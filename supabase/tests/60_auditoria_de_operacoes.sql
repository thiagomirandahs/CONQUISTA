-- =============================================================================
--  Fase 9, item 7 — as operações críticas deixam rastro, e a telemetria não guarda segredo
--  (migration 77).
--
--  A pergunta do item, para cada operação: QUEM fez, O QUÊ, em QUAL clube, QUANDO. As respostas
--  aqui são lidas do BANCO. E a outra metade, que num produto de crianças pesa mais: o rastro não
--  guarda senha, token, código de entrada nem e-mail — e só a operação da plataforma o lê.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.mk('novato', 'Novato Pendente', 'desbravador', 'pendente', 'clube_a', 'A1');
-- a última linha de auditoria de uma operação sobre um alvo, num formato comparável
create function t.ultima(p_operacao text, p_alvo uuid) returns text language sql security definer set search_path = '' as $$
  select concat_ws('|', coalesce(a.ator::text, 'rotina'), a.club_id::text, a.detalhe::text)
    from public.auditoria_operacoes a
   where a.operacao = p_operacao and a.alvo is not distinct from p_alvo
   order by a.id desc limit 1;
$$;
create function t.linha(p_operacao text, p_alvo uuid) returns public.auditoria_operacoes language sql security definer set search_path = '' as $$
  select * from public.auditoria_operacoes where operacao = p_operacao and alvo is not distinct from p_alvo order by id desc limit 1;
$$;
\o

-- =============================================================================
--  1. VÍNCULO: aprovar, suspender, reativar — a operação que dá e tira acesso a crianças
-- =============================================================================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select public.vinculo_gerir(p_user_id => t.id('novato'), p_status => 'ativo');
reset role;
select t.eq('[vínculo] a APROVAÇÃO ficou registrada: quem aprovou, em que clube, pendente → ativo',
  (select concat_ws('|', ator = t.id('lider_a'), club_id = t.id('clube_a'), detalhe->'status'->>0, detalhe->'status'->>1)
     from t.linha('vinculo_alterado', t.id('novato'))), 't|t|pendente|ativo');

select t.como('lider_b'); select t.pedir_clube('clube_b');
select public.vinculo_inativar(t.id('membro_b'), 'saiu_do_clube');
reset role;
select t.eq('[vínculo] a SUSPENSÃO ficou registrada: quem, onde, sobre quem, e de ativo para fora',
  (select concat_ws('|', ator = t.id('lider_b'), club_id = t.id('clube_b'), alvo = t.id('membro_b'),
                    detalhe->'status'->>0, (detalhe->'status'->>1) <> 'ativo')
     from t.linha('vinculo_alterado', t.id('membro_b'))), 't|t|t|ativo|t');

select t.como('lider_b'); select t.pedir_clube('clube_b');
select public.vinculo_gerir(p_user_id => t.id('membro_b'), p_papel => 'conselheiro');
reset role;
select t.ok('[vínculo] a troca de PAPEL também — e só o que mudou entra no detalhe',
  (select detalhe ? 'papel' and not detalhe ? 'status' from t.linha('vinculo_alterado', t.id('membro_b'))));

-- um vínculo criado por rotina do banco (sem sessão) aparece como rotina, não como alguém.
-- t.como_cron() e não só `reset role`: o sub do JWT anterior continua na transação até ser limpo.
select t.como_cron();
select t.mk2('membro_a', 'desbravador', 'ativo', 'clube_b', 'B1');
select t.ok('[vínculo] o que nasce sem sessão fica marcado como ROTINA (ator nulo), sem inventar autor',
  (select ator is null from t.linha('vinculo_criado', t.id('membro_a'))));

-- =============================================================================
--  2. SENHA redefinida pela liderança: na política do Auth, e registrada — sem a senha
-- =============================================================================
-- O alvo é membro_a2 (só do clube A). membro_a ganhou um vínculo em B na seção 1, e desde a
-- migration 80 a liderança de um clube não troca a senha de quem participa de outro (a senha é uma
-- só para todos os clubes da pessoa) — a recusa é provada logo abaixo, e no teste 61.
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('[senha] "123456" é recusada (antes: aceita — 6 sem exigência contornava a política da 8.1)',
  $q$select public.resetar_senha_membro(t.id('membro_a2'), '123456')$q$, '8 caracteres');
select t.throws('[senha] 8 letras sem número também', $q$select public.resetar_senha_membro(t.id('membro_a2'), 'abcdefgh')$q$, 'letras e números');
select t.permitido('[senha] 8 com letras e números passa', $q$select public.resetar_senha_membro(t.id('membro_a2'), 'NovaSenha2026')$q$);
select t.throws('[senha] ...mas não para quem também participa de outro clube (membro_a, agora em A e B)',
  $q$select public.resetar_senha_membro(t.id('membro_a'), 'NovaSenha2026')$q$, 'outro clube');
reset role;
select t.eq('[senha] a redefinição ficou registrada: quem, em que clube, sobre quem',
  (select concat_ws('|', ator = t.id('lider_a'), club_id = t.id('clube_a'), alvo = t.id('membro_a2'))
     from t.linha('senha_redefinida', t.id('membro_a2'))), 't|t|t');
select t.eq('[senha] ...e a senha NÃO está em lugar nenhum da trilha',
  (select count(*) from public.auditoria_operacoes a where a::text like '%NovaSenha2026%'), 0);

-- =============================================================================
--  3. RECURSO ligado/desligado
-- =============================================================================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select public.recurso_definir('chat', false);
reset role;
select t.eq('[recurso] desligar o chat ficou registrado: quem, onde, qual, como ficou',
  (select concat_ws('|', a.ator = t.id('lider_a'), a.club_id = t.id('clube_a'), a.detalhe->>'recurso', a.detalhe->>'ligado')
     from public.auditoria_operacoes a where a.operacao = 'recurso_alterado' order by a.id desc limit 1), 't|t|chat|false');

-- =============================================================================
--  4. QUEM LÊ: só a operação da plataforma
-- =============================================================================
select t.como('membro_a');
select t.eq('[leitura] o membro não lê a trilha', t.nv('select count(*) from public.auditoria_operacoes'), 0);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('[leitura] nem a DIRETORIA do clube (é operação da plataforma)', t.nv('select count(*) from public.auditoria_operacoes'), 0);
select t.eq('[leitura] ...e o painel devolve vazio para ela', t.nv('select count(*) from public.painel_operacoes(72)'), 0);
select t.throws('[escrita] ninguém escreve na trilha direto', $q$insert into public.auditoria_operacoes (operacao) values ('forjada')$q$);
reset role;
\o /dev/null
insert into public.platform_admins (user_id, papel) values (t.id('lider_b'), 'suporte') on conflict do nothing;
\o
select t.como('lider_b');
select t.ok('[leitura] a operação da plataforma lê pelo painel', t.nv('select count(*) from public.painel_operacoes(72)') >= 5);
reset role;

-- =============================================================================
--  5. TELEMETRIA DE ERRO SEM SEGREDO — no servidor, não só no cliente
-- =============================================================================
select t.como('membro_a'); select t.pedir_clube('clube_a');
\o /dev/null
select public.registrar_erro('ui', 'correlacao-t60-a', '/cadastro#convite=0123456789abcdef0123456789abcdef0123456789abcdef', 'x', 'X', 'ua');
select public.registrar_erro('ui', 'correlacao-t60-b', '/verificar/TOKENDODOCUMENTO42', 'x', 'X', 'ua');
select public.registrar_erro('ui', 'correlacao-t60-c', '/entrar', 'O código A1B2C3D4E5F60718 não existe', 'X', 'ua');
select public.registrar_erro('ui', 'correlacao-t60-d', '/eu', 'Falhou para crianca@exemplo.com', 'X', 'ua');
select public.registrar_erro('ui', 'correlacao-t60-e', '/avaliar/' || t.id('membro_b')::text, 'x', 'X', 'ua');
-- migration 79: a SEGUNDA rota com token de documento, e o token no formato real (20 maiúsculas/dígitos)
select public.registrar_erro('ui', 'correlacao-t60-f', '/documento/7V8XC44WJ1NTYHMEK0ER', 'Documento 7V8XC44WJ1NTYHMEK0ER não abriu', 'X', 'ua');
\o
reset role;
select t.eq('[telemetria] o FRAGMENTO some (é onde anda #convite=<token>)',
  t.txt($q$select rota from public.app_erros where correlacao = 'correlacao-t60-a'$q$), '/cadastro');
select t.eq('[telemetria] /documento/:token também (a 77 só conhecia /verificar) — e o mesmo token no texto',
  t.txt($q$select rota || ' | ' || contexto from public.app_erros where correlacao = 'correlacao-t60-f'$q$),
  '/documento/:token | Documento [segredo] não abriu');
select t.eq('[telemetria] o token do DOCUMENTO no caminho vira marcador',
  t.txt($q$select rota from public.app_erros where correlacao = 'correlacao-t60-b'$q$), '/verificar/:token');
select t.eq('[telemetria] um código de entrada completo no texto vira marcador',
  t.txt($q$select contexto from public.app_erros where correlacao = 'correlacao-t60-c'$q$), 'O código [segredo] não existe');
select t.eq('[telemetria] e-mail no texto vira marcador',
  t.txt($q$select contexto from public.app_erros where correlacao = 'correlacao-t60-d'$q$), 'Falhou para [e-mail]');
select t.eq('[telemetria] ...mas o UUID de um registro continua (é o que permite reproduzir o erro)',
  t.txt($q$select rota from public.app_erros where correlacao = 'correlacao-t60-e'$q$), '/avaliar/' || t.id('membro_b')::text);
select t.eq('[telemetria] nenhum dos segredos está em coluna nenhuma',
  t.n($q$select count(*) from public.app_erros e where e::text ~ '(0123456789abcdef0123456789abcdef|TOKENDODOCUMENTO42|A1B2C3D4E5F60718|crianca@exemplo|7V8XC44WJ1NTYHMEK0ER)'$q$), 0);

select t.fim();
rollback;
