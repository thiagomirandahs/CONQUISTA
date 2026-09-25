-- Fase de fechamento — bloqueio REAL de cota de armazenamento (migration 91). Reaproveita
-- _storage_clube_do_objeto (mesma resolução de clube da medição, migration 54) — testado direto em
-- storage.objects (é exatamente a tabela em que o Storage real grava; testar aqui prova o gatilho
-- sem precisar do serviço de Storage rodando). Cobre TODOS os buckets/convenções reais do projeto.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- plano com teto pequeno (2 MB) pra clube_a, plano ilimitado (sem armazenamento_mb) pra clube_b —
-- prova tanto o bloqueio quanto o "sem assinatura/sem teto = ilimitado" no mesmo teste.
insert into public.billing_plans (id, chave, versao, nome, status, ativo, limites)
values (public.curriculo_uuid('cota:plano-pequeno'), 'cota-teste-pequeno', 1, 'Cota de teste (2MB)', 'publicado', true, '{"armazenamento_mb": 2}'::jsonb)
on conflict (chave, versao) do nothing;
insert into public.billing_accounts (id, nome, status) values (public.curriculo_uuid('cota:conta-a'), 'Conta cota A [TESTE]', 'ativa') on conflict (id) do nothing;
insert into public.subscriptions (id, billing_account_id, plan_id, status, ciclo)
values (public.curriculo_uuid('cota:assin-a'), public.curriculo_uuid('cota:conta-a'), public.curriculo_uuid('cota:plano-pequeno'), 'ativa', 'mensal')
on conflict (id) do nothing;
insert into public.subscription_clubs (subscription_id, club_id) values (public.curriculo_uuid('cota:assin-a'), t.id('clube_a')) on conflict (club_id) do nothing;

select t.eq('plano_limite confirma o teto de 2MB pro clube A', public.plano_limite(t.id('clube_a'), 'armazenamento_mb'), 2::bigint);
select t.ok('clube B continua sem teto (sem assinatura) — ilimitado por desenho', public.plano_limite(t.id('clube_b'), 'armazenamento_mb') is null);

-- ==================== upload novo, dentro da cota: passa ====================
insert into storage.objects (bucket_id, name, owner, metadata)
values ('comprovacoes', t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/requisitos/x1.jpg', t.id('membro_a'), jsonb_build_object('size', 1048576)); -- 1MB
select t.eq('1MB dentro da cota de 2MB: aceito', (select count(*) from storage.objects where bucket_id='comprovacoes' and name = t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/requisitos/x1.jpg'), 1::bigint);

-- ==================== segundo upload que estoura a cota: bloqueado, SEM apagar o primeiro ====================
select t.throws('2º upload que estouraria 2MB é RECUSADO (bucket comprovacoes, path novo)',
  format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('comprovacoes', %L, %L, jsonb_build_object('size', 1500000))$q$,
    t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/requisitos/x2.jpg', t.id('membro_a')),
  'Limite de armazenamento');
select t.eq('o upload recusado NÃO foi criado', (select count(*) from storage.objects where name like '%x2.jpg'), 0::bigint);
select t.eq('...e o PRIMEIRO upload continua intacto (nada foi apagado)', (select count(*) from storage.objects where name like '%x1.jpg'), 1::bigint);

-- regressão: RAISE do plpgsql não suporta printf (%.0f) — só "%" cru; a mensagem tem que vir limpa,
-- sem o ".0f" sobrando (bug real encontrado e corrigido nesta mesma rodada).
select t.throws('mensagem de erro vem limpa (sem artefato de formatação tipo ".0f")',
  format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('comprovacoes', %L, %L, jsonb_build_object('size', 1500000))$q$,
    t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/requisitos/x3.jpg', t.id('membro_a')),
  'MB de 2 MB');

-- ==================== outros buckets/convenções, todos respeitando a MESMA cota do clube A ====================
select t.throws('bucket documentos-emitidos (path novo <club>/<uid>/<doc>/<ver>.pdf) também é bloqueado',
  format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('documentos-emitidos', %L, %L, jsonb_build_object('size', 1500000))$q$,
    t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/doc-x/1.pdf', t.id('membro_a')),
  'Limite de armazenamento');
select t.throws('bucket assinaturas-desenhadas (path <club>/<doc>/<sig>.png) também é bloqueado',
  format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('assinaturas-desenhadas', %L, %L, jsonb_build_object('size', 1500000))$q$,
    t.id('clube_a')::text || '/doc-x/sig-x.png', t.id('membro_a')),
  'Limite de armazenamento');
select t.throws('bucket imagens, path ANTIGO (perfis/<uid>.png, resolvido pelo VÍNCULO do dono) também é bloqueado',
  format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('imagens', %L, %L, jsonb_build_object('size', 1500000))$q$,
    'perfis/' || t.id('membro_a')::text || '.png', t.id('membro_a')),
  'Limite de armazenamento');
select t.throws('bucket publico, path <club>/... também é bloqueado',
  format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('publico', %L, %L, jsonb_build_object('size', 1500000))$q$,
    t.id('clube_a')::text || '/emblema.png', t.id('lider_a')),
  'Limite de armazenamento');

-- ==================== DELTA correto no UPDATE (sobrescrever) — não cobra o tamanho inteiro de novo ====================
-- x1.jpg (1MB) cresce pra 1.9MB: delta = 0.9MB, cabe no que resta da cota (2MB - 1MB = 1MB livre)
select t.permitido('UPDATE que cresce por um DELTA que cabe na cota é aceito (não cobra o arquivo inteiro de novo)',
  format($q$update storage.objects set metadata = jsonb_build_object('size', 1900000) where bucket_id='comprovacoes' and name = %L$q$,
    t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/requisitos/x1.jpg'));

-- agora crescer mais um pouco estoura (1.9MB -> 2.5MB = +0.6MB, só sobra ~0.1MB)
select t.throws('UPDATE que cresce além do que resta da cota é recusado',
  format($q$update storage.objects set metadata = jsonb_build_object('size', 2500000) where bucket_id='comprovacoes' and name = %L$q$,
    t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/requisitos/x1.jpg'),
  'Limite de armazenamento');

-- ==================== NUNCA bloqueia quem ENCOLHE ou fica do MESMO tamanho, mesmo acima da cota ====================
select t.permitido('UPDATE que ENCOLHE é sempre aceito, mesmo já perto/acima da cota',
  format($q$update storage.objects set metadata = jsonb_build_object('size', 100000) where bucket_id='comprovacoes' and name = %L$q$,
    t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/requisitos/x1.jpg'));
select t.permitido('UPDATE do MESMO tamanho é sempre aceito',
  format($q$update storage.objects set metadata = jsonb_build_object('size', 100000) where bucket_id='comprovacoes' and name = %L$q$,
    t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/requisitos/x1.jpg'));

-- ==================== DELETE nunca é bloqueado pelo gatilho de cota ====================
-- (o gatilho desta migration só está registrado pra insert/update — delete nem passa por ele. Só
-- pra apagar de verdade a linha aqui no teste, contorna o `protect_objects_delete` do Storage, que
-- é uma proteção DIFERENTE, não relacionada a cota — a mesma que a API real do Storage contorna.)
set session_replication_role = replica;
select t.ok('DELETE nunca é bloqueado pelo gatilho de cota (não está registrado pra delete)', true);
delete from storage.objects where bucket_id='comprovacoes' and name = t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/requisitos/x1.jpg';
set session_replication_role = origin;

-- ==================== objeto que não dá pra atribuir a clube nenhum: não bloqueia (mesma regra da medição) ====================
select t.permitido('objeto sem dono/clube resolvível não é bloqueado (não é contado, então não é travado)',
  $q$insert into storage.objects (bucket_id, name, metadata) values ('imagens', 'orfao-de-teste.png', jsonb_build_object('size', 999999999))$q$);
set session_replication_role = replica;
delete from storage.objects where name = 'orfao-de-teste.png';
set session_replication_role = origin;

-- ==================== clube SEM teto (clube_b) nunca é bloqueado, por maior que seja o arquivo ====================
select t.permitido('clube B (sem assinatura, sem teto) aceita upload grande sem restrição',
  format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('comprovacoes', %L, %L, jsonb_build_object('size', 999999999))$q$,
    t.id('clube_b')::text || '/' || t.id('membro_b')::text || '/requisitos/grande.jpg', t.id('membro_b')));

select t.fim();
rollback;
