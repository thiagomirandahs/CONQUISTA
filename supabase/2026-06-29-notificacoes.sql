-- =====================================================================
--  Filhos da Conquista — Notificações (sininho no app)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. (Já está dentro de supabase/schema.sql também.)
--
--  Cria a tabela de avisos + triggers que GERAM o aviso automaticamente
--  quando: a liderança lança pontos pra uma unidade, cria uma atividade,
--  ou chega um cadastro novo (este só a liderança vê).
-- =====================================================================

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

-- Todos leem as 'todos'; só quem aprova (instrutor/diretoria) lê as 'lideranca'
drop policy if exists "ler notificacoes" on public.notificacoes;
create policy "ler notificacoes" on public.notificacoes for select to authenticated using (
  para = 'todos' or (para = 'lideranca' and public.pode_aprovar())
);
-- Inserção manual (avisos gerais): só liderança. As automáticas entram por trigger.
drop policy if exists "criar notificacao" on public.notificacoes;
create policy "criar notificacao" on public.notificacoes for insert to authenticated with check (public.pode_gerir());

-- ---- Geração automática ----------------------------------------------------
-- Pontos avulsos lançados pra uma unidade
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

-- Nova atividade criada
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

-- Novo cadastro aguardando aprovação (só liderança vê)
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

notify pgrst, 'reload schema';
