-- Reavaliação das pendências (duelos, jogos, missões, chat, bichinho, config_clube): enquanto essas
-- features não são tenantizadas "de verdade", elas pertencem ao Tenant 001 e ficam FECHADAS para
-- outro clube — sem vazar leitura e sem aceitar escrita. Aqui com dados reais gerados pelo clube
-- legado (via RPCs) e atores do clube B tentando ler/gravar.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- dados reais do clube legado (A), pelas próprias RPCs do app ----------
select t.como('membro_a');
select t.permitido('A: mensagem no chat geral', $q$select public.chat_enviar_geral('legado geral')$q$);
select t.permitido('A: mensagem no chat da unidade', $q$select public.chat_enviar_unidade('legado unidade')$q$);
select t.permitido('A: mensagem direta', format($q$select public.chat_enviar_direta(%L, 'legado direta')$q$, t.id('membro_a2')));
select t.permitido('A: missão do dia', $q$select public.registrar_missao(null, 0)$q$);
select t.permitido('A: devocional', $q$select public.registrar_devocional(0)$q$);
select t.permitido('A: adota bichinho', $q$select public.bichinho_adotar('Rex', 'cachorro')$q$);
select t.permitido('A: cria duelo entre unidades A1 x A2', format($q$select public.criar_duelo((select id from public.desafios_unidade where ativo limit 1), %L)$q$, t.id('A2')));
reset role;
insert into public.trilha_jogos (usuario_id, data, tipo, estrelas) values (t.id('membro_a'), current_date, 'memoria', 3);
insert into public.recordes (usuario_id, jogo, semana, pontos) values (t.id('membro_a'), 'reflexo', date_trunc('week', current_date)::date, 42);
select id as duelo_id from public.duelos order by created_at desc limit 1 \gset

select t.ok('os dados do clube legado existem (chat, missão, bichinho, duelo, jogos)',
  (select count(*) from public.chat_mensagens) >= 3 and (select count(*) from public.missoes_feitas) >= 1
  and (select count(*) from public.bichinhos) >= 1 and (select count(*) from public.duelos) >= 1
  and (select count(*) from public.trilha_jogos) >= 1 and (select count(*) from public.recordes) >= 1);

-- ---------- o clube legado enxerga o próprio (não quebramos o Tenant 001) ----------
select t.como('membro_a');
select t.ok('A lê o chat geral', t.n($q$select count(*) from public.chat_mensagens where texto = 'legado geral'$q$) = 1);
select t.ok('A lê as próprias missões', t.n('select count(*) from public.missoes_feitas') >= 1);
select t.ok('A vê o duelo do clube', t.n('select count(*) from public.duelos') >= 1);
select t.ok('A lê o catálogo de desafios de unidade', t.n('select count(*) from public.desafios_unidade') >= 1);
select t.ok('A vê o ranking dos jogos com a própria jogada', t.n(format($q$select count(*) from json_each(public.ranking_trilha()) e cross join lateral json_array_elements(e.value) x where x->>'id' = %L$q$, t.id('membro_a'))) >= 1);
select t.ok('A vê os pets do clube', t.n('select count(*) from public.pets_do_clube()') >= 1);

-- ---------- atores do clube B: nada de leitura ----------
select t.como('membro_b');
select t.eq('B lê 0 mensagens de chat', t.nv('select count(*) from public.chat_mensagens'), 0);
select t.eq('B lê 0 conversas de chat', t.nv('select count(*) from public.chat_conversas'), 0);
select t.eq('B lê 0 participantes de chat', t.nv('select count(*) from public.chat_participantes'), 0);
select t.eq('B lê 0 missões', t.nv('select count(*) from public.missoes_feitas'), 0);
select t.eq('B lê 0 devocionais', t.nv('select count(*) from public.devocional'), 0);
select t.eq('B lê 0 bichinhos', t.nv('select count(*) from public.bichinhos'), 0);
select t.eq('B lê 0 jogadas', t.nv('select count(*) from public.trilha_jogos'), 0);
select t.eq('B lê 0 recordes', t.nv('select count(*) from public.recordes'), 0);
select t.eq('B lê 0 duelos', t.nv('select count(*) from public.duelos'), 0);
select t.eq('B lê 0 desafios de unidade', t.nv('select count(*) from public.desafios_unidade'), 0);
select t.eq('B lê 0 config do clube', t.nv('select count(*) from public.config_clube'), 0);
select t.eq('B lê 0 pedidos de ajuda', t.nv('select count(*) from public.ajudas'), 0);
select t.eq('B lê 0 partidas', t.nv('select count(*) from public.partidas'), 0);
select t.eq('B não aparece nem enxerga o ranking dos jogos do clube legado', t.nv(format($q$select count(*) from json_each(public.ranking_trilha()) e cross join lateral json_array_elements(e.value) x where x->>'id' = %L$q$, t.id('membro_a'))), 0);
select t.eq('B não enxerga o recorde da semana do clube legado', t.nv(format($q$select count(*) from json_array_elements(public.recordes_semana('reflexo')) x where x->>'id' = %L$q$, t.id('membro_a'))), 0);
select t.eq('B não vê pets do clube legado', t.nv('select count(*) from public.pets_do_clube()'), 0);
select t.eq('B não vê pedidos de ajuda recebidos', t.n('select json_array_length(public.ajudas_recebidas())'), 0);
select t.eq('B não acompanha o progresso de duelo do clube legado', t.nv(format($q$select count(*) from json_each(public.progresso_duelo(%L)) where false$q$, :'duelo_id')), 0);
select t.eq('B vê o chefão do clube legado como inativo (nada do chefão dele)', t.txt($q$select (public.chefao_estado()->>'ativo')$q$), 'false');
select t.eq('B não vê jogadas de ninguém no rodízio de hoje (a config é catálogo global, sem dado de pessoa)', t.n($q$select json_array_length(public.status_jogos_do_dia()->'hoje')$q$), 0);

-- ---------- atores do clube B: nada de escrita ----------
select t.throws('B não escreve no chat geral', $q$select public.chat_enviar_geral('invasão')$q$);
select t.throws('B não escreve no chat da unidade', $q$select public.chat_enviar_unidade('invasão')$q$);
select t.throws('B não manda mensagem direta a membro do clube legado', format($q$select public.chat_enviar_direta(%L, 'invasão')$q$, t.id('membro_a')));
select t.throws('B não registra missão', $q$select public.registrar_missao(null, 0)$q$);
select t.throws('B não registra devocional', $q$select public.registrar_devocional(0)$q$);
select t.throws('B não adota bichinho', $q$select public.bichinho_adotar('Invasor', 'gato')$q$);
select t.throws('B não desafia unidade do clube legado', format($q$select public.criar_duelo((select id from public.desafios_unidade limit 1), %L)$q$, t.id('A1')));
select t.throws('B não pede ajuda a membro do clube legado', format($q$select public.pedir_ajuda(%L, 'forca', '{}'::jsonb, 'x')$q$, t.id('membro_a')));
select t.bloqueado('B não grava jogada direto', format($q$insert into public.trilha_jogos (usuario_id, data, tipo, estrelas) values (%L, current_date, 'memoria', 3)$q$, t.id('membro_b')));
select t.bloqueado('B não grava recorde direto', format($q$insert into public.recordes (usuario_id, jogo, semana, pontos) values (%L, 'reflexo', current_date, 999)$q$, t.id('membro_b')));

-- ---------- liderança do clube B: nenhuma ação de gestão dessas features ----------
select t.como('lider_b');
select t.eq('líder B lê 0 missões', t.nv('select count(*) from public.missoes_feitas'), 0);
select t.eq('líder B não lista missões pendentes do clube legado', t.nv('select count(*) from public.missoes_pendentes()'), 0);
select t.throws('líder B não aprova missão', format($q$select public.avaliar_missao(%L, true)$q$, gen_random_uuid()), 'permiss');
select t.throws('líder B não julga duelo', format($q$select public.julgar_duelo(%L, 'a')$q$, :'duelo_id'));
select t.throws('líder B não cancela duelo', format($q$select public.cancelar_duelo(%L)$q$, :'duelo_id'));
select t.bloqueado('líder B não liga/desliga jogos', $q$update public.jogos_trilha set ativo = true$q$);
select t.bloqueado('líder B não mexe no catálogo de desafios de unidade', $q$update public.desafios_unidade set pontos = 999$q$);
select t.bloqueado('líder B não mexe no catálogo de missões (desafios)', $q$update public.desafios set ativo = false$q$);
select t.bloqueado('líder B não mexe nos versículos', $q$update public.versiculos set ativo = false$q$);
select t.throws('líder B não libera jogo', $q$select public.liberar_jogo('memoria')$q$);
select t.throws('líder B não configura o chefão', $q$select public.chefao_config('X', 'x', 10, 'v', current_date, true)$q$);
select t.throws('líder B não apaga mensagem de chat', format($q$select public.chat_apagar_mensagem(%L)$q$, gen_random_uuid()));
select t.throws('líder B não vê a atividade dos jogos', 'select public.atividade_jogos()');

-- ---------- responsável e anônimo ----------
select t.como('pais_a');
select t.eq('responsável do clube legado não lê chat', t.nv('select count(*) from public.chat_mensagens'), 0);
select t.eq('responsável do clube legado não lê missões', t.nv('select count(*) from public.missoes_feitas'), 0);
select t.eq('responsável do clube legado não lê duelos', t.nv('select count(*) from public.duelos'), 0);
select t.throws('responsável não escreve no chat', $q$select public.chat_enviar_geral('oi')$q$);
select t.como_anon();
select t.eq('anon: 0 chat', t.nv('select count(*) from public.chat_mensagens'), 0);
select t.eq('anon: 0 duelos', t.nv('select count(*) from public.duelos'), 0);
select t.eq('anon: 0 catálogo de jogos', t.nv('select count(*) from public.jogos_trilha') , 0);

select t.fim();
rollback;
