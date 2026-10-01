# Saneamento de imagens no servidor (EXIF/GPS/metadados) — desenho e operação

Fase 9. Implementado e testado só localmente (migration 529, Edge Function `sanear-imagens`, núcleo puro, teste SQL 133). **Nada foi aplicado em produção, nada foi publicado.** Substitui os itens 1–2 de `IMAGENS-PROPOSTA-PROXIMA-MIGRATION.md` e a seção 7 de `FASE8-AUDITORIA-E-DECISOES.md` no que toca a metadados (miniatura, cota e caminho com finalidade continuam propostas).

## 1. Problema
O app já tira EXIF no aparelho (canvas), mas um cliente adulterado pode subir o original direto no Storage; o Postgres não enxerga o conteúdo do arquivo. Em comprovações e fotos de documento isso é pior: a foto de uma criança pode carregar GPS da casa.

## 2. Onde sanear (decisão)
Depois do upload, **fora do caminho do envio**, por uma fila de objetos de Storage:

```
app sobe o arquivo ──► (best-effort) imagem_saneamento_enfileirar(bucket, caminho)      ┐
cron a cada 10 min ──► imagem_saneamento_varrer(2)  (pega quem NÃO chamou a RPC)        ├─► tabela imagem_saneamento (pendente)
                       imagem_saneamento_rotina ──pg_net──► Edge Function sanear-imagens (segredo)
Edge Function: pendentes(8) ► baixa ► sanearImagem() ► confere saída ► confere versão ► regrava no MESMO caminho ► marcar(ok)
```

Por que assim e não no momento do envio: o envio hoje é direto do navegador para o Storage (sem servidor no meio); interpor uma função no upload mudaria todos os fluxos, pioraria o 4G (dois saltos) e criaria um ponto de falha novo para a criança que só quer mandar a foto. A fila é aditiva: o fluxo atual não muda, e o cliente adulterado é pego pela **varredura**, que não depende do cliente.

Peças:
- `supabase/functions/_compartilhado/sanear-imagem.ts` — núcleo puro (Deno e Node, sem imports), testado em `src/lib/sanearImagemServidor.test.js` (25 testes).
- `supabase/functions/sanear-imagens/index.ts` — a Edge Function.
- `supabase/migrations/20260930000529_imagem-saneamento-fila.sql` — tabela, RPCs, varredura, rotina e cron `imagem-sanear`.
- `supabase/tests/133_imagem_saneamento.sql` — 101 asserts. Exceção declarada no teste 20 (tabela técnica, `club_id` anulável).
- `src/lib/saneamentoImagem.js` — `solicitarSaneamento()` (aditivo, nunca lança, nunca é aguardado).

## 3. O que o saneador faz (e não faz)
**Não recodifica pixels.** Remove só metadados; os bytes da imagem passam idênticos (provado nos testes e, à mão, com Pillow: pixels iguais, GPS/fabricante ausentes, orientação preservada). Logo: sem perda de qualidade e sem "compressão social" — serve para evidência e documento.

| Formato | Sai | Fica |
|---|---|---|
| JPEG | EXIF (inclui GPS e miniatura), XMP, IPTC/Photoshop, MPF, comentários, qualquer APPn desconhecido, miniatura do JFIF, lixo depois do EOI | SOF/DQT/DHT/SOS e dados, JFIF (sem miniatura), perfil ICC, Adobe APP14 (cor correta) |
| PNG | tEXt, zTXt, iTXt, tIME, eXIf, chunks privados, lixo depois do IEND | IHDR, PLTE, IDAT, IEND, tRNS, gAMA, cHRM, sRGB, iCCP, sBIT, bKGD, pHYs, hIST, APNG, cICP/mDCV/cLLI |
| WebP | EXIF, XMP, chunks desconhecidos (flags do VP8X e tamanho RIFF ajustados) | VP8/VP8L/VP8X/ALPH/ANIM/ANMF/ICCP |

**Orientação:** se havia Orientation EXIF (2..8), ela é **preservada** num EXIF mínimo de 26 bytes (só essa etiqueta; sem GPS, fabricante ou miniatura). A foto continua aparecendo na posição certa sem girar pixels. (Girar pixels exigiria recodificar ou rotação sem perdas por DCT; descartado por custo e risco.)

Estados do resultado: `saneada` (saída nunca maior que a entrada), `limpa` (nada a remover: **não se regrava**; sem recompressão/escrita à toa), `ignorado` (HEIC/HEIF/AVIF, GIF, desconhecido, vazio, maior que 12 MiB), `invalida` (truncada/corrompida). Nunca lança exceção.

## 4. Regras por bucket
| Bucket | No escopo | Observação |
|---|---|---|
| `comunidade` (Rede) | sim | foto de post/story; WebP/JPEG ≤ 300 KB |
| `comprovacoes` | sim | requisitos, missões, **foto de documento** (380), conclusão anterior (521). Só remoção lossless — nunca recompressão |
| `imagens` | sim | avatar, mural, missões/atividades legadas, emblema/bandeira de unidade |
| `suporte-anexos` | sim | jpg/png/webp |
| `publico` (logo do clube) | **não** | logos nunca são alteradas (CLAUDE.md) |
| `parceiros` | não | só admin da plataforma envia; fora do escopo de privacidade de criança |
| `documentos-emitidos` | não | PDFs gerados pelo servidor, sem foto do usuário |
| `assinaturas-desenhadas` | não | PNG desenhado no canvas (sem EXIF) e referenciado por selo/hash do documento: **regravar arriscaria a prova de integridade**. Fora de propósito |

A tabela só aceita os 4 primeiros (`check`); o enfileiramento pelo app valida o caminho com o mesmo formato que as policies de upload exigem.

## 5. Segurança do banco
- RLS ligado, **sem policy**, `revoke all` de anon/authenticated. Nada de `club_id` obrigatório: caminhos legados (avatar `perfis/<uid>-…`, comprovação `<uid>/…`) não têm clube; `club_id` é informativo e a tabela entra na lista de exceções do teste 20 com o motivo.
- `imagem_saneamento_enfileirar` / `imagem_saneamento_estado` (**authenticated**): só o **próprio** objeto, no formato de caminho das policies (comunidade `<clube em uso>/<eu>/<uuid>.(jpg|webp)`, comprovações `<eu>/…` ou `<clube em uso>/<eu>/…`, suporte `<eu>/<uuid>.ext`, imagens via `pode_subir_imagem`) **e** o objeto precisa existir. Caminho forjado, de outra pessoa, de outro clube, de bucket fora do escopo ou inexistente: mesma mensagem (`Objeto inválido.`), sem oráculo.
- `pendentes` / `conferir` / `marcar` / `varrer`: **somente service_role**; `rotina`, `liberada` e auxiliares: ninguém (cron/postgres). `anon` não executa nada.
- Tudo `security definer` com `search_path ''`.
- A tabela guarda só bucket, caminho (que já contém o id do dono), estado, motivo curto (código), contagem, bytes e datas. Nenhum nome, legenda ou conteúdo. Logs da Edge Function: só contagens e códigos; nunca o caminho.

## 6. Idempotência, versão e concorrência
- Um item por `(bucket, caminho)`. Enfileirar de novo o mesmo arquivo não muda nada.
- **Versão = `storage.objects.updated_at`.** Upload novo no mesmo caminho (avatar com `upsert`, por exemplo) volta o item para `pendente`; o resultado de um processamento da versão antiga devolve `versao_mudou` e é descartado.
- A Edge Function reserva o lote (`for update skip locked`, reserva de 5 min que expira sozinha) — duas execuções simultâneas não pegam o mesmo item.
- Antes de regravar, `conferir` garante que o arquivo ainda é a versão reservada (não pisa num upload mais novo). Janela residual: milissegundos entre `conferir` e o upload da função (risco aceito, só afeta o próprio arquivo do remetente).
- Regravar pela API com service_role pode **zerar o dono** (`owner_id`) do objeto; as policies do bucket `imagens` dependem dele (`dono_do_objeto`). `marcar(..., p_reescrito => true)` **restaura** o dono guardado ao enfileirar (testado no SQL 133). **Não foi possível provar contra o Storage real local** (o runner de testes só replica o Postgres) — conferir em staging com um avatar real antes de ligar.

## 7. Falha fechada
- Não conseguiu sanear (download, formato inválido, upload recusado, saída que não confere): o objeto **não muda** e continua visível só a quem já podia vê-lo (as policies de leitura não mexem). Item volta a `pendente` com recuo (10, 40 min) e, na 3ª falha, fica `falhou` (não tenta mais; reabre se o arquivo for regravado). `ignorado` é terminal para aquela versão e nunca quebra nada.
- Função sem segredo configurado ou com segredo errado: 401, nada é tocado. Sem Vault no banco: o cron só alimenta a fila e registra **um** aviso por hora em `infra_falhas`.
- **Rede com aprovação (porta preparada, ainda não ligada).** `_imagem_saneamento_liberada(bucket, caminho)` devolve verdadeiro só se o item está `ok` **e** o arquivo não foi regravado depois do saneamento. Ligar a porta significa acrescentar essa condição em dois pontos: (a) `_comunidade_aplicar_moderacao`, ação `aprovar_foto` (não aprova foto não saneada: erro "A foto ainda está sendo preparada"), e (b) `_comunidade_pode_ver_foto` para quem não é autor/diretoria. **Não liguei na 529** de propósito: sem a Edge Function no ar e o cron chamando, nenhuma foto seria aprovável. Entra numa migration 530 **depois** da função estar em produção e do backfill concluído (ver §9). Enquanto isso o risco é o de hoje (o app tira EXIF e a diretoria só aprova fotos que vê).
- Hoje a foto da Rede já fica `em_analise` até a diretoria aprovar; como o saneamento leva até ~10 min, na prática a foto já estará saneada quando alguém aprovar.

## 8. Impacto em histórico imutável
Nenhuma linha imutável (snapshot de classe, documento emitido, evento de investidura, `curriculum_achievements`) é lida ou alterada. Só o **arquivo** no Storage é regravado, no **mesmo caminho** que o banco guarda; nenhum hash de evidência depende dos bytes (verificado: não há `sha256` de comprovação/foto). Exceção deliberadamente fora do escopo: `assinaturas-desenhadas` (§4).

## 9. Custo e tempo (4G, celular simples)
- Para a pessoa: **zero**. O envio não espera nada; a chamada de enfileiramento é fire-and-forget (uma RPC de poucos bytes) e falhar não faz diferença.
- Servidor: sem decodificar/recodificar, o núcleo percorre os bytes (segundos de CPU para dezenas de MB no total). Lotes de 8 itens, até 5 lotes (40 itens) por chamada, teto de 24 MB baixados e 100 s; arquivo > 12 MiB é `ignorado` sem baixar. Cron a cada 10 min (≈ 240 itens/h; o backfill de milhares de arquivos leva horas, não dias; ajustar `LOTE`/`MAX_LOTES`/frequência se a fila crescer).
- Armazenamento: só diminui (nunca regrava arquivo maior; `limpa` não regrava). `bytes_antes`/`bytes_depois` ficam na fila para métrica.
- Quota de Storage (trigger de cota da migration 91): a regravação menor não deve estourar; se recusar, vira `falhou` (erro_upload).

## 10. Operação (quando o dono decidir ligar)
1. Aplicar a migration 529 (script idempotente; conferir o Tenant 001 antes/depois).
2. Deploy da função: `supabase functions deploy sanear-imagens --no-verify-jwt` (o `config.toml` já traz `verify_jwt = false`).
3. Secret `SANEAMENTO_SECRET` na função e **o mesmo valor** no Vault como `saneamento_secret`; `saneamento_url` = URL da função (nunca no repositório).
4. Conferir o 1º ciclo (`select estado, count(*) from imagem_saneamento group by 1`).
5. **Backfill** (uma vez, depois do passo 4): `select public.imagem_saneamento_varrer(3650);` — enfileira todas as imagens existentes; a fila drena em lotes. Fotos já apagadas da Rede somem sozinhas (`ignorado: sumiu`).
6. Só então a migration 530 (porta da Rede, §7).

Verificação local feita: `npm run test:edge:bundle` (empacota a função com o núcleo no edge-runtime), vitest, teste SQL 133 e o replay completo. **Não** foi exercitada a função contra um Storage real (precisa de `supabase functions serve` + stack local da sessão, que não reiniciei).

## 11. Limites conhecidos
- HEIC/HEIF/AVIF e GIF não são tratados (`ignorado`). O app já recusa HEIC no cadastro de fotos (`validarImagemReal`), e o bucket da Rede só aceita JPEG/WebP.
- JPEG progressivo/arit. é percorrido sem decodificar; arquivo "válido" na estrutura mas com dados de imagem corrompidos passa como está (não é função do saneador validar pixels).
- Metadados "dentro" dos pixels (marca d'água, esteganografia) e leitura de texto na imagem (placa, rosto) estão fora do escopo.
- Moderação de conteúdo da imagem (IA) continua não existindo; este trabalho cobre só metadados.

## 12. Decisões que precisam do dono
1. **Ligar a porta da Rede** (migration 530) depois do backfill? (recomendo sim.)
2. **Frequência do cron** (10 min) e **tamanho do lote** — compatível com o volume esperado do piloto?
3. **`assinaturas-desenhadas` e `publico`** ficarem fora do saneamento (recomendo manter fora).
4. **Backfill** do que já existe em produção (inclui fotos de documento ainda não apagadas): autorizar?
5. Aceitar a janela residual do §6 (regravação concorrente por cliente adulterado) e a verificação do owner em staging antes do go-live.
