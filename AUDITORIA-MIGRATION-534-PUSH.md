# Auditoria da migration 534 (push: erro permanente + poda) e da Edge Function `enviar-push`

Data: 02/10/2026 · Branch do worktree: `worktree-agent-a4abd64c22458ca47` (a partir de `fase-9-seguranca-e-conteudo` @ `9d745b6`)
Escopo: SÓ LOCAL. Nada foi aplicado em produção, nenhuma Edge Function ou front foi publicado, nenhum push foi feito.
(A migration 534 foi aplicada no banco LOCAL de trabalho `postgres` do Docker, apenas para o E2E; ver "Estado do banco local".)

## Veredito

| Item | Pronto para produção? |
|---|---|
| Migration 534 (reescrita) | **SIM** (depois de aplicada na ordem do plano abaixo; gates verdes) |
| Edge Function `enviar-push` + `_compartilhado/push-erro.ts` | **SIM**, publicar DEPOIS da migration |

A versão original da 534 NÃO cumpria o requisito. Achados da auditoria (todos corrigidos):

1. **`desconhecido`, `400` genérico e `413` contavam como "permanentes" na poda.** `desconhecido` pode ser 408, 5xx raro ou qualquer coisa; 400 genérico e 413 são problema do PAYLOAD, não da inscrição. Um aparelho bom podia ser podado por erro de payload ou resposta não provada.
2. **Falha antiga condenava inscrição nova.** A contagem não olhava a data da inscrição: endpoint reutilizado/recriado herdava as falhas de antes (e falhas de OUTRO usuário no mesmo `dispositivo_id`). O front faz `upsert(onConflict: endpoint)`, então `created_at` nunca renova — era preciso uma marca nova.
3. **Prova de saúde fraca:** "alguma entrega ao host nos últimos 7 dias" não exclui uma quebra do servidor ocorrida depois. Agora exige entrega ao mesmo host nas 24 h da última falha.
4. **Corrida poda x re-inscrição:** a poda lia as candidatas 3 vezes (contar, apagar web, apagar FCM) e apagava só por `endpoint`; uma re-inscrição entre a leitura e o DELETE era apagada.
5. **Corrida resposta atrasada x re-inscrição (Edge Function):** o `delete ... eq('endpoint')` direto apagava a inscrição NOVA se a resposta 404/410 da tentativa antiga chegasse depois.
6. **FCM 404 sem prova:** o 404 do FCM apagava o token sempre; um 404 de projeto/rota errado atingiria TODOS os tokens. O 404 que prova token morto traz `errorCode: UNREGISTERED`.
7. **FCM 400 INVALID_ARGUMENT** (token malformado) nunca removia, e o 400 de payload nunca devia remover; não havia critério. Web 400 idem.
8. **Retry sem teto:** `push_reservar` re-reservava qualquer tentativa `falhou` indefinidamente a cada re-despacho, ignorava `Retry-After` e não era serializado por evento.
9. **401/403 sem observabilidade agregada** (só `push_tentativas`) e **mensagem de erro do FCM podia vazar** (um `JSON.parse` da conta de serviço pode ecoar pedaço do segredo para `infra_falhas`).
10. `web-push` sem `timeout` de socket (o `Promise.race` deixava a conexão aberta).

## Tabela status x decisão x prova

Prova = teste que roda a Edge Function REAL num container edge-runtime local contra um provedor FALSO (`supabase/tests/e2e/push-erro-permanente.mjs`, 144 checagens), mais o classificador puro em vitest (`src/lib/pushClassificacao.test.js`) e os testes SQL 139/140. "Remove" = apaga SÓ aquela inscrição/token.

### Web Push (RFC 8030; web.dev "Web Push Protocol")

| Resposta | Código gravado | Remove? | Retry-After | Retry no mesmo evento | Justificativa |
|---|---|---|---|---|---|
| 201/200 | `200` | não | - | entregue não reenvia | sucesso |
| 404 | `404` | **SIM** | - | n/a (removida) | web.dev: "404 = inscrição expirada, remover" |
| 410 | `410` | **SIM** | - | n/a | web.dev/RFC 8030: "410 = cancelada/expirada, remover" |
| 400 com corpo que prova inscrição inválida (`InvalidRegistration`, `invalid endpoint/subscription/registration/token`, `not registered`) | `sub_invalida` | **SIM** | - | n/a | os serviços não padronizam o 400; só remove quando o próprio corpo diz que a INSCRIÇÃO é inválida |
| 400 genérico / vazio (VAPID, TTL, criptografia, payload) | `400` | não | - | 1 tentativa (definitivo) | pode ser erro do servidor; não prova inscrição morta |
| 401 | `401` | não | - | 1 | credencial do SERVIDOR (VAPID), não do aparelho |
| 403 (inclui "VAPID credentials do not correspond to the subscription") | `403` | não | - | 1 | ver "Decisão 401/403" abaixo |
| 408 | `408` | não | se enviado | até 3 | temporário |
| 413 | `413` | não | - | 1 | payload grande (>=4096 B devem ser aceitos); problema do aviso, não do aparelho |
| 429 | `429` | não | **respeitado** (retry_apos; 1-24 h máx.) | espera o Retry-After; sem ele até 3 | limite de taxa |
| 500 / 502 / 503 / 504 | igual ao status | não | respeitado se enviado | até 3 | temporário |
| outro 4xx/5xx/3xx (418, 301, 507, 599...) | `desconhecido` | não | - | até 3 | não provado |
| corpo vazio (com status acima) | segue a linha do status | idem | - | idem | o corpo só serve para o 400 |
| timeout (10 s) | `timeout` | não | - | até 3 | temporário |
| recusa de conexão / DNS inexistente | `rede` | não | - | até 3 | temporário |

### FCM HTTP v1 (https://firebase.google.com/docs/cloud-messaging/error-codes)

| Resposta | Código gravado | Remove? | Retry-After | Retry no mesmo evento | Justificativa |
|---|---|---|---|---|---|
| 200 | `200` | não | - | - | sucesso |
| 404 com `errorCode: UNREGISTERED` | `404` | **SIM** | - | n/a | doc: "UNREGISTERED: remover imediatamente" |
| 404 SEM `UNREGISTERED` (NOT_FOUND genérico: projeto/rota) | `404` | não | - | 1 | um 404 de projeto errado atinge TODOS os tokens; a poda (com prova de saúde) decide depois |
| 400 INVALID_ARGUMENT de TOKEN (campo `message.token` em `BadRequest.fieldViolations` ou "registration token is not a valid FCM registration token") | `sub_invalida` | **SIM** | - | n/a | a doc diz que INVALID_ARGUMENT cobre token malformado, mas também payload/tamanho/chave reservada; só o primeiro é do token |
| 400 INVALID_ARGUMENT de payload (campo `message.data`, tamanho) / vazio | `400` | não | - | 1 | o token pode estar perfeito |
| 401 (THIRD_PARTY_AUTH_ERROR/UNAUTHENTICATED) | `401` | não | - | 1 | credencial do servidor |
| 403 (SENDER_ID_MISMATCH/PERMISSION_DENIED) | `403` | não | - | 1 | ver "Decisão 401/403" |
| 408 | `408` | não | se enviado | até 3 | temporário |
| 429 (QUOTA_EXCEEDED) | `429` | não | **respeitado** | espera | doc: backoff mínimo de 1 min |
| 500 / 502 / 503 (UNAVAILABLE) / 504 | igual | não | respeitado | até 3 | doc: temporário |
| 410 e demais não documentados | `desconhecido` | não | - | até 3 | 410 não existe no FCM v1 |
| timeout / rede | `timeout` / `rede` | não | - | até 3 | temporário |
| OAuth do Google falhando (503/401) ou conta de serviço ilegível | `oauth` | não (NENHUM token) | - | até 3 | erro do SERVIDOR; `infra_falhas` ganha só o rótulo (`FCM: oauth 503`, `FCM: configuração/credencial`) |

### Decisão 401/403 (credencial do servidor/VAPID/remetente)

- A Edge Function NUNCA remove por 401/403. Um 403 pode ser a inscrição criada com outra chave VAPID (por aparelho) OU a chave do servidor quebrada (todos os aparelhos). Do lado do servidor não dá para distinguir numa só resposta.
- Observável: o código real fica em `push_tentativas` (`403`, `401`); `push_resumo_erros()` agrega por canal/código; `push_inscricoes_mortas()` lista candidatas; e, quando TODOS os aparelhos de um canal num lote (>= 3) falham com o mesmo 401/403/400/413, a função grava UM registro agregado em `infra_falhas` (`push: web 403 em todos os N aparelhos do lote (credencial/payload do servidor?)`), que alimenta o alerta `push_degradado`. Um 403 isolado, com outros aparelhos entregando, não gera ruído em `infra_falhas`.
- Sem retry infinito: erro definitivo = 1 tentativa por aparelho e evento. (Consequência: depois de corrigir uma chave do servidor, os avisos já falhados não são reenviados; só avisos novos.)
- Só a poda (`push_podar_inscricoes_mortas`, decisão do dono, nunca agendada) remove por 401/403, e só com evidência acumulada: nunca entregou DESDE o registro, >= 3 falhas permanentes em >= 2 dias DISTINTOS, e o provedor entregou a OUTRO aparelho do mesmo host nas 24 h da última falha. Uma quebra de chave do servidor para todos não satisfaz a última condição.

## Múltiplos dispositivos, idempotência e concorrência (provas)

- Múltiplos dispositivos: uma pessoa com 21 inscrições web + 17 tokens FCM em cenários diferentes; só os 3 web e 2 FCM permanentes comprovados saem; 18 e 15 ficam; a outra pessoa do clube recebe normalmente (E2E seção 1; SQL 140 seção 2).
- Idempotência: `push_concluir` repetido com o mesmo resultado altera 0 linhas; `push_remover_inscricao` repetido devolve 0; poda repetida acha 0; re-despacho do evento não reenvia entregue/removida (SQL 139/140, E2E seção 2).
- Retry sem repetição infinita: 4 despachos do mesmo evento resultam em exatamente 1 requisição (definitivo, `Retry-After` ativo, entregue, removida) ou 3 (temporário/desconhecido/timeout/rede) por aparelho; nenhum aparelho passou de 3 (E2E seção 2, medido nas requisições recebidas pelo provedor falso).
- Concorrência:
  - 2 invokes simultâneos do MESMO evento: cada aparelho recebe exatamente 1 requisição; o 2º invoke devolve `jaEntregue` (E2E seção 3).
  - 2 sessões chamando `push_reservar` ao mesmo tempo: a soma é o nº de aparelhos, nenhuma duplicada (trava `pg_advisory_xact_lock` por evento; E2E seção 3).
  - Resposta ATRASADA (410) depois de a pessoa se re-inscrever: tentativa gravada como 410, inscrição nova NÃO apagada (E2E seção 4; SQL 140 seção 2).
  - Poda concorrente com re-inscrição: a poda bloqueou na linha, e ao liberar NÃO apagou a inscrição renovada (apagou só o controle idêntico) (E2E seção 4, duas sessões `psql` reais).
- Subscription recriada / endpoint reutilizado por outro usuário: falhas anteriores a `registrada_em` e falhas gravadas para outra pessoa não contam (SQL 140 seção 4).
- Multiclube: `p_club_id` restringe lista, poda e resumo; poda do clube A não toca aparelho com falhas só no clube B; a lista e o resumo não devolvem club/usuário/credencial; evento do clube B só tocou aparelhos do clube B (SQL 140 seção 5; E2E seção 5).
- Sem vazamento: `infra_falhas`, logs dos containers das Edge Functions e respostas HTTP não contêm endpoint, token, id de aparelho, chaves nem o segredo plantado em uma conta de serviço ilegível (E2E seção 7). As tabelas de push seguem sem coluna de credencial/conteúdo (teste 43 + E2E).
- A poda NÃO roda sozinha: nenhum `cron.schedule` na migration; `p_aplicar` default `false`; ensaio não remove; nenhum job pg_cron chama poda/lista/remover (SQL 140 seção 6); só `service_role` executa; `anon`/`authenticated`/`public` sem EXECUTE; todas SECURITY DEFINER com `search_path` vazio; `_push_mortas` (devolve a credencial crua) revogada até do `service_role`.

## O que mudou

Migration `supabase/migrations/20260930000534_push-erro-permanente-e-poda.sql` (reescrita; ainda não aplicada em produção):
1. Vocabulário de `push_tentativas.codigo`: +400, 401, 403, 408, 413, 502, 504 e `sub_invalida`; coluna `retry_apos`.
2. `registrada_em` em `push_subscriptions` e `push_tokens` (backfill = `created_at`; trigger servidor-decide: INSERT = agora; UPDATE só renova se usuário/endpoint/chaves/token mudarem; upsert idêntico e carimbo de `dispositivo_id` NÃO renovam).
3. `push_concluir` saneado (id/`retry_s` lixo ignorados, `retry_s` limitado a 24 h, só vocabulário fechado).
4. `push_reservar` (mesma assinatura e retorno): trava por evento, teto 1 (definitivo) / 3 (demais) por aparelho e evento, respeita `retry_apos`.
5. `push_remover_inscricao(bigint, text)` (service_role): remoção atômica; só se a tentativa está `enviando`, a credencial é a do aparelho dela e a inscrição não foi re-registrada depois da tentativa.
6. `_push_mortas`, `push_inscricoes_mortas(min_falhas, min_dias, club)` e `push_podar_inscricoes_mortas(aplicar, min_falhas, min_dias, club)`: regras acima; uma única leitura das candidatas; DELETE confere `registrada_em`.
7. `push_resumo_erros(horas, club)` (service_role): contagem por canal/código.

Edge Function:
- novo `supabase/functions/_compartilhado/push-erro.ts` (classificador puro: `classificarFalha`, `lerRetryAfter`, `rotuloErroFcm`);
- `supabase/functions/enviar-push/index.ts`: usa o classificador; remove só pela RPC atômica; grava `retry_s`; registro agregado de 401/403/400/413; corpo do erro só classifica (nunca gravado/logado); mensagem do FCM/OAuth vira rótulo fixo; `timeout` no socket do `web-push`.

Testes: SQL `139` (ajustado ao novo desenho, 32 asserts) e `140` (novo, 58 asserts); vitest `pushClassificacao.test.js` (novo), `pushErroPermanente.contract.test.js` (reescrito), `pushEdgeContrato.test.js` (2 asserts atualizados: a remoção agora é pela RPC; mesma intenção, mais estrito); E2E `test:push:e2e` (novo: `push-erro-permanente.{sh,mjs}`, `push-provedor-falso.ts`, `push-tls-falso/`).

Nota sobre o E2E: o edge-runtime não confia numa CA extra e bloqueia leitura de arquivo no worker, então o provedor falso (TLS, CA descartável, aliases de rede `fcm.googleapis.com`/`oauth2.googleapis.com`/`push-fake.test`) só é alcançável com um shim de TRANSPORTE de teste (`supabase/tests/e2e/push-tls-falso/shim.ts`, não vai para produção): `fetch` ganha `client` com a CA de teste só para esses hosts e `node:https.request` vira uma ponte sobre o mesmo `fetch`. A Edge Function real, a lib `web-push` real (VAPID, criptografia, `WebPushError`) e o classificador rodam sem alteração. O teste ABORTA antes de enviar qualquer coisa se os nomes dos provedores reais não resolverem para o container falso.

## Compatibilidade com o front (atual e antigo)

- Front só usa: upsert/delete/select em `push_subscriptions` e `push_tokens` (RLS por dono) e a RPC `push_aparelho_registrar(uuid, text, text)`. Nenhuma assinatura, retorno ou permissão de RPC chamada pelo front mudou (a 534 só ACRESCENTA funções service_role e re-emite `push_reservar`/`push_concluir` com a MESMA assinatura; as funções `_push_mortas`/`push_inscricoes_mortas`/`push_podar_inscricoes_mortas` nunca existiram em produção).
- SQL 140 seção 5b prova, como `authenticated` e sem conhecer `registrada_em`: upsert 2x idempotente, carimbo do aparelho, delete, e que continua sem ler `push_tentativas`.
- `contrato-rpc-front.mjs` (front HEAD e front antigo `62c3665` contra um banco com a 534) e a comparação de assinaturas/permissões antes x depois: ver "Gates".

## Riscos e pontos de atenção

1. Depois que a 534 estiver aplicada, o histórico `desconhecido` anterior (11 linhas em prod) NÃO conta mais para a poda: as 2 candidatas de hoje só voltam a ser candidatas com falhas novas (401/403/404/410) em 2 dias distintos. É o comportamento correto (não provado = não poda).
2. Erro definitivo (400/401/403/413) = 1 tentativa por evento. Corrigida uma chave do servidor, avisos antigos não são reenviados (só novos). Aceito para evitar retry infinito.
3. FCM 404 sem `UNREGISTERED`: o token fica e acumula até a poda decidir. Se o Google omitir esse detalhe no futuro, a limpeza passa a depender da poda (falha segura).
4. A heurística de 400 do Web Push é conservadora e baseada nos corpos conhecidos (FCM-web antigo, autopush); um serviço que use outro texto cai no caminho seguro (não remove).
5. `registrada_em`: o backfill usa `created_at`; se `created_at` for nulo, `now()`. Triggers novos em 2 tabelas pequenas (BEFORE INSERT/UPDATE), sem custo relevante.
6. Os testes de contrato estáticos (`pushEdgeContrato`) ficaram acoplados ao nome da RPC; mudança futura precisa atualizá-los de propósito.
7. O E2E precisa de internet só na 1ª execução (pacotes npm da função, como o `edge-chaves-novas`) e da migration 534 no banco local.

## Plano de aplicação sugerido (NÃO executado)

1. Conferir o Tenant 001 (`filhos-da-conquista`) antes.
2. Aplicar a migration 534 em transação com `lock_timeout` (ex.: 5 s) e inserir no ledger `supabase_migrations.schema_migrations`; o SQL Editor não segura `begin/commit`, então manter o script idempotente (o arquivo já é: `if not exists`, `drop ... if exists`, `create or replace`, `on conflict`). Nunca `db push --linked`/`db reset`/`migration repair`.
3. Conferir: `select count(*) from push_subscriptions where registrada_em is null` = 0; as funções existem e só `service_role` executa; `select * from push_podar_inscricoes_mortas()` (ENSAIO, p_aplicar false) mostra as candidatas, sem remover nada.
4. SÓ DEPOIS publicar a Edge Function `enviar-push` (com `_compartilhado/push-erro.ts`; a função nova chama `push_remover_inscricao`, que só existe depois do passo 2). A função ANTIGA continua compatível com o banco novo (usa só `push_reservar`/`push_concluir` com a mesma assinatura), então a ordem segura é banco primeiro.
5. Observar por 24-48 h: `select * from push_resumo_erros(24)` e `infra_falhas` (origem `push/edge`). Só então, se o dono quiser, rodar a poda com `p_aplicar := true` (preferir por clube) e eventualmente agendá-la — decisão do dono.
6. Rollback: a migration é aditiva; reverter a Edge Function para a versão anterior basta (continua funcionando com o banco novo).

## Estado do banco local

Para o E2E, a 534 foi aplicada no banco LOCAL de trabalho (`supabase_db_CONQUISTA`, db `postgres`, ledger local `20260930000534`), que estava na 532. Nada em produção. Bancos de replay usados: `replay_a534` (descartável).

## Gates

Todos locais, um de cada vez, nesta ordem (nenhum falhou depois do diagnóstico; ver "Incidente de infra" abaixo):

| Gate | Resultado |
|---|---|
| SQL 139 + 140 (`REPLAY_DB=<proprio> bash supabase/tests/run-tests.sh 139_... 140_...`) | 32 + 58 asserts OK |
| SQL completo (replay de todas as migrations + todos os testes) | 133 arquivos OK, 0 falhas |
| Upgrade de produção simulado (o `run-tests.sh` completo o executa ao final; mesmo caminho do `--upgrade`) | OK, 120 asserts |
| `npm run test:edge:bundle` | 4/4 funções empacotam (enviar-push com `_compartilhado/push-erro.ts`) |
| `npm run test:push:e2e` (novo, provedor falso) | 144/144 checagens OK, resíduos no banco = 0, containers/volume removidos (rodado 2x: 1ª no desenvolvimento, 2ª no estado final do código) |
| `npm run test:edge:chaves-novas` | 198/198 OK (inclui as checagens de `enviar-push` com a função alterada) |
| vitest dos arquivos tocados (`pushClassificacao`, `pushErroPermanente.contract`, `pushEdgeContrato`) | 70/70 OK |
| vitest completo | 2168 testes OK; 4 ARQUIVOS NÃO CARREGAM (INFRA, ver abaixo), nenhum relacionado a push |
| ESLint (`npm run lint`) | 0 erros (108 warnings que já existiam) |
| Contrato RPC front x banco (`contrato-rpc-front.mjs`), front HEAD (338 RPCs) e front antigo `62c3665` (337 RPCs) contra banco de replay COM a 534 | TODAS as RPCs existem, nos dois |
| Assinaturas e permissões de TODAS as funções públicas, banco até a 533 x banco até a 534 (`pg_proc`: nome, argumentos, retorno, secdef, EXECUTE de anon/authenticated/service_role) | diferença = só 6 linhas ACRESCENTADAS (`_push_carimbar_registro`, `_push_mortas`, `push_inscricoes_mortas`, `push_podar_inscricoes_mortas`, `push_remover_inscricao`, `push_resumo_erros`); nenhuma função existente mudou de assinatura, retorno ou permissão (inclui `push_reservar`, `push_concluir`, `push_aparelho_registrar`) |
| `npm run test:compat:front-antigo` | NÃO EXECUTÁVEL no worktree: INFRA (ver abaixo); coberto por: contrato RPC acima, diff de assinaturas e SQL 140 seção 5b |

### Classificação das falhas e incidentes (nada repetido sem diagnóstico)

- **INFRA (meu próprio erro de operação):** a 1ª tentativa do SQL completo foi interrompida com `TaskStop`, que não encerrou o `run-tests.sh` já em andamento (processo órfão no host + `psql` no container). A rodada seguinte, no MESMO `REPLAY_DB`, colidiu com ele e deu `deadlock detected` dentro de uma migration antiga (`..068`/`..051`) — não é bug de nenhuma migration: duas execuções concorrentes no mesmo banco. Diagnóstico: `Get-CimInstance` mostrou o `run-tests.sh` órfão (PID 23704); encerrado com `taskkill /T`, matei também os `psql` do container e a trava; a repetição passou limpa (e o SQL completo foi rodado do zero depois disso).
- **TESTE DESATUALIZADO (corrigido, mais estrito):** `pushEdgeContrato.test.js` (2 asserts) e `pushErroPermanente.contract.test.js` assumiam a remoção direta (`delete ... eq('endpoint')`) e o desenho antigo da poda. Reescritos para o novo desenho (RPC atômica + classificador + `registrada_em`). Nenhum teste foi afrouxado; os asserts novos exigem mais (ex.: nunca `delete` direto, nunca status 400/401/403 em condicional de remoção).
- **BUG REAL (da 534 original, corrigido):** os 10 achados do início.
- **INFRA (vitest completo):** `atualizacaoOta`, `qr`, `urlPublica`, `DocumentoClasse` não carregam porque o `node_modules` deste worktree não tem `@capgo/capacitor-updater` nem `qrcode-generator` (dependências de commits anteriores a este trabalho; fora do escopo). Não envolvem push.
- **INFRA (`test:compat:front-antigo`):** exige `.env.local` (arquivo local não versionado, ausente neste worktree) e o seed de homologação no banco local; cobre Rede/Classes/Requisitos, nada de push. Não alterei config nem criei credenciais para forçá-lo.
- **Observação sobre o E2E:** a 1ª tentativa mostrou todos os envios como `rede` porque o edge-runtime não confia na CA de teste (UnknownIssuer; `DENO_CERT`/`NODE_EXTRA_CA_CERTS` são ignorados e o worker não lê arquivos). Resolvido com o shim de transporte descrito acima (INFRA do teste, não da função).
