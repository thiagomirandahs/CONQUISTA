-- 519 — Classes: conclusão vale entre clubes, "iniciada" só vale no clube atual, sem nascimento não matricula.
--
-- Decisões do dono (sobre os pontos que a 518 só CARACTERIZAVA):
--  1) CURRÍCULO ENTRE CLUBES. Conclusão = conquista ATIVA da PESSOA (curriculum_achievements, em qualquer clube;
--     club_id_origem guarda a proveniência) e satisfaz a dependência em qualquer clube. Já a classe apenas INICIADA
--     só satisfaz a dependência 'iniciada_ou_concluida' se a matrícula estiver no CLUBE ATUAL: regular iniciada no
--     clube B não libera a avançada no A. Sem clube atual, "iniciada" não satisfaz.
--     _dependencia_de_classe_satisfeita(uuid,uuid,text) mantém a assinatura e usa clube_atual_id(); nasce a
--     sobrecarga de 4 argumentos (com o clube explícito), que dependencias_pendentes usa (recebe o clube do chamador).
--  2) CLASSE JÁ CONCLUÍDA EM OUTRO CLUBE não é oferecida (classes_disponiveis) e classe_iniciar / classe_atribuir
--     RECUSAM — assim não nasce segunda conclusão/histórico/documento (o índice único por club_id_origem permitiria
--     duplicar). Se já existe matrícula não cancelada da classe NESTE clube, o comportamento idempotente de sempre
--     continua (devolve a mesma matrícula). Nova RPC classes_concluidas_anteriormente(): as conquistas ativas da
--     própria pessoa em OUTROS clubes, para a tela mostrar "já concluída em <clube>".
--  3) SEM NASCIMENTO: classe com idade_minima passa a exigir data de nascimento. _classe_motivo_inelegivel devolve
--     o pedido amigável; classes_disponiveis().bloqueio ganha 'nascimento'. Como classe_iniciar/classe_atribuir já
--     usam o motivo, o servidor também bloqueia a atribuição pela diretoria. NÃO mexe em matrículas existentes.
--  4) Dependências de ESPECIALIDADE: intactas (curriculo_pessoa_concluiu) — ver PENDENCIAS-DE-CONTEUDO-OFICIAL.md.

-- ------------------------------------------------------------------------------------------------
-- (1) dependência de classe: conclusão global, iniciada só no clube informado
-- ------------------------------------------------------------------------------------------------
create or replace function public._dependencia_de_classe_satisfeita(p_usuario_id uuid, p_depende_de_id uuid, p_modo text, p_club_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with alvo as (
    select c.codigo, v.origem from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.id = p_depende_de_id
  ), equivalentes as (
    -- a própria classe e, se ela é do catálogo oficial, a MESMA classe (mesmo código) em qualquer versão oficial
    select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id, alvo
    where c.id = p_depende_de_id or (alvo.origem = 'oficial' and v.origem = 'oficial' and c.codigo = alvo.codigo)
  )
  select exists (   -- concluída: conquista ativa da pessoa, em QUALQUER clube
    select 1 from public.curriculum_achievements a
    where a.usuario_id = p_usuario_id and a.tipo = 'classe' and a.status = 'ativa' and a.classe_id in (select id from equivalentes)
  ) or (p_modo = 'iniciada_ou_concluida' and p_club_id is not null and exists (   -- iniciada: só no clube informado
    select 1 from public.member_classes mc
    where mc.usuario_id = p_usuario_id and mc.club_id = p_club_id and mc.status <> 'cancelada' and mc.class_id in (select id from equivalentes)
  ));
$$;

create or replace function public._dependencia_de_classe_satisfeita(p_usuario_id uuid, p_depende_de_id uuid, p_modo text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public._dependencia_de_classe_satisfeita(p_usuario_id, p_depende_de_id, p_modo, public.clube_atual_id());
$$;

revoke all on function public._dependencia_de_classe_satisfeita(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public._dependencia_de_classe_satisfeita(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.dependencias_pendentes(p_alvo_tipo text, p_alvo_id uuid, p_usuario_id uuid, p_club_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare r record; v_ok boolean; v_nome text; v_faltando text[] := '{}';
begin
  for r in select * from public.curriculum_dependencies where alvo_tipo = p_alvo_tipo and alvo_id = p_alvo_id and obrigatorio loop
    if r.depende_de_tipo = 'class' then
      v_ok := public._dependencia_de_classe_satisfeita(p_usuario_id, r.depende_de_id, r.modo, p_club_id);
      select nome into v_nome from public.classes where id = r.depende_de_id;
    else
      v_ok := public.curriculo_pessoa_concluiu('especialidade', p_usuario_id, null, r.depende_de_id);
      select nome into v_nome from public.specialties where id = r.depende_de_id;
    end if;
    if not v_ok then
      v_faltando := array_append(v_faltando, coalesce(v_nome, r.depende_de_id::text));
    end if;
  end loop;
  return v_faltando;
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- (2) classe já concluída pela pessoa (em qualquer clube): devolve o clube de origem da conquista mais recente
-- ------------------------------------------------------------------------------------------------
create or replace function public._classe_conclusao_ativa_clube(p_usuario_id uuid, p_class_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  with alvo as (
    select c.codigo, v.origem from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.id = p_class_id
  ), equivalentes as (
    select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id, alvo
    where c.id = p_class_id or (alvo.origem = 'oficial' and v.origem = 'oficial' and c.codigo = alvo.codigo)
  )
  select a.club_id_origem from public.curriculum_achievements a
   where a.usuario_id = p_usuario_id and a.tipo = 'classe' and a.status = 'ativa' and a.classe_id in (select id from equivalentes)
   order by a.concluida_em desc, a.id limit 1;
$$;
revoke all on function public._classe_conclusao_ativa_clube(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- (3) motivo / tipo de bloqueio: sem nascimento não dá para verificar a idade
-- ------------------------------------------------------------------------------------------------
create or replace function public._classe_motivo_inelegivel(p_usuario_id uuid, p_class_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select format('Esta classe é a partir de %s anos.', c.idade_minima)
       from public.classes c join public.profiles p on p.id = p_usuario_id
      where c.id = p_class_id and c.idade_minima is not null and p.nascimento is not null
        and extract(year from age(current_date, p.nascimento))::int < c.idade_minima),
    (select 'Informe a data de nascimento para verificar quais classes estão disponíveis.'
       from public.classes c
      where c.id = p_class_id and c.idade_minima is not null
        and not exists (select 1 from public.profiles p where p.id = p_usuario_id and p.nascimento is not null)),
    (select case when d.modo = 'iniciada_ou_concluida'
                 then format('Comece a classe %s primeiro: a Classe Avançada é feita junto com ela ou depois dela.', r.nome)
                 else format('Conclua a classe %s primeiro.', r.nome) end
       from public.curriculum_dependencies d join public.classes r on r.id = d.depende_de_id
      where d.alvo_tipo = 'class' and d.alvo_id = p_class_id and d.depende_de_tipo = 'class' and d.obrigatorio
        and not public._dependencia_de_classe_satisfeita(p_usuario_id, d.depende_de_id, d.modo)
      order by r.ordem, r.nome limit 1)
  );
$$;

create or replace function public._classe_bloqueio_tipo(p_usuario_id uuid, p_class_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.classes c join public.profiles p on p.id = p_usuario_id
       where c.id = p_class_id and c.idade_minima is not null and p.nascimento is not null
         and extract(year from age(current_date, p.nascimento))::int < c.idade_minima
    ) then 'idade'
    when exists (
      select 1 from public.classes c
       where c.id = p_class_id and c.idade_minima is not null
         and not exists (select 1 from public.profiles p where p.id = p_usuario_id and p.nascimento is not null)
    ) then 'nascimento'
    when exists (
      select 1 from public.curriculum_dependencies d
       where d.alvo_tipo = 'class' and d.alvo_id = p_class_id and d.depende_de_tipo = 'class' and d.obrigatorio
         and not public._dependencia_de_classe_satisfeita(p_usuario_id, d.depende_de_id, d.modo)
    ) then 'pre_requisito'
    else null
  end;
$$;
revoke all on function public._classe_motivo_inelegivel(uuid, uuid) from public, anon, authenticated;
revoke all on function public._classe_bloqueio_tipo(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- classes_disponiveis: não oferece classe já concluída pela pessoa (qualquer clube)
-- ------------------------------------------------------------------------------------------------
create or replace function public.classes_disponiveis() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'class_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
    'idade_minima', c.idade_minima, 'manifesto_id', c.manifesto_id, 'vigente_desde', c.vigente_desde,
    'avancada', c.tipo_classe = 'avancada', 'classe_regular_codigo', c.classe_regular_codigo,
    'elegivel', public._classe_motivo_inelegivel(auth.uid(), c.id) is null,
    'motivo_inelegivel', public._classe_motivo_inelegivel(auth.uid(), c.id),
    'curriculum_version', json_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao),
    'bloqueio', public._classe_bloqueio_tipo(auth.uid(), c.id),
    'anterior', public._classe_eh_anterior(auth.uid(), c.id)
  ) order by c.ordem, c.tipo_classe = 'avancada', c.nome), '[]'::json)
  from public.classes c
  join public.curriculum_versions v on v.id = c.curriculum_version_id
  where c.ativo and v.status = 'publicado' and v.origem = 'oficial'
    and public.membro_ativo_no_clube(public.clube_atual_id())
    and not exists (
      select 1 from public.member_classes mc
      where mc.usuario_id = auth.uid() and mc.club_id = public.clube_atual_id() and mc.class_id = c.id and mc.status <> 'cancelada'
    )
    and public._classe_conclusao_ativa_clube(auth.uid(), c.id) is null;
$$;
revoke all on function public.classes_disponiveis() from public, anon;
grant execute on function public.classes_disponiveis() to authenticated;

-- ------------------------------------------------------------------------------------------------
-- classe_iniciar / classe_atribuir: recusam classe já concluída em outro clube
-- ------------------------------------------------------------------------------------------------
create or replace function public.classe_iniciar(p_class_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc_id uuid; v_faltando text[]; v_motivo text; v_origem uuid;
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then
    raise exception 'Sem clube em uso.';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not public._classe_no_fluxo_normal(p_class_id) then raise exception 'Classe não encontrada.'; end if;
  v_origem := public._classe_conclusao_ativa_clube(v_uid, p_class_id);
  if v_origem is not null and not exists (
    select 1 from public.member_classes mc where mc.usuario_id = v_uid and mc.club_id = v_club and mc.class_id = p_class_id and mc.status <> 'cancelada'
  ) then
    raise exception 'Esta classe já foi concluída por você em %.', coalesce((select u.nome from public.organizational_units u where u.id = v_origem), 'outro clube');
  end if;
  v_motivo := public._classe_motivo_inelegivel(v_uid, p_class_id);
  if v_motivo is not null then raise exception '%', v_motivo; end if;
  v_faltando := public.dependencias_pendentes('class', p_class_id, v_uid, v_club);
  if array_length(v_faltando, 1) > 0 then
    raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', ');
  end if;
  v_mc_id := public._classe_matricular(v_uid, v_club, p_class_id);
  return json_build_object('ok', true, 'member_class_id', v_mc_id);
end;
$$;

create or replace function public.classe_atribuir(p_usuario_id uuid, p_class_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_mc_id uuid; v_faltando text[]; v_motivo text; v_origem uuid;
begin
  if v_club is null or not public.pode_avaliar_curriculo(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_usuario_id and m.organizational_unit_id = v_club and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Pessoa sem vínculo ativo neste clube.';
  end if;
  if not public._classe_no_fluxo_normal(p_class_id) then raise exception 'Classe não encontrada.'; end if;
  v_origem := public._classe_conclusao_ativa_clube(p_usuario_id, p_class_id);
  if v_origem is not null and not exists (
    select 1 from public.member_classes mc where mc.usuario_id = p_usuario_id and mc.club_id = v_club and mc.class_id = p_class_id and mc.status <> 'cancelada'
  ) then
    -- versão neutra: a diretoria não precisa saber o nome do outro clube
    raise exception 'Esta classe já foi concluída por esta pessoa%.', case when v_origem = v_club then ' neste clube' else ' em outro clube' end;
  end if;
  v_motivo := public._classe_motivo_inelegivel(p_usuario_id, p_class_id);
  if v_motivo is not null then raise exception '%', v_motivo; end if;
  v_faltando := public.dependencias_pendentes('class', p_class_id, p_usuario_id, v_club);
  if array_length(v_faltando, 1) > 0 then
    raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', ');
  end if;
  v_mc_id := public._classe_matricular(p_usuario_id, v_club, p_class_id);
  return json_build_object('ok', true, 'member_class_id', v_mc_id);
end;
$$;
revoke all on function public.classe_iniciar(uuid) from public, anon;
revoke all on function public.classe_atribuir(uuid, uuid) from public, anon;
grant execute on function public.classe_iniciar(uuid) to authenticated;
grant execute on function public.classe_atribuir(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- classes_concluidas_anteriormente(): conquistas ATIVAS da própria pessoa em OUTROS clubes
-- (só o nome do clube de origem; nada de relatório, evidência ou dados de outra pessoa)
-- ------------------------------------------------------------------------------------------------
create or replace function public.classes_concluidas_anteriormente() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club)
     or not public.recurso_habilitado_no_clube(v_club, 'classes') then
    return '[]'::json;
  end if;
  return (
    select coalesce(json_agg(x.j order by x.concluida_em desc), '[]'::json) from (
      select t.concluida_em, json_build_object(
        'class_id', t.class_id, 'codigo', t.codigo, 'nome', t.nome, 'avancada', t.avancada,
        'concluida_em', t.concluida_em, 'origem_clube_nome', t.clube_nome, 'origem', 'outro_clube') as j
      from (
        select distinct on (c.codigo) c.id as class_id, c.codigo, c.nome, (c.tipo_classe = 'avancada') as avancada,
               a.concluida_em, u.nome as clube_nome
          from public.curriculum_achievements a
          join public.classes c on c.id = a.classe_id
          join public.curriculum_versions v on v.id = c.curriculum_version_id and v.origem = 'oficial'
          join public.organizational_units u on u.id = a.club_id_origem
         where a.usuario_id = v_uid and a.tipo = 'classe' and a.status = 'ativa' and a.club_id_origem <> v_club
           and not exists (
             select 1 from public.member_classes mc join public.classes c2 on c2.id = mc.class_id
              where mc.usuario_id = v_uid and mc.club_id = v_club and mc.status <> 'cancelada' and c2.codigo = c.codigo
           )
         order by c.codigo, a.concluida_em desc
      ) t
      order by t.concluida_em desc
      limit 50
    ) x
  );
end;
$$;
revoke all on function public.classes_concluidas_anteriormente() from public, anon;
grant execute on function public.classes_concluidas_anteriormente() to authenticated;
