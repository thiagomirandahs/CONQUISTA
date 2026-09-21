-- Jogos POR CLUBE (trilha, rodízio "Jogos do Dia", recordes arcade, ajudas entre amigos, chefão, catálogo):
--   * jogos_trilha (catálogo com liga/desliga) é POR CLUBE; clube novo ganha o catálogo (só o Jogo da Memória ligado);
--   * trilha_jogos / partidas / recordes / chefao_golpes / ajudas carregam o clube de quem jogou;
--   * o membro joga no PRÓPRIO clube, ranking e recordes só mostram gente do clube; liderança gere só o clube dela;
--   * rodízio e liberações são do clube (ligar o rodízio do B não mexe no A);
--   * chefão: config, vida, dano e golpes por clube; ajuda só entre amigos do mesmo clube;
--   * cadastro pendente e responsável não jogam; ninguém grava direto nas tabelas.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.mk('pend_a', 'Pendente A', 'desbravador', 'pendente', 'clube_a', 'A1', date '2014-10-10');
select t.mk('membro_b2', 'Membro B2', 'desbravador', 'ativo', 'clube_b', 'B1', date '2014-09-09');

-- ---------- estrutura ----------
select t.eq('as 7 tabelas de jogo têm club_id obrigatório',
  (select count(*) from pg_attribute a where a.attrelid in ('public.jogos_trilha'::regclass, 'public.jogos_liberados'::regclass, 'public.trilha_jogos'::regclass,
       'public.partidas'::regclass, 'public.recordes'::regclass, 'public.ajudas'::regclass, 'public.chefao_golpes'::regclass)
     and a.attname = 'club_id' and a.attnotnull), 7);
select t.eq('a chave primária do catálogo é (club_id, chave)',
  (select string_agg(a.attname, ',' order by array_position(i.indkey::int2[], a.attnum))
     from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.jogos_trilha'::regclass and i.indisprimary), 'club_id,chave');
select t.eq('o clube B ganhou o MESMO catálogo do clube A', (select count(*) from public.jogos_trilha where club_id = t.id('clube_b')), (select count(*) from public.jogos_trilha where club_id = t.id('clube_a')));
select t.eq('...só com o Jogo da Memória ligado', (select string_agg(chave, ',') from public.jogos_trilha where club_id = t.id('clube_b') and ativo), 'memoria');
select t.ok('os gates do clube legado saíram das 5 tabelas de jogo',
  not exists (select 1 from pg_trigger where tgrelid in ('public.trilha_jogos'::regclass, 'public.recordes'::regclass, 'public.partidas'::regclass, 'public.chefao_golpes'::regclass, 'public.ajudas'::regclass)
                and not tgisinternal and tgname = 'trg_exigir_clube_legado'));

-- ---------- catálogo (liga/desliga jogos) ----------
select t.como('membro_a');
select t.eq('membro A lê só o catálogo do clube A', t.n('select count(*) from public.jogos_trilha'), (select count(*) from public.jogos_trilha where club_id = t.id('clube_a')));
select t.eq('...e nenhuma linha do clube B', t.nv(format('select count(*) from public.jogos_trilha where club_id = %L', t.id('clube_b'))), 0);
select t.como('lider_b');
select t.permitido('líder B liga o "genius" (update por chave, como o front faz) — só o dele', $q$update public.jogos_trilha set ativo = true where chave = 'genius'$q$);
select t.bloqueado('líder B NÃO liga jogo do clube A', format($q$update public.jogos_trilha set ativo = true where chave = 'caca' and club_id = %L$q$, t.id('clube_a')));
select t.bloqueado('líder B NÃO cria jogo no catálogo do clube A', format($q$insert into public.jogos_trilha (club_id, chave, nome, emoji, ativo, ordem) values (%L, 'invasor', 'x', 'x', true, 99)$q$, t.id('clube_a')));
select t.como('membro_b');
select t.bloqueado('membro NÃO liga jogo', $q$update public.jogos_trilha set ativo = true where chave = 'caca'$q$);
select t.como('tesoureiro_a');
select t.bloqueado('tesoureiro NÃO liga jogo', $q$update public.jogos_trilha set ativo = true where chave = 'caca'$q$);
select t.como('pais_a');
select t.eq('responsável não lê o catálogo', t.nv('select count(*) from public.jogos_trilha'), 0);
select t.como_anon();
select t.eq('anon não lê o catálogo', t.nv('select count(*) from public.jogos_trilha'), 0);
reset role;
select t.eq('o "genius" do clube A continua desligado', (select ativo from public.jogos_trilha where club_id = t.id('clube_a') and chave = 'genius'), false);
select t.eq('o "genius" do clube B está ligado', (select ativo from public.jogos_trilha where club_id = t.id('clube_b') and chave = 'genius'), true);
select t.como('lider_b');
select t.permitido('líder B desliga o genius de novo (volta ao catálogo original)', $q$update public.jogos_trilha set ativo = false where chave = 'genius'$q$);
reset role;

-- ---------- jogar (registrar_jogo) ----------
select t.como('membro_a');
select t.eq('membro A joga a memória: 3 estrelas = 30 pontos', t.txt($q$select public.registrar_jogo('memoria', 3)->>'pontos'$q$), '30');
select t.throws('o mesmo jogo só uma vez ao dia', $q$select public.registrar_jogo('memoria', 3)$q$, 'já jogou');
select t.throws('jogo que não existe no catálogo do clube é inválido', $q$select public.registrar_jogo('invasor', 3)$q$, 'inválido');
select t.como('membro_b');
select t.eq('membro B joga a memória no clube B: 2 estrelas = 20 pontos', t.txt($q$select public.registrar_jogo('memoria', 2)->>'pontos'$q$), '20');
select t.como('pais_a');
select t.throws('responsável NÃO joga', $q$select public.registrar_jogo('memoria', 3)$q$, 'membros ativos');
select t.como('pend_a');
select t.throws('cadastro pendente NÃO joga', $q$select public.registrar_jogo('memoria', 3)$q$, 'membros ativos');
reset role;
select t.eq('a jogada do A e os 30 pontos ficaram no clube A', (select count(*) from public.trilha_jogos where usuario_id = t.id('membro_a') and club_id = t.id('clube_a')) + (select count(*) from public.pontos where usuario_id = t.id('membro_a') and origem = 'trilha' and pontos = 30 and club_id = t.id('clube_a')), 2);
select t.eq('a jogada do B e os 20 pontos ficaram no clube B', (select count(*) from public.trilha_jogos where usuario_id = t.id('membro_b') and club_id = t.id('clube_b')) + (select count(*) from public.pontos where usuario_id = t.id('membro_b') and origem = 'trilha' and pontos = 20 and club_id = t.id('clube_b')), 2);
select t.eq('pendente e responsável não pontuaram', (select count(*) from public.trilha_jogos where usuario_id in (t.id('pais_a'), t.id('pend_a'))), 0);

-- ---------- leitura da trilha e ranking ----------
select t.como('membro_a');
select t.eq('membro A lê só a própria jogada', t.n('select count(*) from public.trilha_jogos'), 1);
select t.eq('ranking dos jogos: o clube A só tem gente do clube A', t.txt($q$select (json_array_length(public.ranking_trilha()->'geral'))::text$q$), '1');
select t.eq('...e o líder do ranking é o membro A', t.txt($q$select public.ranking_trilha()->'geral'->0->>'nome'$q$), 'Membro A');
select t.como('membro_b');
select t.eq('ranking dos jogos do clube B só tem o membro B', t.txt($q$select public.ranking_trilha()->'geral'->0->>'nome'$q$), 'Membro B');
select t.como('lider_a');
select t.eq('líder A lê as jogadas do clube A (e nenhuma do B)', t.nv(format('select count(*) from public.trilha_jogos where club_id = %L', t.id('clube_b'))), 0);
select t.como('lider_b');
select t.eq('líder B NÃO lê a jogada do membro do clube A', t.nv(format('select count(*) from public.trilha_jogos where usuario_id = %L', t.id('membro_a'))), 0);
select t.como('pais_a');
select t.eq('responsável recebe ranking vazio', t.txt($q$select public.ranking_trilha()::text$q$), '{}');
select t.como('membro_b');
select t.bloqueado('membro NÃO grava jogada direto', format($q$insert into public.trilha_jogos (usuario_id, data, tipo, estrelas, club_id) values (%L, current_date - 1, 'memoria', 3, %L)$q$, t.id('membro_b'), t.id('clube_b')));

-- ---------- bônus "todos os jogos do dia" (rodízio desligado: vale 50) ----------
select t.eq('membro B completou os jogos ligados do clube B (só a memória): bônus de 50', t.txt($q$select public.bonus_todos_jogos()->>'ganhou'$q$), '50');
select t.eq('...e não ganha de novo no mesmo dia', t.txt($q$select public.bonus_todos_jogos()->>'ganhou'$q$), '0');
select t.como('membro_a');
select t.eq('membro A também completou (no clube dele): bônus de 50', t.txt($q$select public.bonus_todos_jogos()->>'ganhou'$q$), '50');
reset role;
select t.eq('os bônus caíram cada um no seu clube', (select count(*) from public.pontos where origem = 'bonus_dia' and ((usuario_id = t.id('membro_a') and club_id = t.id('clube_a')) or (usuario_id = t.id('membro_b') and club_id = t.id('clube_b')))), 2);

-- ---------- rodízio "Jogos do Dia" e liberações: por clube ----------
select t.como('lider_b');
select t.permitido('líder B liga o rodízio do clube B', $q$select public.config_gravar('[{"chave":"rodizio_jogos","valor":"sim"}]'::jsonb)$q$);
select t.permitido('líder B liga o "genius" no clube B (entra no rodízio)', $q$update public.jogos_trilha set ativo = true where chave = 'genius'$q$);
select t.eq('status dos jogos do dia do clube B: rodízio ativo', t.txt($q$select public.status_jogos_do_dia()->>'ativo'$q$), 'true');
select t.eq('...com o trio do dia só de jogos LIGADOS no B (memória + genius)', t.txt($q$select (select string_agg(x, ',' order by x) from json_array_elements_text(public.status_jogos_do_dia()->'hoje') x)$q$), 'genius,memoria');
select t.como('membro_a');
select t.eq('o clube A segue com o rodízio desligado', t.txt($q$select public.status_jogos_do_dia()->>'ativo'$q$), 'false');
select t.como('lider_b');
select t.throws('líder B NÃO libera jogo desligado no clube dele', $q$select public.liberar_jogo('caca')$q$, 'fora do rodízio');
select t.permitido('líder B liga o "caca" e libera para hoje', $q$update public.jogos_trilha set ativo = true where chave = 'caca'$q$);
select t.permitido('...libera o caca hoje', $q$select public.liberar_jogo('caca')$q$);
select t.como('membro_a');
select t.throws('membro A NÃO libera jogo', $q$select public.liberar_jogo('memoria')$q$, 'liderança');
select t.como('lider_a');
select t.permitido('líder A "tranca" o caca: só apaga liberação do PRÓPRIO clube', $q$select public.trancar_jogo('caca')$q$);
reset role;
select t.eq('a liberação do clube B continua de pé', (select count(*) from public.jogos_liberados where club_id = t.id('clube_b') and chave = 'caca'), 1);
select t.como('lider_b');
select t.permitido('líder B tranca o caca no clube dele', $q$select public.trancar_jogo('caca')$q$);
reset role;
select t.eq('...e a liberação some só do clube B', (select count(*) from public.jogos_liberados where chave = 'caca'), 0);
select t.como('lider_b');
select t.permitido('líder B libera o caca de novo', $q$select public.liberar_jogo('caca')$q$);
select t.como('membro_b2');
select t.eq('membro B2 joga o caca liberado (2 estrelas)', t.txt($q$select public.registrar_jogo('caca', 2)->>'pontos'$q$), '20');
select t.throws('jogo fora do rodízio de hoje NÃO abre (o "morse" não está ligado no B)', $q$select public.registrar_jogo('morse', 2)$q$, 'abre outro dia');
select t.como('membro_b');
select t.bloqueado('membro NÃO grava liberação direto', format($q$insert into public.jogos_liberados (club_id, chave, data) values (%L, 'morse', current_date)$q$, t.id('clube_b')));

-- ---------- partidas e recordes arcade ----------
select t.como('lider_b');
select t.permitido('líder B liga o reflexo no clube B', $q$update public.jogos_trilha set ativo = true where chave = 'reflexo'$q$);
select t.como('membro_b');
select t.permitido('membro B abre uma partida do reflexo', $q$select public.iniciar_jogo('reflexo')$q$);
select t.eq('membro B registra o recorde do reflexo (sem partida: exigir_partida desligado)', t.txt($q$select public.registrar_recorde('reflexo', 42)->>'recorde'$q$), '42');
select t.como('membro_a');
select t.eq('membro A registra o recorde dele (reflexo) no clube A', t.txt($q$select public.registrar_recorde('reflexo', 77)->>'recorde'$q$), '77');
select t.eq('recordes da semana no clube A: só o do membro A', t.txt($q$select (json_array_length(public.recordes_semana('reflexo')))::text || ':' || (public.recordes_semana('reflexo')->0->>'pontos')$q$), '1:77');
select t.como('membro_b');
select t.eq('recordes da semana no clube B: só o do membro B', t.txt($q$select (json_array_length(public.recordes_semana('reflexo')))::text || ':' || (public.recordes_semana('reflexo')->0->>'pontos')$q$), '1:42');
select t.como('lider_a');
select t.bloqueado('líder A NÃO apaga recorde do clube B', format($q$delete from public.recordes where club_id = %L$q$, t.id('clube_b')));
select t.como('lider_b');
select t.bloqueado('membro/líder NÃO grava recorde direto', format($q$insert into public.recordes (usuario_id, jogo, semana, pontos, club_id) values (%L, 'reflexo', current_date - 7, 999, %L)$q$, t.id('membro_b'), t.id('clube_b')));
select t.como('pais_b');
select t.eq('responsável recebe recordes vazios', t.txt($q$select public.recordes_semana('reflexo')::text$q$), '[]');
reset role;
select t.eq('o recorde e a partida do B ficaram no clube B', (select count(*) from public.recordes where club_id = t.id('clube_b')) + (select count(*) from public.partidas where club_id = t.id('clube_b')), 2);
select t.eq('...e o recorde do A no clube A', (select count(*) from public.recordes where club_id = t.id('clube_a') and pontos = 77), 1);

-- ---------- ajuda entre amigos ----------
select t.como('membro_a');
select t.permitido('membro A pede ajuda a um amigo do MESMO clube', format($q$select public.pedir_ajuda(%L, 'forca', '{"palavra":"_ _"}'::jsonb, 'casa')$q$, t.id('membro_a2')));
select t.throws('membro A NÃO pede ajuda a alguém do clube B (mesma resposta de "amigo inválido")', format($q$select public.pedir_ajuda(%L, 'forca', '{}'::jsonb, 'casa')$q$, t.id('membro_b')), 'Amigo inválido');
select t.como('membro_b');
select t.throws('membro B NÃO pede ajuda a alguém do clube A', format($q$select public.pedir_ajuda(%L, 'forca', '{}'::jsonb, 'casa')$q$, t.id('membro_a')), 'Amigo inválido');
select t.eq('membro B não vê pedidos de ajuda do clube A', t.txt($q$select public.ajudas_recebidas()::text$q$), '[]');
select t.como('membro_a2');
select t.eq('membro A2 recebe 1 pedido', t.txt($q$select (json_array_length(public.ajudas_recebidas()))::text$q$), '1');
select t.eq('membro A2 resolve o pedido: +5 pontos', t.txt($q$select public.resolver_ajuda((public.ajudas_recebidas()->0->>'id')::uuid, 'casa')->>'ganhou'$q$), '5');
reset role;
select t.eq('a ajuda ficou no clube A e o +5 pontuou o A2 no clube A', (select count(*) from public.ajudas where club_id = t.id('clube_a')) + (select count(*) from public.pontos where usuario_id = t.id('membro_a2') and origem = 'ajuda' and club_id = t.id('clube_a')), 2);
select id as ajuda_a from public.ajudas where club_id = t.id('clube_a') limit 1 \gset
select t.como('membro_b');
select t.eq('membro B tentando resolver ajuda do clube A: "sumiu" (sem revelar)', t.txt(format($q$select public.resolver_ajuda(%L, 'casa')->>'erro'$q$, :'ajuda_a')), 'sumiu');
reset role;
select t.throws('gatilho: ajuda entre clubes é impossível (mesmo como dono do banco)', format($q$insert into public.ajudas (de_id, para_id, jogo, enunciado, resposta, status) values (%L, %L, 'forca', '{}'::jsonb, 'x', 'aberto')$q$, t.id('membro_a'), t.id('membro_b')), 'mesmo clube');

-- ---------- chefão ----------
select t.como('membro_a');
select t.throws('membro NÃO configura o chefão', format($q$select public.chefao_config('Golias', '🗿', 1000, null, %L::date, true)$q$, current_date), 'liderança');
select t.como('lider_a');
select t.permitido('líder A liga o chefão do clube A (vida 1000, começa hoje)', format($q$select public.chefao_config('Golias', '🗿', 1000, null, %L::date, true)$q$, (now() at time zone 'America/Sao_Paulo')::date));
select t.como('membro_a');
select t.eq('chefão do clube A: ativo com vida 1000', t.txt($q$select (public.chefao_estado()->>'ativo') || ':' || (public.chefao_estado()->>'vida_total')$q$), 'true:1000');
select t.eq('membro A dá o golpe especial (25 de dano)', t.txt($q$select public.chefao_golpe()->>'dano_golpe'$q$), '25');
select t.throws('só 1 golpe por hora', $q$select public.chefao_golpe()$q$, '1x por hora');
select t.como('membro_b');
select t.eq('chefão do clube B: DESLIGADO (o do A não aparece)', t.txt($q$select public.chefao_estado()->>'ativo'$q$), 'false');
select t.throws('membro B não dá golpe (não há chefão no clube B)', $q$select public.chefao_golpe()$q$, 'Não tem chefão');
select t.como('lider_b');
select t.permitido('líder B liga o chefão do clube B (vida 500)', format($q$select public.chefao_config('Golias B', '🐉', 500, null, %L::date, true)$q$, (now() at time zone 'America/Sao_Paulo')::date));
select t.como('membro_b');
select t.eq('chefão do B: vida 500 e o dano NÃO inclui o golpe nem os pontos do clube A', t.txt($q$select (public.chefao_estado()->>'vida_total') || ':' || (case when (public.chefao_estado()->>'dano')::int < 200 then 'baixo' else 'alto' end)$q$), '500:baixo');
select t.como('membro_a');
select t.eq('chefão do A segue com a vida dele (o config do B não vazou)', t.txt($q$select public.chefao_estado()->>'vida_total'$q$), '1000');
reset role;
select t.eq('o golpe ficou no clube A', (select count(*) from public.chefao_golpes where club_id = t.id('clube_a')), 1);
select t.eq('aviso "chefão apareceu": 1 no clube A e 1 no clube B, cada um só no seu', (select count(*) from public.notificacoes where titulo like '%apareceu%' and club_id = t.id('clube_a') and titulo like '%Golias%' and titulo not like '%Golias B%') + (select count(*) from public.notificacoes where titulo like '%apareceu%' and club_id = t.id('clube_b') and titulo like '%Golias B%'), 2);
select t.eq('nenhum aviso de chefão vazou entre clubes', (select count(*) from public.notificacoes where titulo like '%apareceu%' and ((club_id = t.id('clube_a') and titulo like '%Golias B%') or (club_id = t.id('clube_b') and titulo not like '%Golias B%'))), 0);

-- ---------- painel de atividade nos jogos (liderança) ----------
select t.como('membro_a');
select t.throws('membro NÃO abre o painel de atividade', $q$select public.atividade_jogos()$q$, 'permissão');
select t.como('lider_a');
select t.eq('líder A: hoje jogou 1 no clube A (só o membro A)', t.txt($q$select public.atividade_jogos()->>'hoje'$q$), '1');
select t.como('lider_b');
select t.eq('líder B: hoje jogaram 2 no clube B (membro B e B2)', t.txt($q$select public.atividade_jogos()->>'hoje'$q$), '2');
select t.eq('líder B: a lista de ausentes nunca traz gente do clube A', t.txt($q$select (select count(*) from json_array_elements(public.atividade_jogos()->'ausentes') x where x->>'nome' like '%Membro A%')::text$q$), '0');
reset role;

-- ---------- jogo NOVO no catálogo: entra em todos os clubes ----------
select public.catalogo_jogo_definir('jogo_teste', 'Jogo Teste', '🧪', 99, false, true);
select t.eq('catalogo_jogo_definir cria o jogo novo em TODOS os clubes', (select count(*) from public.jogos_trilha where chave = 'jogo_teste'), (select count(*) from public.organizational_units where type = 'clube'));
select t.eq('...ligado só no clube legado (o Tenant 001 mantém o comportamento de antes)', (select count(*) from public.jogos_trilha where chave = 'jogo_teste' and ativo), 1);
select public.catalogo_jogo_definir('jogo_teste', 'Nome que não vale', '🧪', 99, false, false);
select t.eq('rodar de novo não duplica nem desliga o que já existe', (select count(*) from public.jogos_trilha where chave = 'jogo_teste' and nome = 'Jogo Teste'), (select count(*) from public.organizational_units where type = 'clube'));
select t.eq('catalogo_jogo_definir NÃO é executável por usuário', (select count(*) from pg_proc p where p.proname = 'catalogo_jogo_definir' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0);

select t.fim();
rollback;
