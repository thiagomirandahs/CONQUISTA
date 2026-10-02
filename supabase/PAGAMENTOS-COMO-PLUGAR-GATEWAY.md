# Pagamentos — como plugar um gateway (guia de 6 passos)

Estado (02/10/2026): a base está pronta e **desligada**. Nada muda para ninguém até alguém habilitar um provedor (passo 6).
O motor comercial (assinaturas, faturas, webhook idempotente) já existia desde a migration 048; a 540 acrescentou a ponta do checkout.

## O desenho em uma figura
```
Diretoria (app)  ->  pagamento-checkout (Edge)  ->  banco: pagamento_fatura_preparar  (valor do catálogo, fatura única por período)
                                |                         
                                +--> adaptador do gateway: criarCobranca  ->  link de pagamento / Pix copia-e-cola
                                +--> banco: pagamento_fatura_vincular     (guarda id da cobrança, link e Pix)
Gateway          ->  pagamento-webhook (Edge)  ->  adaptador: validarWebhook + traduzirEvento
                                +--> banco: billing_webhook_receber (idempotente)  ->  fatura paga, licença ativa por 12 meses
```
O motor **nunca** conhece o vocabulário do gateway: o adaptador traduz para cinco eventos internos
(`pagamento_aprovado`, `pagamento_recusado`, `pagamento_atrasado`, `renovacao`, `cancelamento`).
O valor cobrado vem **sempre do banco** (`billing_prices`, Pix em `metadata.pix_centavos` do plano), nunca do navegador.

## Os 6 passos (um gateway novo = 1 arquivo + chaves)
1. **Conta e sandbox.** Abra a conta no gateway e use o ambiente de testes (**sandbox**) primeiro. Anote: chave da API, e como ele prova que um aviso (webhook) é dele (token fixo ou assinatura HMAC).
2. **Crie o adaptador.** Copie `supabase/functions/_compartilhado/pagamento/_modelo.ts` para `<gateway>.ts` (ex.: `asaas.ts`) e preencha os 3 pontos marcados com TODO:
   `criarCobranca` (chama a API), `validarWebhook` (confere o segredo/assinatura; use `igualSeguro` ou `hmacSha256Hex` de `comum.ts`) e `traduzirEvento` (mapa de eventos do gateway para os cinco internos).
3. **Registre** o adaptador em `supabase/functions/_compartilhado/pagamento/registro.ts` (duas linhas: o `import` e a entrada em `ADAPTADORES`; os comentários mostram onde).
4. **Cadastre o provedor no banco** (`billing_providers`): `insert into public.billing_providers (chave, nome, tipo) values ('asaas', 'Asaas', 'externo')` — a `chave` é a mesma do adaptador. Num script de janela de produção, com backup (regra do projeto).
5. **Secrets das Edge Functions** (painel Supabase → Edge Functions → Secrets; nunca no código, nunca no front):
   `PAGAMENTO_PROVEDOR` (a chave do adaptador), `PAGAMENTO_API_KEY`, `PAGAMENTO_WEBHOOK_SEGREDO`, `PAGAMENTO_URL_RETORNO` (`https://app.desbravaclube.com.br`).
   Publique `pagamento-checkout` e `pagamento-webhook` e cadastre a URL do webhook no painel do gateway
   (`https://<projeto>.supabase.co/functions/v1/pagamento-webhook`).
6. **Habilite** só depois de testar no sandbox ponta a ponta: `update public.billing_providers set checkout_habilitado = true where chave = 'asaas'`.
   Enquanto for falso, o botão "Pagar" não aparece e o banco recusa abrir fatura. Para **desligar de emergência**: volte para `false`.

## Teste ponta a ponta sem gateway (provedor de teste)
Com `PAGAMENTO_PROVEDOR=mock` e `PAGAMENTO_MOCK_HABILITADO=sim` (só local/staging; em produção o mock é recusado de propósito, porque um aviso falso
poderia marcar licença como paga) e `billing_providers.checkout_habilitado = true` para `mock`, o fluxo inteiro roda sem cobrar ninguém.
Testes: SQL `supabase/tests/145_pagamento_base_gateway.sql`, regras das funções em `src/lib/pagamentoEdge.test.js`.

## O que já está garantido (e coberto por teste)
- Só a **diretoria** do clube em uso abre fatura (`pode_administrar_clube`); membro, pais e anônimo são recusados.
- **Uma fatura por período** por licença: pedir de novo reaproveita a mesma; trocar Pix/cartão atualiza a mesma; paga não abre outra.
- Webhook **autenticado** (falha fechada: sem segredo/assinatura válidos, 401 e nada é tocado) e **idempotente** (reenvio do mesmo evento não paga duas vezes).
- Ao **pagar**, a licença passa a valer 12 meses (anual) ou 1 mês (mensal) a partir do fim do período vigente (ou de agora, se já venceu).
- **Vencimento automático**: cron diário `avaliar-faturas-vencidas` (04:35) marca fatura aberta vencida e faz a assinatura avançar
  (pagamento pendente → inadimplente → suspensa, pela política de carência já existente). Suspensa/cancelada **nunca apaga dados**.
- Logs sem corpo, cabeçalho, e-mail ou chave.

## Lacunas conhecidas (decisões do dono / próximas rodadas)
- **CPF/CNPJ do pagador**: alguns gateways exigem para emitir cobrança/nota. O adaptador recebe `pagador.documento` opcional; hoje não há coleta (precisa de campo em `billing_account_contacts` e tela).
- **Reembolso/estorno**: o motor aceita fatura `reembolsada`, mas nenhum evento a produz ainda; defina a política antes.
- **Reconciliação ativa** (consultar o gateway por faturas abertas "perdidas") e reprocessar eventos `falhou`: não implementadas; o webhook com reentrega do gateway cobre o caso comum.
- **Nota fiscal**, termos de uso/reembolso e LGPD dos dados do pagador: revisão jurídica.
- Texto da landing e de `Adquirir.jsx` ("pagamento combinado direto") só muda quando o provedor for habilitado em produção (`LANDING-VERACIDADE.md`).
