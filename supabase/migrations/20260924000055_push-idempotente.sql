-- =============================================================================
--  Fase 8.2 — PUSH IDEMPOTENTE, de ponta a ponta.
--
--  O que existia antes desta migration, medido e não estimado: **nada**. Nenhuma constraint,
--  nenhum registro de entrega, nenhuma chave de negócio. `notificacoes.id` é `gen_random_uuid()`,
--  um substituto gerado a cada INSERT — dois INSERTs para o mesmo fato do mundo real
--  ("aniversário do João no clube A em 23/09") recebem ids diferentes, então a chave não colide e
--  não deduplica coisa alguma. A Edge Function sequer lê o id: ela recalcula o público a cada
--  invoke e descarta tudo no fim.
--
--  Os caminhos de duplicata que a auditoria encontrou, todos reais:
--    · cron sem guarda nenhuma (aniversariantes, eventos de amanhã);
--    · duplicata DENTRO de uma única execução — o join de membros não tem `distinct`, e a mesma
--      pessoa pode ter dois vínculos ativos no mesmo clube com papéis diferentes;
--    · check-then-act nos lembretes diários: duas execuções concorrentes leem o valor velho e
--      ambas inserem (é uma corrida, e toda guarda por leitura-antes-de-escrever perde);
--    · o gatilho manda `timeout_milliseconds := 5000` e a função trabalha em lotes que podem
--      passar disso — o pg_net marca `timed_out` numa entrega que está acontecendo;
--    · invoke que morre no lote 12 de 20: os 11 primeiros já chegaram, e sem registro por
--      destinatário qualquer redisparo é tudo-ou-nada;
--    · duplo toque na UI (`RadarFaltas`, botão sem `disabled`);
--    · rotação de token do FCM: o MESMO aparelho vira duas linhas em push_tokens — a duplicata
--      que sobrevive a qualquer chave de evento, porque não existe identidade de APARELHO;
--    · e o pior de todos: **restaurar um backup** dentro de um projeto cujo Vault tem a URL e o
--      segredo replica os INSERTs históricos, e todo membro de todo clube recebe meses de
--      notificação de uma vez.
--
--  O DESENHO — três níveis, três chaves, exatamente o "evento → destinatários → tentativas":
--
--    NÍVEL 1  push_eventos           chave de NEGÓCIO única e imutável.
--             Mata cron duplicado, duplo toque e replay ANTES do pg_net: se o evento não nasce,
--             o gatilho nem dispara. Não depende da Edge Function ser correta.
--
--    NÍVEL 2  push_evento_destinatarios   público CONGELADO no instante do evento.
--             Hoje o público é recalculado dentro do invoke, então um retry lê uma associação
--             diferente da do momento do evento (alguém entrou, alguém saiu, alguém mudou de
--             papel) e "reenviar" deixa de ser bem definido. Congelar torna o retry determinístico.
--
--    NÍVEL 3  push_tentativas        uma linha por TENTATIVA, com índice único PARCIAL.
--             A chave final é (destinatário, APARELHO) e não (destinatário). As duas falhas são
--             simétricas: por pessoa, o tablet ficaria calado (trocaríamos duplicata por PERDA,
--             que num aviso de reunião para criança é pior); e por pessoa nem resolve, porque
--             durante a rotação de token o mesmo aparelho tem duas linhas. O aparelho é onde o
--             ser humano percebe a duplicata — é onde a última constraint pertence.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. IDENTIDADE DE APARELHO — o pré-requisito que não existia.
--
-- `push_tokens` tem PK no próprio token e `push_subscriptions` unique no endpoint. Como o FCM
-- rotaciona tokens e o navegador re-inscreve com endpoint novo, o mesmo aparelho físico vira
-- duas linhas e o telefone toca duas vezes — por baixo de qualquer chave de evento.
--
-- O cliente gera um uuid opaco UMA vez e o guarda localmente. O unique abaixo faz o registro
-- SUBSTITUIR a credencial antiga do mesmo aparelho em vez de acrescentar outra.
-- ---------------------------------------------------------------------------
alter table public.push_tokens        add column if not exists dispositivo_id uuid;
alter table public.push_subscriptions add column if not exists dispositivo_id uuid;

create unique index if not exists uq_push_token_aparelho
  on public.push_tokens (user_id, dispositivo_id) where dispositivo_id is not null;
create unique index if not exists uq_push_sub_aparelho
  on public.push_subscriptions (user_id, dispositivo_id) where dispositivo_id is not null;

-- ---------------------------------------------------------------------------
-- 2. NÍVEL 1 — o evento.
-- ---------------------------------------------------------------------------
create table if not exists public.push_eventos (
  id uuid primary key default gen_random_uuid(),
  -- A chave de NEGÓCIO. Determinística, imutável, construída a partir do fato — nunca de now()
  -- nem de gen_random_uuid(). O dedup inteiro é `on conflict (chave_evento) do nothing`.
  chave_evento text not null unique,
  -- O que dedupica dentro de uma janela curta mesmo quando a chave muda (duplo toque que
  -- atravessa a virada do minuto). A chave única decide a CORRIDA; este hash decide a JANELA.
  conteudo_hash text,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  criado_em timestamptz not null default now(),
  despachado_em timestamptz,
  destinatarios int not null default 0
);
alter table public.push_eventos enable row level security;
revoke all on public.push_eventos from public, authenticated, anon;
create index if not exists idx_push_eventos_janela on public.push_eventos (club_id, conteudo_hash, criado_em desc);

-- ---------------------------------------------------------------------------
-- 3. NÍVEL 2 — o público, congelado.
-- ---------------------------------------------------------------------------
create table if not exists public.push_evento_destinatarios (
  id bigserial primary key,
  evento_id uuid not null references public.push_eventos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  unique (evento_id, user_id)
);
alter table public.push_evento_destinatarios enable row level security;
revoke all on public.push_evento_destinatarios from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. NÍVEL 3 — as tentativas.
--
-- Uma linha POR TENTATIVA (o histórico é o requisito), e um índice único parcial que só enxerga
-- o que está em voo ou já entregue:
--    'enviando'  -> reservado por um invoke; ninguém mais pode reservar
--    'entregue'  -> nunca mais será enviado
--    'falhou'    -> SAI do índice, então uma tentativa nova pode reservar de novo
-- É o que dá, ao mesmo tempo, exatamente-uma-vez na entrega e histórico completo de tentativa.
--
-- `codigo` é vocabulário FECHADO de propósito: o corpo de erro livre do provedor pode ecoar o
-- payload de volta, e o payload fala de criança.
-- ---------------------------------------------------------------------------
create table if not exists public.push_tentativas (
  id bigserial primary key,
  destinatario_id bigint not null references public.push_evento_destinatarios(id) on delete cascade,
  -- Identidade do APARELHO. Quando o cliente ainda não mandou `dispositivo_id`, é um uuid
  -- DERIVADO da credencial (md5 do endpoint/token) — determinístico, e sem guardar a credencial.
  dispositivo_id uuid not null,
  canal text not null check (canal in ('web', 'fcm')),
  estado text not null check (estado in ('enviando', 'entregue', 'falhou', 'descartado')),
  codigo text check (codigo is null or codigo in
    ('200', '201', '404', '410', '429', '500', '503', 'timeout', 'rede', 'oauth', 'desconhecido')),
  duracao_ms int,
  club_id uuid references public.organizational_units(id) on delete set null,
  quando timestamptz not null default now()
);
alter table public.push_tentativas enable row level security;
revoke all on public.push_tentativas from public, authenticated, anon;

-- A constraint que impede o telefone de tocar duas vezes.
create unique index if not exists uq_push_entrega_por_aparelho
  on public.push_tentativas (destinatario_id, dispositivo_id)
  where estado in ('enviando', 'entregue');

create index if not exists idx_push_tentativas_quando on public.push_tentativas (quando desc);
create index if not exists idx_push_tentativas_destinatario on public.push_tentativas (destinatario_id);

-- Leitura: operação da plataforma, como toda telemetria desde a fase 8.1. A diretoria do clube
-- não lê o histórico de entrega das outras pessoas.
grant select on public.push_eventos, public.push_evento_destinatarios, public.push_tentativas to authenticated;
create policy "operação lê eventos de push" on public.push_eventos
  for select to authenticated using (public.eh_admin_plataforma());
create policy "operação lê destinatários de push" on public.push_evento_destinatarios
  for select to authenticated using (public.eh_admin_plataforma());
create policy "operação lê tentativas de push" on public.push_tentativas
  for select to authenticated using (public.eh_admin_plataforma());

grant select, insert, update on public.push_eventos to service_role;
grant select, insert on public.push_evento_destinatarios to service_role;
grant select, insert, update on public.push_tentativas to service_role;
grant usage, select on sequence public.push_tentativas_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- 5. A LIGAÇÃO com `notificacoes`, por INTENÇÃO POSITIVA.
--
-- Esta é a decisão que conserta o restore, e ela é deliberadamente pela afirmativa: a linha só
-- dispara push se CARREGAR um evento. Sem evento, sem push.
--
-- Uma guarda pela negativa (`current_setting('conquista.sem_push')`) seria mais fraca, porque
-- dependeria de todo script futuro — seed, fixture, backfill, importação — lembrar de ligá-la.
-- Aqui, esquecer significa não enviar; e o modo de falha certo para push é o silêncio.
--
-- E o restore fica resolvido por construção: num `pg_restore` as linhas de `push_eventos` voltam
-- junto, então a tentativa de recriar o evento CONFLITA, nenhum evento é novo, e nada dispara.
-- ---------------------------------------------------------------------------
alter table public.notificacoes add column if not exists push_evento_id uuid
  references public.push_eventos(id) on delete set null;
-- A chave que o PRODUTOR escolhe, quando ele sabe qual é o fato. Ex.:
--   'aniversario:<club>:<user>:2026-09-23'   'lance_superado:<lance_id>:<unidade_id>'
-- Deixar nulo é legítimo: a chave é derivada do conteúdo + janela de minuto (ver abaixo).
alter table public.notificacoes add column if not exists chave_push text;

-- ---------------------------------------------------------------------------
-- 6. A criação do evento — onde todo o dedup acontece.
--
-- Devolve o id do evento SÓ quando ele é NOVO. Evento que já existia devolve null, e null
-- significa "não dispare": é a mesma resposta para cron repetido, duplo toque e replay.
-- ---------------------------------------------------------------------------
create or replace function public._push_criar_evento(
  p_club_id uuid, p_chave text, p_conteudo_hash text, p_para text, p_para_usuario uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_n int;
begin
  if p_club_id is null then return null; end if;

  -- (a) JANELA: mesmo conteúdo, mesmo clube, nos últimos 2 minutos = mesmo evento.
  -- Cobre o duplo toque que atravessa a virada do minuto, que a chave sozinha deixaria passar.
  if p_conteudo_hash is not null and exists (
    select 1 from public.push_eventos e
     where e.club_id = p_club_id and e.conteudo_hash = p_conteudo_hash
       and e.criado_em > now() - interval '2 minutes'
  ) then
    return null;
  end if;

  -- (b) CORRIDA: o índice único decide, sem ler antes de escrever. Duas transações concorrentes
  -- com a mesma chave — cron sobreposto, dois toques, dois workers — e exatamente uma ganha.
  insert into public.push_eventos (chave_evento, conteudo_hash, club_id)
  values (p_chave, p_conteudo_hash, p_club_id)
  on conflict (chave_evento) do nothing
  returning id into v_id;

  if v_id is null then return null; end if;   -- já existia: não é evento novo

  -- (c) CONGELA o público agora. Recalcular no momento do envio faria o retry enviar para um
  -- conjunto diferente do original.
  insert into public.push_evento_destinatarios (evento_id, user_id)
  select v_id, u from public._push_publico(p_club_id, p_para, p_para_usuario) u
  on conflict do nothing;
  get diagnostics v_n = row_count;

  update public.push_eventos set destinatarios = v_n where id = v_id;
  return v_id;
end $$;
revoke all on function public._push_criar_evento(uuid, text, text, text, uuid) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 7. O gatilho de `notificacoes`: BEFORE INSERT, criando o evento.
--
-- BEFORE (e não AFTER) porque ele precisa gravar `push_evento_id` na própria linha — é isso que
-- faz a intenção de despacho ficar registrada e auditável, em vez de viver só no ar.
-- ---------------------------------------------------------------------------
create or replace function public._push_preparar_evento()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_hash text; v_chave text;
begin
  -- Produtor que já trouxe o evento pronto (ou que declarou explicitamente que não quer push,
  -- com chave_push = '') passa direto.
  if new.push_evento_id is not null then return new; end if;
  if new.chave_push = '' then return new; end if;
  if new.club_id is null then return new; end if;

  v_hash := encode(extensions.digest(
    coalesce(new.titulo, '') || E'\n' || coalesce(new.corpo, '') || E'\n' ||
    coalesce(new.link, '')   || E'\n' || new.para || E'\n' || coalesce(new.para_usuario::text, ''),
    'sha256'), 'hex');

  -- Sem chave do produtor, a chave é conteúdo + JANELA DE MINUTO. Escolha deliberada:
  --   · um cron que roda duas vezes no mesmo minuto, ou um duplo toque, colidem — é o que se quer;
  --   · o MESMO aviso enviado de novo daqui a uma hora passa — também é o que se quer, porque
  --     repetir um aviso é uma ação legítima e não cabe ao banco adivinhar que foi engano.
  -- Produtores com repetição legítima no mesmo minuto (um leilão com dois lances seguidos, por
  -- exemplo) precisam trazer a PRÓPRIA chave, com o id do fato dentro.
  v_chave := coalesce(nullif(new.chave_push, ''),
    'auto:' || new.club_id::text || ':' || v_hash || ':' ||
    to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI'));

  new.push_evento_id := public._push_criar_evento(
    new.club_id, v_chave, v_hash, new.para, new.para_usuario);
  return new;
end $$;
revoke all on function public._push_preparar_evento() from public, authenticated, anon;

drop trigger if exists trg_notificacao_evento on public.notificacoes;
create trigger trg_notificacao_evento
  before insert on public.notificacoes
  for each row execute function public._push_preparar_evento();

-- ---------------------------------------------------------------------------
-- 8. O disparo passa a ser CONDICIONADO ao evento.
--
-- Substitui a versão da migration 52, que disparava incondicionalmente por linha. Os dois
-- ajustes: só dispara com evento novo, e o corpo leva o `evento_id` (a função precisa dele para
-- reservar as entregas).
--
-- O timeout também sobe de 5 s para 30 s: a auditoria mostrou que 5 s era menor que o trabalho
-- real da função (lotes de 25 com prazo de 10 s cada), então o pg_net marcava `timed_out` numa
-- entrega que estava acontecendo — e um retry construído em cima disso reenviaria.
-- ---------------------------------------------------------------------------
create or replace function public._push_disparar()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_url text; v_segredo text;
begin
  -- Sem evento não há despacho. É a intenção positiva: seed, fixture, backfill e restore
  -- simplesmente não chegam aqui.
  if new.push_evento_id is null then return new; end if;

  select decrypted_secret into v_url     from vault.decrypted_secrets where name = 'push_edge_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'push_webhook_secret';

  if v_url is null or v_segredo is null then
    insert into public.infra_falhas (origem, detalhe, club_id)
    values ('push/webhook',
            'sem configuração no Vault: ' ||
            case when v_url is null and v_segredo is null then 'push_edge_url e push_webhook_secret'
                 when v_url is null then 'push_edge_url'
                 else 'push_webhook_secret' end,
            new.club_id);
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-webhook-secret', v_segredo),
    body := jsonb_build_object('type', 'INSERT', 'table', 'notificacoes', 'record', to_jsonb(new)),
    timeout_milliseconds := 30000
  );
  update public.push_eventos set despachado_em = now() where id = new.push_evento_id;
  return new;
end $$;
revoke all on function public._push_disparar() from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 9. RESERVAR — o que a Edge Function chama ANTES de enviar qualquer coisa.
--
-- Devolve só as entregas que ESTE invoke conseguiu reservar. Um segundo invoke do mesmo evento
-- (retry, timeout, reprocessamento) recebe lista vazia, porque o índice único já tem as linhas.
-- A credencial vai na resposta mas NUNCA é gravada: `dispositivo_id` é derivado dela por md5.
-- ---------------------------------------------------------------------------
create or replace function public.push_reservar(p_evento_id uuid)
returns table (tentativa_id bigint, canal text, endpoint text, p256dh text, auth text, token text)
language plpgsql security definer set search_path = ''
as $$
-- `canal`, `endpoint`, `auth` e `token` são nomes de COLUNA e, ao mesmo tempo, de parâmetro de
-- saída desta função. Sem a diretiva o plpgsql recusa por ambiguidade — resolver pela coluna é o
-- que se quer em todo o corpo; os parâmetros de saída só são preenchidos no `return query`.
#variable_conflict use_column
declare v_club uuid;
begin
  select club_id into v_club from public.push_eventos where id = p_evento_id;
  if v_club is null then return; end if;

  -- Tentativa 'enviando' antiga demais = invoke que morreu no meio. Liberar é o que permite o
  -- retry; sem isso a entrega ficaria presa para sempre.
  update public.push_tentativas
     set estado = 'falhou', codigo = 'timeout'
   where estado = 'enviando' and quando < now() - interval '10 minutes'
     and destinatario_id in (select id from public.push_evento_destinatarios where evento_id = p_evento_id);

  return query
  with candidatos as (
    -- WEB: uma entrega por inscrição
    select d.id as dest, 'web'::text as ch,
           coalesce(s.dispositivo_id, md5(s.endpoint)::uuid) as disp,
           s.endpoint as ep, s.p256dh as pk, s.auth as au, null::text as tk
      from public.push_evento_destinatarios d
      join public.push_subscriptions s on s.user_id = d.user_id
     where d.evento_id = p_evento_id
    union all
    -- APK: uma entrega por token
    select d.id, 'fcm'::text,
           coalesce(k.dispositivo_id, md5(k.token)::uuid),
           null, null, null, k.token
      from public.push_evento_destinatarios d
      join public.push_tokens k on k.user_id = d.user_id
     where d.evento_id = p_evento_id
  ),
  reservadas as (
    insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, club_id)
    select c.dest, c.disp, c.ch, 'enviando', v_club from candidatos c
    -- O coração da idempotência: quem já está 'enviando' ou 'entregue' não entra.
    on conflict (destinatario_id, dispositivo_id) where estado in ('enviando', 'entregue')
      do nothing
    returning id, destinatario_id, dispositivo_id, canal
  )
  select r.id, r.canal, c.ep, c.pk, c.au, c.tk
    from reservadas r
    join candidatos c on c.dest = r.destinatario_id and c.disp = r.dispositivo_id and c.ch = r.canal;
end $$;
revoke all on function public.push_reservar(uuid) from public, authenticated, anon;
grant execute on function public.push_reservar(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. CONCLUIR — o resultado de cada tentativa reservada.
-- Recebe [{id, ok, codigo, ms}]. Nada do conteúdo entra aqui.
-- ---------------------------------------------------------------------------
create or replace function public.push_concluir(p_resultados jsonb)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  update public.push_tentativas t
     set estado = case when (r->>'ok')::boolean then 'entregue' else 'falhou' end,
         codigo = case when r->>'codigo' in
                    ('200','201','404','410','429','500','503','timeout','rede','oauth')
                  then r->>'codigo' else 'desconhecido' end,
         duracao_ms = nullif((r->>'ms')::int, 0),
         quando = now()
    from jsonb_array_elements(coalesce(p_resultados, '[]'::jsonb)) r
   where t.id = (r->>'id')::bigint and t.estado = 'enviando';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.push_concluir(jsonb) from public, authenticated, anon;
grant execute on function public.push_concluir(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 11. O aparelho, registrado pelo cliente.
-- ---------------------------------------------------------------------------
create or replace function public.push_aparelho_registrar(p_dispositivo_id uuid, p_endpoint text default null, p_token text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_dispositivo_id is null then return; end if;
  -- Só marca o que JÁ é da própria pessoa: a função não cria inscrição nem token, só carimba o
  -- aparelho em cima do que ela mesma registrou.
  if p_endpoint is not null then
    update public.push_subscriptions set dispositivo_id = p_dispositivo_id
     where endpoint = p_endpoint and user_id = v_uid;
  end if;
  if p_token is not null then
    update public.push_tokens set dispositivo_id = p_dispositivo_id
     where token = p_token and user_id = v_uid;
  end if;
end $$;
revoke all on function public.push_aparelho_registrar(uuid, text, text) from public, anon;
grant execute on function public.push_aparelho_registrar(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Retenção. `push_tentativas` é a tabela de maior volume do sistema
-- (eventos x destinatários x aparelhos x tentativas). Sem expurgo ela vira o próximo gargalo.
-- ---------------------------------------------------------------------------
create or replace function public.expurgar_push()
returns void language sql security definer set search_path = '' as $$
  delete from public.push_eventos where criado_em < now() - interval '90 days';
$$;
revoke all on function public.expurgar_push() from public, authenticated, anon;

select cron.schedule('expurgar-push', '40 3 * * *', 'select public.expurgar_push()')
 where not exists (select 1 from cron.job where jobname = 'expurgar-push');

-- ---------------------------------------------------------------------------
-- 13. Os produtores que a chave automática NÃO cobriria — conferidos um a um.
--
-- A chave automática é conteúdo + janela de minuto, e o "conteúdo" inclui título, corpo, link,
-- destino e destinatário. O risco dela é o oposto da duplicata: colapsar um aviso LEGÍTIMO que
-- se repete no mesmo minuto — trocar duplicata por PERDA, que num aviso para criança é pior.
--
-- Os candidatos foram conferidos:
--
--   leilão / "passaram sua unidade" — SEGURO sem chave própria. O corpo carrega o VALOR do lance
--     ('deu um lance de 120 no ...'), e lance seguinte é obrigatoriamente maior. Corpos
--     diferentes, hashes diferentes, eventos diferentes. Some-se a isso que `para_usuario` entra
--     no hash, então cada pessoa superada já tem o seu próprio evento.
--
--   crons diários (aniversário, evento de amanhã, lembrete de ausência, jogos do dia) — SEGUROS
--     e, mais que isso, CORRIGIDOS pela chave automática: uma segunda execução no mesmo minuto
--     colide e é descartada, que é exatamente o bug que a auditoria encontrou. Uma execução
--     repetida horas depois ainda passa; quando esses crons forem revistos, a chave explícita
--     com a data (`aniversario:<club>:<user>:<data>`) fecha também essa janela. Está registrado
--     em GO-LIVE-READINESS.md como risco aceito, com o motivo.
--
--   avisos manuais da liderança — SEGUROS: é justamente o caso em que colapsar dois toques no
--     mesmo minuto é o comportamento desejado.
--
-- Nenhum produtor precisou de chave explícita nesta migration. A coluna `chave_push` existe para
-- quando precisar, e o teste 50 prova que ela é honrada quando vem preenchida.
-- ---------------------------------------------------------------------------
