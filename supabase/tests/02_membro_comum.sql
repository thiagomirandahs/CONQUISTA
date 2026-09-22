-- Prioridade 3: todo novo membro entra num fluxo de vínculo/aprovação que a
-- diretoria DO CLUBE certo consegue ver e decidir; enquanto pendente não enxerga nada.
begin;
\ir _lib.sql
\ir _fixtures.sql


-- ---------- cadastro público: o formulário precisa listar as unidades (anon) ----------
select t.como_anon();
select t.eq('anon lista as unidades do clube legado no cadastro',
            t.n($q$select count(*) from public.unidades where nome in ('Teste A1','Teste A2')$q$), 2);
select t.eq('anon NÃO enxerga unidade de outro clube',
            t.nv($q$select count(*) from public.unidades where nome = 'Teste B1'$q$), 0);
reset role;

-- ---------- 3 cadastros: com unidade do clube A, com unidade do clube B, sem unidade ----------
select t.signup('novo_a', jsonb_build_object('nome','Novo A','cargo','Desbravador','unidade_id',t.id('A1'),'nascimento','2014-01-01'));
select t.signup('novo_b', jsonb_build_object('nome','Novo B','cargo','Desbravador','unidade_id',t.id('B1'),'nascimento','2014-02-02'));
select t.signup('novo_sem_unid', jsonb_build_object('nome','Novo Sem Unidade','cargo','Instrutor'));
select t.throws('cadastro com unidade inexistente é recusado',
                format($q$select t.signup('novo_x', %L::jsonb)$q$, jsonb_build_object('nome','X','unidade_id',gen_random_uuid())::text));

select t.eq('novo_a: perfil nasce pendente', (select status from public.profiles where id = t.id('novo_a')), 'pendente');
select t.eq('novo_a: papel nasce desbravador (nunca privilegiado)', (select papel from public.profiles where id = t.id('novo_a')), 'desbravador');
select t.eq('novo_a: ganha vínculo no clube da unidade escolhida', (select organizational_unit_id from public.organization_memberships where user_id = t.id('novo_a')), t.id('clube_a'));
select t.eq('novo_a: vínculo nasce pendente', (select status from public.organization_memberships where user_id = t.id('novo_a')), 'pendente');
select t.eq('novo_a: tem exatamente 1 vínculo', (select count(*) from public.organization_memberships where user_id = t.id('novo_a')), 1);
select t.eq('novo_b: vínculo no clube B (pela unidade B1)', (select organizational_unit_id from public.organization_memberships where user_id = t.id('novo_b')), t.id('clube_b'));
select t.eq('novo_sem_unid: sem unidade cai no clube legado (cadastro público = Tenant 001)', (select organizational_unit_id from public.organization_memberships where user_id = t.id('novo_sem_unid')), t.id('clube_a'));

-- ---------- pendente não enxerga nada do clube ----------
select t.como('novo_a');
select t.eq('pendente vê só o próprio perfil', t.n('select count(*) from public.profiles'), 1);
select t.eq('pendente: 0 pontos', t.nv('select count(*) from public.pontos'), 0);
select t.eq('pendente: 0 fotos', t.nv('select count(*) from public.fotos'), 0);
select t.eq('pendente: 0 atividades', t.nv('select count(*) from public.atividades'), 0);
select t.eq('pendente: 0 eventos', t.nv('select count(*) from public.eventos'), 0);
select t.eq('pendente: 0 unidades (autenticado)', t.nv('select count(*) from public.unidades'), 0);
select t.eq('pendente: 0 avisos do clube', t.nv($q$select count(*) from public.notificacoes where titulo = 'Aviso A'$q$), 0);
select t.eq('pendente: listar_usuarios vazio', t.nv('select count(*) from public.listar_usuarios()'), 0);
select t.eq('pendente: ranking vazio', t.n($q$select json_array_length(public.ranking_totais()->'pessoas')$q$), 0);

-- ---------- a diretoria do clube CERTO enxerga o pendente ----------
select t.como('lider_a');
select t.eq('líder A vê o cadastro pendente novo_a (tela Aprovações)', t.n(format($q$select count(*) from public.profiles where status = 'pendente' and id = %L$q$, t.id('novo_a'))), 1);
select t.eq('líder A vê novo_sem_unid (clube legado)', t.n(format($q$select count(*) from public.profiles where status = 'pendente' and id = %L$q$, t.id('novo_sem_unid'))), 1);
select t.eq('líder A NÃO vê o pendente do clube B', t.nv(format($q$select count(*) from public.profiles where id = %L$q$, t.id('novo_b'))), 0);
select t.eq('líder A vê novo_a em listar_usuarios', t.n(format('select count(*) from public.listar_usuarios() where id = %L', t.id('novo_a'))), 1);
select t.eq('líder A recebeu o aviso "Novo cadastro" de novo_a', t.nv($q$select count(*) from public.notificacoes where titulo ilike '%Novo cadastro%' and corpo ilike '%Novo A %'$q$), 1);
select t.eq('líder A NÃO recebeu o aviso do cadastro do clube B', t.nv($q$select count(*) from public.notificacoes where corpo ilike '%Novo B %'$q$), 0);
select t.como('lider_b');
select t.eq('líder B vê o pendente novo_b', t.n(format($q$select count(*) from public.profiles where status = 'pendente' and id = %L$q$, t.id('novo_b'))), 1);
select t.eq('líder B NÃO vê pendente do clube A', t.nv(format($q$select count(*) from public.profiles where id = %L$q$, t.id('novo_a'))), 0);
select t.eq('líder B recebeu o aviso "Novo cadastro" de novo_b', t.nv($q$select count(*) from public.notificacoes where titulo ilike '%Novo cadastro%' and corpo ilike '%Novo B %'$q$), 1);
select t.eq('líder B NÃO recebeu aviso do cadastro do clube A', t.nv($q$select count(*) from public.notificacoes where corpo ilike '%Novo A %'$q$), 0);
select t.bloqueado('líder B não aprova cadastro do clube A',
                   format($q$select public.vinculo_gerir(%L, p_status := 'ativo')$q$, t.id('novo_a')));
reset role;
select t.eq('novo_a continua pendente após tentativa do líder B', (select status from public.profiles where id = t.id('novo_a')), 'pendente');

-- ---------- o pendente não se aprova sozinho nem se promove ----------
-- (papel/status/unidade_id não são mais graváveis direto em profiles por ninguém — só
-- por vinculo_gerir, que também recusa a própria pessoa alterar o próprio vínculo)
select t.como('novo_sem_unid');
select t.bloqueado('auto-aprovação direto em profiles é recusada (coluna travada)',
                   format($q$update public.profiles set status = 'ativo', papel = 'diretoria' where id = %L$q$, t.id('novo_sem_unid')));
select t.bloqueado('auto-aprovação via vinculo_gerir também é recusada',
                   format($q$select public.vinculo_gerir(%L, p_status := 'ativo')$q$, t.id('novo_sem_unid')));
reset role;
select t.eq('auto-aprovação não pega (perfil)', (select status from public.profiles where id = t.id('novo_sem_unid')), 'pendente');
select t.eq('auto-promoção não pega (papel)', (select papel from public.profiles where id = t.id('novo_sem_unid')), 'desbravador');
select t.eq('auto-aprovação não pega (vínculo)', (select status from public.organization_memberships where user_id = t.id('novo_sem_unid')), 'pendente');

-- ---------- aprovação pela liderança (agora via vinculo_gerir, escopado ao clube em uso) ----------
select t.como('lider_a');
select t.permitido('líder A aprova o novo_a', format($q$select public.vinculo_gerir(%L, p_status := 'ativo')$q$, t.id('novo_a')));
reset role;
select t.eq('aprovado: vínculo vira ativo', (select status from public.organization_memberships where user_id = t.id('novo_a')), 'ativo');
select t.como('novo_a');
select t.eq('aprovado: passa a ver as fotos do clube A', t.n($q$select count(*) from public.fotos where legenda = 'Foto A'$q$), 1);
select t.eq('aprovado: passa a ver as atividades do clube A', t.n($q$select count(*) from public.atividades where titulo = 'Atividade A'$q$), 1);
select t.eq('aprovado: NÃO vê nada do clube B', t.nv($q$select count(*) from public.fotos where legenda = 'Foto B'$q$), 0);
select t.eq('aprovado: recebe o aviso pessoal "Cadastro aprovado"', t.nv($q$select count(*) from public.notificacoes where titulo ilike '%Cadastro aprovado%'$q$), 1);
select t.eq('aprovado: vê o aviso geral do clube A', t.nv($q$select count(*) from public.notificacoes where titulo = 'Aviso A'$q$), 1);
select t.eq('aprovado: não vê o aviso do clube B', t.nv($q$select count(*) from public.notificacoes where titulo = 'Aviso B'$q$), 0);

-- ---------- rejeição / desativação / reativação acompanham o vínculo ----------
select t.como('lider_a');
select t.permitido('líder A rejeita novo_sem_unid', format($q$select public.vinculo_gerir(%L, p_status := 'rejeitado')$q$, t.id('novo_sem_unid')));
select t.permitido('líder A desativa membro_a2', format($q$select public.vinculo_gerir(%L, p_status := 'inativo')$q$, t.id('membro_a2')));
reset role;
select t.ok('rejeitado: vínculo deixa de ser ativo/pendente', (select status from public.organization_memberships where user_id = t.id('novo_sem_unid')) not in ('ativo','pendente'));
select t.ok('inativo: vínculo deixa de ser ativo', (select status from public.organization_memberships where user_id = t.id('membro_a2')) <> 'ativo');
select t.como('membro_a2');
select t.eq('inativo: perde acesso aos dados do clube', t.nv('select count(*) from public.fotos'), 0);
select t.como('lider_a');
select t.eq('líder A AINDA vê o desativado em listar_usuarios', t.n(format($q$select count(*) from public.listar_usuarios() where id = %L and status = 'inativo'$q$, t.id('membro_a2'))), 1);
select t.eq('líder A AINDA vê o rejeitado em listar_usuarios', t.n(format($q$select count(*) from public.listar_usuarios() where id = %L and status = 'rejeitado'$q$, t.id('novo_sem_unid'))), 1);
select t.permitido('líder A reativa membro_a2', format($q$select public.vinculo_gerir(%L, p_status := 'ativo')$q$, t.id('membro_a2')));
select t.como('membro_a2');
select t.eq('reativado: volta a ver o clube', t.n($q$select count(*) from public.fotos where legenda = 'Foto A'$q$), 1);
reset role;
select t.eq('reativado: continua com 1 vínculo só', (select count(*) from public.organization_memberships where user_id = t.id('membro_a2')), 1);

-- ---------- promoção de cargo acompanha o papel do vínculo ----------
select t.como('lider_a');
select t.permitido('líder A promove membro_a2 a conselheiro', format($q$select public.vinculo_gerir(%L, p_papel := 'conselheiro')$q$, t.id('membro_a2')));
reset role;
select t.eq('promoção: papel do vínculo acompanha', (select role from public.organization_memberships where user_id = t.id('membro_a2')), 'conselheiro');
select t.eq('promoção: espelho em profiles acompanha (clube primário)', (select papel from public.profiles where id = t.id('membro_a2')), 'conselheiro');

-- ---------- coerência de unidade x clube ----------
select t.como('lider_a');
select t.bloqueado('líder A não coloca membro do A numa unidade do clube B',
                   format($q$select public.vinculo_gerir(%L, p_unidade_id := %L)$q$, t.id('membro_a'), t.id('B1')));
reset role;
select t.eq('unidade do membro_a intacta', (select unidade_id from public.organization_memberships where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_a')), t.id('A1'));

-- ---------- múltiplos clubes: a mesma pessoa pode ter um SEGUNDO vínculo ativo ----------
-- (antes era recusado por 1-clube-por-pessoa; a restrição saiu nesta fase — ver 27_multiclube_real.sql
-- para a cobertura completa de papel/unidade diferentes por clube, troca de clube, etc.)
select t.permitido('membro_a pode ganhar um SEGUNDO vínculo ativo, em outro clube',
  format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (%L, %L, 'desbravador', 'ativo')$q$, t.id('membro_a'), t.id('clube_b')));
select t.eq('membro_a agora tem 2 vínculos', (select count(*) from public.organization_memberships where user_id = t.id('membro_a')), 2);
delete from public.organization_memberships where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_b');

-- ---------- reconciliação: corrige deriva vínculo -> perfil (rede de segurança da migration 34) ----------
set local session_replication_role = replica;
update public.organization_memberships set unidade_id = null, role = 'desbravador' where user_id = t.id('membro_a');
update public.profiles set papel = 'conselheiro', unidade_id = null where id = t.id('membro_a');
update public.organization_memberships set status = 'pendente' where user_id = t.id('tesoureiro_a');
update public.profiles set status = 'suspenso' where id = t.id('tesoureiro_a');
set local session_replication_role = origin;
select t.ok('reconciliar_perfis_dos_vinculos corrige a deriva (>= 2 ajustes)', t.n('select public.reconciliar_perfis_dos_vinculos()') >= 2);
select t.eq('reconciliado: papel de membro_a no perfil volta a acompanhar o vínculo', (select papel from public.profiles where id = t.id('membro_a')), 'desbravador');
select t.eq('reconciliado: status de tesoureiro_a no perfil volta a acompanhar o vínculo', (select status from public.profiles where id = t.id('tesoureiro_a')), 'pendente');
select t.eq('reconciliar é idempotente (2ª vez = 0 ajustes)', t.n('select public.reconciliar_perfis_dos_vinculos()'), 0);

select t.fim();
rollback;
