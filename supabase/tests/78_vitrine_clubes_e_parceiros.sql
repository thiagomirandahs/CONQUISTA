-- Migration 190: vitrine do site — cartão de visita do clube e parceiros (período de exibição).
-- Contrato ATUAL (migration 203, decisão do dono em 26/09): TODO clube ativo aparece na vitrine
-- automaticamente, só com dados INSTITUCIONAIS; CONTATOS/nome do diretor/apresentação continuam
-- OPT-IN (LGPD); a diretoria pode OCULTAR o próprio clube; o admin modera. (Até 28/09 este teste
-- ainda esperava o opt-in do CLUBE da 190 — regra substituída pela 203, não reintroduzir.)
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin78', '{"tipo":"fundador","nome":"Admin 78"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin78'), 'operacao', 'teste 78');
\o
-- o clube está na lista pública?
create function t.na_vitrine(p_slug text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(public.vitrine_clubes_publico()) e where e ->> 'slug' = p_slug);
$$;
select count(*) as n_listaveis from public.organizational_units
 where type = 'clube' and status = 'ativo' and slug is not null \gset

-- ==================== 0) todo clube ativo aparece, sem cartão e sem contato ====================
select t.eq('nenhum cartão criado pela migration (os contatos nascem desligados)', t.n('select count(*) from public.club_showcase'), 0);
select t.como_anon();
select t.eq('anon: TODO clube ativo aparece automaticamente', t.n('select jsonb_array_length(public.vitrine_clubes_publico())'), :n_listaveis);
select t.eq('anon: Tenant 001 aparece pelo slug',
  t.txt($q$select public.vitrine_clube_publico('filhos-da-conquista') ->> 'encontrado'$q$), 'true');
select t.eq('anon: sem cartão, nenhum contato nem apresentação sai',
  t.n($q$select count(*) from jsonb_array_elements(public.vitrine_clubes_publico()) e
        where e ?| array['whatsapp', 'email', 'diretor_nome', 'apresentacao', 'reuniao_local', 'link_inscricao']$q$), 0);
select t.throws('anon: SELECT direto no cartão negado', 'select * from public.club_showcase');
select t.throws('anon: SELECT direto nos parceiros negado', 'select * from public.site_partners');
select t.throws('anon: não salva cartão', format($q$select public.vitrine_clube_salvar(%L, '{}'::jsonb)$q$, t.id('clube_a')));
select t.throws('anon: não lista admin', 'select public.admin_parceiros_listar()');
reset role;
select t.ok('anon sem EXECUTE nas RPCs de escrita/admin',
  not has_function_privilege('anon', 'public.vitrine_clube_salvar(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.admin_parceiro_salvar(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.admin_vitrine_clube_moderar(uuid, boolean, text)', 'execute')
  and not has_function_privilege('authenticated', 'public._vitrine_registrar_acesso()', 'execute'));

-- ==================== 1) só a diretoria edita ====================
select t.como('membro_a');
select t.throws('desbravador não edita o cartão', format($q$select public.vitrine_clube_salvar(%L, '{"ativo":false}'::jsonb)$q$, t.id('clube_a')), 'Sem permissão');
select t.throws('desbravador não lê o rascunho', format($q$select public.vitrine_clube_ler(%L)$q$, t.id('clube_a')), 'Sem permissão');
select t.como('pais_a');
select t.throws('responsável não edita', format($q$select public.vitrine_clube_salvar(%L, '{}'::jsonb)$q$, t.id('clube_a')), 'Sem permissão');
select t.como('lider_b');
select t.throws('diretoria de OUTRO clube não edita', format($q$select public.vitrine_clube_salvar(%L, '{}'::jsonb)$q$, t.id('clube_a')), 'Sem permissão');

-- opt-in obrigatório
select t.como('lider_a');
select t.throws('ativar sem aceite recusado',
  format($q$select public.vitrine_clube_salvar(%L, '{"ativo":true,"publicar_whatsapp":true,"diretor_whatsapp":"81999998888"}'::jsonb)$q$, t.id('clube_a')), 'aceitar');
select t.throws('ativar sem nenhum contato publicado recusado',
  format($q$select public.vitrine_clube_salvar(%L, '{"ativo":true,"aceite_contato":true}'::jsonb)$q$, t.id('clube_a')), 'ao menos um contato');
select t.throws('publicar WhatsApp vazio recusado',
  format($q$select public.vitrine_clube_salvar(%L, '{"publicar_whatsapp":true}'::jsonb)$q$, t.id('clube_a')), 'WhatsApp');
select t.throws('link javascript: recusado',
  format($q$select public.vitrine_clube_salvar(%L, '{"link_inscricao":"javascript:alert(1)"}'::jsonb)$q$, t.id('clube_a')), 'https');
-- rascunho (desligado) salvo: continua invisível
select t.permitido('rascunho desligado salvo', format($q$select public.vitrine_clube_salvar(%L, '{
  "ativo":false,"aceite_contato":false,"cidade":"Recife","estado":"pe","apresentacao":"Clube de teste",
  "diretor_nome":"Diretor Secreto","diretor_whatsapp":"(81) 99999-8888","diretor_email":"dir@exemplo.com"}'::jsonb)$q$, t.id('clube_a')));
select t.como_anon();
select t.ok('rascunho desligado: o clube continua na lista (institucional)', t.na_vitrine('filhos-da-conquista'));
select t.ok('rascunho desligado: nenhum contato, nome do diretor ou apresentação sai',
  not (public.vitrine_clube_publico('filhos-da-conquista') ?| array['whatsapp', 'email', 'diretor_nome', 'apresentacao']));
-- liga: publica WhatsApp, NÃO publica nome nem e-mail
select t.como('lider_a');
select t.permitido('cartão ligado', format($q$select public.vitrine_clube_salvar(%L, '{
  "ativo":true,"aceite_contato":true,"cidade":"Recife","estado":"PE","apresentacao":"Clube de teste",
  "reuniao_dia":"Domingo","reuniao_horario":"8h","reuniao_local":"Igreja Central",
  "diretor_nome":"Diretor Secreto","diretor_whatsapp":"(81) 99999-8888","diretor_email":"dir@exemplo.com",
  "publicar_whatsapp":true,"link_inscricao":"https://app.desbravaclube.com.br/entrar?codigo=X"}'::jsonb)$q$, t.id('clube_a')));
reset role;
select t.eq('WhatsApp normalizado com DDI', t.txt($q$select diretor_whatsapp from public.club_showcase where club_id = t.id('clube_a')$q$), '5581999998888');
select t.ok('aceite registrado com data e autor', (select aceite_em is not null and aceite_por = t.id('lider_a') from public.club_showcase where club_id = t.id('clube_a')));

select t.como_anon();
select t.eq('ligar o cartão não muda quantos clubes aparecem', t.n('select jsonb_array_length(public.vitrine_clubes_publico())'), :n_listaveis);
select t.eq('lista não traz contato', t.n($q$select count(*) from jsonb_array_elements(public.vitrine_clubes_publico()) e where e ? 'whatsapp' or e ? 'email' or e ? 'diretor_nome'$q$), 0);
select t.eq('detalhe: WhatsApp publicado', t.txt($q$select public.vitrine_clube_publico('filhos-da-conquista') ->> 'whatsapp'$q$), '5581999998888');
select t.ok('detalhe: nome e e-mail NÃO publicados não saem',
  not (public.vitrine_clube_publico('filhos-da-conquista') ?| array['diretor_nome', 'email']));
select t.ok('nenhum dado interno (membros, contagem, ids) no cartão',
  not (public.vitrine_clube_publico('filhos-da-conquista') ?| array['club_id', 'membros', 'total_membros', 'unidades', 'aceite_por', 'oculto_motivo', 'diretor_email']));
select t.eq('reunião publicada', t.txt($q$select public.vitrine_clube_publico('filhos-da-conquista') ->> 'reuniao_local'$q$), 'Igreja Central');
select t.eq('clube B (sem cartão) aparece pelo slug', t.txt($q$select public.vitrine_clube_publico('clube-b-teste') ->> 'encontrado'$q$), 'true');
select t.ok('...mas sem nenhum contato (opt-in é do contato, não do clube)',
  not (public.vitrine_clube_publico('clube-b-teste') ?| array['whatsapp', 'email', 'diretor_nome', 'apresentacao']));
reset role;

-- ==================== 2) admin modera ====================
select t.como('lider_a');
select t.throws('diretoria não modera', format($q$select public.admin_vitrine_clube_moderar(%L, true, 'x')$q$, t.id('clube_a')), 'Sem permissão');
select t.como('admin78');
select t.throws('ocultar sem motivo recusado', format($q$select public.admin_vitrine_clube_moderar(%L, true, '')$q$, t.id('clube_a')), 'motivo');
select public.admin_vitrine_clube_moderar(t.id('clube_a'), true, 'Conteúdo impróprio');
select t.eq('admin lista o clube A como não visível',
  t.txt($q$select e ->> 'visivel' from jsonb_array_elements(public.admin_vitrine_clubes_listar()) e where e ->> 'club_id' = t.id('clube_a')::text$q$), 'false');
select t.como_anon();
select t.ok('ocultado some da vitrine', not t.na_vitrine('filhos-da-conquista'));
select t.ok('...e só ele (os outros clubes continuam)', t.na_vitrine('clube-b-teste'));
select t.eq('ocultado some pelo slug', t.txt($q$select public.vitrine_clube_publico('filhos-da-conquista') ->> 'encontrado'$q$), 'false');
-- diretoria salvando de novo não desfaz a moderação
select t.como('lider_a');
select public.vitrine_clube_salvar(t.id('clube_a'), '{"ativo":true,"aceite_contato":true,"publicar_whatsapp":true,"diretor_whatsapp":"81999998888"}'::jsonb) is not null;
select t.como_anon();
select t.ok('diretoria não desfaz a moderação', not t.na_vitrine('filhos-da-conquista'));
select t.como('lider_a');
select public.vitrine_clube_ocultar(t.id('clube_a'), false) is not null;
select t.como_anon();
select t.ok('...nem pelo "voltar a mostrar" dela', not t.na_vitrine('filhos-da-conquista'));
select t.como('admin78');
select public.admin_vitrine_clube_moderar(t.id('clube_a'), false);
select t.como_anon();
select t.ok('reexibido pelo admin', t.na_vitrine('filhos-da-conquista'));
reset role;
select t.ok('moderação auditada', exists (select 1 from public.platform_admin_audit where acao = 'vitrine_ocultar'));
-- desligar o cartão = os CONTATOS saem na hora (o clube continua, institucional)
select t.como('lider_a');
select public.vitrine_clube_salvar(t.id('clube_a'), '{"ativo":false}'::jsonb) is not null;
select t.como_anon();
select t.ok('cartão desligado: WhatsApp sai na hora', not (public.vitrine_clube_publico('filhos-da-conquista') ? 'whatsapp'));
select t.ok('cartão desligado: o clube continua na lista', t.na_vitrine('filhos-da-conquista'));
-- ocultar o clube é outra ação, só da diretoria DELE
select t.como('membro_a');
select t.throws('desbravador não oculta o clube', format($q$select public.vitrine_clube_ocultar(%L, true)$q$, t.id('clube_a')), 'sem permissão');
select t.como('lider_b');
select t.throws('diretoria de OUTRO clube não oculta', format($q$select public.vitrine_clube_ocultar(%L, true)$q$, t.id('clube_a')), 'sem permissão');
select t.como('lider_a');
select t.permitido('diretoria oculta o próprio clube', format($q$select public.vitrine_clube_ocultar(%L, true)$q$, t.id('clube_a')));
select t.como_anon();
select t.ok('ocultado pela diretoria some da lista', not t.na_vitrine('filhos-da-conquista'));
select t.eq('...e pelo slug (mesma resposta de inexistente)', t.txt($q$select public.vitrine_clube_publico('filhos-da-conquista') ->> 'encontrado'$q$), 'false');
select t.ok('...sem levar os outros clubes junto', t.na_vitrine('clube-b-teste'));
select t.como('lider_a');
select public.vitrine_clube_ocultar(t.id('clube_a'), false) is not null;
select t.como_anon();
select t.ok('a diretoria volta a mostrar', t.na_vitrine('filhos-da-conquista'));
reset role;
select t.throws('trava estrutural: ativo sem aceite', $q$update public.club_showcase set ativo = true, aceite_contato = false$q$, 'club_showcase_opt_in');

-- ==================== 3) parceiros ====================
select t.como('lider_a');
select t.throws('diretoria não cadastra parceiro', $q$select public.admin_parceiro_salvar(null, '{"nome":"X","link":"https://x.com"}'::jsonb)$q$, 'Sem permissão');
select t.como('admin78');
select t.throws('parceiro sem link nem WhatsApp recusado', $q$select public.admin_parceiro_salvar(null, '{"nome":"X"}'::jsonb)$q$, 'link');
select t.throws('link não-http recusado', $q$select public.admin_parceiro_salvar(null, '{"nome":"X","link":"ftp://x.com"}'::jsonb)$q$, 'https');
select t.throws('logo de fora do bucket recusada',
  $q$select public.admin_parceiro_salvar(null, '{"nome":"X","link":"https://x.com","logo_url":"https://evil.com/a.png"}'::jsonb)$q$, 'bucket');
select public.admin_parceiro_salvar(null, '{"nome":"No ar","link":"https://loja.com.br","categoria":"Loja","destaque":true}'::jsonb) is not null;
select public.admin_parceiro_salvar(null, jsonb_build_object('nome','Futuro','whatsapp','81988887777','inicio', now() + interval '2 days')) is not null;
select public.admin_parceiro_salvar(null, jsonb_build_object('nome','Vencido','link','https://a.com','inicio', now() - interval '10 days','fim', now() - interval '1 day')) is not null;
select public.admin_parceiro_salvar(null, '{"nome":"Inativo","link":"https://b.com","ativo":false}'::jsonb) is not null;
select public.admin_parceiro_salvar(null, '{"nome":"Com logo","link":"https://c.com","logo_url":"https://proj.supabase.co/storage/v1/object/public/parceiros/c.png"}'::jsonb) is not null;
select t.eq('admin vê todos', t.n('select jsonb_array_length(public.admin_parceiros_listar())'), 5);
select t.como_anon();
select t.eq('anon: só os no ar (fora do período e inativo não aparecem)',
  t.txt($q$select string_agg(e ->> 'nome', ',') from jsonb_array_elements(public.parceiros_publico()) e$q$), 'No ar,Com logo');
reset role;

-- ==================== 4) rate limit leve ====================
insert into public.vitrine_acessos_publicos (origem_hash, quando)
select public._entrada_origem(), now() from generate_series(1, 130);
select t.como_anon();
select t.throws('muitas consultas da mesma origem: bloqueado', 'select public.parceiros_publico()', 'Muitas consultas');
reset role;

select t.fim();
rollback;
