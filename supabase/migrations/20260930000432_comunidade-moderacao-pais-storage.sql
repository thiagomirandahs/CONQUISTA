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
