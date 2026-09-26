-- =============================================================================
-- 330 — Fluxo de aprovação do cartão de classe: CLUBE → DISTRITO → REGIÃO → apto à investidura.
--
-- DECISÃO DO DONO (26/09): "O cartão de classe, quando acaba, vai para a aprovação dos instrutores,
-- depois do distrito, depois da regional. Daí fica apto à investidura."
-- AJUSTE DO DONO (26/09): "Os requisitos precisam aparecer para correção" — quem aprova (clube, distrito,
-- região) vê o cartão completo (requisitos, texto e fotos) e, ao devolver, marca QUAIS requisitos voltam.
--
-- Nada de schema novo pro fluxo: usa o motor DECLARATIVO/VERSIONADO da migration 46
-- (investiture_workflows / investiture_workflow_stages / runs / decisões imutáveis).
--
-- 1) NOVA VERSÃO do workflow (a v1 não é editada — só arquivada com ativo=false):
--      classes-regulares v2 e classes-avancadas v1 (mesmas etapas):
--        1 revisao_clube            'Revisão do clube'       clube    instrutor|diretoria (capelão é cargo do papel instrutor)
--        2 aprovacao_intermediaria  'Aprovação do distrito'  distrito coordenador_distrital  pula se o clube não tem distrito
--        3 aprovacao_intermediaria  'Aprovação da região'    regiao   coordenador_regional   pula se o clube não tem região
--        4 investidura              'Investidura'            clube    instrutor|diretoria (a investidura continua registrada pelo clube)
--      "Apto à investidura" = a corrida chegou na etapa 4 (member_classes.status = apto_investidura).
--    PULAR: etapas 2/3 têm pular_se_nivel_ausente — o motor (46) registra 'pulada_nivel_ausente' (imutável,
--      auditável) quando unidade_ancestral(clube, tipo) é NULL. Clube sem pai (ex.: "Teste piloto um") vai
--      direto do clube para "apto", como hoje. Clube com região mas sem distrito pula só o distrito.
--      Nível que EXISTE mas está sem coordenador ativo NÃO é pulado: o cartão espera (o admin convida).
--    SEGREGAÇÃO: distrito/região não permitem o mesmo decisor de outra etapa de tipo diferente (regra da 46).
--
-- 2) PROCESSOS EM ANDAMENTO: cada corrida guarda workflow_id/versão desde que nasceu — quem já está em
--    revisão ou apto continua na v1 (2 etapas no clube) até o fim. Só conclusões SELADAS a partir desta
--    migration abrem corrida na versão nova. Nenhuma linha existente é alterada.
--
-- 3) DEVOLVER (coordenacao_investidura_decidir, 'devolvido', motivo obrigatório): a decisão fica gravada
--    (correcao_solicitada, imutável) e a corrida é cancelada; o cartão VOLTA PARA A ETAPA DO CLUBE:
--      a) com requisitos marcados: cada um volta para 'correcao_solicitada' (fluxo de correção de sempre,
--         com o comentário por requisito em requirement_approvals); a matrícula volta a 'em_andamento'.
--         Quando o desbravador reenviar e o clube reaprovar, a conclusão é selada de novo (gatilho de
--         sempre) e abre corrida NOVA — revisão do clube → distrito → região outra vez.
--      b) sem requisito marcado: a conclusão é selada de novo na hora (snapshot v+1) e cai de volta na
--         revisão do clube (aguardando_revisao), com o motivo visível para o clube.
--
-- 4) VER O CARTÃO (investidura_cartao): liderança do clube em uso, ou a autoridade da ETAPA ATUAL, ou quem
--    já aprovou uma etapa acima (e segue com o cargo) — só enquanto a corrida está em andamento. Fotos:
--    policy nova no bucket 'comprovacoes' com a MESMA regra (URL assinada curta, gerada pelo app). Fora do
--    processo (painel/portal geral) a coordenação continua sem evidência nenhuma.
--
-- 5) Sino: coordenadores da etapa recebem aviso quando um cartão chega nela; a liderança do clube quando a
--    coordenação aprova ou devolve (gatilho na corrida — pega todo caminho, inclusive o da revisão do clube).
-- Idempotente. security definer + search_path ''.
-- =============================================================================

-- ---------- eventos novos do histórico da matrícula ----------
alter table public.class_completion_events drop constraint if exists class_completion_events_tipo_check;
alter table public.class_completion_events add constraint class_completion_events_tipo_check check (tipo in (
  'requisitos_concluidos', 'conclusao_bloqueada', 'snapshot_selado', 'snapshot_substituido', 'revisao_solicitada',
  'revisao_aprovada', 'revisao_correcao', 'investidura_registrada', 'snapshot_revogado', 'investidura_revogada',
  'conquista_revogada', 'coordenacao_aprovou', 'coordenacao_devolveu'));

-- ---------- 1) nova versão (regulares v2) + avançadas v1; arquiva a v1 das regulares ----------
insert into public.investiture_workflows (id, chave, versao, nome, descricao, ativo) values
  (public.curriculo_uuid('workflow:classes-regulares:2'), 'classes-regulares', 2, 'Investidura — Classes Regulares (v2)',
   'Decisão do dono (26/09): revisão do clube → aprovação do distrito → aprovação da região → apto à investidura (registrada pelo clube). '
   'Distrito/região pulam sozinhos quando o clube não tem esse nível na árvore. Migration 330.', true),
  (public.curriculo_uuid('workflow:classes-avancadas:1'), 'classes-avancadas', 1, 'Investidura — Classes Avançadas (v1)',
   'Mesmo fluxo das regulares v2 (decisão do dono, 26/09). Migration 330.', true)
on conflict (chave, versao) do nothing;

insert into public.investiture_workflow_stages (id, workflow_id, ordem, chave, nome, escopo_tipo, papeis_permitidos, obrigatoria, pular_se_nivel_ausente, permite_mesmo_decisor)
select public.curriculo_uuid('workflow-stage:' || w.chave || ':' || w.versao || ':' || s.ordem), public.curriculo_uuid('workflow:' || w.chave || ':' || w.versao),
       s.ordem, s.chave, s.nome, s.escopo_tipo, s.papeis, true, s.pula, s.mesmo
  from (values ('classes-regulares', 2), ('classes-avancadas', 1)) w(chave, versao)
 cross join (values
   (1, 'revisao_clube', 'Revisão do clube', 'clube', array['instrutor', 'diretoria'], false, true),
   (2, 'aprovacao_intermediaria', 'Aprovação do distrito', 'distrito', array['coordenador_distrital'], true, false),
   (3, 'aprovacao_intermediaria', 'Aprovação da região', 'regiao', array['coordenador_regional'], true, false),
   (4, 'investidura', 'Investidura', 'clube', array['instrutor', 'diretoria'], false, true)
 ) s(ordem, chave, nome, escopo_tipo, papeis, pula, mesmo)
on conflict (workflow_id, ordem) do nothing;

-- arquiva (não apaga, não edita as etapas) — corridas antigas seguem apontando pra ela
update public.investiture_workflows set ativo = false where chave = 'classes-regulares' and versao = 1 and ativo;

-- a corrida nasce no workflow ATIVO do tipo da classe (avançada → classes-avancadas; senão, regulares)
create or replace function public._workflow_iniciar_run(p_snapshot_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_snap record; v_chave text; v_wf_id uuid; v_wf_versao int; v_run_id uuid;
begin
  select * into v_snap from public.class_completion_snapshots where id = p_snapshot_id;
  if not found then raise exception 'Snapshot não encontrado.'; end if;
  select case when c.tipo_classe = 'avancada' then 'classes-avancadas' else 'classes-regulares' end into v_chave
    from public.classes c where c.id = v_snap.classe_id;
  select id, versao into v_wf_id, v_wf_versao from public.investiture_workflows
   where chave = coalesce(v_chave, 'classes-regulares') and ativo order by versao desc limit 1;
  if v_wf_id is null then
    select id, versao into v_wf_id, v_wf_versao from public.investiture_workflows where chave = 'classes-regulares' and ativo order by versao desc limit 1;
  end if;
  if v_wf_id is null then raise exception 'Nenhum workflow de investidura ativo para classes-regulares — configuração ausente.'; end if;
  insert into public.investiture_workflow_runs (snapshot_id, member_class_id, usuario_id, club_id_origem, workflow_id, workflow_versao, status, current_stage_ordem)
  values (p_snapshot_id, v_snap.member_class_id, v_snap.usuario_id, v_snap.club_id_origem, v_wf_id, v_wf_versao, 'em_andamento',
          (select min(ordem) from public.investiture_workflow_stages where workflow_id = v_wf_id))
  returning id into v_run_id;
  insert into public.investiture_reviews (member_class_id, club_id, usuario_id, snapshot_id)
  values (v_snap.member_class_id, v_snap.club_id_origem, v_snap.usuario_id, p_snapshot_id);
  return v_run_id;
end;
$$;
revoke all on function public._workflow_iniciar_run(uuid) from public, anon, authenticated;

-- ---------- quem da coordenação pode VER o cartão (e as fotos) ----------
-- Só com corrida EM ANDAMENTO: (a) autoridade da etapa atual (não-clube), com vínculo ativo na unidade
-- resolvida pela árvore; ou (b) quem já APROVOU uma etapa não-clube desta corrida e segue com o cargo
-- naquela mesma unidade (o distrital acompanha enquanto a região decide).
create or replace function public._workflow_coordenacao_ve_cartao(p_uid uuid, p_member_class_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and exists (
    select 1 from public.investiture_workflow_runs r
      join public.investiture_workflow_stages st on st.workflow_id = r.workflow_id and st.ordem = r.current_stage_ordem
     where r.member_class_id = p_member_class_id and r.status = 'em_andamento'
       and (
         (st.escopo_tipo <> 'clube'
          and public._workflow_papel_autorizado(p_uid, public.unidade_ancestral(r.club_id_origem, st.escopo_tipo), st.papeis_permitidos) is not null)
         or exists (select 1 from public.workflow_stage_decisions d
                     where d.run_id = r.id and d.decisor_id = p_uid and d.decisao = 'aprovado' and d.escopo_tipo <> 'clube'
                       and public._workflow_papel_autorizado(p_uid, d.escopo_organizational_unit_id, d.papeis_permitidos) is not null)
       ));
$$;
revoke all on function public._workflow_coordenacao_ve_cartao(uuid, uuid) from public, anon, authenticated;

create or replace function public.coordenacao_ve_comprovacao(p_objeto text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member_requirements x
     where x.evidencia_path = p_objeto and public._workflow_coordenacao_ve_cartao(auth.uid(), x.member_class_id)
    union all
    select 1 from public.requirement_submissions s join public.member_requirements x on x.id = s.member_requirement_id
     where s.evidencia_path = p_objeto and public._workflow_coordenacao_ve_cartao(auth.uid(), x.member_class_id)
  );
$$;
revoke all on function public.coordenacao_ve_comprovacao(text) from public, anon;
grant execute on function public.coordenacao_ve_comprovacao(text) to authenticated;

drop policy if exists "comprovacao: coordenacao na etapa de aprovacao le" on storage.objects;
create policy "comprovacao: coordenacao na etapa de aprovacao le" on storage.objects for select to authenticated
using (bucket_id = 'comprovacoes' and public.coordenacao_ve_comprovacao(name));

-- ---------- linha do tempo da corrida mais recente (usada pelo cartão) ----------
create or replace function public._workflow_linha_do_tempo(p_run_id uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'run_id', r.id, 'status', r.status, 'iniciado_em', r.created_at, 'workflow_versao', r.workflow_versao,
    'etapa_atual_ordem', case when r.status = 'em_andamento' then r.current_stage_ordem end,
    'etapas', (select coalesce(json_agg(json_build_object(
        'ordem', st.ordem, 'chave', st.chave, 'nome', st.nome, 'escopo_tipo', st.escopo_tipo,
        'decisao', (select json_build_object('decisao', d.decisao, 'observacao', d.observacao, 'decidido_em', d.decidido_em,
                      'papel_utilizado', d.papel_utilizado, 'decisor_nome', (select p.nome from public.profiles p where p.id = d.decisor_id),
                      'escopo_nome', (select o.nome from public.organizational_units o where o.id = d.escopo_organizational_unit_id))
                    from public.workflow_stage_decisions d where d.run_id = r.id and d.stage_id = st.id)
      ) order by st.ordem), '[]'::json)
      from public.investiture_workflow_stages st where st.workflow_id = r.workflow_id))
  from public.investiture_workflow_runs r where r.id = p_run_id;
$$;
revoke all on function public._workflow_linha_do_tempo(uuid) from public, anon, authenticated;

-- corrida mais recente de uma matrícula: 1 corrida por snapshot e a versão do snapshot só cresce — ordem
-- determinística (created_at empata dentro de uma mesma transação)
create or replace function public._workflow_run_mais_recente(p_member_class_id uuid, p_pular int default 0) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.investiture_workflow_runs r join public.class_completion_snapshots s on s.id = r.snapshot_id
   where r.member_class_id = p_member_class_id order by s.versao desc offset greatest(p_pular, 0) limit 1;
$$;
revoke all on function public._workflow_run_mais_recente(uuid, int) from public, anon, authenticated;

-- a devolução da coordenação que o clube ainda precisa tratar: a da corrida atual (se cancelada por ela)
-- ou a da corrida anterior, enquanto a nova ainda está na revisão do clube
create or replace function public._workflow_devolucao_pendente(p_member_class_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_ult record; v_run uuid;
begin
  select r.* into v_ult from public.investiture_workflow_runs r where r.id = public._workflow_run_mais_recente(p_member_class_id);
  if v_ult.id is null then return null; end if;
  if v_ult.status = 'cancelado' then v_run := v_ult.id;
  elsif v_ult.status = 'em_andamento' and v_ult.current_stage_ordem = (select min(ordem) from public.investiture_workflow_stages where workflow_id = v_ult.workflow_id)
    then v_run := public._workflow_run_mais_recente(p_member_class_id, 1);
  else return null;
  end if;
  return (select json_build_object('etapa', st.nome, 'escopo_tipo', d.escopo_tipo, 'motivo', d.observacao, 'em', d.decidido_em,
                   'por_nome', (select nome from public.profiles where id = d.decisor_id))
            from public.workflow_stage_decisions d join public.investiture_workflow_stages st on st.id = d.stage_id
           where d.run_id = v_run and d.decisao = 'correcao_solicitada' and d.escopo_tipo <> 'clube' limit 1);
end;
$$;
revoke all on function public._workflow_devolucao_pendente(uuid) from public, anon, authenticated;

-- ---------- 4) o cartão completo, pra quem aprova ----------
create or replace function public.investidura_cartao(p_member_class_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_mc record; v_run uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into v_mc from public.member_classes where id = p_member_class_id;
  -- mesma resposta pra "não existe" e "não é da sua alçada" (sem oráculo de UUID)
  if not found or not public._classe_do_catalogo_oficial(v_mc.class_id)
     or not ((v_mc.club_id = public.clube_atual_id() and public.pode_avaliar_curriculo(v_mc.club_id))
             or public._workflow_coordenacao_ve_cartao(v_uid, v_mc.id)) then
    raise exception 'Cartão não encontrado.';
  end if;
  perform public._exigir_classes_habilitado(v_mc.club_id);
  v_run := public._workflow_run_mais_recente(v_mc.id);

  return json_build_object(
    'member_class_id', v_mc.id, 'status', v_mc.status, 'iniciada_em', v_mc.iniciada_em, 'concluida_em', v_mc.concluida_em,
    'pessoa_nome', (select nome from public.profiles where id = v_mc.usuario_id),
    'classe_nome', (select nome from public.classes where id = v_mc.class_id),
    'clube_nome', (select nome from public.organizational_units where id = v_mc.club_id),
    'linha_do_tempo', case when v_run is null then null else public._workflow_linha_do_tempo(v_run) end,
    'devolucao', public._workflow_devolucao_pendente(v_mc.id),
    'requisitos', (select coalesce(json_agg(json_build_object(
        'member_requirement_id', mr.id, 'secao_codigo', s.codigo, 'secao_nome', s.nome, 'codigo', r.codigo, 'descricao', r.descricao,
        'status', mr.status, 'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
        'aprovacao', (select json_build_object('em', a.created_at, 'por_nome', pp.nome, 'papel', a.avaliado_papel)
                        from public.requirement_approvals a join public.profiles pp on pp.id = a.avaliado_por
                       where a.member_requirement_id = mr.id and a.decisao = 'aprovado' order by a.created_at desc limit 1)
      ) order by s.ordem, r.ordem, r.codigo), '[]'::json)
      from public.member_requirements mr
      join public.class_requirements r on r.id = mr.requirement_id and r.ativo
      join public.class_sections s on s.id = r.section_id
     where mr.member_class_id = v_mc.id)
  );
end;
$$;
revoke all on function public.investidura_cartao(uuid) from public, anon;
grant execute on function public.investidura_cartao(uuid) to authenticated;

-- ---------- 3) aprovar / devolver na etapa do distrito ou da região ----------
-- p_correcoes: [{ "member_requirement_id": uuid, "comentario": "..." }] (opcional; só em 'devolvido').
create or replace function public.coordenacao_investidura_decidir(p_member_class_id uuid, p_decisao text, p_comentario text default null, p_correcoes jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_mc record; v_run record; v_stage record; v_result jsonb; v_papel text;
  v_item jsonb; v_mr_id uuid; v_coment text; v_motivo text := nullif(btrim(coalesce(p_comentario, '')), '');
  v_n int := 0; v_ids uuid[] := '{}'; v_selo jsonb;
begin
  if p_decisao not in ('aprovado', 'devolvido') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_decisao = 'devolvido' and (v_motivo is null or length(v_motivo) < 3) then raise exception 'Explique o motivo da devolução ao clube.'; end if;
  if p_correcoes is null then p_correcoes := '[]'::jsonb; end if;
  if jsonb_typeof(p_correcoes) <> 'array' then raise exception 'Lista de correções inválida.'; end if;
  if p_decisao = 'aprovado' and jsonb_array_length(p_correcoes) > 0 then raise exception 'Correções só fazem sentido ao devolver.'; end if;

  select * into v_mc from public.member_classes where id = p_member_class_id for update;
  if not found or not public._classe_do_catalogo_oficial(v_mc.class_id) or not public._workflow_coordenacao_ve_cartao(v_uid, v_mc.id) then
    raise exception 'Cartão não encontrado ou fora da sua etapa.';
  end if;
  perform public._exigir_classes_habilitado(v_mc.club_id);
  select * into v_run from public.investiture_workflow_runs where member_class_id = v_mc.id and status = 'em_andamento' limit 1 for update;
  if not found then raise exception 'Este cartão não está aguardando aprovação.'; end if;
  select * into v_stage from public.investiture_workflow_stages where workflow_id = v_run.workflow_id and ordem = v_run.current_stage_ordem;
  if v_stage.chave is distinct from 'aprovacao_intermediaria' then
    raise exception 'Este cartão não está numa etapa da coordenação (etapa atual: %).', coalesce(v_stage.nome, '?');
  end if;

  -- valida as correções ANTES de gravar qualquer decisão
  for v_item in select x from jsonb_array_elements(p_correcoes) x loop
    begin v_mr_id := (v_item ->> 'member_requirement_id')::uuid; exception when others then v_mr_id := null; end;
    if v_mr_id is null or not exists (select 1 from public.member_requirements where id = v_mr_id and member_class_id = v_mc.id) then
      raise exception 'Requisito informado não é deste cartão.';
    end if;
    if v_mr_id = any (v_ids) then raise exception 'Requisito repetido na lista de correções.'; end if;
    v_ids := v_ids || v_mr_id;
  end loop;

  -- o motor confere a autoridade pela árvore (vínculo ativo NA unidade resolvida), a segregação e grava imutável
  v_result := public._workflow_registrar_decisao(v_run.id, case when p_decisao = 'aprovado' then 'aprovado' else 'correcao_solicitada' end, v_motivo, 'aprovacao_intermediaria');
  v_papel := v_result ->> 'papel_utilizado';

  if p_decisao = 'aprovado' then
    if (v_result ->> 'proxima_etapa') = 'investidura' then
      update public.member_classes set status = 'apto_investidura', updated_at = now() where id = v_mc.id;
    end if;
    perform public._classe_evento(v_mc.id, 'coordenacao_aprovou', v_run.snapshot_id, v_motivo,
      jsonb_build_object('etapa', v_stage.nome, 'escopo_tipo', v_stage.escopo_tipo, 'papel', v_papel, 'proxima_etapa', v_result ->> 'proxima_etapa'));
    return jsonb_build_object('ok', true, 'status', case when (v_result ->> 'proxima_etapa') = 'investidura' then 'apto_investidura' else v_mc.status end,
      'proxima_etapa', v_result ->> 'proxima_etapa');
  end if;

  -- DEVOLVIDO: volta pra etapa do clube
  update public.investiture_reviews set status = 'correcao_solicitada',
         comentario = left('Devolvido pela coordenação (' || v_stage.nome || '): ' || v_motivo, 2000)
   where snapshot_id = v_run.snapshot_id and status = 'aprovado';

  for v_item in select x from jsonb_array_elements(p_correcoes) x loop
    v_mr_id := (v_item ->> 'member_requirement_id')::uuid;
    v_coment := coalesce(nullif(btrim(coalesce(v_item ->> 'comentario', '')), ''), v_motivo);
    update public.member_requirements set status = 'correcao_solicitada', updated_at = now() where id = v_mr_id;
    insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario, conteudo_avaliado)
    select mr.id, mr.requirement_id, c.curriculum_version_id, v_mc.club_id, 'correcao_solicitada', v_uid, coalesce(v_papel, '?'),
           left(v_stage.nome || ': ' || v_coment, 2000), mr.conteudo_fixado
      from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id
      join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
     where mr.id = v_mr_id;
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    update public.member_classes set status = 'em_andamento', concluida_em = null, updated_at = now() where id = v_mc.id;
  else
    -- nenhum requisito marcado: sela de novo e cai direto na revisão do clube (corrida nova, versão ativa)
    update public.member_classes set status = 'requisitos_concluidos', updated_at = now() where id = v_mc.id;
    v_selo := public._classe_selar_conclusao(v_mc.id);
  end if;
  perform public._classe_evento(v_mc.id, 'coordenacao_devolveu', v_run.snapshot_id, v_motivo,
    jsonb_build_object('etapa', v_stage.nome, 'escopo_tipo', v_stage.escopo_tipo, 'papel', v_papel, 'requisitos', to_jsonb(v_ids)));
  return jsonb_build_object('ok', true,
    'status', (select status from public.member_classes where id = v_mc.id), 'requisitos_reabertos', v_n);
end;
$$;
revoke all on function public.coordenacao_investidura_decidir(uuid, text, text, jsonb) from public, anon;
grant execute on function public.coordenacao_investidura_decidir(uuid, text, text, jsonb) to authenticated;

-- ---------- "O que depende de você" (portal): resumo, sem fotos/evidências ----------
create or replace function public.escopo_investiduras_pendentes()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_escopo uuid := public.escopo_atual_id(); v_papel text;
begin
  if v_uid is null or v_escopo is null then return '[]'::json; end if;
  select m.role into v_papel from public.organization_memberships m
   where m.user_id = v_uid and m.organizational_unit_id = v_escopo and m.status = 'ativo'
     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()) limit 1;
  if v_papel is null or not (public._capacidades_institucionais(v_papel) ->> 'decidir_workflow')::boolean then
    return '[]'::json;
  end if;

  return coalesce((
    select json_agg(json_build_object(
      'member_class_id', r.member_class_id,
      'pessoa_nome', p.nome,                 -- parte do processo oficial de investidura (decisão do dono)
      'classe_nome', cl.nome,
      'clube_nome', o.nome,
      'concluida_em', mc.concluida_em,
      'etapa', json_build_object('ordem', st.ordem, 'chave', st.chave, 'nome', st.nome, 'escopo_tipo', st.escopo_tipo),
      'workflow', json_build_object('versao', r.workflow_versao),
      'aprovacoes', (select coalesce(json_agg(json_build_object('etapa', s2.nome, 'escopo_tipo', d.escopo_tipo, 'em', d.decidido_em,
                        'por_nome', (select nome from public.profiles where id = d.decisor_id), 'papel', d.papel_utilizado) order by d.ordem), '[]'::json)
                       from public.workflow_stage_decisions d join public.investiture_workflow_stages s2 on s2.id = d.stage_id
                      where d.run_id = r.id and d.decisao = 'aprovado'),
      'aguardando_desde', r.updated_at
    ) order by r.updated_at)
    from public.investiture_workflow_runs r
    join public.investiture_workflow_stages st on st.workflow_id = r.workflow_id and st.ordem = r.current_stage_ordem
    join public.profiles p on p.id = r.usuario_id
    join public.organizational_units o on o.id = r.club_id_origem
    join public.member_classes mc on mc.id = r.member_class_id
    join public.classes cl on cl.id = mc.class_id
    where r.status = 'em_andamento'
      and st.escopo_tipo <> 'clube'
      and r.club_id_origem in (select club_id from public._clubes_descendentes(v_escopo))
      and public.unidade_ancestral(r.club_id_origem, st.escopo_tipo) = v_escopo
      and v_papel = any (st.papeis_permitidos)
      and public._classe_do_catalogo_oficial(mc.class_id)
  ), '[]'::json);
end;
$$;

-- ---------- histórico: + etapa atual (o app mostra "Aguardando distrito/região") ----------
create or replace function public.workflow_historico(p_member_class_id uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'runs', (select coalesce(json_agg(json_build_object(
        'run_id', r.id, 'status', r.status, 'iniciado_em', r.created_at, 'snapshot_id', r.snapshot_id,
        'etapa_atual_ordem', case when r.status = 'em_andamento' then r.current_stage_ordem end,
        'workflow', json_build_object('chave', wf.chave, 'versao', r.workflow_versao, 'nome', wf.nome),
        'etapas', (select coalesce(json_agg(json_build_object(
            'ordem', st.ordem, 'chave', st.chave, 'nome', st.nome, 'escopo_tipo', st.escopo_tipo,
            'papeis_permitidos', st.papeis_permitidos, 'obrigatoria', st.obrigatoria,
            'decisao', (select json_build_object('id', d.id, 'decisao', d.decisao, 'metodo', d.metodo, 'observacao', d.observacao,
                          'decidido_em', d.decidido_em, 'workflow_versao', d.workflow_versao, 'papel_utilizado', d.papel_utilizado,
                          'decisor', (select json_build_object('id', p.id, 'nome', p.nome) from public.profiles p where p.id = d.decisor_id),
                          'escopo', (select json_build_object('id', o.id, 'nome', o.nome, 'tipo', o.type) from public.organizational_units o where o.id = d.escopo_organizational_unit_id))
                        from public.workflow_stage_decisions d where d.run_id = r.id and d.stage_id = st.id)
          ) order by st.ordem), '[]'::json)
          from public.investiture_workflow_stages st where st.workflow_id = r.workflow_id)
      ) order by (select sn.versao from public.class_completion_snapshots sn where sn.id = r.snapshot_id), r.created_at), '[]'::json)
      from public.investiture_workflow_runs r join public.investiture_workflows wf on wf.id = r.workflow_id
      where r.member_class_id = p_member_class_id and public._pode_ver_conquista_curricular(r.usuario_id, r.club_id_origem))
  );
$$;
revoke all on function public.workflow_historico(uuid) from public, anon;
grant execute on function public.workflow_historico(uuid) to authenticated;

-- ---------- fila do clube (Investiduras): + etapa atual, linha do tempo e última devolução ----------
-- Corpo idêntico ao vivo (210–212: pode_avaliar_curriculo) + 3 campos.
create or replace function public.classe_revisoes_pendentes()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_avaliar_curriculo(v_club) then return '[]'::json; end if;
  perform public._exigir_classes_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'member_class_id', mc.id, 'status', mc.status, 'concluida_em', mc.concluida_em, 'iniciada_em', mc.iniciada_em,
      'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
      'classe_nome', c.nome, 'classe_manifesto_id', c.manifesto_id, 'percentual', public.classe_percentual(mc.id),
      'snapshot', (select json_build_object('id', s.id, 'versao', s.versao, 'hash', s.hash, 'selado_em', s.selado_em, 'status', s.status,
                      'manifesto_versao', s.conteudo -> 'curriculum_version' ->> 'manifesto_versao')
                   from public.class_completion_snapshots s where s.member_class_id = mc.id and s.status = 'selado' order by s.versao desc limit 1),
      'revisao', (select json_build_object('id', ir.id, 'status', ir.status, 'solicitado_em', ir.solicitado_em, 'revisado_em', ir.revisado_em, 'comentario', ir.comentario)
                  from public.investiture_reviews ir where ir.member_class_id = mc.id order by ir.solicitado_em desc limit 1),
      'bloqueios', (select coalesce(json_agg(json_build_object('codigo', r.codigo, 'bloqueios', to_json(b))), '[]'::json)
                    from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
                    cross join lateral public._requisito_bloqueios(mr.id) b where mr.member_class_id = mc.id and array_length(b, 1) > 0),
      'ultimo_evento', (select json_build_object('tipo', e.tipo, 'em', e.created_at, 'dados', e.dados) from public.class_completion_events e where e.member_class_id = mc.id order by e.created_at desc limit 1),
      'requisitos', (select coalesce(json_agg(json_build_object('member_requirement_id', mr.id, 'secao', s.codigo, 'codigo', r.codigo, 'descricao', r.descricao, 'status', mr.status,
                        'aprovado_por', (select pp.nome from public.requirement_approvals a join public.profiles pp on pp.id = a.avaliado_por where a.member_requirement_id = mr.id and a.decisao = 'aprovado' order by a.created_at desc limit 1))
                        order by s.ordem, r.ordem, r.codigo), '[]'::json)
                     from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id join public.class_sections s on s.id = r.section_id where mr.member_class_id = mc.id and r.ativo),
      -- 330: em que etapa do fluxo o cartão está (+ linha do tempo da corrida atual)
      'etapa_atual', (select json_build_object('ordem', st.ordem, 'chave', st.chave, 'nome', st.nome, 'escopo_tipo', st.escopo_tipo)
                        from public.investiture_workflow_runs wr join public.investiture_workflow_stages st on st.workflow_id = wr.workflow_id and st.ordem = wr.current_stage_ordem
                       where wr.member_class_id = mc.id and wr.status = 'em_andamento' limit 1),
      'linha_do_tempo', public._workflow_linha_do_tempo(public._workflow_run_mais_recente(mc.id)),
      'devolucao', public._workflow_devolucao_pendente(mc.id)
    ) order by mc.concluida_em nulls last, mc.updated_at)
    from public.member_classes mc
    join public.classes c on c.id = mc.class_id
    join public.profiles p on p.id = mc.usuario_id
    where mc.club_id = v_club and mc.status in ('requisitos_concluidos', 'aguardando_revisao', 'apto_investidura')
      and public._classe_do_catalogo_oficial(mc.class_id)
  ), '[]'::json);
end;
$$;

-- ---------- 5) sino ----------
create or replace function public._workflow_avisar_mudanca() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_st_new record; v_st_old record; v_unit uuid; v_classe text; v_clube text; v_pessoa text; v_u record; v_d record;
begin
  if old.status <> 'em_andamento' then return new; end if;
  select cl.nome, split_part(coalesce(p.nome, ''), ' ', 1) into v_classe, v_pessoa
    from public.member_classes mc join public.classes cl on cl.id = mc.class_id left join public.profiles p on p.id = mc.usuario_id
   where mc.id = new.member_class_id;
  select nome into v_clube from public.organizational_units where id = new.club_id_origem;
  begin
    if new.status = 'em_andamento' and new.current_stage_ordem <> old.current_stage_ordem then
      select * into v_st_new from public.investiture_workflow_stages where workflow_id = new.workflow_id and ordem = new.current_stage_ordem;
      select * into v_st_old from public.investiture_workflow_stages where workflow_id = new.workflow_id and ordem = old.current_stage_ordem;
      if v_st_new.escopo_tipo <> 'clube' then
        v_unit := public.unidade_ancestral(new.club_id_origem, v_st_new.escopo_tipo);
        for v_u in select distinct m.user_id from public.organization_memberships m
                    where m.organizational_unit_id = v_unit and m.role = any (v_st_new.papeis_permitidos) and m.status = 'ativo'
                      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()) loop
          -- push sai na tela de bloqueio: sem nome de criança aqui (o nome aparece dentro do portal)
          insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
          values ('📌 Cartão de classe aguardando sua aprovação', left(coalesce(v_classe, 'Classe') || ' — ' || coalesce(v_clube, 'clube'), 240),
                  'investidura', '/institucional', 'todos', v_u.user_id, v_unit);
        end loop;
      end if;
      if v_st_old.escopo_tipo <> 'clube' then
        insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
        values ('✅ ' || v_st_old.nome || ': cartão aprovado',
                left(coalesce(v_classe, 'Classe') || ' de ' || coalesce(nullif(v_pessoa, ''), 'desbravador(a)') || ' — ' ||
                     case when v_st_new.chave = 'investidura' then 'apto à investidura.' else 'agora aguardando ' || lower(v_st_new.nome) || '.' end, 240),
                'investidura', '/investiduras', 'lideranca', new.club_id_origem);
      end if;
    elsif new.status = 'cancelado' then
      select * into v_d from public.workflow_stage_decisions where run_id = new.id order by ordem desc, decidido_em desc limit 1;
      if v_d.decisao = 'correcao_solicitada' and v_d.escopo_tipo <> 'clube' then
        insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
        values ('↩️ Cartão devolvido pela coordenação',
                left(coalesce(v_classe, 'Classe') || ' de ' || coalesce(nullif(v_pessoa, ''), 'desbravador(a)') || ': ' || coalesce(v_d.observacao, ''), 240),
                'investidura', '/investiduras', 'lideranca', new.club_id_origem);
      end if;
    end if;
  exception when others then
    raise warning 'aviso do fluxo de investidura não enviado: %', sqlerrm;  -- o aviso nunca derruba a decisão
  end;
  return new;
end;
$$;
revoke all on function public._workflow_avisar_mudanca() from public, anon, authenticated;
drop trigger if exists trg_workflow_avisar_mudanca on public.investiture_workflow_runs;
create trigger trg_workflow_avisar_mudanca after update of current_stage_ordem, status on public.investiture_workflow_runs
for each row execute function public._workflow_avisar_mudanca();

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-fluxo-investidura-distrito-regiao.sql')
on conflict (arquivo) do update set aplicada_em = now();
