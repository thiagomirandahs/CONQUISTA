-- PROVA em PRODUÇÃO do log do admin (migration 530) — transação que termina em ROLLBACK (nada persiste; nenhum dado real é alterado de forma durável).
-- Simula a identidade (JWT) no servidor, sem senha de ninguém. Para criar o contexto "em análise" muda, DENTRO da transação, o status de
-- 1 post de Comunidade já publicado; no ROLLBACK ele volta. Resultado: linhas "R|..." (PASSOU/FALHOU).
--   psql "$DB_URL_PRODUCAO" -X -q -A -t -f scripts/janela-fase8/prova-log-admin-producao.sql 2>&1 | grep 'R|'
\set ON_ERROR_STOP on
begin;
do $$
declare adm uuid; dir_outro uuid; desb uuid; sem uuid; post record; n0 int; n1 int; n2 int; r jsonb; vis int; forjado uuid := gen_random_uuid(); publicado uuid;

begin
  select user_id into adm from public.platform_admins limit 1;
  select id, club_id, foto_path into post from public.comunidade_posts p
   where p.alcance = 'comunidade' and p.status = 'publicado' and p.foto_path is not null and p.foto_apagada_em is null
     and exists (select 1 from storage.objects o where o.bucket_id = 'comunidade' and o.name = p.foto_path) limit 1;
  if post.id is null then raise notice 'R|SEM POST DE COMUNIDADE COM FOTO PARA PROVAR|FALHOU'; return; end if;
  select user_id into dir_outro from public.organization_memberships where role = 'diretoria' and status = 'ativo' and organizational_unit_id <> post.club_id
     and user_id not in (select user_id from public.platform_admins) limit 1;
  select user_id into desb from public.organization_memberships where role = 'desbravador' and status = 'ativo' and user_id not in (select user_id from public.platform_admins) limit 1;
  select id into sem from auth.users where id not in (select user_id from public.organization_memberships) and id not in (select user_id from public.platform_admins) limit 1;
  select id into publicado from public.comunidade_posts p where p.alcance = 'comunidade' and p.status = 'publicado' and p.id <> post.id limit 1;

  -- contexto: o item passa a "em análise" (só dentro da transação)
  update public.comunidade_posts set status = 'em_analise' where id = post.id;

  -- 1) ADMIN: listar o bucket NÃO registra nada (e não lê nada direto)
  select count(*) into n0 from public.plataforma_acesso_log;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select count(*) into vis from storage.objects where bucket_id = 'comunidade';
  execute 'reset role';
  select count(*) into n1 from public.plataforma_acesso_log;
  raise notice 'R|listar a pasta nao gera log (visiveis=%, log % -> %)|%', vis, n0, n1, case when n1 = n0 then 'PASSOU' else 'FALHOU' end;

  -- 2) ADMIN abre UMA foto => exatamente UM registro
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := public.admin_comunidade_foto_assinar('post', post.id);
  execute 'reset role';
  select count(*) into n2 from public.plataforma_acesso_log;
  raise notice 'R|abrir 1 foto gera exatamente 1 registro (% -> %)|%', n1, n2, case when n2 = n1 + 1 then 'PASSOU' else 'FALHOU' end;
  raise notice 'R|RPC devolve ttl 60s e contexto em_analise|%', case when (r ->> 'ttl_segundos') = '60' and (r ->> 'contexto') = 'em_analise' then 'PASSOU' else 'FALHOU' end;
  raise notice 'R|registro sem URL/token/caminho fisico|%', case when not exists (select 1 from public.plataforma_acesso_log l where l.item_id = post.id and (to_jsonb(l)::text ~ 'token|signed|http|eyJ' or to_jsonb(l)::text like '%' || post.foto_path || '%')) then 'PASSOU' else 'FALHOU' end;
  raise notice 'R|registro tem admin, item, bucket, contexto e data|%', case when exists (select 1 from public.plataforma_acesso_log l where l.admin_user_id = adm and l.item_id = post.id and l.bucket = 'comunidade' and l.contexto = 'em_analise' and l.quando is not null) then 'PASSOU' else 'FALHOU' end;

  -- 3) bloqueios: usuário comum, diretoria de OUTRO clube, sem vínculo, caminho/UUID forjado, item publicado fora de contexto
  declare k text; u uuid; bloqueado boolean; antes int; depois int;
  begin
    for k, u in select * from (values ('desbravador', desb), ('diretoria_outro_clube', dir_outro), ('sem_vinculo', sem)) v(p, u) loop
      if u is null then raise notice 'R|%: sem usuario para simular|NAO APLICAVEL', k; continue; end if;
      select count(*) into antes from public.plataforma_acesso_log;
      bloqueado := false;
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
        perform public.admin_comunidade_foto_assinar('post', post.id);
      exception when others then bloqueado := true;
      end;
      execute 'reset role';
      select count(*) into depois from public.plataforma_acesso_log;
      raise notice 'R|% negado e sem log|%', k, case when bloqueado and depois = antes then 'PASSOU' else 'FALHOU' end;
    end loop;
    -- admin com id forjado e com item fora do contexto
    for k, u in select * from (values ('uuid_forjado', forjado), ('item_publicado_fora_de_contexto', publicado)) v(p, u) loop
      if u is null then raise notice 'R|%: sem item para simular|NAO APLICAVEL', k; continue; end if;
      select count(*) into antes from public.plataforma_acesso_log;
      bloqueado := false;
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
        perform public.admin_comunidade_foto_assinar('post', u);
      exception when others then bloqueado := true;
      end;
      execute 'reset role';
      select count(*) into depois from public.plataforma_acesso_log;
      raise notice 'R|admin com % negado e sem log|%', k, case when bloqueado and depois = antes then 'PASSOU' else 'FALHOU' end;
    end loop;
    -- anon
    select count(*) into antes from public.plataforma_acesso_log; bloqueado := false;
    begin
      execute 'set local role anon';
      perform public.admin_comunidade_foto_assinar('post', post.id);
    exception when others then bloqueado := true;
    end;
    execute 'reset role';
    select count(*) into depois from public.plataforma_acesso_log;
    raise notice 'R|anon negado e sem log|%', case when bloqueado and depois = antes then 'PASSOU' else 'FALHOU' end;
  end;
end $$;
rollback;
