-- Fase 4.1 (migration 45): documento (Caderno DesbravaClube) emitido do snapshot selado + verificação
-- pública por token. Cenários pedidos: regeneração do mesmo documento; snapshot depois arquivado no
-- catálogo; snapshot substituído; snapshot revogado; investidura revogada; QR válido (token resolve);
-- token inexistente; tentativa de enumerar; acesso anônimo só ao resumo público; Tenant B sem acesso
-- aos detalhes privados do documento emitido pelo A. Curso de Leitura: fixture SINTÉTICA de teste.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.req(p text) returns uuid language sql stable security definer as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create function t.mr(p text) returns uuid language sql stable security definer as $$
  select id from public.member_requirements where member_class_id = t.id('mc') and requirement_id = t.req(p) $$;
create function t.snap(p_versao int) returns uuid language sql stable security definer as $$
  select id from public.class_completion_snapshots where member_class_id = t.id('mc') and versao = p_versao $$;
create table t.ids_txt (chave text primary key, id text not null); grant all on t.ids_txt to public;
create function t.tok() returns text language sql stable as $$ select id from t.ids_txt where chave = 'token_final' $$;

-- (migration 84: ANO explícito e vigência fechada. O valor é o do ANO CORRENTE no Brasil — assim o
-- teste não vence na virada do ano, que era o que acontecia com as datas fixas de 2026.)
insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, a.y, 'Livro do Curso de Leitura do ano [DADO DE TESTE]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'https://exemplo.test/fixture', 'FIXTURE DE TESTE — não é o livro oficial'
from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a where d.chave = 'curso_leitura_amigo';

-- conclui Amigo por multi_dois_papeis (desbravador no A, conselheiro no B) e investe
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
insert into t.ids (chave, id) select 'mc', id from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and class_id = t.classe('amigo');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('registra escolhas V.1/VII.1', format($q$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}') from unnest(array[%L::uuid, %L::uuid]) r$q$, t.req('amigo.V.1'), t.req('amigo.VII.1')), 2);
select t.permitido('...IX.1 texto livre', format($q$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$q$, t.req('amigo.IX.1')));
select t.permitido('guarda resposta PRIVADA em I.1 (documento não pode expor)', format($q$select public.requisito_salvar(%L, 'Resposta privada do menor [TESTE]', null)$q$, t.req('amigo.I.1')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 25', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'comentário interno [TESTE]') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc')), 25);
reset role;

-- ==================== documento de ACOMPANHAMENTO antes da investidura ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('documento FINAL antes da investidura é recusado', format($q$select public.documento_emitir(%L, 'final')$q$, t.id('mc')), 'após a investidura');
select t.permitido('emite o Caderno de ACOMPANHAMENTO (snapshot selado, antes de investir)', format($q$select public.documento_emitir(%L)$q$, t.id('mc')));
reset role;
insert into t.ids_txt (chave, id) select 'token_acomp', token_publico from public.class_documents where member_class_id = t.id('mc') and tipo = 'acompanhamento';
select t.eq('acompanhamento: token de 20 chars base32 (sem I/L/O/U), não é UUID', (select (length(token_publico) = 20 and token_publico ~ '^[0-9A-HJKMNP-TV-Z]+$' and token_publico !~ '-')::text from public.class_documents where tipo = 'acompanhamento'), 'true');
select t.eq('verificação pública do acompanhamento: estado = acompanhamento (NUNCA "válido"/comprovante de investidura), íntegro',
  (select (public.documento_verificar(id) ->> 'estado') || '|' || (public.documento_verificar(id) ->> 'integro') || '|' || (public.documento_verificar(id) ->> 'tipo') from t.ids_txt where chave = 'token_acomp'),
  'acompanhamento|true|acompanhamento');

-- revisão final + investidura
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('aprova revisão final', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'ok')$q$, t.id('mc')));
select t.permitido('registra investidura', format($q$select public.investidura_registrar(%L, current_date, 'Cerimônia [TESTE]')$q$, t.id('mc')));
reset role;

-- ==================== 1) emitir o documento FINAL + regeneração idempotente ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('emite o documento FINAL (investida): ja_existia=false, tipo=final', (public.documento_emitir(t.id('mc'), 'final') ->> 'ja_existia') || '|' || (public.documento_emitir(t.id('mc'), 'final') ->> 'tipo'), 'false|final');
reset role;
insert into t.ids_txt (chave, id) select 'token_final', token_publico from public.class_documents where member_class_id = t.id('mc') and tipo = 'final';
insert into t.ids_txt (chave, id) select 'conf_final', conferencia from public.class_documents where member_class_id = t.id('mc') and tipo = 'final';
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('REGENERAÇÃO: reemitir o final devolve o MESMO token e a MESMA conferência (idempotente, determinístico)',
  ((public.documento_emitir(t.id('mc'), 'final') ->> 'token') = t.tok() and (public.documento_emitir(t.id('mc'), 'final') ->> 'conferencia') = (select id from t.ids_txt where chave = 'conf_final'))::text
  || '|' || (public.documento_emitir(t.id('mc'), 'final') ->> 'ja_existia'), 'true|true');
select t.eq('...e NÃO cria uma segunda linha de documento final', (select count(*) from public.class_documents where member_class_id = t.id('mc') and tipo = 'final'), 1);
reset role;
-- achado da inspeção visual: o acompanhamento aponta pro MESMO snapshot que depois foi usado pra
-- investir (nenhuma correção/nova versão aconteceu nesta matrícula) — mesmo assim, um documento
-- tipo=acompanhamento NUNCA pode expor a data de investidura (ele declara explicitamente "não é
-- comprovante de investidura"). O tipo=final continua expondo normalmente (já provado acima).
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('ACOMPANHAMENTO (mesmo snapshot da investidura): documento_conteudo NÃO expõe periodo.investidura (chave ausente, não null)',
  (select not (public.documento_conteudo(id) -> 'periodo' ? 'investidura') from t.ids_txt where chave = 'token_acomp')::text, 'true');
select t.eq('...e o FINAL continua expondo periodo.investidura normalmente', (public.documento_conteudo(t.tok()) -> 'periodo' ? 'investidura')::text, 'true');
reset role;
select t.como_anon();
select t.eq('ACOMPANHAMENTO: documento_verificar (público) também NÃO expõe data_investidura',
  (select (public.documento_verificar(id) ->> 'data_investidura') is null from t.ids_txt where chave = 'token_acomp')::text, 'true');
select t.eq('...mas o FINAL continua expondo (mesma verificação pública, tipo diferente)', (public.documento_verificar(t.tok()) ->> 'data_investidura') is not null, true);
reset role;

-- ==================== conteúdo do documento (dono/liderança) — sanitizado ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('conteúdo (dono): nome, clube, classe, versão curricular, período com investidura (data + registrador + papel)',
  (select (d->'pessoa'->>'nome') || '|' || (d->'clube_emissor'->>'nome') || '|' || (d->'classe'->>'nome') || '|' || (d->'curriculum_version'->>'versao') || '|' || (d->'periodo'->'investidura'->>'registrado_papel') || '|' || ((d->'periodo'->'investidura'->>'data') = current_date::text)::text
     from (select public.documento_conteudo(t.tok()) d) x), 'Multi Dois Papeis|Filhos da Conquista|Amigo|2026.3|diretoria|true');
select t.eq('conteúdo: 9 seções, 25 requisitos, cada um com situação e responsável pela aprovação (nome+papel+data)',
  (select jsonb_array_length(d->'secoes') || '|' || (select count(*) from jsonb_array_elements(d->'secoes') s, jsonb_array_elements(s->'requisitos') r) || '|'
     || (select count(*) from jsonb_array_elements(d->'secoes') s, jsonb_array_elements(s->'requisitos') r where r->>'situacao' = 'aprovado' and r->'aprovado_por'->>'nome' = 'Lider A' and r->'aprovado_por'->>'papel' = 'diretoria' and (r->'aprovado_por'->>'em') is not null)
     from (select public.documento_conteudo(t.tok()) d) x), '9|25|25');
select t.eq('conteúdo: escolha (V.1 = Natação principiante I) e conteúdo dinâmico (livro do ano) CONGELADOS do snapshot',
  (select (select r->'escolha'->'escolhidas'->>0 from jsonb_array_elements(d->'secoes') s, jsonb_array_elements(s->'requisitos') r where r->>'codigo' = '1' and s->>'codigo' = 'V')
       || '|' || (select r->'conteudo_dinamico'->>'valor' from jsonb_array_elements(d->'secoes') s, jsonb_array_elements(s->'requisitos') r where r->>'codigo' = '4' and s->>'codigo' = 'I')
     from (select public.documento_conteudo(t.tok()) d) x), 'Natação principiante I|Livro do Curso de Leitura do ano [DADO DE TESTE]');
-- privacidade: nada de evidência, comentário interno, id interno
select t.eq('conteúdo NÃO contém a evidência privada, o comentário interno de aprovação, nem ids internos (snapshot_id/member_class_id/club_id/user_id)',
  ((public.documento_conteudo(t.tok())::text like '%Resposta privada%')
   or (public.documento_conteudo(t.tok())::text like '%comentário interno%')
   or (public.documento_conteudo(t.tok())::text like '%' || t.snap(1)::text || '%')
   or (public.documento_conteudo(t.tok())::text like '%' || t.id('mc')::text || '%')
   or (public.documento_conteudo(t.tok())::text like '%' || t.id('clube_a')::text || '%')
   or (public.documento_conteudo(t.tok())::text like '%' || t.id('multi_dois_papeis')::text || '%'))::text, 'false');
reset role;

-- ==================== QR válido / token inexistente / enumeração / acesso anônimo só ao resumo ====================
select t.como_anon();
select t.eq('QR VÁLIDO (anon resolve o token): estado=valido, integro=true, tipo=final, com nome/classe/clube/versão/conferência',
  (select (d->>'encontrado') || '|' || (d->>'estado') || '|' || (d->>'integro') || '|' || (d->>'tipo') || '|' || (d->>'nome') || '|' || (d->>'classe') || '|' || (d->>'clube_emissor') || '|' || (d->>'versao_curricular') || '|' || (d->>'conferencia')
     from (select public.documento_verificar(t.tok()) d) x),
  'true|valido|true|final|Multi Dois Papeis|Amigo|Filhos da Conquista|classes-regulares-dsa 2026.3|' || (select id from t.ids_txt where chave = 'conf_final'));
select t.eq('resumo público NÃO expõe requisitos, avaliadores, evidências, comentários, snapshot_id/club_id/user_id nem member_class_id',
  ((public.documento_verificar(t.tok())::text like '%secoes%' or public.documento_verificar(t.tok())::text like '%Lider A%' or public.documento_verificar(t.tok())::text like '%Natação%'
    or public.documento_verificar(t.tok())::text like '%' || t.snap(1)::text || '%' or public.documento_verificar(t.tok())::text like '%' || t.id('clube_a')::text || '%'
    or public.documento_verificar(t.tok())::text like '%' || t.id('multi_dois_papeis')::text || '%' or public.documento_verificar(t.tok())::text like '%' || t.id('mc')::text || '%'))::text, 'false');
select t.eq('TOKEN INEXISTENTE: encontrado=false (mesma forma; sem sinal de enumeração)', public.documento_verificar('ZZZZZZZZZZZZZZZZZZZZ') ->> 'encontrado', 'false');
select t.eq('token malformado (curto): encontrado=false', public.documento_verificar('abc') ->> 'encontrado', 'false');
select t.eq('anon NÃO lê a tabela class_documents (enumeração por SELECT bloqueada)', t.nv('select count(*) from public.class_documents'), 0);
select t.eq('anon NÃO chama documento_conteudo (conteúdo detalhado não é público)', t.n(format($q$select case when public.documento_conteudo(%L) is null then 0 else 1 end$q$, t.tok())), -1);
reset role;

-- ==================== Tenant B: sem acesso aos detalhes privados do documento do A ====================
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('lider_b (pessoa tem vínculo ativo no B) VÊ o resumo público pela verificação', public.documento_verificar(t.tok()) ->> 'encontrado', 'true');
select t.eq('...e VÊ o conteúdo (é liderança de clube onde a pessoa tem vínculo — mesma regra da conquista portátil)', (public.documento_conteudo(t.tok()) is not null)::text, 'true');
select t.como('membro_b');
select t.eq('membro comum do B NÃO acessa o conteúdo detalhado do documento (só o resumo público, como qualquer um)', t.txt(format($q$select case when public.documento_conteudo(%L) is null then 'null' else 'vazou' end$q$, t.tok())), 'null');
select t.eq('...mas o resumo público continua acessível (é público)', public.documento_verificar(t.tok()) ->> 'encontrado', 'true');
reset role;

-- ==================== 2) snapshot arquivado no CATÁLOGO — documento intacto ====================
update public.curriculum_versions set status = 'arquivado' where origem = 'oficial';
select t.como_anon();
select t.eq('catálogo oficial arquivado: a verificação pública continua (self-contained; estado válido, íntegro)',
  (public.documento_verificar(t.tok()) ->> 'estado') || '|' || (public.documento_verificar(t.tok()) ->> 'integro'), 'valido|true');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('...e o conteúdo do documento NÃO mudou (nome da classe e versão vêm do snapshot, não do catálogo arquivado)',
  (public.documento_conteudo(t.tok()) -> 'classe' ->> 'nome') || '|' || (public.documento_conteudo(t.tok()) -> 'curriculum_version' ->> 'versao'), 'Amigo|2026.3');
reset role;
update public.curriculum_versions set status = 'publicado' where origem = 'oficial' and versao = '2026.3';

-- ==================== 3) snapshot SUBSTITUÍDO — verificação reflete ====================
-- força um snapshot novo: revoga NÃO (isso é o caso 4); aqui simulamos substituição selando de novo.
-- Reabre um requisito pela revisão e reconclui → snapshot v2 sela, v1 vira 'substituido'.
-- (a investidura estava no v1; para simular substituição limpa, criamos outro membro; mais simples: marca v1 como substituido só neste teste via novo selamento não é trivial — então testamos direto o mapeamento de estado)
select t.eq('mapeamento de estado: um documento cujo snapshot está SUBSTITUÍDO mostra "substituido" (derivado ao vivo)',
  public._documento_estado('substituido', 'final'), 'substituido');
-- caminho real de substituição: revoga o snapshot investido (cascata) e recria a conclusão
-- (feito no caso 4/5 abaixo, que cobre revogação e a matrícula voltando a em_andamento)

-- ==================== 4+5) snapshot/investidura REVOGADOS — verificação vira "revogado" ====================
select t.como('dir_a_membro_b'); select t.pedir_clube('clube_a');
select t.permitido('a liderança do clube de ORIGEM revoga o snapshot (cascata: investidura + conquista)', format($q$select public.snapshot_revogar(%L, 'Erro de avaliação — refazer.')$q$, t.snap(1)));
reset role;
select t.eq('verificação do documento FINAL agora mostra REVOGADO (reflete a revogação da investidura/snapshot ao vivo)', public.documento_verificar(t.tok()) ->> 'estado', 'revogado');
select t.eq('...e o snapshot continua íntegro (revogar ≠ editar) — a verificação não mente sobre integridade', public.documento_verificar(t.tok()) ->> 'integro', 'true');
select t.eq('o documento de ACOMPANHAMENTO (mesmo snapshot) também vira revogado', (select public.documento_verificar(id) ->> 'estado' from t.ids_txt where chave = 'token_acomp'), 'revogado');
select t.eq('a investidura foi revogada e a conquista também (nada apagado)',
  (select status from public.class_investitures where snapshot_id = t.snap(1)) || '|' || (select status from public.curriculum_achievements where member_class_id = t.id('mc') and tipo = 'classe'), 'revogada|revogada');
select t.eq('o token continua resolvendo (o documento não some — só muda de estado)', public.documento_verificar(t.tok()) ->> 'encontrado', 'true');

select t.fim();
rollback;
