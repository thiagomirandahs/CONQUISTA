-- Classes de idade ANTERIOR e Avançadas (migration 518). Regra (não muda aqui): disponível se a idade atual
-- >= classes.idade_minima, SEM limite máximo; avançada exige a regular pareada iniciada/concluída.
-- 518 só acrescenta a classes_disponiveis(): "bloqueio" ('idade'|'pre_requisito'|null) e "anterior" (true =
-- a classe é de uma idade anterior à atual: idade_minima < maior idade_minima oficial já alcançada).
-- Cobre também a segurança do caminho (RPC direto, outro clube, outro usuário, inativos) e o multiclube,
-- e CARACTERIZAVA (até a 518) comportamentos que viraram decisão do dono na migration 519 (ver 125_classes_conclusao_entre_clubes):
--   sem nascimento não matricula; classe concluída em outro clube não é oferecida; iniciada só vale no clube atual.
-- Este teste foi ajustado à regra nova: as fixtures dão nascimento adulto à liderança (em _fixtures.sql).
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

create function t.classe(p_codigo text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('class:2026.4:' || p_codigo) $$;
create function t.classe_v(p_versao text, p_codigo text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('class:' || p_versao || ':' || p_codigo) $$;
-- "elegivel|bloqueio|anterior" de UMA classe em classes_disponiveis() (como o papel atual); '-' se não listada
create function t.d(p_codigo text) returns text language sql stable as $$
  select coalesce((select (c->>'elegivel') || '|' || coalesce(c->>'bloqueio', '-') || '|' || (c->>'anterior')
                     from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = p_codigo), '-') $$;
create function t.nasce(p_chave text, p_anos int) returns void language sql as $$
  update public.profiles set nascimento = (current_date - make_interval(years => p_anos))::date where id = t.id(p_chave) $$;
-- fotografia do que a matrícula de uma classe anterior NÃO pode tocar
create function t.outros() returns text language sql stable security definer as $$
  select (select count(*) from public.curriculum_achievements)::text || '|' || (select count(*) from public.class_documents) || '|'
      || (select count(*) from public.class_investitures) || '|' || (select count(*) from public.class_completion_snapshots) || '|'
      || (select count(*) from public.class_completion_events) || '|' || (select count(*) from public.investiture_reviews) || '|'
      || (select count(*) from public.document_signatures) || '|' || (select count(*) from public.requirement_approvals) || '|'
      || (select count(*) from public.member_requirements where status <> 'nao_iniciado') $$;
create function t.mc(p_chave text, p_codigo text, p_clube text) returns uuid language sql stable security definer as $$
  select id from public.member_classes where usuario_id = t.id(p_chave) and club_id = t.id(p_clube) and class_id = t.classe(p_codigo) $$;
create function t.nreq(p_codigo text) returns bigint language sql stable security definer as $$
  select count(*) from public.class_requirements r join public.class_sections s on s.id = r.section_id where s.class_id = t.classe(p_codigo) and r.ativo $$;

-- pessoas extras: suspensa, pendente e com vínculo encerrado em A; e uma sem nenhum vínculo
select t.mk('susp_a', 'Suspenso A', 'desbravador', 'suspenso', 'clube_a', 'A1', (current_date - interval '13 years')::date);
select t.mk('pend_a', 'Pendente A', 'desbravador', 'pendente', 'clube_a', 'A1', (current_date - interval '13 years')::date);
select t.mk('enc_a', 'Encerrado A', 'desbravador', 'ativo', 'clube_a', 'A1', (current_date - interval '13 years')::date);
update public.organization_memberships set ends_at = now() - interval '1 day', starts_at = now() - interval '2 days' where user_id = t.id('enc_a');
select t.signup('sem_clube', jsonb_build_object('nome', 'Sem Clube', 'cargo', 'Desbravador', 'nascimento', (current_date - interval '13 years')::date::text));

-- ==================== A) exatamente na idade mínima (10): Amigo elegível, NÃO anterior ====================
select t.nasce('membro_a', 10);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('A) 10 anos: Amigo elegível, sem bloqueio, NÃO anterior', t.d('amigo'), 'true|-|false');
select t.eq('A) 10 anos: Companheiro (11) bloqueio idade', t.d('companheiro'), 'false|idade|false');
select t.eq('A) 10 anos: Guia (15) bloqueio idade', t.d('guia'), 'false|idade|false');
select t.eq('A) 10 anos: Amigo da Natureza (avançada, 10) sem a regular = pre_requisito, NÃO anterior', t.d('amigo_da_natureza'), 'false|pre_requisito|false');
select t.eq('A) a lista continua com 12 classes, todas com os campos antigos e os 2 novos',
  t.n($q$select json_array_length(public.classes_disponiveis())$q$) * 1000
  + t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where c::jsonb ?& array['class_id','codigo','nome','faixa_etaria','idade_minima','manifesto_id','vigente_desde','avancada','classe_regular_codigo','elegivel','motivo_inelegivel','curriculum_version','bloqueio','anterior']$q$), 12012);
select t.eq('A) elegivel = (bloqueio is null) = (motivo is null) em TODAS as linhas',
  t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where (c->>'elegivel')::boolean <> (c->>'bloqueio' is null) or (c->>'elegivel')::boolean <> (c->>'motivo_inelegivel' is null)$q$), 0);
select t.eq('A) a ordem dos campos antigos foi mantida (novos no fim)',
  t.txt($q$select (select string_agg(k, ',') from json_object_keys(c) k) from json_array_elements(public.classes_disponiveis()) c limit 1$q$),
  'class_id,codigo,nome,faixa_etaria,idade_minima,manifesto_id,vigente_desde,avancada,classe_regular_codigo,elegivel,motivo_inelegivel,curriculum_version,bloqueio,anterior');
reset role;

-- ==================== B) acima da idade mínima ====================
select t.nasce('membro_a', 12);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('B) 12 anos: Amigo elegível e ANTERIOR', t.d('amigo'), 'true|-|true');
select t.eq('B) 12 anos: Companheiro elegível e ANTERIOR', t.d('companheiro'), 'true|-|true');
select t.eq('B) 12 anos: Pesquisador (a da idade atual) elegível, NÃO anterior', t.d('pesquisador'), 'true|-|false');
select t.eq('B) 12 anos: Pioneiro (13) bloqueio idade', t.d('pioneiro'), 'false|idade|false');
select t.eq('B) 12 anos: Amigo da Natureza (avançada anterior sem a regular) = pre_requisito E anterior', t.d('amigo_da_natureza'), 'false|pre_requisito|true');
reset role;
select t.nasce('membro_a', 16);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('B) 16 anos (sem limite máximo): Guia elegível, NÃO anterior (é a maior idade oficial)', t.d('guia'), 'true|-|false');
select t.eq('B) 16 anos: Amigo segue elegível e anterior', t.d('amigo'), 'true|-|true');
select t.eq('B) 16 anos: nenhuma classe com bloqueio de idade', t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where c->>'bloqueio' = 'idade'$q$), 0);
reset role;
select t.nasce('membro_a', 40);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('B) 40 anos: nenhum teto — as 6 regulares elegíveis, 5 delas anteriores',
  t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where not (c->>'avancada')::boolean and (c->>'elegivel')::boolean$q$) * 10
  + t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where not (c->>'avancada')::boolean and (c->>'anterior')::boolean$q$), 65);
reset role;
select t.nasce('membro_a', 14);

-- ==================== sem nascimento (lider_a): desde a 519 a idade não é verificável => bloqueio 'nascimento' ====================
-- (antes da 519 era só caracterização: "sem nascimento, sem trava". Decisão do dono: sem data de nascimento não matricula.)
update public.profiles set nascimento = null where id = t.id('lider_a');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('sem nascimento (519): Guia bloqueado por nascimento, anterior=false (não adivinha idade)', t.d('guia'), 'false|nascimento|false');
select t.eq('sem nascimento (519): Amigo também bloqueado por nascimento, anterior=false', t.d('amigo'), 'false|nascimento|false');
select t.eq('sem nascimento (519): a avançada mostra primeiro o nascimento (a idade vem antes da regular)', t.d('guia_de_exploracao'), 'false|nascimento|false');
select t.eq('sem nascimento: NENHUMA classe marcada anterior', t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where (c->>'anterior')::boolean$q$), 0);
select t.eq('sem nascimento (519): o motivo é o pedido amigável',
  t.txt($q$select c->>'motivo_inelegivel' from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'amigo'$q$),
  'Informe a data de nascimento para verificar quais classes estão disponíveis.');
reset role;
update public.profiles set nascimento = date '1985-01-01' where id = t.id('lider_a');

-- ==================== C) 13 anos inicia Amigo (regular anterior) pelo RPC ====================
select t.nasce('membro_a2', 13);
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('C) 13 anos: Amigo elegível e anterior', t.d('amigo'), 'true|-|true');
select t.eq('C) 13 anos: Pioneiro (13) elegível, NÃO anterior', t.d('pioneiro'), 'true|-|false');
reset role;
create table t.foto as select t.outros() as antes;
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('C) membro de 13 anos inicia Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
select t.eq('C) a matrícula nasceu em_andamento, sem conclusão/investidura e com iniciada_em = agora (sem data retroativa)',
  (select status || '|' || (concluida_em is null) || '|' || (investida_em is null) || '|' || (iniciada_em >= now() - interval '5 seconds' and iniciada_em <= now() + interval '5 seconds')
     from public.member_classes where id = t.mc('membro_a2', 'amigo', 'clube_a')), 'em_andamento|true|true|true');
select t.eq('C) uma tarefa (member_requirements) por requisito ativo, todas nao_iniciado, do dono e do clube certos',
  (select count(*) from public.member_requirements mr where mr.member_class_id = t.mc('membro_a2', 'amigo', 'clube_a') and mr.status = 'nao_iniciado' and mr.usuario_id = t.id('membro_a2') and mr.club_id = t.id('clube_a')),
  t.nreq('amigo'));
select t.eq('C) ...e há requisitos de fato (> 0)', t.nreq('amigo') > 0, true);
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('C) minha_classe abre as seções/requisitos da Amigo para quem tem 13 anos',
  t.n(format($q$select (select count(*) from json_array_elements(m->'secoes') s, json_array_elements(s->'requisitos') r) from (select public.minha_classe(%L) m) x$q$, t.mc('membro_a2', 'amigo', 'clube_a'))),
  t.nreq('amigo'));
reset role;
select t.eq('C) matricular classe anterior NÃO concluiu nada, NÃO aprovou requisito, NÃO criou conquista/documento/investidura/snapshot/assinatura',
  t.outros(), (select antes from t.foto));
select t.eq('C) percentual da matrícula = 0', public.classe_percentual(t.mc('membro_a2', 'amigo', 'clube_a'))::bigint, 0::bigint);

-- reiniciar é idempotente (não duplica matrícula nem requisitos)
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('C) reiniciar devolve a MESMA matrícula',
  t.txt(format($q$select (public.classe_iniciar(%L)->>'member_class_id')::uuid = %L::uuid$q$, t.classe('amigo'), t.mc('membro_a2', 'amigo', 'clube_a'))), 'true');
reset role;
select t.eq('C) ...sem duplicar matrícula nem requisitos',
  (select count(*) from public.member_classes where usuario_id = t.id('membro_a2') and class_id = t.classe('amigo')) * 1000
  + (select count(*) from public.member_requirements where member_class_id = t.mc('membro_a2', 'amigo', 'clube_a')),
  1000 + t.nreq('amigo'));
select t.eq('C) ...e o estado continua idêntico (nada concluído/alterado)', t.outros(), (select antes from t.foto));

-- ==================== F) anterior em andamento: aparece em minhas_classes, NÃO em disponíveis ====================
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('F) Amigo em andamento NÃO está mais em classes_disponiveis', t.d('amigo'), '-');
select t.eq('F) ...e aparece em minhas_classes (em_andamento)',
  t.txt($q$select (x->>'codigo') || '|' || (x->>'status') from json_array_elements(public.minhas_classes()) x where x->>'codigo' = 'amigo'$q$), 'amigo|em_andamento');
select t.eq('F/H) a avançada Amigo da Natureza (anterior) ficou LIBERADA pela regular iniciada (bloqueio nulo, anterior)', t.d('amigo_da_natureza'), 'true|-|true');
-- ==================== H) avançada anterior com a regular iniciada → inicia ====================
select t.permitido('H) 13 anos inicia Amigo da Natureza (avançada anterior) com a regular iniciada', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo_da_natureza')));
reset role;
select t.eq('H) matrícula da avançada criada em_andamento', (select status from public.member_classes where id = t.mc('membro_a2', 'amigo_da_natureza', 'clube_a')), 'em_andamento');
select t.eq('H) ...com 9 requisitos e nenhuma conquista', (select count(*) from public.member_requirements where member_class_id = t.mc('membro_a2', 'amigo_da_natureza', 'clube_a')) * 10 + (select count(*) from public.curriculum_achievements where usuario_id = t.id('membro_a2')), 90);
select t.eq('H) a regra declarativa é iniciada_ou_concluida (regular NÃO precisa estar concluída)',
  (select modo from public.curriculum_dependencies where alvo_id = t.classe('amigo_da_natureza') and depende_de_id = t.classe('amigo')), 'iniciada_ou_concluida');

-- ==================== G) duas (ou mais) classes em andamento; histórico de uma intacto ao iniciar a outra ====================
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('G) membro_a2 (13) inicia Pioneiro (a da idade atual)', format($q$select public.classe_iniciar(%L)$q$, t.classe('pioneiro')));
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('G) liderança aprova um requisito do Pioneiro', format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L order by requirement_id limit 1), 'aprovado', 'ok')$q$, t.mc('membro_a2', 'pioneiro', 'clube_a')));
reset role;
create table t.foto_g as select
  (select md5(string_agg(mr.id::text || mr.status || coalesce(mr.enviado_em::text, '') || mr.updated_at::text, ',' order by mr.id)) from public.member_requirements mr where mr.member_class_id = t.mc('membro_a2', 'pioneiro', 'clube_a')) as req,
  (select md5(mc::text) from public.member_classes mc where mc.id = t.mc('membro_a2', 'pioneiro', 'clube_a')) as cls,
  (select count(*) from public.requirement_approvals where club_id = t.id('clube_a')) as apr,
  public.classe_percentual(t.mc('membro_a2', 'pioneiro', 'clube_a')) as pct;
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('G) ...e então inicia Companheiro (outra anterior) sem tocar no Pioneiro', format($q$select public.classe_iniciar(%L)$q$, t.classe('companheiro')));
reset role;
select t.eq('G) Pioneiro intocado (matrícula, requisitos, aprovações e percentual idênticos)',
  (select md5(string_agg(mr.id::text || mr.status || coalesce(mr.enviado_em::text, '') || mr.updated_at::text, ',' order by mr.id)) from public.member_requirements mr where mr.member_class_id = t.mc('membro_a2', 'pioneiro', 'clube_a')) = (select req from t.foto_g)
  and (select md5(mc::text) from public.member_classes mc where mc.id = t.mc('membro_a2', 'pioneiro', 'clube_a')) = (select cls from t.foto_g)
  and (select count(*) from public.requirement_approvals where club_id = t.id('clube_a')) = (select apr from t.foto_g)
  and public.classe_percentual(t.mc('membro_a2', 'pioneiro', 'clube_a')) = (select pct from t.foto_g), true);
select t.eq('G) o Pioneiro tem progresso > 0 (aprovação preservada)', (select pct > 0 from t.foto_g), true);
select t.eq('G) 4 matrículas em andamento ao mesmo tempo (Amigo, Amigo da Natureza, Pioneiro, Companheiro) — o modelo permite',
  (select count(*) from public.member_classes where usuario_id = t.id('membro_a2') and club_id = t.id('clube_a') and status = 'em_andamento'), 4);
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('G) minhas_classes lista as 4', t.n($q$select json_array_length(public.minhas_classes())$q$), 4);
select t.eq('G) Pioneiro com percentual > 0 e Companheiro com 0',
  t.txt($q$select string_agg((x->>'codigo') || ':' || ((x->>'percentual')::numeric > 0), ',' order by x->>'codigo') from json_array_elements(public.minhas_classes()) x where x->>'codigo' in ('pioneiro', 'companheiro')$q$), 'companheiro:false,pioneiro:true');
reset role;

-- ==================== E) classe anterior CONCLUÍDA: não reaparece e fica intacta ====================
-- o fluxo real termina em member_classes.status='investida' + conquista ativa (simulado direto, como o teste 74 faz)
select t.nasce('membro_a', 13);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('E) membro_a (13) inicia Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
update public.member_classes set status = 'investida', concluida_em = now() - interval '2 days', investida_em = now() - interval '1 day' where id = t.mc('membro_a', 'amigo', 'clube_a');
select t.eq('E) (simulação) marcar a matrícula como investida gera a conquista ativa pelo gatilho do próprio motor', (select count(*) from public.curriculum_achievements a where a.member_class_id = t.mc('membro_a', 'amigo', 'clube_a') and a.status = 'ativa'), 1);
create table t.foto_e as select md5(mc::text) as mc, (select md5(a::text) from public.curriculum_achievements a where a.member_class_id = mc.id) as ach from public.member_classes mc where mc.id = t.mc('membro_a', 'amigo', 'clube_a');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('E) Amigo concluída NÃO aparece em classes_disponiveis', t.d('amigo'), '-');
select t.eq('E) ...aparece em minhas_classes como investida', t.txt($q$select x->>'status' from json_array_elements(public.minhas_classes()) x where x->>'codigo' = 'amigo'$q$), 'investida');
select t.eq('E) reiniciar uma classe concluída devolve a mesma matrícula',
  t.txt(format($q$select (public.classe_iniciar(%L)->>'member_class_id')::uuid = %L::uuid$q$, t.classe('amigo'), t.mc('membro_a', 'amigo', 'clube_a'))), 'true');
select t.eq('E) a avançada segue liberada pela regular CONCLUÍDA', t.d('amigo_da_natureza'), 'true|-|true');
reset role;
select t.eq('E) ...e a matrícula concluída e a conquista continuam byte a byte iguais (não reabriu)',
  (select md5(mc::text) from public.member_classes mc where mc.id = t.mc('membro_a', 'amigo', 'clube_a')) = (select mc from t.foto_e)
  and (select md5(a::text) from public.curriculum_achievements a where a.member_class_id = t.mc('membro_a', 'amigo', 'clube_a')) = (select ach from t.foto_e), true);
-- 519: conquista de OUTRO clube sem matrícula neste: a classe NÃO é mais oferecida (antes da 519: era, e caracterizava duplicar)
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em)
values (t.id('membro_a'), 'classe', t.classe('companheiro'), t.id('clube_b'), now() - interval '1 year');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('519: Companheiro já CONCLUÍDO em outro clube (só conquista, sem matrícula aqui) NÃO é mais oferecido (o filtro olha a conquista da pessoa)',
  t.d('companheiro'), '-');
reset role;

-- ==================== I) avançada anterior SEM a regular ====================
select t.nasce('membro_b', 13);
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.eq('I) 13 anos no clube B: Amigo da Natureza elegivel=false, bloqueio pre_requisito, anterior=true', t.d('amigo_da_natureza'), 'false|pre_requisito|true');
select t.eq('I) motivo legível pede a regular', t.txt($q$select c->>'motivo_inelegivel' from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'amigo_da_natureza'$q$),
  'Comece a classe Amigo primeiro: a Classe Avançada é feita junto com ela ou depois dela.');
select t.throws('I) classe_iniciar recusa a avançada sem a regular', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo_da_natureza')), 'Comece a classe Amigo primeiro');
reset role;
select t.eq('I) ...e nada foi criado', (select count(*) from public.member_classes where usuario_id = t.id('membro_b')), 0);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('I) a diretoria também não atribui a avançada sem a regular', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_b'), t.classe('amigo_da_natureza')), 'Comece a classe Amigo primeiro');
reset role;

-- ==================== D) menor de idade tentando classe acima ====================
select t.nasce('membro_a', 10);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('D) 10 anos não inicia Guia (15) — mensagem de idade', format($q$select public.classe_iniciar(%L)$q$, t.classe('guia')), 'a partir de 15 anos');
select t.throws('D) 10 anos não inicia Pesquisador (12)', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')), 'a partir de 12 anos');
select t.throws('D) 10 anos não inicia a avançada de Guia (a idade vem antes da regular)', format($q$select public.classe_iniciar(%L)$q$, t.classe('guia_de_exploracao')), 'a partir de 15 anos');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('D) a diretoria também não atribui Guia a quem tem 10 anos', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('guia')), 'a partir de 15 anos');
select t.throws('D) nem a avançada de Guia', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('guia_de_exploracao')), 'a partir de 15 anos');
reset role;
select t.eq('D) nenhuma matrícula foi criada pelas tentativas',
  (select count(*) from public.member_classes where usuario_id = t.id('membro_a') and class_id in (t.classe('guia'), t.classe('pesquisador'), t.classe('guia_de_exploracao'))), 0);
-- faltando 1 dia para os 10 anos = ainda 9: a idade é a ATUAL (não a do ano)
update public.profiles set nascimento = (current_date - interval '10 years' + interval '1 day')::date where id = t.id('conselheiro_a');
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.eq('D) faltando 1 dia para os 10 anos: Amigo ainda bloqueado por idade', t.d('amigo'), 'false|idade|false');
reset role;
update public.profiles set nascimento = date '1985-01-01' where id = t.id('conselheiro_a');   -- volta ao adulto da fixture

-- ==================== J) burlar pelo RPC ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('J) UUID inexistente', $q$select public.classe_iniciar('11111111-1111-4111-8111-111111111111')$q$, 'Classe não encontrada');
select t.throws('J) classe de versão ARQUIVADA (2026.3)', format($q$select public.classe_iniciar(%L)$q$, t.classe_v('2026.3', 'amigo')), 'Classe não encontrada');
select t.throws('J) classe do piloto (origem não oficial)', $q$select public.classe_iniciar('00000000-0000-4000-a000-000000000002')$q$, 'Classe não encontrada');
reset role;
insert into public.curriculum_versions (id, origem, identificador, versao, status) values ('22222222-2222-4222-8222-222222222222', 'oficial', 'teste-124', 'rascunho-124', 'rascunho');
insert into public.classes (id, curriculum_version_id, codigo, nome, idade_minima) values ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'rascunho124', 'Rascunho 124', 10);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('J) classe de versão em RASCUNHO', $q$select public.classe_iniciar('33333333-3333-4333-8333-333333333333')$q$, 'Classe não encontrada');
select t.eq('J) rascunho nunca aparece em classes_disponiveis', t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'rascunho124'$q$), 0);
reset role;
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');   -- (membro_a já concluiu a Amigo no cenário E)
select t.throws('J) avançada sem a regular (conselheiro_a, sem nenhuma matrícula)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo_da_natureza')), 'Comece a classe Amigo primeiro');
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('J) parâmetro p_idade não existe em classe_iniciar', format($q$select public.classe_iniciar(p_class_id => %L, p_idade => 99)$q$, t.classe('guia')), 'does not exist');
select t.throws('J) parâmetro p_club_id não existe em classe_iniciar', format($q$select public.classe_iniciar(p_class_id => %L, p_club_id => %L)$q$, t.classe('amigo'), t.id('clube_b')), 'does not exist');
select t.throws('J) classes_disponiveis não aceita p_idade', $q$select public.classes_disponiveis(p_idade => 15)$q$, 'does not exist');
select t.throws('J) classe_atribuir não aceita p_idade', format($q$select public.classe_atribuir(p_usuario_id => %L, p_class_id => %L, p_idade => 15)$q$, t.id('membro_a'), t.classe('amigo')), 'does not exist');
select t.throws('J) o helper interno _classe_bloqueio_tipo NÃO é chamável pelo app', format($q$select public._classe_bloqueio_tipo(%L, %L)$q$, t.id('membro_a'), t.classe('guia')), 'permission denied');
select t.throws('J) ...nem _classe_eh_anterior', format($q$select public._classe_eh_anterior(%L, %L)$q$, t.id('membro_a'), t.classe('guia')), 'permission denied');
reset role;
select t.como_anon();
select t.throws('J) anon não chama classes_disponiveis', $q$select public.classes_disponiveis()$q$, 'permission denied');
select t.throws('J) anon não chama classe_iniciar', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'permission denied');
reset role;
select t.como('sem_clube');
select t.throws('J) sem clube em uso: classe_iniciar recusa', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'Sem clube em uso');
select t.eq('J) ...e classes_disponiveis vem vazia', t.n($q$select json_array_length(public.classes_disponiveis())$q$), 0);
reset role;
-- clube com o recurso desabilitado
update public.club_features set enabled = false where club_id = t.id('clube_b') and feature = 'classes';
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.throws('J) clube sem o recurso "classes": classe_iniciar recusa', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'desabilitado');
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('J) ...classe_atribuir também', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_b'), t.classe('amigo')), 'desabilitado');
reset role;
update public.club_features set enabled = true where club_id = t.id('clube_b') and feature = 'classes';

-- ==================== K) outro clube ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('K) a diretoria do A não atribui classe a quem só é do clube B', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_b'), t.classe('amigo')), 'sem vínculo ativo');
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_a');   -- pede o A sem ter vínculo: o servidor cai no B
select t.throws('K) a diretoria do B NÃO atribui a membro do A (pedindo o clube A, que não é dela: o servidor não honra o pedido)', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('amigo')), 'Sem permissão');
select t.pedir_clube('clube_b');
select t.throws('K) ...e no PRÓPRIO clube (B) também não: membro_a não tem vínculo no B', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('amigo')), 'sem vínculo ativo');
reset role;
select t.como('membro_b'); select t.pedir_clube('clube_a');   -- membro_b pede o clube A, onde não tem vínculo
select t.throws('K) quem pede clube alheio é recusado (Sem clube em uso): membro_b não inicia classe "no A"', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')), 'Sem clube em uso');
select t.eq('K) ...e a lista de disponíveis pedindo o clube alheio vem vazia', t.n($q$select json_array_length(public.classes_disponiveis())$q$), 0);
select t.pedir_clube('clube_b');
select t.permitido('K) controle positivo: membro_b inicia Pesquisador no PRÓPRIO clube (B)', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')), 1);
reset role;
select t.eq('K) ...nenhuma matrícula de membro_b no clube A', (select count(*) from public.member_classes where usuario_id = t.id('membro_b') and club_id = t.id('clube_a')), 0);
select t.eq('K) ...e 1 no clube B', (select count(*) from public.member_classes where usuario_id = t.id('membro_b') and club_id = t.id('clube_b')), 1);

-- ==================== L) outro usuário ====================
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.throws('L) conselheiro não atribui classe', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('amigo')), 'Sem permissão');
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('L) desbravador não atribui classe (nem a si)', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('amigo')), 'Sem permissão');
select t.eq('L) usuário comum não lê matrícula de outra pessoa (RLS)', t.nv(format($q$select count(*) from public.member_classes where usuario_id = %L$q$, t.id('membro_a2'))), 0);
select t.eq('L) ...nem os requisitos dela', t.nv(format($q$select count(*) from public.member_requirements where usuario_id = %L$q$, t.id('membro_a2'))), 0);
select t.eq('L) minha_classe com a matrícula de OUTRA pessoa não devolve nada de dela',
  t.txt(format($q$select coalesce(m->'classe'->>'nome', 'nada') from (select public.minha_classe(%L) m) x$q$, t.mc('membro_a2', 'amigo', 'clube_a'))) ~ '^(nada|ERRO.*)$', true);
reset role;
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.throws('L) responsável (pais) não inicia classe', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'Sem clube em uso');
select t.throws('L) ...nem atribui', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('amigo')), 'Sem permissão');
reset role;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('L) o instrutor do MESMO clube atribui a membro do clube (controle positivo: conselheiro_a, adulto da fixture)', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('conselheiro_a'), t.classe('amigo')), 1);
reset role;
select t.eq('L) ...a matrícula nasceu no clube A', (select count(*) from public.member_classes where usuario_id = t.id('conselheiro_a') and club_id = t.id('clube_a')), 1);

-- ==================== M) membro inativo/suspenso/encerrado/pendente ====================
select t.como('susp_a'); select t.pedir_clube('clube_a');
select t.throws('M) suspenso: classe_iniciar recusa', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'Sem clube em uso');
select t.eq('M) suspenso: classes_disponiveis vazia', t.n($q$select json_array_length(public.classes_disponiveis())$q$), 0);
reset role;
select t.como('pend_a'); select t.pedir_clube('clube_a');
select t.throws('M) pendente: classe_iniciar recusa', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'Sem clube em uso');
reset role;
select t.como('enc_a'); select t.pedir_clube('clube_a');
select t.throws('M) vínculo encerrado (ends_at no passado): classe_iniciar recusa', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'Sem clube em uso');
select t.eq('M) encerrado: classes_disponiveis vazia', t.n($q$select json_array_length(public.classes_disponiveis())$q$), 0);
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('M) a diretoria não atribui a suspenso', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('susp_a'), t.classe('amigo')), 'sem vínculo ativo');
select t.throws('M) nem a pendente', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('pend_a'), t.classe('amigo')), 'sem vínculo ativo');
select t.throws('M) nem a vínculo encerrado', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('enc_a'), t.classe('amigo')), 'sem vínculo ativo');
reset role;
select t.eq('M) nenhuma matrícula dos três', (select count(*) from public.member_classes where usuario_id in (t.id('susp_a'), t.id('pend_a'), t.id('enc_a'))), 0);

-- ==================== N) multiclube: a mesma pessoa, progresso DIFERENTE em cada clube ====================
-- multi_dois_papeis: desbravador no A, conselheiro no B; 13 anos.
select t.nasce('multi_dois_papeis', 13);
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('N) inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.pedir_clube('clube_b');
select t.permitido('N) inicia Amigo no B', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.permitido('N) ...e Companheiro SÓ no B', format($q$select public.classe_iniciar(%L)$q$, t.classe('companheiro')));
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('N) a liderança do A aprova 1 requisito da Amigo do A',
  format($q$select public.requisito_avaliar((select mr.id from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id where mr.member_class_id = %L and r.manifesto_id = 'amigo.I.2'), 'aprovado', 'ok A')$q$, t.mc('multi_dois_papeis', 'amigo', 'clube_a')));
reset role;
select t.eq('N) percentuais separados: A = 4 (1 de 25), B = 0', public.classe_percentual(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))::bigint * 10 + public.classe_percentual(t.mc('multi_dois_papeis', 'amigo', 'clube_b'))::bigint, 40);
select t.eq('N) a aprovação do A não tocou nenhum requisito do B',
  (select count(*) from public.member_requirements where member_class_id = t.mc('multi_dois_papeis', 'amigo', 'clube_b') and status <> 'nao_iniciado'), 0);
select t.eq('N) histórico (requirement_approvals) só no clube A (1) e nenhum no B (0)',
  (select count(*) from public.requirement_approvals a where a.member_requirement_id in (select id from public.member_requirements where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a'))) * 10
  + (select count(*) from public.requirement_approvals a where a.member_requirement_id in (select id from public.member_requirements where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_b'))), 10);
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('N) no clube A: minhas_classes = só Amigo; Companheiro segue DISPONÍVEL (anterior)', t.txt($q$select string_agg(x->>'codigo', ',') from json_array_elements(public.minhas_classes()) x$q$) || '/' || t.d('companheiro'), 'amigo/true|-|true');
select t.pedir_clube('clube_b');
select t.eq('N) no clube B: minhas_classes = Amigo e Companheiro; Companheiro NÃO disponível', t.txt($q$select string_agg(x->>'codigo', ',' order by x->>'codigo') from json_array_elements(public.minhas_classes()) x$q$) || '/' || t.d('companheiro'), 'amigo,companheiro/-');
reset role;
select t.eq('N) duas matrículas da MESMA Amigo (uma por clube), ids diferentes',
  (select count(distinct id) from public.member_classes where usuario_id = t.id('multi_dois_papeis') and class_id = t.classe('amigo')), 2);
-- 519 (decisão do dono): a regular apenas INICIADA no clube B NÃO libera a avançada no clube A (iniciada só vale no clube atual).
-- Antes da 519 isto era CARACTERIZADO como liberado (dependência olhava member_classes da pessoa em qualquer clube).
update public.member_classes set status = 'cancelada' where id = t.mc('multi_dois_papeis', 'amigo', 'clube_a');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('519 N) sem Amigo ativa no A (cancelada), com Amigo iniciada só no B: a avançada NÃO está liberada no A', t.d('amigo_da_natureza'), 'false|pre_requisito|true');
select t.throws('519 N) ...e classe_iniciar recusa a avançada no clube A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo_da_natureza')), 'Comece a classe Amigo primeiro');
reset role;
select t.eq('519 N) ...e nenhuma avançada nasceu no A', (select count(*) from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and class_id = t.classe('amigo_da_natureza')), 0);
select t.eq('N) a assinatura de 3 argumentos da regra de dependência foi mantida (usa o clube atual)',
  pg_get_function_identity_arguments('public._dependencia_de_classe_satisfeita(uuid,uuid,text)'::regprocedure), 'p_usuario_id uuid, p_depende_de_id uuid, p_modo text');
select t.eq('518: os helpers não têm execute para anon nem authenticated',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('_classe_bloqueio_tipo', '_classe_eh_anterior')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0);
select t.fim();
rollback;
