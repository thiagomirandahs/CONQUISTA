-- Regressões da auditoria sem login. Executar pelo runner SQL do projeto.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.como_anon();
select t.bloqueado('anon não lê contadores privados', 'select * from public.anon_rpc_cotas');
select t.bloqueado('anon não chama a implementação privada de documento', $$select public._anon_548_documento_verificar('abc')$$);
select t.bloqueado('anon não modifica limites de consulta', $$select public._anon_rpc_consumir('teste',99999,99999)$$);
select t.bloqueado('anon não consulta membros', 'select * from public.profiles');
select t.bloqueado('anon não confirma pagamentos', $$select public.licenca_infinitepay_confirmar(null,null,null,null,null)$$);
reset role;

-- A chamada pública inválida também consome a mesma cota que uma válida.
insert into public.anon_rpc_cotas(servico,origem_hash,janela,chamadas)
 values('documento',public._entrada_origem(),to_timestamp(floor(extract(epoch from now())/600)*600),119)
 on conflict(servico,origem_hash,janela) do update set chamadas=119;
select t.como_anon();
select public.documento_verificar('abc');
select t.throws('121ª consulta bloqueada independentemente do token', $$select public.documento_verificar('abc')$$, 'Muitas consultas');
reset role;
select t.eq('contador não ultrapassa 120', (select chamadas from public.anon_rpc_cotas where servico='documento' and origem_hash=public._entrada_origem() and janela=to_timestamp(floor(extract(epoch from now())/600)*600))::bigint,120::bigint);

-- Nem um cabeçalho de origem diferente atravessa o teto GLOBAL.
insert into public.anon_rpc_cotas(servico,origem_hash,janela,chamadas)
 values('entrada','global',to_timestamp(floor(extract(epoch from now())/600)*600),5000)
 on conflict(servico,origem_hash,janela) do update set chamadas=5000;
select t.como_anon();
select t.throws('teto global fecha novas origens', $$select public.entrada_abrir_publico('ABCDEFGHIJKLMNOP')$$, 'Muitas consultas');
select public.metrica_registrar('14800000-0000-4000-8000-000000000001','app',true,true);
reset role;
select t.eq('metadado do visitante não vira login', (select logado::int from public.metricas_sessoes where sessao='14800000-0000-4000-8000-000000000001')::bigint,0::bigint);
select t.fim();
rollback;
