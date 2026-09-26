-- =============================================================================
--  Pendência do piloto: o TESTE GRATUITO não expirava sozinho.
--
--  Quando `trial_ate` passava, a assinatura ficava em 'trial' até alguém do admin encerrar à mão
--  (admin_trial_encerrar, 109). Agora uma rotina diária (pg_cron, mesmo padrão do 'expirar-cortesias'
--  da 150) faz a MESMA transição: trial -> pagamento_pendente pelo _assinatura_transicionar de sempre,
--  com evento em subscription_events (origem 'sistema'). Nada é cobrado nem apagado.
--
--  Nunca toca clube sem assinatura comercial: a rotina parte de `subscriptions` (clube sem assinatura
--  não aparece) e, por garantia, pula qualquer assinatura ligada ao Tenant 001 (slug filhos-da-conquista).
--  Cortesia (provider 'cortesia') não está em 'trial' — continua com a rotina própria dela.
-- =============================================================================

create or replace function public.trials_expirar() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select s.id, s.trial_ate from public.subscriptions s
            where s.status = 'trial' and s.trial_ate is not null and s.trial_ate <= now()
              and not exists (select 1 from public.subscription_clubs sc
                                join public.organizational_units o on o.id = sc.club_id
                               where sc.subscription_id = s.id and o.slug = 'filhos-da-conquista')
            for update of s skip locked loop
    perform public._assinatura_transicionar(r.id, 'pagamento_pendente',
      'teste gratuito terminou — aguardando pagamento', 'sistema', jsonb_build_object('trial_ate', r.trial_ate));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.trials_expirar() from public, anon, authenticated;
grant execute on function public.trials_expirar() to service_role;

select cron.schedule('expirar-trials', '25 4 * * *', 'select public.trials_expirar()')
 where not exists (select 1 from cron.job where jobname = 'expirar-trials');

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-teste-gratuito-expira-sozinho.sql')
on conflict (arquivo) do update set aplicada_em = now();
