-- Rotinas de CRON dos jogos POR CLUBE (sem sessão de usuário: auth.uid() = null):
--   melhores do dia, campeão da semana (recorde), rodada da semana (estrelas + jogo da semana),
--   lembretes (ausentes / jogos do dia) e pagamento do chefão.
--   Cada clube é julgado SÓ com os dados dele, com a config dele, e o prêmio/aviso cai no clube dele.
--   Rodar de novo não paga em dobro; um clube com problema não impede os outros.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.mk('membro_b2', 'Membro B2', 'desbravador', 'ativo', 'clube_b', 'B1', date '2014-09-09');
select t.mk('aus_a', 'Ausente A', 'desbravador', 'ativo', 'clube_a', 'A1', date '2014-01-01');
select t.mk('aus_b', 'Ausente B', 'desbravador', 'ativo', 'clube_b', 'B1', date '2014-02-02');

-- datas que as rotinas usam (mesma conta delas)
select ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')::date as v_dia,
       (date_trunc('week', ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')))::date as v_seg,
       (now() at time zone 'America/Sao_Paulo')::date as v_hoje \gset

-- rodízio ligado nos dois clubes; jogo da semana = memória
update public.config_clube set valor = 'sim' where chave = 'rodizio_jogos' and club_id in (t.id('clube_a'), t.id('clube_b'));
update public.config_clube set valor = 'memoria' where chave = 'jogo_da_semana' and club_id in (t.id('clube_a'), t.id('clube_b'));
select t.como_cron();  -- postgres SEM claim de usuário (o teto de ±100 pontos só vale para quem tem sessão)

-- ---------- 1) melhores do dia ----------
insert into public.trilha_jogos (usuario_id, data, tipo, estrelas) values
  (t.id('membro_a'), :'v_dia', 'memoria', 3), (t.id('membro_a2'), :'v_dia', 'memoria', 2),
  (t.id('membro_b'), :'v_dia', 'memoria', 1), (t.id('membro_b2'), :'v_dia', 'memoria', 2);
select public._premiar_melhores_do_dia_clube(t.id('clube_a'));
select public._premiar_melhores_do_dia_clube(t.id('clube_b'));
select t.eq('clube A: o melhor do dia (3★) levou +10 no clube A', (select count(*) from public.pontos where origem = 'melhor_dia' and usuario_id = t.id('membro_a') and pontos = 10 and club_id = t.id('clube_a')), 1);
select t.eq('clube B: o melhor do dia (2★) levou +10 no clube B', (select count(*) from public.pontos where origem = 'melhor_dia' and usuario_id = t.id('membro_b2') and pontos = 10 and club_id = t.id('clube_b')), 1);
select t.eq('só 2 prêmios no total (um por clube; ninguém do outro clube concorreu)', (select count(*) from public.pontos where origem = 'melhor_dia'), 2);
select t.eq('aviso "Melhores do dia": 1 por clube, cada um no seu', (select count(*) from public.notificacoes where titulo like '%Melhores do dia%' and club_id = t.id('clube_a')) * 10 + (select count(*) from public.notificacoes where titulo like '%Melhores do dia%' and club_id = t.id('clube_b')), 11);
select t.eq('o jogo da semana ficou liberado hoje em cada clube', (select count(*) from public.jogos_liberados where chave = 'memoria' and club_id in (t.id('clube_a'), t.id('clube_b'))), 2);
select public._premiar_melhores_do_dia_clube(t.id('clube_a'));
select public._premiar_melhores_do_dia_clube(t.id('clube_b'));
select t.eq('rodar de novo NÃO paga em dobro', (select count(*) from public.pontos where origem = 'melhor_dia'), 2);

-- ---------- 2) campeão da semana (recordes) ----------
insert into public.recordes (usuario_id, jogo, semana, pontos) values
  (t.id('membro_a'), 'reflexo', :'v_seg', 77), (t.id('membro_b'), 'reflexo', :'v_seg', 42), (t.id('membro_b2'), 'reflexo', :'v_seg', 40);
select public.premiar_campeao_semana();
select t.eq('clube A: o maior recorde (77) levou +20 no clube A', (select count(*) from public.pontos where origem = 'campeao' and usuario_id = t.id('membro_a') and pontos = 20 and club_id = t.id('clube_a') and motivo like '%reflexo%'), 1);
select t.eq('clube B: o maior recorde do B (42, não o 77 do A) levou +20 no clube B', (select count(*) from public.pontos where origem = 'campeao' and usuario_id = t.id('membro_b') and pontos = 20 and club_id = t.id('clube_b') and motivo like '%reflexo%'), 1);
select t.eq('ninguém mais foi premiado no recorde', (select count(*) from public.pontos where origem = 'campeao' and motivo like '%Recorde da semana%'), 2);
select t.eq('aviso "Recorde da semana": 1 por clube', (select count(*) from public.notificacoes where titulo like '%Recorde da semana%' and club_id = t.id('clube_a')) * 10 + (select count(*) from public.notificacoes where titulo like '%Recorde da semana%' and club_id = t.id('clube_b')), 11);
select public.premiar_campeao_semana();
select t.eq('rodar de novo NÃO paga em dobro', (select count(*) from public.pontos where origem = 'campeao' and motivo like '%Recorde da semana%'), 2);

-- ---------- 3) rodada da semana (campeão das estrelas +30, jogo da semana +20, sorteio) ----------
insert into public.trilha_jogos (usuario_id, data, tipo, estrelas) values
  (t.id('membro_a'), :'v_seg', 'genius', 3), (t.id('membro_b2'), :'v_seg', 'genius', 3), (t.id('membro_b'), :'v_seg', 'genius', 1);
select public.premiar_rodada_semana();
-- estrelas da semana: A = membro_a (3 + 3 = 6); B = membro_b2 (2 + 3 = 5) contra membro_b (1 + 1 = 2)
select t.eq('clube A: campeão das estrelas (membro A) levou +30 no clube A', (select count(*) from public.pontos where origem = 'campeao' and usuario_id = t.id('membro_a') and pontos = 30 and club_id = t.id('clube_a')), 1);
select t.eq('clube B: campeão das estrelas (membro B2) levou +30 no clube B', (select count(*) from public.pontos where origem = 'campeao' and usuario_id = t.id('membro_b2') and pontos = 30 and club_id = t.id('clube_b')), 1);
select t.eq('jogo da semana (memória): +20 pro melhor de cada clube, no clube dele', (select count(*) from public.pontos where origem = 'campeao' and pontos = 20 and motivo like '%jogo da semana%' and ((usuario_id = t.id('membro_a') and club_id = t.id('clube_a')) or (usuario_id = t.id('membro_b2') and club_id = t.id('clube_b')))), 2);
select t.eq('só houve esses 4 prêmios de rodada (nada cruzou clubes)', (select count(*) from public.pontos where origem = 'campeao' and (motivo like '%estrelas da semana%' or motivo like '%jogo da semana%')), 4);
select t.eq('o sorteio do próximo jogo foi marcado em CADA clube', (select count(*) from public.config_clube where chave = 'jogo_semana_rodada' and club_id in (t.id('clube_a'), t.id('clube_b'))), 2);
select t.eq('o novo jogo da semana de cada clube é um jogo LIGADO no catálogo dele', (select count(*) from public.config_clube c join public.jogos_trilha j on j.club_id = c.club_id and j.chave = c.valor and j.ativo where c.chave = 'jogo_da_semana' and c.club_id in (t.id('clube_a'), t.id('clube_b'))), 2);
select t.eq('avisos da rodada: cada clube recebeu só os seus (estrelas + jogo + novo jogo)', (select count(*) from public.notificacoes where club_id = t.id('clube_a') and titulo in ('🌟 Campeão das estrelas!', '🎲 Campeão do jogo da semana!', '🎲 Novo jogo da semana!')) * 10 + (select count(*) from public.notificacoes where club_id = t.id('clube_b') and titulo in ('🌟 Campeão das estrelas!', '🎲 Campeão do jogo da semana!', '🎲 Novo jogo da semana!')), 33);
select public.premiar_rodada_semana();
select t.eq('rodar de novo NÃO paga em dobro', (select count(*) from public.pontos where origem = 'campeao' and (motivo like '%estrelas da semana%' or motivo like '%jogo da semana%')), 4);

-- ---------- 4) lembretes ----------
select public.lembrar_ausentes();
select t.eq('lembrete de ausência: 1 ausente em cada clube, no clube dele (quem jogou ontem/hoje fica de fora)', (select count(*) from public.notificacoes where titulo = '🎮 Sentimos sua falta!' and club_id = t.id('clube_a') and para_usuario = t.id('aus_a')) * 10 + (select count(*) from public.notificacoes where titulo = '🎮 Sentimos sua falta!' and club_id = t.id('clube_b') and para_usuario = t.id('aus_b')), 11);
select t.eq('...e ninguém mais foi lembrado', (select count(*) from public.notificacoes where titulo = '🎮 Sentimos sua falta!'), 2);
select t.eq('a marca "já lembrei hoje" é POR CLUBE', (select count(*) from public.config_clube where chave = 'lembrete_ausencia_dia' and valor = :'v_hoje' and club_id in (t.id('clube_a'), t.id('clube_b'))), 2);
select public.lembrar_jogos_do_dia();
select t.eq('lembrete dos jogos do dia: marca por clube', (select count(*) from public.config_clube where chave = 'lembrete_jogos_dia' and valor = :'v_hoje' and club_id in (t.id('clube_a'), t.id('clube_b'))), 2);
select public.lembrar_ausentes();
select t.eq('lembrete de ausência não repete no mesmo dia', (select count(*) from public.notificacoes where titulo = '🎮 Sentimos sua falta!'), 2);

-- ---------- 5) chefão: fim do evento, cada clube com o seu ----------
insert into public.config_clube (club_id, chave, valor) values
  (t.id('clube_a'), 'chefao_ativo', 'sim'), (t.id('clube_a'), 'chefao_inicio', to_char(:'v_hoje'::date - 3, 'YYYY-MM-DD')), (t.id('clube_a'), 'chefao_vida', '1000'), (t.id('clube_a'), 'chefao_nome', 'Golias'),
  (t.id('clube_b'), 'chefao_ativo', 'sim'), (t.id('clube_b'), 'chefao_inicio', to_char(:'v_hoje'::date - 3, 'YYYY-MM-DD')), (t.id('clube_b'), 'chefao_vida', '500'), (t.id('clube_b'), 'chefao_nome', 'Golias B')
on conflict (club_id, chave) do update set valor = excluded.valor;
delete from public.config_clube where chave = 'chefao_pago';
insert into public.pontos (usuario_id, origem, pontos, motivo, data) values
  (t.id('membro_a'), 'manual', 1500, 'dano do A', now() - interval '60 hours'),
  (t.id('membro_b'), 'manual', 100, 'dano do B (não vence)', now() - interval '60 hours');
select public.chefao_premiar();
select t.eq('clube A derrotou o chefão: o prêmio (vida 1000, só dano do A) foi pago no clube A', (select coalesce(sum(pontos), 0) from public.pontos where origem = 'chefao' and usuario_id = t.id('membro_a') and club_id = t.id('clube_a')), 1000);
select t.eq('clube B NÃO venceu (100 de dano < 500): ninguém do B recebeu prêmio de chefão', (select count(*) from public.pontos where origem = 'chefao' and club_id = t.id('clube_b')), 0);
select t.eq('aviso "derrotado" só no clube A; aviso "recuou" só no clube B', (select count(*) from public.notificacoes where titulo like '%derrotado%' and club_id = t.id('clube_a')) * 10 + (select count(*) from public.notificacoes where titulo like '%recuou%' and club_id = t.id('clube_b')), 11);
select t.eq('...e nenhum aviso de chefão no clube errado', (select count(*) from public.notificacoes where (titulo like '%derrotado%' and club_id = t.id('clube_b')) or (titulo like '%recuou%' and club_id = t.id('clube_a'))), 0);
select t.eq('cada clube marcou o "chefão pago" e desligou o SEU chefão', (select count(*) from public.config_clube where chave = 'chefao_pago' and club_id in (t.id('clube_a'), t.id('clube_b'))) * 10 + (select count(*) from public.config_clube where chave = 'chefao_ativo' and valor = 'nao' and club_id in (t.id('clube_a'), t.id('clube_b'))), 22);
select public.chefao_premiar();
select t.eq('rodar de novo NÃO paga em dobro', (select coalesce(sum(pontos), 0) from public.pontos where origem = 'chefao'), 1000);

-- ---------- 6) isolamento de falhas: um clube com problema não impede os outros ----------
-- o clube "lixo" tem config inválida (chefao_vida não numérico faz a rotina DELE falhar) e é o 1º da fila
insert into public.organizational_units (type, nome, slug, pais, timezone, metadata, created_at)
values ('clube', 'Clube Lixo', 'clube-lixo-teste', 'BR', 'America/Recife', '{"test_only":true}', '2000-01-01');
select id as clube_lixo from public.organizational_units where slug = 'clube-lixo-teste' \gset
insert into public.config_clube (club_id, chave, valor) values
  (:'clube_lixo', 'chefao_ativo', 'sim'), (:'clube_lixo', 'chefao_inicio', to_char(:'v_hoje'::date - 3, 'YYYY-MM-DD')), (:'clube_lixo', 'chefao_vida', 'abc'),
  (t.id('clube_a'), 'chefao_ativo', 'sim'), (t.id('clube_a'), 'chefao_inicio', to_char(:'v_hoje'::date - 3, 'YYYY-MM-DD')), (t.id('clube_a'), 'chefao_vida', '900')
on conflict (club_id, chave) do update set valor = excluded.valor;
delete from public.config_clube where chave = 'chefao_pago' and club_id = t.id('clube_a');
select t.permitido('a rotina do chefão não estoura por causa do clube com config inválida', $q$select public.chefao_premiar()$q$);
select t.eq('...e o clube A (config boa, depois do clube com falha na fila) foi julgado: ganhou de novo (vida 900)', (select coalesce(sum(pontos), 0) from public.pontos where origem = 'chefao' and usuario_id = t.id('membro_a') and club_id = t.id('clube_a')), 1900);
reset role;

select t.fim();
rollback;
