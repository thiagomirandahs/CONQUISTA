-- Leitura e escrita CRUZADAS: todo ator (liderança, membro, responsável e anônimo)
-- de um clube contra os dados do outro clube. Nada pode ser lido nem alterado,
-- e tentar forjar club_id não pode mover um dado para o clube alheio.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- pessoas de cada clube, calculado como postgres (o ator não enxerga vínculos alheios)
create function t.pessoas_do_clube(p_clube text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(user_id), '{}') from public.organization_memberships where organizational_unit_id = t.id(p_clube);
$$;

-- ---------- leitura: cada ator x cada tabela com club_id, contra o OUTRO clube ----------
create function t.cruzada_leitura() returns void language plpgsql as $$
declare
  tab text; ator text; n bigint; outro text; pessoas uuid[];
  atores text[][] := array[
    ['lider_a','clube_b'], ['instrutor_a','clube_b'], ['tesoureiro_a','clube_b'], ['conselheiro_a','clube_b'],
    ['membro_a','clube_b'], ['pais_a','clube_b'],
    ['lider_b','clube_a'], ['membro_b','clube_a'], ['pais_b','clube_a']];
  i int;
begin
  for i in 1 .. array_length(atores, 1) loop
    ator := atores[i][1]; outro := atores[i][2];
    pessoas := t.pessoas_do_clube(outro);
    perform t.como(ator);
    foreach tab in array array['unidades','atividades','entregas','pontos','fotos','eventos','mensalidades',
                               'notificacoes','temporadas','club_features','club_invites'] loop
      begin
        execute format('select count(*) from public.%I where club_id = $1', tab) into n using t.id(outro);
      exception when others then n := 0; end;
      perform t.eq(format('leitura cruzada: %s não lê %s do outro clube', ator, tab), n, 0);
    end loop;
    -- tabelas por pessoa (não têm club_id): perfis, vínculos, responsáveis, inscrições de push
    foreach tab in array array['profiles:id','organization_memberships:user_id','responsaveis:responsavel_id','push_subscriptions:user_id'] loop
      begin
        execute format('select count(*) from public.%I where %I = any($1)', split_part(tab, ':', 1), split_part(tab, ':', 2)) into n using pessoas;
      exception when others then n := 0; end;
      perform t.eq(format('leitura cruzada: %s não lê %s de gente do outro clube', ator, split_part(tab, ':', 1)), n, 0);
    end loop;
    begin
      select count(*) into n from storage.objects where bucket_id = 'comprovacoes' and owner = any(pessoas);
    exception when others then n := 0; end;
    perform t.eq(format('leitura cruzada: %s não lê comprovantes do outro clube', ator), n, 0);
  end loop;
  reset role;
end $$;
select t.cruzada_leitura();

-- ---------- anônimo: nada de tabela de clube (só as unidades do cadastro público) ----------
select t.como_anon();
select t.eq('anon: 0 pontos', t.nv('select count(*) from public.pontos'), 0);
select t.eq('anon: 0 perfis', t.nv('select count(*) from public.profiles'), 0);
select t.eq('anon: 0 fotos', t.nv('select count(*) from public.fotos'), 0);
select t.eq('anon: 0 atividades', t.nv('select count(*) from public.atividades'), 0);
select t.eq('anon: 0 eventos', t.nv('select count(*) from public.eventos'), 0);
select t.eq('anon: 0 mensalidades', t.nv('select count(*) from public.mensalidades'), 0);
select t.eq('anon: 0 avisos', t.nv('select count(*) from public.notificacoes'), 0);
select t.eq('anon: 0 vínculos', t.nv('select count(*) from public.organization_memberships'), 0);
select t.eq('anon: 0 convites', t.nv('select count(*) from public.club_invites'), 0);
select t.eq('anon: 0 responsáveis', t.nv('select count(*) from public.responsaveis'), 0);
select t.eq('anon: 0 config', t.nv('select count(*) from public.config_clube'), 0);
select t.eq('anon: 0 comprovantes', t.nv($q$select count(*) from storage.objects where bucket_id = 'comprovacoes'$q$), 0);
select t.bloqueado('anon não escreve pontos', format($q$insert into public.pontos (usuario_id, origem, pontos, motivo) values (%L, 'manual', 1, 'anon')$q$, t.id('membro_a')));
select t.bloqueado('anon não escreve perfis', format($q$update public.profiles set nome = 'anon' where id = %L$q$, t.id('membro_a')));
select t.bloqueado('anon não escreve vínculos', format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (%L, %L, 'diretoria', 'ativo')$q$, t.id('membro_a'), t.id('clube_a')));

-- ---------- escrita cruzada: MEMBRO do clube B contra o clube A ----------
select t.como('membro_b');
select t.bloqueado('membro B não cria vínculo próprio no clube A (auto-promoção)', format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (%L, %L, 'diretoria', 'ativo')$q$, t.id('membro_b'), t.id('clube_a')));
select t.bloqueado('membro B não promove o próprio vínculo', format($q$update public.organization_memberships set role = 'diretoria' where user_id = %L$q$, t.id('membro_b')));
select t.bloqueado('membro B não apaga o próprio vínculo para trocar de clube', format($q$delete from public.organization_memberships where user_id = %L$q$, t.id('membro_b')));
select t.bloqueado('membro B não envia entrega numa atividade do clube A', format($q$insert into public.entregas (atividade_id, usuario_id, texto) values (%L, %L, 'invasão')$q$, t.id('atv_a'), t.id('membro_b')));
-- (estado, não contagem de linhas: o gatilho pode reverter o valor em silêncio; conferimos abaixo como postgres)
update public.profiles set unidade_id = t.id('A1') where id = t.id('membro_b');
update public.profiles set papel = 'diretoria', status = 'ativo' where id = t.id('membro_b');
select t.bloqueado('membro B não cria convite de responsável', $q$insert into public.club_invites (club_id, token_hash, expires_at) values (gen_random_uuid(), 'x', now() + interval '1 day')$q$);
select t.bloqueado('membro B não grava inscrição de push de outra pessoa', format($q$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (%L, 'https://push.teste/invasao', 'k', 'a')$q$, t.id('membro_a')));
select t.bloqueado('membro B não sobe comprovante na pasta de outra pessoa', format($q$insert into storage.objects (bucket_id, name, owner) values ('comprovacoes', %L, %L)$q$, t.id('membro_a') || '/invasao.jpg', t.id('membro_b')));
select t.bloqueado('membro B não cria mensalidade', format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status) values (%L, 5, 2026, 1, 'pago')$q$, t.id('membro_b')));
-- forjar club_id: o dado NÃO pode ir parar no clube A
select t.permitido('membro B posta foto forjando club_id do clube A (o gatilho corrige)', format($q$insert into public.fotos (url, legenda, autor_id, club_id) values ('https://x.test/f.jpg', 'foto forjada', %L, %L)$q$, t.id('membro_b'), t.id('clube_a')), 0);
reset role;
select t.eq('foto forjada NÃO foi parar no clube A', (select count(*) from public.fotos where legenda = 'foto forjada' and club_id = t.id('clube_a')), 0);
select t.eq('o vínculo do membro_b segue só no clube B', (select count(*) from public.organization_memberships where user_id = t.id('membro_b') and organizational_unit_id = t.id('clube_b')), 1);
select t.eq('a unidade do membro_b segue B1', (select unidade_id from public.profiles where id = t.id('membro_b')), t.id('B1'));
select t.eq('o papel do membro_b segue desbravador', (select papel from public.profiles where id = t.id('membro_b')), 'desbravador');

-- ---------- escrita cruzada: LIDERANÇA do clube A contra o clube B ----------
select t.como('lider_a');
select t.bloqueado('líder A não edita perfil do clube B', format($q$update public.profiles set nome = 'invasão' where id = %L$q$, t.id('membro_b')));
select t.bloqueado('líder A não apaga foto do clube B', $q$delete from public.fotos where legenda = 'Foto B'$q$);
select t.bloqueado('líder A não altera ponto do clube B', $q$update public.pontos set pontos = 0 where motivo = 'Ponto membro B'$q$);
select t.bloqueado('líder A não apaga ponto do clube B', $q$delete from public.pontos where motivo = 'Ponto unidade B1'$q$);
select t.bloqueado('líder A não lança ponto na unidade do clube B', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo) values (%L, 'unidade', 999, 'invasão')$q$, t.id('B1')));
select t.bloqueado('líder A não altera atividade do clube B', $q$update public.atividades set pontos = 0 where titulo = 'Atividade B'$q$);
select t.bloqueado('líder A não avalia entrega do clube B', $q$update public.entregas set status = 'aprovada' where texto = 'Entrega B'$q$);
select t.bloqueado('líder A não apaga entrega do clube B', $q$delete from public.entregas where texto = 'Entrega B'$q$);
select t.bloqueado('líder A não muda mensalidade do clube B', format($q$update public.mensalidades set status = 'pago' where desbravador_id = %L$q$, t.id('membro_b')));
select t.bloqueado('líder A não muda evento do clube B', $q$update public.eventos set titulo = 'invasão' where titulo = 'Evento B'$q$);
select t.bloqueado('líder A não cria unidade forjando o clube B', format($q$insert into public.unidades (nome, club_id) values ('invasão', %L)$q$, t.id('clube_b')));
select t.bloqueado('líder A não cria atividade forjando o clube B', format($q$insert into public.atividades (titulo, pontos, club_id) values ('invasão', 1, %L)$q$, t.id('clube_b')));
select t.bloqueado('líder A não abre temporada no clube B', format($q$insert into public.temporadas (club_id, numero, inicio) values (%L, 99, now())$q$, t.id('clube_b')));
select t.bloqueado('líder A não muda temporada do clube B', format($q$update public.temporadas set fim = now() where club_id = %L$q$, t.id('clube_b')));
select t.bloqueado('líder A não muda recursos do clube B', format($q$insert into public.club_features (club_id, feature, enabled) values (%L, 'leilao', true)$q$, t.id('clube_b')));
select t.bloqueado('líder A não muda vínculo de gente do clube B', format($q$update public.organization_memberships set role = 'diretoria' where user_id = %L$q$, t.id('membro_b')));
select t.bloqueado('líder A não cria vínculo para si no clube B', format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (%L, %L, 'diretoria', 'ativo')$q$, t.id('lider_a'), t.id('clube_b')));
select t.bloqueado('líder A não vira dono de um clube: não altera organizational_units', format($q$update public.organizational_units set nome = 'invasão' where id = %L$q$, t.id('clube_b')));
select t.bloqueado('líder A não altera o próprio clube (organizational_units é só leitura)', format($q$update public.organizational_units set nome = 'invasão' where id = %L$q$, t.id('clube_a')));
reset role;

select t.fim();
rollback;
