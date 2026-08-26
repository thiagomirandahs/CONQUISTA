-- =====================================================================
--  Filhos da Conquista — Bichinho virtual (mascote de cuidado diário)
--  (2026-08-26)  [revisado: anti-farm + ofensiva tolerante + aviso de morte]
--
--  Cada desbravador adota UM mascote e cuida todo dia: alimentar 🍎, dar
--  banho 🛁, brincar 🎾. As 3 barrinhas (fome/higiene/felicidade) caem com
--  o tempo. Cuidar (no máximo 1x a cada ~20h, pra não farmar na virada do
--  dia) dá +2 pontos e conta uma OFENSIVA de dias seguidos. Se ficar 3 dias
--  SEM nenhum cuidado, o bichinho morre — aí é só ADOTAR um novo.
--
--  Anti-farm (revisão):
--   * O ponto/ofensiva/crescimento só contam se passaram ~20h desde a
--     última vez que contou (senão dava pra pegar +2 às 23h59 e de novo às
--     00h01). O relógio é do servidor.
--   * cuidar() também exige cadastro ativo (não só adotar).
--   * Crescimento conta por DIA de cuidado (dias_cuidados), não por clique.
--   * Ofensiva tolera perder 1 dia (não zera à toa; o bicho sobrevive 3).
--
--  Sem cron: barrinhas caem por CÁLCULO na leitura (a partir de quando
--  foram atualizadas). meu_bichinho também devolve o "cronômetro de morte"
--  pra tela avisar antes.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Depende de eh_teste()/pontos já existirem.
-- =====================================================================

create table if not exists public.bichinhos (
  usuario_id uuid primary key references public.profiles(id) on delete cascade,
  especie text not null,
  nome text not null,
  fome int not null default 100,
  higiene int not null default 100,
  felicidade int not null default 100,
  atualizado_em timestamptz not null default now(),    -- base do decaimento das barrinhas
  ultimo_cuidado_em timestamptz not null default now(),-- qualquer cuidado (reseta o timer de morte)
  pontuado_em timestamptz,                             -- última vez que contou ponto/ofensiva (gate ~20h)
  dias_cuidados int not null default 0,                -- dias que renderam cuidado (crescimento)
  cuidados_total int not null default 0,               -- total de cliques de cuidado (curiosidade)
  ofensiva int not null default 0,
  vivo boolean not null default true,
  morto_em timestamptz,
  nascido_em timestamptz not null default now(),
  constraint bichinhos_especie_valida check (especie in ('cachorro', 'gato', 'coelho', 'passaro')),
  constraint bichinhos_nome_ok check (length(trim(nome)) between 1 and 20)
);
alter table public.bichinhos enable row level security;
grant select on public.bichinhos to authenticated;
drop policy if exists "ler meu bichinho" on public.bichinhos;
create policy "ler meu bichinho" on public.bichinhos for select to authenticated
  using (usuario_id = auth.uid() or public.pode_gerir());

-- Estágio de crescimento por DIAS de cuidado (não por clique).
create or replace function public._bichinho_estagio(p_dias int)
returns int language sql immutable as $$
  select case when p_dias < 5 then 1 when p_dias < 15 then 2 else 3 end;
$$;

-- ---------- Ler o meu bichinho (barrinhas decaídas + cronômetro de morte) ----------
create or replace function public.meu_bichinho()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  b record;
  v_vivo boolean;
  v_morto_em timestamptz;
  v_h numeric;             -- horas desde atualizado_em (decaimento das barrinhas)
  v_sem numeric;           -- horas desde o último cuidado (timer de morte)
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into b from public.bichinhos where usuario_id = v_uid;
  if not found then return json_build_object('tem', false); end if;

  v_vivo := b.vivo;
  v_morto_em := b.morto_em;
  v_sem := extract(epoch from (now() - b.ultimo_cuidado_em)) / 3600.0;
  -- morreu de abandono (3 dias = 72h)? persiste. O cronômetro só vale DEPOIS
  -- do 1º cuidado (pontuado_em) — bichinho recém-adotado espera por você, não
  -- morre por ninguém ter cuidado ainda (protege 'adotou e foi pro acampamento').
  if v_vivo and b.pontuado_em is not null and v_sem > 72 then
    v_vivo := false;
    v_morto_em := b.ultimo_cuidado_em + interval '72 hours';
    update public.bichinhos set vivo = false, morto_em = v_morto_em where usuario_id = v_uid;
  end if;

  v_h := extract(epoch from (now() - b.atualizado_em)) / 3600.0;

  return json_build_object(
    'tem', true, 'especie', b.especie, 'nome', b.nome, 'vivo', v_vivo,
    'fome',       case when v_vivo then greatest(0, b.fome       - floor(3 * v_h))::int else 0 end,
    'higiene',    case when v_vivo then greatest(0, b.higiene    - floor(3 * v_h))::int else 0 end,
    'felicidade', case when v_vivo then greatest(0, b.felicidade - floor(3 * v_h))::int else 0 end,
    'estagio', public._bichinho_estagio(b.dias_cuidados),
    'ofensiva', b.ofensiva, 'cuidados_total', b.cuidados_total, 'dias_cuidados', b.dias_cuidados,
    -- pode ganhar ponto agora? (passou ~20h desde o último que contou)
    'pode_pontuar', v_vivo and (b.pontuado_em is null or now() - b.pontuado_em >= interval '20 hours'),
    -- cronômetro de morte, pra tela avisar antes (perigo a partir de 36h sem cuidar)
    'horas_sem_cuidado', round(v_sem)::int,
    'em_perigo', v_vivo and b.pontuado_em is not null and v_sem >= 36,
    'nascido_em', b.nascido_em, 'morto_em', v_morto_em
  );
end;
$$;
grant execute on function public.meu_bichinho() to authenticated;

-- ---------- Adotar (novo ou depois que o anterior morreu) ----------
create or replace function public.bichinho_adotar(p_nome text, p_especie text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_nome text := trim(coalesce(p_nome, ''));
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ativo') then
    raise exception 'Seu cadastro precisa estar ativo pra adotar um bichinho.';
  end if;
  if p_especie not in ('cachorro', 'gato', 'coelho', 'passaro') then raise exception 'Espécie inválida.'; end if;
  if length(v_nome) < 1 then raise exception 'Dê um nome pro bichinho.'; end if;
  if length(v_nome) > 20 then raise exception 'Nome muito longo (máx. 20 letras).'; end if;

  -- Serializa por usuário (evita corrida de 2 adoções).
  perform pg_advisory_xact_lock(hashtext('bichinho:' || v_uid::text));

  -- Se ainda tem um vivo (dentro das 72h), não deixa trocar (evita resetar pra fugir do cuidado).
  if exists (select 1 from public.bichinhos b where b.usuario_id = v_uid and b.vivo
             and now() - b.ultimo_cuidado_em <= interval '72 hours') then
    raise exception 'Você já tem um bichinho vivo! Cuide bem dele. 🐾';
  end if;

  insert into public.bichinhos
    (usuario_id, especie, nome, fome, higiene, felicidade, atualizado_em, ultimo_cuidado_em,
     pontuado_em, dias_cuidados, cuidados_total, ofensiva, vivo, morto_em, nascido_em)
  values (v_uid, p_especie, v_nome, 100, 100, 100, now(), now(), null, 0, 0, 0, true, null, now())
  on conflict (usuario_id) do update set
    especie = excluded.especie, nome = excluded.nome, fome = 100, higiene = 100, felicidade = 100,
    atualizado_em = now(), ultimo_cuidado_em = now(), pontuado_em = null,
    dias_cuidados = 0, cuidados_total = 0, ofensiva = 0, vivo = true, morto_em = null, nascido_em = now();

  return json_build_object('ok', true);
end;
$$;
grant execute on function public.bichinho_adotar(text, text) to authenticated;

-- ---------- Cuidar (alimentar / banho / brincar) ----------
create or replace function public.bichinho_cuidar(p_acao text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  b record;
  v_h numeric;
  v_fome int; v_hig int; v_fel int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_conta boolean := false;   -- este cuidado CONTA (passou ~20h desde o último que contou)?
  v_ativo boolean;
  v_pontos int := 0;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_acao not in ('alimentar', 'banho', 'brincar') then raise exception 'Ação inválida.'; end if;

  select * into b from public.bichinhos where usuario_id = v_uid for update;
  if not found then raise exception 'Você ainda não tem um bichinho. Adote um! 🐾'; end if;

  -- morte por abandono (72h) — só conta depois do 1º cuidado (pontuado_em)
  if b.vivo and b.pontuado_em is not null and now() - b.ultimo_cuidado_em > interval '72 hours' then
    update public.bichinhos set vivo = false, morto_em = b.ultimo_cuidado_em + interval '72 hours'
      where usuario_id = v_uid;
    return json_build_object('morreu', true);
  end if;
  if not b.vivo then return json_build_object('morreu', true); end if;

  -- decai até agora, depois aplica a ação (enche a barrinha respectiva)
  v_h := extract(epoch from (now() - b.atualizado_em)) / 3600.0;
  v_fome := greatest(0, b.fome       - floor(3 * v_h))::int;
  v_hig  := greatest(0, b.higiene    - floor(3 * v_h))::int;
  v_fel  := greatest(0, b.felicidade - floor(3 * v_h))::int;
  if p_acao = 'alimentar' then v_fome := 100;
  elsif p_acao = 'banho' then v_hig := 100;
  else v_fel := 100; end if;

  -- Este cuidado CONTA pra ponto/ofensiva/crescimento? Só a cada ~20h.
  v_conta := (b.pontuado_em is null or now() - b.pontuado_em >= interval '20 hours');
  v_ativo := exists (select 1 from public.profiles where id = v_uid and status = 'ativo');

  update public.bichinhos set
    fome = v_fome, higiene = v_hig, felicidade = v_fel,
    atualizado_em = now(), ultimo_cuidado_em = now(),
    cuidados_total = b.cuidados_total + 1,
    dias_cuidados = b.dias_cuidados + (case when v_conta then 1 else 0 end),
    -- ofensiva: tolera perder 1 dia (conta se o último ponto foi há menos de 48h)
    ofensiva = case
      when not v_conta then b.ofensiva
      when b.pontuado_em is not null and now() - b.pontuado_em < interval '48 hours' then b.ofensiva + 1
      else 1 end,
    pontuado_em = case when v_conta then now() else b.pontuado_em end
  where usuario_id = v_uid;

  -- Pontua (+2) só quando conta E o cadastro está ativo E não é conta de teste.
  if v_conta and v_ativo and not public.eh_teste() then
    v_pontos := 2;
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_uid, 'bichinho', 2, 'Cuidou do bichinho ' || to_char(v_hoje, 'DD/MM'));
  end if;

  return json_build_object('ok', true, 'pontos_ganhos', v_pontos, 'contou', v_conta,
    'fome', v_fome, 'higiene', v_hig, 'felicidade', v_fel);
end;
$$;
grant execute on function public.bichinho_cuidar(text) to authenticated;

notify pgrst, 'reload schema';
