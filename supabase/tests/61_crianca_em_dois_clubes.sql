-- =============================================================================
--  Fase 9.1 — O GATE PERMANENTE: a criança que é desbravadora em DOIS clubes.
--
--  Uma criança é desbravadora no clube A (unidade A1) e no clube B (unidade B1). Ela é UMA pessoa
--  (um perfil, uma senha, uma foto), e DUAS participações — com unidade, papel e status próprios em
--  cada clube. Tudo o que um clube vê, conta, premia ou muda sobre ela tem de vir do vínculo DAQUELE
--  clube, e nada do que um clube faz pode mexer na conta dela nos outros.
--
--  A auditoria da 9.1 achou o contrário em muitos lugares: listas lidas do espelho `profiles` (o
--  clube PRIMÁRIO), rotinas somando o que ela fez em A no placar de B, a liderança de B trocando a
--  senha GLOBAL dela, gatilhos carimbando o "clube mais novo" em vez da aba. Proibir a criança de
--  estar em dois clubes NÃO é solução: é o produto. Este arquivo roda em toda rodada e prova, pela
--  sessão de cada pessoa e com o clube pedido (t.pedir_clube), que cada clube vê a criança certa.
--
--  O ELENCO (além dos fixtures):
--    crianca   desbravadora em A/A1 (vínculo mais ANTIGO) e em B/B1 (mais NOVO)
--    so_a      colega só de A (A1)             so_b      colega só de B (B1)
--    amigo_ab  outro desbravador de A/A1 e B/B1 (o par da "ajuda entre amigos")
--    lider_ab  diretoria em A e em B           pai_ab    responsável em A e em B
--    ex_b      ativo em A, ENCERRADO em B (ex-membro de B)
--    dir_c     diretoria do clube C que digitou o código de B (PENDENTE em B)
--    entrante  ativa em A, pendente em B (para a aprovação)
--    lider_a/lider_b/instrutor_a/tesoureiro_a  a liderança de cada clube (fixtures)
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
alter default privileges in schema t grant select on tables to public;

-- os recursos ligados nos dois clubes — senão o teste mediria a flag, não o isolamento
insert into public.club_features (club_id, feature, enabled)
select c, f, true
  from (values (t.id('clube_a')), (t.id('clube_b'))) cl(c)
 cross join (values ('jogos'), ('chefao'), ('desafios'), ('mensalidades'), ('missoes'), ('chat')) fe(f)
on conflict (club_id, feature) do update set enabled = true;

insert into public.unidades (nome, cor, club_id) values ('Teste B2', '#444444', t.id('clube_b'));
insert into t.ids (chave, id) select 'B2', id from public.unidades where nome = 'Teste B2';

-- o terceiro clube, criado "por qualquer conta" (a diretora dele é dir_c)
insert into public.organizational_units (type, nome, slug, pais, timezone, metadata)
values ('clube', 'Clube C (61)', 'clube-c-61', 'BR', 'America/Recife', '{"test_only":true}');
insert into t.ids (chave, id) select 'clube_c', id from public.organizational_units where slug = 'clube-c-61';

select t.mk('crianca',  'Criança Dois Clubes', 'desbravador', 'ativo', 'clube_a', 'A1', date '2014-03-15');
select t.mk2('crianca', 'desbravador', 'ativo', 'clube_b', 'B1');
select t.mk('so_a',     'Colega Só A',         'desbravador', 'ativo', 'clube_a', 'A1', date '2013-07-07');
select t.mk('so_b',     'Colega Só B',         'desbravador', 'ativo', 'clube_b', 'B1', date '2013-08-08');
select t.mk('amigo_ab', 'Amigo Dois Clubes',   'desbravador', 'ativo', 'clube_a', 'A1', date '2014-04-04');
select t.mk2('amigo_ab', 'desbravador', 'ativo', 'clube_b', 'B1');
select t.mk('lider_ab', 'Lider Dois Clubes',   'diretoria',   'ativo', 'clube_a');
select t.mk2('lider_ab', 'diretoria', 'ativo', 'clube_b');
select t.mk('pai_ab',   'Pai Dois Clubes',     'pais',        'ativo', 'clube_a');
select t.mk2('pai_ab', 'pais', 'ativo', 'clube_b');
select t.mk('ex_b',     'Ex Membro de B',      'desbravador', 'ativo', 'clube_a', 'A2');
insert into public.organization_memberships (user_id, organizational_unit_id, role, status, unidade_id)
values (t.id('ex_b'), t.id('clube_b'), 'desbravador', 'encerrado', t.id('B1'));
select t.mk('dir_c',    'Diretora do Clube C', 'diretoria',   'ativo', 'clube_c');
select t.mk2('dir_c', 'desbravador', 'pendente', 'clube_b', 'B1');
select t.mk('entrante', 'Entrante em B',       'desbravador', 'ativo', 'clube_a', 'A2');
select t.mk2('entrante', 'desbravador', 'pendente', 'clube_b', 'B1');

-- A ordem fica EXPLÍCITA (tudo nasceu na mesma transação): o vínculo de A é o mais antigo, o de B
-- o mais novo. É o pior caso para os dois palpites antigos — "o mais antigo" escolhe A, "o mais
-- novo" escolhe B — e nenhum dos dois é a aba.
update public.organization_memberships
   set starts_at = now() - interval '30 days', created_at = now() - interval '30 days'
 where organizational_unit_id = t.id('clube_a')
   and user_id in (t.id('crianca'), t.id('amigo_ab'), t.id('lider_ab'), t.id('pai_ab'), t.id('ex_b'), t.id('entrante'));

-- o rótulo de uma unidade (A1, B1...) a partir do uuid
create function t.uni(p uuid) returns text language sql stable as $$
  select coalesce((select chave from t.ids where id = p and chave in ('A1', 'A2', 'B1', 'B2')), case when p is null then 'sem-unidade' else '?' end);
$$;
-- o rótulo de um clube (A, B, C) a partir do uuid
create function t.uni_clube(p uuid) returns text language sql stable as $$
  select case p when t.id('clube_a') then 'A' when t.id('clube_b') then 'B' when t.id('clube_c') then 'C' else '?' end;
$$;
-- como a pessoa aparece em membros_do_clube(...) para quem está logado: 'papel/unidade/status'
create function t.membro(p_quem text, p_args text default '') returns text language plpgsql as $$
declare v text;
begin
  execute format('select m.papel || ''/'' || t.uni(m.unidade_id) || ''/'' || m.status
                    from public.membros_do_clube(%s) m where m.id = %L', p_args, t.id(p_quem)) into v;
  return coalesce(v, 'ausente');
exception when others then
  return 'ERRO: ' || sqlerrm;
end $$;
-- a mensagem de erro de um comando (ou 'ok')
create function t.erro(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;
create function t.senha_intacta(p_quem text) returns boolean language sql security definer set search_path = '' as $$
  select encrypted_password = extensions.crypt('senha-original', encrypted_password) from auth.users where id = t.id(p_quem);
$$;
create function t.perfil(p_quem text) returns text language sql security definer set search_path = '' as $$
  select concat_ws('|', nome, coalesce(foto, 'sem-foto'), coalesce(nascimento::text, 'sem-nascimento'), teste)
    from public.profiles where id = t.id(p_quem);
$$;
\o

-- =============================================================================
--  1. membros_do_clube: cada clube vê a criança com o vínculo DELE
-- =============================================================================
select t.como('so_a'); select t.pedir_clube('clube_a');
select t.eq('[membros] na aba A a criança é desbravadora da A1, ativa', t.membro('crianca'), 'desbravador/A1/ativo');
select t.eq('[membros] ...e o colega só de B não aparece em A', t.membro('so_b'), 'ausente');
select t.eq('[membros] ...nem o ex-membro de B aparece como de B (em A ele é da A2)', t.membro('ex_b'), 'desbravador/A2/ativo');
select t.como('so_b'); select t.pedir_clube('clube_b');
select t.eq('[membros] na aba B a MESMA criança é da B1 (a unidade do vínculo de B)', t.membro('crianca'), 'desbravador/B1/ativo');
select t.eq('[membros] ...e o colega só de A não aparece em B', t.membro('so_a'), 'ausente');
select t.eq('[membros] ...nem o ex-membro de B (vínculo encerrado)', t.membro('ex_b'), 'ausente');
select t.eq('[membros] filtrar a unidade B1 traz a criança', t.membro('crianca', format('p_unidade_id => %L', t.id('B1'))), 'desbravador/B1/ativo');
select t.eq('[membros] filtrar a unidade A1 (de outro clube) na aba B não traz ninguém',
  t.n(format($q$select count(*) from public.membros_do_clube(p_unidade_id => %L)$q$, t.id('A1'))), 0);
-- a mesma pessoa, com as duas abas: quem olha não muda a resposta, o clube pedido muda
select t.como('lider_ab'); select t.pedir_clube('clube_a');
select t.eq('[membros] lider A+B na aba A vê a criança na A1', t.membro('crianca'), 'desbravador/A1/ativo');
select t.pedir_clube('clube_b');
select t.eq('[membros] ...e na aba B, na B1', t.membro('crianca'), 'desbravador/B1/ativo');
select t.como('crianca'); select t.pedir_clube('clube_b');
select t.eq('[membros] a própria criança, na aba B, se vê na B1', t.membro('crianca'), 'desbravador/B1/ativo');
select t.eq('[membros] o aniversário sai só como dia e mês', t.txt(format($q$select aniversario from public.membros_do_clube() where id = %L$q$, t.id('crianca'))), '03-15');
select t.eq('[membros] a busca por nome acha a criança', t.n($q$select count(*) from public.membros_do_clube(p_busca => 'dois clubes') where nome = 'Criança Dois Clubes'$q$), 1);
select t.eq('[membros] "%" na busca é texto, não curinga (não lista o clube inteiro)', t.n($q$select count(*) from public.membros_do_clube(p_busca => '%')$q$), 0);
select t.eq('[membros] a lista é por PESSOA: ninguém aparece duas vezes',
  t.n($q$select count(*) - count(distinct id) from public.membros_do_clube()$q$), 0);

-- status além de "ativo" é só para a liderança
select t.como('so_b'); select t.pedir_clube('clube_b');
select t.throws('[membros] membro comum NÃO lista pendentes', $q$select count(*) from public.membros_do_clube(p_status => array['pendente'])$q$, 'liderança');
select t.eq('[membros] ...nem vê responsáveis (papel pais), mesmo pedindo', t.n($q$select count(*) from public.membros_do_clube(p_papeis => array['pais'])$q$), 0);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('[membros] a liderança de B vê a diretora de C como PENDENTE em B', t.membro('dir_c', $a$p_status => array['pendente']$a$), 'desbravador/B1/pendente');
select t.eq('[membros] ...e os responsáveis de B, pedindo o papel', t.membro('pai_ab', $a$p_papeis => array['pais']$a$), 'pais/sem-unidade/ativo');

-- quem não é do clube não lê
select t.como_anon();
select t.throws('[membros] anon não lê', $q$select count(*) from public.membros_do_clube()$q$, 'permission denied');
select t.como('so_a'); select t.pedir_clube('clube_b');
select t.eq('[membros] quem é só de A, pedindo o clube B, recebe a lista vazia', t.n($q$select count(*) from public.membros_do_clube()$q$), 0);
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.eq('[membros] o responsável não recebe a lista de membros (a RLS de perfis também não mostra)', t.n($q$select count(*) from public.membros_do_clube()$q$), 0);
select t.como('dir_c'); select t.pedir_clube('clube_b');
select t.eq('[membros] quem está só PENDENTE em B não lê a lista de B', t.n($q$select count(*) from public.membros_do_clube()$q$), 0);

-- suspensa em B: some da lista ativa de B, e A não é afetado
select t.como('lider_b'); select t.pedir_clube('clube_b');
select public.vinculo_inativar(t.id('crianca'), 'saiu_do_clube');
select t.como('so_b'); select t.pedir_clube('clube_b');
select t.eq('[suspensa em B] sai da lista ativa de B', t.membro('crianca'), 'ausente');
select t.como('so_a'); select t.pedir_clube('clube_a');
select t.eq('[suspensa em B] ...e continua ativa na A1, em A', t.membro('crianca'), 'desbravador/A1/ativo');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('[suspensa em B] a liderança de B a vê como suspensa (pedindo esse status)', t.membro('crianca', $a$p_status => array['suspenso']$a$), 'desbravador/B1/suspenso');
select t.eq('[suspensa em B] ...também pelo vocabulário da tela ("inativo")', t.membro('crianca', $a$p_status => array['inativo']$a$), 'desbravador/B1/suspenso');
select public.vinculo_gerir(t.id('crianca'), p_status => 'ativo');
select t.como('so_b'); select t.pedir_clube('clube_b');
select t.eq('[suspensa em B] reativada, volta à B1', t.membro('crianca'), 'desbravador/B1/ativo');
reset role;

-- =============================================================================
--  2. O espelho não decide: aponte-o para A, depois para B — as duas abas não mudam
-- =============================================================================
\o /dev/null
create function t.forcar_espelho(p_quem text, p_unidade text) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;   -- sem o gatilho de sincronia: o espelho "errado" de propósito
  update public.profiles set unidade_id = t.id(p_unidade), papel = 'desbravador', status = 'ativo' where id = t.id(p_quem);
  set local session_replication_role = origin;
end $$;
\o
select t.forcar_espelho('crianca', 'A1');
select t.como('so_b'); select t.pedir_clube('clube_b');
select t.eq('[espelho em A] na aba B a criança continua na B1', t.membro('crianca'), 'desbravador/B1/ativo');
reset role;
select t.forcar_espelho('crianca', 'B1');
select t.como('so_a'); select t.pedir_clube('clube_a');
select t.eq('[espelho em B] na aba A a criança continua na A1', t.membro('crianca'), 'desbravador/A1/ativo');
reset role;
select t.forcar_espelho('crianca', 'A1');

-- =============================================================================
--  3. A senha é da pessoa: nenhum clube a troca por cima dos outros
-- =============================================================================
\o /dev/null
-- uma sessão aberta (e o refresh token dela) de quem vai ter a senha trocada
insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), t.id('so_a'), now(), now());
insert into auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at)
select 'token-61-so-a', t.id('so_a')::text, s.id, false, now(), now() from auth.sessions s where s.user_id = t.id('so_a');
\o
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('[senha] a liderança de A NÃO troca a senha da criança de A+B', format($q$select public.resetar_senha_membro(%L, 'SenhaNova2026')$q$, t.id('crianca')), 'outro clube');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('[senha] ...nem a de B', format($q$select public.resetar_senha_membro(%L, 'SenhaNova2026')$q$, t.id('crianca')), 'outro clube');
select t.throws('[senha] a liderança de B NÃO troca a senha do ex-membro (encerrado em B, ativo em A)', format($q$select public.resetar_senha_membro(%L, 'SenhaNova2026')$q$, t.id('ex_b')), 'ativo neste clube');
select t.throws('[senha] ...nem a da diretora de C que só digitou o código de B (pendente)', format($q$select public.resetar_senha_membro(%L, 'SenhaNova2026')$q$, t.id('dir_c')), 'ativo neste clube');
select t.eq('[senha] alvo de fora do clube e uuid inexistente recebem a MESMA resposta (sem oráculo)',
  t.erro(format($q$select public.resetar_senha_membro(%L, 'SenhaNova2026')$q$, t.id('so_a'))),
  t.erro(format($q$select public.resetar_senha_membro(%L, 'SenhaNova2026')$q$, gen_random_uuid())));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('[senha] a liderança de A troca a senha de quem é SÓ de A e está ativo', format($q$select public.resetar_senha_membro(%L, 'SenhaNova2026')$q$, t.id('so_a')));
select t.permitido('[senha] ...e a do ex-membro de B, que hoje é só de A (o vínculo encerrado não conta)', format($q$select public.resetar_senha_membro(%L, 'SenhaNova2026')$q$, t.id('ex_b')));
reset role;
select t.ok('[senha] a senha da criança continua a original', t.senha_intacta('crianca'));
select t.ok('[senha] ...a da diretora de C também', t.senha_intacta('dir_c'));
select t.ok('[senha] a de so_a mudou', not t.senha_intacta('so_a'));
select t.eq('[senha] as sessões abertas de so_a foram revogadas', (select count(*) from auth.sessions where user_id = t.id('so_a')), 0);
select t.eq('[senha] ...e os refresh tokens delas', (select count(*) from auth.refresh_tokens where user_id = t.id('so_a')::text), 0);
select t.eq('[senha] a auditoria registra a revogação', (select detalhe->>'sessoes_revogadas' from public.auditoria_operacoes
   where operacao = 'senha_redefinida' and alvo = t.id('so_a') order by id desc limit 1), 'true');

-- =============================================================================
--  4. O perfil é da pessoa: foto e modo teste só por RPC, e só para quem é só deste clube
-- =============================================================================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('[perfil] a diretoria de A NÃO liga o modo teste da criança de A+B', format($q$select public.membro_definir_teste(%L, true)$q$, t.id('crianca')), 'outro clube');
select t.throws('[perfil] ...nem troca a foto dela', format($q$select public.membro_definir_foto(%L, 'https://exemplo.test/outra.jpg')$q$, t.id('crianca')), 'outro clube');
select t.permitido('[perfil] liga o modo teste de quem é só de A', format($q$select public.membro_definir_teste(%L, true)$q$, t.id('so_a')), 0);
reset role;
select t.eq('[perfil] ...e ligou', (select teste from public.profiles where id = t.id('so_a')), true);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('[perfil] ...e desliga de novo', format($q$select public.membro_definir_teste(%L, false)$q$, t.id('so_a')), 0);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('[perfil] a diretoria de B NÃO mexe na criança de A+B', format($q$select public.membro_definir_teste(%L, true)$q$, t.id('crianca')), 'outro clube');
select t.throws('[perfil] ...nem na diretora de C que só está pendente em B', format($q$select public.membro_definir_teste(%L, true)$q$, t.id('dir_c')), 'não encontrada');
select t.eq('[perfil] pessoa de outro clube e uuid inexistente: a mesma resposta (sem oráculo)',
  t.erro(format($q$select public.membro_definir_teste(%L, true)$q$, t.id('so_a'))),
  t.erro(format($q$select public.membro_definir_teste(%L, true)$q$, gen_random_uuid())));
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.throws('[perfil] o instrutor NÃO liga modo teste (é da diretoria)', format($q$select public.membro_definir_teste(%L, true)$q$, t.id('so_a')), 'diretoria');
select t.permitido('[perfil] ...mas a liderança troca a foto de quem é só de A', format($q$select public.membro_definir_foto(%L, 'https://exemplo.test/so-a.jpg')$q$, t.id('so_a')), 0);
select t.como('so_a'); select t.pedir_clube('clube_a');
select t.throws('[perfil] membro comum não usa as RPCs da liderança', format($q$select public.membro_definir_foto(%L, null)$q$, t.id('so_a')), 'liderança');
reset role;
select t.eq('[perfil] a foto de so_a foi trocada pela liderança', (select foto from public.profiles where id = t.id('so_a')), 'https://exemplo.test/so-a.jpg');

-- UPDATE direto em profiles de terceiros: não existe mais para a liderança (a policy saiu)
select t.perfil('crianca') as perfil_crianca, t.perfil('so_a') as perfil_so_a, t.perfil('dir_c') as perfil_dir_c \gset
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.bloqueado('[perfil] a liderança de A não renomeia nem muda o nascimento da criança por UPDATE direto',
  format($q$update public.profiles set nome = 'Renomeada', foto = 'https://mal.test/x.jpg', nascimento = '2000-01-01' where id = %L$q$, t.id('crianca')));
select t.bloqueado('[perfil] ...nem de quem é só de A',
  format($q$update public.profiles set nome = 'Renomeado' where id = %L$q$, t.id('so_a')));
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.bloqueado('[perfil] a liderança de B não mexe no perfil da criança',
  format($q$update public.profiles set nome = 'Renomeada B', nascimento = '2001-01-01' where id = %L$q$, t.id('crianca')));
select t.bloqueado('[perfil] ...nem no da diretora de C que só digitou o código de B',
  format($q$update public.profiles set nome = 'Tomada' where id = %L$q$, t.id('dir_c')));
reset role;
select t.eq('[perfil] o perfil da criança ficou intacto', t.perfil('crianca'), :'perfil_crianca');
select t.eq('[perfil] ...o de so_a também', t.perfil('so_a'), :'perfil_so_a');
select t.eq('[perfil] ...e o da diretora de C', t.perfil('dir_c'), :'perfil_dir_c');

-- a própria pessoa: não se marca teste, e continua editando o que é dela
select t.como('crianca'); select t.pedir_clube('clube_a');
select t.bloqueado('[perfil] a criança não se marca como teste (sumiria do ranking dos dois clubes)',
  $q$update public.profiles set teste = true where id = auth.uid()$q$);
reset role;
select t.eq('[perfil] ...e continua fora do modo teste', (select teste from public.profiles where id = t.id('crianca')), false);

-- =============================================================================
--  5. Ajuda entre amigos: cada pedido é do clube em que foi feito
-- =============================================================================
select t.como('crianca'); select t.pedir_clube('clube_a');
select public.pedir_ajuda(t.id('amigo_ab'), 'forca', '{"palavra":"a"}'::jsonb, 'sonda') as ajuda_a \gset
select t.pedir_clube('clube_b');
select public.pedir_ajuda(t.id('amigo_ab'), 'forca', '{"palavra":"b"}'::jsonb, 'outra') as ajuda_b \gset
reset role;
select t.eq('[ajuda] pedir na aba B NÃO cancela o pedido aberto em A', (select status from public.ajudas where id = :'ajuda_a'), 'aberto');
select t.eq('[ajuda] ...e o amigo foi avisado nos DOIS clubes (um pedido em cada)',
  (select count(*) from public.notificacoes where para_usuario = t.id('amigo_ab') and titulo = '🆘 Pedido de ajuda!' and club_id = t.id('clube_a')) * 10
  + (select count(*) from public.notificacoes where para_usuario = t.id('amigo_ab') and titulo = '🆘 Pedido de ajuda!' and club_id = t.id('clube_b')), 11);
select t.como('amigo_ab'); select t.pedir_clube('clube_b');
select t.eq('[ajuda] na aba B o amigo vê só o pedido de B', t.txt($q$select string_agg(x->>'id', ',') from json_array_elements(public.ajudas_recebidas()) x$q$), :'ajuda_b');
select t.eq('[ajuda] a ajuda pedida em A NÃO se resolve na aba B', t.txt(format($q$select public.resolver_ajuda(%L, 'sonda')->>'ok'$q$, :'ajuda_a')), 'false');
reset role;
select t.eq('[ajuda] ...e continua aberta', (select status from public.ajudas where id = :'ajuda_a'), 'aberto');
select t.como('amigo_ab'); select t.pedir_clube('clube_a');
select t.eq('[ajuda] na aba A ela se resolve', t.txt(format($q$select public.resolver_ajuda(%L, 'sonda')->>'ganhou'$q$, :'ajuda_a')), '5');
reset role;
select t.eq('[ajuda] o +5 caiu no clube DA AJUDA (A), não em B',
  (select count(*) from public.pontos where usuario_id = t.id('amigo_ab') and origem = 'ajuda' and club_id = t.id('clube_a')) * 10
  + (select count(*) from public.pontos where usuario_id = t.id('amigo_ab') and origem = 'ajuda' and club_id = t.id('clube_b')), 10);
select t.eq('[ajuda] o aviso "você foi ajudado" é do clube A',
  (select string_agg(t.uni_clube(club_id), ',') from public.notificacoes where para_usuario = t.id('crianca') and titulo = '🎉 Você foi ajudado!'), 'A');

-- =============================================================================
--  6. Duelo em B não conta o que foi feito em A (e a presença é a que a chamada grava)
-- =============================================================================
\o /dev/null
insert into public.desafios_unidade (club_id, titulo, tipo, meta, pontos, dias) values
  (t.id('clube_b'), 'Missões 61', 'missoes', 1, 10, 7), (t.id('clube_b'), 'Presença 61', 'presenca', 1, 10, 7);
insert into public.duelos (club_id, desafio_id, unidade_a, unidade_b, prazo, criado_por)
select t.id('clube_b'), d.id, t.id('B1'), t.id('B2'), current_date + 7, t.id('lider_b')
  from public.desafios_unidade d where d.club_id = t.id('clube_b') and d.titulo in ('Missões 61', 'Presença 61');
insert into t.ids (chave, id) select 'duelo_missoes', du.id from public.duelos du join public.desafios_unidade d on d.id = du.desafio_id where d.titulo = 'Missões 61';
insert into t.ids (chave, id) select 'duelo_presenca', du.id from public.duelos du join public.desafios_unidade d on d.id = du.desafio_id where d.titulo = 'Presença 61';
-- o que a criança fez em A: uma missão e uma presença "na hora"
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id) values (t.id('crianca'), 'missao', 10, 'missão em A (61)', t.id('clube_a'));
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id, marca)
values (t.id('crianca'), 'apontamento', 10, 'reunião em A (61)', t.id('clube_a'), '{"presenca":"naHora"}');
create function t.feito(p_duelo text) returns text language sql as $$
  select coalesce((select x->>'feito' from json_array_elements(public.progresso_duelo(t.id(p_duelo))->'a'->'membros') x
                    where x->>'nome' = 'Criança Dois Clubes'), 'ausente');
$$;
\o
select t.como('so_b'); select t.pedir_clube('clube_b');
select t.eq('[duelo] a missão feita em A NÃO conta no duelo de B', t.feito('duelo_missoes'), '0');
select t.eq('[duelo] ...nem a presença na reunião de A', t.feito('duelo_presenca'), '0');
reset role;
\o /dev/null
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id) values (t.id('crianca'), 'missao', 10, 'missão em B (61)', t.id('clube_b'));
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id, marca)
values (t.id('crianca'), 'apontamento', 5, 'reunião em B (61)', t.id('clube_b'), '{"presenca":"atrasado"}');
\o
select t.como('so_b'); select t.pedir_clube('clube_b');
select t.eq('[duelo] a missão feita em B conta', t.feito('duelo_missoes'), '1');
select t.eq('[duelo] ...e a presença "atrasado" em B conta como presença (antes: só "presente", que a chamada nunca grava)', t.feito('duelo_presenca'), '1');
reset role;

-- =============================================================================
--  7. Chefão: o dano de B é o que foi feito em B
-- =============================================================================
\o /dev/null
insert into public.config_clube (club_id, chave, valor)
select c, k, v from (values (t.id('clube_a')), (t.id('clube_b'))) cl(c)
 cross join (values ('chefao_ativo', 'sim'),
                    ('chefao_inicio', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')),
                    ('chefao_vida', '999999')) kv(k, v)
on conflict (club_id, chave) do update set valor = excluded.valor;
\o
select t.como('crianca'); select t.pedir_clube('clube_b');
select t.n($q$select (public.chefao_estado()->>'dano')::int$q$) as dano_b_antes \gset
select t.pedir_clube('clube_a');
select t.permitido('[chefão] a criança golpeia o chefão de A', $q$select public.chefao_golpe()$q$);
select t.pedir_clube('clube_b');
select t.eq('[chefão] o golpe em A não soma no dano de B', t.n($q$select (public.chefao_estado()->>'dano')::int$q$), :dano_b_antes);
select t.eq('[chefão] ...e o golpe de B não aparece "recarregando" (o recarregamento é por clube)',
  t.txt($q$select (public.chefao_estado()->>'ja_golpeei') || '/' || (public.chefao_estado()->>'golpe_pronto')$q$), 'false/true');
reset role;
\o /dev/null
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id) values (t.id('crianca'), 'manual', 100, 'dano em A (61)', t.id('clube_a'));
\o
select t.como('crianca'); select t.pedir_clube('clube_b');
select t.eq('[chefão] pontos ganhos em A não somam no dano de B', t.n($q$select (public.chefao_estado()->>'dano')::int$q$), :dano_b_antes);
reset role;

-- o prêmio (cron): A vence com o que foi feito em A; B, que só teve 10 de dano, NÃO vence.
-- t.como_cron() e não só `reset role`: com o sub da criança ainda na transação, o teto de ±100 do
-- lançamento manual valeria para estes 500 (é o que o banco faz com quem tem sessão).
\o /dev/null
select t.como_cron();
update public.config_clube set valor = to_char((now() at time zone 'America/Sao_Paulo')::date - 3, 'YYYY-MM-DD')
 where chave = 'chefao_inicio' and club_id in (t.id('clube_a'), t.id('clube_b'));
update public.config_clube set valor = '400' where chave = 'chefao_vida' and club_id = t.id('clube_a');
update public.config_clube set valor = '100' where chave = 'chefao_vida' and club_id = t.id('clube_b');
delete from public.config_clube where chave = 'chefao_pago' and club_id in (t.id('clube_a'), t.id('clube_b'));
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id, data) values
  (t.id('crianca'), 'manual', 500, 'fim de semana em A (61)', t.id('clube_a'), now() - interval '60 hours'),
  (t.id('crianca'), 'manual', 10,  'fim de semana em B (61)', t.id('clube_b'), now() - interval '60 hours');
\o
select t.como_cron();
select public._chefao_premiar_clube(t.id('clube_a'));
select public._chefao_premiar_clube(t.id('clube_b'));
reset role;
select t.eq('[chefão] A derrotou o chefão com o dano de A: a criança levou a vida inteira (400) em A',
  (select coalesce(sum(pontos), 0) from public.pontos where origem = 'chefao' and usuario_id = t.id('crianca') and club_id = t.id('clube_a')), 400);
select t.eq('[chefão] B NÃO foi dado como derrotado pelo que ela fez em A: nenhum prêmio em B',
  (select count(*) from public.pontos where origem = 'chefao' and club_id = t.id('clube_b')), 0);
select t.eq('[chefão] ...B recebeu o aviso de que o chefão recuou',
  (select count(*) from public.notificacoes where titulo like '%recuou%' and club_id = t.id('clube_b')), 1);

-- =============================================================================
--  8. Jogos do dia: cada clube tem os seus, e o bônus de B não conta os jogos de A
-- =============================================================================
select t.como('crianca'); select t.pedir_clube('clube_a');
select t.eq('[jogos] a criança joga a memória em A', t.txt($q$select public.registrar_jogo('memoria', 3)->>'pontos'$q$), '30');
select t.eq('[jogos] ...e completa os jogos do dia de A: bônus em A', t.txt($q$select public.bonus_todos_jogos()->>'ganhou'$q$), '50');
select t.throws('[jogos] em A, a mesma memória de novo é recusada', $q$select public.registrar_jogo('memoria', 3)$q$, 'já jogou');
select t.pedir_clube('clube_b');
select t.eq('[jogos] na aba B, os jogos de A NÃO completam os jogos do dia de B (nada de bônus)',
  t.txt($q$select (public.bonus_todos_jogos()->>'completo') || '/' || (public.bonus_todos_jogos()->>'feitos') || '/' || (public.bonus_todos_jogos()->>'ganhou')$q$), 'false/0/0');
select t.eq('[jogos] ...e a trilha de B não mostra a memória como feita hoje', t.txt($q$select public.meu_progresso_trilha()->>'hoje'$q$), '[]');
select t.eq('[jogos] em B ela joga a memória também (os clubes são independentes)', t.txt($q$select public.registrar_jogo('memoria', 2)->>'pontos'$q$), '20');
select t.eq('[jogos] ...e ganha o bônus de B, que agora é dela', t.txt($q$select public.bonus_todos_jogos()->>'ganhou'$q$), '50');
reset role;
select t.eq('[jogos] uma jogada em cada clube, cada uma no seu',
  (select string_agg(t.uni_clube(club_id), ',' order by t.uni_clube(club_id)) from public.trilha_jogos where usuario_id = t.id('crianca')), 'A,B');
select t.eq('[jogos] um bônus em cada clube',
  (select string_agg(t.uni_clube(club_id), ',' order by t.uni_clube(club_id)) from public.pontos where usuario_id = t.id('crianca') and origem = 'bonus_dia'), 'A,B');

-- =============================================================================
--  9. O ponto manual e o aviso geral caem no clube da ABA
-- =============================================================================
-- O vínculo mais NOVO da criança é B. Antes, o gatilho carimbava B no ponto que a liderança de A
-- lançava na aba A — e a RLS recusava: A não conseguia pontuar a criança.
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('[carimbo] a liderança de A lança ponto manual para a criança, na aba A',
  format($q$insert into public.pontos (usuario_id, origem, pontos, motivo, lancado_por) values (%L, 'manual', 7, 'manual 61 A', auth.uid())$q$, t.id('crianca')));
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('[carimbo] ...e a de B, na aba B',
  format($q$insert into public.pontos (usuario_id, origem, pontos, motivo, lancado_por) values (%L, 'manual', 8, 'manual 61 B', auth.uid())$q$, t.id('crianca')));
select t.bloqueado('[carimbo] a liderança de B NÃO pontua quem é só de A (nem é desviado para outro clube)',
  format($q$insert into public.pontos (usuario_id, origem, pontos, motivo, lancado_por) values (%L, 'manual', 9, 'manual 61 X', auth.uid())$q$, t.id('so_a')));
reset role;
select t.eq('[carimbo] o ponto de A ficou em A, o de B em B',
  (select string_agg(motivo || '=' || t.uni_clube(club_id), ',' order by motivo) from public.pontos where motivo in ('manual 61 A', 'manual 61 B', 'manual 61 X')),
  'manual 61 A=A,manual 61 B=B');
-- rotina do banco (sem aba) continua com o palpite de sempre, mesmo com um header esquecido
select t.como_cron(); select t.pedir_clube('clube_a');
insert into public.pontos (usuario_id, origem, pontos, motivo) values (t.id('crianca'), 'manual', 1, 'rotina 61');
select t.esquecer_clube_pedido();
reset role;
select t.eq('[carimbo] a rotina do banco não usa o header: cai no palpite (o vínculo mais novo, B)',
  (select t.uni_clube(club_id) from public.pontos where motivo = 'rotina 61'), 'B');

-- lider_ab: A é o clube mais ANTIGO dela; antes, o aviso ia para o mais novo (B) e a aba A recusava
select t.como('lider_ab'); select t.pedir_clube('clube_a');
select t.permitido('[carimbo] o aviso geral de quem é liderança em A e B, pela aba A',
  format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por) values ('Aviso 61 A', 'x', 'geral', '/', 'todos', %L)$q$, t.id('lider_ab')));
select t.pedir_clube('clube_b');
select t.permitido('[carimbo] ...e pela aba B',
  format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por) values ('Aviso 61 B', 'x', 'geral', '/', 'todos', %L)$q$, t.id('lider_ab')));
reset role;
select t.eq('[carimbo] cada aviso ficou no clube da aba em que foi escrito',
  (select string_agg(titulo || '=' || t.uni_clube(club_id), ',' order by titulo) from public.notificacoes where titulo in ('Aviso 61 A', 'Aviso 61 B')),
  'Aviso 61 A=A,Aviso 61 B=B');

-- =============================================================================
--  10. "Cadastro aprovado" vem da aprovação no clube, não do espelho
-- =============================================================================
select t.como('lider_b'); select t.pedir_clube('clube_b');
select public.vinculo_gerir(t.id('entrante'), p_status => 'ativo');
reset role;
select t.eq('[aprovação] quem já era ativo em A e foi aprovado em B recebe o aviso, no clube B',
  (select string_agg(t.uni_clube(club_id), ',') from public.notificacoes where para_usuario = t.id('entrante') and titulo like '%Cadastro aprovado%'), 'B');
select t.eq('[aprovação] a suspensão e a reativação da criança em B NÃO geram "cadastro aprovado"',
  (select count(*) from public.notificacoes where para_usuario = t.id('crianca') and titulo like '%Cadastro aprovado%'), 0);

-- =============================================================================
--  11. O mesmo responsável, a mesma criança, nos dois clubes
-- =============================================================================
select t.como('pai_ab'); select t.pedir_clube('clube_a');
select public.pedir_vinculo('Criança Dois Clubes');
select t.pedir_clube('clube_b');
select public.pedir_vinculo('Criança Dois Clubes');
select t.como('lider_ab'); select t.pedir_clube('clube_a');
select t.eq('[responsável] quem é diretoria em A e B vê, na aba A, só o pedido de A', t.n('select json_array_length(public.vinculos_pendentes())'), 1);
select t.pedir_clube('clube_b');
select t.eq('[responsável] ...e na aba B, só o de B', t.n('select json_array_length(public.vinculos_pendentes())'), 1);
reset role;
select id as pedido_a from public.responsaveis where responsavel_id = t.id('pai_ab') and club_id = t.id('clube_a') \gset
select id as pedido_b from public.responsaveis where responsavel_id = t.id('pai_ab') and club_id = t.id('clube_b') \gset
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('[responsável] A aprova o pai para a criança', format('select public.aprovar_vinculo(%L, %L)', :'pedido_a', t.id('crianca')));
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('[responsável] ...e B aprova o MESMO pai para a MESMA criança (antes: "já está vinculado")', format('select public.aprovar_vinculo(%L, %L)', :'pedido_b', t.id('crianca')));
select t.como('pai_ab'); select t.pedir_clube('clube_a');
select t.eq('[responsável] na aba A o pai vê a criança na unidade de A', t.txt($q$select public.meus_filhos()->0->>'unidade'$q$), 'Teste A1');
select t.pedir_clube('clube_b');
select t.eq('[responsável] na aba B, na unidade de B', t.txt($q$select public.meus_filhos()->0->>'unidade'$q$), 'Teste B1');
select t.eq('[responsável] ...e as presenças de B contam o "atrasado" da chamada (e não a presença de A)', t.txt($q$select public.meus_filhos()->0->>'presencas'$q$), '1');
reset role;

-- =============================================================================
--  12. Dinheiro e a tela de Usuários
-- =============================================================================
select t.como('tesoureiro_a'); select t.pedir_clube('clube_a');
select t.eq('[mensalidades] o TESOUREIRO recebe o mapa do ano (antes: vazio)',
  t.n(format($q$select count(*) from public.mensalidades_ano(2026) where desbravador_id = %L$q$, t.id('crianca'))), 1);
select t.eq('[mensalidades] ...só com gente de A', t.n(format($q$select count(*) from public.mensalidades_ano(2026) where desbravador_id = %L$q$, t.id('so_b'))), 0);
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('[mensalidades] o instrutor (sem papel financeiro) não lê', t.n($q$select count(*) from public.mensalidades_ano(2026)$q$), 0);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('[usuários] o ex-membro aparece na lista de B, mas SEM o e-mail',
  t.txt(format($q$select status || '/' || coalesce(email, 'sem-email') from public.listar_usuarios() where id = %L$q$, t.id('ex_b'))), 'rejeitado/sem-email');
select t.ok('[usuários] ...quem está ativo continua com o e-mail',
  t.txt(format($q$select email from public.listar_usuarios() where id = %L$q$, t.id('crianca'))) like '%@teste.local');
reset role;

-- =============================================================================
--  13. A própria pessoa segue editando o que é dela
-- =============================================================================
select t.como('crianca'); select t.pedir_clube('clube_b');
select t.permitido('[perfil] a criança troca a própria foto, o nome e marca o sino como visto',
  $q$update public.profiles set foto = 'https://exemplo.test/eu.jpg', nome = 'Criança Renomeada', notif_visto_em = now() where id = auth.uid()$q$);
reset role;
select t.eq('[perfil] ...e mudou', (select nome || '|' || foto from public.profiles where id = t.id('crianca')), 'Criança Renomeada|https://exemplo.test/eu.jpg');

-- =============================================================================
--  14. As travas no catálogo (o que garante que isso não volta por outra porta)
-- =============================================================================
select t.eq('[catálogo] authenticated não tem UPDATE em profiles.teste',
  (select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'teste' and grantee = 'authenticated' and privilege_type = 'UPDATE'), 0);
select t.eq('[catálogo] a única policy de UPDATE em profiles é a da própria pessoa',
  (select string_agg(policyname, ',') from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'), 'editar proprio perfil');
select t.eq('[catálogo] o "já jogou hoje" é único por pessoa E clube',
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'trilha_jogos'
      and indexdef ilike 'create unique index%' and indexdef not like '%(id)%'
      and indexdef not like '%club_id%'), 0);
select t.eq('[catálogo] o par responsável-criança aprovado é único por clube',
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'responsaveis'
      and indexdef ilike 'create unique index%' and indexdef not like '%(id)%' and indexdef not like '%club_id%'), 0);
select t.eq('[catálogo] nenhum gatilho de aviso nasce do espelho profiles',
  (select count(*) from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal and tgname like '%notif%'), 0);
select t.ok('[catálogo] membros_do_clube: authenticated executa, anon não',
  has_function_privilege('authenticated', 'public.membros_do_clube(text[], uuid, text[], text)', 'execute')
  and not has_function_privilege('anon', 'public.membros_do_clube(text[], uuid, text[], text)', 'execute'));
select t.ok('[catálogo] membros_do_clube não devolve data de nascimento (só "aniversario" como texto MM-DD)',
  pg_get_function_result('public.membros_do_clube(text[], uuid, text[], text)'::regprocedure) !~* '\mdate\M|nascimento');

-- =============================================================================
--  15. (86, S1) A conta de quem ADMINISTRA A PLATAFORMA não é mexida por um clube
-- =============================================================================
-- O dono da plataforma também é diretoria de A — e só de A. A trava da 80 olhava só os vínculos:
-- para ela, ele era "só deste clube", e a liderança de A redefinia a senha GLOBAL dele (e, com ela,
-- entrava nas RPCs de plataforma de TODOS os clubes). O de suporte é conselheiro em A e está
-- DESATIVADO em platform_admins: a conta é a mesma, e ele pode ser reativado.
\o /dev/null
select t.mk('adm_plat', 'Admin Plataforma 61', 'diretoria',   'ativo', 'clube_a');
select t.mk('sup_plat', 'Suporte Plataforma 61', 'conselheiro', 'ativo', 'clube_a', 'A1');
insert into public.platform_admins (user_id, papel, ativo, motivo) values
  (t.id('adm_plat'), 'owner', true, 'teste 61'), (t.id('sup_plat'), 'suporte', false, 'teste 61 (desativado)');
\o
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('[admin] a diretoria de A NÃO redefine a senha do dono da plataforma (que é diretoria só de A)',
  format($q$select public.resetar_senha_membro(%L, 'Tomada2026x')$q$, t.id('adm_plat')), 'outro clube');
select t.throws('[admin] ...nem liga o modo teste dele', format($q$select public.membro_definir_teste(%L, true)$q$, t.id('adm_plat')), 'outro clube');
select t.throws('[admin] ...nem troca a foto dele', format($q$select public.membro_definir_foto(%L, 'https://atacante.example/x.png')$q$, t.id('adm_plat')), 'outro clube');
select t.throws('[admin] ...nem mexe no admin DESATIVADO (a conta é a mesma)', format($q$select public.membro_definir_teste(%L, true)$q$, t.id('sup_plat')), 'outro clube');
select t.eq('[admin] a recusa é a MESMA de "participa de outro clube" (ninguém descobre por aqui quem é admin)',
  t.erro(format($q$select public.resetar_senha_membro(%L, 'Tomada2026x')$q$, t.id('adm_plat'))),
  t.erro(format($q$select public.resetar_senha_membro(%L, 'Tomada2026x')$q$, t.id('crianca'))));
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.throws('[admin] o INSTRUTOR de A não redefine a senha do admin que é conselheiro em A (o passo da diretoria não o protegia)',
  format($q$select public.resetar_senha_membro(%L, 'Tomada2026x')$q$, t.id('sup_plat')), 'Sem permissão');  -- migration 210: instrutor não redefine senha de ninguém
select t.throws('[admin] ...nem troca a foto dele', format($q$select public.membro_definir_foto(%L, 'https://atacante.example/x.png')$q$, t.id('sup_plat')), 'outro clube');
reset role;
select t.ok('[admin] as senhas dos dois admins continuam as originais', t.senha_intacta('adm_plat') and t.senha_intacta('sup_plat'));
select t.eq('[admin] ...e foto e modo teste também', t.perfil('adm_plat') || ' / ' || t.perfil('sup_plat'),
  'Admin Plataforma 61|sem-foto|sem-nascimento|f / Suporte Plataforma 61|sem-foto|sem-nascimento|f');

-- =============================================================================
--  16. (86, S2) A data de nascimento completa não sai pela API; a própria pessoa lê a dela por RPC
-- =============================================================================
select t.como('so_a'); select t.pedir_clube('clube_a');
select t.throws('[nascimento] um colega de A NÃO lê a data de nascimento de outra criança pela API',
  format($q$select nascimento from public.profiles where id = %L$q$, t.id('amigo_ab')), 'permission denied');
select t.throws('[nascimento] ...nem com select * (o Auth do front passa a usar a RPC meu_perfil)', $q$select * from public.profiles limit 1$q$, 'permission denied');
select t.eq('[nascimento] ...as outras colunas continuam legíveis (ranking, chat, chamada)',
  t.txt(format($q$select nome || '|' || coalesce(foto, 'sem-foto') from public.profiles where id = %L$q$, t.id('amigo_ab'))), 'Amigo Dois Clubes|sem-foto');
select t.eq('[nascimento] ...e o card de aniversariantes segue com o dia e o mês', t.txt(format($q$select aniversario from public.membros_do_clube() where id = %L$q$, t.id('amigo_ab'))), '04-04');
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.throws('[nascimento] quem é de B também não lê o nascimento da criança de A+B',
  format($q$select nascimento from public.profiles where id = %L$q$, t.id('crianca')), 'permission denied');
select t.como('crianca'); select t.pedir_clube('clube_b');
select t.eq('[nascimento] a própria criança lê o SEU nascimento pela RPC meu_perfil()', t.txt($q$select nascimento::text from public.meu_perfil()$q$), '2014-03-15');
select t.eq('[nascimento] ...que devolve só a linha dela, com as colunas de profiles',
  t.txt($q$select count(*) || '|' || bool_and(id = auth.uid()) || '|' || bool_and(nome is not null) from public.meu_perfil()$q$), '1|true|true');
select t.ok('[nascimento] a missão do dia (que usa o nascimento para a classe, como definer) continua respondendo', t.n($q$select count(*) from public.missao_do_dia()$q$) >= 0);
select t.como_anon();
select t.throws('[nascimento] anon não chama meu_perfil', $q$select count(*) from public.meu_perfil()$q$, 'permission denied');
reset role;
select t.ok('[catálogo] authenticated não tem SELECT em profiles.nascimento, nem o SELECT da tabela inteira',
  not has_column_privilege('authenticated', 'public.profiles', 'nascimento', 'select')
  and not has_table_privilege('authenticated', 'public.profiles', 'select')
  and has_column_privilege('authenticated', 'public.profiles', 'nome', 'select'));

-- =============================================================================
--  17. (86, M1) Missão e devocional: uma por pessoa, por CLUBE, por dia
-- =============================================================================
-- Antes: "já fez hoje" somava os clubes, mas o duelo de B (81) só conta o que foi feito em B — a
-- criança que fazia primeiro em A ficava com "já fez" em B e ZERO no duelo de B para sempre.
\o /dev/null
update public.desafios set ativo = false where club_id in (t.id('clube_a'), t.id('clube_b'));
insert into public.desafios (club_id, tema, texto, pergunta, opcoes, correta, classe, pede_foto, ativo) values
  (t.id('clube_a'), 'T61', 'missão de A (61)', 'P?', '["a","b"]'::jsonb, 0, null, false, true),
  (t.id('clube_b'), 'T61', 'missão de B (61)', 'P?', '["a","b"]'::jsonb, 0, null, false, true);
update public.versiculos set ativo = false where club_id in (t.id('clube_a'), t.id('clube_b'));
insert into public.versiculos (club_id, texto, referencia, pergunta, opcoes, correta, ativo, livro_abrev, capitulo, versiculo_num) values
  (t.id('clube_a'), 'versículo de A (61)', 'Gn 1:1', 'Q?', '["x","y"]'::jsonb, 0, true, 'gn', 1, 1),
  (t.id('clube_b'), 'versículo de B (61)', 'Gn 1:2', 'Q?', '["x","y"]'::jsonb, 0, true, 'gn', 1, 2);
-- um duelo de DEVOCIONAL em B, B2 x B1 (a criança fica no lado b; o lado a de B1 já tem 2 duelos da seção 6)
insert into public.desafios_unidade (club_id, titulo, tipo, meta, pontos, dias) values (t.id('clube_b'), 'Devocional 61', 'devocional', 1, 10, 7);
insert into public.duelos (club_id, desafio_id, unidade_a, unidade_b, prazo, criado_por)
select t.id('clube_b'), d.id, t.id('B2'), t.id('B1'), current_date + 7, t.id('lider_b') from public.desafios_unidade d where d.titulo = 'Devocional 61';
insert into t.ids (chave, id) select 'duelo_devocional', du.id from public.duelos du join public.desafios_unidade d on d.id = du.desafio_id where d.titulo = 'Devocional 61';
-- o "feito" de alguém num lado do duelo, pelo nome (a criança foi renomeada na seção 13)
create function t.feito_lado(p_duelo text, p_lado text, p_nome text) returns text language sql as $$
  select coalesce((select x->>'feito' from json_array_elements(public.progresso_duelo(t.id(p_duelo))->p_lado->'membros') x
                    where x->>'nome' = p_nome), 'ausente');
$$;
\o
select t.como('so_b'); select t.pedir_clube('clube_b');
select t.feito_lado('duelo_missoes', 'a', 'Criança Renomeada') as missoes_b_antes \gset
select t.como('crianca'); select t.pedir_clube('clube_a');
select t.permitido('[missão] a criança faz a missão na aba A', $q$select public.registrar_missao(null, 0)$q$);
select t.permitido('[devocional] ...e o devocional na aba A', $q$select public.registrar_devocional(0)$q$);
select t.pedir_clube('clube_b');
select t.eq('[missão] na aba B a missão de hoje NÃO aparece como feita (antes: "feito", era a de A)',
  t.txt($q$select (public.meu_resumo_missoes()->>'feito') || '|' || (public.meu_resumo_devocional()->>'feito') || '|' || public.devocional_feito_hoje()::text$q$), 'false|false|false');
select t.como('so_b'); select t.pedir_clube('clube_b');
select t.eq('[duelo] a missão feita em A não conta no duelo de B', t.feito_lado('duelo_missoes', 'a', 'Criança Renomeada'), :'missoes_b_antes');
select t.eq('[duelo] ...nem o devocional feito em A', t.feito_lado('duelo_devocional', 'b', 'Criança Renomeada'), '0');
select t.como('crianca'); select t.pedir_clube('clube_b');
select t.permitido('[missão] em B ela faz a missão de B (antes: "Você já fez a missão de hoje!")', $q$select public.registrar_missao(null, 0)$q$);
select t.permitido('[devocional] ...e o devocional de B (antes: "Você já fez o devocional de hoje!")', $q$select public.registrar_devocional(0)$q$);
select t.throws('[missão] ...uma vez por clube: de novo em B é recusado', $q$select public.registrar_missao(null, 0)$q$, 'já fez a missão');
select t.throws('[devocional] ...idem o devocional', $q$select public.registrar_devocional(0)$q$, 'já fez o devocional');
select t.eq('[missão] agora a aba B mostra feito',
  t.txt($q$select (public.meu_resumo_missoes()->>'feito') || '|' || (public.meu_resumo_devocional()->>'feito') || '|' || public.devocional_feito_hoje()::text$q$), 'true|true|true');
select t.como('so_b'); select t.pedir_clube('clube_b');
select t.eq('[duelo] a missão feita em B conta no duelo de B (+1)', t.feito_lado('duelo_missoes', 'a', 'Criança Renomeada'), ((:'missoes_b_antes')::int + 1)::text);
select t.eq('[duelo] ...e o devocional feito em B também', t.feito_lado('duelo_devocional', 'b', 'Criança Renomeada'), '1');
reset role;
select t.eq('[missão] uma missão e um devocional em CADA clube, cada um no seu',
  (select string_agg(t.uni_clube(club_id), ',' order by t.uni_clube(club_id)) from public.missoes_feitas where usuario_id = t.id('crianca'))
  || '|' || (select string_agg(t.uni_clube(club_id), ',' order by t.uni_clube(club_id)) from public.devocional where usuario_id = t.id('crianca')), 'A,B|A,B');
select t.eq('[catálogo] o "já fez hoje" de missão e devocional é único por pessoa E clube',
  (select count(*) from pg_indexes where schemaname = 'public' and tablename in ('missoes_feitas', 'devocional')
      and indexdef ilike 'create unique index%' and indexdef not like '%(id)%' and indexdef not like '%club_id%'), 0);

-- =============================================================================
--  18. (86, M2) Conselheira que também é responsável no mesmo clube vale como conselheira
-- =============================================================================
\o /dev/null
select t.mk('mae_b', 'Mae Conselheira 61', 'conselheiro', 'ativo', 'clube_b', 'B2');
-- o vínculo de responsável é o MAIS NOVO (inserido direto: nenhum fluxo do app cria isso, mas dado legado sim)
insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (t.id('mae_b'), t.id('clube_b'), 'pais', 'ativo');
insert into public.desafios_unidade (club_id, titulo, tipo, meta, pontos, dias) values
  (t.id('clube_a'), 'Duelo A1 61', 'manual', 1, 10, 7), (t.id('clube_a'), 'Duelo A2 61', 'manual', 1, 10, 7), (t.id('clube_a'), 'Duelo A3 61', 'manual', 1, 10, 7),
  (t.id('clube_b'), 'Duelo B 61', 'manual', 1, 10, 7), (t.id('clube_b'), 'Duelo M2 61', 'manual', 1, 10, 7);
\o
select t.eq('[vínculo] _vinculo_ativo escolhe a conselheira (não o "pais" mais novo) — o mesmo critério da lista',
  (select papel || '/' || t.uni(unidade_id) from public._vinculo_ativo(t.id('mae_b'), t.id('clube_b'))), 'conselheiro/B2');
select t.como('mae_b'); select t.pedir_clube('clube_b');
select t.eq('[vínculo] ...e ela lança duelo pela unidade dela (antes: "precisa estar numa unidade")',
  t.erro(format($q$select public.criar_duelo((select id from public.desafios_unidade where titulo = 'Duelo M2 61'), %L)$q$, t.id('B1'))), 'ok');
reset role;

-- =============================================================================
--  19. (86, M4) O teto de 3 duelos em 24h é por clube
-- =============================================================================
select t.como('crianca'); select t.pedir_clube('clube_a');
select t.permitido('[duelo] a criança lança 3 duelos em A',
  format($q$select public.criar_duelo(d.id, %L) from public.desafios_unidade d where d.titulo in ('Duelo A1 61', 'Duelo A2 61', 'Duelo A3 61')$q$, t.id('A2')), 3);
select t.pedir_clube('clube_b');
select t.eq('[duelo] ...e ainda lança um em B (antes: "Você já lançou 3 duelos nas últimas 24h")',
  t.erro(format($q$select public.criar_duelo((select id from public.desafios_unidade where titulo = 'Duelo B 61'), %L)$q$, t.id('B2'))), 'ok');
reset role;

-- =============================================================================
--  20. (86, M5) O aviso de aniversário segue a regra do card
-- =============================================================================
\o /dev/null
-- aniversário HOJE (ano bissexto: 29/02 também existe)
create function t.aniv_hoje() returns date language sql stable as $$
  select make_date(2012, extract(month from (now() at time zone 'America/Sao_Paulo'))::int, extract(day from (now() at time zone 'America/Sao_Paulo'))::int);
$$;
select t.mk('aniv_mae', 'Aniv61 Mae', 'conselheiro', 'ativo', 'clube_a', 'A1', t.aniv_hoje());
select t.mk2('aniv_mae', 'pais', 'ativo', 'clube_b');                 -- em B ela é só responsável
select t.mk('aniv_crianca', 'Aniv61 Crianca', 'desbravador', 'ativo', 'clube_a', 'A1', t.aniv_hoje());
select t.mk2('aniv_crianca', 'desbravador', 'ativo', 'clube_b', 'B1');
select t.mk('aniv_dois', 'Aniv61 Dois Papeis', 'conselheiro', 'ativo', 'clube_b', 'B1', t.aniv_hoje());
select t.mk2('aniv_dois', 'instrutor', 'ativo', 'clube_b');           -- dois papéis no MESMO clube
select t.mk('aniv_teste', 'Aniv61 Teste', 'desbravador', 'ativo', 'clube_a', 'A2', t.aniv_hoje());
update public.profiles set teste = true where id = t.id('aniv_teste');
select t.mk('aniv_vencido', 'Aniv61 Vencido', 'desbravador', 'ativo', 'clube_a', 'A2', t.aniv_hoje());
update public.organization_memberships set starts_at = now() - interval '60 days', ends_at = now() - interval '1 day' where user_id = t.id('aniv_vencido');
\o
select t.como_cron();
select public.notif_aniversariantes_hoje();
reset role;
select t.eq('[aniversário] um aviso por pessoa por clube, e só de quem está no card (sem responsável, conta de teste nem vínculo vencido)',
  (select string_agg(x, ',' order by x) from (
     select substring(corpo from 'Aniv61 [A-Za-z ]+') || '@' || t.uni_clube(club_id) as x
       from public.notificacoes where corpo like '%Aniv61%') q),
  'Aniv61 Crianca@A,Aniv61 Crianca@B,Aniv61 Dois Papeis@B,Aniv61 Mae@A');

-- =============================================================================
--  21. (86, R3) "Reativar" avisa a pessoa (com texto de reativação, não "cadastro aprovado")
-- =============================================================================
\o /dev/null
select t.mk('rejeitada_b', 'Rejeitada em B 61', 'desbravador', 'pendente', 'clube_b', 'B1');
\o
select t.como('lider_b'); select t.pedir_clube('clube_b');
select public.vinculo_gerir(t.id('rejeitada_b'), p_status => 'rejeitado');
select public.vinculo_gerir(t.id('rejeitada_b'), p_status => 'ativo');
reset role;
select t.eq('[reativar] quem foi REJEITADO e depois reativado recebe o aviso de reativação, no clube B',
  (select string_agg(titulo || '@' || t.uni_clube(club_id), ',') from public.notificacoes where para_usuario = t.id('rejeitada_b') and tipo = 'cadastro'),
  '🔓 Acesso reativado!@B');
select t.eq('[reativar] ...e a criança desativada e reativada em B (seção 1) também — uma vez, em B',
  (select string_agg(t.uni_clube(club_id), ',') from public.notificacoes where para_usuario = t.id('crianca') and titulo like '%reativado%'), 'B');

select t.fim();
rollback;
