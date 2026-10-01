# Chaves das Edge Functions — procedimento executável com ROLLBACK (A–E)

Pré-janela · 01/10/2026 · **documento de procedimento; NADA aqui foi executado em produção.** Complementa `EDGE-FUNCTIONS-CHAVES-AUDITORIA.md` (seção 9) e `PRE-JANELA-CHAVES-EDGE-MATRIZ.md` (matriz, provas e o que é/não é documentado).

## 0. Desenho (decisão do dono) e regras

- **UMA secret key de infraestrutura** do Supabase, compartilhada pelas funções que precisam de privilégio administrativo (as 7 precisam; ver matriz). Ela dá *acesso privilegiado ao Supabase* (Storage admin, RPC só-serviço).
- Os **segredos funcionais** (`PUSH_WEBHOOK_SECRET`, `SANEAMENTO_SECRET`, `STORAGE_EXCLUIR_SECRET`, `REDE_LIMPEZA_SECRET`) continuam sendo a *autorização para invocar a operação*. **Não se misturam**: nenhuma função aceita a secret key como "senha" de invocação, e nenhum segredo funcional vale como chave do Supabase.
- Valores nunca no chat, em commit, em log ou em linha de comando visível. Secrets de função se configuram **no painel** (Edge Functions → Secrets) ou por `supabase secrets set NOME --env-file <arquivo temporário apagado depois>`; nunca `NOME=valor` na linha de comando.
- Legacy `service_role`/`anon` **permanecem ativas** durante A–C. Só a etapa D as considera, e só com a prova completa.
- Produção hoje (leitura de metadados feita em 01/10): legacy habilitada; 1 publishable `default` e 1 secret `default`; a plataforma já injeta `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_JWKS` e (legados) `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`; `CHAVES_MODO`, `SB_*` **não existem** ainda.

### Atenção ao primeiro deploy (por que a etapa A existe)
O helper (`_compartilhado/chaves.ts`), no modo padrão `auto`, prefere a chave nova. Como a plataforma **já injeta** `SUPABASE_SECRET_KEYS`, uma função publicada com o helper passaria a usar a chave nova **no mesmo instante do deploy**. Para publicar o código **sem mudar o comportamento**, o secret `CHAVES_MODO=legacy` precisa existir **antes** do deploy.

### Escolha da secret key ativa
O helper escolhe, para a chave de serviço: (1) `SB_SECRET_KEY` (valor colado por nós) → (2) `SUPABASE_SECRET_KEYS` (dicionário injetado: usa a chave de nome `default`, **ou a de nome indicado em `SB_SECRET_NOME`**) → (3) legacy. Duas formas de ter "a chave de infraestrutura":
1. **Mais simples e sem manusear valor:** criar no painel (Settings → API Keys) uma secret key chamada, p.ex., `infra-edge`; ela aparece sozinha no dicionário `SUPABASE_SECRET_KEYS`; configurar o secret `SB_SECRET_NOME=infra-edge`. O valor nunca sai da plataforma. Revogar = apagar/desativar essa chave no painel (as outras ficam intactas). Se o nome não existir no dicionário, o helper **não cai na `default`** por engano: segue para a legacy (modo `auto`) ou falha fechada (modo `nova`).
2. Usar a própria `default` (nada a configurar). Menos isolamento: revogá-la derruba também scripts/integrações que a usem.
Recomendação: forma 1.

## Critérios de ABORTO (valem para qualquer etapa)
Abortar e ir direto ao rollback (E) se, em qualquer observação:
- aparecer **401/403/500 novos** nas funções (log da função, `net._http_response` do cron, resposta do teste);
- o log de boot **não** mostrar a origem esperada (ver B);
- `infra_falhas` ganhar linhas novas de `push/edge`, ou `rede_limpeza_log`/`imagem_saneamento`/`storage_exclusao_fila` **pararem de andar** ou ganharem erro;
- login, Minha Classe, Rede ou geração de documento falharem para um usuário de teste;
- qualquer log/resposta contiver algo que pareça valor de chave (`sb_secret_…`, `eyJ…`): parar, tratar como vazamento (rotacionar a chave exposta).
Nunca testar o rollback **desativando a legacy em produção**.

## Ordem de publicação sugerida (menor para maior risco)
1. `storage-excluir` (job desligado)  2. `limpar-fotos-rede`  3. `sanear-imagens`  4. `admin-comunidade-foto`  5. `gerar-documento-pdf`  6. `gerar-documento-pdf-final`  7. **`enviar-push` por último** (se parar, os avisos param; o `pg_net` só enxerga 500).
Uma função por vez; só passa para a próxima depois da observação da etapa. Fora do horário de uso; backup recente; canal de deploy = CLI (`supabase functions deploy <nome>`, que empacota `_compartilhado/` — provado por `test:edge:bundle*`); o editor do painel pode não resolver o `import` do helper.
**`verify_jwt`:** o `config.toml` já declara os 7 e o CLI o respeita. Produção está igual ao `config.toml` (conferido por leitura: gatilhos `false`; PDF x2 e `admin-comunidade-foto` `true`). Para `limpar-fotos-rede` o `config.toml` agora declara `false`, então **não** precisa `--no-verify-jwt` manual — mas confira o flag na lista de funções depois do deploy.

---

## A) Publicar funções compatíveis com chave nova **mantendo a legacy em uso**

1. Backup recente do banco confirmado (não é alterado por esta janela, mas é a regra).
2. Painel → Edge Functions → Secrets: criar **`CHAVES_MODO` = `legacy`**. (Não criar `SB_SECRET_KEY`, `SB_SECRET_NOME` nem `SB_PUBLISHABLE_KEY` ainda.)
3. `supabase functions deploy storage-excluir` (e, uma de cada vez, `limpar-fotos-rede`, `sanear-imagens`, `admin-comunidade-foto`, `gerar-documento-pdf`, `gerar-documento-pdf-final`). **`enviar-push` NÃO entra agora** (fica na versão antiga até o fim; ver B).
4. Sem mudar mais nada: o comportamento deve ser **idêntico ao de antes** (mesmas respostas, mesmo segredo funcional). Em cada função, log de boot (B) e checagens (C).

## B) Provar que a função escolhe a chave certa (sem expor valor)

Cada função grava no boot **uma linha** `chaves {"servico":"<origem>:<NOME_DA_VARIÁVEL>","publica":…,"modo":"<modo>"}` — origem e **nome** da variável, nunca o valor (garantido por teste: `chavesEdge.test.js` e a varredura de vazamento do E2E).
- **Onde ler (hospedado):** Painel → Edge Functions → *\<função\>* → **Logs** (procure `chaves {`). A linha sai na **inicialização do worker** (cold start); um deploy já provoca um. Se não aparecer, aguarde/chame a função uma vez (com o segredo funcional de teste) e releia.
- Esperado na etapa A: `{"servico":"legacy:SUPABASE_SERVICE_ROLE_KEY",…,"modo":"legacy"}` (+ `"publica":"legacy:SUPABASE_ANON_KEY"` nas 3 funções que usam cliente "como o usuário").
- Esperado na etapa B-ligar (abaixo): `{"servico":"nova:SUPABASE_SECRET_KEYS[infra-edge]",…,"modo":"auto"}` (ou `nova:SUPABASE_SECRET_KEYS` se usar a `default`) e `"publica":"nova:SUPABASE_PUBLISHABLE_KEYS"`.
- Não há endpoint de diagnóstico (decisão: superfície zero). O log de boot é suficiente e é o que o E2E local já valida (`== 6) de onde veio cada chave`).
- A API de logs de gerenciamento (`GET /v1/projects/{ref}/analytics/endpoints/logs`) respondeu 200 mas **o nome da tabela de logs de função não foi confirmado** (`function_logs`/`function_edge_logs` → "Table does not exist" na consulta feita): usar o painel.

### Ligar a chave nova (por função, ainda sem tirar a legacy)
1. Painel → API Keys: criar a secret `infra-edge` (uma vez só, serve às 7). Ela aparece no dicionário `SUPABASE_SECRET_KEYS` das funções **no próximo início de worker** (não determinado se é imediato; conferir no log de boot).
2. Secrets de função: `SB_SECRET_NOME` = `infra-edge` (uma vez, vale ao projeto todo). Com `CHAVES_MODO=legacy` ainda valendo, nada muda. (`SB_SECRET_NOME` é implementado em `chaves.ts`, provado por teste de unidade; **ainda não** exercitado num dicionário com 2 secrets no E2E/hospedado.)
3. **Secrets de função são do PROJETO, não de uma função**: trocar `CHAVES_MODO` vale para todas as funções que já usam o helper. Por isso o escalonamento é feito pela **ordem de deploy**, não pelo secret:
   - as 6 primeiras funções são publicadas (etapa A) em `legacy` e provadas em `legacy` (C);
   - **`enviar-push` continua na versão ANTIGA (sem helper)** até o fim — a virada de `CHAVES_MODO` não a atinge;
   - virada: `CHAVES_MODO` = `auto` (as 6 passam a usar a nova ao reiniciar o worker; forçar chamando cada uma). Ler o log de boot de **cada uma** (B) e repetir C. Observar 24–48 h;
   - só então publicar o `enviar-push` novo (já com `CHAVES_MODO=auto` valendo: ela nasce usando a chave nova). Observar; rollback = `CHAVES_MODO=legacy` + reinício, ou redeploy da versão antiga.
   - Isolar UMA função na virada exigiria um nome de variável por função (ampliar o helper): não feito, porque o dono escolheu **uma chave compartilhada**.

## C) Testar cada função (comandos/checagens concretos; push sem enviar a usuário real)

Faça cada checagem **primeiro em `legacy` (etapa A) e repita depois da virada**. Os segredos funcionais ficam num arquivo local temporário (`export` lido do arquivo), nunca no terminal/chat. Respostas esperadas:

| Função | Checagem | Esperado |
|---|---|---|
| `storage-excluir` | `POST` sem `x-storage-excluir-secret` | 401 |
| | `POST` com o segredo certo (fila vazia/desligada) | 200 `{"ok":…}`, nada apagado; `storage_exclusao_fila` sem erro novo |
| `limpar-fotos-rede` | `POST` sem/errado `x-rede-limpeza-secret`; só `Authorization` com JWT | 401 (e nada tocado) |
| | `POST` com segredo certo | 200 `{"ok":true,"pendentes":N,…,"erros":0}`; `rede_limpeza_log` ganha linha `origem='edge'` |
| `sanear-imagens` | idem gatilho | 401 sem segredo; 200 com `reservados` numérico; `imagem_saneamento` andando |
| `admin-comunidade-foto` | `POST` sem `Authorization` | 401 |
| | com JWT de admin da plataforma + post em análise de teste | 200 `{url}` que abre os bytes; **exatamente 1** linha nova em `plataforma_acesso_log` |
| | com JWT de usuário comum | 403 |
| `gerar-documento-pdf` | com JWT de um usuário de teste e token de documento de teste | 200 e PDF; token inexistente → 403 (vindo da RPC, não 401/400 de chave) |
| `gerar-documento-pdf-final` | idem com assinatura já registrada | 200; segunda chamada idempotente |
| `enviar-push` | `POST` sem `x-push-webhook-secret` | 401 |
| | `POST` com o segredo e `record` apontando **para um clube/usuário de TESTE sem inscrição** (ou `para` inexistente) | 200 com 0 entregues; **não** usar `para:'todos'` de clube real; conferir `push_eventos` concluído e `infra_falhas` sem linha nova |

Observação por função 24–48 h: `net._http_response` do cron em 200; sem 401/403 novos; filas andando.

## D) Só depois, considerar a legacy

Pré-condições (todas): A–C verdes por 48 h com `CHAVES_MODO=nova` (nada depende da legacy; sem as novas a função falha fechada); scripts de manutenção com `CHAVES_EXIGIR_NOVA=1`; revisão do que **não é função** e ainda usa legacy (front/APK usam publishable — ver auditoria; integrações externas). Ver os pontos NÃO DETERMINADOS na matriz: sobretudo o estado de `SUPABASE_ANON_KEY`/`SERVICE_ROLE_KEY` nas funções depois de desativar (há relato aberto de que continuam com o valor legacy e geram "Legacy API keys are disabled").
Ação do dono, no painel (Settings → API Keys → desativar legacy). A documentação oficial diz que a desativação é **reversível** (reativar no mesmo lugar). Observar na hora: login, Minha Classe, Rede, as 7 funções, `00-pre-leitura.sql`. Rollback imediato: **reativar a legacy no painel** + (E).

## E) ROLLBACK em regressão — sem tocar em banco nem no front

Princípio: as funções e o helper já estão publicados; o rollback é **só configuração de secrets** (segundos; sem deploy de código, sem migration, sem mudança no front/APK).

**Caso 1 — regressão depois de ligar a chave nova, legacy ainda ativa (o caso normal):**
1. Painel → Secrets: `CHAVES_MODO` = **`legacy`**. (Se não existir mais, criar.) Este é o **único** passo obrigatório.
2. Não é preciso apagar `SB_SECRET_NOME`/`SB_SECRET_KEY`: em modo `legacy` o helper as **ignora**.
3. Aplicar: secrets novos valem para workers **novos**; para não esperar, forçar o reinício chamando cada função uma vez (ou `supabase functions deploy <função>` da versão atual), `enviar-push` **primeiro** neste sentido (a mais crítica volta antes) e o resto em seguida.
4. **Confirmar:** log de boot de cada função com `"modo":"legacy"` e `"servico":"legacy:SUPABASE_SERVICE_ROLE_KEY"`; repetir as checagens da tabela C; observar `net._http_response` em 200.
5. Se o **código** novo da função for o problema (e não a chave): `supabase functions deploy` da versão anterior do commit (histórico git; a versão antiga lê só as variáveis legacy) — também sem banco/front.

**Caso 2 — a legacy já foi desativada no painel:** primeiro **reativar a legacy** (Settings → API Keys; documentado como reversível), depois o Caso 1. Sem reativar, `CHAVES_MODO=legacy` não adianta: as variáveis `SUPABASE_*_KEY` legadas deixam de ser aceitas. Alternativa que não depende da legacy: `CHAVES_MODO=auto` + `SB_SECRET_NOME` apontando para uma chave nova válida (ou apagar `SB_SECRET_NOME` para usar a `default`).
- Se o painel **não** deixar reativar: usar a alternativa acima e abrir chamado; os segredos funcionais e o banco não são afetados.

**Caso 3 — chave nova exposta/ruim:** criar outra secret key, apontar `SB_SECRET_NOME` para ela e desativar a antiga (a `default` e a legacy ficam como estão).

**Não é rollback:** rotacionar o segredo JWT (desloga todos) — fora deste plano.

## Resumo de uma linha por etapa
A `CHAVES_MODO=legacy` + deploy · B log de boot mostra a origem (`legacy:` → `nova:`) · C tabela de checagens (push sem usuário real) · D só com prova de 48 h e legacy reativável · E `CHAVES_MODO=legacy` (e reativar a legacy se já desligada).
