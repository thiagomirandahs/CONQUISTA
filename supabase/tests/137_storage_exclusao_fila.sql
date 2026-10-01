-- FILA DE EXCLUSÃO DO STORAGE (migration 532) — prevenir NOVOS arquivos órfãos.
-- Prova: apagar atividade (cascade das entregas) / foto do mural / trocar avatar enfileira EXATAMENTE o caminho antigo (e só ele);
-- valor ainda em outra linha da tabela não enfileira; carência respeitada; nova referência => 'mantido'; objeto novo demais espera;
-- caminho forjado (foto_url apontando para arquivo de OUTRA pessoa) NUNCA é excluído (dono do caminho != dono da linha) e não enfileira
-- bucket protegido; funções internas e a fila inacessíveis para anon/authenticated; reserva (duas execuções não pegam o mesmo item,
-- reserva que expira volta); 'excluido' só por confirmação, idempotente; falha registrada, recuo e teto (visível ao admin, sem
-- caminho/dado pessoal); o gatilho nunca derruba a operação do usuário; cron nasce desligado.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin_saas', '{"tipo":"fundador","nome":"Admin da Plataforma"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin_saas'), 'operacao', 'bootstrap de teste');
select t.mk('membro_a2b', 'Membro A2 (outra pessoa)', 'desbravador', 'ativo', 'clube_a', 'A2');

-- objeto de Storage (como postgres: o upload em si é coberto pelos testes 25/104). Padrão: 30 dias de idade.
create function t.obj(p_bucket text, p_nome text, p_idade interval default '30 days') returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into storage.objects (bucket_id, name, metadata, created_at, updated_at)
  values (p_bucket, p_nome, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1000), now() - p_idade, now() - p_idade);
end $$;
create function t.url(p_bucket text, p_nome text) returns text language sql immutable as $$
  select 'https://x.supabase.co/storage/v1/object/public/' || p_bucket || '/' || p_nome $$;
-- caminhos "<bucket>/<caminho>" enfileirados por origem (ordenados)
create function t.fila(p_origem text) returns text language sql security definer set search_path = '' as $$
  select coalesce(string_agg(bucket || '/' || caminho, ',' order by caminho), '') from public.storage_exclusao_fila where origem = p_origem $$;
create function t.est(p_bucket text, p_caminho text) returns text language sql security definer set search_path = '' as $$
  select estado || ':' || coalesce(ultima_mensagem, '') from public.storage_exclusao_fila where bucket = p_bucket and caminho = p_caminho $$;
create function t.existe(p_bucket text, p_nome text) returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from storage.objects where bucket_id = p_bucket and name = p_nome) $$;
-- o que o processador devolve (como service_role), ordenado
create function t.proc(p_lim int default 20) returns text language sql as $$
  select coalesce(string_agg(bucket || '/' || caminho, ',' order by caminho), '') from public._storage_exclusao_processar(p_lim) $$;

-- processa TUDO que está vencido em lotes (a política limita cada chamada a 8: decisão do dono, Fase 9)
create function t.tudo() returns table (bucket text, caminho text) language plpgsql as $$
declare n int; r record;
begin
  loop
    n := 0;
    for r in select * from public._storage_exclusao_processar(50) loop n := n + 1; bucket := r.bucket; caminho := r.caminho; return next; end loop;
    exit when n = 0;
  end loop;
end $$;

-- ---------- cenário 1: atividade apagada (cascade das entregas) ----------
select t.obj('comprovacoes', t.id('membro_a') || '/atividades/1000.jpg');
select t.obj('comprovacoes', t.id('membro_a2b') || '/atividades/2000.jpg');
insert into public.atividades (titulo, pontos, club_id) values ('Atividade Orfa', 5, t.id('clube_a'));
insert into t.ids (chave, id) select 'atv_orfa', id from public.atividades where titulo = 'Atividade Orfa';
insert into public.entregas (atividade_id, usuario_id, texto, foto_url) values
  (t.id('atv_orfa'), t.id('membro_a'), 'e1', t.id('membro_a') || '/atividades/1000.jpg'),
  (t.id('atv_orfa'), t.id('membro_a2b'), 'e2', t.id('membro_a2b') || '/atividades/2000.jpg');

-- ---------- cenário 2: foto do mural (url + thumb, URL pública do Storage) ----------
select t.obj('imagens', 'mural/' || t.id('membro_a') || '-111.jpg');
select t.obj('imagens', 'mural/' || t.id('membro_a') || '-111-thumb.jpg');
insert into public.fotos (url, thumb, legenda, autor_id) values (
  t.url('imagens', 'mural/' || t.id('membro_a') || '-111.jpg'), t.url('imagens', 'mural/' || t.id('membro_a') || '-111-thumb.jpg'), 'F1', t.id('membro_a'));

-- ---------- cenário 3: avatar ----------
select t.obj('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg');
select t.obj('imagens', 'perfis/' || t.id('membro_a') || '-2.jpg');
update public.profiles set foto = t.url('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg') where id = t.id('membro_a');   -- null -> valor: nada a enfileirar

-- ---------- cenário 4: mesmo valor em OUTRA linha da tabela (não enfileira enquanto alguém ainda usa) ----------
select t.obj('comprovacoes', t.id('membro_a') || '/atividades/3000.jpg');
insert into public.atividades (titulo, pontos, club_id) values ('Atividade Dup', 5, t.id('clube_a'));
insert into t.ids (chave, id) select 'atv_dup', id from public.atividades where titulo = 'Atividade Dup';
insert into public.entregas (atividade_id, usuario_id, texto, foto_url) values
  (t.id('atv_dup'), t.id('membro_a'), 'd1', t.id('membro_a') || '/atividades/3000.jpg'),
  (t.id('atv_dup'), t.id('membro_a2b'), 'd2', t.id('membro_a') || '/atividades/3000.jpg');

-- ---------- cenário 5: referência em OUTRA tabela (profiles.foto do membro_b = mesma URL do mural) ----------
select t.obj('imagens', 'mural/' || t.id('membro_b') || '-555.jpg');
update public.profiles set foto = t.url('imagens', 'mural/' || t.id('membro_b') || '-555.jpg') where id = t.id('membro_b');
insert into public.fotos (url, legenda, autor_id) values (t.url('imagens', 'mural/' || t.id('membro_b') || '-555.jpg'), 'F2', t.id('membro_b'));

-- ---------- cenário 6: referência NOVA depois de enfileirar ----------
select t.obj('imagens', 'mural/' || t.id('membro_b') || '-666.jpg');
insert into public.fotos (url, legenda, autor_id) values (t.url('imagens', 'mural/' || t.id('membro_b') || '-666.jpg'), 'F3', t.id('membro_b'));

-- ---------- cenário 7: ATAQUE — membro_b forja foto_url com o arquivo (sem referência) de OUTRA pessoa ----------
select t.obj('comprovacoes', t.id('membro_a') || '/atividades/VITIMA.jpg');
select t.obj('documentos-emitidos', t.id('membro_a') || '/doc.pdf');
select t.obj('publico', 'clube/logo.png');
select t.obj('comprovacoes', t.id('membro_b') || '/atividades/legit-b.jpg');
update public.entregas set status = 'reprovada', foto_url = t.id('membro_b') || '/atividades/legit-b.jpg' where atividade_id = t.id('atv_b') and usuario_id = t.id('membro_b');

-- ---------- cenário 8: objeto NOVO demais (carência do objeto) ----------
select t.obj('imagens', 'mural/' || t.id('membro_a') || '-777.jpg', '1 day');
insert into public.fotos (url, legenda, autor_id) values (t.url('imagens', 'mural/' || t.id('membro_a') || '-777.jpg'), 'F4', t.id('membro_a'));
-- o setup acima (como postgres) já trocou valores que os fixtures tinham (ex.: foto_url da entrega do membro_b): descarta o resíduo
delete from public.storage_exclusao_fila;
reset role;
\o

-- =============================================================================
--  1. Estrutura e fechaduras
-- =============================================================================
select t.eq('tabela com RLS ligado', (select relrowsecurity from pg_class where oid = 'public.storage_exclusao_fila'::regclass), true);
select t.eq('...e SEM nenhuma policy (só service_role/postgres)', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'storage_exclusao_fila'), 0::bigint);
select t.eq('estados válidos: pendente/excluido/mantido/falhou', (select count(*) from pg_constraint where conrelid = 'public.storage_exclusao_fila'::regclass and pg_get_constraintdef(oid) ilike '%pendente%excluido%mantido%falhou%'), 1::bigint);
select t.eq('unique (bucket, caminho)', (select count(*) from pg_constraint where conrelid = 'public.storage_exclusao_fila'::regclass and contype = 'u' and pg_get_constraintdef(oid) ilike '%(bucket, caminho)%'), 1::bigint);
select t.eq('sem dado pessoal na fila: nenhuma coluna de nome/e-mail/legenda/conteúdo',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'storage_exclusao_fila'
    and column_name ~* '(nome|email|legenda|texto|conteudo|descricao|telefone|cpf|gps)'), 0::bigint);
select t.eq('cron "storage-excluir" existe e NASCE DESLIGADO', (select count(*) from cron.job where jobname = 'storage-excluir' and not active), 1::bigint);
select t.eq('...e não existe outro job de exclusão ligado', (select count(*) from cron.job where jobname like 'storage-excluir%' and active), 0::bigint);
select t.eq('política: carência de 7 dias e só 4 buckets elegíveis',
  (public._storage_exclusao_politica() ->> 'carencia_dias') || '|' || (public._storage_exclusao_politica() -> 'buckets_elegiveis')::text,
  '7|["imagens", "comprovacoes", "comunidade", "suporte-anexos"]');
select t.eq('funções internas: nenhuma executável por anon/authenticated',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('_storage_exclusao_politica', '_storage_exclusao_dono_confere', '_storage_exclusao_enfileirar', '_storage_exclusao_gatilho',
                        '_storage_exclusao_processar', '_storage_exclusao_confirmar', 'storage_exclusao_rotina')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0::bigint);
select t.eq('service_role executa processar e confirmar',
  has_function_privilege('service_role', 'public._storage_exclusao_processar(int)', 'execute')
    and has_function_privilege('service_role', 'public._storage_exclusao_confirmar(text, text, boolean, text)', 'execute'), true);
select t.eq('todas as security definer da fila têm search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.proname ~ '^(_storage_exclusao_|storage_exclusao_|admin_storage_exclusao)' and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=""%'), 0::bigint);
select t.eq('reserva usa FOR UPDATE SKIP LOCKED (concorrência)', position('skip locked' in lower(pg_get_functiondef('public._storage_exclusao_processar(int)'::regprocedure))) > 0, true);
select t.eq('a migration instalou a guarda de manutenção na fila', (select count(*) from pg_trigger where tgrelid = 'public.storage_exclusao_fila'::regclass and tgname = 'zz_manutencao_guarda'), 1::bigint);
select t.eq('gatilhos instalados (6 tabelas)', (select count(*) from pg_trigger where tgname like 'zz_storage_exclusao_%' and not tgisinternal), 6::bigint);
-- cada coluna vigiada está no catálogo do GC (senão o GC trataria o arquivo dela como órfão de qualquer jeito)
select t.eq('toda coluna vigiada por gatilho consta no catálogo de referências (531)',
  (select count(*) from (values ('fotos','url'), ('fotos','thumb'), ('entregas','foto_url'), ('missoes_feitas','foto_url'), ('devocional','foto_url'),
                                ('profiles','foto'), ('unidades','emblema'), ('unidades','bandeira')) v(tb, col)
    where not exists (select 1 from public._storage_referencias() r where r.tabela = v.tb and v.col = any (r.colunas))), 0::bigint);
select t.eq('a fila NÃO é referência no catálogo (não mantém arquivo vivo)', (select count(*) from public._storage_referencias() where tabela = 'storage_exclusao_fila'), 0::bigint);

select t.como_anon();
select t.throws('anon NÃO lê a fila', $q$select count(*) from public.storage_exclusao_fila$q$, 'permission denied');
select t.throws('anon NÃO processa', $q$select * from public._storage_exclusao_processar(5)$q$, 'permission denied');
select t.throws('anon NÃO confirma', $q$select public._storage_exclusao_confirmar('imagens', 'x', true, null)$q$, 'permission denied');
select t.throws('anon NÃO enfileira', $q$select public._storage_exclusao_enfileirar('x', 'imagens', 'x', 'apagado', null)$q$, 'permission denied');
select t.throws('anon NÃO vê o resumo do admin', $q$select public.admin_storage_exclusao_resumo()$q$, 'permission denied');
select t.como('membro_a');
select t.throws('authenticated NÃO lê a fila', $q$select count(*) from public.storage_exclusao_fila$q$, 'permission denied');
select t.throws('authenticated NÃO escreve na fila (insert)', $q$insert into public.storage_exclusao_fila (bucket, caminho, origem, motivo, processar_apos) values ('imagens', 'a/b.jpg', 'x', 'apagado', now())$q$, 'permission denied');
select t.throws('authenticated NÃO altera a fila (update)', $q$update public.storage_exclusao_fila set estado = 'excluido'$q$, 'permission denied');
select t.throws('authenticated NÃO apaga da fila', $q$delete from public.storage_exclusao_fila$q$, 'permission denied');
select t.throws('authenticated NÃO processa', $q$select * from public._storage_exclusao_processar(5)$q$, 'permission denied');
select t.throws('authenticated NÃO confirma', $q$select public._storage_exclusao_confirmar('imagens', 'x', true, null)$q$, 'permission denied');
select t.throws('authenticated NÃO enfileira por função interna', format($q$select public._storage_exclusao_enfileirar(%L, 'imagens', 'x', 'apagado', %L)$q$, 'perfis/' || t.id('membro_a') || '-1.jpg', t.id('membro_a')), 'permission denied');
select t.throws('authenticated NÃO chama o gatilho/dono_confere/rotina/política',
  $q$select public._storage_exclusao_dono_confere('a/b', gen_random_uuid())$q$, 'permission denied');
select t.throws('authenticated NÃO roda a rotina do cron', $q$select public.storage_exclusao_rotina()$q$, 'permission denied');
select t.throws('membro comum NÃO vê o resumo do admin', $q$select public.admin_storage_exclusao_resumo()$q$);
reset role;
select t.eq('...e nada entrou na fila por essas tentativas', (select count(*) from public.storage_exclusao_fila), 0::bigint);

-- =============================================================================
--  2. Gatilhos: o caminho ANTIGO, exatamente
-- =============================================================================
select t.eq('antes de qualquer remoção a fila está vazia (inserir/null->valor não enfileira)', (select count(*) from public.storage_exclusao_fila), 0::bigint);

-- 2a. liderança apaga a atividade; as entregas somem em cascata; os 2 arquivos entram na fila
select t.como('lider_a');
select t.permitido('liderança apaga a atividade (as entregas somem em cascata)', format($q$delete from public.atividades where id = %L$q$, t.id('atv_orfa')));
reset role;
select t.eq('apagar atividade enfileira EXATAMENTE os 2 caminhos das entregas',
  t.fila('entregas.foto_url'),
  'comprovacoes/' || t.id('membro_a') || '/atividades/1000.jpg,comprovacoes/' || t.id('membro_a2b') || '/atividades/2000.jpg'
);
select t.eq('...nenhuma entrega sobrou', (select count(*) from public.entregas where atividade_id = t.id('atv_orfa')), 0::bigint);
select t.eq('...cada item nasce pendente, com carência de 7 dias',
  (select count(*) from public.storage_exclusao_fila where estado = 'pendente' and processar_apos > now() + interval '6 days 23 hours' and processar_apos <= now() + interval '7 days 1 hour'), 2::bigint);
select t.eq('...dono da linha confere com o dono do caminho', (select count(*) from public.storage_exclusao_fila where origem = 'entregas.foto_url' and dono_confere), 2::bigint);
select t.eq('...o arquivo físico continua lá (nada apaga na hora)', t.existe('comprovacoes', t.id('membro_a') || '/atividades/1000.jpg'), true);
select t.eq('...motivo = apagado', (select count(*) from public.storage_exclusao_fila where motivo = 'apagado'), 2::bigint);

-- 2b. foto do mural: url + thumb (URL pública do Storage vira bucket/caminho)
select t.como('membro_a');
select t.permitido('autor apaga a própria foto do mural', format($q$delete from public.fotos where legenda = 'F1' and autor_id = %L$q$, t.id('membro_a')));
reset role;
select t.eq('apagar foto enfileira url + thumb (e só eles), já normalizados',
  t.fila('fotos.url') || '|' || t.fila('fotos.thumb'),
  'imagens/mural/' || t.id('membro_a') || '-111.jpg|imagens/mural/' || t.id('membro_a') || '-111-thumb.jpg');

-- 2c. trocar o avatar
select t.como('membro_a');
select t.permitido('membro troca a própria foto de perfil', format($q$update public.profiles set foto = %L where id = %L$q$, t.url('imagens', 'perfis/' || t.id('membro_a') || '-2.jpg'), t.id('membro_a')));
reset role;
select t.eq('trocar o avatar enfileira SÓ o antigo', t.fila('profiles.foto'), 'imagens/perfis/' || t.id('membro_a') || '-1.jpg');
select t.eq('...o novo avatar NÃO entrou na fila', (select count(*) from public.storage_exclusao_fila where caminho = 'perfis/' || t.id('membro_a') || '-2.jpg'), 0::bigint);
select t.eq('...motivo = trocado', (select motivo from public.storage_exclusao_fila where origem = 'profiles.foto'), 'trocado');
update public.profiles set foto = foto where id = t.id('membro_a');
update public.profiles set nome = nome || ' ' where id = t.id('membro_a');
select t.eq('regravar o mesmo valor / mexer em outra coluna NÃO enfileira nada', (select count(*) from public.storage_exclusao_fila where origem = 'profiles.foto'), 1::bigint);
update public.profiles set foto = null where id = t.id('membro_a2b');
select t.eq('perfil sem foto -> sem foto não enfileira', (select count(*) from public.storage_exclusao_fila where origem = 'profiles.foto'), 1::bigint);

-- 2d. valor ainda em outra linha da MESMA tabela: não enfileira
delete from public.entregas where atividade_id = t.id('atv_dup') and usuario_id = t.id('membro_a');
select t.eq('apagar a 1ª entrega (a outra ainda usa o mesmo arquivo) NÃO enfileira', (select count(*) from public.storage_exclusao_fila where caminho like '%3000.jpg'), 0::bigint);
delete from public.entregas where atividade_id = t.id('atv_dup') and usuario_id = t.id('membro_a2b');
select t.eq('apagar a última linha que usava o arquivo enfileira', (select count(*) from public.storage_exclusao_fila where caminho like '%3000.jpg'), 1::bigint);
select t.eq('...mas o dono da linha (membro_a2b) NÃO é o dono do caminho (membro_a): dono_confere = false',
  (select dono_confere from public.storage_exclusao_fila where caminho like '%3000.jpg'), false);

-- 2e. referência em OUTRA tabela / referência nova depois de enfileirar
delete from public.fotos where legenda = 'F2';     -- profiles.foto do membro_b ainda aponta para o mesmo arquivo
select t.eq('apagar a foto cujo arquivo é também avatar de alguém: enfileira (a conferência completa é no processamento)',
  (select count(*) from public.storage_exclusao_fila where caminho = 'mural/' || t.id('membro_b') || '-555.jpg'), 1::bigint);
delete from public.fotos where legenda = 'F3';
select t.eq('F3 enfileirada', (select count(*) from public.storage_exclusao_fila where caminho = 'mural/' || t.id('membro_b') || '-666.jpg'), 1::bigint);
insert into public.fotos (url, legenda, autor_id) values (t.url('imagens', 'mural/' || t.id('membro_b') || '-666.jpg'), 'F3-de-novo', t.id('membro_b'));   -- NOVA referência

-- 2f. o objeto novo demais (cenário 8)
delete from public.fotos where legenda = 'F4';

-- =============================================================================
--  3. ATAQUE: caminho forjado / bucket protegido / caminho malicioso
-- =============================================================================
-- membro_b aponta a própria entrega para o arquivo (sem nenhuma referência!) do membro_a e depois a liderança do B a apaga
select t.como('membro_b');
select t.permitido('membro_b reenvia a entrega apontando para o arquivo do membro_a (o app não impede o valor)',
  format($q$update public.entregas set foto_url = %L, status = 'pendente' where atividade_id = %L and usuario_id = %L$q$, t.id('membro_a') || '/atividades/VITIMA.jpg', t.id('atv_b'), t.id('membro_b')));
reset role;
select t.como('lider_b');
select t.permitido('liderança do B apaga a entrega forjada', format($q$delete from public.entregas where atividade_id = %L and usuario_id = %L$q$, t.id('atv_b'), t.id('membro_b')));
reset role;
select t.eq('o caminho forjado foi enfileirado com dono_confere = false (dono da linha = membro_b, dono do caminho = membro_a)',
  (select dono_confere::text || '|' || (dono_linha = t.id('membro_b'))::text from public.storage_exclusao_fila where caminho = t.id('membro_a') || '/atividades/VITIMA.jpg'), 'false|true');

-- valores maliciosos nunca entram
select t.eq('URL de bucket PROTEGIDO (documentos-emitidos) não entra', public._storage_exclusao_enfileirar(t.url('documentos-emitidos', t.id('membro_a') || '/doc.pdf'), 'comprovacoes', 'teste', 'apagado', t.id('membro_a')), false);
select t.eq('URL de bucket PROTEGIDO (publico) não entra', public._storage_exclusao_enfileirar(t.url('publico', 'clube/logo.png'), 'imagens', 'teste', 'apagado', null), false);
select t.eq('URL de bucket desconhecido não entra', public._storage_exclusao_enfileirar(t.url('outro', 'a/b.jpg'), 'imagens', 'teste', 'apagado', null), false);
select t.eq('caminho com .. não entra', public._storage_exclusao_enfileirar('../publico/clube/logo.png', 'imagens', 'teste', 'apagado', null), false);
select t.eq('caminho com .. no meio não entra', public._storage_exclusao_enfileirar('perfis/../x.png', 'imagens', 'teste', 'apagado', null), false);
select t.eq('caminho absoluto não entra', public._storage_exclusao_enfileirar('/etc/passwd', 'imagens', 'teste', 'apagado', null), false);
select t.eq('URL externa (outro site) não entra', public._storage_exclusao_enfileirar('https://exemplo.com/a.jpg', 'imagens', 'teste', 'apagado', null), false);
select t.eq('rota interna do app não entra', public._storage_exclusao_enfileirar('/icon-192.png', 'imagens', 'teste', 'apagado', null), false);
select t.eq('valor vazio não entra', public._storage_exclusao_enfileirar('   ', 'imagens', 'teste', 'apagado', null), false);
select t.eq('caminho gigante não entra', public._storage_exclusao_enfileirar(repeat('a', 600), 'imagens', 'teste', 'apagado', null), false);
select t.eq('caminho com caractere de controle não entra', public._storage_exclusao_enfileirar('a/b' || chr(10) || 'c.jpg', 'imagens', 'teste', 'apagado', null), false);
select t.eq('dono_confere: 1º segmento', public._storage_exclusao_dono_confere(t.id('membro_a') || '/atividades/1.jpg', t.id('membro_a')), true);
select t.eq('dono_confere: pasta do clube + dono', public._storage_exclusao_dono_confere(t.id('clube_a') || '/' || t.id('membro_a') || '/x.jpg', t.id('membro_a')), true);
select t.eq('dono_confere: perfis/<uid>-<ts>', public._storage_exclusao_dono_confere('perfis/' || t.id('membro_a') || '-9.jpg', t.id('membro_a')), true);
select t.eq('dono_confere: outra pessoa = false', public._storage_exclusao_dono_confere(t.id('membro_a') || '/atividades/1.jpg', t.id('membro_b')), false);
select t.eq('dono_confere: dono nulo = false', public._storage_exclusao_dono_confere(t.id('membro_a') || '/atividades/1.jpg', null), false);
select t.eq('dono_confere: uuid só no nome do arquivo, no 3º segmento = false', public._storage_exclusao_dono_confere('x/y/' || t.id('membro_b') || '-1.jpg', t.id('membro_b')), false);

-- bucket protegido DIRETO na fila (alguém com acesso de banco): o processador ainda recusa
insert into public.storage_exclusao_fila (bucket, caminho, origem, motivo, dono_linha, dono_confere, processar_apos)
values ('publico', 'clube/logo.png', 'teste', 'apagado', null, true, now() - interval '1 hour'),
       ('documentos-emitidos', t.id('membro_a') || '/doc.pdf', 'teste', 'apagado', t.id('membro_a'), true, now() - interval '1 hour');

-- =============================================================================
--  4. Carência e processamento (service_role)
-- =============================================================================
select t.como_service();
-- (os 2 itens de bucket protegido foram inseridos já vencidos: o processador os resolve; os demais ainda estão na carência)
select t.eq('dentro da carência (7 dias) NADA é devolvido, e bucket protegido na fila nunca é devolvido', t.proc(), '');
reset role;
select t.eq('...publico -> mantido (bucket_nao_elegivel)', t.est('publico', 'clube/logo.png'), 'mantido:bucket_nao_elegivel');
select t.eq('...documentos-emitidos -> mantido (bucket_nao_elegivel)', t.est('documentos-emitidos', t.id('membro_a') || '/doc.pdf'), 'mantido:bucket_nao_elegivel');
select t.eq('...e os arquivos continuam existindo', t.existe('publico', 'clube/logo.png') and t.existe('documentos-emitidos', t.id('membro_a') || '/doc.pdf'), true);

-- vence a carência dos itens dos gatilhos (SÓ no teste: ajuste direto da data)
update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute' where estado = 'pendente';

create table t.lote1 (bucket text, caminho text);
grant all on t.lote1 to public;
select t.como_service();
insert into t.lote1 select bucket, caminho from t.tudo();
reset role;
-- a política limita UMA chamada a no máximo 8 itens
select t.ok('política: lote_maximo = 8', (public._storage_exclusao_politica() ->> 'lote_maximo')::int = 8);
select t.eq('lote 1: devolve só o que passou em TUDO (2 da atividade, url+thumb da foto, avatar antigo, arquivo substituído na reenvio do membro_b)',
  (select coalesce(string_agg(bucket || '/' || caminho, ',' order by caminho), '') from t.lote1),
  (select string_agg(x, ',' order by x) from (values
     ('comprovacoes/' || t.id('membro_a') || '/atividades/1000.jpg'),
     ('comprovacoes/' || t.id('membro_a2b') || '/atividades/2000.jpg'),
     ('imagens/mural/' || t.id('membro_a') || '-111.jpg'),
     ('imagens/mural/' || t.id('membro_a') || '-111-thumb.jpg'),
     ('imagens/perfis/' || t.id('membro_a') || '-1.jpg'),
     ('comprovacoes/' || t.id('membro_b') || '/atividades/legit-b.jpg')) v(x)));
select t.eq('lote 1: 2000.jpg (dono da linha membro_a2b, caminho do membro_a2b) passa — mesmo dono', (select count(*) from t.lote1 where caminho like '%2000.jpg'), 1::bigint);
select t.eq('forjado (VITIMA.jpg, sem referência nenhuma) NÃO é devolvido: dono do caminho != dono da linha', (select count(*) from t.lote1 where caminho like '%VITIMA.jpg'), 0::bigint);
select t.eq('...ficou mantido com o motivo certo', t.est('comprovacoes', t.id('membro_a') || '/atividades/VITIMA.jpg'), 'mantido:dono_diferente');
select t.eq('...e o arquivo da vítima continua existindo', t.existe('comprovacoes', t.id('membro_a') || '/atividades/VITIMA.jpg'), true);
select t.eq('3000.jpg (linha de outra pessoa) -> mantido dono_diferente', t.est('comprovacoes', t.id('membro_a') || '/atividades/3000.jpg'), 'mantido:dono_diferente');
select t.eq('foto que também é avatar de alguém -> mantido (referenciado)', t.est('imagens', 'mural/' || t.id('membro_b') || '-555.jpg'), 'mantido:referenciado');
select t.eq('referência NOVA criada depois de enfileirar -> mantido (referenciado)', t.est('imagens', 'mural/' || t.id('membro_b') || '-666.jpg'), 'mantido:referenciado');
select t.eq('...os arquivos referenciados continuam existindo', t.existe('imagens', 'mural/' || t.id('membro_b') || '-555.jpg') and t.existe('imagens', 'mural/' || t.id('membro_b') || '-666.jpg'), true);
select t.eq('objeto com menos de 7 dias de idade (F4) continua PENDENTE, reagendado para depois da carência dele',
  (select estado = 'pendente' and processar_apos > now() + interval '5 days 23 hours' and reservado_ate is null from public.storage_exclusao_fila where caminho = 'mural/' || t.id('membro_a') || '-777.jpg'), true);
select t.eq('...e não foi devolvido', (select count(*) from t.lote1 where caminho like '%-777.jpg'), 0::bigint);
select t.eq('nada foi apagado em storage.objects pelo processamento', (select count(*) from storage.objects where bucket_id = 'imagens' and name like 'mural/%-111%'), 2::bigint);

-- reserva: a MESMA execução não pega de novo; reserva expirada volta
select t.como_service();
select t.eq('segunda execução simultânea NÃO devolve os itens já reservados (sem exclusão dupla)', t.proc(), '');
reset role;
select t.eq('...os 6 itens estão reservados (10 min)', (select count(*) from public.storage_exclusao_fila where reservado_ate > now() + interval '9 minutes' and estado = 'pendente'), 6::bigint);
update public.storage_exclusao_fila set reservado_ate = now() - interval '1 minute' where estado = 'pendente' and reservado_ate is not null;
select t.como_service();
select t.eq('reserva EXPIRADA volta para o próximo processamento (Edge Function que morreu no meio)',
  (select count(*) from t.tudo())::text, '6');
reset role;

-- =============================================================================
--  5. Confirmação: 'excluido' só pela confirmação; idempotente; falha visível
-- =============================================================================
select t.como_service();
select t.eq('confirmar ok -> excluido', public._storage_exclusao_confirmar('comprovacoes', t.id('membro_a') || '/atividades/1000.jpg', true, 'removido'), 'excluido');
select t.eq('...idempotente (2ª confirmação ok)', public._storage_exclusao_confirmar('comprovacoes', t.id('membro_a') || '/atividades/1000.jpg', true, 'removido'), 'excluido');
select t.eq('...e uma confirmação de FALHA depois não desfaz', public._storage_exclusao_confirmar('comprovacoes', t.id('membro_a') || '/atividades/1000.jpg', false, 'erro'), 'excluido');
select t.eq('item inexistente', public._storage_exclusao_confirmar('imagens', 'nao/existe.jpg', true, null), 'inexistente');
reset role;
select t.eq('...estado gravado', t.est('comprovacoes', t.id('membro_a') || '/atividades/1000.jpg'), 'excluido:removido');
select t.ok('...com data de resolução', (select resolvida_em is not null and reservado_ate is null from public.storage_exclusao_fila where caminho = t.id('membro_a') || '/atividades/1000.jpg'));
-- item que NUNCA foi entregue pelo processador não pode ser "confirmado" (o pendente do F4 está sem reserva)
select t.como_service();
select t.eq('confirmar ok de item nunca entregue (sem reserva) NÃO vale', public._storage_exclusao_confirmar('imagens', 'mural/' || t.id('membro_a') || '-777.jpg', true, null), 'nao_reservado');
reset role;
select t.eq('...continua pendente', (select estado from public.storage_exclusao_fila where caminho = 'mural/' || t.id('membro_a') || '-777.jpg'), 'pendente');

-- falha da API do Storage: recuo crescente, teto, registro visível. Alvo: avatar antigo (reservado, pendente).
create table t.alvo as select 'imagens'::text as bucket, 'perfis/' || t.id('membro_a') || '-1.jpg' as caminho;
grant all on t.alvo to public;
select t.como_service();
select t.eq('falha 1 -> pendente', public._storage_exclusao_confirmar((select bucket from t.alvo), (select caminho from t.alvo), false, 'erro_api 500 ' || t.id('membro_a')), 'pendente');
reset role;
select t.eq('...tentativas = 1, recuo de ~1h, sem reserva', (select tentativas = 1 and processar_apos > now() + interval '59 minutes' and processar_apos <= now() + interval '61 minutes' and reservado_ate is null
   from public.storage_exclusao_fila where caminho = (select caminho from t.alvo)), true);
select t.eq('...a mensagem gravada NÃO contém o uuid da pessoa (sem dado pessoal)', (select ultima_mensagem not like '%' || t.id('membro_a')::text || '%' and ultima_mensagem like '%<id>%' from public.storage_exclusao_fila where caminho = (select caminho from t.alvo)), true);
select t.eq('falha com a fila ainda dentro do recuo: o processador NÃO devolve o item (não martela a API)', (select count(*) from t.tudo() where caminho = (select caminho from t.alvo)), 0::bigint);
-- falhas 2..5: cada uma precisa que o item seja reservado de novo (vence o recuo no teste)
do $$ declare i int; v_r text;
begin
  for i in 2 .. 5 loop
    update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute' where caminho = (select caminho from t.alvo);
    perform count(*) from t.tudo();
    v_r := public._storage_exclusao_confirmar((select bucket from t.alvo), (select caminho from t.alvo), false, 'erro_api 500');
    insert into t.res (nome, ok, detalhe) values ('falha ' || i || ' -> ' || case when i < 5 then 'pendente' else 'falhou' end, v_r = case when i < 5 then 'pendente' else 'falhou' end, 'obtido=' || v_r);
  end loop;
end $$;
select t.eq('teto de tentativas: estado final = falhou, 5 tentativas, mensagem visível',
  (select estado || '|' || tentativas || '|' || coalesce(ultima_mensagem, '') from public.storage_exclusao_fila where caminho = (select caminho from t.alvo)), 'falhou|5|erro_api 500');
select t.eq('...a falha final foi registrada em infra_falhas (não é escondida)', (select count(*) from public.infra_falhas where origem = 'storage/exclusao'), 1::bigint);
select t.eq('...infra_falhas não guarda caminho nem uuid', (select count(*) from public.infra_falhas where origem = 'storage/exclusao' and (detalhe like '%perfis/%' or detalhe ~* '[0-9a-f]{8}-[0-9a-f]{4}-')), 0::bigint);
select t.eq('...o arquivo continua existindo (falha não apaga)', t.existe('imagens', (select caminho from t.alvo)), true);
select t.como_service();
select t.eq('item "falhou" não é mais processado sozinho', (select count(*) from t.tudo() where caminho = (select caminho from t.alvo)), 0::bigint);
select t.eq('confirmar sobre item "falhou" é idempotente (não ressuscita)', public._storage_exclusao_confirmar((select bucket from t.alvo), (select caminho from t.alvo), true, null), 'falhou');
reset role;

-- resumo do admin da plataforma: contagens, sem caminho
select t.como('admin_saas');
select t.eq('admin vê a falha no resumo', (public.admin_storage_exclusao_resumo() -> 'falhas' -> 0 ->> 'tentativas'), '5');
select t.eq('...resumo por estado', (public.admin_storage_exclusao_resumo() -> 'por_estado' ->> 'falhou'), '1');
select t.eq('...resumo NÃO traz caminho', (position('perfis/' in public.admin_storage_exclusao_resumo()::text) = 0 and position('/atividades/' in public.admin_storage_exclusao_resumo()::text) = 0), true);
select t.eq('...nem a chave "caminho"', (public.admin_storage_exclusao_resumo()::text !~ '"caminho"'), true);
reset role;

-- =============================================================================
--  6. Reenfileirar: arquivo já excluído que volta a existir/ser apagado
-- =============================================================================
-- (o arquivo físico segue em storage.objects neste teste: quem apaga é a Edge Function; aqui só provamos a fila)
select t.eq('reenfileirar item "excluido" volta a pendente (mesmo caminho reaparecido)',
  public._storage_exclusao_enfileirar(t.id('membro_a') || '/atividades/1000.jpg', 'comprovacoes', 'entregas.foto_url', 'trocado', t.id('membro_a')), true);
select t.eq('...pendente, tentativas zeradas, nova carência', (select estado = 'pendente' and tentativas = 0 and resolvida_em is null and processar_apos > now() + interval '6 days' from public.storage_exclusao_fila where caminho = t.id('membro_a') || '/atividades/1000.jpg'), true);
select t.eq('...ainda 1 linha por caminho (idempotente)', (select count(*) from public.storage_exclusao_fila where caminho = t.id('membro_a') || '/atividades/1000.jpg'), 1::bigint);
select t.eq('reenfileirar item "mantido" por dono errado com alegação VÁLIDA promove o dono',
  public._storage_exclusao_enfileirar(t.id('membro_a') || '/atividades/VITIMA.jpg', 'comprovacoes', 'entregas.foto_url', 'apagado', t.id('membro_a')), true);
select t.eq('...dono_confere agora true (o dono de verdade apagou a própria linha)', (select dono_confere from public.storage_exclusao_fila where caminho = t.id('membro_a') || '/atividades/VITIMA.jpg'), true);
select t.eq('...mas uma alegação forjada depois NÃO derruba a válida',
  public._storage_exclusao_enfileirar(t.id('membro_a') || '/atividades/VITIMA.jpg', 'comprovacoes', 'entregas.foto_url', 'apagado', t.id('membro_b')) and
  (select dono_confere and dono_linha = t.id('membro_a') from public.storage_exclusao_fila where caminho = t.id('membro_a') || '/atividades/VITIMA.jpg'), true);

-- =============================================================================
--  7. O gatilho NUNCA derruba a operação do usuário
-- =============================================================================
select t.obj('imagens', 'mural/' || t.id('membro_a') || '-888.jpg');
insert into public.fotos (url, legenda, autor_id) values (t.url('imagens', 'mural/' || t.id('membro_a') || '-888.jpg'), 'F5', t.id('membro_a'));
alter table public.storage_exclusao_fila add constraint zz_quebra_de_proposito check (bucket = 'nunca') not valid;
select t.como('membro_a');
select t.permitido('com a fila QUEBRADA, o usuário ainda apaga a foto (o gatilho não bloqueia)', format($q$delete from public.fotos where legenda = 'F5' and autor_id = %L$q$, t.id('membro_a')));
reset role;
select t.eq('...e o problema ficou registrado em infra_falhas', (select count(*) from public.infra_falhas where origem = 'storage/exclusao-gatilho'), 1::bigint);
alter table public.storage_exclusao_fila drop constraint zz_quebra_de_proposito;

-- =============================================================================
--  8. Rotina do cron (sem Vault configurado só registra; nunca chama nada)
-- =============================================================================
update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute', reservado_ate = null where estado = 'pendente';
select public.storage_exclusao_rotina();
select public.storage_exclusao_rotina();
select t.eq('sem storage_excluir_url/secret no Vault: registra 1 aviso (no máximo 1 por hora)', (select count(*) from public.infra_falhas where origem = 'storage/exclusao-config'), 1::bigint);
select t.eq('...e o job continua desligado', (select count(*) from cron.job where jobname = 'storage-excluir' and active), 0::bigint);

-- =============================================================================
--  9. Nada do que o app/gatilhos fazem apagou arquivo físico
-- =============================================================================
select t.eq('os arquivos dos cenários continuam TODOS em storage.objects (quem apaga é só a Edge Function)',
  (select count(*) from storage.objects where bucket_id in ('imagens', 'comprovacoes', 'publico', 'documentos-emitidos')
     and (name like '%' || t.id('membro_a')::text || '%' or name like '%' || t.id('membro_b')::text || '%' or name like '%' || t.id('membro_a2b')::text || '%' or name = 'clube/logo.png')) >= 15, true);

select t.fim();
rollback;
