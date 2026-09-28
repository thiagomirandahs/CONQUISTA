-- =============================================================================
-- 400 — MODO MANUTENÇÃO da plataforma (ninguém perde dado durante uma atualização)
-- =============================================================================
-- Pedido do dono (28/09): durante uma atualização ninguém pode perder dado.
--
-- O que esta migration faz:
--   1) public.plataforma_manutencao: UMA linha (id = 1) com o estado — manutenção ligada/desligada,
--      mensagem da tela, e o AVISO PRÉVIO (horário de início + mensagem da faixa). Só se mexe por RPC.
--   2) manutencao_estado(): leitura PÚBLICA e barata (anon também — a tela de login precisa saber).
--      Devolve só o que vai na tela; nada de quem ligou.
--   3) admin_manutencao_definir(...): só administrador da plataforma (_exigir_admin_plataforma), e
--      toda mudança vai para a auditoria (_admin_auditar, alvo_tipo 'plataforma_manutencao').
--   4) GUARDA CENTRAL DE ESCRITA — a forma MENOS invasiva que cobre tudo:
--      em vez de editar as ~centenas de RPCs de escrita (ou clube_atual_id/_exigir_*, que também são
--      chamados em LEITURAS), cada tabela de public ganha um gatilho FOR EACH STATEMENT
--      (_manutencao_guarda) em insert/update/delete. Com a manutenção ligada ele recusa a escrita
--      quando a requisição veio de usuário do app (papel do JWT = authenticated/anon) que NÃO é
--      admin da plataforma. Pega RPC security definer E escrita direta pelo PostgREST (o papel do JWT
--      continua o mesmo dentro da definer). É um gatilho por COMANDO (não por linha): custa uma
--      leitura por chave primária de uma tabela de 1 linha.
--      Passam: admin da plataforma (para testar), pg_cron/postgres (sem JWT), service_role
--      (Edge Functions) e as migrations. O pg_cron segue rodando (ex.: expirar teste grátis) — se o
--      dono quiser pausar o cron na janela, é decisão dele (ver pendências).
--      Exceções (telemetria/limite de taxa das RPCs públicas; bloquear derrubaria o site público, e
--      não é dado de usuário): app_erros, entrada_tentativas_publicas, vitrine_acessos_publicos,
--      push_tentativas, entrada_tentativas, e a própria plataforma_manutencao/platform_admin_audit.
--   5) Storage: policies RESTRICTIVE em storage.objects recusam upload/troca/apagar de arquivo do
--      usuário comum com a manutenção ligada.
--   6) _manutencao_instalar_guarda(): instala o gatilho nas tabelas que ainda não têm. Tabela NOVA em
--      migration futura: chamar `select public._manutencao_instalar_guarda();` no fim — o teste 100
--      falha se alguma tabela de public ficar sem a guarda.
--
-- A mensagem de erro começa com "MANUTENCAO:" — o cliente reconhece e guarda o rascunho.
-- =============================================================================

create table if not exists public.plataforma_manutencao (
  id smallint primary key default 1 check (id = 1),
  ativo boolean not null default false,
  mensagem text not null default 'Estamos em manutenção, volte em instantes.'
    check (char_length(mensagem) between 1 and 300),
  aviso_inicio timestamptz,
  aviso_mensagem text check (aviso_mensagem is null or char_length(aviso_mensagem) between 1 and 300),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null
);
insert into public.plataforma_manutencao (id) values (1) on conflict (id) do nothing;
alter table public.plataforma_manutencao enable row level security;
revoke all on table public.plataforma_manutencao from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- estado (interno) — usado pela guarda e pelas policies do Storage
-- ---------------------------------------------------------------------------
create or replace function public._manutencao_bloqueia_usuario() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_papel text;
  v_claims text;
begin
  if not exists (select 1 from public.plataforma_manutencao where id = 1 and ativo) then
    return false;
  end if;
  v_papel := nullif(current_setting('request.jwt.claim.role', true), '');
  if v_papel is null then
    v_claims := nullif(current_setting('request.jwt.claims', true), '');
    if v_claims is not null then
      begin
        v_papel := v_claims::jsonb ->> 'role';
      exception when others then v_papel := null;
      end;
    end if;
  end if;
  -- sem JWT (pg_cron, migration) ou service_role (Edge Function): passa
  if v_papel is null or v_papel not in ('authenticated', 'anon') then
    return false;
  end if;
  return not public.eh_admin_plataforma(auth.uid());
end;
$$;
revoke all on function public._manutencao_bloqueia_usuario() from public, anon, authenticated;

create or replace function public._manutencao_guarda() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public._manutencao_bloqueia_usuario() then
    raise exception 'MANUTENCAO: o DesbravaClube está em manutenção. Nada foi alterado; tente de novo em instantes.'
      using errcode = 'P0001', hint = 'manutencao';
  end if;
  return null;
end;
$$;
revoke all on function public._manutencao_guarda() from public, anon, authenticated;

create or replace function public._manutencao_instalar_guarda() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not c.relispartition
       and c.relname not in ('plataforma_manutencao', 'platform_admin_audit', 'app_erros',
                             'entrada_tentativas_publicas', 'entrada_tentativas',
                             'vitrine_acessos_publicos', 'push_tentativas')
       and not exists (select 1 from pg_trigger tg where tg.tgrelid = c.oid and tg.tgname = 'zz_manutencao_guarda')
  loop
    execute format('create trigger zz_manutencao_guarda before insert or update or delete on public.%I '
                   'for each statement execute function public._manutencao_guarda()', r.relname);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public._manutencao_instalar_guarda() from public, anon, authenticated;

select public._manutencao_instalar_guarda();

-- ---------------------------------------------------------------------------
-- Storage: sem upload/troca/apagar de arquivo por usuário comum durante a manutenção
-- ---------------------------------------------------------------------------
drop policy if exists "manutencao: sem upload" on storage.objects;
create policy "manutencao: sem upload" on storage.objects as restrictive for insert to authenticated
  with check (not public._manutencao_bloqueia_usuario());
drop policy if exists "manutencao: sem troca" on storage.objects;
create policy "manutencao: sem troca" on storage.objects as restrictive for update to authenticated
  using (not public._manutencao_bloqueia_usuario());
drop policy if exists "manutencao: sem apagar" on storage.objects;
create policy "manutencao: sem apagar" on storage.objects as restrictive for delete to authenticated
  using (not public._manutencao_bloqueia_usuario());
-- a policy é avaliada como o papel da requisição; a função é definer, mas precisa de EXECUTE
grant execute on function public._manutencao_bloqueia_usuario() to authenticated;

-- ---------------------------------------------------------------------------
-- leitura pública (anon + authenticated): o que a tela precisa, e nada mais
-- ---------------------------------------------------------------------------
create or replace function public.manutencao_estado() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ativo', m.ativo,
    'mensagem', m.mensagem,
    'aviso_inicio', m.aviso_inicio,
    'aviso_mensagem', m.aviso_mensagem,
    'sou_admin', public.eh_admin_plataforma(auth.uid()),
    'agora', now()
  )
  from public.plataforma_manutencao m where m.id = 1;
$$;
revoke all on function public.manutencao_estado() from public;
grant execute on function public.manutencao_estado() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- controle do admin da plataforma (auditado)
--   p_ativo           liga/desliga agora
--   p_mensagem        texto da tela de manutenção (null = mantém)
--   p_aviso_inicio    horário anunciado na faixa (null = sem aviso)
--   p_aviso_mensagem  texto extra da faixa (null = texto padrão)
-- ---------------------------------------------------------------------------
create or replace function public.admin_manutencao_definir(
  p_ativo boolean, p_mensagem text default null, p_aviso_inicio timestamptz default null, p_aviso_mensagem text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public._exigir_admin_plataforma();
  v_antes public.plataforma_manutencao;
  v_depois public.plataforma_manutencao;
begin
  if p_ativo is null then
    raise exception 'Informe se a manutenção fica ligada ou desligada.';
  end if;
  select * into v_antes from public.plataforma_manutencao where id = 1 for update;
  update public.plataforma_manutencao
     set ativo = p_ativo,
         mensagem = coalesce(nullif(btrim(p_mensagem), ''), mensagem),
         aviso_inicio = case when p_ativo then null else p_aviso_inicio end,
         aviso_mensagem = case when p_ativo then null else nullif(btrim(p_aviso_mensagem), '') end,
         atualizado_em = now(),
         atualizado_por = v_admin
   where id = 1
  returning * into v_depois;
  perform public._admin_auditar(
    case when p_ativo and not v_antes.ativo then 'manutencao_ligar'
         when not p_ativo and v_antes.ativo then 'manutencao_desligar'
         else 'manutencao_ajustar' end,
    'plataforma_manutencao', null,
    jsonb_build_object('ativo', v_depois.ativo, 'mensagem', v_depois.mensagem,
                       'aviso_inicio', v_depois.aviso_inicio, 'aviso_mensagem', v_depois.aviso_mensagem,
                       'antes_ativo', v_antes.ativo));
  return public.manutencao_estado();
end;
$$;
revoke all on function public.admin_manutencao_definir(boolean, text, timestamptz, text) from public, anon;
grant execute on function public.admin_manutencao_definir(boolean, text, timestamptz, text) to authenticated;
