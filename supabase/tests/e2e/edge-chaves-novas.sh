#!/usr/bin/env bash
# Prova que as Edge Functions operam SÓ com as chaves novas (sb_secret_/sb_publishable_), em containers descartáveis `kfn_*` (portas 54401-54405)
# ligados à rede do Supabase LOCAL. Sobe, roda os cenários e derruba tudo (mesmo se falhar). Nada remoto, nada de produção.
#   npm run test:edge:chaves-novas      (precisa de Docker + Supabase local no ar, migrations até a 532)
#
# ATENÇÃO — NÃO RODE ao mesmo tempo que o replay SQL (`supabase/tests/run-tests.sh` / `npm run test:db`): o clone do banco derruba as
# conexões do "postgres" que este E2E usa (falhas fantasma) e este E2E suja o modelo do clone. Rode UM de cada vez. Uma trava
# (supabase/tests/_trava-docker-local.sh) aborta com exit 4 se o outro estiver rodando. Só ESTE script usa os containers kfn_*.
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && (pwd -W 2>/dev/null || pwd))"
limpar() { for n in kfn_plataforma kfn_sb kfn_legacy kfn_semchave kfn_modo_nova kfn_indisp kfn_contador; do docker rm -f "$n" >/dev/null 2>&1; done; docker volume rm -f kfn_deno_cache >/dev/null 2>&1; }
. "$ROOT/supabase/tests/_trava-docker-local.sh"
travar_docker_local edge
trap 'limpar; liberar_trava_docker_local' EXIT
limpar
node "$ROOT/supabase/tests/e2e/edge-chaves-novas.mjs"
