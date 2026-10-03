# Licença anual — InfinitePay

Pedido de 03/10/2026: R$ 220 no Pix à vista ou R$ 250 no cartão em até 12x sem juros para o clube.
Parcelas aproximadas de R$ 20,83; o checkout distribui os centavos para fechar R$ 250.
Somente a assinatura da plataforma está neste escopo. Mensalidades dos membros continuam como estão.

## O que foi implementado

- Migration 542 publica nova versão do plano anual copiando recursos e limites vigentes. Não altera contratos anteriores nem o fundador. Reexecutar não publica outra versão.
- Migration 543 registra pedidos com preços congelados, um pedido pendente por assinatura, permissões limitadas ao titular/financeiro da conta e confirmação exclusiva de serviço.
- Edge Function `licenca-infinitepay`: cria checkout, recebe webhook e confirma retorno consultando `payment_check` no provedor antes de ativar. Webhook não assinado não é prova de pagamento.
- Confirmação exige R$ 220 no Pix ou R$ 250 no cartão, 1–12 parcelas conforme pedido. Divergências não ativam a licença e precisam de conciliação: não orientar o cliente a pagar de novo.
- Renovação soma um ano ao período ativo; contratação começa na confirmação. Transação repetida não renova outra vez. Licença já ativa só pode renovar nos últimos 30 dias; assinatura cancelada exige atendimento.
- Tela interna mostra anual/Pix/parcelas, sem aviso falso de rascunho quando o catálogo tem preço definitivo. Botão de pagamento só aparece quando a função está habilitada e autoriza a conta.
- Pagamento ocorre no checkout externo, sem coletar cartão no DesbravaClube. Retorno é no domínio web; no Android, o usuário pode voltar ao app e tocar em atualizar situação.

## Pendências reais antes de cobrar

1. Informar a InfiniteTag da conta que recebe pelo DesbravaClube (sem `$`). Não é senha nem chave bancária.
2. Confirmar com a InfinitePay que o **Checkout Integrado por API** aplica desconto de 12% no Pix (250 → 220) e taxas assumidas até 12x. A API pública consultada documenta `handle`, `items`, `order_nsu`, `redirect_url`, `webhook_url`; não documenta campos para impor desconto por método ou assumir taxas. O artigo de desconto por método fala de Loja Online/Agendamentos. Não presumir que se estende ao checkout integrado.
3. Homologar uma venda de baixo valor autorizada em cada método, verificando checkout, campos `paid_amount`, recebimento, webhook e ativação. Sem isso, **manter `INFINITEPAY_HABILITADO=false`**. O código está preparado, mas não comprova essas condições comerciais.
4. Se o integrado não suportar o desconto, ajustar a estratégia com o dono (Pix separado ou outro provedor). Não gerar um checkout de R$ 220 que também aceite cartão enquanto se anuncia R$ 250 no cartão.

## Implantação

Executar, em ordem, os arquivos SQL completos 542 e 543 no Supabase. Aplicar cada arquivo em uma transação no SQL Editor. O ledger deve confirmar ambos. Não depende da migration de comentários 541.

Publicar a função com o helper `_compartilhado/chaves.ts` já usado pelo projeto e o novo `_compartilhado/infinitepay.ts`:

```sh
supabase functions deploy licenca-infinitepay --no-verify-jwt
supabase secrets set INFINITEPAY_HANDLE=SUA_INFINITETAG INFINITEPAY_HABILITADO=false
```

`SUPABASE_URL` e chaves de serviço/pública seguem o mecanismo existente (`SB_SECRET_KEY`/`SB_PUBLISHABLE_KEY`, chaves injetadas ou fallback legacy). Nunca colocar chave de serviço no frontend.
Após homologação e confirmação das condições comerciais, mudar somente `INFINITEPAY_HABILITADO=true`.
Desligar essa variável suspende novos checkouts e notificações: durante incidente, conciliar pagamentos recebidos antes de reativar. Não apagar pedidos/faturas.

Webhook: `${SUPABASE_URL}/functions/v1/licenca-infinitepay?webhook=1`. A função configura isso em cada link.
Quem volta do checkout pode confirmar pelo botão; não confiar nos parâmetros do retorno sem consultar o provedor.
Casos de reembolso/chargeback exigem conciliação administrativa: a documentação de checkout consultada não publica um contrato de notificação para eles. Não há renovação automática anual de cartão nesta integração.

## Verificação

Testes de app/validação: `npx vitest run src/lib/infinitepay.test.js src/components/PagamentoLicenca.test.jsx src/pages/Planos.test.jsx src/pages/Adquirir.test.jsx`.

PostgreSQL WASM isolado, sem chaves ou produção:

```sh
npm install --prefix /tmp/pagamento-qa @electric-sql/pglite
PGLITE_MODULO=/tmp/pagamento-qa/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/e2e/licenca-infinitepay-isolada.mjs
```

Esse teste usa tabelas extraídas da fundação comercial e stubs de contexto/transição. Verifica migrations novas, preços, imutabilidade dos contratos antigos, grants, autorização, valores e idempotência. Não substitui replay completo do Supabase nem homologação financeira.

Referências oficiais consultadas em 03/10/2026:
- https://www.infinitepay.io/checkout-documentacao
- https://ajuda.infinitepay.io/pt-BR/articles/15503297-como-oferecer-desconto-por-metodo-de-pagamento
- https://ajuda.infinitepay.io/pt-BR/articles/11731304-como-assumir-taxas-vendendo-com-o-link-de-pagamento
