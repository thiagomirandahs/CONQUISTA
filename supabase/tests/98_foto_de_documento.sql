-- Migration 380: foto do DOCUMENTO no requisito de idade ("plano 1" do dono, 28/09).
-- Prova: é obrigatória para enviar; só o dono e o avaliador do clube em uso veem; coordenação, outro
-- clube, outra criança e anônimo não; não entra no histórico imutável; ao aprovar vira "conferido por";
-- depois de apagado fica só o registro, sem caminho.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.req(p text) returns uuid language sql stable security definer as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create function t.ve(p_nome text) returns bigint language sql as $$
  select t.nv(format('select count(*) from storage.objects where bucket_id = ''comprovacoes'' and name = %L', p_nome)) $$;

select t.eq('catálogo: os 6 requisitos de idade pedem documento', (select count(*) from public.requisitos_com_documento), 6);

select t.id('membro_a')::text || '/documentos/doc1.jpg' as doc1 \gset
select t.id('membro_a')::text || '/documentos/doc2.jpg' as doc2 \gset
insert into storage.objects (bucket_id, name, owner_id) values
  ('comprovacoes', :'doc1', t.id('membro_a')::text), ('comprovacoes', :'doc2', t.id('membro_a')::text);

select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.classe_iniciar(t.classe('amigo'));
select t.throws('sem a foto do documento não envia para avaliação', format('select public.requisito_enviar(%L)', t.req('amigo.I.1')), 'foto do documento');
select t.throws('requisito que não pede documento recusa', format('select public.documento_enviar(%L, %L)', t.req('amigo.I.2'), :'doc1'), 'não pede foto de documento');
select t.throws('caminho de outra pessoa é recusado', format('select public.documento_enviar(%L, %L)', t.req('amigo.I.1'), t.id('membro_a2')::text || '/documentos/x.jpg'), 'Arquivo inválido');
select t.eq('1º envio: nada antigo para apagar', (public.documento_enviar(t.req('amigo.I.1'), :'doc1'))->>'caminho_antigo', null);
select t.eq('troca de foto devolve o caminho antigo', (public.documento_enviar(t.req('amigo.I.1'), :'doc2'))->>'caminho_antigo', :'doc1');
select t.eq('dono apaga a foto antiga (sem uso)', public.pode_apagar_documento(:'doc1'), true);
select t.eq('dono NÃO apaga a foto em uso por envio pendente', public.pode_apagar_documento(:'doc2'), false);
select public.requisito_enviar(t.req('amigo.I.1'));
select t.eq('Minha Classe mostra o requisito com documento enviado',
  (public.documentos_da_minha_classe((select id from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a')))
    -> (t.req('amigo.I.1')::text) -> 'documento' ->> 'status'), 'enviado');
reset role;
select id as mr from public.member_requirements where usuario_id = t.id('membro_a') and requirement_id = t.req('amigo.I.1') \gset
select t.eq('a foto NÃO entra no histórico imutável', (select count(*) from public.requirement_submissions where member_requirement_id = :'mr' and evidencia_path is not null), 0);

-- ---------- quem vê ----------
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('a própria criança vê', t.ve(:'doc2'), 1);
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('instrutor do clube vê o documento', t.ve(:'doc2'), 1);
select t.eq('...e recebe o estado pela fila', public.documento_do_requisito(:'mr') -> 'documento' ->> 'status', 'enviado');
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.eq('conselheiro (não avalia currículo) não vê', t.ve(:'doc2'), 0);
select t.eq('...nem pela RPC', public.documento_do_requisito(:'mr') is null, true);
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('outra criança do mesmo clube não vê', t.ve(:'doc2'), 0);
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.eq('responsável sem vínculo não vê', t.ve(:'doc2'), 0);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('diretoria de outro clube não vê', t.ve(:'doc2'), 0);
select t.como('dir_a_membro_b'); select t.pedir_clube('clube_b');
select t.eq('diretoria do A operando no B não vê', t.ve(:'doc2'), 0);
select t.como_anon();
select t.eq('anônimo não vê', t.ve(:'doc2'), 0);
reset role;
select t.eq('coordenação: a regra da investidura não enxerga documento', public.coordenacao_ve_comprovacao(:'doc2'), false);

-- ---------- aprovação ----------
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('antes de aprovar, avaliador não apaga', public.pode_apagar_documento(:'doc2'), false);
select public.requisito_avaliar(:'mr', 'aprovado', null, null);
select t.eq('agora o avaliador pode apagar o arquivo', public.pode_apagar_documento(:'doc2'), true);
reset role;
select t.eq('aprovou: documento conferido por quem aprovou',
  (select status || '|' || conferido_por::text from public.comprovacoes_documento where member_requirement_id = :'mr'), 'conferido|' || t.id('instrutor_a')::text);
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.throws('não marca como apagado enquanto o arquivo existe', format('select public.documento_marcar_apagado(%L)', :'mr'), 'ainda está no armazenamento');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('avaliador de outro clube não apaga', public.pode_apagar_documento(:'doc2'), false);
reset role;

-- o app apaga pela API do Storage; aqui simulamos a remoção do objeto
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'comprovacoes' and name in (:'doc1', :'doc2');
set local storage.allow_delete_query = 'false';
select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.documento_marcar_apagado(:'mr');
reset role;
select t.eq('apagado: sem caminho, com data e com quem conferiu',
  (select (evidencia_path is null)::text || '|' || (foto_apagada_em is not null)::text || '|' || (conferido_por is not null)::text
     from public.comprovacoes_documento where member_requirement_id = :'mr'), 'true|true|true');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('requisito aprovado não aceita documento novo', format('select public.documento_enviar(%L, %L)', t.req('amigo.I.1'), :'doc1'), 'não pode mais ser alterado');
reset role;

select t.fim();
rollback;
