-- =============================================================================
--  Fase 8.1 — o push deixa de depender de alguém lembrar de clicar no painel.
--
--  Dois blockers da Fase 8, que na verdade são o mesmo problema visto de dois lados:
--
--    B3) O Database Webhook que dispara a Edge Function era criado À MÃO no painel do Supabase.
--        Não existia em migration nenhuma. Um projeto novo (um clube novo, um ambiente de
--        staging, uma restauração de backup) subia SEM PUSH e nada avisava: as notificações
--        continuavam entrando na tabela, o app continuava mostrando, e só o aviso no aparelho
--        sumia. É a pior espécie de falha — silenciosa e invisível em teste.
--
--    B2) O APK grava o token do FCM em `push_tokens` desde que o Capacitor entrou, e NENHUM
--        código lê essa tabela. O aparelho Android se registra, o token chega, fica guardado —
--        e o envio só olhava `push_subscriptions` (Web Push). O app promete aviso no celular
--        e não entrega.
--
--  O que esta migration faz:
--    1. `_push_publico()` — a regra de "quem recebe", extraída para um lugar só. Antes ela
--       morava dentro de push_destinatarios(); agora as duas rotas de entrega (Web Push e FCM)
--       leem da MESMA fonte, e não há como uma divergir da outra numa migration futura.
--    2. `push_destinatarios_nativos()` — os tokens FCM do mesmo público.
--    3. `_push_disparar()` + gatilho em `notificacoes` — o webhook, versionado. A URL e o
--       segredo vêm do Vault (`vault.decrypted_secrets`), não do código: o que é específico do
--       ambiente fica fora do repositório, mas o MECANISMO vem junto com as migrations.
--    4. Quando falta configuração, isso é REGISTRADO em `infra_falhas` em vez de passar batido.
--       Um projeto novo sem os segredos continua sem push — mas agora deixa rastro.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. A regra de público, num lugar só.
--    Cópia fiel do que `push_destinatarios` já decidia — 'pessoal' exige vínculo ativo no clube,
--    'lideranca' é instrutor/diretoria, 'todos' é qualquer vínculo ativo menos 'pais'.
--    Sem clube não há público (falha fechada: notificação sem clube nunca vira broadcast).
-- ---------------------------------------------------------------------------
create or replace function public._push_publico(p_club_id uuid, p_para text, p_para_usuario uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id
    from public.organization_memberships m
   where p_club_id is not null
     and m.organizational_unit_id = p_club_id
     and m.status = 'ativo'
     and (
          (p_para_usuario is not null and m.user_id = p_para_usuario)
       or (p_para_usuario is null and p_para = 'lideranca' and m.role in ('instrutor', 'diretoria'))
       or (p_para_usuario is null and p_para = 'todos'     and m.role <> 'pais')
     );
$$;
-- ATENÇÃO ao `revoke ... from authenticated` explícito: este projeto tem
-- `alter default privileges in schema public ... grant execute on functions to authenticated`
-- (migration 20260701000000), então TODA função nova nasce executável por qualquer pessoa
-- logada. Revogar só de `public` não basta — sem a linha abaixo, qualquer membro poderia
-- chamar esta função e enumerar os aparelhos do clube. O teste 47 trava isso.
revoke all on function public._push_publico(uuid, text, uuid) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2a. Web Push (navegador / PWA) — mesma assinatura e mesmo resultado de antes.
-- ---------------------------------------------------------------------------
create or replace function public.push_destinatarios(p_club_id uuid, p_para text, p_para_usuario uuid)
returns table (user_id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = ''
as $$
  select s.user_id, s.endpoint, s.p256dh, s.auth
    from public.push_subscriptions s
   where s.user_id in (select public._push_publico(p_club_id, p_para, p_para_usuario));
$$;
revoke all on function public.push_destinatarios(uuid, text, uuid) from public, authenticated, anon;
grant execute on function public.push_destinatarios(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2b. Push NATIVO (APK Android via FCM) — a rota que faltava.
--     Mesmo público, outra tabela de aparelhos.
-- ---------------------------------------------------------------------------
create or replace function public.push_destinatarios_nativos(p_club_id uuid, p_para text, p_para_usuario uuid)
returns table (user_id uuid, token text, plataforma text)
language sql stable security definer set search_path = ''
as $$
  select k.user_id, k.token, k.plataforma
    from public.push_tokens k
   where k.user_id in (select public._push_publico(p_club_id, p_para, p_para_usuario));
$$;
revoke all on function public.push_destinatarios_nativos(uuid, text, uuid) from public, authenticated, anon;
grant execute on function public.push_destinatarios_nativos(uuid, text, uuid) to service_role;

-- Token que o FCM recusou (aparelho desinstalado, token rotacionado): a Edge Function precisa
-- poder limpar. A policy da tabela é "só o dono mexe", e o service_role não passa por policy —
-- mas precisa do GRANT.
grant select, delete on public.push_tokens to service_role;

-- ---------------------------------------------------------------------------
-- 3. Onde infraestrutura registra que faltou alguma coisa.
--    Sem isto, "o push parou" é invisível até alguém reclamar.
--    Não guarda payload, token nem texto de notificação — só o suficiente para investigar.
-- ---------------------------------------------------------------------------
create table if not exists public.infra_falhas (
  id bigserial primary key,
  quando timestamptz not null default now(),
  origem text not null,
  detalhe text not null,
  -- Opcional de propósito: há falha que não pertence a clube nenhum (o Vault vazio, por exemplo).
  -- `on delete set null` porque o registro do PROBLEMA precisa sobreviver ao clube: se um clube
  -- for apagado, continua valendo saber que o push estava quebrado naquela semana.
  -- A FK existe para satisfazer a matriz de auditoria (teste 20): toda coluna club_id do schema
  -- aponta para organizational_units, sem exceção — é isso que impede um "club_id" solto que
  -- ninguém sabe de onde veio.
  club_id uuid references public.organizational_units(id) on delete set null
);
alter table public.infra_falhas enable row level security;
-- Ninguém lê pelo app: é operação. O acesso é do administrador da plataforma (fase 5) e do
-- service_role. Sem policy de select para `authenticated`, a RLS já nega.
grant select on public.infra_falhas to service_role;
create index if not exists idx_infra_falhas_quando on public.infra_falhas (quando desc);

-- ---------------------------------------------------------------------------
-- 4. O webhook, agora versionado.
--
--    `net.http_post` é assíncrono: enfileira e devolve na hora, então o INSERT da notificação
--    não espera a Edge Function. Se a função estiver fora do ar, a notificação continua gravada
--    (o app a mostra) — só o aviso no aparelho se perde. Era assim com o webhook do painel
--    também; a diferença é que agora está escrito, versionado e testável.
--
--    A URL e o segredo vêm do Vault. Se faltar qualquer um dos dois, a linha entra em
--    `infra_falhas` e o gatilho sai sem erro: uma falha de configuração de infraestrutura não
--    pode impedir uma notificação de ser gravada.
-- ---------------------------------------------------------------------------
create or replace function public._push_disparar()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_url text; v_segredo text;
begin
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
    -- mesmo formato que o Database Webhook do painel enviava, para a Edge Function não precisar
    -- saber por onde foi chamada
    body := jsonb_build_object('type', 'INSERT', 'table', 'notificacoes', 'record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );
  return new;
end $$;
revoke all on function public._push_disparar() from public, authenticated, anon;

drop trigger if exists trg_notificacao_push on public.notificacoes;
create trigger trg_notificacao_push
  after insert on public.notificacoes
  for each row execute function public._push_disparar();
