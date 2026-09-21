-- Prioridade 2: papel `pais` só acessa dados pelo portal "Meus Filhos". Não lê
-- perfis, pontos, fotos, entregas nem outros dados de menores do clube; não escreve
-- em nada do clube; os vínculos pai->filho respeitam o clube.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- segundo filho do clube A (ainda sem vínculo com pais_a) e um pedido de vínculo pendente
select t.mk('membro_a3', 'Membro A3', 'desbravador', 'ativo', 'clube_a', 'A1', date '2015-07-07');

-- ---------- o que o responsável NÃO pode ler ----------
select t.como('pais_a');
select t.eq('pais: vê só o próprio perfil (nenhum outro)', t.n('select count(*) from public.profiles'), 1);
select t.eq('pais: NÃO lê o perfil/nascimento de um menor', t.nv(format('select count(*) from public.profiles where id = %L', t.id('membro_a'))), 0);
select t.eq('pais: NÃO lê pontos', t.nv('select count(*) from public.pontos'), 0);
select t.eq('pais: NÃO lê fotos do mural', t.nv('select count(*) from public.fotos'), 0);
select t.eq('pais: NÃO lê entregas', t.nv('select count(*) from public.entregas'), 0);
select t.eq('pais: NÃO lê atividades', t.nv('select count(*) from public.atividades'), 0);
select t.eq('pais: NÃO lê agenda', t.nv('select count(*) from public.eventos'), 0);
select t.eq('pais: NÃO lê mensalidades direto (só via Meus Filhos)', t.nv('select count(*) from public.mensalidades'), 0);
select t.eq('pais: NÃO lê unidades', t.nv('select count(*) from public.unidades'), 0);
select t.eq('pais: NÃO lê temporadas', t.nv('select count(*) from public.temporadas'), 0);
select t.eq('pais: NÃO lê avisos gerais do clube', t.nv($q$select count(*) from public.notificacoes where titulo = 'Aviso A'$q$), 0);
select t.eq('pais: NÃO lê aviso pessoal de outra pessoa', t.nv($q$select count(*) from public.notificacoes where titulo = 'Recado membro A'$q$), 0);
select t.eq('pais: NÃO lista usuários', t.nv('select count(*) from public.listar_usuarios()'), 0);
select t.eq('pais: ranking do clube vazio', t.n($q$select json_array_length(public.ranking_totais()->'pessoas')$q$), 0);
select t.eq('pais: ranking da semana vazio', t.n($q$select json_array_length(public.ranking_semana()->'pessoas')$q$), 0);
select t.eq('pais: NÃO lê comprovantes (storage privado) de menores', t.nv($q$select count(*) from storage.objects where bucket_id = 'comprovacoes'$q$), 0);
select t.eq('pais: vê os próprios vínculos (memberships) só', t.n('select count(*) from public.organization_memberships'), 1);

-- ---------- o que o responsável NÃO pode escrever ----------
select t.bloqueado('pais não posta foto no mural', format($q$insert into public.fotos (url, legenda, autor_id) values ('https://x.test/p.jpg', 'pais', %L)$q$, t.id('pais_a')));
select t.bloqueado('pais não envia entrega', format($q$insert into public.entregas (atividade_id, usuario_id, texto) values (%L, %L, 'pais')$q$, t.id('atv_a'), t.id('pais_a')));
select t.bloqueado('pais não lança pontos', format($q$insert into public.pontos (usuario_id, origem, pontos, motivo) values (%L, 'manual', 999, 'pais')$q$, t.id('pais_a')));
select t.bloqueado('pais não cria atividade', format($q$insert into public.atividades (titulo, pontos, club_id) values ('pais', 1, %L)$q$, t.id('clube_a')));
select t.bloqueado('pais não cria evento', format($q$insert into public.eventos (titulo, data, club_id) values ('pais', current_date, %L)$q$, t.id('clube_a')));
select t.bloqueado('pais não cria aviso', format($q$insert into public.notificacoes (titulo, para, criado_por) values ('pais', 'todos', %L)$q$, t.id('pais_a')));
select t.bloqueado('pais não edita perfil de menor', format($q$update public.profiles set nome = 'hack' where id = %L$q$, t.id('membro_a')));
select t.bloqueado('pais não usa dar_lance', format('select public.dar_lance(%L, 10)', t.id('atv_a')));
select t.bloqueado('pais não aprova vínculo', format('select public.aprovar_vinculo(%L, %L)', gen_random_uuid(), t.id('membro_a')));

-- ---------- o portal Meus Filhos: ÚNICA porta ----------
select t.eq('meus_filhos: devolve exatamente 1 filho', t.n('select json_array_length(public.meus_filhos())'), 1);
select t.eq('meus_filhos: é o membro_a', t.txt('select public.meus_filhos()->0->>''id'''), t.id('membro_a')::text);
select t.eq('meus_filhos: traz os pontos do filho', t.txt('select public.meus_filhos()->0->>''pontos'''), '10');
select t.eq('meus_filhos: traz a mensalidade pendente', t.n('select json_array_length(public.meus_filhos()->0->''mensalidades_pendentes'')'), 1);
select t.como('pais_b');
select t.eq('pais_b vê só o filho do clube B', t.txt('select public.meus_filhos()->0->>''id'''), t.id('membro_b')::text);
select t.eq('pais_b: 1 filho', t.n('select json_array_length(public.meus_filhos())'), 1);

-- ---------- pedido de vínculo: entra no clube do responsável e a liderança CERTA decide ----------
select t.como('pais_a');
select t.permitido('pais_a pede vínculo com o filho membro_a3', $q$select public.pedir_vinculo('Membro A3')$q$, 1);
reset role;
select t.eq('pedido nasce no clube do responsável', t.txt($q$select club_id::text from public.responsaveis where nome_digitado = 'Membro A3'$q$), t.id('clube_a')::text);
select t.como('lider_a');
select t.eq('líder A vê o pedido pendente', t.n('select json_array_length(public.vinculos_pendentes())'), 1);
select t.como('lider_b');
select t.eq('líder B NÃO vê pedido do clube A', t.n('select json_array_length(public.vinculos_pendentes())'), 0);
reset role;
select id as req_id from public.responsaveis where nome_digitado = 'Membro A3' \gset
select t.como('lider_b');
select t.throws('líder B não aprova vínculo do clube A', format('select public.aprovar_vinculo(%L, %L)', :'req_id', t.id('membro_b')));
select t.throws('líder B não rejeita vínculo do clube A', format('select public.rejeitar_vinculo(%L)', :'req_id'));
select t.como('lider_a');
select t.throws('líder A não vincula responsável a filho de OUTRO clube', format('select public.aprovar_vinculo(%L, %L)', :'req_id', t.id('membro_b')));
select t.como('instrutor_a');
select t.throws('instrutor não aprova vínculo (só diretoria)', format('select public.aprovar_vinculo(%L, %L)', :'req_id', t.id('membro_a3')), 'diretoria');
select t.como('lider_a');
select t.permitido('líder A aprova o vínculo com o filho do próprio clube', format('select public.aprovar_vinculo(%L, %L)', :'req_id', t.id('membro_a3')));
select t.como('pais_a');
select t.eq('após aprovar: meus_filhos passa a devolver 2 filhos', t.n('select json_array_length(public.meus_filhos())'), 2);

-- pedidos demais são barrados (anti-spam existente)
select t.como('pais_a');
select public.pedir_vinculo('X1'); select public.pedir_vinculo('X2'); select public.pedir_vinculo('X3'); select public.pedir_vinculo('X4'); select public.pedir_vinculo('X5');
select t.throws('mais de 5 pedidos pendentes é barrado', $q$select public.pedir_vinculo('X6')$q$, 'demais');
select t.como('membro_a');
select t.throws('membro comum não pede vínculo (só responsável)', $q$select public.pedir_vinculo('Filho')$q$, 'responsáve');
select t.como('membro_a');
select t.eq('membro comum não vê pedidos de vínculo', t.n('select json_array_length(public.vinculos_pendentes())'), 0);

-- ---------- papel padronizado: só 'pais' (nunca 'responsavel') ----------
reset role;
select t.eq('nenhum vínculo com papel legado "responsavel"', (select count(*) from public.organization_memberships where role = 'responsavel'), 0);
select t.throws('papel "responsavel" é rejeitado pela constraint',
  format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (%L, %L, 'responsavel', 'suspenso')$q$, t.id('membro_a'), t.id('clube_a')));
select t.eq('perfis com papel pais têm vínculo de papel pais', (select count(*) from public.profiles p join public.organization_memberships m on m.user_id = p.id where p.papel = 'pais' and m.role <> 'pais'), 0);

select t.fim();
rollback;
