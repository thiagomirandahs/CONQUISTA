#!/usr/bin/env bash
# Teste da trava supabase/tests/_trava-docker-local.sh (sem Docker): replay x edge se bloqueiam; replay x replay nao; trava velha e descartada.
#   bash supabase/tests/e2e/trava-docker-local-teste.sh
set -u
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$AQUI/../_trava-docker-local.sh"
export TMPDIR="$(mktemp -d)"
FALHAS=0
ok() { if [ "$2" = "$3" ]; then echo "   ok     $1"; else echo "   FALHOU $1 (esperado $3, veio $2)"; FALHAS=$((FALHAS+1)); fi; }

bash -c '. "$0"; travar_docker_local edge; sleep 5' "$LIB" &
sleep 1.5
bash -c '. "$0"; travar_docker_local replay' "$LIB" 2>/dev/null; ok "replay recusado com E2E de chaves rodando (exit 4)" "$?" 4
bash -c '. "$0"; travar_docker_local edge' "$LIB" 2>/dev/null; ok "segundo E2E de chaves recusado (exit 4)" "$?" 4
wait
bash -c '. "$0"; travar_docker_local edge; liberar_trava_docker_local' "$LIB"; ok "E2E de chaves livre depois que o outro terminou" "$?" 0

bash -c '. "$0"; travar_docker_local replay; sleep 5' "$LIB" &
sleep 1.5
bash -c '. "$0"; travar_docker_local edge' "$LIB" 2>/dev/null; ok "E2E de chaves recusado com replay SQL rodando (exit 4)" "$?" 4
bash -c '. "$0"; travar_docker_local replay; liberar_trava_docker_local' "$LIB"; ok "replay x replay NAO se bloqueiam (REPLAY_DB proprio segue valendo)" "$?" 0
wait
bash -c '. "$0"; travar_docker_local edge; liberar_trava_docker_local' "$LIB"; ok "E2E de chaves livre depois do replay" "$?" 0

echo 999999 > "$TMPDIR/desbravaclube-trava-docker-local.edge"
bash -c '. "$0"; travar_docker_local replay; liberar_trava_docker_local' "$LIB"; ok "trava velha (PID morto) e descartada" "$?" 0

bash -c '. "$0"; travar_docker_local edge; sleep 3' "$LIB" &
sleep 1
( TRAVA_DOCKER_LOCAL_IGNORAR=1; . "$LIB"; TRAVA_DOCKER_LOCAL_IGNORAR=1 travar_docker_local replay ) 2>/dev/null; ok "TRAVA_DOCKER_LOCAL_IGNORAR=1 contorna (com aviso)" "$?" 0
wait
rm -rf "$TMPDIR"
[ "$FALHAS" = 0 ] && echo "TRAVA OK" || { echo "$FALHAS falha(s)"; exit 1; }
