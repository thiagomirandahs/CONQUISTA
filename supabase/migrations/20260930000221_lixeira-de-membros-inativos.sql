-- =============================================================================
--  LIXEIRA DE MEMBROS INATIVOS / QUE SAÍRAM DO CLUBE (exclusão em duas fases, recuperável).
--
--  REGRA DO QUE É "INATIVO" (por clube, por pessoa):
--    - a pessoa NÃO tem nenhum vínculo ativo/pendente vigente naquele clube, e
--    - o vínculo mais recente dela ali está SUSPENSO ou ENCERRADO (desde organization_memberships.
--      inativo_desde, coluna nova mantida por gatilho) ou ATIVO porém VENCIDO (ends_at no passado,
--      desde ends_at);
--    - e isso há pelo menos `dias_inatividade` dias (padrão 60).
--    - Regra OPCIONAL, DESLIGADA por padrão (sem_login_dias = null): vínculo ativo de quem não entra
--      no app há X dias (auth.users.last_sign_in_at). Diretoria nunca entra por essa regra.
--    - Cadastro PENDENTE nunca aprovado não entra (é pedido, não saída).
--
--  FASE 1 — LIXEIRA (rotina diária, só no modo 'ativo'): TODOS os dados da pessoa NAQUELE clube
--    (vínculos, pontos, recordes, partidas, progresso de classe/especialidade com comprovações e
--    avaliações, experiências, entregas, missões, devocionais, leituras, bichinho, ajudas, chat,
--    notificações, mensalidades, vínculos de responsável/consentimentos) SAEM das tabelas e vão
--    para public.lixeira_linhas (jsonb, sem acesso de ninguém a não ser pelas RPCs do admin).
--    Resultado: somem de todas as telas e RPCs sem precisar mexer em RLS de cada tabela, e a vaga
--    do limite de membros fica livre. Fotos de comprovação no Storage são MARCADAS no pacote
--    (bucket + caminho), não apagadas. Conteúdo do CLUBE criado pela pessoa (atividades, eventos,
--    fotos do mural, avisos que ela enviou, avaliações que ela fez de OUTROS) fica: é do clube.
--  FASE 2 — EXPURGO: só depois de `dias_retencao` (padrão 90) na lixeira e só com o clube em modo
--    'ativo'. Apaga as linhas guardadas e os objetos marcados do Storage. A conta de login global
--    só é apagada se a pessoa não tiver vínculo em NENHUM outro clube/escopo, nem outro pacote na
--    lixeira, e não for admin da plataforma. Dados de outros clubes nunca são tocados.
--  RECUPERAR (admin da plataforma): devolve as linhas e o vínculo como INATIVO (suspenso), com o
--    relógio de inatividade reiniciado e `dias_inatividade` de carência antes de poder voltar à lixeira.
--
--  MODOS (global em lixeira_config + ajuste por clube em lixeira_config_clube):
--    'desligado' — nada roda; 'dry_run' — só MARCA/LISTA quem iria (lixeira_marcacoes) e não altera
--    nada; 'ativo' — move para a lixeira e expurga o que venceu. PADRÃO GLOBAL = 'dry_run'.
--    Tenant 001 (slug filhos-da-conquista) nasce com ajuste próprio 'dry_run': mesmo se o global
--    for para 'ativo', o clube fundador só muda quando o admin ligar ELE explicitamente, depois de
--    ver a lista. (O ajuste do Tenant 001 não pode ser removido, só trocado.)
--
--  Auditoria: platform_admin_audit (admin_user_id nulo = rotina) + lixeira_execucoes por rodada.
--  Esta migration não move nada: só cria estrutura, preenche inativo_desde de quem já está
--  suspenso/encerrado e agenda a rotina (que começa em dry_run).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) "inativo desde" no vínculo
-- ---------------------------------------------------------------------------
alter table public.organization_memberships add column if not exists inativo_desde timestamptz;

create or replace function public._vinculo_marcar_inativo_desde() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('suspenso', 'encerrado') then
    if tg_op = 'INSERT' then
      new.inativo_desde := coalesce(new.inativo_desde, now());
    elsif old.status not in ('suspenso', 'encerrado') or new.inativo_desde is null then
      new.inativo_desde := coalesce(case when old.status in ('suspenso', 'encerrado') then old.inativo_desde end, now());
    end if;
  else
    new.inativo_desde := null;
  end if;
  return new;
end;
$$;
revoke all on function public._vinculo_marcar_inativo_desde() from public, anon, authenticated;
drop trigger if exists trg_vinculo_inativo_desde on public.organization_memberships;
create trigger trg_vinculo_inativo_desde before insert or update of status on public.organization_memberships
for each row execute function public._vinculo_marcar_inativo_desde();

-- carga: quem já está suspenso/encerrado passa a ter a data (melhor estimativa: última alteração).
-- O gatilho de limite retorna cedo para status não-ativo; os de auditoria/sincronia não olham esta coluna.
update public.organization_memberships
   set inativo_desde = coalesce(least(updated_at, ends_at), updated_at, created_at)
 where status in ('suspenso', 'encerrado') and inativo_desde is null;

-- ---------------------------------------------------------------------------
-- 2) configuração
-- ---------------------------------------------------------------------------
create table if not exists public.lixeira_config (
  id boolean primary key default true check (id),
  modo text not null default 'dry_run' check (modo in ('desligado', 'dry_run', 'ativo')),
  dias_inatividade int not null default 60 check (dias_inatividade between 30 and 3650),
  dias_retencao int not null default 90 check (dias_retencao between 7 and 3650),
  sem_login_dias int check (sem_login_dias between 60 and 3650),     -- null = regra desligada
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now()
);
insert into public.lixeira_config (id) values (true) on conflict do nothing;

create table if not exists public.lixeira_config_clube (
  club_id uuid primary key references public.organizational_units(id) on delete cascade,
  modo text not null check (modo in ('desligado', 'dry_run', 'ativo')),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now()
);
insert into public.lixeira_config_clube (club_id, modo)
select id, 'dry_run' from public.organizational_units where slug = 'filhos-da-conquista'
on conflict (club_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) lixeira
-- ---------------------------------------------------------------------------
create table if not exists public.lixeira_pacotes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  user_id uuid not null,                         -- sem FK: a conta pode ter sido apagada no expurgo
  nome_exibicao text,                            -- "Maria S." — some no expurgo
  papeis text[] not null default '{}',
  motivo text not null check (motivo in ('vinculo_suspenso', 'vinculo_encerrado', 'vinculo_vencido', 'sem_login')),
  inativo_desde timestamptz not null,
  status text not null default 'na_lixeira' check (status in ('na_lixeira', 'recuperado', 'expurgado')),
  arquivado_em timestamptz not null default now(),
  arquivado_por uuid,                            -- null = rotina diária
  recuperado_em timestamptz,
  recuperado_por uuid,
  expurgado_em timestamptz,
  conta_removida boolean not null default false,
  contagens jsonb not null default '{}'::jsonb,  -- { tabela: linhas }
  storage jsonb not null default '[]'::jsonb     -- [{bucket, name}] marcados (apagados no expurgo)
);
create index if not exists idx_lixeira_pacotes_club on public.lixeira_pacotes (club_id, status, arquivado_em);
create index if not exists idx_lixeira_pacotes_user on public.lixeira_pacotes (user_id, status);

create table if not exists public.lixeira_linhas (
  id bigint generated always as identity primary key,
  pacote_id uuid not null references public.lixeira_pacotes(id) on delete cascade,
  ordem int not null,
  tabela text not null,
  dados jsonb not null
);
create index if not exists idx_lixeira_linhas_pacote on public.lixeira_linhas (pacote_id, ordem);

-- dry-run: quem IRIA para a lixeira (nada foi mexido)
create table if not exists public.lixeira_marcacoes (
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nome_exibicao text,
  papeis text[] not null default '{}',
  motivo text not null,
  inativo_desde timestamptz not null,
  primeira_vez_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  primary key (club_id, user_id)
);

-- carência depois de uma recuperação
create table if not exists public.lixeira_poupados (
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  user_id uuid not null,
  ate timestamptz not null,
  primary key (club_id, user_id)
);

create table if not exists public.lixeira_execucoes (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  club_id uuid references public.organizational_units(id) on delete cascade,
  modo text not null,
  candidatos int not null default 0,
  arquivados int not null default 0,
  expurgados int not null default 0,
  erros jsonb not null default '[]'::jsonb
);
create index if not exists idx_lixeira_execucoes_club on public.lixeira_execucoes (club_id, quando desc);

do $$
declare tb text;
begin
  foreach tb in array array['lixeira_config', 'lixeira_config_clube', 'lixeira_pacotes', 'lixeira_linhas',
                            'lixeira_marcacoes', 'lixeira_poupados', 'lixeira_execucoes'] loop
    execute format('alter table public.%I enable row level security', tb);
    execute format('revoke all on public.%I from public, anon, authenticated', tb);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) catálogo: o que é "dado da pessoa naquele clube". Ordem = filhos antes dos pais (arquivar
--    em ordem crescente; restaurar em ordem decrescente). $1 = clube, $2 = pessoa.
-- ---------------------------------------------------------------------------
create or replace function public._lixeira_catalogo()
returns table (ordem int, tabela text, filtro text, imutavel boolean)
language sql immutable set search_path = '' as $$
  values
    (10,  'requirement_approvals', 'club_id = $1 and (member_requirement_id in (select id from public.member_requirements where club_id = $1 and usuario_id = $2) or member_specialty_requirement_id in (select id from public.member_specialty_requirements where club_id = $1 and usuario_id = $2) or submission_id in (select id from public.requirement_submissions where club_id = $1 and usuario_id = $2))', false),
    (20,  'requirement_submissions', 'club_id = $1 and usuario_id = $2', true),
    (30,  'member_requirement_options', 'club_id = $1 and usuario_id = $2', false),
    (40,  'member_requirements', 'club_id = $1 and usuario_id = $2', false),
    (50,  'member_specialty_requirements', 'club_id = $1 and usuario_id = $2', false),
    (60,  'member_specialties', 'club_id = $1 and usuario_id = $2', false),
    (70,  'class_completion_events', 'club_id = $1 and usuario_id = $2', true),
    (80,  'class_investitures', 'club_id = $1 and usuario_id = $2', true),
    (90,  'investiture_reviews', 'club_id = $1 and usuario_id = $2', false),
    (100, 'member_classes', 'club_id = $1 and usuario_id = $2', false),
    (110, 'experience_rewards', 'club_id = $1 and participation_id in (select id from public.experience_participations where club_id = $1 and usuario_id = $2)', false),
    (120, 'experience_submissions', 'club_id = $1 and usuario_id = $2', false),
    (130, 'experience_participations', 'club_id = $1 and usuario_id = $2', false),
    (140, 'experience_audiences', 'club_id = $1 and usuario_id = $2', false),
    (150, 'member_badges', 'club_id = $1 and usuario_id = $2', false),
    (160, 'pontos', 'club_id = $1 and usuario_id = $2', false),
    (170, 'entregas', 'club_id = $1 and usuario_id = $2', false),
    (180, 'recordes', 'club_id = $1 and usuario_id = $2', false),
    (190, 'partidas', 'club_id = $1 and usuario_id = $2', false),
    (200, 'trilha_jogos', 'club_id = $1 and usuario_id = $2', false),
    (210, 'chefao_golpes', 'club_id = $1 and usuario_id = $2', false),
    (220, 'missoes_feitas', 'club_id = $1 and usuario_id = $2', false),
    (230, 'devocional', 'club_id = $1 and usuario_id = $2', false),
    (240, 'biblia_leituras', 'club_id = $1 and usuario_id = $2', false),
    (250, 'biblia_leitura_atual', 'club_id = $1 and usuario_id = $2', false),
    (260, 'bichinhos', 'club_id = $1 and usuario_id = $2', false),
    (270, 'ajudas', 'club_id = $1 and (de_id = $2 or para_id = $2)', false),
    (280, 'chat_mensagens_apagadas', 'club_id = $1 and mensagem_id in (select id from public.chat_mensagens where club_id = $1 and autor_id = $2)', false),
    (290, 'chat_mensagens', 'club_id = $1 and autor_id = $2', false),
    (300, 'chat_participantes', 'club_id = $1 and usuario_id = $2', false),
    (310, 'notificacoes', 'club_id = $1 and para_usuario = $2', false),
    (320, 'mensalidades', 'club_id = $1 and desbravador_id = $2', false),
    (330, 'responsavel_consentimentos', 'club_id = $1 and (desbravador_id = $2 or responsavel_id = $2)', true),
    (340, 'responsaveis', 'club_id = $1 and (desbravador_id = $2 or responsavel_id = $2)', false),
    (1000, 'organization_memberships', 'organizational_unit_id = $1 and user_id = $2', false)
$$;
revoke all on function public._lixeira_catalogo() from public, anon, authenticated;

create or replace function public._lixeira_nome(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when array_length(w, 1) > 1 then w[1] || ' ' || left(w[array_length(w, 1)], 1) || '.' else w[1] end
    from (select regexp_split_to_array(btrim(coalesce(p.nome, '')), '\s+') as w from public.profiles p where p.id = p_user) x;
$$;
revoke all on function public._lixeira_nome(uuid) from public, anon, authenticated;

create or replace function public._lixeira_modo(p_club uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select modo from public.lixeira_config_clube where club_id = p_club),
                  (select modo from public.lixeira_config where id), 'dry_run');
$$;
revoke all on function public._lixeira_modo(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) quem está elegível (não altera nada)
-- ---------------------------------------------------------------------------
create or replace function public._lixeira_candidatos(p_club uuid)
returns table (user_id uuid, inativo_desde timestamptz, motivo text, papeis text[])
language sql stable security definer set search_path = '' as $$
  with cfg as (select * from public.lixeira_config where id),
  por_pessoa as (
    select m.user_id,
           bool_or(m.status in ('ativo', 'pendente') and (m.ends_at is null or m.ends_at > now())) as tem_vigente,
           max(case when m.status in ('suspenso', 'encerrado') then coalesce(m.inativo_desde, m.updated_at)
                    when m.status = 'ativo' and m.ends_at <= now() then m.ends_at end) as desde,
           (array_agg(case when m.status in ('suspenso', 'encerrado') then 'vinculo_' || m.status
                           when m.status = 'ativo' and m.ends_at <= now() then 'vinculo_vencido' end
                      order by coalesce(m.inativo_desde, m.ends_at, m.updated_at) desc nulls last))[1] as motivo,
           bool_or(m.role = 'diretoria' and m.status = 'ativo') as diretoria_ativa,
           array_agg(distinct m.role) as papeis
      from public.organization_memberships m
     where m.organizational_unit_id = p_club
     group by m.user_id)
  select p.user_id, p.desde, p.motivo, p.papeis
    from por_pessoa p, cfg
   where not p.tem_vigente and p.desde is not null
     and p.desde <= now() - make_interval(days => cfg.dias_inatividade)
     and not exists (select 1 from public.lixeira_poupados x where x.club_id = p_club and x.user_id = p.user_id and x.ate > now())
  union all
  select p.user_id, coalesce(u.last_sign_in_at, u.created_at), 'sem_login', p.papeis
    from por_pessoa p join auth.users u on u.id = p.user_id, cfg
   where cfg.sem_login_dias is not null and p.tem_vigente and not p.diretoria_ativa
     and coalesce(u.last_sign_in_at, u.created_at) <= now() - make_interval(days => cfg.sem_login_dias)
     and not exists (select 1 from public.lixeira_poupados x where x.club_id = p_club and x.user_id = p.user_id and x.ate > now());
$$;
revoke all on function public._lixeira_candidatos(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) fase 1: mover para a lixeira
-- ---------------------------------------------------------------------------
create or replace function public._lixeira_arquivar(p_club uuid, p_user uuid, p_motivo text, p_inativo_desde timestamptz,
                                                    p_por uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_pacote uuid; r record; n bigint; v_cont jsonb := '{}'::jsonb; v_storage jsonb; v_papeis text[];
begin
  select coalesce(array_agg(distinct role), '{}') into v_papeis from public.organization_memberships
   where organizational_unit_id = p_club and user_id = p_user;
  insert into public.lixeira_pacotes (club_id, user_id, nome_exibicao, papeis, motivo, inativo_desde, arquivado_por)
  values (p_club, p_user, public._lixeira_nome(p_user), v_papeis, p_motivo, p_inativo_desde, p_por)
  returning id into v_pacote;

  for r in select * from public._lixeira_catalogo() c order by c.ordem loop
    -- registros imutáveis (comprovação, investidura, conclusão, consentimento) recusam DELETE por
    -- gatilho; aqui não é "apagar a história": a linha vai inteira para a lixeira e volta igual.
    if r.imutavel then set local session_replication_role = replica; end if;
    execute format('with d as (delete from public.%I where %s returning *)
                    insert into public.lixeira_linhas (pacote_id, ordem, tabela, dados)
                    select $3, $4, $5, to_jsonb(d) from d', r.tabela, r.filtro)
      using p_club, p_user, v_pacote, r.ordem, r.tabela;
    get diagnostics n = row_count;
    if r.imutavel then set local session_replication_role = origin; end if;
    if n > 0 then v_cont := v_cont || jsonb_build_object(r.tabela, n); end if;
  end loop;

  -- fotos de comprovação: só MARCA (bucket + caminho) os objetos daquele clube citados nas linhas
  select coalesce(jsonb_agg(distinct jsonb_build_object('bucket', o.bucket_id, 'name', o.name)), '[]'::jsonb)
    into v_storage
    from public.lixeira_linhas l
    cross join lateral jsonb_each_text(l.dados) kv
    join public.club_storage_objetos o
      on o.club_id = p_club
     and (kv.value = o.name or kv.value like '%/' || o.bucket_id || '/' || o.name
          or kv.value like '%/' || o.bucket_id || '/' || o.name || '?%')
   where l.pacote_id = v_pacote
     and kv.key in ('foto_url', 'evidencia_path', 'arquivo_path', 'url', 'thumb')
     and kv.value is not null and kv.value <> '';

  update public.lixeira_pacotes set contagens = v_cont, storage = v_storage where id = v_pacote;
  delete from public.lixeira_marcacoes where club_id = p_club and user_id = p_user;
  delete from public.lixeira_poupados where club_id = p_club and user_id = p_user;

  insert into public.platform_admin_audit (admin_user_id, acao, alvo_tipo, alvo_id, detalhe)
  values (p_por, 'lixeira_arquivar', 'club', p_club,
          jsonb_build_object('pacote_id', v_pacote, 'motivo', p_motivo, 'inativo_desde', p_inativo_desde,
                             'contagens', v_cont, 'arquivos_marcados', jsonb_array_length(v_storage),
                             'origem', case when p_por is null then 'rotina' else 'admin' end));
  return v_pacote;
end;
$$;
revoke all on function public._lixeira_arquivar(uuid, uuid, text, timestamptz, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) recuperar (devolve tudo; vínculo volta INATIVO)
-- ---------------------------------------------------------------------------
-- Ajusta uma linha às chaves estrangeiras de HOJE: se o "pai" sumiu enquanto a linha estava na
-- lixeira, FK com SET NULL vira nulo; qualquer outra (CASCADE/RESTRICT) descarta a linha — que é o
-- que teria acontecido com ela se estivesse na tabela quando o pai foi apagado.
create or replace function public._lixeira_ajustar_fk(p_tabela text, p_dados jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f record; v_ok boolean; v_dados jsonb := p_dados;
begin
  for f in
    select a.attname as col, c.confrelid::regclass as ref, ra.attname as refcol, c.confdeltype
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
     where c.conrelid = ('public.' || quote_ident(p_tabela))::regclass and c.contype = 'f' and array_length(c.conkey, 1) = 1
  loop
    if v_dados ->> f.col is null then continue; end if;
    execute format('select exists (select 1 from %s where %I::text = $1)', f.ref, f.refcol) into v_ok using v_dados ->> f.col;
    if not v_ok then
      if f.confdeltype in ('n', 'd') then v_dados := jsonb_set(v_dados, array[f.col::text], 'null'::jsonb);
      else return null; end if;
    end if;
  end loop;
  return v_dados;
end;
$$;
revoke all on function public._lixeira_ajustar_fk(text, jsonb) from public, anon, authenticated;

create or replace function public._lixeira_restaurar(p_pacote uuid, p_por uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_p public.lixeira_pacotes; l record; v_dados jsonb; n bigint; v_ok int := 0; v_pulos int := 0;
begin
  select * into v_p from public.lixeira_pacotes where id = p_pacote for update;
  if not found then raise exception 'Pacote da lixeira não encontrado.'; end if;
  if v_p.status <> 'na_lixeira' then raise exception 'Este pacote não está mais na lixeira (%).', v_p.status; end if;

  -- 1º o vínculo, com os gatilhos normais (auditoria/sincronia do perfil), sempre INATIVO
  for l in select * from public.lixeira_linhas where pacote_id = p_pacote and tabela = 'organization_memberships' loop
    v_dados := l.dados;
    -- unidade apagada enquanto estava na lixeira: o vínculo volta sem unidade (não é motivo para perdê-lo)
    if v_dados ->> 'unidade_id' is not null
       and not exists (select 1 from public.unidades where id = (v_dados ->> 'unidade_id')::uuid) then
      v_dados := jsonb_set(v_dados, '{unidade_id}', 'null'::jsonb);
    end if;
    v_dados := public._lixeira_ajustar_fk('organization_memberships', v_dados);
    if v_dados is null then v_pulos := v_pulos + 1; continue; end if;
    v_dados := v_dados || jsonb_build_object(
      'status', case when v_dados ->> 'status' in ('suspenso', 'encerrado') then v_dados ->> 'status' else 'suspenso' end,
      'inativo_desde', now(), 'updated_at', now());
    insert into public.organization_memberships
    select * from jsonb_populate_record(null::public.organization_memberships, v_dados)
    on conflict do nothing;
    get diagnostics n = row_count; v_ok := v_ok + n; if n = 0 then v_pulos := v_pulos + 1; end if;
  end loop;

  -- depois os dados, pais antes dos filhos, sem os gatilhos de validação/notificação de ESCRITA NOVA
  -- (não é escrita nova: é a mesma linha voltando). As FKs são conferidas uma a uma acima.
  set local session_replication_role = replica;
  for l in select * from public.lixeira_linhas where pacote_id = p_pacote and tabela <> 'organization_memberships'
            order by ordem desc, id loop
    v_dados := public._lixeira_ajustar_fk(l.tabela, l.dados);
    if v_dados is null then v_pulos := v_pulos + 1; continue; end if;
    execute format('insert into public.%I overriding system value select * from jsonb_populate_record(null::public.%I, $1) on conflict do nothing',
                   l.tabela, l.tabela) using v_dados;
    get diagnostics n = row_count; v_ok := v_ok + n; if n = 0 then v_pulos := v_pulos + 1; end if;
  end loop;
  set local session_replication_role = origin;

  delete from public.lixeira_linhas where pacote_id = p_pacote;
  update public.lixeira_pacotes set status = 'recuperado', recuperado_em = now(), recuperado_por = p_por where id = p_pacote;
  insert into public.lixeira_poupados (club_id, user_id, ate)
  values (v_p.club_id, v_p.user_id, now() + make_interval(days => (select dias_inatividade from public.lixeira_config where id)))
  on conflict (club_id, user_id) do update set ate = excluded.ate;
  return jsonb_build_object('restauradas', v_ok, 'nao_restauradas', v_pulos);
end;
$$;
revoke all on function public._lixeira_restaurar(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) fase 2: expurgo definitivo
-- ---------------------------------------------------------------------------
create or replace function public._lixeira_expurgar(p_pacote uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_p public.lixeira_pacotes; v_arquivos int := 0; v_conta boolean := false;
begin
  select * into v_p from public.lixeira_pacotes where id = p_pacote for update;
  if not found or v_p.status <> 'na_lixeira' then return null; end if;

  -- objetos marcados, só se continuam contabilizados PARA ESTE CLUBE (nunca de outro clube)
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o
   using jsonb_to_recordset(v_p.storage) as s(bucket text, name text)
   where o.bucket_id = s.bucket and o.name = s.name
     and exists (select 1 from public.club_storage_objetos c
                  where c.bucket_id = o.bucket_id and c.name = o.name and c.club_id = v_p.club_id);
  get diagnostics v_arquivos = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);

  delete from public.lixeira_linhas where pacote_id = p_pacote;

  -- conta de login global: só some se não sobrou NADA da pessoa em lugar nenhum
  if not exists (select 1 from public.organization_memberships where user_id = v_p.user_id)
     and not exists (select 1 from public.lixeira_pacotes where user_id = v_p.user_id and status = 'na_lixeira' and id <> p_pacote)
     and not public.eh_admin_plataforma(v_p.user_id) then
    begin
      delete from auth.users where id = v_p.user_id;
      v_conta := found;
    exception when others then
      v_conta := false;                       -- algo ainda aponta para a conta: ela fica
    end;
  end if;

  update public.lixeira_pacotes
     set status = 'expurgado', expurgado_em = now(), nome_exibicao = null, storage = '[]'::jsonb, conta_removida = v_conta
   where id = p_pacote;
  insert into public.platform_admin_audit (admin_user_id, acao, alvo_tipo, alvo_id, detalhe)
  values (auth.uid(), 'lixeira_expurgar', 'club', v_p.club_id,
          jsonb_build_object('pacote_id', p_pacote, 'arquivado_em', v_p.arquivado_em, 'contagens', v_p.contagens,
                             'arquivos_apagados', v_arquivos, 'conta_removida', v_conta));
  return jsonb_build_object('arquivos_apagados', v_arquivos, 'conta_removida', v_conta);
end;
$$;
revoke all on function public._lixeira_expurgar(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9) rotina (um clube) e rotina diária (todos)
-- ---------------------------------------------------------------------------
create or replace function public._lixeira_rodar_clube(p_club uuid, p_forcar_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_modo text := public._lixeira_modo(p_club); c record; p record; v_cand int := 0; v_arq int := 0; v_exp int := 0;
        v_erros jsonb := '[]'::jsonb; v_ret int;
begin
  if p_forcar_dry_run and v_modo = 'ativo' then v_modo := 'dry_run'; end if;
  if v_modo = 'desligado' and not p_forcar_dry_run then return jsonb_build_object('modo', 'desligado'); end if;
  if v_modo = 'desligado' then v_modo := 'dry_run'; end if;
  select dias_retencao into v_ret from public.lixeira_config where id;

  -- a lista de marcações é SEMPRE a foto de agora (sai quem voltou a ser ativo)
  delete from public.lixeira_marcacoes m
   where m.club_id = p_club and m.user_id not in (select x.user_id from public._lixeira_candidatos(p_club) x);

  for c in select * from public._lixeira_candidatos(p_club) loop
    v_cand := v_cand + 1;
    if v_modo = 'ativo' then
      begin
        perform public._lixeira_arquivar(p_club, c.user_id, c.motivo, c.inativo_desde, null);
        v_arq := v_arq + 1;
      exception when others then
        v_erros := v_erros || jsonb_build_object('user_id', c.user_id, 'erro', sqlerrm);
      end;
    else
      insert into public.lixeira_marcacoes (club_id, user_id, nome_exibicao, papeis, motivo, inativo_desde)
      values (p_club, c.user_id, public._lixeira_nome(c.user_id), c.papeis, c.motivo, c.inativo_desde)
      on conflict (club_id, user_id) do update
        set nome_exibicao = excluded.nome_exibicao, papeis = excluded.papeis, motivo = excluded.motivo,
            inativo_desde = excluded.inativo_desde, visto_em = now();
    end if;
  end loop;

  if v_modo = 'ativo' then
    for p in select id from public.lixeira_pacotes
              where club_id = p_club and status = 'na_lixeira' and arquivado_em <= now() - make_interval(days => v_ret) loop
      begin
        perform public._lixeira_expurgar(p.id);
        v_exp := v_exp + 1;
      exception when others then
        v_erros := v_erros || jsonb_build_object('pacote_id', p.id, 'erro', sqlerrm);
      end;
    end loop;
  end if;

  insert into public.lixeira_execucoes (club_id, modo, candidatos, arquivados, expurgados, erros)
  values (p_club, v_modo, v_cand, v_arq, v_exp, v_erros);
  return jsonb_build_object('modo', v_modo, 'candidatos', v_cand, 'arquivados', v_arq, 'expurgados', v_exp, 'erros', v_erros);
end;
$$;
revoke all on function public._lixeira_rodar_clube(uuid, boolean) from public, anon, authenticated;

create or replace function public.lixeira_rotina() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at loop
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

select cron.schedule('lixeira-membros-inativos', '45 4 * * *', 'select public.lixeira_rotina()')
 where not exists (select 1 from cron.job where jobname = 'lixeira-membros-inativos');

-- ---------------------------------------------------------------------------
-- 10) RPCs do admin da plataforma
-- ---------------------------------------------------------------------------
create or replace function public.admin_lixeira_config() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return (select json_build_object(
    'modo', c.modo, 'dias_inatividade', c.dias_inatividade, 'dias_retencao', c.dias_retencao,
    'sem_login_dias', c.sem_login_dias, 'atualizado_em', c.atualizado_em,
    'clubes', coalesce((select json_agg(json_build_object('club_id', x.club_id, 'clube', u.nome, 'slug', u.slug, 'modo', x.modo,
                                                          'atualizado_em', x.atualizado_em) order by u.nome)
                          from public.lixeira_config_clube x join public.organizational_units u on u.id = x.club_id), '[]'::json))
    from public.lixeira_config c where c.id);
end;
$$;

-- p_sem_login_dias: 0 desliga a regra; null mantém como está
create or replace function public.admin_lixeira_config_definir(p_modo text default null, p_dias_inatividade int default null,
                                                               p_dias_retencao int default null, p_sem_login_dias int default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_antes public.lixeira_config;
begin
  select * into v_antes from public.lixeira_config where id for update;
  if p_modo is not null and p_modo not in ('desligado', 'dry_run', 'ativo') then raise exception 'Modo inválido.'; end if;
  if p_dias_inatividade is not null and (p_dias_inatividade < 30 or p_dias_inatividade > 3650) then
    raise exception 'Dias de inatividade: use de 30 a 3650.'; end if;
  if p_dias_retencao is not null and (p_dias_retencao < 7 or p_dias_retencao > 3650) then
    raise exception 'Dias na lixeira antes do expurgo: use de 7 a 3650.'; end if;
  if p_sem_login_dias is not null and p_sem_login_dias <> 0 and (p_sem_login_dias < 60 or p_sem_login_dias > 3650) then
    raise exception 'Dias sem login: use 0 (desligado) ou de 60 a 3650.'; end if;
  update public.lixeira_config
     set modo = coalesce(p_modo, modo),
         dias_inatividade = coalesce(p_dias_inatividade, dias_inatividade),
         dias_retencao = coalesce(p_dias_retencao, dias_retencao),
         sem_login_dias = case when p_sem_login_dias is null then sem_login_dias when p_sem_login_dias = 0 then null else p_sem_login_dias end,
         atualizado_por = v_admin, atualizado_em = now()
   where id;
  perform public._admin_auditar('lixeira_config', 'plataforma', null,
    jsonb_build_object('antes', to_jsonb(v_antes) - 'id' - 'atualizado_por',
                       'depois', (select to_jsonb(c) - 'id' - 'atualizado_por' from public.lixeira_config c where c.id)));
  return public.admin_lixeira_config();
end;
$$;

-- modo só deste clube; null = segue o global (o Tenant 001 não pode ficar sem ajuste próprio)
create or replace function public.admin_lixeira_clube_modo(p_club_id uuid, p_modo text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_slug text; v_antes text;
begin
  select slug into v_slug from public.organizational_units where id = p_club_id and type = 'clube';
  if not found then raise exception 'Clube não encontrado.'; end if;
  if p_modo is not null and p_modo not in ('desligado', 'dry_run', 'ativo') then raise exception 'Modo inválido.'; end if;
  select modo into v_antes from public.lixeira_config_clube where club_id = p_club_id;
  if p_modo is null then
    if v_slug = 'filhos-da-conquista' then
      raise exception 'O clube fundador sempre tem modo próprio: escolha desligado, somente listar ou ativo.';
    end if;
    delete from public.lixeira_config_clube where club_id = p_club_id;
  else
    insert into public.lixeira_config_clube (club_id, modo, atualizado_por) values (p_club_id, p_modo, v_admin)
    on conflict (club_id) do update set modo = excluded.modo, atualizado_por = excluded.atualizado_por, atualizado_em = now();
  end if;
  perform public._admin_auditar('lixeira_modo_clube', 'club', p_club_id,
    jsonb_build_object('antes', v_antes, 'depois', p_modo, 'efetivo', public._lixeira_modo(p_club_id)));
  return json_build_object('ok', true, 'modo', public._lixeira_modo(p_club_id), 'proprio', p_modo is not null);
end;
$$;

create or replace function public.admin_lixeira_listar(p_club_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_ret int; v_inat int; v_sem int;
begin
  perform public._exigir_admin_plataforma();
  if not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Clube não encontrado.';
  end if;
  select dias_retencao, dias_inatividade, sem_login_dias into v_ret, v_inat, v_sem from public.lixeira_config where id;
  return json_build_object(
    'modo', public._lixeira_modo(p_club_id),
    'modo_proprio', (select modo from public.lixeira_config_clube where club_id = p_club_id),
    'dias_inatividade', v_inat, 'dias_retencao', v_ret, 'sem_login_dias', v_sem,
    'regra', format('Vai para a lixeira quem, neste clube, não tem vínculo ativo/pendente e está com o vínculo suspenso, encerrado ou vencido há %s dias ou mais%s. Responsável (pais) segue a mesma regra. Cadastro pendente não entra. Na lixeira a pessoa some de todas as telas e libera a vaga; o expurgo definitivo acontece %s dias depois (só com o modo ativo).',
                    v_inat, case when v_sem is null then '' else format(' — ou, com a regra de login ligada, não entra no app há %s dias (exceto diretoria)', v_sem) end, v_ret),
    'pacotes', coalesce((select json_agg(json_build_object(
        'id', p.id, 'nome', p.nome_exibicao, 'papeis', p.papeis, 'motivo', p.motivo, 'inativo_desde', p.inativo_desde,
        'status', p.status, 'arquivado_em', p.arquivado_em,
        'expurgo_previsto_em', case when p.status = 'na_lixeira' then p.arquivado_em + make_interval(days => v_ret) end,
        'recuperado_em', p.recuperado_em, 'expurgado_em', p.expurgado_em, 'conta_removida', p.conta_removida,
        'contagens', p.contagens, 'arquivos', jsonb_array_length(p.storage)) order by (p.status = 'na_lixeira') desc, p.arquivado_em desc)
      from (select * from public.lixeira_pacotes where club_id = p_club_id order by arquivado_em desc limit 300) p), '[]'::json),
    'marcacoes', coalesce((select json_agg(json_build_object(
        'nome', m.nome_exibicao, 'papeis', m.papeis, 'motivo', m.motivo, 'inativo_desde', m.inativo_desde,
        'primeira_vez_em', m.primeira_vez_em, 'visto_em', m.visto_em) order by m.inativo_desde)
      from public.lixeira_marcacoes m where m.club_id = p_club_id), '[]'::json),
    'execucoes', coalesce((select json_agg(json_build_object('quando', e.quando, 'modo', e.modo, 'candidatos', e.candidatos,
        'arquivados', e.arquivados, 'expurgados', e.expurgados, 'erros', jsonb_array_length(e.erros)) order by e.quando desc)
      from (select * from public.lixeira_execucoes where club_id = p_club_id order by quando desc limit 10) e), '[]'::json));
end;
$$;

-- atualiza a lista "iria para a lixeira" deste clube AGORA, sem mover nada (sempre dry-run)
create or replace function public.admin_lixeira_simular(p_club_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_res jsonb;
begin
  if not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Clube não encontrado.';
  end if;
  v_res := public._lixeira_rodar_clube(p_club_id, true);
  perform public._admin_auditar('lixeira_simular', 'club', p_club_id, v_res);
  return v_res::json;
end;
$$;

create or replace function public.admin_lixeira_recuperar(p_pacote_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_club uuid; v_res jsonb;
begin
  select club_id into v_club from public.lixeira_pacotes where id = p_pacote_id;
  if v_club is null then raise exception 'Pacote da lixeira não encontrado.'; end if;
  v_res := public._lixeira_restaurar(p_pacote_id, v_admin);
  perform public._admin_auditar('lixeira_recuperar', 'club', v_club,
    jsonb_build_object('pacote_id', p_pacote_id, 'motivo', nullif(btrim(coalesce(p_motivo, '')), '')) || v_res);
  return (jsonb_build_object('ok', true) || v_res)::json;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_lixeira_config()', 'admin_lixeira_config_definir(text, int, int, int)',
                           'admin_lixeira_clube_modo(uuid, text)', 'admin_lixeira_listar(uuid)',
                           'admin_lixeira_simular(uuid)', 'admin_lixeira_recuperar(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-lixeira-de-membros-inativos.sql')
on conflict (arquivo) do update set aplicada_em = now();
