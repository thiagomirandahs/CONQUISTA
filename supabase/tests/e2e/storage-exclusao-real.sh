#!/usr/bin/env bash
# Sobe a Edge Function `storage-excluir` num container do edge-runtime (mesma imagem do `supabase start`) ligado à rede do Supabase LOCAL,
# roda o E2E contra o Storage real local e derruba o container. Só local; nada remoto. Precisa do Supabase local no ar COM a migration 532.
#   npm run test:storage-exclusao:e2e
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && (pwd -W 2>/dev/null || pwd))"
CONT_FN="${SUPABASE_EDGE_CONTAINER:-supabase_edge_runtime_CONQUISTA}"
NET="$(docker inspect "${SUPABASE_KONG_CONTAINER:-supabase_kong_CONQUISTA}" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')" || exit 2
IMG="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -m1 'supabase/edge-runtime')"
[ -n "$IMG" ] && [ -n "$NET" ] || { echo "ERRO: imagem do edge-runtime ou rede do Supabase local não encontradas (rode 'supabase start')."; exit 2; }
SEC="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
ENVF="$(mktemp)"; trap 'rm -f "$ENVF"; docker rm -f fn_excluir_local >/dev/null 2>&1' EXIT
printf 'SUPABASE_URL=http://supabase_kong_CONQUISTA:8000\nSUPABASE_SERVICE_ROLE_KEY=%s\nSTORAGE_EXCLUIR_SECRET=%s\n' "$(docker exec "$CONT_FN" printenv SUPABASE_SERVICE_ROLE_KEY)" "$SEC" > "$ENVF"
ENVW="$(cygpath -w "$ENVF" 2>/dev/null || echo "$ENVF")"
docker rm -f fn_excluir_local >/dev/null 2>&1
docker run -d --name fn_excluir_local --network "$NET" -p 54398:9000 --env-file "$ENVW" -v "$ROOT/supabase/functions:/f:ro" "$IMG" start --main-service /f/storage-excluir -p 9000 >/dev/null || exit 2
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null -X POST http://127.0.0.1:54398/ && break; sleep 1; done
STORAGE_EXCLUIR_SECRET="$SEC" node "$ROOT/supabase/tests/e2e/storage-exclusao-real.mjs"
