#!/usr/bin/env bash
# Prova que as Edge Functions operam SÓ com as chaves novas (sb_secret_/sb_publishable_), em containers descartáveis `kfn_*` (portas 54401-54405)
# ligados à rede do Supabase LOCAL. Sobe, roda os cenários e derruba tudo (mesmo se falhar). Nada remoto, nada de produção.
#   npm run test:edge:chaves-novas      (precisa de Docker + Supabase local no ar, migrations até a 532)
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && (pwd -W 2>/dev/null || pwd))"
limpar() { for n in kfn_plataforma kfn_sb kfn_legacy kfn_semchave kfn_modo_nova kfn_indisp; do docker rm -f "$n" >/dev/null 2>&1; done; docker volume rm -f kfn_deno_cache >/dev/null 2>&1; }
trap limpar EXIT
limpar
node "$ROOT/supabase/tests/e2e/edge-chaves-novas.mjs"
