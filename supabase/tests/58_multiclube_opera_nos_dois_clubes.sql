-- =============================================================================
--  Fase 9 — a pessoa de dois clubes consegue OPERAR nos dois?
--
--  O gate da 8.5 prova uma coisa: nenhuma escrita cai no clube errado. Ele não prova a outra
--  metade: que a escrita CAI NO CLUBE CERTO quando deveria dar certo. As duas são diferentes, e a
--  segunda só aparece com uma pessoa em mais de um clube, agindo no clube que NÃO é o mais antigo
--  (ou o mais novo) dela.
--
--  POR QUE ESTE ARQUIVO EXISTE: lendo como a tela de Mensalidades grava, apareceu
--
--      supabase.from('mensalidades').upsert({...}, { onConflict: 'desbravador_id,mes,ano' })
--        // alvo LEGADO: funciona antes e depois da migration (cada pessoa é de 1 clube só)
--
--  "Cada pessoa é de 1 clube só" — escrito num comentário, no produto que é vendido como
--  multi-clube. E por baixo, o gatilho `definir_club_mensalidade` SOBRESCREVE o `club_id` com o
--  vínculo MAIS ANTIGO da pessoa, ignorando a aba. Para alguém em A e B, toda mensalidade vira do
--  clube A: o tesoureiro de B nunca consegue cobrar essa pessoa, e antes da migration 68 (escrita
--  escopada) ele teria escrito DENTRO DO CAIXA DE A.
--
--  Uma varredura dos gatilhos de carimbo mostrou que 19 dos 24 nunca consultam a aba. Este arquivo
--  mede, superfície por superfície, o que isso faz na prática.
--
--  O MÉTODO: a pessoa age nas DUAS abas. Na aba A a linha tem de cair em A; na aba B, em B.
--    · as duas certas ......... OK
--    · uma recusa, outra não .. DEFEITO FUNCIONAL (não consegue operar num dos clubes)
--    · cai no clube errado .... DEFEITO DE ISOLAMENTO — possível via RPC `security definer`, que
--                               não passa pela RLS escopada da migration 68
--    · as duas recusam ........ pré-condição do teste, não evidência — e é reportado como tal,
--                               em vez de contar como "passou"
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
alter default privileges in schema t grant select on tables to public;

-- A PESSOA: `membro_a` ganha um segundo vínculo em B. O de A é o mais antigo; o de B, o mais novo.
-- É o pior caso para os dois tipos de palpite que os gatilhos fazem: `order by starts_at` escolhe
-- A, `clube_vinculo_do_usuario` (created_at desc) escolhe B. Nenhum dos dois é "a aba".
select t.mk2('membro_a', 'desbravador', 'ativo', 'clube_b', 'B1');
-- `membro_b` precisa estar no A também para a "ajuda entre amigos" ter um par nos dois clubes.
select t.mk2('membro_b', 'desbravador', 'ativo', 'clube_a', 'A1');
-- Tudo acima foi criado na MESMA transação: `starts_at` e `created_at` empatam, e "o mais antigo" /
-- "o mais novo" viraria sorteio. A ordem é fixada à mão, e é a que o comentário acima promete:
-- membro_a entrou em A antes de B; membro_b entrou em B antes de A.
update public.organization_memberships set starts_at = now() - interval '30 days', created_at = now() - interval '30 days'
 where (user_id, organizational_unit_id) in ((t.id('membro_a'), t.id('clube_a')), (t.id('membro_b'), t.id('clube_b')));

-- Os recursos que as superfícies exigem, ligados nos dois clubes — senão a sonda mediria a flag.
insert into public.club_features (club_id, feature, enabled)
select c, f, true
  from (values (t.id('clube_a')), (t.id('clube_b'))) cl(c)
 cross join (values ('mural'), ('atividades'), ('mensalidades'), ('jogos'), ('bichinho'), ('biblia'),
                    ('missoes'), ('chefao'), ('desafios'), ('leilao'), ('chat'), ('agenda')) fe(f)
on conflict (club_id, feature) do update set enabled = true;

-- Mede, FORA da RLS, quantas linhas daquela pessoa existem em cada clube.
create function t.contagem(p_tabela text, p_col text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  execute format('select coalesce(jsonb_object_agg(club_id::text, n), ''{}''::jsonb)
                    from (select club_id, count(*) n from public.%I where %I = $1 group by club_id) x',
                 p_tabela, p_col) into v using p_user;
  return v;
end $$;

create function t.rotulo(p_club text) returns text language sql stable as $$
  select case p_club when t.id('clube_a')::text then 'A' when t.id('clube_b')::text then 'B' else '?' end;
$$;

-- Executa como a identidade ATUAL (não é definer), mede antes e depois, e DESFAZ. Devolve o
-- clube em que a linha nova caiu ('A', 'B'), ou 'recusado: <motivo>'.
create function t.onde_caiu(p_sql text, p_tabela text, p_col text, p_user uuid) returns text
language plpgsql as $$
declare v_antes jsonb; v_depois jsonb; v_onde text;
begin
  v_antes := t.contagem(p_tabela, p_col, p_user);
  begin
    execute p_sql;
    v_depois := t.contagem(p_tabela, p_col, p_user);
    select coalesce(string_agg(t.rotulo(k), '+' order by k), 'nada')
      into v_onde
      from jsonb_each_text(v_depois) d(k, v)
     where d.v::int > coalesce((v_antes ->> d.k)::int, 0);
    raise exception using errcode = 'ZZ004', message = v_onde;
  exception when others then
    if sqlstate = 'ZZ004' then return sqlerrm; end if;
    return 'recusado: ' || left(regexp_replace(sqlerrm, '[0-9a-f-]{36}', '<id>', 'g'), 70);
  end;
end $$;

create table t.sonda (superficie text primary key, ator text, tabela text, col text, alvo text, sql text, ordem int);
grant select on t.sonda to public;
create table t.resultado (superficie text, aba text, esperado text, obtido text);
grant all on t.resultado to public;
\o

-- =============================================================================
--  As superfícies. `ator` é quem age; `alvo` é a pessoa dona da linha (quase sempre membro_a).
--  O SQL é o mesmo caminho que o app percorre: RPC quando o app chama RPC, insert direto quando o
--  app faz insert direto — sem `club_id`, porque o app não manda.
-- =============================================================================
\o /dev/null
insert into t.sonda values
  ('mensalidade (tesoureiro cobra)', 'lider', 'mensalidades', 'desbravador_id', 'membro_a',
   $s$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
      values (t.id('membro_a'), 7, 2026, 25, 'pago', auth.uid())$s$, 1),
  ('foto no mural', 'membro_a', 'fotos', 'autor_id', 'membro_a',
   $s$insert into public.fotos (url, evento, legenda, autor_id)
      values ('https://x/sonda.jpg', 'Acampamento', 'sonda', t.id('membro_a'))$s$, 2),
  ('entrega de atividade', 'membro_a', 'entregas', 'usuario_id', 'membro_a',
   $s$insert into public.entregas (atividade_id, usuario_id, texto)
      values ((select id from public.atividades where club_id = public.clube_atual_id() limit 1),
              t.id('membro_a'), 'sonda')$s$, 3),
  ('jogo (partida)', 'membro_a', 'partidas', 'usuario_id', 'membro_a',
   $s$select public.iniciar_jogo('memoria')$s$, 4),
  ('devocional', 'membro_a', 'devocional', 'usuario_id', 'membro_a',
   $s$select public.registrar_devocional(1)$s$, 5),
  ('missão do dia', 'membro_a', 'missoes_feitas', 'usuario_id', 'membro_a',
   $s$select public.registrar_missao(null, 1)$s$, 6),
  -- `biblia_iniciar_leitura` grava em `biblia_leitura_atual` (a leitura EM ANDAMENTO), não no
  -- histórico. A primeira versão desta sonda medía a tabela errada e devolvia "nada" nas duas abas —
  -- que é exatamente o resultado que parece um "ok" silencioso e não prova coisa nenhuma.
  ('bíblia', 'membro_a', 'biblia_leitura_atual', 'usuario_id', 'membro_a',
   $s$select public.biblia_iniciar_leitura('gn', 1)$s$, 7),
  ('bichinho', 'membro_a', 'bichinhos', 'usuario_id', 'membro_a',
   $s$select public.bichinho_adotar('Sonda', 'cachorro')$s$, 8),
  ('ajuda a um amigo', 'membro_a', 'ajudas', 'de_id', 'membro_a',
   -- só 'anagrama', 'forca' e 'termo' aceitam ajuda (pedir_ajuda recusa os outros)
   $s$select public.pedir_ajuda(t.id('membro_b'), 'forca', '{"palavra":"sonda"}'::jsonb, 'x')$s$, 9),
  ('chefão (golpe)', 'membro_a', 'chefao_golpes', 'usuario_id', 'membro_a',
   $s$select public.chefao_golpe()$s$, 10),
  ('apontamento (conselheiro)', 'lider', 'pontos', 'usuario_id', 'membro_a',
   $s$select public.salvar_reuniao(current_date, 'sonda-9', jsonb_build_array(
        jsonb_build_object('usuario_id', t.id('membro_a'), 'pontos', 5)))$s$, 11);

-- chefão ligado nos dois, e com a data do fuso certo (ver teste 30: o banco é UTC)
insert into public.config_clube (club_id, chave, valor)
select c, k, v from (values (t.id('clube_a')), (t.id('clube_b'))) cl(c)
 cross join (values ('chefao_ativo', 'sim'),
                    ('chefao_inicio', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')),
                    ('chefao_vida', '999999')) kv(k, v)
on conflict (club_id, chave) do update set valor = excluded.valor;
\o

-- =============================================================================
--  A corrida: cada superfície, nas duas abas.
-- =============================================================================
\o /dev/null
create function t.correr() returns void language plpgsql as $$
declare s record; aba text; v_ator text;
begin
  for s in select * from t.sonda order by ordem loop
    foreach aba in array array['A', 'B'] loop
      v_ator := case when s.ator = 'lider' then 'lider_' || lower(aba) else s.ator end;
      perform t.como(v_ator);
      perform t.pedir_clube('clube_' || lower(aba));
      insert into t.resultado values (s.superficie, aba, aba,
        t.onde_caiu(s.sql, s.tabela, s.col, t.id(s.alvo)));
      reset role;
    end loop;
  end loop;
end $$;
select t.correr();
\o

\echo ''
\echo '=== onde cada escrita da pessoa A+B caiu ==='
\pset format aligned
select r.superficie,
       max(r.obtido) filter (where r.aba = 'A') as "na aba A",
       max(r.obtido) filter (where r.aba = 'B') as "na aba B"
  from t.resultado r join t.sonda s on s.superficie = r.superficie
 group by r.superficie, s.ordem order by s.ordem;
\pset format unaligned

-- =============================================================================
--  Os asserts.
-- =============================================================================
-- 1. ISOLAMENTO: nada, em aba nenhuma, cai no clube que não é o da aba.
select t.eq('[isolamento] nenhuma escrita da pessoa A+B caiu no clube que não era o da aba',
  t.txt($q$select coalesce(string_agg(superficie || ' (aba ' || aba || ' caiu em ' || obtido || ')', '; '), '')
             from t.resultado
            where obtido not like 'recusado%' and obtido <> 'nada' and obtido <> esperado$q$), '');

-- 2. FUNCIONAL: onde a escrita funciona num clube, ela tem de funcionar no outro.
select t.eq('[funcional] toda escrita que funciona num dos clubes funciona também no outro',
  t.txt($q$select coalesce(string_agg(a.superficie || ' (A: ' || a.obtido || ' | B: ' || b.obtido || ')', '; '), '')
             from t.resultado a join t.resultado b on b.superficie = a.superficie and b.aba = 'B'
            where a.aba = 'A'
              and ((a.obtido like 'recusado%') <> (b.obtido like 'recusado%'))$q$), '');

-- 3. HONESTIDADE DA SONDA: quantas superfícies foram de fato medidas. Uma que recusa nas duas abas
--    não provou nada — e não pode entrar na conta como se tivesse passado.
select t.eq('[sonda] as 11 superfícies foram realmente exercitadas (nenhuma recusou nas duas abas, nenhuma deu "nada")',
  t.txt($q$select coalesce(string_agg(superficie, ', ' order by superficie), '')
             from (select superficie from t.resultado group by superficie
                    having bool_and(obtido like 'recusado%' or obtido = 'nada')) x$q$), '');

-- =============================================================================
--  O que a sonda não pega sozinha — e que a correção (migrations 73 e 74) precisa garantir.
-- =============================================================================
\o /dev/null
create function t.mensalidade(p_mes int, p_quem text, p_status text) returns text language sql as $$
  select format($s$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
                   values (t.id(%L), %s, 2026, 25, %L, auth.uid())
                   on conflict (club_id, desbravador_id, mes, ano) do update
                     set desbravador_id = excluded.desbravador_id, status = excluded.status$s$,
                p_quem, p_mes, p_status);
$$;
create function t.status_mensalidade(p_club text, p_mes int) returns text
language sql security definer set search_path = '' as $$
  select coalesce(string_agg(status, ','), 'nenhuma') from public.mensalidades
   where club_id = t.id(p_club) and desbravador_id = t.id('membro_a') and mes = p_mes and ano = 2026;
$$;
\o

-- 4. O MESMO mês da MESMA pessoa, nos dois caixas. Antes da 74, a segunda recusava com "duplicate
--    key" — e a recusa contava ao tesoureiro de B que a pessoa tem um registro financeiro em A.
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('[mensalidade] agosto de membro_a no caixa de A', t.mensalidade(8, 'membro_a', 'pago'));
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('[mensalidade] ...o MESMO agosto no caixa de B, sem esbarrar no de A (sem oráculo)', t.mensalidade(8, 'membro_a', 'pago'));
-- o upsert de B, pela segunda vez, é o caminho do DO UPDATE: tem de mexer SÓ na linha de B
select t.permitido('[mensalidade] B desmarca o agosto dele (o upsert que a tela faz)', t.mensalidade(8, 'membro_a', 'pendente'));
reset role;
select t.eq('[mensalidade] A continua com o agosto PAGO — o upsert de B não tocou nem moveu a linha de A',
  t.status_mensalidade('clube_a', 8), 'pago');
select t.eq('[mensalidade] ...e B tem o dele, pendente', t.status_mensalidade('clube_b', 8), 'pendente');

-- 5. Um `club_id` explícito não é passe livre.
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.bloqueado('[explícito] B não cobra, em B, quem não é de B (membro_a2 só é de A)',
  $q$insert into public.mensalidades (club_id, desbravador_id, mes, ano, valor, status)
     values (t.id('clube_b'), t.id('membro_a2'), 9, 2026, 25, 'pago')$q$);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.bloqueado('[explícito] da aba A, a liderança de A não escreve no caixa de B mandando club_id = B',
  $q$insert into public.mensalidades (club_id, desbravador_id, mes, ano, valor, status)
     values (t.id('clube_b'), t.id('membro_a'), 9, 2026, 25, 'pago')$q$);
reset role;
select t.eq('[explícito] ...e nada de setembro existe em lugar nenhum',
  t.status_mensalidade('clube_a', 9) || '/' || t.status_mensalidade('clube_b', 9), 'nenhuma/nenhuma');

-- 6. O aviso pessoal que a ajuda gera cai no clube da ABA. membro_b entrou em A por último: o
--    palpite antigo ("o clube mais novo de quem recebe") mandava para A o aviso de uma ajuda pedida em B.
select t.como('membro_a'); select t.pedir_clube('clube_b');
select t.eq('[aviso] a ajuda pedida na aba B avisa o amigo NO CLUBE B',
  t.onde_caiu($s$select public.pedir_ajuda(t.id('membro_b'), 'forca', '{"palavra":"sonda"}'::jsonb, 'x')$s$,
              'notificacoes', 'para_usuario', t.id('membro_b')), 'B');
select t.pedir_clube('clube_a');
select t.eq('[aviso] ...e a pedida na aba A, no clube A',
  t.onde_caiu($s$select public.pedir_ajuda(t.id('membro_b'), 'forca', '{"palavra":"sonda"}'::jsonb, 'x')$s$,
              'notificacoes', 'para_usuario', t.id('membro_b')), 'A');
reset role;

-- 7. Rotina do banco NÃO tem aba. Um header esquecido na sessão (aqui: A) não pode virar carimbo —
--    sem sessão de cliente, vale o palpite antigo: o clube mais antigo de membro_b, que é B.
select t.como_cron(); select t.pedir_clube('clube_a');
select t.eq('[rotina] a mensalidade gerada pelo banco cai no clube da pessoa, não no header',
  t.onde_caiu($s$insert into public.mensalidades (desbravador_id, mes, ano, valor, status)
                 values (t.id('membro_b'), 10, 2026, 25, 'pendente')$s$,
              'mensalidades', 'desbravador_id', t.id('membro_b')), 'B');
select t.esquecer_clube_pedido();

select t.fim();
rollback;
