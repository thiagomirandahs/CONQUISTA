-- Inscrição pelo link/QR do clube antes de ter conta (migration 104).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.txt($q$select public.clube_codigo_gerar() ->> 'codigo'$q$) as cod_a \gset
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.txt($q$select public.clube_codigo_gerar() ->> 'codigo'$q$) as cod_revogado \gset
select public.clube_codigo_revogar();
select t.txt($q$select public.clube_codigo_gerar(1) ->> 'codigo'$q$) as cod_vencido \gset
reset role;
update public.club_entry_codes set expires_at = now() - interval '1 second' where prefixo = left(:'cod_vencido', 4);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.txt($q$select public.clube_codigo_gerar() ->> 'codigo'$q$) as cod_b \gset
reset role;
select t.signup('novo72', jsonb_build_object('nome', 'Novo Setenta e Dois', 'cargo', 'Desbravador'));
select t.signup('resp72', jsonb_build_object('nome', 'Responsavel Setenta e Dois', 'tipo', 'pais'));
-- cada bloco de tentativas usa uma "origem" (IP repassado pelo gateway) própria
create function t.origem(p text) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', p || ', 10.0.0.1')::text, true);
$$;
\o

-- ==================== 1) sem conta: identidade pública, e só ela ====================
select nome as nome_a from public.organizational_units where id = t.id('clube_a') \gset
select t.como_anon(); select t.origem('203.0.113.1');
select t.eq('sem conta: código válido mostra o nome do clube A',
  t.txt(format($q$select public.entrada_abrir_publico(%L) ->> 'clube'$q$, :'cod_a')), :'nome_a');
select t.eq('sem conta: a resposta traz só identidade pública (nada de id, membros, unidades)',
  t.txt(format($q$select string_agg(k, ',' order by k) from json_object_keys(public.entrada_abrir_publico(%L)) k$q$, :'cod_a')),
  'clube,encontrado,lema,logo_url,sigla');
select t.eq('sem conta: código em minúsculas/espaços também vale (mesma normalização do servidor)',
  t.txt(format($q$select public.entrada_abrir_publico(%L) ->> 'encontrado'$q$, '  ' || lower(:'cod_a') || ' ')), 'true');
select t.eq('inválido, revogado e vencido dão EXATAMENTE a mesma resposta (sem oráculo)',
  t.txt(format($q$select count(distinct r::text) from (values (public.entrada_abrir_publico('ZZZZZZZZZZZZZZZZ')),
          (public.entrada_abrir_publico(%L)), (public.entrada_abrir_publico(%L))) v(r)$q$, :'cod_revogado', :'cod_vencido')), '1');
select t.eq('...e essa resposta é "não encontrado"', t.txt($q$select public.entrada_abrir_publico('ZZZZZZZZZZZZZZZZ') ->> 'encontrado'$q$), 'false');
select t.throws('sem conta NÃO consegue pedir entrada (anon nem tem permissão de executar)',
  format($q$select public.entrada_solicitar(%L)$q$, :'cod_a'), 'permission denied');
select t.throws('sem conta NÃO usa a RPC autenticada de abrir', format($q$select public.entrada_abrir(%L)$q$, :'cod_a'), null);
reset role;
select t.eq('não existe variante que aceite club_id: a única assinatura recebe só o código',
  t.txt($q$select string_agg(pg_get_function_identity_arguments(oid), ' | ') from pg_proc where proname = 'entrada_abrir_publico'$q$), 'p_codigo text');
select t.eq('ninguém lê a tabela de tentativas públicas direto',
  t.n($q$select count(*) from information_schema.table_privileges where table_name = 'entrada_tentativas_publicas' and grantee in ('anon','authenticated')$q$), 0);
-- auditoria 160: inventário do que anon alcança — nenhuma tabela public, e só as 4 RPCs públicas justificadas
select t.eq('anon não tem privilégio em NENHUMA tabela/view de public',
  t.n($q$select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'$q$), 0);
-- vitrine_clubes_publico / vitrine_clube_publico / parceiros_publico (migration 190, revisada na 202): vitrine
-- institucional do site — só devolvem campos PUBLICADOS (clube com aceite, não ocultado; parceiro ativo no
-- período), sem ids internos de pessoas, com rate limit leve por origem (hash do IP) e mesma resposta p/ slug
-- inexistente/oculto (sem oráculo de clube). Decisão de produto; a lista continua fechada, uma por uma.
select t.eq('anon executa só as 7 RPCs públicas (verificar documento, planos, link do clube, convite de coordenação, vitrine de clubes x2, parceiros)',
  t.txt($q$select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')$q$),
  'convite_hierarquia_abrir,documento_verificar,entrada_abrir_publico,parceiros_publico,planos_disponiveis,vitrine_clube_publico,vitrine_clubes_publico');
select t.eq('nenhuma função SECURITY DEFINER de public sem search_path fixo',
  t.n($q$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')$q$), 0);
select t.eq('nenhuma tabela de public sem RLS',
  t.n($q$select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity$q$), 0);

-- ==================== 2) limite: por origem e teto global ====================
select t.como_anon(); select t.origem('198.51.100.7');
do $$ begin for i in 1..10 loop perform public.entrada_abrir_publico('ERRADO' || i); end loop; end $$;
select t.throws('11º erro da mesma origem em 10 min: recusado', $q$select public.entrada_abrir_publico('ERRADO11')$q$, 'Muitas tentativas');
select t.throws('...inclusive com um código VÁLIDO (o bloqueio não vira oráculo)', format($q$select public.entrada_abrir_publico(%L)$q$, :'cod_a'), 'Muitas tentativas');
select t.origem('198.51.100.8');
select t.eq('outra origem continua podendo abrir', t.txt(format($q$select public.entrada_abrir_publico(%L) ->> 'encontrado'$q$, :'cod_a')), 'true');
reset role;
-- auditoria 160: com o IP da borda (cf-connecting-ip) presente, forjar x-forwarded-for NÃO troca de origem
delete from public.entrada_tentativas_publicas;
select t.como_anon();
do $$ begin for i in 1..10 loop
  perform set_config('request.headers', json_build_object('cf-connecting-ip', '198.51.100.50', 'x-forwarded-for', '10.9.' || i || '.1, 10.0.0.1')::text, true);
  perform public.entrada_abrir_publico('ERRADO' || i);
end loop; end $$;
select set_config('request.headers', json_build_object('cf-connecting-ip', '198.51.100.50', 'x-forwarded-for', '10.99.99.99')::text, true) is not null;
select t.throws('forjar x-forwarded-for a cada chamada não escapa do limite por origem (vale o IP da borda)',
  $q$select public.entrada_abrir_publico('ERRADO11')$q$, 'Muitas tentativas');
select set_config('request.headers', json_build_object('cf-connecting-ip', '198.51.100.51', 'x-forwarded-for', '10.99.99.99')::text, true) is not null;
select t.eq('outro IP de borda continua abrindo', t.txt(format($q$select public.entrada_abrir_publico(%L) ->> 'encontrado'$q$, :'cod_a')), 'true');
reset role;
delete from public.entrada_tentativas_publicas;
insert into public.entrada_tentativas_publicas (origem_hash, acertou) select 'forjado-' || g, false from generate_series(1, 300) g;
select t.como_anon(); select t.origem('192.0.2.99');
select t.throws('teto GLOBAL: trocar de IP não libera varredura', format($q$select public.entrada_abrir_publico(%L)$q$, :'cod_a'), 'Muitas tentativas');
reset role;
delete from public.entrada_tentativas_publicas;

-- ==================== 3) conta nova pede entrada: pendente até a aprovação ====================
select t.como('novo72');
select t.eq('conta nova pede entrada no clube A: nasce PENDENTE',
  t.txt(format($q$select public.entrada_solicitar(%L) ->> 'situacao'$q$, :'cod_a')), 'pendente');
reset role;
select t.eq('...como desbravador (o papel do código)', (select role from public.organization_memberships where user_id = t.id('novo72')), 'desbravador');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.ok('a solicitação aparece em Aprovações do clube A', t.txt($q$select public.entradas_pendentes()::text$q$) like '%Novo Setenta e Dois%');
select t.permitido('a diretoria aprova', format($q$select public.vinculo_gerir(%L, p_status := 'ativo')$q$, t.id('novo72')), 0);
reset role;
select t.eq('só depois da aprovação o vínculo fica ativo', (select status from public.organization_memberships where user_id = t.id('novo72')), 'ativo');

-- ==================== 4) responsável pelo mesmo link: entra como responsável ====================
select t.como('resp72');
select t.eq('responsável pede entrada pelo link do clube A', t.txt(format($q$select public.entrada_solicitar(%L) ->> 'papel'$q$, :'cod_a')), 'pais');
reset role;
select t.eq('...e o vínculo nasce como responsável PENDENTE (não como desbravador)',
  (select role || ':' || status from public.organization_memberships where user_id = t.id('resp72') and organizational_unit_id = t.id('clube_a')), 'pais:pendente');
select t.eq('entrar no clube NÃO cria vínculo responsável → filho',
  t.n(format($q$select count(*) from public.responsaveis where responsavel_id = %L$q$, t.id('resp72'))), 0);

-- ==================== 4b) responsável SEM convite: não vê criança, não se promove ====================
select t.como('resp72'); select t.pedir_clube('clube_a');
select t.eq('responsável pendente NÃO vê filho nenhum (meus_filhos vazio)',
  t.txt($q$select coalesce(json_array_length(public.meus_filhos()::json), 0)::text$q$), '0');
select t.eq('...NÃO lê perfis de crianças do clube (só o próprio)', t.n($q$select count(*) from public.profiles where id <> auth.uid()$q$), 0);
select t.eq('...NÃO lê pontos do clube', t.n($q$select count(*) from public.pontos$q$), 0);
select t.eq('...NÃO lê mensalidades do clube', t.n($q$select count(*) from public.mensalidades$q$), 0);
select t.bloqueado('...NÃO se ativa sozinho (update no próprio vínculo)',
  format($q$update public.organization_memberships set status = 'ativo' where user_id = %L$q$, t.id('resp72')));
select t.bloqueado('...NÃO se promove a diretoria (update de papel)',
  format($q$update public.organization_memberships set role = 'diretoria' where user_id = %L$q$, t.id('resp72')));
select t.bloqueado('...NÃO cria vínculo escolhendo club_id (insert direto)',
  format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (%L, %L, 'pais', 'ativo')$q$, t.id('resp72'), t.id('clube_b')));
select t.bloqueado('...NÃO se declara responsável de uma criança (insert direto em responsaveis)',
  format($q$insert into public.responsaveis (responsavel_id, desbravador_id, status, club_id) values (%L, %L, 'aprovado', %L)$q$, t.id('resp72'), t.id('membro_a'), t.id('clube_a')));
select t.throws('...NÃO usa a vitrine de admin', $q$select public.admin_clubes_listar()$q$, 'Sem permissão');
reset role;
select t.eq('depois de tudo isso: continua 1 vínculo, pais e PENDENTE, e 0 filhos',
  (select count(*)::text || ':' || min(role) || ':' || min(status) from public.organization_memberships where user_id = t.id('resp72'))
  || ':' || (select count(*) from public.responsaveis where responsavel_id = t.id('resp72'))::text, '1:pais:pendente:0');
select t.eq('ser responsável não é admin da plataforma', (select count(*) from public.platform_admins where user_id = t.id('resp72')), 0);

-- ==================== 5) multiclube: mesma identidade, novo vínculo ====================
select t.como('membro_a');
select t.eq('membro do clube A usa o link do clube B: pedido pendente em B',
  t.txt(format($q$select public.entrada_solicitar(%L) ->> 'situacao'$q$, :'cod_b')), 'pendente');
reset role;
select t.eq('mesma conta (1 auth.users) e mesmo perfil (1 profiles)',
  (select count(*) from auth.users where id = t.id('membro_a')) + (select count(*) from public.profiles where id = t.id('membro_a')), 2);
select t.eq('o vínculo com o clube A continua ativo e intacto',
  (select status from public.organization_memberships where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_a')), 'ativo');
select t.eq('...e existe um vínculo NOVO, pendente, em B',
  (select status from public.organization_memberships where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_b')), 'pendente');

-- ==================== 6) quem administra as inscrições ====================
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.throws('desbravador NÃO gera código', $q$select public.clube_codigo_gerar()$q$, 'Sem permissão');
reset role;
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.throws('responsável NÃO gera código', $q$select public.clube_codigo_gerar()$q$, 'Sem permissão');
reset role;

select * from t.fim();
rollback;
