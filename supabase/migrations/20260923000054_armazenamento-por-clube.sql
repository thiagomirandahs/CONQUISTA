-- =============================================================================
--  Fase 8.1 — armazenamento por clube: contabilização INCREMENTAL, na escrita.
--
--  A pendência vinha da fase 5: `limite_uso(clube, 'armazenamento_mb')` devolvia NULL porque
--  ninguém sabia quanto cada clube ocupava. A fase 8 mediu as duas formas óbvias de descobrir
--  isso LENDO (PRODUCTION-READINESS.md §6), com 35.000 objetos sintéticos:
--
--      A) objeto -> dono -> vínculo ............................  24,9 ms  (hash join)
--      B) objeto -> registro de negócio por sufixo de URL ....  154.175 ms (nested loop 30k x 35k)
--
--  B é inviável e está proibida de propósito. A é viável, mas continua sendo uma varredura da
--  tabela inteira toda vez que alguém abre a tela de uso — e piora a cada foto nova.
--
--  A saída é não contar na leitura. Cada objeto que entra, muda de tamanho ou sai atualiza um
--  agregado por clube. A leitura vira O(1) e o custo da escrita é uma linha.
--
--  COMO A IDEMPOTÊNCIA É GARANTIDA (o requisito mais difícil aqui):
--    Não por "cuidado ao chamar", e sim pela forma. Existe um LIVRO-RAZÃO com uma linha por
--    objeto — `club_storage_objetos`, chave (bucket_id, name), a mesma chave única que o Storage
--    já usa. O agregado nunca é somado a partir de um evento; ele é somado a partir do DELTA
--    entre o que a linha do razão dizia e o que passou a dizer.
--      upload novo ....... linha nasce, delta = +bytes
--      re-upload igual ... linha já existe com o mesmo tamanho, delta = 0
--      substituição ...... delta = novo - antigo
--      exclusão .......... linha some, delta = -bytes
--      retry / clique duplo ... cai num dos casos acima, sempre com o mesmo resultado final
--    Reprocessar o mesmo evento cem vezes chega no mesmo número. É o mesmo princípio que a fase 5
--    usou nos webhooks e a fase 6 nas recompensas: a unicidade mora no banco, não no chamador.
--
--  DE ONDE VEM O CLUBE:
--    1. se o caminho começa com o uuid de um clube (`<club_id>/...`), é esse — é o formato que
--       os caminhos NOVOS passam a usar;
--    2. senão, pelo dono do objeto e o vínculo dele (a abordagem A, medida em 24,9 ms — aqui ela
--       roda uma vez por objeto, na escrita, não numa varredura).
--    Os caminhos antigos (`perfis/`, `mural/`, `unidades/`) continuam válidos e contabilizados
--    pelo caminho 2. NADA é movido em massa: mudar path de objeto existente quebraria toda URL
--    já salva em `fotos.url`, `profiles.foto` e nas comprovações.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. O livro-razão: uma linha por objeto. É ele que torna a conta idempotente.
-- ---------------------------------------------------------------------------
create table if not exists public.club_storage_objetos (
  bucket_id text not null,
  name text not null,
  club_id uuid references public.organizational_units(id) on delete cascade,
  bytes bigint not null default 0 check (bytes >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (bucket_id, name)
);
alter table public.club_storage_objetos enable row level security;
-- Tabela de contabilidade: ninguém lê nem escreve pelo app. O número que o app mostra sai de
-- `armazenamento_do_clube()`, que é quem aplica a autorização.
revoke all on public.club_storage_objetos from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. O agregado: o que a leitura consulta. Uma linha por clube.
-- ---------------------------------------------------------------------------
create table if not exists public.club_storage_uso (
  club_id uuid primary key references public.organizational_units(id) on delete cascade,
  bytes bigint not null default 0 check (bytes >= 0),
  objetos integer not null default 0 check (objetos >= 0),
  atualizado_em timestamptz not null default now()
);
alter table public.club_storage_uso enable row level security;
revoke all on public.club_storage_uso from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. A quem pertence um objeto.
-- ---------------------------------------------------------------------------
-- `p_owner` recebe `coalesce(owner_id, owner::text)`: storage.objects tem DUAS colunas de dono.
-- `owner` (uuid) é a antiga e `owner_id` (text) é a atual; objetos criados em épocas diferentes
-- têm uma ou outra preenchida. Olhar só uma delas deixava de contabilizar parte do acervo — e o
-- teste 49 pegou justamente isso, porque os fixtures do projeto ainda usam `owner`.
create or replace function public._storage_clube_do_objeto(p_name text, p_owner text)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_primeiro text; v_club uuid;
begin
  -- (1) caminho novo: `<club_id>/...`
  v_primeiro := split_part(coalesce(p_name, ''), '/', 1);
  if v_primeiro ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_club from public.organizational_units where id = v_primeiro::uuid;
    if v_club is not null then return v_club; end if;
  end if;

  -- (2) caminho antigo: pelo dono. Quem está em dois clubes tem o objeto contado no vínculo mais
  -- antigo — é uma escolha, e está registrada aqui para não virar surpresa: a alternativa seria
  -- ratear, o que daria um número que ninguém consegue conferir.
  if p_owner is null or p_owner !~ '^[0-9a-f]{8}-' then return null; end if;
  select m.organizational_unit_id into v_club
    from public.organization_memberships m
   where m.user_id = p_owner::uuid and m.status = 'ativo'
   order by m.starts_at, m.created_at
   limit 1;
  return v_club;
end $$;
revoke all on function public._storage_clube_do_objeto(text, text) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. O gatilho. Toda a contabilidade acontece aqui, e em nenhum outro lugar.
-- ---------------------------------------------------------------------------
create or replace function public._storage_contabilizar()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_club uuid; v_bytes bigint;
  v_club_antigo uuid; v_bytes_antigo bigint;
begin
  -- estado ANTERIOR, lido do razão (não do evento): é isto que torna reprocessamento inofensivo
  if tg_op in ('UPDATE', 'DELETE') then
    select o.club_id, o.bytes into v_club_antigo, v_bytes_antigo
      from public.club_storage_objetos o
     where o.bucket_id = old.bucket_id and o.name = old.name;
  end if;

  if tg_op = 'DELETE' then
    delete from public.club_storage_objetos where bucket_id = old.bucket_id and name = old.name;
    if v_club_antigo is not null then
      update public.club_storage_uso
         set bytes = greatest(bytes - coalesce(v_bytes_antigo, 0), 0),
             objetos = greatest(objetos - 1, 0), atualizado_em = now()
       where club_id = v_club_antigo;
    end if;
    return old;
  end if;

  v_club := public._storage_clube_do_objeto(new.name, coalesce(new.owner_id, new.owner::text));
  -- `metadata->>'size'` é preenchido pela API de Storage. Objeto sem tamanho conhecido conta
  -- como 0 e a reconciliação corrige depois — melhor um número baixo que um número inventado.
  v_bytes := coalesce((new.metadata->>'size')::bigint, 0);

  insert into public.club_storage_objetos (bucket_id, name, club_id, bytes, atualizado_em)
  values (new.bucket_id, new.name, v_club, v_bytes, now())
  on conflict (bucket_id, name) do update
    set club_id = excluded.club_id, bytes = excluded.bytes, atualizado_em = now();

  -- Aplica o DELTA. `on conflict do update` com soma é atômico sob o lock da linha do agregado,
  -- então dois uploads simultâneos do mesmo clube não perdem contagem um do outro.
  if v_club_antigo is not null and v_club_antigo is distinct from v_club then
    -- o objeto trocou de clube (raro, mas possível se o vínculo do dono mudar): tira de lá
    update public.club_storage_uso
       set bytes = greatest(bytes - coalesce(v_bytes_antigo, 0), 0),
           objetos = greatest(objetos - 1, 0), atualizado_em = now()
     where club_id = v_club_antigo;
    v_bytes_antigo := null;
  end if;

  if v_club is not null then
    insert into public.club_storage_uso (club_id, bytes, objetos, atualizado_em)
    values (v_club, v_bytes, case when v_bytes_antigo is null then 1 else 0 end, now())
    on conflict (club_id) do update
      set bytes = greatest(public.club_storage_uso.bytes + v_bytes - coalesce(v_bytes_antigo, 0), 0),
          objetos = public.club_storage_uso.objetos + case when v_bytes_antigo is null then 1 else 0 end,
          atualizado_em = now();
  end if;
  return new;
end $$;
revoke all on function public._storage_contabilizar() from public, authenticated, anon;

drop trigger if exists trg_storage_contabilizar on storage.objects;
create trigger trg_storage_contabilizar
  after insert or update or delete on storage.objects
  for each row execute function public._storage_contabilizar();

-- ---------------------------------------------------------------------------
-- 5. Reconciliação: a rede de segurança.
--
-- Contagem incremental deriva com o tempo — um objeto apagado por fora do gatilho, um `metadata`
-- que chegou depois, uma migração de dados. A reconciliação recomputa do zero a partir de
-- storage.objects e devolve a DIFERENÇA antes de corrigir, para a operação enxergar se está
-- derivando muito (o que seria sintoma de outro problema).
-- ---------------------------------------------------------------------------
create or replace function public.storage_reconciliar(p_club_id uuid default null, p_aplicar boolean default true)
returns table (club_id uuid, bytes_antes bigint, bytes_reais bigint, diferenca bigint,
               objetos_antes int, objetos_reais int)
language plpgsql security definer set search_path = ''
as $$
-- `club_id` é ao mesmo tempo nome de coluna e de parâmetro de SAÍDA desta função, e o plpgsql
-- recusa o `on conflict (club_id)` por ambiguidade. A diretiva manda resolver pela COLUNA, que é
-- o que se quer em toda a função (os parâmetros de saída só são preenchidos no `return query`).
#variable_conflict use_column
begin
  perform public._exigir_admin_plataforma();

  -- A comparação é MATERIALIZADA antes de qualquer escrita. Misturar as duas num `with` que
  -- escreve e lê ao mesmo tempo, além de ilegal em `return query`, esconderia o "antes" —
  -- e o "antes" é justamente o que a operação precisa ver para saber se está derivando.
  create temporary table _recon on commit drop as
  with reais as (
    select public._storage_clube_do_objeto(o.name, coalesce(o.owner_id, o.owner::text)) as cid,
           sum(coalesce((o.metadata->>'size')::bigint, 0))::bigint as bytes,
           count(*)::int as objetos
      from storage.objects o
     group by 1
  )
  select coalesce(r.cid, u.club_id) as cid,
         coalesce(u.bytes, 0)::bigint as antes, coalesce(r.bytes, 0)::bigint as reais,
         coalesce(u.objetos, 0) as obj_antes, coalesce(r.objetos, 0) as obj_reais
    from reais r
    full outer join public.club_storage_uso u on u.club_id = r.cid
   where coalesce(r.cid, u.club_id) is not null
     and (p_club_id is null or coalesce(r.cid, u.club_id) = p_club_id);

  if p_aplicar then
    insert into public.club_storage_uso (club_id, bytes, objetos, atualizado_em)
    select c.cid, c.reais, c.obj_reais, now() from _recon c
    on conflict (club_id) do update
      set bytes = excluded.bytes, objetos = excluded.objetos, atualizado_em = now();
  end if;

  return query
  select c.cid, c.antes, c.reais, c.reais - c.antes, c.obj_antes, c.obj_reais
    from _recon c order by abs(c.reais - c.antes) desc;
end $$;
revoke all on function public.storage_reconciliar(uuid, boolean) from public, anon;
grant execute on function public.storage_reconciliar(uuid, boolean) to authenticated;

-- Reconciliação semanal: barata (uma varredura de madrugada) e suficiente para pegar deriva
-- antes que ela vire cobrança errada.
select cron.schedule('reconciliar-armazenamento', '20 4 * * 0',
  $$select public.storage_reconciliar(null, true) from (select 1) x$$)
 where not exists (select 1 from cron.job where jobname = 'reconciliar-armazenamento');

-- ---------------------------------------------------------------------------
-- 6. A leitura do app — agora O(1) — e o fim da pendência da fase 5.
-- ---------------------------------------------------------------------------
create or replace function public.armazenamento_do_clube(p_club_id uuid default null)
returns table (bytes bigint, megabytes numeric, objetos int, limite_mb int, atualizado_em timestamptz)
language sql stable security definer set search_path = ''
as $$
  select coalesce(u.bytes, 0),
         round(coalesce(u.bytes, 0) / 1048576.0, 2),
         coalesce(u.objetos, 0),
         public.plano_limite(coalesce(p_club_id, public.clube_atual_id()), 'armazenamento_mb'),
         u.atualizado_em
    from (select 1) x
    left join public.club_storage_uso u
      on u.club_id = coalesce(p_club_id, public.clube_atual_id())
   where public.pode_gerir_no_clube(coalesce(p_club_id, public.clube_atual_id()));
$$;
revoke all on function public.armazenamento_do_clube(uuid) from public, anon;
grant execute on function public.armazenamento_do_clube(uuid) to authenticated;

-- `limite_uso` deixa de devolver NULL para armazenamento: era a pendência aberta da fase 5.
-- É a definição da migration 48 INTEIRA, com um ramo a mais — nome do parâmetro, ordem dos
-- casos e as janelas de vigência dos vínculos ficam idênticos. Trocar o nome do parâmetro criaria
-- uma SEGUNDA função sobrecarregada em vez de substituir esta, e `limites_do_clube` passaria a
-- chamar sabe-se lá qual.
create or replace function public.limite_uso(p_club_id uuid, p_chave text) returns bigint
language sql stable security definer set search_path = '' as $$
  select case p_chave
    when 'membros' then (
      select count(*) from public.organization_memberships m
       where m.organizational_unit_id = p_club_id and m.status = 'ativo' and m.role <> 'pais'
         and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()))
    when 'administradores' then (
      select count(*) from public.organization_memberships m
       where m.organizational_unit_id = p_club_id and m.status = 'ativo' and m.role in ('diretoria', 'tesoureiro')
         and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()))
    when 'fotos' then (select count(*) from public.fotos f where f.club_id = p_club_id)
    when 'clubes' then (
      select count(*) from public.subscription_clubs sc
       where sc.subscription_id = public.assinatura_do_clube_id(p_club_id))
    -- NOVO (fase 8.1): sai do agregado, não de uma varredura do Storage. Clube sem nenhum objeto
    -- devolve 0, não NULL — "medição pendente" e "não usa nada" são coisas diferentes.
    when 'armazenamento_mb' then (
      select coalesce((select (u.bytes / 1048576)::bigint from public.club_storage_uso u
                        where u.club_id = p_club_id), 0))
    else null end;
$$;
revoke all on function public.limite_uso(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Carga inicial: contabiliza o que já existe hoje, sem depender de reprocessar upload.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.club_storage_objetos (bucket_id, name, club_id, bytes)
  select o.bucket_id, o.name,
         public._storage_clube_do_objeto(o.name, coalesce(o.owner_id, o.owner::text)),
         coalesce((o.metadata->>'size')::bigint, 0)
    from storage.objects o
  on conflict (bucket_id, name) do nothing;

  insert into public.club_storage_uso (club_id, bytes, objetos)
  select club_id, sum(bytes)::bigint, count(*)::int
    from public.club_storage_objetos where club_id is not null group by club_id
  on conflict (club_id) do update set bytes = excluded.bytes, objetos = excluded.objetos;
end $$;
