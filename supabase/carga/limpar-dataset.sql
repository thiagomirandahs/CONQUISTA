-- Remove TUDO que o gerador criou. Nada do Tenant 001/002 é tocado: o filtro é sempre o slug
-- 'carga-%' dos clubes sintéticos (e o cascade das FKs faz o resto).
\set ON_ERROR_STOP on
do $$
declare v_clubes uuid[];
begin
  select array_agg(id) into v_clubes from public.organizational_units where slug like 'carga-%';
  if v_clubes is null then raise notice '[carga] nada a limpar'; return; end if;
  set local session_replication_role = replica;

  delete from public.experience_submissions where club_id = any(v_clubes);
  delete from public.experience_participations where club_id = any(v_clubes);
  delete from public.experience_audiences where club_id = any(v_clubes);
  delete from public.experience_stages where club_id = any(v_clubes);
  delete from public.experiences where club_id = any(v_clubes);
  delete from public.member_requirements where club_id = any(v_clubes);
  delete from public.member_classes where club_id = any(v_clubes);
  delete from public.notificacoes where club_id = any(v_clubes);
  delete from public.fotos where club_id = any(v_clubes);
  delete from public.chat_mensagens where club_id = any(v_clubes);
  delete from public.chat_conversas where club_id = any(v_clubes);
  delete from public.pontos where club_id = any(v_clubes);
  delete from public.temporadas where club_id = any(v_clubes);
  delete from public.config_clube where club_id = any(v_clubes);
  delete from public.club_features where club_id = any(v_clubes);
  delete from public.organization_memberships where organizational_unit_id = any(v_clubes);
  delete from public.unidades where club_id = any(v_clubes);
  -- as pessoas sintéticas: e-mail @carga.local é o marcador
  delete from public.profiles where id in (select id from auth.users where email like '%@carga.local');
  delete from auth.users where email like '%@carga.local';
  -- Com o replica ligado o ON DELETE CASCADE das FKs NÃO dispara: tudo o que aponta para o clube
  -- sintético tem de sair antes, senão fica linha órfã (o restore da fase 9.1 achou 100 em
  -- club_storage_uso — e o pg_restore recusa a FK). Varre TODA FK que aponta para
  -- organizational_units, em vez de uma lista que envelhece a cada migration.
  declare r record;
  begin
    for r in select c.conrelid::regclass as tab, a.attname as col
               from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
              where c.contype = 'f' and c.confrelid = 'public.organizational_units'::regclass
                and array_length(c.conkey, 1) = 1 and c.conrelid <> 'public.organizational_units'::regclass loop
      execute format('delete from %s where %I = any($1)', r.tab, r.col) using v_clubes;
    end loop;
  end;
  delete from public.organizational_units where id = any(v_clubes);

  -- Objetos sintéticos do Storage. Dois marcadores, porque foram criados em dois formatos:
  -- `mural/carga-*.jpg` (sem dono) e `perfis/<uuid>.jpg` (dono sintético, apagado acima — por isso
  -- o critério aqui é "órfão").
  --
  -- `storage.allow_delete_query` (e não session_replication_role) é o que desarma o
  -- storage.protect_delete(). A diferença importa desde a fase 8.1: o replica desligaria TAMBÉM o
  -- gatilho de contabilidade de armazenamento, e o livro-razão ficaria com linhas de objetos que
  -- não existem mais.
  set local storage.allow_delete_query = 'true';
  delete from storage.objects where name like '%carga-%';
  delete from storage.objects o
   where o.owner_id is not null
     and not exists (select 1 from auth.users u where u.id::text = o.owner_id);

  set local session_replication_role = origin;
  raise notice '[carga] limpo: % clubes', array_length(v_clubes, 1);
end $$;
drop table if exists public._carga_param;
analyze;
