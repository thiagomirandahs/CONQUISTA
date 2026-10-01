# Scripts x chaves — matriz de classificação e privilégio (Fase 9, 01/10/2026)

Nenhum script foi executado contra produção nesta rodada (só `node --check`, vitest com a Management API **simulada** e o E2E local). Este documento classifica os scripts do repositório e diz **qual privilégio cada um realmente precisa**.

## 1. O que mudou

- Novo helper `scripts/lib/chaveServico.mjs` (`obterChaveServico`, `obterChavePublica`, `cabecalhosServico`, `escolherChave`):
  1. `SB_SECRET_KEY` / `SB_PUBLISHABLE_KEY` do ambiente (útil contra o Supabase local);
  2. Management API: chave `type: 'secret'` (a `default` primeiro) / `type: 'publishable'`, pedindo `?reveal=true` (valor completo; se a API recusar o parâmetro, tenta sem);
  3. **só se a nova não existir**: `name === 'service_role'` / `'anon'` (legacy) **com aviso** no stderr (sem o valor);
  - `CHAVES_EXIGIR_NOVA=1` (ou `exigirNova: true`) proíbe o passo 3: falha fechada.
  - Chave com máscara (`•••`) é descartada; valor nunca impresso nem em erro (propriedade não enumerável; erros só com o status HTTP, nunca o corpo); só GET na Management API, host fixo.
  - `cabecalhosServico(chave)`: chave nova -> **só `apikey`** (a `sb_secret_` não é JWT; `Authorization: Bearer` sozinho foi recusado localmente e o gateway converte a `apikey`); legacy -> `apikey` + `Authorization: Bearer`, como antes.
- **Migrados para o helper (sem aumentar privilégio — a secret key tem o mesmo poder da `service_role`, só que revogável por chave):** `janela-fase8/backup-storage.mjs`, `saneamento-teste-controlado-producao.mjs`, `storage-backfill-saneamento.mjs`, `storage-exclusao-teste-controlado-producao.mjs`, `storage-gc-excluir-lote.mjs`, `storage-gc-manifesto.mjs` (serviço) e `auth/testar-recuperacao-producao.mjs` (pública). `limpar-comprovacoes-orfas.mjs` passou a aceitar `SB_SECRET_KEY` (a legacy continua aceita na transição). `storage-gc-listar-api.mjs` já recebia a chave por variável de ambiente nomeada e funciona com `sb_secret_` sem mudança.
- Contrato (`src/lib/chaveServicoScripts.test.js`): nenhum script fora do helper usa `/api-keys` nem procura `name === 'service_role'/'anon'`; os migrados importam o helper. 17+2 testes de unidade/contrato.
- Prova no Supabase local (`npm run test:edge:chaves-novas`, bloco "scripts"): as mesmas chamadas REST/Storage dos scripts (GET de objeto, list, DELETE, RPC só-`service_role`) funcionam **só com `apikey` nova**; a publishable não enxerga os buckets privados.
- Varredura contra segredo no código (`src/lib/semSegredoNoCodigo.contract.test.js`): 0 achados no repositório.

**Não confirmado em produção (não toquei):** que `GET /v1/projects/{ref}/api-keys?reveal=true` devolve o valor completo da secret key, e que o gateway hospedado aceita a `sb_secret_` só no header `apikey` em `/storage/v1/object/*` (localmente aceita). Se algo disso falhar, o helper descarta a chave mascarada e cai na legacy **com aviso** — o script não quebra enquanto a legacy existir.

## 2. Categorias

- **NECESSÁRIO EM PRODUÇÃO** — roda como parte do funcionamento/entrega do produto.
- **SÓ MANUTENÇÃO** — operação humana, pontual (janela, backup, auditoria, limpeza).
- **SÓ TESTE** — ensaio/E2E/staging; não precisa tocar produção.
- **OBSOLETO** — cumpriu o papel (migração/janela já executada); fica como registro.

Privilégio: **SK** = chave de serviço (agora secret nova via helper) · **PK** = chave pública · **PAT** = token pessoal da Management API (`SUPABASE_ACCESS_TOKEN`) · **DB** = conexão direta ao Postgres (`DB_URL_PRODUCAO`, papel `postgres`) · **JWT** = JWT do usuário · **local** = só Docker/arquivos locais.

## 3. `scripts/`

| Script | Categoria | Fala com produção? | Privilégio real | Obs. |
|---|---|---|---|---|
| `gerar-ota.mjs`, `versaoOta.mjs` | NECESSÁRIO EM PRODUÇÃO (build do APK/OTA) | não | nenhum (monta/empacota as telas; não fala com o Supabase) | não lê chave de serviço |
| `janela-fase8/backup-storage.mjs` | SÓ MANUTENÇÃO | sim (leitura) | **DB** (lista `storage.objects`) + **SK** (só GET de objeto) + **PAT** (para obter a chave) | migrado; poderia usar só SK + listagem pela API de Storage (dispensaria o DB) |
| `janela-fase8/backup-banco.sh` | SÓ MANUTENÇÃO | sim (leitura) | **DB** (`pg_dump`) | sem chave de projeto |
| `janela-fase8/aplicar-migration.sh` | OBSOLETO (Fase 8 aplicada) | sim (escrita) | **DB** (postgres) | exige `CONFIRMO_JANELA_FASE8=SIM` |
| `janela-fase8/*.sql` (`00-pre-leitura`, `99-pos-invariantes`, `auditoria-admin-permissoes`, `prova-*`, `smoke-fase8`) | SÓ MANUTENÇÃO (leitura/prova) | sim (leitura) | **DB** | colados no editor ou via psql |
| `saneamento-teste-controlado-producao.mjs` | SÓ TESTE (em produção, controlado) | sim | **DB** + **SK** (Storage POST/GET/DELETE de objeto de teste) + **PAT** + segredo da função | migrado |
| `storage-exclusao-teste-controlado-producao.mjs` | SÓ TESTE (em produção, controlado) | sim | **DB** + **SK** (Storage) + **PAT** + segredo da função | migrado |
| `storage-backfill-saneamento.mjs` | SÓ MANUTENÇÃO | sim | **DB** (enfileira em `imagem_saneamento`) + **SK** (GET de objeto) + **PAT** + segredo da função (chama `sanear-imagens`) | migrado |
| `storage-gc-excluir-lote.mjs` | SÓ MANUTENÇÃO (**destrutivo**) | sim | **DB** + **SK** (GET e **DELETE** de objeto) + **PAT** | migrado; para na 1ª anomalia |
| `storage-gc-manifesto.mjs` | SÓ MANUTENÇÃO | sim (leitura) | **DB** + **SK** (só GET) + **PAT** | migrado |
| `storage-gc-listar-api.mjs` | SÓ MANUTENÇÃO | sim (leitura) | **SK** (só `list`) via variável nomeada | já compatível com `sb_secret_` |
| `storage-gc-dryrun.mjs` | SÓ MANUTENÇÃO (leitura) | sim | **DB** (somente leitura) | não apaga nada |
| `storage-gc-auditar-orfaos.sql` | SÓ MANUTENÇÃO (leitura) | sim | **DB** | |
| `limpar-comprovacoes-orfas.mjs` | SÓ MANUTENÇÃO | sim | **SK** (RPC `comprovacoes_orfas` só-service + Storage `remove`) | aceita `SB_SECRET_KEY`; lista por padrão, `--apagar` remove |
| `storage-inventario-saneamento.mjs`, `storage-inventario-heic.mjs`, `storage-inventario-video.mjs`, `storage-divergencias-formato.mjs` | SÓ MANUTENÇÃO | não | **local** (lê a cópia do backup) | |
| `verificar-auth-hospedado.mjs`, `verificar-backup-hospedado.mjs` | SÓ MANUTENÇÃO (só GET) | sim | **PAT** (somente GET; guarda de produção) | não usam chave de projeto |
| `auth/aplicar-auth-producao.mjs` | SÓ MANUTENÇÃO (escrita; dry-run por padrão) | sim | **PAT** (configuração do Auth) | não usa chave de projeto |
| `auth/testar-recuperacao-producao.mjs` | SÓ TESTE | sim (1 e-mail de recuperação) | **PK** (anon -> publishable) | migrado |
| `seguranca/rotacionar-senha-banco.mjs` | SÓ MANUTENÇÃO (escrita) | sim | **PAT** + **DB** (para provar a nova senha) | |
| `seguranca/auditar-backups.mjs`, `seguranca/backups-com-segredo-plano.sh` | SÓ MANUTENÇÃO | não | **local** | procura `sbp_`, `sb_secret_`, JWT em backups |
| `_migracao_real_producao.mjs` | OBSOLETO (migração real executada em 24/09) | sim (escrita) | **DB** | |
| `_etapa3.mjs`, `_janela-real.mjs` | OBSOLETO (ensaios da migração) | não | **local** (Docker descartável) | |
| `aplicar-340-350-360-producao.sql`, `aplicar-370-a-460-…`, `aplicar-470-a-481-…`, `aplicar-490-491-…`, `aplicar-500-501-…`, `aplicar-502-503-…` | OBSOLETO (já aplicados; produção na 491+) | sim (escrita) | **DB** (editor SQL) | registro histórico; idempotentes |
| `pre-janela-conquista.sql`, `remover-cartao-de-classe-legado.sql`, `smoke-fase7-producao.sql`, `auditoria-segredos-em-definicoes.sql` | SÓ MANUTENÇÃO / OBSOLETO | sim (leitura/escrita pontual) | **DB** | `auditoria-segredos-em-definicoes.sql` segue útil (leitura) |
| `aplicar-migration.mjs`, `drill-migration.mjs`, `restaurar-staging.mjs`, `staging.mjs`, `ensaio-producao.mjs`, `testar-preflight.mjs` | SÓ TESTE | não (staging/descartável) | **local** (chaves DEMO do CLI) | |
| `varredura-mobile.mjs` | SÓ TESTE (dev) | não | nenhum | |
| `scripts/lib/*` | biblioteca | — | — | `chaveServico.mjs` é novo |

## 4. `supabase/tests/e2e/**`, `supabase/e2e/**`, `supabase/carga/**`

Todos **SÓ TESTE** e **locais** (Supabase local/staging em Docker; URL fixa em `127.0.0.1`), com a chave **DEMO** do CLI no código (exceção justificada e limitada pelo contrato `semSegredoNoCodigo`: só `iss: supabase-demo` + `exp` + `role`, só nesses caminhos). Nenhum fala com produção.

| Grupo | Privilégio | Obs. |
|---|---|---|
| `supabase/tests/e2e/*.mjs` (fluxo, PDF, lote, Storage, Rede, saneamento, exclusão, contexto…) | **JWT** de usuário de teste + chave de serviço **local** para montar dados | `saneamento-storage-real`, `storage-exclusao-real` e `pdf-ponta-a-ponta` rodam também contra as funções **sem legacy** pelo `edge-chaves-novas.mjs` |
| `supabase/tests/e2e/edge-chaves-novas.{mjs,sh}` (novo) | só chaves **novas** locais (lidas do container, não gravadas) | cria/remove os containers `kfn_*` |
| `edge-bundle.sh`, `edge-bundle-pdf.sh`, `fix-storage-local.sh`, `build-por-ambiente.mjs` | nenhum / infra local | |
| `supabase/e2e/*.mjs` (`gates-api-staging`, `montar-tres-clubes`, `popular-staging`, `redteam-staging`) | PK + SK **do staging local** | |
| `supabase/carga/*` (k6, `rampa-hospedada.mjs`, `gerar-tokens.mjs`) | PK + JWT de teste; `rampa-hospedada` tem guarda de produção | só contra staging |

## 5. Resumo do que cada categoria exige

| Quem precisa de **secret nova** (privilégio de serviço) | Quem precisa só de **DB direto** | Quem precisa só de **PAT** | Quem precisa só de **JWT/PK** |
|---|---|---|---|
| `backup-storage`, `storage-backfill-saneamento`, `storage-gc-excluir-lote`, `storage-gc-manifesto`, `storage-gc-listar-api`, `limpar-comprovacoes-orfas`, os 2 testes controlados | `backup-banco.sh`, `storage-gc-dryrun`, SQLs de leitura/aplicação | `verificar-auth/backup-hospedado`, `aplicar-auth-producao` | `testar-recuperacao-producao` (PK), E2E locais (JWT) |

Observação: vários scripts de manutenção usam **DB + SK + PAT** juntos só para ler a lista no banco e baixar/apagar pela API. Dá para reduzir o PAT (a chave de serviço pode vir de `SB_SECRET_KEY` no ambiente, sem a Management API) e, nos de leitura (`backup-storage`, `gc-manifesto`), trocar o DB por listagem da API de Storage. **Não feito** (muda o fluxo operacional; decisão do dono).

## 6. Como usar depois da migração das chaves

- Com a secret nova no ambiente (sem PAT): `SB_SECRET_KEY=… node scripts/limpar-comprovacoes-orfas.mjs` (lista por padrão).
- Exigir só chave nova (recusa a legacy): `CHAVES_EXIGIR_NOVA=1 node scripts/…`.
- Os scripts que obtêm a chave pela Management API **avisam** quando caem na legacy; depois da Etapa C do plano (`EDGE-FUNCTIONS-CHAVES-AUDITORIA.md`) esse aviso não deve mais aparecer.
