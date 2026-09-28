-- Aplica 370 (audiolivros) + 380 (foto do documento da idade) em PRODUÇÃO.
-- Pode rodar mais de uma vez sem estragar nada (o SQL Editor grava comando a comando).
-- Para sozinho se a produção não estiver na 360, 370 ou 380.
do $g$ begin
  if (select max(version) from supabase_migrations.schema_migrations) not in ('20260930000360', '20260930000370', '20260930000380') then
    raise exception 'ABORTADO: produção não está na 360 (está em %)', (select max(version) from supabase_migrations.schema_migrations);
  end if;
end $g$;

-- ======================= 370 — audiolivros =======================
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
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000370', 'audiolivros-das-classes') on conflict do nothing;

-- ======================= 380 — foto do documento da idade =======================
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

insert into supabase_migrations.schema_migrations(version, name) values ('20260930000380', 'foto-de-documento-da-idade') on conflict do nothing;

select 'OK' as resultado,
  (select max(version) from supabase_migrations.schema_migrations) as ledger,
  (select count(*) from public.audiolivros) as livros,
  (select count(*) from public.audiolivro_capitulos) as capitulos,
  (select count(*) from public.requisitos_com_documento) as requisitos_com_documento;
