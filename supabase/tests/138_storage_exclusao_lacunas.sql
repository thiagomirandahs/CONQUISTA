-- LACUNAS DA FILA DE EXCLUSÃO DO STORAGE (migration 533) — rascunho/anexo de requisito, especialidade, imagem de experiência,
-- arquivo de etapa de experiência e anexo do suporte.
-- Prova (reutilizando a fila, a política e o processador da 532, sem alterá-los): trocar/remover a foto OU o anexo de rascunho enfileira
-- SÓ o caminho antigo (nunca o novo; a mesma foto regravada, inclusive em URL, não enfileira; o que continua em outra coluna da linha não
-- enfileira); trocar de novo antes da carência não duplica nem encurta; arquivo que volta a ser referenciado (outra coluna/linha) ou que é
-- prova em histórico imutável NÃO é liberado; caminho FORJADO (arquivo de outra pessoa, UUID inexistente, dono nulo) NUNCA é liberado;
-- bucket protegido nem entra; carência de 7 dias; lote máximo 8; reserva sem duplicidade; idempotência; falha da Edge Function (recuo,
-- teto, infra_falhas); objeto ausente; isolamento entre clubes; o gatilho nunca derruba a operação do usuário; as funções 532 e os 6
-- gatilhos 532 seguem intactos.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql

\o /dev/null
\ir _fixture_especialidade_teste.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true), (t.id('clube_a'), 'experiencias', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.esp() returns uuid language sql stable security definer as $$ select id from public.specialties where codigo = 'TE-001' $$;

-- ---- helpers (mesmos da 137) ----
create function t.obj(p_bucket text, p_nome text, p_idade interval default '30 days') returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into storage.objects (bucket_id, name, metadata, created_at, updated_at)
  values (p_bucket, p_nome, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1000), now() - p_idade, now() - p_idade);
end $$;
create function t.url(p_bucket text, p_nome text) returns text language sql immutable as $$
  select 'https://x.supabase.co/storage/v1/object/public/' || p_bucket || '/' || p_nome $$;
create function t.fila(p_origem text) returns text language sql security definer set search_path = '' as $$
  select coalesce(string_agg(bucket || '/' || caminho, ',' order by caminho), '') from public.storage_exclusao_fila where origem = p_origem $$;
create function t.est(p_bucket text, p_caminho text) returns text language sql security definer set search_path = '' as $$
  select estado || ':' || coalesce(ultima_mensagem, '') from public.storage_exclusao_fila where bucket = p_bucket and caminho = p_caminho $$;
create function t.existe(p_bucket text, p_nome text) returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from storage.objects where bucket_id = p_bucket and name = p_nome) $$;
create function t.proc(p_lim int default 20) returns text language sql as $$
  select coalesce(string_agg(bucket || '/' || caminho, ',' order by caminho), '') from public._storage_exclusao_processar(p_lim) $$;
create function t.vencidos() returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.storage_exclusao_fila where estado = 'pendente' and processar_apos <= now() and (reservado_ate is null or reservado_ate < now()) $$;
-- processa TUDO que está vencido em lotes (cada chamada olha no máximo 8 itens; uma chamada pode devolver menos de 8 se alguns forem "mantido")
create function t.tudo() returns table (bucket text, caminho text) language plpgsql as $$
declare r record; v_voltas int := 0;
begin
  loop
    for r in select * from public._storage_exclusao_processar(50) loop bucket := r.bucket; caminho := r.caminho; return next; end loop;
    v_voltas := v_voltas + 1;
    exit when t.vencidos() = 0 or v_voltas > 100;
  end loop;
end $$;

-- ---- helpers desta rodada ----
create function t.p(p_user text, p_tag text) returns text language sql stable as $$ select t.id(p_user)::text || '/requisitos/' || p_tag || '.jpg' $$;
create function t.an(variadic p_caminhos text[]) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('campo', 'fotos', 'path', x) order by o), '[]'::jsonb) from unnest(p_caminhos) with ordinality u(x, o) $$;
create function t.mrn(p_user text, p_n int) returns uuid language sql stable security definer set search_path = '' as $$
  -- determinístico (ids são uuid aleatórios) e sem os requisitos que exigem foto de documento (a tentativa deles tem outra regra)
  select mr.id from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id
   where mr.usuario_id = t.id(p_user) and not public._requisito_exige_documento(mr.requirement_id)
   order by r.manifesto_id, mr.id offset p_n limit 1 $$;
create function t.msrn(p_user text, p_n int) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.member_specialty_requirements where usuario_id = t.id(p_user) order by id offset p_n limit 1 $$;
create function t.n_fila(p_caminho text) returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.storage_exclusao_fila where caminho = p_caminho $$;
-- caminhos que ESPERAMOS que o processador libere (criados aqui para a prova de igualdade de conjunto)
create table t.exp (bucket text, caminho text);
grant all on t.exp to public;
create function t.espera(p_bucket text, p_caminho text) returns void language sql as $$ insert into t.exp values (p_bucket, p_caminho) $$;
create table t.snap (chave text primary key, v text);
grant all on t.snap to public;

-- matrículas reais (classe_iniciar): membro_a no clube A, membro_b no clube B
select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.classe_iniciar(t.classe('amigo'));
reset role;
select t.como('membro_b'); select t.pedir_clube('clube_b');
select public.classe_iniciar(t.classe('amigo'));
reset role;

-- especialidade de teste (insert direto, como o teste 119): membro_a no clube A
insert into public.member_specialties (usuario_id, club_id, specialty_id, iniciada_em) values (t.id('membro_a'), t.id('clube_a'), t.esp(), now() - interval '40 days');
insert into public.member_specialty_requirements (member_specialty_id, specialty_requirement_id)
  select (select id from public.member_specialties where usuario_id = t.id('membro_a') limit 1), id from public.specialty_requirements where specialty_id = t.esp();
delete from public.storage_exclusao_fila;
\o

-- =============================================================================
--  1. Estrutura e fechaduras (a 532 continua intacta)
-- =============================================================================
select t.eq('gatilhos da 533 instalados (4 tabelas x update/delete + experiences + suporte só delete = 9)',
  (select count(*) from pg_trigger where tgname like 'zz_storage_lacuna_%' and not tgisinternal), 9::bigint);
select t.eq('os 6 gatilhos da 532 continuam (nome zz_storage_exclusao_%): a 533 não colide com eles',
  (select count(*) from pg_trigger where tgname like 'zz_storage_exclusao_%' and not tgisinternal), 6::bigint);
select t.eq('gatilhos de UPDATE têm WHEN (o save que regrava o mesmo valor nem executa a função)',
  (select count(*) from pg_trigger where tgname like 'zz_storage_lacuna_%_upd' and not tgisinternal and pg_get_triggerdef(oid) ilike '%WHEN%'), 4::bigint);
select t.eq('gatilhos de UPDATE são AFTER UPDATE OF <coluna> (não disparam em update de outras colunas)',
  (select count(*) from pg_trigger where tgname like 'zz_storage_lacuna_%_upd' and not tgisinternal and pg_get_triggerdef(oid) ilike '%AFTER UPDATE OF%'), 4::bigint);
select t.eq('funções novas: nenhuma executável por anon/authenticated',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('_storage_exclusao_valores', '_storage_exclusao_gatilho_jsonb')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0::bigint);
select t.eq('...a security definer tem search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_storage_exclusao_gatilho_jsonb' and p.prosecdef
      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'), 1::bigint);
select t.eq('a 533 NÃO criou tabela nova (a fila é a da 532)', (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'storage_exclusao%'), 1::bigint);
select t.eq('as funções 532 NÃO foram redefinidas: _storage_exclusao_gatilho continua com a assinatura/corpo da 532 (usa execute format, coluna:bucket)',
  position('execute format' in pg_get_functiondef('public._storage_exclusao_gatilho()'::regprocedure)) > 0, true);
select t.eq('toda coluna vigiada pela 533 consta no catálogo de referências (531): o GC e o processador a enxergam',
  (select count(*) from (values ('member_requirements','evidencia_path'), ('member_requirements','rascunho_anexos'),
                                ('member_specialty_requirements','evidencia_path'), ('member_specialty_requirements','rascunho_anexos'),
                                ('experiences','imagem_path'), ('experience_submissions','arquivo_path'), ('suporte_mensagens','anexo_path')) v(tb, col)
    where not exists (select 1 from public._storage_referencias() r where r.tabela = v.tb and v.col = any (r.colunas))), 0::bigint);
select t.eq('_storage_exclusao_valores: texto simples, lista de {path}, lista de strings, nulos e tipos errados',
  (select string_agg(x, ',' order by x) from (
     select * from public._storage_exclusao_valores(to_jsonb('a/b.jpg'::text), false)
     union all select * from public._storage_exclusao_valores('[{"path":"c/d.jpg"},{"path":"  "},{"x":1},"e/f.jpg",5,null]'::jsonb, true)
     union all select * from public._storage_exclusao_valores('null'::jsonb, false)
     union all select * from public._storage_exclusao_valores(null, true)
     union all select * from public._storage_exclusao_valores('{"path":"g"}'::jsonb, true)
     union all select * from public._storage_exclusao_valores('["h/i.jpg"]'::jsonb, false)) q(x)),
  'a/b.jpg,c/d.jpg,e/f.jpg');

-- =============================================================================
--  2. A) member_requirements.evidencia_path
-- =============================================================================
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'p1')); select t.obj('comprovacoes', t.p('membro_a', 'p2')); select t.obj('comprovacoes', t.p('membro_a', 'p3'));
select t.espera('comprovacoes', t.p('membro_a', 'p1')); select t.espera('comprovacoes', t.p('membro_a', 'p2')); select t.espera('comprovacoes', t.p('membro_a', 'p3'));
\o
update public.member_requirements set evidencia_path = t.p('membro_a', 'p1') where id = t.mrn('membro_a', 0);
select t.eq('null -> valor NÃO enfileira (nada foi substituído)', (select count(*) from public.storage_exclusao_fila), 0::bigint);

-- troca pelo CAMINHO REAL do app: a RPC requisito_salvar (coalesce(p_evidencia_path, evidencia_path))
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro troca a foto do requisito pela RPC real (requisito_salvar)',
  format($q$select public.requisito_salvar((select requirement_id from public.member_requirements where id = %L), null, %L)$q$, t.mrn('membro_a', 0), t.p('membro_a', 'p2')));
select t.permitido('...e salvar de novo SEM foto nova (p_evidencia_path nulo) não muda nada',
  format($q$select public.requisito_salvar((select requirement_id from public.member_requirements where id = %L), 'texto', null)$q$, t.mrn('membro_a', 0)));
reset role;
select t.eq('trocar a foto enfileira SÓ a ANTIGA (bucket comprovacoes)', t.fila('member_requirements.evidencia_path'), 'comprovacoes/' || t.p('membro_a', 'p1'));
select t.eq('...a NOVA (p2) NÃO entrou na fila', t.n_fila(t.p('membro_a', 'p2')), 0::bigint);
select t.eq('...pendente, motivo trocado, dono confere, carência de 7 dias',
  (select (estado = 'pendente' and motivo = 'trocado' and dono_confere and dono_linha = t.id('membro_a')
           and processar_apos > now() + interval '6 days 23 hours' and processar_apos <= now() + interval '7 days 1 hour')::text
     from public.storage_exclusao_fila where caminho = t.p('membro_a', 'p1')), 'true');
select t.eq('...o arquivo físico continua lá', t.existe('comprovacoes', t.p('membro_a', 'p1')), true);

-- mesma foto regravada (mesmo caminho; e a mesma foto em URL pública) não enfileira
update public.member_requirements set evidencia_path = evidencia_path where id = t.mrn('membro_a', 0);
update public.member_requirements set evidencia_path = t.p('membro_a', 'p2'), evidencia_texto = 'mudou so o texto' where id = t.mrn('membro_a', 0);
update public.member_requirements set evidencia_path = t.url('comprovacoes', t.p('membro_a', 'p2')) where id = t.mrn('membro_a', 0);
select t.eq('mesma foto regravada (igual, e em URL pública do mesmo arquivo) NÃO enfileira nada novo', (select count(*) from public.storage_exclusao_fila), 1::bigint);
update public.member_requirements set evidencia_path = t.p('membro_a', 'p2') where id = t.mrn('membro_a', 0);

-- trocar de novo ANTES da carência: a mesma linha da fila, sem encurtar
insert into t.snap select 'p1_id', id::text from public.storage_exclusao_fila where caminho = t.p('membro_a', 'p1');
insert into t.snap select 'p1_pa', processar_apos::text from public.storage_exclusao_fila where caminho = t.p('membro_a', 'p1');
update public.member_requirements set evidencia_path = t.p('membro_a', 'p1') where id = t.mrn('membro_a', 0);        -- volta para p1 (p2 sai)
update public.member_requirements set evidencia_path = t.p('membro_a', 'p3') where id = t.mrn('membro_a', 0);        -- p1 sai DE NOVO
select t.eq('p1 saiu duas vezes: continua UMA linha na fila (mesmo id; unique bucket+caminho)',
  (select count(*) || '|' || (min(id::text) = (select v from t.snap where chave = 'p1_id'))::text from public.storage_exclusao_fila where caminho = t.p('membro_a', 'p1')), '1|true');
select t.eq('...e o novo enfileiramento NÃO encurtou a carência', (select (processar_apos >= (select v::timestamptz from t.snap where chave = 'p1_pa'))::text from public.storage_exclusao_fila where caminho = t.p('membro_a', 'p1')), 'true');
select t.eq('...p2 também entrou (saiu da linha), p3 (o atual) NÃO', t.fila('member_requirements.evidencia_path'), 'comprovacoes/' || t.p('membro_a', 'p1') || ',comprovacoes/' || t.p('membro_a', 'p2'));

-- remover (null): enfileira o que estava (guardado como URL: normaliza para bucket/caminho)
update public.member_requirements set evidencia_path = t.url('comprovacoes', t.p('membro_a', 'p3')) where id = t.mrn('membro_a', 0);
update public.member_requirements set evidencia_path = null where id = t.mrn('membro_a', 0);
select t.eq('remover a foto (null) enfileira a que estava (URL do app normalizada para bucket/caminho)',
  t.fila('member_requirements.evidencia_path'), 'comprovacoes/' || t.p('membro_a', 'p1') || ',comprovacoes/' || t.p('membro_a', 'p2') || ',comprovacoes/' || t.p('membro_a', 'p3'));

-- =============================================================================
--  3. A) member_requirements.rascunho_anexos (array jsonb de {path,...})
-- =============================================================================
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'x' || g)) from generate_series(1, 4) g;
select t.espera('comprovacoes', t.p('membro_a', 'x' || g)) from generate_series(1, 4) g;
\o
update public.member_requirements set rascunho_anexos = t.an(t.p('membro_a', 'x1'), t.p('membro_a', 'x2'), t.p('membro_a', 'x3')) where id = t.mrn('membro_a', 1);
select t.eq('lista vazia -> 3 anexos NÃO enfileira', t.fila('member_requirements.rascunho_anexos'), '');
update public.member_requirements set rascunho_anexos = t.an(t.p('membro_a', 'x1'), t.p('membro_a', 'x3')) where id = t.mrn('membro_a', 1);
select t.eq('item REMOVIDO do array enfileira só ele (x2); os mantidos (x1, x3) não', t.fila('member_requirements.rascunho_anexos'), 'comprovacoes/' || t.p('membro_a', 'x2'));
update public.member_requirements set rascunho_anexos = t.an(t.p('membro_a', 'x3'), t.p('membro_a', 'x1')) where id = t.mrn('membro_a', 1);
select t.eq('reordenar o array (mesmos itens) NÃO enfileira nada', t.fila('member_requirements.rascunho_anexos'), 'comprovacoes/' || t.p('membro_a', 'x2'));
update public.member_requirements set rascunho_anexos = (t.an(t.p('membro_a', 'x1'), t.p('membro_a', 'x4')) || '[]'::jsonb) where id = t.mrn('membro_a', 1);
select t.eq('x3 saiu e x4 entrou: só x3 entra na fila (x4, o NOVO, nunca)', t.fila('member_requirements.rascunho_anexos'), 'comprovacoes/' || t.p('membro_a', 'x2') || ',comprovacoes/' || t.p('membro_a', 'x3'));
update public.member_requirements set rascunho_anexos = '[]'::jsonb where id = t.mrn('membro_a', 1);
select t.eq('esvaziar a lista (save de rascunho limpo) enfileira x1 e x4',
  t.fila('member_requirements.rascunho_anexos'), 'comprovacoes/' || t.p('membro_a', 'x1') || ',comprovacoes/' || t.p('membro_a', 'x2') || ',comprovacoes/' || t.p('membro_a', 'x3') || ',comprovacoes/' || t.p('membro_a', 'x4'));
update public.member_requirements set rascunho_anexos = '{"nao":"array"}'::jsonb where id = t.mrn('membro_a', 1);
update public.member_requirements set rascunho_anexos = '[]'::jsonb where id = t.mrn('membro_a', 1);
select t.eq('jsonb que não é array não quebra nem enfileira lixo', (select count(*) from public.storage_exclusao_fila where origem = 'member_requirements.rascunho_anexos'), 4::bigint);

-- o mesmo arquivo continua em OUTRA coluna da MESMA linha (evidencia_path x rascunho_anexos): não enfileira
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'y1')); select t.obj('comprovacoes', t.p('membro_a', 'y2'));
select t.espera('comprovacoes', t.p('membro_a', 'y1'));
\o
update public.member_requirements set evidencia_path = t.p('membro_a', 'y1'), rascunho_anexos = t.an(t.p('membro_a', 'y1'), t.p('membro_a', 'y2')) where id = t.mrn('membro_a', 2);
update public.member_requirements set rascunho_anexos = t.an(t.p('membro_a', 'y2')) where id = t.mrn('membro_a', 2);
select t.eq('y1 saiu do array mas continua em evidencia_path da mesma linha: NÃO enfileira', t.n_fila(t.p('membro_a', 'y1')), 0::bigint);
update public.member_requirements set evidencia_path = null where id = t.mrn('membro_a', 2);
select t.eq('...quando sai também de evidencia_path, enfileira (y2, ainda no array, não)', t.fila('member_requirements.evidencia_path') like '%' || t.p('membro_a', 'y1') and t.n_fila(t.p('membro_a', 'y2')) = 0, true);
-- o mesmo arquivo nas DUAS colunas saindo juntas: UMA linha só
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'z1'));
select t.espera('comprovacoes', t.p('membro_a', 'z1'));
\o
update public.member_requirements set evidencia_path = t.p('membro_a', 'z1'), rascunho_anexos = t.an(t.p('membro_a', 'z1')) where id = t.mrn('membro_a', 3);
update public.member_requirements set evidencia_path = null, rascunho_anexos = '[]'::jsonb where id = t.mrn('membro_a', 3);
select t.eq('o mesmo arquivo nas duas colunas saindo juntas: 1 linha só na fila', t.n_fila(t.p('membro_a', 'z1')), 1::bigint);

-- =============================================================================
--  4. A) DELETE da linha (cascata de matrícula/usuário/clube): tudo que estava guardado
-- =============================================================================
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'd' || g)) from generate_series(1, 3) g;
select t.espera('comprovacoes', t.p('membro_a', 'd' || g)) from generate_series(1, 3) g;
\o
update public.member_requirements set evidencia_path = t.p('membro_a', 'd1'), rascunho_anexos = t.an(t.p('membro_a', 'd2'), t.p('membro_a', 'd3')) where id = t.mrn('membro_a', 4);
insert into t.snap values ('mr_del', t.mrn('membro_a', 4)::text);
delete from public.member_requirements where id = (select v::uuid from t.snap where chave = 'mr_del');
select t.eq('apagar a linha enfileira evidencia_path + cada anexo do rascunho, motivo apagado',
  (select string_agg(caminho || ':' || motivo, ',' order by caminho) from public.storage_exclusao_fila where caminho like '%/requisitos/d_.jpg' and origem like 'member_requirements.%'),
  t.p('membro_a', 'd1') || ':apagado,' || t.p('membro_a', 'd2') || ':apagado,' || t.p('membro_a', 'd3') || ':apagado');

-- =============================================================================
--  5. A) arquivo ENVIADO (histórico imutável) NUNCA é liberado, mesmo saindo do rascunho
-- =============================================================================
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'h1')); select t.obj('comprovacoes', t.p('membro_a', 'h2')); select t.obj('comprovacoes', t.p('membro_a', 'ha1'));
\o
update public.member_requirements set evidencia_path = t.p('membro_a', 'h1'), rascunho_anexos = t.an(t.p('membro_a', 'ha1')) where id = t.mrn('membro_a', 5);
insert into public.requirement_submissions (member_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_path, anexos)
  values (t.mrn('membro_a', 5), 1, 'foto', t.p('membro_a', 'h1'), t.an(t.p('membro_a', 'ha1')));
update public.member_requirements set evidencia_path = t.p('membro_a', 'h2'), rascunho_anexos = '[]'::jsonb where id = t.mrn('membro_a', 5);   -- aluno corrige depois da devolução
select t.eq('após a tentativa enviada, trocar/limpar o rascunho enfileira o antigo (a decisão é do processador)',
  t.n_fila(t.p('membro_a', 'h1')) + t.n_fila(t.p('membro_a', 'ha1')), 2::bigint);

-- =============================================================================
--  6. Referência que VOLTA (mesma linha / outra linha) e objeto ausente / novo demais
-- =============================================================================
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'v1')); select t.obj('comprovacoes', t.p('membro_a', 'v2'));
select t.obj('comprovacoes', t.p('membro_a', 'w1')); select t.obj('comprovacoes', t.p('membro_a', 'w2'));
select t.obj('comprovacoes', t.p('membro_a', 'r1'), '1 day');
select t.espera('comprovacoes', t.p('membro_a', 'v2'));
\o
update public.member_requirements set evidencia_path = t.p('membro_a', 'v1') where id = t.mrn('membro_a', 6);
update public.member_requirements set evidencia_path = t.p('membro_a', 'v2') where id = t.mrn('membro_a', 6);     -- v1 enfileirada
update public.member_requirements set evidencia_path = t.p('membro_a', 'v1') where id = t.mrn('membro_a', 6);     -- v1 VOLTA; v2 enfileirada
update public.member_requirements set evidencia_path = t.p('membro_a', 'w1') where id = t.mrn('membro_a', 7);
update public.member_requirements set evidencia_path = t.p('membro_a', 'w2') where id = t.mrn('membro_a', 7);     -- w1 enfileirada
update public.member_requirements set evidencia_path = t.p('membro_a', 'w1') where id = t.mrn('membro_a', 8);     -- OUTRA linha passa a usar w1
update public.member_requirements set evidencia_path = t.p('membro_a', 'r1') where id = t.mrn('membro_a', 9);
update public.member_requirements set evidencia_path = null where id = t.mrn('membro_a', 9);                       -- r1: objeto com 1 dia
update public.member_requirements set evidencia_path = t.p('membro_a', 'ausente') where id = t.mrn('membro_a', 10);
update public.member_requirements set evidencia_path = null where id = t.mrn('membro_a', 10);                      -- objeto que não existe
select t.eq('v1/v2/w1/r1/ausente entraram na fila (a revalidação é do processador)',
  t.n_fila(t.p('membro_a', 'v1')) + t.n_fila(t.p('membro_a', 'v2')) + t.n_fila(t.p('membro_a', 'w1')) + t.n_fila(t.p('membro_a', 'r1')) + t.n_fila(t.p('membro_a', 'ausente')), 5::bigint);

-- =============================================================================
--  7. ATAQUES: caminho forjado, UUID forjado, bucket protegido
-- =============================================================================
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'vitima')); select t.obj('comprovacoes', t.p('membro_a', 'vitima2'));
select t.obj('comprovacoes', '00000000-0000-4000-8000-0000000000aa/requisitos/uuid-forjado.jpg');
select t.obj('documentos-emitidos', t.id('membro_a') || '/doc.pdf'); select t.obj('publico', 'clube/logo-533.png');
select t.obj('comprovacoes', t.p('membro_b', 'b1')); select t.obj('comprovacoes', t.p('membro_b', 'b2'));
select t.espera('comprovacoes', t.p('membro_b', 'b1'));
\o
-- membro_b (clube B) aponta evidencia_path / anexo para arquivos de OUTRA pessoa (o app não impede o valor) e depois remove
update public.member_requirements set evidencia_path = t.p('membro_a', 'vitima') where id = t.mrn('membro_b', 0);
update public.member_requirements set evidencia_path = null where id = t.mrn('membro_b', 0);
update public.member_requirements set rascunho_anexos = t.an(t.p('membro_a', 'vitima2')) where id = t.mrn('membro_b', 1);
update public.member_requirements set rascunho_anexos = '[]'::jsonb where id = t.mrn('membro_b', 1);
-- membro_a com um UUID que não é o dele
update public.member_requirements set evidencia_path = '00000000-0000-4000-8000-0000000000aa/requisitos/uuid-forjado.jpg' where id = t.mrn('membro_a', 11);
update public.member_requirements set evidencia_path = null where id = t.mrn('membro_a', 11);
-- bucket protegido por URL (evidencia_path e anexo): nem entra na fila
update public.member_requirements set evidencia_path = t.url('documentos-emitidos', t.id('membro_a') || '/doc.pdf'), rascunho_anexos = t.an(t.url('publico', 'clube/logo-533.png')) where id = t.mrn('membro_a', 12);
update public.member_requirements set evidencia_path = null, rascunho_anexos = '[]'::jsonb where id = t.mrn('membro_a', 12);
-- membro_b, caso legítimo, outro clube
update public.member_requirements set evidencia_path = t.p('membro_b', 'b1') where id = t.mrn('membro_b', 2);
update public.member_requirements set evidencia_path = t.p('membro_b', 'b2') where id = t.mrn('membro_b', 2);
select t.eq('forjado (arquivo de A na linha do B): enfileirado com dono_confere = false e dono_linha = B',
  (select dono_confere::text || '|' || (dono_linha = t.id('membro_b'))::text from public.storage_exclusao_fila where caminho = t.p('membro_a', 'vitima')), 'false|true');
select t.eq('forjado em anexo de rascunho: idem', (select dono_confere::text from public.storage_exclusao_fila where caminho = t.p('membro_a', 'vitima2')), 'false');
select t.eq('UUID forjado: dono_confere = false', (select dono_confere::text from public.storage_exclusao_fila where caminho like '%uuid-forjado.jpg'), 'false');
select t.eq('bucket PROTEGIDO (documentos-emitidos/publico) por URL NÃO entra na fila',
  (select count(*) from public.storage_exclusao_fila where bucket in ('documentos-emitidos', 'publico')), 0::bigint);
select t.eq('isolamento multiclube: o caminho legítimo do B entra com dono_linha = B; nenhum item do B aponta dono A',
  (select (dono_linha = t.id('membro_b') and dono_confere)::text from public.storage_exclusao_fila where caminho = t.p('membro_b', 'b1'))
  || '|' || (select count(*) from public.storage_exclusao_fila where dono_linha = t.id('membro_b') and dono_confere and caminho not like t.id('membro_b')::text || '/%')::text, 'true|0');

-- =============================================================================
--  8. B) especialidade (member_specialty_requirements)
-- =============================================================================
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 's' || g)) from generate_series(1, 4) g;
select t.espera('comprovacoes', t.p('membro_a', 's1')); select t.espera('comprovacoes', t.p('membro_a', 's3')); select t.espera('comprovacoes', t.p('membro_a', 's4'));
\o
update public.member_specialty_requirements set evidencia_path = t.p('membro_a', 's1'), rascunho_anexos = t.an(t.p('membro_a', 's3'), t.p('membro_a', 's2')) where id = t.msrn('membro_a', 0);
select t.eq('especialidade: null/[] -> valor não enfileira', t.fila('member_specialty_requirements.evidencia_path') || t.fila('member_specialty_requirements.rascunho_anexos'), '');
update public.member_specialty_requirements set evidencia_path = t.p('membro_a', 's2'), rascunho_anexos = t.an(t.p('membro_a', 's2')) where id = t.msrn('membro_a', 0);
select t.eq('especialidade: trocar a foto enfileira só s1; anexo removido s3 também; s2 (novo e ainda no array) nunca',
  t.fila('member_specialty_requirements.evidencia_path') || '|' || t.fila('member_specialty_requirements.rascunho_anexos'),
  'comprovacoes/' || t.p('membro_a', 's1') || '|comprovacoes/' || t.p('membro_a', 's3'));
update public.member_specialty_requirements set evidencia_path = null, rascunho_anexos = t.an(t.p('membro_a', 's4')) where id = t.msrn('membro_a', 0);
update public.member_specialty_requirements set rascunho_anexos = '[]'::jsonb where id = t.msrn('membro_a', 0);
select t.eq('especialidade: remover enfileira s2 (evidencia) e s4 (anexo removido depois); s2 não duplica entre as colunas', t.n_fila(t.p('membro_a', 's2')) + t.n_fila(t.p('membro_a', 's4')), 2::bigint);
select t.eq('...s2 e s4 enfileirados, ambos esperados na liberação (s2 sem referência restante)', t.n_fila(t.p('membro_a', 's2')), 1::bigint);
\o /dev/null
select t.espera('comprovacoes', t.p('membro_a', 's2'));
update public.member_specialty_requirements set evidencia_path = t.p('membro_a', 'sd1') where id = t.msrn('membro_a', 1);
select t.obj('comprovacoes', t.p('membro_a', 'sd1')); select t.espera('comprovacoes', t.p('membro_a', 'sd1'));
\o
delete from public.member_specialty_requirements where id = t.msrn('membro_a', 1);
select t.eq('especialidade: apagar a linha enfileira o arquivo (DELETE)', (select motivo from public.storage_exclusao_fila where caminho = t.p('membro_a', 'sd1')), 'apagado');

-- =============================================================================
--  9. C) experiences.imagem_path (dono = criado_por) e D) experience_submissions.arquivo_path (upsert)
-- =============================================================================
\o /dev/null
select t.obj('imagens', t.id('lider_a') || '/experiencias/i' || g || '.jpg') from generate_series(1, 4) g;
select t.obj('imagens', 'legado/sem-dono.jpg');
select t.espera('imagens', t.id('lider_a') || '/experiencias/i1.jpg'); select t.espera('imagens', t.id('lider_a') || '/experiencias/i2.jpg');
\o
insert into public.experiences (club_id, tipo, titulo, imagem_path, criado_por) values (t.id('clube_a'), 'desafio_individual', 'E1-533', t.id('lider_a') || '/experiencias/i1.jpg', t.id('lider_a'));
insert into t.ids (chave, id) select 'exp1', id from public.experiences where titulo = 'E1-533';
update public.experiences set imagem_path = t.id('lider_a') || '/experiencias/i2.jpg' where id = t.id('exp1');
select t.eq('experiência: trocar a imagem enfileira só a antiga (bucket imagens, dono = criado_por)',
  t.fila('experiences.imagem_path') || '|' || (select (dono_confere and dono_linha = t.id('lider_a') and motivo = 'trocado')::text from public.storage_exclusao_fila where caminho = t.id('lider_a') || '/experiencias/i1.jpg'),
  'imagens/' || t.id('lider_a') || '/experiencias/i1.jpg|true');
update public.experiences set imagem_path = t.id('lider_a') || '/experiencias/i2.jpg', descricao = 'so a descricao mudou' where id = t.id('exp1');
update public.experiences set imagem_path = null where id = t.id('exp1');
select t.eq('experiência: remover a imagem enfileira a que estava (i2); descrição alterada sozinha não enfileira', t.n_fila(t.id('lider_a') || '/experiencias/i2.jpg'), 1::bigint);
-- cópia compartilha a MESMA imagem (experiencia_duplicar copia imagem_path): apagar o original enfileira, mas o processador mantém
insert into public.experiences (club_id, tipo, titulo, imagem_path, criado_por) values (t.id('clube_a'), 'desafio_individual', 'E2-533', t.id('lider_a') || '/experiencias/i3.jpg', t.id('lider_a'));
insert into public.experiences (club_id, tipo, titulo, imagem_path, criado_por) values (t.id('clube_a'), 'desafio_individual', 'E3-533', t.id('lider_a') || '/experiencias/i3.jpg', t.id('lider_a'));
delete from public.experiences where titulo = 'E2-533';
select t.eq('apagar uma experiência cuja imagem a cópia ainda usa: entra na fila (motivo apagado)', (select motivo from public.storage_exclusao_fila where caminho = t.id('lider_a') || '/experiencias/i3.jpg'), 'apagado');
-- sem criador (criado_por nulo) não há dono confiável: o processador mantém
insert into public.experiences (club_id, tipo, titulo, imagem_path, criado_por) values (t.id('clube_a'), 'desafio_individual', 'E4-533', 'legado/sem-dono.jpg', null);
delete from public.experiences where titulo = 'E4-533';
select t.eq('experiência sem criador: entra com dono_confere = false (fica órfão por segurança, nunca é apagado)', (select dono_confere::text from public.storage_exclusao_fila where caminho = 'legado/sem-dono.jpg'), 'false');

-- D) etapa de experiência: reenvio é UPSERT (experiencia_etapa_enviar: on conflict do update set arquivo_path = excluded.arquivo_path)
\o /dev/null
select t.obj('comprovacoes', t.id('membro_a') || '/experiencias/s1.jpg'); select t.obj('comprovacoes', t.id('membro_a') || '/experiencias/s2.jpg');
select t.espera('comprovacoes', t.id('membro_a') || '/experiencias/s1.jpg'); select t.espera('comprovacoes', t.id('membro_a') || '/experiencias/s2.jpg');
\o
insert into public.experiences (club_id, tipo, titulo, criado_por) values (t.id('clube_a'), 'tarefa_evidencia', 'E5-533', t.id('lider_a'));
insert into t.ids (chave, id) select 'exp5', id from public.experiences where titulo = 'E5-533';
insert into public.experience_stages (club_id, experience_id, ordem, titulo, evidencia) values (t.id('clube_a'), t.id('exp5'), 1, 'Etapa foto', 'foto');
insert into public.experience_participations (club_id, experience_id, usuario_id) values (t.id('clube_a'), t.id('exp5'), t.id('membro_a'));
insert into public.experience_submissions (club_id, experience_id, participation_id, stage_id, ocorrencia, usuario_id, arquivo_path)
  select t.id('clube_a'), t.id('exp5'), p.id, s.id, 1, t.id('membro_a'), t.id('membro_a') || '/experiencias/s1.jpg'
    from public.experience_participations p, public.experience_stages s where p.experience_id = t.id('exp5') and s.experience_id = t.id('exp5');
select t.eq('1º envio da etapa não enfileira', t.fila('experience_submissions.arquivo_path'), '');
insert into public.experience_submissions (club_id, experience_id, participation_id, stage_id, ocorrencia, usuario_id, arquivo_path)
  select t.id('clube_a'), t.id('exp5'), p.id, s.id, 1, t.id('membro_a'), t.id('membro_a') || '/experiencias/s2.jpg'
    from public.experience_participations p, public.experience_stages s where p.experience_id = t.id('exp5') and s.experience_id = t.id('exp5')
  on conflict (participation_id, stage_id, ocorrencia) do update set arquivo_path = excluded.arquivo_path, updated_at = now();
select t.eq('reenvio (UPSERT que troca arquivo_path) enfileira só o ANTIGO (s1)', t.fila('experience_submissions.arquivo_path'), 'comprovacoes/' || t.id('membro_a') || '/experiencias/s1.jpg');
delete from public.experiences where id = t.id('exp5');
select t.eq('apagar a experiência (cascata participação/etapa/envio) enfileira o arquivo vigente (s2)',
  (select string_agg(caminho || ':' || motivo, ',' order by caminho) from public.storage_exclusao_fila where origem = 'experience_submissions.arquivo_path'),
  t.id('membro_a') || '/experiencias/s1.jpg:trocado,' || t.id('membro_a') || '/experiencias/s2.jpg:apagado');

-- =============================================================================
--  10. E) suporte_mensagens.anexo_path (só DELETE: expurgo de chamado fechado há 2 anos / exclusão de conta)
-- =============================================================================
\o /dev/null
select t.obj('suporte-anexos', t.id('membro_a') || '/chamado-1.jpg'); select t.obj('suporte-anexos', t.id('membro_a') || '/chamado-2.jpg');
select t.espera('suporte-anexos', t.id('membro_a') || '/chamado-1.jpg');
\o
insert into public.suporte_chamados (autor_id, categoria, assunto, status, fechado_em) values (t.id('membro_a'), 'duvida', 'Chamado antigo 533', 'fechado', now() - interval '3 years');
insert into public.suporte_mensagens (chamado_id, autor_id, origem, texto, anexo_path)
  select id, t.id('membro_a'), 'usuario', 'com anexo', t.id('membro_a') || '/chamado-1.jpg' from public.suporte_chamados where assunto = 'Chamado antigo 533';
insert into public.suporte_mensagens (chamado_id, autor_id, origem, texto, anexo_path)   -- anexo forjado: arquivo de OUTRA pessoa
  select id, t.id('membro_b'), 'usuario', 'forjado', t.id('membro_a') || '/chamado-2.jpg' from public.suporte_chamados where assunto = 'Chamado antigo 533';
select t.eq('nada enfileirado enquanto o chamado existe', t.fila('suporte_mensagens.anexo_path'), '');
select public.suporte_rotina();            -- o expurgo REAL (fechado há 2+ anos): mensagens vão em cascata
select t.eq('a rotina real de expurgo do suporte apagou o chamado e enfileirou os 2 anexos (bucket suporte-anexos)',
  (select count(*) from public.suporte_chamados where assunto = 'Chamado antigo 533')::text || '|' || t.fila('suporte_mensagens.anexo_path'),
  '0|suporte-anexos/' || t.id('membro_a') || '/chamado-1.jpg,suporte-anexos/' || t.id('membro_a') || '/chamado-2.jpg');
select t.eq('...o anexo do próprio autor confere; o forjado (autor B, arquivo de A) não',
  (select string_agg(dono_confere::text, ',' order by caminho) from public.storage_exclusao_fila where origem = 'suporte_mensagens.anexo_path'), 'true,false');

-- =============================================================================
--  11. PROCESSAMENTO (service_role): carência, revalidação, lote, concorrência
-- =============================================================================
select t.como_service();
select t.eq('dentro da carência (7 dias) NADA é devolvido', t.proc(), '');
reset role;
update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute' where estado = 'pendente';

create table t.lote_1 (bucket text, caminho text);
grant all on t.lote_1 to public;
create table t.lote_2 (bucket text, caminho text);
grant all on t.lote_2 to public;
select t.como_service();
insert into t.lote_1 select * from public._storage_exclusao_processar(50);
select t.ok('LOTE MÁXIMO: com mais de 8 itens vencidos, UMA chamada devolve no máximo 8 (olha 8 candidatos; alguns viram "mantido")', (select count(*) from t.lote_1) <= 8);
insert into t.lote_2 select * from t.tudo();
reset role;
select t.eq('...e as chamadas seguintes entregam o resto (nenhum item repetido entre o 1º lote e os demais)',
  (select count(*) from t.lote_1 a join t.lote_2 b using (bucket, caminho)), 0::bigint);
select t.eq('o CONJUNTO liberado = exatamente os esperados (trocados/removidos/apagados, sem referência, dono confere, objeto >7 dias)',
  (select count(*) from (
     (select * from t.exp except select * from (select * from t.lote_1 union all select * from t.lote_2) u)
     union all
     (select * from (select * from t.lote_1 union all select * from t.lote_2) u except select * from t.exp)) d), 0::bigint);
select t.eq('...e nenhum item foi devolvido duas vezes', (select count(*) from (select * from t.lote_1 union all select * from t.lote_2) u) , (select count(*) from t.exp));

select t.eq('histórico IMUTÁVEL protege: foto enviada (h1) saiu do rascunho e foi MANTIDA', t.est('comprovacoes', t.p('membro_a', 'h1')), 'mantido:referenciado');
select t.eq('...e o anexo enviado (ha1, histórico requirement_submissions.anexos) também', t.est('comprovacoes', t.p('membro_a', 'ha1')), 'mantido:referenciado');
select t.eq('...os dois arquivos continuam existindo', t.existe('comprovacoes', t.p('membro_a', 'h1')) and t.existe('comprovacoes', t.p('membro_a', 'ha1')), true);
select t.eq('arquivo que VOLTOU a ser a foto da própria linha (v1) é mantido', t.est('comprovacoes', t.p('membro_a', 'v1')), 'mantido:referenciado');
select t.eq('arquivo que OUTRA linha passou a usar (w1) é mantido', t.est('comprovacoes', t.p('membro_a', 'w1')), 'mantido:referenciado');
select t.eq('...v1 e w1 continuam existindo', t.existe('comprovacoes', t.p('membro_a', 'v1')) and t.existe('comprovacoes', t.p('membro_a', 'w1')), true);
select t.eq('imagem de experiência ainda usada pela cópia (i3) é mantida', t.est('imagens', t.id('lider_a') || '/experiencias/i3.jpg'), 'mantido:referenciado');
select t.eq('FORJADO (arquivo de A na linha do B) -> mantido dono_diferente, arquivo intacto', t.est('comprovacoes', t.p('membro_a', 'vitima')) || '|' || t.existe('comprovacoes', t.p('membro_a', 'vitima')), 'mantido:dono_diferente|true');
select t.eq('FORJADO em anexo de rascunho -> mantido dono_diferente', t.est('comprovacoes', t.p('membro_a', 'vitima2')), 'mantido:dono_diferente');
select t.eq('UUID forjado -> mantido dono_diferente, arquivo intacto', t.est('comprovacoes', '00000000-0000-4000-8000-0000000000aa/requisitos/uuid-forjado.jpg') || '|' || t.existe('comprovacoes', '00000000-0000-4000-8000-0000000000aa/requisitos/uuid-forjado.jpg'), 'mantido:dono_diferente|true');
select t.eq('anexo de suporte forjado -> mantido dono_diferente, arquivo intacto', t.est('suporte-anexos', t.id('membro_a') || '/chamado-2.jpg') || '|' || t.existe('suporte-anexos', t.id('membro_a') || '/chamado-2.jpg'), 'mantido:dono_diferente|true');
select t.eq('experiência sem criador -> mantido dono_diferente', t.est('imagens', 'legado/sem-dono.jpg'), 'mantido:dono_diferente');
select t.eq('objeto que não existe mais -> mantido objeto_ausente', t.est('comprovacoes', t.p('membro_a', 'ausente')), 'mantido:objeto_ausente');
select t.eq('objeto com menos de 7 dias (r1) continua PENDENTE, reagendado',
  (select (estado = 'pendente' and processar_apos > now() + interval '5 days 23 hours')::text from public.storage_exclusao_fila where caminho = t.p('membro_a', 'r1')), 'true');
select t.eq('bucket protegido continua sem nenhum arquivo apagado', t.existe('documentos-emitidos', t.id('membro_a') || '/doc.pdf') and t.existe('publico', 'clube/logo-533.png'), true);
select t.eq('isolamento: o processamento do B liberou só o arquivo do B (b1) e nada de A por causa dele',
  (select count(*) from (select * from t.lote_1 union all select * from t.lote_2) u where caminho = t.p('membro_b', 'b1')), 1::bigint);
select t.eq('nada foi apagado em storage.objects pelo processamento (quem apaga é só a Edge Function)',
  (select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like t.id('membro_a')::text || '/requisitos/%'), 28::bigint);

-- concorrência: 2ª execução não pega o que a 1ª reservou; reserva expirada volta
select t.como_service();
select t.eq('2ª execução simultânea NÃO devolve nenhum dos itens reservados (sem exclusão dupla)', t.proc(), '');
reset role;
select t.eq('...todos os liberados seguem reservados (10 min)', (select count(*) from public.storage_exclusao_fila where reservado_ate > now() + interval '9 minutes' and estado = 'pendente'), (select count(*) from t.exp));
-- confirmação: excluido idempotente
select t.como_service();
select t.eq('confirmar ok -> excluido (idempotente, e falha posterior não desfaz)',
  public._storage_exclusao_confirmar('comprovacoes', t.p('membro_a', 'p1'), true, 'removido') || '|' || public._storage_exclusao_confirmar('comprovacoes', t.p('membro_a', 'p1'), true, 'removido') || '|' || public._storage_exclusao_confirmar('comprovacoes', t.p('membro_a', 'p1'), false, 'erro'),
  'excluido|excluido|excluido');
reset role;
select t.eq('...e depois de excluído o item não volta ao processamento', (select count(*) from t.tudo() where caminho = t.p('membro_a', 'p1')), 0::bigint);

-- falha da Edge Function (storage-excluir): recuo, retry, 5ª tentativa = falhou + infra_falhas. Alvo: p2 (reservado, pendente).
select t.como_service();
select t.eq('falha 1 -> pendente, recuo ~1h, sem reserva',
  public._storage_exclusao_confirmar('comprovacoes', t.p('membro_a', 'p2'), false, 'erro_api 500 ' || t.id('membro_a')), 'pendente');
reset role;
select t.eq('...tentativas = 1, recuo de ~1h, e a mensagem não guarda o uuid',
  (select (tentativas = 1 and processar_apos > now() + interval '59 minutes' and processar_apos <= now() + interval '61 minutes' and reservado_ate is null
           and ultima_mensagem not like '%' || t.id('membro_a')::text || '%')::text from public.storage_exclusao_fila where caminho = t.p('membro_a', 'p2')), 'true');
select t.eq('...dentro do recuo o processador NÃO devolve o item (não martela a API)', (select count(*) from t.tudo() where caminho = t.p('membro_a', 'p2')), 0::bigint);
do $$ declare i int; v_r text;
begin
  for i in 2 .. 5 loop
    update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute' where caminho = t.p('membro_a', 'p2');
    perform count(*) from t.tudo();
    v_r := public._storage_exclusao_confirmar('comprovacoes', t.p('membro_a', 'p2'), false, 'erro_api 500');
    insert into t.res (nome, ok, detalhe) values ('falha ' || i || ' -> ' || case when i < 5 then 'pendente' else 'falhou' end, v_r = case when i < 5 then 'pendente' else 'falhou' end, 'obtido=' || v_r);
  end loop;
end $$;
select t.eq('teto de tentativas: falhou|5 e registrado em infra_falhas (sem caminho/uuid)',
  (select estado || '|' || tentativas from public.storage_exclusao_fila where caminho = t.p('membro_a', 'p2')) || '|' ||
  (select count(*) from public.infra_falhas where origem = 'storage/exclusao' and detalhe not like '%/requisitos/%' and detalhe !~* '[0-9a-f]{8}-[0-9a-f]{4}-')::text, 'falhou|5|1');
select t.eq('...o arquivo continua existindo (falha não apaga)', t.existe('comprovacoes', t.p('membro_a', 'p2')), true);

-- um item novo depois do dreno: reservado só para UMA execução
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'q1'));
update public.member_requirements set evidencia_path = t.p('membro_a', 'q1') where id = t.mrn('membro_a', 13);
update public.member_requirements set evidencia_path = null where id = t.mrn('membro_a', 13);
update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute' where caminho = t.p('membro_a', 'q1');
\o
select t.como_service();
select t.eq('item novo vencido: 1ª execução devolve, 2ª NÃO (concorrência)', t.proc() || '|' || t.proc(), 'comprovacoes/' || t.p('membro_a', 'q1') || '|');
reset role;

-- lote máximo, prova exata: 12 itens limpos vencidos -> uma chamada devolve 8, a seguinte 4, a seguinte 0
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'lt' || g)) from generate_series(1, 12) g;
update public.member_requirements set rascunho_anexos = t.an(variadic (select array_agg(t.p('membro_a', 'lt' || g)) from generate_series(1, 12) g)) where id = t.mrn('membro_a', 15);
update public.member_requirements set rascunho_anexos = '[]'::jsonb where id = t.mrn('membro_a', 15);
update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute' where caminho like '%/requisitos/lt%';
\o
select t.eq('12 itens enfileirados pelo esvaziamento do rascunho', (select count(*) from public.storage_exclusao_fila where caminho like '%/requisitos/lt%' and estado = 'pendente'), 12::bigint);
select t.como_service();
select t.eq('LOTE MÁXIMO exato: 1ª chamada devolve 8, a 2ª devolve 4, a 3ª 0',
  (select count(*) from public._storage_exclusao_processar(50))::text || '|' || (select count(*) from public._storage_exclusao_processar(50))::text || '|' || (select count(*) from public._storage_exclusao_processar(50))::text, '8|4|0');
reset role;

-- =============================================================================
--  12. O gatilho NUNCA derruba a operação do usuário (fila quebrada de propósito)
-- =============================================================================
\o /dev/null
select t.obj('comprovacoes', t.p('membro_a', 'k1')); select t.obj('comprovacoes', t.p('membro_a', 'k2'));
update public.member_requirements set evidencia_path = t.p('membro_a', 'k1') where id = t.mrn('membro_a', 14);
\o
alter table public.storage_exclusao_fila add constraint zz_quebra_de_proposito_533 check (bucket = 'nunca') not valid;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('com a fila QUEBRADA, o membro ainda troca a foto do requisito (RPC real)',
  format($q$select public.requisito_salvar((select requirement_id from public.member_requirements where id = %L), null, %L)$q$, t.mrn('membro_a', 14), t.p('membro_a', 'k2')));
reset role;
select t.eq('...a troca valeu (k2 é a foto do requisito)', (select evidencia_path from public.member_requirements where id = t.mrn('membro_a', 14)), t.p('membro_a', 'k2'));
select t.eq('...e o problema ficou registrado em infra_falhas', (select count(*) from public.infra_falhas where origem = 'storage/exclusao-gatilho'), 1::bigint);
alter table public.storage_exclusao_fila drop constraint zz_quebra_de_proposito_533;

-- =============================================================================
--  13. A 533 não afrouxou a 532 e nada físico foi apagado pelo SQL
-- =============================================================================
select t.eq('cron "storage-excluir" continua DESLIGADO (a 533 não mexe no cron)', (select count(*) from cron.job where jobname = 'storage-excluir' and not active), 1::bigint);
select t.eq('os buckets elegíveis continuam os 4 da 532', (public._storage_exclusao_politica() -> 'buckets_elegiveis')::text, '["imagens", "comprovacoes", "comunidade", "suporte-anexos"]');
select t.eq('...carência 7 dias e lote máximo 8', (public._storage_exclusao_politica() ->> 'carencia_dias') || '|' || (public._storage_exclusao_politica() ->> 'lote_maximo'), '7|8');
select t.eq('anon/authenticated não leem a fila (RLS + sem grant)', (has_table_privilege('anon', 'public.storage_exclusao_fila', 'select') or has_table_privilege('authenticated', 'public.storage_exclusao_fila', 'select'))::text, 'false');

select t.fim();
rollback;
