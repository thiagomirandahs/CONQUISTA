# Privacidade de vídeos: inventário e remoção de metadados SEM recodificar — desenho e prova de conceito

Fase 9. **Somente local.** Nada foi aplicado em produção, nenhum arquivo real foi alterado, copiado ou versionado, nenhuma chamada ao Supabase hospedado foi feita.
Peças novas: `scripts/lib/analisarMp4.mjs` (analisador), `scripts/lib/sanearMp4.mjs` (neutralização no lugar), `scripts/lib/mp4Sintetico.mjs` (gerador de fixtures sintéticas),
`scripts/lib/leitorArquivo.mjs` (leitura posicionada), `scripts/storage-inventario-video.mjs` (inventário), `src/lib/videoSaneamentoMp4.test.js` (34 testes).

## 1. Inventário dos vídeos em produção (anônimo; só agregados)

Fonte: cópia local do Storage de 01/10 (somente leitura), filtrada pelo inventário pós-limpeza (`inventario-pos-gc.json`): são **30 vídeos atuais, 449,1 MB, 8,7 min somados**.
O backup tinha 33; **3 vídeos do backup não existem mais em produção** (não analisados). Só cabeçalhos de caixas de topo e o `moov` foram lidos; o `mdat` nunca.

| Item | Resultado |
|---|---|
| Classe | **14 metadados não sensíveis**, **14 metadados sensíveis**, **2 localização/GPS**, 0 limpo, 0 inválido, 0 não suportado |
| Sinais encontrados (nº de arquivos) | creation_time 18 · aparelho/modelo/software/versão do SO 16 · localização 2 · texto livre (autor 3GPP) 1 · encoder genérico 1 |
| Localização | 2 arquivos (os dois `.mov` QuickTime de iPhone, ISO6709 na `meta` do filme). Nenhuma localização em trilha de metadados |
| Container | 25 `mp4` (marca mp42), 1 `mp4` (isom), 4 `mov` (qt) |
| Codec de vídeo / áudio | avc1 29, hvc1 1 / mp4a 24 (6 arquivos sem áudio) |
| Resolução | 1920x1080 (13), 464x832 (7), 1280x720 (3), 478x850 (3), 576x1024 (2), 720x1280 (1), 474x850 (1) |
| Rotação (matriz do tkhd) | 0° (14), 90° (12), 270° (4) |
| Posição do `moov` | início/faststart **26**, fim **4** (nenhum fragmentado; nenhum `mdat` > 4 GB) |
| Offsets (`stco`/`stsz`/`stsc` x `mdat`) | **consistentes nos 30** |
| Finalidade | 17 em `imagens/atividades/…` (legado, anterior ao limite de 15 MB do bucket `imagens`) e 13 em `comprovacoes/…/atividades` |
| Tamanho | menor ≈ 1 MB, maior 44,6 MB (todos abaixo do limite de 60 MiB do bucket `comprovacoes`) |
| Átomos não classificados | `beam` de topo (11 arquivos, 16 bytes de payload), `smta`/`SDLN`/`smrd` (Samsung, 1 cada), 4 itens `mdta` de um editor (chaves técnicas, ex. encoder) |

Todos os 30 são MP4/MOV; não há WebM no acervo atual.
**Metade dos vídeos (16 de 30) tem algo que a PoC neutralizaria** (61 regiões, **1.795 bytes no total**). Os outros 14 só têm creation_time/encoder/átomos desconhecidos.
Observação: a classe "sensível" é majoritariamente `com.android.version` (versão do Android) na `meta` (13 arquivos), um identificador de aparelho/SO. É decisão do dono se isso conta como sensível (aqui foi tratado como sensível).

Reprodução: `node scripts/storage-inventario-video.mjs --pasta <storage-AAAA-MM-DD> --atuais <inventario-pos-gc.json>` (imprime só agregados e rótulos V1..V30).

## 2. O que a PoC faz

**Neutralizar no lugar**, preservando tamanho e posição de todo byte que não seja um átomo sensível:

| Alvo | Ação |
|---|---|
| `©xyz`, `loci`, `©mak`, `©mod`, `©swr`, `©too` (só se citar SO/aparelho), textos livres (`©cmt`, `auth`, `©nam`…), `uuid` XMP, `XMP_` | tipo vira `free`, payload zerado, `size` (e largesize) intactos |
| `meta` QuickTime (mdta): itens de `ilst` de localização/aparelho/identificador/texto | o item vira `free` do mesmo tamanho e o **texto da chave correspondente em `keys` é zerado** (contagem de chaves e índices dos itens restantes intactos) |
| creation/modification em `mvhd`/`tkhd`/`mdhd`, `©day`, `creationdate` | **opcional** (`zerarDatas`), decisão do dono; por padrão ficam |
| localização em trilha de metadados (mebx/camm/gpmd), remoção de caixa, mover `moov`, recodificar | **não implementado: `exige_reescrita`**, nada é aplicado |

Por que `meta` item a item e não "meta inteira vira free": preserva itens benignos (creationdate) e deixa a `meta` válida mesmo quando só parte é sensível. Por que `free` e não remover: remover desloca todos os offsets de `stco/co64` (e o `moov` que vem antes do `mdat` mudaria de tamanho), o que é reescrita.
Resultado: `{ estado: 'saneada' | 'limpa' | 'invalida' | 'nao_suportada' | 'exige_reescrita', bytes }`; tamanho de saída = entrada; idempotente (segunda passada = `limpa`, bytes idênticos); entrada truncada/inválida devolve `invalida` sem lançar.

### Prova (34 testes, `src/lib/videoSaneamentoMp4.test.js`)
Fixtures **sintéticas por código**: ftyp, moov{mvhd, trak{tkhd, mdia{mdhd, hdlr, minf{stbl{stsd, stts, stsc, stsz, stco|co64}}}}, udta, meta}, mdat de ruído. Variantes: ©xyz, mdta location, loci, aparelho, comentário, XMP, rotação 0/90/180/270, `moov` no início e no fim, mdat com largesize, **mdat > 4 GB simulado com `co64` (6 GB virtuais, leitor sem alocar memória)**, truncado em 5 pontos, ruído, texto, WebM, HEIF, `moov` com tamanho absurdo, sem `moov`.
Provado por teste: a localização/aparelho somem dos bytes; tamanho igual; **diff de intervalos: todo byte alterado está dentro de uma região neutralizada**; sha256 de **cada `mdat` e `stbl` idêntico**; largura/altura/rotação/duração/codecs idênticos (tkhd); offsets `stco/co64 x stsz x stsc` continuam dentro do `mdat`; o moov reanalisado pelo próprio analisador é válido e sem sinais; idempotência.

**Nos 30 vídeos reais** (o teste PULA se a cópia não existir; carrega só o `moov`, não grava nada, não imprime conteúdo): para cada um, regiões ⊂ `moov`, nenhuma encosta no `mdat`, diff dentro do `moov` só nas regiões, `stbl` idêntico, reanálise sem localização/aparelho/texto/identificador, offsets consistentes, dimensões/rotação/duração/codec idênticos. Resultado: 16 `saneada`, 14 `limpa`, 0 `exige_reescrita`.

### O que a PoC NÃO prova (honestidade)
- **Reprodutibilidade NÃO foi verificada por decodificação.** Não há player/ffmpeg no ambiente e não consegui gerar um MP4 decodificável sem encoder. Substituí por prova estrutural (offsets, tamanhos, nenhum byte de `mdat`/`stbl` alterado). Como `free`/zeros são válidos pela especificação ISO-BMFF/QuickTime, o risco é baixo, mas **falta ensaio em players reais** (Chrome desktop, Android WebView/ExoPlayer, Safari iOS, VLC) com cópias dos arquivos, antes de qualquer uso.
- Não prova que o vídeo ficou anônimo: **imagem e voz continuam**; o fluxo H.264/HEVC pode ter SEI/`user_data` dentro do `mdat` (ex.: string do encoder) e a PoC não toca em streams. Também não trata nomes de handler (`hdlr`), átomos desconhecidos (`beam`, `smta`…) nem chaves `mdta` desconhecidas (ficam e são contados).
- Não cobre WebM/Matroska (reportado como "FORMATO NÃO SUPORTADO"), vídeo fragmentado (fMP4) com metadados em `moof` (não analisado) nem `moov` comprimido (`cmov`, recusado).
- Não foi testado streaming de upload no Storage (ver §4): é desenho, não medição.

## 3. Formatos e limite
- **Suportados:** MP4/M4V/3GP/MOV (ISO-BMFF/QuickTime), `moov` no início ou no fim, `mdat` com largesize, `co64`.
- **Recusados/pendentes:** WebM/Matroska (o bucket aceita `video/webm`; exige outro parser: Segments/Tags/`Info`, regravação de EBML com `Void` do mesmo tamanho; não implementado), HEIF (imagem), `cmov`, fMP4.
- **Tamanho máximo:** o bucket `comprovacoes` aceita 62.914.560 B (60 MiB) e o cliente já limita a 60 MB (`validarMidia`). O saneador não depende de tamanho (lê só cabeçalhos + `moov`); o limite prático vem do canal de regravação (§4). Sugestão: teto de processamento 64 MiB, acima disso `ignorado` com código.

## 4. Onde processar

Fato que molda tudo: **o Storage não tem escrita parcial**. Trocar 2 KB dentro de um vídeo de 40 MB exige **regravar o objeto inteiro**. Por isso a neutralização em tamanho constante é valiosa: o `Content-Length` da regravação é conhecido (igual ao original) e dá para **transmitir em fluxo** (leitura em stream do original, troca de bytes nos intervalos conhecidos, upload em stream), com memória O(trecho).

| Alternativa | Como | Memória/tempo | Custo/risco |
|---|---|---|---|
| **A. Edge Function** com Range + stream | Range do fim/início só para achar `moov` (KB a poucos MB), plano de regiões, depois `fetch` do original → TransformStream que só substitui bytes nas regiões → upload com `Content-Length` igual | memória baixa (chunk), mas o **tempo é de 2 transferências do arquivo inteiro** (≈ 40 MB x 2); limites da plataforma de memória (≈ 256 MB), CPU por requisição (poucos segundos) e tempo de relógio (150–400 s conforme plano) **precisam ser confirmados no projeto** | zero infraestrutura nova, reaproveita a Edge Function de imagens como molde; **streaming de upload não foi testado** (ensaio em staging obrigatório). **Não baixar o arquivo inteiro em memória** (60 MB + cópia estoura ≈ 256 MB) |
| **B. Worker externo** (job em GitHub Actions/VM pequena/Cloud Run) com a service key | mesmo algoritmo, sem limite de memória/CPU da Edge | folga total; arquivos de 60 MB em segundos | custo fixo baixo (≈ uma VM mínima ou minutos de CI) + segredo fora do Supabase + operação; indicado se a Edge Function não aguentar o fluxo |
| **C. No cliente** (File.slice + Blob) | antes do envio, ler `moov`, montar `new Blob([fatia, zeros, fatia…])` do mesmo tamanho; **sem recodificar** | memória: só o `moov` (KB–MB); fatias do `mdat` são referências, não cópias; roda em Android WebView/Chrome/Safari | o servidor **não confia** no cliente (cliente adulterado sobe o original); mas o dado sensível **nunca chega ao servidor** quando funciona (melhor para LGPD) |
| **D. C + A/B** (recomendado) | cliente remove (melhor esforço) e a fila no servidor confere/regrava o que sobrou | | duas camadas; o servidor é a garantia, o cliente reduz exposição |

### Operação (para a fila)
- **Fila:** recomendo **fila própria** `video_saneamento` (mesmo molde de `imagem_saneamento`, migration 529: RLS sem policy, RPCs service_role, cron) em vez de reaproveitar a de imagens: a de imagens tem `check` de buckets, teto de 12 MiB, lotes de 8 e regrava com decodificação trivial; vídeo tem limites, tempos e estados diferentes (`exige_reescrita`, `mime_diverge`, `sha256_stream`). Se for criada, a migration termina com `select public._manutencao_instalar_guarda();` (teste 100).
- **Timeout/memória:** 1 vídeo por invocação, lote pequeno, teto de bytes e de tempo por chamada; vídeo acima do teto = `ignorado` com código (nunca "meio processado").
- **Idempotência:** analisar primeiro; `limpa` não regrava (sem escrita à toa, sem gasto de banda); `saneada` é seguida de nova análise do resultado; conferência de versão (`updated_at`) antes de regravar para não sobrescrever objeto trocado no meio do caminho (como na 529).
- **Retries:** até 3 com espera crescente para erro de rede/timeout; `invalida`, `nao_suportada`, `exige_reescrita` não repetem (viram estado terminal com código para o /admin).
- **Verificação:** sha256 do `mdat` calculado em fluxo na leitura e na releitura da cópia nova (Range) precisam bater; tamanho igual; reanálise do `moov` sem sinais.
- **owner_id e mimetype:** regravar com `contentType` = mimetype ORIGINAL do objeto (não o inferido), mesmo `cacheControl`, e **restaurar `owner_id`** depois (a regravação por service_role zera o dono; a 529 já faz isso). O caminho nunca muda (o banco referencia o caminho).
- **Extensão ou mimetype divergem do conteúdo** (ex.: `.mp4` com assinatura `qt`, ou mimetype `video/webm` com conteúdo MP4): decide-se **pela assinatura**, não pela extensão; processa e **mantém** extensão/mimetype; registra código `mime_diverge` para observação. Conteúdo que não é vídeo = `ignorado`.
- **Rollback/recuperação:** o risco real é corromper o vídeo da criança. Mitigação: (1) verificação acima antes de confirmar; (2) cópia prévia com sha256 em área de quarentena privada **só até a verificação passar** (horas, não dias; a cópia guarda justamente os dados sensíveis, então retê-la por muito tempo desfaz o objetivo); (3) falha na verificação = restaura da quarentena e marca `falha`. Como só 1,8 KB a poucos KB mudam, uma alternativa sem quarentena do arquivo é guardar no registro da fila apenas `sha256` antes/depois e os intervalos (sem os valores): permite **detectar**, não restaurar. **Decisão do dono** (§6).
- **Observabilidade:** só contagens, códigos e bytes (por estado/formato/codec/duração do processamento); nunca nome de arquivo, owner, coordenada, aparelho ou texto. Alerta se `exige_reescrita`, `invalida` ou falha de verificação > 0.

## 5. Cliente (`src/lib/upload.js`)
Hoje `subirComprovacao({ permitirVideo: true })` valida (tipo real pelo cabeçalho, 60 MB) e envia o **ORIGINAL** sem tratar metadados (só imagem passa por `comprimirImagem`). Vídeo vai com GPS/aparelho se o aparelho gravou. `solicitarSaneamento` (imagem) é chamado, mas a Edge Function atual **ignora** o que não é JPEG/PNG/WebP.
Remover no cliente **é possível sem recodificar**: o mesmo plano de regiões vira um `Blob` de fatias (`file.slice`) e zeros, com tamanho idêntico e sem copiar o `mdat`. Para vídeo grande a leitura do `moov` no fim do arquivo é uma fatia final. Política proposta: manter o limite de **60 MB**; aplicar a remoção como melhor esforço (em qualquer erro, enviar o original, nunca bloquear o envio nem aguardar rede), enfileirar para o servidor conferir (como já se faz para imagens) e **não** prometer anonimato na interface (a imagem e a voz continuam).

## 6. Decisões do dono
1. Tratar `com.android.version` / marca e modelo / versão do SO como **sensíveis** (hoje: sim)?
2. **Zerar datas** (creation/modification, `©day`, `creationdate`)? Padrão da PoC: não.
3. Átomos **desconhecidos** (`beam`, `smta`, chaves de editor): neutralizar também (mais agressivo, menos informação) ou manter?
4. Onde processar: Edge Function (A), worker (B), cliente (C) ou combinado (D, recomendado)? Autoriza ensaio de streaming em **staging**?
5. **Quarentena** da cópia original durante a verificação (e por quantas horas) ou só hash?
6. WebM: recusar no envio (só mp4/mov) ou investir em parser Matroska?
7. Vídeos legados em `imagens/atividades/…` (17 de 30): processar no backfill ou apagar/migrar de bucket?
8. Antes de qualquer aplicação: ensaio de reprodução em players reais com cópias.
