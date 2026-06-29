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
create policy "lancar pontos" on public.pontos for insert to authenticated with check (public.pode_apontar(usuario_id));
drop policy if exists "apagar pontos" on public.pontos;
create policy "apagar pontos" on public.pontos for delete to authenticated using (public.pode_apontar(usuario_id));

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
