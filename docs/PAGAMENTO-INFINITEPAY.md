# Licença anual — InfinitePay e lançamento

## Condições aprovadas em 14/10/2026

- Licença anual: R$ 250 no Pix e no cartão.
- Primeira contratação paga dos primeiros 50 clubes: R$ 200 no Pix ou cartão, somente no primeiro ano.
- Renovação: preço regular vigente (R$ 250 nesta versão). Não há cobrança automática recorrente no cartão.
- A campanha começa na aplicação da migration 547. Contratações anteriores não consomem retroativamente as vagas; clubes com pagamento anterior não são elegíveis.
- Contratos e pedidos antigos preservam seus valores congelados. Novos pedidos recebem os novos preços.

## Controle de vagas

A RPC reserva uma das 50 vagas ao preparar o pagamento, em uma transação com lock da assinatura e da campanha. Cadastro não reserva vaga. A tabela tem uma vaga por clube, assinatura e pedido, e o número da vaga só pode ser 1–50. A confirmação validada pelo provedor preenche a vaga. Repetir pedido ou webhook não ocupa outra vaga nem acrescenta outro ano.

**Limitação de conciliação:** o contrato atual de API não possui cancelamento/expiração homologados do link. Reservas não são automaticamente recicladas. Liberar uma vaga exige confirmar no provedor que o checkout antigo não pode receber pagamentos. Não apagar reservas manualmente enquanto os links estiverem pagáveis. Com todas as vagas reservadas, novas compras usam o preço regular; a vitrine distingue reservas de pagamentos confirmados. Implementar expiração automática depende de uma API homologada para revogar cobranças.

A confirmação pública consulta `payment_check` na InfinitePay; não confia em `paid` enviado pelo navegador/webhook. Confere valor, método, parcelas e referência. Depois, ativa a licença por um ano. A tela consulta o estado a cada 8 segundos. O webhook ativa a licença mesmo que o cliente feche a página.

## Implantação

1. Aplicar as migrations 542 e 543 se ainda não aplicadas; depois executar **20260930000547_licenca-250-promocao-50.sql** completa em uma transação. A 546 de audiolivros é independente.
2. Publicar a Edge Function atualizada com os helpers existentes:

```sh
supabase functions deploy licenca-infinitepay --no-verify-jwt
supabase secrets set INFINITEPAY_HANDLE=SUA_INFINITETAG INFINITEPAY_HABILITADO=false
```

3. Publicar o frontend. Sem a configuração do provedor, a função permanece desabilitada e não oferece cobrança.
4. Desativar qualquer desconto por método na conta InfinitePay: total do Pix e cartão precisa ser exatamente o total congelado no pedido, R$ 200 ou R$ 250. Não há parâmetro inventado de desconto na API.
5. Homologar Pix e cartão, webhook, retorno, valor total e parcelamento. Só então definir `INFINITEPAY_HABILITADO=true`. Taxas e parcelas precisam ser confirmadas com o provedor; as telas não prometem juros zero sem homologação.

A sessão de implementação não tem acesso ao banco de produção, à configuração InfinitePay ou aos segredos. Reembolso/chargeback e cancelamento de link exigem conciliação administrativa. Mensalidades de membros não são alteradas.

## Validação

```sh
npm install --prefix /tmp/pagamento-qa @electric-sql/pglite
PGLITE_MODULO=/tmp/pagamento-qa/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/e2e/licenca-promocao-50-isolada.mjs
npx vitest run src/components/PromocaoLicenca.test.jsx src/components/PagamentoLicenca.test.jsx
```

O teste PostgreSQL WASM usa tabelas reais extraídas da fundação e stubs para contexto/manutenção/transição. Cobre 50 pagamentos, 51º clube, renovação, idempotência e permissões. Não substitui replay completo, testes concorrentes em PostgreSQL real nem homologação financeira.

Referências: https://www.infinitepay.io/checkout-documentacao
