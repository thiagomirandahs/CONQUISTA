-- Decisão comercial real (fora da rodada de fechamento técnico): o catálogo de 3 tiers
-- (Gratuito/Essencial/Completo) foi substituído por UM plano único — "Licença Anual" — com preço
-- real definido: R$229,90 no cartão (12x sem juros) ou R$199,90 no Pix. Não é mensalidade: é uma
-- licença ANUAL com opção de parcelamento no cartão — por isso só existe ciclo 'anual' pra este
-- plano (nenhum 'mensal'), e o valor do Pix/parcela mora no banco (metadata), nunca hardcoded no
-- React, seguindo a mesma regra dos demais preços do catálogo.
--
-- 'legado-fundador' (Tenant 001) NÃO é tocado — continua sem teto, fora da vitrine, do jeito que
-- sempre foi. Os 3 tiers antigos saem só da VITRINE (publico=false) — status continua 'publicado',
-- de propósito: são planos válidos que a administração da plataforma ainda pode usar (mover uma
-- conta pra lá manualmente, um caso de suporte específico, etc.), só não aparecem mais pra quem
-- está decidindo assinar agora. 'arquivado' seria mais restritivo do que a decisão comercial pediu.
update public.billing_plans set publico = false
 where chave in ('gratuito', 'essencial', 'completo');

alter table public.billing_prices add column if not exists metadata jsonb not null default '{}'::jsonb;

insert into public.billing_plans (chave, versao, nome, descricao, publico, status, ativo, recursos, limites, provisorio)
values (
  'anual', 1, 'Licença Anual',
  'Tudo o que o DesbravaClube oferece — Classes, especialidades, documentos com assinatura eletrônica e armazenamento de arquivos, tudo incluso.',
  true, 'publicado', true,
  null, -- todos os recursos, sem exceção (é o único plano vendido agora)
  '{"membros": 300, "administradores": 20, "clubes": 3, "fotos": 20000, "armazenamento_mb": 10240}'::jsonb,
  false -- preço real, decidido — não é mais rascunho
)
on conflict (chave, versao) do update
  set nome = excluded.nome, descricao = excluded.descricao, publico = excluded.publico,
      status = excluded.status, ativo = excluded.ativo, recursos = excluded.recursos,
      limites = excluded.limites, provisorio = excluded.provisorio;

insert into public.billing_prices (plan_id, ciclo, valor_centavos, provisorio, metadata)
select p.id, 'anual', 22990, false,
  jsonb_build_object(
    'pix_centavos', 19990,
    'parcelas_cartao', 12,
    'parcela_centavos', 1916,
    'campanha', 'Clube Fundador — condição especial de lançamento pros primeiros clubes'
  )
from public.billing_plans p
where p.chave = 'anual' and p.versao = 1
  and not exists (select 1 from public.billing_prices x where x.plan_id = p.id and x.ciclo = 'anual');

-- planos_disponiveis() ganha o metadata do preço (Pix/parcelamento) — mesma função, mesmo filtro de
-- vitrine (publico e ativo e status='publicado'), só um campo a mais.
create or replace function public.planos_disponiveis() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select json_agg(json_build_object(
      'chave', p.chave, 'versao', p.versao, 'nome', p.nome, 'descricao', p.descricao,
      'provisorio', p.provisorio, 'recursos', p.recursos, 'limites', p.limites,
      'precos', coalesce((select json_agg(json_build_object('ciclo', pr.ciclo, 'moeda', pr.moeda,
                            'valor_centavos', pr.valor_centavos, 'provisorio', pr.provisorio,
                            'metadata', pr.metadata) order by pr.ciclo)
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
values ('2026-09-30-licenca-anual-plano-unico.sql')
on conflict (arquivo) do update set aplicada_em = now();
