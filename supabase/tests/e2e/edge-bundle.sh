#!/usr/bin/env bash
# Prova que as Edge Functions de gatilho `enviar-push`, `sanear-imagens`, `limpar-fotos-rede` e `storage-excluir` (com as dependências FIXADAS em versão exata
# e o helper compartilhado _compartilhado/chaves.ts) resolvem e empacotam no edge-runtime de verdade
# (a mesma imagem Docker que o `supabase start` usa — só local; nada é publicado). Um pin inexistente/quebrado ou import quebrado faz o bundle falhar.
#
#   npm run test:edge:bundle        (precisa do Docker e da imagem do edge-runtime; baixa os pacotes npm, sem tocar em Supabase remoto)
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IMG="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -m1 'supabase/edge-runtime' || true)"
[ -n "$IMG" ] || { echo "ERRO: imagem do edge-runtime não encontrada (rode 'supabase start' uma vez)."; exit 2; }

# todas importam ../_compartilhado/: por isso monta a pasta functions INTEIRA (somente leitura).
FDIR="$ROOT/supabase/functions"
WFDIR="$(cygpath -w "$FDIR" 2>/dev/null || echo "$FDIR")"
FALHOU=0
for FUNCAO in enviar-push sanear-imagens limpar-fotos-rede storage-excluir; do
  echo "==> empacotando $FUNCAO (com _compartilhado) com $IMG"
  if docker run --rm -v "$WFDIR:/f:ro" "$IMG" bundle --entrypoint "/f/$FUNCAO/index.ts" --output "/tmp/$FUNCAO.eszip" -q; then
    echo "OK — $FUNCAO: dependências fixadas e imports compartilhados resolvem e a função empacota."
  else
    echo "FALHOU — $FUNCAO não empacota (import do núcleo/helper, pin quebrado ou código inválido)."; FALHOU=1
  fi
done
exit $FALHOU
