-- =====================================================================
--  Consentimento AUDITÁVEL do responsável (Bloco G3 do pedido de fechamento).
--
--  O vínculo responsável→desbravador (public.responsaveis) já existia e continua sendo o que
--  decide QUEM acompanha QUEM (pedido/aprovação/recusa pela liderança) — não mexi nele. O que
--  faltava era um REGISTRO AUDITÁVEL de que o responsável CONSENTIU (termo, versão, quando, e uma
--  forma de revogar) — hoje só existia o vínculo aprovado, sem nenhum texto de consentimento.
--
--  NÃO escrevo texto jurídico definitivo (o pedido proíbe explicitamente) — o termo nasce com um
--  placeholder marcado "CONTEÚDO PENDENTE DE REVISÃO JURÍDICA". A INFRAESTRUTURA (tabela
--  versionada, RPC, auditoria, revogação) é real e funciona; o TEXTO é que está marcado como
--  provisório, do mesmo jeito que preço de plano já é `provisorio=true` no motor comercial.
--
--  NÃO transforma a liderança em dona da conta global da criança: consentimento é do
--  RESPONSÁVEL sobre o PRÓPRIO vínculo aprovado, nunca uma ação de terceiro. NÃO mexe em Auth.
--  NÃO resolve "criança sem e-mail" (decisão externa, continua pendente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) catálogo VERSIONADO de termos — mesma forma de document_templates/billing_plans: chave+versão,
--    um vigente por vez. O texto de verdade fica pendente de revisão jurídica, marcado.
-- ---------------------------------------------------------------------
create table if not exists public.termos_consentimento (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  versao int not null check (versao >= 1),
  titulo text not null,
  texto text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (chave, versao)
);
alter table public.termos_consentimento enable row level security;
revoke all on public.termos_consentimento from public, anon, authenticated;
drop policy if exists "leitura publica" on public.termos_consentimento;
create policy "leitura publica" on public.termos_consentimento for select to authenticated using (true);
grant select on public.termos_consentimento to authenticated;

insert into public.termos_consentimento (id, chave, versao, titulo, texto, ativo)
values (
  '10000000-0000-0000-0000-000000000001', 'vinculo-responsavel', 1,
  'Consentimento do responsável',
  'CONTEÚDO PENDENTE DE REVISÃO JURÍDICA — placeholder técnico. Este termo, quando revisado, vai ' ||
  'declarar o que o responsável autoriza ao vincular-se a um desbravador (acompanhar jornada, ' ||
  'receber avisos, dados tratados pelo clube) e como revogar esse consentimento a qualquer momento.',
  true
) on conflict (chave, versao) do nothing;

-- ---------------------------------------------------------------------
-- B) o registro do consentimento — um por (responsavel, desbravador, club) ATIVO por vez (índice
--    parcial, igual ao padrão já usado em document_signatures pra "uma assinatura ativa por vez").
--    Nunca apagado: revogar é uma NOVA coluna preenchida na MESMA linha (status implícito por
--    revogado_em is null), auditável pra sempre — mesmo padrão de class_completion_snapshots.
-- ---------------------------------------------------------------------
create table if not exists public.responsavel_consentimentos (
  id uuid primary key default gen_random_uuid(),
  responsavel_id uuid not null references public.profiles(id) on delete cascade,
  desbravador_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  vinculo_id uuid references public.responsaveis(id) on delete set null,
  termo_id uuid not null references public.termos_consentimento(id),
  origem text not null default 'app' check (origem = 'app'), -- único valor hoje; existe pra não precisar migration de schema se surgir um segundo canal
  concedido_em timestamptz not null default now(),
  revogado_em timestamptz,
  revogado_motivo text,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_responsavel_consentimentos_ativo
  on public.responsavel_consentimentos (responsavel_id, desbravador_id, club_id) where revogado_em is null;
create index if not exists idx_responsavel_consentimentos_club on public.responsavel_consentimentos (club_id);
alter table public.responsavel_consentimentos enable row level security;
revoke insert, update, delete on public.responsavel_consentimentos from authenticated, anon;
drop policy if exists "responsavel ou lideranca do clube" on public.responsavel_consentimentos;
create policy "responsavel ou lideranca do clube" on public.responsavel_consentimentos for select to authenticated
using (responsavel_id = auth.uid() or public.pode_gerir_no_clube(club_id));
drop trigger if exists trg_imutavel on public.responsavel_consentimentos;
create trigger trg_imutavel before update or delete on public.responsavel_consentimentos
for each row execute function public._proteger_registro_imutavel('revogado_em', 'revogado_motivo');

-- ---------------------------------------------------------------------
-- C) conceder — só o PRÓPRIO responsável, só sobre um vínculo APROVADO dele (nunca em nome de
--    outro, nunca sobre criança de outro clube, nunca sobre vínculo pendente/recusado).
-- ---------------------------------------------------------------------
create or replace function public.consentimento_conceder(p_vinculo_id uuid, p_termo_chave text default 'vinculo-responsavel') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_v record; v_termo record; v_id uuid;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  -- mesma regra de oráculo já usada em todo o projeto (ex.: snapshot_revogar/convite_*): inexistente
  -- e "existe mas não é seu" dão a MESMA mensagem — um uuid de outro clube não pode ser distinguido
  -- de um uuid aleatório por quem tenta.
  select * into v_v from public.responsaveis where id = p_vinculo_id and responsavel_id = v_uid;
  if not found then raise exception 'Vínculo não encontrado ou sem permissão.'; end if;
  if v_v.status <> 'aprovado' then raise exception 'O vínculo precisa estar aprovado antes do consentimento (status atual: %).', v_v.status; end if;

  select * into v_termo from public.termos_consentimento where chave = p_termo_chave and ativo order by versao desc limit 1;
  if not found then raise exception 'Termo de consentimento não encontrado.'; end if;

  if exists (select 1 from public.responsavel_consentimentos where responsavel_id = v_uid and desbravador_id = v_v.desbravador_id and club_id = v_v.club_id and revogado_em is null) then
    raise exception 'Você já concedeu este consentimento — revogue antes de conceder de novo.';
  end if;

  insert into public.responsavel_consentimentos (responsavel_id, desbravador_id, club_id, vinculo_id, termo_id, origem)
  values (v_uid, v_v.desbravador_id, v_v.club_id, v_v.id, v_termo.id, 'app')
  returning id into v_id;

  perform public._auditar('consentimento_concedido', v_v.club_id, v_v.desbravador_id, jsonb_build_object('consentimento_id', v_id, 'termo_versao', v_termo.versao));

  return jsonb_build_object('ok', true, 'consentimento_id', v_id, 'termo_versao', v_termo.versao);
end;
$$;
revoke all on function public.consentimento_conceder(uuid, text) from public, anon;
grant execute on function public.consentimento_conceder(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- D) revogar — o próprio responsável, ou a liderança do clube (ex.: responsável suspenso).
-- ---------------------------------------------------------------------
create or replace function public.consentimento_revogar(p_consentimento_id uuid, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_c record;
begin
  select * into v_c from public.responsavel_consentimentos where id = p_consentimento_id;
  -- mesma regra de oráculo: só revela "existe" pra quem já tem autoridade sobre a linha.
  if not found or not (v_c.responsavel_id = v_uid or public.pode_gerir_no_clube(v_c.club_id)) then
    raise exception 'Consentimento não encontrado ou sem permissão.';
  end if;
  if v_c.revogado_em is not null then raise exception 'Este consentimento já está revogado.'; end if;
  update public.responsavel_consentimentos set revogado_em = now(), revogado_motivo = p_motivo where id = p_consentimento_id;
  perform public._auditar('consentimento_revogado', v_c.club_id, v_c.desbravador_id, jsonb_build_object('consentimento_id', p_consentimento_id, 'motivo', p_motivo));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.consentimento_revogar(uuid, text) from public, anon;
grant execute on function public.consentimento_revogar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- E) leitura — histórico completo (concedidos e revogados) de quem o responsável pode ver.
-- ---------------------------------------------------------------------
create or replace function public.meus_consentimentos() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'id', c.id, 'desbravador_id', c.desbravador_id, 'desbravador_nome', p.nome,
    'termo_titulo', t.titulo, 'termo_versao', t.versao,
    'concedido_em', c.concedido_em, 'revogado_em', c.revogado_em, 'revogado_motivo', c.revogado_motivo
  ) order by c.concedido_em desc), '[]'::json)
  from public.responsavel_consentimentos c
  join public.profiles p on p.id = c.desbravador_id
  join public.termos_consentimento t on t.id = c.termo_id
  where c.responsavel_id = auth.uid();
$$;
revoke all on function public.meus_consentimentos() from public, anon;
grant execute on function public.meus_consentimentos() to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-consentimento-auditavel-de-menor.sql')
on conflict (arquivo) do update set aplicada_em = now();
