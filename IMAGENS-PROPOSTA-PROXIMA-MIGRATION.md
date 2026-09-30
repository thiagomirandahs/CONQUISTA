# Pipeline de imagens — contrato atual, evidência e proposta para a próxima migration

Nada aqui foi migrado nesta rodada (sem mudança de caminho, bucket ou policy).

## Contrato atual do Storage (Rede)
- Bucket privado `comunidade`; limite de 300 KB e mime jpeg/webp validados no servidor; 1 imagem por post.
- Caminho exigido pelas RPCs/policies (431/472/480/490/515): `^<clube>/<uid>/<uuid>.(jpg|webp)$`, sem pasta de finalidade.
- O servidor NÃO enxerga o conteúdo do arquivo (Postgres só conhece metadados do objeto).

## EXIF/GPS: o que está provado
Prova em navegador real (Chromium do app, canvas de verdade, 30/09/2026): um JPEG com segmento APP1/Exif falso contendo
`GPSLatitude`, `GPSLongitude` e `Make=SEGREDO` passou por `otimizarFoto` com o perfil `feed` (o mesmo de `prepararFoto`,
caminho do post e do story da Rede). Saída: WebP 1,7 KB **sem** `Exif`, `GPS*` nem `SEGREDO` (entrada tinha os três).
Conclusão: pelo app oficial a foto da Rede sai sem metadados.
**Risco residual (não fechável sem mudança de servidor):** cliente adulterado pode subir o original direto no Storage.
O servidor só confere mime declarado/tamanho/caminho.

## Proposta (próxima migration, não implementada)
1. **Sanear no servidor**: Edge Function `sanear-imagem-rede` chamada por trigger/cron (ou no fluxo de aprovação) que
   baixa o objeto, recodifica (sharp/imagescript), remove EXIF/GPS, gera miniatura e regrava; post só fica `publicado`
   depois. Foto em alcance Comunidade já passa por análise (515), então o gancho natural é a aprovação.
2. **Metadados no banco**: coluna/tabela `imagem_metadata` (finalidade, bytes, largura, altura, sha256, miniatura_path,
   saneada_em) para o post, em vez de confiar no cliente.
3. **Caminho com finalidade** (`<clube>/<uid>/<finalidade>/<uuid>.<ext>`, `caminhoSeguro`): exige alterar o regex das RPCs e
   as policies juntos, com período de convivência (aceitar os dois formatos por um ciclo) e migração não destrutiva.
4. **Miniatura**: gerar no passo 1 e servir no feed (feed nunca carrega a imagem grande).
5. **Remoção**: `removerComSeguranca` só por ação explícita; o GC de Storage segue só desenhado (`STORAGE-GC-DESENHO.md`).
6. Ligar os demais fluxos (mural, avatar, evidência, documento) ao pipeline só depois do 1–3, um por vez, cada um com teste E2E de Storage.

Prioridade: proteção de criança (itens 1 e 2) antes de conveniência (3 e 4).
