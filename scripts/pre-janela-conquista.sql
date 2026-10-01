-- =============================================================================
--  PRÉ-JANELA — passos que faltam para o Conquista real chegar ao estado que as
--  migrations do SaaS (20260921000001 em diante) esperam. Achado pela Etapa 1 da
--  migração (inventário read-only do projeto real) e comprovado pela Etapa 3
--  (ensaio sobre uma cópia real, em ambiente descartável).
--
--  Nenhum destes passos é do repositório de migrations "SaaS" — são os SQLs
--  manuais do fluxo antigo (supabase/2026-*.sql) que este projeto específico
--  nunca chegou a rodar, mais a criação do ledger do CLI que o runbook já pedia.
--  Rode este arquivo INTEIRO, uma vez, no SQL Editor de produção, ANTES da
--  migration 20260921000001 — na mesma janela, antes do passo 7 de
--  supabase/infra/DEPLOY-E-RECUPERACAO.md.
--
--  Idempotente (create/alter ... if not exists) — seguro rodar mais de uma vez.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Ledger do CLI (supabase_migrations) — a migration 01 grava aqui, na mesma
--    transação de cada migration do SaaS.
-- ---------------------------------------------------------------------------
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key, statements text[], name text
);

-- ---------------------------------------------------------------------------
-- 2) supabase/2026-08-28-ledger-migrations.sql (ledger ANTIGO, por arquivo —
--    a migration 01 do SaaS grava nele também; sem esta tabela ela aborta)
-- ---------------------------------------------------------------------------
create table if not exists public.migracoes_aplicadas (
  arquivo text primary key,
  aplicada_em timestamptz not null default now()
);
alter table public.migracoes_aplicadas enable row level security;
grant select on public.migracoes_aplicadas to authenticated;
drop policy if exists "ledger leitura lideranca" on public.migracoes_aplicadas;
create policy "ledger leitura lideranca" on public.migracoes_aplicadas
  for select to authenticated using (public.pode_gerir());
insert into public.migracoes_aplicadas (arquivo)
values ('2026-08-28-ledger-migrations.sql')
on conflict (arquivo) do update set aplicada_em = now();

-- ---------------------------------------------------------------------------
-- 3) supabase/2026-08-01-pedir-ajuda.sql (tabela ajudas + 5 RPCs) — a migration
--    24 recria essas RPCs; sem a tabela, "CREATE OR REPLACE" delas aborta.
-- ---------------------------------------------------------------------------
create table if not exists public.ajudas (
  id uuid primary key default gen_random_uuid(),
  de_id uuid not null references public.profiles(id) on delete cascade,
  para_id uuid not null references public.profiles(id) on delete cascade,
  jogo text not null,
  enunciado jsonb not null,
  resposta text not null,
  status text not null default 'aberto',
  resolvido_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create index if not exists ajudas_para_aberto_idx on public.ajudas (para_id) where status = 'aberto';
create index if not exists ajudas_de_idx on public.ajudas (de_id);
alter table public.ajudas enable row level security;
revoke all on table public.ajudas from anon, authenticated;

create or replace function public.norm_txt(t text)
returns text language sql immutable set search_path = '' as $$
  select upper(trim(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')));
$$;
revoke execute on function public.norm_txt(text) from public, anon;

create or replace function public.pedir_ajuda(p_para uuid, p_jogo text, p_enunciado jsonb, p_resposta text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_id uuid; v_nome text; v_nomejogo text; v_ja_aberto boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then raise exception 'Sem permissão.'; end if;
  if p_jogo not in ('anagrama', 'forca', 'termo') then raise exception 'Jogo inválido.'; end if;
  if p_para = v_uid then raise exception 'Escolha um amigo (não você mesmo).'; end if;
  if not exists (select 1 from public.profiles where id = p_para and status = 'ativo' and papel <> 'pais') then
    raise exception 'Amigo inválido.';
  end if;
  if coalesce(trim(p_resposta), '') = '' then raise exception 'Desafio sem resposta.'; end if;
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':pedir_ajuda'));
  if (select count(*) from public.ajudas where de_id = v_uid and criado_em > now() - interval '5 minutes') >= 5 then
    raise exception 'Você pediu ajuda demais agora. Espere um pouquinho 🙂';
  end if;
  v_ja_aberto := exists (select 1 from public.ajudas where de_id = v_uid and para_id = p_para and status = 'aberto');
  update public.ajudas set status = 'cancelado' where de_id = v_uid and status = 'aberto';
  insert into public.ajudas (de_id, para_id, jogo, enunciado, resposta)
  values (v_uid, p_para, p_jogo, p_enunciado, p_resposta) returning id into v_id;
  if not v_ja_aberto then
    select nome into v_nome from public.profiles where id = v_uid;
    select nome into v_nomejogo from public.jogos_trilha where chave = p_jogo;
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por)
    values ('🆘 Pedido de ajuda!',
      coalesce(v_nome, 'Um amigo') || ' precisou da sua ajuda no ' || coalesce(v_nomejogo, p_jogo) || '! Abra os 🎮 Jogos e ajude.',
      'geral', '/trilha', 'pessoal', p_para, v_uid);
  end if;
  return v_id;
end;
$$;
grant execute on function public.pedir_ajuda(uuid, text, jsonb, text) to authenticated;
revoke execute on function public.pedir_ajuda(uuid, text, jsonb, text) from public, anon;

create or replace function public.ajudas_recebidas()
returns json language sql stable security definer set search_path = '' as $$
  select case when public.eh_membro_ativo() then coalesce((
    select json_agg(json_build_object(
      'id', a.id, 'jogo', a.jogo, 'enunciado', a.enunciado,
      'de_nome', p.nome, 'de_foto', p.foto, 'criado_em', a.criado_em
    ) order by a.criado_em)
    from public.ajudas a join public.profiles p on p.id = a.de_id
    where a.para_id = auth.uid() and a.status = 'aberto'
  ), '[]'::json) else '[]'::json end;
$$;
grant execute on function public.ajudas_recebidas() to authenticated;
revoke execute on function public.ajudas_recebidas() from public, anon;

create or replace function public.resolver_ajuda(p_id uuid, p_tentativa text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_a public.ajudas%rowtype; v_nome text; v_nomejogo text; v_teste boolean; v_ja int; v_ganhou int := 0;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then raise exception 'Sem permissão.'; end if;
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':resolver_ajuda:' || v_hoje::text));
  select * into v_a from public.ajudas where id = p_id and para_id = v_uid and status = 'aberto';
  if not found then return json_build_object('ok', false, 'erro', 'sumiu'); end if;
  if public.norm_txt(p_tentativa) <> public.norm_txt(v_a.resposta) then return json_build_object('ok', false); end if;
  update public.ajudas set status = 'resolvido', resolvido_por = v_uid, resolvido_em = now() where id = p_id;
  select coalesce(teste, false) into v_teste from public.profiles where id = v_uid;
  if not coalesce(v_teste, false) then
    select count(*) into v_ja from public.pontos
    where usuario_id = v_uid and origem = 'ajuda' and (data at time zone 'America/Sao_Paulo')::date = v_hoje;
    if v_ja < 3 then
      select nome into v_nome from public.profiles where id = v_a.de_id;
      select nome into v_nomejogo from public.jogos_trilha where chave = v_a.jogo;
      insert into public.pontos (usuario_id, origem, pontos, motivo)
      values (v_uid, 'ajuda', 5, '🤝 Ajudou ' || coalesce(v_nome, 'um amigo') || ' no ' || coalesce(v_nomejogo, v_a.jogo));
      v_ganhou := 5;
    end if;
  end if;
  select nome into v_nome from public.profiles where id = v_uid;
  insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por)
  values ('🎉 Você foi ajudado!', coalesce(v_nome, 'Um amigo') || ' resolveu seu desafio! Abra o jogo pra ver a resposta.',
    'geral', '/trilha', 'pessoal', v_a.de_id, v_uid);
  return json_build_object('ok', true, 'ganhou', v_ganhou);
end;
$$;
grant execute on function public.resolver_ajuda(uuid, text) to authenticated;
revoke execute on function public.resolver_ajuda(uuid, text) from public, anon;

create or replace function public.ajuda_status(p_id uuid)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_a public.ajudas%rowtype; v_nome text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into v_a from public.ajudas where id = p_id and de_id = v_uid;
  if not found then return json_build_object('status', 'nao'); end if;
  if v_a.resolvido_por is not null then select nome into v_nome from public.profiles where id = v_a.resolvido_por; end if;
  return json_build_object('status', v_a.status,
    'resposta', case when v_a.status = 'resolvido' then v_a.resposta else null end, 'ajudante', v_nome);
end;
$$;
grant execute on function public.ajuda_status(uuid) to authenticated;
revoke execute on function public.ajuda_status(uuid) from public, anon;

create or replace function public.cancelar_ajuda(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  update public.ajudas set status = 'cancelado' where id = p_id and de_id = v_uid and status = 'aberto';
end;
$$;
grant execute on function public.cancelar_ajuda(uuid) to authenticated;
revoke execute on function public.cancelar_ajuda(uuid) from public, anon;

create or replace function public.recusar_ajuda(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  update public.ajudas set status = 'recusado' where id = p_id and para_id = v_uid and status = 'aberto';
end;
$$;
grant execute on function public.recusar_ajuda(uuid) to authenticated;
revoke execute on function public.recusar_ajuda(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 4) supabase/2026-09-09-push-tokens.sql (tabela push_tokens) — a migration
--    52/55 espera essa tabela.
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  plataforma text not null default 'android',
  created_at timestamptz not null default now()
);
create index if not exists idx_push_tokens_user on public.push_tokens(user_id);
alter table public.push_tokens enable row level security;
drop policy if exists "meus tokens push" on public.push_tokens;
create policy "meus tokens push" on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5) supabase/2026-06-30-missoes-aprovacao.sql (colunas devocional.status/
--    .pontos_dados + o motor de aprovação de missão de foto)
-- ---------------------------------------------------------------------------
alter table public.devocional add column if not exists status text not null default 'aprovada';
alter table public.devocional add column if not exists pontos_dados int default 0;

create or replace function public.registrar_missao(p_foto_url text, p_resposta int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text; v_tipo text := 'devocional';
  v_correta int; v_pede_foto boolean := true; v_precisa_aprovar boolean := false;
  v_acertou boolean := false; v_pontos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select public.classe_por_nascimento(nascimento) into v_classe from public.profiles where id = v_uid;
  if v_idx % 2 = 1 then
    with d as (
      select ds.correta, ds.pede_foto, row_number() over (order by ds.created_at, ds.id) - 1 as i
      from public.desafios ds where ds.ativo and (ds.classe = v_classe or ds.classe is null)
    ), n as (select count(*) c from d)
    select d.correta, d.pede_foto into v_correta, v_pede_foto
    from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));
    if found then v_tipo := 'desafio'; end if;
  end if;
  if v_tipo = 'devocional' then
    with v as (
      select vs.correta, row_number() over (order by vs.created_at, vs.id) - 1 as i
      from public.versiculos vs where vs.ativo
    ), n as (select count(*) c from v)
    select v.correta into v_correta from v cross join n where n.c > 0 and v.i = (v_idx % nullif(n.c, 0));
    v_pede_foto := true;
  end if;
  v_precisa_aprovar := (v_tipo = 'desafio' and v_pede_foto);
  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  v_pontos := case when v_acertou then 10 else 5 end;
  if v_precisa_aprovar then
    insert into public.devocional (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados)
    values (v_uid, v_hoje, p_foto_url, false, 'pendente', 10);
    return json_build_object('status', 'pendente');
  else
    insert into public.devocional (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados)
    values (v_uid, v_hoje, p_foto_url, v_acertou, 'aprovada', v_pontos);
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_uid, 'missao', v_pontos, 'Missão ' || to_char(v_hoje, 'DD/MM') || case when v_acertou then ' (acertou)' else '' end);
    return json_build_object('acertou', v_acertou, 'pontos', v_pontos, 'status', 'aprovada');
  end if;
exception when unique_violation then
  raise exception 'Você já fez a missão de hoje! Volte amanhã. 🙂';
end;
$$;
grant execute on function public.registrar_missao(text, int) to authenticated;

create or replace function public.meu_resumo_devocional()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_feito boolean := false; v_foto text; v_status text; v_seq int := 0; v_d date;
begin
  if v_uid is null then return json_build_object('feito', false, 'sequencia', 0); end if;
  select foto_url, status into v_foto, v_status from public.devocional where usuario_id = v_uid and data = v_hoje;
  v_feito := found;
  v_d := case when v_feito then v_hoje else v_hoje - 1 end;
  loop
    exit when not exists (select 1 from public.devocional where usuario_id = v_uid and data = v_d);
    v_seq := v_seq + 1; v_d := v_d - 1;
  end loop;
  return json_build_object('feito', v_feito, 'foto', v_foto, 'sequencia', v_seq, 'status', v_status);
end;
$$;
grant execute on function public.meu_resumo_devocional() to authenticated;

create or replace function public.missoes_pendentes()
returns table (id uuid, nome text, foto_url text, data date)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and papel in ('instrutor','diretoria')) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  return query select d.id, p.nome, d.foto_url, d.data
    from public.devocional d join public.profiles p on p.id = d.usuario_id
    where d.status = 'pendente' order by d.created_at;
end;
$$;
grant execute on function public.missoes_pendentes() to authenticated;

create or replace function public.avaliar_missao(p_id uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row record;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and papel in ('instrutor','diretoria')) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  select * into v_row from public.devocional where id = p_id and status = 'pendente';
  if not found then raise exception 'Missão não encontrada ou já avaliada.'; end if;
  if p_aprovar then
    update public.devocional set status = 'aprovada' where id = p_id;
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_row.usuario_id, 'missao', coalesce(v_row.pontos_dados, 10), 'Missão ' || to_char(v_row.data, 'DD/MM') || ' (aprovada)');
  else
    update public.devocional set status = 'reprovada' where id = p_id;
  end if;
end;
$$;
grant execute on function public.avaliar_missao(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6) Drift NÃO documentado: duas FKs em `partidas` que não vêm de NENHUM script
--    do repositório (nem o legado supabase/2026-08-29-anticheat-partidas.sql,
--    nem a versão em supabase/migrations/ — nenhum dos dois tem `references` em
--    `usuario_id`/`jogo`; o banco de desenvolvimento, construído do zero pelos
--    mesmos arquivos, não tem essas FKs). Alguém rodou um ALTER TABLE manual na
--    produção real, fora de qualquer arquivo. Achado pela Etapa 3 (ensaio sobre
--    o backup real): sem removê-las, a migration 20260921000024 aborta em
--    "cannot drop constraint jogos_trilha_pkey ... because other objects
--    depend on it" (a FK partidas_jogo_fkey trava o índice que vira a PK
--    composta (club_id, chave)).
--
--    Confirmado seguro: `pg_depend`/`information_schema` não mostram nenhuma
--    outra dependência; dropar uma constraint nunca apaga dado, só a checagem.
-- ---------------------------------------------------------------------------
alter table public.partidas drop constraint if exists partidas_jogo_fkey;
alter table public.partidas drop constraint if exists partidas_usuario_id_fkey;
