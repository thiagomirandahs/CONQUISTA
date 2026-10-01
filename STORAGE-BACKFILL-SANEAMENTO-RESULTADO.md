# Backfill do saneamento de imagens — resultado (01/10/2026)

Executado em produção com o pipeline já validado (fila `imagem_saneamento` + Edge Function `sanear-imagens`). Nenhum arquivo foi apagado; HEIC, vídeos e GIF não foram tocados. Caminhos e coordenadas nunca foram impressos.

## Ferramenta
`scripts/storage-backfill-saneamento.mjs` (+ `scripts/lib/analisarImagem.mjs`): `inventario` (baixa e classifica por bytes), `preparar` (cópia de recuperação com sha256 + foto do estado: owner_id, mimetype, visibilidade dono×outro×anon avaliada com as policies reais, policies/RLS, categoria GC), `enfileirar` (só o grupo), `lote` (chama a função uma vez e verifica) e `verificar`. **Para na primeira anomalia** (código 3).

## Resultado
| | Inicial | Final |
|---|---|---|
| Imagens suportadas (JPEG/PNG/WebP) nos 4 buckets saneados | 406 | 406 |
| com **GPS** | **16** (74,5 MB) | **0** |
| com outros metadados (EXIF/XMP/IPTC/texto) | 62 (72,9 MB) | **0** |
| limpas | 328 | **406** |
| HEIC (5, 10,1 MB) / vídeos (33, 492,2 MB) | não suportados | **inalterados** (0 modificados) |

- Ordem: primeiro os 16 com GPS (3 lotes), depois os 62 restantes (5 lotes); total de 78 regravados + 20 que o cron já tinha tratado antes (98 itens na fila: 87 saneados, 11 já limpos).
- Recuperação: os 78 estavam no backup de 01/10 com o **mesmo sha256** e há cópia própria em `~/.desbravaclube-backups/backfill-2026-10-01/recuperacao` (manifesto sha256). Nenhum segredo nesses artefatos.
- Verificação de cada lote (todas passaram, exceto a exceção abaixo): imagem válida, formato igual, GPS/metadados fora, `owner_id`/`owner` iguais, mimetype igual, nome/bucket iguais, visibilidade dono/outro/anon **idêntica** à de antes, policies e RLS de `storage.objects` com o mesmo hash, categoria do GC igual (referência intacta), `sha256` coerente (muda só quando "saneada"), arquivo não cresceu.
- Os 4 arquivos `com_metadados` restantes no inventário final estão no bucket `publico` (logos; fora do escopo por decisão).

## Achados durante a execução
1. **PARADA por mimetype** (lote 3 dos "outros"): 1 arquivo de perfil (`.png`, bytes JPEG, mimetype antigo `image/png`) passou a `image/jpeg` porque a função derivava o rótulo do formato detectado. **Causa:** rótulo antigo errado + função "corrigindo" o rótulo. **Correção:** a função agora **preserva o mimetype original** do objeto; E2E novo (rótulo divergente) e redeploy. O arquivo afetado é um dos órfãos do GC; ficou registrado como exceção documentada (`excecoes.json`, local). Depois da correção os 40 itens restantes passaram sem violação.
2. **CDN do Storage mantém a versão antiga por cerca de 1 min** depois de regravar (`cf-cache-status: HIT`): verificar os bytes logo após o lote dá falso "ainda tem GPS". O `lote` agora espera 90 s. **Risco real para usuários:** quem já tinha a versão antiga em cache (CDN/navegador) pode continuar vendo a imagem com metadados até o cache vencer (`cache-control: max-age=3600`, ~1 h); não há expurgo de cache por API.
3. Meu classificador contava o EXIF mínimo de **orientação** (que o saneador mantém de propósito) como metadado; corrigido: orientação sozinha = limpo.
4. A função respeita um orçamento de 24 MB por chamada: arquivos grandes ficam reservados 5 min e voltam no ciclo seguinte (comportamento projetado, sem perda).
5. O script do teste controlado em produção assume fila vazia; durante o backfill ele processou itens reais junto — sem dano (verificação passou), mas deve ser rodado só com a fila vazia.

## Não saneado (limites conhecidos)
- **HEIC (5):** `imagens/atividades` 3 (8,5 MB) e `imagens/perfis` 2 (1,6 MB) — carregam EXIF/GPS; sem suporte no saneador.
- **Vídeos (33, 492,2 MB):** `imagens/atividades` 20 (286,7 MB) e `comprovacoes/atividades` 13 (205,5 MB) — podem ter localização embutida.
- Decisão do dono: transcodificar/ignorar/excluir. Sugestão: tratar HEIC/vídeo na carga (cliente) e deixar os antigos para o GC.
