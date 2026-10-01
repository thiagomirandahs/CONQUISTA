#!/usr/bin/env bash
# =============================================================================
#  ENSAIO DA JANELA DE PRODUÇÃO DA FASE 8 — 100% LOCAL (banco isolado; nunca produção).
#  Reproduz a janela: banco no estado de PRODUÇÃO (migration 513, com comprovações antigas) e aplica 514 → 516 → 515 → 517 … 527,
#  UMA por transação (lock_timeout 5s, ledger na mesma transação), exatamente como o procedimento de produção.
#  Depois de CADA migration confere que o FRONTEND ATUALMENTE PUBLICADO (eb897ef) continua funcional:
#    (a) contrato antigo (compat/post.sql, 19 asserts: comprovações antigas, formulário, fila, avaliação, rascunho antigo, outro clube);
#    (b) todas as RPCs que o front antigo chama ainda existem (contrato-rpc-front.mjs);
#    (c) a impressão digital das tabelas de comprovação antigas não mudou.
#  Para na primeira falha (como a janela real: ROLLBACK e PARE). Uso: bash supabase/tests/compat/ensaio-janela-fase8.sh
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
DB="${REPLAY_DB:-ensaio_janela}"
CONT="${SUPABASE_DB_CONTAINER:-supabase_db_CONQUISTA}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="$(cd "${TEMP:-/tmp}" && pwd)"
win() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }   # caminho nativo para ferramentas que não são do msys (git, node)
ROOTW="$(win "$ROOT")"
ANTIGO="$TMP/src_front_antigo_eb897ef"
rm -rf "$ANTIGO"; mkdir -p "$ANTIGO"; git -C "$ROOTW" archive eb897ef src | tar -x -C "$ANTIGO"
ANTIGOW="$(win "$ANTIGO")"

echo "==> [1] banco isolado '$DB' no estado de PRODUÇÃO (513) com comprovações antigas"
MAX_MIGRATION=20260930000503 REPLAY_DB="$DB" bash "$ROOT/supabase/tests/run-tests.sh" --keep 09_compat_e_hardening >/dev/null 2>&1
CQ="/tmp/cq_$DB"
docker exec -w "$CQ/cq_tests/compat" -i "$CONT" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 -f pre.sql >/dev/null || { echo "FALHOU no pre.sql"; exit 2; }
IMP() { docker exec -i "$CONT" psql -U postgres -d "$DB" -At -F' | ' < "$ROOT/supabase/tests/e2e/_impressao_comprovacoes.sql"; }
aplicar() { # $1 = arquivo; uma transação com lock_timeout e ledger
  local f="$1" b v n; b="$(basename "$f" .sql)"; v="${b%%_*}"; n="${b#*_}"
  { echo "begin; set lock_timeout='5s';"; cat "$f"; echo "insert into supabase_migrations.schema_migrations(version,name) values ('$v','$n') on conflict do nothing; commit;"; } \
    | docker exec -i "$CONT" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 >/dev/null 2>"$TMP/ensaio_err.txt" || { echo "FALHOU ao aplicar $b (ROLLBACK):"; tail -3 "$TMP/ensaio_err.txt"; exit 3; }
}
for m in 510 511 512 513; do aplicar "$(ls "$ROOT"/supabase/migrations/20260930000${m}_*.sql)"; done
LEDGER="$(docker exec "$CONT" psql -U postgres -d "$DB" -Atc "select max(version) from supabase_migrations.schema_migrations")"
[ "$LEDGER" = "20260930000513" ] || { echo "FALHOU: o banco do ensaio não ficou na 513 ($LEDGER)"; exit 2; }
ANTES="$(IMP)"
echo "==> [2] estado de produção simulado: ledger $LEDGER; impressão das comprovações antigas:"; echo "$ANTES" | sed 's/^/     /'
FALHAS=0
for m in 514 516 515 517 518 519 520 521 522 523 524 525 526 527; do
  f="$(ls "$ROOT"/supabase/migrations/20260930000${m}_*.sql)"
  aplicar "$f"
  O="$(docker exec -w "$CQ/cq_tests/compat" -i "$CONT" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 -f post.sql 2>&1)"; rc=$?
  if [ $rc -eq 0 ] && ! echo "$O" | grep -q FALHOU; then P="front antigo: contrato OK ($(echo "$O" | grep -oE '[0-9]+ asserts' | head -1))"; else P="front antigo: contrato FALHOU"; FALHAS=$((FALHAS+1)); echo "$O" | tail -8; fi
  N="$(node "$ROOTW/supabase/tests/compat/contrato-rpc-front.mjs" "$ANTIGOW/src" "$DB" 2>&1 | grep -E "AUSENTE|TODAS|rror" | head -1)"
  case "$N" in *TODAS*) N="RPCs do front antigo: todas existem";; *) FALHAS=$((FALHAS+1)); N="RPCs do front antigo: PROBLEMA ($N)";; esac
  [ "$(IMP)" = "$ANTES" ] && D="comprovações antigas idênticas" || { D="comprovações antigas MUDARAM"; FALHAS=$((FALHAS+1)); }
  echo "   $m ✓ aplicada | $P | $N | $D"
  [ $FALHAS -eq 0 ] || { echo "PARAR: a migration $m quebrou o front atualmente publicado (na janela real: ROLLBACK e PARE)."; break; }
done
docker exec "$CONT" psql -U postgres -d "$DB" -Atc "select max(version) from supabase_migrations.schema_migrations" | sed 's/^/==> ledger final do ensaio: /'
docker exec "$CONT" psql -U supabase_admin -d template1 -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
[ $FALHAS -eq 0 ] && echo "ENSAIO OK: cada migration (na ordem da janela) manteve o front antigo funcional" || { echo "ENSAIO FALHOU"; exit 1; }
