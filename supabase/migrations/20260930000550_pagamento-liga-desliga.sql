-- 550 — Interruptor da COBRANÇA ONLINE da licença (16/10/2026).
-- Pedido do dono: deixar o pagamento desativado e ligar só quando for cobrar, por um botão no /admin.
--
--  1) public.plataforma_pagamento: UMA linha (id = 1), nasce DESLIGADA. Só se mexe por RPC.
--  2) pagamento_licenca_ativo(): leitura booleana para a Edge Function (service_role) e para a RPC abaixo.
--  3) admin_pagamento_estado() / admin_pagamento_definir(...): só administrador da plataforma; toda mudança é auditada.
--  4) licenca_checkout_criar() passa a recusar quando desligado. Sem isso um usuário logado poderia chamar a RPC
--     direto (PostgREST) e OCUPAR as 50 vagas do lançamento (a reserva não expira) mesmo com a cobrança desligada.
--
-- Desligar bloqueia só pagamentos NOVOS: confirmar um pagamento que já foi feito (webhook / retorno do checkout) segue
-- funcionando, porque a confirmação consulta o provedor e só ativa pedido realmente pago.
-- Depende da 547 (licenca_checkout_criar). Aplicar depois dela.
begin;

create table if not exists public.plataforma_pagamento (
  id int primary key check (id = 1),
  ativo boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null
);
insert into public.plataforma_pagamento (id, ativo) values (1, false) on conflict (id) do nothing;
alter table public.plataforma_pagamento enable row level security;
revoke all on public.plataforma_pagamento from public, anon, authenticated;
grant select on public.plataforma_pagamento to service_role;

create or replace function public.pagamento_licenca_ativo() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select ativo from public.plataforma_pagamento where id = 1), false);
$$;
revoke all on function public.pagamento_licenca_ativo() from public, anon;
grant execute on function public.pagamento_licenca_ativo() to authenticated, service_role;

create or replace function public.admin_pagamento_estado() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.plataforma_pagamento;
begin
  perform public._exigir_admin_plataforma();
  select * into p from public.plataforma_pagamento where id = 1;
  return jsonb_build_object('ativo', coalesce(p.ativo, false), 'atualizado_em', p.atualizado_em);
end $$;
revoke all on function public.admin_pagamento_estado() from public, anon;
grant execute on function public.admin_pagamento_estado() to authenticated;

create or replace function public.admin_pagamento_definir(p_ativo boolean, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_antes boolean; v_depois public.plataforma_pagamento;
begin
  if p_ativo is null then raise exception 'Informe se a cobrança fica ligada ou desligada.'; end if;
  select ativo into v_antes from public.plataforma_pagamento where id = 1 for update;
  update public.plataforma_pagamento set ativo = p_ativo, atualizado_em = now(), atualizado_por = v_admin
   where id = 1 returning * into v_depois;
  perform public._admin_auditar(
    case when p_ativo and not coalesce(v_antes, false) then 'pagamento_ligar'
         when not p_ativo and coalesce(v_antes, false) then 'pagamento_desligar'
         else 'pagamento_ajustar' end,
    'plataforma_pagamento', null,
    jsonb_build_object('ativo', v_depois.ativo, 'antes_ativo', coalesce(v_antes, false), 'motivo', nullif(btrim(p_motivo), '')));
  return jsonb_build_object('ativo', v_depois.ativo, 'atualizado_em', v_depois.atualizado_em);
end $$;
revoke all on function public.admin_pagamento_definir(boolean, text) from public, anon;
grant execute on function public.admin_pagamento_definir(boolean, text) to authenticated;

-- Barreira no servidor: a função original (547) fica privada e a pública confere o interruptor primeiro.
do $$ begin
  if to_regprocedure('public._licenca_checkout_criar_547()') is null then
    alter function public.licenca_checkout_criar() rename to _licenca_checkout_criar_547;
  end if;
end $$;
revoke all on function public._licenca_checkout_criar_547() from public, anon, authenticated, service_role;

create or replace function public.licenca_checkout_criar() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.pagamento_licenca_ativo() then
    raise exception 'O pagamento online está desligado no momento. Fale com a administração.';
  end if;
  return public._licenca_checkout_criar_547();
end $$;
revoke all on function public.licenca_checkout_criar() from public, anon;
grant execute on function public.licenca_checkout_criar() to authenticated;

select public._manutencao_instalar_guarda();
insert into public.migracoes_aplicadas (arquivo) values ('2026-10-16-pagamento-liga-desliga.sql') on conflict (arquivo) do nothing;
notify pgrst, 'reload schema';
commit;
