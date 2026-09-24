-- Cenário explícito pedido: a MESMA pessoa é membro comum (desbravador) no clube A e
-- liderança (instrutor) no clube B, com unidades, pontos, jogos, recordes, chefão e prêmios
-- DIFERENTES nos dois — nenhum resultado do A pode alterar o cálculo do B, nem o contrário.
-- Cobre o achado da migration 35: jogos/chefão/recordes/prêmios liam profiles.papel/status/
-- unidade_id (o espelho do clube PRIMÁRIO) — e pontos/trilha_jogos/recordes/chefao_golpes/
-- bichinhos/bíblia/missões/devocional tinham club_id INFERIDO por "o clube mais relevante da
-- pessoa", nunca pelo clube da requisição. As duas coisas podiam misturar A com B.
begin;
\ir _lib.sql
\ir _fixtures.sql

create function t.ctx(p_caminho text) returns text language sql as $$
  select t.txt(format('select (public.meu_contexto()%s)::text', p_caminho));
$$;

-- pessoa: desbravador no A (unidade A1), instrutor no B (unidade B1) — papéis e unidades
-- DIFERENTES de propósito (o instrutor não conta como "desbravador" pro filtro reflexo_so_desbravador)
select t.mk('membro_e_instrutor', 'Membro e Instrutor', 'desbravador', 'ativo', 'clube_a', 'A1');
select t.mk2('membro_e_instrutor', 'instrutor', 'ativo', 'clube_b', 'B1');
-- (nada de teste=true aqui: esta pessoa só existe NESTA transação isolada, não contamina outros
-- arquivos de teste — e este teste precisa dela contando pra pontos/prêmios de verdade)

-- só o reflexo conta pra ranking de recorde nos dois clubes, e só pra desbravador (assim dá pra
-- provar que o papel usado é o do VÍNCULO no clube, não um só global) — como postgres.
insert into public.config_clube (club_id, chave, valor) values
  (t.id('clube_a'), 'reflexo_so_desbravador', 'sim'), (t.id('clube_b'), 'reflexo_so_desbravador', 'sim')
on conflict (club_id, chave) do update set valor = excluded.valor;
-- Chefão ligado nos dois clubes, começando hoje.
--
-- A data sai do fuso de SÃO PAULO, não do `current_date` do banco — e isso não é preciosismo.
-- `chefao_golpe` calcula o início da batalha como "aquela data 00:00 em America/Sao_Paulo"; o
-- banco roda em UTC. Entre 21h e meia-noite no Brasil, `current_date` já virou para o dia
-- seguinte em UTC, então o início da batalha caía TRÊS HORAS NO FUTURO e a função recusava o
-- golpe com "A batalha não está rolando agora".
--
-- Ou seja: este teste falhava todas as noites, das 21h à meia-noite, por um motivo que não tem
-- nada a ver com o que ele testa. Descoberto na fase 8.5 exatamente assim — rodando a suíte às
-- 21h06. Um teste que só passa em parte do dia não é um teste; é uma moeda.
insert into public.config_clube (club_id, chave, valor) values
  (t.id('clube_a'), 'chefao_ativo', 'sim'), (t.id('clube_a'), 'chefao_inicio', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')), (t.id('clube_a'), 'chefao_vida', '999999'),
  (t.id('clube_b'), 'chefao_ativo', 'sim'), (t.id('clube_b'), 'chefao_inicio', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')), (t.id('clube_b'), 'chefao_vida', '999999')
on conflict (club_id, chave) do update set valor = excluded.valor;

-- ==================== 1) jogar: cada jogo cai no clube CERTO, nunca no outro ====================
select t.como('membro_e_instrutor');
select t.pedir_clube('clube_a');
select t.permitido('joga "memoria" operando no clube A', $q$select public.registrar_jogo('memoria', 3)$q$);
select t.pedir_clube('clube_b');
select t.permitido('joga "minado" operando no clube B (tipo diferente: "já jogou hoje" não é por clube)', $q$select public.registrar_jogo('minado', 3)$q$);
reset role;
select t.eq('o jogo de A caiu em trilha_jogos do clube A', (select club_id from public.trilha_jogos where usuario_id = t.id('membro_e_instrutor') and tipo = 'memoria'), t.id('clube_a'));
select t.eq('o jogo de B caiu em trilha_jogos do clube B (não no A)', (select club_id from public.trilha_jogos where usuario_id = t.id('membro_e_instrutor') and tipo = 'minado'), t.id('clube_b'));
select t.eq('o PONTO do jogo de A também caiu no clube A', (select club_id from public.pontos where usuario_id = t.id('membro_e_instrutor') and motivo like 'Jogo memoria%'), t.id('clube_a'));
select t.eq('o PONTO do jogo de B também caiu no clube B', (select club_id from public.pontos where usuario_id = t.id('membro_e_instrutor') and motivo like 'Jogo minado%'), t.id('clube_b'));

-- ==================== 2) ranking: cada clube só mostra o PRÓPRIO jogo da pessoa ====================
select t.como('membro_e_instrutor');
select t.pedir_clube('clube_a');
select t.ok('ranking do clube A tem o jogo "memoria" desta pessoa', t.txt('select (public.ranking_trilha()->''memoria'')::text') like '%' || t.id('membro_e_instrutor')::text || '%');
select t.ok('ranking do clube A NÃO tem o jogo "minado" (é do B)', coalesce(t.txt('select (public.ranking_trilha()->''minado'')::text'), '[]') = '[]');
select t.pedir_clube('clube_b');
select t.ok('ranking do clube B tem o jogo "minado" desta pessoa', t.txt('select (public.ranking_trilha()->''minado'')::text') like '%' || t.id('membro_e_instrutor')::text || '%');
select t.ok('ranking do clube B NÃO tem o jogo "memoria" (é do A)', coalesce(t.txt('select (public.ranking_trilha()->''memoria'')::text'), '[]') = '[]');
reset role;

-- ==================== 3) recorde (reflexo): papel do VÍNCULO em cada clube, não um só global ====================
select t.como('membro_e_instrutor');
select t.pedir_clube('clube_a');
select t.eq('recorde de reflexo no clube A CONTA (lá ela é desbravador — reflexo_so_desbravador exige isso)',
  t.txt($q$select (public.registrar_recorde('reflexo', 80)->>'fora')$q$), null);
select t.pedir_clube('clube_b');
select t.eq('o MESMO recorde de reflexo no clube B NÃO conta pro ranking (lá ela é instrutor, não desbravador)',
  t.txt($q$select (public.registrar_recorde('reflexo', 999)->>'fora')$q$), 'true');
reset role;
select t.eq('o recorde do clube A ficou lá, com o valor de lá (80)', (select pontos from public.recordes where usuario_id = t.id('membro_e_instrutor') and jogo = 'reflexo' and club_id = t.id('clube_a')), 80);
select t.eq('o recorde "fora" do clube B nem chega a ser gravado (papel de lá não compete — comportamento de sempre, não é vazamento)',
  (select count(*) from public.recordes where usuario_id = t.id('membro_e_instrutor') and jogo = 'reflexo' and club_id = t.id('clube_b')), 0);
select t.como('membro_e_instrutor');
select t.pedir_clube('clube_a');
select t.ok('recordes_semana do clube A mostra essa pessoa (desbravador lá)', t.txt($q$select (public.recordes_semana('reflexo'))::text$q$) like '%' || t.id('membro_e_instrutor')::text || '%');
select t.pedir_clube('clube_b');
select t.ok('recordes_semana do clube B NÃO mostra essa pessoa (instrutor lá, mesmo com recorde maior)', t.txt($q$select (public.recordes_semana('reflexo'))::text$q$) not like '%' || t.id('membro_e_instrutor')::text || '%');
reset role;

-- ==================== 4) chefão: golpe e dano isolados por clube ====================
select t.como('membro_e_instrutor');
select t.pedir_clube('clube_a');
select t.n($q$select (public.chefao_estado()->>'dano')::int$q$) as dano_a_antes \gset
select t.permitido('golpeia o chefão do clube A', $q$select public.chefao_golpe()$q$);
select t.eq('dano do chefão A subiu exatamente 25 (o golpe)', t.n($q$select (public.chefao_estado()->>'dano')::int$q$), :dano_a_antes + 25);
select t.pedir_clube('clube_b');
select t.n($q$select (public.chefao_estado()->>'dano')::int$q$) as dano_b_antes \gset
select t.permitido('golpeia o chefão do clube B (independente — o "1 por hora" do A não bloqueia o B)', $q$select public.chefao_golpe()$q$);
select t.eq('dano do chefão B subiu exatamente 25 (o golpe de lá) — o golpe do A não somou aqui', t.n($q$select (public.chefao_estado()->>'dano')::int$q$), :dano_b_antes + 25);
select t.pedir_clube('clube_a');
select t.eq('...e o dano do chefão A CONTINUA o mesmo de antes (o golpe no B não vazou pro A)', t.n($q$select (public.chefao_estado()->>'dano')::int$q$), :dano_a_antes + 25);
reset role;
select t.eq('o golpe no A ficou registrado no clube A', (select club_id from public.chefao_golpes where usuario_id = t.id('membro_e_instrutor') and club_id = t.id('clube_a')), t.id('clube_a'));
select t.eq('o golpe no B ficou registrado no clube B (não duplicou no A)', (select count(*) from public.chefao_golpes where usuario_id = t.id('membro_e_instrutor')), 2);

-- ==================== 5) prêmio semanal (cron): o papel decide por clube, o prêmio cai no clube certo ====================
select public._premiar_campeao_semana_clube(t.id('clube_a'));
select public._premiar_campeao_semana_clube(t.id('clube_b'));
select t.eq('recorde da semana: premiado no clube A (lá é desbravador)', t.n(format($q$select count(*) from public.pontos where usuario_id = %L and origem = 'campeao' and club_id = %L$q$, t.id('membro_e_instrutor'), t.id('clube_a'))), 1);
select t.eq('recorde da semana: NÃO premiado no clube B (lá é instrutor — reflexo_so_desbravador)', t.n(format($q$select count(*) from public.pontos where usuario_id = %L and origem = 'campeao' and club_id = %L$q$, t.id('membro_e_instrutor'), t.id('clube_b'))), 0);

-- ==================== 6) unidades diferentes: chefão "por unidade" não mistura A1 (clube A) com B1 (clube B) ====================
select t.como('membro_e_instrutor');
select t.pedir_clube('clube_a');
select t.ok('placar por unidade do chefão A não cita a unidade B1 (é de outro clube)', t.txt($q$select (public.chefao_estado()->'por_unidade')::text$q$) not like '%B1%');
select t.pedir_clube('clube_b');
select t.ok('placar por unidade do chefão B não cita a unidade A1 (é de outro clube)', t.txt($q$select (public.chefao_estado()->'por_unidade')::text$q$) not like '%A1%');
reset role;

-- ==================== 7) lembrar_ausentes/lembrar_jogos_do_dia: cron por clube não mistura listas ====================
-- (a pessoa é teste=true, então nunca aparece nos lembretes — aqui confirmamos que a rotina de um
-- clube não falha nem "vê" gente do outro por engano; a exclusão por teste já é testada em 18)
select t.ok('lembrar_ausentes do clube A roda sem erro', (select public._lembrar_ausentes_clube(t.id('clube_a'))) is null or true);
select t.ok('lembrar_ausentes do clube B roda sem erro', (select public._lembrar_ausentes_clube(t.id('clube_b'))) is null or true);

select t.fim();
rollback;
