-- =====================================================================
--  Capacidades explícitas por papel — o que o INSTRUTOR pode (2026-09-26)
--
--  DECISÃO DO DONO (26/09): o papel 'instrutor' (Instrutor(a) e Capelão/Capelã, ver migration 200)
--  AVALIA Classes e Especialidades (requisitos, fila unificada, revisão/investidura, documentos) e
--  GERE atividades (desafios, missões, experiências, entregas). NÃO aprova cadastros/inscrições,
--  NÃO convida equipe, NÃO muda papel/unidade/status de membro, NÃO redefine senha, NÃO mexe em
--  configuração/identidade/recursos/suporte do clube nem em vínculos de responsáveis.
--  Aprovar membros é SÓ da diretoria (Diretor(a), Associado(a), Secretário(a) = papel 'diretoria').
--
--  Antes, uma função só — public.pode_gerir_no_clube(club) = diretoria|instrutor — guardava tudo.
--  Agora há capacidades com nome:
--    pode_administrar_clube(club)  = diretoria                 (pessoas, equipe, config, responsáveis)
--    pode_avaliar_curriculo(club)  = diretoria | instrutor     (Classes e Especialidades)
--    pode_gerir_atividades(club)   = diretoria | instrutor     (desafios, missões, experiências, entregas)
--    pode_gerir_no_clube(club)     = diretoria | instrutor     (continua: "liderança" — leitura de dados
--                                  do clube, moderação, jogos, leilão, avisos, pontos; nada disso mudou)
--    pode_financeiro_no_clube      = tesoureiro | diretoria    (intocado)
--
--  COMO: as funções/políticas NÃO são recopiadas aqui. Um bloco lê a definição VIVA de cada uma
--  (pg_get_functiondef / pg_policies) e troca só a chamada de capacidade. Assim nada que outra
--  migration anterior tenha mudado no corpo é perdido, e cada troca é conferida (se o texto
--  esperado não estiver lá, a migration FALHA em vez de passar calada).
--  Só APERTA: nenhuma capacidade de ninguém foi ampliada. Idempotente (rodar 2x não quebra).
--  Não altera dados.
-- =====================================================================

-- ---------- 1) capacidades ----------
create or replace function public.pode_administrar_clube(p_club_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
     where m.user_id = auth.uid() and m.organizational_unit_id = p_club_id
       and m.role = 'diretoria' and m.status = 'ativo'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()));
$$;

create or replace function public.pode_avaliar_curriculo(p_club_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
     where m.user_id = auth.uid() and m.organizational_unit_id = p_club_id
       and m.role in ('diretoria', 'instrutor') and m.status = 'ativo'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()));
$$;

create or replace function public.pode_gerir_atividades(p_club_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
     where m.user_id = auth.uid() and m.organizational_unit_id = p_club_id
       and m.role in ('diretoria', 'instrutor') and m.status = 'ativo'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()));
$$;

revoke all on function public.pode_administrar_clube(uuid) from public, anon;
revoke all on function public.pode_avaliar_curriculo(uuid) from public, anon;
revoke all on function public.pode_gerir_atividades(uuid) from public, anon;
grant execute on function public.pode_administrar_clube(uuid) to authenticated, service_role;
grant execute on function public.pode_avaliar_curriculo(uuid) to authenticated, service_role;
grant execute on function public.pode_gerir_atividades(uuid) to authenticated, service_role;

comment on function public.pode_administrar_clube(uuid) is 'Capacidade: administrar o clube (aprovar membros, equipe, papéis, senha, config, responsáveis). Só diretoria.';
comment on function public.pode_avaliar_curriculo(uuid) is 'Capacidade: avaliar Classes e Especialidades. Diretoria e instrutor.';
comment on function public.pode_gerir_atividades(uuid) is 'Capacidade: criar/editar/aprovar desafios, missões, experiências e entregas. Diretoria e instrutor.';
comment on function public.pode_gerir_no_clube(uuid) is 'Liderança do clube (diretoria|instrutor): leitura de dados do clube, moderação, jogos, avisos, pontos. Para administrar use pode_administrar_clube.';

-- ---------- 2) utilitários da troca (temporários) ----------
create or replace function pg_temp.trocar_fn(p_fn regprocedure, p_de text, p_para text, p_msg boolean default false, p_marca text default null)
returns void language plpgsql as $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef(p_fn);
  v_novo := regexp_replace(v_def, p_de, p_para, 'g');
  if p_msg then
    v_novo := replace(v_novo, 'apenas diretoria/instrutor', 'apenas a diretoria');
    v_novo := replace(v_novo, 'Sem permissão (apenas a liderança do clube).', 'Sem permissão (apenas a diretoria do clube).');
  end if;
  if v_novo = v_def then
    -- já trocada numa rodada anterior? então o destino tem de estar lá
    if position(coalesce(p_marca, split_part(p_para, '(', 1)) in v_def) = 0 then
      raise exception 'capacidades: % não tem "%" para trocar', p_fn, p_de;
    end if;
    return;
  end if;
  execute v_novo;
end $$;

create or replace function pg_temp.trocar_pol(p_tab text, p_pol text, p_de text, p_para text)
returns void language plpgsql as $$
declare v record; v_sql text;
begin
  select * into v from pg_policies where schemaname = 'public' and tablename = p_tab and policyname = p_pol;
  if not found then raise exception 'capacidades: política "%" em % não existe', p_pol, p_tab; end if;
  if coalesce(v.qual, '') !~ p_de and coalesce(v.with_check, '') !~ p_de then
    if coalesce(v.qual, '') || coalesce(v.with_check, '') !~ split_part(p_para, '(', 1) then
      raise exception 'capacidades: política "%" em % não usa "%"', p_pol, p_tab, p_de;
    end if;
    return;
  end if;
  v_sql := format('alter policy %I on public.%I', p_pol, p_tab);
  if v.qual is not null then v_sql := v_sql || ' using (' || regexp_replace(v.qual, p_de, p_para, 'g') || ')'; end if;
  if v.with_check is not null then v_sql := v_sql || ' with check (' || regexp_replace(v.with_check, p_de, p_para, 'g') || ')'; end if;
  execute v_sql;
end $$;

-- ---------- 3) APERTA: vira só da diretoria ----------
do $$
declare f text;
begin
  foreach f in array array[
    -- entrada de membros (código/QR/link) e aprovação de cadastros
    'public.clube_codigo_atual()', 'public.clube_codigo_gerar(integer,text)', 'public.clube_codigo_revogar()',
    'public.entradas_pendentes()',
    -- papel / status (aprovar, desativar) / unidade do membro; senha
    'public.vinculo_gerir(uuid,text,text,uuid,boolean)', 'public.resetar_senha_membro(uuid,text)',
    'public.unidade_excluir(uuid)',
    -- equipe
    'public.convite_equipe_criar(text,text,text)', 'public.convite_equipe_revogar(uuid)', 'public.convites_do_clube()',
    -- responsáveis (vínculos, convites, consentimento)
    'public.vinculos_pendentes()', 'public.criar_convite_responsavel()', 'public.listar_convites_responsavel()',
    'public.revogar_convite_responsavel(uuid)', 'public.consentimento_revogar(uuid,text)',
    -- configuração, identidade, recursos, acesso de suporte
    'public.config_gravar(jsonb)', 'public.clube_marca_gravar(jsonb)', 'public.recurso_definir(text,boolean)',
    'public.suporte_autorizar(uuid,integer)', 'public.suporte_revogar(uuid,text)'
  ] loop
    perform pg_temp.trocar_fn(f::regprocedure, 'public\.pode_gerir_no_clube\(', 'public.pode_administrar_clube(', true);
  end loop;

  -- contadores de "cadastros a aprovar": o instrutor não vê mais um aviso que não pode resolver
  perform pg_temp.trocar_fn('public.meu_inicio()'::regprocedure,
    '(organization_memberships\s+where\s+organizational_unit_id\s*=\s*v_club\s+and\s+status\s*=\s*''pendente'')(\s*;)',
    '\1 and public.pode_administrar_clube(v_club)\2', false, 'pode_administrar_clube(v_club)');
  perform pg_temp.trocar_fn('public.avaliacoes_pendentes()'::regprocedure,
    '(organization_memberships\s+where\s+organizational_unit_id\s*=\s*v_club\s+and\s+status\s*=\s*''pendente'')(\s*\))',
    '\1 and public.pode_administrar_clube(v_club)\2', false, 'pode_administrar_clube(v_club)');
end $$;

select pg_temp.trocar_pol('config_clube', 'lideranca grava config do proprio clube', 'pode_gerir_no_clube\(', 'pode_administrar_clube(');
select pg_temp.trocar_pol('club_features', 'lideranca gere recursos do proprio clube', 'pode_gerir_no_clube\(', 'pode_administrar_clube(');
select pg_temp.trocar_pol('club_team_invites', 'gestao le convites do proprio clube', 'pode_gerir_no_clube\(', 'pode_administrar_clube(');
select pg_temp.trocar_pol('club_team_invites', 'lideranca do clube', 'pode_gerir_no_clube\(', 'pode_administrar_clube(');
select pg_temp.trocar_pol('responsaveis', 'apagar responsaveis', 'pode_gerir_no_clube\(', 'pode_administrar_clube(');

-- unidades: criar/editar identidade segue com a liderança; APAGAR (que tira a unidade dos membros)
-- passa a ser só da diretoria, igual à RPC unidade_excluir.
do $$
declare v record;
begin
  select * into v from pg_policies where schemaname = 'public' and tablename = 'unidades'
     and policyname = 'lideranca gere unidades do proprio clube';
  if found and v.cmd = 'ALL' then
    execute 'drop policy "lideranca gere unidades do proprio clube" on public.unidades';
    execute format('create policy "lideranca cria unidades do proprio clube" on public.unidades for insert to authenticated with check (%s)', v.with_check);
    execute format('create policy "lideranca edita unidades do proprio clube" on public.unidades for update to authenticated using (%s) with check (%s)', v.qual, v.with_check);
    execute format('create policy "lideranca le unidades do proprio clube" on public.unidades for select to authenticated using (%s)', v.qual);
    execute format('create policy "diretoria apaga unidades do proprio clube" on public.unidades for delete to authenticated using (%s)',
                   regexp_replace(v.qual, 'pode_gerir_no_clube\(', 'pode_administrar_clube(', 'g'));
  end if;
end $$;

-- ---------- 4) NOMEIA (mesmo alcance de antes): Classes e Especialidades ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public._pode_avaliar_especialidade(uuid,uuid)', 'public._pode_ver_conquista_curricular(uuid,uuid)',
    'public.classe_atribuir(uuid,uuid)', 'public.classe_avaliacoes_pendentes()', 'public.classe_revisao_solicitar(uuid)',
    'public.classe_revisoes_pendentes()', 'public.curriculum_achievement_revogar(uuid,text)',
    'public.documento_assinatura_revogar(uuid,text)', 'public.documento_emitir(uuid,text)',
    'public.documento_revisar(text,text,text,text)', 'public.documentos_do_clube()',
    'public.especialidade_atribuir(uuid,uuid,uuid)', 'public.explicar_requisito_classe(uuid)',
    'public.explicar_requisito_especialidade(uuid)', 'public.fila_avaliacao_unificada(text,uuid)',
    'public.investidura_registrar(uuid,date,text)',
    'public.oferta_especialidade_criar(uuid,text,uuid,date,date)', 'public.ofertas_especialidade_do_clube()',
    'public.requisito_avaliar(uuid,text,text,uuid)', 'public.requisito_historico(uuid)',
    'public.revisao_final_decidir(uuid,text,text,uuid[])', 'public.snapshot_revogar(uuid,text)'
  ] loop
    perform pg_temp.trocar_fn(f::regprocedure, 'public\.pode_gerir_no_clube\(', 'public.pode_avaliar_curriculo(');
  end loop;

  -- desafios, missões, experiências, entregas
  foreach f in array array[
    'public.avaliar_missao(uuid,boolean)', 'public.missoes_pendentes()', 'public.aprovar_entrega(uuid)',
    'public._pode_ver_experiencia(uuid)', 'public.experiencia_avaliar(uuid,text,text)',
    'public.experiencia_concluir_manual(uuid)', 'public.experiencia_detalhe(uuid)',
    'public.experiencia_do_template(text,integer)', 'public.experiencia_estado(uuid,text)',
    'public.experiencia_etapa_salvar(uuid,uuid,jsonb)', 'public.experiencia_nova_versao(uuid)',
    'public.experiencia_publico_definir(uuid,jsonb)', 'public.experiencia_salvar(uuid,jsonb)',
    'public.experiencias_do_clube(boolean)', 'public.experiencias_pendentes_de_validacao()'
  ] loop
    perform pg_temp.trocar_fn(f::regprocedure, 'public\.pode_gerir_no_clube\(', 'public.pode_gerir_atividades(');
  end loop;
end $$;

select pg_temp.trocar_pol(t, p, 'pode_gerir_no_clube\(', 'pode_avaliar_curriculo(') from (values
  ('member_classes', 'dono ou lideranca do clube'), ('member_requirement_options', 'dono ou lideranca do clube'),
  ('member_requirements', 'dono ou lideranca do clube'), ('member_specialties', 'dono ou lideranca do clube'),
  ('member_specialty_requirements', 'dono ou lideranca do clube'), ('requirement_approvals', 'dono ou lideranca do clube'),
  ('requirement_submissions', 'dono ou lideranca do clube le submissoes'), ('investiture_reviews', 'dono ou lideranca do clube'),
  ('class_completion_events', 'dono ou lideranca do clube'), ('specialty_offerings', 'membro do clube le, lideranca gere')
) as x(t, p);

select pg_temp.trocar_pol(t, p, 'pode_gerir_no_clube\(', 'pode_gerir_atividades(') from (values
  ('desafios', 'lideranca gere o conteudo de desafios do proprio clube'), ('desafios_unidade', 'lideranca gere desafios do proprio clube'),
  ('atividades', 'lideranca gere atividades do proprio clube'), ('entregas', 'lideranca avalia entrega do proprio clube'),
  ('entregas', 'lideranca apaga entrega do proprio clube'), ('entregas', 'participante le entrega do proprio clube'),
  ('missoes_feitas', 'membro le as proprias missoes ou lideranca do clube'),
  ('experiences', 'publicada pro publico, tudo pra lideranca'), ('experience_audiences', 'publico so pra lideranca'),
  ('experience_events', 'lideranca le a auditoria'), ('experience_participations', 'a propria participacao, a da minha unidade, ou a lideranca'),
  ('experience_reports', 'lideranca le denuncias, autor le a propria'),
  ('experience_submissions', 'evidencia e do autor, da unidade e da lideranca deste clube')
) as x(t, p);

notify pgrst, 'reload schema';
