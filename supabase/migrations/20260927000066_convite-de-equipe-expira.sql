-- =============================================================================
--  Fase 8.5 — o convite de equipe ganha PRAZO, e o papel que ele aceita passa a existir.
--
--  DOIS DEFEITOS DA MIGRATION 61, encontrados ao montar a jornada de navegador do item 7.
--
--  1. O CONVITE NÃO EXPIRAVA.
--
--     `club_team_invites` não tem `expires_at`. A tabela irmã, `club_invites` (o convite de
--     responsável), tem — e `not null`. A diferença não foi decidida: a de responsável nasceu com
--     token e prazo na fase 5, e a de equipe nasceu na fase 8.4 a partir de uma tabela que o
--     onboarding já usava para GUARDAR e-mails, sem nunca ter sido um convite de verdade.
--
--     O que isso significa na prática: um convite criado hoje aceita para sempre. A diretoria
--     convida alguém, a pessoa não entra, passam dois anos, a diretoria mudou, o clube mudou — e o
--     link continua valendo, criando um vínculo ATIVO com papel de liderança. Um convite sem prazo
--     não é um convite: é uma chave.
--
--     14 dias. É o intervalo em que um convite ainda faz sentido para quem recebeu, e curto o
--     bastante para que uma caixa de entrada esquecida não vire acesso. Renovar é trivial — a
--     diretoria convida de novo, e o `on conflict` já reaproveita o mesmo registro.
--
--  2. `convite_equipe_criar` ACEITAVA UM PAPEL QUE A TABELA RECUSA.
--
--     A função validava contra ('desbravador', 'conselheiro', 'instrutor', 'tesoureiro',
--     'diretoria'); o CHECK da tabela só permite ('diretoria', 'tesoureiro', 'instrutor',
--     'conselheiro'). Convidar um desbravador passava pela validação da função e morria no CHECK,
--     com um erro 23514 cru na cara de quem convidou. O teste 54 não pegou porque testou um papel
--     válido e um papel obviamente inválido — nunca o que estava entre os dois.
--
--     A correção alinha a FUNÇÃO à tabela, não o contrário, e a direção importa. Este convite cria
--     vínculo ATIVO sem passar por aprovação: é o certo para quem a liderança avaliza pessoalmente
--     (a equipe do clube), e é errado para um desbravador — que é quase sempre menor de idade e
--     cujo cadastro existe justamente para o clube conferir quem é. Alargar o CHECK teria criado um
--     desvio do fluxo de aprovação. O nome da tabela já dizia: `club_team_invites`, a EQUIPE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. O prazo.
-- ---------------------------------------------------------------------------
alter table public.club_team_invites
  add column if not exists expires_at timestamptz;

-- Os convites que já existem ganham prazo a partir de agora, não da criação: seria injusto
-- expirar retroativamente um convite que a pessoa ainda não teve chance de ver.
update public.club_team_invites
   set expires_at = now() + interval '14 days'
 where expires_at is null;

alter table public.club_team_invites
  alter column expires_at set default (now() + interval '14 days'),
  alter column expires_at set not null;

-- ---------------------------------------------------------------------------
-- 2. Criar: o papel agora é o mesmo conjunto que a tabela aceita, e o prazo reinicia.
-- ---------------------------------------------------------------------------
create or replace function public.convite_equipe_criar(p_email text, p_papel text default 'instrutor')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_club uuid := public.clube_atual_id(); v_email text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'Informe o e-mail de quem você quer convidar.'; end if;

  -- A MESMA lista do CHECK da tabela. 'desbravador' e 'pais' ficam de fora de propósito:
  --   · desbravador entra por cadastro + aprovação, onde o clube confere quem é a pessoa. Este
  --     convite cria vínculo ATIVO direto, e isso só cabe para quem a liderança avaliza;
  --   · responsável entra pelo convite COM TOKEN (club_invites), que é outro fluxo e outra tabela:
  --     ele precisa do vínculo com a criança, não só do clube.
  if p_papel not in ('conselheiro', 'instrutor', 'tesoureiro', 'diretoria') then
    raise exception 'Papel inválido. A equipe do clube aceita conselheiro, instrutor, tesoureiro ou diretoria.';
  end if;

  insert into public.club_team_invites (club_id, email, papel, criado_por, status, expires_at)
  values (v_club, v_email, p_papel, auth.uid(), 'pendente', now() + interval '14 days')
  on conflict (club_id, email) do update
     set papel = excluded.papel, status = 'pendente', criado_por = excluded.criado_por,
         aceito_por = null, aceito_em = null,
         -- convidar de novo RENOVA o prazo: é o jeito de a diretoria reabrir um convite vencido
         expires_at = excluded.expires_at
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'expira_em', (now() + interval '14 days'));
end $$;
revoke all on function public.convite_equipe_criar(text, text) from public, anon;
grant execute on function public.convite_equipe_criar(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Listar: convite vencido não aparece (para ninguém clicar no que não vai funcionar).
-- ---------------------------------------------------------------------------
create or replace function public.convites_da_equipe()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', i.id, 'papel', i.papel, 'clube', o.nome,
           'sigla', o.metadata -> 'marca' ->> 'sigla', 'quando', i.created_at,
           'expira_em', i.expires_at
         ) order by i.created_at desc), '[]'::json)
    from public.club_team_invites i
    join public.organizational_units o on o.id = i.club_id
   where i.status = 'pendente'
     and i.expires_at > now()
     and i.email = (select lower(u.email) from auth.users u where u.id = auth.uid());
$$;
revoke all on function public.convites_da_equipe() from public, anon;
grant execute on function public.convites_da_equipe() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Aceitar: o prazo entra na MESMA condição das outras recusas.
--
--    De propósito na mesma linha, e não num `if` separado com mensagem própria: convite vencido,
--    convite de outra pessoa, convite já usado e convite inexistente respondem todos a mesma coisa.
--    Separar as mensagens transformaria a recusa num oráculo — quem tentasse ids ao acaso
--    descobriria quais existem pela diferença no texto.
-- ---------------------------------------------------------------------------
create or replace function public.convite_equipe_aceitar(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_i public.club_team_invites; v_ja boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  select * into v_i from public.club_team_invites
   where id = p_id and status = 'pendente'
     and expires_at > now()
     and email = (select lower(u.email) from auth.users u where u.id = v_uid)
   for update;
  if not found then raise exception 'Convite não encontrado, vencido ou já usado.'; end if;

  select exists (
    select 1 from public.organization_memberships
     where user_id = v_uid and organizational_unit_id = v_i.club_id
  ) into v_ja;

  if not v_ja then
    -- ATIVO direto: a liderança do clube já avalizou ao convidar. Pedir aprovação depois seria a
    -- mesma decisão duas vezes. O clube é o DO CONVITE — nunca o clube em uso de quem aceita.
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (v_uid, v_i.club_id, v_i.papel, 'ativo', jsonb_build_object('source', 'convite_equipe'));
  end if;
  -- Se já havia vínculo, o convite é consumido e NADA muda. Promover é ato da liderança, por
  -- `vinculo_gerir` — não efeito colateral de clicar num link.

  update public.club_team_invites
     set status = 'aceito', aceito_por = v_uid, aceito_em = now()
   where id = v_i.id;

  return jsonb_build_object('ok', true, 'club_id', v_i.club_id, 'ja_era_membro', v_ja);
end $$;
revoke all on function public.convite_equipe_aceitar(uuid) from public, anon;
grant execute on function public.convite_equipe_aceitar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A lista da gestão: o que o clube tem pendente, para a tela de equipe.
--    (a policy de SELECT já existe desde a migration 61; isto é a leitura pronta para a tela,
--     com o estado derivado — "vencido" é uma situação, não um status guardado.)
-- ---------------------------------------------------------------------------
create or replace function public.convites_do_clube()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', i.id, 'email', i.email, 'papel', i.papel,
           'quando', i.created_at, 'expira_em', i.expires_at,
           'situacao', case
             when i.status <> 'pendente' then i.status
             when i.expires_at <= now() then 'vencido'
             else 'pendente' end
         ) order by i.created_at desc), '[]'::json)
    from public.club_team_invites i
   where i.club_id = public.clube_atual_id()
     and public.pode_gerir_no_clube(i.club_id);
$$;
revoke all on function public.convites_do_clube() from public, anon;
grant execute on function public.convites_do_clube() to authenticated;
