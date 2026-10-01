# Anexos offline — desenho da fila local de fotos/documentos (Fase 9)

Estado: **desenho + prova de conceito pura** (`src/lib/filaAnexos/`, 93 testes, sem UI, sem migration).
Nada aqui foi ligado a tela nem aplicado em produção.

## 1. Situação hoje (o que o código faz)

| Peça | Como é hoje |
|---|---|
| Texto do relato/rascunho | Fica no aparelho (`src/lib/relatorio/rascunhoLocal.js`, `localStorage`, chave `cq.rel.<uid>.<alvo>.<requirementId>`), com `base` (hash do rascunho do servidor) para detectar conflito local × nuvem (`decidirCarga`, `conflito.js` mostra os horários). Apagado ao sair da conta (`Auth.jsx` → `limparRascunhosLocais`). |
| Foto/anexo | **Exige internet.** `CampoAnexos` (`FormularioRelatorio.jsx`) → `subirAnexoDeRelatorio` → `subirComprovacao` (`lib/upload.js`): valida pelos bytes, comprime (`comprimirImagem`, 1080 px/0,72), sobe em `comprovacoes/<uid>/requisitos/<Date.now()>.<ext>` com `upsert:false`, devolve o **caminho**. Sem rede, mostra "o texto foi guardado neste aparelho" e a foto se perde. |
| Associação à tentativa | Caminho entra em `rascunho_anexos` (`requisito_relatorio_salvar`, mig. 510/520) como `[{campo, path}]`. A validação `_anexos_do_dono_erros` exige: caminho `^[A-Za-z0-9_./-]+$`, ≤ 300, 1º segmento = uid (formato antigo) ou `<clube>/<uid>/…`, **e o objeto já existir em `storage.objects`**. No envio (`requisito_enviar`, 520/524) o rascunho é **congelado** na tentativa (`requirement_submissions.anexos` / `specialty_requirement_submissions.anexos`); a tentativa não aceita arquivo "futuro". |
| Fila offline existente | `services/filaJogos.js`: `localStorage`, chave por usuário+clube, itens com `uid`/`clube`, expira 7 dias, descarta erro de regra, idempotência no servidor. **Só dados pequenos** — `localStorage` (~5 MB, string) não serve para foto. É o modelo de regras que reaproveitamos. |
| Compressão/EXIF | `lib/imagens/processar.js` (perfis `evidencia` ≈ 900 KB/2048 px JPEG; `documento` ≈ 1,2 MB/2560 px) re-renderiza em canvas (remove EXIF/GPS) — não está plugado em `subirComprovacao` (que usa `comprimirImagem`, que devolve o original se não ficar menor ⇒ **pode levar EXIF**). `otimizarFoto` (Rede) sempre re-renderiza. |
| Uploaders | `lib/upload.js` (comprovações, avatar, mural), `services/documentoIdade.js` (`<uid>/documentos/<Date.now()>.jpg` + RPC `documento_enviar`), `services/rede.js` (bucket `comunidade`, `upsert:false`), `services/suporte.js`, `ZonaUpload`/`input type=file` crus em ~15 telas. |
| Storage `comprovacoes` | Privado, 60 MB/arquivo, mimes foto+vídeo. Policies (87/173): **INSERT** só o dono no seu caminho (`<uid>/…` ou `<clube em uso>/<uid>/…`), SELECT dono/liderança do clube dono do dado, **sem UPDATE** (⇒ `upsert:true` falharia num arquivo existente), DELETE só do dono em `<uid>/requisitos/<arquivo>` **não referenciado** (órfão, mig. 173; há coleta de órfãs > 7 dias). |
| Capacitor | Plugins: app, haptics, push-notifications, splash-screen, status-bar, `@capgo/capacitor-updater` (OTA). **Sem Camera nem Filesystem.** O app Android é um WebView (`androidScheme: https`); `<input type=file accept=image/*>` já abre câmera/galeria nativas. IndexedDB funciona no WebView e persiste com o app. |

Consequência importante: **o servidor só aceita um caminho depois que o arquivo existe**. Logo, a fila precisa subir o arquivo *antes* de o caminho entrar no rascunho do servidor. Isso já cabe no desenho (seção 5) e dispensa migration.

## 2. Viabilidade — resposta curta

**Viável, com risco baixo e sem migration obrigatória.** A fila guarda a foto (já comprimida, ≤ ~1–2 MB) no aparelho e sobe quando a rede volta; o rascunho de texto continua como está. O ganho prático: a criança fotografa no local da atividade, sem sinal, e não perde a foto.

## 3. Armazenamento

| Opção | Veredito |
|---|---|
| **IndexedDB** (escolhida) | Funciona no Chrome/WebView e no Safari/PWA do iPhone (único caminho que cobre os dois). Transações atômicas (necessárias para o "trava" do item). Quota por origem, em geral muito acima do que usamos. |
| Filesystem do Capacitor | Exige plugin novo ⇒ **APK novo** (mudança nativa não vai por OTA), não existe no PWA/iPhone e obriga manter índice à parte. Rejeitada para a v1. Só vale reavaliar se a WebView despejar IndexedDB na prática (medir no piloto). |
| `localStorage` | ~5 MB, base64 (+33%), síncrono: rejeitado. |
| Cache API / Service Worker | O SW **nunca** deve cachear resposta autenticada (regra do projeto); rejeitado. |

Detalhes de implementação (já no PoC):

- Duas lojas: `meta` (leve, listável) e `blobs`. Blob é gravado como **ArrayBuffer + mime** (WebViews antigas/iOS têm bugs de `Blob` em IndexedDB); anexo comprimido ⇒ custo de memória irrelevante.
- **Quota**: `navigator.storage.estimate()` antes de gravar; se `quota − usage − tamanho < 50 MB` ⇒ erro `COTA_BAIXA` (a tela avisa "pouco espaço no aparelho"). `QuotaExceededError` na gravação ⇒ `COTA`. Sem `estimate` (aparelho antigo) a fila segue e depende do erro de gravação.
- **Persistência**: `pedirPersistencia()` (`navigator.storage.persist()`) na primeira vez que alguém enfileira. Pode ser negado; a fila funciona igual, mas o sistema pode despejar dados sob pressão de espaço ⇒ item ganha `ARQUIVO_PERDIDO` (estado `falhou`) em vez de travar.
- **Limites padrão** (todos configuráveis, `LIMITES_PADRAO`): 2 MB por anexo; 8 itens por destino; 30 itens e 24 MB por usuário+clube; 48 MB no aparelho; 50 MB de reserva de cota livre. Documento sensível: 1 por destino.
- **Compressão ANTES de guardar**: a tela chama `processarImagem(file, 'evidencia')` (ou `'documento'`) e entrega o `Blob` pronto à fila. A fila só aceita `image/jpeg|png|webp` (nunca SVG/vídeo) e recusa > 2 MB. **Vídeo não entra na fila** (Atividades aceita vídeo até 60 MB: continua online-only).
- Fallback: se IndexedDB não existir/estiver bloqueado (navegação privada), usa o adaptador em memória e a tela avisa "as fotos só ficam guardadas enquanto o app estiver aberto".

## 4. Modelo do item

```
{ v:1, id,                       // gerado no cliente (crypto.randomUUID); = chave de idempotência = nome do arquivo no Storage
  uid, clube,                    // dono; TODA operação confere os dois
  destino:{ tipo:'rascunho'|'requisito'|'tentativa', alvo:'classe'|'especialidade'|…, ref:<requirementId>, campo:<chave do campo anexos> },
  caminho,                       // determinístico: <uid>/requisitos/<id>.<ext>  (sensível: <uid>/documentos/<id>.jpg)
  mime, bytes, sha256, sensivel, // sha256 conferido antes de subir (arquivo corrompido nunca sobe)
  base,                          // hash do rascunho do servidor no momento (ver seção 6)
  estado, tentativas, erro:{codigo,mensagem≤160}, proximaTentativaEm,
  criadoEm, atualizadoEm, iniciadoEm, enviadoEm }
```

Sem nome original do arquivo, sem texto livre, sem EXIF (a imagem já passou por canvas). O que é pessoal: o arquivo em si (foto de criança) — por isso ficam no aparelho só o necessário e por pouco tempo (seção 8).

**Estados** (`TRANSICOES` no código; qualquer outra transição é ignorada):

```
enfileirado → enviando → enviado            (arquivo apagado do aparelho; "lápide" some em 1 h)
     ↑            ├────→ enfileirado         (rede caiu: espera 5 s, 10 s, 20 s… até 5 min; sessão expirada não gasta tentativa)
     │            └────→ falhou              (erro de regra, arquivo perdido/corrompido, ou 6 tentativas de rede)
     └── "Tentar de novo" ← falhou
cancelado  (usuário removeu, ou expirou; arquivo apagado)
```

`enviando` tem **lease de 2 min**: se o app foi morto no meio do upload, a rodada seguinte devolve o item a `enfileirado` (retomada após fechar o app). A troca de estado é um compare-and-set dentro de uma transação do IndexedDB, então duas abas/execuções não enviam o mesmo item.

## 5. Fluxo ponta a ponta e a mudança no servidor

1. Criança escolhe a foto → `processarImagem` → `fila.adicionar({uid, clube, destino, blob})` (devolve `id` e `caminho`).
2. **Online**: `fila.processar({uid, clube, enviar})` imediatamente. `enviar` = `supabase.storage.from('comprovacoes').upload(caminho, blob, { upsert:false, contentType })`. Sucesso (ou **409 "já existe" ⇒ sucesso**) ⇒ item `enviado`.
3. **Offline**: a tela mostra a miniatura (lida da fila) com selo "aguardando internet"; o rascunho de texto continua indo para o `localStorage` como hoje. Gatilhos de reenvio, iguais aos da fila de jogos: evento `online`, app voltando ao primeiro plano, login e abertura do formulário.
4. Quando o item vira `enviado`, a tela adiciona `{campo, path: caminho}` ao rascunho **e chama `requisito_relatorio_salvar` como hoje** (o objeto agora existe, então a validação 510 passa). Em seguida `fila.confirmar(id)`.
5. **Envio para avaliação** (`requisito_enviar`) só é habilitado quando não há item `enfileirado/enviando/falhou` para aquele requisito (a tela consulta `fila.listar({destino})`). Nunca se envia tentativa com anexo pendente.

**Mudança mínima no servidor: nenhuma é obrigatória.** O contrato atual (arquivo existe → caminho no rascunho) já é satisfeito pela ordem acima, e o caminho determinístico no formato antigo `<uid>/requisitos/<id>.<ext>` é aceito pelas policies (87) e pela validação (510), e continua alcançável pela policy de apagar órfão (173), o que importa se o item for cancelado depois de subir. Melhorias **opcionais**, para uma migration futura (não implementadas):

- (a) `requisito_relatorio_salvar` aceitar `{campo, path, client_id}` e deduplicar por `client_id` (hoje a duplicidade é prevenida no cliente pelo `id` fixo e no Storage pelo 409);
- (b) policy de INSERT/DELETE para o formato novo `<clube>/<uid>/…` equivalente à 173 (hoje a limpeza de órfão cobre só o formato de 2 segmentos);
- (c) coleta de órfãs (`comprovacoes_orfas`) já resolve o caso "subiu, mas o app morreu antes de salvar o rascunho" depois de 7 dias.

**Idempotência, em camadas**: `id` estável ⇒ caminho estável ⇒ o Storage recusa o segundo `upload` (409) e o cliente trata como sucesso; se o app morrer entre o upload e a gravação do estado `enviado`, a retomada reenvia, recebe 409 e conclui. Não há `upsert:true` porque as policies não têm UPDATE (e não queremos sobrescrever evidência — a tentativa é imutável e auditável). Risco residual: um 409 de arquivo **diferente** com o mesmo id é impossível na prática (UUID v4 gerado no cliente; o PoC recusa o mesmo id vindo de outra conta).

## 6. Associação ao destino certo e conflito local × nuvem

- O item carrega `destino.ref` (requirementId) + `campo`; **não** carrega "o rascunho atual". Editar o texto offline, trocar de requisito, trocar de clube ou fechar o app não muda a qual requisito a foto pertence.
- Fila por **usuário + clube**: `listar/obterBlob/cancelar/processar` exigem `{uid, clube}` e ignoram o resto (testado: item adulterado com outro uid nunca é enviado). O clube em uso vem do mesmo contexto que alimenta o header `x-clube-atual`; o upload usa o caminho com o `uid` real (a policy confere).
- **Conflito local × nuvem**: o hash do rascunho (`hashRascunho(conteudo, anexos)`) hoje considera `anexos`. Proposta: o hash e a `decidirCarga` consideram só anexos **já enviados** (itens da fila ficam fora do hash e aparecem à parte como "pendentes"). Assim a foto pendente nunca cria conflito falso; ela é mesclada **aditivamente** ao rascunho vencedor (acréscimo de anexo não sobrescreve nada). Se a pessoa escolher "versão da nuvem" no conflito e houver foto pendente, a foto **permanece na fila** (não é descartada com o texto) — e a tela deve dizer isso. `base` fica no item só para diagnóstico/auditoria local.
- Requisito que deixou de ser editável (já enviado/aprovado) com foto pendente: item vai a `cancelado` com aviso, análogo ao `descartarLocalComBackup` do texto (a foto não é enviada para um requisito congelado).

## 7. Progresso, tentar de novo, indicador (UX mobile)

- Indicador **discreto**: um selo na própria miniatura ("📶 aguardando", "enviando…", "⚠ falhou — Tentar de novo") e, no máximo, um chip pequeno no topo da Minha Classe ("2 fotos aguardando internet"). Nada de modal, nada que bloqueie o resto do app; `processar` roda em segundo plano e nunca é `await`ed por uma tela.
- Botões ≥ 44 px: "Tentar de novo" (`tentarDeNovo`) e "Remover" (`cancelar`). Progresso real de bytes não é necessário (arquivos ≤ 1–2 MB); estados bastam.
- Cota baixa: mensagem simples "Seu aparelho está com pouco espaço. Libere espaço para guardar fotos." + a foto **não** é descartada em silêncio (a tela mantém o `File` em memória e oferece tentar de novo).
- Texto do aviso de sair da conta com pendências: ver decisão D3.

## 8. Segurança e privacidade

- **Isolamento entre contas** (irmãos no mesmo celular): chave lógica uid+clube em todas as operações; `descartarDaConta({uid})` na saída; `listar` nunca devolve item alheio. Dado de criança fica só no aparelho dela, em storage do próprio app (sandbox do WebView), **não criptografado** além do que o Android já faz — por isso o tempo de permanência é curto.
- **Documento da idade (identidade): política própria.** `sensivel:true` ⇒ só JPEG, **1 por destino, validade 24 h** (o resto: 7 dias), pasta `documentos/`, e é **apagado do aparelho no instante em que sobe** (todo `enviado` apaga o blob). Na saída da conta, documentos pendentes são **sempre** apagados (`descartarDaConta({uid, soSensiveis:true})`), mesmo que se decida manter as fotos comuns. Recomendação mais conservadora (decisão D2): **não oferecer fila offline para documento na v1** — o documento é raro, sensível e o fluxo `documento_enviar` + apagar-depois-da-aprovação é mais crítico; a fila já suporta, mas a tela simplesmente não a usa.
- **EXIF/GPS**: a tela deve usar `processarImagem` (re-render em canvas) antes de enfileirar — hoje `subirComprovacao` pode enviar o original. Registrar isso como correção a fazer junto com a UI (achado desta análise).
- Erros de servidor guardam no máximo 160 caracteres e nenhum dado pessoal.
- Limpeza: `limpar()` ao abrir o app (expira ativos antigos, apaga lápides > 1 h, devolve bytes liberados); limites impedem a fila de crescer; tela "Armazenamento" não é necessária na v1.
- Service worker continua sem cachear resposta autenticada; a fila não passa por ele.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| WebView/sistema despeja IndexedDB (aparelho simples, pouco espaço) | `persist()`, limites baixos, `ARQUIVO_PERDIDO` tratado, texto nunca depende da fila. Medir no piloto antes de prometer "nunca perde". |
| Foto de criança parada por dias no aparelho | validade 7 dias (24 h p/ documento), apagar ao enviar, limpar ao sair da conta (D3). |
| Mesmo celular, outro login logo após o primeiro | filtro por uid+clube + wipe configurável na saída; teste dedicado. |
| Duas abas processando | lease + compare-and-set em transação + trava local (testado com `Promise.all`). |
| `upsert:false` e app morto entre upload e `enviado` | 409 tratado como sucesso (testado). |
| Arquivo órfão no bucket (subiu mas rascunho não gravou) | coleta de órfãs > 7 dias (mig. 173); item `enviado` sem `confirmar` expira. |
| Conflito de rascunho confuso com foto pendente | hash só com anexos enviados (seção 6). |
| `sha256`/canvas custo em Android simples | 1–2 MB: ~ms a poucas centenas de ms; fora do caminho crítico. |
| Esquema do IndexedDB evoluir | `v:1` no item e versão 1 do banco; migração futura via `onupgradeneeded`. |

## 10. Alternativas rejeitadas

- Guardar a foto em base64 no rascunho do `localStorage` (estoura a cota e quebra o rascunho de texto junto).
- Plugin Filesystem/Camera do Capacitor na v1 (APK novo, não cobre iPhone).
- Background Sync do Service Worker (ausente no iOS e na WebView; contraria "SW não toca em dado autenticado").
- `upsert:true` / nome por `Date.now()` (hoje) — sem idempotência; e `upsert` exigiria policy de UPDATE sobre evidência imutável.
- Subir sem `id` fixo e deduplicar por hash no servidor (exige migration e leitura do objeto).
- Fila genérica para todos os uploads (Rede/Mural/avatar/logo): a Rede tem moderação e consentimento online; avatar/logo são raros; fica fora do escopo.

## 11. Plano de testes

Já feito (PoC, `src/lib/filaAnexos/fila.test.js`, mesma suíte nos adaptadores memória e IndexedDB via `fake-indexeddb`): idempotência por id (inclusive corrida), id de outra conta, validação de entrada/tipo/tamanho, limites de itens e bytes, cota baixa/estourada, isolamento uid+clube, saída de conta, envio, 409 como sucesso, backoff e esgotamento, erro de regra, sessão expirada, retomada por lease e por "reabrir o app", concorrência (2 instâncias), offline, arquivo perdido/corrompido, cancelar/tentar de novo/confirmar, expiração (7 dias / 24 h) e lápides, persistência real do IndexedDB.

A fazer quando houver UI: (1) vitest de componente em `CampoAnexos` com a fila injetada (miniatura pendente, "Tentar de novo", botão enviar bloqueado com pendências, conflito com foto pendente); (2) E2E contra o Supabase **local**: criar rascunho → modo offline (CDP `Network.emulateNetworkConditions`/`context.setOffline`) → anexar → reabrir página → voltar online → conferir 1 único objeto em `storage.objects`, caminho = `<uid>/requisitos/<id>.jpg`, `rascunho_anexos` contendo o caminho, e envio da tentativa congelando o anexo; (3) E2E de duplicidade (derrubar a rede no meio do upload, reenviar ⇒ 1 objeto); (4) teste SQL: policy continua sem UPDATE e `_anexos_do_dono_erros` aceita o caminho determinístico; (5) APK real num Android simples com pouco espaço (roteiro em `ROTEIRO-ANDROID-REAL-FASE8.md`).

## 12. Decisões do dono

- **D1** Escopo da v1: só anexos de requisito (Minha Classe/Especialidade)? (recomendado) Mural/Missões/Experiências ficam online-only por enquanto.
- **D2** Documento da idade na fila offline? (recomendado: **não** na v1; o PoC já impõe validade 24 h e apagar ao enviar caso queira depois).
- **D3** Ao **sair da conta** com fotos pendentes: (a) apagar tudo, como o texto hoje (mais seguro, pode perder foto), (b) avisar "há 2 fotos não enviadas — enviar agora/descartar" (recomendado), (c) manter fotos comuns da conta (só documento é apagado).
- **D4** Limites: 2 MB/anexo, 8 por item, 24 MB por conta, validade 7 dias — confirmar ou ajustar.
- **D5** Aceitar a migration opcional (dedupe por `client_id` e policy do formato `<clube>/<uid>`), ou ficar só com o contrato atual?
- **D6** Corrigir `subirComprovacao` para sempre passar por `processarImagem` (remove EXIF/GPS de evidência) — recomendado, independente da fila.
- **D7** Autorizar fase de UI + E2E local, e um piloto em 1–2 aparelhos Android simples antes de divulgar.
