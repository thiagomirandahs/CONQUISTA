#!/usr/bin/env bash
# BACKUP LÓGICO DO BANCO (produção) — SOMENTE LEITURA. Rode logo ANTES da janela. NÃO inclui os ARQUIVOS do Storage (ver backup-storage.mjs).
# Gera: <pasta>/conquista-prod-pre-fase8.dump (pg_dump -Fc dos schemas public, auth, storage [só metadados], supabase_migrations),
#       SHA256.txt, TAMANHO.txt e LISTA-DO-DUMP.txt (pg_restore --list: prova que o arquivo é legível).
# Pasta padrão: ~/.desbravaclube-backups/pre-fase8-<data> (FORA do Git). Credencial: DB_URL_PRODUCAO de ~/.desbravaclube-prod.env (nunca impressa).
# Teste de restauração (local, descartável):  bash scripts/janela-fase8/backup-banco.sh --testar-restauracao <pasta>
set -uo pipefail
export MSYS_NO_PATHCONV=1
if [ "${1:-}" = "--testar-restauracao" ]; then
  PASTA="${2:?informe a pasta do backup}"; D="$PASTA/conquista-prod-pre-fase8.dump"
  docker exec supabase_db_CONQUISTA psql -U supabase_admin -d template1 -c "drop database if exists restore_teste with (force)" >/dev/null
  docker exec supabase_db_CONQUISTA psql -U supabase_admin -d template1 -c "create database restore_teste" >/dev/null
  PGPASSWORD=postgres pg_restore -h 127.0.0.1 -p 54322 -U supabase_admin -d restore_teste --no-owner --no-privileges "$D" 2>&1 | grep -c "error" | sed 's/^/linhas com "error" no pg_restore (esperado: poucas, ex. schema public já existe): /'
  docker exec supabase_db_CONQUISTA psql -U postgres -d restore_teste -Atc "select 'ledger', max(version) from supabase_migrations.schema_migrations; select 'memberships', count(*) from public.organization_memberships; select 'tabelas public', count(*) from pg_tables where schemaname='public'"
  docker exec supabase_db_CONQUISTA psql -U supabase_admin -d template1 -c "drop database if exists restore_teste with (force)" >/dev/null
  exit 0
fi
set -a; eval "$(sed '1s/^\xEF\xBB\xBF//' "$HOME/.desbravaclube-prod.env" | grep '^export')"; set +a
[ -n "${DB_URL_PRODUCAO:-}" ] || { echo "DB_URL_PRODUCAO ausente"; exit 2; }
PASTA="${1:-$HOME/.desbravaclube-backups/pre-fase8-$(date +%Y-%m-%d_%H%M)}"; mkdir -p "$PASTA"
D="$PASTA/conquista-prod-pre-fase8.dump"
echo "== pg_dump (somente leitura) → $PASTA"
pg_dump "$DB_URL_PRODUCAO" -Fc -n public -n auth -n storage -n supabase_migrations -f "$D" || { echo "FALHOU o pg_dump"; exit 1; }
( cd "$PASTA" && sha256sum conquista-prod-pre-fase8.dump > SHA256.txt && ls -l conquista-prod-pre-fase8.dump | awk '{print $5" bytes"}' > TAMANHO.txt )
pg_restore --list "$D" > "$PASTA/LISTA-DO-DUMP.txt" || { echo "FALHOU: o dump não é legível (pg_restore --list)"; exit 1; }
echo "tamanho: $(cat "$PASTA/TAMANHO.txt") | itens de dados de tabela no dump: $(grep -c 'TABLE DATA' "$PASTA/LISTA-DO-DUMP.txt") | $(cut -c1-16 "$PASTA/SHA256.txt")…"
psql "$DB_URL_PRODUCAO" -X -q -A -t -F' | ' -c "select 'ledger_no_momento_do_backup', max(version) from supabase_migrations.schema_migrations" | tee "$PASTA/LEDGER.txt"
cat > "$PASTA/LEIA-ME.txt" <<'EOT'
Backup LÓGICO do banco de produção (antes da janela da Fase 8). NÃO contém os arquivos do Storage (só os metadados em storage.objects).
Restaurar em banco descartável:  bash scripts/janela-fase8/backup-banco.sh --testar-restauracao <esta pasta>
NÃO guardar no Git. Guardar também uma cópia fora deste computador.
EOT
echo "== pronto. Rode agora o teste de restauração local para provar que o arquivo restaura."
