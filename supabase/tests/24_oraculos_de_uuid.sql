-- Hardening final: oráculos de UUID.
--   Um oráculo é quando quem tem sessão consegue, adivinhando um UUID, descobrir se ele EXISTE em outro clube, porque o
--   sistema responde de forma DIFERENTE para "existe em outro clube" e "não existe" (mensagem, código ou sucesso/erro).
--   Os UUIDs são v4 (aleatórios, não se enumeram), então o risco é baixo — mas o pedido é fechar todos os que forem
--   alcançáveis por um cliente. Este teste compara, campo a campo, a resposta para (UUID de OUTRO clube) x (UUID aleatório):
--   têm que ser IDÊNTICAS (mesmo código SQL e mesma mensagem), nos dois sentidos (Tenant 001 -> Tenant 002 e o espelho).
--   Parte 1: escrita direta nas tabelas (o que o app/PostgREST faz). Parte 2: varredura automática de TODA função pública
--   executável por usuário logado que receba um UUID.
--   Clube A = Tenant 001 (legado); clube B = Tenant 002 (teste).
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- ferramentas ----------
-- Executa o SQL como o papel ATUAL, dentro de uma subtransação que SEMPRE desfaz o efeito, e devolve o desfecho:
--   'R:<resultado>'  se funcionou;  'E:<sqlstate>:<mensagem>'  se deu erro. UUIDs na mensagem viram <uuid>.
create function t.probe(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    raise exception using errcode = 'ZZ001', message = coalesce(v, '<null>');
  exception when others then
    if sqlstate = 'ZZ001' then return 'R:' || sqlerrm; end if;
    return 'E:' || sqlstate || ':' || regexp_replace(sqlerrm, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g');
  end;
end $$;
-- Para comandos que não devolvem linha (insert/update): mesmo probe, sem "into".
create function t.probe_dml(p_sql text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception using errcode = 'ZZ001', message = 'ok';
  exception when others then
    if sqlstate = 'ZZ001' then return 'R:ok'; end if;
    return 'E:' || sqlstate || ':' || regexp_replace(sqlerrm, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g');
  end;
end $$;
-- Assert: (UUID de outro clube) e (UUID aleatório) dão a MESMA resposta, e essa resposta é um erro.
create function t.sem_oraculo(p_nome text, p_sql_outro text, p_sql_aleatorio text) returns void language plpgsql as $$
declare a text := t.probe_dml(p_sql_outro); b text := t.probe_dml(p_sql_aleatorio);
begin
  perform t.registrar(p_nome, a = b and a like 'E:%', 'outro clube=[' || a || '] aleatório=[' || b || ']');
end $$;
-- Assert: mesma resposta, seja qual for (erro OU sucesso/no-op). Para campos que o gatilho de proteção do perfil ignora em silêncio.
create function t.sem_oraculo_igual(p_nome text, p_sql_outro text, p_sql_aleatorio text) returns void language plpgsql as $$
declare a text := t.probe_dml(p_sql_outro); b text := t.probe_dml(p_sql_aleatorio);
begin
  perform t.registrar(p_nome, a = b, 'outro clube=[' || a || '] aleatório=[' || b || ']');
end $$;
-- Igual, para chamadas de função (SELECT).
create function t.sem_oraculo_fn(p_nome text, p_sql_outro text, p_sql_aleatorio text) returns void language plpgsql as $$
declare a text := t.probe(p_sql_outro); b text := t.probe(p_sql_aleatorio);
begin
  perform t.registrar(p_nome, a = b, 'outro clube=[' || a || '] aleatório=[' || b || ']');
end $$;

-- ---------- dados extras (como postgres): mais uma unidade no B, pontos nas unidades, recurso ligado, missão pendente ----------
insert into public.unidades (nome, cor, club_id) values ('Teste B2', '#444444', t.id('clube_b'));
insert into t.ids (chave, id) select 'B2', id from public.unidades where nome = 'Teste B2';
insert into public.pontos (unidade_id, origem, pontos, motivo, club_id) values (t.id('A1'), 'unidade', 100, 'saldo', t.id('clube_a')), (t.id('B1'), 'unidade', 100, 'saldo', t.id('clube_b'));
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'leilao', true), (t.id('clube_b'), 'leilao', true)
  on conflict (club_id, feature) do update set enabled = true;
insert into public.missoes_feitas (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados) values (t.id('membro_a'), current_date, 'x/a.jpg', false, 'pendente', 10), (t.id('membro_b'), current_date, 'x/b.jpg', false, 'pendente', 10);

-- ---------- dados criados pelas próprias RPCs (como o app faria): leilão, lance, duelo, chat, convite ----------
select t.como('lider_a');
select public.criar_leilao('Leilão A', now() + interval '1 day', '[{"nome":"Item A","preco_base":10}]'::jsonb);
select public.criar_convite_responsavel();
select public.chat_enviar_geral('msg do lider A');
select t.como('lider_b');
select public.criar_leilao('Leilão B', now() + interval '1 day', '[{"nome":"Item B","preco_base":10}]'::jsonb);
select public.criar_convite_responsavel();
select public.chat_enviar_geral('msg do lider B');
reset role;
select id as item_a from public.leilao_itens where club_id = t.id('clube_a') limit 1 \gset
select id as item_b from public.leilao_itens where club_id = t.id('clube_b') limit 1 \gset
insert into t.ids values ('item_a', :'item_a'), ('item_b', :'item_b');
select t.como('membro_a');
select public.dar_lance(t.id('item_a'), 20, '{}');
select public.criar_duelo((select id from public.desafios_unidade where club_id = t.id('clube_a') limit 1), t.id('A2'));
select t.como('membro_b');
select public.dar_lance(t.id('item_b'), 20, '{}');
select public.criar_duelo((select id from public.desafios_unidade where club_id = t.id('clube_b') limit 1), t.id('B2'));
reset role;
select id as des_a from public.desafios_unidade where club_id = t.id('clube_a') limit 1 \gset
insert into t.ids values ('des_a', :'des_a');
select gen_random_uuid() as rnd \gset
insert into t.ids values ('rnd', :'rnd');

-- =====================================================================================================
-- PARTE 1 — escrita direta nas tabelas (o app/PostgREST). Cada par: UUID do OUTRO clube x UUID aleatório.
-- =====================================================================================================

-- ---------- pontos.usuario_id (lançamento da liderança) ----------
select t.como('lider_a');
select t.sem_oraculo('Tenant001->002: ponto para pessoa do clube B x pessoa inexistente (com unidade do próprio clube)',
  format($q$insert into public.pontos (unidade_id, usuario_id, origem, pontos, motivo) values (%L, %L, 'manual', 1, 'x')$q$, t.id('A1'), t.id('membro_b')),
  format($q$insert into public.pontos (unidade_id, usuario_id, origem, pontos, motivo) values (%L, %L, 'manual', 1, 'x')$q$, t.id('A1'), t.id('rnd')));
select t.sem_oraculo('Tenant001->002: ponto só com pessoa do clube B x pessoa inexistente',
  format($q$insert into public.pontos (usuario_id, origem, pontos, motivo) values (%L, 'manual', 1, 'x')$q$, t.id('membro_b')),
  format($q$insert into public.pontos (usuario_id, origem, pontos, motivo) values (%L, 'manual', 1, 'x')$q$, t.id('rnd')));
select t.sem_oraculo('Tenant001->002: ponto para a unidade do clube B x unidade inexistente',
  format($q$insert into public.pontos (unidade_id, origem, pontos, motivo) values (%L, 'unidade', 1, 'x')$q$, t.id('B1')),
  format($q$insert into public.pontos (unidade_id, origem, pontos, motivo) values (%L, 'unidade', 1, 'x')$q$, t.id('rnd')));
select t.como('lider_b');
select t.sem_oraculo('Tenant002->001: ponto para pessoa do clube A x pessoa inexistente (com unidade do próprio clube)',
  format($q$insert into public.pontos (unidade_id, usuario_id, origem, pontos, motivo) values (%L, %L, 'manual', 1, 'x')$q$, t.id('B1'), t.id('membro_a')),
  format($q$insert into public.pontos (unidade_id, usuario_id, origem, pontos, motivo) values (%L, %L, 'manual', 1, 'x')$q$, t.id('B1'), t.id('rnd')));
select t.sem_oraculo('Tenant002->001: ponto só com pessoa do clube A x pessoa inexistente',
  format($q$insert into public.pontos (usuario_id, origem, pontos, motivo) values (%L, 'manual', 1, 'x')$q$, t.id('membro_a')),
  format($q$insert into public.pontos (usuario_id, origem, pontos, motivo) values (%L, 'manual', 1, 'x')$q$, t.id('rnd')));
select t.sem_oraculo('Tenant002->001: ponto para a unidade do clube A x unidade inexistente',
  format($q$insert into public.pontos (unidade_id, origem, pontos, motivo) values (%L, 'unidade', 1, 'x')$q$, t.id('A1')),
  format($q$insert into public.pontos (unidade_id, origem, pontos, motivo) values (%L, 'unidade', 1, 'x')$q$, t.id('rnd')));
-- controle: o lançamento legítimo continua funcionando (nos dois clubes)
select t.como('lider_a');
select t.permitido('controle: líder A lança ponto para o membro do PRÓPRIO clube', format($q$insert into public.pontos (unidade_id, usuario_id, origem, pontos, motivo) values (%L, %L, 'manual', 1, 'ok')$q$, t.id('A1'), t.id('membro_a')));
select t.permitido('controle: líder A lança ponto para a unidade do PRÓPRIO clube', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo) values (%L, 'unidade', 1, 'ok')$q$, t.id('A1')));
select t.como('lider_b');
select t.permitido('controle: líder B lança ponto para o membro do PRÓPRIO clube', format($q$insert into public.pontos (unidade_id, usuario_id, origem, pontos, motivo) values (%L, %L, 'manual', 1, 'ok')$q$, t.id('B1'), t.id('membro_b')));

-- ---------- entregas.atividade_id (o membro envia; a liderança edita) ----------
select t.como('membro_a');
select t.sem_oraculo('Tenant001->002: entrega em atividade do clube B x atividade inexistente',
  format($q$insert into public.entregas (atividade_id, usuario_id, texto) values (%L, %L, 'x')$q$, t.id('atv_b'), t.id('membro_a')),
  format($q$insert into public.entregas (atividade_id, usuario_id, texto) values (%L, %L, 'x')$q$, t.id('rnd'), t.id('membro_a')));
select t.como('membro_b');
select t.sem_oraculo('Tenant002->001: entrega em atividade do clube A x atividade inexistente',
  format($q$insert into public.entregas (atividade_id, usuario_id, texto) values (%L, %L, 'x')$q$, t.id('atv_a'), t.id('membro_b')),
  format($q$insert into public.entregas (atividade_id, usuario_id, texto) values (%L, %L, 'x')$q$, t.id('rnd'), t.id('membro_b')));
select t.como('lider_a');
select t.sem_oraculo('Tenant001->002: a liderança move a entrega para atividade do clube B x inexistente',
  format($q$update public.entregas set atividade_id = %L where id = %L$q$, t.id('atv_b'), t.id('ent_a')),
  format($q$update public.entregas set atividade_id = %L where id = %L$q$, t.id('rnd'), t.id('ent_a')));
select t.como('lider_b');
select t.sem_oraculo('Tenant002->001: a liderança move a entrega para atividade do clube A x inexistente',
  format($q$update public.entregas set atividade_id = %L where id = %L$q$, t.id('atv_a'), t.id('ent_b')),
  format($q$update public.entregas set atividade_id = %L where id = %L$q$, t.id('rnd'), t.id('ent_b')));

-- ---------- entregas.avaliado_por: só marca autoria — tem que ser QUEM AVALIA ----------
select t.como('lider_a');
select t.sem_oraculo('Tenant001->002: avaliado_por = perfil do clube B x perfil inexistente',
  format($q$update public.entregas set avaliado_por = %L where id = %L$q$, t.id('lider_b'), t.id('ent_a')),
  format($q$update public.entregas set avaliado_por = %L where id = %L$q$, t.id('rnd'), t.id('ent_a')));
select t.bloqueado('avaliado_por não pode ser OUTRA pessoa nem do próprio clube (só quem avalia)', format($q$update public.entregas set avaliado_por = %L where id = %L$q$, t.id('instrutor_a'), t.id('ent_a')));
select t.permitido('controle: a liderança marca a PRÓPRIA avaliação (o que o app faz)', format($q$update public.entregas set status = 'reprovada', avaliado_por = %L, feedback = 'refazer' where id = %L$q$, t.id('lider_a'), t.id('ent_a')));
select t.como('membro_a');
select t.permitido('controle: o membro reenvia a entrega reprovada mesmo com avaliado_por antigo na linha', format($q$update public.entregas set status = 'pendente', texto = 'refeito' where id = %L$q$, t.id('ent_a')));
select t.como('lider_b');
select t.sem_oraculo('Tenant002->001: avaliado_por = perfil do clube A x perfil inexistente',
  format($q$update public.entregas set avaliado_por = %L where id = %L$q$, t.id('lider_a'), t.id('ent_b')),
  format($q$update public.entregas set avaliado_por = %L where id = %L$q$, t.id('rnd'), t.id('ent_b')));
-- o aprovar_entrega (RPC) continua marcando quem aprovou
select t.permitido('controle: aprovar_entrega (RPC) segue funcionando', format($q$select public.aprovar_entrega(%L)$q$, t.id('ent_b')));

-- ---------- mensalidades: desbravador_id e registrado_por ----------
select t.como('lider_a');
select t.sem_oraculo('Tenant001->002: mensalidade para pessoa do clube B x pessoa inexistente',
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status) values (%L, 2, 2026, 10, 'pendente')$q$, t.id('membro_b')),
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status) values (%L, 2, 2026, 10, 'pendente')$q$, t.id('rnd')));
select t.sem_oraculo('Tenant001->002: registrado_por = perfil do clube B x perfil inexistente',
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por) values (%L, 2, 2026, 10, 'pendente', %L)$q$, t.id('membro_a'), t.id('lider_b')),
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por) values (%L, 2, 2026, 10, 'pendente', %L)$q$, t.id('membro_a'), t.id('rnd')));
select t.permitido('controle: mensalidade legítima com registrado_por = a própria liderança', format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por) values (%L, 3, 2026, 10, 'pendente', %L)$q$, t.id('membro_a'), t.id('lider_a')));
select t.como('lider_b');
select t.sem_oraculo('Tenant002->001: mensalidade para pessoa do clube A x pessoa inexistente',
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status) values (%L, 2, 2026, 10, 'pendente')$q$, t.id('membro_a')),
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status) values (%L, 2, 2026, 10, 'pendente')$q$, t.id('rnd')));
select t.sem_oraculo('Tenant002->001: registrado_por = perfil do clube A x perfil inexistente',
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por) values (%L, 2, 2026, 10, 'pendente', %L)$q$, t.id('membro_b'), t.id('lider_a')),
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por) values (%L, 2, 2026, 10, 'pendente', %L)$q$, t.id('membro_b'), t.id('rnd')));
select t.como('tesoureiro_a');
select t.permitido('controle: o tesoureiro edita outra mensalidade sem trocar quem registrou (registrado_por antigo preservado)', format($q$update public.mensalidades set status = 'pago', data_pagamento = current_date where desbravador_id = %L and mes = 1$q$, t.id('membro_a')));

-- ---------- notificacoes.para_usuario ----------
select t.como('lider_a');
select t.sem_oraculo('Tenant001->002: aviso pessoal para alguém do clube B x alguém inexistente',
  format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario) values ('x', 'x', 'geral', '/', 'pessoal', %L)$q$, t.id('membro_b')),
  format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario) values ('x', 'x', 'geral', '/', 'pessoal', %L)$q$, t.id('rnd')));
select t.permitido('controle: aviso pessoal para alguém do PRÓPRIO clube', format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario) values ('ok', 'ok', 'geral', '/', 'pessoal', %L)$q$, t.id('membro_a')));
select t.como('lider_b');
select t.sem_oraculo('Tenant002->001: aviso pessoal para alguém do clube A x alguém inexistente',
  format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario) values ('x', 'x', 'geral', '/', 'pessoal', %L)$q$, t.id('membro_a')),
  format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario) values ('x', 'x', 'geral', '/', 'pessoal', %L)$q$, t.id('rnd')));

-- ---------- profiles.unidade_id (o membro troca a própria unidade; a liderança troca a de um membro) ----------
select t.como('membro_a');
select t.sem_oraculo_igual('Tenant001->002: trocar a própria unidade para a do clube B x unidade inexistente',
  format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('B1'), t.id('membro_a')),
  format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('rnd'), t.id('membro_a')));
select t.como('lider_a');
select t.sem_oraculo_igual('Tenant001->002: a liderança põe um membro na unidade do clube B x unidade inexistente',
  format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('B1'), t.id('membro_a')),
  format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('rnd'), t.id('membro_a')));
select t.como('membro_b');
select t.sem_oraculo_igual('Tenant002->001: trocar a própria unidade para a do clube A x unidade inexistente',
  format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('A1'), t.id('membro_b')),
  format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('rnd'), t.id('membro_b')));
select t.como('lider_b');
select t.sem_oraculo_igual('Tenant002->001: a liderança põe um membro na unidade do clube A x unidade inexistente',
  format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('A1'), t.id('membro_b')),
  format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('rnd'), t.id('membro_b')));
select t.como('membro_a');
select t.permitido('controle: o membro troca para outra unidade do PRÓPRIO clube', format($q$select public.minha_unidade_definir(%L)$q$, t.id('A2')));

-- ---------- RPCs com 2 ou mais UUIDs (a varredura da parte 2 só cobre as de UM uuid) ----------
select t.como('membro_a');
select t.sem_oraculo_fn('Tenant001->002: criar duelo contra unidade do clube B x unidade inexistente',
  format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a'), t.id('B1')),
  format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a'), t.id('rnd')));
select t.sem_oraculo_fn('Tenant001->002: lance com unidade extra do clube B x unidade inexistente',
  format($q$select public.dar_lance(%L, 30, array[%L]::uuid[])$q$, t.id('item_a'), t.id('B1')),
  format($q$select public.dar_lance(%L, 30, array[%L]::uuid[])$q$, t.id('item_a'), t.id('rnd')));
select t.como('membro_b');
select t.sem_oraculo_fn('Tenant002->001: lance com unidade extra do clube A x unidade inexistente',
  format($q$select public.dar_lance(%L, 30, array[%L]::uuid[])$q$, t.id('item_b'), t.id('A1')),
  format($q$select public.dar_lance(%L, 30, array[%L]::uuid[])$q$, t.id('item_b'), t.id('rnd')));
select t.como('lider_a');
select t.sem_oraculo_fn('Tenant001->002: aprovar vínculo com desbravador do clube B x inexistente',
  format($q$select public.aprovar_vinculo(%L, %L)$q$, t.id('rnd'), t.id('membro_b')),
  format($q$select public.aprovar_vinculo(%L, %L)$q$, t.id('rnd'), t.id('rnd')));
reset role;

-- =====================================================================================================
-- PARTE 2 — varredura automática: TODA função pública executável por usuário logado com UM argumento uuid
-- (os demais argumentos recebem valores neutros). Para cada uuid do OUTRO clube, a resposta tem que ser igual à do aleatório.
-- =====================================================================================================
create table t.pool (clube text, id uuid, rotulo text);
create table t.contagem (rotulo text, n int);
grant all on t.contagem to public;
create function t.montar_pool(p_clube text) returns void language plpgsql as $$
declare r record; v_club uuid := t.id(p_clube);
begin
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.columns d on d.table_schema = c.table_schema and d.table_name = c.table_name and d.column_name = 'club_id'
    where c.table_schema = 'public' and c.column_name = 'id' and c.data_type = 'uuid'
  loop
    execute format('insert into t.pool select %L, id, %L from public.%I where club_id = %L limit 3', p_clube, r.table_name, r.table_name, v_club);
  end loop;
  -- exclui quem tem vínculo em MAIS de um clube: pra essas pessoas, funções como
  -- compartilha_clube_com/lideranca_gere_usuario/excluir_usuario respondem diferente de
  -- propósito (elas DE VERDADE compartilham o outro clube) — não é oráculo, é o vínculo real.
  insert into t.pool
  select p_clube, user_id, 'pessoa' from public.organization_memberships
  where organizational_unit_id = v_club
    and user_id not in (
      select user_id from public.organization_memberships group by user_id having count(distinct organizational_unit_id) > 1
    );
  insert into t.pool values (p_clube, v_club, 'o próprio clube');
end $$;
select t.montar_pool('clube_a');
select t.montar_pool('clube_b');
grant select on t.pool to public;

-- monta "select public.f(args)::text" com o alvo na posição i e neutros nas demais; null se algum tipo não for suportado
create function t.chamada(p_nome text, p_tipos oid[], p_pos int, p_alvo uuid, p_outros uuid) returns text language plpgsql as $$
declare j int; v_args text[] := '{}'; v_tipo text;
begin
  for j in 1..coalesce(array_length(p_tipos, 1), 0) loop
    v_tipo := p_tipos[j]::regtype::text;
    v_args := v_args || case
      when j = p_pos then format('%L::uuid', p_alvo)
      when v_tipo = 'uuid' then format('%L::uuid', p_outros)
      when v_tipo = 'text' then quote_literal('x')
      when v_tipo = 'integer' then '1'
      when v_tipo = 'boolean' then 'true'
      when v_tipo = 'jsonb' then '''{}''::jsonb'
      when v_tipo = 'uuid[]' then '''{}''::uuid[]'
      else null end;
    if v_args[j] is null then return null; end if;
  end loop;
  return format('select (public.%I(%s))::text', p_nome, array_to_string(v_args, ', '));
end $$;

-- varre como o usuário JÁ logado (t.como antes): devolve a lista de divergências (texto vazio = nenhuma)
create function t.varrer(p_pool_clube text) returns text language plpgsql as $$
declare f record; p record; i int; v_a text; v_b text; v_sql_a text; v_sql_b text; v_dif text := ''; v_rnd uuid := gen_random_uuid(); v_n int := 0;
begin
  for f in
    select pr.proname, pr.proargtypes::oid[] as tipos, pr.pronargs
    from pg_proc pr
    where pr.pronamespace = 'public'::regnamespace and pr.prokind = 'f' and not pr.proretset and pr.prorettype <> 'trigger'::regtype
      and has_function_privilege(current_user, pr.oid, 'execute')
      and 'uuid'::regtype::oid = any (pr.proargtypes::oid[])
    order by 1
  loop
    for i in 1..f.pronargs loop
      continue when f.tipos[i] <> 'uuid'::regtype::oid;
      for p in select distinct on (id) id, rotulo from t.pool where clube = p_pool_clube loop
        v_sql_a := t.chamada(f.proname, f.tipos, i, p.id, v_rnd);
        v_sql_b := t.chamada(f.proname, f.tipos, i, v_rnd, v_rnd);
        continue when v_sql_a is null;
        v_a := t.probe(v_sql_a); v_b := t.probe(v_sql_b); v_n := v_n + 1;
        if v_a is distinct from v_b then
          v_dif := v_dif || format(E'\n    %s(arg %s) alvo=%s(%s): [%s] x aleatório: [%s]', f.proname, i, p.rotulo, p_pool_clube, left(v_a, 90), left(v_b, 90));
        end if;
      end loop;
    end loop;
  end loop;
  insert into t.contagem values (p_pool_clube, v_n);
  return v_dif;
end $$;

select t.como('membro_a');
select t.eq('Tenant001->002 (membro A): nenhuma função pública distingue uuid do clube B de uuid aleatório', t.varrer('clube_b'), '');
select t.como('lider_a');
select t.eq('Tenant001->002 (líder A): nenhuma função pública distingue uuid do clube B de uuid aleatório', t.varrer('clube_b'), '');
select t.como('tesoureiro_a');
select t.eq('Tenant001->002 (tesoureiro A): nenhuma função pública distingue uuid do clube B de uuid aleatório', t.varrer('clube_b'), '');
select t.como('pais_a');
select t.eq('Tenant001->002 (responsável A): nenhuma função pública distingue uuid do clube B de uuid aleatório', t.varrer('clube_b'), '');
select t.como('membro_b');
select t.eq('Tenant002->001 (membro B): nenhuma função pública distingue uuid do clube A de uuid aleatório', t.varrer('clube_a'), '');
select t.como('lider_b');
select t.eq('Tenant002->001 (líder B): nenhuma função pública distingue uuid do clube A de uuid aleatório', t.varrer('clube_a'), '');
reset role;
select t.ok('a varredura de verdade comparou milhares de chamadas (não passou no vazio)', (select coalesce(sum(n), 0) from t.contagem) >= 4000);

select t.fim();
rollback;
