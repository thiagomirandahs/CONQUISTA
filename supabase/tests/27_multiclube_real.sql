-- Multi-clube DE VERDADE (migration 34): 1 clube por pessoa saiu, papel/unidade/status são do
-- VÍNCULO (não de profiles), e "clube em uso" é uma seleção EXPLÍCITA por requisição (header
-- x-clube-atual, simulado aqui por t.pedir_clube) — nunca confiada sem checar o vínculo real.
--   1) membro de 1 clube só            6) vínculo suspenso em só 1 clube
--   2) 2 clubes, papéis diferentes     7) troca de clube durante a "sessão"
--   3) diretor no A, membro no B       8) duas ABAS (mesmo usuário, requisições concorrentes)
--   4) instrutor em unidades diferentes 9) tentativa de forjar club_id
--   5) responsável com vínculos em 2   10) remoção de vínculo com a "sessão" aberta
-- Clube A = Tenant 001 (legado); clube B = Tenant 002 (teste). Fixtures: _fixtures.sql.
begin;
\ir _lib.sql
\ir _fixtures.sql

create function t.ctx(p_caminho text) returns text language sql as $$
  select t.txt(format('select (public.meu_contexto()%s)::text', p_caminho));
$$;

-- ==================== 1) membro de UM clube só ====================
select t.como('membro_a');
select t.eq('1 clube: exatamente 1 vínculo no contexto', t.n($q$select jsonb_array_length(public.meu_contexto()->'vinculos')$q$), 1);
select t.eq('1 clube: selecionável', t.ctx('->''vinculos''->0->>''selecionavel'''), 'true');
select t.eq('1 clube: clube_atual_id() é o único que tem', t.txt('select public.clube_atual_id()::text'), t.id('clube_a')::text);
reset role;

-- ==================== 2) membro de DOIS clubes, papéis DIFERENTES ====================
select t.como('multi_dois_papeis');
select t.eq('2 clubes: o contexto lista os DOIS', t.n($q$select jsonb_array_length(public.meu_contexto()->'vinculos')$q$), 2);
-- (a ordem depende de qual clube é "atual" por padrão — confere os DOIS papéis presentes, sem depender de ordem)
select t.ok('2 clubes: papel de cada vínculo é o DO CLUBE (desbravador em A, conselheiro em B), não um só pra pessoa toda',
  (t.ctx('->''vinculos''->0->>''papel''') = 'desbravador' and t.ctx('->''vinculos''->1->>''papel''') = 'conselheiro')
  or (t.ctx('->''vinculos''->0->>''papel''') = 'conselheiro' and t.ctx('->''vinculos''->1->>''papel''') = 'desbravador'));
select t.eq('2 clubes: sem pedir nada, clube_atual_id() cai no padrão (o mais antigo = clube A)',
  t.txt('select public.clube_atual_id()::text'), t.id('clube_a')::text);
select t.eq('2 clubes: pedindo o clube A explicitamente, o papel (via meu_contexto, na 1ª posição = clube em uso) é desbravador',
  t.ctx('->''vinculos''->0->>''papel'''), 'desbravador');
select t.pedir_clube('clube_b');
select t.eq('2 clubes: pedindo o clube B (vínculo ativo de verdade), o servidor PASSA a agir lá',
  t.txt('select public.clube_atual_id()::text'), t.id('clube_b')::text);
select t.eq('2 clubes: papel no clube B (agora na 1ª posição) é conselheiro (o mesmo pedido, papel diferente)',
  t.ctx('->''vinculos''->0->>''papel'''), 'conselheiro');
reset role;
select t.eq('confirmado direto no vínculo: papel no clube A é desbravador',
  (select role from public.organization_memberships where user_id = t.id('multi_dois_papeis') and organizational_unit_id = t.id('clube_a')), 'desbravador');
select t.eq('confirmado direto no vínculo: papel no clube B é conselheiro',
  (select role from public.organization_memberships where user_id = t.id('multi_dois_papeis') and organizational_unit_id = t.id('clube_b')), 'conselheiro');

-- ==================== 3) DIRETOR no clube A, membro comum no clube B ====================
-- (os dois vínculos nascem na MESMA transação dos fixtures — sem pedir um clube explícito, qual é
-- "o padrão" é indefinido; por isso toda seção fixa o clube com t.pedir_clube antes de checar)
select t.como('dir_a_membro_b');
select t.pedir_clube('clube_a');
select t.eq('diretor A / membro B: operando no A, gere o clube', t.txt('select public.pode_gerir_no_clube(public.clube_atual_id())::text'), 'true');
select t.permitido('diretor A / membro B: no A, PODE editar o vínculo de outra pessoa (vinculo_gerir)',
  format($q$select public.vinculo_gerir(%L, p_papel := 'conselheiro')$q$, t.id('membro_a2')));
select t.pedir_clube('clube_b');
select t.eq('diretor A / membro B: operando no B, NÃO gere o clube (lá ele é só desbravador)', t.txt('select public.pode_gerir_no_clube(public.clube_atual_id())::text'), 'false');
select t.bloqueado('diretor A / membro B: no B, NÃO pode editar vínculo de ninguém (sem poder de liderança lá)',
  format($q$select public.vinculo_gerir(%L, p_papel := 'conselheiro')$q$, t.id('membro_b')));
reset role;
select t.eq('a promoção no A realmente aconteceu (não foi bloqueada por engano)', (select role from public.organization_memberships where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_a')), 'conselheiro');

-- ==================== 4) INSTRUTOR em unidades DIFERENTES em cada clube ====================
select t.como('instrutor_2clubes');
select t.pedir_clube('clube_a');
select t.eq('contexto: pedindo o A, a unidade do vínculo em uso (1ª posição) é A1', t.ctx('->''vinculos''->0->>''unidade_id'''), t.id('A1')::text);
select t.pedir_clube('clube_b');
select t.eq('contexto: pedindo o B, a unidade do vínculo em uso (1ª posição) é B1 (não A1 — cada clube tem a sua)', t.ctx('->''vinculos''->0->>''unidade_id'''), t.id('B1')::text);
reset role;
select t.eq('confirmado direto no vínculo: unidade no clube A é A1',
  (select unidade_id from public.organization_memberships where user_id = t.id('instrutor_2clubes') and organizational_unit_id = t.id('clube_a')), t.id('A1'));
select t.eq('confirmado direto no vínculo: unidade no clube B é B1',
  (select unidade_id from public.organization_memberships where user_id = t.id('instrutor_2clubes') and organizational_unit_id = t.id('clube_b')), t.id('B1'));

-- ==================== 5) RESPONSÁVEL com vínculos autorizados em 2 clubes ====================
select t.como('pais_2clubes');
select t.pedir_clube('clube_a');
select t.eq('responsável em 2 clubes: pedindo o A, "meus filhos" mostra o filho do A', t.txt($q$select (public.meus_filhos()->0->>'nome')$q$), 'Membro A');
select t.eq('...e só 1 (não vaza o filho do B)', t.n($q$select json_array_length(public.meus_filhos())$q$), 1);
select t.pedir_clube('clube_b');
select t.eq('responsável em 2 clubes: pedindo o B, "meus filhos" passa a mostrar o filho do B', t.txt($q$select (public.meus_filhos()->0->>'nome')$q$), 'Membro B');
select t.eq('...e só 1 (não vaza o filho do A)', t.n($q$select json_array_length(public.meus_filhos())$q$), 1);
reset role;

-- ==================== 6) vínculo SUSPENSO em só UM dos dois clubes ====================
select t.como('suspenso_so_b');
select t.eq('suspenso só no B: o contexto lista os DOIS vínculos', t.n($q$select jsonb_array_length(public.meu_contexto()->'vinculos')$q$), 2);
select t.ok('suspenso só no B: o vínculo ativo (A) é selecionável e o suspenso (B) não',
  (select bool_or(v->>'club_id' = t.id('clube_a')::text and v->>'selecionavel' = 'true')
     and bool_or(v->>'club_id' = t.id('clube_b')::text and v->>'selecionavel' = 'false')
   from jsonb_array_elements(public.meu_contexto()->'vinculos') v));
select t.eq('suspenso só no B: sem pedir nada, o servidor age no A (o único ativo)', t.txt('select public.clube_atual_id()::text'), t.id('clube_a')::text);
select t.pedir_clube('clube_b');
select t.eq('suspenso só no B: PEDIR o B não muda nada — vínculo suspenso nunca é honrado, cai no A de novo',
  t.txt('select public.clube_atual_id()::text'), t.id('clube_a')::text);
select t.eq('suspenso só no B: ainda sem acesso a dados do B (segue operando no A)', t.nv($q$select count(*) from public.fotos where legenda = 'Foto B'$q$), 0);
reset role;

-- ==================== 7) TROCA de clube durante a "sessão" ====================
-- ranking_totais() (como qualquer RPC operacional) é escopada por clube_atual_id() — troca de
-- clube muda o que ela devolve. (Leitura direta da tabela pontos é OUTRA coisa: quem tem vínculo
-- ativo genuíno nos dois clubes sempre pôde ler os pontos de QUALQUER um dos dois — isso já
-- valia antes desta fase, ranking_totais() é o jeito certo de provar que a troca é real.)
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_a');
select t.ok('antes de trocar: ranking do clube A tem o ponto do membro A', t.txt($q$select (public.ranking_totais()->'pessoas')::text$q$) like '%' || t.id('membro_a')::text || '%');
select t.ok('antes de trocar: ranking NÃO tem o ponto do membro B (é do clube B)', t.txt($q$select (public.ranking_totais()->'pessoas')::text$q$) not like '%' || t.id('membro_b')::text || '%');
select t.pedir_clube('clube_b');
select t.ok('depois de trocar (mesma sessão, novo pedido): ranking passa a ser o do clube B', t.txt($q$select (public.ranking_totais()->'pessoas')::text$q$) like '%' || t.id('membro_b')::text || '%');
select t.ok('depois de trocar: NÃO é mais o do clube A (trocou de verdade, não "também vê")', t.txt($q$select (public.ranking_totais()->'pessoas')::text$q$) not like '%' || t.id('membro_a')::text || '%');
select t.esquecer_clube_pedido();
select t.eq('esquecendo o pedido: volta pro padrão (clube A)', t.txt('select public.clube_atual_id()::text'), t.id('clube_a')::text);
reset role;

-- ==================== 8) DUAS ABAS do MESMO usuário, clubes DIFERENTES ao mesmo tempo ====================
-- Não há estado no servidor pra "clube atual da sessão": cada requisição carrega seu próprio
-- pedido de clube — por isso duas requisições concorrentes do MESMO usuário podem agir em clubes
-- diferentes sem se atropelar (é exatamente isso que dá pra simular pedindo um clube por vez).
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_a');
select t.eq('"aba 1" (pediu A): clube_atual_id é A', t.txt('select public.clube_atual_id()::text'), t.id('clube_a')::text);
select t.pedir_clube('clube_b');
select t.eq('"aba 2" (pediu B, mesma sessão de teste): clube_atual_id é B — não herdou o pedido da aba 1', t.txt('select public.clube_atual_id()::text'), t.id('clube_b')::text);
select t.pedir_clube('clube_a');
select t.eq('voltando a pedir A ("aba 1" de novo): continua A, intacto', t.txt('select public.clube_atual_id()::text'), t.id('clube_a')::text);
reset role;

-- ==================== 9) tentativa de FORJAR club_id ====================
select t.como('membro_a');
select t.pedir_clube('clube_b');
select t.eq('membro só do A pede o clube B (sem vínculo lá): NUNCA é honrado, cai no A', t.txt('select public.clube_atual_id()::text'), t.id('clube_a')::text);
select t.eq('...e continua sem ver nada do clube B', t.nv($q$select count(*) from public.fotos where legenda = 'Foto B'$q$), 0);
select t.pedir_clube(gen_random_uuid());
select t.eq('pedindo um clube ALEATÓRIO (nem existe): mesma coisa, cai no A', t.txt('select public.clube_atual_id()::text'), t.id('clube_a')::text);
reset role;
-- e o inverso: um clube de VERDADE, mas de outra pessoa sem vínculo lá
select t.como('membro_b');
select t.pedir_clube('clube_a');
select t.eq('membro só do B pede o clube A (existe, mas sem vínculo lá): cai no B, nunca no A', t.txt('select public.clube_atual_id()::text'), t.id('clube_b')::text);
reset role;

-- ==================== 10) remoção de vínculo com a "sessão" aberta ====================
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_b');
select t.eq('antes de remover: opera no clube B normalmente', t.txt('select public.clube_atual_id()::text'), t.id('clube_b')::text);
select t.eq('antes de remover: é membro ativo do B', t.txt('select public.membro_ativo_no_clube(public.clube_atual_id())::text'), 'true');
reset role;
-- a diretoria do B encerra o vínculo (evento que pode acontecer a qualquer momento, mesmo com a
-- pessoa "logada" — não há sessão/cache no servidor, a PRÓXIMA requisição já reflete a mudança)
select t.como('lider_b');
select t.permitido('liderança do B encerra o vínculo de multi_dois_papeis', format($q$select public.vinculo_gerir(%L, p_status := 'inativo')$q$, t.id('multi_dois_papeis')));
reset role;
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_b');
select t.eq('depois de remover: pedir o B de novo NÃO é mais honrado (vínculo não é mais ativo)', t.txt('select public.clube_atual_id()::text'), t.id('clube_a')::text);
select t.eq('depois de remover: perdeu o acesso a dados do B imediatamente (sem cache)', t.nv($q$select count(*) from public.fotos where legenda = 'Foto B'$q$), 0);
reset role;
select t.eq('depois de remover: o vínculo do clube A (nunca mexido) continua intacto',
  (select role from public.organization_memberships where user_id = t.id('multi_dois_papeis') and organizational_unit_id = t.id('clube_a')), 'desbravador');
select t.eq('depois de remover: o vínculo do clube B ficou mesmo inativo/suspenso', (select status from public.organization_memberships where user_id = t.id('multi_dois_papeis') and organizational_unit_id = t.id('clube_b')), 'suspenso');

select t.fim();
rollback;
