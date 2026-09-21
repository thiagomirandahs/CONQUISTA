#!/usr/bin/env bash
# Prova que a Edge Function `enviar-push` (com as dependências FIXADAS em versão exata) resolve e empacota no edge-runtime de verdade
# (a mesma imagem Docker que o `supabase start` usa — só local; nada é publicado). Um pin inexistente/quebrado faz o bundle falhar.
#
#   npm run test:edge:bundle        (precisa do Docker e da imagem do edge-runtime; baixa os pacotes npm, sem tocar em Supabase remoto)
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DIR="$ROOT/supabase/functions/enviar-push"
WDIR="$(cygpath -w "$DIR" 2>/dev/null || echo "$DIR")"
IMG="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -m1 'supabase/edge-runtime' || true)"
[ -n "$IMG" ] || { echo "ERRO: imagem do edge-runtime não encontrada (rode 'supabase start' uma vez)."; exit 2; }
echo "==> empacotando enviar-push com $IMG"
if docker run --rm -v "$WDIR:/f:ro" "$IMG" bundle --entrypoint /f/index.ts --output /tmp/enviar-push.eszip -q; then
  echo "OK — as dependências fixadas resolvem e a função empacota."
else
  echo "FALHOU — a função não empacota (pin quebrado ou código inválido)."; exit 1
fi
