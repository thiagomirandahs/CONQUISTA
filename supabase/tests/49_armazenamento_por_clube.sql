-- =============================================================================
--  Fase 8.1 — armazenamento por clube (migration 54).
--
--  A pergunta que este teste responde é uma só, feita de seis maneiras:
--      "existe algum jeito de a conta ficar errada?"
--
--  Contabilidade incremental erra de dois modos, e os dois são silenciosos: contar duas vezes
--  (o clube parece cheio e o upload é recusado sem motivo) ou contar de menos (o limite do plano
--  nunca é atingido e a cobrança não fecha). Por isso os cenários aqui são exatamente os da
--  fase 8.1: upload, substituição, exclusão, RETRY e CONCORRÊNCIA.
--
--  A idempotência não é "tomar cuidado ao chamar": ela vem do livro-razão com chave
--  (bucket_id, name) — o delta é sempre "o que a linha dizia" contra "o que passou a dizer".
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
-- Objeto do Storage do jeito que a API cria: `metadata.size` é o tamanho.
create function t.obj(p_nome text, p_bytes bigint, p_dono text default null) returns void
language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('imagens', p_nome, case when p_dono is null then null else t.id(p_dono)::text end,
          jsonb_build_object('size', p_bytes, 'mimetype', 'image/jpeg'));
end $$;
create function t.uso(p_clube text) returns bigint language sql stable as $$
  select coalesce((select bytes from public.club_storage_uso where club_id = t.id(p_clube)), 0);
$$;
create function t.objetos(p_clube text) returns bigint language sql stable as $$
  select coalesce((select objetos from public.club_storage_uso where club_id = t.id(p_clube)), 0);
$$;
-- Os fixtures já criam 2 objetos em `comprovacoes` (um por clube). Ponto de partida conhecido.
create table t.base as select t.uso('clube_a') a, t.uso('clube_b') b;
\o

-- =============================================================================
--  1. Upload
-- =============================================================================
-- Caminho NOVO: `<club_id>/...`. É o formato que os uploads passam a usar.
select t.obj((select id from t.ids where chave='clube_a')::text || '/mural/foto1.jpg', 1000);
select t.eq('upload por caminho com o clube na frente: soma no clube certo',
  t.n($q$select t.uso('clube_a') - (select a from t.base)$q$), 1000);

-- Caminho ANTIGO (`perfis/...`): sem uuid de clube no path, resolve pelo DONO. É o que garante
-- que os milhares de objetos já existentes continuam contabilizados sem mover nada.
select t.obj('perfis/antigo-do-membro-a.jpg', 500, 'membro_a');
select t.eq('upload por caminho legado: resolve pelo dono e soma no mesmo clube',
  t.n($q$select t.uso('clube_a') - (select a from t.base)$q$), 1500);

-- Isolamento: o objeto de um clube nunca entra na conta do outro.
select t.obj((select id from t.ids where chave='clube_b')::text || '/mural/foto-b.jpg', 9999);
select t.eq('o clube B soma só o dele', t.n($q$select t.uso('clube_b') - (select b from t.base)$q$), 9999);
select t.eq('...e o clube A não mudou', t.n($q$select t.uso('clube_a') - (select a from t.base)$q$), 1500);

-- =============================================================================
--  2. RETRY / clique duplo — o cenário que mais quebra contador incremental
-- =============================================================================
-- A API de Storage faz upsert quando o upload repete o mesmo caminho. Reprocessar não pode somar
-- de novo: o razão já tem a linha com aquele tamanho, então o delta é ZERO.
\o /dev/null
update storage.objects set metadata = jsonb_build_object('size', 1000, 'mimetype', 'image/jpeg')
 where name = (select id from t.ids where chave='clube_a')::text || '/mural/foto1.jpg';
update storage.objects set metadata = jsonb_build_object('size', 1000, 'mimetype', 'image/jpeg')
 where name = (select id from t.ids where chave='clube_a')::text || '/mural/foto1.jpg';
update storage.objects set metadata = jsonb_build_object('size', 1000, 'mimetype', 'image/jpeg')
 where name = (select id from t.ids where chave='clube_a')::text || '/mural/foto1.jpg';
\o
select t.eq('reprocessar o MESMO upload 3x não soma nada (delta zero)',
  t.n($q$select t.uso('clube_a') - (select a from t.base)$q$), 1500);
select t.eq('...e não duplica a linha no razão',
  t.n($q$select count(*) from public.club_storage_objetos
        where name = (select id from t.ids where chave='clube_a')::text || '/mural/foto1.jpg'$q$), 1);

-- =============================================================================
--  3. Substituição (mesmo caminho, tamanho diferente)
-- =============================================================================
\o /dev/null
update storage.objects set metadata = jsonb_build_object('size', 4000, 'mimetype', 'image/jpeg')
 where name = (select id from t.ids where chave='clube_a')::text || '/mural/foto1.jpg';
\o
select t.eq('trocar a foto por uma maior aplica a DIFERENÇA, não o total (1500 - 1000 + 4000)',
  t.n($q$select t.uso('clube_a') - (select a from t.base)$q$), 4500);
\o /dev/null
update storage.objects set metadata = jsonb_build_object('size', 100, 'mimetype', 'image/jpeg')
 where name = (select id from t.ids where chave='clube_a')::text || '/mural/foto1.jpg';
\o
select t.eq('trocar por uma MENOR desconta (4500 - 4000 + 100)',
  t.n($q$select t.uso('clube_a') - (select a from t.base)$q$), 600);

-- =============================================================================
--  4. Exclusão
-- =============================================================================
\o /dev/null
-- `storage.allow_delete_query` é a chave que a própria API de Storage usa para apagar. Note que
-- NÃO se usa `session_replication_role = replica` aqui: aquilo desligaria TODOS os gatilhos,
-- inclusive o da contabilidade — e o teste passaria a medir um mundo que não existe.
set local storage.allow_delete_query = 'true';
delete from storage.objects where name = 'perfis/antigo-do-membro-a.jpg';
\o
select t.eq('apagar subtrai exatamente o que aquele objeto ocupava (600 - 500)',
  t.n($q$select t.uso('clube_a') - (select a from t.base)$q$), 100);
select t.eq('...e a linha sai do razão',
  t.n($q$select count(*) from public.club_storage_objetos where name = 'perfis/antigo-do-membro-a.jpg'$q$), 0);
-- os fixtures criam 1 comprovação por clube, com dono — desde a correção do `owner` legado ela
-- também é contabilizada. Restam: essa comprovação + a foto1 (a de `perfis/` acabou de sair).
select t.eq('a contagem de objetos acompanha',
  t.n($q$select t.objetos('clube_a')$q$), 2);

-- A conta nunca fica negativa, mesmo se um DELETE chegar duas vezes (retry de exclusão).
\o /dev/null
set local storage.allow_delete_query = 'true';
delete from storage.objects where name = (select id from t.ids where chave='clube_a')::text || '/mural/foto1.jpg';
-- de novo: o segundo não encontra nada, o gatilho nem dispara. O assert abaixo garante o efeito.
delete from storage.objects where name = (select id from t.ids where chave='clube_a')::text || '/mural/foto1.jpg';
\o
select t.ok('depois de apagar tudo que foi criado aqui, o uso do clube A volta à base',
  t.n($q$select t.uso('clube_a') - (select a from t.base)$q$) = 0);
select t.ok('e nunca ficou negativo', t.n($q$select t.uso('clube_a')$q$) >= 0);

-- =============================================================================
--  5. CONCORRÊNCIA — 50 uploads simultâneos do mesmo clube
-- =============================================================================
-- O risco clássico: ler o total, somar e gravar, perdendo a escrita de outra transação
-- ("lost update"). Aqui o agregado é atualizado por `on conflict do update set bytes = bytes + d`,
-- que roda sob o lock da linha — a soma é aplicada, nunca sobrescrita.
\o /dev/null
create table t.antes_conc as select t.uso('clube_a') v;
do $$
declare v_clube text := (select id::text from public.organizational_units
                          where id = (select id from t.ids where chave='clube_a'));
begin
  for i in 1..50 loop
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('imagens', v_clube || '/lote/arquivo-' || i || '.jpg', null,
            jsonb_build_object('size', 100, 'mimetype', 'image/jpeg'));
  end loop;
end $$;
\o
select t.eq('50 objetos de 100 bytes somam exatamente 5.000 — nenhuma escrita se perdeu',
  t.n($q$select t.uso('clube_a') - (select v from t.antes_conc)$q$), 5000);
select t.eq('...e a contagem de objetos bate', t.n($q$select t.objetos('clube_a')$q$), 51);

-- =============================================================================
--  6. Reconciliação: a rede de segurança
-- =============================================================================
-- Simula deriva (alguém mexeu por fora / um objeto entrou antes do gatilho existir) e confere
-- que a reconciliação DETECTA e CORRIGE.
\o /dev/null
update public.club_storage_uso set bytes = bytes + 999999 where club_id = t.id('clube_a');
insert into public.platform_admins (user_id, papel) values (t.id('lider_b'), 'operacao') on conflict do nothing;
\o
select t.como('lider_a');
select t.throws('só a operação da plataforma reconcilia (não é botão de diretor de clube)',
  'select * from public.storage_reconciliar(null, true)', 'administração da plataforma');
reset role;

select t.como('lider_b');
select t.eq('a reconciliação DETECTA a deriva e devolve a diferença',
  t.n($q$select diferenca from public.storage_reconciliar((select id from t.ids where chave='clube_a'), true)$q$), -999999);
reset role;
select t.eq('...e depois de aplicar, o número bate com a soma real dos objetos',
  t.n($q$select t.uso('clube_a') - coalesce((select sum(coalesce((metadata->>'size')::bigint,0))
      from storage.objects o where public._storage_clube_do_objeto(o.name, o.owner_id) = t.id('clube_a')), 0)$q$), 0);

select t.eq('existe reconciliação agendada (deriva não fica esperando alguém reparar)',
  t.n($q$select count(*) from cron.job where jobname = 'reconciliar-armazenamento'$q$), 1);

-- =============================================================================
--  7. A pendência da fase 5, fechada
-- =============================================================================
select t.eq('limite_uso(armazenamento_mb) deixou de devolver NULL',
  t.txt($q$select coalesce(public.limite_uso((select id from t.ids where chave='clube_a'), 'armazenamento_mb')::text, 'NULO')$q$),
  (t.n($q$select (t.uso('clube_a') / 1048576)$q$))::text);
select t.eq('clube sem objeto nenhum devolve 0, não NULO (medir zero != não saber medir)',
  t.txt($q$select coalesce(public.limite_uso('00000000-0000-0000-0000-000000000000'::uuid, 'armazenamento_mb')::text, 'NULO')$q$), '0');
select t.eq('as outras chaves de limite continuam funcionando como antes',
  t.txt($q$select coalesce(public.limite_uso((select id from t.ids where chave='clube_a'), 'membros')::text, 'NULO')$q$),
  t.txt($q$select count(*)::text from public.organization_memberships m
         where m.organizational_unit_id = (select id from t.ids where chave='clube_a')
           and m.status='ativo' and m.role <> 'pais'
           and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())$q$));

-- =============================================================================
--  8. Quem lê
-- =============================================================================
select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.ok('a diretoria enxerga o uso do PRÓPRIO clube', t.nv('select count(*) from public.armazenamento_do_clube()') = 1);
select t.eq('...e não o de outro clube',
  t.nv($q$select count(*) from public.armazenamento_do_clube((select id from t.ids where chave='clube_b'))$q$), 0);
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('membro comum não lê o consumo do clube (é dado de gestão)',
  t.nv('select count(*) from public.armazenamento_do_clube()'), 0);
select t.throws('e ninguém lê as tabelas de contabilidade direto',
  'select count(*) from public.club_storage_uso', 'permission denied');
reset role;

select t.fim();
rollback;
