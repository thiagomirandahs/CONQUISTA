-- Migration 210: capacidades explícitas (decisão do dono, 26/09).
-- Instrutor AVALIA Classes/Especialidades e GERE desafios/missões; NÃO aprova cadastro/inscrição,
-- NÃO convida equipe, NÃO muda papel/unidade/status, NÃO redefine senha, NÃO mexe em config/marca/
-- recursos nem em vínculos de responsáveis. Diretoria continua podendo tudo. Conselheiro não aprova.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.mk('pendente78', 'Pendente 78', 'desbravador', 'pendente', 'clube_a');
-- mesma preparação do teste 65: o piloto vira "oficial" só nesta transação
update public.curriculum_versions set status = 'arquivado' where origem = 'oficial';
update public.curriculum_versions set origem = 'oficial' where id = '00000000-0000-4000-a000-000000000001'::uuid;
insert into t.ids (chave, id) values ('classe_piloto', '00000000-0000-4000-a000-000000000002'::uuid);
insert into t.ids (chave, id)
  select 'req_' || s.codigo || '_' || r.codigo, r.id
  from public.class_requirements r join public.class_sections s on s.id = r.section_id
  where s.class_id = t.id('classe_piloto');
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
\o

-- ==================== 1) as capacidades, papel a papel ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.ok('diretoria: administra', public.pode_administrar_clube(t.id('clube_a')));
select t.ok('diretoria: avalia currículo', public.pode_avaliar_curriculo(t.id('clube_a')));
select t.ok('diretoria: gere atividades', public.pode_gerir_atividades(t.id('clube_a')));
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.ok('instrutor: NÃO administra', not public.pode_administrar_clube(t.id('clube_a')));
select t.ok('instrutor: avalia currículo', public.pode_avaliar_curriculo(t.id('clube_a')));
select t.ok('instrutor: gere atividades', public.pode_gerir_atividades(t.id('clube_a')));
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.ok('conselheiro: nenhuma das três',
  not (public.pode_administrar_clube(t.id('clube_a')) or public.pode_avaliar_curriculo(t.id('clube_a')) or public.pode_gerir_atividades(t.id('clube_a'))));
select t.como('tesoureiro_a'); select t.pedir_clube('clube_a');
select t.ok('tesoureiro: não administra (financeiro segue à parte)', not public.pode_administrar_clube(t.id('clube_a')));
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.ok('instrutor do A não administra o B', not public.pode_administrar_clube(t.id('clube_b')));
reset role;
select t.eq('anon sem EXECUTE nas capacidades novas',
  t.n($q$select count(*) from unnest(array['pode_administrar_clube(uuid)','pode_avaliar_curriculo(uuid)','pode_gerir_atividades(uuid)']) f
         where has_function_privilege('anon', 'public.' || f, 'execute')$q$), 0);

-- ==================== 2) instrutor AVALIA requisito de classe ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro inicia a classe', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_piloto')));
select t.permitido('membro envia o requisito', format($q$select public.requisito_salvar(%L, %L, null)$q$, t.id('req_espiritual_2'), 'Aprendi sobre paciência.'));
select t.permitido('...e envia', format($q$select public.requisito_enviar(%L)$q$, t.id('req_espiritual_2')));
reset role;
insert into t.ids (chave, id) select 'mr78', r.id from public.member_requirements r join public.member_classes c on c.id = r.member_class_id
 where c.usuario_id = t.id('membro_a') and c.club_id = t.id('clube_a') and r.requirement_id = t.id('req_espiritual_2');
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.ok('instrutor vê o envio na fila unificada', (public.fila_avaliacao_unificada(null, null))::text like '%' || t.id('mr78')::text || '%');
select t.permitido('instrutor pede correção do requisito',
  format($q$select public.requisito_avaliar(%L, 'correcao_solicitada', 'Conte com mais detalhes.')$q$, t.id('mr78')));
reset role;
select t.eq('...e o requisito voltou para correção', (select status from public.member_requirements where id = t.id('mr78')), 'correcao_solicitada');
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.throws('conselheiro NÃO avalia requisito', format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.id('mr78')));

-- ==================== 3) instrutor CRIA desafio e AVALIA missão ====================
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('instrutor cria desafio', $q$insert into public.desafios (pergunta, opcoes, correta, club_id) values ('Quem? 78', '["a","b"]', 0, public.clube_atual_id())$q$);
select t.permitido('instrutor edita desafio', $q$update public.desafios set tema = 'editado 78' where pergunta = 'Quem? 78'$q$);
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.bloqueado('conselheiro NÃO cria desafio', $q$insert into public.desafios (pergunta, opcoes, correta, club_id) values ('hack 78', '[]', 0, public.clube_atual_id())$q$);
reset role;
\o /dev/null
insert into public.missoes_feitas (usuario_id, data, status, club_id) values (t.id('membro_a'), current_date - 3, 'pendente', t.id('clube_a'));
insert into t.ids (chave, id) select 'mf78', id from public.missoes_feitas where usuario_id = t.id('membro_a') and status = 'pendente' and data = current_date - 3;
\o
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.throws('conselheiro NÃO avalia missão', format($q$select public.avaliar_missao(%L, false)$q$, t.id('mf78')), 'Sem permissão');
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('instrutor avalia missão', format($q$select public.avaliar_missao(%L, false)$q$, t.id('mf78')), 0);
reset role;
select t.eq('...e a missão foi avaliada', (select status from public.missoes_feitas where id = t.id('mf78')), 'reprovada');

-- ==================== 4) instrutor NÃO administra pessoas nem o clube ====================
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('instrutor não vê cadastros pendentes', t.txt($q$select public.entradas_pendentes()::text$q$), '[]');
select t.throws('instrutor NÃO aprova cadastro', format($q$select public.vinculo_gerir(%L, p_status := 'ativo')$q$, t.id('pendente78')), 'Sem permissão');
select t.throws('instrutor NÃO muda unidade de membro', format($q$select public.vinculo_gerir(%L, p_unidade_id := %L)$q$, t.id('membro_a'), t.id('A2')), 'Sem permissão');
select t.throws('instrutor NÃO muda papel de membro', format($q$select public.vinculo_gerir(%L, p_papel := 'conselheiro')$q$, t.id('membro_a2')), 'Sem permissão');
select t.throws('instrutor NÃO desativa membro', format($q$select public.vinculo_gerir(%L, p_status := 'inativo')$q$, t.id('membro_a2')), 'Sem permissão');
select t.throws('instrutor NÃO gera código de inscrição', $q$select public.clube_codigo_gerar(null, 'desbravador')$q$, 'Sem permissão');
select t.throws('instrutor NÃO vê o código de inscrição', $q$select public.clube_codigo_atual()$q$, 'Sem permissão');
select t.throws('instrutor NÃO convida equipe', $q$select public.convite_equipe_criar('novo78@teste.local', 'conselheiro', null)$q$, 'Sem permissão');
select t.eq('instrutor não lista convites de equipe', t.txt($q$select public.convites_do_clube()::text$q$), '[]');
select t.ok('...nem pela tabela (0 linhas ou sem acesso)', t.n($q$select count(*) from public.club_team_invites$q$) <= 0);
select t.throws('instrutor NÃO redefine senha', format($q$select public.resetar_senha_membro(%L, 'NovaSenha2026')$q$, t.id('membro_a')), 'Sem permissão');
select t.throws('instrutor NÃO cria convite de responsável', $q$select public.criar_convite_responsavel()$q$, 'Sem permissão');
select t.throws('instrutor NÃO grava a marca', $q$select public.clube_marca_gravar('{"lema":"hack"}'::jsonb)$q$, 'Sem permissão');
select t.throws('instrutor NÃO liga/desliga recurso', $q$select public.recurso_definir('mural', false)$q$, 'Sem permissão');
select t.throws('instrutor NÃO grava config', $q$select public.config_gravar('[{"chave":"pix","valor":"hack"}]'::jsonb)$q$, 'Sem permissão');
select t.bloqueado('instrutor NÃO grava config direto na tabela', $q$update public.config_clube set valor = 'hack' where chave = 'pix'$q$);
select t.throws('instrutor NÃO apaga unidade', format($q$select public.unidade_excluir(%L)$q$, t.id('A2')), 'Sem permissão');
select t.bloqueado('instrutor NÃO apaga unidade direto na tabela', format($q$delete from public.unidades where id = %L$q$, t.id('A2')));
select t.ok('instrutor não recebe o aviso de "cadastros a aprovar" no Início', public.meu_inicio()::text not like '%aprovacoes%');
select t.ok('...nem o contador de cadastros na fila', coalesce((public.avaliacoes_pendentes() ->> 'cadastros')::int, 0) = 0);

-- conselheiro também não aprova ninguém
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.throws('conselheiro NÃO aprova cadastro', format($q$select public.vinculo_gerir(%L, p_status := 'ativo')$q$, t.id('pendente78')), 'Sem permissão');
select t.throws('conselheiro NÃO gera código', $q$select public.clube_codigo_gerar(null, 'desbravador')$q$, 'Sem permissão');
reset role;
select t.eq('o cadastro pendente segue pendente', (select status from public.organization_memberships where user_id = t.id('pendente78')), 'pendente');
select t.eq('a unidade A2 segue lá', t.n(format($q$select count(*) from public.unidades where id = %L$q$, t.id('A2'))), 1);

-- ==================== 5) diretoria continua podendo tudo ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.ok('diretoria vê o cadastro pendente', public.entradas_pendentes()::text like '%' || t.id('pendente78')::text || '%');
select t.ok('diretoria recebe o aviso de cadastros no Início', public.meu_inicio()::text like '%aprovacoes%');
select t.permitido('diretoria aprova cadastro', format($q$select public.vinculo_gerir(%L, p_status := 'ativo', p_unidade_id := %L)$q$, t.id('pendente78'), t.id('A1')));
select t.permitido('diretoria muda unidade', format($q$select public.vinculo_gerir(%L, p_unidade_id := %L)$q$, t.id('membro_a2'), t.id('A1')));
select t.permitido('diretoria gera código de inscrição', $q$select public.clube_codigo_gerar(7, 'desbravador')$q$);
select t.permitido('diretoria convida equipe', $q$select public.convite_equipe_criar('novo78@teste.local', 'instrutor', 'Capelão')$q$);
select t.ok('diretoria lista convites', public.convites_do_clube()::text like '%novo78@teste.local%');
select t.permitido('diretoria cria convite de responsável', $q$select public.criar_convite_responsavel()$q$);
select t.permitido('diretoria grava a marca', $q$select public.clube_marca_gravar('{"lema":"Sempre 78"}'::jsonb)$q$);
select t.permitido('diretoria liga/desliga recurso', $q$select public.recurso_definir('mural', true)$q$);
select t.permitido('diretoria grava config', $q$update public.config_clube set valor = 'PIX-78' where chave = 'pix'$q$);
select t.permitido('diretoria vê o histórico do requisito', format($q$select public.requisito_historico(%L)$q$, t.id('mr78')), 0);
select t.permitido('diretoria cria desafio', $q$insert into public.desafios (pergunta, opcoes, correta, club_id) values ('Dir 78', '["a"]', 0, public.clube_atual_id())$q$);
select t.permitido('diretoria redefine senha de membro', format($q$select public.resetar_senha_membro(%L, 'NovaSenha2026')$q$, t.id('membro_a')), 0);
select t.permitido('diretoria apaga unidade', format($q$select public.unidade_excluir(%L)$q$, t.id('A2')));
reset role;
select t.eq('o cadastro foi aprovado pela diretoria', (select status from public.organization_memberships where user_id = t.id('pendente78')), 'ativo');

select * from t.fim();
rollback;
