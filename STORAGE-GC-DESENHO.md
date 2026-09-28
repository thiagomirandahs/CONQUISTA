# Coleta de arquivos órfãos do Storage — DESENHO (não habilitado)

Status: **somente projetado** (28/09/2026). Nenhum cron destrutivo foi criado. Este documento é para
aprovação do dono antes de qualquer implementação.

## 1. O que existe hoje (auditado no banco local com todas as migrations)

**Buckets**

| bucket | público | caminho | quem grava |
|---|---|---|---|
| `comprovacoes` | não | `<uid>/<tipo>/<ts>.<ext>` (também `<club_id>/<uid>/…`) | app (`src/lib/upload.js`) |
| `imagens` | não | `perfis/<uid>-<ts>`, `unidades/<id>-…`, mural, legado `<tipo>/<uid>-<ts>` (upsert) | app |
| `publico` | sim | `<club_id>/logo-<ts>.<ext>` | diretoria |
| `documentos-emitidos` | não | H1 `<club>/<usuario>/<documento>/<versao>.pdf`, H2 `…/final/<hash16>.pdf` | Edge Functions (service role) |
| `assinaturas-desenhadas` | não | `<club>/<documento>/<signature>.png` | app |
| `parceiros` | sim | `logo-<ts>-<rand>.<ext>` | admin da plataforma |
| `suporte-anexos` | não | `<uid>/<uuid>.<ext>` | app |

**Quem referencia arquivo** (texto): `member_requirements.evidencia_path`, `requirement_submissions.evidencia_path`,
`member_specialty_requirements.evidencia_path`, `experience_submissions.arquivo_path`, `experiences.imagem_path`,
`suporte_mensagens.anexo_path`, `class_documents.pdf_storage_path`, `document_final_renders.storage_path`,
`entregas.foto_url`, `missoes_feitas.foto_url`, `devocional.foto_url`, `fotos.url` (mural), `profiles.foto`,
`site_partners.logo_url`. **Em JSON**: `profiles.avatar`, `document_signatures.dados->>'desenho_path'`,
`organizational_units.metadata->marca->logo_url`, `class_completion_snapshots.conteudo` (caminhos de evidência).
Colunas `*_url` podem guardar URL completa — precisam ser normalizadas para `bucket/name` antes de comparar.

**Imutáveis (gatilho bloqueia UPDATE/DELETE)**: snapshots de conclusão, investiduras, decisões do workflow,
`requirement_submissions`, `document_signatures`, `document_reviews`, `document_final_renders`, consentimentos,
auditorias.

**Mecanismos atuais**
- Cota por clube (`club_storage_objetos`/`club_storage_uso`, gatilhos em `storage.objects`, reconciliação semanal).
- `_comprovacao_referenciada(name)` + policy "comprovacao dono apaga requisito orfao": o próprio dono apaga
  `<uid>/requisitos/<arquivo>` não referenciado. **Não** olha entregas, missões, devocional, experiências, mural.
- `storage.objects` tem `protect_delete()`: DELETE por SQL só com `storage.allow_delete_query=true`, e aí
  **só a linha some — o arquivo físico fica**. O jeito certo é a API do Storage (`remove()`), que apaga os dois.

## 2. Riscos encontrados (reais, não hipotéticos)

1. **Expurgo de clube deixa arquivo físico órfão para sempre.** `_clube_expurgar` (migration 280) apaga as
   LINHAS de `storage.objects` do clube por SQL. O arquivo (inclusive foto de criança) fica no backend e
   nenhuma listagem por `storage.objects` o encontra de novo. É o ponto mais importante: LGPD.
2. Anexo de suporte e upload interrompido (foto subiu, requisito não salvou) viram órfãos — documentado na 290.
3. `imagens` legado sem prefixo de clube e com `upsert:true`: dono ambíguo.
4. Corrida: o upload acontece ANTES da linha que o referencia — um GC sem carência apagaria arquivo em uso.

## 3. Desenho proposto

**Princípio**: nunca apagar por SQL; nunca atravessar clube; nunca tocar em histórico; sempre listar antes.

1. **Inventário (só leitura)** — função `storage_gc_candidatos(p_club_id uuid, p_limite int)` (service role):
   - `p_club_id` **obrigatório**; só objetos cujo clube (`_storage_clube_do_objeto`) é esse clube.
   - candidato = objeto com `created_at < now() - interval '7 days'` (carência) **e** sem referência em
     NENHUMA das colunas da seção 1 (texto, JSON e `*_url` normalizada) **e** fora da lista de proteção.
   - **lista de proteção (nunca candidato)**: buckets `documentos-emitidos` e `assinaturas-desenhadas`
     inteiros; qualquer caminho citado em `class_completion_snapshots.conteudo` ou `requirement_submissions`;
     qualquer objeto de clube com documento assinado; logos de clube e parceiros.
   - devolve `bucket, name, bytes, criado_em, motivo` — ordenado, limitado a `p_limite` (padrão 200).
2. **Execução (dry-run por padrão)** — Edge Function `storage-gc` (service role), chamada manualmente pelo
   admin da plataforma:
   - `modo: 'dry-run'` (padrão) → só grava o relatório em `storage_gc_execucoes` (id, club_id, modo, quem,
     quando, itens jsonb, total_bytes) e devolve a lista. **Nada é apagado.**
   - `modo: 'apagar'` exige o `execucao_id` de um dry-run do MESMO clube com menos de 24h; reconfere cada
     item (ainda órfão? ainda do clube?) e apaga pela **API do Storage** (`remove()`), em lotes de 50.
     Idempotente: item já inexistente conta como feito. Cada item fica logado (ok/erro).
3. **Expurgo de clube** — trocar o `delete from storage.objects` da 280 por: gravar os caminhos numa fila
   `storage_expurgo_fila(club_id, bucket, name)` e deixar a mesma Edge Function apagar pela API. Enquanto
   isso não existir, **não apagar linhas por SQL** (a linha é o único rastro do arquivo físico).
4. **Arquivos físicos já órfãos** (sem linha): só a listagem do backend (API `list` por prefixo `<club_id>/`)
   encontra. Fica para uma segunda etapa, também em dry-run.
5. **Cron**: só depois de 4 semanas de dry-run revisado, e só em modo dry-run (relatório semanal). Apagar
   continua sendo ação humana.

## 4. Testes exigidos antes de habilitar

- SQL: candidato nunca inclui arquivo referenciado (cada coluna da seção 1), nunca de outro clube, nunca
  dentro da carência, nunca documento/assinatura; `p_club_id` nulo é recusado; só service role executa.
- E2E local: dry-run não apaga nada; `apagar` sem dry-run recente é recusado; `apagar` duas vezes é
  idempotente; a cota do clube cai exatamente o que foi apagado.

## 5. Decisões para o dono

1. Carência de 7 dias está boa?
2. Pode trocar o expurgo de clube (item 3) por fila + API? Hoje ele deixa arquivo físico para trás.
3. Anexos de suporte: apagar quando o chamado fecha + N dias, ou manter?
