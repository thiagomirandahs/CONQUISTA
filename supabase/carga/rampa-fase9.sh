#!/usr/bin/env bash
# =============================================================================
#  Fase 9, item 10 — a rampa no STAGING, uma família por vez, com o servidor medido junto.
#
#  NÃO-VALIDANTE: mede esta máquina (ver o cabeçalho de k6-rampa-fase9.js).
#
#  Por família: zera o pg_stat_statements, liga o coletor (conexões, locks, CPU/memória do banco e
#  da API), roda o k6, desliga o coletor e guarda as 8 consultas que mais custaram no período.
#  Depois do upload, apaga os arquivos que ele criou (objetos e disco do Storage).
#
#  Pré-requisitos: dataset de carga no staging (gerar-dataset.sql) e tokens ES256 assinados com a
#  chave do staging:  CHAVE_JWK=staging/supabase/signing_keys.json node supabase/carga/gerar-tokens.mjs supabase/carga/usuarios-staging.json
#
#  Uso:  bash supabase/carga/rampa-fase9.sh [leitura escrita upload rajada]
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
WRAIZ="$(cygpath -w "$RAIZ" 2>/dev/null || echo "$RAIZ")"
DB=supabase_db_CONQUISTA-STAGING
STORAGE=supabase_storage_CONQUISTA-STAGING
ANON="$(grep '^VITE_SUPABASE_ANON_KEY=' "$RAIZ/.env.staging" | cut -d= -f2- | tr -d '\r')"
SAIDA="$RAIZ/supabase/e2e/evidencias-fase9/carga"
mkdir -p "$SAIDA"
FAMILIAS=("${@:-leitura escrita upload rajada}")
[ $# -eq 0 ] && FAMILIAS=(leitura escrita upload rajada)

psql_() { docker exec -i "$DB" psql -U supabase_admin -d postgres -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }

for F in "${FAMILIAS[@]}"; do
  echo "=== família: $F ==="
  psql_ -c "select pg_stat_statements_reset();" >/dev/null
  SUPABASE_DB_CONTAINER=$DB SUPABASE_REST_CONTAINER=supabase_rest_CONQUISTA-STAGING \
    bash "$RAIZ/supabase/carga/coletar-metricas.sh" "$SAIDA/$F-servidor.txt" &
  COLETOR=$!
  sleep 2
  docker run --rm -v "$WRAIZ/supabase/carga:/carga" -w /carga \
    -e ANON="$ANON" -e FAMILIA="$F" -e USERS=/carga/usuarios-staging.json \
    grafana/k6 run --no-color --quiet /carga/k6-rampa-fase9.js > "$SAIDA/$F-k6.txt" 2>&1
  rm -f /tmp/cq-coletando
  wait $COLETOR 2>/dev/null
  {
    echo "--- as 8 consultas que mais custaram durante a família $F (pg_stat_statements) ---"
    psql_ -F ' | ' -c "select calls, round(total_exec_time)::bigint as total_ms, round(mean_exec_time::numeric, 2) as media_ms,
                               left(regexp_replace(query, '\s+', ' ', 'g'), 110)
                          from pg_stat_statements
                         where dbid = (select oid from pg_database where datname = 'postgres')
                         order by total_exec_time desc limit 8;"
  } > "$SAIDA/$F-consultas.txt"
  if [ "$F" = escrita ]; then
    N=$(psql_ -c "with f as (delete from public.fotos where legenda = 'carga-rampa' returning 1),
                       m as (delete from public.chat_mensagens where texto like 'carga %' and created_at > now() - interval '2 hours' returning 1)
                  select (select count(*) from f) || ' foto(s) e ' || (select count(*) from m) || ' mensagem(ns)';")
    echo "   limpeza da escrita: $N"
  fi
  if [ "$F" = upload ]; then
    # O Storage proíbe DELETE direto nas tabelas dele (storage.protect_delete) — um freio contra
    # objeto órfão. A 1ª rodada apagou os arquivos do disco e FALHOU no metadado, deixando 18.966
    # linhas órfãs. A flag abaixo é o caminho que o próprio gatilho oferece para limpeza deliberada.
    N=$(psql_ <<'SQL' | tail -1
begin;
set local storage.allow_delete_query = 'true';
with d as (delete from storage.objects where bucket_id = 'imagens' and name like 'mural/%-carga-%' returning 1) select count(*) from d;
commit;
SQL
)
    docker exec "$STORAGE" sh -c "find /mnt -path '*mural*-carga-*' -exec rm -rf {} + 2>/dev/null; true"
    echo "   limpeza do upload: $N objeto(s) do Storage apagados (metadado e disco)"
  fi
  sed -n '/^família:/,$p' "$SAIDA/$F-k6.txt"
  tail -3 "$SAIDA/$F-servidor.txt"
  echo ""
  # Resfriamento entre famílias. Medido na 1ª rodada: a família que aborta com milhares de conexões
  # deixa a rede do Docker (host.docker.internal, no Windows) entupida por ~1 min, e a família
  # seguinte registrou 3,6% de falha no degrau de 50 usuários — falha da ANTERIOR, não dela.
  sleep 90
done
