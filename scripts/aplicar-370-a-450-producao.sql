-- Aplica 370 → 450 em PRODUÇÃO (audiolivros, documento da idade, painel do coordenador, manutenção,
-- painéis por plano, acessibilidade, comunidade). Colar INTEIRO no SQL Editor e rodar.
-- Pode rodar mais de uma vez sem estragar nada (o SQL Editor grava comando a comando).
-- Para sozinho se a produção não estiver entre a 360 e a 450.
do $g$ begin
  if (select max(version) from supabase_migrations.schema_migrations) not between '20260930000360' and '20260930000450' then
    raise exception 'ABORTADO: produção fora do esperado (está em %)', (select max(version) from supabase_migrations.schema_migrations);
  end if;
end $g$;

-- ======================= 20260930000370_audiolivros-das-classes =======================
-- =============================================================================
-- 370 — Audiolivros das Classes (livro da classe tocado pelo player do YouTube)
-- =============================================================================
-- Pedido do dono (28/09): criança e responsável com dificuldade de leitura ouvem o livro da classe.
-- Decisão: NÃO baixamos nem hospedamos áudio (os livros são da CPB; os vídeos estão em canais não
-- oficiais). Guardamos só o ID de cada vídeo do YouTube, capítulo por capítulo e NA ORDEM CERTA
-- (três playlists estão invertidas/embaralhadas no YouTube), e o app toca pelo player embutido
-- (youtube-nocookie). Se um vídeo cair, o admin troca o ID no /admin › Audiolivros.
--
-- Ligação com o requisito: pelo TÍTULO do livro no texto do requisito ("Ler o livro da classe:
-- \"Vaso de Barro\""). Se uma OMD trocar o livro, o título novo não casa e o botão some sozinho —
-- nunca toca o livro errado.
--
-- Leitura: qualquer autenticado (é catálogo, sem dado de pessoa). Escrita: só admin da plataforma.
-- =============================================================================

create table if not exists public.audiolivros (
  id uuid primary key default gen_random_uuid(),
  titulo text not null unique check (length(btrim(titulo)) between 2 and 120),
  autor text,
  canal text,
  playlist_id text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audiolivro_capitulos (
  id uuid primary key default gen_random_uuid(),
  audiolivro_id uuid not null references public.audiolivros(id) on delete cascade,
  ordem int not null check (ordem between 1 and 500),
  titulo text not null check (length(btrim(titulo)) between 1 and 80),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  updated_at timestamptz not null default now(),
  unique (audiolivro_id, ordem)
);

alter table public.audiolivros enable row level security;
alter table public.audiolivro_capitulos enable row level security;
revoke all on public.audiolivros from public, anon, authenticated;
revoke all on public.audiolivro_capitulos from public, anon, authenticated;

-- Catálogo inicial (28/09/2026): os 6 livros de classe + os 2 das avançadas (Guia VII.1 = só o capítulo 7
-- do Desejado; Guia de Exploração = O Maior Discurso de Cristo), links do dono conferidos um a um.
insert into public.audiolivros (titulo, autor, canal, playlist_id) values
  ('Vaso de Barro', null, 'Canal Desbravando', 'PLI9KNpa2zLv4Mqtj3mpgREEM-McAOfcQf'),
  ('Um Simples Lanche', 'Denis Cruz', 'Flecha do Oriente', 'PLJpmJ_3QuTz_CHoYi_DFez-Mi2Av-DK6j'),
  ('Além da Magia', null, 'Bruno dos Santos', 'PLYDfhJMN8OWu751v75T96tBeXQ5YDeq8H'),
  ('Expedição Galápagos', 'Michelson Borges', 'Hora do Clube', 'PLZzUHCA4d0QxHUB46W_0rzAm46XijMVda'),
  ('O Fim do Começo', 'Carolina Costa Cavalcanti', 'Hora do Clube', 'PLZzUHCA4d0QyjX0cXBPeeWMVi1vkC7uhi'),
  ('O Livro Amargo', 'Denis Cruz', 'Hora do Clube', 'PLZzUHCA4d0QyFhugtYE0G5OosiXxIONu7'),
  ('O Desejado de Todas as Nações', 'Ellen G. White', 'A Voz do Terceiro Anjo', null),
  ('O Maior Discurso de Cristo', 'Ellen G. White', null, 'PL1OkezmX68aCKXLIckMXhWZuHZ4vghImZ')
on conflict (titulo) do nothing;

insert into public.audiolivro_capitulos (audiolivro_id, ordem, titulo, video_id)
select a.id, v.ordem, v.titulo, v.video_id
  from (values
  ('Vaso de Barro', 1, 'Capítulo 1', '0lMzikRDG7w'),
  ('Vaso de Barro', 2, 'Capítulo 2', 'U_OYfCpDo2U'),
  ('Vaso de Barro', 3, 'Capítulo 3', 'Tf-AjmhbgLs'),
  ('Vaso de Barro', 4, 'Capítulo 4', 'CK8fn1DqEU0'),
  ('Vaso de Barro', 5, 'Capítulo 5', 'brUufOKC1To'),
  ('Vaso de Barro', 6, 'Capítulo 6', 'Tw7Cu1ueNXc'),
  ('Vaso de Barro', 7, 'Capítulo 7', '2v188hG7rcY'),
  ('Vaso de Barro', 8, 'Capítulo 8', 'xpAwZXktUHk'),
  ('Vaso de Barro', 9, 'Capítulo 9', 'XJyInSy6r1U'),
  ('Vaso de Barro', 10, 'Capítulo 10', 'euxSxjn_LZs'),
  ('Vaso de Barro', 11, 'Capítulo 11', 'AtydqBI_EK0'),
  ('Vaso de Barro', 12, 'Capítulo 12', 'E7h4CwNbynU'),
  ('Vaso de Barro', 13, 'Capítulo 13', 'eCDsSFdiWPM'),
  ('Vaso de Barro', 14, 'Capítulo 14', 'aDWkIap52BQ'),
  ('Vaso de Barro', 15, 'Capítulo 15', 'nVhXO-6CIhU'),
  ('Vaso de Barro', 16, 'Capítulo 16', 'DoT2-UiornI'),
  ('Vaso de Barro', 17, 'Capítulo 17', '4FemwE-C69w'),
  ('Vaso de Barro', 18, 'Capítulo 18', '4SUPPGM2I08'),
  ('Um Simples Lanche', 1, 'Capítulo 1', 'cashnjT-gjI'),
  ('Um Simples Lanche', 2, 'Capítulo 2', 'Nh9zG5CPSaY'),
  ('Um Simples Lanche', 3, 'Capítulo 3', 'BiwQWDTvMBI'),
  ('Um Simples Lanche', 4, 'Capítulo 4', 'Btv914L3wvw'),
  ('Um Simples Lanche', 5, 'Capítulo 5', 'oqT4pENqTys'),
  ('Um Simples Lanche', 6, 'Capítulo 6', 'Op70VY7Chmw'),
  ('Um Simples Lanche', 7, 'Capítulo 7', '4oXP6yWVows'),
  ('Um Simples Lanche', 8, 'Capítulo 8', 'USLdswwEaK0'),
  ('Um Simples Lanche', 9, 'Capítulo 9', 'WABvjVWsdy0'),
  ('Um Simples Lanche', 10, 'Capítulo 10', 'fQ4y4BY-Rak'),
  ('Um Simples Lanche', 11, 'Capítulo 11', 'Xw5-kf5nDeU'),
  ('Um Simples Lanche', 12, 'Capítulo 12', '2IDV9LwZoLo'),
  ('Um Simples Lanche', 13, 'Capítulo 13', 'wmunEkSsclo'),
  ('Um Simples Lanche', 14, 'Capítulo 14', 'PTLiH_wqzR8'),
  ('Um Simples Lanche', 15, 'Capítulo 15', 'EYRQQcs37ps'),
  ('Um Simples Lanche', 16, 'Capítulo 16', 'jirHlCDi7BQ'),
  ('Um Simples Lanche', 17, 'Capítulo 17', '-z4bMU_AkRA'),
  ('Um Simples Lanche', 18, 'Capítulo 18', '6kIQ0-0JUYo'),
  ('Um Simples Lanche', 19, 'Capítulo 19', 'hXXVM9Cp2XM'),
  ('Um Simples Lanche', 20, 'Epílogo', 'wsBNLnUuV_A'),
  ('Além da Magia', 1, 'Capítulo 1', 'wI1krwFXlhw'),
  ('Além da Magia', 2, 'Capítulo 2', 'BBJ48Cx7HLI'),
  ('Além da Magia', 3, 'Capítulo 3', 'RN_qDe98usg'),
  ('Além da Magia', 4, 'Capítulo 4', 'yFx1EHaIIjk'),
  ('Além da Magia', 5, 'Capítulo 5', 'FsuZF0tPoII'),
  ('Além da Magia', 6, 'Capítulo 6', 'FcYRTBLe_qo'),
  ('Além da Magia', 7, 'Capítulo 7', 'D-pMDuB0qu8'),
  ('Além da Magia', 8, 'Capítulo 8', 'i8Wwh-Q2mEA'),
  ('Além da Magia', 9, 'Capítulo 9', 'HxD6fY0jMco'),
  ('Além da Magia', 10, 'Capítulo 10', 'W_-qnVlISXE'),
  ('Além da Magia', 11, 'Capítulo 11', '7zoocmsWejk'),
  ('Além da Magia', 12, 'Capítulo 12', '9KjR5_073Qw'),
  ('Além da Magia', 13, 'Capítulo 13', 'PP519MJRFXo'),
  ('Além da Magia', 14, 'Capítulo 14', 'Pc3xMiaqu-s'),
  ('Além da Magia', 15, 'Capítulo 15', '97eAu0yzw-U'),
  ('Além da Magia', 16, 'Capítulo 16', 'SLYmG8wKWYY'),
  ('Além da Magia', 17, 'Capítulo 17', 'ydDoKSXIYnY'),
  ('Além da Magia', 18, 'Capítulo 18', 'gBzzy8t1qeM'),
  ('Além da Magia', 19, 'Capítulo 19', 'rj5pMxaE_Ag'),
  ('Além da Magia', 20, 'Capítulo 20', 'E7YBGIOAptQ'),
  ('Além da Magia', 21, 'Capítulo 21', 'EDAA-bDC4f0'),
  ('Além da Magia', 22, 'Capítulo 22', 'U_paiuKfW0Y'),
  ('Além da Magia', 23, 'Capítulo 23', 'sgE0FS99ZCI'),
  ('Além da Magia', 24, 'Capítulo 24', 'SXQnZKpOASM'),
  ('Além da Magia', 25, 'Capítulo 25', '72VyckwkPZg'),
  ('Além da Magia', 26, 'Capítulo 26', 'Fv1brNBLVDw'),
  ('Além da Magia', 27, 'Capítulo 27', 'lVVzpc0Ud5A'),
  ('Além da Magia', 28, 'Capítulo 28', '7x8ZRBIo5kQ'),
  ('Além da Magia', 29, 'Capítulo 29', 'FIMPsJDALcY'),
  ('Além da Magia', 30, 'Capítulo 30', 'vgj3cMKy0oo'),
  ('Além da Magia', 31, 'Capítulo 31', 'nAyUnrXswWU'),
  ('Além da Magia', 32, 'Capítulo 32', 'puBg5DWy2Ls'),
  ('Além da Magia', 33, 'Capítulo 33', 'tsIyZhuZ3qk'),
  ('Expedição Galápagos', 1, 'Capítulo 1', 'qmLYnN_0c6Q'),
  ('Expedição Galápagos', 2, 'Capítulo 2', 'uGGsptJ4X8o'),
  ('Expedição Galápagos', 3, 'Capítulo 3', 'J75EvnBr96U'),
  ('Expedição Galápagos', 4, 'Capítulo 4', 'L-r2N08I1z8'),
  ('Expedição Galápagos', 5, 'Capítulo 5', 'YE6Yaj9skQg'),
  ('Expedição Galápagos', 6, 'Capítulo 6', 'NAkcYQj9FEQ'),
  ('O Fim do Começo', 1, 'Capítulo 1', 'YouNzy6J5EM'),
  ('O Fim do Começo', 2, 'Capítulo 2', 'IG7x9MsLPio'),
  ('O Fim do Começo', 3, 'Capítulo 3', 'muYKh0Sxz5g'),
  ('O Fim do Começo', 4, 'Capítulo 4', 'kzuMbKpXAoM'),
  ('O Fim do Começo', 5, 'Capítulo 5', 'MZS7ie3nCx4'),
  ('O Fim do Começo', 6, 'Capítulo 6', 'OXhR7g0NBZM'),
  ('O Fim do Começo', 7, 'Capítulo 7', 'DZpBlWCW7s4'),
  ('O Fim do Começo', 8, 'Capítulo 8', 'lnebWvSrK9w'),
  ('O Fim do Começo', 9, 'Capítulo 9', '5DtpDTPGRM0'),
  ('O Fim do Começo', 10, 'Capítulo 10', 'zLxQ-siPYzg'),
  ('O Fim do Começo', 11, 'Capítulo 11', 'tqBJ-4HBtTQ'),
  ('O Fim do Começo', 12, 'Capítulo 12', 'hrRZayycMl8'),
  ('O Fim do Começo', 13, 'Capítulo 13', 'Ryt3KwxufDc'),
  ('O Fim do Começo', 14, 'Capítulo 14', 'tnlXIe0QUGs'),
  ('O Fim do Começo', 15, 'Capítulo 15', 'l-9qpa27A2o'),
  ('O Fim do Começo', 16, 'Capítulo 16', 'q9-P8jVfg-s'),
  ('O Fim do Começo', 17, 'Capítulo 17', '4aDycRq8EP0'),
  ('O Fim do Começo', 18, 'Capítulo 18', 'M0NnkCLEq2c'),
  ('O Livro Amargo', 1, 'Capítulo 1', 'LKeZbPxDqTA'),
  ('O Livro Amargo', 2, 'Capítulo 2', 'marMlhAsM4g'),
  ('O Livro Amargo', 3, 'Capítulo 3', 'sLMV1OM9Zt0'),
  ('O Livro Amargo', 4, 'Capítulo 4', '5lOnf7phNLo'),
  ('O Livro Amargo', 5, 'Capítulo 5', '0VA4GhMHfV0'),
  ('O Livro Amargo', 6, 'Capítulo 6', '2nc7RwBY2RA'),
  ('O Livro Amargo', 7, 'Capítulo 7', 'KabQ8JpZaRg'),
  ('O Livro Amargo', 8, 'Capítulo 8', '2VSQ4BrWHCw'),
  ('O Livro Amargo', 9, 'Capítulo 9', 'vCmxFSCDJk0'),
  ('O Livro Amargo', 10, 'Capítulo 10', 'zW3dcBUpHa4'),
  ('O Livro Amargo', 11, 'Capítulo 11', 'RfgiAC2xcGM'),
  ('O Livro Amargo', 12, 'Capítulo 12', '1Z_U6ZfN5yQ'),
  ('O Livro Amargo', 13, 'Capítulo 13', 'Gb32SeHL-js'),
  ('O Livro Amargo', 14, 'Capítulo 14', 'MItmnY1pdUs'),
  ('O Livro Amargo', 15, 'Capítulo 15', 'vK8hsRLVtdU'),
  ('O Livro Amargo', 16, 'Capítulo 16', '4jtm5T_aNBU'),
  ('O Livro Amargo', 17, 'Capítulo 17', 'JKlqbe-ddiM'),
  ('O Livro Amargo', 18, 'Capítulo 18', 'oSMJhIlGX4o'),
  ('O Livro Amargo', 19, 'Capítulo 19', 'kMxHE-jEkgs'),
  ('O Livro Amargo', 20, 'Capítulo 20', 'sUaoKJIO6_Y'),
  ('O Livro Amargo', 21, 'Capítulo 21', 'U4diyKrAXUc'),
  ('O Livro Amargo', 22, 'Capítulo 22', 'yDIxFFHvLj4'),
  ('O Livro Amargo', 23, 'Capítulo 23', 'F5NoZAyTsqU'),
  ('O Livro Amargo', 24, 'Capítulo 24', 'U3RD1cntb9U'),
  ('O Livro Amargo', 25, 'Apêndice', '-j8DeD7twF0'),
  ('O Desejado de Todas as Nações', 1, 'Capítulo 7', '3YS_kDPvHwM'),
  ('O Maior Discurso de Cristo', 1, 'Prefácio', 'Sl2Xt8NFLcs'),
  ('O Maior Discurso de Cristo', 2, 'Capítulo 1', '5mxVChghVwA'),
  ('O Maior Discurso de Cristo', 3, 'Capítulo 2', 'mHWWI5cSy0Q'),
  ('O Maior Discurso de Cristo', 4, 'Capítulo 3', 'v1Dkm8tCyOk'),
  ('O Maior Discurso de Cristo', 5, 'Capítulo 4', 'l7Zac5FztHU'),
  ('O Maior Discurso de Cristo', 6, 'Capítulo 5', 'WRaQwkXU01o'),
  ('O Maior Discurso de Cristo', 7, 'Capítulo 6', 'SKDIXTo8s3M')
  ) as v(livro, ordem, titulo, video_id)
  join public.audiolivros a on a.titulo = v.livro
on conflict (audiolivro_id, ordem) do nothing;

-- Lista para o app: só livros ativos, capítulos em ordem.
create or replace function public.audiolivros_listar()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
           'id', a.id, 'titulo', a.titulo, 'autor', a.autor, 'canal', a.canal,
           'capitulos', (select coalesce(json_agg(json_build_object('ordem', c.ordem, 'titulo', c.titulo, 'video_id', c.video_id) order by c.ordem), '[]'::json)
                           from public.audiolivro_capitulos c where c.audiolivro_id = a.id))
         order by a.titulo), '[]'::json)
    from public.audiolivros a
   where a.ativo and auth.uid() is not null;
$$;
revoke all on function public.audiolivros_listar() from public, anon;
grant execute on function public.audiolivros_listar() to authenticated;

-- Admin: tudo (inclusive inativos), com o id de cada capítulo para trocar o vídeo.
create or replace function public.admin_audiolivros_listar()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return (select coalesce(json_agg(json_build_object(
           'id', a.id, 'titulo', a.titulo, 'autor', a.autor, 'canal', a.canal, 'ativo', a.ativo, 'playlist_id', a.playlist_id,
           'capitulos', (select coalesce(json_agg(json_build_object('id', c.id, 'ordem', c.ordem, 'titulo', c.titulo, 'video_id', c.video_id) order by c.ordem), '[]'::json)
                           from public.audiolivro_capitulos c where c.audiolivro_id = a.id))
         order by a.titulo), '[]'::json)
    from public.audiolivros a);
end $$;
revoke all on function public.admin_audiolivros_listar() from public, anon;
grant execute on function public.admin_audiolivros_listar() to authenticated;

create or replace function public.admin_audiolivro_capitulo_trocar(p_capitulo_id uuid, p_video_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_antes text; v_livro uuid;
begin
  perform public._exigir_admin_plataforma();
  if coalesce(p_video_id, '') !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'Link do YouTube inválido. Cole o link do vídeo (youtube.com/watch?v=... ou youtu.be/...).';
  end if;
  update public.audiolivro_capitulos c set video_id = p_video_id, updated_at = now()
    from (select id, video_id from public.audiolivro_capitulos where id = p_capitulo_id for update) old
   where c.id = old.id
  returning old.video_id, c.audiolivro_id into v_antes, v_livro;
  if v_livro is null then raise exception 'Capítulo não encontrado.'; end if;
  update public.audiolivros set updated_at = now() where id = v_livro;
  perform public._admin_auditar('audiolivro_capitulo_trocar', 'audiolivro', v_livro,
    jsonb_build_object('capitulo_id', p_capitulo_id, 'antes', v_antes, 'depois', p_video_id));
end $$;
revoke all on function public.admin_audiolivro_capitulo_trocar(uuid, text) from public, anon;
grant execute on function public.admin_audiolivro_capitulo_trocar(uuid, text) to authenticated;

create or replace function public.admin_audiolivro_ativar(p_id uuid, p_ativo boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  update public.audiolivros set ativo = coalesce(p_ativo, false), updated_at = now() where id = p_id;
  if not found then raise exception 'Audiolivro não encontrado.'; end if;
  perform public._admin_auditar('audiolivro_ativar', 'audiolivro', p_id, jsonb_build_object('ativo', coalesce(p_ativo, false)));
end $$;
revoke all on function public.admin_audiolivro_ativar(uuid, boolean) from public, anon;
grant execute on function public.admin_audiolivro_ativar(uuid, boolean) to authenticated;

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000370', 'audiolivros-das-classes') on conflict do nothing;

-- ======================= 20260930000380_foto-de-documento-da-idade =======================
-- =============================================================================
-- 380 — Foto do DOCUMENTO para comprovar a idade (com as proteções do plano 1)
-- =============================================================================
-- Decisão do dono (28/09, "plano 1"): nos requisitos "Ter pelo menos N anos" o desbravador envia a
-- foto do documento. Como é dado sensível de criança (LGPD), a foto:
--   * NÃO entra em member_requirements nem em requirement_submissions (histórico imutável, e a
--     coordenação lê as tentativas na investidura) — fica numa tabela própria, apagável;
--   * só é vista pelo DONO e pela liderança que avalia (pode_avaliar_curriculo) do clube em uso;
--   * é APAGADA depois que o requisito é aprovado: fica só "idade conferida por Fulano em tal data".
--     O arquivo físico sai pela API do Storage (o app de quem aprovou, e de novo o app do dono como
--     reserva) — o Supabase não deixa apagar arquivo por SQL (protect_objects_delete).
-- Quais requisitos pedem documento: catálogo requisitos_com_documento, por manifesto_id (estável entre
-- versões do currículo). Nenhuma versão publicada do currículo é alterada.
-- Envio é obrigatório: uma tentativa nova desses requisitos só é aceita com a foto enviada.
-- =============================================================================

create table if not exists public.requisitos_com_documento (
  manifesto_id text primary key check (manifesto_id ~ '^[a-z_]+(\.[A-Za-z0-9]+)+$'),
  orientacao text not null
);
alter table public.requisitos_com_documento enable row level security;
revoke all on public.requisitos_com_documento from public, anon, authenticated;

insert into public.requisitos_com_documento (manifesto_id, orientacao) values
  ('amigo.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).'),
  ('companheiro.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).'),
  ('pesquisador.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).'),
  ('pioneiro.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).'),
  ('excursionista.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).'),
  ('guia.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).')
on conflict (manifesto_id) do nothing;

create table if not exists public.comprovacoes_documento (
  id uuid primary key default gen_random_uuid(),
  member_requirement_id uuid not null unique references public.member_requirements(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  evidencia_path text,
  status text not null default 'enviado' check (status in ('enviado', 'conferido')),
  conferido_por uuid references public.profiles(id) on delete set null,
  conferido_em timestamptz,
  foto_apagada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (evidencia_path is null or evidencia_path like usuario_id::text || '/documentos/%')
);
create index if not exists comprovacoes_documento_path_idx on public.comprovacoes_documento (evidencia_path) where evidencia_path is not null;
alter table public.comprovacoes_documento enable row level security;
revoke all on public.comprovacoes_documento from public, anon, authenticated;

create or replace function public._requisito_exige_documento(p_requirement_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_requirements r join public.requisitos_com_documento d on d.manifesto_id = r.manifesto_id
                  where r.id = p_requirement_id);
$$;
revoke all on function public._requisito_exige_documento(uuid) from public, anon, authenticated;

-- ---------- o desbravador envia (ou troca) a foto ----------
-- Devolve o caminho ANTIGO (se trocou) para o app apagar o arquivo que ficou sem uso.
create or replace function public.documento_enviar(p_requirement_id uuid, p_path text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_doc public.comprovacoes_documento;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  if coalesce(p_path, '') !~ ('^' || v_uid::text || '/documentos/[^/]+$') then raise exception 'Arquivo inválido.'; end if;
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._requisito_exige_documento(p_requirement_id) then
    raise exception 'Este requisito não pede foto de documento.';
  end if;
  if v_mr.status not in ('nao_iniciado', 'em_andamento', 'correcao_solicitada') then
    raise exception 'Este requisito não pode mais ser alterado.';
  end if;
  select * into v_doc from public.comprovacoes_documento where member_requirement_id = v_mr.id for update;
  if found then
    update public.comprovacoes_documento set evidencia_path = p_path, status = 'enviado', updated_at = now(),
           conferido_por = null, conferido_em = null, foto_apagada_em = null
     where id = v_doc.id;
  else
    insert into public.comprovacoes_documento (member_requirement_id, club_id, usuario_id, evidencia_path)
    values (v_mr.id, v_club, v_uid, p_path);
  end if;
  update public.member_requirements set status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true, 'caminho_antigo', nullif(v_doc.evidencia_path, p_path));
end $$;
revoke all on function public.documento_enviar(uuid, text) from public, anon;
grant execute on function public.documento_enviar(uuid, text) to authenticated;

-- ---------- estado (dono: por classe; liderança: por requisito) ----------
create or replace function public._documento_json(d public.comprovacoes_documento)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('status', d.status, 'evidencia_path', d.evidencia_path,
    'conferido_em', d.conferido_em, 'foto_apagada_em', d.foto_apagada_em,
    'conferido_por_nome', (select p.nome from public.profiles p where p.id = d.conferido_por));
$$;
revoke all on function public._documento_json(public.comprovacoes_documento) from public, anon, authenticated;

-- Para a tela Minha Classe: { requirement_id: {exige, orientacao, documento} } dos requisitos que pedem documento.
create or replace function public.documentos_da_minha_classe(p_member_class_id uuid)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_object_agg(mr.requirement_id, json_build_object(
           'orientacao', d.orientacao,
           'documento', (select public._documento_json(c) from public.comprovacoes_documento c where c.member_requirement_id = mr.id))), '{}'::json)
    from public.member_requirements mr
    join public.class_requirements r on r.id = mr.requirement_id
    join public.requisitos_com_documento d on d.manifesto_id = r.manifesto_id
   where mr.member_class_id = p_member_class_id and mr.usuario_id = auth.uid() and mr.club_id = public.clube_atual_id();
$$;
revoke all on function public.documentos_da_minha_classe(uuid) from public, anon;
grant execute on function public.documentos_da_minha_classe(uuid) to authenticated;

-- Para a fila de avaliação: o documento de UM requisito (só avaliador do clube em uso). Coordenação não.
create or replace function public.documento_do_requisito(p_member_requirement_id uuid)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_mr record; v_doc public.comprovacoes_documento;
begin
  if auth.uid() is null or v_club is null then return null; end if;
  select * into v_mr from public.member_requirements where id = p_member_requirement_id and club_id = v_club;
  if not found or not (v_mr.usuario_id = auth.uid() or public.pode_avaliar_curriculo(v_club)) then return null; end if;
  if not public._requisito_exige_documento(v_mr.requirement_id) then return null; end if;
  select * into v_doc from public.comprovacoes_documento where member_requirement_id = v_mr.id;
  return json_build_object('exige', true,
    'orientacao', (select d.orientacao from public.class_requirements r join public.requisitos_com_documento d on d.manifesto_id = r.manifesto_id where r.id = v_mr.requirement_id),
    'documento', case when v_doc.id is null then null else public._documento_json(v_doc) end);
end $$;
revoke all on function public.documento_do_requisito(uuid) from public, anon;
grant execute on function public.documento_do_requisito(uuid) to authenticated;

-- Depois que o app apagou o arquivo no Storage: some o caminho, fica o registro de quem conferiu.
-- Dono ou avaliador do clube; só vale para documento já CONFERIDO (enviado nunca é apagado por aqui).
create or replace function public.documento_marcar_apagado(p_member_requirement_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_doc public.comprovacoes_documento;
begin
  select * into v_doc from public.comprovacoes_documento where member_requirement_id = p_member_requirement_id and club_id = v_club for update;
  if not found or v_doc.status <> 'conferido' then return; end if;
  if not (v_doc.usuario_id = auth.uid() or public.pode_avaliar_curriculo(v_club)) then raise exception 'Sem permissão.'; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'comprovacoes' and o.name = v_doc.evidencia_path) then
    raise exception 'A foto ainda está no armazenamento — apague o arquivo antes.';
  end if;
  update public.comprovacoes_documento set evidencia_path = null, foto_apagada_em = coalesce(foto_apagada_em, now()), updated_at = now()
   where id = v_doc.id;
end $$;
revoke all on function public.documento_marcar_apagado(uuid) from public, anon;
grant execute on function public.documento_marcar_apagado(uuid) to authenticated;

-- ---------- regras automáticas ----------
-- Tentativa nova de requisito que pede documento só entra com a foto enviada.
create or replace function public._exigir_documento_na_tentativa() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_req uuid;
begin
  select requirement_id into v_req from public.member_requirements where id = new.member_requirement_id;
  if public._requisito_exige_documento(v_req) and not exists (
       select 1 from public.comprovacoes_documento d
        where d.member_requirement_id = new.member_requirement_id and d.status = 'enviado' and d.evidencia_path is not null) then
    raise exception 'Envie a foto do documento antes de enviar para avaliação.';
  end if;
  return new;
end $$;
revoke all on function public._exigir_documento_na_tentativa() from public, anon, authenticated;
drop trigger if exists trg_exigir_documento_na_tentativa on public.requirement_submissions;
create trigger trg_exigir_documento_na_tentativa before insert on public.requirement_submissions
  for each row execute function public._exigir_documento_na_tentativa();

-- Aprovou o requisito: o documento vira "conferido por <quem aprovou> em <agora>".
create or replace function public._documento_conferido_na_aprovacao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    update public.comprovacoes_documento set status = 'conferido', conferido_por = auth.uid(), conferido_em = now(), updated_at = now()
     where member_requirement_id = new.id and status = 'enviado';
  end if;
  return new;
end $$;
revoke all on function public._documento_conferido_na_aprovacao() from public, anon, authenticated;
drop trigger if exists trg_documento_conferido_na_aprovacao on public.member_requirements;
create trigger trg_documento_conferido_na_aprovacao after update of status on public.member_requirements
  for each row execute function public._documento_conferido_na_aprovacao();

-- ---------- Storage (bucket privado 'comprovacoes', pasta <uid>/documentos/) ----------
-- O envio já é coberto pela policy "comprovacao dono envia" (pasta começa com o uid).
-- Leitura: o dono já lê a própria pasta; a liderança que avalia lê o documento do clube em uso
-- (enviado, e o conferido até o app apagar — o Storage exige ver o arquivo para apagá-lo).
create or replace function public.avaliador_ve_documento(p_objeto text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.pode_avaliar_curriculo(public.clube_atual_id())
     and exists (select 1 from public.comprovacoes_documento d
                  where d.evidencia_path = p_objeto and d.club_id = public.clube_atual_id() and d.status in ('enviado', 'conferido'));
$$;
revoke all on function public.avaliador_ve_documento(text) from public, anon;
grant execute on function public.avaliador_ve_documento(text) to authenticated;

drop policy if exists "documento: avaliador do clube le" on storage.objects;
create policy "documento: avaliador do clube le" on storage.objects for select to authenticated
  using (bucket_id = 'comprovacoes' and public.avaliador_ve_documento(name));

-- Apagar: o dono apaga arquivo da própria pasta de documentos que não está em uso por um envio
-- pendente (troca de foto / documento já conferido); o avaliador do clube apaga o já CONFERIDO.
create or replace function public.pode_apagar_documento(p_objeto text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (storage.foldername(p_objeto))[2] = 'documentos' and array_length(storage.foldername(p_objeto), 1) = 2 and (
      ((storage.foldername(p_objeto))[1] = auth.uid()::text
        and not exists (select 1 from public.comprovacoes_documento d where d.evidencia_path = p_objeto and d.status = 'enviado'))
   or (public.pode_avaliar_curriculo(public.clube_atual_id())
        and exists (select 1 from public.comprovacoes_documento d
                     where d.evidencia_path = p_objeto and d.club_id = public.clube_atual_id() and d.status = 'conferido')));
$$;
revoke all on function public.pode_apagar_documento(text) from public, anon;
grant execute on function public.pode_apagar_documento(text) to authenticated;

drop policy if exists "documento: dono ou avaliador apaga" on storage.objects;
create policy "documento: dono ou avaliador apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'comprovacoes' and public.pode_apagar_documento(name));

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000380', 'foto-de-documento-da-idade') on conflict do nothing;

-- ======================= 20260930000390_painel-do-coordenador =======================
-- =============================================================================
--  Painel do coordenador — "Como estão meus clubes" (28/09).
--
--  Público: coordenação de distrito/região (muitos idosos, 100% no celular). A tela inicial nova
--  precisa, POR CLUBE, de poucos números simples:
--    - quantos desbravadores estão fazendo classe;
--    - % dos requisitos aprovados (nas classes em andamento);
--    - requisitos aprovados no período escolhido (mês / trimestre / ano);
--    - última vez que o clube AVANÇOU (início de classe, envio ou aprovação de requisito) e há quantos dias;
--    - visitas da coordenação: realizadas no ano, no período, data da última e da próxima.
--  E totais do escopo (clubes, visitados no ano, faltando visitar, parados > 30 dias).
--
--  escopo_resumo_coordenador(p_periodo text) — 'mes' | 'trimestre' | 'ano' (padrão 'mes').
--  Mesmo gate da migration 300 (_escopo_em_uso_com_painel: sessão + x-escopo-atual com vínculo ATIVO
--  + papel com painel) e mesma árvore (_clubes_descendentes). Sem escopo → {sem_escopo:true, clubes:[]}.
--
--  SÓ AGREGADO: sai o nome do clube (dado institucional, já público na vitrine) e contagens/datas.
--  NUNCA sai nome/foto de pessoa, dado de criança, chat, mensagens, evidências, financeiro, plano.
--  SECURITY DEFINER com search_path ''. Nenhuma policy nova. Não altera linha nenhuma. Idempotente.
-- =============================================================================

create or replace function public.escopo_resumo_coordenador(p_periodo text default 'mes') returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_e record; v_res json; v_ini date; v_per text := coalesce(nullif(p_periodo, ''), 'mes');
  v_agora timestamp := (now() at time zone 'America/Sao_Paulo');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ano date := date_trunc('year', (now() at time zone 'America/Sao_Paulo'))::date;
begin
  if v_per not in ('mes', 'trimestre', 'ano') then raise exception 'Período inválido.'; end if;
  if auth.uid() is null then return json_build_object('sem_escopo', true, 'clubes', '[]'::json); end if;
  select * into v_e from public._escopo_em_uso_com_painel();
  if v_e.escopo is null then return json_build_object('sem_escopo', true, 'clubes', '[]'::json); end if;

  v_ini := case v_per when 'mes' then date_trunc('month', v_agora)::date
                      when 'trimestre' then date_trunc('quarter', v_agora)::date
                      else v_ano end;

  with
  cl as (
    select c.id, c.nome from public.organizational_units c
     where c.type = 'clube'
       and c.id in (select club_id from public._clubes_descendentes(v_e.escopo))
  ),
  mc as (   -- classes em andamento (ainda fazendo requisito)
    select m.id, m.club_id, m.usuario_id, m.class_id, m.iniciada_em from public.member_classes m join cl on cl.id = m.club_id
     where m.status = 'em_andamento'
  ),
  linhas as (
    select cl.id, cl.nome,
      (select count(distinct mc.usuario_id) from mc where mc.club_id = cl.id) as fazendo,
      (select count(*) from mc join public.class_sections s on s.class_id = mc.class_id
         join public.class_requirements r on r.section_id = s.id and r.ativo where mc.club_id = cl.id) as req_total,
      (select count(*) from public.member_requirements mr join mc on mc.id = mr.member_class_id
        where mc.club_id = cl.id and mr.status = 'aprovado') as req_aprov,
      (select count(*) from public.requirement_approvals a where a.club_id = cl.id and a.decisao = 'aprovado'
         and (a.created_at at time zone 'America/Sao_Paulo')::date >= v_ini) as aprov_periodo,
      greatest(
        (select max(m.iniciada_em) from public.member_classes m where m.club_id = cl.id),
        (select max(mr.enviado_em) from public.member_requirements mr where mr.club_id = cl.id),
        (select max(a.created_at) from public.requirement_approvals a where a.club_id = cl.id)) as ultimo_avanco,
      (select count(*) from public.club_visits v where v.club_id = cl.id and v.status = 'realizada'
         and (v.realizada_em at time zone 'America/Sao_Paulo')::date >= v_ano) as visitas_ano,
      (select count(*) from public.club_visits v where v.club_id = cl.id and v.status = 'realizada'
         and (v.realizada_em at time zone 'America/Sao_Paulo')::date >= v_ini) as visitas_periodo,
      (select max(v.realizada_em) from public.club_visits v where v.club_id = cl.id and v.status = 'realizada') as ultima_visita,
      (select min(v.agendada_para) from public.club_visits v where v.club_id = cl.id
         and v.status in ('agendada', 'confirmada') and v.agendada_para >= now() - interval '12 hours') as prox_visita
    from cl
  ),
  fim as (
    select l.*, case when l.ultimo_avanco is not null
                     then v_hoje - (l.ultimo_avanco at time zone 'America/Sao_Paulo')::date end as dias_parado
      from linhas l
  )
  select json_build_object(
    'periodo', v_per, 'desde', v_ini, 'hoje', v_hoje,
    'escopo', (select json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type)
                 from public.organizational_units u where u.id = v_e.escopo),
    'clubes', coalesce((select json_agg(json_build_object(
        'club_id', f.id, 'nome', f.nome,
        'desbravadores_em_classe', f.fazendo,
        'requisitos_total', f.req_total, 'requisitos_aprovados', least(f.req_aprov, f.req_total),
        'requisitos_pct', case when f.req_total > 0 then least(100, round(100.0 * f.req_aprov / f.req_total))::int end,
        'aprovados_no_periodo', f.aprov_periodo,
        'ultimo_avanco', (f.ultimo_avanco at time zone 'America/Sao_Paulo')::date,
        'dias_sem_avancar', f.dias_parado,
        'parado', (f.dias_parado is null or f.dias_parado > 30),
        'visitas_ano', f.visitas_ano, 'visitas_periodo', f.visitas_periodo,
        'ultima_visita', (f.ultima_visita at time zone 'America/Sao_Paulo')::date,
        'proxima_visita', (f.prox_visita at time zone 'America/Sao_Paulo')::date
      ) order by f.nome) from fim f), '[]'::json),
    'totais', (select json_build_object(
        'clubes', count(*),
        'desbravadores_em_classe', coalesce(sum(fazendo), 0),
        'requisitos_pct', case when sum(req_total) > 0 then least(100, round(100.0 * sum(least(req_aprov, req_total)) / sum(req_total)))::int end,
        'aprovados_no_periodo', coalesce(sum(aprov_periodo), 0),
        'clubes_parados', count(*) filter (where dias_parado is null or dias_parado > 30),
        'visitados_ano', count(*) filter (where visitas_ano > 0),
        'faltando_visitar_ano', count(*) filter (where visitas_ano = 0),
        'visitas_periodo', coalesce(sum(visitas_periodo), 0))
      from fim)
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.escopo_resumo_coordenador(text) from public, anon;
grant execute on function public.escopo_resumo_coordenador(text) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-painel-do-coordenador.sql')
on conflict (arquivo) do update set aplicada_em = now();

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000390', 'painel-do-coordenador') on conflict do nothing;

-- ======================= 20260930000400_modo-manutencao =======================
-- =============================================================================
-- 400 — MODO MANUTENÇÃO da plataforma (ninguém perde dado durante uma atualização)
-- =============================================================================
-- Pedido do dono (28/09): durante uma atualização ninguém pode perder dado.
--
-- O que esta migration faz:
--   1) public.plataforma_manutencao: UMA linha (id = 1) com o estado — manutenção ligada/desligada,
--      mensagem da tela, e o AVISO PRÉVIO (horário de início + mensagem da faixa). Só se mexe por RPC.
--   2) manutencao_estado(): leitura PÚBLICA e barata (anon também — a tela de login precisa saber).
--      Devolve só o que vai na tela; nada de quem ligou.
--   3) admin_manutencao_definir(...): só administrador da plataforma (_exigir_admin_plataforma), e
--      toda mudança vai para a auditoria (_admin_auditar, alvo_tipo 'plataforma_manutencao').
--   4) GUARDA CENTRAL DE ESCRITA — a forma MENOS invasiva que cobre tudo:
--      em vez de editar as ~centenas de RPCs de escrita (ou clube_atual_id/_exigir_*, que também são
--      chamados em LEITURAS), cada tabela de public ganha um gatilho FOR EACH STATEMENT
--      (_manutencao_guarda) em insert/update/delete. Com a manutenção ligada ele recusa a escrita
--      quando a requisição veio de usuário do app (papel do JWT = authenticated/anon) que NÃO é
--      admin da plataforma. Pega RPC security definer E escrita direta pelo PostgREST (o papel do JWT
--      continua o mesmo dentro da definer). É um gatilho por COMANDO (não por linha): custa uma
--      leitura por chave primária de uma tabela de 1 linha.
--      Passam: admin da plataforma (para testar), pg_cron/postgres (sem JWT), service_role
--      (Edge Functions) e as migrations. O pg_cron segue rodando (ex.: expirar teste grátis) — se o
--      dono quiser pausar o cron na janela, é decisão dele (ver pendências).
--      Exceções (telemetria/limite de taxa das RPCs públicas; bloquear derrubaria o site público, e
--      não é dado de usuário): app_erros, entrada_tentativas_publicas, vitrine_acessos_publicos,
--      push_tentativas, entrada_tentativas, e a própria plataforma_manutencao/platform_admin_audit.
--   5) Storage: policies RESTRICTIVE em storage.objects recusam upload/troca/apagar de arquivo do
--      usuário comum com a manutenção ligada.
--   6) _manutencao_instalar_guarda(): instala o gatilho nas tabelas que ainda não têm. Tabela NOVA em
--      migration futura: chamar `select public._manutencao_instalar_guarda();` no fim — o teste 100
--      falha se alguma tabela de public ficar sem a guarda.
--
-- A mensagem de erro começa com "MANUTENCAO:" — o cliente reconhece e guarda o rascunho.
-- =============================================================================

create table if not exists public.plataforma_manutencao (
  id smallint primary key default 1 check (id = 1),
  ativo boolean not null default false,
  mensagem text not null default 'Estamos em manutenção, volte em instantes.'
    check (char_length(mensagem) between 1 and 300),
  aviso_inicio timestamptz,
  aviso_mensagem text check (aviso_mensagem is null or char_length(aviso_mensagem) between 1 and 300),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null
);
insert into public.plataforma_manutencao (id) values (1) on conflict (id) do nothing;
alter table public.plataforma_manutencao enable row level security;
revoke all on table public.plataforma_manutencao from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- estado (interno) — usado pela guarda e pelas policies do Storage
-- ---------------------------------------------------------------------------
create or replace function public._manutencao_bloqueia_usuario() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_papel text;
  v_claims text;
begin
  if not exists (select 1 from public.plataforma_manutencao where id = 1 and ativo) then
    return false;
  end if;
  v_papel := nullif(current_setting('request.jwt.claim.role', true), '');
  if v_papel is null then
    v_claims := nullif(current_setting('request.jwt.claims', true), '');
    if v_claims is not null then
      begin
        v_papel := v_claims::jsonb ->> 'role';
      exception when others then v_papel := null;
      end;
    end if;
  end if;
  -- sem JWT (pg_cron, migration) ou service_role (Edge Function): passa
  if v_papel is null or v_papel not in ('authenticated', 'anon') then
    return false;
  end if;
  return not public.eh_admin_plataforma(auth.uid());
end;
$$;
revoke all on function public._manutencao_bloqueia_usuario() from public, anon, authenticated;

create or replace function public._manutencao_guarda() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public._manutencao_bloqueia_usuario() then
    raise exception 'MANUTENCAO: o DesbravaClube está em manutenção. Nada foi alterado; tente de novo em instantes.'
      using errcode = 'P0001', hint = 'manutencao';
  end if;
  return null;
end;
$$;
revoke all on function public._manutencao_guarda() from public, anon, authenticated;

create or replace function public._manutencao_instalar_guarda() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not c.relispartition
       and c.relname not in ('plataforma_manutencao', 'platform_admin_audit', 'app_erros',
                             'entrada_tentativas_publicas', 'entrada_tentativas',
                             'vitrine_acessos_publicos', 'push_tentativas')
       and not exists (select 1 from pg_trigger tg where tg.tgrelid = c.oid and tg.tgname = 'zz_manutencao_guarda')
  loop
    execute format('create trigger zz_manutencao_guarda before insert or update or delete on public.%I '
                   'for each statement execute function public._manutencao_guarda()', r.relname);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public._manutencao_instalar_guarda() from public, anon, authenticated;

select public._manutencao_instalar_guarda();

-- ---------------------------------------------------------------------------
-- Storage: sem upload/troca/apagar de arquivo por usuário comum durante a manutenção
-- ---------------------------------------------------------------------------
drop policy if exists "manutencao: sem upload" on storage.objects;
create policy "manutencao: sem upload" on storage.objects as restrictive for insert to authenticated
  with check (not public._manutencao_bloqueia_usuario());
drop policy if exists "manutencao: sem troca" on storage.objects;
create policy "manutencao: sem troca" on storage.objects as restrictive for update to authenticated
  using (not public._manutencao_bloqueia_usuario());
drop policy if exists "manutencao: sem apagar" on storage.objects;
create policy "manutencao: sem apagar" on storage.objects as restrictive for delete to authenticated
  using (not public._manutencao_bloqueia_usuario());
-- a policy é avaliada como o papel da requisição; a função é definer, mas precisa de EXECUTE
grant execute on function public._manutencao_bloqueia_usuario() to authenticated;

-- ---------------------------------------------------------------------------
-- leitura pública (anon + authenticated): o que a tela precisa, e nada mais
-- ---------------------------------------------------------------------------
create or replace function public.manutencao_estado() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ativo', m.ativo,
    'mensagem', m.mensagem,
    'aviso_inicio', m.aviso_inicio,
    'aviso_mensagem', m.aviso_mensagem,
    'sou_admin', public.eh_admin_plataforma(auth.uid()),
    'agora', now()
  )
  from public.plataforma_manutencao m where m.id = 1;
$$;
revoke all on function public.manutencao_estado() from public;
grant execute on function public.manutencao_estado() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- controle do admin da plataforma (auditado)
--   p_ativo           liga/desliga agora
--   p_mensagem        texto da tela de manutenção (null = mantém)
--   p_aviso_inicio    horário anunciado na faixa (null = sem aviso)
--   p_aviso_mensagem  texto extra da faixa (null = texto padrão)
-- ---------------------------------------------------------------------------
create or replace function public.admin_manutencao_definir(
  p_ativo boolean, p_mensagem text default null, p_aviso_inicio timestamptz default null, p_aviso_mensagem text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public._exigir_admin_plataforma();
  v_antes public.plataforma_manutencao;
  v_depois public.plataforma_manutencao;
begin
  if p_ativo is null then
    raise exception 'Informe se a manutenção fica ligada ou desligada.';
  end if;
  select * into v_antes from public.plataforma_manutencao where id = 1 for update;
  update public.plataforma_manutencao
     set ativo = p_ativo,
         mensagem = coalesce(nullif(btrim(p_mensagem), ''), mensagem),
         aviso_inicio = case when p_ativo then null else p_aviso_inicio end,
         aviso_mensagem = case when p_ativo then null else nullif(btrim(p_aviso_mensagem), '') end,
         atualizado_em = now(),
         atualizado_por = v_admin
   where id = 1
  returning * into v_depois;
  perform public._admin_auditar(
    case when p_ativo and not v_antes.ativo then 'manutencao_ligar'
         when not p_ativo and v_antes.ativo then 'manutencao_desligar'
         else 'manutencao_ajustar' end,
    'plataforma_manutencao', null,
    jsonb_build_object('ativo', v_depois.ativo, 'mensagem', v_depois.mensagem,
                       'aviso_inicio', v_depois.aviso_inicio, 'aviso_mensagem', v_depois.aviso_mensagem,
                       'antes_ativo', v_antes.ativo));
  return public.manutencao_estado();
end;
$$;
revoke all on function public.admin_manutencao_definir(boolean, text, timestamptz, text) from public, anon;
grant execute on function public.admin_manutencao_definir(boolean, text, timestamptz, text) to authenticated;

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000400', 'modo-manutencao') on conflict do nothing;

-- ======================= 20260930000410_paineis-por-plano =======================
-- =============================================================================
--  Painéis por plano (28/09): o dono escolhe, no /admin, quais recursos cada plano libera.
--
--  O motor já existia (migration 48): `billing_plans.recursos` é o TETO de módulos do plano
--  (NULL = todos) e entra em `recurso_habilitado_no_clube`, `recursos_do_clube`, nos gatilhos
--  `trg_exigir_recurso` e em `recurso_definir` (201). Faltava só a PORTA do dono, sem SQL.
--
--  Regras:
--    * Só administrador da plataforma altera (`_exigir_admin_plataforma`); cada mudança vai para
--      `platform_admin_audit` com o antes/depois e quantos clubes foram afetados.
--    * Muda a versão do plano NO LUGAR (só a coluna `recursos`; preço, limites e versão ficam).
--      Todo clube com assinatura naquele plano sente a mudança na hora.
--    * REMOVER do plano não apaga nada: `club_features` e os dados do recurso ficam intactos; o
--      recurso só fica inacessível (leitura/escrita barradas pelo servidor, tela escondida).
--      INCLUIR de volta devolve tudo exatamente como estava (inclusive a escolha da diretoria).
--    * Remoção que afeta clube exige confirmação explícita: a 1ª chamada devolve o impacto
--      (`precisa_confirmar`) e não altera nada.
--    * Não remove 'leilao' de plano com leilão ABERTO em clube do plano (mesma regra do 201).
--    * Plano com recursos = NULL ("todos") vira a lista explícita do catálogo ao remover o 1º.
--    * Recurso `somente_plataforma` (especialidades): o plano continua sendo só o teto. Incluir
--      no plano NÃO liga nada no clube — quem liga é `admin_recurso_do_clube_definir`, clube a clube.
-- =============================================================================

-- clubes cuja assinatura vigente está neste plano
create or replace function public._clubes_do_plano(p_plan_id uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id from public.organizational_units o
   where o.type = 'clube'
     and exists (select 1 from public.subscriptions s
                  where s.id = public.assinatura_do_clube_id(o.id) and s.plan_id = p_plan_id);
$$;
revoke all on function public._clubes_do_plano(uuid) from public, anon, authenticated;

create or replace function public._plano_recurso_impacto(p_plan_id uuid, p_feature text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with c as (select id from public._clubes_do_plano(p_plan_id) id)
  select jsonb_build_object(
    'recurso', p_feature,
    'clubes_no_plano', (select count(*) from c),
    'clubes_usando', (select count(*) from c where public.recurso_habilitado_no_clube(c.id, p_feature)),
    'leiloes_abertos', case when p_feature = 'leilao' then
        (select count(*) from public.leiloes l where l.status = 'aberto' and l.club_id in (select id from c)) else 0 end,
    'clubes', coalesce((select jsonb_agg(o.nome order by o.nome) from (
        select o.nome from public.organizational_units o where o.id in (select id from c) order by o.nome limit 20) o), '[]'::jsonb));
$$;
revoke all on function public._plano_recurso_impacto(uuid, text) from public, anon, authenticated;

-- a tela: todos os planos com a lista completa do catálogo e o que cada um inclui
create or replace function public.admin_planos_recursos() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select json_agg(json_build_object(
      'id', p.id, 'chave', p.chave, 'versao', p.versao, 'nome', p.nome, 'status', p.status, 'ativo', p.ativo,
      'publico', p.publico, 'todos', p.recursos is null,
      'clubes', (select count(*) from public._clubes_do_plano(p.id)),
      'recursos', (select json_agg(json_build_object(
                     'chave', c.chave, 'nome', c.nome, 'descricao', c.descricao, 'icone', c.icone,
                     'somente_plataforma', c.somente_plataforma,
                     'incluido', p.recursos is null or c.chave = any (p.recursos)) order by c.ordem, c.chave)
                   from public.recursos_catalogo c)
    ) order by p.ativo desc, p.chave, p.versao desc)
    from public.billing_plans p), '[]'::json);
end;
$$;
revoke all on function public.admin_planos_recursos() from public, anon;
grant execute on function public.admin_planos_recursos() to authenticated;

create or replace function public.admin_plano_recurso_impacto(p_plan_id uuid, p_feature text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  if not exists (select 1 from public.billing_plans where id = p_plan_id) then raise exception 'Plano não encontrado.'; end if;
  if not exists (select 1 from public.recursos_catalogo where chave = p_feature) then raise exception 'Recurso desconhecido.'; end if;
  return public._plano_recurso_impacto(p_plan_id, p_feature);
end;
$$;
revoke all on function public.admin_plano_recurso_impacto(uuid, text) from public, anon;
grant execute on function public.admin_plano_recurso_impacto(uuid, text) to authenticated;

create or replace function public.admin_plano_recurso_definir(
  p_plan_id uuid, p_feature text, p_incluir boolean, p_confirmar boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_plan record; v_cat record; v_antes text[]; v_depois text[]; v_imp jsonb;
begin
  perform public._exigir_admin_plataforma();
  if p_incluir is null then raise exception 'Informe se o recurso entra ou sai do plano.'; end if;
  select * into v_plan from public.billing_plans where id = p_plan_id for update;
  if not found then raise exception 'Plano não encontrado.'; end if;
  select * into v_cat from public.recursos_catalogo where chave = p_feature;
  if not found then raise exception 'Recurso desconhecido.'; end if;

  v_antes := v_plan.recursos;
  if p_incluir then
    if v_antes is null or p_feature = any (v_antes) then
      return jsonb_build_object('alterado', false, 'incluido', true);
    end if;
    v_depois := array_append(v_antes, p_feature);
  else
    if v_antes is not null and not (p_feature = any (v_antes)) then
      return jsonb_build_object('alterado', false, 'incluido', false);
    end if;
    v_imp := public._plano_recurso_impacto(p_plan_id, p_feature);
    if (v_imp ->> 'leiloes_abertos')::int > 0 then
      raise exception 'Há leilão aberto em clube deste plano: encerre ou cancele antes de tirar o leilão do plano.';
    end if;
    if (v_imp ->> 'clubes_no_plano')::int > 0 and not coalesce(p_confirmar, false) then
      return jsonb_build_object('alterado', false, 'precisa_confirmar', true, 'impacto', v_imp);
    end if;
    v_depois := array_remove(coalesce(v_antes,
                  (select array_agg(c.chave order by c.ordem, c.chave) from public.recursos_catalogo c)), p_feature);
  end if;

  update public.billing_plans set recursos = v_depois where id = p_plan_id;
  perform public._admin_auditar(case when p_incluir then 'plano_recurso_incluido' else 'plano_recurso_removido' end,
    'plano', p_plan_id, jsonb_build_object('plano', v_plan.chave, 'versao', v_plan.versao, 'recurso', p_feature,
      'antes', to_jsonb(v_antes), 'depois', to_jsonb(v_depois),
      'clubes_afetados', coalesce((v_imp ->> 'clubes_no_plano')::int, (select count(*) from public._clubes_do_plano(p_plan_id)))));
  return jsonb_build_object('alterado', true, 'incluido', p_incluir, 'recursos', to_jsonb(v_depois));
end;
$$;
revoke all on function public.admin_plano_recurso_definir(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.admin_plano_recurso_definir(uuid, text, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000410', 'paineis-por-plano') on conflict do nothing;

-- ======================= 20260930000420_preferencias-de-acessibilidade =======================
-- =============================================================================
-- 420 — Preferências de acessibilidade salvas na conta (tamanho de letra e alto contraste)
-- =============================================================================
-- Pedido do dono (28/09): crianças, pais e coordenadores idosos, 100% no celular. A pessoa escolhe
-- A− / A / A+ / A++ e liga/desliga o alto contraste no menu da conta; a escolha vale em qualquer
-- aparelho em que ela entrar (por isso fica no banco, não só no navegador).
--
-- Onde: profiles.preferencias (jsonb). NÃO entra no grant de colunas do SELECT direto (86): só a
-- própria pessoa lê, pela meu_perfil() (que devolve p.* da própria linha).
-- Escrita: só pela RPC salvar_preferencias_acessibilidade, que grava SEMPRE na linha de auth.uid()
-- (não recebe id — não há como apontar para a conta de outra pessoa) e valida cada valor.
-- Chaves conhecidas: fonte ('pequena'|'normal'|'grande'|'enorme') e alto_contraste (boolean).
-- =============================================================================

alter table public.profiles
  add column if not exists preferencias jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.profiles add constraint profiles_preferencias_objeto
    check (jsonb_typeof(preferencias) = 'object' and pg_column_size(preferencias) <= 2048);
exception when duplicate_object then null; end $$;

create or replace function public.salvar_preferencias_acessibilidade(p_fonte text, p_alto_contraste boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_nova jsonb;
begin
  if v_uid is null then
    raise exception 'Entre na sua conta para salvar as preferências.' using errcode = '42501';
  end if;
  if p_fonte is null or p_fonte not in ('pequena', 'normal', 'grande', 'enorme') then
    raise exception 'Tamanho de letra inválido.' using errcode = '22023';
  end if;
  if p_alto_contraste is null then
    raise exception 'Informe se o alto contraste fica ligado ou desligado.' using errcode = '22023';
  end if;

  update public.profiles p
     set preferencias = coalesce(p.preferencias, '{}'::jsonb)
                        || jsonb_build_object('fonte', p_fonte, 'alto_contraste', p_alto_contraste)
   where p.id = v_uid
  returning p.preferencias into v_nova;

  if v_nova is null then
    raise exception 'Perfil não encontrado.' using errcode = 'P0002';
  end if;
  return v_nova;
end $$;

revoke all on function public.salvar_preferencias_acessibilidade(text, boolean) from public, anon;
grant execute on function public.salvar_preferencias_acessibilidade(text, boolean) to authenticated;

comment on column public.profiles.preferencias is
  'Preferências da própria pessoa (acessibilidade: fonte, alto_contraste). Gravadas só por salvar_preferencias_acessibilidade(); lidas só por meu_perfil().';

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000420', 'preferencias-de-acessibilidade') on conflict do nothing;

-- ======================= 20260930000430_comunidade-base-e-triagem =======================
-- =============================================================================
-- 430 — COMUNIDADE entre clubes (fase 1): recurso, tabelas e TRIAGEM DE TEXTO no servidor
-- =============================================================================
-- Feed estilo Instagram/TikTok entre clubes. Público: crianças de 10–15 anos, então a SEGURANÇA
-- vem antes de tudo. Esta migration cria a base; a 431 as RPCs do feed e a 432 moderação,
-- autorização dos pais, Storage e o painel da plataforma.
--
-- Decisões do dono (28/09) que moldam o desenho:
--   * O recurso 'comunidade' NASCE DESLIGADO e é SOMENTE DA PLATAFORMA (como 'especialidades',
--     migration 83): a liderança não liga. Só será ligado depois de termos de uso, autorização
--     dos pais e IA de imagem — decisões pendentes do dono.
--   * O desbravador publica LIVREMENTE (sem aprovação prévia), mas o SISTEMA faz triagem
--     automática ANTES de publicar. Texto ruim NEM é publicado (mensagem gentil).
--   * Conteúdo DENUNCIADO some para todos na hora; a DIRETORIA do clube de quem publicou é avisada
--     e revisa (restaurar ou remover de vez).
--
-- Acesso: TODAS as tabelas com RLS ligado e SEM grant para anon/authenticated. Tudo passa por
-- RPC security definer (search_path '') que confere clube em uso, papel, recurso e regras.
--
-- A triagem é NOSSA (sem serviço externo): lista de termos pt-BR editável pelo admin da
-- plataforma (comunidade_termos), com normalização de disfarces, e bloqueio de dados de contato.
-- Tudo o que é bloqueado fica registrado (comunidade_bloqueios), com dígitos mascarados.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. O recurso: desligado e somente da plataforma
-- -----------------------------------------------------------------------------
insert into public.recursos_catalogo (chave, nome, descricao, icone, padrao, ordem, somente_plataforma) values
  ('comunidade', 'Comunidade', 'Feed entre clubes com triagem automática e moderação da diretoria. Liberado pela plataforma depois dos termos de uso, da autorização dos pais e da análise de imagens.', '🌎', false, 140, true)
on conflict (chave) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, padrao = excluded.padrao,
      ordem = excluded.ordem, somente_plataforma = excluded.somente_plataforma;


-- -----------------------------------------------------------------------------
--  2. Normalização de disfarces (pura, sem acesso a dado)
-- -----------------------------------------------------------------------------
-- Ordem: minúsculas -> sem acento -> leetspeak (0→o 4→a 3→e 1→i @→a 5→s $→s 7→t !→i |→i)
-- -> tudo que não é letra vira espaço (pontos, traços, emojis) -> letras soltas em sequência são
-- juntadas ("p u t a", "p.u.t.a" -> "puta") -> letras repetidas colapsam ("merdaaaa" -> "merda").
-- Os TERMOS da lista passam pela MESMA normalização (gatilho), então os dois lados batem.
create or replace function public.comunidade_normalizar(p_texto text)
returns text
language plpgsql immutable set search_path = '' as $$
declare v text; v_tok text; v_saida text[] := '{}'; v_run text := '';
begin
  v := lower(coalesce(p_texto, ''));
  v := translate(v, 'áàâãäåāéèêëēíìîïóòôõöøúùûüçñýÿ', 'aaaaaaaeeeeeiiiiooooooouuuucnyy');
  v := translate(v, '0431@5$7!|', 'oaeiasstii');
  v := regexp_replace(v, '[^a-z]+', ' ', 'g');
  foreach v_tok in array string_to_array(btrim(v), ' ') loop
    if v_tok = '' then continue; end if;
    if length(v_tok) = 1 then
      v_run := v_run || v_tok;
    else
      if v_run <> '' then v_saida := v_saida || v_run; v_run := ''; end if;
      v_saida := v_saida || v_tok;
    end if;
  end loop;
  if v_run <> '' then v_saida := v_saida || v_run; end if;
  v := array_to_string(v_saida, ' ');
  return regexp_replace(v, '([a-z])\1+', '\1', 'g');
end;
$$;
revoke all on function public.comunidade_normalizar(text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  3. Tabelas
-- -----------------------------------------------------------------------------
-- 3.1 Lista de termos (da PLATAFORMA; sem club_id — exceção declarada no teste 20)
create table if not exists public.comunidade_termos (
  id uuid primary key default gen_random_uuid(),
  termo text not null,
  -- exata: a palavra/expressão inteira; radical: palavra que COMEÇA com o termo
  modo text not null default 'exata' check (modo in ('exata', 'radical')),
  -- ofensa: palavrão/xingamento/sexual; contato: rede social, "me chama no zap", endereço...
  categoria text not null default 'ofensa' check (categoria in ('ofensa', 'contato')),
  ativo boolean not null default true,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (termo, modo)
);
alter table public.comunidade_termos enable row level security;
revoke all on public.comunidade_termos from public, anon, authenticated;

create or replace function public._comunidade_normalizar_termo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.termo := btrim(public.comunidade_normalizar(new.termo));
  if new.termo = '' or length(new.termo) < 2 then
    raise exception 'Termo vazio ou curto demais depois da normalização.';
  end if;
  return new;
end;
$$;
revoke all on function public._comunidade_normalizar_termo() from public, anon, authenticated;
drop trigger if exists trg_comunidade_normalizar_termo on public.comunidade_termos;
create trigger trg_comunidade_normalizar_termo before insert or update of termo on public.comunidade_termos
  for each row execute function public._comunidade_normalizar_termo();

-- 3.2 Publicações. club_id = clube do AUTOR (é a diretoria dele que modera).
create table if not exists public.comunidade_posts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  autor_papel text not null,                        -- papel no clube no momento da publicação
  legenda text check (legenda is null or length(legenda) <= 500),
  foto_path text unique,                            -- bucket privado 'comunidade': <club>/<autor>/<uuid>.jpg
  repost_de uuid references public.comunidade_posts(id) on delete set null,
  status text not null check (status in (
    'publicado',          -- visível no feed
    'em_analise',         -- foto aguardando a diretoria (sem IA de imagem ainda)
    'oculto_denuncia',    -- denunciado: some para todos até a diretoria revisar
    'removido',           -- a moderação removeu de vez
    'recusado',           -- a diretoria recusou a foto
    'apagado',            -- o próprio autor apagou
    'retirado'            -- o responsável revogou a autorização
  )),
  created_at timestamptz not null default now(),
  publicado_em timestamptz,
  moderado_por uuid references public.profiles(id) on delete set null,
  moderado_em timestamptz,
  check (legenda is not null or foto_path is not null or repost_de is not null)
);
create index if not exists comunidade_posts_feed_idx on public.comunidade_posts (created_at desc, id desc) where status = 'publicado';
create index if not exists comunidade_posts_clube_idx on public.comunidade_posts (club_id, status);
create index if not exists comunidade_posts_autor_idx on public.comunidade_posts (autor_id, created_at desc);
create index if not exists comunidade_posts_repost_idx on public.comunidade_posts (repost_de) where repost_de is not null;
alter table public.comunidade_posts enable row level security;
revoke all on public.comunidade_posts from public, anon, authenticated;

-- 3.3 Curtidas (club_id = clube de quem curtiu)
create table if not exists public.comunidade_curtidas (
  post_id uuid not null references public.comunidade_posts(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, usuario_id)
);
alter table public.comunidade_curtidas enable row level security;
revoke all on public.comunidade_curtidas from public, anon, authenticated;

-- 3.4 Comentários (club_id = clube de quem comentou; é a diretoria dele que modera)
create table if not exists public.comunidade_comentarios (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.comunidade_posts(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  autor_papel text not null,
  texto text not null check (length(texto) between 1 and 300),
  status text not null default 'publicado' check (status in ('publicado', 'oculto_denuncia', 'removido', 'apagado', 'retirado')),
  created_at timestamptz not null default now(),
  moderado_por uuid references public.profiles(id) on delete set null,
  moderado_em timestamptz
);
create index if not exists comunidade_comentarios_post_idx on public.comunidade_comentarios (post_id, created_at desc);
create index if not exists comunidade_comentarios_autor_idx on public.comunidade_comentarios (autor_id, created_at desc);
alter table public.comunidade_comentarios enable row level security;
revoke all on public.comunidade_comentarios from public, anon, authenticated;

-- 3.5 Denúncias. club_id = clube de quem PUBLICOU o conteúdo (a diretoria que revisa).
create table if not exists public.comunidade_denuncias (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  alvo_tipo text not null check (alvo_tipo in ('post', 'comentario')),
  alvo_id uuid not null,
  denunciante_id uuid not null references public.profiles(id) on delete cascade,
  denunciante_club_id uuid references public.organizational_units(id) on delete set null,
  motivo text not null check (motivo in ('ofensivo', 'perigoso', 'contato', 'imagem', 'outro')),
  ocultou boolean not null default false,        -- esta denúncia escondeu o conteúdo na hora?
  resultado text not null default 'pendente' check (resultado in ('pendente', 'procedente', 'improcedente')),
  resolvido_em timestamptz,
  created_at timestamptz not null default now(),
  unique (alvo_tipo, alvo_id, denunciante_id)
);
create index if not exists comunidade_denuncias_fila_idx on public.comunidade_denuncias (club_id, resultado);
create index if not exists comunidade_denuncias_denunciante_idx on public.comunidade_denuncias (denunciante_id, created_at desc);
alter table public.comunidade_denuncias enable row level security;
revoke all on public.comunidade_denuncias from public, anon, authenticated;

-- 3.6 Registro do que a triagem BLOQUEOU (club_id = clube de quem tentou). Dígitos mascarados:
-- a tentativa de passar telefone não vira um cadastro de telefones de criança.
create table if not exists public.comunidade_bloqueios (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  alvo text not null check (alvo in ('post', 'comentario')),
  motivo text not null check (motivo in ('ofensa', 'contato')),
  regra text not null,                           -- termo normalizado ou telefone/email/arroba/link
  trecho text not null,                          -- até 280 caracteres, dígitos trocados por #
  created_at timestamptz not null default now()
);
create index if not exists comunidade_bloqueios_autor_idx on public.comunidade_bloqueios (autor_id, created_at desc);
create index if not exists comunidade_bloqueios_quando_idx on public.comunidade_bloqueios (created_at desc);
alter table public.comunidade_bloqueios enable row level security;
revoke all on public.comunidade_bloqueios from public, anon, authenticated;

-- 3.7 Auditoria da moderação (quem ocultou/restaurou/removeu/aprovou/suspendeu, e por qual via)
create table if not exists public.comunidade_moderacao_log (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  alvo_tipo text not null check (alvo_tipo in ('post', 'comentario', 'usuario')),
  alvo_id uuid not null,
  acao text not null check (acao in ('ocultado_por_denuncia', 'restaurar', 'remover', 'aprovar_foto', 'recusar_foto',
                                     'suspenso', 'suspensao_encerrada', 'autorizacao_concedida', 'autorizacao_revogada')),
  por uuid references public.profiles(id) on delete set null,   -- nulo = o sistema
  via text not null check (via in ('sistema', 'diretoria', 'plataforma', 'responsavel')),
  motivo text,
  created_at timestamptz not null default now()
);
create index if not exists comunidade_moderacao_log_clube_idx on public.comunidade_moderacao_log (club_id, created_at desc);
alter table public.comunidade_moderacao_log enable row level security;
revoke all on public.comunidade_moderacao_log from public, anon, authenticated;

create or replace function public._comunidade_log_imutavel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'O histórico da moderação não se altera.';
end;
$$;
revoke all on function public._comunidade_log_imutavel() from public, anon, authenticated;
drop trigger if exists trg_comunidade_log_imutavel on public.comunidade_moderacao_log;
create trigger trg_comunidade_log_imutavel before update on public.comunidade_moderacao_log
  for each row execute function public._comunidade_log_imutavel();

-- 3.8 Avisos (strikes) e suspensões temporárias do feed
create table if not exists public.comunidade_avisos (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  origem text not null check (origem in ('texto_bloqueado', 'conteudo_removido')),
  referencia uuid,
  created_at timestamptz not null default now()
);
create index if not exists comunidade_avisos_usuario_idx on public.comunidade_avisos (usuario_id, created_at desc);
alter table public.comunidade_avisos enable row level security;
revoke all on public.comunidade_avisos from public, anon, authenticated;

create table if not exists public.comunidade_suspensoes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  ate timestamptz not null,
  motivo text not null,
  created_at timestamptz not null default now(),
  encerrada_em timestamptz,
  encerrada_por uuid references public.profiles(id) on delete set null
);
create index if not exists comunidade_suspensoes_usuario_idx on public.comunidade_suspensoes (usuario_id, ate desc);
alter table public.comunidade_suspensoes enable row level security;
revoke all on public.comunidade_suspensoes from public, anon, authenticated;

-- 3.9 Autorização do responsável (por desbravador, no clube do vínculo pais↔filho)
create table if not exists public.comunidade_autorizacoes (
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  desbravador_id uuid not null references public.profiles(id) on delete cascade,
  responsavel_id uuid not null references public.profiles(id) on delete cascade,
  autorizado boolean not null,
  atualizado_em timestamptz not null default now(),
  primary key (club_id, desbravador_id)
);
alter table public.comunidade_autorizacoes enable row level security;
revoke all on public.comunidade_autorizacoes from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  4. Limites (um lugar só; mudar = migration nova)
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_limites()
returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'posts_por_minuto', 2,
    'posts_por_dia', 10,
    'posts_por_dia_observacao', 3,          -- conta nova (primeiros dias)
    'comentarios_por_minuto', 5,
    'comentarios_por_dia', 60,
    'comentarios_por_dia_observacao', 15,
    'dias_observacao', 7,
    'avisos_para_suspender', 3,
    'janela_avisos_dias', 30,
    'dias_suspensao', 3,
    'denuncias_por_dia', 10,
    'denuncias_improcedentes_para_perder', 3, -- quem erra tanto perde o poder de esconder na hora
    'janela_denuncias_dias', 60
  );
$$;
revoke all on function public.comunidade_limites() from public, anon;
grant execute on function public.comunidade_limites() to authenticated;


-- -----------------------------------------------------------------------------
--  5. A triagem
-- -----------------------------------------------------------------------------
-- Devolve {ok:true} ou {ok:false, motivo:'ofensa'|'contato', regra}. Interna: nunca exposta, para
-- ninguém usar como oráculo e "testar" a lista. O cliente NÃO decide nada: as RPCs chamam isto.
create or replace function public._comunidade_triar(p_texto text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_raw text := lower(coalesce(p_texto, '')); v_norm text; v_t record;
begin
  -- dados de contato no texto CRU (antes do leetspeak, que transformaria @ e dígitos em letras)
  if v_raw ~ '(\d[\s.()_-]*){8,}' then
    return jsonb_build_object('ok', false, 'motivo', 'contato', 'regra', 'telefone');
  end if;
  if v_raw ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    return jsonb_build_object('ok', false, 'motivo', 'contato', 'regra', 'email');
  end if;
  if v_raw ~ '(^|[^a-z0-9])@[a-z0-9_.]{2,}' then
    return jsonb_build_object('ok', false, 'motivo', 'contato', 'regra', 'arroba');
  end if;
  if v_raw ~ '(https?://|www\.)'
     or v_raw ~ '[a-z0-9-]+\.(com|net|org|br|ly|gg|io|app|link|tv|xyz|site|online|info)(\M|/|$)' then
    return jsonb_build_object('ok', false, 'motivo', 'contato', 'regra', 'link');
  end if;

  v_norm := ' ' || public.comunidade_normalizar(p_texto) || ' ';
  select t.termo, t.categoria into v_t
    from public.comunidade_termos t
   where t.ativo
     and case t.modo when 'exata' then position(' ' || t.termo || ' ' in v_norm) > 0
                     else position(' ' || t.termo in v_norm) > 0 end
   order by (t.categoria = 'contato') desc, length(t.termo) desc
   limit 1;
  if found then
    return jsonb_build_object('ok', false, 'motivo', v_t.categoria, 'regra', v_t.termo);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public._comunidade_triar(text) from public, anon, authenticated;

-- mensagem gentil (a criança nunca sabe QUAL palavra pegou — não vira jogo de adivinhar a lista)
create or replace function public._comunidade_msg_bloqueio(p_motivo text, p_alvo text)
returns text
language sql immutable set search_path = '' as $$
  select case
    when p_motivo = 'contato' then 'Por segurança, não é permitido passar telefone, @, links, e-mail ou rede social na Comunidade 🙂'
    when p_alvo = 'comentario' then 'Esse comentário não pode ser publicado. Vamos manter o respeito 🙂'
    else 'Essa publicação não pode ser publicada. Vamos manter o respeito 🙂'
  end;
$$;
revoke all on function public._comunidade_msg_bloqueio(text, text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  6. Lista inicial (pt-BR). Editável pelo admin da plataforma (migration 432, RPCs admin_comunidade_*).
--     Os termos são normalizados pelo gatilho (acentos, repetições), então "whatsapp" vira "whatsap".
-- -----------------------------------------------------------------------------
insert into public.comunidade_termos (termo, modo, categoria)
select x.termo, x.modo, x.categoria from (values
  -- ofensa / palavrão (palavra inteira)
  ('porra', 'exata', 'ofensa'), ('caralho', 'exata', 'ofensa'), ('merda', 'exata', 'ofensa'), ('bosta', 'exata', 'ofensa'),
  ('puta', 'exata', 'ofensa'), ('puto', 'exata', 'ofensa'), ('putaria', 'exata', 'ofensa'), ('puteiro', 'exata', 'ofensa'),
  ('fdp', 'exata', 'ofensa'), ('pqp', 'exata', 'ofensa'), ('vsf', 'exata', 'ofensa'), ('vtnc', 'exata', 'ofensa'),
  ('tnc', 'exata', 'ofensa'), ('krl', 'exata', 'ofensa'), ('crl', 'exata', 'ofensa'), ('cu', 'exata', 'ofensa'),
  ('cuzao', 'exata', 'ofensa'), ('cuzinho', 'exata', 'ofensa'), ('arrombado', 'exata', 'ofensa'), ('arrombada', 'exata', 'ofensa'),
  ('viado', 'exata', 'ofensa'), ('viadinho', 'exata', 'ofensa'), ('sapatao', 'exata', 'ofensa'),
  ('buceta', 'exata', 'ofensa'), ('boceta', 'exata', 'ofensa'), ('xoxota', 'exata', 'ofensa'), ('xereca', 'exata', 'ofensa'),
  ('piroca', 'exata', 'ofensa'), ('babaca', 'exata', 'ofensa'), ('otario', 'exata', 'ofensa'), ('otaria', 'exata', 'ofensa'),
  ('imbecil', 'exata', 'ofensa'), ('retardado', 'exata', 'ofensa'), ('retardada', 'exata', 'ofensa'),
  ('vagabundo', 'exata', 'ofensa'), ('vagabunda', 'exata', 'ofensa'), ('vadia', 'exata', 'ofensa'),
  ('corno', 'exata', 'ofensa'), ('corna', 'exata', 'ofensa'), ('desgracado', 'exata', 'ofensa'), ('desgracada', 'exata', 'ofensa'),
  ('nudes', 'exata', 'ofensa'), ('nude', 'exata', 'ofensa'), ('pelada', 'exata', 'ofensa'), ('pelado', 'exata', 'ofensa'),
  ('gostosa', 'exata', 'ofensa'), ('gostoso', 'exata', 'ofensa'), ('sexo', 'exata', 'ofensa'), ('transar', 'exata', 'ofensa'),
  ('porno', 'exata', 'ofensa'), ('xvideos', 'exata', 'ofensa'), ('maconha', 'exata', 'ofensa'), ('cocaina', 'exata', 'ofensa'),
  ('hitler', 'exata', 'ofensa'), ('nazista', 'exata', 'ofensa'),
  -- ofensa (expressões)
  ('filho da puta', 'exata', 'ofensa'), ('vai se foder', 'exata', 'ofensa'), ('vai tomar no cu', 'exata', 'ofensa'),
  ('puta que pariu', 'exata', 'ofensa'), ('se mata', 'exata', 'ofensa'), ('vou te matar', 'exata', 'ofensa'),
  -- ofensa (radical: palavra que começa com)
  ('fod', 'radical', 'ofensa'), ('caralh', 'radical', 'ofensa'), ('arromb', 'radical', 'ofensa'), ('merd', 'radical', 'ofensa'),
  ('punhet', 'radical', 'ofensa'), ('siriric', 'radical', 'ofensa'), ('masturb', 'radical', 'ofensa'), ('bucet', 'radical', 'ofensa'),
  -- contato: redes, mensageiros, privado, endereço
  ('zap', 'exata', 'contato'), ('zapzap', 'exata', 'contato'), ('whats', 'exata', 'contato'), ('whatsapp', 'exata', 'contato'),
  ('wpp', 'exata', 'contato'), ('insta', 'exata', 'contato'), ('instagram', 'exata', 'contato'), ('telegram', 'exata', 'contato'),
  ('discord', 'exata', 'contato'), ('snap', 'exata', 'contato'), ('snapchat', 'exata', 'contato'), ('kwai', 'exata', 'contato'),
  ('tiktok', 'exata', 'contato'), ('facebook', 'exata', 'contato'), ('gmail', 'exata', 'contato'), ('hotmail', 'exata', 'contato'),
  ('pv', 'exata', 'contato'), ('dm', 'exata', 'contato'), ('direct', 'exata', 'contato'), ('inbox', 'exata', 'contato'),
  ('no privado', 'exata', 'contato'), ('me chama', 'exata', 'contato'), ('me add', 'exata', 'contato'), ('me adiciona', 'exata', 'contato'),
  ('me segue', 'exata', 'contato'), ('meu numero', 'exata', 'contato'), ('meu telefone', 'exata', 'contato'), ('meu cel', 'exata', 'contato'),
  ('meu celular', 'exata', 'contato'), ('ponto com', 'exata', 'contato'), ('arroba', 'exata', 'contato'),
  ('meu endereco', 'exata', 'contato'), ('onde eu moro', 'exata', 'contato'), ('onde voce mora', 'exata', 'contato'),
  ('onde vc mora', 'exata', 'contato'), ('minha escola', 'exata', 'contato')
) as x(termo, modo, categoria)
where not exists (select 1 from public.comunidade_termos t where t.termo = public.comunidade_normalizar(x.termo) and t.modo = x.modo);

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000430', 'comunidade-base-e-triagem') on conflict do nothing;

-- ======================= 20260930000431_comunidade-feed-e-regras =======================
-- =============================================================================
-- 431 — COMUNIDADE (fase 1): regras e RPCs do feed
-- =============================================================================
-- Tudo aqui é security definer com search_path '' e passa por _exigir_comunidade():
--   * sessão com clube em uso e vínculo ATIVO nele;
--   * recurso 'comunidade' ligado no clube em uso (desligado = bloqueia TUDO, inclusive ler);
--   * desbravador só entra com AUTORIZAÇÃO registrada pelo responsável vinculado (432);
--   * para publicar/comentar/compartilhar: não pode ser 'pais' (acompanham, não publicam) e não
--     pode estar suspenso.
-- O feed mostra publicações de TODOS os clubes com o recurso ligado (fase 1: o alcance é decidido
-- pela plataforma ao ligar o recurso; alcance nacional/regional é decisão pendente do dono).
-- Perfil público = PRIMEIRO NOME + nome do clube. Nunca sobrenome, idade, escola, cidade ou foto
-- de perfil (a foto de perfil pode ser o rosto da criança).
-- SEM mensagem privada: não existe tabela nem RPC para isso, de propósito.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. Helpers internos
-- -----------------------------------------------------------------------------
create or replace function public._comunidade_papel(p_uid uuid, p_club uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_memberships m
   where m.user_id = p_uid and m.organizational_unit_id = p_club and m.status = 'ativo'
     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
   order by m.starts_at
   limit 1;
$$;
revoke all on function public._comunidade_papel(uuid, uuid) from public, anon, authenticated;

-- A autorização só vale enquanto o vínculo pais↔filho (responsaveis, aprovado, no mesmo clube) existir.
create or replace function public._comunidade_autorizado(p_uid uuid, p_club uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comunidade_autorizacoes a
     where a.club_id = p_club and a.desbravador_id = p_uid and a.autorizado
       and exists (select 1 from public.responsaveis r
                    where r.responsavel_id = a.responsavel_id and r.desbravador_id = p_uid
                      and r.club_id = p_club and r.status = 'aprovado'));
$$;
revoke all on function public._comunidade_autorizado(uuid, uuid) from public, anon, authenticated;

create or replace function public._comunidade_suspenso_ate(p_uid uuid)
returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(s.ate) from public.comunidade_suspensoes s
   where s.usuario_id = p_uid and s.encerrada_em is null and s.ate > now();
$$;
revoke all on function public._comunidade_suspenso_ate(uuid) from public, anon, authenticated;

-- Conta nova = perfil criado há menos de N dias: limites menores ("em observação").
create or replace function public._comunidade_em_observacao(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.created_at from public.profiles p where p.id = p_uid), now())
         > now() - make_interval(days => (public.comunidade_limites() ->> 'dias_observacao')::int);
$$;
revoke all on function public._comunidade_em_observacao(uuid) from public, anon, authenticated;

create or replace function public._comunidade_primeiro_nome(p_nome text)
returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(initcap(split_part(btrim(coalesce(p_nome, '')), ' ', 1)), ''), 'Desbravador(a)');
$$;
revoke all on function public._comunidade_primeiro_nome(text) from public, anon, authenticated;

-- O portão de TODAS as RPCs do feed. Devolve {uid, club, papel}.
create or replace function public._exigir_comunidade(p_para_publicar boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_papel text; v_ate timestamptz;
begin
  if v_uid is null or v_club is null then
    raise exception 'Entre num clube para usar a Comunidade.';
  end if;
  if not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
    raise exception 'A Comunidade não está liberada neste clube.';
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null then
    raise exception 'Sem vínculo ativo neste clube.';
  end if;
  if v_papel = 'desbravador' and not public._comunidade_autorizado(v_uid, v_club) then
    raise exception 'Para usar a Comunidade, peça ao seu responsável para autorizar pelo app 🙂';
  end if;
  if p_para_publicar then
    if v_papel = 'pais' then
      raise exception 'Responsáveis acompanham a Comunidade, mas não publicam nem comentam.';
    end if;
    v_ate := public._comunidade_suspenso_ate(v_uid);
    if v_ate is not null then
      raise exception 'Sua Comunidade está pausada até %. Depois disso você pode publicar de novo 🙂',
        to_char(v_ate at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI');
    end if;
  end if;
  return jsonb_build_object('uid', v_uid, 'club', v_club, 'papel', v_papel);
end;
$$;
revoke all on function public._exigir_comunidade(boolean) from public, anon, authenticated;

-- Limite por minuto/dia (menor para conta nova). Tentativas BLOQUEADAS contam no limite por minuto
-- (ninguém fica martelando a triagem). Devolve a mensagem, ou null se pode.
create or replace function public._comunidade_limite(p_uid uuid, p_tipo text)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare l jsonb := public.comunidade_limites(); v_obs boolean := public._comunidade_em_observacao(p_uid);
        v_n_min bigint; v_n_dia bigint; v_min int; v_dia int;
begin
  if p_tipo = 'post' then
    select count(*) filter (where created_at > now() - interval '1 minute'), count(*) into v_n_min, v_n_dia
      from public.comunidade_posts where autor_id = p_uid and created_at > now() - interval '1 day';
    v_min := (l ->> 'posts_por_minuto')::int;
    v_dia := case when v_obs then (l ->> 'posts_por_dia_observacao')::int else (l ->> 'posts_por_dia')::int end;
  else
    select count(*) filter (where created_at > now() - interval '1 minute'), count(*) into v_n_min, v_n_dia
      from public.comunidade_comentarios where autor_id = p_uid and created_at > now() - interval '1 day';
    v_min := (l ->> 'comentarios_por_minuto')::int;
    v_dia := case when v_obs then (l ->> 'comentarios_por_dia_observacao')::int else (l ->> 'comentarios_por_dia')::int end;
  end if;
  v_n_min := v_n_min + (select count(*) from public.comunidade_bloqueios b
                         where b.autor_id = p_uid and b.created_at > now() - interval '1 minute');
  if v_n_min >= v_min then
    return 'Calma! Espere um minutinho antes de ' || case when p_tipo = 'post' then 'publicar' else 'comentar' end || ' de novo 🙂';
  end if;
  if v_n_dia >= v_dia then
    return case when v_obs then 'Nos primeiros dias a conta tem um limite menor. ' else '' end
           || 'Você chegou ao limite de hoje. Amanhã tem mais 🙂';
  end if;
  return null;
end;
$$;
revoke all on function public._comunidade_limite(uuid, text) from public, anon, authenticated;

-- Aviso pessoal para cada pessoa da DIRETORIA do clube (sino + push pelo gatilho de notificacoes).
-- O texto nunca leva nome de criança nem o conteúdo: sai na tela de bloqueio do celular.
create or replace function public._comunidade_avisar_diretoria(p_club uuid, p_titulo text, p_corpo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_u record;
begin
  for v_u in select distinct m.user_id from public.organization_memberships m
              where m.organizational_unit_id = p_club and m.role = 'diretoria' and m.status = 'ativo'
                and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()) loop
    begin
      insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
      values (left(p_titulo, 120), left(p_corpo, 240), 'comunidade', '/gestao/comunidade', 'todos', v_u.user_id, p_club);
    exception when others then
      raise warning 'aviso da comunidade não enviado: %', sqlerrm;   -- o aviso nunca derruba a ação
    end;
  end loop;
end;
$$;
revoke all on function public._comunidade_avisar_diretoria(uuid, text, text) from public, anon, authenticated;

create or replace function public._comunidade_avisar_pessoa(p_uid uuid, p_club uuid, p_titulo text, p_corpo text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
  values (left(p_titulo, 120), left(p_corpo, 240), 'comunidade', '/comunidade', 'todos', p_uid, p_club);
exception when others then
  raise warning 'aviso da comunidade não enviado: %', sqlerrm;
end;
$$;
revoke all on function public._comunidade_avisar_pessoa(uuid, uuid, text, text) from public, anon, authenticated;

-- Aviso (strike). No 3º dentro da janela (contado desde a última suspensão): suspensão temporária
-- do feed + diretoria avisada. Devolve true se suspendeu agora.
create or replace function public._comunidade_registrar_aviso(p_uid uuid, p_club uuid, p_origem text, p_ref uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare l jsonb := public.comunidade_limites(); v_desde timestamptz; v_n bigint; v_ate timestamptz;
begin
  insert into public.comunidade_avisos (club_id, usuario_id, origem, referencia) values (p_club, p_uid, p_origem, p_ref);
  select max(s.created_at) into v_desde from public.comunidade_suspensoes s where s.usuario_id = p_uid;
  select count(*) into v_n from public.comunidade_avisos a
   where a.usuario_id = p_uid
     and a.created_at > now() - make_interval(days => (l ->> 'janela_avisos_dias')::int)
     and (v_desde is null or a.created_at > v_desde);
  if v_n >= (l ->> 'avisos_para_suspender')::int and public._comunidade_suspenso_ate(p_uid) is null then
    v_ate := now() + make_interval(days => (l ->> 'dias_suspensao')::int);
    insert into public.comunidade_suspensoes (club_id, usuario_id, ate, motivo)
    values (p_club, p_uid, v_ate, 'avisos repetidos (' || v_n || ')');
    insert into public.comunidade_moderacao_log (club_id, alvo_tipo, alvo_id, acao, por, via, motivo)
    values (p_club, 'usuario', p_uid, 'suspenso', null, 'sistema', 'avisos repetidos');
    perform public._comunidade_avisar_diretoria(p_club, '⏸️ Comunidade pausada para um membro',
      'Um membro do clube recebeu ' || v_n || ' avisos na Comunidade e ficou pausado por '
      || (l ->> 'dias_suspensao') || ' dias. Veja em Gestão → Comunidade.');
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public._comunidade_registrar_aviso(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Registra a tentativa bloqueada (com dígitos mascarados) e o aviso. Devolve a resposta da RPC.
create or replace function public._comunidade_bloquear(p_uid uuid, p_club uuid, p_alvo text, p_triagem jsonb, p_texto text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_susp boolean;
begin
  insert into public.comunidade_bloqueios (club_id, autor_id, alvo, motivo, regra, trecho)
  values (p_club, p_uid, p_alvo, p_triagem ->> 'motivo', p_triagem ->> 'regra',
          left(regexp_replace(coalesce(p_texto, ''), '[0-9]', '#', 'g'), 280));
  v_susp := public._comunidade_registrar_aviso(p_uid, p_club, 'texto_bloqueado', null);
  return jsonb_build_object('ok', false, 'motivo', p_triagem ->> 'motivo',
    'mensagem', public._comunidade_msg_bloqueio(p_triagem ->> 'motivo', p_alvo)
                || case when v_susp then ' Você recebeu avisos demais e sua Comunidade ficou pausada por alguns dias.' else '' end,
    'suspenso', v_susp);
end;
$$;
revoke all on function public._comunidade_bloquear(uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- Texto puro: sem caracteres de controle (mantém \n), aparado.
create or replace function public._comunidade_limpar(p_texto text)
returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(p_texto, ''), '[\x01-\x09\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), '');
$$;
revoke all on function public._comunidade_limpar(text) from public, anon, authenticated;

-- Um post é visível para p_uid? (publicado num clube com o recurso ligado; ou é do próprio autor)
create or replace function public._comunidade_post_visivel(p_post uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comunidade_posts p
     where p.id = p_post
       and ((p.status = 'publicado' and public.recurso_habilitado_no_clube(p.club_id, 'comunidade'))
            or (p.autor_id = p_uid and p.status = 'em_analise')));
$$;
revoke all on function public._comunidade_post_visivel(uuid, uuid) from public, anon, authenticated;

create or replace function public._comunidade_autor_json(p_autor uuid, p_club uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'nome', public._comunidade_primeiro_nome((select p.nome from public.profiles p where p.id = p_autor)),
    'clube', (select u.nome from public.organizational_units u where u.id = p_club));
$$;
revoke all on function public._comunidade_autor_json(uuid, uuid) from public, anon, authenticated;

create or replace function public._comunidade_post_json(p_post uuid, p_uid uuid, p_nivel int default 0)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.comunidade_posts; v_repost jsonb;
begin
  select * into p from public.comunidade_posts where id = p_post;
  if not found then return null; end if;
  if p.repost_de is not null and p_nivel = 0 then
    v_repost := case when public._comunidade_post_visivel(p.repost_de, p_uid)
                     then public._comunidade_post_json(p.repost_de, p_uid, 1)
                     else jsonb_build_object('indisponivel', true) end;
  end if;
  return jsonb_build_object(
    'id', p.id,
    'legenda', p.legenda,
    'foto', p.foto_path,
    'status', case when p.autor_id = p_uid then p.status end,
    'autor', public._comunidade_autor_json(p.autor_id, p.club_id),
    'clube_id', p.club_id,
    'crianca', p.autor_papel = 'desbravador',
    'meu', p.autor_id = p_uid,
    'criado_em', p.created_at,
    'curtidas', (select count(*) from public.comunidade_curtidas c where c.post_id = p.id),
    'comentarios', (select count(*) from public.comunidade_comentarios k where k.post_id = p.id and k.status = 'publicado'),
    'eu_curti', exists (select 1 from public.comunidade_curtidas c where c.post_id = p.id and c.usuario_id = p_uid),
    'repost', v_repost);
end;
$$;
revoke all on function public._comunidade_post_json(uuid, uuid, int) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  2. Situação da pessoa (a tela decide o que mostrar; o servidor decide o que vale)
-- -----------------------------------------------------------------------------
-- Não levanta erro: devolve o porquê. Assim a tela explica ("peça autorização", "recurso desligado").
create or replace function public.comunidade_meu_status()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_papel text; v_aut boolean; v_ate timestamptz;
begin
  if v_uid is null or v_club is null then
    return jsonb_build_object('pode_ver', false, 'motivo', 'sem_clube');
  end if;
  if not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
    return jsonb_build_object('pode_ver', false, 'motivo', 'recurso_desligado');
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null then
    return jsonb_build_object('pode_ver', false, 'motivo', 'sem_vinculo');
  end if;
  v_aut := v_papel <> 'desbravador' or public._comunidade_autorizado(v_uid, v_club);
  v_ate := public._comunidade_suspenso_ate(v_uid);
  return jsonb_build_object(
    'pode_ver', v_aut,
    'motivo', case when not v_aut then 'sem_autorizacao' end,
    'papel', v_papel,
    'pode_publicar', v_aut and v_papel <> 'pais' and v_ate is null,
    'suspenso_ate', v_ate,
    'em_observacao', public._comunidade_em_observacao(v_uid),
    'limites', public.comunidade_limites());
end;
$$;
revoke all on function public.comunidade_meu_status() from public, anon;
grant execute on function public.comunidade_meu_status() to authenticated;


-- -----------------------------------------------------------------------------
--  3. Publicar (texto, foto opcional) e compartilhar DENTRO do app (repost)
-- -----------------------------------------------------------------------------
-- Texto sem foto: triagem -> publicado. Com foto: triagem da legenda -> 'em_analise' até a
-- diretoria do clube do autor aprovar (ainda não há IA de imagem; quando houver, a IA decide a
-- foto e só o duvidoso cai na fila — ver COMUNIDADE-FASE1.md).
-- Compartilhar = repost apontando para o ORIGINAL (nunca download/link externo).
create or replace function public.comunidade_publicar(p_legenda text, p_foto_path text default null, p_repost_de uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid; v_papel text;
        v_leg text := public._comunidade_limpar(p_legenda); v_tri jsonb; v_lim text; v_orig record;
        v_repost uuid := p_repost_de; v_status text; v_id uuid;
begin
  v_club := (c ->> 'club')::uuid; v_papel := c ->> 'papel';
  if length(v_leg) > 500 then raise exception 'A legenda pode ter até 500 caracteres.'; end if;
  if v_repost is not null and p_foto_path is not null then raise exception 'Ao compartilhar não dá para trocar a foto.'; end if;
  if v_leg is null and p_foto_path is null and v_repost is null then raise exception 'Escreva algo ou escolha uma foto.'; end if;

  v_lim := public._comunidade_limite(v_uid, 'post');
  if v_lim is not null then
    return jsonb_build_object('ok', false, 'motivo', 'limite', 'mensagem', v_lim);
  end if;

  if v_repost is not null then
    select id, repost_de into v_orig from public.comunidade_posts where id = v_repost;
    if found and v_orig.repost_de is not null then v_repost := v_orig.repost_de; end if;   -- sempre o original
    if not found or not exists (select 1 from public.comunidade_posts p where p.id = v_repost and p.status = 'publicado'
                                 and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')) then
      raise exception 'Esta publicação não está disponível.';
    end if;
  end if;

  if p_foto_path is not null then
    if p_foto_path !~ ('^' || v_club::text || '/' || v_uid::text || '/[0-9a-f-]{36}\.jpg$') then
      raise exception 'Foto inválida.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'comunidade' and o.name = p_foto_path) then
      raise exception 'A foto não chegou. Tente enviar de novo.';
    end if;
    if exists (select 1 from public.comunidade_posts where foto_path = p_foto_path) then
      raise exception 'Essa foto já foi usada.';
    end if;
  end if;

  if v_leg is not null then
    v_tri := public._comunidade_triar(v_leg);
    if not (v_tri ->> 'ok')::boolean then
      return public._comunidade_bloquear(v_uid, v_club, 'post', v_tri, v_leg);
    end if;
  end if;

  v_status := case when p_foto_path is not null then 'em_analise' else 'publicado' end;
  insert into public.comunidade_posts (club_id, autor_id, autor_papel, legenda, foto_path, repost_de, status, publicado_em)
  values (v_club, v_uid, v_papel, v_leg, p_foto_path, v_repost, v_status, case when v_status = 'publicado' then now() end)
  returning id into v_id;

  if v_status = 'em_analise' then
    perform public._comunidade_avisar_diretoria(v_club, '📷 Foto aguardando aprovação',
      'Uma foto de um membro do clube está esperando a sua aprovação para aparecer na Comunidade.');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status,
    'mensagem', case when v_status = 'em_analise'
                     then 'Foto enviada! Ela aparece na Comunidade assim que a diretoria do seu clube aprovar 🙂'
                     when v_repost is not null then 'Compartilhado na Comunidade! 🔁'
                     else 'Publicado! 🎉' end,
    'post', public._comunidade_post_json(v_id, v_uid, 0));
end;
$$;
revoke all on function public.comunidade_publicar(text, text, uuid) from public, anon;
grant execute on function public.comunidade_publicar(text, text, uuid) to authenticated;


-- -----------------------------------------------------------------------------
--  4. Feed paginado (keyset, 10 por página: leve no 4G fraco)
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_feed(p_antes timestamptz default null, p_antes_id uuid default null, p_limite int default 10)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_lim int := least(greatest(coalesce(p_limite, 10), 1), 20); v_itens jsonb; v_n int; v_antes timestamptz; v_antes_id uuid;
begin
  with pagina as (
    select p.id, p.created_at from public.comunidade_posts p
     where ((p.status = 'publicado' and public.recurso_habilitado_no_clube(p.club_id, 'comunidade'))
            or (p.autor_id = v_uid and p.status = 'em_analise'))
       and (p_antes is null
            or (p.created_at, p.id) < (p_antes, coalesce(p_antes_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     order by p.created_at desc, p.id desc
     limit v_lim)
  select coalesce(jsonb_agg(public._comunidade_post_json(x.id, v_uid, 0) order by x.created_at desc, x.id desc), '[]'::jsonb),
         count(*)
    into v_itens, v_n
    from pagina x;
  if v_n = v_lim then
    select (e ->> 'criado_em')::timestamptz, (e ->> 'id')::uuid into v_antes, v_antes_id
      from jsonb_array_elements(v_itens) with ordinality as a(e, i) order by i desc limit 1;
  end if;
  return jsonb_build_object('itens', v_itens,
    'proximo', case when v_n = v_lim then jsonb_build_object('antes', v_antes, 'antes_id', v_antes_id) end);
end;
$$;
revoke all on function public.comunidade_feed(timestamptz, uuid, int) from public, anon;
grant execute on function public.comunidade_feed(timestamptz, uuid, int) to authenticated;

-- Uma publicação (link INTERNO /comunidade/p/:id)
create or replace function public.comunidade_post(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if not public._comunidade_post_visivel(p_id, v_uid) then
    raise exception 'Esta publicação não está disponível.';
  end if;
  return public._comunidade_post_json(p_id, v_uid, 0);
end;
$$;
revoke all on function public.comunidade_post(uuid) from public, anon;
grant execute on function public.comunidade_post(uuid) to authenticated;


-- -----------------------------------------------------------------------------
--  5. Curtir
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_curtir(p_post uuid, p_curtir boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado'
                  and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')) then
    raise exception 'Esta publicação não está disponível.';
  end if;
  if coalesce(p_curtir, true) then
    insert into public.comunidade_curtidas (post_id, usuario_id, club_id) values (p_post, v_uid, (c ->> 'club')::uuid)
    on conflict (post_id, usuario_id) do nothing;
  else
    delete from public.comunidade_curtidas where post_id = p_post and usuario_id = v_uid;
  end if;
  return jsonb_build_object('curtidas', (select count(*) from public.comunidade_curtidas where post_id = p_post),
                            'eu_curti', coalesce(p_curtir, true));
end;
$$;
revoke all on function public.comunidade_curtir(uuid, boolean) from public, anon;
grant execute on function public.comunidade_curtir(uuid, boolean) to authenticated;


-- -----------------------------------------------------------------------------
--  6. Comentar e listar comentários
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_comentar(p_post uuid, p_texto text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid; v_papel text;
        v_txt text := public._comunidade_limpar(p_texto); v_post record; v_tri jsonb; v_lim text; v_id uuid;
begin
  v_club := (c ->> 'club')::uuid; v_papel := c ->> 'papel';
  if v_txt is null then raise exception 'Escreva o comentário.'; end if;
  if length(v_txt) > 300 then raise exception 'O comentário pode ter até 300 caracteres.'; end if;
  select * into v_post from public.comunidade_posts where id = p_post;
  if not found or v_post.status <> 'publicado' or not public.recurso_habilitado_no_clube(v_post.club_id, 'comunidade') then
    raise exception 'Esta publicação não está disponível.';
  end if;
  -- adulto de OUTRO clube não comenta em publicação de criança
  if v_post.autor_papel = 'desbravador' and v_papel <> 'desbravador' and v_post.club_id <> v_club then
    raise exception 'Adultos de outro clube não comentam em publicações de desbravadores. Você pode curtir 🙂';
  end if;
  v_lim := public._comunidade_limite(v_uid, 'comentario');
  if v_lim is not null then
    return jsonb_build_object('ok', false, 'motivo', 'limite', 'mensagem', v_lim);
  end if;
  v_tri := public._comunidade_triar(v_txt);
  if not (v_tri ->> 'ok')::boolean then
    return public._comunidade_bloquear(v_uid, v_club, 'comentario', v_tri, v_txt);
  end if;
  insert into public.comunidade_comentarios (post_id, club_id, autor_id, autor_papel, texto)
  values (p_post, v_club, v_uid, v_papel, v_txt) returning id into v_id;
  return jsonb_build_object('ok', true, 'comentario', jsonb_build_object(
    'id', v_id, 'texto', v_txt, 'autor', public._comunidade_autor_json(v_uid, v_club), 'meu', true, 'criado_em', now()));
end;
$$;
revoke all on function public.comunidade_comentar(uuid, text) from public, anon;
grant execute on function public.comunidade_comentar(uuid, text) to authenticated;

create or replace function public.comunidade_comentarios(p_post uuid, p_antes timestamptz default null, p_limite int default 20)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_lim int := least(greatest(coalesce(p_limite, 20), 1), 50); v_itens jsonb; v_n int;
begin
  if not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado'
                  and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')) then
    raise exception 'Esta publicação não está disponível.';
  end if;
  with pagina as (
    select k.* from public.comunidade_comentarios k
     where k.post_id = p_post and k.status = 'publicado' and (p_antes is null or k.created_at < p_antes)
     order by k.created_at desc, k.id desc limit v_lim)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'texto', x.texto, 'autor', public._comunidade_autor_json(x.autor_id, x.club_id),
                                               'meu', x.autor_id = v_uid, 'criado_em', x.created_at)
                            order by x.created_at desc, x.id desc), '[]'::jsonb), count(*)
    into v_itens, v_n from pagina x;
  return jsonb_build_object('itens', v_itens,
    'proximo', case when v_n = v_lim then (select min((e ->> 'criado_em')::timestamptz) from jsonb_array_elements(v_itens) e) end);
end;
$$;
revoke all on function public.comunidade_comentarios(uuid, timestamptz, int) from public, anon;
grant execute on function public.comunidade_comentarios(uuid, timestamptz, int) to authenticated;


-- -----------------------------------------------------------------------------
--  7. Apagar o que é meu
-- -----------------------------------------------------------------------------
-- Conteúdo que está em revisão (oculto por denúncia) não se apaga: a diretoria decide.
create or replace function public.comunidade_apagar(p_tipo text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n int; v_foto text;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  if p_tipo = 'post' then
    update public.comunidade_posts set status = 'apagado'
     where id = p_id and autor_id = v_uid and status in ('publicado', 'em_analise')
    returning foto_path into v_foto;
  elsif p_tipo = 'comentario' then
    update public.comunidade_comentarios set status = 'apagado'
     where id = p_id and autor_id = v_uid and status = 'publicado';
  else
    raise exception 'Tipo inválido.';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Não foi possível apagar (não é seu ou está em revisão).'; end if;
  return jsonb_build_object('ok', true, 'foto', v_foto);   -- o app apaga o arquivo do Storage
end;
$$;
revoke all on function public.comunidade_apagar(text, uuid) from public, anon;
grant execute on function public.comunidade_apagar(text, uuid) to authenticated;


-- -----------------------------------------------------------------------------
--  8. Denunciar
-- -----------------------------------------------------------------------------
-- Some NA HORA para todos (status 'oculto_denuncia') e a diretoria do clube de quem publicou é
-- avisada. Exceção: quem denuncia demais sem procedência (N improcedentes na janela) perde o poder
-- de esconder na hora — a denúncia ainda entra na fila, mas o conteúdo fica até a diretoria olhar.
create or replace function public._comunidade_denunciante_confiavel(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.comunidade_denuncias d
           where d.denunciante_id = p_uid and d.resultado = 'improcedente'
             and d.created_at > now() - make_interval(days => (public.comunidade_limites() ->> 'janela_denuncias_dias')::int))
         < (public.comunidade_limites() ->> 'denuncias_improcedentes_para_perder')::int;
$$;
revoke all on function public._comunidade_denunciante_confiavel(uuid) from public, anon, authenticated;

create or replace function public.comunidade_denunciar(p_tipo text, p_id uuid, p_motivo text default 'outro')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_club uuid; v_status text; v_autor uuid; v_post uuid; v_conf boolean; v_primeira boolean; v_ocultar boolean;
begin
  if coalesce(p_motivo, '') not in ('ofensivo', 'perigoso', 'contato', 'imagem', 'outro') then
    raise exception 'Motivo inválido.';
  end if;
  if (select count(*) from public.comunidade_denuncias where denunciante_id = v_uid and created_at > now() - interval '1 day')
     >= (public.comunidade_limites() ->> 'denuncias_por_dia')::int then
    return jsonb_build_object('ok', false, 'mensagem', 'Você já fez muitas denúncias hoje. Se for urgente, fale com a diretoria do seu clube.');
  end if;
  if p_tipo = 'post' then
    select club_id, status, autor_id into v_club, v_status, v_autor from public.comunidade_posts where id = p_id for update;
  elsif p_tipo = 'comentario' then
    select k.club_id, k.status, k.autor_id, k.post_id into v_club, v_status, v_autor, v_post
      from public.comunidade_comentarios k where k.id = p_id for update;
    if found and not exists (select 1 from public.comunidade_posts p where p.id = v_post and p.status in ('publicado', 'oculto_denuncia')) then
      v_status := null;
    end if;
  else
    raise exception 'Tipo inválido.';
  end if;
  if v_club is null or coalesce(v_status, '') not in ('publicado', 'oculto_denuncia')
     or not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
    raise exception 'Este conteúdo não está disponível.';
  end if;
  if v_autor = v_uid then raise exception 'Você não pode denunciar o que você mesmo publicou.'; end if;
  if exists (select 1 from public.comunidade_denuncias where alvo_tipo = p_tipo and alvo_id = p_id and denunciante_id = v_uid) then
    return jsonb_build_object('ok', true, 'ocultou', false, 'mensagem', 'Você já denunciou isto. Obrigado por cuidar da Comunidade!');
  end if;

  v_conf := public._comunidade_denunciante_confiavel(v_uid);
  v_primeira := not exists (select 1 from public.comunidade_denuncias where alvo_tipo = p_tipo and alvo_id = p_id and resultado = 'pendente');
  v_ocultar := v_conf and v_status = 'publicado';
  insert into public.comunidade_denuncias (club_id, alvo_tipo, alvo_id, denunciante_id, denunciante_club_id, motivo, ocultou)
  values (v_club, p_tipo, p_id, v_uid, (c ->> 'club')::uuid, p_motivo, v_ocultar);
  if v_ocultar then
    if p_tipo = 'post' then
      update public.comunidade_posts set status = 'oculto_denuncia' where id = p_id;
    else
      update public.comunidade_comentarios set status = 'oculto_denuncia' where id = p_id;
    end if;
    insert into public.comunidade_moderacao_log (club_id, alvo_tipo, alvo_id, acao, por, via, motivo)
    values (v_club, p_tipo, p_id, 'ocultado_por_denuncia', null, 'sistema', p_motivo);
  end if;
  if v_primeira then
    perform public._comunidade_avisar_diretoria(v_club, '🚩 Conteúdo denunciado na Comunidade',
      'Um conteúdo de um membro do clube foi denunciado' || case when v_ocultar then ' e está escondido' else '' end
      || ' até a sua revisão. Veja em Gestão → Comunidade.');
  end if;
  return jsonb_build_object('ok', true, 'ocultou', v_ocultar,
    'mensagem', case when v_ocultar then 'Obrigado! O conteúdo foi escondido e a diretoria do clube vai revisar.'
                     else 'Obrigado! A diretoria do clube vai revisar.' end);
end;
$$;
revoke all on function public.comunidade_denunciar(text, uuid, text) from public, anon;
grant execute on function public.comunidade_denunciar(text, uuid, text) to authenticated;

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000431', 'comunidade-feed-e-regras') on conflict do nothing;

-- ======================= 20260930000432_comunidade-moderacao-pais-storage =======================
-- =============================================================================
-- 432 — COMUNIDADE (fase 1): moderação da diretoria, autorização dos pais, Storage e painel da plataforma
-- =============================================================================
--   * Fila da DIRETORIA (pode_administrar_clube, clube em uso): fotos em análise e conteúdo
--     denunciado do SEU clube (quem publicou é do clube). Ações: aprovar/recusar foto, restaurar,
--     remover de vez. Tudo auditado em comunidade_moderacao_log (quem, quando, por qual via).
--     Quem denunciou NUNCA aparece para a diretoria.
--   * Remover conteúdo = aviso (strike) ao autor; 3 avisos = suspensão temporária + diretoria avisada.
--   * Restaurar = as denúncias viram improcedentes (é o que alimenta a regra da denúncia abusiva).
--   * Responsável vinculado (responsaveis, aprovado, no clube em uso) autoriza ou revoga. Revogar
--     retira na hora as publicações e comentários do filho naquele clube.
--   * Storage: bucket PRIVADO 'comunidade', só JPEG (o app recomprime em canvas, o que descarta
--     EXIF/GPS), 3 MB. Leitura só de quem pode ver o post (ou o autor, a diretoria dele e a plataforma).
--   * Admin da plataforma: painel com números, bloqueios recentes e auditoria; fila de todos os
--     clubes; edição da lista de termos. Tudo com _admin_auditar.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. O núcleo da moderação (diretoria ou plataforma)
-- -----------------------------------------------------------------------------
create or replace function public._comunidade_aplicar_moderacao(p_tipo text, p_id uuid, p_acao text, p_motivo text,
                                                               p_via text, p_club_exigido uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_status text; v_autor uuid; v_pend boolean; v_novo text; v_res text;
begin
  if p_tipo = 'post' then
    select club_id, status, autor_id into v_club, v_status, v_autor from public.comunidade_posts where id = p_id for update;
  elsif p_tipo = 'comentario' then
    select club_id, status, autor_id into v_club, v_status, v_autor from public.comunidade_comentarios where id = p_id for update;
  else
    raise exception 'Tipo inválido.';
  end if;
  if v_club is null or (p_club_exigido is not null and v_club <> p_club_exigido) then
    raise exception 'Conteúdo não encontrado.';
  end if;
  v_pend := exists (select 1 from public.comunidade_denuncias d where d.alvo_tipo = p_tipo and d.alvo_id = p_id and d.resultado = 'pendente');

  if p_acao in ('aprovar_foto', 'recusar_foto') then
    if p_tipo <> 'post' or v_status <> 'em_analise' then raise exception 'Só fotos em análise podem ser aprovadas ou recusadas.'; end if;
    v_novo := case p_acao when 'aprovar_foto' then 'publicado' else 'recusado' end;
  elsif p_acao = 'restaurar' then
    if not (v_status = 'oculto_denuncia' or (v_status = 'publicado' and v_pend)) then raise exception 'Não há nada para restaurar.'; end if;
    v_novo := 'publicado'; v_res := 'improcedente';
  elsif p_acao = 'remover' then
    if v_status not in ('publicado', 'oculto_denuncia', 'em_analise') then raise exception 'Este conteúdo já saiu da Comunidade.'; end if;
    v_novo := 'removido'; v_res := 'procedente';
  else
    raise exception 'Ação inválida.';
  end if;

  if p_tipo = 'post' then
    update public.comunidade_posts
       set status = v_novo, moderado_por = auth.uid(), moderado_em = now(),
           publicado_em = case when v_novo = 'publicado' then coalesce(publicado_em, now()) else publicado_em end
     where id = p_id;
  else
    update public.comunidade_comentarios set status = v_novo, moderado_por = auth.uid(), moderado_em = now() where id = p_id;
  end if;
  if v_res is not null then
    update public.comunidade_denuncias set resultado = v_res, resolvido_em = now()
     where alvo_tipo = p_tipo and alvo_id = p_id and resultado = 'pendente';
  end if;
  insert into public.comunidade_moderacao_log (club_id, alvo_tipo, alvo_id, acao, por, via, motivo)
  values (v_club, p_tipo, p_id, p_acao, auth.uid(), p_via, left(public._comunidade_limpar(p_motivo), 300));

  if p_acao = 'remover' then
    perform public._comunidade_registrar_aviso(v_autor, v_club, 'conteudo_removido', p_id);
    perform public._comunidade_avisar_pessoa(v_autor, v_club, 'Um conteúdo seu saiu da Comunidade',
      'A diretoria revisou e removeu um conteúdo seu. Lembre: respeito e segurança em primeiro lugar 🙂');
  elsif p_acao = 'aprovar_foto' then
    perform public._comunidade_avisar_pessoa(v_autor, v_club, '📷 Sua foto foi aprovada!', 'Ela já aparece na Comunidade.');
  elsif p_acao = 'recusar_foto' then
    perform public._comunidade_avisar_pessoa(v_autor, v_club, 'Sua foto não foi aprovada',
      'A diretoria do seu clube não aprovou a foto. Você pode tentar outra 🙂');
  end if;
  return jsonb_build_object('ok', true, 'status', v_novo);
end;
$$;
revoke all on function public._comunidade_aplicar_moderacao(text, uuid, text, text, text, uuid) from public, anon, authenticated;

-- Diretoria do clube em uso
create or replace function public.comunidade_moderar(p_tipo text, p_id uuid, p_acao text, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null or v_club is null or not public.pode_administrar_clube(v_club) then
    raise exception 'Sem permissão (apenas a diretoria do clube).';
  end if;
  return public._comunidade_aplicar_moderacao(p_tipo, p_id, p_acao, p_motivo, 'diretoria', v_club);
end;
$$;
revoke all on function public.comunidade_moderar(text, uuid, text, text) from public, anon;
grant execute on function public.comunidade_moderar(text, uuid, text, text) to authenticated;

-- JSON de um item da fila (a diretoria vê o NOME COMPLETO do próprio membro; nunca quem denunciou)
create or replace function public._comunidade_item_fila(p_tipo text, p_id uuid, p_com_clube boolean)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_tipo = 'post' then
    select jsonb_build_object('tipo', 'post', 'id', p.id, 'texto', p.legenda, 'foto', p.foto_path, 'status', p.status,
                              'autor', case when p_com_clube then public._comunidade_primeiro_nome(pr.nome) else pr.nome end,
                              'clube', case when p_com_clube then u.nome end, 'criado_em', p.created_at,
                              'repost', p.repost_de is not null)
      into v from public.comunidade_posts p join public.profiles pr on pr.id = p.autor_id
      join public.organizational_units u on u.id = p.club_id where p.id = p_id;
  else
    select jsonb_build_object('tipo', 'comentario', 'id', k.id, 'texto', k.texto, 'foto', null, 'status', k.status,
                              'autor', case when p_com_clube then public._comunidade_primeiro_nome(pr.nome) else pr.nome end,
                              'clube', case when p_com_clube then u.nome end, 'criado_em', k.created_at, 'post_id', k.post_id)
      into v from public.comunidade_comentarios k join public.profiles pr on pr.id = k.autor_id
      join public.organizational_units u on u.id = k.club_id where k.id = p_id;
  end if;
  return v;
end;
$$;
revoke all on function public._comunidade_item_fila(text, uuid, boolean) from public, anon, authenticated;

create or replace function public._comunidade_fila(p_club uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'fotos', (select coalesce(jsonb_agg(public._comunidade_item_fila('post', p.id, p_club is null) order by p.created_at), '[]'::jsonb)
                from public.comunidade_posts p where p.status = 'em_analise' and (p_club is null or p.club_id = p_club)),
    'denuncias', (select coalesce(jsonb_agg(public._comunidade_item_fila(d.alvo_tipo, d.alvo_id, p_club is null)
                                            || jsonb_build_object('denuncias', d.n, 'motivos', d.motivos) order by d.primeira), '[]'::jsonb)
                    from (select alvo_tipo, alvo_id, count(*) as n, jsonb_agg(distinct motivo) as motivos, min(created_at) as primeira
                            from public.comunidade_denuncias
                           where resultado = 'pendente' and (p_club is null or club_id = p_club)
                           group by alvo_tipo, alvo_id) d),
    'suspensos', (select coalesce(jsonb_agg(jsonb_build_object('usuario_id', s.usuario_id,
                                    'nome', case when p_club is null then public._comunidade_primeiro_nome(pr.nome) else pr.nome end,
                                    'ate', s.ate) order by s.ate), '[]'::jsonb)
                    from public.comunidade_suspensoes s join public.profiles pr on pr.id = s.usuario_id
                   where s.encerrada_em is null and s.ate > now() and (p_club is null or s.club_id = p_club)),
    'historico', (select coalesce(jsonb_agg(h.j order by h.created_at desc), '[]'::jsonb) from (
                    select l.created_at, jsonb_build_object('acao', l.acao, 'alvo_tipo', l.alvo_tipo, 'via', l.via, 'motivo', l.motivo,
                             'por', coalesce(public._comunidade_primeiro_nome(pr.nome), 'Sistema'), 'quando', l.created_at) as j
                      from public.comunidade_moderacao_log l left join public.profiles pr on pr.id = l.por
                     where p_club is null or l.club_id = p_club
                     order by l.created_at desc limit 30) h)
  );
$$;
revoke all on function public._comunidade_fila(uuid) from public, anon, authenticated;

create or replace function public.comunidade_fila_moderacao()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null or v_club is null or not public.pode_administrar_clube(v_club) then
    raise exception 'Sem permissão (apenas a diretoria do clube).';
  end if;
  return public._comunidade_fila(v_club);
end;
$$;
revoke all on function public.comunidade_fila_moderacao() from public, anon;
grant execute on function public.comunidade_fila_moderacao() to authenticated;

-- A diretoria pode encerrar uma suspensão antes do prazo (conversou com a criança, por exemplo)
create or replace function public.comunidade_encerrar_suspensao(p_usuario uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_n int;
begin
  if auth.uid() is null or v_club is null or not public.pode_administrar_clube(v_club) then
    raise exception 'Sem permissão (apenas a diretoria do clube).';
  end if;
  update public.comunidade_suspensoes set encerrada_em = now(), encerrada_por = auth.uid()
   where usuario_id = p_usuario and club_id = v_club and encerrada_em is null and ate > now();
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Não há suspensão ativa deste membro no clube.'; end if;
  insert into public.comunidade_moderacao_log (club_id, alvo_tipo, alvo_id, acao, por, via)
  values (v_club, 'usuario', p_usuario, 'suspensao_encerrada', auth.uid(), 'diretoria');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.comunidade_encerrar_suspensao(uuid) from public, anon;
grant execute on function public.comunidade_encerrar_suspensao(uuid) to authenticated;


-- -----------------------------------------------------------------------------
--  2. Autorização dos pais
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_autorizacoes_dos_filhos()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null then return jsonb_build_object('recurso_ligado', false, 'filhos', '[]'::jsonb); end if;
  return jsonb_build_object(
    'recurso_ligado', public.recurso_habilitado_no_clube(v_club, 'comunidade'),
    'filhos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'desbravador_id', r.desbravador_id, 'nome', p.nome,
                  'autorizado', public._comunidade_autorizado(r.desbravador_id, v_club),
                  'atualizado_em', a.atualizado_em) order by p.nome), '[]'::jsonb)
                 from (select distinct desbravador_id from public.responsaveis
                        where responsavel_id = v_uid and club_id = v_club and status = 'aprovado') r
                 join public.profiles p on p.id = r.desbravador_id
                 left join public.comunidade_autorizacoes a on a.club_id = v_club and a.desbravador_id = r.desbravador_id));
end;
$$;
revoke all on function public.comunidade_autorizacoes_dos_filhos() from public, anon;
grant execute on function public.comunidade_autorizacoes_dos_filhos() to authenticated;

create or replace function public.comunidade_autorizar(p_desbravador uuid, p_autorizar boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_ret int := 0; v_n int;
begin
  if v_uid is null or v_club is null then raise exception 'Entre no clube para autorizar.'; end if;
  if p_autorizar is null then raise exception 'Informe se autoriza ou não.'; end if;
  if not exists (select 1 from public.responsaveis r where r.responsavel_id = v_uid and r.desbravador_id = p_desbravador
                  and r.club_id = v_club and r.status = 'aprovado') then
    raise exception 'Só o responsável vinculado (aprovado pela diretoria) pode autorizar.';
  end if;
  if p_autorizar and not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
    raise exception 'A Comunidade não está liberada neste clube.';
  end if;
  insert into public.comunidade_autorizacoes (club_id, desbravador_id, responsavel_id, autorizado, atualizado_em)
  values (v_club, p_desbravador, v_uid, p_autorizar, now())
  on conflict (club_id, desbravador_id) do update
    set autorizado = excluded.autorizado, responsavel_id = excluded.responsavel_id, atualizado_em = now();
  if not p_autorizar then
    -- revogou: o que o filho publicou/comentou neste clube sai da Comunidade na hora
    -- (o que está em revisão por denúncia fica para a diretoria decidir)
    update public.comunidade_posts set status = 'retirado'
     where autor_id = p_desbravador and club_id = v_club and status in ('publicado', 'em_analise');
    get diagnostics v_n = row_count; v_ret := v_ret + v_n;
    update public.comunidade_comentarios set status = 'retirado'
     where autor_id = p_desbravador and club_id = v_club and status = 'publicado';
    get diagnostics v_n = row_count; v_ret := v_ret + v_n;
  end if;
  insert into public.comunidade_moderacao_log (club_id, alvo_tipo, alvo_id, acao, por, via)
  values (v_club, 'usuario', p_desbravador, case when p_autorizar then 'autorizacao_concedida' else 'autorizacao_revogada' end, v_uid, 'responsavel');
  perform public._auditar('comunidade_autorizacao', v_club, p_desbravador, jsonb_build_object('autorizado', p_autorizar));
  return jsonb_build_object('ok', true, 'autorizado', p_autorizar, 'retirados', v_ret);
end;
$$;
revoke all on function public.comunidade_autorizar(uuid, boolean) from public, anon;
grant execute on function public.comunidade_autorizar(uuid, boolean) to authenticated;


-- -----------------------------------------------------------------------------
--  3. Storage: bucket privado 'comunidade'
-- -----------------------------------------------------------------------------
-- Só JPEG: o app SEMPRE recomprime a foto em canvas (lib/imagem.js limparFotoParaComunidade), e
-- redesenhar em canvas descarta EXIF/GPS. Um cliente adulterado poderia mandar um JPEG com EXIF —
-- por isso toda foto passa pela diretoria antes de aparecer; com a IA de imagem, a recompressão
-- passa a ser feita também no servidor (pendência documentada).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comunidade', 'comunidade', false, 3145728, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public._comunidade_pode_enviar_foto(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_papel text;
begin
  if v_uid is null or v_club is null then return false; end if;
  if coalesce(p_name, '') !~ ('^' || v_club::text || '/' || v_uid::text || '/[0-9a-f-]{36}\.jpg$') then return false; end if;
  if not public.recurso_habilitado_no_clube(v_club, 'comunidade') then return false; end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null or v_papel = 'pais' then return false; end if;
  if v_papel = 'desbravador' and not public._comunidade_autorizado(v_uid, v_club) then return false; end if;
  return public._comunidade_suspenso_ate(v_uid) is null;
end;
$$;
revoke all on function public._comunidade_pode_enviar_foto(text) from public, anon;
grant execute on function public._comunidade_pode_enviar_foto(text) to authenticated;

create or replace function public._comunidade_pode_ver_foto(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); p record; v_papel text;
begin
  if v_uid is null then return false; end if;
  select * into p from public.comunidade_posts where foto_path = p_name;
  if not found then
    -- recém-enviada, ainda sem post: só o próprio autor (pasta <club>/<uid>/)
    return split_part(coalesce(p_name, ''), '/', 2) = v_uid::text;
  end if;
  if p.autor_id = v_uid or public.eh_admin_plataforma(v_uid) then return true; end if;
  if v_club is null then return false; end if;
  if p.club_id = v_club and public.pode_administrar_clube(v_club) then return true; end if;
  if p.status <> 'publicado' or not public.recurso_habilitado_no_clube(p.club_id, 'comunidade')
     or not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
    return false;
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  return v_papel is not null and (v_papel <> 'desbravador' or public._comunidade_autorizado(v_uid, v_club));
end;
$$;
revoke all on function public._comunidade_pode_ver_foto(text) from public, anon;
grant execute on function public._comunidade_pode_ver_foto(text) to authenticated;

-- o autor apaga o arquivo que não está (mais) no ar: envio que falhou, post apagado/recusado
create or replace function public._comunidade_pode_apagar_foto(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and split_part(coalesce(p_name, ''), '/', 2) = auth.uid()::text
     and not exists (select 1 from public.comunidade_posts p
                      where p.foto_path = p_name and p.status in ('publicado', 'em_analise', 'oculto_denuncia'));
$$;
revoke all on function public._comunidade_pode_apagar_foto(text) from public, anon;
grant execute on function public._comunidade_pode_apagar_foto(text) to authenticated;

drop policy if exists "comunidade: autor envia" on storage.objects;
create policy "comunidade: autor envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'comunidade' and public._comunidade_pode_enviar_foto(name));
drop policy if exists "comunidade: quem pode ver le" on storage.objects;
create policy "comunidade: quem pode ver le" on storage.objects for select to authenticated
  using (bucket_id = 'comunidade' and public._comunidade_pode_ver_foto(name));
drop policy if exists "comunidade: autor apaga fora do ar" on storage.objects;
create policy "comunidade: autor apaga fora do ar" on storage.objects for delete to authenticated
  using (bucket_id = 'comunidade' and public._comunidade_pode_apagar_foto(name));
-- sem UPDATE: foto enviada não se troca (troca = post novo)


-- -----------------------------------------------------------------------------
--  4. Admin da plataforma
-- -----------------------------------------------------------------------------
create or replace function public.admin_comunidade_painel()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return jsonb_build_object(
    'clubes_com_recurso', (select count(*) from public.organizational_units u where u.type = 'clube'
                             and public.recurso_habilitado_no_clube(u.id, 'comunidade')),
    'posts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from
               (select status, count(*) n from public.comunidade_posts group by status) s),
    'denuncias_pendentes', (select count(*) from public.comunidade_denuncias where resultado = 'pendente'),
    'bloqueios_7d', (select count(*) from public.comunidade_bloqueios where created_at > now() - interval '7 days'),
    'suspensos', (select count(*) from public.comunidade_suspensoes where encerrada_em is null and ate > now()),
    'bloqueios', (select coalesce(jsonb_agg(b.j order by b.created_at desc), '[]'::jsonb) from (
                    select x.created_at, jsonb_build_object('quando', x.created_at, 'clube', u.nome, 'alvo', x.alvo,
                             'motivo', x.motivo, 'regra', x.regra, 'trecho', x.trecho) j
                      from public.comunidade_bloqueios x join public.organizational_units u on u.id = x.club_id
                     order by x.created_at desc limit 50) b),
    'fila', public._comunidade_fila(null));
end;
$$;
revoke all on function public.admin_comunidade_painel() from public, anon;
grant execute on function public.admin_comunidade_painel() to authenticated;

create or replace function public.admin_comunidade_moderar(p_tipo text, p_id uuid, p_acao text, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public._exigir_admin_plataforma();
  v := public._comunidade_aplicar_moderacao(p_tipo, p_id, p_acao, p_motivo, 'plataforma', null);
  perform public._admin_auditar('comunidade_moderar', p_tipo, p_id, jsonb_build_object('acao', p_acao));
  return v;
end;
$$;
revoke all on function public.admin_comunidade_moderar(text, uuid, text, text) from public, anon;
grant execute on function public.admin_comunidade_moderar(text, uuid, text, text) to authenticated;

create or replace function public.admin_comunidade_termos()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'termo', termo, 'modo', modo, 'categoria', categoria, 'ativo', ativo)
                                    order by categoria, termo), '[]'::jsonb) from public.comunidade_termos);
end;
$$;
revoke all on function public.admin_comunidade_termos() from public, anon;
grant execute on function public.admin_comunidade_termos() to authenticated;

create or replace function public.admin_comunidade_termo_salvar(p_termo text, p_modo text default 'exata',
                                                                p_categoria text default 'ofensa', p_ativo boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public._exigir_admin_plataforma();
  if coalesce(p_modo, '') not in ('exata', 'radical') or coalesce(p_categoria, '') not in ('ofensa', 'contato') then
    raise exception 'Modo ou categoria inválidos.';
  end if;
  insert into public.comunidade_termos (termo, modo, categoria, ativo, criado_por)
  values (p_termo, p_modo, p_categoria, coalesce(p_ativo, true), auth.uid())
  on conflict (termo, modo) do update set categoria = excluded.categoria, ativo = excluded.ativo
  returning id into v_id;
  perform public._admin_auditar('comunidade_termo_salvar', 'comunidade_termo', v_id,
    jsonb_build_object('modo', p_modo, 'categoria', p_categoria, 'ativo', coalesce(p_ativo, true)));
  return public.admin_comunidade_termos();
end;
$$;
revoke all on function public.admin_comunidade_termo_salvar(text, text, text, boolean) from public, anon;
grant execute on function public.admin_comunidade_termo_salvar(text, text, text, boolean) to authenticated;

create or replace function public.admin_comunidade_termo_remover(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  delete from public.comunidade_termos where id = p_id;
  perform public._admin_auditar('comunidade_termo_remover', 'comunidade_termo', p_id, '{}'::jsonb);
  return public.admin_comunidade_termos();
end;
$$;
revoke all on function public.admin_comunidade_termo_remover(uuid) from public, anon;
grant execute on function public.admin_comunidade_termo_remover(uuid) to authenticated;

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000432', 'comunidade-moderacao-pais-storage') on conflict do nothing;

-- ======================= 20260930000450_manutencao-cobre-tabelas-da-comunidade =======================
-- =============================================================================
-- 450 — A trava do modo manutenção (400) passa a cobrir as tabelas criadas depois dela
-- =============================================================================
-- A Comunidade (430–432) e a manutenção (400) foram feitas em paralelo; as tabelas da Comunidade
-- nasceram sem o gatilho zz_manutencao_guarda. A função da 400 é idempotente: instala a guarda em
-- toda tabela do public que ainda não tem (respeitando as exceções de telemetria/limite de tentativa).
-- Regra (CLAUDE.md): toda migration que cria tabela chama public._manutencao_instalar_guarda().
-- =============================================================================
select public._manutencao_instalar_guarda();

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000450', 'manutencao-cobre-tabelas-da-comunidade') on conflict do nothing;

select 'OK' as resultado,
  (select max(version) from supabase_migrations.schema_migrations) as ledger,
  (select count(*) from public.audiolivros) as livros,
  (select count(*) from public.requisitos_com_documento) as requisitos_documento,
  (select count(*) from public.organization_memberships m join public.organizational_units u on u.id = m.organizational_unit_id
    where u.slug = 'filhos-da-conquista' and m.status = 'ativo') as ativos_filhos_da_conquista;
