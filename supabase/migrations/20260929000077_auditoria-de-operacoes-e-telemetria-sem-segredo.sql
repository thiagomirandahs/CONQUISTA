-- =============================================================================
--  Fase 9, item 7 (OBSERVABILIDADE + SEGURANÇA).
--
--  A pergunta do item: para cada operação crítica, dá para responder QUEM fez, O QUÊ, em QUAL
--  clube, QUANDO e por QUAL componente — sem gravar token, código, evidência, foto ou dado sensível
--  de criança? O inventário da fase 9 respondeu "sim" para push, cron, alertas, convites, códigos,
--  mensalidade, pontos, documento e avaliação (todos têm `*_por` e data). E "NÃO" para três:
--
--    1. MUDANÇA DE VÍNCULO — aprovar uma entrada, suspender, trocar papel ou unidade. É a operação
--       que dá e tira acesso a crianças, e não deixava rastro nenhum: "quem suspendeu a criança X
--       no clube B, e quando?" não tinha resposta;
--    2. REDEFINIR A SENHA de um membro pela liderança — nenhum registro. E a função aceitava 6
--       caracteres sem exigência nenhuma, contornando a política de senha da fase 8.1 (8, com letras
--       e números): uma liderança podia dar "123456" a uma criança;
--    3. LIGAR/DESLIGAR RECURSO do clube — nenhum registro.
--
--  E duas brechas de "defesa numa camada só" na telemetria de erro (`registrar_erro`):
--    · o servidor descartava a querystring, mas NÃO o fragmento (`#convite=<token>`); só o cliente
--      impedia o token de chegar;
--    · `/verificar/:token` põe o token do DOCUMENTO no caminho — um erro naquela tela gravava o
--      token, que abre o resumo do documento de uma criança.
-- =============================================================================

-- ---------------------------------------------------------------------------
--  1. A trilha: uma tabela, escrita só por gatilho/função, lida só pela operação da plataforma.
--     Nada de conteúdo: ids, nome da operação e o que mudou (status, papel, unidade, recurso).
-- ---------------------------------------------------------------------------
create table if not exists public.auditoria_operacoes (
  id        bigserial primary key,
  quando    timestamptz not null default now(),
  ator      uuid,                 -- quem fez (auth.uid()); nulo = rotina do banco
  -- em que clube (ou unidade institucional). FK com `set null`, como infra_falhas: o registro do
  -- que aconteceu sobrevive à remoção do clube
  club_id   uuid references public.organizational_units (id) on delete set null,
  alvo      uuid,                 -- sobre quem
  operacao  text not null,
  detalhe   jsonb not null default '{}'::jsonb
);
create index if not exists auditoria_operacoes_quando_idx on public.auditoria_operacoes (quando desc);
create index if not exists auditoria_operacoes_alvo_idx on public.auditoria_operacoes (alvo, quando desc);
alter table public.auditoria_operacoes enable row level security;
revoke all on public.auditoria_operacoes from public, anon, authenticated;
revoke all on sequence public.auditoria_operacoes_id_seq from public, anon, authenticated;

create or replace function public._auditar(p_operacao text, p_club uuid, p_alvo uuid, p_detalhe jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.auditoria_operacoes (ator, club_id, alvo, operacao, detalhe)
  values (auth.uid(), p_club, p_alvo, p_operacao, coalesce(p_detalhe, '{}'::jsonb));
$$;
revoke all on function public._auditar(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
--  2. Vínculos: todo nascimento, mudança de status/papel/unidade e remoção.
-- ---------------------------------------------------------------------------
create or replace function public._auditar_vinculo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public._auditar('vinculo_criado', new.organizational_unit_id, new.user_id,
      jsonb_build_object('status', new.status, 'papel', new.role, 'unidade_id', new.unidade_id));
  elsif tg_op = 'UPDATE' then
    perform public._auditar('vinculo_alterado', new.organizational_unit_id, new.user_id,
      jsonb_strip_nulls(jsonb_build_object(
        'status',     case when new.status is distinct from old.status then jsonb_build_array(old.status, new.status) end,
        'papel',      case when new.role is distinct from old.role then jsonb_build_array(old.role, new.role) end,
        'unidade_id', case when new.unidade_id is distinct from old.unidade_id then jsonb_build_array(old.unidade_id, new.unidade_id) end)));
  else
    perform public._auditar('vinculo_removido', old.organizational_unit_id, old.user_id,
      jsonb_build_object('status', old.status, 'papel', old.role));
  end if;
  return null;
end;
$$;
drop trigger if exists trg_auditar_vinculo on public.organization_memberships;
create trigger trg_auditar_vinculo
  after insert or delete or update of status, role, unidade_id on public.organization_memberships
  for each row execute function public._auditar_vinculo();

-- ---------------------------------------------------------------------------
--  3. Senha redefinida pela liderança: registrada, e na MESMA política do Auth (8, letras e números).
-- ---------------------------------------------------------------------------
create or replace function public.resetar_senha_membro(alvo uuid, nova_senha text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_papel text;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club)
     or not exists (select 1 from public.organization_memberships where user_id = alvo and organizational_unit_id = v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor do clube desta pessoa).';
  end if;
  select role into v_papel from public.organization_memberships
   where user_id = alvo and organizational_unit_id = v_club order by created_at desc limit 1;
  if v_papel in ('diretoria', 'instrutor', 'tesoureiro') and not public.diretoria_gere_usuario(alvo) then
    raise exception 'Sem permissão: só a diretoria redefine a senha de diretoria, instrutor ou tesoureiro.';
  end if;
  -- a mesma regra que o Auth aplica no cadastro e na recuperação (fase 8.1). Antes: 6, sem exigência.
  if nova_senha is null or length(nova_senha) < 8 or nova_senha !~ '[A-Za-z]' or nova_senha !~ '[0-9]' then
    raise exception 'A senha precisa ter pelo menos 8 caracteres, com letras e números.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(nova_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = alvo;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
  perform public._auditar('senha_redefinida', v_club, alvo, jsonb_build_object('papel_do_alvo', v_papel));
end;
$$;

-- ---------------------------------------------------------------------------
--  4. Recurso ligado/desligado: registrado.
-- ---------------------------------------------------------------------------
create or replace function public.recurso_definir(p_feature text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas a liderança do clube).';
  end if;
  if p_enabled is null then
    raise exception 'Informe se o recurso fica ligado ou desligado.';
  end if;
  if not exists (select 1 from public.recursos_catalogo where chave = p_feature) then
    raise exception 'Recurso desconhecido.';
  end if;
  -- desligar o leilão com leilão em andamento esconderia a tela com pontos das unidades em jogo
  if p_feature = 'leilao' and not p_enabled
     and exists (select 1 from public.leiloes where club_id = v_club and status = 'aberto') then
    raise exception 'Há leilão aberto: encerre ou cancele antes de desligar o leilão.';
  end if;
  insert into public.club_features (club_id, feature, enabled) values (v_club, p_feature, p_enabled)
  on conflict (club_id, feature) do update set enabled = excluded.enabled, updated_at = now();
  perform public._auditar('recurso_alterado', v_club, null, jsonb_build_object('recurso', p_feature, 'ligado', p_enabled));
  return public.recursos_do_clube(v_club);
end;
$$;

-- ---------------------------------------------------------------------------
--  5. O painel da operação: as últimas operações, sem nome de ninguém (ids bastam para investigar
--     um relato; o nome, se preciso, a operação busca com o próprio acesso dela).
-- ---------------------------------------------------------------------------
create or replace function public.painel_operacoes(p_horas integer default 72)
returns table (quando timestamptz, operacao text, club_id uuid, ator uuid, alvo uuid, detalhe jsonb)
language sql stable security definer set search_path = '' as $$
  select a.quando, a.operacao, a.club_id, a.ator, a.alvo, a.detalhe
    from public.auditoria_operacoes a
   where public.eh_admin_plataforma()
     and a.quando > now() - (greatest(least(coalesce(p_horas, 72), 2160), 1) || ' hours')::interval
   order by a.quando desc
   limit 500;
$$;
revoke all on function public.painel_operacoes(integer) from public, anon;
grant execute on function public.painel_operacoes(integer) to authenticated;

-- ---------------------------------------------------------------------------
--  6. Telemetria de erro sem segredo, no SERVIDOR (o cliente já tentava; agora não é a única camada).
-- ---------------------------------------------------------------------------
create or replace function public._sem_segredo(p_texto text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(regexp_replace(coalesce(p_texto, ''),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[e-mail]', 'g'),   -- e-mail
    '\m[0-9A-Fa-f]{16,}\M', '[segredo]', 'g'),                            -- código de entrada (16 hex), tokens hex
    '\m[A-Za-z0-9_]{32,}\M', '[segredo]', 'g');                           -- tokens longos. SEM hífen de propósito:
                                                                          -- um uuid (grupos de até 12) continua legível
$$;

create or replace function public.registrar_erro(p_origem text, p_correlacao text, p_rota text default null,
  p_contexto text default null, p_codigo text default null, p_agente text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_recentes int; v_rota text;
begin
  if p_origem is null or p_origem not in ('ui', 'boundary', 'janela', 'promessa') then return; end if;
  if p_correlacao is null or length(p_correlacao) not between 8 and 64 then return; end if;

  -- Teto: 20 erros por correlação por hora. Passou disso, para de gravar em silêncio — o
  -- objetivo é investigar um relato, não capturar cada quadro de um laço.
  select count(*) into v_recentes
    from public.app_erros
   where correlacao = p_correlacao and quando > now() - interval '1 hour';
  if v_recentes >= 20 then return; end if;

  -- a rota: sem querystring E sem fragmento (onde andam `?convite=` e `#convite=`), com o token do
  -- documento trocado por um marcador, e qualquer outro segmento com cara de segredo também. O uuid
  -- de um registro continua (é o que permite reproduzir o erro); um token, não.
  v_rota := regexp_replace(coalesce(p_rota, ''), '[?#].*$', '');
  v_rota := regexp_replace(v_rota, '^/verificar/[^/]+', '/verificar/:token');
  v_rota := public._sem_segredo(v_rota);

  insert into public.app_erros (user_id, club_id, origem, rota, contexto, codigo, correlacao, agente)
  values (
    v_uid,
    -- o clube vem do HEADER da requisição, pela mesma função que o resto do app usa: é o clube
    -- em que a pessoa estava de fato, não um palpite do cliente
    public.clube_atual_id(),
    p_origem,
    left(v_rota, 120),
    left(public._sem_segredo(p_contexto), 200),
    left(public._sem_segredo(p_codigo), 80),
    p_correlacao,
    left(coalesce(p_agente, ''), 120)
  );
end;
$$;
