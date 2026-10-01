# HEIC: privacidade de metadados — inventário, prova de conceito e desenho

Fase 9 · 01/10/2026 · só local, só leitura nos arquivos reais · **nada foi ligado em produção e a Edge Function publicada não foi alterada.**

## 1. Inventário (anônimo)

Fonte: backup local do Storage (`storage-2026-10-01`) + inventário pós-GC (`backfill-2026-10-01/inventario-pos-gc.json`).
HEIC descobertos **pela assinatura de bytes** (`ftyp` com marca heic/heix/hevc/hevx/heim/heis/mif1/msf1/heif), nunca pela extensão.

- HEIC no backup antigo: **5**. Em produção hoje (pós-GC): **4**. Só no backup antigo, fora de produção: **1** (cópia exata de outro, mesmo tamanho).
- Todos no bucket `imagens`; 3 de atividade, 1 de avatar/perfil. Total 9,7 MB (0,85 a 5,7 MB). Todos `image/heic` no banco, extensão `.heic`, marca `heic` (compatível `mif1`).
- Todos são fotos de câmera de celular (grid de tiles hvc1, 3712x2088 a 4080x3060), com `irot` (270 ou 90 graus) — a rotação vem do `irot`, que a PoC não toca.

| Rótulo | Finalidade | Bytes | Itens | EXIF | GPS | XMP | MakerNote | Classe |
|---|---|---|---|---|---|---|---|---|
| H1 | atividade | 2.295.861 | hvc1 49, grid 1, Exif 1 | sim | **não** | não | não | METADADOS_SENSIVEIS |
| H2 | atividade | 869.418 | hvc1 49, grid 1, Exif 1 | sim | **não** | não | não | METADADOS_SENSIVEIS |
| H3 | atividade | 5.711.005 | hvc1 35, grid 2, tmap 1, Exif 1, mime 2 | sim | **não** | 2 itens (1 só de HDR, 1 com dados) | não | METADADOS_SENSIVEIS |
| H4 | avatar/perfil | 848.232 | hvc1 41, grid 1, Exif 1 | sim | **não** | não | não | METADADOS_SENSIVEIS |

Resumo: **4 de 4 com metadados sensíveis (fabricante, modelo, software, data/hora de captura, fuso, subsegundos; 2 deles com identificador único da imagem); 0 com GPS; 0 limpos.** H3 é uma foto com mapa de ganho HDR e "motion photo" (XMP com `GCamera`/`Container` + XMP funcional `hdrgm`).
Reprodução: `node scripts/storage-inventario-heic.mjs --pasta <storage-AAAA-MM-DD> --atuais <inventario-pos-gc.json> --sanear` (imprime só rótulos e contagens; não grava nada).

## 2. O que a prova de conceito faz

`scripts/lib/analisarHeic.mjs` (parse ISO-BMFF puro: `ftyp`, `meta`/`pitm`/`iinf`/`infe` v0-3/`iloc` v0-2 com `construction_method` e extents/`iref`/`iprp`: `ispe`, `irot`, `imir`, `colr`/`ipma`) e `scripts/lib/sanearHeic.mjs`.

**Neutralizar no lugar**: o item `Exif` continua com o MESMO tamanho e offset, mas o conteúdo vira `[offset 6]["Exif\0\0"][TIFF mínimo]` (só Orientation, se havia; senão 0 entradas) e o resto zerado; o item XMP (`mime` `application/rdf+xml`) vira pacote vazio + espaços. XMP **funcional** (só parâmetros numéricos `hdrgm:*` do mapa de ganho HDR, sem texto livre) é **preservado**, porque apagá-lo tira o HDR da foto. Nada de `iloc`, `iinf`, `mdat`, `hvc1/grid/tmap`, `ispe`, `irot`, `imir`, `colr` é tocado: **sem recompressão, sem mover offsets, arquivo com o mesmo tamanho**.

Salvaguardas: recusa (`nao_suportada`) se o extent do Exif/XMP sobrepuser o de outro item (nunca apaga pixel), se usar `construction_method` 2 ou extent de comprimento 0 ("até o fim"), se restarem itens de metadado desconhecidos (outro `mime`/`uri`), AVIF, marca desconhecida. Auto-verificação: depois de sanear, reanalisa e exige mesmos itens/extents/dimensões/rotação e classe LIMPO.

### O que está provado (vitest `src/lib/heicSaneamento.test.js`, 33 testes)
- Fixtures sintéticas (geradas por código): com/sem GPS, TIFF LE/BE, irot/imir, XMP (sensível, com GPS, HDR funcional), iloc v0/v1/v2, base_offset, 2 extents, Exif na `idat`, ipma 16 bits, brand desconhecida/AVIF/vídeo, truncado em todos os pontos, lixo, fuzz de 400 mutações: GPS e dados sensíveis somem; ispe/irot/hvc1/cabeçalho intactos byte a byte; tamanho igual; **só bytes dentro dos extents do Exif/XMP mudam** (comparação de intervalos); idempotente; inválido/truncado vira `invalida` sem exceção.
- Nos 4 HEIC reais (lidos em memória, nada gravado, teste pula se não existirem): só bytes dentro dos extents Exif/XMP mudariam (352 a 1.381 bytes por arquivo); o analisador aplicado ao resultado dá **LIMPO** nos 4; itens de imagem, ispe/irot e extents idênticos; Orientation preservada; segunda aplicação não altera nada.

### O que NÃO está provado
- **Decodificação**: o Chrome do ambiente não decodifica HEIC (`createImageBitmap` falha também no original), então **"decodificação NÃO verificada (sem decoder HEIC no ambiente)"**. A garantia de que a imagem é a mesma é estrutural (itens de imagem e propriedades idênticos byte a byte; só mudam bytes de itens de metadado). Antes de qualquer uso real: abrir os 4 saneados num iPhone/Safari ou Android com decoder HEIC e comparar com os originais.
- Metadados dentro do próprio bitstream HEVC (mensagens SEI) e em itens de imagem auxiliares (profundidade, mapa de ganho: são imagens, não texto) não são analisados nem removidos.
- Itens `mime` que não sejam XMP, itens `uri `, sequências (`moov`, marca `msf1` com trilhas) e HEIC com metadados fora de `Exif`/XMP: recusados (`nao_suportada`) ou apenas sinalizados, nunca "limpos" às cegas.
- Comportamento em leitores específicos (Windows Photos, Google Fotos) com Exif minimizado: não testado.

## 3. O que exigiria recompressão ou reescrita de offsets (NÃO implementado)
- **Remover** os itens Exif/XMP de verdade (apagar `infe` + `iloc` + bytes): encolhe `meta` e o `mdat`, desloca todos os extents e o `size` de várias caixas. É possível sem recomprimir pixels, mas é reescrever offsets: mais risco e mais teste; a neutralização no lugar entrega o mesmo ganho de privacidade (a única diferença é o item continuar existindo, vazio).
- Metadados dentro do bitstream (SEI) ou em itens auxiliares: exigiria parse/regravação do HEVC. Fora de escopo.
- Qualquer caso que precise de HEIC -> JPEG (compatibilidade): recodifica e perde qualidade/HDR; só no cliente, onde há decoder.

## 4. Desenho para produção (proposta; nada ativado)

**Formatos aceitos**: marcas heic, heix, hevc, hevx, heim, heis, mif1, msf1, heif **com** itens hvc1 (grid/tmap permitidos). **Recusados** (continuam `ignorado`): AVIF (avif/avis) até haver teste real, vídeos (mp42/qt/isom...), marca desconhecida. **Tamanho máximo**: o mesmo `MAX_BYTES_PADRAO` do núcleo (12 MiB; o maior real tem 5,7 MB). Acima disso: `ignorado: grande`.

**Processamento**: reaproveitar a fila `imagem_saneamento` e a Edge Function `sanear-imagens` (sem tabela nova). Mudança mínima no núcleo `supabase/functions/_compartilhado/sanear-imagem.ts`:
1. `Formato` ganha `'heic'`; `detectarFormato` reconhece `ftyp` + marca HEIC (hoje cai em `desconhecido` e vira `heic_nao_suportado`).
2. Novo arquivo `_compartilhado/sanear-heic.ts`: port TypeScript Deno-compatível (só `Uint8Array`/`DataView`, sem imports) de `analisarHeic.mjs` + `sanearHeic.mjs`. A porta é mecânica: os módulos JS já não usam nenhuma API de plataforma.
3. Em `sanearImagem`: `formato === 'heic'` -> `sanearHeic(entrada)`; mapear `saneada`->`saneada`, `limpa`->`limpa`, `invalida`->`invalida`, `nao_suportada`->`ignorado` (motivo `heic_nao_suportado`/`heic_extent`...). O contrato "nunca maior, mesmo tamanho" já vale (aqui é sempre igual).
4. `MIME` na função: `heic: 'image/heic'`. **O mimetype original é preservado**: a função regrava com o `contentType` do objeto original (ler de `blob.type`/metadata, e só cair em `image/heic` por padrão), nunca por extensão.
5. A checagem "saída confere" que a função já faz (`sanearImagem(saida)` precisa dar `limpa`) funciona sem mudança, porque o saneador é idempotente.

**Extensão ou mimetype divergentes do formato real**: sempre vale a assinatura de bytes. `.jpg` com conteúdo HEIC (ou `image/jpeg` no banco) é saneado como HEIC e regravado com o mimetype ORIGINAL do objeto (não "consertamos" o tipo: isso é decisão de produto à parte). Arquivo `.heic` cujo conteúdo é JPEG segue o caminho JPEG.

**Timeout/memória**: sem processo pesado — o parse lê só `meta` (poucos KB) e a única cópia é do arquivo (12 MiB no pior caso, dentro do `ORCAMENTO_BYTES` de 24 MiB por chamada que a função já respeita). Não há decodificação.

**Idempotência / retries / falhas**: idêntico às demais imagens: `limpa` -> `ok/ja_limpa`; `invalida` -> `falhou/invalida`; recuo e 3 tentativas pela fila; falha fecha (objeto continua como está, visível só a quem já via).

**Observabilidade**: mesmas contagens da função (`saneadas`, `ignoradas`, `falhas`, `bytes_liberados` = 0 para HEIC) + motivo curto por item na fila; incluir o formato no motivo (`heic_saneada`) ajuda a separar nos relatórios. Nenhum valor de metadado é logado.

**Preservação de owner_id**: já tratada pela fila: `dono_id` guardado na reserva e restaurado em `imagem_saneamento_marcar` após o `upload(upsert)`. Mesma regra para HEIC.

**Rollback / recuperação**: antes de regravar, copiar o original para um caminho de quarentena de bucket privado de serviço (ou, no primeiro lote, para o backup local) com `sha256` registrado no `relatorio`; só apagar a cópia depois da verificação num aparelho com decoder. Como a saída tem o mesmo tamanho e difere só em bytes de metadado, também dá para reverter regravando o original. **Piloto sugerido**: os 4 HEIC reais, com cópia prévia, conferência no iPhone/Android e só então liberar a fila.

## 5. Impacto no cliente (decisão necessária)

Hoje `src/lib/upload.js` aceita HEIC pela assinatura e `src/lib/imagem.js` (`semMetadados: true`) tenta redesenhar no canvas via `createImageBitmap`. No **Android Chrome** o HEIC não decodifica: o envio falha com "Não consegui preparar essa foto. Tente outra (JPG ou PNG)". No **iOS Safari** decodifica e o redesenho sai JPEG limpo. Os 4 HEIC em produção entraram por caminhos que não usam `semMetadados` (atividade, avatar) ou antes dessa regra.

Opções:
- **A. Recusar HEIC no cliente** (mensagem clara + dica "tire/escolha como JPG"): não aumenta superfície, mas tira o caso de uso do iPhone com "Alta eficiência" quando o seletor não converte, e não resolve os caminhos sem `semMetadados`.
- **B. Aceitar e sanear no servidor** (este desenho): o HEIC sobe como está e a fila neutraliza os metadados; o arquivo continua HEIC, que **não abre em muitos Android/navegadores** (a exibição do avatar/atividade quebra para quem não decodifica). Serve como rede de proteção, não como solução de produto.
- **Recomendação**: **combinar**. (1) Cliente continua tentando o redesenho (iOS decodifica, vira JPEG limpo) e, onde falha, **recusa com mensagem clara** nos caminhos `semMetadados`; (2) o saneamento no servidor entra como **rede de proteção** para HEIC que chegar por caminhos sem redesenho e para os 4 existentes. Decisão do dono: aceitar HEIC como formato de armazenamento (com o risco de não exibir em alguns aparelhos) ou apenas neutralizar os 4 existentes e recusar HEIC novo.

## 6. Decisões pendentes do dono
1. Autorizar neutralizar os 4 HEIC existentes (com cópia prévia + `sha256`) depois da conferência visual em aparelho com decoder?
2. Política para HEIC novo: recusar no cliente vs aceitar e sanear no servidor (seção 5).
3. Aceitar o XMP funcional `hdrgm` preservado (não é dado pessoal), em vez de apagar tudo e perder o HDR?
4. AVIF: manter fora (recomendado) ou incluir após teste com arquivos reais?
5. Autorizar o port TypeScript do núcleo (local, com testes, sem ligar na função) em rodada própria.
