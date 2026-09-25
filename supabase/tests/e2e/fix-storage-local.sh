#!/usr/bin/env bash
# =============================================================================
# CORREÇÃO REPRODUZÍVEL de um bug real do Supabase CLI 2.117.0 no ambiente
# local (Fase 4, Blocos 1-2). Rode isto depois de QUALQUER `supabase start`
# ou `npm run db:reset` — o CLI sempre recria o container do Storage com a
# imagem pinada (v1.72.1), que é a que tem o bug.
#
#   bash supabase/tests/e2e/fix-storage-local.sh
#   npm run test:storage:e2e     # deve dar 48/48 depois
#
# CAUSA RAIZ (as DUAS partes, achadas nesta investigação):
#
#   1) 42P10 em QUALQUER upload/upsert, em QUALQUER bucket: o CLI 2.117.0 pina
#      storage-api:v1.72.1, mas as MIGRATIONS de schema do Storage que o
#      próprio CLI aplica vão até a #72 ("drop-bucketid-objname-index"), que
#      troca o índice único simples em (bucket_id, name) por dois índices
#      PARCIAIS (para dar suporte a versionamento de objeto). O storage-api
#      v1.72.1 ainda faz `INSERT ... ON CONFLICT (name, bucket_id)` esperando
#      aquele índice simples — sem ele, o Postgres não acha um "arbiter" e
#      QUALQUER upsert falha. Confirmado com `\d storage.objects`: só existem
#      os dois índices parciais + um índice único de 3 colunas com `version`,
#      nenhum simples em (bucket_id, name).
#
#   2) Ao trocar para storage-api:v1.77.5 (que já não tem o bug 1), uploads
#      autenticados por SESSÃO DE USUÁRIO (GoTrue) passaram a falhar com
#      `"alg" (Algorithm) Header Parameter value not allowed`. Descoberto o
#      motivo lendo o bundle da própria imagem
#      (`docker run --entrypoint sh storage-api:v1.77.5 -c 'cat
#      /app/dist/internal/auth/jwt.js'`): a lista de algoritmos JWT aceitos
#      (`getJWTAlgorithms`) só inclui ES256/RS256/EdDSA quando o storage-api
#      consegue LER `config.jwtJWKS` (populada a partir da variável de
#      ambiente `JWT_JWKS`) — sem ela, cai no default `[jwtAlgorithm]` =
#      `["HS256"]`, e por isso rejeitava os JWTs ES256 que o GoTrue local
#      emite de verdade (confirmado decodificando um token real:
#      `{"alg":"ES256","kid":"b81269f1-..."}`, o MESMO `kid` que já estava no
#      `JWT_JWKS` do container original v1.72.1). Ou seja: **não era um
#      problema do storage-api v1.77.5 nem do GoTrue** — era eu, ao recriar o
#      container manualmente numa tentativa anterior, tendo ESQUECIDO de
#      passar a variável `JWT_JWKS` (só copiei ANON_KEY/SERVICE_KEY/
#      AUTH_JWT_SECRET). Com `JWT_JWKS` presente, v1.77.5 verifica os tokens
#      ES256 corretamente E não tem mais o bug do índice — as duas causas
#      eram independentes, e a "solução simples" (trocar de imagem) sempre
#      esteve certa; só faltava um env var.
#
# POR QUE NÃO BASTA "clonar a config do container antigo": também é preciso
# `MSYS_NO_PATHCONV=1` no Git Bash/MSYS do Windows — sem isso, valores de env
# que PARECEM caminho Unix (`/mnt`, `/storage/v1`, `/storage/v1/upload/
# resumable`) são reescritos para caminhos Windows (`C:/Program Files/Git/
# mnt`) pela camada de compatibilidade do MSYS, silenciosamente. O storage-api
# tolerou isso o bastante pra passar no smoke test do upload básico, mas
# deixaria os caminhos ERRADOS num container "permanente" — por isso o export
# abaixo.
#
# NADA no schema deste projeto mudou: nenhuma migration de negócio alterada,
# nenhum índice manual criado "pra silenciar" o 42P10 (a imagem nova já usa os
# índices parciais corretos, sem precisar de nada extra), nenhuma validação de
# JWT desabilitada (ela está mais completa agora, não menos), nenhuma chave de
# serviço exposta no frontend.
#
# QUANDO ISTO DEIXA DE SER NECESSÁRIO: quando o Supabase CLI publicar um
# binário Windows >= 2.118 (ou outra versão que já pine um storage-api >=
# v1.77.5) — nesta sessão, `npx supabase@2.118.0` falhou com "No matching
# Supabase CLI binary package found for win32-x64".
# =============================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1
CONT="${SUPABASE_STORAGE_CONTAINER:-supabase_storage_CONQUISTA}"
IMG_NOVA="public.ecr.aws/supabase/storage-api:v1.77.5"
NETWORK="${SUPABASE_NETWORK:-supabase_network_CONQUISTA}"
VOLUME_MNT="${SUPABASE_STORAGE_VOLUME:-supabase_storage_CONQUISTA}"

if ! docker image inspect "$IMG_NOVA" >/dev/null 2>&1; then
  echo "==> baixando $IMG_NOVA (só a primeira vez)"
  docker pull "$IMG_NOVA"
fi

echo "==> lendo ANON_KEY/SERVICE_KEY/AUTH_JWT_SECRET/JWT_JWKS do container atual ($CONT)"
ANON_KEY=$(docker inspect "$CONT" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^ANON_KEY=//p')
SERVICE_KEY=$(docker inspect "$CONT" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^SERVICE_KEY=//p')
AUTH_JWT_SECRET=$(docker inspect "$CONT" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^AUTH_JWT_SECRET=//p')
JWT_JWKS=$(docker inspect "$CONT" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^JWT_JWKS=//p')
S3_KEY_ID=$(docker inspect "$CONT" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^S3_PROTOCOL_ACCESS_KEY_ID=//p')
S3_KEY_SECRET=$(docker inspect "$CONT" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^S3_PROTOCOL_ACCESS_KEY_SECRET=//p')

if [ -z "$ANON_KEY" ] || [ -z "$JWT_JWKS" ]; then
  echo "ERRO: não consegui ler ANON_KEY/JWT_JWKS de $CONT (ele está rodando com a config esperada?)."
  exit 2
fi

echo "==> removendo $CONT (só o container — o volume de dados fica intacto)"
docker rm -f "$CONT" >/dev/null

echo "==> recriando $CONT com $IMG_NOVA"
docker run -d --name "$CONT" --network "$NETWORK" \
  -e VECTOR_ENABLED=true -e AUTH_JWT_SECRET="$AUTH_JWT_SECRET" -e JWT_JWKS="$JWT_JWKS" \
  -e GLOBAL_S3_BUCKET=stub -e TUS_URL_PATH=/storage/v1/upload/resumable -e VECTOR_BUCKET_PROVIDER=pgvector \
  -e VECTOR_DATABASE_URL="postgresql://postgres:postgres@supabase_db_CONQUISTA:5432/postgres" \
  -e IMAGE_TRANSFORMATION_ENABLED=false -e IMGPROXY_URL="http://supabase_imgproxy_CONQUISTA:5001" \
  -e S3_PROTOCOL_ACCESS_KEY_ID="$S3_KEY_ID" -e S3_PROTOCOL_PREFIX=/storage/v1 \
  -e VECTOR_STORE_MIGRATIONS_ENABLED=true \
  -e ANON_KEY="$ANON_KEY" -e SERVICE_KEY="$SERVICE_KEY" \
  -e DATABASE_URL="postgresql://supabase_storage_admin:postgres@supabase_db_CONQUISTA:5432/postgres" \
  -e FILE_SIZE_LIMIT=52428800 -e FILE_STORAGE_BACKEND_PATH=/mnt -e TENANT_ID=stub \
  -e ENABLE_IMAGE_TRANSFORMATION=false -e STORAGE_BACKEND=file -e STORAGE_S3_REGION=local \
  -e S3_PROTOCOL_ENABLED=true -e S3_PROTOCOL_ACCESS_KEY_SECRET="$S3_KEY_SECRET" \
  -e UPLOAD_FILE_SIZE_LIMIT=52428800000 -e UPLOAD_FILE_SIZE_LIMIT_STANDARD=5242880000 -e SIGNED_UPLOAD_URL_EXPIRATION_TIME=7200 \
  -v "$VOLUME_MNT:/mnt" \
  "$IMG_NOVA" >/dev/null

sleep 3
if docker logs "$CONT" --tail 5 2>&1 | grep -q "Started Successfully"; then
  echo "OK — $CONT no ar com $IMG_NOVA. Rode: npm run test:storage:e2e"
else
  echo "AVISO: não confirmei 'Started Successfully' nos logs — confira manualmente: docker logs $CONT"
fi
