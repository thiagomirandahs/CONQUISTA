-- 523 — Classe iniciada numa versão ARQUIVADA do currículo não pode ser iniciada de novo na versão vigente (achado da auditoria
-- ATUALIZACAO-DE-CLASSE-ARQUITETURA.md §4): classes_disponiveis e o UNIQUE olhavam só class_id, então "Amigo 2026.3 em andamento" deixava
-- iniciar também "Amigo 2026.4" (duas matrículas ativas da mesma classe no clube, progresso dividido). Agora, no MESMO clube, uma matrícula
-- não cancelada de classe EQUIVALENTE (mesmo código oficial, qualquer versão) bloqueia a oferta e o início/atribuição, com mensagem clara.
-- Não toca matrículas existentes, não migra nada, não muda a regra de idade/dependência/conclusão (519/521). A atualização da matrícula
-- para a versão vigente continua NÃO implementada (ver o parecer).
create or replace function public._classe_matricula_equivalente(p_usuario_id uuid, p_club_id uuid, p_class_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  with alvo as (select c.codigo from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.id = p_class_id and v.origem = 'oficial')
  select mc.id from public.member_classes mc
    join public.classes c on c.id = mc.class_id
    join public.curriculum_versions v on v.id = c.curriculum_version_id and v.origem = 'oficial', alvo
   where mc.usuario_id = p_usuario_id and mc.club_id = p_club_id and mc.status <> 'cancelada'
     and c.codigo = alvo.codigo and mc.class_id <> p_class_id
   order by mc.iniciada_em limit 1;
$$;
revoke all on function public._classe_matricula_equivalente(uuid, uuid, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.classe_iniciar(p_class_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if public._classe_matricula_equivalente(v_uid, v_club, p_class_id) is not null then
    raise exception 'Você já tem esta classe em andamento neste clube, em uma versão anterior do currículo. Peça à liderança a atualização da matrícula.';
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
$function$;

CREATE OR REPLACE FUNCTION public.classe_atribuir(p_usuario_id uuid, p_class_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if public._classe_matricula_equivalente(p_usuario_id, v_club, p_class_id) is not null then
    raise exception 'Esta pessoa já tem esta classe em andamento neste clube, em uma versão anterior do currículo.';
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
$function$;

CREATE OR REPLACE FUNCTION public.classes_disponiveis()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and public._classe_conclusao_ativa_clube(auth.uid(), c.id) is null
    and public._classe_matricula_equivalente(auth.uid(), public.clube_atual_id(), c.id) is null;
$function$;

revoke all on function public.classe_iniciar(uuid) from public, anon;
revoke all on function public.classe_atribuir(uuid, uuid) from public, anon;
revoke all on function public.classes_disponiveis() from public, anon;
grant execute on function public.classe_iniciar(uuid) to authenticated;
grant execute on function public.classe_atribuir(uuid, uuid) to authenticated;
grant execute on function public.classes_disponiveis() to authenticated;
