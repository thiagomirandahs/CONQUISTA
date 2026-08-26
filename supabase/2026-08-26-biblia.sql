-- =====================================================================
--  Filhos da Conquista — Bíblia no app (2026-08-26)
--  Leitor completo (ACF, domínio público) + pontos por capítulo lido +
--  link a partir do Devocional pro capítulo do versículo do dia.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado. O TEXTO da Bíblia (66 livros/31106
--  versículos) é importado à parte via CSV (Table Editor), não por aqui.
-- =====================================================================

create table if not exists public.biblia_livros (
  abrev text primary key,
  nome text not null,
  ordem int not null,
  testamento text not null check (testamento in ('AT', 'NT')),
  capitulos int not null
);
alter table public.biblia_livros enable row level security;
drop policy if exists "ler livros biblia" on public.biblia_livros;
create policy "ler livros biblia" on public.biblia_livros for select to authenticated using (true);

create table if not exists public.biblia_versiculos (
  livro_abrev text not null references public.biblia_livros(abrev) on delete cascade,
  capitulo int not null,
  versiculo int not null,
  texto text not null,
  primary key (livro_abrev, capitulo, versiculo)
);
alter table public.biblia_versiculos enable row level security;
drop policy if exists "ler versiculos biblia" on public.biblia_versiculos;
create policy "ler versiculos biblia" on public.biblia_versiculos for select to authenticated using (true);

-- Quais capítulos cada um já leu (progresso + evita pontuar 2x o mesmo capítulo)
create table if not exists public.biblia_leituras (
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  livro_abrev text not null references public.biblia_livros(abrev) on delete cascade,
  capitulo int not null,
  lido_em timestamptz not null default now(),
  primary key (usuario_id, livro_abrev, capitulo)
);
alter table public.biblia_leituras enable row level security;
drop policy if exists "ler minhas leituras biblia" on public.biblia_leituras;
create policy "ler minhas leituras biblia" on public.biblia_leituras for select to authenticated
  using (usuario_id = auth.uid() or public.pode_gerir());

-- ---------------------------------------------------------------------
-- Marca um capítulo como lido. 1ª vez que lê aquele capítulo = pontua
-- (+2, teto de 20/dia vindos da Bíblia = 10 capítulos "pagos" por dia;
-- pode continuar lendo além disso, só não ganha ponto novo). Conta de
-- teste não pontua. Idempotente: reler um capítulo já lido não dá erro
-- nem ponto de novo.
-- ---------------------------------------------------------------------
create or replace function public.registrar_leitura_biblia(p_livro_abrev text, p_capitulo int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_max_capitulos int;
  v_rows int;
  v_pontos_hoje int;
  v_pontos_ganhos int := 0;
  v_total_lidos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ativo') then
    raise exception 'Você precisa estar com o cadastro ativo pra ler a Bíblia no app.';
  end if;

  select capitulos into v_max_capitulos from public.biblia_livros where abrev = p_livro_abrev;
  if v_max_capitulos is null then raise exception 'Livro inválido.'; end if;
  if p_capitulo < 1 or p_capitulo > v_max_capitulos then raise exception 'Capítulo inválido.'; end if;

  -- on conflict do nothing + row_count: idempotente e sem corrida (2 cliques
  -- rápidos no mesmo capítulo nunca dão erro nem pontuam 2x)
  insert into public.biblia_leituras (usuario_id, livro_abrev, capitulo)
  values (v_uid, p_livro_abrev, p_capitulo)
  on conflict (usuario_id, livro_abrev, capitulo) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows > 0 and not public.eh_teste() then
    select coalesce(sum(pontos), 0) into v_pontos_hoje from public.pontos
    where usuario_id = v_uid and origem = 'biblia'
      and (data at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;

    if v_pontos_hoje < 20 then
      v_pontos_ganhos := least(2, 20 - v_pontos_hoje);
      insert into public.pontos (usuario_id, origem, pontos, motivo)
      values (v_uid, 'biblia', v_pontos_ganhos,
              'Leu ' || (select nome from public.biblia_livros where abrev = p_livro_abrev) || ' ' || p_capitulo);
    end if;
  end if;

  select count(*) into v_total_lidos from public.biblia_leituras where usuario_id = v_uid;

  return json_build_object('ja_lido', v_rows = 0, 'pontos_ganhos', v_pontos_ganhos, 'total_capitulos_lidos', v_total_lidos);
end;
$$;
grant execute on function public.registrar_leitura_biblia(text, int) to authenticated;

-- Meu progresso de leitura (pra tela da Bíblia e pro Perfil)
create or replace function public.minha_leitura_biblia()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'total_lidos', (select count(*) from public.biblia_leituras where usuario_id = auth.uid()),
    'total_capitulos', (select coalesce(sum(capitulos), 0) from public.biblia_livros),
    'capitulos', (
      select coalesce(json_agg(json_build_object('livro_abrev', livro_abrev, 'capitulo', capitulo)), '[]'::json)
      from public.biblia_leituras where usuario_id = auth.uid()
    )
  );
$$;
grant execute on function public.minha_leitura_biblia() to authenticated;

-- ---------------------------------------------------------------------
-- Liga o Devocional à Bíblia: cada versículo-quiz aponta pro capítulo
-- inteiro (pra "ler o capítulo depois de responder"). O abrev/capítulo só
-- entram no retorno de registrar_devocional (chamado DEPOIS de responder),
-- nunca em versiculo_do_dia() — senão entregaria a resposta do quiz de graça.
-- ---------------------------------------------------------------------
alter table public.versiculos add column if not exists livro_abrev text references public.biblia_livros(abrev);
alter table public.versiculos add column if not exists capitulo int;
alter table public.versiculos add column if not exists versiculo_num int;

-- Redefine a função que o popup do Devocional realmente chama (registrar_devocional/1
-- em 2026-06-30-devocional-popup.sql), só acrescentando livro_abrev/capitulo no retorno.
drop function if exists public.registrar_devocional(text, int);
create or replace function public.registrar_devocional(p_resposta int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_correta int; v_acertou boolean := false;
  v_livro_abrev text; v_capitulo int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  with v as (
    select vs.correta, vs.livro_abrev, vs.capitulo, row_number() over (order by vs.created_at, vs.id) - 1 as i
    from public.versiculos vs where vs.ativo
  ), n as (select count(*) c from v)
  select v.correta, v.livro_abrev, v.capitulo into v_correta, v_livro_abrev, v_capitulo
  from v cross join n where n.c > 0 and v.i = (v_idx % nullif(n.c, 0));
  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  insert into public.devocional (usuario_id, data, acertou_quiz)
  values (v_uid, v_hoje, v_acertou);
  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'devocional', 5, 'Devocional ' || to_char(v_hoje, 'DD/MM'));
  return json_build_object('acertou', v_acertou, 'pontos', 5, 'livro_abrev', v_livro_abrev, 'capitulo', v_capitulo);
exception when unique_violation then
  raise exception 'Você já fez o devocional de hoje! 🙂';
end;
$$;
grant execute on function public.registrar_devocional(int) to authenticated;

-- Liga os 20 versículos-seed do devocional aos capítulos correspondentes
update public.versiculos set livro_abrev = 'jo', capitulo = 3, versiculo_num = 16 where referencia = 'João 3:16';
update public.versiculos set livro_abrev = 'sl', capitulo = 23, versiculo_num = 1 where referencia = 'Salmos 23:1';
update public.versiculos set livro_abrev = 'fp', capitulo = 4, versiculo_num = 13 where referencia = 'Filipenses 4:13';
update public.versiculos set livro_abrev = 'pv', capitulo = 3, versiculo_num = 5 where referencia = 'Provérbios 3:5';
update public.versiculos set livro_abrev = 'jo', capitulo = 14, versiculo_num = 6 where referencia = 'João 14:6';
update public.versiculos set livro_abrev = 'is', capitulo = 40, versiculo_num = 31 where referencia = 'Isaías 40:31';
update public.versiculos set livro_abrev = 'is', capitulo = 41, versiculo_num = 10 where referencia = 'Isaías 41:10';
update public.versiculos set livro_abrev = 'sl', capitulo = 119, versiculo_num = 105 where referencia = 'Salmos 119:105';
update public.versiculos set livro_abrev = 'pv', capitulo = 22, versiculo_num = 6 where referencia = 'Provérbios 22:6';
update public.versiculos set livro_abrev = 'fp', capitulo = 4, versiculo_num = 4 where referencia = 'Filipenses 4:4';
update public.versiculos set livro_abrev = 'sl', capitulo = 30, versiculo_num = 5 where referencia = 'Salmos 30:5';
update public.versiculos set livro_abrev = 'mt', capitulo = 6, versiculo_num = 33 where referencia = 'Mateus 6:33';
update public.versiculos set livro_abrev = 'jr', capitulo = 29, versiculo_num = 11 where referencia = 'Jeremias 29:11';
update public.versiculos set livro_abrev = 'mc', capitulo = 12, versiculo_num = 31 where referencia = 'Marcos 12:31';
update public.versiculos set livro_abrev = 'sl', capitulo = 37, versiculo_num = 5 where referencia = 'Salmos 37:5';
update public.versiculos set livro_abrev = 'js', capitulo = 24, versiculo_num = 15 where referencia = 'Josué 24:15';
update public.versiculos set livro_abrev = 'sl', capitulo = 27, versiculo_num = 1 where referencia = 'Salmos 27:1';
update public.versiculos set livro_abrev = 'js', capitulo = 1, versiculo_num = 9 where referencia = 'Josué 1:9';
update public.versiculos set livro_abrev = 'sl', capitulo = 46, versiculo_num = 1 where referencia = 'Salmos 46:1';
update public.versiculos set livro_abrev = 'hb', capitulo = 4, versiculo_num = 12 where referencia = 'Hebreus 4:12';

notify pgrst, 'reload schema';
