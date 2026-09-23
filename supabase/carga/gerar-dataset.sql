-- =====================================================================
-- Fase 8 — DATASET SINTÉTICO para medição de capacidade.
--
-- Regras que este arquivo cumpre, de propósito:
--   * DETERMINÍSTICO: tudo deriva de `setseed` + um contador. Rodar duas vezes no mesmo banco
--     produz exatamente os mesmos ids, nomes e volumes.
--   * DESCARTÁVEL: tudo nasce marcado (`slug` começa com 'carga-', `profiles.teste = true`) e sai
--     com `\i limpar-dataset.sql`. Nada se mistura com o Tenant 001 nem com o Tenant 002.
--   * SEM DADO PESSOAL REAL: nomes vêm de listas fixas + número; e-mails em @carga.local (domínio
--     reservado, não roteável); nenhuma data de nascimento real, nenhuma foto, nenhum texto de gente.
--   * NUNCA EM PRODUÇÃO: a primeira coisa que ele faz é recusar rodar se o banco não for de teste.
--
-- Volume padrão (parametrizável logo abaixo):
--   100 clubes · ~50 membros por clube (5.000 pessoas) · 12 unidades por clube
--   ~250k lançamentos de pontos · 100k mensagens de chat · 30k fotos
--   matrículas de classe + requisitos, experiências + participações + evidências, notificações
-- =====================================================================
\set ON_ERROR_STOP on

do $$
begin
  -- trava de segurança: só roda em banco de teste/local
  if current_database() in ('postgres') and exists (select 1 from pg_settings where name = 'cluster_name' and setting like '%prod%') then
    raise exception 'Recuso rodar: este banco parece ser de produção.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- IDEMPOTÊNCIA DE VERDADE: limpa antes de gerar.
-- Descoberto na primeira execução: `on conflict do nothing` só protege tabela com chave natural —
-- pontos, chat, fotos e notificações não têm, então uma segunda rodada TRIPLICAVA o volume e
-- invalidava a comparação antes/depois. Gerar sempre começa do zero.
-- ---------------------------------------------------------------------
\i /tmp/carga/limpar-dataset.sql

-- ---------------------------------------------------------------------
-- parâmetros (mude aqui para gerar mais ou menos)
-- ---------------------------------------------------------------------
create table if not exists public._carga_param (chave text primary key, valor int not null);
truncate public._carga_param;
insert into public._carga_param values
  ('clubes', 100),
  ('membros_por_clube', 50),
  ('unidades_por_clube', 12),
  ('pontos_por_membro', 50),
  ('mensagens_por_clube', 1000),
  ('fotos_por_clube', 300),
  ('notificacoes_por_clube', 200);

do $$
declare
  v_clubes int := (select valor from public._carga_param where chave = 'clubes');
  v_membros int := (select valor from public._carga_param where chave = 'membros_por_clube');
  v_unidades int := (select valor from public._carga_param where chave = 'unidades_por_clube');
  v_pontos int := (select valor from public._carga_param where chave = 'pontos_por_membro');
  v_msgs int := (select valor from public._carga_param where chave = 'mensagens_por_clube');
  v_fotos int := (select valor from public._carga_param where chave = 'fotos_por_clube');
  v_notifs int := (select valor from public._carga_param where chave = 'notificacoes_por_clube');
  v_t0 timestamptz := clock_timestamp();
begin
  perform setseed(0.42);   -- determinismo

  -- gatilhos de produto ficam de fora: isto é semeadura de plataforma, não uso do app
  set local session_replication_role = replica;

  raise notice '[carga] clubes...';
  insert into public.organizational_units (id, type, nome, slug, pais, timezone, metadata)
  select md5('carga:clube:' || i)::uuid, 'clube', 'Clube Carga ' || i, 'carga-clube-' || i, 'BR', 'America/Recife',
         '{"carga":true}'::jsonb
  from generate_series(1, v_clubes) i
  on conflict (id) do nothing;

  raise notice '[carga] unidades...';
  insert into public.unidades (id, nome, cor, club_id)
  select md5('carga:unid:' || c || ':' || u)::uuid, 'Unidade ' || u, '#3b5bfd', md5('carga:clube:' || c)::uuid
  from generate_series(1, v_clubes) c, generate_series(1, v_unidades) u
  on conflict (id) do nothing;

  raise notice '[carga] pessoas (auth + perfil + vinculo)...';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, phone_change, phone_change_token, email_change_token_current,
    reauthentication_token, is_sso_user, is_anonymous)
  select '00000000-0000-0000-0000-000000000000', md5('carga:user:' || c || ':' || m)::uuid,
    'authenticated', 'authenticated', 'carga-' || c || '-' || m || '@carga.local',
    '$2a$10$abcdefghijklmnopqrstuv',   -- hash fixo e inválido: ninguém loga com isto
    now(), '{}'::jsonb, '{"carga":true}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false
  from generate_series(1, v_clubes) c, generate_series(1, v_membros) m
  on conflict (id) do nothing;

  insert into public.profiles (id, nome, papel, status, unidade_id, teste)
  select md5('carga:user:' || c || ':' || m)::uuid,
    (array['Ana','Bruno','Carla','Davi','Elisa','Felipe','Gabi','Hugo','Ines','Joao'])[1 + (m % 10)] || ' ' ||
    (array['Silva','Souza','Lima','Costa','Alves','Rocha','Dias','Melo'])[1 + (m % 8)] || ' ' || c || m,
    case when m <= 2 then 'diretoria' when m <= 4 then 'instrutor' when m <= 6 then 'conselheiro' else 'desbravador' end,
    'ativo', md5('carga:unid:' || c || ':' || (1 + (m % v_unidades)))::uuid, true
  from generate_series(1, v_clubes) c, generate_series(1, v_membros) m
  on conflict (id) do nothing;

  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, unidade_id, starts_at, created_at)
  select md5('carga:user:' || c || ':' || m)::uuid, md5('carga:clube:' || c)::uuid,
    case when m <= 2 then 'diretoria' when m <= 4 then 'instrutor' when m <= 6 then 'conselheiro' else 'desbravador' end,
    'ativo', md5('carga:unid:' || c || ':' || (1 + (m % v_unidades)))::uuid, now() - interval '1 year', now() - interval '1 year'
  from generate_series(1, v_clubes) c, generate_series(1, v_membros) m
  on conflict do nothing;

  -- pessoa em DOIS clubes: 1 a cada 10 também participa do clube seguinte (cenário multi-clube real)
  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, unidade_id, starts_at, created_at)
  select md5('carga:user:' || c || ':' || m)::uuid, md5('carga:clube:' || (1 + (c % v_clubes)))::uuid,
    'conselheiro', 'ativo', null, now() - interval '6 months', now() - interval '6 months'
  from generate_series(1, v_clubes) c, generate_series(1, v_membros) m
  where m % 10 = 0
  on conflict do nothing;

  raise notice '[carga] config e temporadas...';
  insert into public.config_clube (club_id, chave, valor)
  select md5('carga:clube:' || c)::uuid, k, ''
  from generate_series(1, v_clubes) c,
       unnest(array['pix','reflexo_so_desbravador','jogo_da_semana','rodizio_jogos','exigir_partida','chefao_ativo']) k
  on conflict (club_id, chave) do nothing;

  insert into public.temporadas (club_id, numero, inicio)
  select md5('carga:clube:' || c)::uuid, 1, now() - interval '1 year'
  from generate_series(1, v_clubes) c
  where not exists (select 1 from public.temporadas t where t.club_id = md5('carga:clube:' || c)::uuid);

  raise notice '[carga] pontos (o maior volume)...';
  insert into public.pontos (usuario_id, unidade_id, origem, pontos, motivo, data, club_id)
  select md5('carga:user:' || c || ':' || m)::uuid, null, 'manual', 1 + (p % 20),
    'carga ' || p, now() - make_interval(days => (p % 365)), md5('carga:clube:' || c)::uuid
  from generate_series(1, v_clubes) c, generate_series(1, v_membros) m, generate_series(1, v_pontos) p;

  raise notice '[carga] chat...';
  insert into public.chat_conversas (id, club_id, tipo)
  select md5('carga:conv:' || c)::uuid, md5('carga:clube:' || c)::uuid, 'geral'
  from generate_series(1, v_clubes) c
  on conflict do nothing;

  insert into public.chat_mensagens (conversa_id, autor_id, texto, club_id, created_at)
  select md5('carga:conv:' || c)::uuid, md5('carga:user:' || c || ':' || (1 + (n % v_membros)))::uuid,
    'mensagem de carga ' || n, md5('carga:clube:' || c)::uuid, now() - make_interval(hours => (n % 8760))
  from generate_series(1, v_clubes) c, generate_series(1, v_msgs) n;

  raise notice '[carga] fotos...';
  insert into public.fotos (url, thumb, legenda, autor_id, club_id, created_at)
  select 'mural/carga-' || c || '-' || f || '.jpg', 'mural/carga-' || c || '-' || f || '-t.jpg',
    'foto de carga', md5('carga:user:' || c || ':' || (1 + (f % v_membros)))::uuid,
    md5('carga:clube:' || c)::uuid, now() - make_interval(days => (f % 365))
  from generate_series(1, v_clubes) c, generate_series(1, v_fotos) f;

  raise notice '[carga] notificacoes...';
  insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id, created_at)
  select 'Aviso de carga ' || n, 'corpo do aviso', 'geral', '/', 'todos',
    md5('carga:clube:' || c)::uuid, now() - make_interval(days => (n % 180))
  from generate_series(1, v_clubes) c, generate_series(1, v_notifs) n;

  raise notice '[carga] pronto em % s', round(extract(epoch from clock_timestamp() - v_t0));
  set local session_replication_role = origin;
end $$;

-- ---------------------------------------------------------------------
-- Currículo e experiências: volume menor, mas é o que a Home consulta.
-- ---------------------------------------------------------------------
do $$
declare
  v_clubes int := (select valor from public._carga_param where chave = 'clubes');
  v_membros int := (select valor from public._carga_param where chave = 'membros_por_clube');
  v_classe uuid;
begin
  set local session_replication_role = replica;
  select c.id into v_classe from public.classes c
    join public.curriculum_versions v on v.id = c.curriculum_version_id
   where v.status = 'publicado' and v.origem = 'oficial' order by c.ordem limit 1;
  if v_classe is null then raise notice '[carga] sem catalogo curricular publicado; pulando classes'; return; end if;

  raise notice '[carga] matriculas de classe...';
  insert into public.member_classes (id, usuario_id, club_id, class_id, status, iniciada_em)
  select md5('carga:mc:' || c || ':' || m)::uuid, md5('carga:user:' || c || ':' || m)::uuid,
         md5('carga:clube:' || c)::uuid, v_classe, 'em_andamento', now() - interval '3 months'
  from generate_series(1, v_clubes) c, generate_series(7, v_membros) m   -- só desbravadores
  on conflict (id) do nothing;

  raise notice '[carga] requisitos...';
  insert into public.member_requirements (member_class_id, requirement_id, usuario_id, club_id, status, updated_at)
  select md5('carga:mc:' || c || ':' || m)::uuid, r.id, md5('carga:user:' || c || ':' || m)::uuid,
         md5('carga:clube:' || c)::uuid,
         (array['nao_iniciado','em_andamento','aguardando_avaliacao','aprovado','correcao_solicitada'])[1 + ((m + r.ordem) % 5)],
         now() - make_interval(days => ((m + r.ordem) % 60))
  from generate_series(1, v_clubes) c, generate_series(7, v_membros) m,
       (select cr.id, cr.ordem from public.class_requirements cr
         join public.class_sections cs on cs.id = cr.section_id
        where cs.class_id = (select cl.id from public.classes cl
                             join public.curriculum_versions cv on cv.id = cl.curriculum_version_id
                             where cv.status='publicado' and cv.origem='oficial' order by cl.ordem limit 1)
        limit 25) r
  on conflict do nothing;

  set local session_replication_role = origin;
end $$;

-- ---------------------------------------------------------------------
-- Experiências (fase 6): o recurso nasce desligado; aqui ligamos SÓ nos clubes de carga.
-- ---------------------------------------------------------------------
do $$
declare
  v_clubes int := (select valor from public._carga_param where chave = 'clubes');
  v_membros int := (select valor from public._carga_param where chave = 'membros_por_clube');
begin
  set local session_replication_role = replica;

  insert into public.club_features (club_id, feature, enabled)
  select md5('carga:clube:' || c)::uuid, f, true
  from generate_series(1, v_clubes) c, unnest(array['experiencias','classes']) f
  on conflict (club_id, feature) do update set enabled = true;

  raise notice '[carga] experiencias...';
  insert into public.experiences (id, club_id, tipo, alvo, titulo, descricao, status, publicado_em,
                                  inicio, fim, regra_conclusao, recompensa)
  select md5('carga:exp:' || c || ':' || e)::uuid, md5('carga:clube:' || c)::uuid,
         'desafio_individual', 'individual', 'Experiencia de carga ' || e, 'gerada para medicao',
         'publicada', now() - interval '10 days', now() - interval '10 days', now() + interval '20 days',
         '{"tipo":"todas_etapas"}'::jsonb, '{"tipo":"pontos","valor":10}'::jsonb
  from generate_series(1, v_clubes) c, generate_series(1, 5) e
  on conflict (id) do nothing;

  insert into public.experience_stages (id, club_id, experience_id, ordem, titulo, evidencia, regra)
  select md5('carga:etapa:' || c || ':' || e)::uuid, md5('carga:clube:' || c)::uuid,
         md5('carga:exp:' || c || ':' || e)::uuid, 1, 'Etapa unica', 'confirmacao', '{}'::jsonb
  from generate_series(1, v_clubes) c, generate_series(1, 5) e
  on conflict (id) do nothing;

  insert into public.experience_audiences (club_id, experience_id, tipo)
  select md5('carga:clube:' || c)::uuid, md5('carga:exp:' || c || ':' || e)::uuid, 'todos'
  from generate_series(1, v_clubes) c, generate_series(1, 5) e
  on conflict do nothing;

  raise notice '[carga] participacoes e evidencias...';
  insert into public.experience_participations (id, club_id, experience_id, usuario_id, status)
  select md5('carga:part:' || c || ':' || e || ':' || m)::uuid, md5('carga:clube:' || c)::uuid,
         md5('carga:exp:' || c || ':' || e)::uuid, md5('carga:user:' || c || ':' || m)::uuid,
         case when m % 3 = 0 then 'concluida' else 'em_andamento' end
  from generate_series(1, v_clubes) c, generate_series(1, 5) e, generate_series(7, v_membros) m
  where m % 2 = 0
  on conflict do nothing;

  insert into public.experience_submissions (club_id, experience_id, participation_id, stage_id, usuario_id, status)
  select md5('carga:clube:' || c)::uuid, md5('carga:exp:' || c || ':' || e)::uuid,
         md5('carga:part:' || c || ':' || e || ':' || m)::uuid, md5('carga:etapa:' || c || ':' || e)::uuid,
         md5('carga:user:' || c || ':' || m)::uuid,
         case when m % 3 = 0 then 'aprovada' else 'enviada' end
  from generate_series(1, v_clubes) c, generate_series(1, 5) e, generate_series(7, v_membros) m
  where m % 2 = 0
  on conflict do nothing;

  set local session_replication_role = origin;
end $$;

analyze;

-- ---------------------------------------------------------------------
-- Resumo do que foi gerado
-- ---------------------------------------------------------------------
select 'clubes' t, count(*) n from public.organizational_units where slug like 'carga-%'
union all select 'pessoas', count(*) from public.profiles where teste and id in (select user_id from public.organization_memberships m join public.organizational_units o on o.id = m.organizational_unit_id where o.slug like 'carga-%')
union all select 'vinculos', count(*) from public.organization_memberships m join public.organizational_units o on o.id = m.organizational_unit_id where o.slug like 'carga-%'
union all select 'pontos', count(*) from public.pontos p join public.organizational_units o on o.id = p.club_id where o.slug like 'carga-%'
union all select 'chat', count(*) from public.chat_mensagens x join public.organizational_units o on o.id = x.club_id where o.slug like 'carga-%'
union all select 'fotos', count(*) from public.fotos f join public.organizational_units o on o.id = f.club_id where o.slug like 'carga-%'
union all select 'notificacoes', count(*) from public.notificacoes nf join public.organizational_units o on o.id = nf.club_id where o.slug like 'carga-%'
union all select 'member_requirements', count(*) from public.member_requirements mr join public.organizational_units o on o.id = mr.club_id where o.slug like 'carga-%'
union all select 'experiencias', count(*) from public.experiences e join public.organizational_units o on o.id = e.club_id where o.slug like 'carga-%'
union all select 'evidencias', count(*) from public.experience_submissions s join public.organizational_units o on o.id = s.club_id where o.slug like 'carga-%'
order by 1;
