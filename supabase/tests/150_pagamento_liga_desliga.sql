-- Interruptor da cobrança online (migration 550): nasce DESLIGADO, só o admin da plataforma liga/desliga (auditado),
-- a tabela é fechada, e a RPC de checkout recusa enquanto estiver desligado (senão alguém ocuparia as vagas do lançamento).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('adm150', '{"tipo":"fundador","nome":"Admin 150"}'::jsonb);
insert into public.platform_admins (user_id, papel) values (t.id('adm150'), 'operacao');
\o

select t.eq('nasce DESLIGADO', (select count(*) from public.plataforma_pagamento where id = 1 and ativo = false), 1::bigint);
select t.eq('é uma linha só', (select count(*) from public.plataforma_pagamento), 1::bigint);
select t.ok('pagamento_licenca_ativo() = false', not public.pagamento_licenca_ativo());

-- a tabela é fechada para quem entra pelo PostgREST
select t.como_anon();
select t.bloqueado('anon não lê a tabela', 'select count(*) from public.plataforma_pagamento');
select t.bloqueado('anon não chama pagamento_licenca_ativo', 'select public.pagamento_licenca_ativo()');
reset role;
select t.como('lider_a');
select t.bloqueado('liderança de clube não lê a tabela', 'select count(*) from public.plataforma_pagamento');
select t.bloqueado('...nem escreve nela', 'update public.plataforma_pagamento set ativo = true');
select t.throws('...nem liga pela RPC admin', 'select public.admin_pagamento_definir(true)', 'Sem permissão');
select t.throws('...nem lê o estado admin', 'select public.admin_pagamento_estado()', 'Sem permissão');

-- DESLIGADO: o checkout recusa já na porta (a reserva de vaga nunca acontece)
select t.throws('desligado: licenca_checkout_criar recusa', 'select public.licenca_checkout_criar()', 'desligado');
reset role;
select t.eq('...e nenhuma vaga/pedido foi criado', (select count(*) from public.licenca_pedidos) + (select count(*) from public.licenca_promocao_vagas), 0::bigint);

-- admin liga: estado, auditoria e o checkout passa a chegar nas regras de negócio
select t.como('adm150');
select set_config('t150.on', public.admin_pagamento_definir(true, 'teste de homologação')::text, true);
select t.eq('admin vê o estado ligado', (public.admin_pagamento_estado()->>'ativo')::boolean::int::bigint, 1::bigint);
reset role;
select t.eq('RPC devolveu ativo = true', ((current_setting('t150.on')::jsonb)->>'ativo')::boolean::int::bigint, 1::bigint);
select t.ok('pagamento_licenca_ativo() = true', public.pagamento_licenca_ativo());
select t.eq('auditado: pagamento_ligar com motivo', (select count(*) from public.platform_admin_audit where acao = 'pagamento_ligar' and detalhe->>'motivo' = 'teste de homologação'), 1::bigint);
select t.eq('quem ligou fica registrado', (select count(*) from public.plataforma_pagamento where atualizado_por = t.id('adm150')), 1::bigint);

select t.como('lider_a');
select t.throws('ligado: passa do interruptor e cai na regra de negócio (sem responsável financeiro)', 'select public.licenca_checkout_criar()', 'responsável financeiro');
reset role;

-- admin desliga de novo
select t.como('adm150');
select public.admin_pagamento_definir(false, 'voltou a desligar');
reset role;
select t.ok('voltou a ficar desligado', not public.pagamento_licenca_ativo());
select t.eq('auditado: pagamento_desligar', (select count(*) from public.platform_admin_audit where acao = 'pagamento_desligar'), 1::bigint);
select t.como('lider_a');
select t.throws('desligado de novo: recusa', 'select public.licenca_checkout_criar()', 'desligado');
reset role;

-- a função original (547) não é chamável por ninguém; só pela barreira
select t.eq('a implementação interna não é executável por authenticated/anon/service_role',
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r(papel)
    where has_function_privilege(r.papel, 'public._licenca_checkout_criar_547()', 'execute')), 0::bigint);
select t.ok('service_role lê o interruptor (a Edge Function precisa)', has_function_privilege('service_role', 'public.pagamento_licenca_ativo()', 'execute'));

select t.fim();
rollback;
