-- Achados da revisão independente (segurança) — cada bloco reproduz um achado CONFIRMADO no banco:
--  A) aviso/push forjado em outro clube via criado_por/lancado_por      B) chefão soma pontos de outro clube
--  C) atividade_jogos lista menores de outro clube                       D) bucket "imagens" listável por anon
--  E) instrutor vira diretoria                                           F) unidade/usuário de outro clube aceitos
--  G) oráculos de existência de UUID
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.mk('susp_a', 'Suspenso A', 'desbravador', 'inativo', 'clube_a', 'A1');
select t.mk('susp_b', 'Suspenso B', 'desbravador', 'inativo', 'clube_b', 'B1');

-- ==================== A) notificação forjada em outro clube ====================
select t.como('lider_b');
select t.tenta(format($q$insert into public.atividades (titulo, pontos, criado_por) values ('PHISHING atividade B', 5, %L)$q$, t.id('lider_a')));
select t.tenta(format($q$insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por) values (%L, 'unidade', 1, 'PHISHING ponto B', %L)$q$, t.id('B1'), t.id('lider_a')));
select t.tenta(format($q$insert into public.notificacoes (titulo, para, criado_por) values ('PHISHING aviso B', 'todos', %L)$q$, t.id('lider_a')));
reset role;
select t.eq('nenhum aviso forjado chegou ao clube A (atividade/ponto/aviso)',
  (select count(*) from public.notificacoes where club_id = t.id('clube_a') and (titulo like '%PHISHING%' or corpo like '%PHISHING%' or titulo like '%Teste B1%')), 0);
select t.como('lider_b');
select t.bloqueado('líder B não cria atividade em nome de outra pessoa', format($q$insert into public.atividades (titulo, pontos, criado_por) values ('em nome de A', 5, %L)$q$, t.id('lider_a')));
select t.bloqueado('líder B não lança ponto em nome de outra pessoa', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por) values (%L, 'unidade', 1, 'em nome de A', %L)$q$, t.id('B1'), t.id('lider_a')));
select t.bloqueado('líder B não cria aviso em nome de outra pessoa', format($q$insert into public.notificacoes (titulo, para, criado_por) values ('em nome de A', 'todos', %L)$q$, t.id('lider_a')));
select t.bloqueado('líder B não cria evento em nome de outra pessoa', format($q$insert into public.eventos (titulo, data, criado_por) values ('em nome de A', current_date, %L)$q$, t.id('lider_a')));
select t.permitido('líder B cria atividade em nome próprio', format($q$insert into public.atividades (titulo, pontos, criado_por) values ('Atividade legítima B', 5, %L)$q$, t.id('lider_b')));
select t.permitido('líder B lança ponto em nome próprio', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por) values (%L, 'unidade', 1, 'ponto legítimo B', %L)$q$, t.id('B1'), t.id('lider_b')));
select t.permitido('líder B cria evento em nome próprio', format($q$insert into public.eventos (titulo, data, criado_por) values ('Evento legítimo B', current_date + 3, %L)$q$, t.id('lider_b')));
reset role;
insert into public.eventos (titulo, tipo, data, criado_por, club_id)
values ('Evento do instrutor', 'Reunião', current_date + 2, t.id('instrutor_a'), t.id('clube_a'));
select t.como('lider_a');
select t.permitido('um líder do clube edita evento criado por OUTRO líder (o UPDATE segue funcionando)', $q$update public.eventos set titulo = 'Evento do instrutor (editado)' where titulo = 'Evento do instrutor'$q$);
reset role;
select t.eq('o aviso "Nova atividade" da atividade legítima do B ficou no clube B', (select count(*) from public.notificacoes where club_id = t.id('clube_b') and corpo like '%Atividade legítima B%'), 1);

-- ==================== B) chefão só conta o clube legado ====================
insert into public.config_clube (club_id, chave, valor) values
  (t.id('clube_a'), 'chefao_ativo', 'sim'), (t.id('clube_a'), 'chefao_inicio', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')), (t.id('clube_a'), 'chefao_vida', '1000')
on conflict (club_id, chave) do update set valor = excluded.valor;
insert into public.pontos (usuario_id, origem, pontos, motivo) values (t.id('membro_b'), 'manual', 100000, 'pontos do clube B');
select t.como('membro_a');
select t.ok('chefão do clube A não recebe dano do clube B (dano < 1000)', t.n($q$select (public.chefao_estado()->>'dano')::int$q$) between 0 and 999);
select t.ok('chefão do clube A não mostra a unidade do clube B no placar', t.txt($q$select (public.chefao_estado()->'por_unidade')::text not like '%Teste B1%'$q$) in ('true', 't'));
select t.ok('chefão do clube A não é vencido por pontos do clube B', t.txt($q$select (public.chefao_estado()->>'venceu')$q$) = 'false');
select t.como_cron();  -- postgres SEM claim de usuário (o teto de ±100 pontos só vale para quem tem sessão)
-- o evento do chefão (sáb-dom) já terminou e só o clube A causou dano suficiente (1500 >= 1000):
-- o prêmio é proporcional ao dano e NÃO pode pagar ninguém do clube B (100000 de dano lá)
update public.config_clube set valor = to_char((now() at time zone 'America/Sao_Paulo')::date - 3, 'YYYY-MM-DD') where chave = 'chefao_inicio' and club_id = t.id('clube_a');
delete from public.config_clube where chave = 'chefao_pago' and club_id = t.id('clube_a');
insert into public.pontos (usuario_id, origem, pontos, motivo, data) values
  (t.id('membro_a'), 'manual', 1500, 'dano do A', now() - interval '60 hours'),
  (t.id('membro_b'), 'manual', 100000, 'dano do B', now() - interval '60 hours');
select public.chefao_premiar();
select t.ok('o chefão foi derrotado pelo clube A e pagou o prêmio (o teste exercita o pagamento)', (select count(*) from public.pontos where usuario_id = t.id('membro_a') and origem = 'chefao') >= 1);
select t.eq('o prêmio do chefão não paga ninguém do clube B', (select count(*) from public.pontos where usuario_id = t.id('membro_b') and origem = 'chefao'), 0);

-- ==================== C) atividade_jogos só do clube legado ====================
select count(*) as esperado_jogos from public.profiles p
 where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false and public.clube_do_usuario(p.id) = public.clube_legado_id() \gset
select t.como('lider_a');
select t.ok('atividade_jogos (clube A) não lista menor do clube B', t.txt($q$select (public.atividade_jogos())::text not like '%Membro B%'$q$) in ('true', 't'));
select t.eq('atividade_jogos conta só os desbravadores do clube legado', t.n($q$select (public.atividade_jogos()->>'total')::int$q$), :esperado_jogos::bigint);
reset role;

-- ==================== D) bucket "imagens": sem listagem anônima nem entre clubes ====================
insert into storage.buckets (id, name, public) values ('imagens', 'imagens', true) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner) values
  ('imagens', 'mural/' || t.id('membro_a') || '-1.jpg', t.id('membro_a')),
  ('imagens', 'mural/' || t.id('membro_b') || '-1.jpg', t.id('membro_b'));
select t.como_anon();
select t.eq('anon NÃO lista imagens (nem uuids de usuários)', t.nv($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 0);
select t.como('membro_b');
select t.eq('membro B lista só os próprios arquivos', t.n($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 1);
select t.como('membro_a');
select t.eq('membro A lista só os próprios arquivos', t.n($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 1);
select t.como('lider_a');
select t.eq('líder A vê os arquivos do próprio clube (não os do B)', t.n($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 1);
select t.como('lider_b');
select t.eq('líder B vê os arquivos do próprio clube (não os do A)', t.n($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 1);
select t.como('pais_a');
select t.eq('responsável não lista imagens de menores', t.nv($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 0);
reset role;

-- ==================== E) instrutor não vira diretoria ====================
select t.como('instrutor_a');
select t.tenta(format($q$update public.profiles set papel = 'diretoria' where id = %L$q$, t.id('membro_a')));
select t.tenta(format($q$update public.profiles set papel = 'instrutor' where id = %L$q$, t.id('membro_a2')));
select t.tenta(format($q$update public.profiles set papel = 'tesoureiro' where id = %L$q$, t.id('conselheiro_a')));
select t.tenta(format($q$update public.profiles set status = 'inativo' where id = %L$q$, t.id('tesoureiro_a')));
select t.tenta(format($q$update public.profiles set status = 'inativo' where id = %L$q$, t.id('lider_a')));
select t.permitido('instrutor promove membro comum a conselheiro (continua podendo)', format($q$update public.profiles set papel = 'conselheiro' where id = %L$q$, t.id('membro_a2')));
select t.throws('instrutor NÃO redefine a senha do tesoureiro', format($q$select public.resetar_senha_membro(%L, 'assumindo-conta')$q$, t.id('tesoureiro_a')), 'permiss');
reset role;
select t.eq('instrutor não criou diretoria', (select papel from public.profiles where id = t.id('membro_a')), 'desbravador');
select t.eq('...nem o vínculo dela', (select role from public.organization_memberships where user_id = t.id('membro_a')), 'desbravador');
select t.eq('instrutor não criou outro instrutor', (select papel from public.profiles where id = t.id('conselheiro_a')), 'conselheiro');
select t.eq('instrutor não desativou o tesoureiro', (select status from public.profiles where id = t.id('tesoureiro_a')), 'ativo');
select t.eq('instrutor não desativou a diretoria', (select status from public.profiles where id = t.id('lider_a')), 'ativo');
select t.eq('instrutor conseguiu o que é permitido (conselheiro)', (select papel from public.profiles where id = t.id('membro_a2')), 'conselheiro');
select t.como('lider_a');
select t.permitido('diretoria promove a instrutor', format($q$update public.profiles set papel = 'instrutor' where id = %L$q$, t.id('membro_a')));
select t.permitido('diretoria desativa o tesoureiro', format($q$update public.profiles set status = 'inativo' where id = %L$q$, t.id('tesoureiro_a')));
select t.permitido('diretoria redefine a senha do tesoureiro', format($q$select public.resetar_senha_membro(%L, 'senha-ok-123')$q$, t.id('tesoureiro_a')));
reset role;
select t.eq('a diretoria promoveu de verdade (perfil e vínculo)', (select p.papel || '/' || m.role from public.profiles p join public.organization_memberships m on m.user_id = p.id where p.id = t.id('membro_a')), 'instrutor/instrutor');

-- ==================== F) unidade e pessoa sempre do MESMO clube ====================
select t.como('membro_a');
select t.throws('duelo contra unidade de outro clube é recusado', format($q$select public.criar_duelo((select id from public.desafios_unidade where ativo limit 1), %L)$q$, t.id('B1')));
select t.como('lider_a');
select t.bloqueado('líder A não muda a unidade de um SUSPENSO para unidade do clube B', format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('B1'), t.id('susp_a')));
reset role;
select t.eq('a unidade do suspenso ficou como estava', (select unidade_id from public.profiles where id = t.id('susp_a')), t.id('A1'));
select t.throws('ponto com pessoa de um clube e unidade de outro é recusado',
  format($q$insert into public.pontos (usuario_id, unidade_id, origem, pontos, motivo) values (%L, %L, 'manual', -500, 'misturado')$q$, t.id('membro_b'), t.id('A1')), 'clubes diferentes');
select t.como('lider_b');
select t.permitido('líder B lança ponto para um membro SUSPENSO do próprio clube', format($q$insert into public.pontos (usuario_id, origem, pontos, motivo, lancado_por) values (%L, 'manual', 3, 'pt susp B', %L)$q$, t.id('susp_b'), t.id('lider_b')));
reset role;
select t.eq('...e o ponto do suspenso ficou no clube B (não caiu no legado)', (select club_id from public.pontos where motivo = 'pt susp B'), t.id('clube_b'));

-- ==================== G) sem oráculo de existência de UUID ====================
select t.como('lider_b');
select t.throws('aprovar_entrega de id inexistente responde como sem permissão', format($q$select public.aprovar_entrega(%L)$q$, gen_random_uuid()), 'permiss');
select t.throws('aprovar_entrega de entrega de OUTRO clube responde igual', format($q$select public.aprovar_entrega(%L)$q$, t.id('ent_a')), 'permiss');
select t.throws('revogar convite inexistente ou de outro clube: mesma mensagem', format($q$select public.revogar_convite_responsavel(%L)$q$, gen_random_uuid()), 'permiss');
select t.throws('aprovar vínculo inexistente responde como sem permissão', format($q$select public.aprovar_vinculo(%L, %L)$q$, gen_random_uuid(), t.id('membro_b')), 'diretoria');

select t.fim();
rollback;
