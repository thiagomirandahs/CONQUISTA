-- Camada de produto multi-clube (migration 33): o app passa a saber, por SESSÃO, em quais clubes a pessoa está, qual o papel dela em cada
-- um, qual a unidade, a marca (branding) e os recursos ligados — tudo numa chamada só, `meu_contexto()`.
--   * `meu_contexto()`: só os vínculos DA PRÓPRIA pessoa (nunca de outro clube), com papel/status/unidade/marca/recursos;
--   * marca por clube (`clube_marca_gravar`): só a liderança do clube grava, valida cor/texto/logo (a logo só pode ser do bucket
--     `publico`, na pasta DO CLUBE) e nunca mexe na marca de outro clube;
--   * recursos por clube (`recurso_definir`): catálogo da plataforma + escolha do clube; padrão do catálogo quando o clube nunca escolheu;
--   * o Tenant 001 (clube legado) mantém exatamente a marca e os recursos de sempre.
-- Clube A = Tenant 001 (legado); clube B = Tenant 002 (teste). Asserts espelhados.
begin;
\ir _lib.sql
\ir _fixtures.sql

create function t.ctx(p_caminho text) returns text language sql as $$
  select t.txt(format('select (public.meu_contexto()%s)::text', p_caminho));
$$;

-- pessoas extras (como postgres): cadastro pendente e uma conta SEM nenhum vínculo
select t.mk('pend_a', 'Pend A', 'desbravador', 'pendente', 'clube_a', 'A1');
set local session_replication_role = replica;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
values ('00000000-0000-0000-0000-000000000000', md5('cq-test:sem_vinculo')::uuid, 'authenticated', 'authenticated', 'sem_vinculo@teste.local',
  extensions.crypt('x', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', '', '', '', false, false);
insert into public.profiles (id, nome, papel, status) values (md5('cq-test:sem_vinculo')::uuid, 'Sem Vinculo', 'desbravador', 'ativo');
set local session_replication_role = origin;
insert into t.ids values ('sem_vinculo', md5('cq-test:sem_vinculo')::uuid);

-- ==================== 1) meu_contexto: quem sou eu em cada clube ====================
select t.como('membro_a');
select t.eq('membro A: exatamente 1 vínculo (o do clube A)', t.ctx('->''vinculos''->0->>''club_id'''), t.id('clube_a')::text);
select t.eq('membro A: nenhum outro vínculo na lista', t.n($q$select jsonb_array_length(public.meu_contexto()->'vinculos')$q$), 1);
select t.eq('membro A: o clube atual do SERVIDOR é o clube A', t.ctx('->>''clube_atual_id'''), t.id('clube_a')::text);
select t.eq('membro A: papel e status NO CLUBE', t.ctx('->''vinculos''->0->>''papel''') || '/' || t.ctx('->''vinculos''->0->>''status'''), 'desbravador/ativo');
select t.eq('membro A: pode agir nesse clube (selecionável)', t.ctx('->''vinculos''->0->>''selecionavel'''), 'true');
select t.eq('membro A: unidade dele NESSE clube (A1)', t.ctx('->''vinculos''->0->>''unidade_id'''), t.id('A1')::text);
select t.eq('membro A: nome da unidade', t.ctx('->''vinculos''->0->''unidade_nome'''), '"Teste A1"');
select t.eq('membro A: nada do clube B vaza pelo contexto (id nem nome)', t.n(format($q$select (public.meu_contexto()::text like '%%' || %L || '%%' or public.meu_contexto()::text like '%%Clube B%%')::int$q$, t.id('clube_b'))), 0);

-- ---------- Tenant 001 mantém a marca de sempre (dados, não código) ----------
select t.eq('Tenant 001: nome', t.ctx('->''vinculos''->0->''marca''->>''nome'''), 'Filhos da Conquista');
select t.eq('Tenant 001: sigla "FC" (a que o app sempre mostrou)', t.ctx('->''vinculos''->0->''marca''->>''sigla'''), 'FC');
select t.eq('Tenant 001: lema, descrição e ano', t.ctx('->''vinculos''->0->''marca''->>''lema''') || '|' || t.ctx('->''vinculos''->0->''marca''->>''descricao''') || '|' || t.ctx('->''vinculos''->0->''marca''->>''desde'''), 'Desbravadores · 1994|Clube de Desbravadores · 1994|1994');
-- MUDOU NA 8.5 (migration 65). O logo do Tenant 001 apontava para `/icon-192.png`, que é o ÍCONE
-- DO PRODUTO — o favicon, o ícone do PWA, o ícone do app Android e o `icon`/`badge` de toda
-- notificação push de todo clube. E aquele arquivo era, de fato, o brasão do clube A. A identidade
-- do produto e a de um cliente eram literalmente o mesmo arquivo: nem o clube A podia trocar o
-- logo dele sem trocar o do produto, nem um clube novo escapava de instalar um app com o brasão
-- do clube A na tela inicial. Agora o brasão mora num arquivo dele, e a marca aponta para lá.
select t.eq('Tenant 001: o logo é o BRASÃO DELE, num arquivo dele — não o ícone do produto',
  t.ctx('->''vinculos''->0->''marca''->>''logo_url''') || '|' || coalesce(t.ctx('->''vinculos''->0->''marca''->>''cor_primaria'''), 'padrao'),
  '/clubes/tenant-001.png|padrao');
select t.eq('...e nenhum clube aponta o logo para o ícone do produto',
  (select count(*) from public.organizational_units
    where type = 'clube' and metadata->'marca'->>'logo_url' in ('/icon-192.png', '/icon-512.png', '/logo.png')), 0);
select t.eq('Tenant 001: leilão segue ligado (era o único recurso opcional) e o resto do catálogo vem ligado', t.ctx('->''vinculos''->0->''recursos''->>''leilao''') || '|' || t.ctx('->''vinculos''->0->''recursos''->>''chat''') || '|' || t.ctx('->''vinculos''->0->''recursos''->>''mural'''), 'true|true|true');

-- ---------- Tenant 002: marca padrão derivada do NOME do clube (nunca "Filhos da Conquista") ----------
select t.como('membro_b');
select t.eq('membro B: 1 vínculo, do clube B', t.ctx('->''vinculos''->0->>''club_id''') || '/' || t.n($q$select jsonb_array_length(public.meu_contexto()->'vinculos')$q$), t.id('clube_b')::text || '/1');
select t.eq('membro B: unidade B1 e clube atual B', t.ctx('->''vinculos''->0->>''unidade_id''') || '|' || t.ctx('->>''clube_atual_id'''), t.id('B1')::text || '|' || t.id('clube_b')::text);
select t.eq('Tenant 002: marca padrão vem do nome do clube', t.ctx('->''vinculos''->0->''marca''->>''nome''') || '|' || t.ctx('->''vinculos''->0->''marca''->>''sigla'''), 'Clube B (teste)|CB');
select t.eq('Tenant 002: sem lema, sem logo, sem cor (nada do clube A emprestado)', coalesce(t.ctx('->''vinculos''->0->''marca''->>''lema'''), 'nulo') || '|' || coalesce(t.ctx('->''vinculos''->0->''marca''->>''logo_url'''), 'nulo') || '|' || coalesce(t.ctx('->''vinculos''->0->''marca''->>''cor_primaria'''), 'nulo'), 'nulo|nulo|nulo');
select t.eq('Tenant 002: o leilão vem DESLIGADO (padrão do catálogo) e o chat ligado', t.ctx('->''vinculos''->0->''recursos''->>''leilao''') || '|' || t.ctx('->''vinculos''->0->''recursos''->>''chat'''), 'false|true');
select t.eq('membro B: nada do clube A vaza pelo contexto', t.n(format($q$select (public.meu_contexto()::text like '%%' || %L || '%%' or public.meu_contexto()::text like '%%Filhos da Conquista%%')::int$q$, t.id('clube_a'))), 0);

-- ---------- responsável, liderança e cadastro pendente ----------
select t.como('pais_a');
select t.eq('responsável: papel "pais", sem unidade, e o vínculo é dele', t.ctx('->''vinculos''->0->>''papel''') || '|' || coalesce(t.ctx('->''vinculos''->0->>''unidade_id'''), 'sem-unidade') || '|' || t.ctx('->''vinculos''->0->>''selecionavel'''), 'pais|sem-unidade|true');
select t.como('lider_a');
select t.eq('diretoria A: papel diretoria', t.ctx('->''vinculos''->0->>''papel'''), 'diretoria');
select t.como('instrutor_a');
select t.eq('instrutor A: papel instrutor', t.ctx('->''vinculos''->0->>''papel'''), 'instrutor');
select t.como('tesoureiro_a');
select t.eq('tesoureiro A: papel tesoureiro', t.ctx('->''vinculos''->0->>''papel'''), 'tesoureiro');
select t.como('conselheiro_a');
select t.eq('conselheiro A: papel e unidade A1', t.ctx('->''vinculos''->0->>''papel''') || '|' || t.ctx('->''vinculos''->0->>''unidade_id'''), 'conselheiro|' || t.id('A1')::text);
select t.como('lider_b');
select t.eq('diretoria B: papel diretoria no clube B', t.ctx('->''vinculos''->0->>''papel''') || '|' || t.ctx('->''vinculos''->0->>''club_id'''), 'diretoria|' || t.id('clube_b')::text);
select t.como('pend_a');
select t.eq('cadastro pendente: aparece como pendente, NÃO selecionável e sem clube atual no servidor', t.ctx('->''vinculos''->0->>''status''') || '|' || t.ctx('->''vinculos''->0->>''selecionavel''') || '|' || coalesce(t.ctx('->>''clube_atual_id'''), 'sem-clube'), 'pendente|false|sem-clube');

-- ---------- tentativa de acessar clube SEM vínculo ----------
select t.como('sem_vinculo');
select t.eq('conta sem vínculo: lista vazia e nenhum clube atual (nada de clube "por padrão")', t.n($q$select jsonb_array_length(public.meu_contexto()->'vinculos')$q$) || '|' || coalesce(t.ctx('->>''clube_atual_id'''), 'sem-clube'), '0|sem-clube');
select t.eq('conta sem vínculo não recebe marca nem recursos de clube nenhum', t.n($q$select (public.meu_contexto()::text like '%marca%')::int$q$), 0);
select t.como_anon();
select t.ok('anon NÃO executa meu_contexto', t.ctx('') like 'ERRO:%');
reset role;

-- ---------- vários vínculos: agora é suportado de verdade (migration 34 removeu o 1-clube-por-
-- pessoa) ----------  cobertura completa (papel/unidade diferentes por clube, seleção via header,
-- troca de clube, forjar club_id, responsável e liderança em 2 clubes) está em 27_multiclube_real.sql;
-- aqui só a forma que meu_contexto() devolve quando a pessoa JÁ tem 2 vínculos.
select t.permitido('múltiplos clubes ativos: agora é aceito sem erro',
  format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status, unidade_id, created_at) values (%L, %L, 'instrutor', 'ativo', null, now() + interval '1 hour')$q$, t.id('membro_b'), t.id('clube_a')));
select t.como('membro_b');
select t.eq('pessoa em 2 clubes: o contexto lista os DOIS, o do servidor primeiro', t.ctx('->''vinculos''->0->>''club_id''') || '|' || t.ctx('->''vinculos''->1->>''club_id'''), t.id('clube_b')::text || '|' || t.id('clube_a')::text);
select t.eq('pessoa em 2 clubes: papel DIFERENTE em cada (o papel é do vínculo, não da pessoa)', t.ctx('->''vinculos''->0->>''papel''') || '|' || t.ctx('->''vinculos''->1->>''papel'''), 'desbravador|instrutor');
select t.eq('pessoa em 2 clubes: os DOIS vínculos ativos são selecionáveis (a troca de clube é real agora)', t.ctx('->''vinculos''->0->>''selecionavel''') || '|' || t.ctx('->''vinculos''->1->>''selecionavel'''), 'true|true');
select t.eq('pessoa em 2 clubes: a unidade só vale no clube dela (B1 no B; nenhuma no A)', t.ctx('->''vinculos''->0->>''unidade_id''') || '|' || coalesce(t.ctx('->''vinculos''->1->>''unidade_id'''), 'sem-unidade'), t.id('B1')::text || '|sem-unidade');
reset role;
delete from public.organization_memberships where user_id = t.id('membro_b') and organizational_unit_id = t.id('clube_a');

-- ==================== 2) marca por clube ====================
select t.como('lider_a');
select t.permitido('diretoria A grava a marca do PRÓPRIO clube', $q$select public.clube_marca_gravar('{"nome":"Conquista Oficial","cor_primaria":"#112233","cor_secundaria":"#AABBCC","lema":"Sempre prontos"}'::jsonb)$q$);
select t.eq('...e o contexto passa a mostrar a marca nova (cores em minúsculas), mantendo o que não mudou', t.ctx('->''vinculos''->0->''marca''->>''nome''') || '|' || t.ctx('->''vinculos''->0->''marca''->>''cor_primaria''') || '|' || t.ctx('->''vinculos''->0->''marca''->>''cor_secundaria''') || '|' || t.ctx('->''vinculos''->0->''marca''->>''lema''') || '|' || t.ctx('->''vinculos''->0->''marca''->>''sigla'''), 'Conquista Oficial|#112233|#aabbcc|Sempre prontos|FC');
select t.como('instrutor_a');
select t.bloqueado('instrutor A NÃO grava a marca (migration 210: identidade é da diretoria)', $q$select public.clube_marca_gravar('{"sigla":"CO"}'::jsonb)$q$);
select t.como('tesoureiro_a');
select t.bloqueado('tesoureiro NÃO grava a marca', $q$select public.clube_marca_gravar('{"nome":"Hackeado"}'::jsonb)$q$);
select t.como('conselheiro_a');
select t.bloqueado('conselheiro NÃO grava a marca', $q$select public.clube_marca_gravar('{"nome":"Hackeado"}'::jsonb)$q$);
select t.como('membro_a');
select t.bloqueado('membro NÃO grava a marca', $q$select public.clube_marca_gravar('{"nome":"Hackeado"}'::jsonb)$q$);
select t.como('pais_a');
select t.bloqueado('responsável NÃO grava a marca', $q$select public.clube_marca_gravar('{"nome":"Hackeado"}'::jsonb)$q$);
select t.como('sem_vinculo');
select t.bloqueado('conta sem vínculo NÃO grava marca de clube nenhum', $q$select public.clube_marca_gravar('{"nome":"Hackeado"}'::jsonb)$q$);
select t.como_anon();
select t.bloqueado('anon NÃO grava marca', $q$select public.clube_marca_gravar('{"nome":"Hackeado"}'::jsonb)$q$);
reset role;
select t.eq('a marca do clube B NÃO mudou com as gravações do clube A', (select coalesce(metadata->'marca', '{}'::jsonb)::text from public.organizational_units where id = t.id('clube_b')), '{}');
select t.como('lider_b');
select t.permitido('diretoria B grava a marca do PRÓPRIO clube', $q$select public.clube_marca_gravar('{"nome":"Clube B Oficial","lema":"Lema do B","desde":2010}'::jsonb)$q$);
select t.eq('...e o contexto do B mostra a marca do B', t.ctx('->''vinculos''->0->''marca''->>''nome''') || '|' || t.ctx('->''vinculos''->0->''marca''->>''desde'''), 'Clube B Oficial|2010');
reset role;
select t.eq('a marca do clube A NÃO mudou com a gravação do clube B (e a sigla do instrutor não entrou: migration 210)', (select metadata #>> '{marca,nome}' from public.organizational_units where id = t.id('clube_a')) || '|' || coalesce((select metadata #>> '{marca,sigla}' from public.organizational_units where id = t.id('clube_a')), '-'), 'Conquista Oficial|-');

-- validações (uma marca ruim NUNCA entra; erro claro para a liderança)
select t.como('lider_a');
select t.throws('cor inválida (nome de cor)', $q$select public.clube_marca_gravar('{"cor_primaria":"red"}'::jsonb)$q$, 'cor');
select t.throws('cor inválida (curta)', $q$select public.clube_marca_gravar('{"cor_secundaria":"#12345"}'::jsonb)$q$, 'cor');
select t.throws('cor inválida (injeção de CSS)', $q$select public.clube_marca_gravar('{"cor_primaria":"#111; background:url(x)"}'::jsonb)$q$, 'cor');
select t.throws('campo desconhecido é recusado (nada de gravar coisa nova por essa porta)', $q$select public.clube_marca_gravar('{"evil":"x"}'::jsonb)$q$, 'desconhecido');
select t.throws('texto com < ou > é recusado', $q$select public.clube_marca_gravar('{"nome":"<script>alert(1)</script>"}'::jsonb)$q$, 'caracteres');
select t.throws('nome grande demais', format($q$select public.clube_marca_gravar(jsonb_build_object('nome', %L))$q$, repeat('a', 61)), 'nome');
select t.throws('sigla com mais de 4 caracteres', $q$select public.clube_marca_gravar('{"sigla":"ABCDE"}'::jsonb)$q$, 'sigla');
select t.throws('ano de fundação absurdo', $q$select public.clube_marca_gravar('{"desde":1500}'::jsonb)$q$, 'ano');
select t.throws('logo de site externo é recusada (o app não carrega imagem de terceiro)', $q$select public.clube_marca_gravar('{"logo_url":"https://evil.test/track.png"}'::jsonb)$q$, 'logo');
select t.throws('logo na pasta do clube B é recusada', format($q$select public.clube_marca_gravar(jsonb_build_object('logo_url', 'https://proj.supabase.co/storage/v1/object/public/publico/%s/logo.png'))$q$, t.id('clube_b')), 'logo');
select t.throws('logo com javascript: é recusada', $q$select public.clube_marca_gravar('{"logo_url":"javascript:alert(1)"}'::jsonb)$q$, 'logo');
select t.throws('logo de OUTRO bucket do próprio clube é recusada (só o bucket publico)', format($q$select public.clube_marca_gravar(jsonb_build_object('logo_url', 'https://proj.supabase.co/storage/v1/object/public/imagens/%s/logo.png'))$q$, t.id('clube_a')), 'logo');
select t.permitido('logo na pasta do PRÓPRIO clube, no bucket publico, é aceita', format($q$select public.clube_marca_gravar(jsonb_build_object('logo_url', 'https://proj.supabase.co/storage/v1/object/public/publico/%s/logo-1.png'))$q$, t.id('clube_a')));
select t.eq('...e aparece no contexto', t.ctx('->''vinculos''->0->''marca''->>''logo_url'''), 'https://proj.supabase.co/storage/v1/object/public/publico/' || t.id('clube_a') || '/logo-1.png');
select t.permitido('reenviar a logo antiga sem mudar (o front manda o valor atual) não é erro', $q$select public.clube_marca_gravar(jsonb_build_object('logo_url', public.meu_contexto()->'vinculos'->0->'marca'->>'logo_url'))$q$);
select t.como('lider_b');
select t.throws('líder B NÃO aponta a logo para a pasta do clube A', format($q$select public.clube_marca_gravar(jsonb_build_object('logo_url', 'https://proj.supabase.co/storage/v1/object/public/publico/%s/logo-1.png'))$q$, t.id('clube_a')), 'logo');
select t.como('lider_a');
-- limpar volta ao padrão (nome do clube, sigla derivada)
select t.permitido('limpar campos (null ou vazio) volta ao padrão', $q$select public.clube_marca_gravar('{"nome":null,"sigla":"","lema":null,"cor_primaria":null,"cor_secundaria":null,"logo_url":null,"descricao":null,"desde":null}'::jsonb)$q$);
select t.eq('...nome do clube e sigla derivada, sem lema/cores/logo', t.ctx('->''vinculos''->0->''marca''->>''nome''') || '|' || t.ctx('->''vinculos''->0->''marca''->>''sigla''') || '|' || coalesce(t.ctx('->''vinculos''->0->''marca''->>''lema'''), 'nulo') || '|' || coalesce(t.ctx('->''vinculos''->0->''marca''->>''logo_url'''), 'nulo'), 'Filhos da Conquista|FC|nulo|nulo');
reset role;

-- ==================== 3) recursos (feature flags) por clube ====================
-- (fase 6: entra `experiencias`, que também nasce DESLIGADO — módulo novo nunca liga sozinho num clube)
-- (fase 9.1, migration 83: entra `especialidades`, desligado E somente da plataforma — a liderança não liga)
select t.eq('o catálogo tem os recursos do app e SÓ leilão, classes, experiências e especialidades nascem desligados', (select count(*) from public.recursos_catalogo) * 100 + (select count(*) from public.recursos_catalogo where not padrao), 1504);
select t.eq('...e só `especialidades` é recurso que SÓ a plataforma liga', (select string_agg(chave, ',' order by chave) from public.recursos_catalogo where somente_plataforma), 'especialidades');
select t.eq('padrão do catálogo quando o clube nunca escolheu; leilão desligado; recurso que não existe = desligado', (public.recurso_habilitado_no_clube(t.id('clube_b'), 'chat'))::text || '|' || (public.recurso_habilitado_no_clube(t.id('clube_b'), 'leilao'))::text || '|' || (public.recurso_habilitado_no_clube(t.id('clube_b'), 'nao_existe'))::text, 'true|false|false');
select t.como('lider_a');
select t.permitido('diretoria A desliga o chat do PRÓPRIO clube', $q$select public.recurso_definir('chat', false)$q$);
select t.eq('...o contexto do A mostra o chat desligado', t.ctx('->''vinculos''->0->''recursos''->>''chat'''), 'false');
select t.como('lider_b');
select t.eq('...e o chat do clube B continua ligado (escolha de um clube não vaza)', t.ctx('->''vinculos''->0->''recursos''->>''chat'''), 'true');
select t.permitido('diretoria B liga o leilão do PRÓPRIO clube', $q$select public.recurso_definir('leilao', true)$q$);
select t.eq('...leilão ligado só no B', t.ctx('->''vinculos''->0->''recursos''->>''leilao'''), 'true');
select t.como('membro_b');
select t.eq('membro B vê o leilão ligado (o gate de dados do leilão, `leilao_habilitado`, usa a MESMA regra)', public.leilao_habilitado(t.id('clube_b'))::text, 'true');
select t.como('membro_a');
select t.eq('membro A não tem o leilão do B (nem o chat que o A desligou): o gate é por clube', public.leilao_habilitado(t.id('clube_b'))::text, 'false');
select t.bloqueado('membro NÃO liga/desliga recurso', $q$select public.recurso_definir('mural', false)$q$);
select t.como('pais_a');
select t.bloqueado('responsável NÃO liga/desliga recurso', $q$select public.recurso_definir('mural', false)$q$);
select t.como('tesoureiro_a');
select t.bloqueado('tesoureiro NÃO liga/desliga recurso', $q$select public.recurso_definir('mural', false)$q$);
select t.como('instrutor_a');
select t.bloqueado('instrutor A NÃO liga/desliga recurso (migration 210: só a diretoria)', $q$select public.recurso_definir('mural', true)$q$);
select t.como('lider_a');
select t.throws('recurso fora do catálogo é recusado', $q$select public.recurso_definir('inventado', true)$q$, 'desconhecido');
select t.throws('valor nulo é recusado', $q$select public.recurso_definir('chat', null)$q$, 'ligado ou desligado');
select t.como('sem_vinculo');
select t.bloqueado('conta sem vínculo NÃO mexe em recurso de clube nenhum', $q$select public.recurso_definir('chat', false)$q$);
select t.como_anon();
select t.bloqueado('anon NÃO mexe em recurso', $q$select public.recurso_definir('chat', false)$q$);
reset role;
select t.eq('a escolha do clube B não criou linha no clube A e vice-versa', (select count(*) from public.club_features where club_id = t.id('clube_a') and feature = 'leilao' and enabled), 1);

-- não dá para desligar o leilão com leilão ABERTO (as unidades perderiam a tela com pontos em jogo)
select t.como('lider_a');
select public.criar_leilao('Leilão do A', now() + interval '1 day', '[{"nome":"Item","preco_base":10}]'::jsonb);
select t.throws('desligar o leilão com leilão aberto é recusado (encerre antes)', $q$select public.recurso_definir('leilao', false)$q$, 'aberto');
select t.permitido('mas dá para desligar recurso sem pendência (mural)', $q$select public.recurso_definir('mural', false)$q$);
reset role;

-- catálogo: leitura para quem está logado; ninguém grava
select t.como('membro_a');
select t.eq('membro lê o catálogo (para mostrar rótulos/ícones)', t.n('select count(*) from public.recursos_catalogo'), 15);
select t.bloqueado('membro NÃO grava no catálogo', $q$insert into public.recursos_catalogo (chave, nome, padrao) values ('x', 'x', true)$q$);
select t.bloqueado('membro NÃO altera o catálogo', $q$update public.recursos_catalogo set padrao = false$q$);
select t.bloqueado('membro NÃO apaga do catálogo', $q$delete from public.recursos_catalogo$q$);
select t.como('lider_a');
select t.bloqueado('nem a diretoria altera o catálogo da plataforma', $q$update public.recursos_catalogo set padrao = false$q$);
select t.como_anon();
select t.eq('anon não lê o catálogo', t.nv('select count(*) from public.recursos_catalogo'), 0);
reset role;
select t.ok('as funções internas (marca/recursos efetivos) não são executáveis por usuário nem anon',
  not has_function_privilege('authenticated', 'public.clube_marca(uuid)', 'execute') and not has_function_privilege('anon', 'public.clube_marca(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.recursos_do_clube(uuid)', 'execute') and not has_function_privilege('anon', 'public.recursos_do_clube(uuid)', 'execute'));
select t.ok('as RPCs de escrita não são executáveis por anon',
  not has_function_privilege('anon', 'public.clube_marca_gravar(jsonb)', 'execute') and not has_function_privilege('anon', 'public.recurso_definir(text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.meu_contexto()', 'execute'));

select t.fim();
rollback;
