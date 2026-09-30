# src/lib/imagens/ — pipeline central de imagens

Infraestrutura reaproveitável (Rede/Comunidade, relatórios, capas, avatar). Não confundir com
`src/lib/imagens.js` (URLs assinadas do bucket `imagens`). O legado (`lib/imagem.js`: `comprimirImagem`,
`otimizarFoto`; `lib/upload.js`) continua intacto e em uso.

## Contrato

- `validarImagem(file, {maxBytes=15MB, maxLado=12000, maxPixels=100M})` -> `{mime, ext, largura, altura, bytes}`.
  Tipo por assinatura (magic bytes) JPEG/PNG/WebP; ignora `file.type` e extensão; recusa SVG/GIF/HEIC/HTML/PDF,
  vazio, corrompido, gigante e "bomba" de dimensões (lidas do cabeçalho, sem decodificar). Erros em pt-BR.
- `PERFIS` / `perfilDe(nome)`: `avatar`, `feed` (= FOTO_REDE: 1080 px, 150 KB, WebP), `miniatura`, `mural`,
  `evidencia` e `documento` (JPEG, 2048/2560 px, qualidade >= 0,8: sem compressão social agressiva).
- `processarImagem(file, perfil)` -> `{principal, miniatura, largura, altura, bytes, mime, finalidade, bytesOriginal}`.
  Re-renderiza em canvas (só pixels: EXIF/GPS somem; orientação aplicada), WebP com fallback JPEG. Nunca devolve o original:
  se falhar, lança erro. O parâmetro `deps` existe para testes.
- `caminhoSeguro({clubId, usuarioId, finalidade, extensao})` -> `<clubId>/<usuarioId>/<finalidade>/<uuid>.<ext>`.
  Sem nome original; ids só `[A-Za-z0-9_-]`; `clubId` obrigatório; extensão só jpg/jpeg/png/webp.
- `montarUpload(resultado, {clubId, usuarioId, comHash})` -> `{uploads:[{path, blob, contentType}] (principal, miniatura), metadata}`.
  Não sobe nada. `metadata` é JSON puro `{finalidade, bytes, largura, altura, mime, sha256?}`.
- `removerComSeguranca(bucket, paths, {supabase, clubId})`: só remove se TODOS os caminhos começam por `clubId/`
  (sem `..`, `//`, `\`); sem `clubId` recusa. Remoção explícita — **não é GC**, nada a chama automaticamente.

## Servidor x cliente

| Regra | Onde |
|---|---|
| Limite 300 KB do bucket `comunidade`, policies de Storage, regex do path nas RPCs (`^<clube>/<uid>/<uuid>.(jpg\|webp)$`), triagem, moderação | Servidor (autoridade) |
| MIME real, dimensões, re-render sem EXIF, perfis, montagem de caminho | Cliente (conveniência + defesa em camadas) |

## Integração atual

Só `prepararFoto` (post da Rede, `src/services/rede.js`): validação de MIME real + números do perfil `feed`.
O caminho e o limite de 300 KB continuam os de sempre. **Divergência**: as RPCs da Rede (migrations 431/472/480/490)
exigem `<clube>/<uid>/<uuid>.<ext>` SEM pasta de finalidade; por isso `caminhoSeguro`/`montarUpload` NÃO foram ligados à Rede
(exigiriam migration nova). Stories, avatar, mural e demais uploads seguem no legado. Efeito de comportamento: post da Rede
agora recusa GIF e HEIC (antes o GIF virava um quadro estático).

## Riscos residuais

- EXIF/GPS só é removido **no cliente**. Um cliente adulterado pode subir o original: o servidor não reprocessa imagem
  (sem IA/pipeline de imagem no servidor ainda).
- Os magic bytes provam o início do arquivo, não que o restante é uma imagem sã (polyglot); a defesa final é servir via
  bucket privado/URL assinada e o decode no canvas.
- Dimensões vêm do cabeçalho declarado; a decodificação real ainda pode falhar (tratada como erro).
- `sha256` é opcional e não é prova de integridade contra o próprio cliente.
