# Pre-janela: dependencia de chaves legacy em GitHub Actions e Vercel

Auditoria somente leitura (01/10/2026). Nenhum valor de segredo foi lido, impresso ou gravado. Nada foi alterado em GitHub, Vercel ou Supabase.

## Resultados

- **GITHUB ACTIONS: LEGACY = NAO DETERMINADO** (o codigo nao usa service_role nem Management Token; mas o VALOR do secret `VITE_SUPABASE_ANON_KEY` nao e legivel, e o nome ainda diz "ANON").
- **VERCEL: LEGACY = NAO DETERMINADO** (sem acesso a Vercel: sem CLI/token; o bundle publicado esta limpo, o que prova o valor em PRODUCAO, nao em Preview/Development).

## 1. GitHub Actions

Acesso: `gh` autenticado (conta thiagomirandahs); listados so os NOMES. Repo tem 2 workflows (ci.yml, android.yml), 0 variables, 6 secrets de repositorio, ambientes `Preview` e `Production` (secrets de ambiente nao usados pelos workflows).

| Variavel | Workflow | Job/step | Finalidade | Classificacao |
|---|---|---|---|---|
| secrets.VITE_SUPABASE_URL | android.yml | build / `npm run build:cap` | URL do projeto embutida no APK | outro (URL publica) |
| secrets.VITE_SUPABASE_ANON_KEY | android.yml | idem | chave do cliente embutida no APK | **desconhecida** (nome legacy; doc FASE9 diz que o valor e a publicavel, nao verificado; secret nao alterado desde 09/09/2026) |
| secrets.VITE_VAPID_PUBLIC_KEY | android.yml | idem | chave VAPID publica (push) | outro (publica). **NAO cadastrada** no repo: o build do APK recebe vazio |
| secrets.ANDROID_KEYSTORE_BASE64 | android.yml | decodifica keystore | assinatura do APK | segredo funcional |
| secrets.ANDROID_KEYSTORE_PASSWORD | android.yml | gradle assemble | assinatura | segredo funcional |
| secrets.ANDROID_KEY_ALIAS | android.yml | gradle assemble | assinatura | segredo funcional |
| secrets.ANDROID_KEY_PASSWORD | android.yml | gradle assemble | assinatura | segredo funcional |
| github.run_number / github.ref_name / runner.temp | android.yml | gradle/release | versionCode, nome, pasta temporaria | outro (contexto) |
| VITE_SUPABASE_URL = `https://exemplo.supabase.co` (literal) | ci.yml | `npm run check` | build de teste | outro (placeholder) |
| VITE_SUPABASE_ANON_KEY = `chave-de-teste-ci` (literal) | ci.yml | idem | build de teste | outro (placeholder, nao e chave) |

Comparacao usados x cadastrados: usados e cadastrados = 6. Usado e NAO cadastrado = `VITE_VAPID_PUBLIC_KEY` (achado funcional, nao de seguranca). Cadastrado e nao usado = nenhum. Nenhum secret service_role, sb_secret_ ou sbp_ (Management Token) existe ou e referenciado. Scripts chamados pelos workflows: `npm run check` -> `supabase/tests/e2e/build-por-ambiente.mjs` (so valores de teste fabricados) e vitest; `build:cap` -> vite. Nenhum le chave real.

Scripts manuais (fora dos workflows) que citam chaves: `scripts/limpar-comprovacoes-orfas.mjs` aceita `SB_SECRET_KEY`/`SERVICE_ROLE_KEY`/`SUPABASE_SERVICE_ROLE_KEY`; `verificar-auth-hospedado.mjs` e `staging.mjs` aceitam `ANON_KEY`/`SUPABASE_ANON_KEY`; scripts de storage usam `SUPABASE_ACCESS_TOKEN` (Management Token, so em ~/.desbravaclube-prod.env local). Detalhe em `SCRIPTS-CHAVES-MATRIZ.md`.

NAO DETERMINADO (GitHub): valor de `VITE_SUPABASE_ANON_KEY` (secrets nao sao legiveis). O dono pode confirmar re-salvando o secret com a publishable (`sb_publishable_...`), ou inspecionando o APK mais recente (nao baixado aqui por regra). Se o valor for o JWT anon legacy, o APK ja publicado o embute.

## 2. Vercel

Acesso: **nenhum** (sem `vercel` CLI, `com.vercel.cli` sem login, `~/.desbravaclube-prod.env` so tem `DB_URL_PRODUCAO` e `SUPABASE_ACCESS_TOKEN`, que nao sao da Vercel e nao foram usados). Nao ha pasta `api/` (sem funcoes serverless). `vercel.json`: buildCommand `npm run build:vercel` (vite build + `gerar-ota.mjs`), rewrites, headers e redirect; nenhum env.

Variaveis consumidas pelo codigo (todas so em build; Vite embute no bundle, nao ha runtime server):

| Variavel | Uso | Fase | Classificacao |
|---|---|---|---|
| VITE_SUPABASE_URL | src/lib/supabase.js, chaveDaSessao.js, vite.config.js (deriva a CSP) | build | necessaria; publica |
| VITE_SUPABASE_ANON_KEY | src/lib/supabase.js | build | necessaria; **nome legacy, mas o valor em producao e `sb_publishable_` (provado pelo bundle)**; Preview/Development desconhecido |
| VITE_VAPID_PUBLIC_KEY | src/lib/push.js | build | necessaria p/ push web; publica |
| VITE_URL_PUBLICA_APP | src/lib/dominios.js | build | opcional |
| VITE_APP_VERSION | src/services/suporte.js | build | opcional |
| OTA_URL_BASE / OTA_VERSAO | scripts/gerar-ota.mjs | build | opcionais (padrao embutido) |
| CAP_BUILD | vite.config.js | build | so Android/CI, nao Vercel |

Nomes realmente cadastrados na Vercel (Production/Preview/Development): **NAO DETERMINADO**. O dono precisa mostrar apenas os NOMES: print de Settings > Environment Variables com valores ocultos, e, se possivel, o prefixo do valor (`sb_publishable_` vs `eyJ`) de VITE_SUPABASE_ANON_KEY em Preview e Development. Procurar variaveis fora do padrao (SUPABASE_SERVICE_ROLE_KEY, SB_SECRET_KEY, SUPABASE_ACCESS_TOKEN) que nao deveriam existir no projeto.

### Bundle publicado (https://app.desbravaclube.com.br, index.html + 188 arquivos .js incluindo chunks, ~4,4 MB)

| Padrao | Ocorrencias |
|---|---|
| JWT `eyJ...` (qualquer role: service_role ou anon) | 0 |
| `sb_secret_` | 0 |
| `sbp_` | 0 |
| texto `service_role` | 0 |
| `sb_publishable_` (valores distintos) | 1 (esperado) |

Conclusao: o deploy de producao nao carrega chave legacy nem segredo.
