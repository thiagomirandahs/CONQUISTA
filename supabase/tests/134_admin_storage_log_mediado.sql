-- ADMIN DA PLATAFORMA x STORAGE — acesso MEDIADO por RPC (migration 530).
-- Prova: listar o bucket nao registra nada e nao devolve arquivo ao admin; assinar registra EXATAMENTE 1 linha por
-- chamada (admin, contexto, bucket, item, quando); item fora do contexto (alcance clube, publicado sem denuncia,
-- aprovado) e negado e nao registra; nao-admin e anon negados; o log nao contem URL/token; o log e append-only;
-- fail-closed (log indisponivel => nada autorizado); a policy do Storage continua servindo membros normalmente.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
insert into public.club_features (club_id, feature, enabled)
values (t.id('clube_a'), 'comunidade', true), (t.id('clube_b'), 'comunidade', true)
on conflict (club_id, feature) do update set enabled = true;
set local session_replication_role = replica;
update public.profiles set created_at = now() - interval '60 days'
 where id in (t.id('lider_a'), t.id('instrutor_a'), t.id('membro_a'), t.id('lider_b'), t.id('membro_b'), t.id('pais_a'), t.id('pais_b'));
set local session_replication_role = origin;
select t.signup('admin_134', '{"tipo":"fundador","nome":"Admin Cento Trinta Quatro"}'::jsonb);
update public.profiles set created_at = now() - interval '60 days' where id = t.id('admin_134');
insert into public.platform_admins (user_id, papel) values (t.id('admin_134'), 'operacao');
insert into t.ids values ('f1', gen_random_uuid()), ('f2', gen_random_uuid()), ('f3', gen_random_uuid()), ('f4', gen_random_uuid());
create function t.cam(p_clube text, p_pessoa text, p_foto text, p_ext text default 'webp') returns text language sql as $$
  select t.id(p_clube)::text || '/' || t.id(p_pessoa)::text || '/' || t.id(p_foto)::text || '.' || p_ext;
$$;
create function t.obj(p_path text) returns void language sql security definer set search_path = '' as $$
  insert into storage.objects (bucket_id, name, metadata) values ('comunidade', p_path, jsonb_build_object('size', 120000, 'mimetype', 'image/webp'));
$$;
create function t.nlog(p_admin text, p_item uuid default null) returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.plataforma_acesso_log l
   where l.admin_user_id = t.id(p_admin) and l.o_que = 'foto_assinada' and (p_item is null or l.item_id = p_item);
$$;
create function t.nlog_total() returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.plataforma_acesso_log;
$$;
create function t.recuar(p_min int) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.comunidade_posts set created_at = created_at - make_interval(mins => p_min);
end $$;
grant usage on schema t to public;
select t.obj(t.cam('clube_a', 'lider_a', 'f1'));
select t.obj(t.cam('clube_a', 'lider_a', 'f2'));
select t.obj(t.cam('clube_a', 'lider_a', 'f3'));
select t.como('lider_a');
select public.rede_publicar('foto_clube', 'Comunidade em analise', t.cam('clube_a', 'lider_a', 'f1'), 'Grupo no acampamento', null, null, 'comunidade');
select t.recuar(10);
select public.rede_publicar('foto_clube', 'So do clube', t.cam('clube_a', 'lider_a', 'f2'), 'Grupo do clube');
select t.recuar(10);
select public.rede_publicar('foto_clube', 'Outra da Comunidade', t.cam('clube_a', 'lider_a', 'f3'), 'Outro grupo', null, null, 'comunidade');
reset role;
insert into t.ids (chave, id) select 'p_analise', id from public.comunidade_posts where foto_path = t.cam('clube_a', 'lider_a', 'f1');
insert into t.ids (chave, id) select 'p_clube', id from public.comunidade_posts where foto_path = t.cam('clube_a', 'lider_a', 'f2');
insert into t.ids (chave, id) select 'p_outra', id from public.comunidade_posts where foto_path = t.cam('clube_a', 'lider_a', 'f3');
\o

select t.eq('preparo: foto da Comunidade em analise', (select status from public.comunidade_posts where id = t.id('p_analise')), 'em_analise');
select t.eq('preparo: foto do Meu Clube publicada direto', (select status from public.comunidade_posts where id = t.id('p_clube')), 'publicado');

-- =============================================================================
--  1. Estrutura e grants
-- =============================================================================
select t.eq('RPC: authenticated executa, anon NAO, security definer, search_path vazio, volatil',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_comunidade_foto_assinar'
      and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and p.provolatile = 'v' and coalesce(p.proconfig, '{}') @> array['search_path=""']), 1::bigint);
select t.eq('a policy de leitura do bucket agora e STABLE (nao grava nada)',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_comunidade_pode_ver_foto'
      and p.provolatile = 's' and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']), 1::bigint);
select t.eq('a funcao da policy nao referencia mais o registro do admin',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_comunidade_pode_ver_foto'
      and (p.prosrc ilike '%plataforma_acesso%' or p.prosrc ilike '%eh_admin_plataforma%')), 0::bigint);
select t.eq('log: colunas = as antigas + bucket + contexto (nada de url/token/caminho fisico)',
  (select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'plataforma_acesso_log'),
  'admin_user_id,bucket,contexto,id,item_club_id,item_id,item_tipo,o_que,quando');
select t.eq('log: RLS ligado, sem grant para anon/authenticated, com a guarda de manutencao',
  (select count(*) from pg_class c where c.oid = 'public.plataforma_acesso_log'::regclass and c.relrowsecurity
      and not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = c.relname
                        and g.grantee in ('anon', 'authenticated', 'PUBLIC'))
      and exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'zz_manutencao_guarda')), 1::bigint);

-- =============================================================================
--  2. LISTAR nao registra (e o admin nao ganha leitura direta no Storage)
-- =============================================================================
select t.como('admin_134');
select t.eq('admin lista o bucket inteiro: nenhum arquivo da Comunidade (leitura direta fechada)',
  t.nv($q$select count(*) from storage.objects where bucket_id = 'comunidade'$q$), 0::bigint);
select t.eq('...nem por nome exato (em analise)', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f1'))), 0::bigint);
select t.eq('...nem o item "clube"', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f2'))), 0::bigint);
select t.eq('...a funcao da policy diz nao para o admin', t.txt(format($q$select public._comunidade_pode_ver_foto(%L)::text$q$, t.cam('clube_a', 'lider_a', 'f1'))), 'false');
reset role;
select t.eq('listar/ler pelo Storage NAO gerou nenhuma linha no log', t.nlog_total(), 0::bigint);

-- =============================================================================
--  3. ASSINAR registra EXATAMENTE 1 linha por chamada
-- =============================================================================
select t.como('admin_134');
select t.eq('admin assina a foto em analise: ok e devolve o caminho do item',
  t.txt(format($q$select (r->>'ok') || '|' || (r->>'path') from (select public.admin_comunidade_foto_assinar('post', %L) r) x$q$, t.id('p_analise'))),
  'true|' || t.cam('clube_a', 'lider_a', 'f1'));
reset role;
select t.eq('1 assinatura => 1 linha', t.nlog('admin_134', t.id('p_analise')), 1::bigint);
select t.como('admin_134');
select t.eq('devolve bucket, contexto e TTL curto', t.txt(format($q$select (r->>'bucket') || '|' || (r->>'contexto') || '|' || (r->>'ttl_segundos') from (select public.admin_comunidade_foto_assinar('post', %L) r) x$q$, t.id('p_analise'))), 'comunidade|em_analise|60');
select t.eq('3a assinatura seguida (mesmo item, mesmo minuto)', t.txt(format($q$select public.admin_comunidade_foto_assinar('post', %L)->>'ok'$q$, t.id('p_analise'))), 'true');
reset role;
select t.eq('3 assinaturas => 3 linhas (1 por assinatura, sem dedupe)', t.nlog('admin_134', t.id('p_analise')), 3::bigint);
select t.eq('a linha identifica admin, item, clube de origem, bucket, contexto e quando',
  (select count(*) from public.plataforma_acesso_log l where l.admin_user_id = t.id('admin_134') and l.o_que = 'foto_assinada'
      and l.item_tipo = 'post' and l.item_id = t.id('p_analise') and l.item_club_id = t.id('clube_a')
      and l.bucket = 'comunidade' and l.contexto = 'em_analise' and l.quando > now() - interval '1 minute'), 3::bigint);
select t.ok('o log NAO contem URL, token, JWT nem o caminho do arquivo',
  not exists (select 1 from public.plataforma_acesso_log l
               where l::text ~* '(https?:|token|eyJ[A-Za-z0-9_-]{10,}|object/sign|\.webp|\.jpg)' or l::text like '%' || t.id('lider_a')::text || '%'));

-- denunciada na Comunidade tambem entra no contexto (contexto = denunciado quando nao esta em analise)
select t.como('lider_a');
select public.comunidade_moderar('post', t.id('p_analise'), 'aprovar_foto');
reset role;
select t.como('admin_134');
select t.throws('aprovada e sem denuncia: fora do contexto => negado', format($q$select public.admin_comunidade_foto_assinar('post', %L)$q$, t.id('p_analise')), 'não encontrado');
reset role;
select t.eq('...e a negativa nao registrou nada', t.nlog('admin_134', t.id('p_analise')), 3::bigint);
select t.como('lider_b');
select t.eq('(aprovada) outro clube abre a Comunidade PUBLICADA pelo Storage (regra do feed)', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f1'))), 1::bigint);
select t.eq('B denuncia a foto da Comunidade (publicada)', t.txt(format($q$select public.comunidade_denunciar('post', %L, 'imagem')->>'ok'$q$, t.id('p_analise'))), 'true');
select t.como('admin_134');
select t.eq('denunciada: volta ao contexto e assina', t.txt(format($q$select public.admin_comunidade_foto_assinar('post', %L)->>'path'$q$, t.id('p_analise'))), t.cam('clube_a', 'lider_a', 'f1'));
reset role;
select t.eq('...contexto registrado como denunciado ou em analise, 4a linha', t.nlog('admin_134', t.id('p_analise')), 4::bigint);
select t.ok('...contexto da 4a linha = denunciado (post ja publicado, denuncia pendente)',
  exists (select 1 from public.plataforma_acesso_log l where l.item_id = t.id('p_analise') and l.contexto = 'denunciado'));

-- outro item em analise: contexto proprio e 1 linha propria
select t.como('admin_134');
select t.eq('outra foto em analise assina', t.txt(format($q$select public.admin_comunidade_foto_assinar('post', %L)->>'contexto'$q$, t.id('p_outra'))), 'em_analise');
reset role;
select t.eq('...1 linha para ela', t.nlog('admin_134', t.id('p_outra')), 1::bigint);

-- =============================================================================
--  4. Fora do contexto => negado e sem log
-- =============================================================================
select t.como('pais_a');
select public.comunidade_autorizar(t.id('membro_a'), true);
select t.como('membro_a');
select t.eq('desbravador autorizado do mesmo clube abre a foto do Meu Clube (antes da denuncia)', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f2'))), 1::bigint);
select t.como('instrutor_a');
select t.eq('colega denuncia o post do Meu Clube', t.txt(format($q$select public.comunidade_denunciar('post', %L, 'outro')->>'ok'$q$, t.id('p_clube'))), 'true');
select t.como('admin_134');
select t.throws('post do Meu Clube (alcance clube), MESMO denunciado: negado', format($q$select public.admin_comunidade_foto_assinar('post', %L)$q$, t.id('p_clube')), 'não encontrado');
select t.throws('tipo comentario nao e foto: negado', format($q$select public.admin_comunidade_foto_assinar('comentario', %L)$q$, t.id('p_analise')), 'não encontrado');
select t.throws('tipo inventado: negado', format($q$select public.admin_comunidade_foto_assinar('perfil', %L)$q$, t.id('p_analise')), 'não encontrado');
select t.throws('id inexistente: negado', $q$select public.admin_comunidade_foto_assinar('post', gen_random_uuid())$q$, 'não encontrado');
select t.throws('id nulo: negado', $q$select public.admin_comunidade_foto_assinar('post', null)$q$, 'não encontrado');
select t.throws('tipo nulo: negado', format($q$select public.admin_comunidade_foto_assinar(null, %L)$q$, t.id('p_analise')), 'não encontrado');
reset role;
select t.eq('nenhuma dessas negativas gerou linha (total = 5: 4 do p_analise + 1 do p_outra)', t.nlog_total(), 5::bigint);

-- foto sem arquivo no Storage / foto ja apagada: erro claro e sem log
select t.obj(t.cam('clube_a', 'lider_a', 'f4'));
select t.recuar(10);
select t.como('lider_a');
select t.eq('lider A publica outra foto na Comunidade', t.txt(format($q$select public.rede_publicar('foto_clube', 'Sem arquivo depois', %L, 'Grupo', null, null, 'comunidade')->>'status'$q$, t.cam('clube_a', 'lider_a', 'f4'))), 'em_analise');
reset role;
insert into t.ids (chave, id) select 'p_sem_arq', id from public.comunidade_posts where foto_path = t.cam('clube_a', 'lider_a', 'f4');
-- (o Storage nao deixa apagar linha direto: simula o arquivo sumido apontando o post para um nome sem objeto)
update public.comunidade_posts set foto_path = foto_path || '.sumido' where id = t.id('p_sem_arq');
select t.como('admin_134');
select t.throws('arquivo ausente do Storage: erro claro', format($q$select public.admin_comunidade_foto_assinar('post', %L)$q$, t.id('p_sem_arq')), 'não tem foto disponível');
reset role;
select t.eq('...sem linha de log (so se registra o que existe)', t.nlog('admin_134', t.id('p_sem_arq')), 0::bigint);

-- =============================================================================
--  5. Nao-admin e anon
-- =============================================================================
select t.como('lider_a');
select t.throws('diretoria do clube NAO usa a RPC de admin', format($q$select public.admin_comunidade_foto_assinar('post', %L)$q$, t.id('p_outra')), 'Sem permissão');
select t.como('membro_a');
select t.throws('desbravador NAO usa a RPC', format($q$select public.admin_comunidade_foto_assinar('post', %L)$q$, t.id('p_outra')), 'Sem permissão');
select t.como('lider_b');
select t.throws('diretoria de OUTRO clube NAO usa a RPC', format($q$select public.admin_comunidade_foto_assinar('post', %L)$q$, t.id('p_outra')), 'Sem permissão');
select t.como_anon();
select t.throws('anon NAO executa a RPC', format($q$select public.admin_comunidade_foto_assinar('post', %L)$q$, t.id('p_outra')));
reset role;
select t.eq('nada disso gerou linha (total continua 5)', t.nlog_total(), 5::bigint);

-- =============================================================================
--  6. O log e append-only
-- =============================================================================
select t.throws('log: update falha', $q$update public.plataforma_acesso_log set o_que = 'x'$q$, 'não se altera');
select t.throws('log: delete falha', $q$delete from public.plataforma_acesso_log$q$, 'não se altera');
select t.throws('log: truncate falha', $q$truncate public.plataforma_acesso_log$q$, 'não se altera');
select t.como('admin_134');
select t.eq('admin nao le o log direto (sem grant)', t.nv($q$select count(*) from public.plataforma_acesso_log$q$), 0::bigint);
select t.throws('admin nao insere no log direto', $q$insert into public.plataforma_acesso_log (admin_user_id, o_que) values (auth.uid(), 'forjado')$q$);
reset role;

-- =============================================================================
--  7. Fail-closed: log indisponivel => nada autorizado
-- =============================================================================
create function t.falha_log() returns trigger language plpgsql as $$ begin raise exception 'log indisponivel (teste)'; end $$;
create trigger t_falha_log before insert on public.plataforma_acesso_log for each row execute function t.falha_log();
select t.como('admin_134');
select t.throws('log falha => a RPC falha (nao devolve caminho sem registrar)', format($q$select public.admin_comunidade_foto_assinar('post', %L)$q$, t.id('p_outra')), 'log indisponivel');
reset role;
drop trigger t_falha_log on public.plataforma_acesso_log;
select t.eq('...e nada foi gravado', t.nlog_total(), 5::bigint);

-- =============================================================================
--  8. A policy continua servindo membros (nao quebrou o uso normal)
-- =============================================================================
select t.como('lider_a');
select t.eq('autor abre a propria foto', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f1'))), 1::bigint);
select t.como('lider_b');
select t.eq('outro clube NAO abre a que segue em analise', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f3'))), 0::bigint);
select t.eq('...nem a do Meu Clube de A', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f2'))), 0::bigint);
select t.como('lider_a');
select t.eq('diretoria do clube abre as fotos do proprio clube (em analise)', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f3'))), 1::bigint);
select t.como('admin_134');
select t.eq('o admin da plataforma segue sem ler nenhuma delas pelo Storage', t.nv($q$select count(*) from storage.objects where bucket_id = 'comunidade'$q$), 0::bigint);
reset role;
select t.eq('...e a leitura de membros/admin pelo Storage nunca escreve no log (total 5)', t.nlog_total(), 5::bigint);

select t.fim();
rollback;
