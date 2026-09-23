-- =====================================================================
-- Fase 8 — PoC: como medir ARMAZENAMENTO POR CLUBE de forma confiável.
--
-- A pendência vem da fase 5: `armazenamento_mb` está declarado no plano, mas `limite_uso` devolve
-- NULL porque os objetos do Storage NÃO carregam o clube no caminho — as pastas são por assunto
-- (`perfis/`, `mural/`, `unidades/`) e por usuário (`<user_id>/…` em comprovações).
--
-- Três caminhos avaliados. Nenhum deles muda path em massa.
-- =====================================================================
\echo '=== quantos objetos existem e como os caminhos sao formados ==='
select bucket_id, split_part(name, '/', 1) as primeira_pasta, count(*) objetos,
       pg_size_pretty(sum(coalesce((metadata->>'size')::bigint, 0))) tamanho
from storage.objects group by 1,2 order by 3 desc limit 10;

\echo '=== A) ligar objeto -> clube pelo DONO (owner/owner_id -> vinculo) ==='
\echo '    Serve para perfis/ e comprovacoes/ (que sao por pessoa). Custo: 1 join por objeto.'
explain (analyze, buffers, costs off, timing off)
select m.organizational_unit_id as club_id, count(*) objetos, sum(coalesce((o.metadata->>'size')::bigint,0)) bytes
from storage.objects o
join public.organization_memberships m
  on m.user_id = coalesce(o.owner_id::uuid, o.owner) and m.status='ativo'
group by 1;

\echo '=== B) ligar pelo REGISTRO de negocio (fotos.url/thumb -> fotos.club_id) ==='
\echo '    Serve para mural/. Hoje exige casar por sufixo de URL: O(n*m), nao escala.'
explain (analyze, buffers, costs off, timing off)
select f.club_id, count(*)
from public.fotos f
join storage.objects o on o.bucket_id='imagens' and (f.url like '%' || o.name or f.thumb like '%' || o.name)
group by 1;
