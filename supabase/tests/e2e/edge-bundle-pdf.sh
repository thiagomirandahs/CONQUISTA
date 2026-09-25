#!/usr/bin/env bash
# Prova que as Edge Functions de documento/PDF (com as dependências FIXADAS em versão exata)
# resolvem e empacotam no edge-runtime de verdade (a mesma imagem Docker que o `supabase start` usa —
# só local; nada é publicado). Um pin inexistente/quebrado faz o bundle falhar.
#
#   npm run test:edge:bundle:pdf    (precisa do Docker e da imagem do edge-runtime)
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IMG="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -m1 'supabase/edge-runtime' || true)"
[ -n "$IMG" ] || { echo "ERRO: imagem do edge-runtime não encontrada (rode 'supabase start' uma vez)."; exit 2; }

FALHOU=0
for FUNCAO in gerar-documento-pdf gerar-documento-pdf-final; do
  DIR="$ROOT/supabase/functions/$FUNCAO"
  WDIR="$(cygpath -w "$DIR" 2>/dev/null || echo "$DIR")"
  echo "==> empacotando $FUNCAO com $IMG"
  if docker run --rm -v "$WDIR:/f:ro" "$IMG" bundle --entrypoint /f/index.ts --output "/tmp/$FUNCAO.eszip" -q; then
    echo "OK — $FUNCAO: as dependências fixadas resolvem e a função empacota."
  else
    echo "FALHOU — $FUNCAO não empacota (pin quebrado ou código inválido)."
    FALHOU=1
  fi
done
exit $FALHOU
