-- Preço autorizado em 03/10/2026. Nova versão: preserva contratos e preços anteriores.
do $$
declare b public.billing_plans; n uuid;
begin
  if exists (select 1 from public.migracoes_aplicadas where arquivo = '2026-10-03-licenca-anual-220-pix-250-cartao.sql') then return; end if;
  select * into b from public.billing_plans where chave = 'anual' and status = 'publicado' and ativo order by versao desc limit 1;
  if b.id is null then raise exception 'Licença anual publicada não encontrada.'; end if;
  insert into public.billing_plans (chave, versao, nome, descricao, publico, status, ativo, recursos, limites, provisorio)
  values (b.chave, (select max(versao) + 1 from public.billing_plans where chave = b.chave), b.nome, b.descricao,
          b.publico, 'publicado', true, b.recursos, b.limites, false) returning id into n;
  insert into public.billing_prices (plan_id, ciclo, valor_centavos, provisorio, metadata)
  values (n, 'anual', 25000, false, jsonb_build_object('pix_centavos', 22000, 'parcelas_cartao', 12,
    'parcela_centavos', 2083, 'campanha', 'Condição de lançamento — licença anual'));
  insert into public.migracoes_aplicadas (arquivo) values ('2026-10-03-licenca-anual-220-pix-250-cartao.sql');
end $$;
notify pgrst, 'reload schema';
