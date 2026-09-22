-- Feature flags viram autorização de verdade (migration 34): desligar um recurso bloqueia
-- também a ESCRITA dele (RPC/insert direto), não só esconde a rota no front. Continua dando pra
-- LER o que já existe e a liderança continua podendo aprovar/editar pendências antigas — só
-- escrita NOVA é barrada. Um gatilho central (exigir_recurso_habilitado) cobre as 12 tabelas dos
-- 11 recursos que ainda não tinham gate de dados (o leilão já tinha, desde a fase anterior).
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ==================== 1) estrutural: o gatilho está em TODAS as tabelas certas ====================
create table t.esperado (tabela text, feature text);
insert into t.esperado values
  ('atividades', 'atividades'), ('entregas', 'atividades'),
  ('eventos', 'agenda'),
  ('chat_mensagens', 'chat'),
  ('trilha_jogos', 'jogos'), ('recordes', 'jogos'), ('partidas', 'jogos'),
  ('chefao_golpes', 'chefao'),
  ('duelos', 'desafios'), ('desafios_unidade', 'desafios'),
  ('missoes_feitas', 'missoes'), ('devocional', 'missoes'),
  ('fotos', 'mural'),
  ('mensalidades', 'mensalidades'),
  ('biblia_leituras', 'biblia'), ('biblia_leitura_atual', 'biblia'),
  ('bichinhos', 'bichinho');
select t.eq('as 17 tabelas dos 11 recursos (fora leilão) têm o gatilho central, com a chave certa',
  (select count(*) from t.esperado e
    where exists (
      select 1 from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_proc p on p.oid = tg.tgfoid
      where p.proname = 'exigir_recurso_habilitado' and c.relname = e.tabela
        and encode(tg.tgargs, 'escape') = e.feature || E'\\000'
    )), 17);
select t.eq('recurso "desafios" está no catálogo mas SEM tabela própria dedicada (usa duelos/desafios_unidade, já cobertos acima)',
  (select count(*) from public.recursos_catalogo where chave = 'desafios'), 1);

-- ==================== 2) mural (fotos): desliga -> bloqueia postar; já postado continua visível ====================
select t.como('lider_a');
select t.permitido('diretoria desliga o recurso "mural" no clube A', $q$select public.recurso_definir('mural', false)$q$);
reset role;
select t.como('membro_a');
select t.bloqueado('mural DESLIGADO: postar foto nova é recusado', format($q$insert into public.fotos (url, legenda, autor_id) values ('https://x.test/novo.jpg', 'Foto nova', %L)$q$, t.id('membro_a')));
select t.eq('mural DESLIGADO: a foto ANTIGA (Foto A) continua visível (leitura nunca é bloqueada)', t.n($q$select count(*) from public.fotos where legenda = 'Foto A'$q$), 1);
reset role;
select t.como('lider_a');
select t.permitido('diretoria religa o recurso "mural"', $q$select public.recurso_definir('mural', true)$q$);
reset role;
select t.como('membro_a');
select t.permitido('mural religado: postar foto volta a funcionar', format($q$insert into public.fotos (url, legenda, autor_id) values ('https://x.test/novo.jpg', 'Foto nova', %L)$q$, t.id('membro_a')));
reset role;

-- ==================== 3) mensalidades: desliga -> bloqueia criar cobrança nova; a pendente continua pagável ====================
select t.como('lider_a');
select t.permitido('diretoria desliga o recurso "mensalidades"', $q$select public.recurso_definir('mensalidades', false)$q$);
select t.como('tesoureiro_a');
select t.bloqueado('mensalidades DESLIGADO: criar cobrança nova é recusada',
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status) values (%L, 3, 2026, 40, 'pendente')$q$, t.id('membro_a')));
select t.permitido('mensalidades DESLIGADO: marcar a cobrança JÁ existente como paga continua funcionando (edição, não criação)',
  format($q$update public.mensalidades set status = 'pago' where desbravador_id = %L and mes = 1 and ano = 2026$q$, t.id('membro_a')));
reset role;
select t.como('lider_a');
select t.permitido('diretoria religa o recurso "mensalidades"', $q$select public.recurso_definir('mensalidades', true)$q$);
reset role;

-- ==================== 4) agenda (eventos): desliga -> bloqueia criar evento novo ====================
select t.como('lider_a');
select t.permitido('diretoria desliga o recurso "agenda"', $q$select public.recurso_definir('agenda', false)$q$);
select t.bloqueado('agenda DESLIGADO: criar evento novo é recusado',
  format($q$insert into public.eventos (titulo, tipo, data, criado_por) values ('Evento novo', 'Reunião', current_date + 10, %L)$q$, t.id('lider_a')));
reset role;
select t.como('membro_a');
select t.eq('agenda DESLIGADO: o evento ANTIGO (Evento A) continua visível', t.n($q$select count(*) from public.eventos where titulo = 'Evento A'$q$), 1);
reset role;
select t.como('lider_a');
select t.permitido('diretoria religa o recurso "agenda"', $q$select public.recurso_definir('agenda', true)$q$);
reset role;

-- ==================== 5) atividades (catálogo + entregas): desliga -> bloqueia os dois ====================
select t.como('lider_a');
select t.permitido('diretoria desliga o recurso "atividades"', $q$select public.recurso_definir('atividades', false)$q$);
select t.bloqueado('atividades DESLIGADO: criar atividade nova é recusado',
  format($q$insert into public.atividades (titulo, pontos, criado_por) values ('Atividade nova', 5, %L)$q$, t.id('lider_a')));
reset role;
select t.como('membro_a2');
select t.bloqueado('atividades DESLIGADO: enviar entrega nova é recusado',
  format($q$insert into public.entregas (atividade_id, usuario_id, texto) values (%L, %L, 'tentativa')$q$, t.id('atv_a'), t.id('membro_a2')));
reset role;
select t.como('lider_a');
select t.permitido('líder A ainda avalia a entrega JÁ existente (edição continua liberada)',
  $q$select public.aprovar_entrega((select id from public.entregas where texto = 'Entrega A'))$q$);
select t.permitido('diretoria religa o recurso "atividades"', $q$select public.recurso_definir('atividades', true)$q$);
reset role;

-- ==================== 6) isolamento: desligar no clube A não afeta o clube B ====================
select t.como('lider_a');
select t.permitido('diretoria A desliga "mural" (só no clube A)', $q$select public.recurso_definir('mural', false)$q$);
reset role;
select t.como('lider_b');
select t.permitido('mural continua LIGADO no clube B (recurso é por clube)', format($q$insert into public.fotos (url, legenda, autor_id) values ('https://x.test/b.jpg', 'Foto B nova', %L)$q$, t.id('lider_b')));
reset role;
select t.como('lider_a');
select t.permitido('religa de volta (não deixa o clube A destravado errado pro resto da suíte)', $q$select public.recurso_definir('mural', true)$q$);
reset role;

select t.fim();
rollback;
