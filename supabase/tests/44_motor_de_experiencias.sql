-- =============================================================================
--  FASE 6 — Motor de experiências no-code (migration 49).
--
--  Prova que:
--    * o motor representa os tipos iniciais SEM tabela por modalidade;
--    * o clube configura por VOCABULÁRIO FECHADO — não há como guardar SQL, JS ou expressão executável;
--    * publicado não se reescreve (mudança incompatível vira versão nova);
--    * recompensa é idempotente pelo BANCO (clique duplo/retry/concorrência não pagam duas vezes);
--    * evidência é privada e não atravessa clube nem unidade;
--    * as três camadas da fase 5 (plano → clube → permissão) valem aqui também;
--    * currículo oficial e experiências do clube seguem SEPARADOS.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

-- Fase 8.2: `recurso_disponivel_no_plano` deixou de ser chamavel por `authenticated` — era por
-- ela que o vetor comercial de QUALQUER clube vazava (o red-team leu plano, overrides e
-- suspensao de um clube pagante com uma conta sem vinculo nenhum).
--
-- As sondas abaixo perguntam o que o PLANO contem, nao quem pode perguntar — logo rodam como
-- postgres. `t.pg()` faz isso sem mexer no papel da sessao: quem estava logado continua logado
-- no proximo assert.
create function t.pg(p_sql text) returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin execute p_sql into v; return v; exception when others then return 'ERRO: ' || sqlerrm; end $$;
\set ON_ERROR_STOP on
\o /dev/null

-- o recurso nasce DESLIGADO (padrao = false): a liderança liga. Nos dois clubes de teste, ligamos.
insert into public.club_features (club_id, feature, enabled) values
  (t.id('clube_a'), 'experiencias', true), (t.id('clube_b'), 'experiencias', true)
on conflict (club_id, feature) do update set enabled = true;
\o

-- =============================================================================
-- 1) SEPARAÇÃO DOS DOIS MOTORES + NADA EXECUTÁVEL (garantias ESTRUTURAIS)
-- =============================================================================
select t.eq('NENHUMA função do motor de experiências toca no motor curricular (nem por acidente)',
  t.n($q$select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and (p.proname ~ '^_?experienc' or p.proname ~ '^temporada' or p.proname ~ '^_exp_' or p.proname ~ '^_validar_(regra|recompensa)')
        and p.prosrc ~ '(member_requirements|requirement_approvals|member_classes|member_specialties|curriculum_achievements|class_completion_snapshots|class_investitures)'$q$), 0);
select t.eq('NENHUMA função do motor executa SQL dinâmico (o que o clube configura é lido, nunca executado)',
  t.n($q$select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and (p.proname ~ '^_?experienc' or p.proname ~ '^temporada' or p.proname ~ '^_exp_' or p.proname ~ '^_validar_(regra|recompensa)'
             or p.proname in ('_texto_seguro', '_so_estas_chaves', '_inteiro_entre'))
        and p.prosrc ~* '\mexecute\M'$q$), 0);
select t.eq('as experiências NÃO reaproveitam curriculum_achievements (nenhuma FK pra lá)',
  t.n($q$select count(*) from pg_constraint k join pg_class c on c.oid = k.conrelid
        where c.relname like 'experience%' and k.contype = 'f'
          and k.confrelid in ('public.curriculum_achievements'::regclass, 'public.member_classes'::regclass)$q$), 0);

-- =============================================================================
-- 2) OS PILOTOS [TESTE] DO CLUBE LEGADO SAÍRAM (migration 83)
-- =============================================================================
-- A migration 49 semeava 4 experiências e 1 temporada [TESTE] no clube legado (Tenant 001), e o ensaio
-- de produção mostrou que o upgrade as criava no cliente real. A 83 apaga as que não tiveram uso (no
-- upgrade, todas: o recurso nasce desligado) e arquiva as que tiveram. Exemplo não mora em clube de
-- cliente: os modelos da plataforma (seção F da 49) continuam servindo de ponto de partida.
select t.eq('nenhuma experiência [TESTE] ficou no clube legado',
  t.n(format($q$select count(*) from public.experiences where club_id = %L and teste$q$, t.id('clube_a'))), 0);
select t.eq('...nem a temporada piloto',
  t.n(format($q$select count(*) from public.experience_seasons where club_id = %L and teste$q$, t.id('clube_a'))), 0);
select t.eq('o recurso nasce DESLIGADO no catálogo (nenhum clube vê nada sem a liderança ligar)',
  t.txt($q$select padrao::text from public.recursos_catalogo where chave = 'experiencias'$q$), 'false');

-- =============================================================================
-- 3) RED-TEAM DO NO-CODE: o clube não escapa do vocabulário
-- =============================================================================
select t.como('lider_a');
select t.pedir_clube('clube_a');
\o /dev/null
reset role;
create table t.antes_exp as select count(*) n from public.experiences;
\o
select t.como('lider_a');
select t.pedir_clube('clube_a');

select t.throws('HTML no título é recusado (conteúdo é gerado por usuário)',
  $q$select public.experiencia_salvar(null, '{"titulo":"<script>alert(1)</script>","tipo":"desafio_individual"}'::jsonb)$q$, 'não aceita HTML');
select t.throws('atributo de evento (onerror=) é recusado',
  $q$select public.experiencia_salvar(null, '{"titulo":"Ok","descricao":"img src=x onerror=roubar()"}'::jsonb)$q$, 'não permitido');
select t.throws('javascript: na descrição é recusado',
  $q$select public.experiencia_salvar(null, '{"titulo":"Ok","descricao":"clique javascript:fetch(1)"}'::jsonb)$q$, 'não permitido');
select t.throws('campo fora do vocabulário da experiência é recusado',
  $q$select public.experiencia_salvar(null, '{"titulo":"Ok","sql":"drop table public.pontos"}'::jsonb)$q$, 'não permitido');
select t.throws('regra de conclusão inventada é recusada',
  $q$select public.experiencia_salvar(null, '{"titulo":"Ok","regra_conclusao":{"tipo":"executar","codigo":"select 1"}}'::jsonb)$q$, 'Regra de conclusão desconhecida');
select t.throws('recompensa fora da faixa é recusada',
  $q$select public.experiencia_salvar(null, '{"titulo":"Ok","recompensa":{"tipo":"pontos","valor":99999999}}'::jsonb)$q$, 'entre 1 e 10000');
select t.throws('recompensa inventada é recusada',
  $q$select public.experiencia_salvar(null, '{"titulo":"Ok","recompensa":{"tipo":"pix","valor":10}}'::jsonb)$q$, 'Recompensa desconhecida');
reset role;
select t.eq('NENHUMA dessas tentativas criou linha (o vocabulário barra na escrita)',
  t.n($q$select count(*) from public.experiences$q$), t.n($q$select n from t.antes_exp$q$));

-- =============================================================================
-- 4) CONSTRUTOR: experiência INDIVIDUAL ponta a ponta
-- =============================================================================
select t.como('lider_a');
select t.pedir_clube('clube_a');
\o /dev/null
select public.experiencia_salvar(null, '{"titulo":"Desafio da semana","descricao":"Leia e conte","tipo":"desafio_individual","alvo":"individual","recompensa":{"tipo":"pontos","valor":30}}'::jsonb);
reset role;
insert into t.ids select 'exp1', id from public.experiences where titulo = 'Desafio da semana';
select t.como('lider_a'); select t.pedir_clube('clube_a');
select public.experiencia_etapa_salvar(t.id('exp1'), null, '{"titulo":"Li o capitulo","evidencia":"confirmacao","ordem":1,"pontos":10}'::jsonb);
select public.experiencia_etapa_salvar(t.id('exp1'), null, '{"titulo":"O que achei","evidencia":"texto","ordem":2,"pontos":20,"regra":{"min_caracteres":10}}'::jsonb);
\o
select t.throws('publicar sem público definido é recusado',
  format($q$select public.experiencia_estado(%L, 'publicada')$q$, t.id('exp1')), 'escolher o público');
select t.permitido('define o público (todos do clube)',
  format($q$select public.experiencia_publico_definir(%L, '[{"tipo":"todos"}]'::jsonb)$q$, t.id('exp1')));
select t.throws('público com papel inventado é recusado',
  format($q$select public.experiencia_publico_definir(%L, '[{"tipo":"papel","papel":"bispo"}]'::jsonb)$q$, t.id('exp1')), 'Papel desconhecido');
select t.throws('público apontando pra unidade de OUTRO clube é recusado',
  format($q$select public.experiencia_publico_definir(%L, %L::jsonb)$q$, t.id('exp1'),
         json_build_array(json_build_object('tipo', 'unidade', 'unidade_id', t.id('B1')))::text), 'Unidade não encontrada neste clube');
\o /dev/null
select public.experiencia_publico_definir(t.id('exp1'), '[{"tipo":"todos"}]'::jsonb);
\o
select t.eq('agenda antes de publicar', t.txt(format($q$select public.experiencia_estado(%L, 'agendada') ->> 'status'$q$, t.id('exp1'))), 'agendada');
select t.eq('publica', t.txt(format($q$select public.experiencia_estado(%L, 'publicada') ->> 'status'$q$, t.id('exp1'))), 'publicada');
select t.throws('estado inválido é recusado (publicada não volta a rascunho)',
  format($q$select public.experiencia_estado(%L, 'rascunho')$q$, t.id('exp1')), 'Mudança de estado inválida');

-- ---------- membro participa e conclui ----------
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.permitido('membro participa', format($q$select public.experiencia_participar(%L)$q$, t.id('exp1')));
select t.permitido('participar de novo é idempotente (não cria 2ª participação)', format($q$select public.experiencia_participar(%L)$q$, t.id('exp1')));
reset role;
select t.eq('...continua UMA participação', t.n(format($q$select count(*) from public.experience_participations where experience_id = %L$q$, t.id('exp1'))), 1);
\o /dev/null
insert into t.ids select 'part1', id from public.experience_participations where experience_id = t.id('exp1');
insert into t.ids select 'et1', id from public.experience_stages where experience_id = t.id('exp1') and ordem = 1;
insert into t.ids select 'et2', id from public.experience_stages where experience_id = t.id('exp1') and ordem = 2;
\o
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('envia a etapa 1 (confirmação)', format($q$select public.experiencia_etapa_enviar(%L, '{}'::jsonb)$q$, t.id('et1')));
reset role;
select t.eq('ainda NÃO concluiu (falta a etapa 2)',
  t.txt(format($q$select status from public.experience_participations where id = %L$q$, t.id('part1'))), 'em_andamento');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('texto curto demais é recusado pela regra da etapa',
  format($q$select public.experiencia_etapa_enviar(%L, '{"texto":"oi"}'::jsonb)$q$, t.id('et2')), 'Escreva um pouco mais');
select t.throws('HTML na resposta do participante também é recusado',
  format($q$select public.experiencia_etapa_enviar(%L, '{"texto":"<b>gostei muito mesmo</b>"}'::jsonb)$q$, t.id('et2')), 'não aceita HTML');
select t.permitido('envia a etapa 2 (texto)', format($q$select public.experiencia_etapa_enviar(%L, '{"texto":"Gostei bastante da leitura desta semana"}'::jsonb)$q$, t.id('et2')));
reset role;
select t.eq('agora CONCLUIU (regra: todas as etapas obrigatórias)',
  t.txt(format($q$select status from public.experience_participations where id = %L$q$, t.id('part1'))), 'concluida');

-- =============================================================================
-- 5) RECOMPENSA IDEMPOTENTE (clique duplo, retry, concorrência)
-- =============================================================================
select t.eq('a recompensa foi concedida UMA vez', t.n(format($q$select count(*) from public.experience_rewards where participation_id = %L$q$, t.id('part1'))), 1);
select t.eq('...e virou UM lançamento no ledger de pontos que já existia',
  t.n(format($q$select count(*) from public.pontos where usuario_id = %L and origem = 'experiencia'$q$, t.id('membro_a'))), 1);
select t.eq('...com o valor do plano da experiência',
  t.n(format($q$select pontos from public.pontos where usuario_id = %L and origem = 'experiencia'$q$, t.id('membro_a'))), 30);
select t.permitido('reprocessar a conclusão (retry/webhook interno/clique duplo)',
  format($q$select public._experiencia_avaliar_conclusao(%L)$q$, t.id('part1')), 0);
select t.permitido('...e de novo, direto na concessão',
  format($q$select public._experiencia_conceder_recompensa(%L)$q$, t.id('part1')), 0);
select t.eq('CONTINUA uma recompensa só', t.n(format($q$select count(*) from public.experience_rewards where participation_id = %L$q$, t.id('part1'))), 1);
select t.eq('...e um lançamento de pontos só',
  t.n(format($q$select count(*) from public.pontos where usuario_id = %L and origem = 'experiencia'$q$, t.id('membro_a'))), 1);
select t.eq('a garantia é do BANCO: chave_idempotencia é UNIQUE',
  t.n($q$select count(*) from pg_constraint where conrelid = 'public.experience_rewards'::regclass and contype = 'u'$q$), 1);
select t.throws('duas concessões concorrentes com a mesma chave batem na unicidade',
  format($q$insert into public.experience_rewards (club_id, experience_id, participation_id, tipo, chave_idempotencia)
           values (%L, %L, %L, 'pontos', 'exp:' || %L || ':part:' || %L || ':final')$q$,
         t.id('clube_a'), t.id('exp1'), t.id('part1'), t.id('exp1'), t.id('part1')), 'duplicate key');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('reenviar etapa de participação já concluída é recusado',
  format($q$select public.experiencia_etapa_enviar(%L, '{"texto":"tentando de novo pra ganhar mais"}'::jsonb)$q$, t.id('et2')), 'já foi concluída');

-- =============================================================================
-- 6) PUBLICADO NÃO SE REESCREVE — e versão nova não toca no histórico
-- =============================================================================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('mudar a RECOMPENSA de algo publicado é recusado',
  format($q$select public.experiencia_salvar(%L, '{"recompensa":{"tipo":"pontos","valor":999}}'::jsonb)$q$, t.id('exp1')), 'não pode mudar');
select t.throws('mudar o PERÍODO de algo publicado é recusado',
  format($q$select public.experiencia_salvar(%L, '{"fim":"2030-01-01T00:00:00Z"}'::jsonb)$q$, t.id('exp1')), 'não pode mudar');
select t.throws('acrescentar ETAPA em algo publicado é recusado',
  format($q$select public.experiencia_etapa_salvar(%L, null, '{"titulo":"etapa nova","evidencia":"confirmacao","ordem":3}'::jsonb)$q$, t.id('exp1')), 'já foi publicada');
select t.throws('mudar o PÚBLICO de algo publicado é recusado',
  format($q$select public.experiencia_publico_definir(%L, '[{"tipo":"todos"}]'::jsonb)$q$, t.id('exp1')), 'já foi publicada');
select t.permitido('corrigir um erro de digitação no título continua permitido',
  format($q$select public.experiencia_salvar(%L, '{"titulo":"Desafio da semana (corrigido)"}'::jsonb)$q$, t.id('exp1')));
select t.permitido('mudança incompatível vira VERSÃO NOVA', format($q$select public.experiencia_nova_versao(%L)$q$, t.id('exp1')));
reset role;
select t.eq('a versão nova nasce em rascunho, versão 2',
  t.txt(format($q$select status || '/' || versao from public.experiences where raiz_id = %L$q$, t.id('exp1'))), 'rascunho/2');
select t.eq('...com as etapas copiadas',
  t.n(format($q$select count(*) from public.experience_stages s join public.experiences e on e.id = s.experience_id where e.raiz_id = %L$q$, t.id('exp1'))), 2);
select t.eq('...e o histórico de quem participou da versão 1 INTACTO',
  t.txt(format($q$select status from public.experience_participations where id = %L$q$, t.id('part1'))), 'concluida');

-- =============================================================================
-- 7) EXPERIÊNCIA POR UNIDADE, COM EVIDÊNCIA PRIVADA E VALIDAÇÃO DA LIDERANÇA
-- =============================================================================
select t.como('lider_a'); select t.pedir_clube('clube_a');
\o /dev/null
select public.experiencia_salvar(null, '{"titulo":"Mutirao da unidade","tipo":"tarefa_evidencia","alvo":"unidade","recompensa":{"tipo":"pontos","valor":50}}'::jsonb);
reset role;
insert into t.ids select 'exp2', id from public.experiences where titulo = 'Mutirao da unidade';
select t.como('lider_a'); select t.pedir_clube('clube_a');
select public.experiencia_etapa_salvar(t.id('exp2'), null, '{"titulo":"Foto do mutirao","evidencia":"foto","exige_aprovacao":true,"ordem":1,"pontos":50,"regra":{"max_arquivos":1}}'::jsonb);
select public.experiencia_publico_definir(t.id('exp2'), '[{"tipo":"todos"}]'::jsonb);
select public.experiencia_estado(t.id('exp2'), 'publicada');
reset role;
insert into t.ids select 'et_foto', id from public.experience_stages where experience_id = t.id('exp2');
\o
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro participa em nome da UNIDADE dele', format($q$select public.experiencia_participar(%L)$q$, t.id('exp2')));
reset role;
select t.eq('a participação é da unidade, não da pessoa',
  t.txt(format($q$select case when unidade_id = %L then 'unidade-A1' else 'outro' end from public.experience_participations where experience_id = %L$q$,
        t.id('A1'), t.id('exp2'))), 'unidade-A1');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('arquivo na pasta de OUTRA pessoa é recusado',
  format($q$select public.experiencia_etapa_enviar(%L, %L::jsonb)$q$, t.id('et_foto'),
         json_build_object('arquivo_path', t.id('membro_a2') || '/mutirao.jpg')::text), 'sua própria pasta');
select t.permitido('envia a foto na própria pasta privada de comprovações',
  format($q$select public.experiencia_etapa_enviar(%L, %L::jsonb)$q$, t.id('et_foto'),
         json_build_object('arquivo_path', t.id('membro_a') || '/mutirao.jpg')::text));
reset role;
select t.eq('com validação da liderança exigida, fica AGUARDANDO (não conclui sozinho)',
  t.txt(format($q$select status from public.experience_submissions where stage_id = %L$q$, t.id('et_foto'))), 'enviada');
select t.eq('...e a unidade ainda não recebeu ponto nenhum',
  t.n(format($q$select count(*) from public.pontos where unidade_id = %L and origem = 'experiencia'$q$, t.id('A1'))), 0);
\o /dev/null
insert into t.ids select 'sub_foto', id from public.experience_submissions where stage_id = t.id('et_foto');
\o

-- ---------- evidência é PRIVADA ----------
select t.como('membro_b');
select t.eq('membro de OUTRO clube não vê a evidência',
  t.nv(format($q$select count(*) from public.experience_submissions where id = %L$q$, t.id('sub_foto'))), 0);
select t.como('lider_b');
select t.pedir_clube('clube_b');
select t.eq('LIDERANÇA de outro clube não vê a evidência',
  t.nv(format($q$select count(*) from public.experience_submissions where id = %L$q$, t.id('sub_foto'))), 0);
select t.eq('...nem a experiência', t.nv(format($q$select count(*) from public.experiences where id = %L$q$, t.id('exp2'))), 0);
select t.throws('...nem consegue avaliar a evidência do clube A',
  format($q$select public.experiencia_avaliar(%L, 'aprovada')$q$, t.id('sub_foto')), 'não encontrado neste clube');
select t.como('membro_a2');
select t.pedir_clube('clube_a');
select t.eq('membro do MESMO clube mas de outra unidade não vê a evidência da unidade A1',
  t.nv(format($q$select count(*) from public.experience_submissions where id = %L$q$, t.id('sub_foto'))), 0);
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('quem enviou vê a própria evidência', t.n(format($q$select count(*) from public.experience_submissions where id = %L$q$, t.id('sub_foto'))), 1);

-- ---------- liderança valida e a unidade recebe ----------
select t.como('membro_a');
select t.throws('membro comum NÃO pode validar evidência',
  format($q$select public.experiencia_avaliar(%L, 'aprovada')$q$, t.id('sub_foto')), 'Sem permissão');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('liderança aprova a evidência', format($q$select public.experiencia_avaliar(%L, 'aprovada', 'ficou otimo')$q$, t.id('sub_foto')));
reset role;
select t.eq('a participação da UNIDADE concluiu',
  t.txt(format($q$select status from public.experience_participations where experience_id = %L$q$, t.id('exp2'))), 'concluida');
select t.eq('...e a UNIDADE recebeu os pontos (uma vez)',
  t.n(format($q$select count(*) from public.pontos where unidade_id = %L and origem = 'experiencia'$q$, t.id('A1'))), 1);

-- =============================================================================
-- 8) TEMPORADA COM VÁRIAS EXPERIÊNCIAS
-- =============================================================================
select t.como('lider_a'); select t.pedir_clube('clube_a');
\o /dev/null
select public.temporada_salvar(null, '{"titulo":"Temporada do trimestre","inicio":"2026-01-01T00:00:00Z","fim":"2026-12-31T00:00:00Z"}'::jsonb);
reset role;
insert into t.ids select 'temp1', id from public.experience_seasons where titulo = 'Temporada do trimestre';
select t.como('lider_a'); select t.pedir_clube('clube_a');
select public.experiencia_salvar(null, format('{"titulo":"Quiz da temporada","tipo":"quiz","season_id":"%s"}', t.id('temp1'))::jsonb);
select public.experiencia_salvar(null, format('{"titulo":"Meta do trimestre","tipo":"meta_quantitativa","season_id":"%s"}', t.id('temp1'))::jsonb);
\o
reset role;
select t.eq('uma temporada agrupa várias experiências',
  t.n(format($q$select count(*) from public.experiences where season_id = %L$q$, t.id('temp1'))), 2);
select t.eq('...e tem início e fim próprios',
  t.n(format($q$select count(*) from public.experience_seasons where id = %L and inicio is not null and fim is not null$q$, t.id('temp1'))), 1);

-- =============================================================================
-- 9) QUIZ: resposta certa NUNCA vai pro participante
-- =============================================================================
reset role;
\o /dev/null
insert into t.ids select 'exp_quiz', id from public.experiences where titulo = 'Quiz da temporada';
\o
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('quiz com resposta correta fora das opções é recusado',
  format($q$select public.experiencia_etapa_salvar(%L, null, '{"titulo":"Q","evidencia":"quiz","ordem":1,"regra":{"perguntas":[{"texto":"a?","opcoes":["x","y"],"correta":9}],"acertos_minimos":1}}'::jsonb)$q$,
         t.id('exp_quiz')), 'entre 0 e 1');
select t.throws('quiz com campo a mais na pergunta é recusado',
  format($q$select public.experiencia_etapa_salvar(%L, null, '{"titulo":"Q","evidencia":"quiz","ordem":1,"regra":{"perguntas":[{"texto":"a?","opcoes":["x","y"],"correta":0,"script":"alert(1)"}],"acertos_minimos":1}}'::jsonb)$q$,
         t.id('exp_quiz')), 'não permitido');
\o /dev/null
select public.experiencia_etapa_salvar(t.id('exp_quiz'), null, '{"titulo":"Pergunta","evidencia":"quiz","ordem":1,"pontos":10,"regra":{"perguntas":[{"texto":"Quanto e 2+2?","opcoes":["3","4","5"],"correta":1}],"acertos_minimos":1}}'::jsonb);
select public.experiencia_publico_definir(t.id('exp_quiz'), '[{"tipo":"todos"}]'::jsonb);
select public.experiencia_estado(t.id('exp_quiz'), 'publicada');
\o
select t.eq('a liderança enxerga a resposta correta (ela montou o quiz)',
  t.txt(format($q$select (public.experiencia_detalhe(%L) #> '{etapas,0,regra,perguntas,0}' ? 'correta')::text$q$, t.id('exp_quiz'))), 'true');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('o PARTICIPANTE não recebe a resposta correta',
  t.txt(format($q$select (public.experiencia_detalhe(%L) #> '{etapas,0,regra,perguntas,0}' ? 'correta')::text$q$, t.id('exp_quiz'))), 'false');
select t.eq('...mas recebe o enunciado e as opções',
  t.txt(format($q$select public.experiencia_detalhe(%L) #>> '{etapas,0,regra,perguntas,0,texto}'$q$, t.id('exp_quiz'))), 'Quanto e 2+2?');

-- =============================================================================
-- 10) PESSOA EM DOIS CLUBES vê só o clube EM USO
-- =============================================================================
\o /dev/null
reset role;
-- uma experiência publicada no clube B, pra provar a separação
insert into public.experiences (club_id, tipo, alvo, titulo, status, publicado_em, regra_conclusao, recompensa)
values (t.id('clube_b'), 'desafio_individual', 'individual', 'So do clube B', 'rascunho', now(), '{"tipo":"todas_etapas"}'::jsonb, '{"tipo":"nenhuma"}'::jsonb);
insert into t.ids select 'exp_b', id from public.experiences where titulo = 'So do clube B';
insert into public.experience_stages (club_id, experience_id, ordem, titulo, evidencia) values (t.id('clube_b'), t.id('exp_b'), 1, 'Etapa B', 'confirmacao');
insert into public.experience_audiences (club_id, experience_id, tipo) values (t.id('clube_b'), t.id('exp_b'), 'todos');
update public.experiences set status = 'publicada' where id = t.id('exp_b');   -- etapas primeiro, publicação depois
\o
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_a');
select t.eq('no clube A, a pessoa de dois clubes NÃO vê a experiência do clube B',
  t.n(format($q$select count(*) from json_array_elements(public.experiencias_do_clube()) x where x ->> 'titulo' = 'So do clube B'$q$)), 0);
select t.ok('...e vê as do clube A',
  t.n($q$select json_array_length(public.experiencias_do_clube())$q$) > 0);
select t.pedir_clube('clube_b');
select t.eq('no clube B, vê a do clube B',
  t.n($q$select count(*) from json_array_elements(public.experiencias_do_clube()) x where x ->> 'titulo' = 'So do clube B'$q$), 1);
select t.eq('...e NÃO vê as do clube A',
  t.n($q$select count(*) from json_array_elements(public.experiencias_do_clube()) x where x ->> 'titulo' like 'Desafio da semana%'$q$), 0);
select t.throws('e não consegue participar de uma experiência do outro clube',
  format($q$select public.experiencia_participar(%L)$q$, t.id('exp1')), 'não encontrada neste clube');

-- =============================================================================
-- 11) AS TRÊS CAMADAS DA FASE 5 (plano → clube → permissão)
-- =============================================================================
-- camada 3 (usuário): membro comum não constrói
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('membro comum não cria experiência', $q$select public.experiencia_salvar(null, '{"titulo":"minha"}'::jsonb)$q$, 'Sem permissão');
select t.throws('membro comum não publica', format($q$select public.experiencia_estado(%L, 'encerrada')$q$, t.id('exp1')), 'Sem permissão');

-- camada 2 (clube): a diretoria desliga o recurso
\o /dev/null
reset role;
update public.club_features set enabled = false where club_id = t.id('clube_b') and feature = 'experiencias';
\o
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('recurso DESLIGADO pelo clube fecha o motor inteiro',
  $q$select public.experiencias_do_clube()$q$, 'desabilitado neste clube');
select t.throws('...inclusive a construção', $q$select public.experiencia_salvar(null, '{"titulo":"x"}'::jsonb)$q$, 'desabilitado neste clube');
\o /dev/null
reset role;
update public.club_features set enabled = true where club_id = t.id('clube_b') and feature = 'experiencias';
\o
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('religado pelo clube, volta a funcionar', $q$select public.experiencias_do_clube()$q$, 0);

-- camada 1 (plano): assinatura no plano que NÃO inclui o módulo
\o /dev/null
reset role;
insert into public.billing_accounts (id, nome) values ('00000000-0000-4000-9000-000000000001', 'Cliente do clube B');
insert into public.subscriptions (id, billing_account_id, plan_id, status)
select '00000000-0000-4000-9000-000000000002', '00000000-0000-4000-9000-000000000001', id, 'ativa'
  from public.billing_plans where chave = 'essencial' and versao = 1;
insert into public.subscription_clubs (subscription_id, club_id) values ('00000000-0000-4000-9000-000000000002', t.id('clube_b'));
\o
select t.eq('o plano essencial v1 NÃO inclui o módulo novo (quem assinou a v1 segue na v1)',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'experiencias')::text$q$, t.id('clube_b'))), 'false');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('fora do plano, o motor não abre — mesmo com o clube tendo ligado',
  $q$select public.experiencias_do_clube()$q$, 'desabilitado neste clube');
\o /dev/null
reset role;
update public.subscriptions set plan_id = (select id from public.billing_plans where chave = 'essencial' and versao = 2)
 where id = '00000000-0000-4000-9000-000000000002';
\o
select t.eq('a versão NOVA do plano inclui o módulo',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'experiencias')::text$q$, t.id('clube_b'))), 'true');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('...e o motor abre', $q$select public.experiencias_do_clube()$q$, 0);

-- Tenant 001 sem assinatura segue funcionando
select t.eq('o Tenant 001 não tem assinatura e o plano não atrapalha',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'experiencias')::text$q$, t.id('clube_a'))), 'true');

-- =============================================================================
-- 12) REMOÇÃO DO VÍNCULO DURANTE A EXPERIÊNCIA — barra o futuro, não apaga o passado
-- =============================================================================
\o /dev/null
reset role;
insert into public.experiences (club_id, tipo, alvo, titulo, status, publicado_em, regra_conclusao, recompensa)
values (t.id('clube_a'), 'desafio_individual', 'individual', 'Em andamento', 'rascunho', now(), '{"tipo":"todas_etapas"}'::jsonb, '{"tipo":"nenhuma"}'::jsonb);
insert into t.ids select 'exp3', id from public.experiences where titulo = 'Em andamento';
insert into public.experience_stages (club_id, experience_id, ordem, titulo, evidencia) values (t.id('clube_a'), t.id('exp3'), 1, 'Marque', 'confirmacao');
insert into t.ids select 'et3', id from public.experience_stages where experience_id = t.id('exp3');
insert into public.experience_audiences (club_id, experience_id, tipo) values (t.id('clube_a'), t.id('exp3'), 'todos');
update public.experiences set status = 'publicada' where id = t.id('exp3');
\o
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('membro participa', format($q$select public.experiencia_participar(%L)$q$, t.id('exp3')));
\o /dev/null
reset role;
update public.organization_memberships set status = 'suspenso' where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_a');
\o
select t.como('membro_a2'); select t.pedir_clube('clube_a');
-- suspender o vínculo tira o clube da sessão inteira (clube_atual_id() deixa de honrar o pedido):
-- a barreira acontece antes mesmo do motor — que é o comportamento mais forte, não o mais fraco.
select t.throws('vínculo suspenso no meio da experiência barra o envio',
  format($q$select public.experiencia_etapa_enviar(%L, '{}'::jsonb)$q$, t.id('et3')), 'Sem clube em uso');
reset role;
select t.eq('...mas a participação NÃO é apagada (histórico preservado)',
  t.n(format($q$select count(*) from public.experience_participations where experience_id = %L$q$, t.id('exp3'))), 1);
\o /dev/null
reset role;
update public.organization_memberships set status = 'ativo' where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_a');
\o

-- =============================================================================
-- 13) TEMPLATE DA PLATAFORMA: cópia, e alterar o modelo depois NÃO mexe no clube
-- =============================================================================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('clube copia um modelo da plataforma', $q$select public.experiencia_do_template('leitura-da-semana')$q$);
reset role;
\o /dev/null
insert into t.ids select 'exp_tpl', id from public.experiences where template_chave = 'leitura-da-semana' and club_id = t.id('clube_a');
create table t.tpl_antes as
  select e.titulo, e.recompensa, (select count(*) from public.experience_stages s where s.experience_id = e.id) etapas
  from public.experiences e where e.id = t.id('exp_tpl');
\o
select t.eq('a cópia trouxe as etapas do modelo',
  t.n(format($q$select count(*) from public.experience_stages where experience_id = %L$q$, t.id('exp_tpl'))), 2);
select t.eq('...e guarda a proveniência (qual modelo, qual versão)',
  t.txt(format($q$select template_chave || ' v' || template_versao from public.experiences where id = %L$q$, t.id('exp_tpl'))), 'leitura-da-semana v1');
select t.como('lider_a'); select t.pedir_clube('clube_a');
\o /dev/null
select public.experiencia_publico_definir(t.id('exp_tpl'), '[{"tipo":"todos"}]'::jsonb);
select public.experiencia_estado(t.id('exp_tpl'), 'publicada');
-- a PLATAFORMA publica uma versão nova do mesmo modelo, bem diferente
reset role;
insert into public.experience_templates (chave, versao, tipo, alvo, titulo, descricao, definicao)
values ('leitura-da-semana', 2, 'desafio_individual', 'individual', 'Leitura da semana (nova)',
  'Versao 2 do modelo, com outra recompensa e outra etapa.',
  '{"sequencial": true, "regra_conclusao": {"tipo":"todas_etapas"}, "recompensa": {"tipo":"pontos","valor":999},
    "etapas": [{"ordem":1,"titulo":"Etapa unica da v2","evidencia":"confirmacao","regra":{},"pontos":999}]}'::jsonb);
\o
select t.eq('a plataforma publicou a v2 do modelo',
  t.n($q$select count(*) from public.experience_templates where chave = 'leitura-da-semana'$q$), 2);
select t.eq('a experiência JÁ PUBLICADA pelo clube continua com o título da cópia',
  t.txt(format($q$select titulo from public.experiences where id = %L$q$, t.id('exp_tpl'))), t.txt($q$select titulo from t.tpl_antes$q$));
select t.eq('...com a MESMA recompensa',
  t.txt(format($q$select recompensa::text from public.experiences where id = %L$q$, t.id('exp_tpl'))), t.txt($q$select recompensa::text from t.tpl_antes$q$));
select t.eq('...e as MESMAS etapas (mudar o modelo não reescreve o que o clube publicou)',
  t.n(format($q$select count(*) from public.experience_stages where experience_id = %L$q$, t.id('exp_tpl'))), t.n($q$select etapas from t.tpl_antes$q$));

-- =============================================================================
-- 14) ENCERRAMENTO E ARQUIVAMENTO
-- =============================================================================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('encerra', t.txt(format($q$select public.experiencia_estado(%L, 'encerrada') ->> 'status'$q$, t.id('exp1'))), 'encerrada');
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.throws('encerrada não aceita participação nova', format($q$select public.experiencia_participar(%L)$q$, t.id('exp1')), 'não está aberta');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('arquiva', t.txt(format($q$select public.experiencia_estado(%L, 'arquivada') ->> 'status'$q$, t.id('exp1'))), 'arquivada');
reset role;
select t.eq('arquivar NÃO apaga nada: a conclusão e a recompensa continuam lá',
  t.n(format($q$select count(*) from public.experience_rewards where participation_id = %L$q$, t.id('part1'))), 1);

-- =============================================================================
-- 15) AUDITORIA DO CONTEÚDO GERADO PELA LIDERANÇA
-- =============================================================================
select t.ok('a auditoria registrou criação, edição, público, estados e recompensa',
  t.n(format($q$select count(distinct acao) from public.experience_events where experience_id = %L$q$, t.id('exp1'))) >= 4);
select t.eq('...com o autor de cada ação',
  t.n(format($q$select count(*) from public.experience_events where experience_id = %L and ator_id is null$q$, t.id('exp1'))), 0);
select t.throws('a auditoria é IMUTÁVEL', $q$update public.experience_events set acao = 'mentira'$q$, 'imutável');
select t.throws('...e não pode ser apagada', $q$delete from public.experience_events$q$, 'imutável');

-- =============================================================================
-- 16) TENANT 001 × TENANT 002: nenhum vazamento nos dois sentidos
-- =============================================================================
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('liderança do clube B não enxerga NENHUMA experiência do clube A',
  t.nv(format($q$select count(*) from public.experiences where club_id = %L$q$, t.id('clube_a'))), 0);
select t.eq('...nem participações', t.nv(format($q$select count(*) from public.experience_participations where club_id = %L$q$, t.id('clube_a'))), 0);
select t.eq('...nem recompensas', t.nv(format($q$select count(*) from public.experience_rewards where club_id = %L$q$, t.id('clube_a'))), 0);
select t.eq('...nem a auditoria', t.nv(format($q$select count(*) from public.experience_events where club_id = %L$q$, t.id('clube_a'))), 0);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('e a liderança do clube A não enxerga as do clube B',
  t.nv(format($q$select count(*) from public.experiences where club_id = %L$q$, t.id('clube_b'))), 0);
select t.como_anon();
select t.eq('anônimo não vê experiência nenhuma', t.nv($q$select count(*) from public.experiences$q$), 0);
select t.eq('anônimo não vê evidência nenhuma', t.nv($q$select count(*) from public.experience_submissions$q$), 0);

select t.fim();
rollback;
