#!/usr/bin/env bash
# Prova que as Edge Functions `enviar-push` e `sanear-imagens` (com as dependências FIXADAS em versão exata) resolvem e empacotam no edge-runtime de verdade
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

# sanear-imagens importa o núcleo puro de ../_compartilhado/: por isso monta a pasta functions INTEIRA (somente leitura).
FDIR="$ROOT/supabase/functions"
WFDIR="$(cygpath -w "$FDIR" 2>/dev/null || echo "$FDIR")"
echo "==> empacotando sanear-imagens (com _compartilhado) com $IMG"
if docker run --rm -v "$WFDIR:/f:ro" "$IMG" bundle --entrypoint /f/sanear-imagens/index.ts --output /tmp/sanear-imagens.eszip -q; then
  echo "OK — sanear-imagens e o núcleo compartilhado resolvem e empacotam."
else
  echo "FALHOU — sanear-imagens não empacota (import do núcleo, pin quebrado ou código inválido)."; exit 1
fi

# storage-excluir (migration 532) também importa o núcleo puro de ../_compartilhado/ (mesma montagem).
echo "==> empacotando storage-excluir (com _compartilhado) com $IMG"
if docker run --rm -v "$WFDIR:/f:ro" "$IMG" bundle --entrypoint /f/storage-excluir/index.ts --output /tmp/storage-excluir.eszip -q; then
  echo "OK — storage-excluir e o núcleo compartilhado resolvem e empacotam."
else
  echo "FALHOU — storage-excluir não empacota (import do núcleo, pin quebrado ou código inválido)."; exit 1
fi
