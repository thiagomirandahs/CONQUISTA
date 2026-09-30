#!/usr/bin/env bash
# =============================================================================
#  Compatibilidade das migrations 510–513 com dados que JÁ EXISTEM (fase 7). 100% LOCAL (docker exec no container local).
#    1) monta um banco isolado no estado da migration 503 (o de produção hoje);
#    2) grava comprovações ANTIGAS pelo caminho de sempre (compat/pre.sql);
#    3) tira a IMPRESSÃO DIGITAL das tabelas antigas (e2e/_impressao_comprovacoes.sql);
#    4) aplica 510, 511, 512 e 513 (cada uma em transação);
#    5) confere que a impressão digital é IDÊNTICA e roda compat/post.sql (o motor novo convive com o antigo).
#  Uso: bash supabase/tests/compat/compat-510-513.sh        (npm run test:db:compat)
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
DB="${REPLAY_DB:-compat_f7}"
CONT="${SUPABASE_DB_CONTAINER:-supabase_db_CONQUISTA}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
echo "==> [1/5] banco isolado '$DB' no estado da migration 503 (reaplica as migrations até lá)"
MAX_MIGRATION=20260930000503 REPLAY_DB="$DB" bash "$ROOT/supabase/tests/run-tests.sh" --keep 09_compat_e_hardening >/dev/null 2>&1
docker exec "$CONT" psql -U postgres -d "$DB" -Atc "select max(version) from supabase_migrations.schema_migrations" | grep -q "^20260930000503$" || { echo "FALHOU: o banco não ficou na 503"; exit 2; }
CQ="/tmp/cq_$DB"
echo "==> [2/5] comprovações ANTIGAS (caminho de sempre)"
docker exec -w "$CQ/cq_tests/compat" -i "$CONT" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 -f pre.sql >/dev/null || { echo "FALHOU no pre.sql"; exit 2; }
IMP() { docker exec -i "$CONT" psql -U postgres -d "$DB" -At -F' | ' < "$ROOT/supabase/tests/e2e/_impressao_comprovacoes.sql"; }
ANTES="$(IMP)"
echo "==> [3/5] impressão digital ANTES:"; echo "$ANTES" | sed 's/^/     /'
echo "==> [4/5] aplicando 510, 511, 512 e 513 (cada uma em transação)"
for f in "$ROOT"/supabase/migrations/20260930000510_*.sql "$ROOT"/supabase/migrations/20260930000511_*.sql "$ROOT"/supabase/migrations/20260930000512_*.sql "$ROOT"/supabase/migrations/20260930000513_*.sql; do
  b="$(basename "$f")"; echo "     $b"
  { echo "begin;"; cat "$f"; echo "commit;"; } | docker exec -i "$CONT" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 >/dev/null || { echo "FALHOU ao aplicar $b"; exit 3; }
done
DEPOIS="$(IMP)"
echo "==> [5/5] conferindo"
if [ "$ANTES" = "$DEPOIS" ]; then echo "   OK     comprovações antigas IDÊNTICAS (linhas e hash de cada tabela)"; else echo "   FALHOU impressão digital mudou:"; diff <(echo "$ANTES") <(echo "$DEPOIS"); exit 4; fi
OUT="$(docker exec -w "$CQ/cq_tests/compat" -i "$CONT" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 -f post.sql 2>&1)"; rc=$?
if [ $rc -eq 0 ] && ! echo "$OUT" | grep -q FALHOU; then echo "   OK     post.sql ($(echo "$OUT" | grep -oE '[0-9]+ asserts' | head -1))"; else echo "   FALHOU post.sql"; echo "$OUT" | tail -20; exit 5; fi
docker exec "$CONT" psql -U supabase_admin -d template1 -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
echo "COMPATIBILIDADE OK"
