#!/usr/bin/env bash
# =============================================================================
#  Fase 8.1 — roda um degrau de carga com a coleta de métricas do servidor junto.
#
#  Usar os dois juntos é o ponto: o k6 diz QUANTO demorou, o coletor diz POR QUE. Foi assim que a
#  fase 8 descobriu que o gargalo não era o banco (11 conexões ativas de 100 enquanto a API já
#  devolvia 5% de erro).
#
#  Uso:  bash supabase/carga/rodar-carga.sh <degrau>
#        degraus: base (20-50-100) | fino (100-450) | joelho (25-300) | alto (300-800) | completo (50-1200)
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1

DEGRAU="${1:-base}"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
SAIDA="/tmp/carga-$DEGRAU"
ANON="${ANON:-$(npx --yes supabase@2.117.0 status -o env 2>/dev/null | grep '^ANON_KEY=' | cut -d'"' -f2)}"
[ -z "$ANON" ] && { echo "sem ANON_KEY — o stack local está no ar?"; exit 1; }

echo "=== degrau: $DEGRAU ==="
bash "$RAIZ/supabase/carga/coletar-metricas.sh" "$SAIDA-servidor.txt" &
COLETOR=$!
sleep 2

docker run --rm -v "$RAIZ/supabase/carga:/carga" \
  -e ANON="$ANON" -e USERS=//carga/usuarios.json -e DEGRAU="$DEGRAU" \
  grafana/k6 run --no-color --summary-trend-stats='avg,med,p(95),p(99),max' //carga/k6-mix.js \
  > "$SAIDA-k6.txt" 2>&1

rm -f /tmp/cq-coletando
wait $COLETOR 2>/dev/null

echo ""
echo "--- k6 ---"
grep -E "^\s+(op_|http_req_duration|http_req_failed|http_reqs|iterations|checks_succeeded|erros|vus_max)" "$SAIDA-k6.txt" \
  | sed 's/^ */  /'
echo ""
echo "--- servidor (picos) ---"
tail -4 "$SAIDA-servidor.txt" | sed 's/^/  /'
echo ""
echo "  detalhes: $SAIDA-k6.txt  e  $SAIDA-servidor.txt"
