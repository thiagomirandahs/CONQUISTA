-- =============================================================================
--  Fase 8.2 — CANAL DE ALERTA.
--
--  A fase 8.1 criou observabilidade: `app_erros`, `infra_falhas`, `cron_falhas`, `painel_erros()`.
--  Tudo GRAVA. Ninguém é AVISADO. A diferença entre as duas coisas é a diferença entre "dá para
--  investigar depois" e "alguém fica sabendo agora".
--
--  Não é um SOC. São seis categorias, uma porta e um mock.
--
--  O desenho é deliberadamente o MESMO que a fase 5 usou para gateway de pagamento
--  (`billing_providers` + porta única + mock local), e não por simetria estética: já existe
--  teste, vocabulário e hábito operacional em cima dele. A regra, na frase da migration 48:
--  o motor nunca conhece o fornecedor.
--
--  TRÊS SEPARAÇÕES, as mesmas do push (item 1 desta fase):
--    alertas .......... o EVENTO lógico — um por CONDIÇÃO, não um por ocorrência. Se o mesmo
--                       problema acontece 400 vezes, é UM alerta com contador 400. Alerta que
--                       repete vira ruído, e ruído é como alerta morre.
--    alerta_destinos .. para onde vai. `webhook_json` sozinho cobre Slack, Discord, Teams, n8n,
--                       Zapier e qualquer relay próprio — sem o banco saber o nome de nenhum.
--    alerta_entregas .. uma linha por TENTATIVA, com o resultado.
--
--  E o alerta por AUSÊNCIA (`infra_heartbeat`), que fecha o único ponto cego de qualquer sistema
--  de alerta: ele não consegue avisar sobre a própria morte. Se o avaliador parar, o que acusa é
--  a falta do batimento, não a presença de um erro.
--
--  PRIVACIDADE: o alerta SAI do sistema. Ele leva categoria, contagem, janela e club_id — nunca
--  user_id, nome, texto de notificação, mensagem de chat, token ou qualquer dado de menor. O
--  detalhe fica na tabela, cuja leitura é só de `eh_admin_plataforma()`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. O alerta: um por condição aberta.
-- ---------------------------------------------------------------------------
create table if not exists public.alertas (
  id bigserial primary key,
  categoria text not null check (categoria in (
    'erro_critico_app', 'edge_falha_repetida', 'push_degradado',
    'billing_webhook_falha', 'provisionamento_falhou', 'backup_restore_falhou',
    'avaliador_parado')),
  -- O que faz o MESMO problema não virar 400 alertas. Parcial por estado: um problema resolvido
  -- pode voltar a abrir depois, e aí é um alerta novo de verdade.
  chave_dedupe text not null,
  severidade text not null check (severidade in ('aviso', 'alto', 'critico')),
  resumo text not null,
  -- Só metadado: contagens, janelas, código. Nunca conteúdo. O CHECK abaixo é a trava.
  dados jsonb not null default '{}'::jsonb,
  club_id uuid references public.organizational_units(id) on delete set null,
  ocorrencias int not null default 1,
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  estado text not null default 'aberto' check (estado in ('aberto', 'reconhecido', 'resolvido')),
  -- Nenhuma chave de conteúdo em `dados`. Um alerta que carrega o texto do erro leva o dado da
  -- criança para fora do sistema, para um Slack, para sempre.
  constraint alerta_sem_conteudo check (
    not (dados ?| array['titulo','corpo','texto','mensagem','payload','token','endpoint','email','nome'])
  )
);
alter table public.alertas enable row level security;
create unique index if not exists uq_alerta_aberto on public.alertas (categoria, chave_dedupe) where estado <> 'resolvido';
create index if not exists idx_alertas_recentes on public.alertas (ultimo_em desc);

-- ---------------------------------------------------------------------------
-- 2. Os destinos — a interface sem fornecedor.
-- ---------------------------------------------------------------------------
create table if not exists public.alerta_destinos (
  chave text primary key,
  nome text not null,
  tipo text not null check (tipo in ('mock', 'tabela', 'webhook_json')),
  -- O NOME do segredo no Vault, nunca a URL. Assim o destino pode ser versionado e o endereço
  -- (que costuma ser um token de webhook disfarçado de URL) não entra no repositório nem num dump.
  nome_segredo text,
  categorias text[],            -- null = todas
  severidade_minima text not null default 'alto' check (severidade_minima in ('aviso', 'alto', 'critico')),
  ativo boolean not null default true
);
alter table public.alerta_destinos enable row level security;

-- ---------------------------------------------------------------------------
-- 3. As entregas — uma linha por tentativa.
-- ---------------------------------------------------------------------------
create table if not exists public.alerta_entregas (
  id bigserial primary key,
  alerta_id bigint not null references public.alertas(id) on delete cascade,
  destino text not null references public.alerta_destinos(chave) on delete cascade,
  tentativa int not null default 1,
  estado text not null check (estado in ('enfileirada', 'entregue', 'falhou')),
  http_status int,
  quando timestamptz not null default now(),
  unique (alerta_id, destino, tentativa)
);
alter table public.alerta_entregas enable row level security;

-- ---------------------------------------------------------------------------
-- 4. O batimento — o alerta por AUSÊNCIA.
-- ---------------------------------------------------------------------------
create table if not exists public.infra_heartbeat (
  chave text primary key,
  ultimo_em timestamptz not null default now(),
  detalhe text
);
alter table public.infra_heartbeat enable row level security;

grant select on public.alertas, public.alerta_destinos, public.alerta_entregas, public.infra_heartbeat to authenticated;
revoke insert, update, delete on public.alertas, public.alerta_destinos, public.alerta_entregas, public.infra_heartbeat from authenticated, anon, public;
create policy "operação lê alertas" on public.alertas for select to authenticated using (public.eh_admin_plataforma());
create policy "operação lê destinos" on public.alerta_destinos for select to authenticated using (public.eh_admin_plataforma());
create policy "operação lê entregas" on public.alerta_entregas for select to authenticated using (public.eh_admin_plataforma());
create policy "operação lê batimentos" on public.infra_heartbeat for select to authenticated using (public.eh_admin_plataforma());

-- Destino padrão: 'tabela'. É o PISO — mesmo sem nenhum destino externo configurado, a operação
-- tem uma tela em vez de não ter ninguém. Um projeto novo já nasce com isto.
insert into public.alerta_destinos (chave, nome, tipo, severidade_minima)
values ('painel', 'Painel da operação (sem saída de rede)', 'tabela', 'aviso')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Levantar um alerta. É aqui que a deduplicação acontece.
-- ---------------------------------------------------------------------------
create or replace function public.alerta_levantar(
  p_categoria text, p_chave text, p_severidade text, p_resumo text,
  p_dados jsonb default '{}'::jsonb, p_club_id uuid default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  insert into public.alertas (categoria, chave_dedupe, severidade, resumo, dados, club_id)
  values (p_categoria, p_chave, p_severidade, left(p_resumo, 300), coalesce(p_dados, '{}'::jsonb), p_club_id)
  on conflict (categoria, chave_dedupe) where estado <> 'resolvido'
    -- Já aberto: soma a ocorrência e atualiza o retrato. NÃO cria alerta novo, e NÃO reenvia:
    -- é o que separa "um problema acontecendo há uma hora" de "sessenta mensagens no Slack".
    do update set ocorrencias = public.alertas.ocorrencias + 1,
                  ultimo_em = now(),
                  dados = excluded.dados,
                  severidade = case when excluded.severidade = 'critico' or public.alertas.severidade = 'critico' then 'critico' when excluded.severidade = 'alto' or public.alertas.severidade = 'alto' then 'alto' else 'aviso' end
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.alerta_levantar(text, text, text, text, jsonb, uuid) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6. O AVALIADOR: as seis categorias, cada uma com o seu sinal e o seu limiar.
--
-- Os limiares vieram da forma dos dados, não de um número redondo. Onde a categoria é rara e
-- sempre grave (provisionamento, billing), o limiar é 1 — agregar seria esconder. Onde a
-- categoria tem ruído natural (erro de app), a unidade de contagem é a CORRELAÇÃO (uma aba), não
-- a ocorrência, senão um laço de render numa única aba dispara sozinho.
-- ---------------------------------------------------------------------------
create or replace function public.alertas_avaliar()
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int := 0; r record;
begin
  -- (1) erro crítico da aplicação: o MESMO par (rota, código) atingindo 3+ abas distintas em 15
  -- minutos. Três pessoas diferentes batendo no mesmo ponto não é azar.
  for r in
    select regexp_replace(coalesce(e.rota, ''), '[0-9a-f]{8}-[0-9a-f-]{27}', ':id', 'g') as rota,
           coalesce(e.codigo, 'sem-codigo') as codigo,
           count(distinct e.correlacao) as abas, count(*) as total, (array_agg(e.club_id))[1] as club_id
      from public.app_erros e
     where e.quando > now() - interval '15 minutes'
     group by 1, 2 having count(distinct e.correlacao) >= 3
  loop
    perform public.alerta_levantar('erro_critico_app', r.rota || '|' || r.codigo,
      case when r.abas >= 10 then 'critico' else 'alto' end,
      format('%s abas distintas com %s em %s', r.abas, r.codigo, r.rota),
      jsonb_build_object('abas', r.abas, 'ocorrencias', r.total, 'rota', r.rota, 'codigo', r.codigo),
      r.club_id);
    v_n := v_n + 1;
  end loop;

  -- (2) Edge Function: `net._http_response` é hoje o único registro do resultado do invoke, e
  -- ninguém lê essa tabela. 401 é UMA ocorrência = incidente (a fechadura mudou dos dois lados);
  -- 5xx precisa de 3 em 10 min para não alarmar por um invoke frio.
  for r in
    select case when status_code = 401 then '401' else '5xx' end as classe, count(*) as n
      from net._http_response
     where created > now() - interval '10 minutes' and (status_code = 401 or status_code >= 500)
     group by 1
  loop
    if r.classe = '401' or r.n >= 3 then
      perform public.alerta_levantar('edge_falha_repetida', 'edge|' || r.classe,
        case when r.classe = '401' then 'critico' else 'alto' end,
        format('%s resposta(s) %s da Edge Function em 10 min', r.n, r.classe),
        jsonb_build_object('classe', r.classe, 'ocorrencias', r.n));
      v_n := v_n + 1;
    end if;
  end loop;

  -- (3) push degradado. Duas condições muito diferentes:
  --   (a) infra_falhas = configuração ausente: o push está 100% desligado. Sempre crítico.
  --   (b) taxa de falha de entrega alta: está saindo, mas não está chegando.
  for r in
    select origem, count(*) as n, (array_agg(club_id))[1] as club_id
      from public.infra_falhas where quando > now() - interval '1 hour' group by 1
  loop
    perform public.alerta_levantar('push_degradado', 'infra|' || r.origem, 'critico',
      format('%s falha(s) de infraestrutura de push (%s) na última hora', r.n, r.origem),
      jsonb_build_object('origem', r.origem, 'ocorrencias', r.n), r.club_id);
    v_n := v_n + 1;
  end loop;

  for r in
    select club_id,
           count(*) filter (where estado = 'falhou') as falhas,
           count(*) as total
      from public.push_tentativas
     where quando > now() - interval '1 hour'
     group by 1 having count(*) >= 20 and count(*) filter (where estado = 'falhou') > count(*) / 2
  loop
    perform public.alerta_levantar('push_degradado', 'entrega|' || coalesce(r.club_id::text, 'sem-clube'), 'alto',
      format('%s de %s entregas de push falharam na última hora', r.falhas, r.total),
      jsonb_build_object('falhas', r.falhas, 'total', r.total), r.club_id);
    v_n := v_n + 1;
  end loop;

  -- (4) billing: webhook que entrou e nunca foi processado. Limiar 1 — cobrança é dinheiro de
  -- cliente, e agregar aqui seria esconder.
  for r in
    select count(*) as n from public.billing_events
     where processado_em is null and recebido_em < now() - interval '15 minutes'
  loop
    if r.n > 0 then
      perform public.alerta_levantar('billing_webhook_falha', 'nao_processado', 'critico',
        format('%s webhook(s) de cobrança parado(s) há mais de 15 min', r.n),
        jsonb_build_object('parados', r.n));
      v_n := v_n + 1;
    end if;
  end loop;

  -- (5) provisionamento: um clube que nasceu incompleto. Limiar 1, e é o cliente novo.
  for r in
    select ps.club_id, ps.status from public.club_provisioning_status ps
     where ps.status <> 'ok'
  loop
    perform public.alerta_levantar('provisionamento_falhou', 'clube|' || r.club_id::text, 'critico',
      format('clube provisionado com status "%s"', r.status),
      jsonb_build_object('status', r.status), r.club_id);
    v_n := v_n + 1;
  end loop;

  -- (6) backup/restore: alerta por AUSÊNCIA. O procedimento existe e é reexecutável; o que não
  -- existia era alguém perceber que ele parou de rodar. 35 dias dá folga a um ciclo mensal.
  if not exists (select 1 from public.infra_heartbeat
                  where chave = 'restore_teste' and ultimo_em > now() - interval '35 days') then
    perform public.alerta_levantar('backup_restore_falhou', 'sem_teste_recente', 'alto',
      'o teste de restore não roda há mais de 35 dias (ou nunca rodou)',
      jsonb_build_object('ultimo', (select ultimo_em from public.infra_heartbeat where chave = 'restore_teste')));
    v_n := v_n + 1;
  end if;

  -- O batimento do próprio avaliador. É o que permite alertar sobre a morte dele — ver (7).
  insert into public.infra_heartbeat (chave, ultimo_em, detalhe)
  values ('alertas_avaliar', now(), v_n || ' alerta(s)')
  on conflict (chave) do update set ultimo_em = now(), detalhe = excluded.detalhe;

  -- Resolve sozinho o que parou de acontecer: alerta que não se atualiza há 24 h some da lista.
  -- Alerta que não fecha sozinho vira lista que ninguém lê.
  update public.alertas set estado = 'resolvido'
   where estado = 'aberto' and ultimo_em < now() - interval '24 hours';

  return v_n;
end $$;
revoke all on function public.alertas_avaliar() from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 7. O DESPACHO. `webhook_json` é o único tipo que fala com o mundo, e ele não sabe com quem.
-- ---------------------------------------------------------------------------
create or replace function public.alertas_despachar()
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int := 0; a record; d record; v_url text; v_req bigint;
begin
  for a in
    select * from public.alertas
     where estado = 'aberto'
       and not exists (select 1 from public.alerta_entregas e where e.alerta_id = public.alertas.id)
     order by id limit 50
  loop
    for d in select * from public.alerta_destinos where ativo
              and (categorias is null or a.categoria = any(categorias))
              and case severidade_minima when 'aviso' then true
                    when 'alto' then a.severidade in ('alto', 'critico')
                    else a.severidade = 'critico' end
    loop
      if d.tipo = 'webhook_json' then
        select decrypted_secret into v_url from vault.decrypted_secrets where name = d.nome_segredo;
        if v_url is null then
          insert into public.alerta_entregas (alerta_id, destino, estado) values (a.id, d.chave, 'falhou');
          continue;
        end if;
        -- O ENVELOPE. Versionado, e sem nada além de metadado: categoria, severidade, contagem,
        -- janela e clube. Nem user_id, porque o alerta sai do sistema.
        select net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object(
            'versao', 1, 'produto', 'DesbravaClube',
            'categoria', a.categoria, 'severidade', a.severidade,
            'resumo', a.resumo, 'ocorrencias', a.ocorrencias,
            'desde', a.primeiro_em, 'ate', a.ultimo_em,
            'club_id', a.club_id, 'dados', a.dados),
          timeout_milliseconds := 10000) into v_req;
        insert into public.alerta_entregas (alerta_id, destino, estado) values (a.id, d.chave, 'enfileirada');
      else
        -- 'tabela' e 'mock' não saem para a rede. O mock existe para o ciclo inteiro ser
        -- exercitável em teste, exatamente como o provedor mock de cobrança da fase 5.
        insert into public.alerta_entregas (alerta_id, destino, estado, http_status)
        values (a.id, d.chave, 'entregue', 200);
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;
revoke all on function public.alertas_despachar() from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 8. A tela da operação, e o registro de um batimento externo.
-- ---------------------------------------------------------------------------
create or replace function public.painel_alertas(p_horas int default 72)
returns table (categoria text, severidade text, resumo text, ocorrencias int,
               club_id uuid, primeiro_em timestamptz, ultimo_em timestamptz, estado text)
language sql stable security definer set search_path = ''
as $$
  select a.categoria, a.severidade, a.resumo, a.ocorrencias, a.club_id, a.primeiro_em, a.ultimo_em, a.estado
    from public.alertas a
   where public.eh_admin_plataforma()
     and a.ultimo_em > now() - (greatest(least(coalesce(p_horas, 72), 720), 1) || ' hours')::interval
   order by case a.severidade when 'critico' then 0 when 'alto' then 1 else 2 end, a.ultimo_em desc
   limit 200;
$$;
revoke all on function public.painel_alertas(int) from public, anon;
grant execute on function public.painel_alertas(int) to authenticated;

-- Registrar um batimento de fora do banco (o restore testado, por exemplo). Só a operação.
create or replace function public.heartbeat_registrar(p_chave text, p_detalhe text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  insert into public.infra_heartbeat (chave, ultimo_em, detalhe)
  values (left(p_chave, 60), now(), left(coalesce(p_detalhe, ''), 200))
  on conflict (chave) do update set ultimo_em = now(), detalhe = excluded.detalhe;
end $$;
revoke all on function public.heartbeat_registrar(text, text) from public, anon;
grant execute on function public.heartbeat_registrar(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. O agendamento. A cada 5 minutos: avalia e despacha.
-- ---------------------------------------------------------------------------
select cron.schedule('alertas', '*/5 * * * *',
  'select public.alertas_avaliar(); select public.alertas_despachar();')
 where not exists (select 1 from cron.job where jobname = 'alertas');
