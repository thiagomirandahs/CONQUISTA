-- =============================================================================
--  Fase 8.1 — MATRIZ DE ACESSO DO CHAT (teste de congelamento).
--
--  Este arquivo existe por um motivo específico: a Fase 8 provou que a policy de leitura do chat
--  (`chat_pode_ver(conversa_id)`, STABLE, avaliada UMA VEZ POR LINHA) respondia por ~92% do custo
--  da consulta de mensagens — 9.111 buffers para ler 50 linhas. A correção mexe em AUTORIZAÇÃO.
--
--  Então a regra é: este teste foi escrito ANTES da otimização, rodou contra a implementação
--  antiga, e precisa continuar passando, assert por assert, contra a nova. Se um único cruzamento
--  mudar, a otimização está errada — não importa quanto ela acelere.
--
--  O que a matriz cobre (7 conversas x 15 pessoas):
--    conversas:  geral A · unidade A1 · unidade A2 · direta A (membro_a<->membro_a2)
--                geral B · unidade B1 · direta B (membro_b<->lider_b)
--    pessoas:    membro comum, membro de OUTRA unidade, conselheiro, diretoria, instrutor,
--                tesoureiro, responsável, pessoa com vínculo em DOIS clubes (3 combinações),
--                pessoa SUSPENSA num dos clubes, e o espelho Tenant 001 <-> Tenant 002.
--
--  Cada pessoa é conferida em três superfícies, porque as três têm policy própria e a otimização
--  mexe nas três: chat_conversas, chat_mensagens e chat_participantes. Uma mensagem moderada
--  entra na conta para provar que o RECORTE por conversa e o RECORTE por moderação são
--  independentes (a moderação já é coberta em detalhe pelo teste 23).
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
-- ---------- as 7 conversas, criadas explicitamente (controle total sobre o cenário) ----------
-- Direto na tabela, como postgres: os RPCs chat_enviar_* já são cobertos pelos testes 19 e 23;
-- aqui o que importa é a FORMA da matriz, não o caminho de escrita.
-- A geral do Tenant 001 já nasce com o clube (o seed a cria) e há índice único por clube —
-- por isso o `on conflict do nothing`: o cenário REUSA a conversa real em vez de inventar outra.
insert into public.chat_conversas (tipo, club_id, unidade_id) values
  ('geral',   t.id('clube_a'), null),
  ('unidade', t.id('clube_a'), t.id('A1')),
  ('unidade', t.id('clube_a'), t.id('A2')),
  ('direta',  t.id('clube_a'), null),
  ('geral',   t.id('clube_b'), null),
  ('unidade', t.id('clube_b'), t.id('B1')),
  ('direta',  t.id('clube_b'), null)
on conflict do nothing;

insert into t.ids (chave, id) select 'conv_1_geral_a',   id from public.chat_conversas where tipo='geral'   and club_id=t.id('clube_a');
insert into t.ids (chave, id) select 'conv_2_unid_a1',   id from public.chat_conversas where tipo='unidade' and unidade_id=t.id('A1');
insert into t.ids (chave, id) select 'conv_3_unid_a2',   id from public.chat_conversas where tipo='unidade' and unidade_id=t.id('A2');
insert into t.ids (chave, id) select 'conv_4_direta_a',  id from public.chat_conversas where tipo='direta'  and club_id=t.id('clube_a');
insert into t.ids (chave, id) select 'conv_5_geral_b',   id from public.chat_conversas where tipo='geral'   and club_id=t.id('clube_b');
insert into t.ids (chave, id) select 'conv_6_unid_b1',   id from public.chat_conversas where tipo='unidade' and unidade_id=t.id('B1');
insert into t.ids (chave, id) select 'conv_7_direta_b',  id from public.chat_conversas where tipo='direta'  and club_id=t.id('clube_b');

-- participantes das DIRETAS (a única espécie que depende de lista explícita)
insert into public.chat_participantes (conversa_id, usuario_id) values
  (t.id('conv_4_direta_a'), t.id('membro_a')),
  (t.id('conv_4_direta_a'), t.id('membro_a2')),
  (t.id('conv_7_direta_b'), t.id('membro_b')),
  (t.id('conv_7_direta_b'), t.id('lider_b'));

-- uma mensagem por conversa, com texto = a chave da conversa (assim a matriz de MENSAGENS
-- é legível e comparável linha a linha com a matriz de CONVERSAS)
insert into public.chat_mensagens (conversa_id, autor_id, texto)
select i.id, case when i.chave like '%_b' or i.chave like '%_b1' then t.id('membro_b') else t.id('membro_a') end, i.chave
  from t.ids i where i.chave like 'conv_%';

-- uma mensagem moderada na geral do A: some da matriz de TEXTO para todo mundo, mas a LINHA
-- continua visível para quem vê a conversa (o teste 23 cobre o texto; aqui interessa o recorte).
insert into public.chat_mensagens (conversa_id, autor_id, texto)
values (t.id('conv_1_geral_a'), t.id('membro_a'), 'ofensa a moderar');
insert into t.ids (chave, id) select 'msg_moderada', id from public.chat_mensagens where texto = 'ofensa a moderar';
reset role;
select t.como('lider_a');
select public.chat_apagar_mensagem(t.id('msg_moderada'));
reset role;

-- ---------- as três leituras da matriz, do ponto de vista de quem estiver logado ----------
-- Cada uma devolve a lista ORDENADA das conversas alcançadas por aquela superfície. O join com
-- t.ids é o que dá nome legível ao uuid; a RLS é quem decide quais linhas sobram.
create function t.m_conversas() returns text language sql stable as $$
  select coalesce(string_agg(i.chave, ' ' order by i.chave), '-')
    from public.chat_conversas c join t.ids i on i.id = c.id where i.chave like 'conv_%';
$$;
-- `distinct` porque a geral do A tem duas mensagens (a normal e a moderada): o que se compara é
-- o CONJUNTO de conversas alcançadas pela leitura de mensagens, não a contagem de linhas.
create function t.m_mensagens() returns text language sql stable as $$
  select coalesce(string_agg(distinct i.chave, ' ' order by i.chave), '-')
    from public.chat_mensagens m join t.ids i on i.id = m.conversa_id where i.chave like 'conv_%';
$$;
create function t.m_participantes() returns text language sql stable as $$
  select coalesce(string_agg(distinct i.chave, ' ' order by i.chave), '-')
    from public.chat_participantes p join t.ids i on i.id = p.conversa_id where i.chave like 'conv_%';
$$;

-- Um cruzamento = uma pessoa. Confere as três superfícies de uma vez e registra os três asserts.
-- `p_participantes` é passado à parte porque só as DIRETAS têm linha em chat_participantes: quem
-- enxerga a geral do A não enxerga participante nenhum ali (não existe nenhum).
create function t.matriz(p_pessoa text, p_conversas text, p_participantes text) returns void
language plpgsql as $$
begin
  perform t.como(p_pessoa);
  perform t.eq(format('[%s] conversas visíveis', p_pessoa), t.txt('select t.m_conversas()'), p_conversas);
  -- a matriz de MENSAGENS tem de ser idêntica à de conversas: toda conversa deste cenário tem
  -- exatamente uma mensagem visível, então qualquer divergência é vazamento ou perda de acesso.
  perform t.eq(format('[%s] mensagens visíveis batem com as conversas', p_pessoa), t.txt('select t.m_mensagens()'), p_conversas);
  perform t.eq(format('[%s] participantes visíveis', p_pessoa), t.txt('select t.m_participantes()'), p_participantes);
  reset role;
end $$;
\o

-- =============================================================================
--  A MATRIZ. Cada linha foi conferida contra a implementação ANTIGA antes de a otimização existir.
-- =============================================================================

-- ---------- Tenant 001 (clube A): quem é o quê ----------
-- As duas funções que decidem tudo, conferidas no banco e registradas aqui para o leitor:
--   pode_gerir_no_clube()  = vínculo ATIVO com papel em (instrutor, diretoria).  Só esses dois.
--   membro_ativo_no_clube() = qualquer vínculo ATIVO cujo papel NÃO seja 'pais'.
--
-- diretoria vê TUDO do próprio clube (as 4 conversas do A) e nada do B — inclusive a direta
-- alheia, porque moderação de chat é atribuição da diretoria.
select t.matriz('lider_a',       'conv_1_geral_a conv_2_unid_a1 conv_3_unid_a2 conv_4_direta_a', 'conv_4_direta_a');
-- instrutor também é gestão: mesma visão da diretoria.
select t.matriz('instrutor_a',   'conv_1_geral_a conv_2_unid_a1 conv_3_unid_a2 conv_4_direta_a', 'conv_4_direta_a');
-- tesoureiro NÃO é gestão de chat (pode_gerir_no_clube não o inclui). Ele é membro ativo, então
-- alcança a geral; como não tem unidade e não participa de direta, para por aí. Dinheiro é uma
-- atribuição, ler conversa de unidade é outra — e o teste trava essa separação.
select t.matriz('tesoureiro_a',  'conv_1_geral_a', '-');

-- membro comum da A1: geral + a SUA unidade + a direta de que participa. Nunca a unidade A2.
select t.matriz('membro_a',      'conv_1_geral_a conv_2_unid_a1 conv_4_direta_a', 'conv_4_direta_a');
-- membro da A2: geral + A2 + a direta de que participa. Nunca a A1.
select t.matriz('membro_a2',     'conv_1_geral_a conv_3_unid_a2 conv_4_direta_a', 'conv_4_direta_a');
-- conselheiro da A1: NÃO é gestão do clube, então vê como membro — geral + a unidade dele.
select t.matriz('conselheiro_a', 'conv_1_geral_a conv_2_unid_a1', '-');
-- responsável (pais): NÃO alcança conversa nenhuma, nem a geral. membro_ativo_no_clube() exclui
-- 'pais' de propósito — quem acompanha uma criança não entra no chat do clube dela.
select t.matriz('pais_a',        '-', '-');

-- ---------- Tenant 002 (clube B): o espelho ----------
select t.matriz('lider_b',       'conv_5_geral_b conv_6_unid_b1 conv_7_direta_b', 'conv_7_direta_b');
select t.matriz('membro_b',      'conv_5_geral_b conv_6_unid_b1 conv_7_direta_b', 'conv_7_direta_b');
select t.matriz('pais_b',        '-', '-');

-- ---------- pessoas com vínculo em DOIS clubes: a soma dos dois pontos de vista ----------
-- desbravador na A1 + conselheiro na B1: membro comum nos dois, cada um com a sua unidade.
-- Uma conta só, dois clubes, sem vazamento cruzado e sem precisar escolher um deles.
select t.matriz('multi_dois_papeis', 'conv_1_geral_a conv_2_unid_a1 conv_5_geral_b conv_6_unid_b1', '-');
-- diretoria no A + desbravador comum na B1: gestão de um lado, membro do outro.
-- A prova de que o papel é POR CLUBE: ela vê a direta do A (gestão) e não vê a do B (não participa).
select t.matriz('dir_a_membro_b', 'conv_1_geral_a conv_2_unid_a1 conv_3_unid_a2 conv_4_direta_a conv_5_geral_b conv_6_unid_b1', 'conv_4_direta_a');
-- instrutor nos dois clubes: gestão dos dois lados.
select t.matriz('instrutor_2clubes', 'conv_1_geral_a conv_2_unid_a1 conv_3_unid_a2 conv_4_direta_a conv_5_geral_b conv_6_unid_b1 conv_7_direta_b', 'conv_4_direta_a conv_7_direta_b');
-- responsável nos dois clubes: nada, nos dois. Ser responsável em dois lugares não soma acesso.
select t.matriz('pais_2clubes', '-', '-');
-- ATIVO no A, SUSPENSO no B: o vínculo suspenso não abre NADA do B, e não contamina o do A.
select t.matriz('suspenso_so_b', 'conv_1_geral_a conv_2_unid_a1', '-');

-- ---------- fora da sessão: anônimo esbarra antes da RLS ----------
-- Não é "nenhuma linha": é permissão negada na própria tabela. A barreira do anônimo é o GRANT,
-- uma camada acima da policy — e precisa continuar sendo depois da otimização.
select t.como_anon();
select t.eq('anônimo: chat_conversas nega no GRANT, antes de qualquer policy',
  t.txt('select t.m_conversas()'), 'ERRO: permission denied for table chat_conversas');
select t.eq('anônimo: chat_mensagens idem',
  t.txt('select t.m_mensagens()'), 'ERRO: permission denied for table chat_mensagens');
reset role;

-- =============================================================================
--  Recortes que a matriz por si só não prova
-- =============================================================================

-- 1) A mensagem moderada: a LINHA continua visível para quem vê a conversa (o app mostra
--    "removida pela liderança"), mas o TEXTO não. O recorte por conversa e o recorte por
--    moderação são camadas independentes — a otimização só pode mexer na primeira.
select t.como('membro_a2');
select t.eq('membro do clube A ainda enxerga a LINHA da mensagem moderada',
  t.nv(format('select count(*) from public.chat_mensagens where id = %L', t.id('msg_moderada'))), 1);
select t.eq('...mas o texto original continua fora do alcance dele',
  t.txt(format('select texto from public.chat_mensagens where id = %L', t.id('msg_moderada'))), '(mensagem apagada)');
select t.como('membro_b');
select t.eq('membro do clube B não enxerga nem a linha da mensagem moderada do clube A',
  t.nv(format('select count(*) from public.chat_mensagens where id = %L', t.id('msg_moderada'))), 0);
reset role;

-- 2) Pedir um clube pelo header NÃO amplia nem reduz o que a pessoa lê no chat: a leitura é por
--    VÍNCULO, não pela aba escolhida. (Se a otimização passasse a depender de clube_atual_id(),
--    a pessoa de dois clubes perderia metade das conversas — este assert pega isso.)
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_a');
select t.eq('com o clube A pedido, continua enxergando as conversas dos DOIS clubes',
  t.txt('select t.m_conversas()'), 'conv_1_geral_a conv_2_unid_a1 conv_5_geral_b conv_6_unid_b1');
select t.pedir_clube('clube_b');
select t.eq('com o clube B pedido, idem — a leitura do chat não depende da aba',
  t.txt('select t.m_conversas()'), 'conv_1_geral_a conv_2_unid_a1 conv_5_geral_b conv_6_unid_b1');
reset role;

-- 3) Uma conversa de unidade de OUTRO clube nunca é alcançada por id direto (não existe caminho
--    "adivinhar o uuid"), e a direta de terceiros idem.
select t.como('membro_a');
select t.eq('membro do A não lê a unidade B1 nem sabendo o id',
  t.nv(format('select count(*) from public.chat_mensagens where conversa_id = %L', t.id('conv_6_unid_b1'))), 0);
select t.eq('membro do A não lê a direta do B nem sabendo o id',
  t.nv(format('select count(*) from public.chat_mensagens where conversa_id = %L', t.id('conv_7_direta_b'))), 0);
select t.eq('membro da A1 não lê a unidade A2 do PRÓPRIO clube nem sabendo o id',
  t.nv(format('select count(*) from public.chat_mensagens where conversa_id = %L', t.id('conv_3_unid_a2'))), 0);
reset role;

-- 4) chat_pode_ver() continua existindo e respondendo o mesmo — é API pública (grant a
--    authenticated) e o PREFLIGHT confere a presença dela. A otimização pode mudar a IMPLEMENTAÇÃO,
--    nunca a resposta.
select t.como('membro_a');
select t.eq('chat_pode_ver: geral do próprio clube = true',  t.txt(format('select public.chat_pode_ver(%L)::text', t.id('conv_1_geral_a'))), 'true');
select t.eq('chat_pode_ver: unidade própria = true',         t.txt(format('select public.chat_pode_ver(%L)::text', t.id('conv_2_unid_a1'))), 'true');
select t.eq('chat_pode_ver: unidade alheia = false',         t.txt(format('select public.chat_pode_ver(%L)::text', t.id('conv_3_unid_a2'))), 'false');
select t.eq('chat_pode_ver: direta de que participa = true', t.txt(format('select public.chat_pode_ver(%L)::text', t.id('conv_4_direta_a'))), 'true');
select t.eq('chat_pode_ver: conversa do outro clube = false',t.txt(format('select public.chat_pode_ver(%L)::text', t.id('conv_5_geral_b'))), 'false');
select t.eq('chat_pode_ver: uuid inexistente = false',       t.txt($q$select public.chat_pode_ver('00000000-0000-0000-0000-000000000000')::text$q$), 'false');
select t.como('suspenso_so_b');
select t.eq('chat_pode_ver: vínculo SUSPENSO no B não abre a geral do B', t.txt(format('select public.chat_pode_ver(%L)::text', t.id('conv_5_geral_b'))), 'false');
reset role;

select t.fim();
rollback;
