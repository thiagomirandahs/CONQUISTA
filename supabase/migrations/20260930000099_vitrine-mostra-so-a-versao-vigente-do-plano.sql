-- Item 6 da rodada de fechamento: a vitrine pública (planos_disponiveis(), usada por /adquirir e
-- pelo onboarding) mostrava TODAS as versões publicadas de um plano ao mesmo tempo — achado ao
-- testar /adquirir de verdade no navegador (duas linhas "Essencial" lado a lado). Versão antiga NÃO
-- é deletada (continua existindo pra quem já assinou: subscriptions.plan_id aponta pro ID exato da
-- versão, e assinatura_do_clube() lê isso direto — nunca passa por planos_disponiveis()); só a
-- VITRINE (nova aquisição) passa a mostrar, por chave, a versão publicada mais recente.
create or replace function public.planos_disponiveis() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select json_agg(json_build_object(
      'chave', p.chave, 'versao', p.versao, 'nome', p.nome, 'descricao', p.descricao,
      'provisorio', p.provisorio, 'recursos', p.recursos, 'limites', p.limites,
      'precos', coalesce((select json_agg(json_build_object('ciclo', pr.ciclo, 'moeda', pr.moeda,
                            'valor_centavos', pr.valor_centavos, 'provisorio', pr.provisorio) order by pr.ciclo)
                          from public.billing_prices pr
                          where pr.plan_id = p.id and pr.ativo and pr.vigente_de <= now()
                            and (pr.vigente_ate is null or pr.vigente_ate > now())), '[]'::json)
    ) order by p.chave)
    from (
      select distinct on (p.chave) p.*
        from public.billing_plans p
       where p.publico and p.ativo and p.status = 'publicado'
       order by p.chave, p.versao desc
    ) p
  ), '[]'::json);
$$;
revoke all on function public.planos_disponiveis() from public, anon;
grant execute on function public.planos_disponiveis() to authenticated, anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-vitrine-mostra-so-a-versao-vigente-do-plano.sql')
on conflict (arquivo) do update set aplicada_em = now();
