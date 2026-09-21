-- Estado de PRODUÇÃO simulado: schema legado (ainda sem club_id/vínculos) com dados vivos de um clube.
-- Roda ANTES das migrations 20260921000001..19. Chaves: md5('up:'||chave)::uuid (ver post_verificacao.sql).
\set ON_ERROR_STOP on
\o /dev/null

create function pg_temp.mk(p_k text, p_nome text, p_papel text, p_status text, p_unidade uuid default null, p_nasc date default null) returns uuid
language plpgsql as $$
declare v_id uuid := md5('up:' || p_k)::uuid;
begin
  -- cadastro do jeito de sempre: o gatilho legado cria o perfil (pendente, desbravador)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, phone_change, phone_change_token, email_change_token_current,
    reauthentication_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_k || '@prod.test',
    extensions.crypt('senha-antiga', extensions.gen_salt('bf')), now(), '{}'::jsonb,
    jsonb_build_object('nome', p_nome, 'tipo', case when p_papel = 'pais' then 'pais' else '' end),
    now(), now(), '', '', '', '', '', '', '', '', false, false);
  update public.profiles set papel = p_papel, status = p_status, unidade_id = p_unidade, nascimento = p_nasc, nome = p_nome
   where id = v_id;
  return v_id;
end $$;

insert into public.unidades (nome, cor) values ('Águias', '#1d4ed8'), ('Leões', '#dc2626');

select pg_temp.mk('dir',  'Diretor',       'diretoria',   'ativo');
select pg_temp.mk('ins',  'Instrutor',     'instrutor',   'ativo');
select pg_temp.mk('tes',  'Tesoureiro',    'tesoureiro',  'ativo');
select pg_temp.mk('con',  'Conselheiro',   'conselheiro', 'ativo',    (select id from public.unidades where nome = 'Águias'));
select pg_temp.mk('d1',   'Desbravador 1', 'desbravador', 'ativo',    (select id from public.unidades where nome = 'Águias'), date '2014-05-05');
select pg_temp.mk('d2',   'Desbravador 2', 'desbravador', 'ativo',    (select id from public.unidades where nome = 'Leões'),  date '2013-03-03');
select pg_temp.mk('d3',   'Desbravador 3 (inativo)', 'desbravador', 'inativo', (select id from public.unidades where nome = 'Águias'));
select pg_temp.mk('pend', 'Cadastro Pendente', 'desbravador', 'pendente');
select pg_temp.mk('rej',  'Cadastro Rejeitado', 'desbravador', 'rejeitado');
select pg_temp.mk('pai',  'Responsável',   'pais',        'ativo');

insert into public.atividades (titulo, descricao, pontos, criado_por) values ('Atividade 1', 'x', 10, md5('up:dir')::uuid);
insert into public.entregas (atividade_id, usuario_id, texto, status)
select a.id, md5('up:d1')::uuid, 'entrega do d1', 'aprovada' from public.atividades a where a.titulo = 'Atividade 1';
insert into public.entregas (atividade_id, usuario_id, texto, status)
select a.id, md5('up:d2')::uuid, 'entrega do d2', 'pendente' from public.atividades a where a.titulo = 'Atividade 1';

insert into public.pontos (usuario_id, origem, pontos, motivo) values
  (md5('up:d1')::uuid, 'manual', 30, 'p d1'), (md5('up:d2')::uuid, 'manual', 20, 'p d2'), (md5('up:d3')::uuid, 'manual', 5, 'p d3');
insert into public.pontos (unidade_id, origem, pontos, motivo) values
  ((select id from public.unidades where nome = 'Águias'), 'unidade', 40, 'u aguias'),
  ((select id from public.unidades where nome = 'Leões'), 'unidade', 10, 'u leoes');

insert into public.fotos (url, legenda, autor_id) values ('https://x.test/1.jpg', 'foto 1', md5('up:d1')::uuid), ('https://x.test/2.jpg', 'foto 2', md5('up:d2')::uuid);
insert into public.eventos (titulo, tipo, data, criado_por) values ('Reunião', 'Reunião', current_date + 5, md5('up:dir')::uuid), ('Acampamento', 'Acampamento', current_date + 30, md5('up:dir')::uuid);
insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por) values
  (md5('up:d1')::uuid, 1, 2026, 50, 'pago', md5('up:tes')::uuid), (md5('up:d2')::uuid, 1, 2026, 50, 'pendente', md5('up:tes')::uuid);
-- mensalidades ÓRFÃS (dono excluído no passado: FK ON DELETE SET NULL). Duas no mesmo mês NÃO são duplicata
-- (NULL nunca colide na UNIQUE): o pré-check da migration 14 não pode abortar por causa delas.
insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por) values
  (null, 3, 2026, 50, 'pago', md5('up:tes')::uuid), (null, 3, 2026, 50, 'pago', md5('up:tes')::uuid);
insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por) values
  ('Aviso geral 1', 'x', 'geral', '/', 'todos', md5('up:dir')::uuid), ('Aviso geral 2', 'x', 'geral', '/', 'todos', md5('up:dir')::uuid);
insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por) values
  ('Recado do d1', 'x', 'geral', '/', 'pessoal', md5('up:d1')::uuid, md5('up:dir')::uuid);
insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status)
values (md5('up:pai')::uuid, md5('up:d1')::uuid, 'Desbravador 1', 'aprovado');
insert into public.config_clube (chave, valor) values ('pix', 'PIX-DE-PRODUCAO') on conflict (chave) do update set valor = excluded.valor;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select md5('up:' || k)::uuid, 'https://push.prod/' || k, 'k', 'a' from unnest(array['dir', 'd1', 'pai']) k;

-- leilão ABERTO com um lance ativo da unidade Águias (saldo = 30 + 40 = 70; lance de 20)
insert into public.leiloes (titulo, fecha_em, criado_por) values ('Leilão de produção', now() + interval '2 days', md5('up:dir')::uuid);
insert into public.leilao_itens (leilao_id, nome, preco_base, ordem)
select id, 'Prêmio', 10, 1 from public.leiloes where titulo = 'Leilão de produção';
insert into public.leilao_lances (item_id, criado_por, valor, status)
select it.id, md5('up:d1')::uuid, 20, 'ativo' from public.leilao_itens it where it.nome = 'Prêmio';
insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
select l.id, (select id from public.unidades where nome = 'Águias'), true from public.leilao_lances l;

-- duelo em andamento entre as duas unidades (catálogo padrão que o SQL legado semeou)
insert into public.duelos (desafio_id, titulo, pontos, unidade_a, unidade_b, criado_por, prazo)
select du.id, du.titulo, du.pontos, (select id from public.unidades where nome = 'Águias'), (select id from public.unidades where nome = 'Leões'), md5('up:d1')::uuid, current_date + 7
from public.desafios_unidade du where du.titulo = 'Maratona de missões';

-- fotografia do estado ANTES do upgrade (psql guarda nas variáveis pre_*)
select (select count(*) from public.config_clube) as pre_config, (select count(*) from public.duelos) as pre_duelos, (select count(*) from public.desafios_unidade) as pre_desafios, (select count(*) from public.pontos) as pre_pontos, (select coalesce(sum(pontos), 0) from public.pontos) as pre_soma_pontos,
       (select count(*) from public.fotos) as pre_fotos, (select count(*) from public.atividades) as pre_atividades,
       (select count(*) from public.entregas) as pre_entregas, (select count(*) from public.mensalidades) as pre_mensalidades,
       (select count(*) from public.eventos) as pre_eventos, (select count(*) from public.notificacoes) as pre_notificacoes,
       (select count(*) from public.profiles) as pre_perfis, (select count(*) from public.unidades) as pre_unidades,
       (select count(*) from public.responsaveis) as pre_responsaveis, (select count(*) from public.leilao_lances) as pre_lances,
       (select string_agg(usuario_id::text || ':' || s, ',' order by usuario_id::text)
          from (select usuario_id, sum(pontos)::text as s from public.pontos where usuario_id is not null group by 1) x) as pre_totais_pessoas
\gset
\o
