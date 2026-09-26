-- Classes Avançadas (manifesto 2026.4, migrations 120/121): pré-requisito da regular pareada, idade da
-- regular, versão nova sem quebrar quem já está na 2026.3, e o que a tela recebe (avancada/motivo).
-- Regra aplicada: a avançada exige a regular pareada INICIADA ou CONCLUÍDA (feita junto ou depois) — a fonte
-- oficial (adventistas.org/pt/desbravadores/classes/) pareia avançada e regular pela idade e não exige a
-- regular concluída antes. A checagem vale por CÓDIGO em qualquer versão oficial.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

create function t.classe(p_versao text, p_codigo text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('class:' || p_versao || ':' || p_codigo) $$;
create function t.req(p_versao text, p_manifesto_id text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('req:' || p_versao || ':' || p_manifesto_id) $$;

-- ==================== catálogo: só a 2026.4 é oferecida ====================
select t.eq('2026.4 publicada; 2026.3 arquivada (versão nova do manifesto arquiva a anterior)',
  (select string_agg(versao || ':' || status, ',' order by versao) from public.curriculum_versions where origem = 'oficial' and versao in ('2026.3', '2026.4')),
  '2026.3:arquivado,2026.4:publicado');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('classes_disponiveis só oferece classes da versão PUBLICADA (nenhum class_id da 2026.3 ou anterior)',
  t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where c->'curriculum_version'->>'versao' <> '2026.4'$q$) * 100
  + t.n($q$select json_array_length(public.classes_disponiveis())$q$), 12);
select t.eq('a avançada vem marcada (avancada=true, classe_regular_codigo) logo depois da regular dela',
  t.txt($q$select string_agg(c->>'codigo' || ':' || (c->>'avancada') || ':' || coalesce(c->>'classe_regular_codigo', '-'), ',') from (select c from json_array_elements(public.classes_disponiveis()) c limit 2) x$q$),
  'amigo:false:-,amigo_da_natureza:true:amigo');
select t.eq('sem a regular: Amigo da Natureza indisponível, com a mensagem clara',
  t.txt($q$select (c->>'elegivel') || '|' || (c->>'motivo_inelegivel') from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'amigo_da_natureza'$q$),
  'false|Comece a classe Amigo primeiro: a Classe Avançada é feita junto com ela ou depois dela.');
select t.eq('avançada acima da idade: o motivo é a idade (igual à regular pareada), não a regular',
  t.txt($q$select c->>'motivo_inelegivel' from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'guia_de_exploracao'$q$),
  'Esta classe é a partir de 15 anos.');
select t.throws('classe_iniciar recusa a avançada sem a regular', format($q$select public.classe_iniciar(%L)$q$, t.classe('2026.4', 'amigo_da_natureza')), 'Comece a classe Amigo primeiro');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('a liderança também não atribui a avançada sem a regular', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('2026.4', 'amigo_da_natureza')), 'Comece a classe Amigo primeiro');
reset role;

-- ==================== quem já estava na 2026.3 continua nela — e isso vale como "regular iniciada" ====================
-- matrícula ANTERIOR à 2026.4 (a 2026.3 era a publicada quando a criança começou): simulada direto no motor
insert into t.ids (chave, id) values ('mc_amigo_263', public._classe_matricular(t.id('membro_a'), t.id('clube_a'), t.classe('2026.3', 'amigo')));
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('minha_classe da matrícula 2026.3 continua abrindo NA 2026.3 (25 requisitos, versão arquivada preservada)',
  t.txt(format($q$select (m->'curriculum_version'->>'versao') || '|' || (select count(*) from json_array_elements(m->'secoes') s, json_array_elements(s->'requisitos') r) from (select public.minha_classe(%L) m) x$q$, t.id('mc_amigo_263'))),
  '2026.3|25');
select t.eq('classes_disponiveis agora libera Amigo da Natureza (Amigo em andamento na 2026.3 conta)',
  t.txt($q$select (c->>'elegivel') || '|' || coalesce(c->>'motivo_inelegivel', '-') from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'amigo_da_natureza'$q$), 'true|-');
select t.eq('...e ainda oferece a Amigo 2026.4 (outro class_id) — a pessoa não é empurrada de versão',
  t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'amigo'$q$), 1);
select t.permitido('membro_a inicia Amigo da Natureza (feita junto com a regular)', format($q$select public.classe_iniciar(%L)$q$, t.classe('2026.4', 'amigo_da_natureza')));
select t.eq('minhas_classes lista as duas: Amigo (2026.3) e Amigo da Natureza (2026.4)',
  t.txt($q$select string_agg(x->>'codigo', ',' order by x->>'codigo') from json_array_elements(public.minhas_classes()) x$q$), 'amigo,amigo_da_natureza');
select t.permitido('envio na matrícula 2026.3 funciona (requisito da versão arquivada)', format($q$select public.requisito_salvar(%L, null, null)$q$, t.req('2026.3', 'amigo.I.3')));
select t.permitido('...envia', format($q$select public.requisito_enviar(%L)$q$, t.req('2026.3', 'amigo.I.3')));
select t.permitido('envio na avançada funciona (requisito sem comprovação: liderança confere)', format($q$select public.requisito_enviar(%L)$q$, t.req('2026.4', 'amigo_da_natureza.1')));
select t.eq('a avançada chega à tela com a seção única e os 9 requisitos do manifesto (1 foto em 3, escolha de personagem)',
  t.txt($q$select (m->'classe'->>'nome') || '|' || json_array_length(m->'secoes') || '|' || json_array_length(m->'secoes'->0->'requisitos') || '|'
          || (select r->>'tipo_evidencia' from json_array_elements(m->'secoes'->0->'requisitos') r where r->>'manifesto_id' = 'amigo_da_natureza.3') || '|'
          || (select json_array_length(r->'escolha'->'opcoes') from json_array_elements(m->'secoes'->0->'requisitos') r where r->>'manifesto_id' = 'amigo_da_natureza.2')
        from (select public.minha_classe((select mc.id from public.member_classes mc join public.classes c on c.id = mc.class_id where c.codigo = 'amigo_da_natureza' and mc.usuario_id = auth.uid())) m) x$q$),
  'Amigo da Natureza|1|9|foto|4');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('avaliação na matrícula 2026.3 funciona',
  format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_amigo_263'), t.req('2026.3', 'amigo.I.3')));
select t.permitido('avaliação na avançada funciona',
  format($q$select public.requisito_avaliar((select mr.id from public.member_requirements mr join public.member_classes mc on mc.id = mr.member_class_id where mc.usuario_id = %L and mr.requirement_id = %L), 'aprovado', null)$q$,
    t.id('membro_a'), t.req('2026.4', 'amigo_da_natureza.1')));
reset role;
select t.eq('os dois requisitos ficaram aprovados, cada um na sua versão',
  (select string_agg(r.manifesto_id || ':' || mr.status, ',' order by r.manifesto_id collate "C") from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id
     join public.member_classes mc on mc.id = mr.member_class_id where mc.usuario_id = t.id('membro_a') and r.id in (t.req('2026.3', 'amigo.I.3'), t.req('2026.4', 'amigo_da_natureza.1'))),
  'amigo.I.3:aprovado,amigo_da_natureza.1:aprovado');

-- ==================== matrícula CANCELADA não conta; CONCLUSÃO (qualquer versão) conta ====================
update public.member_classes set status = 'cancelada' where id = t.id('mc_amigo_263');
select t.eq('regular cancelada não satisfaz o pré-requisito',
  public._classe_motivo_inelegivel(t.id('membro_a'), t.classe('2026.4', 'amigo_da_natureza')) like 'Comece a classe Amigo primeiro%', true);
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em)
values (t.id('membro_a'), 'classe', t.classe('2026.2', 'amigo'), t.id('clube_b'), now() - interval '1 year');
select t.eq('Amigo CONCLUÍDA numa versão antiga (2026.2, outro clube) satisfaz o pré-requisito da 2026.4',
  public._classe_motivo_inelegivel(t.id('membro_a'), t.classe('2026.4', 'amigo_da_natureza')) is null, true);
update public.curriculum_achievements set status = 'revogada', revogada_em = now() where usuario_id = t.id('membro_a') and classe_id = t.classe('2026.2', 'amigo');
select t.eq('...conclusão revogada não conta', public._classe_motivo_inelegivel(t.id('membro_a'), t.classe('2026.4', 'amigo_da_natureza')) is not null, true);

-- ==================== a regra mora no mecanismo de dependências (declarativa, trocável) ====================
select t.eq('dependencias_pendentes devolve o nome da regular faltante', public.dependencias_pendentes('class', t.classe('2026.4', 'amigo_da_natureza'), t.id('membro_a'), t.id('clube_a'))::text, '{Amigo}');
update public.curriculum_dependencies set modo = 'concluida' where alvo_id = t.classe('2026.4', 'amigo_da_natureza');
select t.eq('com modo=concluida a mensagem pede a CONCLUSÃO (troca de regra = 1 update, sem migration de lógica)',
  public._classe_motivo_inelegivel(t.id('membro_a'), t.classe('2026.4', 'amigo_da_natureza')), 'Conclua a classe Amigo primeiro.');
select t.throws('modo desconhecido é recusado', $q$update public.curriculum_dependencies set modo = 'qualquer' where alvo_tipo = 'class'$q$, 'curriculum_dependencies_modo_check');
select t.throws('classe avançada sem regular pareada é recusada pelo schema',
  format($q$update public.classes set classe_regular_codigo = null where id = %L$q$, t.classe('2026.4', 'amigo_da_natureza')), 'classes_avancada_tem_regular');

-- ==================== importador: avançada inconsistente é recusada ====================
select t.throws('importador recusa avançada com idade diferente da regular pareada',
  (select format($q$select public.curriculo_importar_classes_regulares(%L::jsonb, %L)$q$,
     jsonb_set(jsonb_set(texto::jsonb, '{manifesto_versao}', '"teste-74a"'), '{classes_avancadas,0,idade_minima}', '11'), repeat('0', 64)) from t.manifesto),
  'idade_minima diferente da regular pareada');
select t.throws('importador recusa avançada apontando pra regular inexistente',
  (select format($q$select public.curriculo_importar_classes_regulares(%L::jsonb, %L)$q$,
     jsonb_set(jsonb_set(texto::jsonb, '{manifesto_versao}', '"teste-74b"'), '{classes_avancadas,0,classe_regular_ref}', '"lider"'), repeat('0', 64)) from t.manifesto),
  'sem classe_regular_ref válida');
select t.throws('importador recusa requisito pendente numa avançada',
  (select format($q$select public.curriculo_importar_classes_regulares(%L::jsonb, %L)$q$,
     jsonb_set(jsonb_set(texto::jsonb, '{manifesto_versao}', '"teste-74c"'), '{classes_avancadas,0,secoes,0,requisitos,0,status}', '"PENDENTE_DE_VALIDACAO"'), repeat('0', 64)) from t.manifesto),
  'PENDENTE_DE_VALIDACAO');
select t.eq('...e nada foi publicado por essas tentativas (2026.4 segue a única publicada)',
  (select string_agg(versao, ',') from public.curriculum_versions where origem = 'oficial' and status = 'publicado'), '2026.4');
select t.fim();
rollback;
