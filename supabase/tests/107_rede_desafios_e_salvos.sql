-- REDE DBV (migrations 471–472) — desafios, participação, publicações por tipo, salvos, feed com abas,
-- moderação "Ocultar" e VIDA ÚTIL das fotos.
-- Prova: só o admin da plataforma cria desafio; participação única por pessoa (e pode voltar se o post
-- saiu do ar); pontos da rede só no perfil (nunca em public.pontos); salvos só do próprio usuário;
-- triagem vale também na descrição da imagem; conquista exige categoria; aba "Meu clube";
-- tudo bloqueado com o recurso desligado; anon sem acesso; bucket 300 KB com WebP; foto expira
-- em 90 dias e entra na fila de apagar (e recusada/removida/apagada na hora); órfã marcada;
-- só o service_role lê/confirma a fila; o log conta arquivos e bytes.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
set local session_replication_role = replica;
update public.profiles set created_at = now() - interval '60 days'
 where id in (t.id('membro_a'), t.id('membro_b'), t.id('lider_a'), t.id('lider_b'));
set local session_replication_role = origin;
select t.mk('admin_rede', 'Admin Plataforma', 'diretoria', 'ativo', 'clube_b');
insert into public.platform_admins (user_id, papel) values (t.id('admin_rede'), 'operacao');
create function t.recuar(p_min int) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.comunidade_posts set created_at = created_at - make_interval(mins => p_min);
  update public.comunidade_bloqueios set created_at = created_at - make_interval(mins => p_min);
end $$;
create function t.pontos_clube(p_chave text) returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.pontos where usuario_id = t.id(p_chave);
$$;
create table t.base_pontos as select count(*) as n from public.pontos where usuario_id = t.id('membro_a');
reset role;
\o

-- =============================================================================
--  1. Desafios: só o admin da plataforma cria
-- =============================================================================
select t.como('lider_a');
select t.throws('diretoria NÃO cria desafio', $q$select public.admin_rede_desafio_salvar(null, 'Meu desafio', 'x', 10, now(), now() + interval '7 days', true)$q$, 'Sem permissão');
select t.bloqueado('...nem direto na tabela', $q$insert into public.rede_desafios (titulo, fim) values ('Hack', now() + interval '1 day')$q$);
select t.como('membro_a');
select t.throws('desbravador NÃO cria desafio', $q$select public.admin_rede_desafio_salvar(null, 'Meu desafio', 'x', 10, now(), now() + interval '7 days', true)$q$, 'Sem permissão');
select t.como('admin_rede');
select t.throws('fim antes do início é recusado', $q$select public.admin_rede_desafio_salvar(null, 'Errado', 'x', 10, now(), now() - interval '1 day', true)$q$, 'fim precisa');
select t.eq('admin da plataforma cria o desafio da semana',
  t.n($q$select jsonb_array_length(public.admin_rede_desafio_salvar(null, 'Foto na natureza', 'Tire uma foto na natureza', 50, now() - interval '1 hour', now() + interval '6 days', true))$q$), 1::bigint);
select public.admin_rede_desafio_salvar(null, 'Nó de escota', 'Aprenda o nó', 20, now() - interval '3 days', now() + interval '10 days', true);
select public.admin_rede_desafio_salvar(null, 'Desafio antigo', 'Já acabou', 20, now() - interval '30 days', now() - interval '20 days', true);
select public.admin_rede_desafio_salvar(null, 'Desafio inativo', 'Desligado', 20, now() - interval '1 day', now() + interval '5 days', false);
reset role;
select t.eq('criação auditada', (select count(*) from public.platform_admin_audit where acao = 'rede_desafio_salvar'), 4::bigint);
insert into t.ids (chave, id) select 'des_semana', id from public.rede_desafios where titulo = 'Foto na natureza';
insert into t.ids (chave, id) select 'des_no', id from public.rede_desafios where titulo = 'Nó de escota';
insert into t.ids (chave, id) select 'des_antigo', id from public.rede_desafios where titulo = 'Desafio antigo';

-- =============================================================================
--  2. Recurso desligado: tudo bloqueado
-- =============================================================================
select t.como('membro_a');
select t.throws('desligado: desafios bloqueados', $q$select public.rede_desafios()$q$, 'não está liberada');
select t.throws('desligado: publicar na rede bloqueado', $q$select public.rede_publicar('livre', 'oi')$q$, 'não está liberada');
select t.throws('desligado: salvos bloqueados', $q$select public.rede_perfil_posts(null, 'salvos')$q$, 'não está liberada');
select t.throws('desligado: feed bloqueado', $q$select public.rede_feed('meu_clube')$q$, 'não está liberada');

select t.como('admin_rede');
select public.admin_recurso_do_clube_definir(t.id('clube_a'), 'comunidade', true);
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
select t.como('pais_a');
select public.comunidade_autorizar(t.id('membro_a'), true);
select t.como('pais_b');
select public.comunidade_autorizar(t.id('membro_b'), true);
reset role;

-- =============================================================================
--  3. anon
-- =============================================================================
select t.como_anon();
select t.throws('anon não lista desafios', $q$select public.rede_desafios()$q$);
select t.throws('anon não salva', $q$select public.rede_salvar(gen_random_uuid(), true)$q$);
reset role;
select t.eq('tabelas novas com RLS e sem grant',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and c.relname in ('rede_desafios', 'rede_desafio_participacoes', 'rede_salvos', 'rede_fotos_para_apagar', 'rede_limpeza_log')
      and c.relrowsecurity
      and not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = c.relname
                        and g.grantee in ('anon', 'authenticated', 'PUBLIC'))), 5::bigint);
select t.eq('as tabelas novas têm a guarda do modo manutenção',
  (select count(distinct c.relname) from pg_trigger g join pg_class c on c.oid = g.tgrelid
    where c.relname in ('rede_desafios', 'rede_desafio_participacoes', 'rede_salvos', 'rede_fotos_para_apagar', 'rede_limpeza_log', 'rede_autorizacao_imagem')
      and g.tgname = 'zz_manutencao_guarda'), 6::bigint);

-- =============================================================================
--  4. Desafio da semana e participação única
-- =============================================================================
select t.como('membro_a');
select t.eq('desafio da semana = o aberto mais recente', t.txt($q$select public.rede_desafios()->'semana'->>'titulo'$q$), 'Foto na natureza');
select t.eq('outros: só os abertos e ativos (sem o antigo e o inativo)', t.txt($q$select string_agg(e->>'titulo', ',') from jsonb_array_elements(public.rede_desafios()->'outros') e$q$), 'Nó de escota');
select t.ok('dias restantes calculados', t.n($q$select (public.rede_desafios()->'semana'->>'dias_restantes')::bigint$q$) between 5 and 6);
select t.throws('desafio encerrado não aceita participação', format($q$select public.rede_publicar('desafio', 'Fiz!', null, null, %L)$q$, t.id('des_antigo')), 'não está aberto');
select t.throws('desafio_id só em publicação de desafio', format($q$select public.rede_publicar('livre', 'Fiz!', null, null, %L)$q$, t.id('des_no')), 'Só publicações de desafio');
select t.eq('participa do desafio', t.txt(format($q$select public.rede_publicar('desafio', 'Aprendi o nó!', null, null, %L)->>'ok'$q$, t.id('des_no'))), 'true');
select t.throws('participação ÚNICA por pessoa por desafio', format($q$select public.rede_publicar('desafio', 'De novo!', null, null, %L)$q$, t.id('des_no')), 'já participou');
select t.eq('lista marca "participei"', t.txt($q$select e->>'participei' from jsonb_array_elements(public.rede_desafios()->'outros') e$q$), 'true');
select t.eq('pontos da rede no MEU perfil', t.txt($q$select public.rede_perfil()->>'pontos'$q$), '20');
reset role;
select t.eq('NÃO mistura com os pontos/ranking do clube (nenhum lançamento novo)', t.pontos_clube('membro_a'), (select n from t.base_pontos));
select t.eq('post ficou vinculado ao desafio', (select count(*) from public.comunidade_posts where autor_id = t.id('membro_a') and tipo = 'desafio' and desafio_id = t.id('des_no')), 1::bigint);
insert into t.ids (chave, id) select 'post_desafio_a', id from public.comunidade_posts where autor_id = t.id('membro_a') and tipo = 'desafio';
-- o post saiu do ar (apagado pela própria criança): pode participar de novo
select t.recuar(5);
select t.como('membro_a');
select public.comunidade_apagar('post', t.id('post_desafio_a'));
select t.eq('post apagado: pontos do desafio deixam de contar', t.txt($q$select public.rede_perfil()->>'pontos'$q$), '0');
select t.eq('...e pode participar de novo', t.txt(format($q$select public.rede_publicar('desafio', 'Agora sim!', null, null, %L)->>'ok'$q$, t.id('des_no'))), 'true');
reset role;
select t.eq('continua 1 participação só', (select count(*) from public.rede_desafio_participacoes where usuario_id = t.id('membro_a')), 1::bigint);
select t.como('pais_a');
select t.throws('responsável não participa (não publica)', format($q$select public.rede_publicar('desafio', 'oi', null, null, %L)$q$, t.id('des_semana')), 'não publicam');

-- =============================================================================
--  5. Tipos: conquista, texto até 300, triagem na descrição da imagem
-- =============================================================================
select t.recuar(5);
select t.como('membro_b');
select t.throws('conquista sem categoria é recusada', $q$select public.rede_publicar('conquista', 'Concluí a classe Amigo')$q$, 'tipo da conquista');
select t.eq('conquista categorizada', t.txt($q$select public.rede_publicar('conquista', 'Concluí a classe Amigo', null, null, null, 'classe')->'post'->>'conquista'$q$), 'classe');
select t.throws('texto acima de 300 é recusado', format($q$select public.rede_publicar('livre', %L)$q$, repeat('a', 301)), 'até 300');
select t.eq('triagem continua valendo na rede', t.txt($q$select public.rede_publicar('livre', 'me chama no zap')->>'motivo'$q$), 'contato');
select t.eq('perfil: 1 conquista', t.txt($q$select public.rede_perfil()->>'conquistas'$q$), '1');
select t.eq('aba Conquistas do perfil', t.n($q$select jsonb_array_length(public.rede_perfil_posts(null, 'conquistas')->'itens')$q$), 1::bigint);
select t.eq('aba Desafios de outra pessoa', t.n(format($q$select jsonb_array_length(public.rede_perfil_posts(%L, 'desafios')->'itens')$q$, t.id('membro_a'))), 1::bigint);
reset role;

-- =============================================================================
--  6. Feed: Todos x Meu clube
-- =============================================================================
select t.como('membro_b');
select t.ok('Todos: vê o clube A', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('todos')->'itens') e where e->>'clube_id' = %L$q$, t.id('clube_a'))) >= 1);
select t.eq('Meu clube: só o clube B', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e where e->>'clube_id' <> %L$q$, t.id('clube_b'))), 0::bigint);
select t.throws('filtro inventado é recusado', $q$select public.rede_feed('outro')$q$, 'Filtro inválido');

-- =============================================================================
--  7. Salvos: só do próprio usuário
-- =============================================================================
reset role;
insert into t.ids (chave, id) select 'post_a_vivo', id from public.comunidade_posts where autor_id = t.id('membro_a') and status = 'publicado' limit 1;
select t.como('membro_b');
select t.eq('salva', t.txt(format($q$select public.rede_salvar(%L, true)->>'eu_salvei'$q$, t.id('post_a_vivo'))), 'true');
select t.eq('salvar de novo não duplica', t.txt(format($q$select public.rede_salvar(%L, true)->>'ok'$q$, t.id('post_a_vivo'))), 'true');
select t.eq('feed marca "eu salvei"', t.txt(format($q$select e->>'eu_salvei' from jsonb_array_elements(public.rede_feed()->'itens') e where e->>'id' = %L$q$, t.id('post_a_vivo'))), 'true');
select t.eq('aparece nos MEUS salvos', t.n($q$select jsonb_array_length(public.rede_perfil_posts(null, 'salvos')->'itens')$q$), 1::bigint);
select t.como('membro_a');
select t.throws('ninguém vê os salvos de outra pessoa', format($q$select public.rede_perfil_posts(%L, 'salvos')$q$, t.id('membro_b')), 'só seus');
select t.eq('...e os meus salvos estão vazios', t.n($q$select jsonb_array_length(public.rede_perfil_posts(null, 'salvos')->'itens')$q$), 0::bigint);
select t.eq('eu_salvei é por pessoa', t.txt(format($q$select e->>'eu_salvei' from jsonb_array_elements(public.rede_feed()->'itens') e where e->>'id' = %L$q$, t.id('post_a_vivo'))), 'false');
select t.bloqueado('ninguém lê rede_salvos direto', $q$select * from public.rede_salvos$q$);
select t.como('membro_b');
select t.eq('tira dos salvos', t.txt(format($q$select public.rede_salvar(%L, false)->>'eu_salvei'$q$, t.id('post_a_vivo'))), 'false');
select t.eq('...lista vazia', t.n($q$select jsonb_array_length(public.rede_perfil_posts(null, 'salvos')->'itens')$q$), 0::bigint);
reset role;

-- =============================================================================
--  8. Moderação: Ocultar (conteúdo denunciado que ficou no ar)
-- =============================================================================
insert into public.comunidade_denuncias (club_id, alvo_tipo, alvo_id, denunciante_id, motivo)
values (t.id('clube_a'), 'post', t.id('post_a_vivo'), t.id('membro_b'), 'outro');
select t.como('lider_b');
select t.throws('diretoria de OUTRO clube não oculta', format($q$select public.comunidade_moderar('post', %L, 'ocultar')$q$, t.id('post_a_vivo')), 'não encontrado');
select t.como('lider_a');
select t.eq('diretoria oculta', t.txt(format($q$select public.comunidade_moderar('post', %L, 'ocultar')->>'status'$q$, t.id('post_a_vivo'))), 'oculto_denuncia');
select t.throws('não oculta o que já está oculto', format($q$select public.comunidade_moderar('post', %L, 'ocultar')$q$, t.id('post_a_vivo')), 'Só dá para ocultar');
select t.eq('Manter (= restaurar) volta ao ar', t.txt(format($q$select public.comunidade_moderar('post', %L, 'restaurar')->>'status'$q$, t.id('post_a_vivo'))), 'publicado');
reset role;
select t.eq('ocultar registrado no histórico pela diretoria', (select count(*) from public.comunidade_moderacao_log where alvo_id = t.id('post_a_vivo') and acao = 'ocultado_por_denuncia' and via = 'diretoria'), 1::bigint);
select t.eq('ocultar NÃO dá aviso (strike) ao autor', (select count(*) from public.comunidade_avisos where usuario_id = t.id('membro_a')), 0::bigint);

-- =============================================================================
--  9. Armazenamento mínimo e VIDA ÚTIL das fotos
-- =============================================================================
select t.eq('bucket comunidade: privado, JPEG/WebP, até 300 KB',
  (select count(*) from storage.buckets where id = 'comunidade' and not public
      and allowed_mime_types @> array['image/webp'] and file_size_limit = 307200), 1::bigint);
select t.recuar(5);
insert into t.ids values ('foto1', gen_random_uuid()), ('foto2', gen_random_uuid()), ('orfa', gen_random_uuid());
create temp table caminhos as select
  t.id('clube_b')::text || '/' || t.id('membro_b')::text || '/' || t.id('foto1')::text || '.webp' as p1,
  t.id('clube_b')::text || '/' || t.id('membro_b')::text || '/' || t.id('foto2')::text || '.webp' as p2,
  t.id('clube_b')::text || '/' || t.id('membro_b')::text || '/' || t.id('orfa')::text || '.webp' as orfa;
grant select on caminhos to public;
select t.como('membro_b');
select t.permitido('envia WebP no caminho certo', $q$insert into storage.objects (bucket_id, name, owner, metadata) select 'comunidade', p1, auth.uid(), '{"size": 120000}' from caminhos$q$);
select t.permitido('...outra', $q$insert into storage.objects (bucket_id, name, owner, metadata) select 'comunidade', p2, auth.uid(), '{"size": 90000}' from caminhos$q$);
select t.eq('publica foto WebP com descrição (em análise)', t.txt($q$select public.rede_publicar('foto', 'Trilha!', (select p1 from caminhos), 'Grupo numa trilha')->>'status'$q$), 'em_analise');
select t.eq('descrição da imagem passa pela triagem', t.txt($q$select public.rede_publicar('foto', 'Oi', (select p2 from caminhos), 'me chama no zap')->>'motivo'$q$), 'contato');
reset role;
select t.eq('descrição guardada como alt', (select foto_alt from public.comunidade_posts where foto_path = (select p1 from caminhos)), 'Grupo numa trilha');
select t.ok('foto nasce com validade de 90 dias',
  (select foto_expira_em between now() + interval '89 days' and now() + interval '91 days' from public.comunidade_posts where foto_path = (select p1 from caminhos)));
insert into t.ids (chave, id) select 'post_foto', id from public.comunidade_posts where foto_path = (select p1 from caminhos);
select t.como('lider_b');
select public.comunidade_moderar('post', t.id('post_foto'), 'aprovar_foto');
reset role;
select t.eq('aprovada: ainda não está na fila de apagar', (select count(*) from public.rede_fotos_para_apagar where caminho = (select p1 from caminhos)), 0::bigint);

-- EXPIRADA: passa dos 90 dias
update public.comunidade_posts set foto_expira_em = now() - interval '1 minute' where id = t.id('post_foto');
select t.como('membro_a');
select t.eq('expirada: o post continua no feed', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed()->'itens') e where e->>'id' = %L$q$, t.id('post_foto'))), 1::bigint);
select t.eq('...sem a foto', t.txt(format($q$select coalesce(e->>'foto', 'nula') || '|' || (e->>'foto_expirada') from jsonb_array_elements(public.rede_feed()->'itens') e where e->>'id' = %L$q$, t.id('post_foto'))), 'nula|true');
select t.eq('...e o arquivo não abre mais para os outros', t.nv($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = (select p1 from caminhos)$q$), 0::bigint);
select t.como('membro_a');
select t.throws('usuário NÃO roda a marcação', $q$select public.rede_marcar_fotos_para_apagar()$q$);
select t.throws('usuário NÃO lê a fila', $q$select * from public.rede_fotos_pendentes()$q$);
select t.throws('usuário NÃO confirma apagamento', $q$select public.rede_fotos_confirmar(array[gen_random_uuid()])$q$);
reset role;
-- a órfã: subiu há 2 dias e não virou post
insert into storage.objects (bucket_id, name, metadata, created_at) select 'comunidade', orfa, '{"size": 50000}', now() - interval '2 days' from caminhos;
select t.como_cron();
select t.eq('a rotina diária marca a expirada e a órfã', public.rede_marcar_fotos_para_apagar(), 2);
reset role;
select t.eq('expirada na fila com o tamanho', (select motivo || '|' || bytes from public.rede_fotos_para_apagar where caminho = (select p1 from caminhos)), 'expirada|120000');
select t.eq('órfã na fila', (select motivo from public.rede_fotos_para_apagar where caminho = (select orfa from caminhos)), 'orfa');
select t.como_cron();
select t.eq('rodar de novo não duplica', public.rede_marcar_fotos_para_apagar(), 0);
reset role;

-- recusada / apagada: entra na fila NA HORA (gatilho)
select t.recuar(5);
select t.como('membro_b');
select public.rede_publicar('foto', 'Outra', (select p2 from caminhos));
reset role;
insert into t.ids (chave, id) select 'post_foto2', id from public.comunidade_posts where foto_path = (select p2 from caminhos);
select t.como('lider_b');
select public.comunidade_moderar('post', t.id('post_foto2'), 'recusar_foto');
reset role;
select t.eq('recusada entra na fila na hora', (select motivo from public.rede_fotos_para_apagar where caminho = (select p2 from caminhos)), 'recusada');

-- a Edge Function (service_role) lê e confirma; o log conta arquivos e bytes
select t.como_service();
set local role service_role;
select t.eq('service_role lê a fila', (select count(*) from public.rede_fotos_pendentes()), 3::bigint);
select t.eq('confirmar devolve arquivos/bytes liberados',
  (select public.rede_fotos_confirmar((select array_agg(id) from public.rede_fotos_pendentes() where caminho <> (select p2 from caminhos)))::text),
  '{"bytes": 170000, "arquivos": 2}');
reset role;
select t.ok('post marcado com a foto apagada', (select foto_apagada_em is not null from public.comunidade_posts where id = t.id('post_foto')));
select t.eq('log da rodada (edge) com arquivos e bytes', (select arquivos || '|' || bytes from public.rede_limpeza_log where origem = 'edge'), '2|170000');
select t.como('admin_rede');
select t.eq('admin da plataforma vê quanto foi liberado', t.txt($q$select public.admin_rede_armazenamento()->>'liberados_bytes'$q$), '170000');
select t.como('lider_a');
select t.throws('diretoria não vê o painel de armazenamento', $q$select public.admin_rede_armazenamento()$q$, 'Sem permissão');
reset role;
select t.eq('cron diário agendado', (select count(*) from cron.job where jobname = 'rede-limpar-fotos' and command like '%rede_limpeza_rotina%'), 1::bigint);

select t.fim();
rollback;
