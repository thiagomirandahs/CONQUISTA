-- =====================================================================
-- Hardening final (3/3, parte 1): imagens de usuários/membros por CLUBE + bucket "publico" para o que é realmente público.
-- Rodar DEPOIS da 20260921000030. Idempotente. Reproduzido nos testes 25 (SQL) e no e2e do Storage antes de corrigir.
-- Esta migration é SEGURA em qualquer janela (front/APK antigo continua funcionando: o bucket ainda é público até a 32).
--
-- O problema: `imagens` é um bucket PÚBLICO — avatar, foto do mural e emblema/bandeira de unidade (fotos de crianças) abrem para
-- QUALQUER pessoa na internet que tenha a URL, sem login e sem checar clube. Também aceitava upload de qualquer usuário em
-- qualquer caminho. Auditoria do que o app guarda no Storage:
--     perfis/<uid>-<ts>.<ext>              avatar (do cadastro e do perfil)         -> privado: colegas do clube + responsável do filho
--     mural/<uid>-<ts>[-thumb].<ext>       foto do mural                            -> privado: membros do clube da foto
--     unidades/<unidade>-<campo>-<ts>.ext  emblema/bandeira de unidade             -> privado: membros do clube da unidade
--     missoes|atividades/<uid>-<ts>.<ext>  comprovante ANTIGO (fallback sem bucket privado) -> só o dono e a liderança
--   NADA disso é "realmente público" (não há logo/banner de clube no Storage; o app estático fica na Vercel). Então:
--   * `imagens` passa a ser tudo PRIVADO (a virada é a migration 32 — passo separado de propósito, por causa do APK/front antigo
--     em cache, que mostram a imagem pela URL pública);
--   * nasce o bucket `publico`, RESERVADO para asset realmente público de um clube (logo, banner de divulgação): leitura por URL,
--     mas só a LIDERANÇA DO CLUBE grava, e só na pasta `<id do clube>/`. O app de hoje não grava nele.
--
-- Como o app lê uma imagem privada: URL assinada (createSignedUrl), que o Storage só entrega a quem passa na policy SELECT abaixo.
--
-- ACHADO DO E2E COM O STORAGE REAL (supabase/tests/e2e/storage-imagens.mjs): o Storage atual grava o dono do arquivo em
-- `storage.objects.owner_id` (texto) e deixa `owner` (uuid, deprecado) NULO; arquivos antigos têm `owner`. Toda policy que comparava
-- `owner = auth.uid()` (inclusive as de apagar/atualizar da migration 16) recusava o upload `upsert` de avatar/mural, porque o
-- INSERT ... ON CONFLICT ... RETURNING precisa passar na policy de leitura. Aqui TODAS as policies do bucket passam a usar
-- `dono_do_objeto(owner, owner_id)`, que entende os dois formatos (objetos antigos do Tenant 001 continuam com dono).
-- =====================================================================

-- ==================== 0) dono do objeto: `owner` (antigo) OU `owner_id` (atual) ====================
create or replace function public.dono_do_objeto(p_owner uuid, p_owner_id text) returns uuid
language sql immutable set search_path = '' as $$
  select coalesce(
    p_owner,
    case when p_owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_owner_id::uuid end
  )
$$;
grant execute on function public.dono_do_objeto(uuid, text) to authenticated;

-- alterar/apagar: o dono ou a liderança do clube do dono (o que a migration 16 queria, agora com o dono certo)
create or replace function public.pode_alterar_imagem(p_owner uuid, p_owner_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.dono_do_objeto(p_owner, p_owner_id) is not null
     and (public.dono_do_objeto(p_owner, p_owner_id) = auth.uid() or public.lideranca_gere_usuario(public.dono_do_objeto(p_owner, p_owner_id)))
$$;
revoke all on function public.pode_alterar_imagem(uuid, text) from public, anon;
grant execute on function public.pode_alterar_imagem(uuid, text) to authenticated;

-- ==================== 1) quem pode VER uma imagem (policy SELECT: listar e assinar URL) ====================
-- Regras (o dono e a liderança do clube do dono sempre; o resto depende da pasta):
--   perfis/    colegas do clube (ambos ativos, sem responsável) e o responsável aprovado do dono (foto do filho)
--   mural/     colegas do clube do dono OU membro do clube da FOTO (a linha em public.fotos manda: vale mesmo se o autor saiu/foi excluído)
--   unidades/  membro ativo do clube da UNIDADE (o id da unidade vem no nome do arquivo)
--   demais     (comprovante antigo, qualquer outra coisa): só o dono e a liderança — como já era
create or replace function public.pode_ver_imagem(p_name text, p_owner uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_pasta text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_uid is null then return false; end if;
  if p_owner is not null and (p_owner = v_uid or public.lideranca_gere_usuario(p_owner)) then return true; end if;
  if v_pasta = 'perfis' then
    return p_owner is not null and (
      public.compartilha_clube_com(p_owner)
      or exists (select 1 from public.responsaveis r where r.responsavel_id = v_uid and r.desbravador_id = p_owner and r.status = 'aprovado')
    );
  elsif v_pasta = 'mural' then
    return (p_owner is not null and public.compartilha_clube_com(p_owner))
      or exists (
        select 1 from public.fotos f
        where public.membro_ativo_no_clube(f.club_id)
          and (right(f.url, length(p_name)) = p_name or right(f.thumb, length(p_name)) = p_name)
      );
  elsif v_pasta = 'unidades' then
    -- compara como TEXTO (um nome malformado não pode gerar erro de cast na policy e derrubar a listagem de todo mundo)
    return exists (
      select 1 from public.unidades u
      where u.id::text = substring(p_name from '^unidades/([0-9a-fA-F-]{36})-')
        and public.membro_ativo_no_clube(u.club_id)
    );
  end if;
  return false;
end;
$$;
revoke all on function public.pode_ver_imagem(text, uuid) from public, anon;
grant execute on function public.pode_ver_imagem(text, uuid) to authenticated;

drop policy if exists "ler imagens dono ou lideranca" on storage.objects;
drop policy if exists "ler imagens do clube" on storage.objects;
create policy "ler imagens do clube" on storage.objects for select to authenticated
  using (bucket_id = 'imagens' and public.pode_ver_imagem(name, public.dono_do_objeto(owner, owner_id)));

-- ==================== 2) quem pode ENVIAR (policy INSERT): só no PRÓPRIO escopo, com o formato que o app usa ====================
-- Antes: `with check (bucket_id = 'imagens')` — qualquer usuário (de qualquer clube, pendente ou responsável) em qualquer caminho.
create or replace function public.pode_subir_imagem(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_pasta text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_uid is null or p_name is null then return false; end if;
  if v_pasta = 'perfis' then
    -- avatar: o arquivo começa com o PRÓPRIO id (vale também no cadastro, antes da aprovação)
    return p_name ~ ('^perfis/' || v_uid::text || '-[^/]+$');
  elsif v_pasta = 'mural' then
    return p_name ~ ('^mural/' || v_uid::text || '-[^/]+$') and public.membro_ativo_no_clube(public.clube_atual_id());
  elsif v_pasta in ('missoes', 'atividades') then
    -- comprovante do fallback antigo (quando o bucket privado ainda não existia)
    return p_name ~ ('^(missoes|atividades)/' || v_uid::text || '-[^/]+$') and public.membro_ativo_no_clube(public.clube_atual_id());
  elsif v_pasta = 'unidades' then
    -- emblema/bandeira: liderança do clube DA UNIDADE
    return p_name ~ '^unidades/[0-9a-fA-F-]{36}-[^/]+$' and exists (
      select 1 from public.unidades u
      where u.id::text = substring(p_name from '^unidades/([0-9a-fA-F-]{36})-')
        and public.pode_gerir_no_clube(u.club_id)
    );
  end if;
  return false;
end;
$$;
revoke all on function public.pode_subir_imagem(text) from public, anon;
grant execute on function public.pode_subir_imagem(text) to authenticated;

drop policy if exists "subir imagens" on storage.objects;
drop policy if exists "subir imagens no proprio escopo" on storage.objects;
create policy "subir imagens no proprio escopo" on storage.objects for insert to authenticated
  with check (bucket_id = 'imagens' and public.pode_subir_imagem(name));
drop policy if exists "apagar imagens" on storage.objects;
create policy "apagar imagens" on storage.objects for delete to authenticated
  using (bucket_id = 'imagens' and public.pode_alterar_imagem(owner, owner_id));
drop policy if exists "atualizar imagens" on storage.objects;
create policy "atualizar imagens" on storage.objects for update to authenticated
  using (bucket_id = 'imagens' and public.pode_alterar_imagem(owner, owner_id))
  with check (bucket_id = 'imagens' and public.pode_alterar_imagem(owner, owner_id));

-- ==================== 3) bucket "publico": só o que é realmente público de um clube ====================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('publico', 'publico', true, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- pasta = id do clube: só a liderança daquele clube escreve ali (o clube vem do caminho e é conferido contra o vínculo de quem envia)
create or replace function public.pode_gerir_pasta_publica(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_name, '') ~ '^[0-9a-fA-F-]{36}/[^/]+$'
     and exists (
       select 1 from public.organizational_units u
       where u.type = 'clube' and u.id::text = split_part(p_name, '/', 1) and public.pode_gerir_no_clube(u.id)
     );
$$;
revoke all on function public.pode_gerir_pasta_publica(text) from public, anon;
grant execute on function public.pode_gerir_pasta_publica(text) to authenticated;

-- leitura por URL não passa por policy (bucket público); estas policies só governam LISTAR e GRAVAR — anon nunca lista.
drop policy if exists "publico lideranca do clube lista" on storage.objects;
create policy "publico lideranca do clube lista" on storage.objects for select to authenticated
  using (bucket_id = 'publico' and (public.dono_do_objeto(owner, owner_id) = auth.uid() or public.pode_gerir_pasta_publica(name)));
drop policy if exists "publico lideranca do clube envia" on storage.objects;
create policy "publico lideranca do clube envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'publico' and public.pode_gerir_pasta_publica(name));
drop policy if exists "publico lideranca do clube atualiza" on storage.objects;
create policy "publico lideranca do clube atualiza" on storage.objects for update to authenticated
  using (bucket_id = 'publico' and public.pode_gerir_pasta_publica(name))
  with check (bucket_id = 'publico' and public.pode_gerir_pasta_publica(name));
drop policy if exists "publico lideranca do clube apaga" on storage.objects;
create policy "publico lideranca do clube apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'publico' and public.pode_gerir_pasta_publica(name));
