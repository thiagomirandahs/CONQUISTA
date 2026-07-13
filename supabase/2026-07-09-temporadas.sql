-- =====================================================================
--  Filhos da Conquista — Temporadas (zerar o ranking guardando histórico)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente.
--
--  Como funciona: o ranking passa a somar SÓ os pontos da temporada atual
--  (a partir da data de início). "Nova temporada" fecha a atual (guardando
--  os campeões) e começa outra do zero — os pontos antigos FICAM no banco
--  (nada se perde; só param de contar no ranking). Só a DIRETORIA pode.
-- =====================================================================

create table if not exists public.temporadas (
  id uuid primary key default gen_random_uuid(),
  numero int not null default 1,
  inicio timestamptz not null default now(),
  fim timestamptz,                    -- null = temporada em andamento
  campeao_individual text,            -- snapshot do campeão ao encerrar
  campeao_unidade text,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.temporadas enable row level security;
drop policy if exists "ler temporadas" on public.temporadas;
create policy "ler temporadas" on public.temporadas for select to authenticated using (true);
-- Escrita só pela função nova_temporada() (security definer). Sem policy de insert/update.

-- No máximo UMA temporada aberta por vez (trava 2 diretores clicando junto).
create unique index if not exists uma_temporada_aberta on public.temporadas ((true)) where fim is null;

-- Semeia a temporada 1 (a "atual de todo o histórico"): inicio -infinity, então
-- o ranking conta TUDO até a 1ª virada. Assim o 1º "nova temporada" tem o que
-- fechar (e guarda os campeões do período inteiro). Só cria se não existir.
insert into public.temporadas (numero, inicio)
select 1, '-infinity'::timestamptz where not exists (select 1 from public.temporadas);

-- Início da temporada atual (ou -infinity = conta tudo, se nunca abriu uma).
create or replace function public.temporada_inicio()
returns timestamptz language sql stable security definer set search_path = '' as $$
  select coalesce(max(inicio), '-infinity'::timestamptz) from public.temporadas where fim is null;
$$;
grant execute on function public.temporada_inicio() to authenticated;

-- Ranking passa a contar SÓ a temporada atual (data >= início).
create or replace function public.ranking_totais()
returns json language sql security definer set search_path = '' as $$
  select json_build_object(
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (
        select usuario_id, sum(pontos)::int as total
        from public.pontos
        where usuario_id is not null and coalesce(data, '-infinity'::timestamptz) >= public.temporada_inicio()
        group by usuario_id
      ) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (
        select unidade_id, sum(pontos)::int as total
        from public.pontos
        where usuario_id is null and unidade_id is not null and coalesce(data, '-infinity'::timestamptz) >= public.temporada_inicio()
        group by unidade_id
      ) t), '[]'::json)
  );
$$;
grant execute on function public.ranking_totais() to authenticated;

-- Encerra a temporada atual (guardando os campeões que o app calculou) e
-- começa uma nova do zero. Só diretoria.
create or replace function public.nova_temporada(p_campeao_individual text, p_campeao_unidade text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_num int;
begin
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ativo' and papel = 'diretoria') then
    raise exception 'Só a diretoria pode iniciar uma nova temporada.';
  end if;
  perform pg_advisory_xact_lock(hashtext('nova_temporada')); -- serializa cliques simultâneos

  update public.temporadas
     set fim = now(), campeao_individual = p_campeao_individual, campeao_unidade = p_campeao_unidade
   where fim is null;

  select coalesce(max(numero), 0) + 1 into v_num from public.temporadas;
  insert into public.temporadas (numero, inicio, criado_por) values (v_num, now(), v_uid);

  return json_build_object('numero', v_num);
end;
$$;
grant execute on function public.nova_temporada(text, text) to authenticated;

notify pgrst, 'reload schema';
