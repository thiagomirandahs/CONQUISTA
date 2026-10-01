-- Migration 531: GC SEGURO do Storage — catálogo de referências + inventário + relatório (SOMENTE LEITURA).
-- Prova: (a) o catálogo cobre TODA coluna de caminho/arquivo do schema (coluna nova sem mapa FALHA aqui);
-- (b) a classificação: órfão, referenciado (URL, caminho puro, JSON), recente, bucket protegido, bucket
-- desconhecido, fila da Rede, clube expurgado / na lixeira, conclusao-anterior plantado, sem linha (listagem);
-- (c) referência quebrada é só relatada; (d) o relatório é só do admin da plataforma, sem dado pessoal, e
-- não escreve nada; (e) a carência mínima é 7 dias, ninguém baixa disso.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.signup('admin_saas', '{"tipo":"fundador","nome":"Admin da Plataforma"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin_saas'), 'operacao', 'bootstrap de teste');

-- ============================ (a) CATÁLOGO × SCHEMA ============================
-- colunas com nome "de arquivo" em tabelas do public que nem o catálogo nem a lista de exceções conhecem
select t.eq('catálogo: nenhuma coluna de caminho/arquivo/foto/url fora do catálogo e das exceções',
  (select coalesce(string_agg(c.table_name || '.' || c.column_name, ', ' order by c.table_name, c.column_name), '')
     from information_schema.columns c
     join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type in ('text', 'character varying', 'jsonb', 'json')
      and c.column_name ~* '(path|caminho|arquivo|foto|evidenc|url|anexo|imagem|logo|avatar|storage|desenho|midia|capa|thumb|emblema|bandeira|banner|pdf|comprovante|file|image|icone|upload|bucket|link)'
      and not exists (select 1 from public._storage_referencias() r where r.tabela = c.table_name and c.column_name = any (r.colunas))
      and not exists (select 1 from public._storage_referencias_excecoes() e where e.tabela = c.table_name and e.coluna = c.column_name)), '');
select t.eq('catálogo: toda coluna citada existe (catálogo não apodrece)',
  (select coalesce(string_agg(r.id || '→' || col, ', '), '') from public._storage_referencias() r, unnest(r.colunas) col
    where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = r.tabela and c.column_name = col)), '');
select t.eq('exceções: toda coluna citada existe (lista de exceções não apodrece)',
  (select coalesce(string_agg(e.tabela || '.' || e.coluna, ', '), '') from public._storage_referencias_excecoes() e
    where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = e.tabela and c.column_name = e.coluna)), '');
select t.eq('exceções: todas têm motivo escrito',
  (select count(*) from public._storage_referencias_excecoes() where length(btrim(coalesce(motivo, ''))) < 5), 0);
select t.eq('catálogo: ids únicos', (select count(*) - count(distinct id) from public._storage_referencias()), 0);
select t.eq('catálogo: forma e proteção válidas',
  (select count(*) from public._storage_referencias() where forma not in ('exato', 'contem') or protecao not in ('viva', 'historico', 'fila_remocao')), 0);
select t.eq('catálogo: toda consulta executa (nenhuma quebrada por mudança de schema)',
  (select count(*) from public._storage_gc_referencias_coletar()) >= 0, true);
select t.eq('catálogo: as tabelas imutáveis/históricas estão marcadas como histórico',
  (select count(*) from public._storage_referencias() where tabela in ('requirement_submissions', 'class_completion_snapshots', 'document_final_renders', 'document_signatures', 'class_documents') and protecao <> 'historico'), 0);
-- todo bucket existente foi DECIDIDO: ou está no escopo do GC (referências catalogadas) ou é protegido
select t.eq('buckets: todo bucket está no escopo do GC ou na lista protegida (bucket novo sem decisão FALHA)',
  (select coalesce(string_agg(b.id, ', '), '') from storage.buckets b
    where b.id not in (select jsonb_array_elements_text(public._storage_gc_politica() -> 'buckets_no_escopo'))
      and b.id not in (select jsonb_array_elements_text(public._storage_gc_politica() -> 'buckets_protegidos'))), '');
select t.eq('buckets públicos são todos protegidos (marca)',
  (select count(*) from storage.buckets b where b.public and b.id not in (select jsonb_array_elements_text(public._storage_gc_politica() -> 'buckets_protegidos'))), 0);
select t.eq('política: carência mínima é 7 dias', (public._storage_gc_politica() ->> 'carencia_minima_dias'), '7');

-- ============================ normalização e máscara ============================
select t.eq('chave: URL pública do Storage', public._storage_ref_chave('https://x.supabase.co/storage/v1/object/public/imagens/perfis/a.jpg', 'comprovacoes'), 'imagens/perfis/a.jpg');
select t.eq('chave: URL assinada (token cortado)', public._storage_ref_chave('https://x.supabase.co/storage/v1/object/sign/comprovacoes/u/r/1.jpg?token=abc', 'imagens'), 'comprovacoes/u/r/1.jpg');
select t.eq('chave: caminho puro usa o bucket do catálogo', public._storage_ref_chave('u/missoes/1.jpg', 'comprovacoes'), 'comprovacoes/u/missoes/1.jpg');
select t.eq('chave: URL externa não é Storage', public._storage_ref_chave('https://youtube.com/watch?v=1', 'imagens'), null);
select t.eq('chave: rota interna do app não é Storage', public._storage_ref_chave('/icon-192.png', 'imagens'), null);
select t.eq('chave: vazio', public._storage_ref_chave('  ', 'imagens'), null);
select t.eq('máscara: UUID cortado, arquivo some, pasta estrutural fica',
  public._storage_gc_mascarar('comprovacoes', '11111111-2222-3333-4444-555555555555/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/conclusao-anterior/99999999-8888-7777-6666-555555555555.heic'),
  'comprovacoes/11111111…/aaaaaaaa…/conclusao-anterior/….heic');
select t.eq('máscara: pasta desconhecida some', public._storage_gc_mascarar('suporte-anexos', 'abc/segredo/foto.png'), 'suporte-anexos/…/…/….png');

-- ============================ (b) CLASSIFICAÇÃO ============================
create function t.obj(p_bucket text, p_name text, p_dias numeric, p_bytes bigint default 1000) returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata, created_at, updated_at)
  values (p_bucket, p_name, jsonb_build_object('size', p_bytes), now() - make_interval(secs => (p_dias * 86400)::int), now()) $$;
create function t.cat(p_bucket text, p_name text) returns text language sql as $$
  select categoria from public._storage_gc_inventario(7) where bucket = p_bucket and name = p_name $$;
create function t.mot(p_bucket text, p_name text) returns text language sql as $$
  select motivo from public._storage_gc_inventario(7) where bucket = p_bucket and name = p_name $$;

select t.id('membro_a')::text as ua, t.id('clube_a')::text as ca, t.id('clube_b')::text as cb, gen_random_uuid()::text as cx,
       gen_random_uuid()::text as u9, gen_random_uuid()::text as u8 \gset

-- referências reais (URL, caminho puro, JSON)
update public.profiles set foto = 'http://127.0.0.1:54321/storage/v1/object/public/imagens/perfis/' || :'ua' || '-200.jpg' where id = t.id('membro_a');
update public.profiles set avatar = jsonb_build_object('foto', 'perfis/' || :'ua' || '-300.jpg') where id = t.id('membro_a2');
update public.entregas set foto_url = :'ua' || '/missoes/ref.jpg' where id = t.id('ent_a');

-- órfão (30 dias) / referenciado por URL / referenciado por JSON / referenciado por caminho puro / recente
select t.obj('imagens', 'perfis/' || :'ua' || '-100.jpg', 30);
select t.obj('imagens', 'perfis/' || :'ua' || '-200.jpg', 900);
select t.obj('imagens', 'perfis/' || :'ua' || '-300.jpg', 900);
select t.obj('comprovacoes', :'ua' || '/missoes/ref.jpg', 900);
select t.obj('imagens', 'perfis/' || :'ua' || '-400.jpg', 2);
select t.obj('imagens', 'perfis/' || :'ua' || '-500.jpg', 6.5);
select t.obj('imagens', 'perfis/' || :'ua' || '-600.jpg', 7.5);
select t.eq('órfão antigo => candidato "orfao"', t.cat('imagens', 'perfis/' || :'ua' || '-100.jpg'), 'orfao');
select t.eq('referenciado por URL (profiles.foto) NUNCA é candidato', t.cat('imagens', 'perfis/' || :'ua' || '-200.jpg'), 'referenciado');
select t.eq('referenciado por JSON (profiles.avatar) NUNCA é candidato', t.cat('imagens', 'perfis/' || :'ua' || '-300.jpg'), 'referenciado');
select t.eq('referenciado por caminho puro (entregas.foto_url) NUNCA é candidato', t.cat('comprovacoes', :'ua' || '/missoes/ref.jpg'), 'referenciado');
select t.eq('recente (2 dias) NUNCA é candidato', t.cat('imagens', 'perfis/' || :'ua' || '-400.jpg'), 'recente');
select t.eq('6,5 dias ainda é recente', t.cat('imagens', 'perfis/' || :'ua' || '-500.jpg'), 'recente');
select t.eq('7,5 dias já passa da carência', t.cat('imagens', 'perfis/' || :'ua' || '-600.jpg'), 'orfao');

-- buckets protegidos e desconhecido
select t.obj('documentos-emitidos', :'ca' || '/' || :'ua' || '/doc/1.pdf', 900);
select t.obj('assinaturas-desenhadas', :'ca' || '/doc/sig.png', 900);
select t.obj('publico', :'ca' || '/logo-1.png', 900);
select t.obj('parceiros', 'logo-1-abc.png', 900);
select t.eq('documentos-emitidos órfão: protegido', t.cat('documentos-emitidos', :'ca' || '/' || :'ua' || '/doc/1.pdf'), 'protegido_bucket');
select t.eq('assinaturas-desenhadas órfã: protegida', t.cat('assinaturas-desenhadas', :'ca' || '/doc/sig.png'), 'protegido_bucket');
select t.eq('logo de clube antiga (publico): protegida', t.cat('publico', :'ca' || '/logo-1.png'), 'protegido_bucket');
select t.eq('logo de parceiro antiga: protegida', t.cat('parceiros', 'logo-1-abc.png'), 'protegido_bucket');
insert into storage.buckets (id, name, public) values ('bucket-novo-sem-decisao', 'bucket-novo-sem-decisao', false);
select t.obj('bucket-novo-sem-decisao', 'a/b.jpg', 900);
select t.eq('bucket sem decisão: fora do escopo (falha fechada)', t.cat('bucket-novo-sem-decisao', 'a/b.jpg'), 'bucket_fora_do_escopo');

-- fila da limpeza da Rede
insert into public.rede_fotos_para_apagar (club_id, bucket, caminho, motivo) values (t.id('clube_a'), 'comunidade', :'ca' || '/' || :'ua' || '/fila.jpg', 'orfa');
select t.obj('comunidade', :'ca' || '/' || :'ua' || '/fila.jpg', 30);
select t.obj('comunidade', :'ca' || '/' || :'ua' || '/solta.jpg', 30);
select t.eq('na fila da Rede: não é do GC', t.cat('comunidade', :'ca' || '/' || :'ua' || '/fila.jpg'), 'em_fila_de_remocao');
select t.eq('foto da Rede solta e antiga (nem post nem fila) é órfã', t.cat('comunidade', :'ca' || '/' || :'ua' || '/solta.jpg'), 'orfao');

-- clube expurgado / na lixeira
insert into public.clube_exclusoes (clube_uuid, nome, motivo, status) values (:'cx'::uuid, 'Clube X', 'teste', 'expurgado');
select t.obj('comprovacoes', :'cx' || '/' || :'u9' || '/requisitos/a.jpg', 30);
select t.obj('comprovacoes', :'cx' || '/' || :'u9' || '/requisitos/b.jpg', 3);
select t.eq('arquivo de clube EXPURGADO e antigo => candidato', t.cat('comprovacoes', :'cx' || '/' || :'u9' || '/requisitos/a.jpg'), 'clube_expurgado');
select t.eq('...mas recente continua recente', t.cat('comprovacoes', :'cx' || '/' || :'u9' || '/requisitos/b.jpg'), 'recente');
update public.organizational_units set status = 'excluido' where id = t.id('clube_b');
select t.obj('comprovacoes', :'cb' || '/' || :'u8' || '/requisitos/a.jpg', 900);
select t.eq('clube na LIXEIRA (recuperável) nunca é candidato', t.cat('comprovacoes', :'cb' || '/' || :'u8' || '/requisitos/a.jpg'), 'clube_na_lixeira');
update public.organizational_units set status = 'ativo' where id = t.id('clube_b');

-- conclusao-anterior plantado sem registro
select t.obj('comprovacoes', :'ca' || '/' || :'ua' || '/conclusao-anterior/' || gen_random_uuid() || '.jpg', 30);
select gen_random_uuid()::text as cav \gset
select t.obj('comprovacoes', :'ca' || '/' || :'ua' || '/conclusao-anterior/' || :'cav' || '.jpg', 30);
select t.obj('comprovacoes', :'ca' || '/' || :'ua' || '/conclusao-anterior/script.exe', 30);
select t.obj('comprovacoes', :'ca' || '/' || :'ua' || '/conclusao-anterior/' || gen_random_uuid() || '.jpg', 2);
select t.eq('conclusao-anterior sem registro, formato válido', t.cat('comprovacoes', :'ca' || '/' || :'ua' || '/conclusao-anterior/' || :'cav' || '.jpg'), 'conclusao_anterior_sem_registro');
select t.eq('...motivo: sem_registro', t.mot('comprovacoes', :'ca' || '/' || :'ua' || '/conclusao-anterior/' || :'cav' || '.jpg'), 'sem_registro');
select t.eq('conclusao-anterior plantado com formato inválido', t.cat('comprovacoes', :'ca' || '/' || :'ua' || '/conclusao-anterior/script.exe'), 'conclusao_anterior_sem_registro');
select t.eq('...motivo: formato_invalido', t.mot('comprovacoes', :'ca' || '/' || :'ua' || '/conclusao-anterior/script.exe'), 'formato_invalido');
select t.eq('conclusao-anterior recente (upload antes do registro) não é candidato',
  (select count(*) from public._storage_gc_inventario(7) where name like '%/conclusao-anterior/%' and categoria = 'recente'), 1);
-- com registro: a referência real (curriculum_achievements.comprovante_path) protege
select gen_random_uuid()::text as cav2 \gset
select t.obj('comprovacoes', :'ca' || '/' || :'ua' || '/conclusao-anterior/' || :'cav2' || '.jpg', 30);
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em, origem, registrado_por, registrado_papel,
                                            registrado_em, registrado_no_club_id, observacao, comprovante_path)
select t.id('membro_a'), 'classe', (select id from public.classes limit 1), t.id('clube_a'), now() - interval '40 days', 'registro_anterior',
       t.id('lider_a'), 'diretoria', now(), t.id('clube_a'), 'registro de teste do GC',
       :'ca' || '/' || :'ua' || '/conclusao-anterior/' || :'cav2' || '.jpg';
select t.eq('conclusao-anterior COM registro (curriculum_achievements) é referenciado',
  t.cat('comprovacoes', :'ca' || '/' || :'ua' || '/conclusao-anterior/' || :'cav2' || '.jpg'), 'referenciado');

-- ============================ (5) referência quebrada: só relata ============================
update public.entregas set foto_url = :'ua' || '/missoes/sumiu.jpg' where id = t.id('ent_b');
select t.eq('referência quebrada (tabela aponta para objeto inexistente) é relatada',
  (select count(*) from public._storage_gc_quebradas() where origem = 'entregas.foto_url' and name = :'ua' || '/missoes/sumiu.jpg'), 1);
select t.eq('referência íntegra NÃO aparece como quebrada',
  (select count(*) from public._storage_gc_quebradas() where name = :'ua' || '/missoes/ref.jpg'), 0);

-- ============================ (2) listagem da API: arquivo físico sem linha ============================
select t.eq('listagem: arquivo sem linha, antigo e sem referência => existe_linha=false e categoria orfao',
  (select existe_linha::text || '/' || categoria from public._storage_gc_fatos(
     jsonb_build_array(jsonb_build_object('bucket', 'comprovacoes', 'name', :'cx' || '/' || :'u9' || '/requisitos/fantasma.jpg', 'criado_em', (now() - interval '60 days')::text)), 7)),
  'false/clube_expurgado');
select t.eq('listagem: arquivo físico sem linha MAS referenciado (a referência quebrada achou o arquivo) => referenciado, nunca candidato',
  (select existe_linha::text || '/' || categoria from public._storage_gc_fatos(
     jsonb_build_array(jsonb_build_object('bucket', 'comprovacoes', 'name', :'ua' || '/missoes/sumiu.jpg', 'criado_em', (now() - interval '60 days')::text)), 7)),
  'false/referenciado');
select t.eq('listagem: item sem data não é candidato',
  (select categoria from public._storage_gc_fatos(jsonb_build_array(jsonb_build_object('bucket', 'imagens', 'name', 'perfis/zzz.jpg')), 7)), 'sem_data');
select t.eq('listagem: arquivo físico sem linha e sem referência (fora de clube) => orfao',
  (select existe_linha::text || '/' || categoria from public._storage_gc_fatos(
     jsonb_build_array(jsonb_build_object('bucket', 'imagens', 'name', 'perfis/fantasma.jpg', 'criado_em', (now() - interval '60 days')::text)), 7)),
  'false/orfao');

-- ============================ (d) o RELATÓRIO ============================
select count(*) as n_antes from storage.objects \gset
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('diretoria de clube NÃO vê o relatório', 'select public.admin_storage_gc_relatorio()', 'Sem permissão');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('membro NÃO vê o relatório', 'select public.admin_storage_gc_relatorio()', 'Sem permissão');
select t.como_anon();
select t.throws('anônimo NÃO executa', 'select public.admin_storage_gc_relatorio()', 'permission denied');
select t.como('admin_saas');
select public.admin_storage_gc_relatorio(7, 10)::text as rel \gset
select t.ok('admin da plataforma recebe o relatório', :'rel'::jsonb ->> 'versao' = '1');
select t.eq('declara somente leitura', :'rel'::jsonb ->> 'somente_leitura', 'true');
select t.eq('carência 7 por padrão', :'rel'::jsonb ->> 'carencia_dias', '7');
select t.eq('candidatos do relatório = orfãos + expurgado + conclusao-anterior sem registro (fixtures)',
  :'rel'::jsonb -> 'candidatos' ->> 'n', '8'); -- 4 órfãos (inclui o do clube B, já fora da lixeira) + 1 expurgado + 3 conclusao-anterior
select t.eq('relatório: protegido_bucket conta os 4 buckets protegidos', :'rel'::jsonb -> 'por_categoria' -> 'protegido_bucket' ->> 'n', '4');
select t.eq('relatório: referências quebradas', :'rel'::jsonb -> 'referencias_quebradas' ->> 'total', '1');
select t.ok('relatório: bucket protegido tem 0 candidatos', (:'rel'::jsonb -> 'por_bucket' -> 'documentos-emitidos' ->> 'candidatos') = '0');
select t.ok('SEM dado pessoal: nenhum UUID inteiro, nenhum caminho completo no JSON',
  position(:'ua' in :'rel') = 0 and position(:'ca' in :'rel') = 0 and position(:'cx' in :'rel') = 0 and position('script.exe' in :'rel') = 0
  and position('fantasma' in :'rel') = 0 and position('sumiu' in :'rel') = 0);
select t.ok('amostras mascaradas existem para as categorias candidatas', (:'rel'::jsonb -> 'amostras_mascaradas' -> 'orfao') is not null and jsonb_array_length(:'rel'::jsonb -> 'amostras_mascaradas' -> 'orfao') > 0);
select t.eq('p_dias abaixo de 7 é elevado a 7 (carência mínima inegociável)', (public.admin_storage_gc_relatorio(0, 1) ->> 'carencia_dias'), '7');
select t.eq('p_dias negativo também', (public.admin_storage_gc_relatorio(-30, 1) ->> 'carencia_dias'), '7');
select t.eq('carência maior só ESTREITA os candidatos: com 2000 dias nada é candidato',
  (public.admin_storage_gc_relatorio(2000, 1) -> 'candidatos' ->> 'n'), '0');
select t.eq('amostra limitada a 50', (select max(jsonb_array_length(v)) <= 50 from jsonb_each(public.admin_storage_gc_relatorio(7, 9999) -> 'amostras_mascaradas') e(k, v)), true);
reset role;
select t.eq('o relatório NÃO apaga nem altera nada em storage.objects', (select count(*) from storage.objects), :n_antes::bigint);

-- ============================ permissões e forma das funções ============================
select t.eq('anon sem EXECUTE no relatório', has_function_privilege('anon', 'public.admin_storage_gc_relatorio(int, int)', 'execute'), false);
select t.eq('authenticated com EXECUTE no relatório (a trava é _exigir_admin_plataforma)', has_function_privilege('authenticated', 'public.admin_storage_gc_relatorio(int, int)', 'execute'), true);
select t.eq('funções internas: nenhuma executável por anon/authenticated',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('_storage_gc_politica', '_storage_ref_chave', '_storage_referencias', '_storage_referencias_excecoes',
                        '_storage_gc_referencias_coletar', '_storage_gc_mascarar', '_storage_gc_fatos', '_storage_gc_inventario', '_storage_gc_quebradas')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0);
select t.eq('security definer das funções que leem tabelas têm search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.proname in ('_storage_gc_referencias_coletar', '_storage_gc_fatos', '_storage_gc_inventario', '_storage_gc_quebradas', 'admin_storage_gc_relatorio')
      and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=""%'), 0);
select t.eq('todas as funções do GC são STABLE/IMMUTABLE (nenhuma pode escrever)',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^(_storage_gc_|_storage_ref|_storage_referencias|admin_storage_gc)' and p.provolatile = 'v'), 0);
select t.eq('a migration não criou tabela (nada para a guarda de manutenção)',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname ~ 'storage_gc'), 0);

select t.fim();
rollback;
