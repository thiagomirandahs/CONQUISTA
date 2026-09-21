#!/usr/bin/env bash
# =============================================================================
#  Testes de banco (multi-tenant) — reprodutíveis, 100% LOCAIS.
#
#  O que faz (modo padrão = --replay):
#    1. Clona a CAMADA DE PLATAFORMA (auth, storage, extensions, cron...) do
#       Postgres local do Supabase para um banco ISOLADO ("replay_test").
#    2. Apaga o schema public desse clone e REAPLICA, do zero e em ordem,
#       TODAS as migrations de supabase/migrations/ + supabase/seed.sql.
#       (A sequência completa faz parte do risco: uma migration nova precisa
#       nascer certa depois de todas as antigas, num banco limpo.)
#    3. Roda cada supabase/tests/*.sql (arquivos com "_" na frente são
#       bibliotecas). Cada teste roda numa transação que termina em ROLLBACK.
#
#  Nunca conecta em produção/remoto: só faz `docker exec` no container local.
#  Não altera o banco de trabalho "postgres" (só o usa como modelo da plataforma;
#  suas conexões são derrubadas por ~2s e os serviços do Supabase reconectam).
#
#  Uso:
#    bash supabase/tests/run-tests.sh                 # replay do zero + todos os testes
#    bash supabase/tests/run-tests.sh --keep          # mantém o banco replay_test p/ investigar
#    bash supabase/tests/run-tests.sh --upgrade       # simula o UPGRADE de produção: schema legado + dados vivos,
#                                                     # depois aplica 20260921000001..19 e verifica (tests/upgrade/)
#    bash supabase/tests/run-tests.sh --no-replay     # só roda os testes no banco já pronto
#    bash supabase/tests/run-tests.sh --db postgres --no-replay
#                                                     # roda no banco de trabalho (ex.: depois
#                                                     # de um `supabase db reset` de verdade)
#    bash supabase/tests/run-tests.sh 03_responsavel  # só o(s) teste(s) indicado(s)
#
#  Variáveis: SUPABASE_DB_CONTAINER (padrão supabase_db_CONQUISTA), REPLAY_DB (padrão replay_test)
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash (Windows) não pode reescrever /tmp/... dos caminhos do container

CONT="${SUPABASE_DB_CONTAINER:-supabase_db_CONQUISTA}"
DB="${REPLAY_DB:-replay_test}"
REPLAY=1
KEEP=0
UPGRADE=0
ONLY=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-replay) REPLAY=0 ;;
    --replay) REPLAY=1 ;;
    --keep) KEEP=1 ;;
    --upgrade) UPGRADE=1 ;;
    --db) DB="$2"; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) ONLY+=("$1") ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WROOT="$(cygpath -w "$ROOT" 2>/dev/null || echo "$ROOT")"   # docker cp (nativo do Windows) precisa do caminho C:...
PSQL=(docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$CONT" psql -U postgres -X -q -v ON_ERROR_STOP=1)
ADMIN=(docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$CONT" psql -U supabase_admin -X -q -v ON_ERROR_STOP=1)  # superusuário local (derrubar sessões, clonar plataforma)

docker inspect "$CONT" >/dev/null 2>&1 || { echo "ERRO: container '$CONT' não existe/roda. Suba o Supabase local (Docker) antes."; exit 2; }
[ "$(docker inspect -f '{{.State.Running}}' "$CONT")" = "true" ] || { echo "ERRO: container '$CONT' parado."; exit 2; }

reabrir_postgres() { "${ADMIN[@]}" -d template1 -c "alter database postgres allow_connections true" >/dev/null 2>&1 || true; }

if [ "$REPLAY" = 1 ]; then
  echo "==> [1/4] Clonando a plataforma do Postgres local para o banco isolado '$DB'"
  trap reabrir_postgres EXIT
  "${ADMIN[@]}" -d template1 >/dev/null <<SQL || { echo "ERRO ao clonar o banco"; exit 2; }
alter database postgres allow_connections false;
select pg_terminate_backend(pid) from pg_stat_activity
 where datname in ('postgres', '$DB') and pid <> pg_backend_pid();
drop database if exists $DB with (force);
create database $DB template postgres owner postgres;
alter database postgres allow_connections true;
SQL
  trap - EXIT

  echo "==> [2/4] Limpando o clone (public vazio, ledger/auth/storage zerados)"
  "${ADMIN[@]}" -d "$DB" >/dev/null <<'SQL' || { echo "ERRO ao limpar o clone"; exit 2; }
drop schema public cascade;
create schema public authorization pg_database_owner;
grant usage on schema public to public, postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to postgres, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant execute on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to postgres, anon, authenticated, service_role;
truncate auth.users cascade;
truncate storage.objects, storage.buckets cascade;
truncate supabase_migrations.schema_migrations;
delete from cron.job;
SQL

  if [ "$UPGRADE" = 1 ]; then
    echo "==> [3/4] UPGRADE: migrations legadas -> dados de producao simulados -> 20260921000001..19 -> verificacao"
    docker exec "$CONT" rm -rf /tmp/cq_migrations /tmp/cq_tests >/dev/null 2>&1
    docker cp "$WROOT/supabase/migrations" "$CONT:/tmp/cq_migrations" >/dev/null || exit 2
    docker cp "$WROOT/supabase/tests" "$CONT:/tmp/cq_tests" >/dev/null || exit 2
    docker cp "$WROOT/supabase/PREFLIGHT-PRODUCAO.sql" "$CONT:/tmp/cq_preflight.sql" >/dev/null || exit 2
    DRIVER="$(mktemp)"; carregou=0
    {
      echo '\set ON_ERROR_STOP on'
      for f in "$ROOT"/supabase/migrations/*.sql; do
        base="$(basename "$f")"; ver="${base%%_*}"
        # 1ª migration do SaaS (20260921...): antes dela o banco é o "de produção"; carrega os dados vivos
        if [ "$carregou" = 0 ] && [[ "$ver" > "20260909000001" ]]; then echo "\echo '   [dados de producao simulados]'"; echo "\i /tmp/cq_tests/upgrade/pre_dados.sql"; echo "\echo '   [pre-voo da producao]'"; echo "\i /tmp/cq_preflight.sql"; carregou=1; fi
        echo "\echo '   migration $base'"; echo "begin;"; echo "\i /tmp/cq_migrations/$base"; echo "commit;"
      done
      echo "\echo '   [verificacao pos-upgrade]'"; echo "\i /tmp/cq_tests/upgrade/post_verificacao.sql"
    } > "$DRIVER"
    docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$CONT" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 < "$DRIVER" > "$DRIVER.log" 2>&1; rc=$?
    # o pré-voo (PREFLIGHT-PRODUCAO.sql) roda no estado "de produção" e tem que dar RESUMO ok (0 problemas)
    if [ $rc -eq 0 ] && ! grep -qi "falhou" "$DRIVER.log" && grep -qE "RESUMO +\| +ok" "$DRIVER.log"; then
      echo "   OK     upgrade de producao simulado  ($(grep -oE 'ok  - [0-9]+ asserts' "$DRIVER.log" | tail -1))"; RESULT=0
    else
      echo "   FALHOU upgrade de producao simulado"; grep -iE "falhou|error|erro|detail|^  - " "$DRIVER.log" | sed 's/^/          /' | head -30; RESULT=1
    fi
    rm -f "$DRIVER" "$DRIVER.log"
    if [ "$KEEP" = 0 ]; then "${ADMIN[@]}" -d template1 -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; fi
    exit $RESULT
  fi

  echo "==> [3/4] Reaplicando TODAS as migrations em ordem + seed"
  docker exec "$CONT" rm -rf /tmp/cq_migrations /tmp/cq_seed.sql >/dev/null 2>&1
  docker cp "$WROOT/supabase/migrations" "$CONT:/tmp/cq_migrations" >/dev/null || exit 2
  docker cp "$WROOT/supabase/seed.sql" "$CONT:/tmp/cq_seed.sql" >/dev/null || exit 2
  DRIVER="$(mktemp)"
  {
    echo '\set ON_ERROR_STOP on'
    for f in "$ROOT"/supabase/migrations/*.sql; do   # glob entre aspas: o caminho pode ter espaços
      base="$(basename "$f")"; ver="${base%%_*}"; nome="${base#*_}"; nome="${nome%.sql}"
      echo "\\echo '   migration $base'"
      echo "begin;"
      echo "\\i /tmp/cq_migrations/$base"
      echo "insert into supabase_migrations.schema_migrations (version, name) values ('$ver', '$nome') on conflict do nothing;"
      echo "commit;"
    done
    echo "\\echo '   seed.sql'"
    echo "\\i /tmp/cq_seed.sql"
  } > "$DRIVER"
  if ! docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$CONT" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 < "$DRIVER" > "$DRIVER.log" 2>&1; then
    echo "FALHOU ao reaplicar as migrations. Últimas linhas:"; tail -25 "$DRIVER.log"; rm -f "$DRIVER" "$DRIVER.log"; exit 3
  fi
  echo "   $(grep -c '   migration' "$DRIVER.log") migrations aplicadas sem erro"
  rm -f "$DRIVER" "$DRIVER.log"
fi

echo "==> [4/4] Rodando testes no banco '$DB'"
docker exec "$CONT" rm -rf /tmp/cq_tests /tmp/cq_migrations >/dev/null 2>&1
docker cp "$WROOT/supabase/migrations" "$CONT:/tmp/cq_migrations" >/dev/null || exit 2   # o teste de idempotência reaplica as migrations novas
docker cp "$WROOT/supabase/tests" "$CONT:/tmp/cq_tests" >/dev/null || exit 2
if [ ${#ONLY[@]} -gt 0 ]; then
  FILES=(); for t in "${ONLY[@]}"; do t="${t%.sql}"; FILES+=("$ROOT/supabase/tests/$t.sql"); done
else
  mapfile -t FILES < <(ls "$ROOT"/supabase/tests/*.sql | sort)
fi
PASS=0; FAIL=0; FALHAS=()
for f in "${FILES[@]}"; do
  base="$(basename "$f")"; case "$base" in _*) continue ;; esac
  out="$(docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$CONT" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 -f "/tmp/cq_tests/$base" 2>&1)"; rc=$?
  if [ $rc -eq 0 ] && ! echo "$out" | grep -q "FALHOU"; then
    PASS=$((PASS+1)); printf '   OK     %s  (%s)\n' "$base" "$(echo "$out" | grep -oE 'ok  - [0-9]+ asserts' | head -1 | grep -oE '[0-9]+ asserts')"
  else
    FAIL=$((FAIL+1)); FALHAS+=("$base"); printf '   FALHOU %s\n' "$base"; echo "$out" | grep -iE "falhou|error|erro|detail|^  - " | sed 's/^/          /' | head -25
  fi
done

if [ "$REPLAY" = 1 ] && [ "$KEEP" = 0 ]; then
  "${ADMIN[@]}" -d template1 -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
fi
echo "----------------------------------------------------------------"
echo "Testes: $PASS ok, $FAIL com falha${FALHAS:+  -> ${FALHAS[*]}}"
[ "$FAIL" = 0 ]
