-- =============================================================================
--  CANTINHO DA UNIDADE (26/09) — pedido do dono: um espaço dentro de cada unidade, cuidado pelo
--  CONSELHEIRO (e conselheiro associado) da unidade; a diretoria vê/edita tudo; o membro vê o que é
--  dele; outra unidade NÃO vê nada.
--
--  Seções e fonte da verdade (sem duplicar o que já existe):
--   1) Presentes/Faltosos .... a chamada JÁ É o Apontamento (pontos.origem='apontamento', marca.presenca).
--                              Aqui só nasce a JUSTIFICATIVA de falta (unidade_justificativas).
--   2) Caixa da unidade ...... unidade_caixa (só registro de dados; sem pagamento, sem integração).
--   3) Meditação do domingo .. unidade_meditacoes (1 por unidade por domingo).
--   4) Pedidos/Agradecimentos  unidade_mural (a "semana" é gravada; o mural mostra só a semana atual —
--                              zera no domingo por CONSULTA, nada é apagado por job).
--   5) Ajudar os pais ........ unidade_ajuda_pais + um ponto em public.pontos (origem 'ajuda_pais'),
--                              1x por semana por desbravador, valor por clube (unidade_cantinho_config).
--   6) Presença no culto ..... JÁ EXISTE: marca.igreja do Apontamento. Só resumo, nada novo.
--   7) Reuniões da unidade ... unidade_reunioes (a Agenda do clube é só lida junto, não copiada).
--   8) Planejamento .......... unidade_planejamento (quadro simples: a fazer / fazendo / feito).
--
--  Acesso: TUDO por RPC security definer (search_path ''). As tabelas têm RLS ligada e NENHUMA
--  policy: nem leitura direta pela API. O clube é sempre o da aba (clube_atual_id()); a unidade tem
--  de ser desse clube. "Semana" = começa no DOMINGO, fuso America/Sao_Paulo.
--  Privacidade: pedidos de oração são de crianças — nada disto é lido pelo site público, pela
--  vitrine ou pelo portal institucional (nenhuma função aqui é executável por anon).
-- =============================================================================

-- ---------- recurso do clube (ligado por padrão; a Licença Anual já inclui tudo: recursos = null) ----------
insert into public.recursos_catalogo (chave, nome, descricao, icone, padrao, ordem) values
  ('cantinho_unidade', 'Cantinho da unidade',
   'Chamada, caixa, meditação, pedidos de oração, ajuda em casa, reuniões e planejamento de cada unidade.', '🏠', true, 95)
on conflict (chave) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, ordem = excluded.ordem;

-- ---------- tabelas ----------
create table if not exists public.unidade_justificativas (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  data date not null,
  motivo text not null check (char_length(motivo) between 1 and 200),
  registrado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (club_id, usuario_id, data)
);

create table if not exists public.unidade_caixa (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  data date not null,
  descricao text not null check (char_length(descricao) between 1 and 120),
  tipo text not null check (tipo in ('entrada', 'saida')),
  valor_centavos integer not null check (valor_centavos > 0 and valor_centavos <= 10000000),
  lancado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_unidade_caixa_unidade on public.unidade_caixa (unidade_id, data desc);

create table if not exists public.unidade_meditacoes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  domingo date not null check (extract(dow from domingo) = 0),
  texto text not null check (char_length(texto) between 1 and 1000),
  referencia text check (referencia is null or char_length(referencia) <= 60),
  autor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unidade_id, domingo)
);

create table if not exists public.unidade_mural (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('pedido', 'agradecimento')),
  texto text not null check (char_length(texto) between 1 and 280),
  -- privado = só o conselheiro (e a diretoria) leem; o resto da unidade não
  privado boolean not null default false,
  semana date not null check (extract(dow from semana) = 0),
  oculto boolean not null default false,
  oculto_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_unidade_mural_semana on public.unidade_mural (unidade_id, semana desc);

create table if not exists public.unidade_ajuda_pais (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  semana date not null check (extract(dow from semana) = 0),
  descricao text check (descricao is null or char_length(descricao) <= 200),
  status text not null default 'pendente' check (status in ('pendente', 'confirmado')),
  ponto_id uuid references public.pontos(id) on delete set null,
  pontos integer,
  registrado_por uuid references public.profiles(id) on delete set null,
  confirmado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- 1x por semana por desbravador (neste clube)
  unique (club_id, usuario_id, semana)
);

create table if not exists public.unidade_reunioes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  inicio timestamptz not null,
  local text check (local is null or char_length(local) <= 120),
  pauta text check (pauta is null or char_length(pauta) <= 500),
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_unidade_reunioes on public.unidade_reunioes (unidade_id, inicio);

create table if not exists public.unidade_planejamento (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 120),
  detalhe text check (detalhe is null or char_length(detalhe) <= 500),
  status text not null default 'a_fazer' check (status in ('a_fazer', 'fazendo', 'feito')),
  prazo date,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_unidade_planejamento on public.unidade_planejamento (unidade_id);

create table if not exists public.unidade_cantinho_config (
  club_id uuid primary key references public.organizational_units(id) on delete cascade,
  pontos_ajuda_pais integer not null default 10 check (pontos_ajuda_pais between 0 and 50),
  updated_at timestamptz not null default now()
);

-- RLS ligada, SEM policy: só as RPCs abaixo leem/escrevem.
do $$
declare t text;
begin
  foreach t in array array['unidade_justificativas', 'unidade_caixa', 'unidade_meditacoes', 'unidade_mural',
                           'unidade_ajuda_pais', 'unidade_reunioes', 'unidade_planejamento', 'unidade_cantinho_config'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    if t <> 'unidade_cantinho_config' then
      execute format('drop trigger if exists trg_exigir_recurso on public.%I', t);
      execute format('create trigger trg_exigir_recurso before insert on public.%I for each row execute function public.exigir_recurso_habilitado(%L)', t, 'cantinho_unidade');
    end if;
  end loop;
end $$;

-- ---------- utilitários ----------
-- Domingo que abre a semana de p_ts, no fuso do Brasil (o "mural zera todo domingo").
create or replace function public.cantinho_domingo(p_ts timestamptz default now()) returns date
language sql stable set search_path = '' as $$
  select (p_ts at time zone 'America/Sao_Paulo')::date
       - extract(dow from (p_ts at time zone 'America/Sao_Paulo'))::int;
$$;
revoke all on function public.cantinho_domingo(timestamptz) from public, anon;
grant execute on function public.cantinho_domingo(timestamptz) to authenticated;

-- Papel de quem chama NESTA unidade, no clube da aba: 'diretoria' | 'lider' | 'membro' | null.
-- lider = conselheiro(a) da própria unidade: papel 'conselheiro' no vínculo desta unidade OU cargo
-- da unidade conselheiro/conselheiro associado (migration 230).
create or replace function public._cantinho_papel(p_unidade uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_m record;
begin
  if auth.uid() is null or v_club is null or p_unidade is null then return null; end if;
  if not exists (select 1 from public.unidades u where u.id = p_unidade and u.club_id = v_club) then return null; end if;
  if public.pode_administrar_clube(v_club) then return 'diretoria'; end if;
  select m.role, m.cargo_unidade into v_m
    from public.organization_memberships m
   where m.user_id = auth.uid() and m.organizational_unit_id = v_club and m.unidade_id = p_unidade
     and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
     and m.role <> 'pais'
   order by (m.role = 'conselheiro') desc, m.starts_at, m.id
   limit 1;
  if not found then return null; end if;
  if v_m.role = 'conselheiro' or v_m.cargo_unidade in ('conselheiro', 'conselheiro_associado') then return 'lider'; end if;
  return 'membro';
end $$;
revoke all on function public._cantinho_papel(uuid) from public, anon, authenticated;

create or replace function public._cantinho_tesoureiro(p_unidade uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
     where m.user_id = auth.uid() and m.organizational_unit_id = public.clube_atual_id()
       and m.unidade_id = p_unidade and m.cargo_unidade = 'tesoureiro'
       and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()));
$$;
revoke all on function public._cantinho_tesoureiro(uuid) from public, anon, authenticated;

-- Barreira única das RPCs. p_nivel: 'membro' (qualquer um da unidade), 'lider' (conselheiro/diretoria),
-- 'caixa' (conselheiro, tesoureiro(a) da unidade, diretoria). Devolve o papel.
create or replace function public._cantinho_exigir(p_unidade uuid, p_nivel text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_papel text;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  if v_club is null then raise exception 'Sem clube em uso.'; end if;
  v_papel := public._cantinho_papel(p_unidade);
  if v_papel is null then raise exception 'Sem permissão (este cantinho é só da unidade).'; end if;
  if not public.recurso_habilitado_no_clube(v_club, 'cantinho_unidade') then
    raise exception 'Este recurso está desabilitado neste clube.';
  end if;
  if p_nivel = 'lider' and v_papel not in ('lider', 'diretoria') then
    raise exception 'Sem permissão (só o conselheiro da unidade ou a diretoria).';
  end if;
  if p_nivel = 'caixa' and v_papel not in ('lider', 'diretoria') and not public._cantinho_tesoureiro(p_unidade) then
    raise exception 'Sem permissão (só conselheiro, tesoureiro da unidade ou diretoria lançam no caixa).';
  end if;
  return v_papel;
end $$;
revoke all on function public._cantinho_exigir(uuid, text) from public, anon, authenticated;

-- membro ativo (não responsável) desta unidade, neste clube
create or replace function public._cantinho_da_unidade(p_user uuid, p_unidade uuid, p_so_desbravador boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
     where m.user_id = p_user and m.organizational_unit_id = public.clube_atual_id() and m.unidade_id = p_unidade
       and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
       and m.role <> 'pais' and (not p_so_desbravador or m.role = 'desbravador'));
$$;
revoke all on function public._cantinho_da_unidade(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public._cantinho_pontos_ajuda(p_club uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.pontos_ajuda_pais from public.unidade_cantinho_config c where c.club_id = p_club), 10);
$$;
revoke all on function public._cantinho_pontos_ajuda(uuid) from public, anon, authenticated;

-- ---------- quais cantinhos eu abro ----------
create or replace function public.cantinho_minhas_unidades()
returns table (unidade_id uuid, nome text, cor text, emblema text, papel text)
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null or v_club is null or not public.recurso_habilitado_no_clube(v_club, 'cantinho_unidade') then return; end if;
  return query
    select u.id, u.nome, u.cor, u.emblema, public._cantinho_papel(u.id)
      from public.unidades u
     where u.club_id = v_club and public._cantinho_papel(u.id) is not null
     order by u.nome;
end $$;
revoke all on function public.cantinho_minhas_unidades() from public, anon;
grant execute on function public.cantinho_minhas_unidades() to authenticated;

-- ---------- leitura: tudo o que ESTA pessoa pode ver do cantinho, numa chamada ----------
create or replace function public.cantinho_ver(p_unidade uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_papel text := public._cantinho_exigir(p_unidade, 'membro');
  v_gestor boolean := v_papel in ('lider', 'diretoria');
  v_caixa boolean := v_gestor or public._cantinho_tesoureiro(p_unidade);
  v_dom date := public.cantinho_domingo(now());
  v_membros uuid[];
  v_res jsonb;
begin
  select coalesce(array_agg(distinct m.user_id), '{}') into v_membros
    from public.organization_memberships m
   where m.organizational_unit_id = v_club and m.unidade_id = p_unidade and m.role <> 'pais'
     and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now());

  with ap as (      -- apontamentos (chamada da reunião) dos membros da unidade, neste clube
    select p.usuario_id, (p.data at time zone 'America/Sao_Paulo')::date as dia, p.marca, p.pontos
      from public.pontos p
     where p.club_id = v_club and p.origem = 'apontamento' and p.usuario_id = any (v_membros)
  ), dias as (
    select distinct dia from ap order by dia desc limit 8
  ), linhas as (
    select a.usuario_id, a.dia,
           case when coalesce(a.marca ->> 'presenca', case when a.pontos > 0 then 'naHora' else 'faltou' end) = 'faltou'
                  then case when j.id is not null then 'justificada' else 'falta' end
                when a.marca ->> 'presenca' = 'atrasado' then 'atrasado'
                else 'presente' end as status,
           coalesce((a.marca ->> 'igreja')::boolean, false) as igreja,
           j.motivo
      from ap a
      join dias d on d.dia = a.dia
      left join public.unidade_justificativas j on j.club_id = v_club and j.usuario_id = a.usuario_id and j.data = a.dia
     where v_gestor or a.usuario_id = v_uid
  )
  select jsonb_build_object(
    'unidade', (select jsonb_build_object('id', u.id, 'nome', u.nome, 'cor', u.cor, 'emblema', u.emblema, 'lema', u.lema)
                  from public.unidades u where u.id = p_unidade),
    'papel', v_papel, 'pode_editar', v_gestor, 'pode_caixa', v_caixa, 'eu', v_uid,
    'domingo', v_dom, 'hoje', (now() at time zone 'America/Sao_Paulo')::date,
    'membros', coalesce((
      select jsonb_agg(jsonb_build_object('id', pr.id, 'nome', pr.nome, 'foto', pr.foto, 'role', x.role, 'cargo_unidade', x.cargo_unidade) order by pr.nome)
        from (select distinct on (m.user_id) m.user_id, m.role, m.cargo_unidade
                from public.organization_memberships m
               where m.organizational_unit_id = v_club and m.unidade_id = p_unidade and m.user_id = any (v_membros)
                 and m.status = 'ativo' and m.ends_at is null
               order by m.user_id, m.starts_at) x
        join public.profiles pr on pr.id = x.user_id), '[]'::jsonb),
    'chamada', coalesce((
      select jsonb_agg(jsonb_build_object('data', l.dia, 'itens', l.itens) order by l.dia desc)
        from (select dia, jsonb_agg(jsonb_build_object('usuario_id', usuario_id, 'status', status, 'motivo', motivo, 'igreja', igreja)) itens
                from linhas group by dia) l), '[]'::jsonb),
    'resumo', coalesce((
      select jsonb_agg(to_jsonb(r))
        from (select usuario_id, count(*) as reunioes, count(*) filter (where status = 'falta') as faltas,
                     count(*) filter (where status = 'justificada') as justificadas,
                     count(*) filter (where igreja) as culto
                from linhas group by usuario_id) r), '[]'::jsonb),
    'caixa', case when v_caixa then jsonb_build_object(
        'saldo_centavos', (select coalesce(sum(case when c.tipo = 'entrada' then c.valor_centavos else -c.valor_centavos end), 0)
                             from public.unidade_caixa c where c.unidade_id = p_unidade and c.club_id = v_club),
        'lancamentos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'data', c.data, 'descricao', c.descricao,
                                   'tipo', c.tipo, 'valor_centavos', c.valor_centavos) order by c.data desc, c.created_at desc)
                                   from (select * from public.unidade_caixa c where c.unidade_id = p_unidade and c.club_id = v_club
                                          order by c.data desc, c.created_at desc limit 60) c), '[]'::jsonb))
      else jsonb_build_object('saldo_centavos',
             (select coalesce(sum(case when c.tipo = 'entrada' then c.valor_centavos else -c.valor_centavos end), 0)
                from public.unidade_caixa c where c.unidade_id = p_unidade and c.club_id = v_club),
             'lancamentos', '[]'::jsonb) end,
    'meditacao', (select jsonb_build_object('id', md.id, 'domingo', md.domingo, 'texto', md.texto, 'referencia', md.referencia)
                    from public.unidade_meditacoes md where md.unidade_id = p_unidade and md.club_id = v_club and md.domingo = v_dom),
    'meditacoes_anteriores', coalesce((
      select jsonb_agg(jsonb_build_object('domingo', md.domingo, 'texto', md.texto, 'referencia', md.referencia) order by md.domingo desc)
        from (select * from public.unidade_meditacoes md where md.unidade_id = p_unidade and md.club_id = v_club and md.domingo < v_dom
               order by md.domingo desc limit 8) md), '[]'::jsonb),
    -- mural DA SEMANA: some no domingo seguinte (consulta pela semana; nada é apagado)
    'mural', coalesce((
      select jsonb_agg(jsonb_build_object('id', mu.id, 'tipo', mu.tipo, 'texto', mu.texto, 'privado', mu.privado, 'oculto', mu.oculto,
               'meu', mu.autor_id = v_uid, 'autor', pr.nome, 'created_at', mu.created_at) order by mu.created_at desc)
        from public.unidade_mural mu join public.profiles pr on pr.id = mu.autor_id
       where mu.unidade_id = p_unidade and mu.club_id = v_club and mu.semana = v_dom
         and (v_gestor or mu.autor_id = v_uid or (not mu.privado and not mu.oculto))), '[]'::jsonb),
    -- semanas anteriores: só o conselheiro/diretoria (e cada um o que é seu)
    'mural_historico', coalesce((
      select jsonb_agg(jsonb_build_object('id', mu.id, 'semana', mu.semana, 'tipo', mu.tipo, 'texto', mu.texto, 'privado', mu.privado,
               'oculto', mu.oculto, 'meu', mu.autor_id = v_uid, 'autor', pr.nome) order by mu.semana desc, mu.created_at desc)
        from (select * from public.unidade_mural mu
               where mu.unidade_id = p_unidade and mu.club_id = v_club and mu.semana < v_dom and mu.semana >= v_dom - 56
                 and (v_gestor or mu.autor_id = v_uid)
               order by mu.semana desc, mu.created_at desc limit 80) mu
        join public.profiles pr on pr.id = mu.autor_id), '[]'::jsonb),
    'ajuda_pontos', public._cantinho_pontos_ajuda(v_club),
    'ajuda', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'usuario_id', a.usuario_id, 'semana', a.semana, 'descricao', a.descricao,
               'status', a.status, 'pontos', a.pontos) order by a.semana desc)
        from public.unidade_ajuda_pais a
       where a.unidade_id = p_unidade and a.club_id = v_club and a.semana >= v_dom - 56
         and (v_gestor or a.usuario_id = v_uid)), '[]'::jsonb),
    'reunioes', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'inicio', r.inicio, 'local', r.local, 'pauta', r.pauta) order by r.inicio)
        from public.unidade_reunioes r
       where r.unidade_id = p_unidade and r.club_id = v_club and r.inicio >= now() - interval '12 hours'), '[]'::jsonb),
    -- Agenda do clube (já existe): só as próximas reuniões/eventos, lidas daqui, nunca copiadas
    'agenda_clube', case when public.recurso_habilitado_no_clube(v_club, 'agenda') then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'titulo', e.titulo, 'tipo', e.tipo, 'data', e.data, 'hora', e.hora, 'local', e.local) order by e.data)
        from (select * from public.eventos e where e.club_id = v_club and coalesce(e.data_fim, e.data) >= (now() at time zone 'America/Sao_Paulo')::date
               order by e.data limit 4) e), '[]'::jsonb) else '[]'::jsonb end,
    'plano', case when v_gestor then coalesce((
      select jsonb_agg(jsonb_build_object('id', pl.id, 'titulo', pl.titulo, 'detalhe', pl.detalhe, 'status', pl.status, 'prazo', pl.prazo)
               order by pl.status = 'feito', pl.prazo nulls last, pl.created_at)
        from public.unidade_planejamento pl where pl.unidade_id = p_unidade and pl.club_id = v_club), '[]'::jsonb) else '[]'::jsonb end
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.cantinho_ver(uuid) from public, anon;
grant execute on function public.cantinho_ver(uuid) to authenticated;

-- ---------- 1) justificar falta (a chamada em si é o Apontamento) ----------
create or replace function public.cantinho_justificar(p_unidade uuid, p_usuario uuid, p_data date, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform public._cantinho_exigir(p_unidade, 'lider');
  if not public._cantinho_da_unidade(p_usuario, p_unidade) then raise exception 'Esta pessoa não é desta unidade.'; end if;
  if p_data is null then raise exception 'Informe a data da reunião.'; end if;
  if v_motivo is null then
    delete from public.unidade_justificativas where club_id = v_club and usuario_id = p_usuario and data = p_data;
    return jsonb_build_object('ok', true, 'justificada', false);
  end if;
  insert into public.unidade_justificativas (club_id, unidade_id, usuario_id, data, motivo, registrado_por)
  values (v_club, p_unidade, p_usuario, p_data, left(v_motivo, 200), auth.uid())
  on conflict (club_id, usuario_id, data) do update set motivo = excluded.motivo, registrado_por = excluded.registrado_por;
  return jsonb_build_object('ok', true, 'justificada', true);
end $$;
revoke all on function public.cantinho_justificar(uuid, uuid, date, text) from public, anon;
grant execute on function public.cantinho_justificar(uuid, uuid, date, text) to authenticated;

-- justificativas do clube da aba (o Radar de faltas não conta falta justificada). Liderança do clube
-- vê todas; conselheiro só as da própria unidade.
create or replace function public.cantinho_justificativas_do_clube(p_desde date default null)
returns table (usuario_id uuid, data date)
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null or v_club is null then return; end if;
  return query
    select j.usuario_id, j.data from public.unidade_justificativas j
     where j.club_id = v_club and (p_desde is null or j.data >= p_desde)
       and (public.pode_gerir_no_clube(v_club) or public._cantinho_papel(j.unidade_id) in ('lider', 'diretoria'));
end $$;
revoke all on function public.cantinho_justificativas_do_clube(date) from public, anon;
grant execute on function public.cantinho_justificativas_do_clube(date) to authenticated;

-- ---------- 2) caixa ----------
create or replace function public.cantinho_caixa_lancar(p_unidade uuid, p_data date, p_descricao text, p_tipo text, p_valor_centavos integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_desc text := nullif(btrim(coalesce(p_descricao, '')), '');
begin
  perform public._cantinho_exigir(p_unidade, 'caixa');
  if v_desc is null then raise exception 'Descreva o lançamento.'; end if;
  if p_tipo not in ('entrada', 'saida') then raise exception 'Tipo inválido (entrada ou saída).'; end if;
  if p_valor_centavos is null or p_valor_centavos <= 0 or p_valor_centavos > 10000000 then raise exception 'Valor inválido.'; end if;
  insert into public.unidade_caixa (club_id, unidade_id, data, descricao, tipo, valor_centavos, lancado_por)
  values (public.clube_atual_id(), p_unidade, coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date), left(v_desc, 120), p_tipo, p_valor_centavos, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.cantinho_caixa_lancar(uuid, date, text, text, integer) from public, anon;
grant execute on function public.cantinho_caixa_lancar(uuid, date, text, text, integer) to authenticated;

create or replace function public.cantinho_caixa_excluir(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_un uuid;
begin
  select unidade_id into v_un from public.unidade_caixa where id = p_id and club_id = public.clube_atual_id();
  if v_un is null then raise exception 'Lançamento não encontrado.'; end if;
  perform public._cantinho_exigir(v_un, 'caixa');
  delete from public.unidade_caixa where id = p_id;
end $$;
revoke all on function public.cantinho_caixa_excluir(uuid) from public, anon;
grant execute on function public.cantinho_caixa_excluir(uuid) to authenticated;

-- ---------- 3) meditação do domingo (sempre a da semana atual) ----------
create or replace function public.cantinho_meditacao_salvar(p_unidade uuid, p_texto text, p_referencia text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_dom date := public.cantinho_domingo(now()); v_txt text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  perform public._cantinho_exigir(p_unidade, 'lider');
  if v_txt is null then
    delete from public.unidade_meditacoes where unidade_id = p_unidade and domingo = v_dom;
    return jsonb_build_object('ok', true, 'domingo', v_dom, 'apagada', true);
  end if;
  insert into public.unidade_meditacoes (club_id, unidade_id, domingo, texto, referencia, autor_id)
  values (public.clube_atual_id(), p_unidade, v_dom, left(v_txt, 1000), left(nullif(btrim(coalesce(p_referencia, '')), ''), 60), auth.uid())
  on conflict (unidade_id, domingo) do update
    set texto = excluded.texto, referencia = excluded.referencia, autor_id = excluded.autor_id, updated_at = now();
  return jsonb_build_object('ok', true, 'domingo', v_dom);
end $$;
revoke all on function public.cantinho_meditacao_salvar(uuid, text, text) from public, anon;
grant execute on function public.cantinho_meditacao_salvar(uuid, text, text) to authenticated;

-- ---------- 4) pedidos de oração / agradecimentos ----------
create or replace function public.cantinho_mural_enviar(p_unidade uuid, p_tipo text, p_texto text, p_privado boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_txt text := nullif(btrim(coalesce(p_texto, '')), ''); v_club uuid := public.clube_atual_id();
begin
  perform public._cantinho_exigir(p_unidade, 'membro');
  if p_tipo not in ('pedido', 'agradecimento') then raise exception 'Tipo inválido.'; end if;
  if v_txt is null then raise exception 'Escreva o seu pedido ou agradecimento.'; end if;
  if char_length(v_txt) > 280 then raise exception 'Texto longo demais (máximo 280 letras).'; end if;
  -- freio de abuso: no máximo 10 por pessoa por semana
  if (select count(*) from public.unidade_mural where club_id = v_club and autor_id = auth.uid()
        and semana = public.cantinho_domingo(now())) >= 10 then
    raise exception 'Você já enviou 10 nesta semana. Fale com o seu conselheiro.';
  end if;
  insert into public.unidade_mural (club_id, unidade_id, autor_id, tipo, texto, privado, semana)
  values (v_club, p_unidade, auth.uid(), p_tipo, v_txt, coalesce(p_privado, false), public.cantinho_domingo(now()))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.cantinho_mural_enviar(uuid, text, text, boolean) from public, anon;
grant execute on function public.cantinho_mural_enviar(uuid, text, text, boolean) to authenticated;

-- moderação: o conselheiro/diretoria esconde (ou mostra de novo) do resto da unidade
create or replace function public.cantinho_mural_moderar(p_id uuid, p_oculto boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_un uuid;
begin
  select unidade_id into v_un from public.unidade_mural where id = p_id and club_id = public.clube_atual_id();
  if v_un is null then raise exception 'Mensagem não encontrada.'; end if;
  perform public._cantinho_exigir(v_un, 'lider');
  update public.unidade_mural set oculto = coalesce(p_oculto, true),
         oculto_por = case when coalesce(p_oculto, true) then auth.uid() end
   where id = p_id;
end $$;
revoke all on function public.cantinho_mural_moderar(uuid, boolean) from public, anon;
grant execute on function public.cantinho_mural_moderar(uuid, boolean) to authenticated;

-- apagar de vez: o próprio autor, ou o conselheiro/diretoria
create or replace function public.cantinho_mural_apagar(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_m public.unidade_mural;
begin
  select * into v_m from public.unidade_mural where id = p_id and club_id = public.clube_atual_id();
  if not found then raise exception 'Mensagem não encontrada.'; end if;
  if v_m.autor_id = auth.uid() then
    perform public._cantinho_exigir(v_m.unidade_id, 'membro');
  else
    perform public._cantinho_exigir(v_m.unidade_id, 'lider');
  end if;
  delete from public.unidade_mural where id = p_id;
end $$;
revoke all on function public.cantinho_mural_apagar(uuid) from public, anon;
grant execute on function public.cantinho_mural_apagar(uuid) to authenticated;

-- ---------- 5) ajudar os pais (entra na pontuação) ----------
-- o desbravador conta o que fez (fica PENDENTE; ainda não vale ponto)
create or replace function public.cantinho_ajuda_registrar(p_unidade uuid, p_descricao text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_club uuid := public.clube_atual_id();
begin
  perform public._cantinho_exigir(p_unidade, 'membro');
  if not public._cantinho_da_unidade(auth.uid(), p_unidade, true) then raise exception 'Só o desbravador registra a própria ajuda.'; end if;
  insert into public.unidade_ajuda_pais (club_id, unidade_id, usuario_id, semana, descricao, registrado_por)
  values (v_club, p_unidade, auth.uid(), public.cantinho_domingo(now()), left(nullif(btrim(coalesce(p_descricao, '')), ''), 200), auth.uid())
  on conflict (club_id, usuario_id, semana) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'Você já registrou a ajuda desta semana.'; end if;
  return v_id;
end $$;
revoke all on function public.cantinho_ajuda_registrar(uuid, text) from public, anon;
grant execute on function public.cantinho_ajuda_registrar(uuid, text) to authenticated;

-- o conselheiro confirma (ou lança direto): gera o ponto, 1x por semana por desbravador.
-- O ponto nasce com lancado_por = quem confirmou, então o teto de pontos do conselheiro
-- (gatilho limita_pontos_conselheiro) vale aqui também.
create or replace function public.cantinho_ajuda_confirmar(p_unidade uuid, p_usuario uuid, p_descricao text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_dom date := public.cantinho_domingo(now());
  v_a public.unidade_ajuda_pais;
  v_valor int;
  v_ponto uuid; v_pts int;
begin
  perform public._cantinho_exigir(p_unidade, 'lider');
  if p_usuario = auth.uid() then raise exception 'Você não confirma a sua própria ajuda.'; end if;
  if not public._cantinho_da_unidade(p_usuario, p_unidade, true) then raise exception 'Esta pessoa não é desbravador(a) desta unidade.'; end if;

  select * into v_a from public.unidade_ajuda_pais where club_id = v_club and usuario_id = p_usuario and semana = v_dom for update;
  if found and v_a.status = 'confirmado' then raise exception 'A ajuda desta semana já foi confirmada (vale 1x por semana).'; end if;
  if not found then
    insert into public.unidade_ajuda_pais (club_id, unidade_id, usuario_id, semana, descricao, registrado_por)
    values (v_club, p_unidade, p_usuario, v_dom, left(nullif(btrim(coalesce(p_descricao, '')), ''), 200), auth.uid())
    returning * into v_a;
  end if;

  v_valor := public._cantinho_pontos_ajuda(v_club);
  if v_valor > 0 then
    insert into public.pontos (usuario_id, origem, pontos, motivo, data, lancado_por, club_id)
    values (p_usuario, 'ajuda_pais', v_valor, 'Ajudou em casa (semana de ' || to_char(v_dom, 'DD/MM') || ')', now(), auth.uid(), v_club)
    returning id, pontos into v_ponto, v_pts;
  else
    v_pts := 0;
  end if;

  update public.unidade_ajuda_pais
     set status = 'confirmado', ponto_id = v_ponto, pontos = v_pts, confirmado_por = auth.uid(),
         descricao = coalesce(descricao, left(nullif(btrim(coalesce(p_descricao, '')), ''), 200))
   where id = v_a.id;
  return jsonb_build_object('ok', true, 'pontos', v_pts, 'semana', v_dom);
end $$;
revoke all on function public.cantinho_ajuda_confirmar(uuid, uuid, text) from public, anon;
grant execute on function public.cantinho_ajuda_confirmar(uuid, uuid, text) to authenticated;

-- desfazer (engano): apaga o registro da semana e o ponto que ele gerou
create or replace function public.cantinho_ajuda_desfazer(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_a public.unidade_ajuda_pais;
begin
  select * into v_a from public.unidade_ajuda_pais where id = p_id and club_id = public.clube_atual_id();
  if not found then raise exception 'Registro não encontrado.'; end if;
  perform public._cantinho_exigir(v_a.unidade_id, 'lider');
  if v_a.ponto_id is not null then delete from public.pontos where id = v_a.ponto_id and club_id = v_a.club_id; end if;
  delete from public.unidade_ajuda_pais where id = p_id;
end $$;
revoke all on function public.cantinho_ajuda_desfazer(uuid) from public, anon;
grant execute on function public.cantinho_ajuda_desfazer(uuid) to authenticated;

-- valor do ponto por clube (só a diretoria)
create or replace function public.cantinho_config_definir(p_pontos_ajuda_pais integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null or v_club is null or not public.pode_administrar_clube(v_club) then
    raise exception 'Sem permissão (apenas a diretoria deste clube).';
  end if;
  if p_pontos_ajuda_pais is null or p_pontos_ajuda_pais < 0 or p_pontos_ajuda_pais > 50 then
    raise exception 'Valor entre 0 e 50 pontos.';
  end if;
  insert into public.unidade_cantinho_config (club_id, pontos_ajuda_pais) values (v_club, p_pontos_ajuda_pais)
  on conflict (club_id) do update set pontos_ajuda_pais = excluded.pontos_ajuda_pais, updated_at = now();
  return jsonb_build_object('ok', true, 'pontos_ajuda_pais', p_pontos_ajuda_pais);
end $$;
revoke all on function public.cantinho_config_definir(integer) from public, anon;
grant execute on function public.cantinho_config_definir(integer) to authenticated;

-- ---------- 7) reuniões da unidade ----------
create or replace function public.cantinho_reuniao_salvar(p_unidade uuid, p_id uuid, p_inicio timestamptz, p_local text, p_pauta text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public._cantinho_exigir(p_unidade, 'lider');
  if p_inicio is null then raise exception 'Informe data e hora.'; end if;
  if p_id is null then
    insert into public.unidade_reunioes (club_id, unidade_id, inicio, local, pauta, criado_por)
    values (public.clube_atual_id(), p_unidade, p_inicio, left(nullif(btrim(coalesce(p_local, '')), ''), 120),
            left(nullif(btrim(coalesce(p_pauta, '')), ''), 500), auth.uid())
    returning id into v_id;
  else
    update public.unidade_reunioes set inicio = p_inicio, local = left(nullif(btrim(coalesce(p_local, '')), ''), 120),
           pauta = left(nullif(btrim(coalesce(p_pauta, '')), ''), 500)
     where id = p_id and unidade_id = p_unidade and club_id = public.clube_atual_id()
    returning id into v_id;
    if v_id is null then raise exception 'Reunião não encontrada.'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.cantinho_reuniao_salvar(uuid, uuid, timestamptz, text, text) from public, anon;
grant execute on function public.cantinho_reuniao_salvar(uuid, uuid, timestamptz, text, text) to authenticated;

create or replace function public.cantinho_reuniao_excluir(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_un uuid;
begin
  select unidade_id into v_un from public.unidade_reunioes where id = p_id and club_id = public.clube_atual_id();
  if v_un is null then raise exception 'Reunião não encontrada.'; end if;
  perform public._cantinho_exigir(v_un, 'lider');
  delete from public.unidade_reunioes where id = p_id;
end $$;
revoke all on function public.cantinho_reuniao_excluir(uuid) from public, anon;
grant execute on function public.cantinho_reuniao_excluir(uuid) to authenticated;

-- ---------- 8) planejamento ----------
create or replace function public.cantinho_plano_salvar(p_unidade uuid, p_id uuid, p_titulo text, p_detalhe text, p_status text, p_prazo date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tit text := nullif(btrim(coalesce(p_titulo, '')), ''); v_st text := coalesce(p_status, 'a_fazer');
begin
  perform public._cantinho_exigir(p_unidade, 'lider');
  if v_tit is null then raise exception 'Dê um título à meta/tarefa.'; end if;
  if v_st not in ('a_fazer', 'fazendo', 'feito') then raise exception 'Status inválido.'; end if;
  if p_id is null then
    insert into public.unidade_planejamento (club_id, unidade_id, titulo, detalhe, status, prazo, criado_por)
    values (public.clube_atual_id(), p_unidade, left(v_tit, 120), left(nullif(btrim(coalesce(p_detalhe, '')), ''), 500), v_st, p_prazo, auth.uid())
    returning id into v_id;
  else
    update public.unidade_planejamento
       set titulo = left(v_tit, 120), detalhe = left(nullif(btrim(coalesce(p_detalhe, '')), ''), 500),
           status = v_st, prazo = p_prazo, updated_at = now()
     where id = p_id and unidade_id = p_unidade and club_id = public.clube_atual_id()
    returning id into v_id;
    if v_id is null then raise exception 'Item não encontrado.'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.cantinho_plano_salvar(uuid, uuid, text, text, text, date) from public, anon;
grant execute on function public.cantinho_plano_salvar(uuid, uuid, text, text, text, date) to authenticated;

create or replace function public.cantinho_plano_excluir(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_un uuid;
begin
  select unidade_id into v_un from public.unidade_planejamento where id = p_id and club_id = public.clube_atual_id();
  if v_un is null then raise exception 'Item não encontrado.'; end if;
  perform public._cantinho_exigir(v_un, 'lider');
  delete from public.unidade_planejamento where id = p_id;
end $$;
revoke all on function public.cantinho_plano_excluir(uuid) from public, anon;
grant execute on function public.cantinho_plano_excluir(uuid) to authenticated;

notify pgrst, 'reload schema';
