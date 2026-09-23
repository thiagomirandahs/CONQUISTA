-- =============================================================================
--  Fase 8.4 — o caminho que faltava: uma pessoa entrar num SEGUNDO clube.
--
--  O ACHADO CENTRAL DA VALIDAÇÃO MULTI-CLUBE, e ele é do tipo que só aparece tentando usar o
--  produto de ponta a ponta:
--
--  O DesbravaClube é vendido como multi-clube. O banco modela isso certo (uma identidade,
--  N vínculos), a RLS trata certo, o contexto por requisição trata certo, e 54 arquivos de teste
--  exercitam pessoas com vínculo em dois clubes. Mas todos eles criam esses vínculos com SQL
--  direto (`t.mk2` nos fixtures) — e a varredura do banco mostra por que isso nunca doeu:
--
--    · só três funções inserem em `organization_memberships`:
--        handle_new_user ............. o PRIMEIRO vínculo, no cadastro
--        onboarding_etapa ............ o vínculo do fundador no clube que ele criou
--        sincronizar_vinculo_perfil .. espelho interno
--    · `organization_memberships` não tem policy de INSERT nenhuma — só de SELECT;
--    · `vinculo_gerir` exige vínculo EXISTENTE no clube em uso: altera, nunca cria.
--
--  Resultado: **nenhuma pessoa já cadastrada conseguia entrar num segundo clube.** O fundador de
--  um clube novo não conseguia trazer um instrutor que já tivesse conta em outro lugar. A
--  premissa do produto não era exercitável por ninguém.
--
--  E o mais revelador: a etapa "equipe" do onboarding JÁ grava convites em `club_team_invites`,
--  e essa tabela JÁ tem as colunas `aceito_por` e `aceito_em`. A aceitação foi desenhada e nunca
--  implementada — o convite era gravado e morria ali. Esta migration não inventa um mecanismo:
--  ela liga a ponta solta de um que já existe.
--
--  AS DECISÕES, e por quê:
--
--    · o convite é NOMINAL (casado pelo e-mail de quem aceita). Um id vazado não vira acesso.
--    · quem aceita entra ATIVO, sem passar por aprovação: a liderança já avalizou ao convidar.
--      Exigir aprovação depois seria pedir a mesma decisão duas vezes.
--    · aceitar convite NÃO promove quem já é do clube. Promoção é ato da liderança, por
--      `vinculo_gerir`, com a pessoa ciente — nunca efeito colateral de clicar num link. Sem essa
--      regra, um convite mal endereçado vira escalada de privilégio.
--    · o vínculo nasce no clube DO CONVITE, não no clube em uso de quem aceita. É a única leitura
--      possível: a pessoa clica num link que chegou por e-mail, provavelmente com outra aba aberta.
--    · convite inexistente e convite alheio dão a MESMA resposta — é a regra de oráculo do projeto.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Convidar. Só a gestão do clube em uso, e só para papéis que existem.
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
  -- 'pais' fica de fora de propósito: responsável entra pelo convite COM TOKEN, que é outro
  -- fluxo e outra tabela (club_invites) — ele precisa do vínculo com a criança, não só do clube.
  if p_papel not in ('desbravador', 'conselheiro', 'instrutor', 'tesoureiro', 'diretoria') then
    raise exception 'Papel inválido.';
  end if;

  insert into public.club_team_invites (club_id, email, papel, criado_por, status)
  values (v_club, v_email, p_papel, auth.uid(), 'pendente')
  on conflict (club_id, email) do update
     set papel = excluded.papel, status = 'pendente', criado_por = excluded.criado_por,
         aceito_por = null, aceito_em = null
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.convite_equipe_criar(text, text) from public, anon;
grant execute on function public.convite_equipe_criar(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ver os meus convites. Casados pelo e-mail da própria conta.
-- ---------------------------------------------------------------------------
create or replace function public.convites_da_equipe()
returns json
language sql stable security definer set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'id', i.id, 'papel', i.papel, 'clube', o.nome,
           'sigla', o.metadata -> 'marca' ->> 'sigla', 'quando', i.created_at
         ) order by i.created_at desc), '[]'::json)
    from public.club_team_invites i
    join public.organizational_units o on o.id = i.club_id
   where i.status = 'pendente'
     and i.email = (select lower(u.email) from auth.users u where u.id = auth.uid());
$$;
revoke all on function public.convites_da_equipe() from public, anon;
grant execute on function public.convites_da_equipe() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Aceitar.
-- ---------------------------------------------------------------------------
create or replace function public.convite_equipe_aceitar(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_i public.club_team_invites; v_ja boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  -- Nominal: o convite tem de ser DESTE e-mail. Convite alheio e convite inexistente caem os dois
  -- aqui, com a mesma mensagem — quem tenta um id qualquer não descobre se ele existe.
  select * into v_i from public.club_team_invites
   where id = p_id and status = 'pendente'
     and email = (select lower(u.email) from auth.users u where u.id = v_uid)
   for update;
  if not found then raise exception 'Convite não encontrado ou já usado.'; end if;

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
-- 4. Revogar (a liderança muda de ideia antes de a pessoa aceitar).
-- ---------------------------------------------------------------------------
create or replace function public.convite_equipe_revogar(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_club uuid := public.clube_atual_id(); v_n int;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
    -- 'cancelado' e nao 'revogado': o vocabulario do CHECK da tabela e
  -- (pendente|aceito|cancelado), definido na fase 5. Inventar um quarto valor aqui exigiria
  -- alterar a constraint — e o nome que ja existe diz a mesma coisa.
  update public.club_team_invites set status = 'cancelado'
   where id = p_id and club_id = v_club and status = 'pendente';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0);
end $$;
revoke all on function public.convite_equipe_revogar(uuid) from public, anon;
grant execute on function public.convite_equipe_revogar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Leitura da tabela: só a gestão do próprio clube, para a tela de equipe.
-- `club_team_invites` guarda e-mail de pessoa — não é catálogo.
-- ---------------------------------------------------------------------------
grant select on public.club_team_invites to authenticated;
drop policy if exists "gestao le convites do proprio clube" on public.club_team_invites;
create policy "gestao le convites do proprio clube" on public.club_team_invites
  for select to authenticated using (public.pode_gerir_no_clube(club_id));
