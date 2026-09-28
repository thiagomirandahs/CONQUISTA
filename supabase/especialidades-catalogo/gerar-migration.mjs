// Gera a migration do CATÁLOGO de especialidades e mestrados a partir de catalogo-mda.json
// (coletado por coletar-mda.mjs). Nunca editar a migration gerada à mão: recoletar e gerar de novo
// num arquivo NOVO (número maior) — os INSERTs são "upsert", então reaplicar só atualiza.
// Uso: node supabase/especialidades-catalogo/gerar-migration.mjs 20260930000460
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const versao = process.argv[2]
if (!/^\d{14}$/.test(versao || '')) throw new Error('informe a versão da migration (14 dígitos)')
const j = JSON.parse(readFileSync(join(aqui, 'catalogo-mda.json'), 'utf8'))
const q = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

const esp = j.especialidades.map((e) =>
  `  (${q(e.codigo)}, ${q(e.nome)}, ${q(e.area)}, ${q(e.area_nome)}, ${e.nivel ?? 'null'}, ${e.ano ? Number(e.ano) : 'null'}, ${q(e.origem)}, ${e.extinta ? 'true' : 'false'}, ${q(e.fonte_url)})`)
const mes = j.mestrados.map((m) => `  (${q(m.codigo)}, ${q(m.nome)}, ${m.minimo ?? 'null'}, ${q(m.area)}, ${q(m.fonte_url)})`)
const comp = j.mestrados.flatMap((m) => m.especialidades.map((c) => `  (${q(m.codigo)}, ${q(c)})`))

const sql = `-- =============================================================================
-- ${versao.slice(-3)} — Catálogo de ESPECIALIDADES e MESTRADOS (Desbravadores)
-- =============================================================================
-- GERADO por supabase/especialidades-catalogo/gerar-migration.mjs a partir de catalogo-mda.json
-- (fonte indicada pelo dono em 29/09/2026: ${j.fonte}, coletado em ${j.coletado_em.slice(0, 10)}).
-- Só dados de catálogo: nome, área, código, nível, ano, instituição de origem e o link da página —
-- o texto dos requisitos NÃO é copiado (o site não declara licença); o app abre a página de origem.
-- Aventureiros ficam de fora. Catálogo global, sem dado de pessoa: leitura por RPC autenticada.
-- NÃO mexe no motor de Especialidades (specialties/…, recurso 'especialidades' continua fora do piloto).
-- ${j.especialidades.length} especialidades · ${j.mestrados.length} mestrados · ${comp.length} ligações mestrado→especialidade.
-- =============================================================================

create table if not exists public.especialidades_catalogo (
  codigo text primary key check (codigo ~ '^[A-Z]{2}(-EB)?-[0-9]{3}$'),
  nome text not null,
  area text not null,
  area_nome text not null,
  nivel smallint check (nivel between 1 and 5),
  ano smallint,
  origem text,
  extinta boolean not null default false,
  fonte_url text not null check (fonte_url like 'https://mda.wiki.br/%'),
  atualizado_em timestamptz not null default now()
);
create table if not exists public.mestrados_catalogo (
  codigo text primary key check (codigo ~ '^ME-[0-9]{3}$'),
  nome text not null,
  minimo smallint,
  area text,
  fonte_url text not null check (fonte_url like 'https://mda.wiki.br/%'),
  atualizado_em timestamptz not null default now()
);
create table if not exists public.mestrado_especialidades (
  mestrado_codigo text not null references public.mestrados_catalogo(codigo) on delete cascade,
  especialidade_codigo text not null references public.especialidades_catalogo(codigo) on delete cascade,
  primary key (mestrado_codigo, especialidade_codigo)
);
alter table public.especialidades_catalogo enable row level security;
alter table public.mestrados_catalogo enable row level security;
alter table public.mestrado_especialidades enable row level security;
revoke all on public.especialidades_catalogo, public.mestrados_catalogo, public.mestrado_especialidades from public, anon, authenticated;

insert into public.especialidades_catalogo (codigo, nome, area, area_nome, nivel, ano, origem, extinta, fonte_url) values
${esp.join(',\n')}
on conflict (codigo) do update set nome = excluded.nome, area = excluded.area, area_nome = excluded.area_nome, nivel = excluded.nivel,
  ano = excluded.ano, origem = excluded.origem, extinta = excluded.extinta, fonte_url = excluded.fonte_url, atualizado_em = now();

insert into public.mestrados_catalogo (codigo, nome, minimo, area, fonte_url) values
${mes.join(',\n')}
on conflict (codigo) do update set nome = excluded.nome, minimo = excluded.minimo, area = excluded.area,
  fonte_url = excluded.fonte_url, atualizado_em = now();

insert into public.mestrado_especialidades (mestrado_codigo, especialidade_codigo) values
${comp.join(',\n')}
on conflict do nothing;

-- Leitura para o app: tudo de uma vez (é pequeno e muda raramente; o app guarda em memória).
create or replace function public.catalogo_especialidades()
returns json language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null else json_build_object(
    'especialidades', (select coalesce(json_agg(json_build_object('codigo', e.codigo, 'nome', e.nome, 'area', e.area,
        'area_nome', e.area_nome, 'nivel', e.nivel, 'ano', e.ano, 'origem', e.origem, 'extinta', e.extinta, 'url', e.fonte_url)
        order by e.area, e.nome), '[]'::json) from public.especialidades_catalogo e),
    'mestrados', (select coalesce(json_agg(json_build_object('codigo', m.codigo, 'nome', m.nome, 'minimo', m.minimo, 'area', m.area,
        'url', m.fonte_url, 'especialidades', (select coalesce(json_agg(me.especialidade_codigo order by me.especialidade_codigo), '[]'::json)
          from public.mestrado_especialidades me where me.mestrado_codigo = m.codigo)) order by m.codigo), '[]'::json)
      from public.mestrados_catalogo m)) end;
$$;
revoke all on function public.catalogo_especialidades() from public, anon;
grant execute on function public.catalogo_especialidades() to authenticated;

-- modo manutenção (migration 400): tabela nova ganha a guarda
select public._manutencao_instalar_guarda();
`
const nome = `${versao}_catalogo-de-especialidades-e-mestrados.sql`
writeFileSync(join(aqui, '..', 'migrations', nome), sql)
console.log(`gerada supabase/migrations/${nome}: ${esp.length} especialidades, ${mes.length} mestrados, ${comp.length} ligações`)
