-- Migrations 260/261: CANTINHO DA UNIDADE.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- tesoureiro(a) DA UNIDADE A1 (cargo_unidade) e um conselheiro associado (instrutor com cargo em A1)
select t.mk('tes_a1', 'Tesoureira A1', 'desbravador', 'ativo', 'clube_a', 'A1', date '2012-02-02');
select t.mk('assoc_a1', 'Associado A1', 'instrutor', 'ativo', 'clube_a', 'A1');
update public.organization_memberships set cargo_unidade = 'tesoureiro' where user_id = t.id('tes_a1') and organizational_unit_id = t.id('clube_a');
update public.organization_memberships set cargo_unidade = 'conselheiro_associado' where user_id = t.id('assoc_a1') and organizational_unit_id = t.id('clube_a');

-- chamada da última reunião = Apontamento que já existe (membro_a faltou, tes_a1 veio e foi à igreja)
insert into public.pontos (usuario_id, origem, pontos, motivo, data, marca, club_id) values
  (t.id('membro_a'), 'apontamento', 0, 'Reunião teste', now() - interval '3 days', '{"presenca":"faltou"}', t.id('clube_a')),
  (t.id('tes_a1'), 'apontamento', 20, 'Reunião teste', now() - interval '3 days', '{"presenca":"naHora","igreja":true}', t.id('clube_a')),
  (t.id('membro_a2'), 'apontamento', 10, 'Reunião teste', now() - interval '3 days', '{"presenca":"naHora"}', t.id('clube_a'));

reset role;
select t.ok('anon sem EXECUTE nas RPCs', not has_function_privilege('anon', 'public.cantinho_ver(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.cantinho_mural_enviar(uuid, text, text, boolean)', 'execute'));
select t.ok('sem leitura direta das tabelas', not has_table_privilege('authenticated', 'public.unidade_mural', 'select')
  and not has_table_privilege('authenticated', 'public.unidade_caixa', 'select')
  and not has_table_privilege('anon', 'public.unidade_mural', 'select'));
select t.ok('recurso no catálogo, ligado por padrão', (select padrao from public.recursos_catalogo where chave = 'cantinho_unidade'));

-- ==================== 1) conselheiro só na PRÓPRIA unidade ====================
select t.como('conselheiro_a');
select t.eq('conselheiro é líder em A1', t.txt(format('select public.cantinho_ver(%L)->>''papel''', t.id('A1'))), 'lider');
select t.eq('conselheiro abre só o cantinho da própria unidade', t.n('select count(*) from public.cantinho_minhas_unidades()'), 1);
select t.throws('conselheiro não abre A2', format('select public.cantinho_ver(%L)', t.id('A2')), 'Sem permissão');
select t.throws('conselheiro não lança meditação em A2', format('select public.cantinho_meditacao_salvar(%L, %L)', t.id('A2'), 'x'), 'Sem permissão');
select t.permitido('conselheiro salva a meditação do domingo', format('select public.cantinho_meditacao_salvar(%L, %L, %L)', t.id('A1'), 'Deus cuida de você.', 'Sl 23'));
select t.eq('chamada vem do Apontamento (só membros de A1)', t.n(format(
  'select jsonb_array_length(public.cantinho_ver(%L)->''chamada''->0->''itens'')', t.id('A1'))), 2);
select t.permitido('conselheiro justifica a falta', format('select public.cantinho_justificar(%L, %L, %L, %L)',
  t.id('A1'), t.id('membro_a'), ((now() - interval '3 days') at time zone 'America/Sao_Paulo')::date, 'Doente'));
select t.eq('falta virou justificada', t.txt(format(
  $q$select i->>'status' from jsonb_array_elements(public.cantinho_ver(%L)->'chamada'->0->'itens') i where i->>'usuario_id' = %L$q$,
  t.id('A1'), t.id('membro_a'))), 'justificada');
select t.eq('resumo do culto (marca igreja do Apontamento)', t.n(format(
  $q$select (r->>'culto')::int from jsonb_array_elements(public.cantinho_ver(%L)->'resumo') r where r->>'usuario_id' = %L$q$,
  t.id('A1'), t.id('tes_a1'))), 1);
select t.throws('não justifica gente de outra unidade', format('select public.cantinho_justificar(%L, %L, current_date, %L)',
  t.id('A1'), t.id('membro_a2'), 'x'), 'não é desta unidade');
select t.permitido('conselheiro agenda reunião', format('select public.cantinho_reuniao_salvar(%L, null, now() + interval ''2 days'', %L, %L)', t.id('A1'), 'Sala 2', 'Ensaio'));
select t.permitido('conselheiro cria item do planejamento', format('select public.cantinho_plano_salvar(%L, null, %L, null, %L, null)', t.id('A1'), 'Acampar', 'a_fazer'));

select t.como('assoc_a1');
select t.eq('conselheiro associado (cargo) também é líder', t.txt(format('select public.cantinho_ver(%L)->>''papel''', t.id('A1'))), 'lider');

-- diretoria: todas as unidades
select t.como('lider_a');
select t.eq('diretoria abre todas as unidades do clube', t.n('select count(*) from public.cantinho_minhas_unidades()'),
  t.n('select count(*) from public.unidades'));
select t.permitido('diretoria edita planejamento de A2', format('select public.cantinho_plano_salvar(%L, null, %L, null, null, null)', t.id('A2'), 'Meta A2'));
select t.eq('diretoria vê o planejamento de A1', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''plano'')', t.id('A1'))), 1);

-- instrutor sem unidade não entra
select t.como('instrutor_a');
select t.throws('instrutor sem unidade não abre cantinho', format('select public.cantinho_ver(%L)', t.id('A1')), 'Sem permissão');

-- ==================== 2) membro vê o que é dele; outra unidade não vê ====================
select t.como('membro_a');
select t.eq('membro é membro', t.txt(format('select public.cantinho_ver(%L)->>''papel''', t.id('A1'))), 'membro');
select t.eq('membro vê a meditação da semana', t.txt(format('select public.cantinho_ver(%L)->''meditacao''->>''referencia''', t.id('A1'))), 'Sl 23');
select t.eq('membro vê só a própria linha da chamada', t.n(format(
  'select jsonb_array_length(public.cantinho_ver(%L)->''chamada''->0->''itens'')', t.id('A1'))), 1);
select t.eq('membro não vê o planejamento', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''plano'')', t.id('A1'))), 0);
select t.eq('membro vê a reunião da unidade', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''reunioes'')', t.id('A1'))), 1);
select t.permitido('membro envia pedido de oração', format('select public.cantinho_mural_enviar(%L, %L, %L, false)', t.id('A1'), 'pedido', 'Pela minha avó'));
select t.permitido('membro envia pedido PRIVADO', format('select public.cantinho_mural_enviar(%L, %L, %L, true)', t.id('A1'), 'pedido', 'Segredo'));
select t.throws('membro não modera', format('select public.cantinho_mural_moderar((select null::uuid), true)'), null);
select t.throws('membro não lança no caixa', format('select public.cantinho_caixa_lancar(%L, null, %L, %L, 500)', t.id('A1'), 'Rifa', 'entrada'), 'Sem permissão');
select t.throws('membro não confirma ajuda', format('select public.cantinho_ajuda_confirmar(%L, %L)', t.id('A1'), t.id('tes_a1')), 'Sem permissão');

select t.como('tes_a1');
select t.eq('colega vê o pedido público (não o privado)', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''mural'')', t.id('A1'))), 1);

select t.como('membro_a2');
select t.throws('membro de OUTRA unidade não abre A1', format('select public.cantinho_ver(%L)', t.id('A1')), 'Sem permissão');
select t.throws('membro de outra unidade não posta em A1', format('select public.cantinho_mural_enviar(%L, %L, %L)', t.id('A1'), 'pedido', 'x'), 'Sem permissão');
select t.eq('membro de A2 abre só A2', t.n('select count(*) from public.cantinho_minhas_unidades()'), 1);

select t.como('lider_b');
select t.throws('diretoria de OUTRO clube não abre A1', format('select public.cantinho_ver(%L)', t.id('A1')), 'Sem permissão');
select t.como('pais_a');
select t.throws('responsável não abre cantinho', format('select public.cantinho_ver(%L)', t.id('A1')), 'Sem permissão');

reset role;
insert into t.ids select 'pedido_avo', id from public.unidade_mural where texto = 'Pela minha avó';
select t.como('conselheiro_a');
select t.eq('conselheiro vê público + privado', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''mural'')', t.id('A1'))), 2);
select t.permitido('conselheiro modera (esconde) o pedido', format('select public.cantinho_mural_moderar(%L, true)', t.id('pedido_avo')));
select t.como('tes_a1');
select t.eq('pedido moderado some para a unidade', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''mural'')', t.id('A1'))), 0);
select t.como('membro_a');
select t.eq('autor ainda vê os seus', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''mural'')', t.id('A1'))), 2);

-- ==================== 3) mural zera no domingo ====================
reset role;
update public.unidade_mural set semana = public.cantinho_domingo(now()) - 7;   -- viraram "semana passada"
select t.como('tes_a1');
select t.eq('mural da semana zerou', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''mural'')', t.id('A1'))), 0);
select t.eq('colega não vê histórico alheio', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''mural_historico'')', t.id('A1'))), 0);
select t.como('conselheiro_a');
select t.eq('conselheiro vê o histórico', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''mural_historico'')', t.id('A1'))), 2);
reset role;
select t.eq('linhas continuam no banco (sem job destrutivo)', (select count(*) from public.unidade_mural), 2::bigint);
select t.eq('domingo é domingo', (select extract(dow from public.cantinho_domingo(now()))::bigint), 0::bigint);
select t.eq('sábado 23h59 de SP ainda é a semana anterior',
  public.cantinho_domingo(timestamptz '2026-10-03 23:59:00-03')::text, '2026-09-27');
select t.eq('domingo 00h01 de SP abre a semana nova',
  public.cantinho_domingo(timestamptz '2026-10-04 00:01:00-03')::text, '2026-10-04');

-- ==================== 4) ajudar os pais: pontos 1x por semana ====================
select t.como('lider_a');
select t.permitido('diretoria define o valor', 'select public.cantinho_config_definir(15)');
select t.throws('valor acima do teto recusado', 'select public.cantinho_config_definir(500)', 'entre 0 e 50');
select t.como('conselheiro_a');
select t.throws('conselheiro não define o valor', 'select public.cantinho_config_definir(40)', 'Sem permissão');
select t.como('membro_a');
select t.permitido('desbravador registra a ajuda', format('select public.cantinho_ajuda_registrar(%L, %L)', t.id('A1'), 'Lavei a louça'));
select t.throws('só 1 registro por semana', format('select public.cantinho_ajuda_registrar(%L, %L)', t.id('A1'), 'De novo'), 'já registrou');
reset role;
select t.eq('registrar ainda não dá ponto', (select count(*) from public.pontos where origem = 'ajuda_pais'), 0::bigint);
select t.como('conselheiro_a');
select t.eq('conselheiro confirma: 15 pontos', t.n(format('select (public.cantinho_ajuda_confirmar(%L, %L)->>''pontos'')::int', t.id('A1'), t.id('membro_a'))), 15);
select t.throws('segunda confirmação na semana recusada', format('select public.cantinho_ajuda_confirmar(%L, %L)', t.id('A1'), t.id('membro_a')), '1x por semana');
select t.throws('conselheiro não confirma desbravador de outra unidade', format('select public.cantinho_ajuda_confirmar(%L, %L)', t.id('A1'), t.id('membro_a2')), 'não é desbravador');
select t.throws('conselheiro não confirma em A2', format('select public.cantinho_ajuda_confirmar(%L, %L)', t.id('A2'), t.id('membro_a2')), 'Sem permissão');
reset role;
select t.eq('1 ponto de ajuda_pais, no clube A, lançado pelo conselheiro',
  (select count(*) from public.pontos where origem = 'ajuda_pais' and usuario_id = t.id('membro_a') and club_id = t.id('clube_a')
      and lancado_por = t.id('conselheiro_a') and pontos = 15), 1::bigint);
-- semana seguinte: vale de novo
update public.unidade_ajuda_pais set semana = semana - 7;
select t.como('conselheiro_a');
select t.permitido('na semana seguinte vale de novo (lançado direto)', format('select public.cantinho_ajuda_confirmar(%L, %L, %L)', t.id('A1'), t.id('membro_a'), 'Arrumou o quarto'));
reset role;
select t.eq('2 pontos de ajuda em 2 semanas', (select count(*) from public.pontos where origem = 'ajuda_pais' and usuario_id = t.id('membro_a')), 2::bigint);
-- o teto de pontos do conselheiro (limita_pontos_conselheiro) continua valendo: valor 50 < 100, e o
-- gatilho está na tabela pontos (não foi contornado)
select t.ok('teto do conselheiro segue ligado em pontos', exists (select 1 from pg_trigger where tgname = 'trg_limita_pontos_conselheiro' and not tgisinternal));
insert into t.ids select 'ajuda_atual', id from public.unidade_ajuda_pais where semana = public.cantinho_domingo(now());
select t.como('membro_a2');
select t.throws('outra unidade não desfaz', format('select public.cantinho_ajuda_desfazer(%L)', t.id('ajuda_atual')), 'Sem permissão');
select t.como('conselheiro_a');
select t.permitido('conselheiro desfaz (engano)', format('select public.cantinho_ajuda_desfazer(%L)', t.id('ajuda_atual')));
reset role;
select t.eq('ponto desfeito', (select count(*) from public.pontos where origem = 'ajuda_pais' and usuario_id = t.id('membro_a')), 1::bigint);

-- ==================== 5) caixa: só conselheiro/tesoureiro da unidade (e diretoria) ====================
select t.como('tes_a1');
select t.permitido('tesoureira da unidade lança entrada', format('select public.cantinho_caixa_lancar(%L, null, %L, %L, 2000)', t.id('A1'), 'Rifa', 'entrada'));
select t.throws('tesoureira de A1 não lança em A2', format('select public.cantinho_caixa_lancar(%L, null, %L, %L, 100)', t.id('A2'), 'x', 'entrada'), 'Sem permissão');
select t.como('conselheiro_a');
select t.permitido('conselheiro lança saída', format('select public.cantinho_caixa_lancar(%L, null, %L, %L, 500)', t.id('A1'), 'Lanche', 'saida'));
select t.throws('valor negativo recusado', format('select public.cantinho_caixa_lancar(%L, null, %L, %L, -5)', t.id('A1'), 'x', 'entrada'), 'Valor inválido');
select t.eq('saldo = 1500 centavos', t.n(format('select (public.cantinho_ver(%L)->''caixa''->>''saldo_centavos'')::int', t.id('A1'))), 1500);
select t.como('membro_a');
select t.eq('membro vê só o saldo, sem lançamentos', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''caixa''->''lancamentos'')', t.id('A1'))), 0);
select t.como('lider_a');
select t.eq('diretoria vê os lançamentos', t.n(format('select jsonb_array_length(public.cantinho_ver(%L)->''caixa''->''lancamentos'')', t.id('A1'))), 2);

-- ==================== 6) recurso desligado ====================
reset role;
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'cantinho_unidade', false)
on conflict (club_id, feature) do update set enabled = false;
select t.como('conselheiro_a');
select t.throws('recurso desligado barra', format('select public.cantinho_ver(%L)', t.id('A1')), 'desabilitado');
select t.eq('menu some com o recurso desligado', t.n('select count(*) from public.cantinho_minhas_unidades()'), 0);

-- lixeira conhece as tabelas do cantinho
reset role;
select t.eq('lixeira arquiva os pedidos da criança', (select count(*) from public._lixeira_catalogo() where tabela in ('unidade_mural', 'unidade_ajuda_pais', 'unidade_justificativas')), 3::bigint);

select t.fim();
rollback;
