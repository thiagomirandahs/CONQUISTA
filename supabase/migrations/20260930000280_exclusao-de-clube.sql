-- =============================================================================
--  EXCLUSÃO DE CLUBE EM DUAS FASES (só admin da plataforma), no mesmo espírito da lixeira de
--  membros (migration 221): arquivar -> recuperar -> expurgo com retenção.
--
--  FASE 1 — "Excluir clube" (admin_clube_excluir): confirmação digitando o NOME do clube + motivo.
--    Nada é apagado. O efeito é ARQUIVAR:
--      - organizational_units.status = 'excluido' (valor novo). A vitrine do site só lista
--        status = 'ativo' (203) e a inscrição pública pelo link também (104): somem sozinhas.
--      - o clube sai da árvore (parent_id = null, o anterior fica guardado): o painel da coordenação
--        (_clubes_descendentes) deixa de enxergá-lo.
--      - vínculos ativos/pendentes viram 'suspenso' e TODOS os vínculos do clube ganham a marca
--        metadata.clube_excluido = <id da exclusão>. Sem vínculo ativo, clube_atual_id() nunca
--        devolve o clube: some de todas as telas/RPCs do app, sem mexer em RLS de tabela nenhuma.
--      - assinatura: se cobre só este clube, vira 'cancelada' (só status + subscription_events;
--        nenhuma cobrança, fatura ou estorno) e a licença fica livre (a conta pode ter outra viva);
--        se cobre outros clubes também, só este clube sai dela (subscription_clubs).
--      - convites/códigos de entrada revogados (código de entrada, convite de responsável, convite
--        de equipe). Tudo guardado em clube_exclusoes.snapshot para o RECUPERAR.
--      - o /admin deixa de listar o clube (admin_clubes_listar filtra 'excluido'); a rotina da
--        lixeira de membros ignora o clube (senão os vínculos suspensos iriam para a lixeira).
--  RECUPERAR (admin_clube_recuperar): volta status, árvore, vínculos (cada um ao status que tinha),
--    convites/códigos e a assinatura. Assinatura: volta ao status que tinha, EXCETO quando isso
--    daria acesso sem pagamento — teste vencido (trial_ate no passado) ou período pago vencido
--    (periodo_fim no passado): aí volta 'pagamento_pendente' ("aguardando pagamento"). Se a conta
--    comercial já tiver OUTRA assinatura viva, a antiga continua cancelada e o clube volta sem
--    licença (o admin resolve em Assinaturas) — está no retorno e na auditoria.
--  FASE 2 — EXPURGO (rotina diária depois de `dias_retencao`, padrão 30; ou "Apagar definitivamente
--    agora" com a palavra APAGAR): apaga TODAS as linhas das tabelas ligadas ao clube (qualquer
--    coluna club_id e qualquer FK para organizational_units), em passadas até esvaziar, respeitando
--    as FKs; objetos de Storage do clube (prefixo "<club_id>/" em qualquer bucket, e os do razão
--    de armazenamento do clube cujo dono é conta exclusiva dele); as contas de login que só
--    existiam neste clube (sem vínculo em outro lugar, sem pacote na lixeira de outro clube e que
--    não são admin da plataforma); e por fim a própria linha do clube. Registros COMERCIAIS da
--    conta (subscriptions canceladas, faturas, eventos) ficam: são o contrato da plataforma.
--    Tudo numa transação: se algo travar, nada é apagado e o erro aparece.
--  FUNDADOR: o Tenant 001 (slug filhos-da-conquista / metadata.tenant='001' / metadata.legacy)
--    NÃO pode ser excluído nem expurgado por botão. Só depois que o admin ligar
--    clube_exclusao_config.permitir_excluir_fundador (RPC admin_clube_exclusao_config_definir,
--    com motivo, auditado). Padrão: desligado.
--  Auditoria: platform_admin_audit (clube_excluir, clube_recuperar, clube_expurgar, clube_exclusao_config).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) status novo 'excluido'
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.organizational_units'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.organizational_units drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.organizational_units add constraint organizational_units_status_check
  check (status in ('ativo', 'inativo', 'excluido'));

-- ---------------------------------------------------------------------------
-- 2) configuração e registro das exclusões
-- ---------------------------------------------------------------------------
create table if not exists public.clube_exclusao_config (
  id boolean primary key default true check (id),
  dias_retencao int not null default 30 check (dias_retencao between 1 and 3650),
  permitir_excluir_fundador boolean not null default false,
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now()
);
insert into public.clube_exclusao_config (id) values (true) on conflict do nothing;

create table if not exists public.clube_exclusoes (
  id uuid primary key default gen_random_uuid(),
  clube_uuid uuid not null,                       -- o clube (sem FK nem nome club_id: a linha do clube some no expurgo e o registro fica)
  nome text not null,
  slug text,
  status text not null default 'excluido' check (status in ('excluido', 'recuperado', 'expurgado')),
  motivo text not null,
  excluido_por uuid,
  excluido_em timestamptz not null default now(),
  recuperado_por uuid,
  recuperado_em timestamptz,
  expurgado_por uuid,                             -- null = rotina
  expurgado_em timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  resultado jsonb not null default '{}'::jsonb
);
create index if not exists idx_clube_exclusoes_club on public.clube_exclusoes (clube_uuid, status);
create unique index if not exists uq_clube_exclusao_aberta on public.clube_exclusoes (clube_uuid) where status = 'excluido';

do $$
declare tb text;
begin
  foreach tb in array array['clube_exclusao_config', 'clube_exclusoes'] loop
    execute format('alter table public.%I enable row level security', tb);
    execute format('revoke all on public.%I from public, anon, authenticated', tb);
  end loop;
end $$;

create or replace function public._clube_eh_fundador(p_club uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizational_units o
                  where o.id = p_club
                    and (o.slug = 'filhos-da-conquista'
                         or o.metadata ->> 'tenant' = '001'
                         or lower(coalesce(o.metadata ->> 'legacy', '')) in ('true', 't', '1')));
$$;
revoke all on function public._clube_eh_fundador(uuid) from public, anon, authenticated;

create or replace function public._clube_exclusao_retencao() returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select dias_retencao from public.clube_exclusao_config where id), 30);
$$;
revoke all on function public._clube_exclusao_retencao() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) FASE 1 — excluir (arquivar)
-- ---------------------------------------------------------------------------
create or replace function public.admin_clube_excluir(p_club_id uuid, p_nome_confirmacao text, p_motivo text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public._exigir_admin_plataforma();
  v_o public.organizational_units; v_id uuid := gen_random_uuid(); v_motivo text := btrim(coalesce(p_motivo, ''));
  v_vinc jsonb; v_subs jsonb := '[]'::jsonb; v_cod jsonb; v_inv jsonb; v_eq jsonb; s record; v_n int;
begin
  select * into v_o from public.organizational_units where id = p_club_id and type = 'clube' for update;
  if not found then raise exception 'Clube não encontrado.'; end if;
  if v_o.status = 'excluido' then raise exception 'Este clube já está na lixeira de clubes.'; end if;
  if public._clube_eh_fundador(p_club_id)
     and not coalesce((select permitir_excluir_fundador from public.clube_exclusao_config where id), false) then
    raise exception 'O clube fundador (Tenant 001) é protegido e não pode ser excluído por botão. Para isso, a liberação "permitir excluir o clube fundador" precisa ser ligada antes na configuração de exclusão de clubes.';
  end if;
  if lower(btrim(coalesce(p_nome_confirmacao, ''))) <> lower(btrim(v_o.nome)) then
    raise exception 'Confirmação não confere: digite exatamente o nome do clube (%).', v_o.nome;
  end if;
  if length(v_motivo) < 5 then raise exception 'Informe o motivo da exclusão (pelo menos 5 letras).'; end if;

  -- vínculos: guarda o status de quem estava ativo/pendente e suspende; marca TODOS
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status)), '[]'::jsonb) into v_vinc
    from public.organization_memberships m
   where m.organizational_unit_id = p_club_id and m.status in ('ativo', 'pendente');
  update public.organization_memberships
     set status = case when status in ('ativo', 'pendente') then 'suspenso' else status end,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('clube_excluido', v_id),
         updated_at = now()
   where organizational_unit_id = p_club_id;

  -- assinatura(s) vivas que cobrem o clube
  for s in select sub.*, (select count(*) from public.subscription_clubs x where x.subscription_id = sub.id) as clubes,
                  sc.incluido_em
             from public.subscription_clubs sc join public.subscriptions sub on sub.id = sc.subscription_id
            where sc.club_id = p_club_id and sub.status <> 'cancelada'
            for update of sub loop
    if s.clubes <= 1 then
      v_subs := v_subs || jsonb_build_object('id', s.id, 'modo', 'cancelada', 'status', s.status,
                                             'status_motivo', s.status_motivo, 'cancelada_em', s.cancelada_em,
                                             'cancelamento_motivo', s.cancelamento_motivo);
      update public.subscriptions
         set status = 'cancelada', cancelada_em = now(),
             cancelamento_motivo = 'Clube excluído pela administração da plataforma: ' || v_motivo,
             status_motivo = 'clube excluído (sem estorno e sem cobrança)', updated_at = now()
       where id = s.id;
      insert into public.subscription_events (subscription_id, de, para, motivo, origem, ator_id, detalhe)
      values (s.id, s.status, 'cancelada', 'clube excluído pela administração', 'admin', v_admin,
              jsonb_build_object('exclusao_id', v_id, 'club_id', p_club_id, 'sem_estorno', true, 'sem_cobranca', true));
    else
      v_subs := v_subs || jsonb_build_object('id', s.id, 'modo', 'desvinculada', 'status', s.status, 'incluido_em', s.incluido_em);
      delete from public.subscription_clubs where subscription_id = s.id and club_id = p_club_id;
      insert into public.subscription_events (subscription_id, de, para, motivo, origem, ator_id, detalhe)
      values (s.id, s.status, s.status, 'clube excluído saiu da licença', 'admin', v_admin,
              jsonb_build_object('exclusao_id', v_id, 'club_id', p_club_id));
    end if;
  end loop;

  -- convites e códigos de entrada
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_cod from public.club_entry_codes where club_id = p_club_id and revoked_at is null;
  update public.club_entry_codes set revoked_at = now(), revoked_by = v_admin where club_id = p_club_id and revoked_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'expires_at', expires_at)), '[]'::jsonb) into v_inv
    from public.club_invites where club_id = p_club_id and used_at is null and expires_at > now();
  update public.club_invites set expires_at = now() where club_id = p_club_id and used_at is null and expires_at > now();
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_eq from public.club_team_invites where club_id = p_club_id and status = 'pendente';
  update public.club_team_invites set status = 'cancelado' where club_id = p_club_id and status = 'pendente';

  update public.organizational_units set status = 'excluido', parent_id = null, updated_at = now() where id = p_club_id;

  insert into public.clube_exclusoes (id, clube_uuid, nome, slug, motivo, excluido_por, snapshot)
  values (v_id, p_club_id, v_o.nome, v_o.slug, v_motivo, v_admin,
          jsonb_build_object('status', v_o.status, 'parent_id', v_o.parent_id, 'vinculos', v_vinc,
                             'assinaturas', v_subs, 'codigos', v_cod, 'convites_responsavel', v_inv, 'convites_equipe', v_eq));

  v_n := jsonb_array_length(v_vinc);
  perform public._admin_auditar('clube_excluir', 'club', p_club_id,
    jsonb_build_object('exclusao_id', v_id, 'nome', v_o.nome, 'motivo', v_motivo, 'vinculos_suspensos', v_n,
                       'assinaturas', v_subs, 'codigos_revogados', jsonb_array_length(v_cod),
                       'convites_revogados', jsonb_array_length(v_inv) + jsonb_array_length(v_eq),
                       'fundador', public._clube_eh_fundador(p_club_id)));
  return json_build_object('ok', true, 'exclusao_id', v_id, 'vinculos_suspensos', v_n,
                           'assinaturas_canceladas', (select count(*) from jsonb_array_elements(v_subs) e where e ->> 'modo' = 'cancelada'),
                           'expurgo_previsto_em', now() + make_interval(days => public._clube_exclusao_retencao()));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) RECUPERAR
-- ---------------------------------------------------------------------------
create or replace function public.admin_clube_recuperar(p_exclusao_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public._exigir_admin_plataforma();
  v_e public.clube_exclusoes; v_sn jsonb; e jsonb; v_sub public.subscriptions; v_para text; v_n int := 0; v_k int;
  v_avisos jsonb := '[]'::jsonb; v_subs_res jsonb := '[]'::jsonb; v_parent uuid;
begin
  select * into v_e from public.clube_exclusoes where id = p_exclusao_id for update;
  if not found then raise exception 'Exclusão não encontrada.'; end if;
  if v_e.status <> 'excluido' then raise exception 'Este clube não está mais na lixeira (%).', v_e.status; end if;
  v_sn := v_e.snapshot;
  perform 1 from public.organizational_units where id = v_e.clube_uuid for update;
  if not found then raise exception 'O clube não existe mais.'; end if;

  -- 1º a licença (o limite de membros depende do plano do clube)
  for e in select * from jsonb_array_elements(coalesce(v_sn -> 'assinaturas', '[]'::jsonb)) loop
    select * into v_sub from public.subscriptions where id = (e ->> 'id')::uuid for update;
    if not found then
      v_avisos := v_avisos || to_jsonb('Assinatura anterior não existe mais: o clube volta sem licença.'::text);
      continue;
    end if;
    if e ->> 'modo' = 'cancelada' then
      if v_sub.status <> 'cancelada' then continue; end if;
      if exists (select 1 from public.subscriptions x where x.billing_account_id = v_sub.billing_account_id
                  and x.status <> 'cancelada' and x.id <> v_sub.id) then
        v_avisos := v_avisos || to_jsonb('A conta comercial já tem outra assinatura viva: a antiga continua cancelada e o clube volta sem licença.'::text);
        v_subs_res := v_subs_res || jsonb_build_object('id', v_sub.id, 'status', 'cancelada');
        continue;
      end if;
      v_para := e ->> 'status';
      -- não reabre acesso que já teria vencido: vira "aguardando pagamento"
      if (v_para = 'trial' and (v_sub.trial_ate is null or v_sub.trial_ate <= now()))
         or (v_para = 'ativa' and v_sub.periodo_fim is not null and v_sub.periodo_fim <= now()) then
        v_para := 'pagamento_pendente';
      end if;
      update public.subscriptions
         set status = v_para, cancelada_em = nullif(e ->> 'cancelada_em', '')::timestamptz,
             cancelamento_motivo = e ->> 'cancelamento_motivo',
             status_motivo = 'clube recuperado da lixeira pela administração', updated_at = now()
       where id = v_sub.id;
      insert into public.subscription_events (subscription_id, de, para, motivo, origem, ator_id, detalhe)
      values (v_sub.id, 'cancelada', v_para, 'clube recuperado da lixeira', 'admin', v_admin,
              jsonb_build_object('exclusao_id', v_e.id, 'status_anterior', e ->> 'status'));
      v_subs_res := v_subs_res || jsonb_build_object('id', v_sub.id, 'status', v_para, 'status_anterior', e ->> 'status');
    else
      if v_sub.status = 'cancelada' or exists (select 1 from public.subscription_clubs where club_id = v_e.clube_uuid) then
        v_avisos := v_avisos || to_jsonb('A licença compartilhada não pôde receber o clube de volta.'::text);
        continue;
      end if;
      begin
        insert into public.subscription_clubs (subscription_id, club_id, incluido_em)
        values (v_sub.id, v_e.clube_uuid, coalesce(nullif(e ->> 'incluido_em', '')::timestamptz, now()));
        insert into public.subscription_events (subscription_id, de, para, motivo, origem, ator_id, detalhe)
        values (v_sub.id, v_sub.status, v_sub.status, 'clube recuperado voltou à licença', 'admin', v_admin,
                jsonb_build_object('exclusao_id', v_e.id, 'club_id', v_e.clube_uuid));
        v_subs_res := v_subs_res || jsonb_build_object('id', v_sub.id, 'status', v_sub.status);
      exception when others then
        v_avisos := v_avisos || to_jsonb(('A licença compartilhada não aceitou o clube de volta: ' || sqlerrm)::text);
      end;
    end if;
  end loop;

  -- clube e árvore
  v_parent := nullif(v_sn ->> 'parent_id', '')::uuid;
  if v_parent is not null and not exists (select 1 from public.organizational_units where id = v_parent) then
    v_parent := null;
    v_avisos := v_avisos || to_jsonb('A unidade-mãe anterior não existe mais: o clube volta sem vínculo na hierarquia.'::text);
  end if;
  update public.organizational_units
     set status = coalesce(nullif(v_sn ->> 'status', ''), 'ativo'), parent_id = v_parent, updated_at = now()
   where id = v_e.clube_uuid;

  -- vínculos: cada um ao status que tinha (só os que esta exclusão suspendeu)
  for e in select * from jsonb_array_elements(coalesce(v_sn -> 'vinculos', '[]'::jsonb)) loop
    update public.organization_memberships set status = e ->> 'status', updated_at = now()
     where id = (e ->> 'id')::uuid and status = 'suspenso' and metadata ->> 'clube_excluido' = v_e.id::text;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end loop;
  update public.organization_memberships set metadata = metadata - 'clube_excluido'
   where organizational_unit_id = v_e.clube_uuid and metadata ->> 'clube_excluido' = v_e.id::text;

  -- convites e códigos
  update public.club_entry_codes c set revoked_at = null, revoked_by = null
   where c.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(v_sn -> 'codigos', '[]'::jsonb)) x)
     and (c.expires_at is null or c.expires_at > now())
     and not exists (select 1 from public.club_entry_codes o where o.club_id = c.club_id and o.revoked_at is null);
  update public.club_invites i set expires_at = (x ->> 'expires_at')::timestamptz
    from jsonb_array_elements(coalesce(v_sn -> 'convites_responsavel', '[]'::jsonb)) x
   where i.id = (x ->> 'id')::uuid and i.used_at is null;
  update public.club_team_invites t set status = 'pendente'
   where t.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(v_sn -> 'convites_equipe', '[]'::jsonb)) x)
     and t.status = 'cancelado';

  update public.clube_exclusoes
     set status = 'recuperado', recuperado_em = now(), recuperado_por = v_admin,
         resultado = jsonb_build_object('vinculos_restaurados', v_n, 'assinaturas', v_subs_res, 'avisos', v_avisos,
                                        'motivo', nullif(btrim(coalesce(p_motivo, '')), ''))
   where id = v_e.id;
  perform public._admin_auditar('clube_recuperar', 'club', v_e.clube_uuid,
    jsonb_build_object('exclusao_id', v_e.id, 'nome', v_e.nome, 'motivo', nullif(btrim(coalesce(p_motivo, '')), ''),
                       'vinculos_restaurados', v_n, 'assinaturas', v_subs_res, 'avisos', v_avisos));
  return json_build_object('ok', true, 'vinculos_restaurados', v_n, 'assinaturas', v_subs_res, 'avisos', v_avisos);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) FASE 2 — expurgo definitivo
-- ---------------------------------------------------------------------------
-- A tabela pode perder estas linhas sem deixar filho órfão? (usado só quando o DELETE normal é
-- recusado por gatilho de imutabilidade e vai ser refeito sem gatilhos)
create or replace function public._clube_sem_referencias(p_tabela text, p_coluna text, p_club uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare f record; v_existe boolean;
begin
  for f in
    select k.conrelid::regclass::text as filho, (k.conrelid = k.confrelid) as proprio,
           ca.attname as col_filho, pa.attname as col_pai
      from pg_constraint k
      join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = k.conkey[1]
      join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
     where k.contype = 'f' and k.confrelid = ('public.' || quote_ident(p_tabela))::regclass
  loop
    execute format('select exists (select 1 from %s c join public.%I p on c.%I = p.%I where p.%I = $1 %s)',
                   case when f.filho like '%.%' then f.filho else 'public.' || f.filho end,
                   p_tabela, f.col_filho, f.col_pai, p_coluna,
                   case when f.proprio then format('and c.%I is distinct from $1', p_coluna) else '' end)
      into v_existe using p_club;
    if v_existe then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public._clube_sem_referencias(text, text, uuid) from public, anon, authenticated;

-- apaga toda linha ligada ao clube, em passadas, até não sobrar nada. Retorna {tabela: linhas}.
create or replace function public._clube_apagar_linhas(p_club uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  alvo record; v_cont jsonb := '{}'::jsonb; v_prog bigint; n bigint; v_resta boolean; v_passada int := 0;
  v_travadas text[]; v_erro text; v_alvos jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('tabela', x.tabela, 'coluna', x.coluna) order by x.tabela, x.coluna), '[]'::jsonb)
    into v_alvos
    from (
  select c.relname as tabela, a.attname as coluna
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
   where k.contype = 'f' and k.confrelid = 'public.organizational_units'::regclass
     and array_length(k.conkey, 1) = 1 and c.relname <> 'organizational_units' and c.relkind in ('r', 'p')
  union
  select c.relname, a.attname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'club_id' and not a.attisdropped
   where c.relkind in ('r', 'p') and a.atttypid = 'uuid'::regtype) x
  ;

  loop
    v_passada := v_passada + 1;
    v_prog := 0; v_travadas := '{}'; v_erro := null;
    for alvo in select * from jsonb_to_recordset(v_alvos) as r(tabela text, coluna text) loop
      execute format('select exists (select 1 from public.%I where %I = $1)', alvo.tabela, alvo.coluna) into v_resta using p_club;
      continue when not v_resta;
      begin
        execute format('delete from public.%I where %I = $1', alvo.tabela, alvo.coluna) using p_club;
        get diagnostics n = row_count;
      exception when foreign_key_violation then
        n := -1; v_erro := sqlerrm;
      when others then
        n := -1; v_erro := sqlerrm;
        -- recusa de gatilho (registro imutável): refaz sem gatilhos se não deixar filho órfão
        if public._clube_sem_referencias(alvo.tabela, alvo.coluna, p_club) then
          begin
            set local session_replication_role = replica;
            execute format('delete from public.%I where %I = $1', alvo.tabela, alvo.coluna) using p_club;
            get diagnostics n = row_count;
            set local session_replication_role = origin;
          exception when others then
            n := -1; v_erro := sqlerrm;
          end;
        end if;
      end;
      if n < 0 then
        v_travadas := v_travadas || alvo.tabela;
      else
        v_prog := v_prog + n;
        v_cont := jsonb_set(v_cont, array[alvo.tabela], to_jsonb(coalesce((v_cont ->> alvo.tabela)::bigint, 0) + n));
      end if;
    end loop;
    exit when cardinality(v_travadas) = 0 and v_prog = 0;
    if v_prog = 0 or v_passada > 60 then
      raise exception 'Expurgo do clube travou (nada foi apagado): % — %', array_to_string(v_travadas, ', '), v_erro;
    end if;
  end loop;
  return v_cont;
end;
$$;
revoke all on function public._clube_apagar_linhas(uuid) from public, anon, authenticated;

create or replace function public._clube_expurgar(p_exclusao_id uuid, p_por uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_e public.clube_exclusoes; v_club uuid; v_users uuid[]; v_exclusivos uuid[]; v_u uuid;
  v_arquivos int := 0; v_contas int := 0; v_contas_mantidas int := 0; v_linhas jsonb; v_res jsonb;
begin
  select * into v_e from public.clube_exclusoes where id = p_exclusao_id for update;
  if not found then raise exception 'Exclusão não encontrada.'; end if;
  if v_e.status <> 'excluido' then raise exception 'Este clube não está na lixeira (%).', v_e.status; end if;
  v_club := v_e.clube_uuid;
  if not exists (select 1 from public.organizational_units where id = v_club and type = 'clube' and status = 'excluido') then
    raise exception 'O clube não está excluído: nada foi apagado.';
  end if;
  if public._clube_eh_fundador(v_club)
     and not coalesce((select permitir_excluir_fundador from public.clube_exclusao_config where id), false) then
    raise exception 'O clube fundador (Tenant 001) é protegido: o expurgo exige a liberação explícita na configuração.';
  end if;

  -- contas que SÓ existem neste clube (decidido antes de apagar os vínculos)
  select coalesce(array_agg(distinct u), '{}') into v_users from (
    select user_id as u from public.organization_memberships where organizational_unit_id = v_club
    union select user_id from public.lixeira_pacotes where club_id = v_club and status = 'na_lixeira') x;
  select coalesce(array_agg(u), '{}') into v_exclusivos from unnest(v_users) u
   where not exists (select 1 from public.organization_memberships m where m.user_id = u and m.organizational_unit_id <> v_club)
     and not exists (select 1 from public.lixeira_pacotes p where p.user_id = u and p.club_id <> v_club and p.status = 'na_lixeira')
     and not public.eh_admin_plataforma(u);

  -- Storage: prefixo do clube em qualquer bucket + objetos do razão do clube cujo dono é conta exclusiva
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o
   where split_part(o.name, '/', 1) = v_club::text
      or (exists (select 1 from public.club_storage_objetos c where c.bucket_id = o.bucket_id and c.name = o.name and c.club_id = v_club)
          and coalesce(o.owner_id, o.owner::text) = any (select x::text from unnest(v_exclusivos) x));
  get diagnostics v_arquivos = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);

  -- profiles é identidade GLOBAL; unidade_id ali é só o espelho do vínculo primário. Quem apontava
  -- para uma unidade deste clube fica sem unidade (o espelho se recalcula no próximo vínculo).
  update public.profiles set unidade_id = null
   where unidade_id in (select id from public.unidades where club_id = v_club);

  v_linhas := public._clube_apagar_linhas(v_club);
  delete from public.organizational_units where id = v_club;

  foreach v_u in array v_exclusivos loop
    begin
      delete from auth.users where id = v_u;
      if found then v_contas := v_contas + 1; end if;
    exception when others then
      v_contas_mantidas := v_contas_mantidas + 1;   -- algo de fora ainda aponta para a conta: ela fica
    end;
  end loop;

  v_res := jsonb_build_object('linhas', v_linhas, 'arquivos_apagados', v_arquivos, 'contas_removidas', v_contas,
                              'contas_mantidas', v_contas_mantidas, 'pessoas_do_clube', cardinality(v_users));
  update public.clube_exclusoes
     set status = 'expurgado', expurgado_em = now(), expurgado_por = p_por, snapshot = '{}'::jsonb,
         resultado = v_res
   where id = p_exclusao_id;
  insert into public.platform_admin_audit (admin_user_id, acao, alvo_tipo, alvo_id, detalhe)
  values (p_por, 'clube_expurgar', 'club', v_club,
          jsonb_build_object('exclusao_id', p_exclusao_id, 'nome', v_e.nome, 'excluido_em', v_e.excluido_em,
                             'origem', case when p_por is null then 'rotina' else 'admin' end) || v_res);
  return v_res;
end;
$$;
revoke all on function public._clube_expurgar(uuid, uuid) from public, anon, authenticated;

create or replace function public.admin_clube_expurgar_agora(p_exclusao_id uuid, p_confirmacao text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma();
begin
  if coalesce(btrim(p_confirmacao), '') <> 'APAGAR' then
    raise exception 'Para apagar definitivamente, digite APAGAR (em maiúsculas).';
  end if;
  return (jsonb_build_object('ok', true) || public._clube_expurgar(p_exclusao_id, v_admin))::json;
end;
$$;

-- rotina diária: expurga o que passou da retenção (um clube com erro não trava os outros)
create or replace function public.clube_exclusao_rotina() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id, clube_uuid from public.clube_exclusoes
            where status = 'excluido' and excluido_em <= now() - make_interval(days => public._clube_exclusao_retencao())
            order by excluido_em loop
    begin
      perform public._clube_expurgar(r.id, null);
      n := n + 1;
    exception when others then
      insert into public.platform_admin_audit (admin_user_id, acao, alvo_tipo, alvo_id, detalhe)
      values (null, 'clube_expurgar_erro', 'club', r.clube_uuid, jsonb_build_object('exclusao_id', r.id, 'erro', sqlerrm));
    end;
  end loop;
  return n;
end;
$$;
revoke all on function public.clube_exclusao_rotina() from public, anon, authenticated;
grant execute on function public.clube_exclusao_rotina() to service_role;

select cron.schedule('expurgar-clubes-excluidos', '50 4 * * *', 'select public.clube_exclusao_rotina()')
 where not exists (select 1 from cron.job where jobname = 'expurgar-clubes-excluidos');

-- ---------------------------------------------------------------------------
-- 6) listagem e configuração (admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_clube_exclusao_config() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return (select json_build_object('dias_retencao', c.dias_retencao, 'permitir_excluir_fundador', c.permitir_excluir_fundador,
                                   'atualizado_em', c.atualizado_em)
            from public.clube_exclusao_config c where c.id);
end;
$$;

-- null = mantém. Ligar a liberação do fundador exige motivo.
create or replace function public.admin_clube_exclusao_config_definir(p_dias_retencao int default null,
                                                                      p_permitir_excluir_fundador boolean default null,
                                                                      p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_antes public.clube_exclusao_config;
begin
  select * into v_antes from public.clube_exclusao_config where id for update;
  if p_dias_retencao is not null and (p_dias_retencao < 1 or p_dias_retencao > 3650) then
    raise exception 'Dias na lixeira antes do expurgo: use de 1 a 3650.';
  end if;
  if p_permitir_excluir_fundador and length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo para liberar a exclusão do clube fundador.';
  end if;
  update public.clube_exclusao_config
     set dias_retencao = coalesce(p_dias_retencao, dias_retencao),
         permitir_excluir_fundador = coalesce(p_permitir_excluir_fundador, permitir_excluir_fundador),
         atualizado_por = v_admin, atualizado_em = now()
   where id;
  perform public._admin_auditar('clube_exclusao_config', 'plataforma', null,
    jsonb_build_object('antes', to_jsonb(v_antes) - 'id' - 'atualizado_por',
                       'depois', (select to_jsonb(c) - 'id' - 'atualizado_por' from public.clube_exclusao_config c where c.id),
                       'motivo', nullif(btrim(coalesce(p_motivo, '')), '')));
  return public.admin_clube_exclusao_config();
end;
$$;

create or replace function public.admin_clubes_excluidos_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_ret int := public._clube_exclusao_retencao();
begin
  perform public._exigir_admin_plataforma();
  return json_build_object(
    'dias_retencao', v_ret,
    'permitir_excluir_fundador', (select permitir_excluir_fundador from public.clube_exclusao_config where id),
    'clubes', coalesce((select json_agg(json_build_object(
        'id', e.id, 'club_id', e.clube_uuid, 'nome', e.nome, 'slug', e.slug, 'status', e.status, 'motivo', e.motivo,
        'excluido_em', e.excluido_em,
        'excluido_por', coalesce(nullif(btrim(pr.nome), ''), au.email, 'administração'),
        'expurgo_previsto_em', case when e.status = 'excluido' then e.excluido_em + make_interval(days => v_ret) end,
        'recuperado_em', e.recuperado_em, 'expurgado_em', e.expurgado_em,
        'vinculos', jsonb_array_length(coalesce(e.snapshot -> 'vinculos', '[]'::jsonb)),
        'fundador', e.slug = 'filhos-da-conquista',
        'resultado', e.resultado)
        order by (e.status = 'excluido') desc, e.excluido_em desc)
      from (select * from public.clube_exclusoes order by excluido_em desc limit 300) e
      left join public.profiles pr on pr.id = e.excluido_por
      left join auth.users au on au.id = e.excluido_por), '[]'::json));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_clube_excluir(uuid, text, text)', 'admin_clube_recuperar(uuid, text)',
                           'admin_clube_expurgar_agora(uuid, text)', 'admin_clube_exclusao_config()',
                           'admin_clube_exclusao_config_definir(int, boolean, text)', 'admin_clubes_excluidos_listar()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7) o clube excluído some das listas do /admin e das rotinas
-- ---------------------------------------------------------------------------
-- admin_clubes_listar (240) + filtro do status 'excluido'. admin_clube_detalhe reaproveita esta
-- função: o detalhe de um clube excluído responde "não encontrado" (ele vive na lixeira de clubes).
create or replace function public.admin_clubes_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select json_agg(c order by c.criado_em desc) from (
    select o.id as club_id, o.nome, o.slug, o.status, o.created_at as criado_em,
           a.assinatura_id, a.assinatura_status, a.ciclo, a.trial_ate, a.periodo_fim, a.provider,
           a.plano_chave, a.plano_versao, a.plano_nome,
           coalesce(u.bytes, 0) as armazenamento_bytes, coalesce(u.objetos, 0) as armazenamento_objetos,
           lim.mb as armazenamento_limite_mb,
           case when lim.mb > 0 then round(coalesce(u.bytes, 0) * 100.0 / (lim.mb * 1048576), 1) end as armazenamento_pct,
           public._admin_situacao_armazenamento(coalesce(u.bytes, 0), lim.mb) as armazenamento_situacao,
           public.limite_uso(o.id, 'membros') as membros,
           ob.status as onboarding_status, ob.etapa as onboarding_etapa,
           coalesce(ps.status, 'nao_verificado') as provisionamento,
           nullif(o.metadata #>> '{marca,logo_url}', '') as logo_url,
           nullif(o.metadata #>> '{marca,sigla}', '') as sigla,
           nullif(o.metadata #>> '{marca,cor_primaria}', '') as cor_primaria,
           public.plano_limite(o.id, 'membros') as membros_limite,
           pai.nome as vinculado_a_nome, pai.type as vinculado_a_tipo,
           public._clube_eh_fundador(o.id) as fundador
      from public.organizational_units o
      left join public.organizational_units pai on pai.id = o.parent_id
      left join lateral (
        select s.id as assinatura_id, s.status as assinatura_status, s.ciclo, s.trial_ate, s.periodo_fim, s.provider,
               p.chave as plano_chave, p.versao as plano_versao, p.nome as plano_nome
          from public.subscription_clubs sc
          join public.subscriptions s on s.id = sc.subscription_id
          join public.billing_plans p on p.id = s.plan_id
         where sc.club_id = o.id
         order by (s.status = 'cancelada'), s.created_at desc limit 1) a on true
      left join public.club_storage_uso u on u.club_id = o.id
      left join lateral (select public.plano_limite(o.id, 'armazenamento_mb') as mb) lim on true
      left join lateral (select os.status, os.etapa from public.onboarding_sessions os
                          where os.club_id = o.id order by os.created_at desc limit 1) ob on true
      left join public.club_provisioning_status ps on ps.club_id = o.id
     where o.type = 'clube' and o.status <> 'excluido') c), '[]'::json);
end;
$$;
revoke all on function public.admin_clubes_listar() from public, anon;
grant execute on function public.admin_clubes_listar() to authenticated;

-- lixeira de membros (221): clube excluído não roda (os vínculos suspensos pela exclusão não são
-- "membros inativos" — o destino deles é o do clube)
create or replace function public.lixeira_rotina() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.organizational_units where type = 'clube' and status <> 'excluido' order by created_at loop
    begin
      perform public._lixeira_rodar_clube(r.id);
      n := n + 1;
    exception when others then
      insert into public.lixeira_execucoes (club_id, modo, erros)
      values (r.id, 'erro', jsonb_build_array(jsonb_build_object('erro', sqlerrm)));
    end;
  end loop;
  return n;
end;
$$;
revoke all on function public.lixeira_rotina() from public, anon, authenticated;
grant execute on function public.lixeira_rotina() to service_role;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-exclusao-de-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
