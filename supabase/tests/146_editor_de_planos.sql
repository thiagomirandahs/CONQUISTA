-- EDITOR DE PLANOS (migration 540): rascunho -> publicar versão; quem assinou NÃO muda; validações; só admin da plataforma; auditoria; arquivar/descartar com trava.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('adm146', '{"tipo":"fundador","nome":"Admin 146"}'::jsonb);
insert into public.platform_admins (user_id, papel) values (t.id('adm146'), 'operacao');
-- uma assinatura viva no plano 'anual' v1 (para provar que ela NÃO muda quando sai a v2)
insert into public.billing_accounts (id, nome, status) values (public.curriculo_uuid('t146:conta'), 'Conta 146 [TESTE]', 'ativa');
insert into public.subscriptions (id, billing_account_id, plan_id, status, ciclo)
  values (public.curriculo_uuid('t146:assin'), public.curriculo_uuid('t146:conta'),
          (select id from public.billing_plans where chave = 'anual' and versao = 1), 'ativa', 'anual');
create function t.p146(p_chave text, p_versao int) returns uuid language sql as $$ select id from public.billing_plans where chave = p_chave and versao = p_versao $$;
grant execute on function t.p146(text, int) to public;
\o

-- ==================== quem pode ====================
select t.como('lider_a');
select t.throws('diretoria de clube NÃO edita plano', $$select public.admin_plano_rascunho_salvar('anual', 'x', '', true, '{}', '[]')$$, 'Sem permissão');
select t.como_anon();
select t.throws('anon não executa o editor', $$select public.admin_plano_rascunho_salvar('anual', 'x', '', true, '{}', '[]')$$, 'permission denied');
reset role;

-- ==================== rascunho da versão nova ====================
select t.como('adm146');
select public.admin_plano_rascunho_salvar('anual', 'Licença Anual 2027', 'Reajuste anual', true,
  '{"membros": 400, "administradores": 25, "fotos": null}',
  '[{"ciclo":"anual","valor_centavos":25990,"pix_centavos":22990,"parcelas_cartao":12,"parcela_centavos":2166}]') is not null;
reset role;
select t.eq('criou a v2 como RASCUNHO do plano anual', (select status from public.billing_plans where chave = 'anual' and versao = 2), 'rascunho');
select t.eq('a v2 herdou os painéis da v1 (recursos copiados)', (select recursos is not distinct from (select recursos from public.billing_plans where chave = 'anual' and versao = 1) from public.billing_plans where chave = 'anual' and versao = 2)::text, 'true');
select t.eq('limites normalizados (vazio = ilimitado some do JSON)', (select limites::text from public.billing_plans where chave = 'anual' and versao = 2), '{"membros": 400, "administradores": 25}');
select t.eq('preço e metadata do Pix/parcelas gravados',
  (select valor_centavos || '|' || (metadata ->> 'pix_centavos') || '|' || (metadata ->> 'parcelas_cartao') from public.billing_prices where plan_id = t.p146('anual', 2)), '25990|22990|12');
select t.eq('a vitrine AINDA mostra a v1 (rascunho não aparece)', (select (public.planos_disponiveis() -> 0 ->> 'versao')) , '1');
select t.eq('a v1 continua intacta', (select valor_centavos from public.billing_prices where plan_id = t.p146('anual', 1) and ciclo = 'anual'), 22990::bigint);

-- salvar de novo atualiza o MESMO rascunho (sem criar v3) e troca os preços
select t.como('adm146');
select public.admin_plano_rascunho_salvar('anual', 'Licença Anual 2027', 'Reajuste anual', true, '{"membros": 400}',
  '[{"ciclo":"anual","valor_centavos":24990},{"ciclo":"mensal","valor_centavos":2990}]') is not null;
reset role;
select t.eq('continua um único rascunho (v2)', (select count(*) from public.billing_plans where chave = 'anual' and status = 'rascunho'), 1::bigint);
select t.eq('os preços foram substituídos (2 ciclos)', (select count(*) from public.billing_prices where plan_id = t.p146('anual', 2)), 2::bigint);

-- ==================== validações ====================
select t.como('adm146');
select t.throws('limite negativo é recusado', $$select public.admin_plano_rascunho_salvar('anual', 'Nome ok', '', true, '{"membros": -1}', '[]')$$, 'inteiro maior ou igual a zero');
select t.throws('limite fracionado é recusado', $$select public.admin_plano_rascunho_salvar('anual', 'Nome ok', '', true, '{"membros": 1.5}', '[]')$$, 'inteiro');
select t.throws('limite desconhecido é recusado', $$select public.admin_plano_rascunho_salvar('anual', 'Nome ok', '', true, '{"galinhas": 3}', '[]')$$, 'Limite desconhecido');
select t.throws('ciclo inválido é recusado', $$select public.admin_plano_rascunho_salvar('anual', 'Nome ok', '', true, '{}', '[{"ciclo":"semanal","valor_centavos":100}]')$$, 'Ciclo de preço inválido');
select t.throws('ciclo repetido é recusado', $$select public.admin_plano_rascunho_salvar('anual', 'Nome ok', '', true, '{}', '[{"ciclo":"anual","valor_centavos":100},{"ciclo":"anual","valor_centavos":200}]')$$, 'repetido');
select t.throws('Pix maior que o valor cheio é recusado', $$select public.admin_plano_rascunho_salvar('anual', 'Nome ok', '', true, '{}', '[{"ciclo":"anual","valor_centavos":100,"pix_centavos":200}]')$$, 'Pix');
select t.throws('parcelas fora de 1..12 são recusadas', $$select public.admin_plano_rascunho_salvar('anual', 'Nome ok', '', true, '{}', '[{"ciclo":"anual","valor_centavos":100,"parcelas_cartao":13}]')$$, 'parcelas');
select t.throws('valor com centavos fracionados é recusado', $$select public.admin_plano_rascunho_salvar('anual', 'Nome ok', '', true, '{}', '[{"ciclo":"anual","valor_centavos":100.5}]')$$, 'Valor inválido');
select t.throws('nome curto é recusado', $$select public.admin_plano_rascunho_salvar('anual', 'ab', '', true, '{}', '[]')$$, 'nome do plano');
select t.throws('HTML no texto é recusado', $$select public.admin_plano_rascunho_salvar('anual', 'Nome <b>', '', true, '{}', '[]')$$, 'Não use');
select t.throws('chave inválida é recusada', $$select public.admin_plano_rascunho_salvar('Plano Novo!', 'Nome ok', '', true, '{}', '[]')$$, 'chave do plano');
select t.throws('o plano do clube fundador não é editável', $$select public.admin_plano_rascunho_salvar('legado-fundador', 'Nome ok', '', true, '{}', '[]')$$, 'fundador');
reset role;

-- ==================== publicar ====================
select t.como('adm146');
select t.throws('versão publicada não é publicada de novo', format($q$select public.admin_plano_publicar(%L)$q$, t.p146('anual', 1)), 'Só um rascunho');
select set_config('t146.pub', public.admin_plano_publicar(t.p146('anual', 2), 'reajuste 2027')::text, true) is not null;
reset role;
select t.eq('v2 publicada', (select status from public.billing_plans where chave = 'anual' and versao = 2), 'publicado');
select t.eq('...informando quantas assinaturas ficam na versão anterior', (current_setting('t146.pub')::json ->> 'ficam_na_versao_anterior')::int >= 1, true);
select t.eq('a vitrine passa a mostrar a v2 (nova contratação)', (public.planos_disponiveis() -> 0 ->> 'versao'), '2');
select t.eq('a assinatura existente CONTINUA na v1', (select plan_id from public.subscriptions where id = public.curriculo_uuid('t146:assin')), t.p146('anual', 1));
select t.eq('a v1 continua publicada (histórico)', (select status from public.billing_plans where chave = 'anual' and versao = 1), 'publicado');
select t.eq('o preço da v1 NÃO mudou', (select valor_centavos from public.billing_prices where plan_id = t.p146('anual', 1) and ciclo = 'anual'), 22990::bigint);
select t.eq('auditoria do salvar e do publicar', (select count(*) from public.platform_admin_audit where acao in ('plano_rascunho_salvar', 'plano_publicar') and alvo_id = t.p146('anual', 2)), 3::bigint);

-- ==================== plano novo, painéis obrigatórios, descartar ====================
select t.como('adm146');
select public.admin_plano_rascunho_salvar('basico-146', 'Básico 146', 'Plano de teste', true, '{"membros": 30}', '[{"ciclo":"mensal","valor_centavos":990}]') is not null;
select t.throws('plano novo sem painéis não publica', format($q$select public.admin_plano_publicar(%L)$q$, t.p146('basico-146', 1)), 'painéis');
select public.admin_plano_rascunho_descartar(t.p146('basico-146', 1)) is not null;
reset role;
select t.eq('rascunho descartado some (plano e preço)', (select count(*) from public.billing_plans where chave = 'basico-146'), 0::bigint);
select t.como('adm146');
select t.throws('versão publicada nunca se descarta', format($q$select public.admin_plano_rascunho_descartar(%L)$q$, t.p146('anual', 1)), 'Só um rascunho');

-- ==================== vitrine e arquivar ====================
select public.admin_plano_visibilidade_definir(t.p146('anual', 2), false) is not null;
reset role;
select t.eq('oculto na vitrine não aparece', (select count(*) from public.billing_plans p where p.chave = 'anual' and p.versao = 2 and p.publico), 0::bigint);
select t.como('adm146');
select public.admin_plano_visibilidade_definir(t.p146('anual', 2), true) is not null;
select t.throws('não arquiva versão com assinatura viva', format($q$select public.admin_plano_arquivar(%L)$q$, t.p146('anual', 1)), 'assinatura');
select t.throws('legado-fundador nunca é arquivado', format($q$select public.admin_plano_arquivar(%L)$q$, (select id from public.billing_plans where chave = 'legado-fundador' order by versao desc limit 1)), 'fundador');
select t.throws('legado-fundador não muda de vitrine', format($q$select public.admin_plano_visibilidade_definir(%L, true)$q$, (select id from public.billing_plans where chave = 'legado-fundador' order by versao desc limit 1)), 'fundador');
reset role;

-- ==================== listagem com metadata do preço ====================
select t.como('adm146');
select t.ok('admin_planos_listar traz o metadata do preço (Pix/parcelas)', (select bool_or((pr ->> 'metadata') like '%pix_centavos%') from json_array_elements(public.admin_planos_listar()) p, json_array_elements(p -> 'precos') pr));
reset role;
select t.fim();
rollback;
