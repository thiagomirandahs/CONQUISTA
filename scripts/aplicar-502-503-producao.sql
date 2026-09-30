-- Aplica 502 (unidade do autor no post da Rede DBV) e 503 (histórico IMUTÁVEL do consentimento de imagem)
-- em PRODUÇÃO. Pode rodar mais de uma vez. O SQL Editor não segura transação: cada comando é idempotente
-- (create or replace / if not exists / drop trigger if exists) e não há tabela temporária.
-- Para sozinho se a produção não estiver entre a 501 e a 503.
-- 502: só create or replace de funções (mesmas assinaturas/grants). 503: tabela nova + coluna nula + gatilhos
-- + RPC de leitura da diretoria; NÃO altera nenhuma regra de autorização, nenhuma tela, nenhum dado existente.
do $g$ begin
  if (select max(version) from supabase_migrations.schema_migrations) not between '20260930000501' and '20260930000503' then
    raise exception 'ABORTADO: produção fora do esperado (está em %)', (select max(version) from supabase_migrations.schema_migrations);
  end if;
end $g$;

-- ======================= 20260930000502_rede-unidade-no-post =======================
-- =============================================================================
-- 502 — Rede DBV: a UNIDADE do autor no post/comentário/story/perfil ("Clube · Unidade · há X")
-- =============================================================================
-- Fase 6, item 5 (30/09/2026). O front já mostrava a unidade quando o servidor mandasse
-- (componentes.jsx `subtituloDoAutor`, RedePerfil `perfil.unidade`) — mas nenhuma RPC mandava.
--
-- De onde vem: o VÍNCULO da pessoa NO CLUBE DO CONTEÚDO (organization_memberships.unidade_id →
-- public.unidades.nome). É um nome organizacional ("Águias", "Falcão"), não dado pessoal; só sai o
-- NOME (nem id, nem cor, nem conselheiro).
--
-- Regras:
--   * só vínculo ATIVO e vigente no clube `p_club` (suspenso/encerrado/pendente → null);
--   * a unidade tem de pertencer a esse clube (unidades.club_id = p_club);
--   * autor de COORDENAÇÃO (p_club é distrito/região…) → null (coordenação não tem unidade);
--   * membro sem unidade → null. O front nunca inventa unidade.
--
-- Nada de autorização muda: `_comunidade_autor_json` continua sem EXECUTE para anon/authenticated
-- (só as RPCs gateadas a chamam) e `rede_perfil` continua passando por `_exigir_comunidade`.
-- Um subselect escalar por autor (índice em organization_memberships(user_id, organizational_unit_id));
-- nenhuma chamada extra do app.
--
-- Só `create or replace` das duas funções (mesmas assinaturas e grants da 500). Idempotente.
-- =============================================================================

create or replace function public._comunidade_autor_json(p_autor uuid, p_club uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_autor,
    'nome', public._comunidade_nome_publico(pr.nome),
    'clube', case when u.type is distinct from 'clube' and u.id is not null then 'Coordenação · ' || u.nome else u.nome end,
    'coordenacao', coalesce(u.type <> 'clube', false),
    -- 502: nome da unidade do vínculo ATIVO no clube do conteúdo; null para coordenação e para quem não tem unidade
    'unidade', case when u.type = 'clube' then (
        select un.nome
          from public.organization_memberships m
          join public.unidades un on un.id = m.unidade_id and un.club_id = p_club
         where m.user_id = p_autor and m.organizational_unit_id = p_club
           and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
         order by (m.role <> 'pais') desc, m.created_at desc, m.id desc
         limit 1) end,
    -- 500: personagem (desenho) sai sempre; a foto de rosto só sem personagem E com a autorização de imagem
    'avatar_tipo', case when pr.avatar_tipo = 'personagem' then 'personagem' end,
    'avatar', case when pr.avatar_tipo = 'personagem' then pr.avatar end,
    'foto', case when pr.avatar_tipo is distinct from 'personagem' and public._rede_imagem_autorizada(p_autor) then pr.foto end)
    from public.profiles pr left join public.organizational_units u on u.id = p_club
   where pr.id = p_autor;
$$;
revoke all on function public._comunidade_autor_json(uuid, uuid) from public, anon, authenticated;

create or replace function public.rede_perfil(p_usuario uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_alvo uuid := coalesce(p_usuario, auth.uid());
        v_club uuid; v_papel text; v_desde timestamptz; pr public.profiles; v_eu boolean; v_personagem boolean; v_autor jsonb;
begin
  v_eu := v_alvo = v_uid;
  v_club := case when v_eu then (c ->> 'club')::uuid else public._rede_clube_do_perfil(v_alvo, (c ->> 'club')::uuid) end;
  if v_club is null then raise exception 'Este perfil não está disponível.'; end if;
  select * into pr from public.profiles where id = v_alvo;
  v_papel := public._comunidade_papel(v_alvo, v_club);
  v_personagem := coalesce(pr.avatar_tipo, 'foto') = 'personagem';
  v_autor := public._comunidade_autor_json(v_alvo, v_club);   -- 490: "Coordenação · X"; 502: unidade
  select min(m.starts_at) into v_desde from public.organization_memberships m
   where m.user_id = v_alvo and m.organizational_unit_id = v_club;
  return jsonb_build_object(
    'id', v_alvo,
    'eu', v_eu,
    'nome', public._comunidade_nome_publico(pr.nome),
    'clube', v_autor ->> 'clube',
    'unidade', v_autor ->> 'unidade',
    'coordenacao', exists (select 1 from public.organizational_units u where u.id = v_club and u.type <> 'clube'),
    'papel', v_papel,
    'desde', extract(year from v_desde)::int,
    -- 500: personagem (desenho) para todos; foto só sem personagem e com autorização de imagem
    'avatar_tipo', case when v_personagem then 'personagem' end,
    'avatar', case when v_personagem then pr.avatar end,
    'foto', case when not v_personagem and public._rede_imagem_autorizada(v_alvo) then pr.foto end,
    -- 500: a flag de consentimento é só do dono do perfil (explica por que a foto não aparece)
    'imagem_autorizada', case when v_eu then public._rede_imagem_autorizada(v_alvo) end,
    'publicacoes', (select count(*) from public.comunidade_posts p where p.autor_id = v_alvo and p.status = 'publicado'
                      and public._rede_unidade_ligada(p.club_id)),
    'conquistas', (select count(*) from public.comunidade_posts p where p.autor_id = v_alvo and p.status = 'publicado'
                     and p.tipo = 'conquista' and public._rede_unidade_ligada(p.club_id)),
    'pontos', public._rede_pontos(v_alvo));
end;
$function$;
revoke all on function public.rede_perfil(uuid) from public, anon;
grant execute on function public.rede_perfil(uuid) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('20260930000502', 'rede-unidade-no-post') on conflict do nothing;

-- ======================= 20260930000503_rede-consentimento-imagem-auditavel =======================
-- =============================================================================
-- 503 — Rede DBV: HISTÓRICO IMUTÁVEL (append-only) do consentimento de imagem
-- =============================================================================
-- Problema (Fase 6, item 6): a tabela rede_autorizacao_imagem (470) guarda só o ESTADO ATUAL —
-- cada marcação da diretoria e cada "desligar/religar" do responsável SOBRESCREVE a linha
-- (upsert). A trilha genérica auditoria_operacoes (77) registra ator/alvo/detalhe, mas:
--   * só o admin da plataforma lê (painel_operacoes, últimas 500 linhas, até 90 dias);
--   * a diretoria do clube — que arquiva o papel — não consegue provar depois QUEM marcou,
--     QUANDO e o que valia antes;
--   * não há lugar para a VERSÃO DO TERMO assinado (o texto do termo não existe ainda).
--
-- O que esta migration faz (só técnica; NENHUMA regra jurídica muda):
--   1. rede_consentimento_imagem_historico: uma linha por evento, escrita SÓ por gatilho, nunca
--      editada nem apagada (trg_imutavel = _proteger_registro_imutavel, o mesmo das investiduras).
--      Guarda: clube, criança/membro, evento, quem fez (ator), o papel de quem fez (diretoria /
--      responsável / banco), origem (app = JWT autenticado; banco = rotina), estado ANTES e DEPOIS
--      (os mesmos dois booleanos de hoje), a versão do termo (nula até existir texto jurídico) e
--      a data/hora. Nada de nome, foto ou dado sensível: só ids e booleanos.
--   2. Gatilho em rede_autorizacao_imagem (insert/update/delete): marcar, desmarcar, desligar e
--      religar viram linhas de histórico. Revogar NUNCA apaga histórico: só acrescenta.
--   3. Gatilho em comunidade_autorizacoes (o "não" do responsável para a PARTICIPAÇÃO do filho na
--      rede, 432/491): também entra no histórico, com escopo 'participacao' — quando o responsável
--      tira o filho da rede, a foto dele some junto, e a família precisa conseguir provar isso.
--   4. rede_autorizacao_imagem.versao_termo (nulo): campo reservado. Nenhuma RPC grava hoje;
--      quando o Termo existir, a RPC de marcação passa a receber a versão e o gatilho copia.
--   5. Leitura só por RPC rede_consentimento_imagem_historico(): diretoria do clube em uso (só o
--      próprio clube) ou admin da plataforma. Ninguém tem acesso direto à tabela.
--   6. Expurgo de clube (280) continua funcionando: o gatilho recusa o delete, a rotina de expurgo
--      já refaz em modo replica quando não há filho órfão — é o mesmo caminho das investiduras.
-- Idempotente. Termina com _manutencao_instalar_guarda().
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. Campo reservado para a versão do termo (nulo até existir o texto jurídico)
-- -----------------------------------------------------------------------------
alter table public.rede_autorizacao_imagem add column if not exists versao_termo text;
comment on column public.rede_autorizacao_imagem.versao_termo is
  'Versão do termo de uso de imagem que a diretoria arquivou (503). NULO até o texto do termo existir; nenhuma RPC grava ainda.';

-- -----------------------------------------------------------------------------
--  2. A tabela de histórico (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.rede_consentimento_imagem_historico (
  id            bigserial primary key,
  quando        timestamptz not null default now(),
  club_id       uuid not null references public.organizational_units(id) on delete cascade,
  usuario_id    uuid not null,                       -- a criança/membro (sem FK: o histórico sobrevive à conta)
  escopo        text not null check (escopo in ('imagem', 'participacao')),
  evento        text not null check (evento in (
                  'arquivada', 'desmarcada',                                   -- diretoria (papel assinado)
                  'desligada_pelo_responsavel', 'religada_pelo_responsavel',   -- responsável (foto)
                  'participacao_revogada', 'participacao_religada',            -- responsável (rede)
                  'alterada', 'registro_removido')),                           -- fora das RPCs (SQL direto / cascata)
  ator          uuid,                                -- quem fez (auth.uid() ou o *_por da linha); nulo = rotina do banco
  papel_ator    text not null check (papel_ator in ('diretoria', 'responsavel', 'banco')),
  origem        text not null,                       -- 'app' (JWT autenticado), 'service_role' ou 'banco'
  antes         jsonb,                               -- estado anterior (nulo no 1º registro)
  depois        jsonb,                               -- estado novo (nulo quando removido)
  versao_termo  text                                 -- copiada de rede_autorizacao_imagem.versao_termo (nula por enquanto)
);
create index if not exists rede_consentimento_hist_usuario_idx on public.rede_consentimento_imagem_historico (usuario_id, quando desc);
create index if not exists rede_consentimento_hist_clube_idx on public.rede_consentimento_imagem_historico (club_id, quando desc);
alter table public.rede_consentimento_imagem_historico enable row level security;
revoke all on public.rede_consentimento_imagem_historico from public, anon, authenticated;
revoke all on sequence public.rede_consentimento_imagem_historico_id_seq from public, anon, authenticated;

-- ninguém edita nem apaga (nem postgres por engano): mesmo gatilho das investiduras (044)
drop trigger if exists trg_imutavel on public.rede_consentimento_imagem_historico;
create trigger trg_imutavel before update or delete on public.rede_consentimento_imagem_historico
for each row execute function public._proteger_registro_imutavel();

-- -----------------------------------------------------------------------------
--  3. Quem está fazendo: origem da requisição (sem gravar token nem claims)
-- -----------------------------------------------------------------------------
create or replace function public._rede_consentimento_origem()
returns text
language sql stable set search_path = '' as $$
  select case
    when auth.uid() is not null then 'app'
    when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then 'service_role'
    else 'banco' end;
$$;
revoke all on function public._rede_consentimento_origem() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
--  4. Gatilho: rede_autorizacao_imagem -> histórico (escopo 'imagem')
--     Marcar/desmarcar (diretoria) move marcada_em; desligar/religar (responsável) move
--     responsavel_em. É por esses carimbos que o evento é reconhecido — inclusive quando a
--     diretoria remarca o MESMO valor (reconfirmação também é evento).
-- -----------------------------------------------------------------------------
create or replace function public._rede_consentimento_imagem_registrar()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_antes jsonb; v_depois jsonb; v_evento text; v_papel text; v_ator uuid;
  v_dir boolean := false; v_resp boolean := false;
begin
  if tg_op = 'DELETE' then
    insert into public.rede_consentimento_imagem_historico
      (club_id, usuario_id, escopo, evento, ator, papel_ator, origem, antes, depois, versao_termo)
    values (old.club_id, old.usuario_id, 'imagem', 'registro_removido', auth.uid(), 'banco',
            public._rede_consentimento_origem(),
            jsonb_build_object('arquivada', old.arquivada, 'desligada_pelo_responsavel', old.desligada_pelo_responsavel),
            null, old.versao_termo);
    return null;
  end if;

  v_depois := jsonb_build_object('arquivada', new.arquivada, 'desligada_pelo_responsavel', new.desligada_pelo_responsavel);
  if tg_op = 'UPDATE' then
    v_antes := jsonb_build_object('arquivada', old.arquivada, 'desligada_pelo_responsavel', old.desligada_pelo_responsavel);
    v_dir  := new.marcada_em is distinct from old.marcada_em or new.arquivada is distinct from old.arquivada;
    v_resp := new.responsavel_em is distinct from old.responsavel_em
              or new.desligada_pelo_responsavel is distinct from old.desligada_pelo_responsavel;
  else
    v_dir  := new.marcada_em is not null;
    v_resp := new.responsavel_em is not null;
  end if;

  -- evento da DIRETORIA (papel arquivado / desmarcado)
  if v_dir then
    v_evento := case when new.arquivada then 'arquivada' else 'desmarcada' end;
    v_ator := coalesce(auth.uid(), new.marcada_por);
    v_papel := case when v_ator is null then 'banco' else 'diretoria' end;
    insert into public.rede_consentimento_imagem_historico
      (club_id, usuario_id, escopo, evento, ator, papel_ator, origem, antes, depois, versao_termo)
    values (new.club_id, new.usuario_id, 'imagem', v_evento, v_ator, v_papel, public._rede_consentimento_origem(),
            v_antes, v_depois, new.versao_termo);
  end if;

  -- evento do RESPONSÁVEL (desligou / religou a foto)
  if v_resp then
    v_evento := case when new.desligada_pelo_responsavel then 'desligada_pelo_responsavel' else 'religada_pelo_responsavel' end;
    v_ator := coalesce(auth.uid(), new.responsavel_id);
    v_papel := case when v_ator is null then 'banco' else 'responsavel' end;
    insert into public.rede_consentimento_imagem_historico
      (club_id, usuario_id, escopo, evento, ator, papel_ator, origem, antes, depois, versao_termo)
    values (new.club_id, new.usuario_id, 'imagem', v_evento, v_ator, v_papel, public._rede_consentimento_origem(),
            v_antes, v_depois, new.versao_termo);
  end if;

  -- mudou algo fora das RPCs (SQL direto, sem carimbo): fica registrado mesmo assim
  if not v_dir and not v_resp and (tg_op = 'INSERT' or v_antes is distinct from v_depois
       or new.versao_termo is distinct from old.versao_termo) then
    insert into public.rede_consentimento_imagem_historico
      (club_id, usuario_id, escopo, evento, ator, papel_ator, origem, antes, depois, versao_termo)
    values (new.club_id, new.usuario_id, 'imagem', 'alterada', auth.uid(),
            case when auth.uid() is null then 'banco' else 'diretoria' end,
            public._rede_consentimento_origem(), v_antes, v_depois, new.versao_termo);
  end if;
  return null;
end;
$$;
revoke all on function public._rede_consentimento_imagem_registrar() from public, anon, authenticated;

drop trigger if exists trg_rede_consentimento_imagem_historico on public.rede_autorizacao_imagem;
create trigger trg_rede_consentimento_imagem_historico
  after insert or update or delete on public.rede_autorizacao_imagem
  for each row execute function public._rede_consentimento_imagem_registrar();

-- -----------------------------------------------------------------------------
--  5. Gatilho: comunidade_autorizacoes -> histórico (escopo 'participacao')
--     O responsável revogou/religou a participação do filho na rede (comunidade_autorizar, 432).
-- -----------------------------------------------------------------------------
create or replace function public._rede_consentimento_participacao_registrar()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_antes jsonb; v_ator uuid;
begin
  if tg_op = 'DELETE' then
    insert into public.rede_consentimento_imagem_historico
      (club_id, usuario_id, escopo, evento, ator, papel_ator, origem, antes, depois)
    values (old.club_id, old.desbravador_id, 'participacao', 'registro_removido', auth.uid(), 'banco',
            public._rede_consentimento_origem(), jsonb_build_object('autorizado', old.autorizado), null);
    return null;
  end if;
  if tg_op = 'UPDATE' then
    v_antes := jsonb_build_object('autorizado', old.autorizado);
    -- nada mudou de verdade (nem o carimbo): não polui o histórico
    if new.autorizado = old.autorizado and new.atualizado_em is not distinct from old.atualizado_em
       and new.responsavel_id is not distinct from old.responsavel_id then
      return null;
    end if;
  end if;
  v_ator := coalesce(auth.uid(), new.responsavel_id);
  insert into public.rede_consentimento_imagem_historico
    (club_id, usuario_id, escopo, evento, ator, papel_ator, origem, antes, depois)
  values (new.club_id, new.desbravador_id, 'participacao',
          case when new.autorizado then 'participacao_religada' else 'participacao_revogada' end,
          v_ator, case when v_ator is null then 'banco' else 'responsavel' end,
          public._rede_consentimento_origem(), v_antes, jsonb_build_object('autorizado', new.autorizado));
  return null;
end;
$$;
revoke all on function public._rede_consentimento_participacao_registrar() from public, anon, authenticated;

drop trigger if exists trg_rede_consentimento_participacao_historico on public.comunidade_autorizacoes;
create trigger trg_rede_consentimento_participacao_historico
  after insert or update or delete on public.comunidade_autorizacoes
  for each row execute function public._rede_consentimento_participacao_registrar();

-- -----------------------------------------------------------------------------
--  6. Leitura: diretoria do clube em uso (só o próprio clube) ou admin da plataforma (todos).
--     Sem nome, sem foto: ids, evento, quem, quando, antes/depois, versão do termo.
--     Lê MESMO com a Comunidade desligada no clube: é registro do que já aconteceu.
-- -----------------------------------------------------------------------------
create or replace function public.rede_consentimento_imagem_historico(p_usuario uuid default null, p_limite integer default 200)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_admin boolean := public.eh_admin_plataforma();
begin
  if auth.uid() is null then raise exception 'Entre para ver o histórico.'; end if;
  if not v_admin and (v_club is null or not public.pode_administrar_clube(v_club)) then
    raise exception 'Sem permissão (apenas a diretoria do clube).';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', h.id, 'quando', h.quando, 'club_id', h.club_id, 'usuario_id', h.usuario_id,
            'escopo', h.escopo, 'evento', h.evento, 'ator', h.ator, 'papel_ator', h.papel_ator, 'origem', h.origem,
            'antes', h.antes, 'depois', h.depois, 'versao_termo', h.versao_termo) order by h.quando desc, h.id desc), '[]'::jsonb)
            from (select * from public.rede_consentimento_imagem_historico h
                   where (v_admin or h.club_id = v_club)
                     and (p_usuario is null or h.usuario_id = p_usuario)
                   order by h.quando desc, h.id desc
                   limit greatest(least(coalesce(p_limite, 200), 1000), 1)) h);
end;
$$;
revoke all on function public.rede_consentimento_imagem_historico(uuid, integer) from public, anon;
grant execute on function public.rede_consentimento_imagem_historico(uuid, integer) to authenticated;

select public._manutencao_instalar_guarda();

insert into supabase_migrations.schema_migrations(version, name) values ('20260930000503', 'rede-consentimento-imagem-auditavel') on conflict do nothing;

select 'OK' as resultado,
  (select max(version) from supabase_migrations.schema_migrations) as ledger,
  (select count(*) from public.organization_memberships m join public.organizational_units u on u.id = m.organizational_unit_id
    where u.slug = 'filhos-da-conquista' and m.status = 'ativo') as ativos_filhos_da_conquista,
  (select count(*) from public.rede_consentimento_imagem_historico) as linhas_historico_consentimento;
