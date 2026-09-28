-- =============================================================================
-- 472 — REDE DBV: moderação no visual novo ("Ocultar") e VIDA ÚTIL / armazenamento mínimo das fotos
-- =============================================================================
-- 1. Moderação: os cards da rede têm Manter · Ocultar · Remover. Manter = 'restaurar', Remover =
--    'remover' (as de sempre). 'ocultar' é NOVA e só serve para conteúdo que ainda está no ar com
--    denúncia pendente (denunciante sem poder de esconder na hora): a diretoria esconde enquanto
--    pensa. Não gera aviso (strike) ao autor; no histórico entra como 'ocultado_por_denuncia'
--    com via 'diretoria'/'plataforma' (o CHECK do log não muda).
-- 2. Armazenamento mínimo (decisão do dono, 28/09):
--    * o app comprime para WebP (fallback JPEG), lado maior 1080 px, alvo ≤ 150 KB;
--    * o bucket 'comunidade' passa a aceitar image/webp e o LIMITE cai para 300 KB (o servidor
--      recusa arquivo grande mesmo com app adulterado).
-- 3. Vida útil:
--    * foto de post expira em 90 dias (foto_expira_em): o post continua, sem a foto ("foto expirada");
--    * foto recusada/removida pela moderação, de post apagado ou retirado pelo responsável: entra
--      na fila de apagar NA HORA (gatilho); arquivo órfão (subiu e não virou post) em 1 dia;
--    * avatar (bucket 'imagens') fica enquanto o membro estiver ativo — nada muda aqui.
--    O Supabase NÃO deixa apagar arquivo por SQL (storage.protect_objects_delete): o banco só
--    MARCA (rede_fotos_para_apagar); a Edge Function `limpar-fotos-rede` (service_role) lê a
--    fila, remove pela API do Storage em lotes de até 100 e confirma. Cada rodada vai para
--    rede_limpeza_log (arquivos e bytes liberados).
--    O pg_cron roda public.rede_limpeza_rotina() todo dia: marca e, se o Vault tiver
--    'rede_limpeza_url' e 'rede_limpeza_secret', chama a Edge Function por pg_net. Sem eles
--    (ex.: banco local), só marca e registra em infra_falhas — a função pode ser chamada à mão.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. Moderação: ação 'ocultar'
-- -----------------------------------------------------------------------------
create or replace function public._comunidade_aplicar_moderacao(p_tipo text, p_id uuid, p_acao text, p_motivo text,
                                                               p_via text, p_club_exigido uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_status text; v_autor uuid; v_pend boolean; v_novo text; v_res text; v_log text := p_acao;
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
  elsif p_acao = 'ocultar' then
    if v_status <> 'publicado' or not v_pend then raise exception 'Só dá para ocultar conteúdo denunciado que ainda está no ar.'; end if;
    v_novo := 'oculto_denuncia'; v_log := 'ocultado_por_denuncia';
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
  values (v_club, p_tipo, p_id, v_log, auth.uid(), p_via, left(public._comunidade_limpar(p_motivo), 300));

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


-- -----------------------------------------------------------------------------
--  2. Bucket: WebP ou JPEG, até 300 KB
-- -----------------------------------------------------------------------------
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/webp'], file_size_limit = 307200, public = false
 where id = 'comunidade';

-- caminho aceita .jpg ou .webp (as policies de Storage da 432 chamam esta função)
create or replace function public._comunidade_pode_enviar_foto(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_papel text;
begin
  if v_uid is null or v_club is null then return false; end if;
  if coalesce(p_name, '') !~ ('^' || v_club::text || '/' || v_uid::text || '/[0-9a-f-]{36}\.(jpg|webp)$') then return false; end if;
  if not public.recurso_habilitado_no_clube(v_club, 'comunidade') then return false; end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null or v_papel = 'pais' then return false; end if;
  if v_papel = 'desbravador' and not public._comunidade_autorizado(v_uid, v_club) then return false; end if;
  return public._comunidade_suspenso_ate(v_uid) is null;
end;
$$;
revoke all on function public._comunidade_pode_enviar_foto(text) from public, anon;
grant execute on function public._comunidade_pode_enviar_foto(text) to authenticated;

-- comunidade_publicar (431) com o caminho .jpg|.webp — o resto é idêntico
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
    if found and v_orig.repost_de is not null then v_repost := v_orig.repost_de; end if;
    if not found or not exists (select 1 from public.comunidade_posts p where p.id = v_repost and p.status = 'publicado'
                                 and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')) then
      raise exception 'Esta publicação não está disponível.';
    end if;
  end if;

  if p_foto_path is not null then
    if p_foto_path !~ ('^' || v_club::text || '/' || v_uid::text || '/[0-9a-f-]{36}\.(jpg|webp)$') then
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

-- foto expirada/apagada não abre mais (nem por URL assinada antiga pedida de novo)
create or replace function public._comunidade_pode_ver_foto(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); p record; v_papel text;
begin
  if v_uid is null then return false; end if;
  select * into p from public.comunidade_posts where foto_path = p_name;
  if not found then
    return split_part(coalesce(p_name, ''), '/', 2) = v_uid::text;
  end if;
  if p.autor_id = v_uid or public.eh_admin_plataforma(v_uid) then return true; end if;
  if p.foto_apagada_em is not null or p.foto_expira_em <= now() then return false; end if;
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


-- -----------------------------------------------------------------------------
--  3. Vida útil: 90 dias, fila de apagar e log
-- -----------------------------------------------------------------------------
create or replace function public.rede_dias_de_foto() returns int
language sql immutable set search_path = '' as $$ select 90 $$;   -- mudar = migration nova
revoke all on function public.rede_dias_de_foto() from public, anon;
grant execute on function public.rede_dias_de_foto() to authenticated;

update public.comunidade_posts
   set foto_expira_em = coalesce(publicado_em, created_at) + make_interval(days => public.rede_dias_de_foto())
 where foto_path is not null and foto_expira_em is null;

create or replace function public._rede_foto_expira() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.foto_path is not null and new.foto_expira_em is null then
    new.foto_expira_em := now() + make_interval(days => public.rede_dias_de_foto());
  end if;
  return new;
end;
$$;
revoke all on function public._rede_foto_expira() from public, anon, authenticated;
drop trigger if exists trg_rede_foto_expira on public.comunidade_posts;
create trigger trg_rede_foto_expira before insert on public.comunidade_posts
  for each row execute function public._rede_foto_expira();

-- Fila (club_id = clube do post/pasta). O arquivo só sai pela Edge Function (API do Storage).
create table if not exists public.rede_fotos_para_apagar (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  bucket text not null default 'comunidade',
  caminho text not null,
  motivo text not null check (motivo in ('expirada', 'recusada', 'removida', 'apagada', 'retirada', 'orfa')),
  post_id uuid references public.comunidade_posts(id) on delete set null,
  bytes bigint,
  marcada_em timestamptz not null default now(),
  apagada_em timestamptz,
  tentativas int not null default 0,
  erro text,
  unique (bucket, caminho)
);
create index if not exists rede_fotos_para_apagar_pendentes_idx on public.rede_fotos_para_apagar (marcada_em) where apagada_em is null;
alter table public.rede_fotos_para_apagar enable row level security;
revoke all on public.rede_fotos_para_apagar from public, anon, authenticated;

-- Log das rodadas (da PLATAFORMA; sem club_id — exceção no teste 20)
create table if not exists public.rede_limpeza_log (
  id uuid primary key default gen_random_uuid(),
  origem text not null check (origem in ('marcacao', 'edge')),
  marcadas int not null default 0,
  arquivos int not null default 0,
  bytes bigint not null default 0,
  erros int not null default 0,
  detalhe text,
  created_at timestamptz not null default now()
);
alter table public.rede_limpeza_log enable row level security;
revoke all on public.rede_limpeza_log from public, anon, authenticated;
select public._manutencao_instalar_guarda();

create or replace function public._rede_tamanho_objeto(p_bucket text, p_caminho text) returns bigint
language sql stable security definer set search_path = '' as $$
  select nullif(o.metadata ->> 'size', '')::bigint from storage.objects o where o.bucket_id = p_bucket and o.name = p_caminho;
$$;
revoke all on function public._rede_tamanho_objeto(text, text) from public, anon, authenticated;

-- Moderação/apagar/retirar: a foto entra na fila NA HORA
create or replace function public._rede_foto_fora_do_ar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.foto_path is not null and new.status is distinct from old.status
     and new.status in ('recusado', 'removido', 'apagado', 'retirado') then
    insert into public.rede_fotos_para_apagar (club_id, caminho, motivo, post_id, bytes)
    values (new.club_id, new.foto_path,
            case new.status when 'recusado' then 'recusada' when 'removido' then 'removida'
                            when 'apagado' then 'apagada' else 'retirada' end,
            new.id, public._rede_tamanho_objeto('comunidade', new.foto_path))
    on conflict (bucket, caminho) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public._rede_foto_fora_do_ar() from public, anon, authenticated;
drop trigger if exists trg_rede_foto_fora_do_ar on public.comunidade_posts;
create trigger trg_rede_foto_fora_do_ar after update of status on public.comunidade_posts
  for each row execute function public._rede_foto_fora_do_ar();

-- Marcação diária: expiradas + fora do ar que escaparam + órfãs (subiu e não virou post em 1 dia)
create or replace function public.rede_marcar_fotos_para_apagar()
returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_k int;
begin
  insert into public.rede_fotos_para_apagar (club_id, caminho, motivo, post_id, bytes)
  select p.club_id, p.foto_path,
         case when p.status = 'recusado' then 'recusada' when p.status = 'removido' then 'removida'
              when p.status = 'apagado' then 'apagada' when p.status = 'retirado' then 'retirada' else 'expirada' end,
         p.id, public._rede_tamanho_objeto('comunidade', p.foto_path)
    from public.comunidade_posts p
   where p.foto_path is not null and p.foto_apagada_em is null
     and (p.foto_expira_em <= now() or p.status in ('recusado', 'removido', 'apagado', 'retirado'))
  on conflict (bucket, caminho) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.rede_fotos_para_apagar (club_id, caminho, motivo, bytes)
  select u.id, o.name, 'orfa', nullif(o.metadata ->> 'size', '')::bigint
    from storage.objects o
    join public.organizational_units u on u.id::text = split_part(o.name, '/', 1)
   where o.bucket_id = 'comunidade' and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.comunidade_posts p where p.foto_path = o.name)
  on conflict (bucket, caminho) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.rede_limpeza_log (origem, marcadas) values ('marcacao', v_n);
  return v_n;
end;
$$;
revoke all on function public.rede_marcar_fotos_para_apagar() from public, anon, authenticated;

-- Lidas/confirmadas SÓ pela Edge Function (service_role)
create or replace function public.rede_fotos_pendentes(p_limite int default 500)
returns table (id uuid, bucket text, caminho text, bytes bigint)
language sql stable security definer set search_path = '' as $$
  select f.id, f.bucket, f.caminho, f.bytes from public.rede_fotos_para_apagar f
   where f.apagada_em is null and f.tentativas < 5
   order by f.marcada_em limit least(greatest(coalesce(p_limite, 500), 1), 2000);
$$;
revoke all on function public.rede_fotos_pendentes(int) from public, anon, authenticated;
grant execute on function public.rede_fotos_pendentes(int) to service_role;

create or replace function public.rede_fotos_confirmar(p_apagadas uuid[], p_falhas uuid[] default '{}', p_erro text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_arq int; v_bytes bigint;
begin
  update public.rede_fotos_para_apagar set apagada_em = now(), erro = null
   where id = any(coalesce(p_apagadas, '{}')) and apagada_em is null;
  get diagnostics v_arq = row_count;
  select coalesce(sum(bytes), 0) into v_bytes from public.rede_fotos_para_apagar where id = any(coalesce(p_apagadas, '{}'));
  update public.comunidade_posts p set foto_apagada_em = now()
    from public.rede_fotos_para_apagar f
   where f.id = any(coalesce(p_apagadas, '{}')) and f.post_id = p.id and p.foto_apagada_em is null;
  update public.rede_fotos_para_apagar set tentativas = tentativas + 1, erro = left(p_erro, 300)
   where id = any(coalesce(p_falhas, '{}')) and apagada_em is null;
  insert into public.rede_limpeza_log (origem, arquivos, bytes, erros, detalhe)
  values ('edge', v_arq, v_bytes, coalesce(array_length(p_falhas, 1), 0), left(p_erro, 300));
  return jsonb_build_object('arquivos', v_arq, 'bytes', v_bytes);
end;
$$;
revoke all on function public.rede_fotos_confirmar(uuid[], uuid[], text) from public, anon, authenticated;
grant execute on function public.rede_fotos_confirmar(uuid[], uuid[], text) to service_role;

-- Rotina do cron: marca e (se configurado) chama a Edge Function
create or replace function public.rede_limpeza_rotina()
returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_segredo text;
begin
  perform public.rede_marcar_fotos_para_apagar();
  begin
    select decrypted_secret into v_url     from vault.decrypted_secrets where name = 'rede_limpeza_url';
    select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'rede_limpeza_secret';
  exception when others then v_url := null;
  end;
  if v_url is null or v_segredo is null then
    insert into public.infra_falhas (origem, detalhe)
    values ('rede/limpeza', 'sem rede_limpeza_url/rede_limpeza_secret no Vault: só marcou; rode a Edge Function limpar-fotos-rede à mão');
    return;
  end if;
  perform net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-rede-limpeza-secret', v_segredo),
    body := '{}'::jsonb, timeout_milliseconds := 10000);
end;
$$;
revoke all on function public.rede_limpeza_rotina() from public, anon, authenticated;

-- Admin da plataforma vê quanto foi liberado
create or replace function public.admin_rede_armazenamento()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return jsonb_build_object(
    'pendentes', (select count(*) from public.rede_fotos_para_apagar where apagada_em is null),
    'liberados_arquivos', (select coalesce(sum(arquivos), 0) from public.rede_limpeza_log where origem = 'edge'),
    'liberados_bytes', (select coalesce(sum(bytes), 0) from public.rede_limpeza_log where origem = 'edge'),
    'ultima', (select max(created_at) from public.rede_limpeza_log where origem = 'edge'));
end;
$$;
revoke all on function public.admin_rede_armazenamento() from public, anon;
grant execute on function public.admin_rede_armazenamento() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'rede-limpar-fotos';
    perform cron.schedule('rede-limpar-fotos', '35 5 * * *', 'select public.rede_limpeza_rotina()');
  end if;
end $$;
