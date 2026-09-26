-- Liderança do Tenant 001 (clube A, legado): TEM que conseguir operar o próprio
-- clube (o Tenant 001 é produção!), cada papel nos seus limites, e nunca enxerga
-- nem altera o clube B. Inclui o "recurso opcional" (leilão) valendo NO BANCO.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.mk('temp_a', 'Temporário A', 'desbravador', 'ativo', 'clube_a', 'A2');
select t.mk('temp_a2', 'Temporário A2 (desativado)', 'desbravador', 'inativo', 'clube_a', 'A2');
insert into public.entregas (atividade_id, usuario_id, texto) values (t.id('atv_a'), t.id('membro_a2'), 'Entrega A2');
insert into public.entregas (atividade_id, usuario_id, texto) values (t.id('atv_a'), t.id('conselheiro_a'), 'Entrega A3');
insert into t.ids select 'ent_a2', id from public.entregas where texto = 'Entrega A2';
insert into t.ids select 'ent_a3', id from public.entregas where texto = 'Entrega A3';
insert into public.atividades (titulo, pontos, club_id) values ('Atividade A2', 7, t.id('clube_a'));
insert into t.ids select 'atv_a2', id from public.atividades where titulo = 'Atividade A2';

-- ================= líder A (diretoria): leitura do próprio clube =================
select t.como('lider_a');
select t.eq('líder A vê as unidades do clube A', t.n($q$select count(*) from public.unidades where nome in ('Teste A1','Teste A2')$q$), 2);
select t.eq('líder A NÃO vê unidade do clube B', t.nv($q$select count(*) from public.unidades where nome = 'Teste B1'$q$), 0);
select t.eq('líder A vê perfil do membro_a', t.n(format('select count(*) from public.profiles where id = %L', t.id('membro_a'))), 1);
select t.eq('líder A vê o responsável pais_a do próprio clube', t.n(format('select count(*) from public.profiles where id = %L', t.id('pais_a'))), 1);
select t.eq('líder A NÃO vê perfis do clube B', t.nv(format('select count(*) from public.profiles where id in (%L, %L, %L)', t.id('lider_b'), t.id('membro_b'), t.id('pais_b'))), 0);
select t.eq('líder A vê a foto do clube A', t.n($q$select count(*) from public.fotos where legenda = 'Foto A'$q$), 1);
select t.eq('líder A NÃO vê a foto do clube B', t.nv($q$select count(*) from public.fotos where legenda = 'Foto B'$q$), 0);
select t.eq('líder A vê os pontos do clube A', t.n($q$select count(*) from public.pontos where motivo in ('Ponto membro A','Ponto unidade A1')$q$), 2);
select t.eq('líder A NÃO vê pontos do clube B', t.nv($q$select count(*) from public.pontos where motivo in ('Ponto membro B','Ponto unidade B1')$q$), 0);
select t.eq('líder A lê o comprovante privado do membro_a', t.n(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and owner = %L$q$, t.id('membro_a'))), 1);
select t.eq('líder A NÃO lê comprovante do clube B', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and owner = %L$q$, t.id('membro_b'))), 0);
select t.eq('líder A lê a config do clube (PIX)', t.n($q$select count(*) from public.config_clube where chave = 'pix'$q$), 1);

-- ================= líder A: escrita no próprio clube =================
select t.permitido('líder A cria unidade (clube preenchido sozinho)', $q$insert into public.unidades (nome) values ('Nova Unidade A')$q$);
select t.permitido('líder A cria atividade', $q$insert into public.atividades (titulo, pontos) values ('Nova Atividade A', 5)$q$);
select t.permitido('líder A cria evento', $q$insert into public.eventos (titulo, tipo, data) values ('Novo Evento A', 'Reunião', current_date + 1)$q$);
select t.permitido('líder A cria aviso geral', format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por) values ('Aviso novo A', 'x', 'geral', '/', 'todos', %L)$q$, t.id('lider_a')));
select t.permitido('líder A lança pontos a um membro', format($q$insert into public.pontos (usuario_id, origem, pontos, motivo, lancado_por) values (%L, 'manual', 3, 'manual', %L)$q$, t.id('membro_a'), t.id('lider_a')));
select t.permitido('líder A lança pontos a uma unidade', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por) values (%L, 'unidade', 3, 'manual', %L)$q$, t.id('A1'), t.id('lider_a')));
select t.permitido('líder A aprova entrega do clube A', format('select public.aprovar_entrega(%L)', t.id('ent_a')));
select t.permitido('líder A salva reunião (apontamento) de membros do clube', format($q$select public.salvar_reuniao(current_date, 'Reunião teste', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('usuario_id', t.id('membro_a'), 'pontos', 5, 'marca', jsonb_build_object('presenca','presente')))::text));
select t.permitido('líder A lança colocação de acampamento em unidade do clube', format($q$select public.lancar_colocacao_acampamento('Teste', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('unidade_id', t.id('A1'), 'posicao', 1, 'pontos', 30))::text));
select t.permitido('líder A abre nova temporada do clube', $q$select public.nova_temporada('Membro A', 'Teste A1')$q$);
select t.permitido('líder A cria convite de responsável', $q$select public.criar_convite_responsavel()$q$);
select t.permitido('líder A edita a config do clube (PIX)', $q$update public.config_clube set valor = 'PIX-NOVO-A' where chave = 'pix'$q$);
select t.permitido('líder A redefine a senha de membro do clube', format($q$select public.resetar_senha_membro(%L, 'senha-nova-123')$q$, t.id('membro_a')));
-- Até a fase 9 esta linha dizia o CONTRÁRIO ("redefine a senha de usuário DESATIVADO"). Era o
-- defeito: a senha é da PESSOA (auth.users é global), e aceitar qualquer vínculo no clube — suspenso,
-- encerrado, pendente — deixava a liderança trocar a senha de ex-membro e de quem só digitou o código
-- do clube. Desde a migration 80 só quem está ATIVO aqui (e só aqui) tem a senha redefinida pela
-- liderança; o afastado usa "Esqueci a senha". Excluir o desativado (linha de baixo) também deixou de
-- valer na migration 310 (decisão do dono, 26/09): inativo não se apaga, fica com o histórico.
select t.throws('líder A NÃO redefine a senha de usuário DESATIVADO do clube (só de quem está ativo)', format($q$select public.resetar_senha_membro(%L, 'senha-nova-123')$q$, t.id('temp_a2')), 'ativo neste clube');
select t.throws('líder A NÃO exclui usuário DESATIVADO do clube (fica como inativo)', format('select public.excluir_usuario(%L)', t.id('temp_a2')), 'inativo não é apagado');
select t.permitido('líder A (diretoria) exclui usuário do clube', format('select public.excluir_usuario(%L)', t.id('temp_a')));
reset role;
select t.eq('senha do membro_a foi trocada', (select encrypted_password = extensions.crypt('senha-nova-123', encrypted_password) from auth.users where id = t.id('membro_a')), true);
select t.eq('usuário excluído sumiu', (select count(*) from public.profiles where id = t.id('temp_a')), 0);
select t.eq('a nova temporada foi só do clube A (B intacta)', (select count(*) from public.temporadas where club_id = t.id('clube_b') and fim is null), 1);
select t.eq('a unidade criada ficou no clube A', (select club_id from public.unidades where nome = 'Nova Unidade A'), t.id('clube_a'));
select t.eq('o evento criado ficou no clube A', (select club_id from public.eventos where titulo = 'Novo Evento A'), t.id('clube_a'));
select t.eq('o aviso criado ficou no clube A', (select club_id from public.notificacoes where titulo = 'Aviso novo A'), t.id('clube_a'));

-- ================= leilão: recurso opcional valendo NO BANCO =================
select t.como('lider_a');
select t.permitido('líder A cria leilão (recurso habilitado no clube)', format($q$select public.criar_leilao('Leilão A', now() + interval '2 days', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('nome','Prêmio','preco_base',10,'incremento_minimo',5))::text));
select t.permitido('líder A cancela o leilão', format($q$select public.cancelar_leilao(id) from public.leiloes where titulo = 'Leilão A'$q$));
select t.permitido('líder A desliga o recurso leilão do próprio clube', format($q$update public.club_features set enabled = false where club_id = %L and feature = 'leilao'$q$, t.id('clube_a')));
select t.throws('com o recurso desligado, criar leilão é recusado NO BANCO', format($q$select public.criar_leilao('Leilão X', now() + interval '2 days', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('nome','P','preco_base',10))::text), 'habilit');
select t.eq('com o recurso desligado, o leilão some da leitura', t.nv('select count(*) from public.leiloes'), 0);
select t.permitido('líder A religa o recurso', format($q$update public.club_features set enabled = true where club_id = %L and feature = 'leilao'$q$, t.id('clube_a')));

-- ================= instrutor: opera, mas dentro dos limites do papel =================
select t.como('instrutor_a');
select t.eq('instrutor aprova entrega pendente do clube', t.txt(format('select (public.aprovar_entrega(%L))->>''ok''', t.id('ent_a2'))), 'true');
select t.throws('instrutor NÃO redefine a senha da diretoria (senão assumiria a conta)', format($q$select public.resetar_senha_membro(%L, 'assumindo-conta')$q$, t.id('lider_a')), 'permiss');
select t.throws('instrutor NÃO redefine nem a senha de membro comum (migration 210: só a diretoria)', format($q$select public.resetar_senha_membro(%L, 'senha-ok-123')$q$, t.id('membro_a2')), 'Sem permissão');
select t.permitido('instrutor cria atividade', $q$insert into public.atividades (titulo, pontos) values ('Atividade do instrutor', 5)$q$);
select t.throws('instrutor NÃO exclui usuário (só diretoria)', format('select public.excluir_usuario(%L)', t.id('membro_a2')), 'diretoria');
select t.bloqueado('instrutor NÃO gere mensalidades (financeiro = tesoureiro/diretoria)', format($q$update public.mensalidades set status = 'pago' where desbravador_id = %L$q$, t.id('membro_a')));
select t.como('tesoureiro_a');
select t.permitido('tesoureiro gere mensalidades do clube', format($q$update public.mensalidades set status = 'pago' where desbravador_id = %L$q$, t.id('membro_a')));
select t.throws('tesoureiro NÃO aprova entrega', format('select public.aprovar_entrega(%L)', t.id('ent_a3')), 'permiss');

-- ================= conselheiro: só apontamento da própria unidade =================
select t.como('conselheiro_a');
select t.permitido('conselheiro aponta membro da PRÓPRIA unidade', format($q$select public.salvar_reuniao(current_date, 'Reunião do conselheiro', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('usuario_id', t.id('membro_a'), 'pontos', 4))::text));
select t.throws('conselheiro NÃO aponta membro de OUTRA unidade', format($q$select public.salvar_reuniao(current_date, 'Reunião do conselheiro', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('usuario_id', t.id('membro_a2'), 'pontos', 4))::text), 'permiss');
select t.throws('conselheiro NÃO redefine senha', format($q$select public.resetar_senha_membro(%L, 'qualquer-coisa')$q$, t.id('membro_a')), 'permiss');
select t.bloqueado('conselheiro NÃO abre temporada', $q$select public.nova_temporada('x','y')$q$);

-- ================= membro comum: nenhuma ação de liderança =================
select t.como('membro_a');
select t.throws('membro NÃO aprova entrega', format('select public.aprovar_entrega(%L)', t.id('ent_a3')), 'permiss');
select t.bloqueado('membro NÃO abre temporada', $q$select public.nova_temporada('x','y')$q$);
select t.bloqueado('membro NÃO cria convite', $q$select public.criar_convite_responsavel()$q$);
select t.bloqueado('membro NÃO redefine senha de ninguém', format($q$select public.resetar_senha_membro(%L, 'qualquer-coisa')$q$, t.id('membro_a2')));
select t.bloqueado('membro NÃO exclui usuário', format('select public.excluir_usuario(%L)', t.id('membro_a2')));
select t.bloqueado('membro NÃO edita a config do clube', $q$update public.config_clube set valor = 'hack' where chave = 'pix'$q$);
select t.bloqueado('membro NÃO cria unidade', $q$insert into public.unidades (nome) values ('hack')$q$);
select t.bloqueado('membro NÃO lança pontos em unidade', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo) values (%L, 'unidade', 999, 'hack')$q$, t.id('A1')));
select t.bloqueado('membro NÃO liga/desliga recursos do clube', format($q$update public.club_features set enabled = false where club_id = %L$q$, t.id('clube_a')));
select t.permitido('membro posta foto no mural do próprio clube', format($q$insert into public.fotos (url, legenda, autor_id) values ('https://x.test/m.jpg', 'do membro', %L)$q$, t.id('membro_a')));
select t.permitido('membro envia entrega no próprio clube', format($q$insert into public.entregas (atividade_id, usuario_id, texto) values (%L, %L, 'minha entrega')$q$, t.id('atv_a2'), t.id('membro_a')));

-- ================= recursos do "reino legado" (chat/missões) seguem funcionando p/ o Tenant 001 =================
select t.permitido('membro do Tenant 001 fala no chat geral', $q$select public.chat_enviar_geral('oi do clube A')$q$);
select t.permitido('membro do Tenant 001 registra a missão do dia', $q$select public.registrar_missao(null, 0)$q$);

select t.fim();
rollback;
