#!/usr/bin/env bash
# =============================================================================
#  Fase 8.1 — RESTORE DE VERDADE, em ambiente descartável (blocker B1).
#
#  "Backup sem restore testado não conta como estratégia de recuperação." Até aqui existia backup
#  (o automático do Supabase) e nunca ninguém tinha restaurado nada. Isso não é uma estratégia —
#  é uma esperança.
#
#  O que este script faz, e por que cada passo:
#    1. dump completo do banco de trabalho (com o dataset sintético carregado, para o tempo medido
#       significar alguma coisa: restaurar um banco vazio não prova nada);
#    2. cria um banco NOVO e descartável no mesmo Postgres;
#    3. restaura;
#    4. CONFERE o que foi restaurado — contagem por tabela, funções, policies, gatilhos e cron.
#       Um restore que termina sem erro mas perde as policies devolve um banco com os dados de
#       todo mundo visíveis para todo mundo. É o passo que separa "o comando rodou" de
#       "o sistema volta";
#    5. mede cada fase e imprime o RTO observado;
#    6. derruba o banco descartável.
#
#  NUNCA toca em produção: tudo acontece dentro do container local do Supabase.
#
#  Uso:  bash supabase/infra/restaurar-teste.sh [--manter]
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash (Windows) não pode reescrever os caminhos do container

CONT="${SUPABASE_DB_CONTAINER:-supabase_db_CONQUISTA}"
ORIGEM="${ORIGEM_DB:-postgres}"
ALVO="restore_teste"
MANTER=0
[ "${1:-}" = "--manter" ] && MANTER=1

psql_() { docker exec -i "$CONT" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
agora() { date +%s; }

echo "=============================================================="
echo " RESTORE EM AMBIENTE DESCARTÁVEL"
echo " origem: $ORIGEM   alvo: $ALVO   container: $CONT"
echo "=============================================================="

# ---------------------------------------------------------------------------
# Antes: o retrato do que PRECISA voltar.
# ---------------------------------------------------------------------------
echo ""
echo "-- retrato do banco de origem --"
RETRATO=$(psql_ -d "$ORIGEM" -At -F'|' -c "
  select 'tabelas',   count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
  union all select 'funcoes',  count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  union all select 'policies', count(*) from pg_policies where schemaname='public'
  union all select 'gatilhos', count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
                                join pg_namespace n on n.oid=c.relnamespace
                                where n.nspname='public' and not t.tgisinternal
  union all select 'indices',  count(*) from pg_indexes where schemaname='public'
  union all select 'rls_ligada', count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                                where n.nspname='public' and c.relkind='r' and c.relrowsecurity
  union all select 'perfis',   count(*) from public.profiles
  union all select 'clubes',   count(*) from public.organizational_units
  union all select 'pontos',   count(*) from public.pontos
  union all select 'chat',     count(*) from public.chat_mensagens
  order by 1")
echo "$RETRATO" | sed 's/|/ = /' | sed 's/^/   /'
TAMANHO=$(psql_ -d "$ORIGEM" -At -c "select pg_size_pretty(pg_database_size('$ORIGEM'))")
echo "   tamanho do banco = $TAMANHO"

# ---------------------------------------------------------------------------
# 1. Dump
# ---------------------------------------------------------------------------
echo ""
echo "-- 1. dump --"
T0=$(agora)
docker exec -i "$CONT" pg_dump -U postgres -Fc -f /tmp/backup-teste.dump "$ORIGEM" || { echo "FALHOU: pg_dump"; exit 1; }
T1=$(agora)
BYTES=$(docker exec -i "$CONT" stat -c %s /tmp/backup-teste.dump)
echo "   dump concluído em $((T1-T0))s  ($(numfmt --to=iec "$BYTES" 2>/dev/null || echo "$BYTES bytes"))"

# ---------------------------------------------------------------------------
# 2 e 3. Banco novo + restore
# ---------------------------------------------------------------------------
echo ""
echo "-- 2. banco descartável --"
psql_ -d postgres -c "drop database if exists $ALVO with (force)" >/dev/null
psql_ -d postgres -c "create database $ALVO" >/dev/null
echo "   $ALVO criado"

echo ""
echo "-- 3. restore --"
T2=$(agora)
# `--no-owner` sim, `--no-acl` NÃO. A primeira versão deste script usava os dois, e o resultado
# passou em todas as contagens — tabelas, policies, linhas — e mesmo assim o banco restaurado
# estava INUTILIZÁVEL: sem os GRANTs, `authenticated` não lia uma única tabela. A RLS decide quem
# vê o quê DEPOIS do grant; sem grant, não há o que decidir. É a diferença entre um restore que
# termina e um sistema que volta, e só a leitura de verdade do passo 5 pega isso.
SAIDA=$(docker exec -i "$CONT" pg_restore -U postgres -d "$ALVO" --no-owner /tmp/backup-teste.dump 2>&1)
T3=$(agora)
ERROS=$(echo "$SAIDA" | grep -c "^pg_restore: error" || true)
echo "   restore concluído em $((T3-T2))s  (mensagens de erro: $ERROS)"
[ "$ERROS" -gt 0 ] && echo "$SAIDA" | grep "^pg_restore: error" | head -5 | sed 's/^/      /'

# ---------------------------------------------------------------------------
# 4. A conferência que importa
# ---------------------------------------------------------------------------
echo ""
echo "-- 4. o que voltou --"
DEPOIS=$(psql_ -d "$ALVO" -At -F'|' -c "
  select 'tabelas',   count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
  union all select 'funcoes',  count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  union all select 'policies', count(*) from pg_policies where schemaname='public'
  union all select 'gatilhos', count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
                                join pg_namespace n on n.oid=c.relnamespace
                                where n.nspname='public' and not t.tgisinternal
  union all select 'indices',  count(*) from pg_indexes where schemaname='public'
  union all select 'rls_ligada', count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                                where n.nspname='public' and c.relkind='r' and c.relrowsecurity
  union all select 'perfis',   count(*) from public.profiles
  union all select 'clubes',   count(*) from public.organizational_units
  union all select 'pontos',   count(*) from public.pontos
  union all select 'chat',     count(*) from public.chat_mensagens
  order by 1")

FALHAS=0
while IFS='|' read -r chave valor; do
  antes=$(echo "$RETRATO" | grep "^$chave|" | cut -d'|' -f2)
  if [ "$antes" = "$valor" ]; then
    printf "   OK      %-12s %s\n" "$chave" "$valor"
  else
    printf "   FALHOU  %-12s origem=%s  restaurado=%s\n" "$chave" "$antes" "$valor"
    FALHAS=$((FALHAS+1))
  fi
done <<< "$DEPOIS"

# O detalhe que um "contou tudo certo" esconde: RLS ligada mas SEM policy é um banco onde
# ninguém lê nada, e RLS desligada é um banco onde todo mundo lê tudo. As duas voltam erradas
# em silêncio se o restore perder metadado.
echo ""
echo "-- 5. as duas checagens que a contagem não pega --"
SEM_POLICY=$(psql_ -d "$ALVO" -At -c "
  select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname)")
echo "   tabelas com RLS ligada e ZERO policy: $SEM_POLICY (quanto menor, melhor; >0 merece olhada)"

# Uma leitura de verdade, como `authenticated`, para provar que a autorização voltou funcionando
# e não só que as linhas de pg_policies existem.
ISOLAMENTO=$(docker exec -i "$CONT" psql -U postgres -d "$ALVO" -At -c "
  select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles limit 1), 'role','authenticated')::text, false) is not null as ignore;
  set role authenticated;
  select count(*) from public.profiles;" 2>&1 | grep -E '^[0-9]+$|permission denied' | tail -1)
TOTAL_PERFIS=$(psql_ -d "$ALVO" -At -c "select count(*) from public.profiles")
if echo "$ISOLAMENTO" | grep -qi "permission denied"; then
  echo "   FALHOU  leitura como authenticated: PERMISSÃO NEGADA — o restore trouxe os dados mas não os GRANTs"
  FALHAS=$((FALHAS+1))
else
  echo "   OK      leitura como authenticated: vê $ISOLAMENTO de $TOTAL_PERFIS perfis (grant + RLS funcionando)"
fi

# ---------------------------------------------------------------------------
# RTO
# ---------------------------------------------------------------------------
echo ""
echo "=============================================================="
echo " RTO OBSERVADO (banco de $TAMANHO)"
echo "   dump ............ $((T1-T0))s"
echo "   criar banco ..... ~0s"
echo "   restore ......... $((T3-T2))s"
echo "   TOTAL ........... $((T3-T0))s"
echo ""
echo " Leitura: este é o tempo de MÁQUINA, num Postgres local, com o banco"
echo " parado. O RTO real soma a decisão humana, o provisionamento do projeto"
echo " novo e o reapontamento do app. Vale como piso, não como promessa."
echo "=============================================================="
[ "$FALHAS" -eq 0 ] && echo " RESULTADO: restore ÍNTEGRO ($FALHAS divergências)" || echo " RESULTADO: $FALHAS DIVERGÊNCIAS — investigar antes de confiar neste backup"

if [ "$MANTER" -eq 0 ]; then
  psql_ -d postgres -c "drop database if exists $ALVO with (force)" >/dev/null
  docker exec -i "$CONT" rm -f /tmp/backup-teste.dump
  echo " (ambiente descartável removido; use --manter para inspecionar)"
fi
exit "$FALHAS"
