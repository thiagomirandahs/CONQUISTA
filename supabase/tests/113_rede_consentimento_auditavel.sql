-- REDE DBV (migration 503) — HISTÓRICO IMUTÁVEL do consentimento de imagem.
-- Prova: marcar/desmarcar (diretoria) e desligar/religar (responsável) geram linha de histórico com
-- quem, papel, origem, antes/depois e versão do termo (nula por enquanto); a revogação do responsável
-- para a PARTICIPAÇÃO também entra; revogar nunca apaga histórico; apagar a linha de estado deixa o
-- histórico e registra 'registro_removido'; ninguém edita/apaga (nem postgres); acesso só por RPC:
-- diretoria do próprio clube ou admin da plataforma; tabela com RLS, sem grants, com a guarda da
-- manutenção; a regra de negócio (foto só com arquivada e sem "não" do responsável) não mudou.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
select t.mk('admin_rede', 'Admin Plataforma', 'diretoria', 'ativo', 'clube_b');
insert into public.platform_admins (user_id, papel) values (t.id('admin_rede'), 'operacao');
create function t.hist(p_pessoa text, p_evento text) returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.rede_consentimento_imagem_historico where usuario_id = t.id(p_pessoa) and evento = p_evento;
$$;
create function t.hist_total(p_pessoa text) returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.rede_consentimento_imagem_historico where usuario_id = t.id(p_pessoa);
$$;
create function t.ultimo(p_pessoa text, p_campo text) returns text language sql security definer set search_path = '' as $$
  select to_jsonb(h) ->> p_campo from public.rede_consentimento_imagem_historico h
   where usuario_id = t.id(p_pessoa) order by quando desc, id desc limit 1;
$$;
reset role;
\o

-- =============================================================================
--  1. Contrato da tabela: RLS, sem grants, guarda da manutenção, club_id obrigatório com FK, imutável
-- =============================================================================
select t.ok('tabela existe com RLS ligado', (select c.relrowsecurity from pg_class c where c.relname = 'rede_consentimento_imagem_historico' and c.relnamespace = 'public'::regnamespace));
select t.eq('sem privilégio direto para anon/authenticated',
  (select count(*) from information_schema.role_table_grants g where g.table_schema = 'public'
     and g.table_name = 'rede_consentimento_imagem_historico' and g.grantee in ('anon', 'authenticated', 'PUBLIC')), 0::bigint);
select t.eq('guarda do modo manutenção instalada',
  (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
    where c.relname = 'rede_consentimento_imagem_historico' and g.tgname = 'zz_manutencao_guarda'), 1::bigint);
select t.eq('gatilho de imutabilidade instalado',
  (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
    where c.relname = 'rede_consentimento_imagem_historico' and g.tgname = 'trg_imutavel'), 1::bigint);
select t.eq('club_id obrigatório e com FK para organizational_units',
  (select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relname = 'rede_consentimento_imagem_historico' and a.attname = 'club_id' and a.attnotnull
      and exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'
                    and k.confrelid = 'public.organizational_units'::regclass and a.attnum = any(k.conkey))), 1::bigint);
select t.eq('campo versao_termo existe na tabela de estado (nulo, reservado)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'rede_autorizacao_imagem'
     and column_name = 'versao_termo' and is_nullable = 'YES'), 1::bigint);
select t.eq('anon não executa a RPC de histórico',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'rede_consentimento_imagem_historico'
     and has_function_privilege('anon', p.oid, 'execute')), 0::bigint);
select t.eq('funções novas: security definer com search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%rede_consentimento%' and p.prosecdef
     and not (coalesce(p.proconfig, '{}') @> array['search_path=""'])), 0::bigint);

-- =============================================================================
--  2. Liga a rede nos dois clubes; fixtures não geram histórico (nada marcado ainda)
-- =============================================================================
select t.como('admin_rede');
select public.admin_recurso_do_clube_definir(t.id('clube_a'), 'comunidade', true);
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
reset role;
select t.eq('histórico começa vazio para membro_a', t.hist_total('membro_a'), 0::bigint);

-- =============================================================================
--  3. Diretoria marca, desmarca e remarca: 3 eventos, com quem/papel/origem/antes/depois
-- =============================================================================
select t.como('lider_a');
select public.rede_marcar_autorizacao_imagem(t.id('membro_a'), true);
reset role;
select t.eq('marcar -> evento arquivada', t.hist('membro_a', 'arquivada'), 1::bigint);
select t.eq('...ator = a diretora que marcou', t.ultimo('membro_a', 'ator'), t.id('lider_a')::text);
select t.eq('...papel_ator = diretoria', t.ultimo('membro_a', 'papel_ator'), 'diretoria');
select t.eq('...origem = app (JWT autenticado)', t.ultimo('membro_a', 'origem'), 'app');
select t.eq('...escopo = imagem', t.ultimo('membro_a', 'escopo'), 'imagem');
select t.eq('...clube = clube A', t.ultimo('membro_a', 'club_id'), t.id('clube_a')::text);
select t.eq('...antes é nulo no 1º registro', t.ultimo('membro_a', 'antes'), null::text);
select t.eq('...depois.arquivada = true', (select (t.ultimo('membro_a', 'depois'))::jsonb ->> 'arquivada'), 'true');
select t.eq('...versao_termo NULA (o termo ainda não existe)', t.ultimo('membro_a', 'versao_termo'), null::text);

select t.como('lider_a');
select public.rede_marcar_autorizacao_imagem(t.id('membro_a'), false);
reset role;
select t.eq('desmarcar -> evento desmarcada', t.hist('membro_a', 'desmarcada'), 1::bigint);
select t.eq('...antes.arquivada = true', (select (t.ultimo('membro_a', 'antes'))::jsonb ->> 'arquivada'), 'true');
select t.eq('...depois.arquivada = false', (select (t.ultimo('membro_a', 'depois'))::jsonb ->> 'arquivada'), 'false');
select t.como('lider_a');
select public.rede_marcar_autorizacao_imagem(t.id('membro_a'), true);
reset role;
select t.eq('remarcar -> 2º evento arquivada (nada foi sobrescrito)', t.hist('membro_a', 'arquivada'), 2::bigint);
select t.eq('a tabela de ESTADO continua com 1 linha só (regra de hoje intacta)',
  (select count(*) from public.rede_autorizacao_imagem where usuario_id = t.id('membro_a')), 1::bigint);

-- =============================================================================
--  4. Responsável desliga e religa a foto: 2 eventos; revogar NÃO apaga nada
-- =============================================================================
select t.como('pais_a');
select public.rede_responsavel_imagem(t.id('membro_a'), true);
reset role;
select t.eq('desligar -> evento desligada_pelo_responsavel', t.hist('membro_a', 'desligada_pelo_responsavel'), 1::bigint);
select t.eq('...ator = o responsável', t.ultimo('membro_a', 'ator'), t.id('pais_a')::text);
select t.eq('...papel_ator = responsavel', t.ultimo('membro_a', 'papel_ator'), 'responsavel');
select t.eq('...antes.desligada = false / depois.desligada = true',
  (select (t.ultimo('membro_a', 'antes'))::jsonb ->> 'desligada_pelo_responsavel') || '/' || (select (t.ultimo('membro_a', 'depois'))::jsonb ->> 'desligada_pelo_responsavel'), 'false/true');
select t.eq('revogar não apagou os eventos da diretoria', t.hist('membro_a', 'arquivada') + t.hist('membro_a', 'desmarcada'), 3::bigint);
select t.eq('regra de negócio intacta: arquivada + responsável desligou = sem foto',
  (select public._rede_imagem_autorizada(t.id('membro_a'))), false);
select t.como('pais_a');
select public.rede_responsavel_imagem(t.id('membro_a'), false);
reset role;
select t.eq('religar -> evento religada_pelo_responsavel', t.hist('membro_a', 'religada_pelo_responsavel'), 1::bigint);
select t.eq('regra de negócio intacta: religou = foto volta', (select public._rede_imagem_autorizada(t.id('membro_a'))), true);
select t.eq('5 eventos de imagem até aqui', (select count(*) from public.rede_consentimento_imagem_historico where usuario_id = t.id('membro_a') and escopo = 'imagem'), 5::bigint);

-- =============================================================================
--  5. Responsável revoga/religa a PARTICIPAÇÃO na rede (comunidade_autorizar): escopo 'participacao'
-- =============================================================================
select t.como('pais_a');
select public.comunidade_autorizar(t.id('membro_a'), false);
reset role;
select t.eq('revogar participação -> evento participacao_revogada', t.hist('membro_a', 'participacao_revogada'), 1::bigint);
select t.eq('...escopo = participacao', t.ultimo('membro_a', 'escopo'), 'participacao');
select t.eq('...ator = o responsável, papel responsavel', t.ultimo('membro_a', 'ator') || '/' || t.ultimo('membro_a', 'papel_ator'), t.id('pais_a')::text || '/responsavel');
select t.como('pais_a');
select public.comunidade_autorizar(t.id('membro_a'), true);
reset role;
select t.eq('religar participação -> evento participacao_religada', t.hist('membro_a', 'participacao_religada'), 1::bigint);
select t.eq('7 eventos no total', t.hist_total('membro_a'), 7::bigint);

-- =============================================================================
--  6. Imutável: nem postgres edita/apaga; apagar a linha de ESTADO não apaga o histórico
-- =============================================================================
reset role;
select t.throws('postgres não altera o histórico', $q$update public.rede_consentimento_imagem_historico set evento = 'desmarcada' where evento = 'arquivada'$q$, 'imutável');
select t.throws('postgres não apaga o histórico', $q$delete from public.rede_consentimento_imagem_historico where escopo = 'imagem'$q$, 'imutável');
delete from public.rede_autorizacao_imagem where usuario_id = t.id('membro_a');
select t.eq('apagar a linha de estado: histórico anterior continua', t.hist('membro_a', 'arquivada'), 2::bigint);
select t.eq('...e registra registro_removido', t.hist('membro_a', 'registro_removido'), 1::bigint);
select t.eq('...papel_ator = banco (não veio de RPC)', t.ultimo('membro_a', 'papel_ator'), 'banco');
select t.eq('...origem = banco (sem JWT)', t.ultimo('membro_a', 'origem'), 'banco');
select t.eq('8 eventos', t.hist_total('membro_a'), 8::bigint);
-- SQL direto (sem carimbo das RPCs) também fica registrado
insert into public.rede_autorizacao_imagem (club_id, usuario_id, arquivada) values (t.id('clube_a'), t.id('membro_a'), true);
select t.eq('insert direto sem carimbo -> evento alterada', t.hist('membro_a', 'alterada'), 1::bigint);
update public.rede_autorizacao_imagem set versao_termo = 'v-teste' where usuario_id = t.id('membro_a');
select t.eq('mudou só versao_termo -> evento alterada com a versão copiada', t.ultimo('membro_a', 'versao_termo'), 'v-teste');

-- =============================================================================
--  7. Leitura: só por RPC; diretoria do PRÓPRIO clube; admin da plataforma vê tudo
-- =============================================================================
select t.como('lider_a');
select t.bloqueado('diretoria não lê a tabela direto', $q$select * from public.rede_consentimento_imagem_historico$q$);
select t.eq('diretoria A lê o histórico de membro_a pela RPC',
  t.n(format($q$select jsonb_array_length(public.rede_consentimento_imagem_historico(%L))$q$, t.id('membro_a'))), 10::bigint);
select t.eq('...o mais recente vem primeiro', t.txt(format($q$select public.rede_consentimento_imagem_historico(%L)->0->>'evento'$q$, t.id('membro_a'))), 'alterada');
select t.eq('...sem filtro: só linhas do clube A', t.n($q$select count(*) from jsonb_array_elements(public.rede_consentimento_imagem_historico()) e where e->>'club_id' <> t.id('clube_a')::text$q$), 0::bigint);
select t.eq('...limite respeitado', t.n(format($q$select jsonb_array_length(public.rede_consentimento_imagem_historico(%L, 3))$q$, t.id('membro_a'))), 3::bigint);
select t.eq('...sem nome nem foto no retorno', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_consentimento_imagem_historico(%L)) e where e ? 'nome' or e ? 'foto'$q$, t.id('membro_a'))), 0::bigint);
select t.como('lider_b');
select t.eq('diretoria de OUTRO clube não vê membro_a', t.n(format($q$select jsonb_array_length(public.rede_consentimento_imagem_historico(%L))$q$, t.id('membro_a'))), 0::bigint);
select t.como('instrutor_a');
select t.throws('instrutor não lê (só diretoria)', $q$select public.rede_consentimento_imagem_historico()$q$, 'diretoria');
select t.como('pais_a');
select t.throws('responsável não lê pela RPC da diretoria', $q$select public.rede_consentimento_imagem_historico()$q$, 'diretoria');
select t.como('membro_a');
select t.throws('a própria criança não lê', $q$select public.rede_consentimento_imagem_historico()$q$, 'diretoria');
select t.como_anon();
select t.throws('anon não lê', $q$select public.rede_consentimento_imagem_historico()$q$);
select t.como('admin_rede');
select t.eq('admin da plataforma (no clube B) vê o histórico do clube A',
  t.n(format($q$select jsonb_array_length(public.rede_consentimento_imagem_historico(%L))$q$, t.id('membro_a'))), 10::bigint);

-- =============================================================================
--  8. Com a Comunidade DESLIGADA a diretoria ainda lê (é registro do que já aconteceu)
-- =============================================================================
select t.como('admin_rede');
select public.admin_recurso_do_clube_definir(t.id('clube_a'), 'comunidade', false);
select t.como('lider_a');
select t.eq('recurso desligado: histórico continua legível pela diretoria',
  t.n(format($q$select jsonb_array_length(public.rede_consentimento_imagem_historico(%L))$q$, t.id('membro_a'))), 10::bigint);
reset role;

select t.fim();
rollback;
