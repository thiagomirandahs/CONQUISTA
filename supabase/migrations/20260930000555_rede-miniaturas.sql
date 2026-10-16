-- =============================================================================
--  555 — MINIATURAS DAS FOTOS DA REDE DBV (16/10/2026).
--  A grade do perfil (quadradinhos de ~120 px) baixava a foto inteira (até 150 KB) de cada post. Agora cada foto nova sobe
--  também uma MINIATURA (~30 KB) em <clube>/<eu>/<uuid>-min.webp (ou .jpg) e a grade usa ela; post antigo sem miniatura
--  continua mostrando a foto inteira.
--
--  Para a miniatura ser um arquivo "em uso" (e não lixo):
--   1. comunidade_posts.foto_min_path guarda o caminho (o catálogo do GC de Storage reconhece a coluna);
--   2. rede_post_miniatura(post, caminho): só o AUTOR, só com o nome derivado da própria foto e só se o arquivo existir;
--   3. a regra de envio do bucket aceita o sufixo -min; a de leitura trata a miniatura como a foto do post (mesmas regras);
--   4. a limpeza da Rede: a miniatura NÃO é órfã; e sai junto quando a foto do post sai (expirada, removida…).
--  As três funções existentes são ajustadas por SUBSTITUIÇÃO PONTUAL do texto vivo (se o trecho mudou, a migration para).
-- =============================================================================
begin;

alter table public.comunidade_posts add column if not exists foto_min_path text;

do $$
declare v_def text; v_novo text;
begin
  -- 3a) envio: aceita <uuid>-min.(jpg|webp)
  v_def := pg_get_functiondef('public._comunidade_pode_enviar_foto(text)'::regprocedure);
  if strpos(v_def, '(-min)?\.(jpg|webp)$') = 0 then   -- strpos (no LIKE a barra invertida é escape)
    v_novo := replace(v_def, '/[0-9a-f-]{36}\.(jpg|webp)$', '/[0-9a-f-]{36}(-min)?\.(jpg|webp)$');
    if v_novo = v_def then raise exception '555: trecho da regra de envio não encontrado'; end if;
    execute v_novo;
  end if;

  -- 3b) leitura: a miniatura vale como a foto do post (mesmas regras de quem pode ver)
  v_def := pg_get_functiondef('public._comunidade_pode_ver_foto(text)'::regprocedure);
  if v_def not like '%p_name in (foto_path, foto_min_path)%' then
    v_novo := replace(v_def, 'select * into p from public.comunidade_posts where foto_path = p_name;',
                             'select * into p from public.comunidade_posts where p_name in (foto_path, foto_min_path) limit 1;');
    if v_novo = v_def then raise exception '555: trecho da regra de leitura não encontrado'; end if;
    execute v_novo;
  end if;

  -- 1b) catálogo do GC de Storage: a miniatura é referência VIVA (nunca vira candidata a lixo enquanto o post a usa)
  v_def := pg_get_functiondef('public._storage_referencias()'::regprocedure);
  if v_def not like '%comunidade_posts.foto_min_path%' then
    v_novo := replace(v_def, $velho$    ('rede_stories.foto_path', 'rede_stories',$velho$,
      $novo$    ('comunidade_posts.foto_min_path', 'comunidade_posts', array['foto_min_path'], 'exato', 'comunidade', 'viva',
      $q$select foto_min_path, foto_apagada_em is null, null::text from public.comunidade_posts where foto_min_path is not null$q$,
      'Miniatura da foto do post (555): a grade do perfil usa; sai junto com a foto.'),
    ('rede_stories.foto_path', 'rede_stories',$novo$);
    if v_novo = v_def then raise exception '555: trecho do catálogo do GC não encontrado'; end if;
    execute v_novo;
  end if;

  -- 4a) limpeza: miniatura de post NÃO é órfã
  v_def := pg_get_functiondef('public.rede_marcar_fotos_para_apagar()'::regprocedure);
  if v_def not like '%o.name in (p.foto_path, p.foto_min_path)%' then
    v_novo := replace(v_def, 'where p.foto_path = o.name)', 'where o.name in (p.foto_path, p.foto_min_path))');
    if v_novo = v_def then raise exception '555: trecho da limpeza de órfãs não encontrado'; end if;
    execute v_novo;
  end if;
end $$;

-- 4b) quando a FOTO de um post entra na fila de apagar, a miniatura dele vai junto
create or replace function public._rede_miniatura_junto() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_min text;
begin
  if new.post_id is null then return null; end if;
  select p.foto_min_path into v_min from public.comunidade_posts p where p.id = new.post_id;
  if v_min is not null and v_min <> new.caminho then
    insert into public.rede_fotos_para_apagar (club_id, bucket, caminho, motivo, post_id, bytes)
    values (new.club_id, new.bucket, v_min, new.motivo, new.post_id, public._rede_tamanho_objeto(new.bucket, v_min))
    on conflict (bucket, caminho) do nothing;
  end if;
  return null;
end $$;
revoke all on function public._rede_miniatura_junto() from public, anon, authenticated;
drop trigger if exists trg_rede_miniatura_junto on public.rede_fotos_para_apagar;
create trigger trg_rede_miniatura_junto after insert on public.rede_fotos_para_apagar
  for each row execute function public._rede_miniatura_junto();

-- 2) o autor registra a miniatura do próprio post (o app chama logo depois de publicar)
create or replace function public.rede_post_miniatura(p_post uuid, p_caminho text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); p public.comunidade_posts;
begin
  if v_uid is null then return false; end if;
  select * into p from public.comunidade_posts where id = p_post;
  if p.id is null or p.autor_id <> v_uid or p.foto_path is null then return false; end if;
  -- só o nome derivado da PRÓPRIA foto: <mesmo caminho sem extensão>-min.webp|jpg
  if p_caminho is null or p_caminho !~ '-min\.(webp|jpg)$'
     or regexp_replace(p_caminho, '-min\.(webp|jpg)$', '') <> regexp_replace(p.foto_path, '\.(webp|jpg)$', '') then
    return false;
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'comunidade' and o.name = p_caminho) then return false; end if;
  update public.comunidade_posts set foto_min_path = p_caminho where id = p.id;
  return true;
end $$;
revoke all on function public.rede_post_miniatura(uuid, text) from public, anon;
grant execute on function public.rede_post_miniatura(uuid, text) to authenticated;

notify pgrst, 'reload schema';
insert into public.migracoes_aplicadas (arquivo) values ('2026-10-16-rede-miniaturas.sql') on conflict (arquivo) do nothing;
commit;
