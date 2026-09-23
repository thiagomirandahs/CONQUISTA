-- =============================================================================
--  Fixtures dos testes (incluídos por cada teste, DENTRO da transação, como
--  postgres). Estado EXPLÍCITO e independente das migrations novas: as linhas de
--  auth/perfil/vínculo são criadas com os gatilhos desligados, para que o mesmo
--  cenário exista antes e depois das correções. Os DADOS (pontos, fotos...) são
--  inseridos com os gatilhos ligados, como o app faria.
--
--  Clubes:  A = Tenant 001 (legado, "Filhos da Conquista")   B = clube de teste
--  Pessoas (t.id('chave')):
--    A: lider_a (diretoria) instrutor_a tesoureiro_a conselheiro_a (unid A1)
--       membro_a (desbravador, unid A1)  membro_a2 (desbravador, unid A2)  pais_a
--    B: lider_b (diretoria) membro_b (desbravador, unid B1)  pais_b
--    Multi-clube (t.mk + t.mk2 — vínculo em A E B; ver 27_multiclube_real.sql):
--      multi_dois_papeis (desbravador/A1 no A, conselheiro/B1 no B)
--      dir_a_membro_b (diretoria no A, desbravador/B1 no B)
--      instrutor_2clubes (instrutor/A1 no A, instrutor/B1 no B)
--      pais_2clubes (pais nos dois — responsaveis aprovados: membro_a no A, membro_b no B)
--      suspenso_so_b (desbravador/A1 ATIVO no A, desbravador/B1 SUSPENSO no B)
--    (as 5 pessoas de multi-clube têm profiles.teste = true — não contam em rankings/lembretes)
--  Unidades: A1 A2 (clube A)  B1 (clube B)
-- =============================================================================
\set ON_ERROR_STOP on
\o /dev/null

insert into t.ids (chave, id) select 'clube_a', id from public.organizational_units where slug = 'filhos-da-conquista';
insert into public.organizational_units (type, nome, slug, pais, timezone, metadata)
values ('clube', 'Clube B (teste)', 'clube-b-teste', 'BR', 'America/Recife', '{"test_only":true}');
insert into t.ids (chave, id) select 'clube_b', id from public.organizational_units where slug = 'clube-b-teste';

insert into public.unidades (nome, cor, club_id) values ('Teste A1', '#111111', t.id('clube_a'));
insert into public.unidades (nome, cor, club_id) values ('Teste A2', '#222222', t.id('clube_a'));
insert into public.unidades (nome, cor, club_id) values ('Teste B1', '#333333', t.id('clube_b'));
insert into t.ids (chave, id) select 'A1', id from public.unidades where nome = 'Teste A1';
insert into t.ids (chave, id) select 'A2', id from public.unidades where nome = 'Teste A2';
insert into t.ids (chave, id) select 'B1', id from public.unidades where nome = 'Teste B1';

create function t.mk(p_chave text, p_nome text, p_papel text, p_status text, p_clube text,
                     p_unidade text default null, p_nasc date default null) returns uuid
language plpgsql as $$
declare
  v_id uuid := md5('cq-test:' || p_chave)::uuid;
begin
  set local session_replication_role = replica;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, phone_change, phone_change_token, email_change_token_current,
    reauthentication_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    p_chave || '@teste.local', extensions.crypt('senha-original', extensions.gen_salt('bf')), now(),
    '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false);
  insert into public.profiles (id, nome, papel, status, unidade_id, nascimento)
  values (v_id, p_nome, p_papel, p_status, case when p_unidade is null then null else t.id(p_unidade) end, p_nasc);
  -- starts_at um instante ANTES de now(): now() é fixo pra transação inteira (não avança entre
  -- statements), então um eventual 2º vínculo da MESMA pessoa (t.mk2, sempre com now() puro) nunca
  -- empata nem "ganha" o desempate de qual clube é o padrão sem pedir nada — só este 1º aqui.
  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, unidade_id, starts_at, created_at)
  values (v_id, t.id(p_clube), p_papel,
          case p_status when 'ativo' then 'ativo' when 'pendente' then 'pendente' else 'suspenso' end,
          case when p_unidade is null then null else t.id(p_unidade) end,
          now() - interval '1 second', now() - interval '1 second');
  set local session_replication_role = origin;
  insert into t.ids (chave, id) values (p_chave, v_id);
  return v_id;
end $$;

-- Segundo vínculo (ou mais) para uma pessoa que t.mk já criou, em OUTRO clube
-- (ou no mesmo, com outro papel) — cenários de multi-clube de verdade. Nunca
-- mexe em profiles (identidade global, criada uma vez só por t.mk).
-- Ao contrário de t.mk (que cria auth.users+profiles+vínculo juntos, com os gatilhos desligados),
-- t.mk2 SÓ insere o vínculo novo numa pessoa que já existe — os gatilhos reais (valida a unidade,
-- espelha em profiles) rodam normalmente, exatamente como uma aprovação de verdade rodaria.
-- t.mk grava o PRIMEIRO vínculo com starts_at levemente ANTERIOR (ver comentário lá) só pra isso
-- aqui poder usar now() sem se preocupar: o vínculo de t.mk2 nunca empata (nem "ganha") o desempate
-- de qual clube é o padrão — só é honrado quando alguém PEDE esse clube explicitamente.
create function t.mk2(p_chave_pessoa text, p_papel text, p_status text, p_clube text, p_unidade text default null)
returns uuid language plpgsql as $$
declare v_id uuid := t.id(p_chave_pessoa);
begin
  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, unidade_id)
  values (v_id, t.id(p_clube), p_papel,
          case p_status when 'ativo' then 'ativo' when 'pendente' then 'pendente' else 'suspenso' end,
          case when p_unidade is null then null else t.id(p_unidade) end);
  return v_id;
end $$;

-- ---------- pessoas com vínculo em MAIS DE UM clube (multi-clube de verdade) ----------
-- multi_dois_papeis: desbravador no clube A (unid A1), conselheiro no clube B (unid B1).
select t.mk('multi_dois_papeis', 'Multi Dois Papeis', 'desbravador', 'ativo', 'clube_a', 'A1', date '2013-01-01');
select t.mk2('multi_dois_papeis', 'conselheiro', 'ativo', 'clube_b', 'B1');

-- dir_a_membro_b: diretoria no clube A, desbravador comum no clube B.
select t.mk('dir_a_membro_b', 'Diretor A Membro B', 'diretoria', 'ativo', 'clube_a');
select t.mk2('dir_a_membro_b', 'desbravador', 'ativo', 'clube_b', 'B1');

-- instrutor_2clubes: instrutor nos dois clubes, cada um com uma unidade diferente.
select t.mk('instrutor_2clubes', 'Instrutor Dois Clubes', 'instrutor', 'ativo', 'clube_a', 'A1');
select t.mk2('instrutor_2clubes', 'instrutor', 'ativo', 'clube_b', 'B1');

-- pais_2clubes: responsável nos dois clubes, cada vínculo aprovado para o filho daquele clube.
select t.mk('pais_2clubes', 'Pais Dois Clubes', 'pais', 'ativo', 'clube_a');
select t.mk2('pais_2clubes', 'pais', 'ativo', 'clube_b');

-- suspenso_so_b: ativo no clube A, SUSPENSO só no clube B (o vínculo do A não é afetado).
select t.mk('suspenso_so_b', 'Suspenso So B', 'desbravador', 'ativo', 'clube_a', 'A1');
select t.mk2('suspenso_so_b', 'desbravador', 'suspenso', 'clube_b', 'B1');

-- Essas 5 pessoas de multi-clube não podem contaminar contagens EXATAS de outros testes
-- (lembretes de ausência, rankings...): a flag teste já existe pra isso (rotinas de cron/jogo já
-- excluem quem tem profiles.teste = true).
update public.profiles set teste = true
 where id in (t.id('multi_dois_papeis'), t.id('dir_a_membro_b'), t.id('instrutor_2clubes'), t.id('pais_2clubes'), t.id('suspenso_so_b'));

select t.mk('lider_a',       'Lider A',       'diretoria',   'ativo', 'clube_a');
select t.mk('instrutor_a',   'Instrutor A',   'instrutor',   'ativo', 'clube_a');
select t.mk('tesoureiro_a',  'Tesoureiro A',  'tesoureiro',  'ativo', 'clube_a');
select t.mk('conselheiro_a', 'Conselheiro A', 'conselheiro', 'ativo', 'clube_a', 'A1');
select t.mk('membro_a',      'Membro A',      'desbravador', 'ativo', 'clube_a', 'A1', date '2014-05-05');
select t.mk('membro_a2',     'Membro A2',     'desbravador', 'ativo', 'clube_a', 'A2', date '2013-03-03');
select t.mk('pais_a',        'Pais A',        'pais',        'ativo', 'clube_a');
select t.mk('lider_b',       'Lider B',       'diretoria',   'ativo', 'clube_b');
select t.mk('membro_b',      'Membro B',      'desbravador', 'ativo', 'clube_b', 'B1', date '2014-06-06');
select t.mk('pais_b',        'Pais B',        'pais',        'ativo', 'clube_b');

-- ---------- dados de cada clube (gatilhos ligados, como no app) ----------
insert into public.atividades (titulo, descricao, pontos, club_id, criado_por)
values ('Atividade A', 'do clube A', 10, t.id('clube_a'), t.id('lider_a'));
insert into public.atividades (titulo, descricao, pontos, club_id, criado_por)
values ('Atividade B', 'do clube B', 20, t.id('clube_b'), t.id('lider_b'));
insert into t.ids (chave, id) select 'atv_a', id from public.atividades where titulo = 'Atividade A';
insert into t.ids (chave, id) select 'atv_b', id from public.atividades where titulo = 'Atividade B';

insert into public.entregas (atividade_id, usuario_id, texto) values (t.id('atv_a'), t.id('membro_a'), 'Entrega A');
insert into public.entregas (atividade_id, usuario_id, texto) values (t.id('atv_b'), t.id('membro_b'), 'Entrega B');
insert into t.ids (chave, id) select 'ent_a', id from public.entregas where texto = 'Entrega A';
insert into t.ids (chave, id) select 'ent_b', id from public.entregas where texto = 'Entrega B';

insert into public.pontos (usuario_id, origem, pontos, motivo) values (t.id('membro_a'), 'manual', 10, 'Ponto membro A');
insert into public.pontos (unidade_id, origem, pontos, motivo) values (t.id('A1'), 'unidade', 5, 'Ponto unidade A1');
insert into public.pontos (usuario_id, origem, pontos, motivo) values (t.id('membro_b'), 'manual', 20, 'Ponto membro B');
insert into public.pontos (unidade_id, origem, pontos, motivo) values (t.id('B1'), 'unidade', 7, 'Ponto unidade B1');

insert into public.fotos (url, legenda, autor_id) values ('https://exemplo.test/a.jpg', 'Foto A', t.id('membro_a'));
insert into public.fotos (url, legenda, autor_id) values ('https://exemplo.test/b.jpg', 'Foto B', t.id('membro_b'));

insert into public.eventos (titulo, tipo, data, criado_por, club_id)
values ('Evento A', 'Reunião', current_date + 7, t.id('lider_a'), t.id('clube_a'));
insert into public.eventos (titulo, tipo, data, criado_por, club_id)
values ('Evento B', 'Reunião', current_date + 7, t.id('lider_b'), t.id('clube_b'));

insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
values (t.id('membro_a'), 1, 2026, 50, 'pendente', t.id('lider_a'));
insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
values (t.id('membro_b'), 1, 2026, 60, 'pendente', t.id('lider_b'));

insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por, chave_push)
values ('Aviso A', 'todos do A', 'geral', '/', 'todos', t.id('lider_a'), '');
insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por, chave_push)
values ('Aviso B', 'todos do B', 'geral', '/', 'todos', t.id('lider_b'), '');
insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por, chave_push)
values ('Recado membro A', 'só do membro A', 'geral', '/', 'pessoal', t.id('membro_a'), t.id('lider_a'), '');

insert into public.temporadas (club_id, numero, inicio)
select t.id('clube_b'), 1, '-infinity'::timestamptz
where not exists (select 1 from public.temporadas where club_id = t.id('clube_b'));

insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status)
values (t.id('pais_a'), t.id('membro_a'), 'Membro A', 'aprovado');
insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status)
values (t.id('pais_b'), t.id('membro_b'), 'Membro B', 'aprovado');
-- pais_2clubes: um vínculo aprovado em CADA clube. Sem auth.uid() nos fixtures,
-- definir_club_responsavel só sabe resolver "o" clube do responsável (ambíguo com
-- 2 vínculos) — grava os dois direto, com os gatilhos desligados, como t.mk faz.
do $$
begin
  set local session_replication_role = replica;
  insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status, club_id)
  values (t.id('pais_2clubes'), t.id('membro_a'), 'Membro A (via pais 2 clubes)', 'aprovado', t.id('clube_a'));
  insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status, club_id)
  values (t.id('pais_2clubes'), t.id('membro_b'), 'Membro B (via pais 2 clubes)', 'aprovado', t.id('clube_b'));
  set local session_replication_role = origin;
end $$;

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select t.id(k), 'https://push.teste/' || k, 'k', 'a'
from unnest(array['lider_a','instrutor_a','membro_a','pais_a','lider_b','membro_b','pais_b']) k;

insert into public.config_clube (club_id, chave, valor) values (t.id('clube_a'), 'pix', 'PIX-DO-CLUBE-A')
on conflict (club_id, chave) do update set valor = excluded.valor;

insert into storage.objects (bucket_id, name, owner)
values ('comprovacoes', t.id('membro_a') || '/foto-a.jpg', t.id('membro_a')),
       ('comprovacoes', t.id('membro_b') || '/foto-b.jpg', t.id('membro_b'));

reset role;
\o
