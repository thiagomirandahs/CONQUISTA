-- config_clube POR CLUBE (chave, valor) — PIX, popup, rodízio, interruptores do chefão/reflexo:
--   * cada clube tem as SUAS chaves (chave primária (club_id, chave)); um clube novo nasce com os padrões;
--   * membro lê a config do próprio clube (responsável também: paga a mensalidade pelo PIX); ninguém lê a de outro;
--   * só a liderança do clube grava, e só no próprio clube (nem forjando club_id);
--   * o front grava pela RPC config_gravar (o upsert por "chave" sozinha não existe mais);
--   * as funções de jogo continuam lendo a config do clube certo (Tenant 001 idêntico ao de antes).
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.eq('a chave primária é (club_id, chave)',
  (select string_agg(a.attname, ',' order by array_position(i.indkey::int2[], a.attnum))
     from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.config_clube'::regclass and i.indisprimary), 'club_id,chave');
select t.eq('toda linha de config existente foi para um clube (Tenant 001 preserva as suas)',
  (select count(*) from public.config_clube where club_id is null), 0);
select t.ok('as chaves do Tenant 001 continuam lá (PIX do fixture)',
  (select valor from public.config_clube where club_id = t.id('clube_a') and chave = 'pix') = 'PIX-DO-CLUBE-A');

-- ---------- provisionamento: clube novo nasce com as chaves padrão ----------
insert into public.organizational_units (type, nome, slug, pais, timezone, metadata)
values ('clube', 'Clube C (teste)', 'clube-c-teste', 'BR', 'America/Recife', '{"test_only":true}');
insert into t.ids (chave, id) select 'clube_c', id from public.organizational_units where slug = 'clube-c-teste';
select t.eq('clube novo ganha as 6 chaves padrão (pix, reflexo, jogo da semana, rodízio, partida, chefão)',
  (select count(*) from public.config_clube where club_id = t.id('clube_c')), 6);
select t.eq('...com o rodízio desligado e o chefão desligado, como no clube atual',
  (select count(*) from public.config_clube where club_id = t.id('clube_c') and ((chave = 'rodizio_jogos' and valor = 'nao') or (chave = 'chefao_ativo' and valor = 'nao') or (chave = 'reflexo_so_desbravador' and valor = 'sim'))), 3);
select public.provisionar_clube(t.id('clube_c'));
select t.eq('provisionar de novo é idempotente (não duplica nem sobrescreve)', (select count(*) from public.config_clube where club_id = t.id('clube_c')), 6);
select t.eq('o clube B do fixture também foi provisionado', (select count(*) from public.config_clube where club_id = t.id('clube_b')), 6);

-- ---------- leitura ----------
select count(*) as n_a from public.config_clube where club_id = t.id('clube_a') \gset
select t.como('lider_a');
select t.eq('líder A lê o PIX do clube A', t.txt($q$select valor from public.config_clube where chave = 'pix'$q$), 'PIX-DO-CLUBE-A');
select t.eq('líder A lê só as chaves do clube A (e todas elas)', t.n('select count(*) from public.config_clube'), :n_a::bigint);
select t.como('membro_a');
select t.eq('membro A lê o PIX do clube A', t.txt($q$select valor from public.config_clube where chave = 'pix'$q$), 'PIX-DO-CLUBE-A');
select t.como('pais_a');
select t.eq('responsável do clube A lê o PIX (paga a mensalidade)', t.txt($q$select valor from public.config_clube where chave = 'pix'$q$), 'PIX-DO-CLUBE-A');
select t.como('lider_b');
select t.eq('líder B lê o PIX do PRÓPRIO clube (vazio por padrão), não o do A', t.txt($q$select valor from public.config_clube where chave = 'pix'$q$), '');
select t.eq('líder B não enxerga nenhuma linha do clube A', t.nv(format('select count(*) from public.config_clube where club_id = %L', t.id('clube_a'))), 0);
select t.como('membro_b');
select t.eq('membro B lê só 6 linhas (as do clube B)', t.n('select count(*) from public.config_clube'), 6);
select t.como('pais_b');
select t.eq('responsável do clube B não lê o PIX do clube A', t.nv(format('select count(*) from public.config_clube where club_id = %L', t.id('clube_a'))), 0);
select t.como_anon();
select t.eq('anon não lê config', t.nv('select count(*) from public.config_clube'), 0);

-- ---------- escrita direta (compat do front antigo: update ... where chave = ''pix'') ----------
select t.como('lider_a');
select t.permitido('líder A atualiza o PIX (update por chave, como o front publicado faz)', $q$update public.config_clube set valor = 'PIX-NOVO-A' where chave = 'pix'$q$);
select t.como('instrutor_a');
select t.permitido('instrutor A também gere a config do clube (igual ao legado: pode_gerir)', $q$update public.config_clube set valor = 'PIX-NOVO-A' where chave = 'pix'$q$);
select t.como('tesoureiro_a');
select t.bloqueado('tesoureiro NÃO edita a config (igual ao legado)', $q$update public.config_clube set valor = 'hack' where chave = 'pix'$q$);
select t.como('membro_a');
select t.bloqueado('membro NÃO edita a config', $q$update public.config_clube set valor = 'hack' where chave = 'pix'$q$);
select t.como('pais_a');
select t.bloqueado('responsável NÃO edita a config', $q$update public.config_clube set valor = 'hack' where chave = 'pix'$q$);
select t.como('lider_b');
select t.permitido('líder B atualiza o PIX do PRÓPRIO clube', $q$update public.config_clube set valor = 'PIX-DO-B' where chave = 'pix'$q$);
select t.bloqueado('líder B NÃO altera o PIX do clube A', format($q$update public.config_clube set valor = 'ATACANTE' where chave = 'pix' and club_id = %L$q$, t.id('clube_a')));
select t.bloqueado('líder B NÃO cria chave no clube A (club_id forjado)', format($q$insert into public.config_clube (club_id, chave, valor) values (%L, 'popup_titulo', 'atacante')$q$, t.id('clube_a')));
select t.bloqueado('líder B NÃO apaga config do clube A', format($q$delete from public.config_clube where club_id = %L$q$, t.id('clube_a')));
reset role;
select t.eq('o PIX do clube A ficou como o líder A deixou', (select valor from public.config_clube where club_id = t.id('clube_a') and chave = 'pix'), 'PIX-NOVO-A');
select t.eq('o PIX do clube B é o do líder B', (select valor from public.config_clube where club_id = t.id('clube_b') and chave = 'pix'), 'PIX-DO-B');

-- ---------- RPC config_gravar (upsert atômico de várias chaves, sempre no clube de quem chama) ----------
select t.como('lider_a');
select t.permitido('líder A grava o popup do clube (4 chaves numa chamada)',
  $q$select public.config_gravar('[{"chave":"popup_ativo","valor":"sim"},{"chave":"popup_titulo","valor":"Oi A"},{"chave":"popup_texto","valor":"texto A"},{"chave":"popup_alvo","valor":"todos"}]'::jsonb)$q$);
select t.eq('...e lê de volta o título', t.txt($q$select valor from public.config_clube where chave = 'popup_titulo'$q$), 'Oi A');
select t.permitido('líder A grava de novo (upsert: atualiza, não duplica)', $q$select public.config_gravar('[{"chave":"popup_titulo","valor":"Oi A v2"}]'::jsonb)$q$);
select t.eq('...sem duplicar a linha', t.n($q$select count(*) from public.config_clube where chave = 'popup_titulo'$q$), 1);
select t.permitido('líder A grava o interruptor do rodízio', $q$select public.config_gravar('[{"chave":"rodizio_jogos","valor":"sim"}]'::jsonb)$q$);
select t.como('lider_b');
select t.permitido('líder B grava o popup do clube B', $q$select public.config_gravar('[{"chave":"popup_titulo","valor":"Oi B"}]'::jsonb)$q$);
select t.como('membro_a');
select t.throws('membro NÃO chama config_gravar', $q$select public.config_gravar('[{"chave":"popup_titulo","valor":"hack"}]'::jsonb)$q$);
select t.como('pais_a');
select t.throws('responsável NÃO chama config_gravar', $q$select public.config_gravar('[{"chave":"popup_titulo","valor":"hack"}]'::jsonb)$q$);
select t.como('lider_a');
select t.throws('chave inválida é recusada (maiúscula/espaço)', $q$select public.config_gravar('[{"chave":"Popup Titulo","valor":"x"}]'::jsonb)$q$);
select t.throws('valor gigante é recusado', format($q$select public.config_gravar('[{"chave":"popup_texto","valor":%L}]'::jsonb)$q$, repeat('x', 5001)));
select t.throws('payload que não é lista é recusado', $q$select public.config_gravar('{"chave":"x"}'::jsonb)$q$);
select t.como_anon();
select t.throws('anon NÃO chama config_gravar', $q$select public.config_gravar('[{"chave":"popup_titulo","valor":"x"}]'::jsonb)$q$);
reset role;
select t.eq('popup do clube A não vazou para o B', (select valor from public.config_clube where club_id = t.id('clube_b') and chave = 'popup_titulo'), 'Oi B');
select t.eq('popup do clube B não vazou para o A', (select valor from public.config_clube where club_id = t.id('clube_a') and chave = 'popup_titulo'), 'Oi A v2');
select t.eq('o clube C (sem líder) ficou intacto', (select count(*) from public.config_clube where club_id = t.id('clube_c')), 6);

-- ---------- helpers internos não são chamáveis por usuário ----------
select t.eq('config_valor / config_definir NÃO são executáveis por authenticated nem anon',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('config_valor', 'config_definir')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0);
select t.eq('provisionar_clube NÃO é executável por authenticated nem anon',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'provisionar_clube'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0);

-- ---------- funções de jogo leem a config do CLUBE de quem chama ----------
select t.como('membro_a');
select t.eq('rodizio_ligado() do membro A reflete a chave do clube A (ligada pelo líder A)', t.txt('select public.rodizio_ligado()::text'), 'true');
select t.como('membro_b');
select t.eq('rodizio_ligado() do membro B reflete a chave do clube B (desligada) — não a do A', t.txt('select public.rodizio_ligado()::text'), 'false');
select t.como('lider_b');
select t.permitido('líder B liga o rodízio do clube B', $q$select public.config_gravar('[{"chave":"rodizio_jogos","valor":"sim"}]'::jsonb)$q$);
select t.como('lider_a');
select t.permitido('líder A desliga o rodízio do clube A', $q$select public.config_gravar('[{"chave":"rodizio_jogos","valor":"nao"}]'::jsonb)$q$);
select t.como('membro_b');
select t.eq('agora o membro B vê ligado (o desligar do A não o afetou)', t.txt('select public.rodizio_ligado()::text'), 'true');
select t.como('membro_a');
select t.eq('e o membro A vê desligado', t.txt('select public.rodizio_ligado()::text'), 'false');
select t.eq('reflexo_so_desbravador() do clube A = padrão sim', t.txt('select public.reflexo_so_desbravador()::text'), 'true');
select t.como('lider_b');
select t.permitido('líder B desliga o "só desbravador" do clube B', $q$select public.config_gravar('[{"chave":"reflexo_so_desbravador","valor":"nao"}]'::jsonb)$q$);
select t.como('membro_b');
select t.eq('reflexo_so_desbravador() do clube B = nao', t.txt('select public.reflexo_so_desbravador()::text'), 'false');
select t.como('membro_a');
select t.eq('reflexo_so_desbravador() do clube A não mudou', t.txt('select public.reflexo_so_desbravador()::text'), 'true');
reset role;

select t.fim();
rollback;
