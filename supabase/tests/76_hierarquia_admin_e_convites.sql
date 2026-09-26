-- Hierarquia gerida no /admin + convites de coordenação + pedido de região do clube (migration 130).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin_h', '{"tipo":"fundador","nome":"Admin Hierarquia"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin_h'), 'operacao', 'teste 76');
select t.signup('coord_fixo', '{"tipo":"fundador","nome":"Coord Fixo 76"}'::jsonb);
select t.signup('coord_esc', '{"tipo":"fundador","nome":"Coord Escolha 76"}'::jsonb);
select t.signup('coord_uni', '{"tipo":"fundador","nome":"Coord Uniao 76"}'::jsonb);
select t.signup('curioso', '{"tipo":"fundador","nome":"Curioso 76"}'::jsonb);
grant insert, select on t.ids to public;
select set_config('t76.nome_a', (select nome from public.organizational_units where id = t.id('clube_a')), true);  -- o admin (authenticated) guarda os ids que criou
\o

-- ==================== 1) só o admin da plataforma mexe na árvore ====================
select t.como('lider_a');
select t.throws('diretoria: admin_hierarquia recusada', 'select public.admin_hierarquia()', 'Sem permissão');
select t.throws('diretoria: criar unidade recusada', $q$select public.admin_unidade_criar('regiao', 'Região Pirata')$q$, 'Sem permissão');
select t.throws('diretoria: vincular o próprio clube recusado',
  format('select public.admin_clube_vincular(%L, null)', t.id('clube_a')), 'Sem permissão');
select t.throws('diretoria: gerar convite recusado', $q$select public.admin_convite_hierarquia_gerar('coordenador_regional')$q$, 'Sem permissão');
select t.eq('diretoria: UPDATE direto do parent_id do clube não passa (RLS)',
  t.n(format($q$with u as (update public.organizational_units set parent_id = null where id = %L returning 1) select count(*) from u$q$, t.id('clube_a'))) <= 0, true);
reset role;
select t.eq('anon: nenhuma RPC de admin/clube nova tem EXECUTE',
  t.n($q$select count(*) from unnest(array['admin_hierarquia()','admin_unidade_criar(text,text,uuid)','admin_clube_vincular(uuid,uuid,text)',
        'admin_convite_hierarquia_gerar(text,uuid,integer,integer,text)','convite_hierarquia_aceitar(text,uuid)',
        'clube_hierarquia_solicitar(uuid,uuid)','admin_coordenador_decidir(uuid,boolean,text)']) f
       where has_function_privilege('anon', 'public.' || f, 'execute')$q$), 0);

-- ==================== 2) admin monta a árvore ====================
select t.como('admin_h');
insert into t.ids (chave, id) select 'div', (public.admin_unidade_criar('divisao', 'Divisão 76') ->> 'id')::uuid;
insert into t.ids (chave, id) select 'uni', (public.admin_unidade_criar('uniao', 'União 76', t.id('div')) ->> 'id')::uuid;
insert into t.ids (chave, id) select 'campo', (public.admin_unidade_criar('campo', 'Associação 76', t.id('uni')) ->> 'id')::uuid;
insert into t.ids (chave, id) select 'norte', (public.admin_unidade_criar('regiao', 'Região Norte 76', t.id('campo')) ->> 'id')::uuid;
insert into t.ids (chave, id) select 'sul', (public.admin_unidade_criar('regiao', 'Região Sul 76', t.id('campo')) ->> 'id')::uuid;
insert into t.ids (chave, id) select 'dist', (public.admin_unidade_criar('distrito', 'Distrito Centro 76', t.id('norte')) ->> 'id')::uuid;
select t.ok('admin: árvore criada (6 unidades)', (select count(*) = 6 from json_array_elements(public.admin_hierarquia() -> 'unidades') u
  where (u ->> 'nome') like '%76'));
select t.throws('admin: região não pode ficar debaixo de distrito',
  format($q$select public.admin_unidade_criar('regiao', 'Errada', %L)$q$, t.id('dist')), 'não pode ficar debaixo');
select t.throws('admin: tipo clube não se cria por aqui', $q$select public.admin_unidade_criar('clube', 'Clube Novo')$q$, 'Tipo inválido');
select t.throws('admin: ciclo recusado (campo debaixo da própria região)',
  format($q$select public.admin_unidade_editar(%L, 'Associação 76', %L)$q$, t.id('campo'), t.id('norte')), 'não pode ficar debaixo');
select t.ok('admin: renomear unidade', (public.admin_unidade_editar(t.id('sul'), 'Região Sul 76', t.id('campo')) ->> 'ok')::boolean);
select t.throws('admin: desativar região com distrito ativo debaixo é recusado',
  format('select public.admin_unidade_status(%L, false)', t.id('norte')), 'Mova ou desative');
reset role;
select t.ok('auditoria: criação de unidade ficou registrada',
  (select count(*) >= 6 from public.platform_admin_audit where acao = 'hierarquia_unidade_criar' and admin_user_id = t.id('admin_h')));

-- ==================== 3) clube escolhe a região → pedido pendente → admin confirma ====================
select t.como('lider_a');
select t.ok('diretoria: lista de opções traz o distrito', (select count(*) = 1 from json_array_elements(public.hierarquia_opcoes_para_clube()) o
  where (o ->> 'id')::uuid = t.id('dist')));
select t.eq('diretoria: pedir a Região Norte vira PENDENTE',
  t.txt(format('select public.clube_hierarquia_solicitar(%L, %L) ->> %L', t.id('clube_a'), t.id('norte'), 'status')), 'pendente');
select t.eq('diretoria: mudar de ideia (distrito) — continua 1 pendente só',
  t.txt(format('select public.clube_hierarquia_solicitar(%L, %L) ->> %L', t.id('clube_a'), t.id('dist'), 'status')), 'pendente');
select t.eq('...o clube AINDA não está debaixo de nada novo',
  t.n(format($q$select count(*) from public.organizational_units where id = %L and parent_id = %L$q$, t.id('clube_a'), t.id('dist'))), 0);
select t.throws('diretoria do clube A não pede pelo clube B',
  format('select public.clube_hierarquia_solicitar(%L, %L)', t.id('clube_b'), t.id('norte')), 'Sem permissão');
select t.como('membro_a');
select t.throws('desbravador não pede região', format('select public.clube_hierarquia_solicitar(%L, %L)', t.id('clube_a'), t.id('norte')), 'Sem permissão');
reset role;
select t.eq('só 1 pedido pendente para o clube A',
  t.n(format($q$select count(*) from public.club_hierarchy_requests where club_id = %L and status = 'pendente'$q$, t.id('clube_a'))), 1);

select t.como('admin_h');
select t.eq('admin: pedido aparece nas pendências',
  t.n($q$select count(*) from json_array_elements(public.admin_hierarquia() -> 'pedidos_clube')$q$), 1);
select t.eq('admin: confirma o pedido',
  t.txt(format($q$select public.admin_pedido_clube_decidir((select (p ->> 'id')::uuid from json_array_elements(public.admin_hierarquia() -> 'pedidos_clube') p limit 1), true) ->> 'status'$q$)), 'confirmado');
reset role;
select t.eq('clube A agora está debaixo do Distrito Centro',
  (select parent_id from public.organizational_units where id = t.id('clube_a')), t.id('dist'));

-- clube B: admin ALTERA o pedido (pediu Norte, fica no Sul)
select t.como('lider_b');
select public.clube_hierarquia_solicitar(t.id('clube_b'), t.id('norte')) is not null;
select t.como('admin_h');
select t.ok('admin: confirma alterando para a Região Sul',
  (select (public.admin_pedido_clube_decidir((p ->> 'id')::uuid, true, t.id('sul'), 'fica no sul') ->> 'parent_id')::uuid = t.id('sul')
     from json_array_elements(public.admin_hierarquia() -> 'pedidos_clube') p where (p ->> 'club_id')::uuid = t.id('clube_b')));
select t.como('lider_b');
select t.eq('diretoria B vê a situação: atual = Região Sul',
  t.txt(format($q$select public.clube_hierarquia_situacao(%L) -> 'atual' ->> 'nome'$q$, t.id('clube_b'))), 'Região Sul 76');

-- ==================== 4) convite FIXO (unidade definida) → ativo ao aceitar ====================
select t.como('admin_h');
select set_config('t76.tok_fixo', public.admin_convite_hierarquia_gerar('coordenador_regional', t.id('norte'), 7, 1, 'Coordenador Regional — Região Norte') ->> 'token', true) is not null;
select t.throws('admin: papel incompatível com a unidade', format($q$select public.admin_convite_hierarquia_gerar('coordenador_distrital', %L)$q$, t.id('norte')), 'vale numa unidade');
reset role;
select t.eq('o token NÃO fica em claro no banco',
  t.n(format($q$select count(*) from public.hierarchy_invites where token_hash = %L$q$, current_setting('t76.tok_fixo'))), 0);
select t.como_anon();
select t.eq('anon: abrir o link mostra papel e unidade',
  t.txt(format($q$select public.convite_hierarquia_abrir(%L) -> 'unidade' ->> 'nome'$q$, current_setting('t76.tok_fixo'))), 'Região Norte 76');
select t.eq('anon: token errado = não encontrado',
  t.txt($q$select public.convite_hierarquia_abrir('deadbeef') ->> 'encontrado'$q$), 'false');
select t.throws('anon: não pode aceitar', format('select public.convite_hierarquia_aceitar(%L)', current_setting('t76.tok_fixo')), 'permission denied');
select t.como('coord_fixo');
select t.eq('coordenador aceita o link fixo → ATIVO',
  t.txt(format($q$select public.convite_hierarquia_aceitar(%L) ->> 'situacao'$q$, current_setting('t76.tok_fixo'))), 'ativo');
select t.como('curioso');
select t.eq('link de uso único já usado: outra pessoa recebe "não encontrado"',
  t.txt(format($q$select public.convite_hierarquia_aceitar(%L) ->> 'encontrado'$q$, current_setting('t76.tok_fixo'))), 'false');

-- ==================== 5) portal: acesso DERIVADO da árvore e só agregado ====================
select t.como('coord_fixo');
select set_config('request.headers', json_build_object('x-escopo-atual', t.id('norte'))::text, true) is not null;
select t.eq('regional Norte: escopo honrado', public.escopo_atual_id(), t.id('norte'));
select t.eq('regional Norte: vê o clube A (Norte › Distrito › A), não o B (Sul)',
  t.txt($q$select string_agg(c ->> 'nome', ',') from json_array_elements(public.escopo_painel()) c$q$),
  current_setting('t76.nome_a'));
select t.eq('isolamento: nada de pontos do clube pela RLS', t.nv('select count(*) from public.pontos'), 0);
select t.eq('isolamento: nada de fotos pela RLS', t.nv('select count(*) from public.fotos'), 0);
select t.eq('isolamento: nada de perfis de membros do clube A pela RLS',
  t.nv(format($q$select count(*) from public.profiles where id = %L$q$, t.id('membro_a'))), 0);
select t.ok('isolamento: o painel não traz nome de pessoa', public.escopo_painel()::text not like '%Membro A%');
select t.throws('regional não é admin', 'select public.admin_hierarquia()', 'Sem permissão');

-- clube novo que entra DEPOIS debaixo do distrito aparece sozinho
reset role;
insert into public.organizational_units (id, type, nome, slug, metadata)
values (public.curriculo_uuid('t76:clube_c'), 'clube', 'Clube C 76', 't76-clube-c', '{"test_only":true}');
insert into t.ids (chave, id) values ('clube_c', public.curriculo_uuid('t76:clube_c'));
select t.como('admin_h');
select public.admin_clube_vincular(t.id('clube_c'), t.id('dist'), 'clube novo') is not null;
select t.como('coord_fixo');
select set_config('request.headers', json_build_object('x-escopo-atual', t.id('norte'))::text, true) is not null;
select t.eq('clube novo debaixo do distrito entra no escopo sem nomear clube a clube',
  t.n('select count(*) from json_array_elements(public.escopo_painel())'), 2);

-- mover o clube A para o Sul corta o acesso NA HORA
select t.como('admin_h');
select public.admin_clube_vincular(t.id('clube_a'), t.id('sul'), 'mudou de região') is not null;
select t.como('coord_fixo');
select set_config('request.headers', json_build_object('x-escopo-atual', t.id('norte'))::text, true) is not null;
select t.eq('clube movido sai do escopo imediatamente',
  t.n($q$select count(*) from json_array_elements(public.escopo_painel()) c where (c ->> 'club_id')::uuid = t.id('clube_a')$q$), 0);

-- remover o vínculo corta tudo
reset role;
select set_config('t76.mid', (select m.id from public.organization_memberships m
  where m.user_id = t.id('coord_fixo') and m.organizational_unit_id = t.id('norte') and m.status = 'ativo')::text, true) is not null;
select t.como('admin_h');
select public.admin_coordenador_remover(current_setting('t76.mid')::uuid, 'fim do mandato') is not null;
select t.como('coord_fixo');
select set_config('request.headers', json_build_object('x-escopo-atual', t.id('norte'))::text, true) is not null;
select t.ok('vínculo removido: escopo deixa de ser honrado', public.escopo_atual_id() is null);
select t.eq('vínculo removido: painel vazio', t.n('select count(*) from json_array_elements(public.escopo_painel())'), 0);

-- ==================== 6) convite GENÉRICO com escolha → pendente até o admin confirmar ====================
select t.como('admin_h');
select set_config('t76.tok_esc', public.admin_convite_hierarquia_gerar('coordenador_distrital', null, 3, 5, 'Coordenador distrital (escolha)') ->> 'token', true) is not null;
select t.como('coord_esc');
select t.ok('abrir o genérico lista os distritos para escolher',
  (select count(*) = 1 from json_array_elements(public.convite_hierarquia_abrir(current_setting('t76.tok_esc')) -> 'opcoes') o
    where (o ->> 'id')::uuid = t.id('dist')));
select t.throws('escolher uma REGIÃO num convite distrital é recusado',
  format('select public.convite_hierarquia_aceitar(%L, %L)', current_setting('t76.tok_esc'), t.id('norte')), 'Unidade inválida');
select t.throws('sem escolher unidade é recusado',
  format('select public.convite_hierarquia_aceitar(%L)', current_setting('t76.tok_esc')), 'Escolha a sua unidade');
select t.eq('aceitar escolhendo o distrito → PENDENTE',
  t.txt(format($q$select public.convite_hierarquia_aceitar(%L, %L) ->> 'situacao'$q$, current_setting('t76.tok_esc'), t.id('dist'))), 'pendente');
select set_config('request.headers', json_build_object('x-escopo-atual', t.id('dist'))::text, true) is not null;
select t.ok('pendente: escopo NÃO é honrado', public.escopo_atual_id() is null);
select t.eq('pendente: painel vazio', t.n('select count(*) from json_array_elements(public.escopo_painel())'), 0);
select t.eq('pendente: nem aparece no contexto institucional',
  t.n($q$select count(*) from jsonb_array_elements(public.meu_contexto_institucional() -> 'escopos')$q$), 0);
select t.como('admin_h');
select t.eq('admin: coordenador pendente aparece nas pendências',
  t.n($q$select count(*) from json_array_elements(public.admin_hierarquia() -> 'coordenadores_pendentes')$q$), 1);
select t.eq('admin confirma',
  t.txt($q$select public.admin_coordenador_decidir((select (p ->> 'membership_id')::uuid from json_array_elements(public.admin_hierarquia() -> 'coordenadores_pendentes') p limit 1), true) ->> 'status'$q$), 'ativo');
select t.como('coord_esc');
select set_config('request.headers', json_build_object('x-escopo-atual', t.id('dist'))::text, true) is not null;
select t.eq('confirmado: distrital vê o clube C (único ainda no distrito)',
  t.txt($q$select string_agg(c ->> 'nome', ',') from json_array_elements(public.escopo_painel()) c$q$), 'Clube C 76');

-- ==================== 7) União: papel novo, mesmo princípio ====================
select t.como('admin_h');
select set_config('t76.tok_uni', public.admin_convite_hierarquia_gerar('diretor_uniao', t.id('uni'), 1, 1) ->> 'token', true) is not null;
select t.como('coord_uni');
select public.convite_hierarquia_aceitar(current_setting('t76.tok_uni')) is not null;
select set_config('request.headers', json_build_object('x-escopo-atual', t.id('uni'))::text, true) is not null;
select t.eq('união: vê os 3 clubes da árvore (A, B, C) — só agregado',
  t.n('select count(*) from json_array_elements(public.escopo_painel())'), 3);
select t.eq('união: nada de pontos pela RLS', t.nv('select count(*) from public.pontos'), 0);
select t.eq('união: investiduras pendentes vazias (nenhuma etapa exige a união)',
  t.n('select count(*) from json_array_elements(public.escopo_investiduras_pendentes())'), 0);
reset role;
select t.throws('papel de união numa região é recusado pelo gatilho',
  format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role) values (%L, %L, 'coordenador_uniao')$q$, t.id('curioso'), t.id('norte')),
  'não é válido');

-- ==================== 8) revogar e expirar ====================
select t.como('admin_h');
select set_config('t76.tok_rev', public.admin_convite_hierarquia_gerar('coordenador_regional', t.id('sul'), 1, 3) ->> 'token', true) is not null;
reset role;
select set_config('t76.rev', (select id from public.hierarchy_invites where token_hash = encode(extensions.digest(current_setting('t76.tok_rev'), 'sha256'), 'hex'))::text, true) is not null;
select t.como('admin_h');
select public.admin_convite_hierarquia_revogar(current_setting('t76.rev')::uuid, 'teste') is not null;
select t.como('curioso');
select t.eq('convite revogado: não encontrado',
  t.txt(format($q$select public.convite_hierarquia_aceitar(%L) ->> 'encontrado'$q$, current_setting('t76.tok_rev'))), 'false');
reset role;
update public.hierarchy_invites set expires_at = now() - interval '1 second', revoked_at = null
 where token_hash = encode(extensions.digest(current_setting('t76.tok_rev'), 'sha256'), 'hex');
select t.como('curioso');
select t.eq('convite expirado: não encontrado',
  t.txt(format($q$select public.convite_hierarquia_abrir(%L) ->> 'encontrado'$q$, current_setting('t76.tok_rev'))), 'false');

-- rate limit por pessoa (10 erros em 10 min)
select public.convite_hierarquia_aceitar('errado' || g) from generate_series(1, 8) g;
select t.throws('rate limit: a 11ª tentativa errada é bloqueada', $q$select public.convite_hierarquia_aceitar('errado-x')$q$, 'Muitas tentativas');

-- ==================== 9) trilha ====================
reset role;
select t.ok('auditoria: pedidos, vínculos e convites registrados',
  (select count(distinct acao) >= 7 from public.platform_admin_audit where acao like 'hierarquia_%'));

select * from t.fim();
rollback;
