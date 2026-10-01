-- =============================================================================
--  Fase 9 — GC (coleta de lixo) SEGURO do Storage: CATÁLOGO + RELATÓRIO. SOMENTE LEITURA.
--
--  Esta migration é ADITIVA e NÃO apaga nada: só funções. Não cria tabela (nada para guardar). A
--  remoção de arquivo NÃO existe aqui nem em lugar nenhum do repositório nesta fase; quando existir,
--  será pela API do Storage (nunca por SQL — ver STORAGE-GC-DESENHO.md e STORAGE-GC-IMPLEMENTACAO.md).
--
--  O que entrega:
--   1. Catálogo VERSIONADO de "quem referencia arquivo do Storage" — _storage_referencias() — mais a
--      lista de exceções JUSTIFICADAS — _storage_referencias_excecoes(). O teste 135 varre o schema e
--      FALHA se aparecer coluna com nome de caminho/foto/arquivo... fora das duas listas: coluna nova
--      que guarda caminho obriga a atualizar o catálogo (senão o GC trataria o arquivo dela como órfão).
--   2. Inventário por objeto — _storage_gc_inventario(p_dias) — com a CATEGORIA de cada arquivo e o
--      relatório para o admin da plataforma — admin_storage_gc_relatorio — SEM dados pessoais:
--      contagens, buckets, bytes e caminhos mascarados (UUID cortado em 8 caracteres, nome do arquivo
--      sumido, só a extensão).
--
--  Categorias (as mesmas, com a mesma regra, em src/lib/storageGc.js — que é o que o script
--  scripts/storage-gc-dryrun.mjs usa; o script confere as duas e acusa divergência):
--    candidatas (o que SERIA removido numa fase futura, autorizada à parte):
--      orfao                            nenhuma tabela referencia; fora dos buckets protegidos; >= carência
--      clube_expurgado                  prefixo <club_id>/ de clube EXPURGADO (a 280 só apaga a linha)
--      conclusao_anterior_sem_registro  pasta <club>/<membro>/conclusao-anterior/ sem curriculum_achievements
--    NUNCA candidatas:
--      referenciado | em_fila_de_remocao (outra rotina cuida) | protegido_bucket (documentos-emitidos,
--      assinaturas-desenhadas, publico, parceiros) | clube_na_lixeira (recuperável) | recente (< carência;
--      mínimo 7 dias, sempre) | sem_data (listagem sem data de criação) | bucket_fora_do_escopo (bucket que
--      ninguém decidiu: falha fechada)
--
--  Só admin da plataforma executa o relatório. Nada é gravado, nem auditoria: é leitura pura.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Constantes de política (uma função, para o teste e o relatório citarem a mesma lista)
-- ---------------------------------------------------------------------------
create or replace function public._storage_gc_politica() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'carencia_minima_dias', 7,
    -- buckets onde o GC olha: todas as referências deles estão catalogadas
    'buckets_no_escopo', jsonb_build_array('comprovacoes', 'imagens', 'comunidade', 'suporte-anexos'),
    -- buckets NUNCA candidatos (documento emitido, assinatura, marca pública)
    'buckets_protegidos', jsonb_build_array('documentos-emitidos', 'assinaturas-desenhadas', 'publico', 'parceiros'),
    'categorias_candidatas', jsonb_build_array('orfao', 'clube_expurgado', 'conclusao_anterior_sem_registro')
  );
$$;
revoke all on function public._storage_gc_politica() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Normalização: valor guardado no banco -> 'bucket/caminho'
--    * URL do Storage (…/storage/v1/object/(public|sign|authenticated)/<bucket>/<caminho>[?token]) -> 'bucket/caminho'
--    * caminho puro -> '<bucket do catálogo>/<caminho>'
--    * URL externa, link interno do app (/icon-192.png), vazio -> null (não aponta para o Storage)
-- ---------------------------------------------------------------------------
create or replace function public._storage_ref_chave(p_ref text, p_bucket text) returns text
language sql immutable set search_path = '' as $$
  select case
    when nullif(btrim(coalesce(p_ref, '')), '') is null then null
    when p_ref ~* '/storage/v1/object/(public|sign|authenticated)/[^/]+/.+' then
      nullif(split_part(split_part(substring(p_ref from '(?i)/storage/v1/object/(?:public|sign|authenticated)/(.+)$'), '?', 1), '#', 1), '')
    when p_ref ~* '^[a-z][a-z0-9+.-]*:' then null
    when p_ref like '/%' then null
    when p_bucket is null then null
    else p_bucket || '/' || btrim(p_ref)
  end;
$$;
revoke all on function public._storage_ref_chave(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. O CATÁLOGO. Uma linha por (tabela, forma de guardar o caminho).
--    forma = 'exato'  : `consulta` devolve (ref, esperada, bucket). ref é o valor guardado (caminho ou URL);
--                       esperada=false = a linha admite que o arquivo já foi apagado (não é referência quebrada);
--                       bucket (opcional) sobrepõe o bucket padrão da linha do catálogo.
--    forma = 'contem' : `consulta` devolve (blob). O arquivo conta como referenciado se o caminho aparece
--                       como texto dentro do blob (JSON de histórico, snapshot, rascunho...). Não gera "quebrada".
--    protecao = 'viva' | 'historico' (tabela imutável/histórico: o caminho é prova, nunca candidato) | 'fila_remocao'
--               (já está na fila de outra rotina de limpeza; não é referência de uso).
--    Ao criar coluna que guarda caminho/URL de arquivo: ACRESCENTE aqui (o teste 135 cobra).
-- ---------------------------------------------------------------------------
create or replace function public._storage_referencias()
returns table (id text, tabela text, colunas text[], forma text, bucket text, protecao text, consulta text, nota text)
language sql stable set search_path = '' as $$
  select * from (values
    -- ---- comprovações de requisito (bucket privado 'comprovacoes') ----
    ('member_requirements.evidencia_path', 'member_requirements', array['evidencia_path'], 'exato', 'comprovacoes', 'viva',
      $q$select evidencia_path, true, null::text from public.member_requirements where evidencia_path is not null$q$,
      'Foto/arquivo do requisito em andamento. Pode ser URL antiga do bucket imagens (legado).'),
    ('member_requirements.rascunho_anexos', 'member_requirements', array['rascunho_anexos'], 'exato', 'comprovacoes', 'viva',
      $q$select a ->> 'path', true, null::text from public.member_requirements m,
           jsonb_array_elements(case when jsonb_typeof(m.rascunho_anexos) = 'array' then m.rascunho_anexos else '[]'::jsonb end) a$q$,
      'Anexos do rascunho (lista de {path,...}).'),
    ('member_specialty_requirements.evidencia_path', 'member_specialty_requirements', array['evidencia_path'], 'exato', 'comprovacoes', 'viva',
      $q$select evidencia_path, true, null::text from public.member_specialty_requirements where evidencia_path is not null$q$, null),
    ('member_specialty_requirements.rascunho_anexos', 'member_specialty_requirements', array['rascunho_anexos'], 'exato', 'comprovacoes', 'viva',
      $q$select a ->> 'path', true, null::text from public.member_specialty_requirements m,
           jsonb_array_elements(case when jsonb_typeof(m.rascunho_anexos) = 'array' then m.rascunho_anexos else '[]'::jsonb end) a$q$, null),
    ('requirement_submissions.evidencia_path', 'requirement_submissions', array['evidencia_path'], 'exato', 'comprovacoes', 'historico',
      $q$select evidencia_path, true, null::text from public.requirement_submissions where evidencia_path is not null$q$,
      'Histórico IMUTÁVEL das tentativas: o arquivo é prova.'),
    ('requirement_submissions.anexos', 'requirement_submissions', array['anexos'], 'exato', 'comprovacoes', 'historico',
      $q$select a ->> 'path', true, null::text from public.requirement_submissions s,
           jsonb_array_elements(case when jsonb_typeof(s.anexos) = 'array' then s.anexos else '[]'::jsonb end) a$q$,
      'Histórico IMUTÁVEL (vários anexos por tentativa).'),
    ('specialty_requirement_submissions.evidencia_path', 'specialty_requirement_submissions', array['evidencia_path'], 'exato', 'comprovacoes', 'historico',
      $q$select evidencia_path, true, null::text from public.specialty_requirement_submissions where evidencia_path is not null$q$, null),
    ('specialty_requirement_submissions.anexos', 'specialty_requirement_submissions', array['anexos'], 'exato', 'comprovacoes', 'historico',
      $q$select a ->> 'path', true, null::text from public.specialty_requirement_submissions s,
           jsonb_array_elements(case when jsonb_typeof(s.anexos) = 'array' then s.anexos else '[]'::jsonb end) a$q$, null),
    ('comprovacoes_documento.evidencia_path', 'comprovacoes_documento', array['evidencia_path'], 'exato', 'comprovacoes', 'viva',
      $q$select evidencia_path, foto_apagada_em is null, null::text from public.comprovacoes_documento where evidencia_path is not null$q$,
      'Foto do documento da idade (380): apagada depois da aprovação; o caminho vira null.'),
    ('curriculum_achievements.comprovante_path', 'curriculum_achievements', array['comprovante_path'], 'exato', 'comprovacoes', 'historico',
      $q$select comprovante_path, true, null::text from public.curriculum_achievements where comprovante_path is not null$q$,
      'Comprovante de classe concluída anteriormente (521), pasta <club>/<membro>/conclusao-anterior/. Revogar não apaga o caminho.'),
    ('experience_submissions.arquivo_path', 'experience_submissions', array['arquivo_path'], 'exato', 'comprovacoes', 'viva',
      $q$select arquivo_path, true, null::text from public.experience_submissions where arquivo_path is not null$q$, null),
    ('entregas.foto_url', 'entregas', array['foto_url'], 'exato', 'comprovacoes', 'viva',
      $q$select foto_url, true, null::text from public.entregas where foto_url is not null$q$,
      'Caminho privado ou URL pública antiga (bucket imagens).'),
    ('missoes_feitas.foto_url', 'missoes_feitas', array['foto_url'], 'exato', 'comprovacoes', 'viva',
      $q$select foto_url, true, null::text from public.missoes_feitas where foto_url is not null$q$, null),
    ('devocional.foto_url', 'devocional', array['foto_url'], 'exato', 'comprovacoes', 'viva',
      $q$select foto_url, true, null::text from public.devocional where foto_url is not null$q$, null),
    -- ---- bucket 'imagens' (perfil, unidade, mural, experiência) ----
    ('profiles.foto', 'profiles', array['foto'], 'exato', 'imagens', 'viva',
      $q$select foto, true, null::text from public.profiles where foto is not null$q$,
      'Foto de perfil (URL do bucket imagens). Trocar a foto deixa a anterior órfã: é o órfão mais comum.'),
    ('unidades.emblema', 'unidades', array['emblema'], 'exato', 'imagens', 'viva',
      $q$select emblema, true, null::text from public.unidades where emblema is not null$q$, null),
    ('unidades.bandeira', 'unidades', array['bandeira'], 'exato', 'imagens', 'viva',
      $q$select bandeira, true, null::text from public.unidades where bandeira is not null$q$, null),
    ('fotos.url', 'fotos', array['url'], 'exato', 'imagens', 'viva',
      $q$select url, true, null::text from public.fotos where url is not null$q$, 'Mural.'),
    ('fotos.thumb', 'fotos', array['thumb'], 'exato', 'imagens', 'viva',
      $q$select thumb, true, null::text from public.fotos where thumb is not null$q$, 'Miniatura do mural.'),
    ('experiences.imagem_path', 'experiences', array['imagem_path'], 'exato', 'imagens', 'viva',
      $q$select imagem_path, true, null::text from public.experiences where imagem_path is not null$q$, null),
    ('profiles.avatar', 'profiles', array['avatar'], 'contem', null, 'viva',
      $q$select avatar::text from public.profiles where avatar is not null$q$,
      'Avatar em JSON (personagem ou foto). Busca por texto: não gera referência quebrada.'),
    -- ---- marca pública ----
    ('organizational_units.metadata', 'organizational_units', array['metadata'], 'exato', 'publico', 'viva',
      $q$select metadata #>> '{marca,logo_url}', true, null::text from public.organizational_units where metadata #>> '{marca,logo_url}' is not null$q$,
      'Logo do clube (bucket publico). Logo trocada deixa a antiga; bucket protegido: só relata.'),
    ('site_partners.logo_url', 'site_partners', array['logo_url'], 'exato', 'parceiros', 'viva',
      $q$select logo_url, true, null::text from public.site_partners where logo_url is not null$q$, null),
    -- ---- Rede / Comunidade ----
    ('comunidade_posts.foto_path', 'comunidade_posts', array['foto_path'], 'exato', 'comunidade', 'viva',
      $q$select foto_path, foto_apagada_em is null, null::text from public.comunidade_posts where foto_path is not null$q$,
      'Foto de post (vida útil de 90 dias; a Edge Function limpar-fotos-rede apaga).'),
    ('rede_stories.foto_path', 'rede_stories', array['foto_path'], 'exato', 'comunidade', 'viva',
      $q$select foto_path, foto_apagada_em is null, null::text from public.rede_stories where foto_path is not null$q$, null),
    ('rede_fotos_para_apagar.caminho', 'rede_fotos_para_apagar', array['caminho', 'bucket'], 'exato', 'comunidade', 'fila_remocao',
      $q$select caminho, true, bucket from public.rede_fotos_para_apagar where apagada_em is null$q$,
      'Fila da limpeza da Rede (472): essa rotina já cuida do arquivo; o GC não mexe.'),
    -- ---- suporte ----
    ('suporte_mensagens.anexo_path', 'suporte_mensagens', array['anexo_path'], 'exato', 'suporte-anexos', 'viva',
      $q$select anexo_path, true, null::text from public.suporte_mensagens where anexo_path is not null$q$, null),
    -- ---- documentos emitidos e assinaturas (buckets protegidos) ----
    ('class_documents.pdf_storage_path', 'class_documents', array['pdf_storage_path'], 'exato', 'documentos-emitidos', 'historico',
      $q$select pdf_storage_path, true, null::text from public.class_documents where pdf_storage_path is not null$q$, null),
    ('document_final_renders.storage_path', 'document_final_renders', array['storage_path'], 'exato', 'documentos-emitidos', 'historico',
      $q$select storage_path, true, null::text from public.document_final_renders where storage_path is not null$q$,
      'Representação final assinada (H2): histórico imutável.'),
    ('document_signatures.dados', 'document_signatures', array['dados'], 'exato', 'assinaturas-desenhadas', 'historico',
      $q$select dados ->> 'desenho_path', true, null::text from public.document_signatures where dados ->> 'desenho_path' is not null$q$,
      'Assinatura desenhada: histórico imutável.'),
    -- ---- leituras (catálogo global; normalmente URL externa => ignorada pela normalização) ----
    ('leitura_materiais.capa_url', 'leitura_materiais', array['capa_url'], 'exato', null, 'viva',
      $q$select capa_url, true, null::text from public.leitura_materiais where capa_url is not null$q$, 'Só conta se for URL do Storage.'),
    ('leitura_materiais.pdf_url', 'leitura_materiais', array['pdf_url'], 'exato', null, 'viva',
      $q$select pdf_url, true, null::text from public.leitura_materiais where pdf_url is not null$q$, null),
    ('leitura_materiais.audio_url', 'leitura_materiais', array['audio_url'], 'exato', null, 'viva',
      $q$select audio_url, true, null::text from public.leitura_materiais where audio_url is not null$q$, null),
    ('leitura_materiais.book_url', 'leitura_materiais', array['book_url'], 'exato', null, 'viva',
      $q$select book_url, true, null::text from public.leitura_materiais where book_url is not null$q$, null),
    -- ---- HISTÓRICO / JSON: caminho citado em texto conta como referência (prova) ----
    ('class_completion_snapshots.conteudo', 'class_completion_snapshots', array['conteudo'], 'contem', null, 'historico',
      $q$select conteudo::text from public.class_completion_snapshots$q$, 'Snapshot selado e imutável da conclusão.'),
    ('class_prior_completion_log.antes', 'class_prior_completion_log', array['antes'], 'contem', null, 'historico',
      $q$select antes::text from public.class_prior_completion_log where antes is not null$q$, 'Log append-only.'),
    ('class_prior_completion_log.depois', 'class_prior_completion_log', array['depois'], 'contem', null, 'historico',
      $q$select depois::text from public.class_prior_completion_log where depois is not null$q$, null),
    ('class_completion_events.dados', 'class_completion_events', array['dados'], 'contem', null, 'historico',
      $q$select dados::text from public.class_completion_events where dados is not null$q$, null),
    ('requirement_approvals.conteudo_avaliado', 'requirement_approvals', array['conteudo_avaliado'], 'contem', null, 'historico',
      $q$select conteudo_avaliado::text from public.requirement_approvals where conteudo_avaliado is not null$q$, null),
    ('requirement_submissions.conteudo', 'requirement_submissions', array['conteudo'], 'contem', null, 'historico',
      $q$select conteudo::text from public.requirement_submissions where conteudo is not null$q$, null),
    ('specialty_requirement_submissions.conteudo', 'specialty_requirement_submissions', array['conteudo'], 'contem', null, 'historico',
      $q$select conteudo::text from public.specialty_requirement_submissions where conteudo is not null$q$, null),
    ('member_requirements.rascunho', 'member_requirements', array['rascunho'], 'contem', null, 'viva',
      $q$select rascunho::text from public.member_requirements where rascunho is not null$q$, null),
    ('member_specialty_requirements.rascunho', 'member_specialty_requirements', array['rascunho'], 'contem', null, 'viva',
      $q$select rascunho::text from public.member_specialty_requirements where rascunho is not null$q$, null),
    ('experience_submissions.respostas', 'experience_submissions', array['respostas'], 'contem', null, 'viva',
      $q$select respostas::text from public.experience_submissions where respostas is not null$q$, null),
    ('lixeira_pacotes.storage', 'lixeira_pacotes', array['storage'], 'contem', null, 'historico',
      $q$select storage::text from public.lixeira_pacotes where storage is not null$q$, 'Lixeira de membros (desligada, mas pode haver pacote).'),
    ('lixeira_linhas.dados', 'lixeira_linhas', array['dados'], 'contem', null, 'historico',
      $q$select dados::text from public.lixeira_linhas where dados is not null$q$, null),
    ('clube_exclusoes.snapshot', 'clube_exclusoes', array['snapshot'], 'contem', null, 'historico',
      $q$select snapshot::text from public.clube_exclusoes$q$, 'Snapshot da exclusão de clube (recuperável).')
  ) v(id, tabela, colunas, forma, bucket, protecao, consulta, nota);
$$;
revoke all on function public._storage_referencias() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. EXCEÇÕES justificadas: coluna com nome "de arquivo" que NÃO guarda caminho de Storage.
--    O teste 135 exige: toda coluna suspeita está no catálogo OU aqui, com motivo; exceção que aponta para
--    coluna que não existe mais também falha (lista não apodrece).
-- ---------------------------------------------------------------------------
create or replace function public._storage_referencias_excecoes()
returns table (tabela text, coluna text, motivo text)
language sql immutable set search_path = '' as $$
  select * from (values
    ('class_requirements', 'evidencia_obrigatoria', 'booleano de regra do currículo'),
    ('class_requirements', 'tipo_evidencia', 'tipo (texto/foto) da regra, não caminho'),
    ('specialty_requirements', 'evidencia_obrigatoria', 'booleano de regra do currículo'),
    ('specialty_requirements', 'tipo_evidencia', 'tipo da regra, não caminho'),
    ('classes', 'fonte_url', 'URL externa da fonte oficial do currículo'),
    ('curriculum_versions', 'fonte_url', 'URL externa da fonte do currículo'),
    ('curriculum_versions', 'fonte_arquivo', 'nome do arquivo do manifesto no repositório, não do Storage'),
    ('dynamic_content_values', 'fonte_url', 'URL externa da fonte'),
    ('dynamic_content_values', 'manifesto_arquivo', 'nome de arquivo do manifesto no repositório'),
    ('especialidades_catalogo', 'fonte_url', 'URL externa da fonte (MDA Wiki)'),
    ('mestrados_catalogo', 'fonte_url', 'URL externa da fonte'),
    ('specialties', 'fonte_url', 'URL externa da fonte'),
    ('specialty_requirements', 'fonte_url', 'URL externa da fonte'),
    ('leitura_materiais', 'pdf_fonte_licenca', 'texto da licença do PDF, não caminho'),
    ('class_documents', 'pdf_hash', 'hash do PDF, não caminho (o caminho está em pdf_storage_path)'),
    ('document_final_renders', 'pdf_hash', 'hash do PDF, não caminho'),
    ('document_signatures', 'pdf_hash', 'hash do PDF, não caminho'),
    ('comunidade_posts', 'foto_alt', 'texto alternativo da foto'),
    ('experience_stages', 'evidencia', 'texto da etapa da experiência (regra), não caminho'),
    ('member_requirements', 'evidencia_texto', 'texto escrito pela criança'),
    ('member_specialty_requirements', 'evidencia_texto', 'texto escrito pela criança'),
    ('requirement_submissions', 'evidencia_texto', 'texto histórico da tentativa'),
    ('requirement_submissions', 'tipo_evidencia_entregue', 'tipo (texto/foto), não caminho'),
    ('specialty_requirement_submissions', 'evidencia_texto', 'texto histórico da tentativa'),
    ('specialty_requirement_submissions', 'tipo_evidencia_entregue', 'tipo, não caminho'),
    ('profiles', 'avatar_tipo', 'rótulo (personagem|foto), não caminho'),
    ('club_storage_objetos', 'bucket_id', 'razão de cota: espelha storage.objects, não é referência de uso'),
    ('rede_limpeza_log', 'arquivos', 'contador'),
    ('migracoes_aplicadas', 'arquivo', 'nome do arquivo de migration'),
    ('club_badges', 'icone', 'chave de ícone/emoji do app'),
    ('recursos_catalogo', 'icone', 'chave de ícone/emoji do app'),
    ('notificacoes', 'link', 'rota interna do app'),
    ('site_partners', 'link', 'link externo do parceiro'),
    ('club_showcase', 'link_inscricao', 'rota/URL de inscrição, não arquivo'),
    ('desafios', 'pede_foto', 'booleano de regra')
  ) v(tabela, coluna, motivo);
$$;
revoke all on function public._storage_referencias_excecoes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Coleta: executa o catálogo. Devolve UMA linha por referência encontrada (exato) ou por blob (contem).
-- ---------------------------------------------------------------------------
create or replace function public._storage_gc_referencias_coletar()
returns table (origem text, forma text, chave text, blob text, esperada boolean, protecao text)
language plpgsql stable security definer set search_path = '' as $$
declare r record;
begin
  for r in select * from public._storage_referencias() order by id loop
    if r.forma = 'exato' then
      return query execute format(
        'select %L::text, %L::text, public._storage_ref_chave(q.ref, coalesce(q.bucket, %L)), null::text, q.esperada, %L::text
           from (%s) q(ref, esperada, bucket)
          where public._storage_ref_chave(q.ref, coalesce(q.bucket, %L)) is not null',
        r.id, r.forma, r.bucket, r.protecao, r.consulta, r.bucket);
    elsif r.forma = 'contem' then
      return query execute format(
        'select %L::text, %L::text, null::text, q.blob, true, %L::text from (%s) q(blob) where q.blob is not null',
        r.id, r.forma, r.protecao, r.consulta);
    else
      raise exception 'Catálogo de referências do Storage: forma inválida (%) em %', r.forma, r.id;
    end if;
  end loop;
end $$;
revoke all on function public._storage_gc_referencias_coletar() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Máscara de caminho (sem dado pessoal): UUID vira 8 caracteres + '…'; só pastas "estruturais"
--    conhecidas ficam legíveis; o nome do arquivo some e fica a extensão.
-- ---------------------------------------------------------------------------
create or replace function public._storage_gc_mascarar(p_bucket text, p_name text) returns text
language plpgsql immutable set search_path = '' as $$
declare v_seg text[] := string_to_array(coalesce(p_name, ''), '/'); v_n int := coalesce(array_length(string_to_array(coalesce(p_name, ''), '/'), 1), 0);
        v_out text[] := '{}'; i int; s text;
begin
  for i in 1 .. v_n loop
    s := v_seg[i];
    if i = v_n then
      v_out := array_append(v_out, '…' || coalesce(substring(s from '\.[A-Za-z0-9]{1,5}$'), ''));
    elsif s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_out := array_append(v_out, left(s, 8) || '…');
    elsif s in ('requisitos', 'documentos', 'conclusao-anterior', 'perfis', 'unidades', 'mural', 'final', 'missoes', 'atividades', 'experiencias') then
      v_out := array_append(v_out, s);
    else
      v_out := array_append(v_out, '…'::text);
    end if;
  end loop;
  return coalesce(p_bucket, '?') || '/' || array_to_string(v_out, '/');
end $$;
revoke all on function public._storage_gc_mascarar(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Fatos + categoria de cada arquivo. Nunca escreve.
--    p_fonte = null  -> todos os objetos de storage.objects (inventário)
--    p_fonte = jsonb -> lista [{bucket, name, bytes, criado_em}] vinda da LISTAGEM da API do Storage
--                       (acha o arquivo físico SEM linha em storage.objects; existe_linha = false)
--    clube_situacao: 'ativo' | 'inativo' | 'excluido' (lixeira) | 'expurgado' | null (caminho não é de clube)
-- ---------------------------------------------------------------------------
create or replace function public._storage_gc_fatos(p_fonte jsonb, p_dias int default 7)
returns table (bucket text, name text, bytes bigint, criado_em timestamptz, idade_dias numeric, existe_linha boolean,
               club_id uuid, clube_situacao text, referencias int, em_fila boolean, categoria text, motivo text)
language sql stable security definer set search_path = '' as $$
  with pol as (select public._storage_gc_politica() p),
  carencia as (
    select greatest(coalesce(p_dias, 7), (p -> 'carencia_minima_dias')::int) as dias from pol
  ),
  refs as materialized (select * from public._storage_gc_referencias_coletar()),
  exatas as (
    select r.chave,
           count(*) filter (where r.protecao <> 'fila_remocao') as vivas,
           bool_or(r.protecao = 'fila_remocao') as fila
      from refs r where r.forma = 'exato' group by r.chave
  ),
  blobs as (select r.blob from refs r where r.forma = 'contem'),
  origem as (
    select o.bucket_id as bucket, o.name, coalesce((o.metadata ->> 'size')::bigint, 0) as bytes,
           o.created_at as criado_em, true as existe_linha
      from storage.objects o where p_fonte is null
    union all
    select x ->> 'bucket', x ->> 'name', coalesce(nullif(x ->> 'bytes', '')::bigint, 0),
           nullif(x ->> 'criado_em', '')::timestamptz,
           exists (select 1 from storage.objects o where o.bucket_id = x ->> 'bucket' and o.name = x ->> 'name')
      from jsonb_array_elements(coalesce(p_fonte, '[]'::jsonb)) x
     where p_fonte is not null and x ->> 'bucket' is not null and x ->> 'name' is not null
  ),
  base as (
    select s.*,
           round(extract(epoch from (now() - s.criado_em)) / 86400.0, 2) as idade_dias,
           case when split_part(s.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then split_part(s.name, '/', 1)::uuid end as seg1
      from origem s
  ),
  fatos as (
    select b.*,
           case when b.seg1 is null then null
                when exists (select 1 from public.organizational_units u where u.id = b.seg1 and u.type = 'clube')
                  then (select u.status from public.organizational_units u where u.id = b.seg1)
                when exists (select 1 from public.clube_exclusoes x where x.clube_uuid = b.seg1 and x.status = 'expurgado')
                  then 'expurgado'
           end as clube_situacao,
           coalesce(e.vivas, 0)::int
             + (select count(*) from blobs bl where strpos(bl.blob, b.name) > 0)::int as referencias,
           coalesce(e.fila, false) as em_fila
      from base b left join exatas e on e.chave = b.bucket || '/' || b.name
  )
  select f.bucket, f.name, f.bytes, f.criado_em, f.idade_dias, f.existe_linha,
         case when f.clube_situacao is not null then f.seg1 end, f.clube_situacao, f.referencias, f.em_fila,
         k.categoria,
         case when k.categoria = 'conclusao_anterior_sem_registro' then
                case when f.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/conclusao-anterior/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif)$'
                     then 'sem_registro' else 'formato_invalido' end
         end
    from fatos f cross join carencia c
    cross join lateral (select case
      when f.bucket not in (select jsonb_array_elements_text(p -> 'buckets_no_escopo') from pol)
       and f.bucket not in (select jsonb_array_elements_text(p -> 'buckets_protegidos') from pol) then 'bucket_fora_do_escopo'
      when f.referencias > 0 then 'referenciado'
      when f.em_fila then 'em_fila_de_remocao'
      when f.bucket in (select jsonb_array_elements_text(p -> 'buckets_protegidos') from pol) then 'protegido_bucket'
      when f.clube_situacao = 'excluido' then 'clube_na_lixeira'
      when f.idade_dias is null then 'sem_data'
      when f.idade_dias < c.dias then 'recente'
      when f.clube_situacao = 'expurgado' then 'clube_expurgado'
      when f.bucket = 'comprovacoes' and f.name ~* '^[^/]+/[^/]+/conclusao-anterior/' then 'conclusao_anterior_sem_registro'
      else 'orfao'
    end as categoria) k;
$$;
revoke all on function public._storage_gc_fatos(jsonb, int) from public, anon, authenticated;

-- inventário = os fatos de tudo o que está em storage.objects
create or replace function public._storage_gc_inventario(p_dias int default 7)
returns table (bucket text, name text, bytes bigint, criado_em timestamptz, idade_dias numeric, existe_linha boolean,
               club_id uuid, clube_situacao text, referencias int, em_fila boolean, categoria text, motivo text)
language sql stable security definer set search_path = '' as $$
  select * from public._storage_gc_fatos(null, p_dias);
$$;
revoke all on function public._storage_gc_inventario(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Referências QUEBRADAS: a tabela aponta para objeto que não existe (só 'exato' e esperada = true).
--    Só relata. (Para 'esperada' = false — ex.: foto da Rede já apagada pela vida útil — não é quebra.)
-- ---------------------------------------------------------------------------
create or replace function public._storage_gc_quebradas()
returns table (origem text, bucket text, name text)
language sql stable security definer set search_path = '' as $$
  select distinct r.origem, split_part(r.chave, '/', 1), substr(r.chave, strpos(r.chave, '/') + 1)
    from public._storage_gc_referencias_coletar() r
   where r.forma = 'exato' and r.esperada and r.protecao <> 'fila_remocao'
     and not exists (select 1 from storage.objects o
                      where o.bucket_id = split_part(r.chave, '/', 1) and o.name = substr(r.chave, strpos(r.chave, '/') + 1));
$$;
revoke all on function public._storage_gc_quebradas() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. O RELATÓRIO do admin da plataforma. Somente leitura, sem dado pessoal.
-- ---------------------------------------------------------------------------
create or replace function public.admin_storage_gc_relatorio(p_dias int default 7, p_amostra int default 10)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dias int := greatest(coalesce(p_dias, 7), (public._storage_gc_politica() -> 'carencia_minima_dias')::int);
  v_n int := least(greatest(coalesce(p_amostra, 10), 0), 50);
  v_cands jsonb := public._storage_gc_politica() -> 'categorias_candidatas';
  v_res jsonb;
begin
  perform public._exigir_admin_plataforma();

  with inv as materialized (select * from public._storage_gc_inventario(v_dias)),
  quebradas as (select * from public._storage_gc_quebradas()),
  cats as (
    select categoria, count(*) as n, coalesce(sum(bytes), 0) as bytes from inv group by categoria
  ),
  buckets as (
    select bucket, count(*) as objetos, coalesce(sum(bytes), 0) as bytes,
           count(*) filter (where v_cands ? categoria) as candidatos,
           coalesce(sum(bytes) filter (where v_cands ? categoria), 0) as candidatos_bytes
      from inv group by bucket
  ),
  amostras as (
    select categoria, jsonb_agg(jsonb_build_object(
             'chave', left(md5(bucket || '/' || name), 12),
             'caminho', public._storage_gc_mascarar(bucket, name),
             'bytes', bytes, 'idade_dias', idade_dias, 'motivo', motivo) order by criado_em) as itens
      from (select i.*, row_number() over (partition by categoria order by criado_em) rn from inv i) x
     where rn <= v_n and v_cands ? categoria
     group by categoria
  )
  select jsonb_build_object(
    'versao', 1,
    'gerado_em', now(),
    'somente_leitura', true,
    'carencia_dias', v_dias,
    'totais', jsonb_build_object('objetos', (select count(*) from inv), 'bytes', (select coalesce(sum(bytes), 0) from inv)),
    'por_categoria', coalesce((select jsonb_object_agg(categoria, jsonb_build_object('n', n, 'bytes', bytes)) from cats), '{}'::jsonb),
    'por_bucket', coalesce((select jsonb_object_agg(bucket, jsonb_build_object(
        'objetos', objetos, 'bytes', bytes, 'candidatos', candidatos, 'candidatos_bytes', candidatos_bytes)) from buckets), '{}'::jsonb),
    'candidatos', jsonb_build_object(
        'n', (select count(*) from inv where v_cands ? categoria),
        'bytes', (select coalesce(sum(bytes), 0) from inv where v_cands ? categoria)),
    'referencias_quebradas', jsonb_build_object(
        'total', (select count(*) from quebradas),
        'por_origem', coalesce((select jsonb_object_agg(origem, n) from (select origem, count(*) n from quebradas group by origem) q), '{}'::jsonb)),
    'amostras_mascaradas', coalesce((select jsonb_object_agg(categoria, itens) from amostras), '{}'::jsonb),
    'catalogo', jsonb_build_object('entradas', (select count(*) from public._storage_referencias()),
                                   'excecoes', (select count(*) from public._storage_referencias_excecoes()))
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.admin_storage_gc_relatorio(int, int) from public, anon;
grant execute on function public.admin_storage_gc_relatorio(int, int) to authenticated;

notify pgrst, 'reload schema';
