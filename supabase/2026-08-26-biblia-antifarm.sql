-- =====================================================================
--  Filhos da Conquista — Bíblia: leitura com tempo mínimo (anti-atalho)
--  (2026-08-26)
--
--  PROBLEMA: do jeito anterior, dava pra abrir 10 capítulos em segundos e
--  pegar os 20 pontos do dia sem ler NADA. Agora a leitura tem 2 passos no
--  servidor:
--    1) "abrir" (biblia_iniciar_leitura) grava a HORA que a pessoa abriu o
--       capítulo, no banco.
--    2) "confirmar" (biblia_confirmar_leitura) só pontua se passou o tempo
--       mínimo (proporcional ao tamanho do capítulo) NAQUELE capítulo.
--  Como só existe UMA leitura em andamento por pessoa, não dá pra abrir
--  vários em paralelo e confirmar todos de uma vez — tem que ler um de cada
--  vez. O cliente ajuda mostrando o tempo, mas quem MANDA é o servidor: a
--  hora de abrir e a de confirmar são do banco, não do aparelho, então não
--  dá pra burlar chamando a API na mão.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado. Capítulos já lidos antes continuam lidos.
-- =====================================================================

-- Uma leitura "em andamento" por pessoa (a hora em que abriu o capítulo).
create table if not exists public.biblia_leitura_atual (
  usuario_id uuid primary key references public.profiles(id) on delete cascade,
  livro_abrev text not null references public.biblia_livros(abrev) on delete cascade,
  capitulo int not null,
  aberto_em timestamptz not null default now()
);
alter table public.biblia_leitura_atual enable row level security;
drop policy if exists "ler minha leitura atual" on public.biblia_leitura_atual;
create policy "ler minha leitura atual" on public.biblia_leitura_atual for select to authenticated
  using (usuario_id = auth.uid() or public.pode_gerir());

-- Tempo mínimo (segundos) pra pontuar: ~3s por versículo, mínimo 12s e
-- máximo 60s (capítulo grande não vira castigo). Determinístico no servidor.
create or replace function public._biblia_segundos_min(p_livro_abrev text, p_capitulo int)
returns int language sql stable security definer set search_path = '' as $$
  select greatest(12, least(60, coalesce((
    select count(*) from public.biblia_versiculos
    where livro_abrev = p_livro_abrev and capitulo = p_capitulo
  ), 0)::int * 3));
$$;
grant execute on function public._biblia_segundos_min(text, int) to authenticated;

-- ---------------------------------------------------------------------
-- Passo 1: ABRIR o capítulo. Grava a hora no banco e devolve quantos
-- segundos AINDA FALTAM de leitura antes de pontuar.
--   * Reabrir o MESMO capítulo (interrupção normal: notificação, tela
--     bloqueou, trocou de aba, recarregou) NÃO zera o cronômetro — retoma
--     de onde parou. Trocar de capítulo, sim, começa do zero.
-- ---------------------------------------------------------------------
create or replace function public.biblia_iniciar_leitura(p_livro_abrev text, p_capitulo int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_max int;
  v_req int;
  v_aberto timestamptz;
  v_restante int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ativo') then
    raise exception 'Você precisa estar com o cadastro ativo pra ler a Bíblia no app.';
  end if;
  select capitulos into v_max from public.biblia_livros where abrev = p_livro_abrev;
  if v_max is null then raise exception 'Livro inválido.'; end if;
  if p_capitulo < 1 or p_capitulo > v_max then raise exception 'Capítulo inválido.'; end if;

  -- Já lido antes? pode reler à vontade, sem tempo e sem pontos de novo.
  if exists (select 1 from public.biblia_leituras
             where usuario_id = v_uid and livro_abrev = p_livro_abrev and capitulo = p_capitulo) then
    return json_build_object('ja_lido', true, 'segundos', 0);
  end if;

  v_req := public._biblia_segundos_min(p_livro_abrev, p_capitulo);

  -- Marca ESTE como a leitura em andamento (troca qualquer outra que
  -- estivesse aberta — só dá pra ler um capítulo de cada vez). Se já era o
  -- mesmo capítulo, PRESERVA o aberto_em (retoma o tempo já corrido).
  insert into public.biblia_leitura_atual (usuario_id, livro_abrev, capitulo, aberto_em)
  values (v_uid, p_livro_abrev, p_capitulo, now())
  on conflict (usuario_id) do update
    set livro_abrev = excluded.livro_abrev,
        capitulo = excluded.capitulo,
        aberto_em = case
          when biblia_leitura_atual.livro_abrev = excluded.livro_abrev
           and biblia_leitura_atual.capitulo = excluded.capitulo
          then biblia_leitura_atual.aberto_em
          else now()
        end
  returning aberto_em into v_aberto;

  v_restante := greatest(0, v_req - floor(extract(epoch from (now() - v_aberto)))::int);
  return json_build_object('ja_lido', false, 'segundos', v_restante);
end;
$$;
grant execute on function public.biblia_iniciar_leitura(text, int) to authenticated;

-- ---------------------------------------------------------------------
-- Passo 2: CONFIRMAR a leitura. Só marca como lido e pontua se o capítulo
-- confirmado é o mesmo que foi aberto E já passou o tempo mínimo.
-- ---------------------------------------------------------------------
create or replace function public.biblia_confirmar_leitura(p_livro_abrev text, p_capitulo int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_atual record;
  v_segundos int;
  v_pontos_hoje int;
  v_pontos_ganhos int := 0;
  v_limite boolean := false;
  v_total int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  -- Revalida o cadastro ativo aqui também (não só no abrir), pra quem foi
  -- desativado entre abrir e confirmar não pontuar.
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ativo') then
    raise exception 'Você precisa estar com o cadastro ativo pra ganhar pontos lendo.';
  end if;

  -- Já lido? nada a fazer (não pontua de novo).
  if exists (select 1 from public.biblia_leituras
             where usuario_id = v_uid and livro_abrev = p_livro_abrev and capitulo = p_capitulo) then
    select count(*) into v_total from public.biblia_leituras where usuario_id = v_uid;
    return json_build_object('lido', true, 'ja_lido', true, 'pontos_ganhos', 0, 'total_capitulos_lidos', v_total);
  end if;

  -- Trava a linha da leitura em andamento (evita 2 confirmações em corrida).
  select * into v_atual from public.biblia_leitura_atual where usuario_id = v_uid for update;

  -- Não abriu, ou abriu OUTRO capítulo depois: não vale.
  if not found or v_atual.livro_abrev <> p_livro_abrev or v_atual.capitulo <> p_capitulo then
    return json_build_object('invalido', true);
  end if;

  v_segundos := public._biblia_segundos_min(p_livro_abrev, p_capitulo);
  if now() - v_atual.aberto_em < make_interval(secs => v_segundos) then
    return json_build_object('muito_rapido', true,
      'faltam', greatest(0, ceil(v_segundos - extract(epoch from (now() - v_atual.aberto_em)))::int));
  end if;

  -- Passou no tempo: marca como lido (permanente) e limpa a leitura atual.
  insert into public.biblia_leituras (usuario_id, livro_abrev, capitulo)
  values (v_uid, p_livro_abrev, p_capitulo)
  on conflict (usuario_id, livro_abrev, capitulo) do nothing;
  delete from public.biblia_leitura_atual where usuario_id = v_uid;

  -- Pontua (+2, teto 20/dia). Conta de teste não pontua.
  if not public.eh_teste() then
    select coalesce(sum(pontos), 0) into v_pontos_hoje from public.pontos
    where usuario_id = v_uid and origem = 'biblia'
      and (data at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;
    if v_pontos_hoje < 20 then
      v_pontos_ganhos := least(2, 20 - v_pontos_hoje);
      insert into public.pontos (usuario_id, origem, pontos, motivo)
      values (v_uid, 'biblia', v_pontos_ganhos,
              'Leu ' || (select nome from public.biblia_livros where abrev = p_livro_abrev) || ' ' || p_capitulo);
    else
      -- Leu de verdade mas já bateu o teto do dia: conta o progresso, avisa
      -- que o limite foi atingido (pra tela não parecer que "roubou" ponto).
      v_limite := true;
    end if;
  end if;

  select count(*) into v_total from public.biblia_leituras where usuario_id = v_uid;
  return json_build_object('lido', true, 'ja_lido', false, 'pontos_ganhos', v_pontos_ganhos,
                           'limite_diario', v_limite, 'total_capitulos_lidos', v_total);
end;
$$;
grant execute on function public.biblia_confirmar_leitura(text, int) to authenticated;

-- Aposenta a função antiga de 1 passo (agora é abrir + confirmar).
drop function if exists public.registrar_leitura_biblia(text, int);

notify pgrst, 'reload schema';
