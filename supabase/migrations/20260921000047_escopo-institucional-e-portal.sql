-- =====================================================================
-- Fase 4.3 — Escopo institucional (contexto próprio, NÃO "clube") + portal enxuto + interface de dados
-- pra futura assinatura eletrônica. Rodar DEPOIS da 20260921000046. Idempotente.
--
-- PRINCÍPIO CENTRAL DESTA FASE: hierarquia NÃO é acesso. Estar acima na árvore não dá, e não pode dar,
-- acesso a chat, fotos, mensagens, financeiro, evidências, dados de responsáveis ou qualquer dado
-- operacional/pessoal dos clubes abaixo. Por isso:
--   - NENHUMA policy de RLS nova é criada aqui. Nada em member_*, profiles, fotos, chat, mensalidades,
--     responsaveis, requirement_approvals etc. passa a enxergar "quem está acima".
--   - Tudo que o portal mostra vem de RPCs SECURITY DEFINER que devolvem AGREGADO (contagens) — nunca
--     linhas pessoais — exceto onde há uma etapa de workflow que EXIGE a atuação daquela autoridade
--     (aí, e só aí, aparece o nome de quem depende da decisão: é o mínimo pra decidir).
--   - Um coordenador SEM vínculo de clube continua sem clube_atual_id() — ou seja, continua sem acesso
--     a absolutamente nada do app operacional. O portal é a única porta dele.
--
-- Camadas (identidade → vínculos → escopo em uso → capacidades → dados permitidos):
--   escopo_atual_id()            -> qual unidade NÃO-clube está em uso NESTA REQUISIÇÃO (header
--                                   x-escopo-atual, sempre validado contra vínculo ativo; sem padrão:
--                                   escopo institucional é explícito, nunca "cai" em algum)
--   meu_contexto_institucional() -> vínculos institucionais + capacidades de cada um
--   escopo_clubes_descendentes() -> os clubes abaixo na árvore (desce por parent_id)
--   escopo_painel()              -> situação geral dos clubes: SÓ contagens
--   escopo_investiduras_pendentes() -> só o que EXIGE atuação desta autoridade (hoje: sempre vazio para
--                                   Classes Regulares — o workflow ativo não tem etapa fora do clube;
--                                   ver a pesquisa institucional na migration 46. Nada é inventado.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) escopo em uso NESTA REQUISIÇÃO (mesma mecânica de duas abas do clube_atual_id, header próprio)
-- ---------------------------------------------------------------------
-- Diferenças deliberadas em relação a clube_atual_id():
--   - só aceita unidade NÃO-clube (clube tem o contexto dele; não se misturam);
--   - NÃO tem padrão: sem header válido, devolve NULL. Entrar no portal é um ato explícito.
create or replace function public.escopo_atual_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_pedido uuid;
begin
  if v_uid is null then return null; end if;
  begin
    v_pedido := nullif(current_setting('request.headers', true)::jsonb ->> 'x-escopo-atual', '')::uuid;
  exception when others then
    v_pedido := null;
  end;
  if v_pedido is null then return null; end if;
  -- só honra se houver vínculo ATIVO e vigente NAQUELA unidade, e se ela NÃO for um clube
  if exists (
    select 1 from public.organization_memberships m
    join public.organizational_units u on u.id = m.organizational_unit_id
    where m.user_id = v_uid and m.organizational_unit_id = v_pedido
      and u.type <> 'clube'
      and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    return v_pedido;
  end if;
  return null;  -- pedido inválido/forjado/desatualizado: nunca erro, nunca vaza — simplesmente não há escopo
end;
$$;
revoke all on function public.escopo_atual_id() from public, anon;
grant execute on function public.escopo_atual_id() to authenticated;

-- capacidades de um papel institucional (o que a autoridade PODE fazer naquele escopo). Declarativo e
-- pequeno de propósito: hoje o portal só lê. Nada aqui concede leitura de dado operacional de clube.
create or replace function public._capacidades_institucionais(p_role text) returns jsonb
language sql immutable as $$
  select case p_role
    when 'coordenador_distrital' then jsonb_build_object('ver_clubes', true, 'ver_painel', true, 'decidir_workflow', true)
    when 'coordenador_regional'  then jsonb_build_object('ver_clubes', true, 'ver_painel', true, 'decidir_workflow', true)
    when 'coordenador_geral'     then jsonb_build_object('ver_clubes', true, 'ver_painel', true, 'decidir_workflow', true)
    when 'diretor_mda'           then jsonb_build_object('ver_clubes', true, 'ver_painel', true, 'decidir_workflow', true)
    else jsonb_build_object('ver_clubes', false, 'ver_painel', false, 'decidir_workflow', false) end;
$$;
revoke all on function public._capacidades_institucionais(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- B) contexto institucional (paralelo ao meu_contexto(), que segue só de clube — nada quebra)
-- ---------------------------------------------------------------------
create or replace function public.meu_contexto_institucional() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_atual uuid := public.escopo_atual_id();
begin
  if v_uid is null then
    return jsonb_build_object('usuario_id', null, 'escopo_atual_id', null, 'escopos', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'usuario_id', v_uid,
    'escopo_atual_id', v_atual,
    'escopos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'escopo_id', u.id,
        'nome', u.nome,
        'tipo', u.type,
        'papel', m.role,
        'status', m.status,
        'selecionavel', (m.status = 'ativo'),
        'em_uso', (u.id is not distinct from v_atual),
        'capacidades', public._capacidades_institucionais(m.role)
      ) order by (u.id is not distinct from v_atual) desc, u.type, u.nome)
      from public.organization_memberships m
      join public.organizational_units u on u.id = m.organizational_unit_id and u.type <> 'clube'
      where m.user_id = v_uid
        and m.status = 'ativo'
        and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.meu_contexto_institucional() from public, anon;
grant execute on function public.meu_contexto_institucional() to authenticated;

-- ---------------------------------------------------------------------
-- C) clubes descendentes do escopo em uso (desce a árvore por parent_id)
-- ---------------------------------------------------------------------
create or replace function public._clubes_descendentes(p_escopo uuid) returns table (club_id uuid)
language sql stable security definer set search_path = '' as $$
  with recursive descendentes as (
    select id, type from public.organizational_units where id = p_escopo
    union all
    select o.id, o.type from public.organizational_units o join descendentes d on o.parent_id = d.id
  )
  select id from descendentes where type = 'clube';
$$;
revoke all on function public._clubes_descendentes(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- D) PAINEL do escopo — situação geral dos clubes, SÓ AGREGADO.
--    Nada de nome de pessoa, foto, chat, mensagem, financeiro, evidência, responsável ou contato.
--    A justificativa de cada número: uma coordenação precisa saber quantos clubes tem, o tamanho deles
--    e quantas conclusões estão paradas — não QUEM são as crianças nem o que elas enviaram.
-- ---------------------------------------------------------------------
create or replace function public.escopo_painel() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_escopo uuid := public.escopo_atual_id(); v_papel text;
begin
  if v_uid is null or v_escopo is null then return '[]'::json; end if;
  select m.role into v_papel from public.organization_memberships m
   where m.user_id = v_uid and m.organizational_unit_id = v_escopo and m.status = 'ativo'
     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()) limit 1;
  if v_papel is null or not (public._capacidades_institucionais(v_papel) ->> 'ver_painel')::boolean then
    return '[]'::json;
  end if;

  return coalesce((
    select json_agg(json_build_object(
      'club_id', c.id,
      'nome', c.nome,
      'tipo', c.type,
      'status', c.status,
      -- AGREGADOS (contagem pura; nenhuma linha pessoal sai daqui)
      'membros_ativos', (select count(*) from public.organization_memberships m2
                          where m2.organizational_unit_id = c.id and m2.status = 'ativo' and m2.role <> 'pais'
                            and m2.starts_at <= now() and (m2.ends_at is null or m2.ends_at > now())),
      'classes_em_andamento', (select count(*) from public.member_classes mc where mc.club_id = c.id and mc.status = 'em_andamento'),
      'classes_aguardando_revisao', (select count(*) from public.member_classes mc where mc.club_id = c.id and mc.status in ('requisitos_concluidos', 'aguardando_revisao')),
      'classes_aptas_investidura', (select count(*) from public.member_classes mc where mc.club_id = c.id and mc.status = 'apto_investidura'),
      'investidos_total', (select count(*) from public.member_classes mc where mc.club_id = c.id and mc.status = 'investida')
    ) order by c.nome)
    from public.organizational_units c
    where c.id in (select club_id from public._clubes_descendentes(v_escopo))
  ), '[]'::json);
end;
$$;
revoke all on function public.escopo_painel() from public, anon;
grant execute on function public.escopo_painel() to authenticated;

-- ---------------------------------------------------------------------
-- E) INVESTIDURAS que exigem a atuação DESTA autoridade.
--    Só aparece o que está travado numa etapa cujo escopo resolve EXATAMENTE neste escopo em uso E
--    cujo papel exigido a pessoa realmente tem aqui. Para o workflow ATIVO (Classes Regulares, 2 etapas
--    ambas no clube) isto é SEMPRE vazio — e é assim que tem que ser: o portal mostra "nada exige sua
--    atuação" em vez de inventar uma aprovação distrital que nenhuma fonte oficial exige (migration 46).
--    O nome da pessoa só aparece AQUI, porque sem ele não há como decidir sobre a investidura dela.
-- ---------------------------------------------------------------------
create or replace function public.escopo_investiduras_pendentes() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_escopo uuid := public.escopo_atual_id(); v_papel text;
begin
  if v_uid is null or v_escopo is null then return '[]'::json; end if;
  select m.role into v_papel from public.organization_memberships m
   where m.user_id = v_uid and m.organizational_unit_id = v_escopo and m.status = 'ativo'
     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()) limit 1;
  if v_papel is null or not (public._capacidades_institucionais(v_papel) ->> 'decidir_workflow')::boolean then
    return '[]'::json;
  end if;

  return coalesce((
    select json_agg(json_build_object(
      'member_class_id', r.member_class_id,
      'pessoa_nome', p.nome,                 -- mínimo indispensável pra decidir sobre a investidura dela
      'classe_nome', cl.nome,
      'clube_nome', o.nome,
      'etapa', json_build_object('ordem', st.ordem, 'chave', st.chave, 'nome', st.nome, 'escopo_tipo', st.escopo_tipo),
      'workflow', json_build_object('versao', r.workflow_versao),
      'aguardando_desde', r.updated_at
    ) order by r.updated_at)
    from public.investiture_workflow_runs r
    join public.investiture_workflow_stages st on st.workflow_id = r.workflow_id and st.ordem = r.current_stage_ordem
    join public.profiles p on p.id = r.usuario_id
    join public.organizational_units o on o.id = r.club_id_origem
    join public.member_classes mc on mc.id = r.member_class_id
    join public.classes cl on cl.id = mc.class_id
    where r.status = 'em_andamento'
      and r.club_id_origem in (select club_id from public._clubes_descendentes(v_escopo))
      -- a etapa atual tem que resolver EXATAMENTE neste escopo, e o papel exigido tem que ser o meu
      and public.unidade_ancestral(r.club_id_origem, st.escopo_tipo) = v_escopo
      and v_papel = any (st.papeis_permitidos)
  ), '[]'::json);
end;
$$;
revoke all on function public.escopo_investiduras_pendentes() from public, anon;
grant execute on function public.escopo_investiduras_pendentes() to authenticated;

-- ---------------------------------------------------------------------
-- F) INTERFACE DE DADOS pra futura assinatura eletrônica — preparada, NÃO implementada.
--    Hoje a única forma de decisão é 'aprovacao_sistema' (fase 4.2): decisão autenticada dentro do
--    sistema, que dá autoria e auditoria — e que NÃO é, e não deve ser chamada de, assinatura digital.
--    Esta tabela existe só pra que amanhã uma assinatura eletrônica possa ser ASSOCIADA ao snapshot/
--    documento sem remodelar nada. Nenhuma RPC escreve nela nesta fase; nasce e fica vazia.
-- ---------------------------------------------------------------------
create table if not exists public.document_signatures (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid references public.class_documents(id) on delete restrict,
  snapshot_id uuid not null references public.class_completion_snapshots(id) on delete restrict,
  usuario_id uuid references public.profiles(id) on delete set null,       -- titular (denorm p/ RLS)
  club_id_origem uuid not null references public.organizational_units(id), -- emissor (denorm p/ RLS)
  signatario_id uuid references public.profiles(id) on delete set null,
  signatario_papel text,
  escopo_organizational_unit_id uuid references public.organizational_units(id) on delete set null,
  -- 'aprovacao_sistema' é o que existe hoje; os demais são placeholders de schema pra quando houver
  -- fluxo real de assinatura eletrônica / certificado. Nenhum é gravado nesta fase.
  metodo text not null check (metodo in ('aprovacao_sistema', 'assinatura_eletronica', 'certificado_digital')),
  referencia_externa text,   -- id do provedor de assinatura, quando existir
  dados jsonb,               -- payload/carimbo do provedor, quando existir
  status text not null default 'registrada' check (status in ('registrada', 'revogada')),
  assinado_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_document_signatures_doc on public.document_signatures (documento_id);
alter table public.document_signatures enable row level security;
revoke insert, update, delete on public.document_signatures from authenticated, anon;
drop policy if exists "dono, emissor ou lideranca de clube com vinculo ativo" on public.document_signatures;
create policy "dono, emissor ou lideranca de clube com vinculo ativo" on public.document_signatures for select to authenticated
using (public._pode_ver_conquista_curricular(usuario_id, club_id_origem));
drop trigger if exists trg_imutavel on public.document_signatures;
create trigger trg_imutavel before update or delete on public.document_signatures
for each row execute function public._proteger_registro_imutavel('status');

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-escopo-institucional-e-portal.sql')
on conflict (arquivo) do update set aplicada_em = now();
