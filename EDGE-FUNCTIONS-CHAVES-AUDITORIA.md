# Edge Functions x chaves novas (publishable / secret) — auditoria, helper, prova local e plano de produção

Fase 9 · 01/10/2026 · **tudo feito só localmente** (nenhuma chamada ao Supabase hospedado, nenhum deploy, nada desativado).
Nada neste documento foi executado em produção. O plano da seção 9 depende de autorização explícita do dono.

## 1. Resumo

- As 7 Edge Functions passaram a ler as chaves por **um helper único**, `supabase/functions/_compartilhado/chaves.ts`:
  secret nova -> `service_role` legacy (serviço) e publishable nova -> `anon` legacy (cliente "como o usuário"). Mesmas respostas HTTP, mesmos segredos de gatilho, mesmo `verify_jwt`.
- **As 3 funções que liam a `SUPABASE_ANON_KEY` só a usavam para criar o cliente "como o usuário"** (JWT do chamador no `Authorization`). Isso funciona com a **publishable** — provado localmente (seção 6).
- **Prova** (`npm run test:edge:chaves-novas`, 179 checagens, todas ok): cada função rodou num container do edge-runtime (mesma imagem do `supabase start`) **sem `SUPABASE_SERVICE_ROLE_KEY` nem `SUPABASE_ANON_KEY`** (conferido por `printenv`, só os nomes), apenas com as chaves novas.
  - **PROVADA COM CHAVES NOVAS:** `sanear-imagens`, `storage-excluir`, `limpar-fotos-rede`, `admin-comunidade-foto`, `gerar-documento-pdf`, `gerar-documento-pdf-final`.
  - **PROVADA PARCIALMENTE:** `enviar-push` (o envio real ao navegador/FCM não existe localmente).
- O fallback legacy foi mantido e testado (perfil "legacy" = produção hoje). Há uma alavanca de rollback sem redeploy: o secret `CHAVES_MODO` (`auto` | `nova` | `legacy`).
- **Não determinado** (seção 7): como o projeto hospedado se comporta ao desativar as legacy (variáveis injetadas, verificação do JWT do usuário no gateway, formato exato de `SUPABASE_SECRET_KEYS`). O plano de produção foi desenhado para descobrir isso **antes** de desativar qualquer coisa.

## 2. Como as chaves chegam à função (fatos observados no runtime local)

O container `supabase_edge_runtime_CONQUISTA` (edge-runtime 1.74.3) tem um *main service* (o do CLI) que:

- aplica o `verify_jwt` do `config.toml` (HS256 pelo segredo JWT interno; ES256/RS256 pelo JWKS);
- monta o ambiente de cada função copiando o ambiente do container **e injetando** `SUPABASE_PUBLISHABLE_KEYS` = `{"default":"sb_publishable_…"}` e `SUPABASE_SECRET_KEYS` = `{"default":"sb_secret_…"}` (a partir de `SUPABASE_INTERNAL_PUBLISHABLE_KEY` / `SUPABASE_INTERNAL_SECRET_KEY`). As `SUPABASE_INTERNAL_*` **não** chegam à função.
- O ambiente do container local **ainda tem** `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`; por isso as funções locais "funcionavam" mesmo se lessem só a legacy. O E2E novo tira essas duas variáveis.

O Supabase local **aceita** as chaves novas como `apikey` (o Kong traduz `sb_secret_` em service_role e `sb_publishable_` em anon; em produção quem faz isso é o gateway da plataforma — mesma semântica, outro componente). Verificado: Storage (lista todos os buckets com a secret; só os públicos com a publishable), Auth admin (secret sim, publishable não), RPC só-`service_role` (secret sim, publishable não). Detalhe importante: **`apikey` sozinho basta; `Authorization: Bearer sb_secret_…` sozinho (sem `apikey`) é recusado (400).**

**Formato esperado de `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS`:** objeto JSON nome -> chave, com a chave `default`. O helper aceita também lista e `{nome:{api_key}}` e usa `default` ou a primeira com o prefixo certo. **Confirmado no runtime local; no hospedado só pela existência dos nomes na lista de secrets do projeto** (seção 7).

## 3. Matriz por função

Legenda: URL = `SUPABASE_URL` · legacy = `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` · helper = `chaves.ts` · "serviço" = privilégio de `service_role`/secret (ignora RLS).

| Função | verify_jwt (config.toml) | URL | ANON legacy | SERVICE legacy | publishable (helper) | secret (helper) | Precisa de privilégio de serviço? | Poderia usar só o JWT do usuário? |
|---|---|---|---|---|---|---|---|---|
| `enviar-push` | `false` (gatilho `x-push-webhook-secret`) | sim | não | antes sim | não | sim | **Sim** | **Não** |
| `sanear-imagens` | `false` (gatilho `x-saneamento-secret`) | sim | não | antes sim | não | sim | **Sim** | **Não** |
| `storage-excluir` | `false` (gatilho `x-storage-excluir-secret`) | sim | não | antes sim | não | sim | **Sim** | **Não** |
| `limpar-fotos-rede` | **não declarada** (ver 8.1) (gatilho `x-rede-limpeza-secret`) | sim | não | antes sim | não | sim | **Sim** | **Não** |
| `gerar-documento-pdf` | `true` | sim | antes sim (cliente do usuário) | antes sim | **sim** (substitui a anon) | sim | **Sim, só para o upload** | **Em parte**: RPCs já são como usuário; o upload não |
| `gerar-documento-pdf-final` | `true` | sim | antes sim (cliente do usuário) | antes sim | **sim** (substitui a anon) | sim | **Sim** (upload; e o download do desenho hoje) | **Em parte**: o download do desenho poderia ser como usuário (ver 4.6) |
| `admin-comunidade-foto` | `true` | sim | antes sim (cliente do usuário) | antes sim | **sim** (substitui a anon) | sim | **Sim, só para assinar a URL** | **Não** para assinar; a decisão já é do banco como usuário |

## 4. Detalhe por função

### 4.1 `enviar-push`
- **Operações:** RPC `push_reservar` e `push_concluir` (só `service_role` executa); `DELETE` em `push_subscriptions`/`push_tokens` (inscrição expirada/token 404); `INSERT` em `infra_falhas`; envio Web Push (VAPID) e FCM HTTP v1.
- **Por que serviço:** quem chama é o banco (`pg_net`, sem JWT de usuário) e a função precisa ler inscrições de **todos** os destinatários do clube; nenhuma policy deixa um usuário fazer isso. Provado: o usuário autenticado **não** executa `push_reservar`, não lê `push_eventos` e não escreve em `infra_falhas`.
- **Risco da troca:** o mais alto das 7 (se parar, os avisos param; o `pg_net` só vê 500). Por isso é a **última** do plano.
- **Pendente de prova real:** entrega a um navegador/FCM de verdade.

### 4.2 `sanear-imagens`
- **Operações:** RPC `imagem_saneamento_pendentes/conferir/marcar`; Storage `download` e `upload` com `upsert` (regrava o arquivo no mesmo caminho) em qualquer bucket de imagem.
- **Por que serviço:** baixa/regrava arquivo de **qualquer pessoa**, chamado pelo cron. O usuário comum não executa as RPCs nem lê arquivo alheio (provado).
- **Risco:** regravar com a chave errada poderia mudar `owner_id`. Provado pelo E2E existente (45 verificações): `owner_id`, permissões e RLS do Storage ficam iguais com a secret nova.

### 4.3 `storage-excluir`
- **Operações:** RPC `_storage_exclusao_processar/_confirmar`; Storage `remove`.
- **Por que serviço:** o job nasce **desligado**; apaga só o que o banco devolver. Sem alternativa de usuário (não há usuário). Provado com o E2E existente (34 verificações) e fila vazia nos perfis de fumaça.

### 4.4 `limpar-fotos-rede`
- **Operações:** RPC `rede_fotos_pendentes/confirmar`; Storage `remove` (lote de até 100).
- **Por que serviço:** o Supabase não deixa apagar arquivo por SQL; só a API do Storage, e só com serviço. Provado: remove o arquivo, confirma no banco, "arquivo já ausente" conta como apagado, 2ª chamada é idempotente, e o usuário comum não executa as RPCs nem remove arquivo alheio.

### 4.5 `gerar-documento-pdf`
- **Por que usava a ANON legacy:** só para `createClient(URL, ANON, { global: { headers: { Authorization: <JWT do usuário> } } })`, isto é, o cliente que chama `documento_pdf_dados` e `documento_pdf_registrar` **como o usuário** (o banco decide e a trava de imutabilidade pós-assinatura roda lá). **Não há nenhum outro uso da anon.**
- **Migração:** a mesma chamada com a **publishable** (o JWT do usuário continua no `Authorization`; a `apikey` só identifica o projeto). Provado: fluxo completo H1 (44 checagens do E2E de PDF), e "JWT válido + token inexistente" volta 403 vindo da RPC (não 401/400 de chave inválida).
- **Serviço:** o upload em `documentos-emitidos`, que **não tem policy de INSERT para `authenticated` de propósito** (migration 88).

### 4.6 `gerar-documento-pdf-final`
- Igual à anterior para o cliente do usuário (migrado para a publishable). Serviço: upload do H2 e **download** do PNG da assinatura desenhada (`assinaturas-desenhadas`).
- **Oportunidade de menor privilégio (NÃO feita):** o download do desenho poderia ser feito pelo cliente do usuário se a policy de SELECT do bucket valer para quem chama (o E2E mostra "lê o desenho de volta (dono/liderança)"). Mudaria o comportamento em casos de borda (quem assina x quem gera); fica como decisão (seção 10).

### 4.7 `admin-comunidade-foto`
- **Por que usava a ANON legacy:** só para o cliente do usuário que chama a RPC `admin_comunidade_foto_assinar` (o Postgres decide: admin da plataforma, item em análise/denunciado, arquivo existente, e grava **exatamente 1** linha em `plataforma_acesso_log`). Migrada para a publishable.
- **Serviço:** assinar 60 s a URL do arquivo do bucket `comunidade`; o admin **não tem** leitura direta nesse bucket (migration 530). Provado: o mesmo admin, com o próprio JWT, não assina o arquivo.
- **Provado também:** sem Authorization -> 401; JWT adulterado -> 401; diretoria do clube/de outro clube/usuário comum -> 403; post já aprovado -> 403; UUID inexistente -> 403; tipo/id inválidos -> 400; GET -> 405; CORS; as negadas **não** geram log; arquivo ausente -> nunca 200.

## 5. O helper `chaves.ts`

Ordem (a primeira que existir **e** tiver o formato certo vence):

| | 1ª | 2ª | 3ª (transição) |
|---|---|---|---|
| serviço | `SB_SECRET_KEY` (`sb_secret_…`) | `SUPABASE_SECRET_KEYS` (JSON; `default` ou a primeira `sb_secret_`) | `SUPABASE_SERVICE_ROLE_KEY` (JWT) -> `origem: 'legacy'` |
| pública | `SB_PUBLISHABLE_KEY` | `SUPABASE_PUBLISHABLE_KEYS` | `SUPABASE_ANON_KEY` -> `origem: 'legacy'` |

- `CHAVES_MODO`: `auto` (padrão) | `nova` (só as novas; sem elas, **falha fechada**) | `legacy` (volta ao comportamento anterior). É a alavanca de rollback: trocar o secret não exige novo deploy de código.
- O valor **nunca** aparece em erro, log, JSON ou template string (propriedade `valor` não enumerável; erro genérico "Chaves do projeto indisponíveis"). Cada função loga uma linha no boot: `chaves {"servico":"nova:SUPABASE_SECRET_KEYS","publica":"nova:SUPABASE_PUBLISHABLE_KEYS","modo":"auto"}` (origem e **nome** da variável).
- Valor no formato errado (um JWT em `SB_SECRET_KEY`, uma publishable no lugar da secret) é **ignorado**.
- 21 testes de unidade (`src/lib/chavesEdge.test.js`) + contrato: nenhuma função lê `SUPABASE_*` direto nem usa a chave de serviço no cliente "como o usuário".

**Atenção ao primeiro deploy:** se a plataforma já injeta `SUPABASE_SECRET_KEYS` (os nomes aparecem na lista de secrets do projeto), a função **passa a usar a chave nova assim que for publicada**, mesmo sem nenhum secret nosso. Para publicar o código **sem mudar nada**, crie antes o secret `CHAVES_MODO=legacy` (plano, etapa A).

## 6. A prova (como foi feita e o que ela mostra)

`npm run test:edge:chaves-novas` (`supabase/tests/e2e/edge-chaves-novas.{mjs,sh}`), local, Docker, ~10 min na 1ª vez (baixa pacotes npm):

- usa a **mesma imagem** do `supabase start` e **o mesmo main service** (copiado do container do CLI), portanto o `verify_jwt` e a injeção de `SUPABASE_*_KEYS` são os do CLI;
- chaves lidas em tempo de execução do container (`SUPABASE_INTERNAL_*`), nunca gravadas em arquivo versionado, log ou saída; o `--env-file` do container é temporário e apagado; o próprio harness de teste também usa só as chaves novas;
- containers `kfn_*` (portas 54401–54406) e volume `kfn_deno_cache`, removidos no fim (inclusive em Ctrl+C/falha); dados `e2e-chv-*` apagados; os pendentes que já existiam em `rede_fotos_para_apagar` são postos de lado durante o teste e **restaurados**.

Perfis de ambiente:

| Perfil | Ambiente da função | Para quê |
|---|---|---|
| `plataforma` | só `SUPABASE_SECRET_KEYS`/`SUPABASE_PUBLISHABLE_KEYS` injetadas; **sem** legacy | bateria completa |
| `sb` | só `SB_SECRET_KEY`/`SB_PUBLISHABLE_KEY`; sem plataforma e sem legacy | fumaça |
| `legacy` | só `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` (produção hoje) | regressão do fallback |
| `semchave` e `modo-nova` | nenhuma chave / só legacy com `CHAVES_MODO=nova` | falha fechada (5xx, sem vazar) |
| `indisp` | chaves novas válidas, Supabase fora do ar | falha limpa de cada função |

Resultado por função (checagens do perfil completo + fumaça + falhas):

| Função | Classificação | Checagens | O que cobre |
|---|---|---|---|
| `sanear-imagens` | **PROVADA COM CHAVES NOVAS** | 14/14 + sub-E2E existente (45) | segredo (sem/errado/1 caractere/GET), download+upload no Storage com owner/RLS preservados, EXIF/GPS removidos, idempotência, falha, RLS (usuário não executa as RPCs) |
| `storage-excluir` | **PROVADA COM CHAVES NOVAS** | 13/13 + sub-E2E existente (34) | idem; reverificação do banco, carência, bucket protegido |
| `limpar-fotos-rede` | **PROVADA COM CHAVES NOVAS** | 29/29 | remove + confirma no banco, ausente = apagado, idempotência, RLS/privilégio, falha com Supabase fora |
| `admin-comunidade-foto` | **PROVADA COM CHAVES NOVAS** | 29/29 | `verify_jwt`, JWT inválido/adulterado, multiclube, RLS, log de acesso, URL assinada abre os bytes, arquivo ausente |
| `gerar-documento-pdf` | **PROVADA COM CHAVES NOVAS** | 12/12 + E2E de PDF (44) | H1 completo, hash confere, privacidade dos bytes, **outro clube negado**, token/JWT inválidos |
| `gerar-documento-pdf-final` | **PROVADA COM CHAVES NOVAS** | 12/12 + E2E de PDF | H2 com assinatura desenhada vinda do Storage, idempotência real, outro clube negado |
| `enviar-push` | **PROVADA PARCIALMENTE** | 26/26 | segredo, reserva/conclusão via RPC de serviço, escrita em `infra_falhas`, idempotência (`jaEntregue`), payloads inválidos/`pessoal`/sem clube, falha com banco fora. **Falta:** entrega real (ver 7) |
| (scripts) chamadas REST/Storage | **PROVADA COM CHAVES NOVAS** | 7/7 | GET/list/DELETE de objeto e RPC só com `apikey` nova |

Também verificado no mesmo teste: a origem de cada chave (`nova:SUPABASE_SECRET_KEYS`, `nova:SB_SECRET_KEY`, `legacy:SUPABASE_SERVICE_ROLE_KEY`), nenhuma função usou legacy nos perfis sem legacy, e **nenhuma resposta nem log** de container contém o valor de nenhuma chave/segredo (secret, publishable, legacy, segredo JWT, VAPID, segredos de gatilho).

## 7. O que NÃO foi provado / NÃO DETERMINADO

**Não provável localmente**
1. **Entrega real de push** (Web Push para navegador, FCM do Google, `FCM_SERVICE_ACCOUNT`). Simulado: provedor inalcançável.
2. **O gateway hospedado** traduzindo `sb_secret_`/`sb_publishable_` (localmente é o Kong). A semântica é a mesma; o componente não.
3. **`verify_jwt` no gateway hospedado**: localmente é o main service do CLI; em produção, a plataforma.

**Não determinado (precisa ser observado em produção, com cuidado)**
4. Ao **desativar as chaves legacy** no painel: a plataforma continua injetando `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` (inúteis), para de injetar, ou injeta valores revogados? O helper lida com os três casos (nova primeiro; `CHAVES_MODO=nova` ignora a legacy), **mas não foi observado**.
5. **Os JWTs dos usuários** (HS256, assinados pelo segredo JWT legado) continuam sendo aceitos pelo `verify_jwt=true` e pelo Auth depois de desativar as chaves legacy `anon`/`service_role`? Desativar as **chaves de API** não é o mesmo que girar o **segredo JWT**, mas a documentação precisa ser conferida no painel antes. É o ponto de maior risco para as 3 funções com `verify_jwt=true` e para todo o app.
6. Formato exato de `SUPABASE_SECRET_KEYS` **no hospedado** (confirmado só no runtime local do CLI).
7. Se `GET /v1/projects/{ref}/api-keys?reveal=true` devolve o valor completo de uma secret key (usado por `scripts/lib/chaveServico.mjs`; o helper descarta valores mascarados e cai na legacy com aviso).
8. Se o editor de funções do painel aceita funções com `import '../_compartilhado/…'` (hoje `sanear-imagens` e `storage-excluir` já importam; **as outras 5 eram autocontidas** — comentários antigos dizem "função colada no painel"). Com `supabase functions deploy` (CLI) o import é empacotado (provado pelos `test:edge:bundle*`).
9. Reativar as legacy depois de desativadas (rollback do painel) — conferir se o painel permite.

## 8. Achados colaterais (nada disso foi alterado)

1. **`limpar-fotos-rede` não está no `supabase/config.toml`.** Os outros gatilhos têm `verify_jwt = false`; esta confia em estar assim no painel. Um `supabase functions deploy limpar-fotos-rede` **sem** `--no-verify-jwt` ligaria o JWT e o cron (sem JWT) passaria a levar 401 em silêncio. Sugestão (sem mudança de comportamento se produção já está `false`): declarar `[functions.limpar-fotos-rede] verify_jwt = false`.
2. `sanear-imagens` devolve `{"ok": <contagem>, …}` (o `...c` sobrescreve `ok: true`); comportamento antigo, mantido (o teste checa `reservados`).
3. `limpar-fotos-rede`: com o Storage local, um lote em que **um** item é "estranho" (29 pendentes antigos do banco local) faz o `remove()` em lote falhar inteiro ("The related resource does not exist", igual com a chave legacy) e todos do lote ganham `tentativas+1`. Independe de chaves; vale observar em produção (após 5 tentativas o item é abandonado).
4. **TESTE DESATUALIZADO** corrigido: `pdf-ponta-a-ponta.mjs` não apagava `curriculum_achievements` (migration 519); a conquista sobrevivia ao usuário e a execução seguinte falhava em `classe_iniciar` ("Esta classe já foi concluída"). Agora apaga pelo id determinístico. O mesmo teste ganhou `FUNCOES_BASE` (apontar para outro edge-runtime local) e a prova de **outro clube negado**.
5. Os scripts de bundle (`test:edge:bundle*`) agora montam a pasta `functions` inteira (as funções importam `_compartilhado/chaves.ts`) e incluem `limpar-fotos-rede` e `storage-excluir`.

## 9. PLANO DE PRODUÇÃO (NÃO EXECUTAR sem autorização do dono)

Princípios: uma função por vez; cada etapa tem **observação** e **rollback sem redeploy** (`CHAVES_MODO=legacy`); backup recente; fora do horário de uso; nada de chave no chat/commit/log; só depois de tudo estável o dono desativa as legacy no painel.

**Etapa 0 — preparação (leitura/painel, sem tocar função)**
- Painel > Settings > API Keys: anotar as chaves existentes (nomes, não valores). Criar uma **secret key dedicada** às Edge Functions (ex.: `edge-funcoes`), separada da `default`, para poder revogá-la sozinha. (Secrets de função no Supabase são do **projeto**, não por função: `SB_SECRET_KEY` vale para as 7; granularidade por função exigiria nomes de variável diferentes, que o helper não lê — decisão 10.2.)
- Conferir na documentação/painel os pontos 4–6 e 9 da seção 7.
- Confirmar o canal de deploy (CLI `supabase functions deploy`, que empacota `_compartilhado/`) — ponto 8.

**Etapa A — publicar o código SEM mudar o comportamento**
- Criar o secret `CHAVES_MODO=legacy` (e **não** criar `SB_SECRET_KEY` ainda).
- Publicar uma função de baixo risco (`storage-excluir`, job desligado) e conferir no log do boot `chaves {"servico":"legacy:SUPABASE_SERVICE_ROLE_KEY",…}`. Depois as demais, nesta ordem: `limpar-fotos-rede`, `sanear-imagens`, `admin-comunidade-foto`, `gerar-documento-pdf`, `gerar-documento-pdf-final`, `enviar-push`. Em cada uma, chamar com o segredo/JWT de teste e ver o mesmo resultado de antes.
- Para `limpar-fotos-rede`, publicar com `--no-verify-jwt` (ou declarar no `config.toml`, achado 8.1).

**Etapa B — ligar a chave nova, uma função por vez (mesma ordem, `enviar-push` por último)**
- Criar o secret `SB_SECRET_KEY` (valor da secret dedicada) e `SB_PUBLISHABLE_KEY` (publishable) — pelo painel/CLI, sem passar pelo chat. Trocar `CHAVES_MODO` de `legacy` para `auto`.
- **Observar 24–48 h por função:** log de boot `nova:SB_SECRET_KEY`; `net._http_response` do cron (200); `rede_limpeza_log`, `imagem_saneamento`, `storage_exclusao_fila` andando; `infra_falhas` sem novos `push/edge`; para PDF/foto: geração de um documento e de uma URL assinada de teste; sem 401/403 novos.
- **Rollback imediato:** `CHAVES_MODO=legacy` (segundos, sem deploy).

**Etapa C — provar que ninguém depende da legacy (ainda sem desativar)**
- `CHAVES_MODO=nova` em todas as funções (sem as novas, falham fechadas). Observar 48 h. Se algo falhar, `CHAVES_MODO=auto`.
- Scripts de manutenção: usar uma secret key e `CHAVES_EXIGIR_NOVA=1`.

**Etapa D — desativar as legacy (decisão e ação do dono, no painel)**
- Só depois de A–C e dos pontos 4–5 da seção 7 esclarecidos. Observar: login, Minha Classe, Rede, push de teste, `scripts/janela-fase8/00-pre-leitura.sql`, as 7 funções. Rollback: reativar as legacy (ponto 9) e `CHAVES_MODO=legacy`.

**Fora deste plano:** APK/OTA (já usam a publishable), rotação do **segredo JWT** (logout geral; ver `SEGURANCA-ROTACAO-DE-CHAVES.md`), limpeza dos backups com a chave antiga.

## 10. Decisões do dono

1. Autorizar (ou não) o plano da seção 9 e a janela.
2. Uma secret dedicada para todas as funções (simples) **ou** nomes de variável por função (granularidade de revogação; exigiria ampliar o helper).
3. Declarar `verify_jwt = false` de `limpar-fotos-rede` no `config.toml` (achado 8.1).
4. Menor privilégio no `gerar-documento-pdf-final` (baixar o desenho como usuário), se quiser — muda borda de comportamento.
5. Canal de deploy das funções (CLI com bundle) — o editor do painel pode não suportar o import do helper.
6. Confirmar no painel os pontos 4–5 da seção 7 antes da Etapa D.
