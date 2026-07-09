-- =====================================================================
--  Filhos da Conquista — Cartão de Classe (parte 1: base + progresso)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Não semeia requisitos: a liderança cadastra pela tela
--  Gestão -> Conteúdo -> Cartão de Classe (o texto oficial é de vocês).
--
--  Modelo:
--   - classe_requisitos: os requisitos de cada classe (Amigo..Guia). Todos
--     leem (é o cartão), só a liderança edita.
--   - requisito_cumprido: o que cada desbravador marcou e o que já foi
--     aprovado pelo conselheiro. Marcar/desmarcar (dono) e avaliar
--     (liderança) via funções seguras.
-- =====================================================================

-- 1) Requisitos de cada classe ---------------------------------------------
create table if not exists public.classe_requisitos (
  id uuid primary key default gen_random_uuid(),
  classe text not null,            -- Amigo|Companheiro|Pesquisador|Pioneiro|Excursionista|Guia
  secao text,                      -- agrupamento opcional (ex.: 'Geral', 'Natureza')
  ordem int not null default 0,
  texto text not null,
  ativo boolean not null default true,
  created_at timestamptz default now()
);
create index if not exists idx_classe_req on public.classe_requisitos(classe, ordem);
alter table public.classe_requisitos enable row level security;
drop policy if exists "ler classe_requisitos" on public.classe_requisitos;
create policy "ler classe_requisitos" on public.classe_requisitos for select to authenticated using (true);
drop policy if exists "gerir classe_requisitos" on public.classe_requisitos;
create policy "gerir classe_requisitos" on public.classe_requisitos for all to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());

-- 2) Progresso do desbravador ----------------------------------------------
create table if not exists public.requisito_cumprido (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.profiles(id) on delete cascade,
  requisito_id uuid references public.classe_requisitos(id) on delete cascade,
  status text not null default 'pendente',   -- pendente | aprovado
  avaliado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  unique (usuario_id, requisito_id)
);
create index if not exists idx_req_cumprido_user on public.requisito_cumprido(usuario_id);
create index if not exists idx_req_cumprido_status on public.requisito_cumprido(status);
alter table public.requisito_cumprido enable row level security;
drop policy if exists "ler requisito_cumprido" on public.requisito_cumprido;
create policy "ler requisito_cumprido" on public.requisito_cumprido for select to authenticated
  using (usuario_id = auth.uid() or public.pode_gerir());

-- 3) Ações seguras ----------------------------------------------------------
-- Desbravador marca um requisito como "cumpri" (fica pendente de aprovação)
create or replace function public.marcar_requisito(p_requisito_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  insert into public.requisito_cumprido (usuario_id, requisito_id, status)
  values (v_uid, p_requisito_id, 'pendente')
  on conflict (usuario_id, requisito_id) do nothing;  -- já marcado: não rebaixa aprovado
end; $$;
grant execute on function public.marcar_requisito(uuid) to authenticated;

-- Desbravador desmarca (só o que ainda está pendente — não desfaz aprovação)
create or replace function public.desmarcar_requisito(p_requisito_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  delete from public.requisito_cumprido
   where usuario_id = v_uid and requisito_id = p_requisito_id and status = 'pendente';
end; $$;
grant execute on function public.desmarcar_requisito(uuid) to authenticated;

-- Liderança aprova (vira 'aprovado') ou reprova (remove a marcação)
create or replace function public.avaliar_requisito(p_usuario_id uuid, p_requisito_id uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not public.pode_gerir() then raise exception 'Sem permissão.'; end if;
  if p_aprovar then
    insert into public.requisito_cumprido (usuario_id, requisito_id, status, avaliado_por)
    values (p_usuario_id, p_requisito_id, 'aprovado', v_uid)
    on conflict (usuario_id, requisito_id) do update set status = 'aprovado', avaliado_por = v_uid;
  else
    delete from public.requisito_cumprido where usuario_id = p_usuario_id and requisito_id = p_requisito_id;
  end if;
end; $$;
grant execute on function public.avaliar_requisito(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
