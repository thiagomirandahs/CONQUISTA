# Análise dos app_erros (24 h) e auditoria do logger (02/10/2026)

Produção **somente leitura** (`default_transaction_read_only=on`; só SELECT; nada apagado). Pessoas e clubes aparecem como hash curto de 6 caracteres (md5 do id); nenhum nome, e-mail, texto ou token foi impresso. Correções **locais**: nada publicado, nenhum push, nenhuma migration, nenhum replay SQL.

## 1. Os 4 erros das últimas 24 h

Janela: 01/10 ~11 h UTC até 02/10 10:59 UTC (último id = 33). Front publicado: `6413af0` (commit 01/10 15:40 BRT = 18:40 UTC), com o **logger antigo** (a `030b900` que grava versão no `agente` não está publicada: nenhum registro traz ` v<data>-<sha>`). Por isso a atribuição "antes/depois do deploy" é por horário. Os 4 vieram do logger ANTIGO (só `codigo`, sem mensagem/stack/versão).

| id | quando (UTC) | rota / origem | plataforma | código gravado | contexto | pessoa / clube | repete conhecido? | classificação |
|---|---|---|---|---|---|---|---|---|
| 30 | 01/10 17:47 | /avaliar-classe, `ui` | Android 10, Chrome 154 | Desconhecido | vazio | f048dd / ea9c35 | Sim: ids 24–26 (mesma pessoa, mesmo clube). Último erro **antes** do deploy das 18:40 | **USO NORMAL** (recusa/validação da tela de avaliação; no código local já é `esperado` e não será mais registrado) |
| 31 | 01/10 21:33 | /trilha, `boundary` | Android 10, Chrome 154 | TypeError | "A tela quebrou…" | fa4a2c / ea9c35 | Sim: 6º TypeError de boundary/promessa em 7 dias (ids 5, 6, 20, 21, 22) | **INDETERMINADO** (hipótese principal: chunk de versão velha após o deploy das 18:40, 2 h 53 min depois; `ErroApp` já tenta se recuperar sozinho) |
| 32 | 02/10 09:16 | /bichinho, `boundary` | Android 10, Chrome 154 | TypeError | "A tela quebrou…" | 6d8200 / d98303 | TypeError de boundary, rota nova na lista | **INDETERMINADO** (mesma hipótese; **não** é dado: o bichinho dessa pessoa tem todos os campos válidos nas listas do app) |
| 33 | 02/10 09:27 | /trilha, `ui` | Android 10, **Chrome 138** | Desconhecido | vazio | 435e5d / d98303 | Sim: ids 1–3, 16–19, 23, 29 | **BUG REAL (menor, UX)**: falso erro na tela logo após um registro de jogo bem-sucedido; corrigido localmente |

Notas por erro:

- **#30**: 14:47 BRT, mesma pessoa/clube dos ids 24–26 (30/09), padrão "tentar enviar correção sem comentário" ou recusa do servidor (SQLSTATE P0001 do `RAISE EXCEPTION` vira "Desconhecido" no logger antigo). Nenhuma novidade.
- **#31 e #32**: rotas lazy (`/trilha`, `/bichinho`). Em Chrome, `import()` que falha ("Failed to fetch dynamically imported module", também quando o chunk antigo devolve o `index.html` por causa do rewrite SPA) é um **TypeError**, e o logger antigo só guardava "TypeError". Isso explica por que há TypeError de boundary em rotas sem nenhuma relação (/admin, /inicio, /eu, /rede/publicar, /trilha, /bichinho). Para o #32 especificamente: `Bichinho.jsx` e `bichinhoPecas.js` usam listas-branca (`especieInfo`, `itemSeguro`, `olhosSeguro`, `corSegura`, `cenarioSeguro`, `movelSeguro`) e a linha da pessoa no banco (espécie, item, cor, olhos, cenário, móvel) tem só valores válidos; não achei caminho de dado que gere TypeError. **Não consigo provar** a causa com o que foi gravado; o logger novo (abaixo) entrega nome+mensagem+`arquivo.js:linha:coluna`, o que diferencia `ChunkLoad` de `leitura:undefined.x`. Não houve correção por falta de evidência (não inventar bug).
- **#33 (BUG REAL, e a causa dos "Desconhecido" de /trilha)**: cruzei **todos** os 9 erros `ui` de /trilha (ids 1–3, 16–19, 23, 29, 33) com `trilha_jogos` da mesma pessoa: **9 de 9 ocorreram 0,8 a 7,4 s depois de um registro de jogo bem-sucedido** (arco, basquete x4, caça, basquete, próximo), e os ids 1–3 e 16–19 são rajadas de 3–4 erros no mesmo segundo. Explicação: o jogo chama `onTerminar` mais de uma vez (toques repetidos em "Concluir" enquanto a rede de 4G demora, evento de fim duplicado). O servidor aceita só o primeiro (1 registro por dia por jogo); as cópias voltavam como recusa e `aoTerminar` mostrava `avisar.erro` para a criança, **com o resultado já salvo**. Isto é inferência forte (correlação 9/9 + rajadas + `Concluir` sem trava), não prova do duplo toque, porque o logger antigo não guardava a mensagem.
  - Correção (`src/pages/Trilha.jsx`): trava de reentrada `terminando` (ref) em `aoTerminar`; só uma chamada por partida, liberada em `abrirJogo`. Se o 1º registro falhar de verdade, o erro aparece **uma** vez.
  - Teste de regressão `src/pages/Trilha.terminar.test.jsx` (3 casos: cópias → 1 registro e 0 erro; partida nova volta a registrar; falha real → 1 erro). Os 3 **falham sem a trava** e passam com ela (conferido).
  - Contexto do #33: as duas pessoas do clube d98303 jogam todos os jogos em sequência, juntas, às 09:16–09:31 UTC nos dois dias (sessão de clube); #32 e #33 são dessas duas pessoas, 11 minutos de distância, sem relação de causa entre si.

## 2. O logger novo: o que fazia e o que mudou

Contrato da RPC `registrar_erro` **inalterado** (colunas: `contexto` 200, `codigo` 80, `rota` 120, `agente` 120). **Nenhuma migration** (a 535 não foi necessária e **não existe**): mudar a assinatura da RPC quebraria os testes SQL 48/56/72 e a ordem front-antes-do-banco perderia toda a telemetria; a mensagem, o nome, a causa e o local cabem em `contexto` (200) de forma comprimida.

Antes (`030b900`): a mensagem só virava rótulo de lista fechada ou **hash** (`Erro#a1b2c3`), `cause` e `stack` nunca eram lidos (só o 1º `arquivo:linha:coluna` para `boundary/janela/promessa`), `message` descartada. Seguro, mas cego: o #31 e o #32 são "TypeError" sem mais nada.

Agora (`src/lib/sanitizarErro.js`, novo; `src/lib/observabilidade.js`):

- `descreverErro`: nome (só se for identificador `[\w$.-]{1,40}`), **mensagem**, **até 3 níveis de `cause`** (com detecção de ciclo), **2 frames** do stack (Chrome `at f (url:l:c)` e Firefox/Safari `f@url:l:c`, só nome do arquivo, sem host nem query). Lê tudo com `try` (getter que lança, Proxy hostil, objeto circular). Erro Supabase/PostgREST (objeto): `message`, senão `error_description`/`details`/`hint`/`error`.
- `sanitizarTexto` **mascara por padrão** (não descarta): JWT (`eyJ…`), `Bearer`/`Basic`, `sb_publishable_`/`sb_secret_`/`sbp_`, valor inteiro de `Authorization`/`Cookie`/`Set-Cookie`, pares `nome=valor`/`nome: valor` de campos secretos (token, access/refresh/id_token, apikey, senha/password, secret, cookie, session, signature, `x-amz-*`, credential, code, cpf, telefone, e-mail, nome…), toda **URL** fica só origem+caminho (`?[query]`, sem fragmento, sem `user:senha@`, segmento longo/uuid vira `[segredo]`/`[uuid]`), e-mail, CPF, telefone BR, uuid, sequências opacas (hex 16+, base64url 32+, MAIÚSCULAS 16+). Mensagens que não são do motor JS também escondem valores entre aspas e `=(valor)` do Postgres (só identificador curto em minúsculas passa). Limite de tamanho aplicado **antes** dos regex (mensagem de MB não custa CPU).
- `montarContextoTecnico` (200 caracteres): `frase da tela | Nome: mensagem <- Causa: msg <- Causa2 [a.js:1:2 < b.js:3:4]`. Prioridade quando falta espaço: **local** > nome+mensagem > frase > causas (a causa some primeiro; o local nunca é cortado).
- `codigo`: lógica anterior mantida (SQLSTATE, `PGRST`, HTTP, rótulos, `leitura:undefined.map`, hash só como agrupador). **Achado e correção:** o `name` do erro era truncado a 40 caracteres **sem validação**, então `new Error()` com `name` hostil (ex.: `"Hostil eyJhbGci…"`) vazava o começo de um segredo no `codigo`. Agora só entra se for identificador. `codigoDoErro` também passou a nunca lançar.
- Rota: `sanitizarRota` (sem query/fragmento, `/verificar|documento/:token`, segmento opaco mascarado); o servidor ainda aplica `_sem_segredo` (migrations 77/79) por cima, como segunda camada.
- `ErroApp` (boundary) extraído de `App.jsx` para `src/components/ErroApp.jsx` (comportamento idêntico) para poder ser testado.

### Matriz de captura x sanitização (todos testados)

| Caso | Capturado (name/message/stack/cause/rota) | Sanitização verificada |
|---|---|---|
| `throw new Error()` sem mensagem | nome "Error", rota, correlação | n/a |
| string lançada | texto vira mensagem; `codigo` `Texto#hash` | e-mail mascarado |
| objeto lançado `{message}` / sem nada | mensagem / só a frase da tela | n/a |
| Promise rejection com `Error` (`RangeError`) | nome+mensagem, origem `promessa` | n/a |
| Promise rejection **não-Error** (string, `undefined`, objeto com `code`) | texto / `SemDetalhe` / `P0001` + mensagem | n/a |
| `window.onerror` com objeto e **sem** objeto (`Script error.` + filename) | nome, mensagem, `[arquivo:l:c]` (do stack ou do evento) | query do `filename` removida |
| `TypeError` do motor | `TypeError:leitura:undefined.map`, `naofuncao:x.foo` | aspas só em erros não-motor |
| erro de `fetch` (`Failed to fetch`) | `TypeError:RedeIndisponivel` + mensagem | n/a |
| erro Supabase/PostgREST (code/message/details/hint) | `23505` + mensagem | `Key (email)=(…)`, aspas e e-mail mascarados |
| erro no `ErrorBoundary` | origem `boundary`, rota, nome, mensagem, local | token e JWT na mensagem mascarados |
| `cause` em 3 camadas / `cause` circular / objeto circular | `topo <- meio <- raiz`; ciclo marcado, sem travar | n/a |
| mensagem de 60 mil caracteres | `contexto` <= 200, `codigo` <= 80, `agente` <= 120, `rota` <= 120, **local preservado** | rápido (<500 ms em 1,6 MB) |
| segredos na mensagem/stack/cause/contexto da tela/URL/rota | idem | JWT, Bearer, `sb_publishable_`, `sb_secret_`, `?token=`, `?apikey=`, `#access_token=`, URL assinada, Cookie/Set-Cookie, senha, e-mail, telefone, CPF, uuid, token de documento na rota: **todos mascarados** |
| `name` hostil com segredo | descartado | `codigo` sem segredo (era vazamento) |
| getter que lança / Proxy hostil | não lança | n/a |

## 3. Limites honestos

- **Stack completo e `cause` longo não cabem** em 200 caracteres: ficam 2 frames e até ~60 caracteres de causas. Se o dono quiser stack inteiro, precisa de **colunas novas + RPC nova** (migration 535 + ajuste dos testes 48/56/72) e de tratar a ordem de publicação (front antes do banco = telemetria perdida em silêncio). Não foi feito.
- **Nome de pessoa em texto livre** não é detectável por padrão. Mitigações: aspas/`=(…)` mascaradas, 200 caracteres no máximo, `_sem_segredo` no servidor, leitura só da plataforma, `expurgar_app_erros`. Mensagens `RAISE EXCEPTION` do projeto são estruturais (levantamento por amostragem no `grep` das migrations; nenhuma interpola nome), mas `raise exception '%', v_motivo` (8 ocorrências) repassa texto e deve ser conferido caso a caso.
- A **`ui`** agora também envia mensagem sanitizada (antes só a frase da tela). É a maior mudança de política; está nos testes.

## 4. Arquivos

`src/lib/sanitizarErro.js` (novo), `src/lib/observabilidade.js`, `src/components/ErroApp.jsx` (novo, extraído), `src/App.jsx`, `src/pages/Trilha.jsx`; testes: `src/lib/sanitizarErro.test.js` (31), `src/lib/observabilidade.captura.test.js` (17), `src/pages/Trilha.terminar.test.jsx` (3); `observabilidade.test.js` existente (12) segue verde.

Vitest completo: 2183 passando; as mesmas 4 suítes que já falhavam por dependência ausente no `node_modules` (`atualizacaoOta`, `qr`, `DocumentoClasse`, `urlPublica`) continuam falhando por isso, não por esta mudança. ESLint: 0 erros nos arquivos tocados (2 avisos antigos em `Trilha.jsx`).
