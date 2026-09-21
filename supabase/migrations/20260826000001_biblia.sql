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

-- Seed dos 66 livros (idempotente). O TEXTO dos versículos vem por CSV, mas
-- os livros já entram aqui pra o leitor nunca dar "Livro inválido" numa
-- instalação nova antes de importar o CSV.
insert into public.biblia_livros (abrev, nome, ordem, testamento, capitulos) values
('gn','Gênesis',1,'AT',50),('ex','Êxodo',2,'AT',40),('lv','Levítico',3,'AT',27),
('nm','Números',4,'AT',36),('dt','Deuteronômio',5,'AT',34),('js','Josué',6,'AT',24),
('jz','Juízes',7,'AT',21),('rt','Rute',8,'AT',4),('1sm','1 Samuel',9,'AT',31),
('2sm','2 Samuel',10,'AT',24),('1rs','1 Reis',11,'AT',22),('2rs','2 Reis',12,'AT',25),
('1cr','1 Crônicas',13,'AT',29),('2cr','2 Crônicas',14,'AT',36),('ed','Esdras',15,'AT',10),
('ne','Neemias',16,'AT',13),('et','Ester',17,'AT',10),('jó','Jó',18,'AT',42),
('sl','Salmos',19,'AT',150),('pv','Provérbios',20,'AT',31),('ec','Eclesiastes',21,'AT',12),
('ct','Cânticos',22,'AT',8),('is','Isaías',23,'AT',66),('jr','Jeremias',24,'AT',52),
('lm','Lamentações de Jeremias',25,'AT',5),('ez','Ezequiel',26,'AT',48),('dn','Daniel',27,'AT',12),
('os','Oséias',28,'AT',14),('jl','Joel',29,'AT',3),('am','Amós',30,'AT',9),
('ob','Obadias',31,'AT',1),('jn','Jonas',32,'AT',4),('mq','Miquéias',33,'AT',7),
('na','Naum',34,'AT',3),('hc','Habacuque',35,'AT',3),('sf','Sofonias',36,'AT',3),
('ag','Ageu',37,'AT',2),('zc','Zacarias',38,'AT',14),('ml','Malaquias',39,'AT',4),
('mt','Mateus',40,'NT',28),('mc','Marcos',41,'NT',16),('lc','Lucas',42,'NT',24),
('jo','João',43,'NT',21),('atos','Atos',44,'NT',28),('rm','Romanos',45,'NT',16),
('1co','1 Coríntios',46,'NT',16),('2co','2 Coríntios',47,'NT',13),('gl','Gálatas',48,'NT',6),
('ef','Efésios',49,'NT',6),('fp','Filipenses',50,'NT',4),('cl','Colossenses',51,'NT',4),
('1ts','1 Tessalonicenses',52,'NT',5),('2ts','2 Tessalonicenses',53,'NT',3),('1tm','1 Timóteo',54,'NT',6),
('2tm','2 Timóteo',55,'NT',4),('tt','Tito',56,'NT',3),('fm','Filemom',57,'NT',1),
('hb','Hebreus',58,'NT',13),('tg','Tiago',59,'NT',5),('1pe','1 Pedro',60,'NT',5),
('2pe','2 Pedro',61,'NT',3),('1jo','1 João',62,'NT',5),('2jo','2 João',63,'NT',1),
('3jo','3 João',64,'NT',1),('jd','Judas',65,'NT',1),('ap','Apocalipse',66,'NT',22)
on conflict (abrev) do nothing;

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

-- NOTA: a marcação de "capítulo lido" mudou pra fluxo de 2 passos (abrir +
-- confirmar, com tempo mínimo de leitura) — ver 2026-08-26-biblia-antifarm.sql.
-- A função antiga de 1 passo (registrar_leitura_biblia) foi REMOVIDA de
-- propósito: recriá-la aqui reabriria o atalho de pontuar sem ler. Rode o
-- arquivo antifarm depois deste.

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
