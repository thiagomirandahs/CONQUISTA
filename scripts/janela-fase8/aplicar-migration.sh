#!/usr/bin/env bash
# =============================================================================
#  JANELA DE PRODUÇÃO — FASE 8: aplica UMA migration por vez, em UMA transação (lock_timeout 5 s), com o ledger na MESMA transação.
#  NÃO EXECUTAR sem a autorização explícita do dono para a janela. Sem a variável CONFIRMO_JANELA_FASE8=SIM faz só o PLANO (nada é gravado).
#
#    bash scripts/janela-fase8/aplicar-migration.sh 514            # plano (confere ordem/ledger e mostra o que faria)
#    CONFIRMO_JANELA_FASE8=SIM bash scripts/janela-fase8/aplicar-migration.sh 514   # APLICA a 514
#
#  Ordem OBRIGATÓRIA: 514 516 515 517 518 519 520 521 522 523 524 525 526 527 (Fase 8) e 528 529 530 531 (Fase 9, infra/segurança); o frontend só depois. O script recusa fora de ordem.
#  Nunca: migration repair, db reset, db push --linked, editar o ledger à mão, force push.
#  Credencial: DB_URL_PRODUCAO de ~/.desbravaclube-prod.env (nunca impressa).
#  Gravar em PRODUÇÃO exige TAMBÉM JANELA_PRODUCAO_AUTORIZADA_PELO_DONO=SIM. Ensaio local: JANELA_DB_URL=postgresql://...@127.0.0.1:54322/<banco>.
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
N="${1:-}"
ORDEM=(514 516 515 517 518 519 520 521 522 523 524 525 526 527 528 529 530 531 532 533 534 535 536 537 538 539 540)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && (pwd -W 2>/dev/null || pwd))"
LOGS="$HOME/.desbravaclube-backups/janela-fase8"; mkdir -p "$LOGS"
[ -n "$N" ] || { echo "uso: aplicar-migration.sh <514|516|515|...|532|533|534|535|536|537|538|539|540>"; exit 2; }
POS=-1; for i in "${!ORDEM[@]}"; do [ "${ORDEM[$i]}" = "$N" ] && POS=$i; done
[ $POS -ge 0 ] || { echo "migration $N não faz parte da janela (ordem: ${ORDEM[*]})"; exit 2; }
ARQ="$(ls "$ROOT"/supabase/migrations/20260930000${N}_*.sql 2>/dev/null | head -1)"
[ -f "$ARQ" ] || { echo "arquivo da migration $N não encontrado"; exit 2; }
if [ -n "${JANELA_DB_URL:-}" ]; then
  DB_URL_PRODUCAO="$JANELA_DB_URL"; ALVO="LOCAL(ensaio)"; echo "== ENSAIO: JANELA_DB_URL definido (banco LOCAL), a produção NÃO é tocada"
else
  ALVO="PRODUÇÃO"
  # TRAVA DUPLA: gravar em PRODUÇÃO exige, além de CONFIRMO_JANELA_FASE8=SIM, a variável JANELA_PRODUCAO_AUTORIZADA_PELO_DONO=SIM (só na janela autorizada)
  if [ "${CONFIRMO_JANELA_FASE8:-}" = "SIM" ] && [ "${JANELA_PRODUCAO_AUTORIZADA_PELO_DONO:-}" != "SIM" ]; then echo "RECUSADO: gravar em PRODUÇÃO exige JANELA_PRODUCAO_AUTORIZADA_PELO_DONO=SIM (janela autorizada). Para ensaio local use JANELA_DB_URL."; exit 6; fi
  set -a; eval "$(sed '1s/^\xEF\xBB\xBF//' "$HOME/.desbravaclube-prod.env" | grep '^export')"; set +a
fi
[ -n "${DB_URL_PRODUCAO:-}" ] || { echo "URL do banco ausente"; exit 2; }
P() { psql "$DB_URL_PRODUCAO" -X -q -A -t -F' | ' "$@"; }

VER="20260930000$N"; NOME="$(basename "$ARQ" .sql)"; NOME="${NOME#*_}"
LEDGER="$(P -c "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations where version between '20260930000514' and '20260930000540'")"
MAX="$(P -c "select max(version) from supabase_migrations.schema_migrations")"
echo "== ledger atual: máximo=$MAX ; já aplicadas da fase 8: ${LEDGER:-nenhuma}"
# pré-condições de ordem
for i in "${!ORDEM[@]}"; do
  V="20260930000${ORDEM[$i]}"; TEM=0; case ",$LEDGER," in *",$V,"*) TEM=1;; esac
  if [ $i -lt $POS ] && [ $TEM -eq 0 ]; then echo "RECUSADO: a anterior ${ORDEM[$i]} ainda não está no ledger (a ordem da janela é obrigatória)."; exit 3; fi
  if [ $i -ge $POS ] && [ $TEM -eq 1 ]; then echo "RECUSADO: $V (ou posterior) já está no ledger — nada a fazer / estado inesperado. PARE e avise o dono."; exit 3; fi
done
[ $POS -ne 0 ] || [ "$MAX" = "20260930000513" ] || { echo "RECUSADO: antes da 514 o ledger devia terminar na 513 (está em $MAX)."; exit 3; }

echo "== PRÉ: leitura geral + impressão digital do Tenant 001 (salvas em $LOGS)"
P -f "$ROOT/scripts/janela-fase8/00-pre-leitura.sql" > "$LOGS/$N-pre-leitura.txt" 2>&1
P -f "$ROOT/supabase/tests/e2e/_impressao_tenant001.sql" > "$LOGS/$N-tenant001-antes.txt" 2>&1
grep -q "psql: erro" "$LOGS/$N-pre-leitura.txt" "$LOGS/$N-tenant001-antes.txt" && { echo "FALHA: leituras pré não rodaram (arquivo SQL ilegível). PARE antes de gravar."; exit 7; }
wc -l "$LOGS/$N-pre-leitura.txt" "$LOGS/$N-tenant001-antes.txt" | sed 's/^/   /'

if [ "${CONFIRMO_JANELA_FASE8:-}" != "SIM" ]; then
  echo "== PLANO (nada foi gravado): aplicaria $NOME ($VER) numa transação com lock_timeout 5 s e ledger na mesma transação."
  echo "   Para aplicar de verdade: CONFIRMO_JANELA_FASE8=SIM bash scripts/janela-fase8/aplicar-migration.sh $N"; exit 0
fi

echo "== APLICANDO em $ALVO: $NOME ($VER) — UMA transação"
TMPSQL="$LOGS/$N-migration-com-ledger.sql"; TMPW="$(cd "$LOGS" && (pwd -W 2>/dev/null || pwd))/$N-migration-com-ledger.sql"   # caminho nativo para o psql
{ echo "set lock_timeout = '5s'; set statement_timeout = '300s';"; cat "$ARQ"; echo; echo "insert into supabase_migrations.schema_migrations(version, name) values ('$VER', '$NOME');"; } > "$TMPSQL"
if ! psql "$DB_URL_PRODUCAO" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$TMPW" > "$LOGS/$N-aplicacao.txt" 2>&1; then
  echo "FALHOU: a transação foi DESFEITA (ROLLBACK automático). PARE. Últimas linhas:"; tail -5 "$LOGS/$N-aplicacao.txt"; exit 1
fi

echo "== PÓS"
P -f "$ROOT/supabase/tests/e2e/_impressao_tenant001.sql" > "$LOGS/$N-tenant001-depois.txt" 2>&1
if diff -q "$LOGS/$N-tenant001-antes.txt" "$LOGS/$N-tenant001-depois.txt" >/dev/null; then echo "   Tenant 001: impressão digital IDÊNTICA antes × depois"; else echo "   ATENÇÃO: impressão do Tenant 001 MUDOU:"; diff "$LOGS/$N-tenant001-antes.txt" "$LOGS/$N-tenant001-depois.txt" | head -10; echo "   PARE e avalie (a migration foi aplicada; NÃO há rollback automático depois do commit)."; exit 4; fi
P -c "select 'ledger_max', max(version) from supabase_migrations.schema_migrations"
P -f "$ROOT/scripts/janela-fase8/99-pos-invariantes.sql" | tee "$LOGS/$N-invariantes.txt" | grep -E "FALHOU" && { echo "INVARIANTE FALHOU — PARE."; exit 5; }
echo "== $N OK. Próxima: $( [ $((POS+1)) -lt ${#ORDEM[@]} ] && echo ${ORDEM[$((POS+1))]} || echo 'nenhuma — publicar o FRONTEND (fast-forward da main) conforme o plano' )"
