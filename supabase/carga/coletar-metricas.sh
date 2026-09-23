#!/usr/bin/env bash
# =============================================================================
#  Fase 8.1 — coletor de métricas do servidor DURANTE o teste de carga.
#
#  Sem isto, um teste de carga responde só "quanto demorou". Com isto, responde "por que".
#  A fase 8 concluiu que o gargalo era o pool da API justamente porque mediu as conexões do
#  Postgres ao mesmo tempo e viu o banco ocioso — 11 ativas de 100 — enquanto a API já devolvia
#  5% de erro. Este script generaliza aquela coleta.
#
#  Coleta a cada 5 s, enquanto o arquivo-sentinela existir:
#    conexões totais / ativas / ociosas-em-transação / esperando lock
#    a consulta mais demorada em andamento
#    CPU e memória do container do Postgres e do container do PostgREST
#
#  Uso:  bash supabase/carga/coletar-metricas.sh <arquivo-de-saida> &
#        ... roda o k6 ...
#        rm /tmp/cq-coletando   (para o coletor)
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1

SAIDA="${1:-/tmp/metricas.txt}"
CONT_DB="${SUPABASE_DB_CONTAINER:-supabase_db_CONQUISTA}"
CONT_API="${SUPABASE_REST_CONTAINER:-supabase_rest_CONQUISTA}"
SENTINELA=/tmp/cq-coletando

touch "$SENTINELA"
: > "$SAIDA"
printf '%-9s %6s %7s %10s %8s %9s %9s %9s %9s\n' \
  hora conn ativas ocio_trans esp_lock db_cpu% db_mem api_cpu% api_mem >> "$SAIDA"

while [ -f "$SENTINELA" ]; do
  PG=$(docker exec -i "$CONT_DB" psql -U postgres -At -F'|' -c "
    select count(*),
           count(*) filter (where state = 'active'),
           count(*) filter (where state = 'idle in transaction'),
           count(*) filter (where wait_event_type = 'Lock')
      from pg_stat_activity where datname = 'postgres'" 2>/dev/null)
  ESTAT=$(docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' "$CONT_DB" "$CONT_API" 2>/dev/null)
  DBCPU=$(echo "$ESTAT" | grep "$CONT_DB" | cut -d'|' -f2)
  DBMEM=$(echo "$ESTAT" | grep "$CONT_DB" | cut -d'|' -f3 | cut -d'/' -f1 | tr -d ' ')
  APICPU=$(echo "$ESTAT" | grep "$CONT_API" | cut -d'|' -f2)
  APIMEM=$(echo "$ESTAT" | grep "$CONT_API" | cut -d'|' -f3 | cut -d'/' -f1 | tr -d ' ')
  printf '%-9s %6s %7s %10s %8s %9s %9s %9s %9s\n' \
    "$(date +%H:%M:%S)" \
    "$(echo "$PG" | cut -d'|' -f1)" "$(echo "$PG" | cut -d'|' -f2)" \
    "$(echo "$PG" | cut -d'|' -f3)" "$(echo "$PG" | cut -d'|' -f4)" \
    "${DBCPU:-?}" "${DBMEM:-?}" "${APICPU:-?}" "${APIMEM:-?}" >> "$SAIDA"
  sleep 5
done

# Resumo: o pico de cada coluna é o que importa para responder "o banco chegou perto do limite?"
{
  echo ""
  echo "--- picos observados ---"
  awk 'NR>1 {if ($2+0>c) c=$2; if ($3+0>a) a=$3; if ($4+0>t) t=$4; if ($5+0>l) l=$5}
       END {printf "conexoes=%d  ativas=%d  ociosas_em_transacao=%d  esperando_lock=%d\n", c, a, t, l}' "$SAIDA"
  echo "max_connections do servidor: $(docker exec -i "$CONT_DB" psql -U postgres -At -c 'show max_connections' 2>/dev/null)"
} >> "$SAIDA"
