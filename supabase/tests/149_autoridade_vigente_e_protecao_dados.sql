begin;
\ir _lib.sql
\ir _fixtures.sql

-- Uma diretoria expirada com outro papel ativo continua no clube, mas não administra.
insert into public.organization_memberships(user_id,organizational_unit_id,role,status,starts_at)
values(t.id('lider_a'),t.id('clube_a'),'conselheiro','ativo',now()-interval '1 day');
update public.organization_memberships set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'
where user_id=t.id('lider_a') and organizational_unit_id=t.id('clube_a') and role='diretoria';
select set_config('t149.vinculo',(select id::text from public.responsaveis where responsavel_id=t.id('pais_a') and desbravador_id=t.id('membro_a') limit 1),true);
select t.como('lider_a');
select t.eq('a pessoa ainda tem clube, pelo papel não privilegiado',public.clube_atual_id(),t.id('clube_a'));
select t.eq('diretoria fora da validade não administra',public.pode_administrar_clube(t.id('clube_a')),false);
select t.throws('diretoria expirada não apaga dados de outra pessoa',format('select public.excluir_usuario(%L)',t.id('membro_a')),'vínculo vigente');
select t.throws('diretoria expirada não rejeita vínculo de responsável',format('select public.rejeitar_vinculo(%L)',current_setting('t149.vinculo')),'vínculo vigente');
reset role;

-- Não mistura operações entre abas/clubes, mesmo quando há diretoria legítima nos dois.
select t.mk2('lider_a','diretoria','ativo','clube_b');
update public.organization_memberships set ends_at=null where user_id=t.id('lider_a') and organizational_unit_id=t.id('clube_a') and role='diretoria';
select t.como('lider_a');
select set_config('request.headers',jsonb_build_object('x-clube-atual',t.id('clube_b'))::text,true);
select t.throws('aba B não rejeita vínculo de A',format('select public.rejeitar_vinculo(%L)',current_setting('t149.vinculo')),'clube em uso');
reset role;

-- Rotinas delegadas não são uma segunda API acessível para ignorar as guardas.
select t.como('membro_a');
select t.bloqueado('não chama exclusão privada',format('select public._seg549_excluir_usuario(%L)',t.id('membro_a2')));
select t.bloqueado('não chama rejeição privada',format('select public._seg549_rejeitar_vinculo(%L)',current_setting('t149.vinculo')));
reset role;
select t.eq('authenticated não cria funções/tabelas no schema da API',has_schema_privilege('authenticated','public','create'),false);
select t.eq('anon não cria funções/tabelas no schema da API',has_schema_privilege('anon','public','create'),false);
select t.fim();
rollback;
