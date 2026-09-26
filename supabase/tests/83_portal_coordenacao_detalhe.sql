-- Portal da coordenação (migration 300): painel sem informação comercial + página do clube
-- (escopo_clube_detalhe) com a mesma checagem de escopo pela árvore.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('c83_dist', '{"tipo":"fundador","nome":"Coord Distrital 83"}'::jsonb);
select t.signup('c83_outro', '{"tipo":"fundador","nome":"Coord Outro 83"}'::jsonb);
create function t.un83(p_chave text, p_tipo text, p_nome text, p_pai text) returns void language plpgsql as $$
begin
  insert into public.organizational_units (id, type, nome, slug, parent_id, metadata)
  values (public.curriculo_uuid('t83:' || p_chave), p_tipo, p_nome,
          case when p_tipo = 'clube' then 't83-' || replace(p_chave, '_', '-') end,
          case when p_pai is not null then t.id(p_pai) end, '{"test_only":true}');
  insert into t.ids (chave, id) values (p_chave, public.curriculo_uuid('t83:' || p_chave));
end $$;
select t.un83('campo83', 'campo', 'Associação 83', null);
select t.un83('r83', 'regiao', 'Região 83', 'campo83');
select t.un83('d83', 'distrito', 'Distrito 83', 'r83');
select t.un83('d83b', 'distrito', 'Distrito 83 B', 'r83');
update public.organizational_units set parent_id = t.id('d83'),
       metadata = coalesce(metadata, '{}'::jsonb) || '{"marca":{"logo_url":"https://x.test/logo.png","sigla":"CA","cor_primaria":"#112233"}}'
 where id = t.id('clube_a');
update public.organizational_units set parent_id = t.id('d83b') where id = t.id('clube_b');
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('c83_dist'), t.id('d83'), 'coordenador_distrital', 'ativo'),
       (t.id('c83_outro'), t.id('d83b'), 'coordenador_distrital', 'ativo');
-- chamada (Apontamento) de hoje no clube A: 1 presente, 1 falta
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id, data, marca)
values (t.id('membro_a'), 'apontamento', 5, 'chamada 83', t.id('clube_a'), now(), '{"presenca":"naHora"}'),
       (t.id('lider_a'), 'apontamento', 0, 'chamada 83', t.id('clube_a'), now(), '{"presenca":"faltou"}');
-- evento da agenda do clube A (título NÃO pode sair no portal)
insert into public.eventos (titulo, data, local, descricao, club_id)
values ('Acampamento secreto 83', (now() at time zone 'America/Sao_Paulo')::date + 5, 'Sítio 83', 'Descrição 83', t.id('clube_a'));
create function t.no_escopo83(p_pessoa text, p_unid text) returns void language plpgsql as $$
begin
  perform t.como(p_pessoa);
  perform set_config('request.headers', json_build_object('x-escopo-atual', t.id(p_unid))::text, true);
end $$;
grant insert, select on t.ids to public;
\o

-- ==================== painel: nada comercial ====================
select t.no_escopo83('c83_dist', 'd83');
select set_config('t83.painel', public.escopo_painel_analitico()::text, true) is not null;
select t.ok('painel: nenhum campo comercial (assinatura/plano/trial/cobrança/limite/armazenamento)',
  current_setting('t83.painel') !~* '"(cadastro|assinatura\w*|plano\w*|trial\w*|cortesia|valida_ate|cobranca|limite\w*|armazenamento\w*|provider|ciclo)"\s*:');
select t.eq('painel: a marca (logo) do clube vem', current_setting('t83.painel')::json -> 'clubes' -> 0 -> 'marca' ->> 'logo_url', 'https://x.test/logo.png');
select t.eq('painel: presença média dos últimos 30 dias (1 de 2)',
  (current_setting('t83.painel')::json -> 'clubes' -> 0 -> 'presenca' ->> 'media_pct_30d')::int, 50);
select t.ok('painel: totais com destaques', (current_setting('t83.painel')::json -> 'totais') ->> 'clubes_sem_atividade_14d' is not null
  and (current_setting('t83.painel')::json -> 'totais') ->> 'investiduras_mes' is not null);

-- ==================== detalhe do clube ====================
select set_config('t83.det', public.escopo_clube_detalhe(t.id('clube_a'))::text, true) is not null;
reset role;
select t.eq('detalhe: nome do clube', current_setting('t83.det')::json -> 'clube' ->> 'nome',
  (select nome from public.organizational_units where id = t.id('clube_a')));
select t.eq('detalhe: distrito pelo nome', current_setting('t83.det')::json -> 'clube' -> 'distrito' ->> 'nome', 'Distrito 83');
select t.eq('detalhe: membros ativos (sem pais) conferem',
  (current_setting('t83.det')::json -> 'membros' ->> 'total')::bigint,
  (select count(*) from public.organization_memberships where organizational_unit_id = t.id('clube_a') and status = 'ativo'
      and role <> 'pais' and starts_at <= now() and (ends_at is null or ends_at > now())));
select t.eq('detalhe: unidades do clube (quantidade)',
  (select count(*) from json_array_elements(current_setting('t83.det')::json -> 'unidades'))::bigint,
  (select count(*) from public.unidades where club_id = t.id('clube_a')));
select t.eq('detalhe: presença do dia = 50%',
  (current_setting('t83.det')::json -> 'presenca' -> 'reunioes' -> 0 ->> 'pct')::int, 50);
select t.ok('detalhe: agenda só com data e contagem',
  (current_setting('t83.det')::json -> 'agenda' ->> 'proximo_evento') is not null
  and (current_setting('t83.det')::json -> 'agenda' ->> 'eventos_30d')::int >= 1);
select t.ok('detalhe: título/local/descrição do evento NÃO saem',
  position('secreto 83' in current_setting('t83.det')) = 0 and position('Sítio 83' in current_setting('t83.det')) = 0
  and position('Descrição 83' in current_setting('t83.det')) = 0);
select t.ok('detalhe: nenhum campo comercial nem sensível',
  current_setting('t83.det') !~* '"(assinatura\w*|plano\w*|trial\w*|cortesia|cobranca|limite\w*|armazenamento\w*|foto|fotos|chat|mensagem|mensagens|evidencia\w*|valor\w*|preco|fatura\w*|responsave\w*|email|telefone|nascimento|caixa|motivo|oracao|titulo|descricao|local)"\s*:');
select t.eq('detalhe: nenhum nome de pessoa do clube A aparece',
  (select count(*) from public.organization_memberships m join public.profiles p on p.id = m.user_id
    where m.organizational_unit_id = t.id('clube_a') and length(p.nome) > 3
      and position(p.nome in current_setting('t83.det')) > 0), 0::bigint);

-- ==================== escopo: fora = inexistente ====================
select t.no_escopo83('c83_dist', 'd83');
select t.throws('detalhe de clube FORA do escopo é recusado',
  format('select public.escopo_clube_detalhe(%L)', t.id('clube_b')), 'Clube não encontrado');
select t.throws('clube inexistente: MESMA resposta',
  format('select public.escopo_clube_detalhe(%L)', gen_random_uuid()), 'Clube não encontrado');
select t.throws('unidade não-clube dentro do escopo também não abre',
  format('select public.escopo_clube_detalhe(%L)', t.id('d83')), 'Clube não encontrado');
select t.no_escopo83('c83_outro', 'd83b');
select t.throws('coordenador do outro distrito não abre o clube A',
  format('select public.escopo_clube_detalhe(%L)', t.id('clube_a')), 'Clube não encontrado');
select t.no_escopo83('c83_outro', 'd83');
select t.throws('header forjado (escopo sem vínculo) = sem permissão',
  format('select public.escopo_clube_detalhe(%L)', t.id('clube_a')), 'Sem permissão');
select t.como('lider_a');
select t.throws('diretoria do clube (sem vínculo institucional) não usa a RPC do portal',
  format('select public.escopo_clube_detalhe(%L)', t.id('clube_a')), 'Sem permissão');

reset role;
select t.eq('anon sem EXECUTE no detalhe', has_function_privilege('anon', 'public.escopo_clube_detalhe(uuid)', 'execute'), false);
select t.eq('helper de presença sem EXECUTE para authenticated',
  has_function_privilege('authenticated', 'public._apontamento_presente(jsonb,numeric)', 'execute'), false);

select t.fim();
rollback;
