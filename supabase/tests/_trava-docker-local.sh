#!/usr/bin/env bash
# Trava simples para impedir a execucao CONCORRENTE de duas coisas que usam o MESMO Supabase/Docker local e se atrapalham:
#   * supabase/tests/run-tests.sh (replay SQL)  -> clona o banco "postgres" e DERRUBA as conexoes dele por ~2 s;
#   * supabase/tests/e2e/edge-chaves-novas.sh   -> mantem containers kfn_* e fixtures que usam o banco "postgres" por ~10 min.
# Rodando juntos, o clone derruba conexoes do E2E (falhas "fantasma") e o E2E suja o modelo do clone. Rode UM de cada vez.
#
# Duas execucoes de run-tests.sh entre si NAO se bloqueiam (continua valendo REPLAY_DB proprio, como em CLAUDE.md); so ha exclusao
# mutua ENTRE os dois grupos. Funciona entre worktrees (a trava fica no diretorio temporario do sistema).
# Trava velha (processo morto) e descartada sozinha. Emergencia: TRAVA_DOCKER_LOCAL_IGNORAR=1 (aviso; por sua conta e risco).
#
# Uso (com `source`):  travar_docker_local edge|replay   ...   (a liberacao e automatica via liberar_trava_docker_local no EXIT)
_TRAVA_BASE="${TMPDIR:-/tmp}/desbravaclube-trava-docker-local"
_TRAVA_EDGE="$_TRAVA_BASE.edge"          # arquivo com o PID do E2E das chaves
_TRAVA_REPLAY="$_TRAVA_BASE.replay.d"    # um arquivo por PID de replay SQL em andamento
_TRAVA_MEU=""

_trava_viva() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

_trava_replays_vivos() {
  local f p
  [ -d "$_TRAVA_REPLAY" ] || return 0
  for f in "$_TRAVA_REPLAY"/*; do
    [ -e "$f" ] || continue
    p="$(basename "$f")"
    if _trava_viva "$p"; then echo "$p"; else rm -f "$f"; fi
  done
}

liberar_trava_docker_local() {
  [ -n "$_TRAVA_MEU" ] || return 0
  case "$_TRAVA_MEU" in
    edge)   [ "$(cat "$_TRAVA_EDGE" 2>/dev/null)" = "$$" ] && rm -f "$_TRAVA_EDGE" ;;
    replay) rm -f "$_TRAVA_REPLAY/$$" ;;
  esac
  _TRAVA_MEU=""
}

travar_docker_local() {
  local tipo="$1" outro
  if [ "${TRAVA_DOCKER_LOCAL_IGNORAR:-}" = "1" ]; then
    echo "AVISO: TRAVA_DOCKER_LOCAL_IGNORAR=1 - sem protecao contra execucao concorrente (replay SQL x E2E de chaves)." >&2
    return 0
  fi
  mkdir -p "$_TRAVA_REPLAY"
  if [ "$tipo" = "edge" ]; then
    outro="$(cat "$_TRAVA_EDGE" 2>/dev/null)"
    if _trava_viva "$outro" && [ "$outro" != "$$" ]; then
      echo "ERRO: outro E2E de chaves (edge-chaves-novas) esta rodando (PID $outro). Espere terminar; nunca rode dois ao mesmo tempo." >&2; exit 4
    fi
    outro="$(_trava_replays_vivos | head -1)"
    if [ -n "$outro" ]; then
      echo "ERRO: um replay SQL (supabase/tests/run-tests.sh, PID $outro) esta rodando. O clone do banco derruba conexoes e invalida este E2E. Rode UM de cada vez." >&2; exit 4
    fi
    echo "$$" > "$_TRAVA_EDGE"
    _TRAVA_MEU=edge
  else
    outro="$(cat "$_TRAVA_EDGE" 2>/dev/null)"
    if _trava_viva "$outro"; then
      echo "ERRO: o E2E de chaves (edge-chaves-novas, PID $outro) esta rodando e usa o mesmo Supabase local. O clone do banco derrubaria as conexoes dele. Rode UM de cada vez." >&2; exit 4
    fi
    echo "$$" > "$_TRAVA_REPLAY/$$"
    _TRAVA_MEU=replay
  fi
}
