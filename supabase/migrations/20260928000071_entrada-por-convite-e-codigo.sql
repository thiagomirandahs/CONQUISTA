-- =============================================================================
--  Fase 8.6 — como uma pessoa ENTRA num clube, agora que cadastrar-se não coloca ninguém em lugar
--  nenhum.
--
--  São três portas, e cada uma existe porque as outras duas não servem para o caso dela:
--
--    CONVITE NOMINAL (club_team_invites)  a liderança convida alguém pelo e-mail, para a equipe.
--                                         Já existe desde a fase 8.4. Não muda aqui.
--    CONVITE COM TOKEN (club_invites)     a liderança gera um link para UMA pessoa específica —
--                                         hoje o do responsável. Ganha um caminho para quem JÁ
--                                         tem conta (item 2).
--    CÓDIGO DE ENTRADA (novo)             o clube divulga UM código/QR e quem quiser pede entrada.
--                                         É o caso do desbravador: gerar convite individual para
--                                         trinta crianças no primeiro dia do ano não é um fluxo,
--                                         é uma punição.
--
--  A REGRA QUE VALE PARA AS TRÊS, e é o que a fase pede em "sem confiar em club_id enviado pelo
--  cliente": o cliente nunca diz para qual clube está entrando. Ele apresenta um SEGREDO, e o
--  servidor descobre o clube a partir dele. Um `club_id` na URL seria um palpite editável; um
--  token é uma prova.
--
-- -----------------------------------------------------------------------------
--  O CÓDIGO NÃO É UMA CHAVE, É UM ENDEREÇO.
--
--  Isto está no item 3 e merece estar no código: apresentar o código do clube NÃO faz de ninguém
--  membro. Ele cria uma SOLICITAÇÃO pendente, e a liderança aprova pela tela de Aprovações que já
--  existe. O código diz "é para este clube"; quem diz "esta pessoa entra" continua sendo o clube.
--
--  A consequência prática disso é que o código pode ser impresso num cartaz, e um código vazado
--  não vira acesso — vira, no pior caso, uma fila de solicitações para a liderança recusar.
--
-- -----------------------------------------------------------------------------
--  POR QUE EXIGIR LOGIN PARA ABRIR UM CÓDIGO
--
--  O fluxo é "abrir → autenticar/cadastrar → confirmar clube → aceitar". A validação do código
--  acontece DEPOIS do login, e isso é uma decisão de privacidade (item 5): sem sessão, tentar
--  códigos ao acaso seria uma sonda anônima e ilimitada contra a existência de clubes. Com sessão,
--  cada tentativa tem dono, entra no limite de tentativas abaixo, e a enumeração deixa de ser
--  gratuita.
--
--  Quem chega pelo QR sem ter conta faz o cadastro primeiro — e o cadastro, desde a migration 70,
--  não o coloca em clube nenhum. Nada se perde no caminho.
-- =============================================================================

-- ---------------------------------------------------------------------------
--  1. O código de entrada do clube
--
--  Guardado em HASH, como o token do convite de responsável (mesma receita: `gen_random_bytes` +
--  `sha256`). O valor em claro aparece UMA vez, para quem gerou. Um vazamento do banco não entrega
--  os códigos, e nem a liderança consegue recuperar um código antigo — ela gera outro, e o
--  anterior morre no mesmo ato.
--
--  Um código ATIVO por clube. Regenerar é revogar o anterior: é o que "revogável/regenerável"
--  significa na prática, e evita a situação de dois cartazes válidos com códigos diferentes.
-- ---------------------------------------------------------------------------
create table if not exists public.club_entry_codes (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references public.organizational_units(id) on delete cascade,
  codigo_hash   text not null,
  -- o prefixo legível serve só para a liderança reconhecer qual cartaz está no ar ("DC-7F3…").
  -- Não é segredo e não abre nada sozinho.
  prefixo       text not null,
  papel         text not null default 'desbravador'
                check (papel in ('desbravador', 'conselheiro')),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id) on delete set null,
  criado_por    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index if not exists club_entry_codes_hash_key on public.club_entry_codes (codigo_hash);
-- Um ativo por clube. `revoked_at is null` no índice parcial: os revogados ficam guardados, para a
-- liderança poder ver que houve troca e quando.
create unique index if not exists um_codigo_ativo_por_clube
  on public.club_entry_codes (club_id) where revoked_at is null;

alter table public.club_entry_codes enable row level security;
-- Ninguém lê esta tabela direto. Nem a liderança: o que ela precisa saber (prefixo, validade) vem
-- por RPC. Sem policy, `authenticated` não enxerga linha nenhuma — e o hash nunca sai do banco.
revoke all on public.club_entry_codes from anon, authenticated;

-- ---------------------------------------------------------------------------
--  2. Tentativas — o limite de abuso (item 9)
--
--  O projeto não tinha rate limit nenhum. Este é o mais simples que resolve o problema real: uma
--  linha por tentativa, com o autor, e uma contagem por janela. Não é um balde de fichas
--  distribuído; é uma tabela com um índice, que é o que cabe num banco que já tem tudo mais.
--
--  A contagem é por PESSOA porque a validação exige login. Sem isso o limite seria por IP, que o
--  Postgres não enxerga daqui.
-- ---------------------------------------------------------------------------
create table if not exists public.entrada_tentativas (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  quando      timestamptz not null default now(),
  acertou     boolean not null
);
create index if not exists idx_entrada_tentativas_pessoa on public.entrada_tentativas (user_id, quando desc);
alter table public.entrada_tentativas enable row level security;
revoke all on public.entrada_tentativas from anon, authenticated;

create or replace function public._entrada_registrar_tentativa(p_acertou boolean)
returns void language sql security definer set search_path = '' as $$
  insert into public.entrada_tentativas (user_id, acertou) values (auth.uid(), p_acertou);
$$;

-- 10 tentativas ERRADAS em 10 minutos e a porta fecha por 10 minutos. Tentativas certas não contam:
-- quem acerta não está sondando. O número é folgado para uma pessoa digitando um código de cartaz
-- e apertado para quem está varrendo o espaço de códigos.
create or replace function public._entrada_excedeu_limite()
returns boolean language sql stable security definer set search_path = '' as $$
  select count(*) >= 10
    from public.entrada_tentativas
   where user_id = auth.uid()
     and not acertou
     and quando > now() - interval '10 minutes';
$$;

-- ---------------------------------------------------------------------------
--  3. Gerar, ver e revogar — a liderança
-- ---------------------------------------------------------------------------
create or replace function public.clube_codigo_gerar(p_dias int default null, p_papel text default 'desbravador')
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_club uuid := public.clube_atual_id();
  v_codigo text;
  v_id uuid;
  v_exp timestamptz;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  if p_papel not in ('desbravador', 'conselheiro') then
    raise exception 'O código de entrada só serve para desbravador ou conselheiro. Liderança entra por convite nominal.';
  end if;
  -- `p_dias` nulo = sem prazo. É escolha do clube (a fase pede expiração CONFIGURÁVEL, não
  -- obrigatória): um cartaz no mural do salão pode durar o ano; um código de um evento, uma tarde.
  v_exp := case when p_dias is null then null else now() + make_interval(days => greatest(1, p_dias)) end;

  -- 8 bytes = 16 caracteres hex. Espaço de 2^64: a varredura é inviável mesmo sem limite, e o
  -- limite de tentativas está lá por cima disso. Curto o bastante para caber num cartaz e ser
  -- digitado por uma criança sem erro.
  v_codigo := upper(encode(extensions.gen_random_bytes(8), 'hex'));

  -- Regenerar REVOGA o anterior, no mesmo ato: é isso que evita dois cartazes válidos ao mesmo
  -- tempo, e é o que faz "regenerar" ser também a forma de "revogar e substituir".
  update public.club_entry_codes
     set revoked_at = now(), revoked_by = auth.uid()
   where club_id = v_club and revoked_at is null;

  insert into public.club_entry_codes (club_id, codigo_hash, prefixo, papel, expires_at, criado_por)
  values (v_club, encode(extensions.digest(v_codigo, 'sha256'), 'hex'),
          left(v_codigo, 4), p_papel, v_exp, auth.uid())
  returning id into v_id;

  -- O código em claro sai daqui UMA vez. Depois disto, nem o banco sabe qual era.
  return json_build_object('id', v_id, 'codigo', v_codigo, 'expira_em', v_exp, 'papel', p_papel);
end $$;
revoke all on function public.clube_codigo_gerar(int, text) from public, anon;
grant execute on function public.clube_codigo_gerar(int, text) to authenticated;

create or replace function public.clube_codigo_atual()
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_club uuid := public.clube_atual_id(); v_row public.club_entry_codes;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  select * into v_row from public.club_entry_codes
   where club_id = v_club and revoked_at is null;
  if not found then return json_build_object('existe', false); end if;
  -- Sem o código: ele não é recuperável por desenho. A liderança vê que EXISTE um código no ar,
  -- desde quando e até quando — e, se perdeu o papel onde anotou, gera outro.
  return json_build_object('existe', true, 'prefixo', v_row.prefixo, 'papel', v_row.papel,
                           'criado_em', v_row.created_at, 'expira_em', v_row.expires_at,
                           'vencido', v_row.expires_at is not null and v_row.expires_at <= now());
end $$;
revoke all on function public.clube_codigo_atual() from public, anon;
grant execute on function public.clube_codigo_atual() to authenticated;

create or replace function public.clube_codigo_revogar()
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_club uuid := public.clube_atual_id(); v_n int;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  update public.club_entry_codes set revoked_at = now(), revoked_by = auth.uid()
   where club_id = v_club and revoked_at is null;
  get diagnostics v_n = row_count;
  return json_build_object('ok', v_n > 0);
end $$;
revoke all on function public.clube_codigo_revogar() from public, anon;
grant execute on function public.clube_codigo_revogar() to authenticated;

-- ---------------------------------------------------------------------------
--  4. Abrir: "você está entrando em…" — e SÓ isso (item 5)
--
--  Devolve a identidade PÚBLICA do clube de destino: nome, sigla, logo, lema. Nada de membros,
--  unidades, responsáveis ou contagem. É o mínimo para a pessoa confirmar que é ali mesmo antes de
--  pedir entrada — e nada que ajude quem está sondando.
--
--  Código errado, revogado, vencido e inexistente dão a MESMA resposta. É a regra de oráculo do
--  projeto, e aqui ela importa mais do que em qualquer outro lugar: a diferença entre "não existe"
--  e "existe mas expirou" já é a confirmação de que aquele clube existe.
-- ---------------------------------------------------------------------------
create or replace function public.entrada_abrir(p_codigo text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_row public.club_entry_codes; v_marca jsonb; v_nome text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if public._entrada_excedeu_limite() then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;

  select * into v_row from public.club_entry_codes
   where codigo_hash = encode(extensions.digest(upper(btrim(coalesce(p_codigo, ''))), 'sha256'), 'hex')
     and revoked_at is null
     and (expires_at is null or expires_at > now());

  perform public._entrada_registrar_tentativa(found);
  if not found then raise exception 'Código não encontrado.'; end if;

  select o.nome, o.metadata -> 'marca' into v_nome, v_marca
    from public.organizational_units o where o.id = v_row.club_id;

  return json_build_object(
    'clube', v_nome,
    'sigla', v_marca ->> 'sigla',
    'lema', v_marca ->> 'lema',
    'logo_url', v_marca ->> 'logo_url',
    'papel', v_row.papel
  );
end $$;
revoke all on function public.entrada_abrir(text) from public, anon;
grant execute on function public.entrada_abrir(text) to authenticated;

-- ---------------------------------------------------------------------------
--  5. Solicitar entrada — cria o vínculo PENDENTE
--
--  Sem unidade (item 6): quem entra não escolhe unidade. A liderança atribui depois, em Usuários,
--  porque é ela que sabe como as unidades estão organizadas e quem é a pessoa. Pedir isso no
--  formulário público nunca foi uma escolha informada — era uma lista de nomes para um
--  desconhecido adivinhar.
-- ---------------------------------------------------------------------------
create or replace function public.entrada_solicitar(p_codigo text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_row public.club_entry_codes; v_ja public.organization_memberships;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if public._entrada_excedeu_limite() then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;

  -- `for update` no código: duas solicitações simultâneas com o mesmo código não podem passar uma
  -- pela brecha da outra na checagem de vínculo existente.
  select * into v_row from public.club_entry_codes
   where codigo_hash = encode(extensions.digest(upper(btrim(coalesce(p_codigo, ''))), 'sha256'), 'hex')
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   for update;

  perform public._entrada_registrar_tentativa(found);
  if not found then raise exception 'Código não encontrado.'; end if;

  select * into v_ja from public.organization_memberships
   where user_id = v_uid and organizational_unit_id = v_row.club_id
   for update;

  if found then
    -- Já tem vínculo aqui. O código não promove, não reativa e não muda papel: quem já está
    -- encerrado ou suspenso volta pela liderança, que foi quem o tirou. Repetir a solicitação é
    -- inofensivo e idempotente.
    return json_build_object('ok', true, 'ja_era', true, 'situacao', v_ja.status);
  end if;

  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
  values (v_uid, v_row.club_id, v_row.papel, 'pendente',
          jsonb_build_object('source', 'codigo_de_entrada', 'codigo_id', v_row.id));

  return json_build_object('ok', true, 'ja_era', false, 'situacao', 'pendente');
end $$;
revoke all on function public.entrada_solicitar(text) from public, anon;
grant execute on function public.entrada_solicitar(text) to authenticated;

-- ---------------------------------------------------------------------------
--  6. A fila de aprovação, por VÍNCULO
--
--  A tela de Aprovações lia `profiles.status = 'pendente'` — o status GLOBAL da conta. Isso é
--  herança de quando havia um clube só: com N clubes, "esta pessoa está pendente" não quer dizer
--  nada sem dizer pendente ONDE. E desde a migration 70 a conta nasce ativa, então a lista ficaria
--  permanentemente vazia.
--
--  Agora a fila é do CLUBE EM USO, e o que ela lista são vínculos.
-- ---------------------------------------------------------------------------
create or replace function public.entradas_pendentes()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', p.id, 'nome', p.nome, 'nascimento', p.nascimento,
           'papel_pedido', m.role, 'quando', m.created_at,
           'origem', m.metadata ->> 'source'
         ) order by m.created_at), '[]'::json)
    from public.organization_memberships m
    join public.profiles p on p.id = m.user_id
   where m.organizational_unit_id = public.clube_atual_id()
     and m.status = 'pendente'
     and public.pode_gerir_no_clube(public.clube_atual_id());
$$;
revoke all on function public.entradas_pendentes() from public, anon;
grant execute on function public.entradas_pendentes() to authenticated;

-- ---------------------------------------------------------------------------
--  7. O convite com token, para quem JÁ TEM CONTA (item 2)
--
--  `club_invites` é consumido dentro de `handle_new_user`, no cadastro. Quem já tem conta não tinha
--  como usar o link: ele só funcionava no exato momento de criar a identidade. A fase pede
--  "pessoa já cadastrada deve usar o mesmo link sem criar outra identidade" — e criar uma segunda
--  conta para entrar num clube é exatamente o que um produto multi-clube não pode pedir.
--
--  As duas funções abaixo são o mesmo par do código: abrir (identidade pública) e aceitar.
-- ---------------------------------------------------------------------------
create or replace function public.convite_abrir(p_token text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_inv public.club_invites; v_marca jsonb; v_nome text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if public._entrada_excedeu_limite() then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;

  select * into v_inv from public.club_invites
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and used_at is null and revoked_at is null and expires_at > now();

  perform public._entrada_registrar_tentativa(found);
  if not found then raise exception 'Convite não encontrado.'; end if;

  select o.nome, o.metadata -> 'marca' into v_nome, v_marca
    from public.organizational_units o where o.id = v_inv.club_id;
  return json_build_object('clube', v_nome, 'sigla', v_marca ->> 'sigla',
                           'lema', v_marca ->> 'lema', 'logo_url', v_marca ->> 'logo_url',
                           'papel', 'pais');
end $$;
revoke all on function public.convite_abrir(text) from public, anon;
grant execute on function public.convite_abrir(text) to authenticated;

create or replace function public.convite_aceitar(p_token text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_inv public.club_invites; v_ja boolean;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if public._entrada_excedeu_limite() then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;

  select * into v_inv from public.club_invites
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and used_at is null and revoked_at is null and expires_at > now()
   for update;

  perform public._entrada_registrar_tentativa(found);
  if not found then raise exception 'Convite não encontrado.'; end if;

  select exists (select 1 from public.organization_memberships
                  where user_id = v_uid and organizational_unit_id = v_inv.club_id) into v_ja;

  if not v_ja then
    -- ATIVO e papel 'pais': este convite é nominal, emitido pela liderança para uma pessoa
    -- específica — a mesma autoridade que já valia no cadastro. E o vínculo pai/filho continua
    -- sendo outra coisa, aprovada em separado (item 4): entrar no clube como responsável não
    -- declara ninguém responsável por criança nenhuma.
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (v_uid, v_inv.club_id, 'pais', 'ativo', jsonb_build_object('source', 'convite_token'));
  end if;

  update public.club_invites set used_at = now(), used_by = v_uid where id = v_inv.id;
  return json_build_object('ok', true, 'ja_era_membro', v_ja);
end $$;
revoke all on function public.convite_aceitar(text) from public, anon;
grant execute on function public.convite_aceitar(text) to authenticated;

-- ---------------------------------------------------------------------------
--  8. O aviso "Novo cadastro" muda de gatilho — e de fonte de verdade.
--
--  Ele disparava no INSERT de `profiles` com `status = 'pendente'`, e escolhia o clube com
--  `clube_do_usuario(new.id)` — ou seja, adivinhava. Duas coisas quebram nisso agora:
--
--    · desde a migration 70 a conta nasce ATIVA (não há clube que a aprove), então o gatilho
--      simplesmente nunca mais dispararia, e a liderança deixaria de ser avisada;
--    · e o clube vinha de um palpite sobre a pessoa, não do vínculo que a pessoa acabou de pedir.
--
--  O evento que interessa não é "alguém criou uma conta" — é "alguém pediu para entrar NO MEU
--  CLUBE". Esse evento é o vínculo pendente, e ele sabe exatamente de que clube é.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_notif_novo_cadastro on public.profiles;

create or replace function public.notif_pedido_de_entrada() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_nome text;
begin
  if new.status = 'pendente' then
    select nome into v_nome from public.profiles where id = new.user_id;
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('👤 Novo cadastro', coalesce(v_nome, 'Alguém') || ' está aguardando aprovação',
            'cadastro', '/aprovacoes', 'lideranca', new.organizational_unit_id);
  end if;
  return new;
end $$;
revoke all on function public.notif_pedido_de_entrada() from public, anon, authenticated;

drop trigger if exists trg_notif_pedido_de_entrada on public.organization_memberships;
create trigger trg_notif_pedido_de_entrada
  after insert on public.organization_memberships
  for each row execute function public.notif_pedido_de_entrada();
