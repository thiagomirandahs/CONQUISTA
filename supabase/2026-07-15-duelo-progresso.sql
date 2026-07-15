-- =====================================================================
--  Filhos da Conquista — Progresso do Duelo (2026-07-15)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  Antes o duelo era julgado "no olho". Agora, pros desafios que o app SABE
--  medir (missões, presença, jogos, devocional), dá pra ver o DESENVOLVIMENTO:
--  ao tocar no duelo, aparece quem cumpriu e quanto cada um fez, por unidade.
--  Desafios 'manual' (arrecadar alimentos, uniforme) seguem só no olho.
--
--  Segurança: a função de progresso é security definer mas só responde a
--  MEMBRO ATIVO (eh_membro_ativo) — pai/pendente não veem dados de criança.
-- =====================================================================

-- 1) Catálogo ganha "como acompanhar" (tipo) + meta por pessoa.
alter table public.desafios_unidade add column if not exists tipo text not null default 'manual';
alter table public.desafios_unidade add column if not exists meta int not null default 1;
alter table public.desafios_unidade drop constraint if exists desafios_unidade_tipo_valido;
alter table public.desafios_unidade add constraint desafios_unidade_tipo_valido
  check (tipo in ('manual', 'missoes', 'presenca', 'jogos', 'devocional'));

-- Ajusta os 4 desafios que já vieram de fábrica (best-effort, por título).
update public.desafios_unidade set tipo = 'missoes',  meta = 5 where titulo = 'Maratona de missões' and tipo = 'manual';
update public.desafios_unidade set tipo = 'presenca', meta = 1 where titulo = 'Presença total'      and tipo = 'manual';

-- 2) Progresso de UM lado (uma unidade): cada membro e quanto fez desde o duelo.
--    GUARDA POR DENTRO (eh_membro_ativo): mesmo que alguem consiga chamar a função
--    direto (anon/pai/pendente), ela devolve VAZIO — não vaza nome de criança.
--    Não confiamos só em grant/revoke (no Supabase, anon também nasce com execute).
create or replace function public.progresso_lado(p_uni uuid, p_tipo text, p_meta int, p_desde timestamptz)
returns json language sql security definer set search_path = '' as $$
  select case when public.eh_membro_ativo() then (
    with membros as (
      select p.id, p.nome, p.foto
      from public.profiles p
      where p.unidade_id = p_uni and p.status = 'ativo'
        and p.papel in ('desbravador', 'conselheiro')
    ),
    conta as (
      select m.nome, m.foto,
        (select count(*) from public.pontos pt
          where pt.usuario_id = m.id and pt.data >= p_desde
            and case
                  when p_tipo = 'missoes'    then pt.origem = 'missao'
                  when p_tipo = 'jogos'      then pt.origem = 'trilha'
                  when p_tipo = 'devocional' then pt.origem = 'devocional'
                  when p_tipo = 'presenca'   then pt.origem = 'apontamento' and pt.marca->>'presenca' = 'presente'
                  else false
                end
        )::int as feito
      from membros m
    )
    select json_build_object(
      'membros', coalesce(json_agg(json_build_object(
          'nome', nome, 'foto', foto, 'feito', feito, 'cumpriu', feito >= p_meta
        ) order by feito desc, nome), '[]'::json),
      'cumpriram', (select count(*) from conta where feito >= p_meta),
      'total', (select count(*) from conta)
    ) from conta
  ) else json_build_object('membros', '[]'::json, 'cumpriram', 0, 'total', 0) end;
$$;
-- Além da guarda por dentro, tira do PostgREST: revoga de TODOS os papéis
-- (inclui anon e service_role, que grant/revoke parcial deixaria passar).
revoke all on function public.progresso_lado(uuid, text, int, timestamptz)
  from public, anon, authenticated, service_role;

-- 3) Progresso do DUELO: junta os dois lados. Só membro ativo enxerga.
create or replace function public.progresso_duelo(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_tipo text; v_meta int; v_ua uuid; v_ub uuid; v_desde timestamptz;
begin
  if not public.eh_membro_ativo() then return json_build_object('tipo', 'manual'); end if;

  select coalesce(du.tipo, 'manual'), coalesce(du.meta, 1), d.unidade_a, d.unidade_b, d.created_at
    into v_tipo, v_meta, v_ua, v_ub, v_desde
  from public.duelos d
  join public.desafios_unidade du on du.id = d.desafio_id
  where d.id = p_id;

  if not found then raise exception 'Duelo não encontrado.'; end if;
  if v_tipo = 'manual' then return json_build_object('tipo', 'manual', 'meta', v_meta); end if;

  return json_build_object(
    'tipo', v_tipo, 'meta', v_meta,
    'a', public.progresso_lado(v_ua, v_tipo, v_meta, v_desde),
    'b', public.progresso_lado(v_ub, v_tipo, v_meta, v_desde)
  );
end;
$$;
grant execute on function public.progresso_duelo(uuid) to authenticated;

notify pgrst, 'reload schema';
