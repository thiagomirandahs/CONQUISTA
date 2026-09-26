-- Painel analítico por escopo, visitas da coordenação, papéis do MD e apagar convite inativo
-- (migrations 140, 141 e 142).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin_77', '{"tipo":"fundador","nome":"Admin 77"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin_77'), 'operacao', 'teste 77');
select t.signup('c_dist', '{"tipo":"fundador","nome":"Coord Distrital 77"}'::jsonb);
select t.signup('c_reg', '{"tipo":"fundador","nome":"Coord Regional 77"}'::jsonb);
select t.signup('c_reg1', '{"tipo":"fundador","nome":"Coord Regiao Um 77"}'::jsonb);
select t.signup('c_geral', '{"tipo":"fundador","nome":"Coord Geral 77"}'::jsonb);
select t.signup('c_sec', '{"tipo":"fundador","nome":"Secretaria MD 77"}'::jsonb);
select t.signup('c_assoc', '{"tipo":"fundador","nome":"Associado MD 77"}'::jsonb);
select t.signup('c_dep', '{"tipo":"fundador","nome":"Departamental 77"}'::jsonb);

-- árvore: Associação › (2ª Região › Distritos 1 e 2) + (1ª Região › Distrito 3)
create function t.un(p_chave text, p_tipo text, p_nome text, p_pai text) returns void language plpgsql as $$
begin
  insert into public.organizational_units (id, type, nome, slug, parent_id, metadata)
  values (public.curriculo_uuid('t77:' || p_chave), p_tipo, p_nome,
          case when p_tipo = 'clube' then 't77-' || replace(p_chave, '_', '-') end,
          case when p_pai is not null then t.id(p_pai) end, '{"test_only":true}');
  insert into t.ids (chave, id) values (p_chave, public.curriculo_uuid('t77:' || p_chave));
end $$;
select t.un('campo', 'campo', 'Associação 77', null);
select t.un('r2', 'regiao', '2ª Região 77', 'campo');
select t.un('r1', 'regiao', '1ª Região 77', 'campo');
select t.un('d1', 'distrito', 'Distrito 1 77', 'r2');
select t.un('d2', 'distrito', 'Distrito 2 77', 'r2');
select t.un('d3', 'distrito', 'Distrito 3 77', 'r1');
select t.un('clube_x', 'clube', 'Clube X 77', 'd3');
update public.organizational_units set parent_id = t.id('d1') where id = t.id('clube_a');
update public.organizational_units set parent_id = t.id('d2') where id = t.id('clube_b');

create function t.vinc(p_pessoa text, p_unid text, p_papel text) returns void language sql as $$
  insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
  values (t.id(p_pessoa), t.id(p_unid), p_papel, 'ativo');
$$;
select t.vinc('c_dist', 'd1', 'coordenador_distrital');
select t.vinc('c_reg', 'r2', 'coordenador_regional');
select t.vinc('c_reg1', 'r1', 'coordenador_regional');
select t.vinc('c_geral', 'campo', 'coordenador_geral');

-- quem está logado + escopo pedido (header x-escopo-atual)
create function t.no_escopo(p_pessoa text, p_unid text) returns void language plpgsql as $$
begin
  perform t.como(p_pessoa);
  perform set_config('request.headers', json_build_object('x-escopo-atual', t.id(p_unid))::text, true);
end $$;
create function t.clubes_do_painel(p_filtro uuid default null) returns text language sql as $$
  select coalesce(string_agg(c ->> 'nome', ',' order by c ->> 'nome'), '')
    from json_array_elements(public.escopo_painel_analitico(p_filtro) -> 'clubes') c;
$$;
grant insert, select on t.ids to public;
select set_config('t77.nome_a', (select nome from public.organizational_units where id = t.id('clube_a')), true);
select set_config('t77.nome_b', (select nome from public.organizational_units where id = t.id('clube_b')), true);
\o

-- ==================== B) papéis do MD no campo ====================
select t.permitido('secretário(a) do MD vale no campo', $q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
  values (t.id('c_sec'), t.id('campo'), 'secretario_md', 'ativo')$q$);
select t.permitido('associado(a) do MD vale no campo', $q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
  values (t.id('c_assoc'), t.id('campo'), 'associado_md', 'ativo')$q$);
select t.permitido('departamental vale no campo', $q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
  values (t.id('c_dep'), t.id('campo'), 'departamental_jovem', 'ativo')$q$);
select t.throws('secretário(a) do MD NÃO vale numa região', $q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
  values (t.id('c_sec'), t.id('r2'), 'secretario_md', 'ativo')$q$, 'não é válido');
select t.throws('departamental NÃO vale num clube', $q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
  values (t.id('c_dep'), t.id('clube_a'), 'departamental_jovem', 'ativo')$q$, 'não é válido');
select t.throws('papel inventado continua barrado', $q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
  values (t.id('c_dep'), t.id('campo'), 'secretario_geral', 'ativo')$q$);
select t.eq('papéis do MD só leem agregado (mesmas capacidades do portal)',
  (select bool_and((public._capacidades_institucionais(p) ->> 'ver_painel')::boolean)
     from unnest(array['secretario_md', 'associado_md', 'departamental_jovem']) p), true);
select t.eq('_hier_tipo_do_papel: os três valem no campo',
  (select count(*) from unnest(array['secretario_md', 'associado_md', 'departamental_jovem']) p where public._hier_tipo_do_papel(p) = 'campo'), 3::bigint);
select t.como('admin_77');
select t.ok('admin: gera convite de Secretário(a) do MD para o campo',
  (public.admin_convite_hierarquia_gerar('secretario_md', t.id('campo'), 7, 1, 'Secretaria 77') ->> 'ok')::boolean);
select t.throws('admin: convite de Departamental numa região é recusado',
  format($q$select public.admin_convite_hierarquia_gerar('departamental_jovem', %L)$q$, t.id('r2')), 'vale numa unidade');
select t.como('c_sec');
select t.eq('secretário(a): o escopo aparece no contexto institucional',
  t.n($q$select count(*) from jsonb_array_elements(public.meu_contexto_institucional() -> 'escopos') e where e ->> 'papel' = 'secretario_md'$q$), 1);

-- ==================== C) painel: cada escopo vê EXATAMENTE os clubes certos ====================
select t.no_escopo('c_dist', 'd1');
select t.eq('distrital (Distrito 1): só o clube A', t.clubes_do_painel(), current_setting('t77.nome_a'));
select t.eq('distrital: totais batem com a lista', t.n($q$select (public.escopo_painel_analitico() -> 'totais' ->> 'clubes')::bigint$q$), 1);
select t.no_escopo('c_reg', 'r2');
select t.eq('regional (2ª Região): clubes dos distritos 1 e 2 (A e B), não o X',
  t.clubes_do_painel(), (select string_agg(n, ',' order by n) from unnest(array[current_setting('t77.nome_a'), current_setting('t77.nome_b')]) n));
select t.eq('regional: filtro Distrito 2 → só o B', t.clubes_do_painel(t.id('d2')), current_setting('t77.nome_b'));
select t.eq('regional: lista de filtros traz só os distritos da região',
  t.txt($q$select string_agg(f ->> 'nome', ',' order by f ->> 'nome') from json_array_elements(public.escopo_painel_analitico() -> 'filtros') f$q$),
  'Distrito 1 77,Distrito 2 77');
select t.throws('regional: filtro de distrito de OUTRA região é recusado',
  format('select public.escopo_painel_analitico(%L)', t.id('d3')), 'fora do seu escopo');
select t.no_escopo('c_dist', 'd1');
select t.throws('distrital: filtrar pela região acima dele é recusado',
  format('select public.escopo_painel_analitico(%L)', t.id('r2')), 'fora do seu escopo');
select t.no_escopo('c_reg1', 'r1');
select t.eq('regional da 1ª Região: só o X', t.clubes_do_painel(), 'Clube X 77');
select t.no_escopo('c_geral', 'campo');
select t.eq('coordenador geral: os 3 clubes da Associação', t.n($q$select (public.escopo_painel_analitico() -> 'totais' ->> 'clubes')::bigint$q$), 3);
select t.eq('coordenador geral: filtro 2ª Região → 2 clubes', t.n(format($q$select (public.escopo_painel_analitico(%L) -> 'totais' ->> 'clubes')::bigint$q$, t.id('r2'))), 2);
select t.no_escopo('c_sec', 'campo');
select t.eq('secretário(a) do MD: os 3 clubes', t.n($q$select (public.escopo_painel_analitico() -> 'totais' ->> 'clubes')::bigint$q$), 3);
select t.no_escopo('c_assoc', 'campo');
select t.eq('associado(a) do MD: os 3 clubes', t.n($q$select (public.escopo_painel_analitico() -> 'totais' ->> 'clubes')::bigint$q$), 3);
select t.no_escopo('c_dep', 'campo');
select t.eq('departamental: os 3 clubes', t.n($q$select (public.escopo_painel_analitico() -> 'totais' ->> 'clubes')::bigint$q$), 3);
select t.no_escopo('c_dist', 'r2');
select t.eq('header forjado (distrital pedindo a região) = sem escopo',
  t.txt($q$select public.escopo_painel_analitico() ->> 'sem_escopo'$q$), 'true');
select t.como('lider_a');
select t.eq('diretoria de clube (sem vínculo institucional) = sem escopo',
  t.txt($q$select public.escopo_painel_analitico() ->> 'sem_escopo'$q$), 'true');

-- números agregados conferem com a base (membros ativos sem "pais"; unidades do clube)
select t.no_escopo('c_dist', 'd1');
select set_config('t77.painel', public.escopo_painel_analitico()::text, true) is not null;
reset role;
select t.eq('membros ativos do clube A (sem pais) conferem',
  ((current_setting('t77.painel')::json -> 'clubes' -> 0 -> 'membros' ->> 'total'))::bigint,
  (select count(*) from public.organization_memberships where organizational_unit_id = t.id('clube_a') and status = 'ativo'
      and role <> 'pais' and (ends_at is null or ends_at > now())));
select t.eq('diretoria contada por papel',
  ((current_setting('t77.painel')::json -> 'clubes' -> 0 -> 'membros' -> 'por_papel' ->> 'diretoria'))::bigint,
  (select count(*) from public.organization_memberships where organizational_unit_id = t.id('clube_a') and status = 'ativo' and role = 'diretoria'
      and (ends_at is null or ends_at > now())));
select t.eq('"pais" não entra na contagem por papel',
  (current_setting('t77.painel')::json -> 'clubes' -> 0 -> 'membros' -> 'por_papel' ->> 'pais'), null::text);
select t.eq('unidades do clube A conferem', ((current_setting('t77.painel')::json -> 'clubes' -> 0 ->> 'unidades'))::bigint,
  (select count(*) from public.unidades where club_id = t.id('clube_a')));
select t.ok('distrito/região do clube vêm pelo nome da unidade',
  (current_setting('t77.painel')::json -> 'clubes' -> 0 -> 'distrito' ->> 'nome') = 'Distrito 1 77'
  and (current_setting('t77.painel')::json -> 'clubes' -> 0 -> 'regiao' ->> 'nome') = '2ª Região 77');

-- PRIVACIDADE: nenhum nome/foto de pessoa do clube; nenhum campo sensível
select t.eq('privacidade: nenhum nome de pessoa do clube A aparece no painel',
  (select count(*) from public.organization_memberships m join public.profiles p on p.id = m.user_id
    where m.organizational_unit_id = t.id('clube_a') and length(p.nome) > 3
      and position(p.nome in current_setting('t77.painel')) > 0), 0::bigint);
select t.ok('privacidade: sem chaves de foto/chat/mensagem/evidência/valor/responsável',
  current_setting('t77.painel') !~* '"(foto|fotos|chat|mensagem|mensagens|evidencia\w*|valor|preco|fatura\w*|responsave\w*|email|telefone|nascimento)"\s*:');
select t.ok('portal não recebe nada comercial (assinatura/plano/trial — migration 300)',
  current_setting('t77.painel') !~* '"(cadastro|assinatura\w*|plano\w*|trial\w*|cortesia|valida_ate|cobranca|limite\w*|armazenamento\w*)"\s*:');
select t.no_escopo('c_dist', 'd1');
select t.eq('isolamento: coordenador continua sem ler perfis dos membros pela RLS',
  t.nv(format($q$select count(*) from public.profiles where id = %L$q$, t.id('membro_a'))), 0);
select t.eq('isolamento: coordenador não lê a tabela de visitas direto',
  t.nv('select count(*) from public.club_visits'), 0);

-- clube novo que entra DEPOIS debaixo do Distrito 1 aparece sozinho (para distrital, regional e geral)
reset role;
select t.un('clube_y', 'clube', 'Clube Y 77', 'd1');
select t.no_escopo('c_dist', 'd1');
select t.eq('clube novo no distrito aparece para o distrital', t.n($q$select (public.escopo_painel_analitico() -> 'totais' ->> 'clubes')::bigint$q$), 2);
select t.no_escopo('c_reg', 'r2');
select t.eq('...e para o regional', t.n($q$select (public.escopo_painel_analitico() -> 'totais' ->> 'clubes')::bigint$q$), 3);
select t.no_escopo('c_geral', 'campo');
select t.eq('...e para o geral', t.n($q$select (public.escopo_painel_analitico() -> 'totais' ->> 'clubes')::bigint$q$), 4);

-- ==================== D) visitas ====================
select t.no_escopo('c_dist', 'd1');
select set_config('t77.v1', public.escopo_visita_agendar(t.id('clube_a'), now() + interval '3 days', 'Conhecer a diretoria', 'Chego às 9h') ->> 'id', true) is not null;
select t.throws('distrital: agendar em clube FORA do distrito é recusado',
  format($q$select public.escopo_visita_agendar(%L, now() + interval '3 days', 'Visita')$q$, t.id('clube_b')), 'não está no seu escopo');
select t.throws('distrital: data no passado é recusada',
  format($q$select public.escopo_visita_agendar(%L, now() - interval '3 days', 'Visita')$q$, t.id('clube_a')), 'futuras');
select t.throws('distrital: objetivo vazio é recusado',
  format($q$select public.escopo_visita_agendar(%L, now() + interval '3 days', '  ')$q$, t.id('clube_a')), 'Objetivo');
reset role;
select t.eq('aviso para a liderança do clube A (mecanismo de notificações existente)',
  (select count(*) from public.notificacoes where club_id = t.id('clube_a') and tipo = 'visita' and para = 'lideranca'), 1::bigint);

select t.como('lider_a');
select t.eq('diretoria do clube A vê a visita agendada',
  t.txt(format($q$select public.clube_visitas(%L) -> 0 ->> 'status'$q$, t.id('clube_a'))), 'agendada');
select t.eq('diretoria vê quem agendou (unidade)',
  t.txt(format($q$select public.clube_visitas(%L) -> 0 -> 'agendada_por' -> 'unidade' ->> 'nome'$q$, t.id('clube_a'))), 'Distrito 1 77');
select t.eq('diretoria sugere outra data (continua agendada, com sugestão)',
  t.txt(format($q$select public.clube_visita_responder(%L, false, now() + interval '5 days', 'Sábado é melhor') ->> 'status'$q$, current_setting('t77.v1'))), 'agendada');
select t.throws('diretoria: sugestão sem data é recusada',
  format('select public.clube_visita_responder(%L, false)', current_setting('t77.v1')), 'Sugira');
select t.como('lider_b');
select t.throws('diretoria do clube B não vê visitas do A', format('select public.clube_visitas(%L)', t.id('clube_a')), 'Sem permissão');
select t.throws('diretoria do clube B não responde visita do A',
  format('select public.clube_visita_responder(%L, true)', current_setting('t77.v1')), 'não encontrada');
select t.como('membro_a');
select t.throws('desbravador não vê visitas', format('select public.clube_visitas(%L)', t.id('clube_a')), 'Sem permissão');

select t.no_escopo('c_dist', 'd1');
select t.ok('distrital vê a sugestão do clube',
  (select (v -> 'sugestao' ->> 'para') is not null from json_array_elements(public.escopo_visitas()) v where v ->> 'id' = current_setting('t77.v1')));
select t.eq('distrital reagenda para a data sugerida',
  t.txt(format($q$select public.escopo_visita_atualizar(%L, 'reagendar', now() + interval '5 days') ->> 'status'$q$, current_setting('t77.v1'))), 'agendada');
select t.como('lider_a');
select t.eq('diretoria confirma',
  t.txt(format($q$select public.clube_visita_responder(%L, true) ->> 'status'$q$, current_setting('t77.v1'))), 'confirmada');

-- nível acima vê (sem editar); regional agenda a própria visita, que o distrital NÃO vê
select t.no_escopo('c_reg', 'r2');
select t.eq('regional vê a visita do distrital (nível acima), sem poder editar',
  t.txt(format($q$select v ->> 'pode_editar' from json_array_elements(public.escopo_visitas()) v where v ->> 'id' = %L$q$, current_setting('t77.v1'))), 'false');
select t.throws('regional não altera a visita do distrital',
  format($q$select public.escopo_visita_atualizar(%L, 'cancelar')$q$, current_setting('t77.v1')), 'não encontrada');
select set_config('t77.v2', public.escopo_visita_agendar(t.id('clube_b'), now() + interval '2 hours', 'Visita regional') ->> 'id', true) is not null;
select set_config('t77.v3', public.escopo_visita_agendar(t.id('clube_a'), now() + interval '10 days', 'Visita regional ao A') ->> 'id', true) is not null;
select t.no_escopo('c_dist', 'd1');
select t.eq('distrital NÃO vê visitas agendadas pelo regional (nível acima dele)',
  t.n($q$select count(*) from json_array_elements(public.escopo_visitas())$q$), 1);
select t.no_escopo('c_reg1', 'r1');
select t.eq('regional de outra região não vê nada', t.n($q$select count(*) from json_array_elements(public.escopo_visitas())$q$), 0);
select t.throws('regional de outra região não altera', format($q$select public.escopo_visita_atualizar(%L, 'cancelar')$q$, current_setting('t77.v2')), 'não encontrada');
select t.no_escopo('c_geral', 'campo');
select t.eq('coordenador geral vê as 3 visitas', t.n($q$select count(*) from json_array_elements(public.escopo_visitas())$q$), 3);
select t.eq('painel: próxima visita do clube A aparece',
  t.n($q$select count(*) from json_array_elements(public.escopo_painel_analitico() -> 'clubes') c where c ->> 'proxima_visita' is not null$q$), 2);

-- relatório
select t.no_escopo('c_reg', 'r2');
select t.throws('relatório curto demais é recusado', format($q$select public.escopo_visita_atualizar(%L, 'realizada', null, 'ok')$q$, current_setting('t77.v2')), 'mínimo');
select t.throws('visita que ainda não aconteceu não tem relatório',
  format($q$select public.escopo_visita_atualizar(%L, 'realizada', null, 'Relatório adiantado demais')$q$, current_setting('t77.v3')), 'ainda não aconteceu');
select t.eq('regional registra a visita realizada com relatório',
  t.txt(format($q$select public.escopo_visita_atualizar(%L, 'realizada', null, 'Clube organizado, unidades ativas.') ->> 'status'$q$, current_setting('t77.v2'))), 'realizada');
select t.throws('visita realizada não é reagendada',
  format($q$select public.escopo_visita_atualizar(%L, 'reagendar', now() + interval '1 day')$q$, current_setting('t77.v2')), 'já foi');
select t.eq('regional cancela a visita ao A',
  t.txt(format($q$select public.escopo_visita_atualizar(%L, 'cancelar', null, 'Imprevisto') ->> 'status'$q$, current_setting('t77.v3'))), 'cancelada');
select t.como('lider_b');
select t.eq('diretoria do B lê o relatório', t.txt(format($q$select public.clube_visitas(%L) -> 0 ->> 'relatorio'$q$, t.id('clube_b'))), 'Clube organizado, unidades ativas.');
select t.no_escopo('c_geral', 'campo');
select t.eq('nível acima (geral) lê o relatório',
  t.txt(format($q$select v ->> 'relatorio' from json_array_elements(public.escopo_visitas()) v where v ->> 'id' = %L$q$, current_setting('t77.v2'))),
  'Clube organizado, unidades ativas.');
select t.no_escopo('c_dist', 'd1');
select t.eq('distrital (abaixo do regional) não lê o relatório do regional',
  t.n(format($q$select count(*) from json_array_elements(public.escopo_visitas()) v where v ->> 'id' = %L$q$, current_setting('t77.v2'))), 0);

-- ==================== corte: tirar o coordenador da unidade corta TUDO ====================
reset role;
update public.organization_memberships set status = 'encerrado', ends_at = clock_timestamp()
 where user_id = t.id('c_dist') and organizational_unit_id = t.id('d1');
select t.no_escopo('c_dist', 'd1');
select t.eq('corte: painel volta sem escopo', t.txt($q$select public.escopo_painel_analitico() ->> 'sem_escopo'$q$), 'true');
select t.eq('corte: visitas somem', t.n($q$select count(*) from json_array_elements(public.escopo_visitas())$q$), 0);
select t.throws('corte: não agenda mais', format($q$select public.escopo_visita_agendar(%L, now() + interval '3 days', 'Visita')$q$, t.id('clube_a')), 'Sem permissão');
select t.throws('corte: não altera a própria visita antiga', format($q$select public.escopo_visita_atualizar(%L, 'cancelar')$q$, current_setting('t77.v1')), 'Sem permissão');
-- mover o clube B para fora da 2ª Região corta o regional daquele clube (painel e visitas)
reset role;
update public.organizational_units set parent_id = t.id('d3') where id = t.id('clube_b');
select t.no_escopo('c_reg', 'r2');
select t.eq('clube movido sai do painel do regional', position(current_setting('t77.nome_b') in t.clubes_do_painel()) = 0, true);
select t.eq('...e as visitas dele também', t.n(format($q$select count(*) from json_array_elements(public.escopo_visitas()) v where v ->> 'club_id' = %L$q$, t.id('clube_b'))), 0);

-- anon / sem EXECUTE
reset role;
select t.eq('anon: nenhuma RPC nova tem EXECUTE',
  t.n($q$select count(*) from unnest(array['escopo_painel_analitico(uuid)','escopo_visitas(uuid)','escopo_visita_agendar(uuid,timestamptz,text,text)',
        'escopo_visita_atualizar(uuid,text,timestamptz,text)','clube_visitas(uuid)','clube_visita_responder(uuid,boolean,timestamptz,text)',
        'admin_convite_hierarquia_apagar(uuid,text)','admin_convites_hierarquia_limpar_inativos()']) f
       where has_function_privilege('anon', 'public.' || f, 'execute')$q$), 0);
select t.eq('helpers internos sem EXECUTE para authenticated',
  t.n($q$select count(*) from unnest(array['_escopo_em_uso_com_painel()','_hier_eh_ancestral_ou_igual(uuid,uuid)']) f
       where has_function_privilege('authenticated', 'public.' || f, 'execute')$q$), 0);

-- ==================== A) apagar convite: só inativo, com trilha ====================
select t.como('admin_77');
select set_config('t77.conv_ativo', public.admin_convite_hierarquia_gerar('coordenador_distrital', t.id('d2'), 7, 1, 'Ativo 77') ->> 'id', true) is not null;
select set_config('t77.conv_rev', public.admin_convite_hierarquia_gerar('coordenador_distrital', t.id('d2'), 7, 1, 'Revogado 77') ->> 'id', true) is not null;
select set_config('t77.conv_exp', public.admin_convite_hierarquia_gerar('coordenador_regional', t.id('r1'), 7, 1, 'Expirado 77') ->> 'id', true) is not null;
select t.throws('convite ATIVO não se apaga (só revoga)',
  format('select public.admin_convite_hierarquia_apagar(%L)', current_setting('t77.conv_ativo')), 'Revogue');
select public.admin_convite_hierarquia_revogar(current_setting('t77.conv_rev')::uuid) is not null;
select t.ok('convite revogado se apaga',
  (public.admin_convite_hierarquia_apagar(current_setting('t77.conv_rev')::uuid, 'limpeza') ->> 'situacao') = 'revogado');
select t.eq('apagado some da lista do /admin',
  t.n(format($q$select count(*) from json_array_elements(public.admin_hierarquia() -> 'convites') c where c ->> 'id' = %L$q$, current_setting('t77.conv_rev'))), 0);
select t.eq('apagar de novo não faz nada (idempotente)',
  t.txt(format($q$select public.admin_convite_hierarquia_apagar(%L) ->> 'sem_mudanca'$q$, current_setting('t77.conv_rev'))), 'true');
reset role;
update public.hierarchy_invites set expires_at = now() - interval '1 minute', created_at = created_at - interval '8 days'
 where id = current_setting('t77.conv_exp')::uuid;
select t.como('admin_77');
select t.ok('limpar inativos arquiva pelo menos o expirado',
  (public.admin_convites_hierarquia_limpar_inativos() ->> 'apagados')::int >= 1);
select t.ok('...mantém o ativo na lista e tira o expirado',
  exists (select 1 from json_array_elements(public.admin_hierarquia() -> 'convites') c where c ->> 'id' = current_setting('t77.conv_ativo'))
  and not exists (select 1 from json_array_elements(public.admin_hierarquia() -> 'convites') c where c ->> 'id' = current_setting('t77.conv_exp')));
select t.ok('contador de arquivados no /admin', (public.admin_hierarquia() ->> 'convites_arquivados')::int >= 2);
reset role;
select t.eq('rastro preservado: o convite apagado CONTINUA no banco (arquivado)',
  (select count(*) from public.hierarchy_invites where id in (current_setting('t77.conv_rev')::uuid, current_setting('t77.conv_exp')::uuid)
      and arquivado_em is not null and arquivado_por = t.id('admin_77')), 2::bigint);
select t.eq('rastro no platform_admin_audit (um por convite apagado)',
  (select count(*) from public.platform_admin_audit where acao = 'hierarquia_convite_apagar'
      and alvo_id in (current_setting('t77.conv_rev')::uuid, current_setting('t77.conv_exp')::uuid)), 2::bigint);
select t.eq('convite ativo NÃO foi arquivado pelo "limpar"',
  (select arquivado_em is null from public.hierarchy_invites where id = current_setting('t77.conv_ativo')::uuid), true);
select t.como('lider_a');
select t.throws('não-admin não apaga convite', format('select public.admin_convite_hierarquia_apagar(%L)', current_setting('t77.conv_ativo')), 'Sem permissão');
select t.throws('não-admin não limpa inativos', 'select public.admin_convites_hierarquia_limpar_inativos()', 'Sem permissão');

select t.fim();
rollback;
