# Pré-janela de chaves — matriz das 7 Edge Functions, prova da fechadura do `limpar-fotos-rede` e desativação da legacy

01/10/2026 · branch `worktree-agent-a48df1fcdfb34cc55` · **nada em produção foi alterado** (só leituras de metadados na Management API, sem `reveal`, sem imprimir valor; nenhuma função publicada, nenhum secret/chave/migration tocado; legacy continua ativa).
Procedimento executável: `CHAVES-ROLLBACK-PROCEDIMENTO.md`. Auditoria de base: `EDGE-FUNCTIONS-CHAVES-AUDITORIA.md`, `SCRIPTS-CHAVES-MATRIZ.md`.

## 1. Desenho decidido pelo dono

**Uma** secret key de infraestrutura do Supabase, compartilhada pelas funções que precisam de privilégio administrativo. **Segredos funcionais** (`x-push-webhook-secret`, `x-saneamento-secret`, `x-storage-excluir-secret`, `x-rede-limpeza-secret`) seguem como autorização de cada operação. *Secret key = acesso privilegiado ao Supabase; segredo funcional = autorização para invocar a operação.* Os dois não se misturam (provado: `Authorization` com secret/publishable/JWT legacy **não** autoriza `limpar-fotos-rede`; seção 3).
Para a chave dedicada, o helper ganhou `SB_SECRET_NOME` (escolhe, por **nome**, uma secret do dicionário `SUPABASE_SECRET_KEYS` injetado; o valor nunca sai da plataforma; nome ausente = não cai em outra chave).

## 2. Matriz final

Legenda: **SK** = chave de serviço (secret); **PK** = publishable; helper = `supabase/functions/_compartilhado/chaves.ts`. "Origem em produção hoje" = o que o helper escolheria no modo `auto` **hoje**, porque a plataforma já injeta `SUPABASE_SECRET_KEYS`/`SUPABASE_PUBLISHABLE_KEYS` (visto na lista de nomes de secrets do projeto, 01/10).

| FUNÇÃO | verify_jwt (config.toml = produção*) | Chave Supabase necessária | PK necessária? | SK necessária? (por quê / menor privilégio) | Legacy hoje? | Segredo funcional | Origem escolhida pelo helper (auto) | Fallback existente | Teste com chave nova | Teste sem legacy | Rollback possível |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `enviar-push` | `false` | SK | não | **Sim.** Chamada pelo banco (pg_net, sem usuário); lê inscrições de todo o clube e roda `push_reservar/concluir` (só `service_role`), apaga inscrição expirada, grava `infra_falhas`. **Nenhuma** alternativa de usuário/publishable (provado: usuário comum não executa essas RPCs) | Sim (código publicado antigo lê `SUPABASE_SERVICE_ROLE_KEY`; presumido, não li o código hospedado) | `PUSH_WEBHOOK_SECRET` (`x-push-webhook-secret`) | serviço: `nova:SUPABASE_SECRET_KEYS` (ou `[nome]` com `SB_SECRET_NOME`) | legacy `SUPABASE_SERVICE_ROLE_KEY`; `CHAVES_MODO=legacy` | E2E 26/26 (**parcial**: sem entrega real a navegador/FCM) | sim (perfis plataforma/sb) | `CHAVES_MODO=legacy` ou redeploy da versão antiga |
| `sanear-imagens` | `false` | SK | não | **Sim.** Baixa e **regrava** (upsert) arquivo de qualquer pessoa em qualquer bucket de imagem + RPCs de fila só-serviço. Usuário comum não consegue (provado) | Sim | `SANEAMENTO_SECRET` (`x-saneamento-secret`) | serviço: `nova:SUPABASE_SECRET_KEYS` | idem | E2E 14/14 + sub-E2E 45 | sim | idem |
| `storage-excluir` | `false` | SK | não | **Sim.** `Storage.remove` + RPCs `_storage_exclusao_*`; job desligado; apaga só o que o banco devolver após carência | Sim | `STORAGE_EXCLUIR_SECRET` (`x-storage-excluir-secret`) | serviço: `nova:SUPABASE_SECRET_KEYS` | idem | E2E 13/13 + sub-E2E 34 | sim | idem |
| `limpar-fotos-rede` | `false` (declarado agora no config.toml; produção já `false`) | SK | não | **Sim.** O Supabase não apaga arquivo por SQL; só a API do Storage com privilégio de serviço (`remove` em lote) + RPC `rede_fotos_pendentes/confirmar` (só-serviço) | Sim | `REDE_LIMPEZA_SECRET` (`x-rede-limpeza-secret`) | serviço: `nova:SUPABASE_SECRET_KEYS` | idem | E2E 47/47 (inclui a fechadura, seção 3) | sim | idem |
| `gerar-documento-pdf` | `true` | PK + SK | **Sim** — só para o cliente "como o usuário" (JWT dele no `Authorization`): RPCs `documento_pdf_dados/registrar` decididas pelo banco | **Sim, só o upload** em `documentos-emitidos` (bucket sem policy de INSERT para `authenticated` de propósito, migration 88). As RPCs **já** são como usuário (menor privilégio satisfeito) | Sim (anon + service_role) | nenhum (autorização = JWT do usuário + RPC) | PK: `nova:SUPABASE_PUBLISHABLE_KEYS`; SK: `nova:SUPABASE_SECRET_KEYS` | legacy anon/service_role | E2E 12/12 + E2E PDF 44 | sim | idem |
| `gerar-documento-pdf-final` | `true` | PK + SK | **Sim** (idem) | **Sim:** upload do H2 e **download** do PNG da assinatura desenhada. *O download poderia usar o JWT do usuário (privilégio menor); NÃO feito: muda comportamento de borda (decisão do dono)* | Sim | nenhum | idem | idem | E2E 12/12 + E2E PDF | sim | idem |
| `admin-comunidade-foto` | `true` | PK + SK | **Sim** (cliente do usuário chama `admin_comunidade_foto_assinar`; o Postgres decide e grava 1 linha de log) | **Sim, só para assinar a URL (60 s)** do bucket `comunidade`; o admin não tem leitura direta (migration 530) | Sim | nenhum | idem | idem | E2E 29/29 | sim | idem |

\* `verify_jwt` de produção conferido por leitura (`GET /functions`, só metadados): gatilhos (`enviar-push`, `sanear-imagens`, `storage-excluir`, `limpar-fotos-rede`) `false`; PDF x2 e `admin-comunidade-foto` `true` — igual ao `config.toml`. Versões hospedadas hoje: enviar-push v19, sanear-imagens v4, storage-excluir v1, limpar-fotos-rede v6, admin-comunidade-foto v4, PDF x2 v11 (todas `ACTIVE`).

**Menor privilégio — conclusão:** nenhuma das 7 consegue trabalhar só com publishable/JWT do usuário; todas têm ao menos uma operação que só a secret faz. As 3 funções com `verify_jwt=true` já usam o **JWT do usuário + publishable** para tudo que o banco pode decidir, e a secret só para Storage. A única redução possível (download do desenho como usuário em `gerar-documento-pdf-final`) fica como decisão do dono.

**Estado em produção observado (metadados, sem valores):** legacy `enabled: true`; chaves: `anon`/`service_role` (legacy), 1 publishable `default`, 1 secret `default` (criadas em 28/06). Secrets de função existentes (nomes): `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_JWKS`, `VAPID_*`, `FCM_SERVICE_ACCOUNT`, `PUSH_WEBHOOK_SECRET`, `SANEAMENTO_SECRET`, `STORAGE_EXCLUIR_SECRET`, `REDE_LIMPEZA_SECRET`, `APP_URL_VERIFICACAO`. **Não existem** `CHAVES_MODO`, `SB_SECRET_KEY`, `SB_PUBLISHABLE_KEY`, `SB_SECRET_NOME` (⇒ publicar o helper sem antes criar `CHAVES_MODO=legacy` já trocaria para a chave nova no ato). Os chamadores do banco (`pg_net`) enviam **só** o segredo funcional (nenhuma migration manda `Authorization`/`apikey`), então não dependem da legacy.

## 3. `limpar-fotos-rede` — prova local da fechadura

Código (`supabase/functions/limpar-fotos-rede/index.ts`): `verify_jwt = false` em `config.toml` (`[functions.limpar-fotos-rede]`, 414). O handler faz: método ≠ POST → 405; depois `igualSeguro(req.headers.get('x-rede-limpeza-secret') ?? '', SEGREDO)` → 401; **só depois** o primeiro uso de `sb.rpc`/`sb.storage`. O JWT do `Authorization` **nunca é lido**. `SEGREDO` vem de `REDE_LIMPEZA_SECRET` com padrão `''`, e `igualSeguro` devolve `false` se `b` é vazio (falha fechada: função sem segredo configurado nunca autoriza).

Provas (todas locais, E2E `npm run test:edge:chaves-novas` — função rodando no edge-runtime **sem** `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`; o perfil novo `contador` aponta `SUPABASE_URL` para um servidor do harness que **só conta** requisições):

| Caso | Resultado |
|---|---|
| boot da função (createClient + chaves) | **0** requisições ao "Supabase" |
| sem `x-rede-limpeza-secret` | 401 |
| header vazio / segredo incorreto / com 1 caractere a menos / a mais | 401 |
| segredo de **outra** função no header certo | 401 |
| só `Authorization: Bearer` com **JWT legacy service_role** / **JWT legacy anon** | 401 |
| só `Authorization: Bearer <secret nova>` + `apikey`; idem `<publishable>` | 401 |
| JWT legacy no `Authorization` + segredo errado; só os outros 3 segredos funcionais | 401 |
| `GET` com segredo certo | 405 |
| **Total de requisições ao PostgREST/Storage/Auth durante as 12 tentativas negadas + GET** | **0** |
| segredo **correto** | passa da fechadura (não 401); a 1ª requisição é `POST /rest/v1/rpc/rede_fotos_pendentes`; nenhuma chamada `/storage/` antes |
| (bateria completa já existente, perfil `plataforma`) | segredo certo remove arquivo, confirma no banco, idempotente; usuário comum/anon não executa as RPCs |

Comparação em tempo constante (`src/lib/igualSeguroEdge.test.js`, vale também para `enviar-push`, `sanear-imagens`, `storage-excluir`): digest SHA-256 dos **dois** lados (tamanho fixo de 32 bytes, então nem o tamanho vaza), XOR acumulado sem `return`/`break` no laço, nenhuma comparação direta `a === b`, a única saída antecipada é "segredo do servidor vazio"; teste funcional (igual/1 char/prefixo/tamanho/vazio/5000 chars) e **espião de `crypto.subtle.digest`** confirmando exatamente 2 digests para qualquer entrada. Ordem handler (método → segredo → 401 → primeiro acesso) travada por teste de contrato. *Limite honesto: é prova por construção e por contagem de trabalho, não medição de tempo de relógio.*

## 4. Desativação das chaves legacy

### 4.1 DOCUMENTADO OFICIALMENTE
- Criar publishable/secret não afeta as legacy; elas "stay valid until you disable them" em Settings → API Keys; **a desativação é reversível** ("you can re-activate them"). <https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys> · <https://supabase.com/docs/guides/api/api-keys>
- Legacy `anon`/`service_role` serão **depreciadas até o fim de 2026**. (mesmas páginas)
- Variáveis padrão nas Edge Functions: `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS` (**dicionários JSON** por nome, ex. `["default"]`), `SUPABASE_JWKS`; as legadas `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` "ainda existem" e **carregam as chaves depreciadas**. <https://supabase.com/docs/guides/functions/secrets>
- **Múltiplas secret keys:** sim; recomenda-se uma por componente de backend (revogar sem afetar as outras). **Valor completo da secret pode ser lido de novo** pela Management API com `reveal=true`. <https://supabase.com/docs/guides/api/api-keys>
- Chaves novas **não são JWT**: enviar na `apikey`, não em `Authorization: Bearer` (senão "Invalid JWT"). O `verify_jwt` da plataforma valida o `Authorization` (aceita JWT de usuário HS256 e ES256 e, por compatibilidade, as chaves `sb_` no `Authorization`), mas **não autentica quem manda só uma API key** — a doc manda `verify_jwt=false` + autorização no código para função chamada com chave. <https://supabase.com/docs/guides/functions/auth-headers> · migrating-to-new-api-keys
- **JWT dos usuários:** "the migration doesn't affect user sessions" (o usuário segue com o JWT do Auth). Desativar `anon`/`service_role` afeta **acesso por API key**, não os tokens de usuário; o segredo JWT legado é outra coisa (revogar separadamente; reversível: "move a revoked key to standby"); tokens não expirados continuam aceitos ao migrar para chave assimétrica. Publishable/secret "não são mais baseadas na chave de assinatura JWT". <https://supabase.com/docs/guides/auth/signing-keys>
- Com a rotação para chaves assimétricas, a opção "Verify JWT" de funções pode quebrar; alternativa: `getClaims()`/JWKS. (signing-keys)

### 4.2 PROVADO LOCALMENTE
- As 7 funções operam com o ambiente **sem** `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` (conferido por `printenv`), só com `SUPABASE_SECRET_KEYS`/`SUPABASE_PUBLISHABLE_KEYS` do main service (formato `{"default":"sb_…"}`), ou só com `SB_*`; `CHAVES_MODO=nova` + só legacy falha fechada (5xx sem vazar); perfil `legacy` (= produção hoje) continua funcionando; nenhum log/resposta contém valor de chave.
- O Supabase local aceita `sb_*` **só no header `apikey`** (Authorization sozinho → 400); Storage/Auth admin/RPC só-service funcionam com a secret, e a publishable não enxerga buckets privados.
- Fechadura do `limpar-fotos-rede` (seção 3) e `verify_jwt` das funções com JWT de usuário (admin-comunidade-foto: sem/adulterado → 401).
- **Limite:** o local usa Kong + main service do CLI, não o gateway hospedado.

### 4.3 NÃO DETERMINADO
1. **O que acontece com `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` nas funções ao desativar a legacy** (deixam de ser injetadas? ficam com valor inválido?). A doc só diz que "carregam chaves depreciadas". **Há relato aberto na comunidade** (supabase/supabase#37648, sem resposta oficial na página): depois de desativar, `SUPABASE_ANON_KEY` continuou com o JWT legado e as chamadas deram "Legacy API keys are disabled". ⇒ tratar como **"ficam presentes, mas inválidas"**; é exatamente o caso que o helper cobre (prefere a nova; `CHAVES_MODO=nova` ignora a legacy). Não observado no nosso projeto.
2. **Formato real de `SUPABASE_SECRET_KEYS` no hospedado** (doc: dicionário por nome; o runtime local confirma `{"default":…}`). Que **uma secret criada depois** apareça no dicionário e **quando** (próximo cold start? imediatamente?): não documentado; verificar no log de boot (`SB_SECRET_NOME`).
3. Como a plataforma **escolhe a "ativa"**: não há conceito de "ativa" documentado; todas as secrets válidas valem simultaneamente; quem escolhe é o nosso helper (`default`, ou `SB_SECRET_NOME`, ou `SB_SECRET_KEY`).
4. **Recuperação do valor completo da secret:** doc diz que sim via `reveal=true`. **Observado no projeto:** `GET /api-keys` (com e sem `?reveal=true`) devolveu a secret **sem máscara** (41 caracteres, prefixo `sb_secret_`) para o nosso token — ou seja, para quem tem o token de gerenciamento o valor é recuperável; **o token é, portanto, tão sensível quanto a própria secret**.
5. **Reativar a legacy:** doc diz que é reversível; **não confirmado por chamada** (nenhum endpoint de escrita foi usado). Só se sabe que `GET /api-keys/legacy` retorna `{"enabled":true}` (existe estado habilitado/desabilitado; o endpoint de alteração não foi tocado). Para o rollback, tratar a reativação como **"deve funcionar, confirmar no painel antes da janela"**.
6. **Efeito no gateway/`verify_jwt` das 3 funções com `verify_jwt=true`:** a doc afirma que JWT de usuário (HS256 e ES256) segue aceito e que o app não é afetado, mas **não foi provado no hospedado** com a legacy desligada. Risco específico: quem chama essas funções com **JWT de usuário** (nosso front) deve seguir bem; quem as chamasse só com `apikey` legacy não é nosso caso. O `pg_net` das 4 funções de gatilho usa só segredo funcional (`verify_jwt=false`).
7. **PostgREST/Auth/Storage hospedados com legacy desativada:** a doc só cita Realtime público (24 h) como mudança; o resto "inalterado". Não provado aqui. O front/APK usam a publishable; o `service_role` não está no cliente (SEGURANCA-SERVICE-ROLE-INVESTIGACAO.md).
8. Nome da tabela de logs de função na API de logs de gerenciamento (`function_logs` retornou "Table does not exist" na consulta); usar o painel para o log de boot.

## 5. Mudanças de código/teste desta rodada
- `supabase/tests/e2e/edge-chaves-novas.mjs`: perfil `contador` + 18 checagens da fechadura do `limpar-fotos-rede`; comentário obsoleto sobre `config.toml` corrigido.
- `supabase/tests/_trava-docker-local.sh` (+ teste `e2e/trava-docker-local-teste.sh`): trava contra rodar **replay SQL** e **E2E de chaves** ao mesmo tempo (exit 4); documentado nos cabeçalhos de `run-tests.sh` e `edge-chaves-novas.sh`. Dois replays entre si continuam permitidos (`REPLAY_DB` próprio).
- `src/lib/igualSeguroEdge.test.js` (novo, 14 testes) e 5 testes novos em `chavesEdge.test.js` (`SB_SECRET_NOME`).
- `supabase/functions/_compartilhado/chaves.ts`: `SB_SECRET_NOME` (seletor por nome; nenhum comportamento muda se a variável não existir).
