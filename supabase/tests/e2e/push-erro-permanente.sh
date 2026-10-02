#!/usr/bin/env bash
# E2E do tratamento de erro de push (migration 534 + enviar-push) contra um PROVEDOR FALSO local, em containers descartaveis `kpe_*`
# (portas 54411-54414 e 54420) ligados a rede do Supabase LOCAL. Sobe, roda, derruba tudo (mesmo se falhar). Nada remoto, nada de producao.
#   npm run test:push:e2e      (Docker + Supabase local no ar COM a migration 534 aplicada localmente)
# Usa o mesmo Supabase local que o replay SQL e o E2E de chaves: a trava (supabase/tests/_trava-docker-local.sh) impede rodar juntos.
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && (pwd -W 2>/dev/null || pwd))"
limpar() { for n in kpe_fake kpe_edge kpe_oauth503 kpe_oauth401 kpe_badjson; do docker rm -f "$n" >/dev/null 2>&1; done; docker volume rm -f kpe_deno_cache >/dev/null 2>&1; }
. "$ROOT/supabase/tests/_trava-docker-local.sh"
travar_docker_local edge
trap 'limpar; liberar_trava_docker_local' EXIT
limpar
node "$ROOT/supabase/tests/e2e/push-erro-permanente.mjs"
