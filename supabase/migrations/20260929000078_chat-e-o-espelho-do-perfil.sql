-- =============================================================================
--  Fase 9 (ISOLAMENTO / funcional) — o chat e as funções que ainda liam o ESPELHO do perfil.
--
--  Achado pelo TESTE DE CARGA (item 10), não pelos gates: o dataset sintético tem pessoas em dois
--  clubes, e no ensaio de 5 usuários o chat recusou uma delas com "Autor de outro clube." — na aba
--  do clube MAIS ANTIGO dela. É a mesma raiz da migration 73 (o clube saindo da pessoa, não da
--  aba), numa superfície que o teste 58 não sondava.
--
--  1. `definir_club_chat` exigia que o clube MAIS NOVO do autor fosse o da conversa (e o mesmo para
--     o participante de uma conversa direta). Quem é de dois clubes só conversava no mais novo.
--
--  2. A varredura que se seguiu achou 11 funções decidindo papel, status ou unidade pelo ESPELHO de
--     `profiles` — que reflete só o clube PRIMÁRIO da pessoa:
--       chat (geral, unidade, direta), bíblia (iniciar, confirmar), bichinho (adotar, cuidar),
--       lance conjunto do leilão (confirmar, recusar), criar_duelo e minha_unidade().
--     Para quem é de um clube só, espelho e vínculo coincidem. Para quem é de vários, a unidade ou
--     o papel vêm do clube errado. O caso que mais pesa: `chat_enviar_unidade` pegava a unidade do
--     clube PRIMÁRIO — corrigir só o gatilho (1) teria deixado a pessoa, na aba B, escrever no chat
--     da unidade dela em A. As duas correções têm de ir juntas.
--
--  3. `biblia_confirmar_leitura` gravava o histórico sem `club_id`: a leitura feita na aba A era
--     carimbada no clube mais novo.
--
--  A regra, a mesma da 73: o papel, a unidade e o "estar ativo" são os do VÍNCULO no clube da aba.
--  As funções abaixo são as de antes com SÓ essas linhas trocadas (geradas a partir da definição
--  em vigor e conferidas uma a uma: cada troca aconteceu exatamente uma vez).
-- =============================================================================

-- O vínculo ATIVO e vigente de uma pessoa num clube: papel e unidade. Vazio se não houver.
create or replace function public._vinculo_ativo(p_user uuid, p_club uuid)
returns table (papel text, unidade_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.role, m.unidade_id
    from public.organization_memberships m
   where m.user_id = p_user and m.organizational_unit_id = p_club
     and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
   order by m.created_at desc
   limit 1;
$$;
revoke all on function public._vinculo_ativo(uuid, uuid) from public, anon, authenticated;

-- ---------- 1. o gatilho do chat ----------
create or replace function public.definir_club_chat()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_club uuid;
begin
  if tg_table_name = 'chat_conversas' then
    if new.unidade_id is not null then
      select club_id into v_club from public.unidades where id = new.unidade_id;
    else
      v_club := coalesce(new.club_id, public.clube_atual_id());
    end if;
    new.club_id := v_club;
  elsif tg_table_name = 'chat_mensagens' then
    select club_id into v_club from public.chat_conversas where id = new.conversa_id;
    new.club_id := v_club;
    -- o autor precisa estar ATIVO no clube DA CONVERSA (antes: o clube mais novo dele tinha de ser esse)
    if not public._tem_vinculo(new.autor_id, v_club) then
      raise exception 'Autor de outro clube.';
    end if;
  else  -- chat_participantes
    select club_id into v_club from public.chat_conversas where id = new.conversa_id;
    new.club_id := v_club;
    if not public._tem_vinculo(new.usuario_id, v_club) then
      raise exception 'Participante de outro clube.';
    end if;
  end if;
  if v_club is null then
    raise exception 'Conversa sem clube.';
  end if;
  return new;
end;
$$;

-- ---------- 2 e 3. as funções que liam o espelho (corpo em vigor, só as leituras trocadas) ----------

-- ---------- chat_enviar_geral ----------
CREATE OR REPLACE FUNCTION public.chat_enviar_geral(p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_papel text;
  v_conversa_id uuid;
  v_texto text := trim(coalesce(p_texto, ''));
  v_recentes int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if length(v_texto) = 0 then raise exception 'Escreva algo.'; end if;
  if length(v_texto) > 500 then raise exception 'Mensagem muito longa (máx. 500 caracteres).'; end if;
  if public._chat_tem_palavrao(v_texto) then
    raise exception 'Essa mensagem tem uma palavra não permitida. Reescreva, por favor.';
  end if;

  select v.papel into v_papel from public._vinculo_ativo(v_uid, v_club) v;
  if v_papel is null or not public.membro_ativo_no_clube(v_club) then raise exception 'Você precisa estar ativo pra usar o chat.'; end if;
  if v_papel = 'pais' then raise exception 'O chat não é pra responsáveis.'; end if;

  select count(*) into v_recentes from public.chat_mensagens
  where autor_id = v_uid and created_at > now() - interval '5 minutes';
  if v_recentes >= 30 then
    raise exception 'Calma lá! Espere um pouquinho antes de mandar mais mensagens.';
  end if;

  select id into v_conversa_id from public.chat_conversas where tipo = 'geral' and club_id = v_club limit 1;
  if v_conversa_id is null then
    insert into public.chat_conversas (club_id, tipo) values (v_club, 'geral') returning id into v_conversa_id;
  end if;

  insert into public.chat_mensagens (conversa_id, autor_id, texto) values (v_conversa_id, v_uid, v_texto);

  return json_build_object('ok', true, 'conversa_id', v_conversa_id);
end;
$function$;

-- ---------- chat_enviar_unidade ----------
CREATE OR REPLACE FUNCTION public.chat_enviar_unidade(p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_papel text;
  v_unidade uuid;
  v_conversa_id uuid;
  v_texto text := trim(coalesce(p_texto, ''));
  v_recentes int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if length(v_texto) = 0 then raise exception 'Escreva algo.'; end if;
  if length(v_texto) > 500 then raise exception 'Mensagem muito longa (máx. 500 caracteres).'; end if;
  if public._chat_tem_palavrao(v_texto) then
    raise exception 'Essa mensagem tem uma palavra não permitida. Reescreva, por favor.';
  end if;

  select v.unidade_id, v.papel into v_unidade, v_papel from public._vinculo_ativo(v_uid, v_club) v;
  if v_unidade is null or not public.membro_ativo_no_clube(v_club) then raise exception 'Você precisa estar numa unidade ativa pra usar o chat.'; end if;
  if v_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros mandam mensagem no chat.';
  end if;

  select count(*) into v_recentes from public.chat_mensagens
  where autor_id = v_uid and created_at > now() - interval '5 minutes';
  if v_recentes >= 30 then
    raise exception 'Calma lá! Espere um pouquinho antes de mandar mais mensagens.';
  end if;

  insert into public.chat_conversas (club_id, tipo, unidade_id) values (v_club, 'unidade', v_unidade)
  on conflict (unidade_id) where tipo = 'unidade' do nothing;

  select id into v_conversa_id from public.chat_conversas where tipo = 'unidade' and unidade_id = v_unidade;

  insert into public.chat_mensagens (conversa_id, autor_id, texto) values (v_conversa_id, v_uid, v_texto);

  return json_build_object('ok', true, 'conversa_id', v_conversa_id);
end;
$function$;

-- ---------- chat_enviar_direta ----------
CREATE OR REPLACE FUNCTION public.chat_enviar_direta(p_destinatario_id uuid, p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_papel text;
  v_dest_papel text;
  v_texto text := trim(coalesce(p_texto, ''));
  v_conversa_id uuid;
  v_recentes int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_destinatario_id is null or p_destinatario_id = v_uid then raise exception 'Destinatário inválido.'; end if;
  if length(v_texto) = 0 then raise exception 'Escreva algo.'; end if;
  if length(v_texto) > 500 then raise exception 'Mensagem muito longa (máx. 500 caracteres).'; end if;
  if public._chat_tem_palavrao(v_texto) then
    raise exception 'Essa mensagem tem uma palavra não permitida. Reescreva, por favor.';
  end if;

  select v.papel into v_papel from public._vinculo_ativo(v_uid, v_club) v;
  if v_papel is null or not public.membro_ativo_no_clube(v_club) then raise exception 'Você precisa estar ativo pra usar o chat.'; end if;
  if v_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros mandam mensagem no chat.';
  end if;

  select v.papel into v_dest_papel from public._vinculo_ativo(p_destinatario_id, v_club) v;
  if v_dest_papel is null or v_dest_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Essa pessoa não está disponível pro chat.';
  end if;

  select count(*) into v_recentes from public.chat_mensagens
  where autor_id = v_uid and created_at > now() - interval '5 minutes';
  if v_recentes >= 30 then
    raise exception 'Calma lá! Espere um pouquinho antes de mandar mais mensagens.';
  end if;

  -- Trava por PAR (ordem fixa) — evita 2 conversas duplicadas se os dois
  -- mandarem a primeira mensagem quase ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtext(
    'chat_par:' || least(v_uid, p_destinatario_id)::text || ':' || greatest(v_uid, p_destinatario_id)::text
  ));

  select cp1.conversa_id into v_conversa_id
  from public.chat_participantes cp1
  join public.chat_participantes cp2 on cp2.conversa_id = cp1.conversa_id
  join public.chat_conversas c on c.id = cp1.conversa_id
  where c.tipo = 'direta' and c.club_id = v_club and cp1.usuario_id = v_uid and cp2.usuario_id = p_destinatario_id
  limit 1;

  if v_conversa_id is null then
    insert into public.chat_conversas (club_id, tipo) values (v_club, 'direta') returning id into v_conversa_id;
    insert into public.chat_participantes (conversa_id, usuario_id)
    values (v_conversa_id, v_uid), (v_conversa_id, p_destinatario_id);
  end if;

  insert into public.chat_mensagens (conversa_id, autor_id, texto) values (v_conversa_id, v_uid, v_texto);

  return json_build_object('ok', true, 'conversa_id', v_conversa_id);
end;
$function$;

-- ---------- biblia_iniciar_leitura ----------
CREATE OR REPLACE FUNCTION public.biblia_iniciar_leitura(p_livro_abrev text, p_capitulo integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_max int;
  v_req int;
  v_aberto timestamptz;
  v_restante int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not exists (select 1 from public._vinculo_ativo(v_uid, public.clube_atual_id())) then
    raise exception 'Você precisa estar com o cadastro ativo pra ler a Bíblia no app.';
  end if;
  select capitulos into v_max from public.biblia_livros where abrev = p_livro_abrev;
  if v_max is null then raise exception 'Livro inválido.'; end if;
  if p_capitulo < 1 or p_capitulo > v_max then raise exception 'Capítulo inválido.'; end if;

  -- Já lido antes? pode reler à vontade, sem tempo e sem pontos de novo.
  if exists (select 1 from public.biblia_leituras
             where usuario_id = v_uid and livro_abrev = p_livro_abrev and capitulo = p_capitulo) then
    return json_build_object('ja_lido', true, 'segundos', 0);
  end if;

  v_req := public._biblia_segundos_min(p_livro_abrev, p_capitulo);

  -- Marca ESTE como a leitura em andamento (troca qualquer outra que
  -- estivesse aberta — só dá pra ler um capítulo de cada vez). Se já era o
  -- mesmo capítulo, PRESERVA o aberto_em (retoma o tempo já corrido).
  insert into public.biblia_leitura_atual (usuario_id, livro_abrev, capitulo, aberto_em, club_id)
  values (v_uid, p_livro_abrev, p_capitulo, now(), v_club)
  on conflict (usuario_id) do update
    set livro_abrev = excluded.livro_abrev,
        capitulo = excluded.capitulo,
        club_id = excluded.club_id,
        aberto_em = case
          when biblia_leitura_atual.livro_abrev = excluded.livro_abrev
           and biblia_leitura_atual.capitulo = excluded.capitulo
          then biblia_leitura_atual.aberto_em
          else now()
        end
  returning aberto_em into v_aberto;

  v_restante := greatest(0, v_req - floor(extract(epoch from (now() - v_aberto)))::int);
  return json_build_object('ja_lido', false, 'segundos', v_restante);
end;
$function$;

-- ---------- biblia_confirmar_leitura ----------
CREATE OR REPLACE FUNCTION public.biblia_confirmar_leitura(p_livro_abrev text, p_capitulo integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_atual record;
  v_segundos int;
  v_pontos_hoje int;
  v_pontos_ganhos int := 0;
  v_limite boolean := false;
  v_total int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  -- Revalida o cadastro ativo aqui também (não só no abrir), pra quem foi
  -- desativado entre abrir e confirmar não pontuar.
  if not exists (select 1 from public._vinculo_ativo(v_uid, v_club)) then
    raise exception 'Você precisa estar com o cadastro ativo pra ganhar pontos lendo.';
  end if;

  -- Já lido? nada a fazer (não pontua de novo).
  if exists (select 1 from public.biblia_leituras
             where usuario_id = v_uid and livro_abrev = p_livro_abrev and capitulo = p_capitulo) then
    select count(*) into v_total from public.biblia_leituras where usuario_id = v_uid;
    return json_build_object('lido', true, 'ja_lido', true, 'pontos_ganhos', 0, 'total_capitulos_lidos', v_total);
  end if;

  -- Trava a linha da leitura em andamento (evita 2 confirmações em corrida).
  select * into v_atual from public.biblia_leitura_atual where usuario_id = v_uid for update;

  -- Não abriu, ou abriu OUTRO capítulo depois: não vale.
  if not found or v_atual.livro_abrev <> p_livro_abrev or v_atual.capitulo <> p_capitulo then
    return json_build_object('invalido', true);
  end if;

  v_segundos := public._biblia_segundos_min(p_livro_abrev, p_capitulo);
  if now() - v_atual.aberto_em < make_interval(secs => v_segundos) then
    return json_build_object('muito_rapido', true,
      'faltam', greatest(0, ceil(v_segundos - extract(epoch from (now() - v_atual.aberto_em)))::int));
  end if;

  -- Passou no tempo: marca como lido (permanente) e limpa a leitura atual.
  insert into public.biblia_leituras (usuario_id, livro_abrev, capitulo, club_id)
  values (v_uid, p_livro_abrev, p_capitulo, v_club)
  on conflict (usuario_id, livro_abrev, capitulo) do nothing;
  delete from public.biblia_leitura_atual where usuario_id = v_uid;

  -- Pontua (+2, teto 20/dia). Conta de teste não pontua.
  if not public.eh_teste() then
    select coalesce(sum(pontos), 0) into v_pontos_hoje from public.pontos
    where usuario_id = v_uid and origem = 'biblia'
      and (data at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;
    if v_pontos_hoje < 20 then
      v_pontos_ganhos := least(2, 20 - v_pontos_hoje);
      insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
      values (v_uid, 'biblia', v_pontos_ganhos,
              'Leu ' || (select nome from public.biblia_livros where abrev = p_livro_abrev) || ' ' || p_capitulo, v_club);
    else
      -- Leu de verdade mas já bateu o teto do dia: conta o progresso, avisa
      -- que o limite foi atingido (pra tela não parecer que "roubou" ponto).
      v_limite := true;
    end if;
  end if;

  select count(*) into v_total from public.biblia_leituras where usuario_id = v_uid;
  return json_build_object('lido', true, 'ja_lido', false, 'pontos_ganhos', v_pontos_ganhos,
                           'limite_diario', v_limite, 'total_capitulos_lidos', v_total);
end;
$function$;

-- ---------- bichinho_adotar ----------
CREATE OR REPLACE FUNCTION public.bichinho_adotar(p_nome text, p_especie text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_nome text := trim(coalesce(p_nome, ''));
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not exists (select 1 from public._vinculo_ativo(v_uid, public.clube_atual_id())) then
    raise exception 'Seu cadastro precisa estar ativo pra adotar um bichinho.';
  end if;
  if p_especie not in ('cachorro', 'gato', 'coelho', 'passaro') then raise exception 'Espécie inválida.'; end if;
  if length(v_nome) < 1 then raise exception 'Dê um nome pro bichinho.'; end if;
  if length(v_nome) > 20 then raise exception 'Nome muito longo (máx. 20 letras).'; end if;

  perform pg_advisory_xact_lock(hashtext('bichinho:' || v_uid::text));

  if exists (select 1 from public.bichinhos b where b.usuario_id = v_uid and b.vivo
             and (b.dormindo_desde is not null or now() - b.ultimo_cuidado_em <= interval '72 hours')) then
    raise exception 'Você já tem um bichinho vivo! Cuide bem dele. 🐾';
  end if;

  insert into public.bichinhos
    (usuario_id, especie, nome, fome, higiene, felicidade, atualizado_em, ultimo_cuidado_em,
     pontuado_em, dias_cuidados, cuidados_total, ofensiva, vivo, morto_em, nascido_em, dormindo_desde, club_id)
  values (v_uid, p_especie, v_nome, 100, 100, 100, now(), now(), null, 0, 0, 0, true, null, now(), null, v_club)
  on conflict (usuario_id) do update set
    especie = excluded.especie, nome = excluded.nome, fome = 100, higiene = 100, felicidade = 100,
    atualizado_em = now(), ultimo_cuidado_em = now(), pontuado_em = null,
    dias_cuidados = 0, cuidados_total = 0, ofensiva = 0, vivo = true, morto_em = null, nascido_em = now(),
    dormindo_desde = null, club_id = excluded.club_id;

  return json_build_object('ok', true);
end;
$function$;

-- ---------- bichinho_cuidar ----------
CREATE OR REPLACE FUNCTION public.bichinho_cuidar(p_acao text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  b record;
  v_h numeric;
  v_fome int; v_hig int; v_fel int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_conta boolean := false;
  v_ativo boolean;
  v_pontos int := 0;
  v_sono interval;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_acao not in ('alimentar', 'banho', 'brincar') then raise exception 'Ação inválida.'; end if;

  select * into b from public.bichinhos where usuario_id = v_uid for update;
  if not found then raise exception 'Você ainda não tem um bichinho. Adote um! 🐾'; end if;

  if b.dormindo_desde is not null then
    v_sono := greatest(interval '0', now() - b.dormindo_desde);
    update public.bichinhos set
      dormindo_desde = null,
      atualizado_em = b.atualizado_em + v_sono,
      ultimo_cuidado_em = b.ultimo_cuidado_em + v_sono,
      pontuado_em = case when b.pontuado_em is null then null else b.pontuado_em + v_sono end
    where usuario_id = v_uid
    returning * into b;
  end if;

  if b.vivo and b.pontuado_em is not null and now() - b.ultimo_cuidado_em > interval '72 hours' then
    update public.bichinhos set vivo = false, morto_em = b.ultimo_cuidado_em + interval '72 hours'
      where usuario_id = v_uid;
    return json_build_object('morreu', true);
  end if;
  if not b.vivo then return json_build_object('morreu', true); end if;

  v_h := extract(epoch from (now() - b.atualizado_em)) / 3600.0;
  v_fome := greatest(0, b.fome       - floor(3 * v_h))::int;
  v_hig  := greatest(0, b.higiene    - floor(3 * v_h))::int;
  v_fel  := greatest(0, b.felicidade - floor(3 * v_h))::int;
  if p_acao = 'alimentar' then v_fome := 100;
  elsif p_acao = 'banho' then v_hig := 100;
  else v_fel := 100; end if;

  v_conta := (b.pontuado_em is null or now() - b.pontuado_em >= interval '20 hours');
  v_ativo := exists (select 1 from public._vinculo_ativo(v_uid, public.clube_atual_id()));

  update public.bichinhos set
    fome = v_fome, higiene = v_hig, felicidade = v_fel,
    atualizado_em = now(), ultimo_cuidado_em = now(),
    cuidados_total = b.cuidados_total + 1,
    dias_cuidados = b.dias_cuidados + (case when v_conta then 1 else 0 end),
    ofensiva = case
      when not v_conta then b.ofensiva
      when b.pontuado_em is not null and now() - b.pontuado_em < interval '48 hours' then b.ofensiva + 1
      else 1 end,
    pontuado_em = case when v_conta then now() else b.pontuado_em end
  where usuario_id = v_uid;

  if v_conta and v_ativo and not public.eh_teste() then
    v_pontos := 2;
    insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
    values (v_uid, 'bichinho', 2, 'Cuidou do bichinho ' || to_char(v_hoje, 'DD/MM'), v_club);
  end if;

  return json_build_object('ok', true, 'pontos_ganhos', v_pontos, 'contou', v_conta,
    'fome', v_fome, 'higiene', v_hig, 'felicidade', v_fel);
end;
$function$;

-- ---------- confirmar_lance_conjunto ----------
CREATE OR REPLACE FUNCTION public.confirmar_lance_conjunto(p_lance_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_minha_unidade uuid;
  v_item_id uuid; v_valor int; v_leilao_id uuid;
  v_leilao_status text; v_fecha_em timestamptz;
  v_preco_base int; v_incremento int;
  v_status_atual text;
  v_maior_valor int;
  v_faltam int;
  v_saldo int;
  v_meu_papel text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.leilao_habilitado(v_club) then raise exception 'O leilão não está habilitado para o seu clube.'; end if;
  select v.unidade_id, v.papel into v_minha_unidade, v_meu_papel from public._vinculo_ativo(v_uid, public.clube_atual_id()) v;
  if v_minha_unidade is null then raise exception 'Você precisa estar numa unidade ativa.'; end if;
  if v_meu_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros podem confirmar lance no leilão.';
  end if;

  select l.item_id, l.valor, it.leilao_id, it.preco_base, it.incremento_minimo
    into v_item_id, v_valor, v_leilao_id, v_preco_base, v_incremento
  from public.leilao_lances l join public.leilao_itens it on it.id = l.item_id
  where l.id = p_lance_id and l.club_id = v_club;
  if v_item_id is null then raise exception 'Lance não encontrado.'; end if;

  if not exists (
    select 1 from public.leilao_lance_unidades
    where lance_id = p_lance_id and unidade_id = v_minha_unidade and confirmado = false
  ) then
    raise exception 'Sua unidade não precisa confirmar esse lance.';
  end if;

  -- Trava a linha do leilão (mesma trava de dar_lance/recusar/encerrar/cron).
  select status, fecha_em into v_leilao_status, v_fecha_em from public.leiloes where id = v_leilao_id for update;
  if v_leilao_status <> 'aberto' then raise exception 'Esse leilão já encerrou.'; end if;
  if now() >= v_fecha_em then raise exception 'O tempo desse leilão acabou.'; end if;

  select status into v_status_atual from public.leilao_lances where id = p_lance_id;
  if v_status_atual <> 'pendente' then
    raise exception 'Esse lance não está mais pendente (alguém recusou, ou o leilão fechou).';
  end if;

  update public.leilao_lance_unidades set confirmado = true
   where lance_id = p_lance_id and unidade_id = v_minha_unidade;

  select count(*) into v_faltam from public.leilao_lance_unidades
  where lance_id = p_lance_id and confirmado = false;
  if v_faltam > 0 then
    return json_build_object('ativado', false, 'faltam', v_faltam);
  end if;

  -- Todo mundo confirmou: valida de novo (o mundo pode ter mudado) e ativa.
  -- Sem "raise exception" ao invalidar: devolve o motivo no JSON e commita o
  -- 'superado' (uma exceção desfaria a transação e o lance ficaria pendente).
  select coalesce(max(valor), 0) into v_maior_valor
  from public.leilao_lances where item_id = v_item_id and status = 'ativo';
  if v_valor < v_preco_base or (v_maior_valor > 0 and v_valor < v_maior_valor + v_incremento) then
    update public.leilao_lances set status = 'superado' where id = p_lance_id;
    return json_build_object('ativado', false,
      'motivo', 'Enquanto vocês combinavam, outra unidade deu um lance maior. Esse lance não vale mais.');
  end if;

  -- NOVO — SALDO COLETIVO: as unidades podem SOMAR forças. Basta a soma do que
  -- cada uma tem disponível cobrir o valor. Soma de volta o que as próprias
  -- unidades do lance já têm reservado NESTE item (o lance ativo que será
  -- superado abaixo), senão a conta ficaria estrita demais.
  select coalesce(sum(public.leilao_saldo_unidade(lu.unidade_id)), 0) into v_saldo
  from public.leilao_lance_unidades lu
  where lu.lance_id = p_lance_id;

  select v_saldo + coalesce(sum(l.valor), 0) into v_saldo
  from public.leilao_lances l
  join public.leilao_lance_unidades lua on lua.lance_id = l.id
  where l.item_id = v_item_id and l.status = 'ativo'
    and lua.unidade_id in (select unidade_id from public.leilao_lance_unidades where lance_id = p_lance_id);

  if v_saldo < v_valor then
    update public.leilao_lances set status = 'superado' where id = p_lance_id;
    return json_build_object('ativado', false, 'motivo',
      'Juntas, as unidades não têm ' || v_valor || ' pontos disponíveis agora. Esse lance não vale mais.');
  end if;

  update public.leilao_lances set status = 'superado' where item_id = v_item_id and status = 'ativo';
  update public.leilao_lances set status = 'ativo' where id = p_lance_id and status = 'pendente';

  return json_build_object('ativado', true);
end;
$function$;

-- ---------- recusar_lance_conjunto ----------
CREATE OR REPLACE FUNCTION public.recusar_lance_conjunto(p_lance_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_minha_unidade uuid;
  v_leilao_id uuid;
  v_leilao_status text;
  v_status_atual text;
  v_meu_papel text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.leilao_habilitado(v_club) then raise exception 'O leilão não está habilitado para o seu clube.'; end if;
  select v.unidade_id, v.papel into v_minha_unidade, v_meu_papel from public._vinculo_ativo(v_uid, public.clube_atual_id()) v;
  if v_minha_unidade is null then raise exception 'Você precisa estar numa unidade ativa.'; end if;
  if v_meu_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros podem recusar lance no leilão.';
  end if;

  select it.leilao_id into v_leilao_id
  from public.leilao_lances l join public.leilao_itens it on it.id = l.item_id
  where l.id = p_lance_id and l.club_id = v_club;
  if v_leilao_id is null then raise exception 'Lance não encontrado.'; end if;

  if not exists (
    select 1 from public.leilao_lance_unidades
    where lance_id = p_lance_id and unidade_id = v_minha_unidade and confirmado = false
  ) then
    raise exception 'Sua unidade não precisa confirmar esse lance.';
  end if;

  -- Trava a MESMA linha do leilão que dar_lance/confirmar/encerrar/cron usam
  -- (não a linha do lance) — assim recusar nunca corre por cima de um
  -- confirmar_lance_conjunto ativando o mesmo lance ao mesmo tempo.
  select status into v_leilao_status from public.leiloes where id = v_leilao_id for update;

  select status into v_status_atual from public.leilao_lances where id = p_lance_id;
  if v_status_atual <> 'pendente' then raise exception 'Esse lance não está mais pendente.'; end if;

  update public.leilao_lances set status = 'superado' where id = p_lance_id and status = 'pendente';

  return json_build_object('ok', true);
end;
$function$;

-- ---------- criar_duelo ----------
CREATE OR REPLACE FUNCTION public.criar_duelo(p_desafio_id uuid, p_unidade_b uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_ua uuid;
  v_dias int; v_titulo text; v_pontos int;
  v_abertos int; v_recentes int;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  -- Só desafia PELA SUA unidade (não dá pra desafiar em nome de outra) e só quem
  -- já teve o cadastro aprovado (status ativo) — senão um cadastro pendente com
  -- unidade poderia lançar duelos e tocar o push do clube.
  select v.unidade_id into v_ua
  from public._vinculo_ativo(v_uid, v_club) v;
  if v_ua is null or not public.membro_ativo_no_clube(v_club) then
    raise exception 'Você precisa estar numa unidade (com cadastro aprovado) pra desafiar.';
  end if;
  if p_unidade_b is null or p_unidade_b = v_ua then
    raise exception 'Escolha OUTRA unidade pra desafiar.';
  end if;
  -- só unidade do MEU clube (unidade de outro clube = "não encontrada", sem revelar que existe)
  if not exists (select 1 from public.unidades where id = p_unidade_b and club_id = v_club) then
    raise exception 'Unidade não encontrada.';
  end if;

  -- O desafio precisa existir, ser do meu clube e estar ativo (e guardamos o snapshot dele)
  select dias, titulo, pontos into v_dias, v_titulo, v_pontos
  from public.desafios_unidade where id = p_desafio_id and ativo and club_id = v_club;
  if v_dias is null then
    raise exception 'Desafio inválido ou desativado.';
  end if;

  -- Trava 1 — na MINHA unidade: serializa os dois tetos abaixo (contar-e-inserir).
  -- Sem ela, várias chamadas paralelas contra adversários DIFERENTES pegariam
  -- travas diferentes, leriam a mesma contagem e furariam os limites (spam de push).
  perform pg_advisory_xact_lock(hashtext('duelo_uni:' || v_ua::text));

  -- Trava 2 — no PAR de unidades: impede a corrida espelhada (X desafia Y no mesmo
  -- instante em que Y desafia X), que criaria 2 duelos iguais e premiaria em dobro.
  -- Ordem unidade -> par é livre de deadlock (quem segura o par nunca espera unidade).
  perform pg_advisory_xact_lock(hashtext(
    'duelo:' || least(v_ua, p_unidade_b)::text || ':' || greatest(v_ua, p_unidade_b)::text
  ));

  -- Nada de duelo repetido do mesmo desafio entre as mesmas unidades
  if exists (
    select 1 from public.duelos
    where status = 'aberto' and desafio_id = p_desafio_id
      and ((unidade_a = v_ua and unidade_b = p_unidade_b)
        or (unidade_a = p_unidade_b and unidade_b = v_ua))
  ) then
    raise exception 'Já existe um duelo aberto desse desafio entre essas unidades.';
  end if;

  -- Teto 1: 3 duelos ABERTOS por unidade (pra não virar bagunça)
  select count(*) into v_abertos
  from public.duelos where status = 'aberto' and unidade_a = v_ua;
  if v_abertos >= 3 then
    raise exception 'Sua unidade já tem 3 duelos abertos. Espere julgarem algum. 🙂';
  end if;

  -- Teto 2 (anti-spam): 3 duelos CRIADOS por pessoa a cada 24h, seja qual for o
  -- status. Sem isso, criar+cancelar em loop tocaria o push do clube sem parar.
  select count(*) into v_recentes
  from public.duelos
  where criado_por = v_uid and created_at > now() - interval '24 hours';
  if v_recentes >= 3 then
    raise exception 'Você já lançou 3 duelos nas últimas 24h. Amanhã tem mais! 🙂';
  end if;

  insert into public.duelos (desafio_id, titulo, pontos, unidade_a, unidade_b, criado_por, prazo)
  values (p_desafio_id, v_titulo, v_pontos, v_ua, p_unidade_b, v_uid,
          ((now() at time zone 'America/Sao_Paulo')::date + v_dias))
  returning id into v_id;

  return json_build_object('id', v_id);
exception when unique_violation then
  -- Backstop do índice único (corrida espelhada): mensagem amigável em vez do erro cru
  raise exception 'Já existe um duelo aberto desse desafio entre essas unidades.';
end;
$function$;

-- ---------- minha_unidade ----------
CREATE OR REPLACE FUNCTION public.minha_unidade()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select v.unidade_id from public._vinculo_ativo(auth.uid(), public.clube_atual_id()) v
$function$;
