-- Migration 290: CENTRAL DE CHAMADOS (suporte por ticket).
begin;
\ir _lib.sql
\ir _fixtures.sql

-- admin da plataforma COM vínculo (lider_a) — recebe sino/push; e um admin sem vínculo nenhum.
reset role;
insert into public.platform_admins (user_id, papel, motivo) values (t.id('lider_b'), 'owner', 'teste 83');
select t.signup('admin83', '{"tipo":"fundador","nome":"Admin 83"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin83'), 'suporte', 'teste 83');

select t.ok('anon sem EXECUTE nas RPCs', not has_function_privilege('anon', 'public.suporte_chamado_abrir(text, text, text, text, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.admin_chamados_listar(text)', 'execute'));
select t.ok('sem leitura direta das tabelas', not has_table_privilege('authenticated', 'public.suporte_chamados', 'select')
  and not has_table_privilege('authenticated', 'public.suporte_mensagens', 'select'));
select t.ok('helpers internos fechados', not has_function_privilege('authenticated', 'public._suporte_notificar(uuid, text, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.suporte_rotina()', 'execute'));
select t.ok('bucket privado', not (select public from storage.buckets where id = 'suporte-anexos'));

-- ==================== 1) autor abre; contexto filtrado; admin notificado ====================
select t.como('membro_a');
select t.permitido('membro abre chamado', $q$select public.suporte_chamado_abrir('problema', 'App <b>trava</b>', 'Quando abro o ranking ele fecha sozinho.', null, 'urgente',
  '{"versao":"1.2","rota":"/ranking","senha":"123","token":"abc","aparelho":"Android 14"}'::jsonb)$q$);
reset role;
create temp table ch as select id, contexto, assunto, prioridade, prioridade_sugerida from public.suporte_chamados where autor_id = t.id('membro_a');
grant select on ch to authenticated;
select t.eq('HTML removido do assunto', (select assunto from ch), 'App trava');
select t.ok('contexto sem senha/token', not ((select contexto from ch) ? 'senha') and not ((select contexto from ch) ? 'token')
  and (select contexto from ch) ->> 'rota' = '/ranking');
select t.ok('prioridade sugerida ignorada para quem não é diretoria', (select prioridade_sugerida from ch) is null and (select prioridade from ch) = 'normal');
select t.eq('admin com vínculo recebeu notificação', (select count(*) from public.notificacoes
  where para_usuario = t.id('lider_b') and tipo = 'suporte'), 1::bigint);
select t.ok('notificação do admin carrega evento de push', (select push_evento_id is not null from public.notificacoes
  where para_usuario = t.id('lider_b') and tipo = 'suporte' limit 1));
select t.eq('autor não notifica a si mesmo', (select count(*) from public.notificacoes where para_usuario = t.id('membro_a') and tipo = 'suporte'), 0::bigint);

select t.como('membro_a');
select t.eq('autor vê o próprio chamado', t.n('select jsonb_array_length(public.suporte_meus_chamados())'), 1);

-- ==================== 2) outro usuário não vê ====================
select t.como('membro_a2');
select t.eq('outro usuário não lista', t.n('select jsonb_array_length(public.suporte_meus_chamados())'), 0);
select t.throws('outro usuário não abre', format('select public.suporte_chamado_ver(%L)', (select id from ch)), 'não encontrado');
select t.throws('outro usuário não responde', format('select public.suporte_chamado_responder(%L, %L)', (select id from ch), 'oi'), 'não encontrado');
select t.como('lider_a');
select t.throws('diretoria do clube não vê chamado do membro', format('select public.suporte_chamado_ver(%L)', (select id from ch)), 'não encontrado');
select t.throws('não-admin não lista a fila', 'select public.admin_chamados_listar()', 'Sem permissão');

-- ==================== 3) admin vê todos; nota interna invisível ====================
select t.como('admin83');
select t.eq('admin vê a fila', t.n('select jsonb_array_length(public.admin_chamados_listar(''abertos''))'), 1);
select t.eq('contador de abertos', t.n('select public.admin_chamados_contagem()'), 1);
select t.permitido('admin escreve nota interna', format('select public.admin_chamado_responder(%L, %L, true)', (select id from ch), 'Suspeita: cache'));
select t.permitido('admin responde', format('select public.admin_chamado_responder(%L, %L)', (select id from ch), 'Pode atualizar o app?'));
select t.eq('admin vê as 3 mensagens', t.n(format('select jsonb_array_length(public.admin_chamado_ver(%L)->''mensagens'')', (select id from ch))), 3);
select t.eq('status aguardando usuário', t.txt(format('select public.admin_chamado_ver(%L)->>''status''', (select id from ch))), 'aguardando_usuario');
select t.eq('filtro meus', t.n('select jsonb_array_length(public.admin_chamados_listar(''meus''))'), 1);
reset role;
select t.eq('auditoria das ações do admin', (select count(*) from public.platform_admin_audit where alvo_tipo = 'suporte_chamado' and alvo_id = (select id from ch)), 2::bigint);
select t.eq('autor notificado da resposta (não da nota)', (select count(*) from public.notificacoes where para_usuario = t.id('membro_a') and tipo = 'suporte'), 1::bigint);

select t.como('membro_a');
select t.eq('autor vê 2 mensagens (sem a nota interna)', t.n(format('select jsonb_array_length(public.suporte_chamado_ver(%L)->''mensagens'')', (select id from ch))), 2);
select t.ok('texto da nota não aparece ao autor', position('cache' in t.txt(format('select public.suporte_chamado_ver(%L)::text', (select id from ch)))) = 0);
select t.permitido('autor responde', format('select public.suporte_chamado_responder(%L, %L)', (select id from ch), 'Atualizei e continua'));
select t.eq('volta a aberto', t.txt(format('select public.suporte_chamado_ver(%L)->>''status''', (select id from ch))), 'aberto');

-- ==================== 4) reabrir até 7 dias; depois não ====================
select t.como('admin83');
select t.permitido('admin resolve', format('select public.admin_chamado_atualizar(%L, %L)', (select id from ch), 'resolvido'));
select t.como('membro_a');
select t.permitido('autor reabre em até 7 dias', format('select public.suporte_chamado_responder(%L, %L)', (select id from ch), 'Voltou a acontecer'));
select t.eq('reaberto', t.txt(format('select public.suporte_chamado_ver(%L)->>''status''', (select id from ch))), 'aberto');
reset role;
update public.suporte_chamados set status = 'resolvido', resolvido_em = now() - interval '8 days' where id = (select id from ch);
select t.como('membro_a');
select t.throws('depois de 7 dias não reabre', format('select public.suporte_chamado_responder(%L, %L)', (select id from ch), 'e agora?'), 'encerrado');
reset role;
select public.suporte_rotina();
select t.eq('rotina fecha resolvido antigo', (select status from public.suporte_chamados where id = (select id from ch)), 'fechado');

-- ==================== 5) diretoria sugere prioridade; rate limit; anexo ====================
select t.como('lider_a');
select t.permitido('diretoria abre com prioridade', $q$select public.suporte_chamado_abrir('pagamento', 'Cobrança duplicada', 'Veio duas cobranças no cartão.', null, 'alta', '{}'::jsonb)$q$);
reset role;
select t.eq('prioridade sugerida da diretoria vale', (select prioridade from public.suporte_chamados where autor_id = t.id('lider_a')), 'alta');

select t.como('membro_a2');
select t.throws('anexo de outra pasta é recusado', format($q$select public.suporte_chamado_abrir('duvida', 'Assunto', 'Descrição longa o bastante', %L)$q$,
  t.id('membro_a')::text || '/' || gen_random_uuid()::text || '.png'), 'Anexo inválido');
select t.throws('anexo inexistente é recusado', format($q$select public.suporte_chamado_abrir('duvida', 'Assunto', 'Descrição longa o bastante', %L)$q$,
  t.id('membro_a2')::text || '/' || gen_random_uuid()::text || '.png'), 'não encontrado');
select t.throws('descrição curta', $q$select public.suporte_chamado_abrir('duvida', 'Assunto', 'curta')$q$, '10 a 4000');
select t.permitido('1', $q$select public.suporte_chamado_abrir('duvida', 'Pergunta 1', 'Descrição longa o bastante')$q$);
select t.permitido('2', $q$select public.suporte_chamado_abrir('duvida', 'Pergunta 2', 'Descrição longa o bastante')$q$);
select t.permitido('3', $q$select public.suporte_chamado_abrir('duvida', 'Pergunta 3', 'Descrição longa o bastante')$q$);
select t.permitido('4', $q$select public.suporte_chamado_abrir('duvida', 'Pergunta 4', 'Descrição longa o bastante')$q$);
select t.permitido('5', $q$select public.suporte_chamado_abrir('duvida', 'Pergunta 5', 'Descrição longa o bastante')$q$);
select t.throws('6º chamado em 24h é bloqueado', $q$select public.suporte_chamado_abrir('duvida', 'Pergunta 6', 'Descrição longa o bastante')$q$, 'Limite de 5');

-- anexo válido: objeto na pasta do próprio usuário
reset role;
insert into storage.objects (bucket_id, name, owner) values ('suporte-anexos', t.id('membro_b')::text || '/11111111-1111-1111-1111-111111111111.png', t.id('membro_b'));
select t.como('membro_b');
select t.permitido('abre com anexo próprio', format($q$select public.suporte_chamado_abrir('problema', 'Print do erro', 'Segue o print do erro.', %L)$q$,
  t.id('membro_b')::text || '/11111111-1111-1111-1111-111111111111.png'));
select t.ok('autor pode ler o anexo', public._suporte_pode_ler_anexo(t.id('membro_b')::text || '/11111111-1111-1111-1111-111111111111.png'));
select t.como('membro_a');
select t.ok('outro usuário não lê o anexo', not public._suporte_pode_ler_anexo(t.id('membro_b')::text || '/11111111-1111-1111-1111-111111111111.png'));
select t.como('admin83');
select t.ok('admin lê o anexo', public._suporte_pode_ler_anexo(t.id('membro_b')::text || '/11111111-1111-1111-1111-111111111111.png'));

select t.fim();
rollback;
