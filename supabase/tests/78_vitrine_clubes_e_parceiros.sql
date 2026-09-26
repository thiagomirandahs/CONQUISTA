-- Migration 190: vitrine do site — cartão de visita do clube (opt-in) e parceiros (período de exibição).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin78', '{"tipo":"fundador","nome":"Admin 78"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin78'), 'operacao', 'teste 78');
\o

-- ==================== 0) nasce tudo desligado ====================
select t.eq('nenhum cartão criado pela migration (Tenant 001 e demais desligados)', t.n('select count(*) from public.club_showcase'), 0);
select t.como_anon();
select t.eq('anon: vitrine vazia', t.txt('select public.vitrine_clubes_publico()::text'), '[]');
select t.eq('anon: Tenant 001 não aparece pelo slug',
  t.txt($q$select public.vitrine_clube_publico('filhos-da-conquista') ->> 'encontrado'$q$), 'false');
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
select t.eq('rascunho desligado não aparece', t.txt('select public.vitrine_clubes_publico()::text'), '[]');
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
select t.eq('anon vê 1 clube', t.n('select jsonb_array_length(public.vitrine_clubes_publico())'), 1);
select t.eq('lista não traz contato', t.n($q$select count(*) from jsonb_array_elements(public.vitrine_clubes_publico()) e where e ? 'whatsapp' or e ? 'email' or e ? 'diretor_nome'$q$), 0);
select t.eq('detalhe: WhatsApp publicado', t.txt($q$select public.vitrine_clube_publico('filhos-da-conquista') ->> 'whatsapp'$q$), '5581999998888');
select t.ok('detalhe: nome e e-mail NÃO publicados não saem',
  not (public.vitrine_clube_publico('filhos-da-conquista') ?| array['diretor_nome', 'email']));
select t.ok('nenhum dado interno (membros, contagem, ids) no cartão',
  not (public.vitrine_clube_publico('filhos-da-conquista') ?| array['club_id', 'membros', 'total_membros', 'unidades', 'aceite_por', 'oculto_motivo', 'diretor_email']));
select t.eq('reunião publicada', t.txt($q$select public.vitrine_clube_publico('filhos-da-conquista') ->> 'reuniao_local'$q$), 'Igreja Central');
select t.eq('clube B (sem opt-in) invisível pelo slug', t.txt($q$select public.vitrine_clube_publico('clube-b-teste') ->> 'encontrado'$q$), 'false');
reset role;

-- ==================== 2) admin modera ====================
select t.como('lider_a');
select t.throws('diretoria não modera', format($q$select public.admin_vitrine_clube_moderar(%L, true, 'x')$q$, t.id('clube_a')), 'Sem permissão');
select t.como('admin78');
select t.throws('ocultar sem motivo recusado', format($q$select public.admin_vitrine_clube_moderar(%L, true, '')$q$, t.id('clube_a')), 'motivo');
select public.admin_vitrine_clube_moderar(t.id('clube_a'), true, 'Conteúdo impróprio');
select t.eq('admin lista o cartão como não visível', t.txt($q$select public.admin_vitrine_clubes_listar() -> 0 ->> 'visivel'$q$), 'false');
select t.como_anon();
select t.eq('ocultado some da vitrine', t.txt('select public.vitrine_clubes_publico()::text'), '[]');
select t.eq('ocultado some pelo slug', t.txt($q$select public.vitrine_clube_publico('filhos-da-conquista') ->> 'encontrado'$q$), 'false');
-- diretoria salvando de novo não desfaz a moderação
select t.como('lider_a');
select public.vitrine_clube_salvar(t.id('clube_a'), '{"ativo":true,"aceite_contato":true,"publicar_whatsapp":true,"diretor_whatsapp":"81999998888"}'::jsonb) is not null;
select t.como_anon();
select t.eq('diretoria não desfaz a moderação', t.n('select jsonb_array_length(public.vitrine_clubes_publico())'), 0);
select t.como('admin78');
select public.admin_vitrine_clube_moderar(t.id('clube_a'), false);
select t.como_anon();
select t.eq('reexibido pelo admin', t.n('select jsonb_array_length(public.vitrine_clubes_publico())'), 1);
reset role;
select t.ok('moderação auditada', exists (select 1 from public.platform_admin_audit where acao = 'vitrine_ocultar'));
-- desligar = sair na hora
select t.como('lider_a');
select public.vitrine_clube_salvar(t.id('clube_a'), '{"ativo":false}'::jsonb) is not null;
select t.como_anon();
select t.eq('desligado pela diretoria some', t.n('select jsonb_array_length(public.vitrine_clubes_publico())'), 0);
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
