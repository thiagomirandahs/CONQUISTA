-- Prioridade 4: a liderança de um clube NÃO opera dados, RPCs, configurações nem
-- comprovantes de outro clube. Aqui: liderança do clube B (Tenant 002) — positivo
-- no clube B e todas as tentativas de operar o clube A (Tenant 001) barradas.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.mk('temp_b', 'Temporário B', 'desbravador', 'ativo', 'clube_b', 'B1');
insert into public.entregas (atividade_id, usuario_id, texto) values (t.id('atv_b'), t.id('temp_b'), 'Entrega B2');
insert into t.ids select 'ent_b2', id from public.entregas where texto = 'Entrega B2';

-- guarda o estado do clube A para provar, no fim, que nada mudou
select (select encrypted_password from auth.users where id = t.id('membro_a')) as hash_a,
       (select valor from public.config_clube where chave = 'pix' and club_id = t.id('clube_a')) as pix_a,
       (select count(*) from public.pontos where club_id = t.id('clube_a')) as pontos_a
\gset
insert into public.leiloes (titulo, fecha_em, criado_por) values ('Leilão do clube A', now() + interval '3 days', t.id('lider_a'));
insert into t.ids select 'leilao_a', id from public.leiloes where titulo = 'Leilão do clube A';
insert into public.leilao_itens (leilao_id, nome, preco_base, ordem) values (t.id('leilao_a'), 'Prêmio A', 10, 1);
insert into t.ids select 'item_a', id from public.leilao_itens where leilao_id = t.id('leilao_a');

-- ================= positivo: líder B opera o PRÓPRIO clube =================
select t.como('lider_b');
select t.permitido('líder B cria unidade (clube preenchido sozinho)', $q$insert into public.unidades (nome) values ('Nova Unidade B')$q$);
select t.permitido('líder B cria atividade', $q$insert into public.atividades (titulo, pontos) values ('Nova Atividade B', 5)$q$);
select t.permitido('líder B cria evento', $q$insert into public.eventos (titulo, tipo, data) values ('Novo Evento B', 'Reunião', current_date + 1)$q$);
select t.permitido('líder B cria aviso geral', format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por) values ('Aviso novo B', 'x', 'geral', '/', 'todos', %L)$q$, t.id('lider_b')));
select t.eq('líder B aprova entrega do clube B', t.txt(format('select (public.aprovar_entrega(%L))->>''ok''', t.id('ent_b'))), 'true');
select t.permitido('líder B lança pontos na unidade B1', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por) values (%L, 'unidade', 3, 'manual', %L)$q$, t.id('B1'), t.id('lider_b')));
select t.permitido('líder B salva reunião de membro do clube B', format($q$select public.salvar_reuniao(current_date, 'Reunião B', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('usuario_id', t.id('membro_b'), 'pontos', 5))::text));
select t.permitido('líder B lança colocação em unidade do clube B', format($q$select public.lancar_colocacao_acampamento('Teste B', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('unidade_id', t.id('B1'), 'posicao', 1, 'pontos', 30))::text));
select t.permitido('líder B abre nova temporada do clube B', $q$select public.nova_temporada('Membro B', 'Teste B1')$q$);
select t.permitido('líder B cria convite de responsável do clube B', $q$select public.criar_convite_responsavel()$q$);
select t.permitido('líder B redefine senha de membro do clube B', format($q$select public.resetar_senha_membro(%L, 'senha-nova-b-123')$q$, t.id('membro_b')));
select t.permitido('líder B (diretoria) exclui usuário do clube B', format('select public.excluir_usuario(%L)', t.id('temp_b')));
select t.permitido('líder B gere mensalidades do clube B', format($q$update public.mensalidades set status = 'pago' where desbravador_id = %L$q$, t.id('membro_b')));
select t.eq('líder B lista só gente do clube B', t.n($q$select count(*) from public.listar_usuarios() where nome in ('Lider A','Membro A','Pais A','Instrutor A')$q$), 0);
select t.ok('líder B lista o membro_b em listar_usuarios', t.n(format('select count(*) from public.listar_usuarios() where id = %L', t.id('membro_b'))) = 1);
select t.eq('líder B lê o comprovante do PRÓPRIO clube', t.n(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and owner = %L$q$, t.id('membro_b'))), 1);
reset role;
select t.eq('temporada do clube B foi encerrada e reaberta', (select count(*) from public.temporadas where club_id = t.id('clube_b')), 2);
select t.eq('a unidade criada ficou no clube B', (select club_id from public.unidades where nome = 'Nova Unidade B'), t.id('clube_b'));
select t.eq('o evento criado ficou no clube B', (select club_id from public.eventos where titulo = 'Novo Evento B'), t.id('clube_b'));
select t.eq('o aviso criado ficou no clube B', (select club_id from public.notificacoes where titulo = 'Aviso novo B'), t.id('clube_b'));
select t.eq('a temporada do clube A NÃO foi mexida', (select count(*) from public.temporadas where club_id = t.id('clube_a') and fim is null), 1);

-- ================= negativo: líder B tenta operar o clube A =================
select t.como('lider_b');
select t.throws('líder B NÃO redefine senha de membro do clube A', format($q$select public.resetar_senha_membro(%L, 'invasao-123')$q$, t.id('membro_a')), 'permiss');
select t.throws('líder B NÃO exclui usuário do clube A', format('select public.excluir_usuario(%L)', t.id('membro_a')));
select t.throws('líder B NÃO aprova entrega do clube A', format('select public.aprovar_entrega(%L)', t.id('ent_a')), 'permiss');
select t.throws('líder B NÃO lança colocação em unidade do clube A', format($q$select public.lancar_colocacao_acampamento('Invasão', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('unidade_id', t.id('A1'), 'posicao', 1, 'pontos', 999))::text));
select t.throws('líder B NÃO aponta membro do clube A', format($q$select public.salvar_reuniao(current_date, 'Invasão', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('usuario_id', t.id('membro_a'), 'pontos', 99))::text), 'permiss');
select t.bloqueado('líder B NÃO lança pontos no clube A (unidade)', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo) values (%L, 'unidade', 999, 'invasão')$q$, t.id('A1')));
select t.bloqueado('líder B NÃO lança pontos no clube A (membro)', format($q$insert into public.pontos (usuario_id, origem, pontos, motivo) values (%L, 'manual', 999, 'invasão')$q$, t.id('membro_a')));
select t.bloqueado('líder B NÃO edita perfil do clube A', format($q$update public.profiles set papel = 'diretoria' where id = %L$q$, t.id('membro_a')));
select t.bloqueado('líder B NÃO apaga foto do clube A', $q$delete from public.fotos where legenda = 'Foto A'$q$);
select t.bloqueado('líder B NÃO edita mensalidade do clube A', format($q$update public.mensalidades set status = 'pago' where desbravador_id = %L$q$, t.id('membro_a')));
select t.bloqueado('líder B NÃO cria evento no clube A', format($q$insert into public.eventos (titulo, data, club_id) values ('invasão', current_date, %L)$q$, t.id('clube_a')));
select t.tenta(format($q$insert into public.notificacoes (titulo, para, criado_por, club_id) values ('invasão A', 'todos', %L, %L)$q$, t.id('lider_b'), t.id('clube_a')));
select t.bloqueado('líder B NÃO manda aviso pessoal a membro do clube A', format($q$insert into public.notificacoes (titulo, para, para_usuario, criado_por) values ('invasão', 'pessoal', %L, %L)$q$, t.id('membro_a'), t.id('lider_b')));
select t.bloqueado('líder B NÃO liga recurso no clube A', format($q$update public.club_features set metadata = '{"x":1}' where club_id = %L$q$, t.id('clube_a')));

-- leilão (recurso do clube A): nada de criar, encerrar, cancelar nem dar lance
select t.throws('líder B NÃO cria leilão', format($q$select public.criar_leilao('Invasão', now() + interval '2 days', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('nome','P','preco_base',10))::text));
select t.throws('líder B NÃO cancela o leilão do clube A', format('select public.cancelar_leilao(%L)', t.id('leilao_a')));
select t.throws('líder B NÃO encerra o leilão do clube A', format('select public.encerrar_leilao(%L)', t.id('leilao_a')));
select t.eq('líder B NÃO vê leilão do clube A', t.nv('select count(*) from public.leiloes'), 0);
select t.eq('líder B NÃO vê itens do leilão do clube A', t.nv('select count(*) from public.leilao_itens'), 0);

-- configuração do clube A (PIX etc.)
select t.eq('líder B NÃO lê a config do clube A', t.nv(format($q$select count(*) from public.config_clube where club_id = %L$q$, t.id('clube_a'))), 0);
select t.bloqueado('líder B NÃO altera o PIX do clube A', format($q$update public.config_clube set valor = 'PIX-DO-ATACANTE' where chave = 'pix' and club_id = %L$q$, t.id('clube_a')));
select t.bloqueado('líder B NÃO cria config nova NO CLUBE A', format($q$insert into public.config_clube (club_id, chave, valor) values (%L, 'atacante', 'x')$q$, t.id('clube_a')));

-- comprovantes privados de menores do clube A
select t.eq('líder B NÃO lê comprovante do clube A (storage)', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and owner = %L$q$, t.id('membro_a'))), 0);

-- "reino legado" (chat, missões, jogos, pets): fechado para outro clube, sem vazar nem gravar
reset role;
select t.como('membro_a');
select public.chat_enviar_geral('mensagem do clube A');
select public.registrar_missao(null, 0);
select t.como('lider_b');
select t.eq('líder B NÃO lê o chat geral do clube A', t.nv('select count(*) from public.chat_mensagens'), 0);
select t.eq('líder B NÃO lê missões feitas do clube A', t.nv('select count(*) from public.missoes_feitas'), 0);
select t.eq('líder B NÃO vê conversas de moderação do chat', t.nv('select count(*) from public.chat_todas_conversas()'), 0);
select t.eq('líder B NÃO vê pets do clube A', t.nv('select count(*) from public.pets_do_clube()'), 0);
select t.eq('líder B NÃO lista missões pendentes do clube A', t.nv('select count(*) from public.missoes_pendentes()'), 0);
select t.throws('líder B NÃO usa atividade_jogos (painel do clube A)', 'select public.atividade_jogos()');
select t.como('membro_b');
select t.throws('membro B NÃO escreve no chat geral do clube A', $q$select public.chat_enviar_geral('invasão')$q$);
-- (missão/devocional do clube B: agora funcionam no PRÓPRIO clube — ver 15_missoes_e_devocional_por_clube)

-- ================= o clube A ficou exatamente como estava =================
reset role;
select t.eq('senha do membro_a intacta', (select encrypted_password = :'hash_a' from auth.users where id = t.id('membro_a')), true);
select t.eq('PIX do clube A intacto', (select valor from public.config_clube where chave = 'pix' and club_id = t.id('clube_a')), :'pix_a');
select t.eq('aviso com club_id forjado NÃO foi parar no clube A', (select count(*) from public.notificacoes where titulo = 'invasão A' and club_id = t.id('clube_a')), 0);
select t.eq('leilão do clube A segue aberto', (select status from public.leiloes where id = t.id('leilao_a')), 'aberto');
select t.eq('membro_a e perfis do clube A intactos', (select papel from public.profiles where id = t.id('membro_a')), 'desbravador');
select t.eq('entrega A intacta (segue pendente)', (select status from public.entregas where id = t.id('ent_a')), 'pendente');
select t.eq('nenhum ponto novo no clube A', (select count(*) from public.pontos where club_id = t.id('clube_a') and origem <> 'missao'), :'pontos_a'::bigint);

select t.fim();
rollback;
