-- =====================================================================
--  Filhos da Conquista — MIGRAÇÃO COMPLETA do banco de dados
--  (tabelas, funções, segurança RLS, storage e permissões)
--
--  COMO MUDAR DE SERVIDOR (novo projeto Supabase):
--    1) Crie um novo projeto no Supabase.
--    2) SQL Editor -> New query -> cole TODO este arquivo -> Run.
--    3) Authentication -> Providers -> Email -> DESLIGUE "Confirm email".
--    4) No Vercel, troque VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
--       pelas chaves do novo projeto e faça um novo deploy.
--    5) Crie o 1o diretor: cadastre-se no app e rode:
--       update public.profiles set status='ativo', papel='diretoria'
--       where id = (select id from auth.users where email='SEU-EMAIL');
--
--  Idempotente: pode rodar quantas vezes quiser, sem duplicar nada.
-- =====================================================================

-- ---------- UNIDADES ----------
create table if not exists public.unidades (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cor text default '#1d4ed8',
  emblema text,
  conselheiro_id uuid,
  created_at timestamptz default now()
);

-- ---------- PERFIS DE USUÁRIO ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  foto text,
  nascimento date,
  papel text not null default 'desbravador',  -- desbravador|conselheiro|instrutor|tesoureiro|diretoria|pais
  cargo text,                                   -- só para diretoria
  unidade_id uuid references public.unidades(id),
  status text not null default 'pendente',      -- pendente|ativo
  created_at timestamptz default now()
);

-- ---------- Cria o perfil automaticamente quando alguém se cadastra ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_cargo text := new.raw_user_meta_data->>'cargo';
  v_papel text;
begin
  v_papel := case
    when v_cargo in ('Conselheiro','Conselheira') then 'conselheiro'
    when v_cargo in ('Instrutor','Instrutora','Capelão') then 'instrutor'
    when v_cargo = 'Tesoureiro' then 'tesoureiro'
    when v_cargo in ('Diretor','Diretora','Diretor Associado','Diretora Associada','Secretário','Secretária') then 'diretoria'
    else 'desbravador'
  end;
  insert into public.profiles (id, nome, nascimento, unidade_id, cargo, papel)
  values (
    new.id,
    new.raw_user_meta_data->>'nome',
    (nullif(new.raw_user_meta_data->>'nascimento',''))::date,
    (nullif(new.raw_user_meta_data->>'unidade_id',''))::uuid,
    v_cargo,
    v_papel
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- SEGURANÇA (RLS) ----------
alter table public.unidades enable row level security;
alter table public.profiles enable row level security;

-- Qualquer usuário logado pode LER unidades e perfis
drop policy if exists "ler unidades" on public.unidades;
drop policy if exists "ler unidades publico" on public.unidades;
create policy "ler unidades publico" on public.unidades for select using (true);

drop policy if exists "ler perfis" on public.profiles;
create policy "ler perfis" on public.profiles for select to authenticated using (true);

-- Cada pessoa pode editar o próprio perfil
drop policy if exists "editar proprio perfil" on public.profiles;
create policy "editar proprio perfil" on public.profiles for update to authenticated using (auth.uid() = id);

-- (As permissões por cargo — aprovar cadastros, criar unidades, etc. — entram no próximo passo.)

-- ---------- Limpa unidades de exemplo (se existirem) ----------
update public.profiles set unidade_id = null
where unidade_id in (select id from public.unidades where nome in ('Águia','Falcão','Leão'));
delete from public.unidades where nome in ('Águia','Falcão','Leão');

-- ---------- APROVAÇÕES: diretoria e instrutor podem aprovar cadastros ----------
create or replace function public.pode_aprovar()
returns boolean
language sql
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'ativo' and papel in ('diretoria','instrutor')
  );
$$;

drop policy if exists "admin atualiza perfis" on public.profiles;
create policy "admin atualiza perfis" on public.profiles
  for update to authenticated using (public.pode_aprovar());

-- SEGURANÇA: usuário comum não pode mudar o próprio papel/cargo/status/unidade
create or replace function public.protege_campos_perfil()
returns trigger language plpgsql set search_path = public as $func$
begin
  if current_user not in ('authenticated','anon') then return new; end if;
  if not public.pode_aprovar() then
    new.papel := old.papel; new.cargo := old.cargo;
    new.status := old.status; new.unidade_id := old.unidade_id;
  end if;
  return new;
end;
$func$;
drop trigger if exists trg_protege_perfil on public.profiles;
create trigger trg_protege_perfil before update on public.profiles
  for each row execute function public.protege_campos_perfil();

-- =====================================================================
--  PASSO 2: Atividades, Entregas, Pontos e Fotos (deixar tudo real)
-- =====================================================================

-- Quem pode gerir atividades / lançar pontos (instrutor ou diretoria)
create or replace function public.pode_gerir()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and status = 'ativo' and papel in ('instrutor','diretoria'));
$$;

create table if not exists public.atividades (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  categoria text,
  pontos int not null default 0,
  prazo date,
  alvo text default 'Todas as unidades',
  criterios jsonb default '{"foto":false,"texto":true,"arquivo":false}',
  criado_por uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table if not exists public.entregas (
  id uuid primary key default gen_random_uuid(),
  atividade_id uuid references public.atividades(id) on delete cascade,
  usuario_id uuid references public.profiles(id) on delete cascade,
  texto text,
  foto_url text,
  status text not null default 'pendente',  -- pendente|aprovada|reprovada
  pontos_dados int default 0,
  avaliado_por uuid references public.profiles(id),
  created_at timestamptz default now(),
  unique (atividade_id, usuario_id)
);

create table if not exists public.pontos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.profiles(id) on delete cascade,
  origem text,
  pontos int not null default 0,
  motivo text,
  data timestamptz default now(),
  lancado_por uuid references public.profiles(id)
);
-- Pontos avulsos podem ir direto para uma UNIDADE (time), não só para uma pessoa.
-- Um lançamento tem OU usuario_id (individual) OU unidade_id (time).
alter table public.pontos add column if not exists unidade_id uuid references public.unidades(id) on delete cascade;
-- Apontamentos: guarda o que foi marcado (presença/bíblia/uniforme/...) pra a tela pré-carregar.
alter table public.pontos add column if not exists marca jsonb;

create table if not exists public.fotos (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  legenda text,
  evento text,
  autor_id uuid references public.profiles(id),
  aprovada boolean default true,
  created_at timestamptz default now()
);

alter table public.atividades enable row level security;
alter table public.entregas enable row level security;
alter table public.pontos enable row level security;
alter table public.fotos enable row level security;

-- Unidades: liderança pode criar/editar
drop policy if exists "gerir unidades" on public.unidades;
create policy "gerir unidades" on public.unidades for all to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());

-- Atividades: todos leem; liderança gere
drop policy if exists "ler atividades" on public.atividades;
create policy "ler atividades" on public.atividades for select to authenticated using (true);
drop policy if exists "gerir atividades" on public.atividades;
create policy "gerir atividades" on public.atividades for all to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());

-- Entregas: dono vê/cria a sua; liderança vê/corrige todas
drop policy if exists "ler entregas" on public.entregas;
create policy "ler entregas" on public.entregas for select to authenticated
  using (usuario_id = auth.uid() or public.pode_gerir());
drop policy if exists "criar entrega" on public.entregas;
create policy "criar entrega" on public.entregas for insert to authenticated
  with check (usuario_id = auth.uid() and status = 'pendente');
drop policy if exists "corrigir entrega" on public.entregas;
create policy "corrigir entrega" on public.entregas for update to authenticated
  using (public.pode_gerir());
-- Liderança pode APAGAR entregas (limpar envios errados/duplicados)
drop policy if exists "apagar entrega" on public.entregas;
create policy "apagar entrega" on public.entregas for delete to authenticated
  using (public.pode_gerir());

-- Pontos: todos leem (ranking); liderança lança
drop policy if exists "ler pontos" on public.pontos;
create policy "ler pontos" on public.pontos for select to authenticated using (true);
-- Conselheiro pode lançar/apagar pontos dos desbravadores da SUA unidade (+ liderança)
create or replace function public.pode_apontar(alvo uuid)
returns boolean language sql security definer set search_path = public as $$
  select public.pode_gerir() or exists (
    select 1 from public.profiles eu
    join public.profiles d on d.unidade_id = eu.unidade_id
    where eu.id = auth.uid() and eu.papel = 'conselheiro' and eu.status = 'ativo'
      and d.id = alvo and d.papel = 'desbravador'  -- só desbravadores: conselheiro não pontua a si mesmo nem a outros líderes
  );
$$;
drop policy if exists "lancar pontos" on public.pontos;
create policy "lancar pontos" on public.pontos for insert to authenticated with check (
  case when unidade_id is not null then public.pode_gerir()   -- pontos de time: só liderança (instrutor/diretoria)
       else public.pode_apontar(usuario_id) end               -- pontos individuais: regra de sempre
);
drop policy if exists "apagar pontos" on public.pontos;
create policy "apagar pontos" on public.pontos for delete to authenticated using (
  case when unidade_id is not null then public.pode_gerir()
       else public.pode_apontar(usuario_id) end
);

-- Fotos: todos leem; autenticado posta a sua
drop policy if exists "ler fotos" on public.fotos;
create policy "ler fotos" on public.fotos for select to authenticated using (true);
drop policy if exists "postar foto" on public.fotos;
create policy "postar foto" on public.fotos for insert to authenticated
  with check (autor_id = auth.uid());
-- Autor (ou liderança) pode apagar a própria foto do mural
drop policy if exists "apagar foto" on public.fotos;
create policy "apagar foto" on public.fotos for delete to authenticated
  using (autor_id = auth.uid() or public.pode_gerir());

-- ---------- MENSALIDADES (tesoureiro controla; diretoria acompanha) ----------
create table if not exists public.mensalidades (
  id uuid primary key default gen_random_uuid(),
  desbravador_id uuid references public.profiles(id) on delete cascade,
  mes int not null, ano int not null,
  valor numeric default 0,
  status text not null default 'pendente',  -- pago | pendente
  data_pagamento date,
  registrado_por uuid references public.profiles(id),
  created_at timestamptz default now(),
  unique (desbravador_id, mes, ano)
);
create or replace function public.eh_financeiro()
returns boolean language sql security definer set search_path = public as $f$
  select exists(select 1 from public.profiles where id = auth.uid() and status='ativo' and papel in ('tesoureiro','diretoria'));
$f$;
alter table public.mensalidades enable row level security;
drop policy if exists "ler mensalidades" on public.mensalidades;
create policy "ler mensalidades" on public.mensalidades for select to authenticated using (desbravador_id = auth.uid() or public.eh_financeiro());
drop policy if exists "gerir mensalidades" on public.mensalidades;
create policy "gerir mensalidades" on public.mensalidades for all to authenticated using (public.eh_financeiro()) with check (public.eh_financeiro());

-- ---------- NOTIFICAÇÕES (sininho no app) ----------
create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  corpo text,
  tipo text,                              -- pontos | atividade | cadastro | geral
  link text,                              -- rota no app ao tocar (ex.: /ranking)
  para text not null default 'todos',     -- todos | lideranca
  criado_por uuid references public.profiles(id),
  created_at timestamptz default now()
);
create index if not exists idx_notificacoes_created on public.notificacoes(created_at desc);

-- Marca quando a pessoa viu as notificações (pra contar as não-lidas)
alter table public.profiles add column if not exists notif_visto_em timestamptz default now();

alter table public.notificacoes enable row level security;
drop policy if exists "ler notificacoes" on public.notificacoes;
create policy "ler notificacoes" on public.notificacoes for select to authenticated using (
  para = 'todos' or (para = 'lideranca' and public.pode_aprovar())
);
drop policy if exists "criar notificacao" on public.notificacoes;
create policy "criar notificacao" on public.notificacoes for insert to authenticated with check (public.pode_gerir());

-- Geração automática de avisos
create or replace function public.notif_pontos_unidade()
returns trigger language plpgsql security definer set search_path = public as $$
declare uni text;
begin
  if new.unidade_id is not null then
    select nome into uni from public.unidades where id = new.unidade_id;
    insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por)
    values ('🏆 Pontos pra ' || coalesce(uni, 'unidade'),
            coalesce(uni, 'A unidade') || ' recebeu ' || new.pontos || ' pontos' || coalesce(' — ' || new.motivo, ''),
            'pontos', '/ranking', 'todos', new.lancado_por);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notif_pontos_unidade on public.pontos;
create trigger trg_notif_pontos_unidade after insert on public.pontos
  for each row execute function public.notif_pontos_unidade();

create or replace function public.notif_nova_atividade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por)
  values ('📋 Nova atividade', new.titulo, 'atividade', '/atividades', 'todos', new.criado_por);
  return new;
end;
$$;
drop trigger if exists trg_notif_nova_atividade on public.atividades;
create trigger trg_notif_nova_atividade after insert on public.atividades
  for each row execute function public.notif_nova_atividade();

create or replace function public.notif_novo_cadastro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pendente' then
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('👤 Novo cadastro', coalesce(new.nome, 'Alguém') || ' está aguardando aprovação', 'cadastro', '/aprovacoes', 'lideranca');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notif_novo_cadastro on public.profiles;
create trigger trg_notif_novo_cadastro after insert on public.profiles
  for each row execute function public.notif_novo_cadastro();

-- ---------- PUSH (notificação no celular) ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "minhas inscricoes" on public.push_subscriptions;
create policy "minhas inscricoes" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- ANIVERSÁRIO: aviso automático diário ----------
create or replace function public.notif_aniversariantes_hoje()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select nome from public.profiles
    where status = 'ativo' and nascimento is not null
      and to_char(nascimento, 'MM-DD') = to_char((now() at time zone 'America/Sao_Paulo'), 'MM-DD')
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🎂 Aniversário hoje!',
            'Hoje é aniversário de ' || coalesce(r.nome, 'um membro') || '. Mande os parabéns! 🥳',
            'aniversario', '/ranking', 'todos');
  end loop;
end;
$$;
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('aniversariantes-do-dia');
exception when others then null;
end $$;
select cron.schedule('aniversariantes-do-dia', '0 12 * * *', $$ select public.notif_aniversariantes_hoje(); $$);

-- ---------- USUÁRIOS: listar com e-mail + resetar senha (só liderança) ----------
create extension if not exists pgcrypto with schema extensions;

create or replace function public.listar_usuarios()
returns table (id uuid, nome text, foto text, papel text, status text, unidade_id uuid, email text)
language sql security definer set search_path = '' as $$
  select p.id, p.nome, p.foto, p.papel, p.status, p.unidade_id, u.email::text
  from public.profiles p
  left join auth.users u on u.id = p.id
  where exists (
    select 1 from public.profiles eu
    where eu.id = auth.uid() and eu.status = 'ativo' and eu.papel in ('instrutor','diretoria')
  )
  order by p.nome;
$$;
grant execute on function public.listar_usuarios() to authenticated;

create or replace function public.resetar_senha_membro(alvo uuid, nova_senha text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles eu
                 where eu.id = auth.uid() and eu.status = 'ativo' and eu.papel in ('instrutor','diretoria')) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  if nova_senha is null or length(nova_senha) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(nova_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = alvo;
  if not found then raise exception 'Usuário não encontrado.'; end if;
end;
$$;
grant execute on function public.resetar_senha_membro(uuid, text) to authenticated;

-- ---------- DEVOCIONAL DIÁRIO (versículo + quiz + foto + pontos/dia) ----------
create table if not exists public.versiculos (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  referencia text not null,
  pergunta text not null default 'De qual livro da Bíblia é este versículo?',
  opcoes jsonb not null default '[]',
  correta int not null default 0,
  ativo boolean default true,
  created_at timestamptz default now()
);
alter table public.versiculos enable row level security;
drop policy if exists "ler versiculos" on public.versiculos;
create policy "ler versiculos" on public.versiculos for select to authenticated using (public.pode_gerir());
drop policy if exists "gerir versiculos" on public.versiculos;
create policy "gerir versiculos" on public.versiculos for all to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());

create table if not exists public.devocional (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.profiles(id) on delete cascade,
  data date not null,
  foto_url text,
  acertou_quiz boolean default false,
  created_at timestamptz default now(),
  unique (usuario_id, data)
);
alter table public.devocional enable row level security;
drop policy if exists "ler devocional" on public.devocional;
create policy "ler devocional" on public.devocional for select to authenticated
  using (usuario_id = auth.uid() or public.pode_gerir());

create or replace function public.versiculo_do_dia()
returns table (id uuid, texto text, referencia text, pergunta text, opcoes jsonb)
language sql security definer set search_path = '' as $$
  with v as (
    select id, texto, referencia, pergunta, opcoes,
           row_number() over (order by created_at, id) - 1 as idx
    from public.versiculos where ativo = true
  ), n as (select count(*) c from v)
  select v.id, v.texto, v.referencia, v.pergunta, v.opcoes
  from v, n
  where n.c > 0 and v.idx = (((now() at time zone 'America/Sao_Paulo')::date - date '2026-01-01') % n.c);
$$;
grant execute on function public.versiculo_do_dia() to authenticated;

create or replace function public.registrar_devocional(p_foto_url text, p_resposta int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_correta int;
  v_acertou boolean := false;
  v_pontos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  with v as (
    select correta, row_number() over (order by created_at, id) - 1 as idx
    from public.versiculos where ativo = true
  ), n as (select count(*) c from v)
  select v.correta into v_correta
  from v, n
  where n.c > 0 and v.idx = ((v_hoje - date '2026-01-01') % n.c);
  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  v_pontos := 10 + (case when v_acertou then 5 else 0 end);
  insert into public.devocional (usuario_id, data, foto_url, acertou_quiz)
  values (v_uid, v_hoje, p_foto_url, v_acertou);
  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'devocional', v_pontos,
          'Devocional ' || to_char(v_hoje, 'DD/MM') || case when v_acertou then ' (quiz ✓)' else '' end);
  return json_build_object('acertou', v_acertou, 'pontos', v_pontos);
exception
  when unique_violation then raise exception 'Você já fez o devocional de hoje! Volte amanhã. 🙂';
end;
$$;
grant execute on function public.registrar_devocional(text, int) to authenticated;

create or replace function public.meu_resumo_devocional()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_feito boolean := false;
  v_foto text;
  v_seq int := 0;
  v_d date;
begin
  if v_uid is null then return json_build_object('feito', false, 'sequencia', 0); end if;
  select foto_url into v_foto from public.devocional where usuario_id = v_uid and data = v_hoje;
  v_feito := found;
  v_d := case when v_feito then v_hoje else v_hoje - 1 end;
  loop
    exit when not exists (select 1 from public.devocional where usuario_id = v_uid and data = v_d);
    v_seq := v_seq + 1;
    v_d := v_d - 1;
  end loop;
  return json_build_object('feito', v_feito, 'foto', v_foto, 'sequencia', v_seq);
end;
$$;
grant execute on function public.meu_resumo_devocional() to authenticated;

-- ---------- MISSÕES (devocional + desafios do clube, por classe/idade) ----------
create or replace function public.classe_por_nascimento(nasc date)
returns text language sql stable set search_path = '' as $$
  select case
    when nasc is null then null
    when extract(year from age(nasc))::int <= 10 then 'Amigo'
    when extract(year from age(nasc))::int = 11 then 'Companheiro'
    when extract(year from age(nasc))::int = 12 then 'Pesquisador'
    when extract(year from age(nasc))::int = 13 then 'Pioneiro'
    when extract(year from age(nasc))::int = 14 then 'Excursionista'
    else 'Guia'
  end;
$$;

create table if not exists public.desafios (
  id uuid primary key default gen_random_uuid(),
  tema text, texto text, pergunta text not null,
  opcoes jsonb not null default '[]', correta int not null default 0,
  classe text, pede_foto boolean not null default false,
  ativo boolean default true, created_at timestamptz default now()
);
alter table public.desafios enable row level security;
drop policy if exists "ler desafios" on public.desafios;
create policy "ler desafios" on public.desafios for select to authenticated using (public.pode_gerir());
drop policy if exists "gerir desafios" on public.desafios;
create policy "gerir desafios" on public.desafios for all to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());

create or replace function public.missao_do_dia()
returns table (tipo text, texto text, referencia text, tema text, pergunta text, opcoes jsonb, pede_foto boolean, classe text)
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text;
begin
  select public.classe_por_nascimento(nascimento) into v_classe from public.profiles where id = auth.uid();
  if v_idx % 2 = 1 then
    return query
    with d as (
      select ds.texto, ds.tema, ds.pergunta, ds.opcoes, ds.pede_foto,
             row_number() over (order by ds.created_at, ds.id) - 1 as i
      from public.desafios ds where ds.ativo and (ds.classe = v_classe or ds.classe is null)
    ), n as (select count(*) c from d)
    select 'desafio'::text, d.texto, null::text, d.tema, d.pergunta, d.opcoes, d.pede_foto, v_classe
    from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));
    if found then return; end if;
  end if;
  return query
  with v as (
    select vs.texto, vs.referencia, vs.pergunta, vs.opcoes,
           row_number() over (order by vs.created_at, vs.id) - 1 as i
    from public.versiculos vs where vs.ativo
  ), n as (select count(*) c from v)
  select 'devocional'::text, v.texto, v.referencia, 'Devocional'::text, v.pergunta, v.opcoes, true, v_classe
  from v cross join n where n.c > 0 and v.i = (v_idx % nullif(n.c, 0));
end;
$$;
grant execute on function public.missao_do_dia() to authenticated;

create or replace function public.registrar_missao(p_foto_url text, p_resposta int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text; v_tipo text := 'devocional'; v_correta int; v_acertou boolean := false; v_pontos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select public.classe_por_nascimento(nascimento) into v_classe from public.profiles where id = v_uid;
  if v_idx % 2 = 1 then
    with d as (
      select ds.correta, row_number() over (order by ds.created_at, ds.id) - 1 as i
      from public.desafios ds where ds.ativo and (ds.classe = v_classe or ds.classe is null)
    ), n as (select count(*) c from d)
    select d.correta into v_correta from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));
    if found then v_tipo := 'desafio'; end if;
  end if;
  if v_tipo = 'devocional' then
    with v as (
      select vs.correta, row_number() over (order by vs.created_at, vs.id) - 1 as i
      from public.versiculos vs where vs.ativo
    ), n as (select count(*) c from v)
    select v.correta into v_correta from v cross join n where n.c > 0 and v.i = (v_idx % nullif(n.c, 0));
  end if;
  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  v_pontos := 10 + (case when v_acertou then 5 else 0 end);
  insert into public.devocional (usuario_id, data, foto_url, acertou_quiz) values (v_uid, v_hoje, p_foto_url, v_acertou);
  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'missao', v_pontos, 'Missão ' || to_char(v_hoje, 'DD/MM') || case when v_acertou then ' (quiz ✓)' else '' end);
  return json_build_object('acertou', v_acertou, 'pontos', v_pontos, 'tipo', v_tipo);
exception when unique_violation then raise exception 'Você já fez a missão de hoje! Volte amanhã. 🙂';
end;
$$;
grant execute on function public.registrar_missao(text, int) to authenticated;
-- (Os desafios iniciais são semeados por supabase/2026-06-30-missoes.sql.)

-- ---------- STORAGE: bucket de imagens (emblemas das unidades, fotos) ----------
insert into storage.buckets (id, name, public) values ('imagens','imagens',true) on conflict (id) do nothing;
drop policy if exists "ler imagens publico" on storage.objects;
create policy "ler imagens publico" on storage.objects for select using (bucket_id = 'imagens');
drop policy if exists "subir imagens" on storage.objects;
create policy "subir imagens" on storage.objects for insert to authenticated with check (bucket_id = 'imagens');
drop policy if exists "atualizar imagens" on storage.objects;
create policy "atualizar imagens" on storage.objects for update to authenticated using (bucket_id = 'imagens');

-- ---------- PERMISSÕES de acesso da API ----------
grant usage on schema public to anon, authenticated, service_role;

-- authenticated e service_role: privilégios completos (o RLS filtra linha a linha)
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant all on all routines in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;

-- anon (visitante deslogado): remove qualquer privilégio amplo e mantém apenas a
-- LEITURA das unidades, necessária na tela de cadastro (ainda sem login).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
grant select on public.unidades to anon;

-- Atualiza a lista de tabelas da API
notify pgrst, 'reload schema';
