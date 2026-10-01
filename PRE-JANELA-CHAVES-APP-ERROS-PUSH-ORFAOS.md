# Pré-janela (01/10/2026): app_erros, push 404/410 e os 3 órfãos

Investigação **somente leitura** em produção (`default_transaction_read_only=on`; nenhuma escrita, nenhuma chamada a Edge Function, nenhum push, nenhum download de objeto). Pessoas aparecem só como hash curto; nenhum caminho completo, nome, e-mail ou texto privado foi impresso. Correções **locais**, nada aplicado, publicado ou enviado.

Gates locais: vitest 2113 passando; as 4 suítes que falham (`atualizacaoOta`, `qr`, `DocumentoClasse`, `urlPublica`) falham por dependência ausente no `node_modules` deste worktree (`@capgo/capacitor-updater`, `qrcode-generator`), não por esta mudança. **Replay SQL NÃO foi rodado** (ver "Pendências para o agente principal").

---

## A) app_erros (8 registros das últimas 24 h)

### Linha do tempo (UTC; BRT = UTC−3). Publicação do 6413af0: commit às 15:40 BRT (18:40 UTC)

| id | quando (UTC) | origem / código | rota | plataforma | contexto | pertence a |
|---|---|---|---|---|---|---|
| 24, 25, 26 | 30/09 23:47–23:50 | ui / Desconhecido | /avaliar-classe | Android 10, Chrome 154 (mesma pessoa, mesmo clube) | vazio | front anterior |
| 27, 28 | 01/10 00:32–00:33 | ui / Desconhecido | /admin (Desafios da Rede) | WebView Android 16 (APK) | "Não consegui salvar o desafio." | front anterior (APK/OTA) |
| 29 | 01/10 09:08 | ui / Desconhecido | /trilha | Android 10, Chrome 154 | vazio | front anterior |
| 30 | 01/10 17:47 | ui / Desconhecido | /avaliar-classe | Android 10, Chrome 154 (mesma pessoa de 24–26) | vazio | front anterior (antes do deploy) |
| 31 | 01/10 21:33 | **boundary / TypeError** | /trilha | Android 10, Chrome 154 | "A tela quebrou e o app precisou se recuperar." | **front 6413af0** (publicado) |

Notas de atribuição:
- **Fase 9 não participa de nenhum.** `git diff 6413af0..HEAD -- src` só adiciona arquivos de teste e fixtures; nenhuma linha de código de tela mudou.
- **Extensão/navegador e rede: nenhum.** Nenhum código `RedeIndisponivel`, `ScriptError` ou chunk; todos são Chrome/WebView atuais, sem sinal de extensão.
- Os registros não trazem versão do front, por isso a atribuição "anterior vs 6413af0" é por horário (deploy ~18:40 UTC). O logger novo (abaixo) grava a versão do front.

### O que cada grupo é

1. **#24–26 e #30 (/avaliar-classe), #29 (/trilha), #27–28 (/admin): erros esperados de regra de negócio, não bugs.**
   - /avaliar-classe: `avisar.erro(e)` sem contexto. Ou é a recusa do servidor ("outra pessoa já decidiu", etc.; `RAISE EXCEPTION` = SQLSTATE `P0001`) ou a validação da própria tela `new Error('Explique o que precisa ser corrigido antes de enviar.')` (3 toques em 3 minutos, o padrão de quem tenta enviar "correção" sem comentário).
   - /admin #27–28: `admin_rede_desafio_salvar` recusa com `raise exception 'O fim precisa ser depois do início.'` (migration 471) ou a checagem de admin da plataforma. Duas tentativas com 60 s de intervalo, pela conta da plataforma.
   - /trilha #29: `liberarJogo`/`trancarJogo`/`registrarJogo` rejeitados pelo servidor (regras do dia).
   Não há como provar a mensagem exata, porque o logger a descartava (ver abaixo). Todos têm o mesmo perfil: recusa deliberada do servidor mostrada ao usuário.
2. **#31 (boundary TypeError em /trilha): bug real possível, causa NÃO determinável com o que foi gravado.** O logger só guardava "TypeError". É o 6º TypeError de boundary/promessa em 7 dias (antes: /admin, /inicio, /eu, /rede/publicar x2, todos de fronts mais antigos). Com o logger novo, o próximo vem com a forma do erro (`TypeError:leitura:undefined.map`) e o `arquivo-hash.js:linha:coluna` (bundle com hash de build = versão).
   Observação de UX (não alterada): o `ErroApp` mostra "Precisamos atualizar o app" para QUALQUER erro de renderização, não só versão velha; um bug real de tela aparece para a criança como "atualize".

### Por que 7 vinham como "Desconhecido" (causa, no código)

`codigoDoErro` (src/lib/observabilidade.js) só reconhecia códigos que casassem `PGRST\d{3}`, `2xxxx`, `4xxxx` ou `5xxxx`, e caía em `name`. Resultado:
1. **`P0001`** (o SQLSTATE de TODO `RAISE EXCEPTION` das nossas RPCs de regra de negócio) não casa com nenhum padrão → "Desconhecido". É a causa dominante.
2. `new Error('...')` gerado na própria tela tem `name === 'Error'` → "Desconhecido".
3. Rejeição com valor não-Error (string, objeto, `undefined`, Event) e "Script error." de origem cruzada não têm `code`/`name` → "Desconhecido" (ou vazio `''`, caso de `undefined`).
4. O `Error.message`/`stack` nunca foi enviado (de propósito: privacidade), mas sem substituto, o que sobrava era inútil.

### Correção local (commit `030b900`, sem mudar o contrato da RPC `registrar_erro`)

`src/lib/observabilidade.js` (+ `observabilidade.test.js`, 12 testes):
- Reconhece SQLSTATE completo (`[0-9A-Z]{5}`, inclui `P0001`, `22P02`, `57014`...) e `PGRST###`.
- Status HTTP (`FunctionsHttpError:HTTP429`, `HTTP413`...) quando não há `code`.
- Não-Error: `Rejeicao:<tipo>`, `Evento:<tipo>:<TAG>`, `SemDetalhe`; texto puro `Texto#<hash>`.
- Lista **fechada** de rótulos: `ScriptErrorCrossOrigin`, `ResizeObserver`, `ChunkLoad`, `RedeIndisponivel`, `Timeout`, `Abortado`, `ArmazenamentoCheio`, `SessaoInvalida`, `PermissaoNegada`.
- TypeError/ReferenceError/RangeError do motor JS só em **formas conhecidas** (`leitura:undefined.map`, `naofuncao:x.foo`...). O identificador é limitado a 30–40 caracteres, nunca valor.
- Mensagem fora da lista vira **impressão digital** (`Erro#a1b2c3`, `TypeError#a1b2c3`; djb2 de 6 hex, com números e uuids normalizados): agrupa iguais e dá para conferir contra uma mensagem conhecida sem gravar o texto. Teste prova que e-mail/nome não vazam.
- Onde nasceu: para origens `boundary/janela/promessa`, `arquivo.js:linha:coluna` do primeiro frame do stack entra no `contexto` (200 chars; o servidor ainda passa por `_sem_segredo`). Handler `window.error` usa `filename/lineno/colno` do evento.
- Versão: o `agente` passa a terminar com ` v<data-hora>-<sha>` (a mesma `__OTA_VERSAO__` do OTA), mantendo 120 caracteres.
- `erro.esperado === true` não é registrado; usado na validação de /avaliar-classe, que não é falha.
- O servidor continua com `p_codigo` até 80 caracteres e mascara segredos (migration 79): nenhuma mudança de RPC.

---

## B) Push 404/410

### Confirmação
- **404/410 são tratados como erro permanente e funcionam.** `enviar-push/index.ts`: web `statusCode 404|410` → `delete from push_subscriptions where endpoint = <esse>`; FCM `404` → `delete from push_tokens where token = <esse>`. Efeito medido em produção: as inscrições dos erros 410 (web) e 404 (FCM) das últimas 24 h **já não existem** (0 linhas por identidade); só a inscrição que falhou é removida (4 pessoas têm mais de uma inscrição; as outras ficam).
- **Sem retry no mesmo evento:** uma falha vira `falhou` e a reserva por índice único impede reenvio do mesmo evento; o evento seguinte só tenta aparelhos que ainda existem.
- **Sem `infra_falhas` repetitiva:** 404/410 não chamam `registrarFalha`; as 184 linhas de `push/edge` em produção são de 25–29/09 ("sem configuração no Vault"), nenhuma nova.
- **Temporário x permanente:** a Edge Function só apaga em 404/410 (FCM: 404). Timeout/rede/oauth/429/5xx são gravados e a inscrição fica. Correto para esses casos.

### Os 3 "desconhecido" (agregado, sem identificar pessoa)
- `push_tentativas.codigo` é vocabulário **fechado** (migration 55: 200,201,404,410,429,500,503,timeout,rede,oauth,desconhecido) e `push_concluir` colapsa qualquer outro status HTTP em `desconhecido`. Ou seja: **são respostas do provedor com status fora da lista (400/401/403/413/502/504...), cujo status real é descartado.**
- Os 3 ocorreram no **mesmo instante** (01/10 21:00:05, ~0,9–1,0 s de duração, não é timeout) em **3 aparelhos distintos** (2 hosts `fcm.googleapis.com`, 1 `web.push.apple.com`) e **nenhum deles jamais teve uma entrega**. Histórico total: 11 `desconhecido` em 4 inscrições, todas "só falha desde 29/09". Hipótese principal: 401/403 de inscrição criada com outra chave VAPID/ou revogada no provedor, ou 400/413. **Não confirmável**, justamente porque o status era descartado.

### Contagem de inscrições provavelmente mortas (sem apagar nada)
- Inscrições web: 20 (16 pessoas; 19 `fcm.googleapis.com`, 1 `web.push.apple.com`). Tokens FCM (APK): 2.
- **4 inscrições web só têm falha, nunca entrega** (3 no FCM-web + a do Apple), 1 sem nenhuma tentativa. A consulta da poda proposta (rodada como SELECT, read-only) lista **2 candidatas** hoje: ambas `fcm.googleapis.com`, 3 e 4 falhas permanentes em 3 dias distintos (29/09–01/10). A do Apple não entra de propósito (nenhum outro aparelho no host Apple prova que o provedor funciona); a 4ª tem 1 falha só.

### Lacunas encontradas
1. **Status real perdido** (`desconhecido`): impede saber se é 401/403 (aparelho morto ou chave do SERVIDOR) ou 413 (payload).
2. **Erro permanente que não é 404/410 nunca é limpo**: inscrição morta com 403 recebe uma tentativa a cada aviso, para sempre (retry "eterno" por evento).
3. **Falha ao apagar a inscrição era silenciosa** (`delete` do supabase-js devolve `{error}` e o código ignorava).
4. FCM: só `404` limpa o token; `400 INVALID_ARGUMENT`/`403` (token inválido ou de outro projeto) não. Não alterado: pode ser payload ou projeto, não token.
5. Apple (`web.push.apple.com`) responde 410 para inscrição morta, como os demais: ok. Os 3 falhando sem entregar nunca devem ser tratados como "dispositivo desligado" sem mais evidência.

### Correção local (commit `a898f95`, **migration 534 + teste SQL 139, replay NÃO rodado**)
`supabase/migrations/20260930000534_push-erro-permanente-e-poda.sql`:
1. Amplia o vocabulário de `codigo` (+400, 401, 403, 413, 502, 504) na constraint e em `push_concluir`: o status real passa a aparecer. Fora da lista continua `desconhecido`.
2. `push_inscricoes_mortas(p_min_falhas=3, p_min_dias=2)` (só `service_role`): lista **anonimizada** (hash de 8 chars do endpoint, host, contagens, período).
3. `push_podar_inscricoes_mortas(p_aplicar := false, ...)` (só `service_role`): **o padrão é ENSAIO**; com `true` remove só inscrição/token que (a) **nunca entregou**, (b) tem >= 3 falhas **permanentes** (400/401/403/404/410/413/desconhecido) em >= 2 dias distintos, (c) o **provedor comprovadamente funciona** (houve entrega a OUTRO aparelho do mesmo host/canal nos últimos 7 dias) — um problema de chave do servidor, que derrubaria todos, nunca vira poda em massa. Timeout, rede, 429, 5xx, oauth **nunca** contam. Piso interno de 2/2. Histórico de tentativas e outras inscrições da mesma pessoa preservados.
4. `_push_mortas` (devolve a credencial crua) revogada de todos, inclusive `service_role`; nada agendado (a poda é decisão do dono).

`enviar-push/index.ts`: erro ao apagar a inscrição/token expirado agora gera `registrarFalha` (sem texto do provedor). Comportamento HTTP igual; 400/401/403 **não** apagam na Edge Function.

Testes: SQL `139_push_erro_permanente_e_poda.sql` (morta x saudável x já-entregou x temporária x poucas falhas x host sem prova x identidade alternativa por `dispositivo_id` x token FCM x ensaio x aplicar x idempotência x permissões); vitest `pushErroPermanente.contract.test.js` (9 asserts estáticos; passam).

---

## C) Os 3 órfãos (hoje, `_storage_gc_fatos(null,30)`; NENHUM apagado)

Identidade técnica por metadados do banco (sem baixar nada): id do objeto, `eTag`, `mimetype`/`size`/`contentLength` (iguais), `created_at`, tipo de pasta, dono. Nenhum dos 3 está na fila 532 (`storage_exclusao_fila`: 0 linhas), tem referência (0) ou está em remoção.

| ÓRFÃO (hash) | bucket | tamanho | idade | mimetype | origem provável | classificação | recomendação |
|---|---|---|---|---|---|---|---|
| `fac1a2bb` (obj `451d634a`) `<uid>/atividades/<ts>.mov` | comprovacoes | 28.017.064 B (26,7 MiB) | 30,03 d (01/09 22:12 UTC) | video/quicktime | **Entrega de Atividade** (único fluxo que aceita vídeo: `Atividades.jsx` -> `subirComprovacao(tipo 'atividades')`). Não é rascunho de requisito/experiência. | **A) NOVO CANDIDATO: provável duplicata de envio, NÃO provado idêntico. Tratar como INDETERMINADO até conferência de conteúdo.** | Preservar. Antes de qualquer exclusão: sha256 dos DOIS arquivos (este e o referenciado, `b267ec`) no manifesto do GC. Iguais -> entra no lote seguro; diferentes -> continua preservado e o dono decide. |
| `4bdb99ef` (obj `b4792826`) `atividades/<ativ>-<pessoa>-<ts>.jpg` | imagens | 151.135 B | 82,33 d (11/07) | image/jpeg | Entrega de atividade (caminho legado no bucket `imagens`), upload de 11/07; entrega aprovada existia no dump de 24/09 | **B) JPG histórico explicado**: a pessoa **não existe mais** (excluída depois de 24/09, a entrega foi junto; atividade passou de 13 para 12 entregas, hoje 12). Era a entrega, hoje sem linha. | Candidato a SEGURO, aguardando autorização do dono (mesma conclusão da seção 8 de `FASE9-PRIVACIDADE-MIDIA-ANALISE.md`, reconfirmada hoje: atividade existe, pessoa 0, par 0). |
| `6462631f` (obj `01624940`) `atividades/<ativ>-<pessoa>-<ts>.heic` | imagens | 869.418 B | 61,83 d (01/08 02:54 UTC) | image/heic | Upload de entrega de atividade **sem registro** (pessoa ativa, atividade existe, 0 entrega do par; a pessoa tem 2 entregas aprovadas em 05/07 e 13/07; a atividade tem 9 entregas) | **C) HEIC INDETERMINADO**, como antes (upload sem registro; plausível, não provado) | Preservar até decisão do dono. Cuidado: é original HEIC não saneado (EXIF/GPS possível, de um menor); excluir é benéfico para privacidade, mas só com autorização. |

Como foi identificado: JPG e HEIC batem com os dois "indeterminados" documentados antes (mesmos buckets, idades 82/62 d, mesmos tamanhos de 24/09–01/10; hoje reconferidos pelo par atividade/pessoa no banco). O HEIC é o único HEIC de `imagens/atividades` sem entrega do par; os outros 3 HEIC (848.232 / 2.295.861 / 5.711.005 B) seguem referenciados. A **assinatura mágica não foi lida** (exigiria baixar); mimetype, extensão e `size` são consistentes entre si.

### Detalhe do objeto A (comprovacoes, 28 MB)
- **Formato do caminho** (`src/lib/upload.js`): `<auth.uid>/<tipo>/<Date.now()>.<ext>`; aqui tipo `atividades`, `.mov`, timestamp do nome = 01/09 22:11:10 UTC; o objeto terminou de subir às 22:12:08 (58 s de upload).
- **Mesma pessoa enviou outro .mov de tamanho idêntico** (28.017.064 B) que **é** a entrega aprovada: nome-ts 22:12:25, objeto criado 22:12:52, `entregas.created_at` 22:12:52,39 (0,4 s depois). Ou seja: o primeiro envio terminou, **nunca chegou ao `upsert` em `entregas`** (se tivesse, `created_at` seria 22:12:08, porque o upsert não reescreve `created_at`), a pessoa tocou de novo e o segundo gerou a entrega. Tudo em ~1 minuto.
- **ETags diferentes** (`...-2` ambos, valores distintos) com o mesmo tamanho: **não** posso afirmar mesmo conteúdo. Pode ser o mesmo arquivo com partes diferentes no armazenamento, ou conteúdo diferente com tamanho coincidente. Por isso não classifico como seguro.
- **Por que perdeu a referência: NÃO é o buraco que a 533 fecha.** A 533 cobre troca/remoção de rascunho/anexo de requisito, especialidade, imagem de experiência, etc. Aqui nunca houve linha: é "upload concluído, registro nunca gravado". A 532 também não vê (gatilho só reage a linha de `entregas` que existiu). É um terceiro caminho de vazamento, só tratável no cliente (ver correção) ou pelo GC.
- Mesma pessoa tem 4 entregas (3 jpg em jul, 1 mov em 01/09) e 2 objetos .mov em 01/09 (1 referenciado + este).

### Achado novo, mais importante que os 3: mais 12 órfãos chegando
Mesma consulta, categoria `recente` com 0 referência no bucket `comprovacoes`: **12 arquivos, 49,4 MB**, todos `<uid>/atividades/`, 27,3–28,2 dias de idade, cruzam 30 dias em **1,9 a 2,7 dias** (≈ 03–04/10). O padrão repete o do objeto A: **03/09 19:26:24, :29, :42 — mesma pessoa enviou o mesmo mp4 de 1.936.316 B três vezes em 18 s** (e um mov de 1.022.495 B duas vezes em 4 s); em **04/09 15:42–16:20, fotos de 6 pessoas diferentes sem entrega por perto**. Interpretação: **o envio sobe o arquivo e, se o registro falha, a pessoa toca de novo e sobe outra cópia**; a anterior fica sem dono. (Mais 19 em `imagens`: perfis/mural, 6,8 MB, de 5 a 23 dias; fotos de perfil antigas trocadas, tratadas pela 532.) Recomendo tratar essas 12 como o objeto A: sem excluir; com sha256 dos pares e conferência de entrega.

### Correção local (commit `606e56a`)
`src/pages/Atividades.jsx` + `src/services/entregasAtividade.js` (+ 5 testes): se o `upsert` de `entregas` falhar depois do upload, **o arquivo recém-enviado é descartado** (`comComprovacao`, migration 173: o servidor só deixa o dono apagar o que ninguém referencia). Cada "tentar de novo" deixa de acumular uma cópia. O ponto de envio de vídeo continua só em `Atividades.jsx` (contrato `uploadsMidia.contract.test.js` mantido). Não resolve: upload que termina mas a página é fechada/recarregada antes do `upsert` (provável no objeto A); isso fica com o GC.

---

## Pendências para o agente principal

1. **Rodar o replay SQL** (`npm run test:db` ou `REPLAY_DB=<nome> bash supabase/tests/run-tests.sh`) com a migration `20260930000534_push-erro-permanente-e-poda.sql` e o teste `139_push_erro_permanente_e_poda.sql` (escritos sem execução; ajustes de fixture possíveis). Se outro agente reservou 534, renumerar o arquivo (o teste não depende do número).
2. **Aplicar a 534 em produção só com autorização** (idempotente: `drop constraint if exists`, `create or replace`; não cria tabela, não precisa do guard de manutenção). Rodar `select * from push_inscricoes_mortas();` (ensaio) e **`push_podar_inscricoes_mortas(true)` só depois da autorização do dono**; hoje listaria 2 candidatas.
3. **Redeploy da Edge Function `enviar-push`** (mudança só de log de falha de remoção) junto da próxima janela.
4. **Órfão A e os 12 a caminho:** decidir se o manifesto do GC calcula sha256 dos pares antes de 03–04/10 (quando entram em `orfao`); nada deve ser apagado antes disso.
5. **Decisões do dono:** excluir o JPG B (explicado); manter ou excluir o HEIC C (indeterminado); a poda de push; mensagem do `ErroApp` ("Precisamos atualizar" para qualquer erro).
6. Próximo `app_erros` já vem com versão e causa; reler depois do deploy do front.

## Commits (branch `worktree-agent-aeb575e59827437de`)
- `030b900` fix(observabilidade): código do erro não perde P0001/HTTP/não-Error; versão e local no registro
- `a898f95` feat(push): status real de erro permanente + poda segura (migration 534, teste 139; replay pendente)
- `606e56a` fix(atividades): descarta o arquivo recém-enviado se o registro da entrega falhar
