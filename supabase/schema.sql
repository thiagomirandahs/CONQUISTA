-- =====================================================================
--  Filhos da Conquista — Banco de dados (Passo 1: unidades + usuários)
--  Cole TUDO isto no Supabase → SQL Editor → New query → Run
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
begin
  insert into public.profiles (id, nome, nascimento, unidade_id)
  values (
    new.id,
    new.raw_user_meta_data->>'nome',
    (nullif(new.raw_user_meta_data->>'nascimento',''))::date,
    (nullif(new.raw_user_meta_data->>'unidade_id',''))::uuid
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
create policy "ler unidades" on public.unidades for select to authenticated using (true);

drop policy if exists "ler perfis" on public.profiles;
create policy "ler perfis" on public.profiles for select to authenticated using (true);

-- Cada pessoa pode editar o próprio perfil
drop policy if exists "editar proprio perfil" on public.profiles;
create policy "editar proprio perfil" on public.profiles for update to authenticated using (auth.uid() = id);

-- (As permissões por cargo — aprovar cadastros, criar unidades, etc. — entram no próximo passo.)

-- ---------- Unidades de exemplo (edite/adicione as suas depois) ----------
insert into public.unidades (nome, cor) values
  ('Águia', '#1d4ed8'),
  ('Falcão', '#0ea5e9'),
  ('Leão', '#f59e0b')
on conflict do nothing;
