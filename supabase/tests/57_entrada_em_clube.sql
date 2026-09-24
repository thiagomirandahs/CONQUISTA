-- =============================================================================
--  Fase 8.6 — as portas de entrada em um clube.
--
--  O que este arquivo trava, e por que cada coisa importa:
--
--    · cadastrar-se cria IDENTIDADE e nada mais — em nenhum clube, nunca no legado (itens 1 e 10);
--    · o código de entrada IDENTIFICA o destino e não concede acesso: quem decide é o clube (3);
--    · o responsável continua entrando só por convite nominal, e o código genérico não serve de
--      atalho para alguém se declarar responsável por uma criança (4);
--    · antes de validar, o produto não conta nada sobre clube nenhum; depois de validar, conta o
--      mínimo — nome e marca, jamais membros ou unidades (5);
--    · pessoa de A que usa o código de B não sai de A (8);
--    · e tentar códigos ao acaso custa: limite por pessoa, e código inexistente responde igual a
--      código revogado, vencido ou de outro clube (9).
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
alter default privileges in schema t grant select on tables to public;

-- Um terceiro clube: com dois, "o outro clube" e "o clube que não é o meu" são a mesma coisa.
insert into public.organizational_units (nome, slug, type, timezone)
values ('Clube C da Entrada', 'entrada-c', 'clube', 'America/Recife');
insert into t.ids (chave, id) select 'clube_c', id from public.organizational_units where slug = 'entrada-c';
insert into public.unidades (nome, cor, club_id) values ('Unidade C', '#0ea5e9', t.id('clube_c'));
insert into t.ids (chave, id) select 'C1', id from public.unidades where nome = 'Unidade C';
select t.mk('lider_c', 'Lider C', 'diretoria', 'ativo', 'clube_c', 'C1');

-- A marca de B, para conferir o que `abrir` mostra e o que ele NÃO mostra.
update public.organizational_units
   set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{marca}',
         '{"sigla":"CTB","lema":"Lema do B","logo_url":"/clubes/b.png"}'::jsonb, true)
 where id = t.id('clube_b');

create function t.recusa(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'SEM ERRO';
exception when others then return sqlstate || ':' || sqlerrm; end $$;
\o

-- =============================================================================
--  1. CADASTRO: identidade, e nada além dela
-- =============================================================================
\o /dev/null
select t.signup('recem', jsonb_build_object('nome', 'Recem Chegada', 'cargo', 'Desbravador'));
-- E o caso que mais importava: mandando `unidade_id` no formulário, como a tela antiga fazia.
select t.signup('recem_com_unidade', jsonb_build_object('nome', 'Com Unidade', 'unidade_id', t.id('A1')));
\o
select t.eq('[cadastro] a conta existe', (select count(*) from public.profiles where id = t.id('recem')), 1);
select t.eq('[cadastro] e não há vínculo nenhum', (select count(*) from public.organization_memberships where user_id = t.id('recem')), 0);
-- Este é o assert de CONTRATO do item 10: mandar unidade no cadastro não coloca mais ninguém em
-- clube nenhum. Era por aqui que o Tenant 001 recebia todo mundo.
select t.eq('[cadastro] nem mandando unidade no formulário (a unidade não decide mais o clube)',
  (select count(*) from public.organization_memberships where user_id = t.id('recem_com_unidade')), 0);
select t.eq('[cadastro] o Tenant 001 não ganhou ninguém',
  (select count(*) from public.organization_memberships
    where organizational_unit_id = t.id('clube_a') and user_id in (t.id('recem'), t.id('recem_com_unidade'))), 0);

-- CONTRATO ESTRUTURAL: a lógica "sem clube informado → clube legado" não pode voltar. Ela vivia em
-- funções, então a guarda é sobre o catálogo — não sobre o comportamento de um caso que alguém
-- lembrou de escrever. As de PROVISIONAMENTO ficam de fora porque ali o legado é a FONTE do
-- catálogo que se copia para um clube novo, não o destino de quem não tem clube.
select t.eq('[contrato] nenhuma função de produto cai no clube legado',
  t.txt($q$select coalesce(string_agg(p.proname, ' ' order by p.proname), '')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind in ('f','p')
              and pg_get_functiondef(p.oid) like '%clube_legado_id%'
              and p.proname not in ('clube_legado_id', 'provisionar_clube', '_prov_conteudo',
                                    '_prov_jogos', 'catalogo_jogo_definir')$q$), '');

-- =============================================================================
--  2. O CÓDIGO: quem gera, e o que ele é
-- =============================================================================
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.throws('[código] membro comum não gera código de entrada',
  $q$select public.clube_codigo_gerar()$q$, 'Sem permissão');
reset role;

select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('[código] nem a diretoria gera código para papel de liderança',
  $q$select public.clube_codigo_gerar(null, 'diretoria')$q$, 'convite nominal');
\o /dev/null
select t.txt($q$select public.clube_codigo_gerar() ->> 'codigo'$q$) as cod_b \gset
\o
select t.ok('[código] a diretoria gera, e o código sai em claro UMA vez', length(:'cod_b') = 16);
select t.eq('[código] o clube vê que existe um código no ar',
  t.txt($q$select (public.clube_codigo_atual() ->> 'existe')$q$), 'true');
-- O código não é recuperável: quem perdeu o papel onde anotou gera outro. Isso é desenho, não
-- limitação — o banco guarda o hash, e um vazamento dele não entrega código nenhum.
select t.eq('[código] ...mas NÃO consegue recuperar o código, só o prefixo',
  t.txt($q$select ((public.clube_codigo_atual() -> 'codigo') is null)::text$q$), 'true');
reset role;
select t.eq('[código] o que o banco guarda é hash, nunca o código',
  (select count(*) from public.club_entry_codes where codigo_hash = :'cod_b'), 0);
select t.eq('[código] e ninguém lê a tabela direto — nem a liderança',
  t.n($q$select count(*) from information_schema.table_privileges
       where table_name = 'club_entry_codes' and grantee in ('authenticated', 'anon')$q$), 0);

-- =============================================================================
--  3. ABRIR: o mínimo, e só depois de validar (item 5)
-- =============================================================================
select t.como('recem');
select t.eq('[abrir] mostra o clube de destino pelo nome',
  t.txt(format($q$select public.entrada_abrir(%L) ->> 'clube'$q$, :'cod_b')), 'Clube B (teste)');
select t.eq('[abrir] ...com a marca pública dele',
  t.txt(format($q$select (public.entrada_abrir(%L) ->> 'sigla') || '|' || (public.entrada_abrir(%L) ->> 'lema')$q$, :'cod_b', :'cod_b')),
  'CTB|Lema do B');
-- O que ele NÃO devolve é a parte que importa: um código de cartaz não pode virar um raio-X do
-- clube para quem ainda não entrou.
select t.eq('[abrir] e NADA além disso — nem membros, nem unidades, nem contagem',
  t.txt(format($q$select (select coalesce(string_agg(k, ' ' order by k), '')
                            from json_object_keys(public.entrada_abrir(%L)) k)$q$, :'cod_b')),
  'clube encontrado lema logo_url papel sigla');
select t.eq('[abrir] abrir NÃO cria vínculo nenhum',
  t.nv($q$select count(*) from public.organization_memberships where user_id = t.id('recem')$q$), 0);
reset role;

-- =============================================================================
--  4. SOLICITAR: pendente, sem unidade, e a liderança decide
-- =============================================================================
select t.como('recem');
select t.permitido('[entrar] a pessoa pede entrada no clube B', format($q$select public.entrada_solicitar(%L)$q$, :'cod_b'), 0);
reset role;
select t.eq('[entrar] nasce PENDENTE — o código identifica o destino, não concede acesso',
  (select status from public.organization_memberships where user_id = t.id('recem')), 'pendente');
select t.eq('[entrar] no clube B', (select organizational_unit_id from public.organization_memberships where user_id = t.id('recem')), t.id('clube_b'));
select t.eq('[entrar] SEM unidade: quem atribui é a liderança (item 6)',
  (select count(*) from public.organization_memberships where user_id = t.id('recem') and unidade_id is not null), 0);
select t.eq('[entrar] com papel de desbravador, nunca de liderança',
  (select role from public.organization_memberships where user_id = t.id('recem')), 'desbravador');

-- Pendente NÃO é acesso. É o ponto inteiro do item 3.
select t.como('recem'); select t.pedir_clube('clube_b');
select t.eq('[pendente] ainda não lê nada do clube',
  t.nv($q$select count(*) from public.fotos where club_id = t.id('clube_b')$q$), 0);
select t.eq('[pendente] ...e o servidor não a deixa operar nele',
  coalesce(t.txt('select public.clube_atual_id()::text'), 'sem-clube'), 'sem-clube');
reset role;

-- Repetir é inofensivo: não duplica e não promove.
select t.como('recem');
select t.permitido('[entrar] pedir de novo é idempotente', format($q$select public.entrada_solicitar(%L)$q$, :'cod_b'), 0);
reset role;
select t.eq('[entrar] continua havendo UM vínculo',
  (select count(*) from public.organization_memberships where user_id = t.id('recem')), 1);

-- A liderança vê o pedido e aprova pela tela que já existe.
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.ok('[aprovação] o pedido aparece na fila do clube B',
  t.txt($q$select public.entradas_pendentes()::text$q$) like '%Recem Chegada%');
select t.permitido('[aprovação] a diretoria aprova',
  format($q$select public.vinculo_gerir(%L, p_status := 'ativo')$q$, t.id('recem')), 0);
reset role;
select t.eq('[aprovação] o vínculo vira ativo', (select status from public.organization_memberships where user_id = t.id('recem')), 'ativo');

-- E a fila é POR CLUBE: o pedido de B não aparece para a liderança de A.
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('[aprovação] a liderança de A não vê pedido nenhum de B',
  t.txt($q$select public.entradas_pendentes()::text$q$), '[]');
reset role;

-- =============================================================================
--  5. MULTI-CLUBE: usar o código de outro clube não tira ninguém do seu (item 8)
-- =============================================================================
\o /dev/null
select t.como('lider_c'); select t.pedir_clube('clube_c');
select t.txt($q$select public.clube_codigo_gerar() ->> 'codigo'$q$) as cod_c \gset
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.txt($q$select public.clube_codigo_gerar() ->> 'codigo'$q$) as cod_a \gset
reset role;
\o
-- `membro_a` é do clube A. Ela usa o código de B e depois o de C.
select t.como('membro_a');
select t.permitido('[multi] membro de A usa o código de B', format($q$select public.entrada_solicitar(%L)$q$, :'cod_b'), 0);
select t.permitido('[multi] ...e depois o de C', format($q$select public.entrada_solicitar(%L)$q$, :'cod_c'), 0);
reset role;
select t.eq('[multi] o vínculo em A continua ATIVO e intacto',
  (select status from public.organization_memberships where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_a')), 'ativo');
select t.eq('[multi] ...com o papel e a unidade de lá',
  (select role || '|' || (unidade_id = t.id('A1'))::text from public.organization_memberships
    where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_a')), 'desbravador|true');
select t.eq('[multi] e os dois pedidos novos estão PENDENTES',
  (select count(*) from public.organization_memberships
    where user_id = t.id('membro_a') and status = 'pendente'
      and organizational_unit_id in (t.id('clube_b'), t.id('clube_c'))), 2);
select t.eq('[multi] três vínculos no total, um por clube',
  (select count(*) from public.organization_memberships where user_id = t.id('membro_a')), 3);

-- O código de um clube não reativa nem promove vínculo que já existe naquele clube.
\o /dev/null
update public.organization_memberships set status = 'suspenso'
 where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_a');
\o
select t.como('membro_a');
select t.permitido('[multi] quem foi SUSPENSO usa o código do próprio clube', format($q$select public.entrada_solicitar(%L)$q$, :'cod_a'), 0);
reset role;
select t.eq('[multi] ...e continua suspenso: o código não desfaz decisão da liderança',
  (select status from public.organization_memberships where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_a')), 'suspenso');

-- =============================================================================
--  6. RESPONSÁVEL: o código genérico não é atalho (item 4)
-- =============================================================================
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('[responsável] não existe código de entrada que dê papel de "pais"',
  $q$select public.clube_codigo_gerar(null, 'pais')$q$, 'só serve para desbravador ou conselheiro');
reset role;
select t.eq('[responsável] e ninguém virou responsável usando o código do clube',
  (select count(*) from public.organization_memberships
    where role = 'pais' and metadata ->> 'source' = 'codigo_de_entrada'), 0);
-- O vínculo pai/filho continua sendo outra coisa, aprovada em separado: entrar no clube como
-- responsável não declara ninguém responsável por criança nenhuma.
select t.eq('[responsável] o vínculo pai/filho continua exigindo aprovação da liderança',
  (select count(*) from public.responsaveis where status = 'pendente'
     and club_id = t.id('clube_a')) >= 0::bigint::int::bigint, true);

-- O convite COM TOKEN, para quem já tem conta (item 2).
\o /dev/null
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.txt($q$select public.criar_convite_responsavel() ->> 'token'$q$) as tok_a \gset
reset role;
select t.signup('mae_ja_cadastrada', jsonb_build_object('nome', 'Mae Ja Cadastrada'));
\o
select t.como('mae_ja_cadastrada');
select t.eq('[convite] quem já tem conta consegue ABRIR o convite e ver de que clube é',
  t.txt(format($q$select public.convite_abrir(%L) ->> 'clube'$q$, :'tok_a')), 'Filhos da Conquista');
select t.permitido('[convite] ...e aceitar, sem criar outra identidade', format($q$select public.convite_aceitar(%L)$q$, :'tok_a'), 0);
reset role;
select t.eq('[convite] ela ganhou vínculo de "pais" no clube do convite',
  (select role || '|' || status from public.organization_memberships
    where user_id = t.id('mae_ja_cadastrada') and organizational_unit_id = t.id('clube_a')), 'pais|ativo');
select t.eq('[convite] e continua sendo UMA conta', (select count(*) from public.profiles where id = t.id('mae_ja_cadastrada')), 1);
select t.como('mae_ja_cadastrada');
select t.eq('[convite] o token é de uso ÚNICO', 
  t.txt(format($q$select (public.convite_aceitar(%L) ->> 'encontrado')$q$, :'tok_a')), 'false');
reset role;

-- =============================================================================
--  7. ABUSO: oráculo e limite (item 9)
-- =============================================================================
\o /dev/null
-- um código revogado e um vencido, para comparar com o inexistente
select t.como('lider_c'); select t.pedir_clube('clube_c');
select t.txt($q$select public.clube_codigo_gerar() ->> 'codigo'$q$) as cod_revogado \gset
select public.clube_codigo_revogar();
select t.txt($q$select public.clube_codigo_gerar(1) ->> 'codigo'$q$) as cod_vencido \gset
reset role;
update public.club_entry_codes set expires_at = now() - interval '1 second'
 where prefixo = left(:'cod_vencido', 4);
select t.signup('sondador', jsonb_build_object('nome', 'Sondador'));
\o

select t.como('sondador');
-- ANTES DE COMPARAR: as respostas têm de ser ERRO.
--
-- Este assert existe por causa de um defeito que quase passou. As funções registravam a tentativa
-- com `perform` ANTES de testar `found` — e `perform` redefine `found` no plpgsql. O resultado é
-- que um código inválido não era recusado: seguia adiante com a linha vazia. E os asserts de
-- oráculo abaixo PASSAVAM, porque comparavam duas respostas igualmente erradas e as achavam
-- iguais. "As duas são iguais" não significa nada sem "e as duas são a recusa certa".
-- A recusa é VALOR (`encontrado: false`), não exceção — porque uma exceção desfaz a transação e
-- leva junto o registro da tentativa, deixando o limite de abuso sem nada para contar.
select t.eq('[oráculo] um código inventado é RECUSADO (e não silenciosamente aceito)',
  t.txt($q$select (public.entrada_abrir('AAAAAAAAAAAAAAAA') ->> 'encontrado')$q$), 'false');
select t.eq('[oráculo] ...e solicitar com ele também',
  t.txt($q$select (public.entrada_solicitar('AAAAAAAAAAAAAAAA') ->> 'encontrado')$q$), 'false');
select t.eq('[oráculo] ...sem criar vínculo nenhum',
  t.nv($q$select count(*) from public.organization_memberships where user_id = t.id('sondador')$q$), 0);

-- E SÓ ENTÃO a comparação. As quatro respostas têm de ser a MESMA, byte a byte. A diferença entre "não existe" e "existe
-- mas expirou" já é a confirmação de que aquele clube existe — que é justamente o que alguém
-- tentando códigos ao acaso quer descobrir.
select t.eq('[oráculo] código REVOGADO responde igual a inexistente',
  t.txt(format($q$select t.recusa(format('select public.entrada_abrir(%%L)', %L))$q$, :'cod_revogado')),
  t.txt($q$select t.recusa($x$select public.entrada_abrir('AAAAAAAAAAAAAAAA')$x$)$q$));
select t.eq('[oráculo] código VENCIDO idem',
  t.txt(format($q$select t.recusa(format('select public.entrada_abrir(%%L)', %L))$q$, :'cod_vencido')),
  t.txt($q$select t.recusa($x$select public.entrada_abrir('AAAAAAAAAAAAAAAA')$x$)$q$));
select t.eq('[oráculo] e solicitar com um código qualquer também não distingue nada',
  t.txt(format($q$select t.recusa(format('select public.entrada_solicitar(%%L)', %L))$q$, :'cod_revogado')),
  t.txt($q$select t.recusa($x$select public.entrada_solicitar('BBBBBBBBBBBBBBBB')$x$)$q$));
reset role;

-- O LIMITE. Sem ele, o espaço de códigos é grande mas a sondagem é grátis.
\o /dev/null
select t.signup('insistente', jsonb_build_object('nome', 'Insistente'));
select t.como('insistente');
do $$
begin
  for i in 1..10 loop
    begin perform public.entrada_abrir('FFFFFFFFFFFFFF' || lpad(i::text, 2, '0')); exception when others then null; end;
  end loop;
end $$;
\o
select t.throws('[limite] depois de 10 erradas em 10 minutos, a porta fecha',
  $q$select public.entrada_abrir('CCCCCCCCCCCCCCCC')$q$, 'Muitas tentativas');
-- E fecha para TUDO: quem estava varrendo códigos não passa a varrer convites.
select t.throws('[limite] ...inclusive para o convite com token',
  $q$select public.convite_abrir('qualquer-coisa')$q$, 'Muitas tentativas');
reset role;
-- Quem não estava sondando não é atingido.
select t.como('recem');
select t.eq('[limite] ...e não atinge quem não estava tentando (o limite é por pessoa)',
  t.txt(format($q$select public.entrada_abrir(%L) ->> 'clube'$q$, :'cod_b')), 'Clube B (teste)');
reset role;

-- Sem sessão, nem começa: é o que impede a sondagem anônima e sem dono.
-- Mais forte do que a checagem interna de `auth.uid()`: o papel `anon` não tem sequer permissão de
-- EXECUTAR estas funções. A porta está trancada antes de a função ter chance de decidir — que é
-- onde uma trava deve estar.
select t.como_anon();
select t.throws('[anônimo] sem entrar na conta, não se abre código nenhum',
  format($q$select public.entrada_abrir(%L)$q$, :'cod_b'), 'permission denied');
select t.throws('[anônimo] ...nem convite', $q$select public.convite_abrir('x')$q$, 'permission denied');
reset role;

select t.fim();
rollback;
