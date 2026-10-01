-- FILA DE SANEAMENTO DE IMAGENS (migration 529) — a Edge Function `sanear-imagens` lê/remove metadados/regrava; o banco guarda a FILA.
-- Prova: anon não executa nada; authenticated só enfileira/consulta o PRÓPRIO objeto no formato de caminho das policies de upload
-- (nunca caminho forjado de outra pessoa, de outro clube, de bucket fora do escopo ou de objeto que não existe — mesma mensagem);
-- tabela e rotinas internas fechadas (só service_role); idempotência; estados pendente/ok/falhou/ignorado com recuo e 3 tentativas;
-- versão do arquivo (upload novo volta para a fila e o resultado do processamento antigo não vale); varredura pega o que um cliente
-- adulterado subiu sem chamar a RPC; owner restaurado após regravar; porta "liberada" para a Rede; sem dado pessoal na tabela.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.mk('dir_dois', 'Dir Dois Clubes', 'diretoria', 'ativo', 'clube_a');
select t.mk2('dir_dois', 'desbravador', 'ativo', 'clube_b', 'B1');
create function t.u(p_n int) returns text language sql immutable as $$ select lpad(p_n::text, 8, '0') || '-0000-0000-0000-000000000000' $$;
create function t.obj(p_bucket text, p_nome text, p_dono text default null, p_mime text default 'image/jpeg', p_idade interval default '0 seconds') returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata, created_at, updated_at)
  values (p_bucket, p_nome, case when p_dono is null then null else t.id(p_dono)::text end,
          jsonb_build_object('mimetype', p_mime, 'size', 120000), now() - p_idade, now() - p_idade);
end $$;
create function t.est(p_bucket text, p_nome text) returns text language sql security definer set search_path = '' as $$
  select estado from public.imagem_saneamento where bucket = p_bucket and caminho = p_nome $$;
create function t.linha(p_bucket text, p_nome text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.imagem_saneamento where bucket = p_bucket and caminho = p_nome $$;
create function t.ver(p_bucket text, p_nome text) returns timestamptz language sql security definer set search_path = '' as $$
  select updated_at from storage.objects where bucket_id = p_bucket and name = p_nome $$;

-- objetos (como postgres: o upload em si é coberto pelas policies de Storage, testes 25/104)
select t.obj('comunidade', t.id('clube_a') || '/' || t.id('membro_a') || '/' || t.u(1) || '.webp', 'membro_a');
select t.obj('comunidade', t.id('clube_b') || '/' || t.id('membro_b') || '/' || t.u(2) || '.jpg', 'membro_b');
select t.obj('comunidade', t.id('clube_a') || '/' || t.id('dir_dois') || '/' || t.u(3) || '.jpg', 'dir_dois');
select t.obj('comunidade', t.id('clube_b') || '/' || t.id('dir_dois') || '/' || t.u(4) || '.jpg', 'dir_dois');
select t.obj('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg', 'membro_a');
select t.obj('imagens', 'perfis/' || t.id('membro_b') || '-1.jpg', 'membro_b');
select t.obj('imagens', 'mural/' || t.id('membro_a') || '-foto.jpg', 'membro_a');
select t.obj('comprovacoes', t.id('clube_a') || '/' || t.id('membro_a') || '/requisitos/a.jpg', 'membro_a');
select t.obj('comprovacoes', t.id('membro_a') || '/requisitos/legado.jpg', 'membro_a');
select t.obj('comprovacoes', t.id('clube_a') || '/' || t.id('membro_a') || '/requisitos/laudo.pdf', 'membro_a', 'application/pdf');
select t.obj('suporte-anexos', t.id('membro_a') || '/' || t.u(5) || '.png', 'membro_a', 'image/png');
select t.obj('publico', 'clube/logo.png', null, 'image/png');
select t.obj('documentos-emitidos', t.id('membro_a') || '/doc.png', 'membro_a', 'image/png');
reset role;
\o

-- =============================================================================
--  1. Estrutura e fechaduras
-- =============================================================================
select t.eq('tabela com RLS ligado', (select relrowsecurity from pg_class where oid = 'public.imagem_saneamento'::regclass), true);
select t.eq('...e SEM nenhuma policy (só service_role/postgres)', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'imagem_saneamento'), 0::bigint);
select t.eq('só 4 estados válidos', (select count(*) from pg_constraint where conrelid = 'public.imagem_saneamento'::regclass and pg_get_constraintdef(oid) ilike '%pendente%ok%falhou%ignorado%'), 1::bigint);
select t.eq('sem dado pessoal na fila: nenhuma coluna de nome/e-mail/legenda/conteúdo',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'imagem_saneamento'
    and column_name ~* '(nome|email|legenda|texto|conteudo|descricao|telefone|cpf|gps|lat|lon)'), 0::bigint);
select t.eq('só os 4 buckets do escopo (publico, parceiros, documentos-emitidos, assinaturas fora)',
  (select count(*) from pg_constraint where conrelid = 'public.imagem_saneamento'::regclass and pg_get_constraintdef(oid) ilike '%imagens%comprovacoes%comunidade%suporte-anexos%'), 1::bigint);

select t.como_anon();
select t.throws('anon NÃO enfileira', $q$select public.imagem_saneamento_enfileirar('comunidade', 'x')$q$, 'permission denied');
select t.throws('anon NÃO consulta estado', $q$select public.imagem_saneamento_estado('comunidade', 'x')$q$, 'permission denied');
select t.throws('anon NÃO lê a tabela', $q$select count(*) from public.imagem_saneamento$q$, 'permission denied');
select t.throws('anon NÃO reserva lote', $q$select * from public.imagem_saneamento_pendentes(5)$q$, 'permission denied');
select t.throws('anon NÃO marca', $q$select public.imagem_saneamento_marcar(gen_random_uuid(), 'ok')$q$, 'permission denied');
select t.throws('anon NÃO varre', $q$select public.imagem_saneamento_varrer(2)$q$, 'permission denied');
select t.throws('anon NÃO executa o interno de permissão', $q$select public._imagem_saneamento_pode('comunidade', 'x')$q$, 'permission denied');

select t.como('membro_a');
select t.throws('authenticated NÃO lê a tabela', $q$select count(*) from public.imagem_saneamento$q$, 'permission denied');
select t.throws('authenticated NÃO escreve na tabela', $q$insert into public.imagem_saneamento (bucket, caminho) values ('comunidade', 'a/b/c.jpg')$q$, 'permission denied');
select t.throws('authenticated NÃO reserva lote', $q$select * from public.imagem_saneamento_pendentes(5)$q$, 'permission denied');
select t.throws('authenticated NÃO marca resultado', $q$select public.imagem_saneamento_marcar(gen_random_uuid(), 'ok')$q$, 'permission denied');
select t.throws('authenticated NÃO confere versão', $q$select public.imagem_saneamento_conferir(gen_random_uuid(), now())$q$, 'permission denied');
select t.throws('authenticated NÃO varre', $q$select public.imagem_saneamento_varrer(2)$q$, 'permission denied');
select t.throws('authenticated NÃO roda a rotina', $q$select public.imagem_saneamento_rotina()$q$, 'permission denied');
select t.throws('authenticated NÃO chama o interno "liberada"', $q$select public._imagem_saneamento_liberada('comunidade', 'x')$q$, 'permission denied');

-- =============================================================================
--  2. Enfileirar o PRÓPRIO objeto (e só ele)
-- =============================================================================
select t.como('membro_a');
select t.eq('membro_a enfileira a própria foto da Rede', (select public.imagem_saneamento_enfileirar('comunidade', t.id('clube_a') || '/' || t.id('membro_a') || '/' || t.u(1) || '.webp') ->> 'estado'), 'pendente');
select t.eq('...segunda chamada é idempotente (continua 1 linha, pendente)',
  (select public.imagem_saneamento_enfileirar('comunidade', t.id('clube_a') || '/' || t.id('membro_a') || '/' || t.u(1) || '.webp') ->> 'estado'), 'pendente');
select t.eq('avatar próprio', public.imagem_saneamento_enfileirar('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg') ->> 'estado', 'pendente');
select t.eq('foto do mural própria (membro ativo)', public.imagem_saneamento_enfileirar('imagens', 'mural/' || t.id('membro_a') || '-foto.jpg') ->> 'estado', 'pendente');
select t.eq('comprovação própria (formato novo clube/usuário)', public.imagem_saneamento_enfileirar('comprovacoes', t.id('clube_a') || '/' || t.id('membro_a') || '/requisitos/a.jpg') ->> 'estado', 'pendente');
select t.eq('comprovação própria (formato legado usuário/...)', public.imagem_saneamento_enfileirar('comprovacoes', t.id('membro_a') || '/requisitos/legado.jpg') ->> 'estado', 'pendente');
select t.eq('anexo de suporte próprio', public.imagem_saneamento_enfileirar('suporte-anexos', t.id('membro_a') || '/' || t.u(5) || '.png') ->> 'estado', 'pendente');
select t.eq('estado do próprio objeto', public.imagem_saneamento_estado('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg'), 'pendente');
select t.eq('estado de objeto próprio nunca enfileirado = nenhum',
  public.imagem_saneamento_estado('comprovacoes', t.id('clube_a') || '/' || t.id('membro_a') || '/requisitos/laudo.pdf'), 'nenhum');

-- caminho forjado / fora do escopo: SEMPRE a mesma mensagem (não vaza se o objeto existe)
select t.throws('NÃO enfileira a foto de outra pessoa (mesmo clube/pasta alheia)', format($q$select public.imagem_saneamento_enfileirar('comunidade', %L)$q$, t.id('clube_b') || '/' || t.id('membro_b') || '/' || t.u(2) || '.jpg'), 'Objeto inválido.');
select t.throws('NÃO enfileira o avatar de outra pessoa', format($q$select public.imagem_saneamento_enfileirar('imagens', %L)$q$, 'perfis/' || t.id('membro_b') || '-1.jpg'), 'Objeto inválido.');
select t.throws('NÃO enfileira pasta de OUTRO clube com o próprio uid (clube em uso é o A)', format($q$select public.imagem_saneamento_enfileirar('comunidade', %L)$q$, t.id('clube_b') || '/' || t.id('membro_a') || '/' || t.u(9) || '.jpg'), 'Objeto inválido.');
select t.throws('NÃO enfileira objeto que não existe (próprio formato)', format($q$select public.imagem_saneamento_enfileirar('comunidade', %L)$q$, t.id('clube_a') || '/' || t.id('membro_a') || '/' || t.u(99) || '.jpg'), 'Objeto inválido.');
select t.throws('NÃO enfileira bucket fora do escopo (publico/logo)', $q$select public.imagem_saneamento_enfileirar('publico', 'clube/logo.png')$q$, 'Objeto inválido.');
select t.throws('NÃO enfileira bucket fora do escopo (documentos-emitidos)', format($q$select public.imagem_saneamento_enfileirar('documentos-emitidos', %L)$q$, t.id('membro_a') || '/doc.png'), 'Objeto inválido.');
select t.throws('NÃO enfileira bucket inexistente', $q$select public.imagem_saneamento_enfileirar('qualquer', 'a/b.jpg')$q$, 'Objeto inválido.');
select t.throws('NÃO enfileira com bucket/caminho nulos', $q$select public.imagem_saneamento_enfileirar(null, null)$q$, 'Objeto inválido.');
select t.throws('NÃO enfileira caminho gigante', $q$select public.imagem_saneamento_enfileirar('imagens', repeat('a', 600))$q$, 'Objeto inválido.');
select t.throws('NÃO enfileira a pasta de comprovação de outra pessoa', format($q$select public.imagem_saneamento_enfileirar('comprovacoes', %L)$q$, t.id('membro_b') || '/requisitos/x.jpg'), 'Objeto inválido.');
select t.throws('NÃO consulta estado de objeto alheio', format($q$select public.imagem_saneamento_estado('imagens', %L)$q$, 'perfis/' || t.id('membro_b') || '-1.jpg'), 'Objeto inválido.');
select t.eq('mensagem idêntica para "existe e é de outro" e "não existe"',
  t.txt(format($q$select public.imagem_saneamento_enfileirar('imagens', %L)$q$, 'perfis/' || t.id('membro_b') || '-1.jpg')),
  t.txt(format($q$select public.imagem_saneamento_enfileirar('imagens', %L)$q$, 'perfis/' || t.id('membro_a') || '-nao-existe.jpg')));

select t.como('membro_b');
select t.throws('membro_b NÃO enfileira o avatar do membro_a', format($q$select public.imagem_saneamento_enfileirar('imagens', %L)$q$, 'perfis/' || t.id('membro_a') || '-1.jpg'), 'Objeto inválido.');
select t.throws('membro_b NÃO enxerga o estado do objeto do membro_a', format($q$select public.imagem_saneamento_estado('imagens', %L)$q$, 'perfis/' || t.id('membro_a') || '-1.jpg'), 'Objeto inválido.');
select t.eq('membro_b enfileira o próprio (clube B)', public.imagem_saneamento_enfileirar('comunidade', t.id('clube_b') || '/' || t.id('membro_b') || '/' || t.u(2) || '.jpg') ->> 'estado', 'pendente');

-- multiclube: o clube EM USO decide o caminho aceito
select t.como('dir_dois');
select t.pedir_clube('clube_b');
select t.throws('clube em uso B: NÃO enfileira a pasta do clube A', format($q$select public.imagem_saneamento_enfileirar('comunidade', %L)$q$, t.id('clube_a') || '/' || t.id('dir_dois') || '/' || t.u(3) || '.jpg'), 'Objeto inválido.');
select t.eq('clube em uso B: enfileira a pasta do clube B', public.imagem_saneamento_enfileirar('comunidade', t.id('clube_b') || '/' || t.id('dir_dois') || '/' || t.u(4) || '.jpg') ->> 'estado', 'pendente');
select t.pedir_clube('clube_a');
select t.eq('clube em uso A: enfileira a pasta do clube A', public.imagem_saneamento_enfileirar('comunidade', t.id('clube_a') || '/' || t.id('dir_dois') || '/' || t.u(3) || '.jpg') ->> 'estado', 'pendente');

reset role;
select t.eq('1 linha por objeto (idempotência real)', (select count(*) from public.imagem_saneamento where bucket = 'comunidade' and caminho like t.id('clube_a') || '/' || t.id('membro_a') || '/%'), 1::bigint);
select t.eq('clube da linha vem do caminho (A)', (select club_id from public.imagem_saneamento where bucket = 'comunidade' and caminho like t.id('clube_a') || '/' || t.id('membro_a') || '/%'), t.id('clube_a'));
select t.eq('clube da linha (B)', (select club_id from public.imagem_saneamento where bucket = 'comunidade' and caminho like t.id('clube_b') || '/' || t.id('membro_b') || '/%'), t.id('clube_b'));
select t.ok('formato legado sem clube: club_id nulo', (select club_id is null from public.imagem_saneamento where bucket = 'comprovacoes' and caminho = t.id('membro_a') || '/requisitos/legado.jpg'));
select t.eq('dono do objeto guardado (para restaurar o owner)', (select dono_id from public.imagem_saneamento where bucket = 'imagens' and caminho = 'perfis/' || t.id('membro_a') || '-1.jpg'), t.id('membro_a'));
select t.eq('nada de bucket fora do escopo na fila', (select count(*) from public.imagem_saneamento where bucket not in ('imagens', 'comprovacoes', 'comunidade', 'suporte-anexos')), 0::bigint);

-- =============================================================================
--  3. Edge Function (service_role): reservar, conferir, marcar
-- =============================================================================
select t.como_service();
select t.ok('service_role reserva um lote', (select count(*) from public.imagem_saneamento_pendentes(100)) >= 8);
select t.eq('...e o MESMO lote não volta enquanto reservado', (select count(*) from public.imagem_saneamento_pendentes(100)), 0::bigint);
reset role;
select t.ok('reserva tem prazo (5 min)', (select count(*) from public.imagem_saneamento where reservado_ate > now() + interval '4 minutes' and reservado_ate <= now() + interval '5 minutes') >= 8);

-- alvo: avatar do membro_a
create table t.alvo as select t.linha('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg') as id, t.ver('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg') as v;
grant select on t.alvo to public;
select t.como_service();
select t.eq('conferir: versão atual confere', public.imagem_saneamento_conferir((select id from t.alvo), (select v from t.alvo)), true);
select t.eq('conferir: versão antiga NÃO confere', public.imagem_saneamento_conferir((select id from t.alvo), (select v from t.alvo) - interval '1 hour'), false);
select t.throws('marcar com estado inválido', $q$select public.imagem_saneamento_marcar((select id from t.alvo), 'pendente')$q$, 'Estado inválido');
select t.throws('marcar item inexistente', $q$select public.imagem_saneamento_marcar(gen_random_uuid(), 'ok')$q$, 'não encontrado');
select t.eq('marcar ok', public.imagem_saneamento_marcar((select id from t.alvo), 'ok', 'saneada', (select v from t.alvo), 1000, 800, false), 'ok');
select t.eq('marcar de novo (já resolvido) é idempotente', public.imagem_saneamento_marcar((select id from t.alvo), 'falhou', 'erro', (select v from t.alvo)), 'ok');
reset role;
select t.eq('estado ok com bytes e data', (select estado || '|' || bytes_antes || '|' || bytes_depois || '|' || (saneada_em is not null) from public.imagem_saneamento where id = (select id from t.alvo)), 'ok|1000|800|true');
select t.eq('porta da Rede: "liberada" depois de ok', public._imagem_saneamento_liberada('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg'), true);
select t.eq('...e NÃO liberada para quem nunca foi saneado', public._imagem_saneamento_liberada('imagens', 'perfis/' || t.id('membro_b') || '-1.jpg'), false);

-- upload novo no mesmo caminho: a "liberação" cai e o app volta o item para a fila
set local session_replication_role = replica;   -- o gatilho do Storage reescreve updated_at = now(); aqui simulamos tempo passando
update storage.objects set updated_at = now() + interval '2 minutes' where bucket_id = 'imagens' and name = 'perfis/' || t.id('membro_a') || '-1.jpg';
set local session_replication_role = origin;
select t.eq('arquivo regravado DEPOIS do saneamento: não está mais liberada', public._imagem_saneamento_liberada('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg'), false);
select t.como('membro_a');
select t.eq('reenfileirar com arquivo novo volta para pendente', public.imagem_saneamento_enfileirar('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg') ->> 'estado', 'pendente');
reset role;
select t.eq('...com tentativas zeradas e versão nova', (select tentativas || '|' || (objeto_versao = (select updated_at from storage.objects where bucket_id = 'imagens' and name = 'perfis/' || t.id('membro_a') || '-1.jpg'))::text from public.imagem_saneamento where id = (select id from t.alvo)), '0|true');
select t.como_service();
select t.eq('resultado de processamento da versão ANTIGA não vale', public.imagem_saneamento_marcar((select id from t.alvo), 'ok', 'saneada', (select v from t.alvo)), 'versao_mudou');
reset role;
select t.eq('...e o item segue pendente', t.est('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg'), 'pendente');

-- falha: recuo e 3 tentativas
create table t.alvo2 as select t.linha('imagens', 'mural/' || t.id('membro_a') || '-foto.jpg') as id, t.ver('imagens', 'mural/' || t.id('membro_a') || '-foto.jpg') as v;
grant select on t.alvo2 to public;
select t.como_service();
select t.eq('falha 1: volta para pendente (recuo)', public.imagem_saneamento_marcar((select id from t.alvo2), 'falhou', 'erro_download', (select v from t.alvo2)), 'pendente');
reset role;
select t.ok('...com próxima tentativa no futuro e reserva liberada', (select proxima_em > now() + interval '5 minutes' and reservado_ate is null and tentativas = 1 from public.imagem_saneamento where id = (select id from t.alvo2)));
select t.como_service();
select t.ok('...e fora do lote enquanto está em recuo', not exists (select 1 from public.imagem_saneamento_pendentes(100) p where p.id = (select id from t.alvo2)));
select t.eq('falha 2: pendente', public.imagem_saneamento_marcar((select id from t.alvo2), 'falhou', 'erro_upload', (select v from t.alvo2)), 'pendente');
select t.eq('falha 3: FALHOU (para de tentar)', public.imagem_saneamento_marcar((select id from t.alvo2), 'falhou', 'invalida', (select v from t.alvo2)), 'falhou');
reset role;
select t.eq('falhou guarda o código do motivo e 3 tentativas', (select motivo || '|' || tentativas from public.imagem_saneamento where id = (select id from t.alvo2)), 'invalida|3');
select t.eq('falhou NÃO libera a imagem para a Rede', public._imagem_saneamento_liberada('imagens', 'mural/' || t.id('membro_a') || '-foto.jpg'), false);

-- ignorado (HEIC etc.) é terminal e não quebra
create table t.alvo3 as select t.linha('suporte-anexos', t.id('membro_a') || '/' || t.u(5) || '.png') as id, t.ver('suporte-anexos', t.id('membro_a') || '/' || t.u(5) || '.png') as v;
grant select on t.alvo3 to public;
select t.como_service();
select t.eq('ignorado (formato não suportado)', public.imagem_saneamento_marcar((select id from t.alvo3), 'ignorado', 'heic_nao_suportado', (select v from t.alvo3)), 'ignorado');
select t.ok('...não volta no lote', not exists (select 1 from public.imagem_saneamento_pendentes(100) p where p.id = (select id from t.alvo3)));
reset role;
select t.eq('...e também não é "liberada" (só ok libera)', public._imagem_saneamento_liberada('suporte-anexos', t.id('membro_a') || '/' || t.u(5) || '.png'), false);

-- regravar pela API com service_role pode zerar o dono: o banco restaura (policies do bucket 'imagens' dependem do dono)
\o /dev/null
select t.como('membro_b');
select public.imagem_saneamento_enfileirar('imagens', 'perfis/' || t.id('membro_b') || '-1.jpg');
reset role;
create table t.alvo4 as select id, objeto_versao as v from public.imagem_saneamento where caminho = 'perfis/' || t.id('membro_b') || '-1.jpg';
grant select on t.alvo4 to public;
-- simula a regravação do saneador: dono zerado e updated_at novo (a função processou a versão V0, registrada em alvo4)
set local session_replication_role = replica;   -- o gatilho do Storage reescreve updated_at = now(); aqui simulamos tempo passando
update storage.objects set owner_id = null, owner = null, updated_at = now() + interval '1 second' where bucket_id = 'imagens' and name = 'perfis/' || t.id('membro_b') || '-1.jpg';
set local session_replication_role = origin;
\o
select t.eq('antes de marcar, o dono está zerado', (select public.dono_do_objeto(owner, owner_id) is null from storage.objects where bucket_id = 'imagens' and name = 'perfis/' || t.id('membro_b') || '-1.jpg'), true);
select t.como_service();
select t.eq('marcar ok (reescrito) com a versão que a função processou', public.imagem_saneamento_marcar((select id from t.alvo4), 'ok', 'saneada', (select v from t.alvo4), 5000, 4000, true), 'ok');
reset role;
select t.eq('dono do objeto RESTAURADO após a regravação', (select public.dono_do_objeto(owner, owner_id) from storage.objects where bucket_id = 'imagens' and name = 'perfis/' || t.id('membro_b') || '-1.jpg'), t.id('membro_b'));
select t.eq('...e a versão nova foi registrada (varredura não enfileira de novo)', (select s.objeto_versao = coalesce(o.updated_at, o.created_at) from public.imagem_saneamento s join storage.objects o on o.bucket_id = s.bucket and o.name = s.caminho where s.caminho = 'perfis/' || t.id('membro_b') || '-1.jpg'), true);
select t.eq('...e fica liberada', public._imagem_saneamento_liberada('imagens', 'perfis/' || t.id('membro_b') || '-1.jpg'), true);

-- =============================================================================
--  4. Varredura (pega o cliente adulterado) e rotina
-- =============================================================================
\o /dev/null
select t.obj('comunidade', t.id('clube_a') || '/' || t.id('membro_a2') || '/' || t.u(7) || '.jpg', 'membro_a2');                   -- subiu e NÃO chamou a RPC
select t.obj('comprovacoes', t.id('clube_a') || '/' || t.id('membro_a2') || '/documentos/d.jpg', 'membro_a2');
select t.obj('comunidade', t.id('clube_a') || '/' || t.id('membro_a2') || '/' || t.u(8) || '.jpg', 'membro_a2', 'image/jpeg', interval '10 days'); -- antigo
\o
select t.como_service();
select t.ok('varrer(2) enfileira o que ninguém enfileirou (>= 2)', public.imagem_saneamento_varrer(2) >= 2);
reset role;
select t.eq('...a foto do cliente adulterado entrou na fila (com clube)', (select estado || '|' || (club_id = t.id('clube_a'))::text from public.imagem_saneamento where caminho = t.id('clube_a') || '/' || t.id('membro_a2') || '/' || t.u(7) || '.jpg'), 'pendente|true');
select t.eq('...a foto de documento também', t.est('comprovacoes', t.id('clube_a') || '/' || t.id('membro_a2') || '/documentos/d.jpg'), 'pendente');
select t.ok('...objeto ANTIGO fica de fora da janela de 2 dias', t.est('comunidade', t.id('clube_a') || '/' || t.id('membro_a2') || '/' || t.u(8) || '.jpg') is null);
select t.ok('...PDF não entra', t.est('comprovacoes', t.id('clube_a') || '/' || t.id('membro_a') || '/requisitos/laudo.pdf') is null);
select t.eq('...nem bucket fora do escopo (logo público, documentos emitidos)', (select count(*) from public.imagem_saneamento where bucket in ('publico', 'documentos-emitidos')), 0::bigint);
select t.como_service();
select t.eq('varrer de novo não duplica nem mexe (idempotente)', public.imagem_saneamento_varrer(2), 0::bigint);
select t.ok('backfill (varrer 30 dias) pega o antigo', public.imagem_saneamento_varrer(30) >= 1);
reset role;
select t.eq('...o antigo entrou', t.est('comunidade', t.id('clube_a') || '/' || t.id('membro_a2') || '/' || t.u(8) || '.jpg'), 'pendente');
-- item já saneado NÃO volta na varredura se o arquivo não mudou; volta se mudou
select t.eq('item ok não é reaberto pela varredura (arquivo igual)', t.est('imagens', 'perfis/' || t.id('membro_b') || '-1.jpg'), 'ok');
\o /dev/null
select t.como_service();
select public.imagem_saneamento_varrer(2);
reset role;
\o
select t.eq('...continua ok depois de varrer', t.est('imagens', 'perfis/' || t.id('membro_b') || '-1.jpg'), 'ok');
set local session_replication_role = replica;   -- o gatilho do Storage reescreve updated_at = now(); aqui simulamos tempo passando
update storage.objects set updated_at = now() + interval '1 hour' where bucket_id = 'imagens' and name = 'perfis/' || t.id('membro_b') || '-1.jpg';
set local session_replication_role = origin;
select t.como_service();
select t.ok('arquivo regravado por cliente adulterado: a varredura reabre', public.imagem_saneamento_varrer(2) >= 1);
reset role;
select t.eq('...voltou para pendente', t.est('imagens', 'perfis/' || t.id('membro_b') || '-1.jpg'), 'pendente');

-- rotina do cron (sem Vault no banco de teste): alimenta a fila e avisa em infra_falhas no máximo 1x por hora
select t.como_cron();
select public.imagem_saneamento_rotina();
select public.imagem_saneamento_rotina();
select t.eq('rotina sem Vault: 1 aviso (não 2) em infra_falhas', (select count(*) from public.infra_falhas where origem = 'imagens/saneamento'), 1::bigint);
select t.eq('rotina não toca em objeto fora do escopo', (select count(*) from public.imagem_saneamento where bucket not in ('imagens', 'comprovacoes', 'comunidade', 'suporte-anexos')), 0::bigint);

-- o cron nasce DESLIGADO (só liga depois de validar a Edge Function e configurar o Vault)
select t.ok('cron "imagem-sanear" nasce inativo (quando há pg_cron)', not exists (select 1 from pg_extension where extname = 'pg_cron')
  or exists (select 1 from cron.job where jobname = 'imagem-sanear' and not active));
-- o cron do banco existe e é só do postgres
select t.ok('cron "imagem-sanear" agendado (quando há pg_cron)', not exists (select 1 from pg_extension where extname = 'pg_cron')
  or exists (select 1 from cron.job where jobname = 'imagem-sanear' and command ilike '%imagem_saneamento_rotina%'));

select t.fim();
rollback;
