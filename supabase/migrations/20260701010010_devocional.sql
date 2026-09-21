-- =====================================================================
--  Filhos da Conquista — Devocional diário gamificado
--  Versículo do dia + quiz (1 pergunta) + foto com a Bíblia + pontos/dia.
--  Tudo por SQL (sem Edge Function). Pontos entram no ranking.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole TUDO -> Run.
--  Idempotente (os 20 versículos só entram se a tabela estiver vazia).
-- =====================================================================

-- ---------- Tabela de versículos (a "resposta certa" mora aqui) ----------
create table if not exists public.versiculos (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  referencia text not null,
  pergunta text not null default 'De qual livro da Bíblia é este versículo?',
  opcoes jsonb not null default '[]',
  correta int not null default 0,
  ativo boolean default true,
  created_at timestamptz default now()
);
alter table public.versiculos enable row level security;
-- Só liderança lê a tabela direto (pra não vazar a resposta do quiz).
-- As crianças recebem o versículo do dia SEM a resposta, pela função abaixo.
drop policy if exists "ler versiculos" on public.versiculos;
create policy "ler versiculos" on public.versiculos for select to authenticated using (public.pode_gerir());
drop policy if exists "gerir versiculos" on public.versiculos;
create policy "gerir versiculos" on public.versiculos for all to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());

-- ---------- Tabela das entregas diárias ----------
create table if not exists public.devocional (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.profiles(id) on delete cascade,
  data date not null,
  foto_url text,
  acertou_quiz boolean default false,
  created_at timestamptz default now(),
  unique (usuario_id, data)   -- 1 por dia
);
alter table public.devocional enable row level security;
drop policy if exists "ler devocional" on public.devocional;
create policy "ler devocional" on public.devocional for select to authenticated
  using (usuario_id = auth.uid() or public.pode_gerir());

-- ---------- Versículo do dia (determinístico; SEM a resposta correta) ----------
create or replace function public.versiculo_do_dia()
returns table (id uuid, texto text, referencia text, pergunta text, opcoes jsonb)
language sql security definer set search_path = '' as $$
  with v as (
    select id, texto, referencia, pergunta, opcoes,
           row_number() over (order by created_at, id) - 1 as idx
    from public.versiculos where ativo = true
  ), n as (select count(*) c from v)
  select v.id, v.texto, v.referencia, v.pergunta, v.opcoes
  from v, n
  where n.c > 0 and v.idx = (((now() at time zone 'America/Sao_Paulo')::date - date '2026-01-01') % n.c);
$$;
grant execute on function public.versiculo_do_dia() to authenticated;

-- ---------- Registrar o devocional do dia (pontua na hora) ----------
create or replace function public.registrar_devocional(p_foto_url text, p_resposta int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_correta int;
  v_acertou boolean := false;
  v_pontos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  with v as (
    select correta, row_number() over (order by created_at, id) - 1 as idx
    from public.versiculos where ativo = true
  ), n as (select count(*) c from v)
  select v.correta into v_correta
  from v, n
  where n.c > 0 and v.idx = ((v_hoje - date '2026-01-01') % n.c);

  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  v_pontos := 10 + (case when v_acertou then 5 else 0 end);

  insert into public.devocional (usuario_id, data, foto_url, acertou_quiz)
  values (v_uid, v_hoje, p_foto_url, v_acertou);

  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'devocional', v_pontos,
          'Devocional ' || to_char(v_hoje, 'DD/MM') || case when v_acertou then ' (quiz ✓)' else '' end);

  return json_build_object('acertou', v_acertou, 'pontos', v_pontos);
exception
  when unique_violation then
    raise exception 'Você já fez o devocional de hoje! Volte amanhã. 🙂';
end;
$$;
grant execute on function public.registrar_devocional(text, int) to authenticated;

-- ---------- Meu resumo (feito hoje? + sequência de dias) ----------
create or replace function public.meu_resumo_devocional()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_feito boolean := false;
  v_foto text;
  v_seq int := 0;
  v_d date;
begin
  if v_uid is null then return json_build_object('feito', false, 'sequencia', 0); end if;
  select foto_url into v_foto from public.devocional where usuario_id = v_uid and data = v_hoje;
  v_feito := found;
  v_d := case when v_feito then v_hoje else v_hoje - 1 end;
  loop
    exit when not exists (select 1 from public.devocional where usuario_id = v_uid and data = v_d);
    v_seq := v_seq + 1;
    v_d := v_d - 1;
  end loop;
  return json_build_object('feito', v_feito, 'foto', v_foto, 'sequencia', v_seq);
end;
$$;
grant execute on function public.meu_resumo_devocional() to authenticated;

-- ---------- 20 versículos iniciais (só entram se a tabela estiver vazia) ----------
do $$
begin
  if not exists (select 1 from public.versiculos) then
    insert into public.versiculos (texto, referencia, opcoes, correta) values
    ('Porque Deus amou o mundo de tal maneira que deu o seu Filho unigênito, para que todo aquele que nele crê não pereça, mas tenha a vida eterna.', 'João 3:16', '["Mateus","João","Salmos","Romanos"]', 1),
    ('O Senhor é o meu pastor; nada me faltará.', 'Salmos 23:1', '["Provérbios","Isaías","Salmos","João"]', 2),
    ('Tudo posso naquele que me fortalece.', 'Filipenses 4:13', '["Filipenses","Efésios","Salmos","Tiago"]', 0),
    ('Confia no Senhor de todo o teu coração e não te estribes no teu próprio entendimento.', 'Provérbios 3:5', '["Salmos","Provérbios","Eclesiastes","João"]', 1),
    ('Eu sou o caminho, a verdade e a vida; ninguém vem ao Pai senão por mim.', 'João 14:6', '["Lucas","Atos","Salmos","João"]', 3),
    ('Mas os que esperam no Senhor renovarão as suas forças; subirão com asas como águias.', 'Isaías 40:31', '["Isaías","Jeremias","Salmos","Daniel"]', 0),
    ('Não temas, porque eu sou contigo; não te assombres, porque eu sou o teu Deus.', 'Isaías 41:10', '["Salmos","Isaías","Josué","Mateus"]', 1),
    ('Lâmpada para os meus pés é a tua palavra e luz para o meu caminho.', 'Salmos 119:105', '["Provérbios","João","Salmos","Isaías"]', 2),
    ('Ensina a criança no caminho em que deve andar, e até quando envelhecer não se desviará dele.', 'Provérbios 22:6', '["Provérbios","Salmos","Deuteronômio","Mateus"]', 0),
    ('Alegrai-vos sempre no Senhor; outra vez digo: alegrai-vos.', 'Filipenses 4:4', '["Romanos","Filipenses","Salmos","Tiago"]', 1),
    ('O choro pode durar uma noite, mas a alegria vem pela manhã.', 'Salmos 30:5', '["Salmos","Lamentações","Jó","João"]', 0),
    ('Buscai primeiro o reino de Deus e a sua justiça, e todas estas coisas vos serão acrescentadas.', 'Mateus 6:33', '["Marcos","Lucas","Mateus","João"]', 2),
    ('Porque eu bem sei os pensamentos que tenho a vosso respeito, pensamentos de paz e não de mal.', 'Jeremias 29:11', '["Isaías","Jeremias","Ezequiel","Salmos"]', 1),
    ('Amarás o teu próximo como a ti mesmo.', 'Marcos 12:31', '["Mateus","Marcos","Levítico","João"]', 1),
    ('Entrega o teu caminho ao Senhor; confia nele, e ele o fará.', 'Salmos 37:5', '["Provérbios","Salmos","Isaías","Romanos"]', 1),
    ('Eu e a minha casa serviremos ao Senhor.', 'Josué 24:15', '["Juízes","Êxodo","Josué","Números"]', 2),
    ('O Senhor é a minha luz e a minha salvação; a quem temerei?', 'Salmos 27:1', '["Salmos","João","Isaías","Provérbios"]', 0),
    ('Sê forte e corajoso; não temas, nem te espantes, porque o Senhor, teu Deus, é contigo.', 'Josué 1:9', '["Deuteronômio","Josué","Juízes","Salmos"]', 1),
    ('Deus é o nosso refúgio e fortaleza, socorro bem presente na angústia.', 'Salmos 46:1', '["Salmos","Naum","Habacuque","João"]', 0),
    ('Porque a palavra de Deus é viva e eficaz.', 'Hebreus 4:12', '["Tiago","Romanos","Hebreus","Efésios"]', 2);
  end if;
end $$;

notify pgrst, 'reload schema';
