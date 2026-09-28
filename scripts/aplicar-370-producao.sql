-- Aplica a 370 (audiolivros das Classes) em PRODUÇÃO. Pode rodar mais de uma vez sem estragar nada
-- (o SQL Editor grava comando a comando). Para sozinho se a produção não estiver na 360 ou já na 370.
do $g$ begin
  if (select max(version) from supabase_migrations.schema_migrations) not in ('20260930000360', '20260930000370') then
    raise exception 'ABORTADO: produção não está na 360 (está em %)', (select max(version) from supabase_migrations.schema_migrations);
  end if;
end $g$;

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

-- Catálogo inicial (28/09/2026): as 6 playlists enviadas pelo dono, conferidas uma a uma.
insert into public.audiolivros (titulo, autor, canal, playlist_id) values
  ('Vaso de Barro', null, 'Canal Desbravando', 'PLI9KNpa2zLv4Mqtj3mpgREEM-McAOfcQf'),
  ('Um Simples Lanche', 'Denis Cruz', 'Flecha do Oriente', 'PLJpmJ_3QuTz_CHoYi_DFez-Mi2Av-DK6j'),
  ('Além da Magia', null, 'Bruno dos Santos', 'PLYDfhJMN8OWu751v75T96tBeXQ5YDeq8H'),
  ('Expedição Galápagos', 'Michelson Borges', 'Hora do Clube', 'PLZzUHCA4d0QxHUB46W_0rzAm46XijMVda'),
  ('O Fim do Começo', 'Carolina Costa Cavalcanti', 'Hora do Clube', 'PLZzUHCA4d0QyjX0cXBPeeWMVi1vkC7uhi'),
  ('O Livro Amargo', 'Denis Cruz', 'Hora do Clube', 'PLZzUHCA4d0QyFhugtYE0G5OosiXxIONu7')
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
  ('O Livro Amargo', 25, 'Apêndice', '-j8DeD7twF0')
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

insert into supabase_migrations.schema_migrations(version, name) values ('20260930000370', 'audiolivros-das-classes')
on conflict do nothing;

select 'OK' as resultado,
  (select max(version) from supabase_migrations.schema_migrations) as ledger,
  (select count(*) from public.audiolivros) as livros,
  (select count(*) from public.audiolivro_capitulos) as capitulos;
