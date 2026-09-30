-- COMUNIDADE (migrations 430–432) — TRIAGEM DE TEXTO no servidor.
-- Prova: normalização de disfarces (acento, leetspeak, repetição, letras separadas), bloqueio de
-- dados de contato (telefone, @, e-mail, link, "me chama no zap"), falsos positivos que NÃO podem
-- bloquear, mensagem gentil, nada publicado quando bloqueia, registro do bloqueio (com dígitos
-- mascarados), lista editável só pelo admin da plataforma e triagem inacessível ao cliente.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
insert into public.club_features (club_id, feature, enabled)
values (t.id('clube_a'), 'comunidade', true), (t.id('clube_b'), 'comunidade', true)
on conflict (club_id, feature) do update set enabled = true;
-- contas antigas (fora da "observação" de conta nova)
set local session_replication_role = replica;
update public.profiles set created_at = now() - interval '60 days' where id in (t.id('membro_a'), t.id('membro_a2'), t.id('membro_b'), t.id('lider_a'), t.id('lider_b'));
set local session_replication_role = origin;
select t.mk('admin_com', 'Admin Plataforma', 'diretoria', 'ativo', 'clube_b');
insert into public.platform_admins (user_id, papel) values (t.id('admin_com'), 'operacao');
select t.como('pais_a'); select public.comunidade_autorizar(t.id('membro_a'), true);
select t.como('pais_b'); select public.comunidade_autorizar(t.id('membro_b'), true);
reset role;
-- entre um bloco e outro: zera avisos/suspensões e tira as tentativas do "último minuto"
create function t.comun_zerar() returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.comunidade_avisos;
  delete from public.comunidade_suspensoes;
  update public.comunidade_bloqueios set created_at = now() - interval '2 minutes';
  update public.comunidade_posts set created_at = created_at - interval '2 minutes';
  update public.comunidade_comentarios set created_at = created_at - interval '2 minutes';
end $$;
create function t.triar_ok(p text) returns boolean language sql security definer set search_path = '' as $$
  select (public._comunidade_triar(p) ->> 'ok')::boolean;
$$;
create function t.triar_motivo(p text) returns text language sql security definer set search_path = '' as $$
  select public._comunidade_triar(p) ->> 'motivo';
$$;
\o

-- ---------- 1. normalização ----------
select t.eq('acento + maiúscula', public.comunidade_normalizar('PÔRRÁ'), 'pora');
select t.eq('leetspeak 3→e 4→a e letras repetidas', public.comunidade_normalizar('M3rd4aaaa'), 'merda');
select t.eq('@→a 0→o 1→i', public.comunidade_normalizar('@m0r v1d@'), 'amor vida');
select t.eq('pontos entre letras', public.comunidade_normalizar('p.u.t.a'), 'puta');
select t.eq('espaços entre letras', public.comunidade_normalizar('p u t a'), 'puta');
select t.eq('emoji e pontuação viram separador', public.comunidade_normalizar('oi!!! 😀 tudo—bem?'), 'oi tudo bem');
select t.eq('os TERMOS da lista passam pela mesma normalização (whatsapp → whatsap)',
  (select count(*) from public.comunidade_termos where termo = 'whatsap' and categoria = 'contato'), 1::bigint);

-- ---------- 2. bloqueia (ofensa, com disfarce) ----------
select t.eq('palavrão simples', t.triar_ok('que merda de dia'), false);
select t.eq('palavrão com letra repetida', t.triar_ok('MERDAAAAA'), false);
select t.eq('palavrão em leetspeak', t.triar_ok('que m3rd@'), false);
select t.eq('palavrão com pontos entre as letras', t.triar_ok('sua p.u.t.a'), false);
select t.eq('palavrão com espaços entre as letras', t.triar_ok('p u t a'), false);
select t.eq('palavrão com acento trocado', t.triar_ok('pôrra'), false);
select t.eq('expressão (vai tomar no c u)', t.triar_ok('vai tomar no c u'), false);
select t.eq('radical (fod...)', t.triar_ok('fodase'), false);
select t.eq('motivo = ofensa', t.triar_motivo('caralho'), 'ofensa');

-- ---------- 3. bloqueia (contato) ----------
select t.eq('telefone com traço e espaço', t.triar_motivo('liga 11 98765-4321'), 'contato');
select t.eq('telefone com pontos', t.triar_ok('9.8.7.6.5.4.3.2.1'), false);
select t.eq('@usuario', t.triar_motivo('me segue lá @joaozinho_10'), 'contato');
select t.eq('e-mail', t.triar_ok('manda pra ana@gmail.com'), false);
select t.eq('link http', t.triar_ok('olha https://exemplo.test/x'), false);
select t.eq('link www', t.triar_ok('entra em www.algo.net'), false);
select t.eq('domínio solto', t.triar_ok('meusite.com.br'), false);
select t.eq('"me chama no zap"', t.triar_motivo('me chama no zap'), 'contato');
select t.eq('"whats" disfarçado (wh4ts)', t.triar_ok('passa teu wh4ts'), false);
select t.eq('insta', t.triar_ok('segue meu insta'), false);
select t.eq('"no privado"', t.triar_ok('fala comigo no privado'), false);
select t.eq('endereço/escola ("minha escola")', t.triar_ok('minha escola é perto'), false);

-- ---------- 4. NÃO bloqueia (falsos positivos) ----------
select t.eq('frase normal', t.triar_ok('Que dia lindo no acampamento! Parabéns, Águias!'), true);
select t.eq('"computador" (contém "puta" no meio)', t.triar_ok('ganhei um computador'), true);
select t.eq('"viaduto"', t.triar_ok('passamos pelo viaduto'), true);
select t.eq('"cuscuz"', t.triar_ok('comi cuscuz no café'), true);
select t.eq('data 28/09/2026', t.triar_ok('Reunião dia 28/09/2026 às 9h'), true);
select t.eq('frase com ponto e "Com" (não é link)', t.triar_ok('Foi legal. Com certeza volto'), true);
select t.eq('placar e número pequeno', t.triar_ok('Ganhamos de 3 a 1! 1º lugar'), true);

-- ---------- 5. a triagem é do SERVIDOR: o cliente não chama nem lê a lista ----------
select t.como('membro_a');
select t.throws('cliente NÃO executa a triagem (não vira oráculo da lista)', $q$select public._comunidade_triar('x')$q$);
select t.throws('cliente NÃO executa a normalização', $q$select public.comunidade_normalizar('x')$q$);
select t.bloqueado('cliente NÃO lê a lista de termos', $q$select * from public.comunidade_termos$q$);
select t.bloqueado('cliente NÃO lê o registro de bloqueios', $q$select * from public.comunidade_bloqueios$q$);
select t.bloqueado('cliente NÃO grava post direto (sem passar pela triagem)',
  format($q$insert into public.comunidade_posts (club_id, autor_id, autor_papel, legenda, status) values (%L, %L, 'desbravador', 'merda', 'publicado')$q$, t.id('clube_a'), t.id('membro_a')));

-- ---------- 6. RPC: legenda ruim NEM é publicada ----------
select t.eq('publicar com palavrão → ok=false',
  t.txt($q$select public.comunidade_publicar('que m3rd@ de jogo')->>'ok'$q$), 'false');
select t.eq('mensagem gentil para publicação',
  t.txt($q$select public.comunidade_publicar('que merda')->>'mensagem'$q$), 'Essa publicação não pode ser publicada. Vamos manter o respeito 🙂');
reset role;
select t.eq('nada foi publicado', (select count(*) from public.comunidade_posts), 0::bigint);
select t.eq('os 2 bloqueios ficaram registrados, no clube do autor', (select count(*) from public.comunidade_bloqueios where autor_id = t.id('membro_a') and club_id = t.id('clube_a') and alvo = 'post' and motivo = 'ofensa'), 2::bigint);
select t.eq('...cada bloqueio gerou um aviso', (select count(*) from public.comunidade_avisos where usuario_id = t.id('membro_a') and origem = 'texto_bloqueado'), 2::bigint);
select t.comun_zerar();

select t.como('membro_a');
select t.eq('texto limpo SEM foto publica direto', t.txt($q$select public.comunidade_publicar('Amei a reunião de hoje!')->>'status'$q$), 'publicado');
reset role;
insert into t.ids (chave, id) select 'post1', id from public.comunidade_posts limit 1;
select t.como('membro_a2');
select t.eq('comentário ruim → mensagem pedida pelo dono',
  t.txt(format($q$select public.comunidade_comentar(%L, 'seu arrombado')->>'mensagem'$q$, t.id('post1'))),
  'Esse comentário não pode ser publicado. Vamos manter o respeito 🙂');
select t.eq('comentário com telefone → mensagem de segurança',
  t.txt(format($q$select public.comunidade_comentar(%L, 'me liga 11 9 8765 4321')->>'motivo'$q$, t.id('post1'))), 'contato');
reset role;
select t.eq('nenhum comentário ruim entrou', (select count(*) from public.comunidade_comentarios), 0::bigint);
select t.eq('o bloqueio de telefone guarda o trecho SEM os dígitos',
  (select count(*) from public.comunidade_bloqueios where autor_id = t.id('membro_a2') and motivo = 'contato' and trecho !~ '[0-9]' and trecho like '%#%'), 1::bigint);
select t.comun_zerar();
select t.como('membro_a2');
select t.eq('comentário limpo entra',
  t.txt(format($q$select public.comunidade_comentar(%L, 'Parabéns pelo 1º lugar!')->>'ok'$q$, t.id('post1'))), 'true');
reset role;

-- ---------- 7. lista editável SÓ pelo admin da plataforma ----------
select t.como('lider_a');
select t.throws('diretoria NÃO edita a lista', $q$select public.admin_comunidade_termo_salvar('batata', 'exata', 'ofensa', true)$q$, 'Sem permissão');
select t.throws('diretoria NÃO lê a lista', $q$select public.admin_comunidade_termos()$q$, 'Sem permissão');
select t.como('admin_com');
select t.ok('admin da plataforma lê a lista', t.n($q$select jsonb_array_length(public.admin_comunidade_termos())$q$) > 50);
select t.ok('admin inclui termo novo (normalizado)', t.txt($q$select public.admin_comunidade_termo_salvar('BATATÃÃ', 'exata', 'ofensa', true)::text$q$) like '%"batata"%');
reset role;
select t.eq('termo novo passa a bloquear', t.triar_ok('que batata'), false);
select t.eq('...e a alteração ficou auditada', (select count(*) from public.platform_admin_audit where acao = 'comunidade_termo_salvar'), 1::bigint);
select t.como('admin_com');
select t.ok('admin desativa o termo', t.txt($q$select public.admin_comunidade_termo_salvar('batata', 'exata', 'ofensa', false)::text$q$) is not null);
reset role;
select t.eq('termo desativado deixa de bloquear', t.triar_ok('que batata'), true);
insert into t.ids (chave, id) select 'termo_batata', id from public.comunidade_termos where termo = 'batata';
select t.como('admin_com');
select t.ok('admin remove o termo', t.txt(format($q$select public.admin_comunidade_termo_remover(%L)::text$q$, t.id('termo_batata'))) is not null);
select t.ok('admin vê os bloqueios recentes no painel', t.n($q$select jsonb_array_length(public.admin_comunidade_painel()->'bloqueios')$q$) >= 3);
reset role;

select t.fim();
rollback;
