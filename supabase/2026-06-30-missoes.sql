-- =====================================================================
--  Filhos da Conquista — Missões diárias (devocional + desafios do clube)
--  A missão do dia alterna entre DEVOCIONAL (versículo) e DESAFIO do
--  universo desbravador (classes/ideais/lei/nós/natureza), este último
--  filtrado pela CLASSE do desbravador (calculada pela idade).
--  Pontua na hora (10 + 5 se acertar o quiz). A resposta certa nunca sai
--  do banco (anti-cola). Reusa a tabela public.devocional pra registro.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole TUDO -> Run.
--  Idempotente (os desafios só entram se a tabela estiver vazia).
-- =====================================================================

-- Classe do desbravador pela idade
create or replace function public.classe_por_nascimento(nasc date)
returns text language sql stable set search_path = '' as $$
  select case
    when nasc is null then null
    when extract(year from age(nasc))::int <= 10 then 'Amigo'
    when extract(year from age(nasc))::int = 11 then 'Companheiro'
    when extract(year from age(nasc))::int = 12 then 'Pesquisador'
    when extract(year from age(nasc))::int = 13 then 'Pioneiro'
    when extract(year from age(nasc))::int = 14 then 'Excursionista'
    else 'Guia'
  end;
$$;

-- Pool de desafios (a resposta certa mora aqui; só liderança lê a tabela)
create table if not exists public.desafios (
  id uuid primary key default gen_random_uuid(),
  tema text,
  texto text,
  pergunta text not null,
  opcoes jsonb not null default '[]',
  correta int not null default 0,
  classe text,            -- Amigo|Companheiro|...|null (geral)
  pede_foto boolean not null default false,
  ativo boolean default true,
  created_at timestamptz default now()
);
alter table public.desafios enable row level security;
drop policy if exists "ler desafios" on public.desafios;
create policy "ler desafios" on public.desafios for select to authenticated using (public.pode_gerir());
drop policy if exists "gerir desafios" on public.desafios;
create policy "gerir desafios" on public.desafios for all to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());

-- Missão do dia (SEM a resposta): devocional em dias pares, desafio em ímpares
create or replace function public.missao_do_dia()
returns table (tipo text, texto text, referencia text, tema text, pergunta text, opcoes jsonb, pede_foto boolean, classe text)
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text;
begin
  select public.classe_por_nascimento(nascimento) into v_classe from public.profiles where id = auth.uid();

  if v_idx % 2 = 1 then
    return query
    with d as (
      select ds.texto, ds.tema, ds.pergunta, ds.opcoes, ds.pede_foto,
             row_number() over (order by ds.created_at, ds.id) - 1 as i
      from public.desafios ds
      where ds.ativo and (ds.classe = v_classe or ds.classe is null)
    ), n as (select count(*) c from d)
    select 'desafio'::text, d.texto, null::text, d.tema, d.pergunta, d.opcoes, d.pede_foto, v_classe
    from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));
    if found then return; end if;
  end if;

  return query
  with v as (
    select vs.texto, vs.referencia, vs.pergunta, vs.opcoes,
           row_number() over (order by vs.created_at, vs.id) - 1 as i
    from public.versiculos vs where vs.ativo
  ), n as (select count(*) c from v)
  select 'devocional'::text, v.texto, v.referencia, 'Devocional'::text, v.pergunta, v.opcoes, true, v_classe
  from v cross join n where n.c > 0 and v.i = (v_idx % nullif(n.c, 0));
end;
$$;
grant execute on function public.missao_do_dia() to authenticated;

-- Registrar a missão do dia (pontua; 1x/dia; confere a resposta no servidor)
create or replace function public.registrar_missao(p_foto_url text, p_resposta int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text;
  v_tipo text := 'devocional';
  v_correta int;
  v_acertou boolean := false;
  v_pontos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select public.classe_por_nascimento(nascimento) into v_classe from public.profiles where id = v_uid;

  if v_idx % 2 = 1 then
    with d as (
      select ds.correta, row_number() over (order by ds.created_at, ds.id) - 1 as i
      from public.desafios ds where ds.ativo and (ds.classe = v_classe or ds.classe is null)
    ), n as (select count(*) c from d)
    select d.correta into v_correta from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));
    if found then v_tipo := 'desafio'; end if;
  end if;

  if v_tipo = 'devocional' then
    with v as (
      select vs.correta, row_number() over (order by vs.created_at, vs.id) - 1 as i
      from public.versiculos vs where vs.ativo
    ), n as (select count(*) c from v)
    select v.correta into v_correta from v cross join n where n.c > 0 and v.i = (v_idx % nullif(n.c, 0));
  end if;

  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  v_pontos := 10 + (case when v_acertou then 5 else 0 end);

  insert into public.devocional (usuario_id, data, foto_url, acertou_quiz)
  values (v_uid, v_hoje, p_foto_url, v_acertou);

  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'missao', v_pontos, 'Missão ' || to_char(v_hoje, 'DD/MM') || case when v_acertou then ' (quiz ✓)' else '' end);

  return json_build_object('acertou', v_acertou, 'pontos', v_pontos, 'tipo', v_tipo);
exception when unique_violation then
  raise exception 'Você já fez a missão de hoje! Volte amanhã. 🙂';
end;
$$;
grant execute on function public.registrar_missao(text, int) to authenticated;

-- Desafios iniciais (verificados em fontes oficiais dos Desbravadores)
do $$
begin
  if not exists (select 1 from public.desafios) then
    insert into public.desafios (tema, pergunta, opcoes, correta, classe, pede_foto)
    select d.tema, d.pergunta, d.opcoes, d.correta, d.classe, d.pede_foto
    from jsonb_to_recordset($json$[
      {"tema":"Classes","pergunta":"Qual classe do Desbravador é para quem tem 10 anos?","opcoes":["Amigo","Companheiro","Pioneiro","Guia"],"correta":0,"classe":"Amigo","pede_foto":false},
      {"tema":"Classes","pergunta":"Qual classe do Desbravador é para quem tem 12 anos?","opcoes":["Amigo","Pesquisador","Pioneiro","Guia"],"correta":1,"classe":"Pesquisador","pede_foto":false},
      {"tema":"Classes","pergunta":"Com quantos anos o Desbravador entra na classe de Guia?","opcoes":["13 anos","14 anos","15 anos","16 anos"],"correta":2,"classe":"Guia","pede_foto":false},
      {"tema":"Classes","pergunta":"Qual é a ordem correta das classes regulares dos Desbravadores?","opcoes":["Amigo, Companheiro, Pesquisador, Pioneiro, Excursionista, Guia","Amigo, Pioneiro, Pesquisador, Companheiro, Guia, Excursionista","Guia, Excursionista, Pioneiro, Pesquisador, Companheiro, Amigo","Companheiro, Amigo, Pioneiro, Pesquisador, Guia, Excursionista"],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Classes","pergunta":"Qual é a cor do lenço da classe Amigo?","opcoes":["Azul","Vermelho","Verde","Amarelo"],"correta":0,"classe":"Amigo","pede_foto":false},
      {"tema":"Classes","pergunta":"Qual classe do Desbravador é para quem tem 14 anos?","opcoes":["Pioneiro","Excursionista","Guia","Companheiro"],"correta":1,"classe":"Excursionista","pede_foto":false},
      {"tema":"Voto","pergunta":"Como começa o Voto do Desbravador?","opcoes":["Pela graça de Deus...","O amor de Cristo...","A Lei me ordena...","Sempre alerta..."],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Voto","pergunta":"No Voto, o Desbravador promete ser puro, bondoso e...","opcoes":["Forte","Leal","Rápido","Rico"],"correta":1,"classe":null,"pede_foto":false},
      {"tema":"Voto","pergunta":"Segundo o Voto, o Desbravador será servo de Deus e amigo de...","opcoes":["Todos","Poucos","Ninguém","Alguns"],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Lei","pergunta":"Quantos itens tem a Lei do Desbravador?","opcoes":["6","7","8","10"],"correta":2,"classe":null,"pede_foto":false},
      {"tema":"Lei","pergunta":"Qual destes é um item da Lei do Desbravador?","opcoes":["Observar a devoção matinal","Ganhar todas as competições","Nunca acampar","Ficar em silêncio o dia todo"],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Lei","pergunta":"A Lei do Desbravador manda andar com reverência na casa de quem?","opcoes":["Deus","Vovó","Todos","Ninguém"],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Alvo","pergunta":"Qual é o Alvo do Desbravador?","opcoes":["A mensagem do advento a todo o mundo na minha geração","O amor de Cristo me motiva","Salvar do pecado e guiar no serviço","Sempre alerta"],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Lema","pergunta":"Qual é o Lema do Desbravador?","opcoes":["O amor de Cristo me motiva","A mensagem do advento a todo o mundo na minha geração","Serei puro, bondoso e leal","Ir aonde Deus mandar"],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Nós","pergunta":"Qual nó serve para unir as pontas de duas cordas de mesma espessura?","opcoes":["Nó direito","Nó de escota","Lais de guia","Nó cego"],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Nós","pergunta":"Qual nó forma uma laçada que NÃO aperta e é usado para salvamento de pessoas?","opcoes":["Lais de guia","Nó direito","Nó de escota","Nó de pescador"],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Nós","pergunta":"Missão prática: faça um nó direito com um pedaço de corda e tire uma foto mostrando o nó!","opcoes":[],"correta":0,"classe":null,"pede_foto":true},
      {"tema":"Natureza","pergunta":"Qual instrumento aponta sempre para o Norte e ajuda o Desbravador a se orientar?","opcoes":["Bússola","Relógio","Lanterna","Régua"],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Natureza","pergunta":"Missão: encontre uma planta ou árvore perto de você e tire uma foto dela!","opcoes":[],"correta":0,"classe":"Amigo","pede_foto":true},
      {"tema":"Clube","pergunta":"Os Desbravadores são um clube ligado a qual igreja?","opcoes":["Igreja Adventista do Sétimo Dia","Igreja Católica","Igreja Batista","Nenhuma igreja"],"correta":0,"classe":null,"pede_foto":false},
      {"tema":"Clube","pergunta":"O que os Desbravadores usam no pescoço como parte do uniforme?","opcoes":["Lenço","Gravata","Cachecol de lã","Colar"],"correta":0,"classe":null,"pede_foto":false}
    ]$json$::jsonb) as d(tema text, pergunta text, opcoes jsonb, correta int, classe text, pede_foto boolean);
  end if;
end $$;

notify pgrst, 'reload schema';
