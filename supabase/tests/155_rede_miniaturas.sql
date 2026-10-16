-- Miniaturas da Rede (migration 555): só o autor registra a miniatura da PRÓPRIA foto (nome derivado, arquivo existente);
-- a limpeza não trata a miniatura como órfã e a apaga junto com a foto; envio aceita o sufixo -min; leitura segue as regras do post.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
insert into public.comunidade_posts (id, club_id, autor_id, autor_papel, legenda, status, foto_path)
values (public.curriculo_uuid('t155:post'), t.id('clube_a'), t.id('membro_a'), 'desbravador', 'Acampamento', 'publicado',
        t.id('clube_a') || '/' || t.id('membro_a') || '/11111111-1111-1111-1111-111111111111.webp');
insert into storage.objects (bucket_id, name, metadata) values
  ('comunidade', t.id('clube_a') || '/' || t.id('membro_a') || '/11111111-1111-1111-1111-111111111111-min.webp', '{"size": 20000}');
\o
select set_config('t155.post', public.curriculo_uuid('t155:post')::text, true);
select set_config('t155.min', t.id('clube_a') || '/' || t.id('membro_a') || '/11111111-1111-1111-1111-111111111111-min.webp', true);

-- as três funções foram ajustadas
select t.ok('envio aceita o sufixo -min', strpos(pg_get_functiondef('public._comunidade_pode_enviar_foto(text)'::regprocedure), '(-min)?\.(jpg|webp)$') > 0);
select t.ok('leitura trata a miniatura como a foto do post', pg_get_functiondef('public._comunidade_pode_ver_foto(text)'::regprocedure) like '%p_name in (foto_path, foto_min_path)%');
select t.ok('limpeza: miniatura não é órfã', pg_get_functiondef('public.rede_marcar_fotos_para_apagar()'::regprocedure) like '%o.name in (p.foto_path, p.foto_min_path)%');

-- quem pode registrar
select t.como('membro_b');
select t.eq('outra pessoa NÃO registra miniatura no post alheio', (public.rede_post_miniatura(current_setting('t155.post')::uuid, current_setting('t155.min')))::int::bigint, 0::bigint);
reset role;
select t.como('membro_a');
select t.eq('nome que não deriva da própria foto é recusado', (public.rede_post_miniatura(current_setting('t155.post')::uuid, t.id('clube_a') || '/' || t.id('membro_a') || '/22222222-2222-2222-2222-222222222222-min.webp'))::int::bigint, 0::bigint);
select t.eq('arquivo que não existe é recusado', (public.rede_post_miniatura(current_setting('t155.post')::uuid, replace(current_setting('t155.min'), '-min.webp', '-min.jpg')))::int::bigint, 0::bigint);
select t.eq('autor registra a miniatura da própria foto', (public.rede_post_miniatura(current_setting('t155.post')::uuid, current_setting('t155.min')))::int::bigint, 1::bigint);
reset role;
select t.eq('ficou gravada no post', (select count(*) from public.comunidade_posts where id = current_setting('t155.post')::uuid and foto_min_path = current_setting('t155.min')), 1::bigint);

-- a miniatura não entra como órfã (mesmo velha) e sai junto quando a foto sai
update storage.objects set created_at = now() - interval '3 days' where name = current_setting('t155.min');
select public.rede_marcar_fotos_para_apagar();
select t.eq('miniatura em uso NÃO é marcada como órfã', (select count(*) from public.rede_fotos_para_apagar where caminho = current_setting('t155.min') and motivo = 'orfa'), 0::bigint);
update public.comunidade_posts set status = 'removido' where id = current_setting('t155.post')::uuid;
select t.eq('removeu o post: foto E miniatura vão para a fila', (select count(*) from public.rede_fotos_para_apagar where post_id = current_setting('t155.post')::uuid), 2::bigint);

select t.como_anon();
select t.throws('anônimo não registra', format('select public.rede_post_miniatura(%L, %L)', current_setting('t155.post')::uuid, 'x'), 'permission denied');
reset role;

select t.fim();
rollback;
