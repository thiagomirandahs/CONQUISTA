-- =====================================================================
-- Fase 4 — Snapshot curricular IMUTÁVEL + fluxo formal de conclusão / revisão final / investidura.
-- Rodar DEPOIS da 20260921000043. Idempotente. Ainda SEM PDF/cartão: esta é a camada que qualquer
-- cartão/caderno futuro vai ler.
--
-- Antes: 100% aprovado => member_classes 'concluida' (+ conquista portátil emitida na hora) e
-- investidura_confirmar virava 'investida'. Agora os estados são separados de verdade:
--   em_andamento → requisitos_concluidos → aguardando_revisao → apto_investidura → investida
--   (cancelada continua). 'concluida' deixa de existir.
--   - requisitos_concluidos: todos os requisitos aprovados (gatilho). Em seguida o sistema tenta SELAR a
--     conclusão: reconfere TODA regra estrutural (dependência, conteúdo dinâmico, N-de-M, sem_repeticao,
--     prazo). Se algo bloqueia, fica aqui (evento 'conclusao_bloqueada' com os motivos; a liderança pode
--     tentar de novo com classe_revisao_solicitar). Se nada bloqueia: snapshot selado + revisão aberta.
--   - aguardando_revisao: existe um class_completion_snapshot 'selado' (versão N desta matrícula) e um
--     investiture_reviews 'pendente' apontando pra ele.
--   - apto_investidura: a revisão final foi APROVADA (revisor, papel via organization_memberships, clube,
--     data, observação). Ainda NÃO é investido.
--   - investida: class_investitures registrada (evento próprio: data, clube, quem registrou, snapshot) —
--     só aqui a conquista portátil (curriculum_achievements) de CLASSE é emitida, com snapshot_id.
--   Correção na revisão: revisao_final_decidir('correcao_solicitada', requisitos[]) reabre requisitos
--   específicos, a matrícula volta a em_andamento; ao concluir de novo nasce o snapshot N+1 e o N vira
--   'substituido' (nunca editado, nunca apagado).
--
-- Snapshot (class_completion_snapshots.conteudo, jsonb canônico + hash sha256): pessoa, clube de
-- origem, classe, curriculum_version (versão/hash do manifesto, arquivos, documentos-base, OMDs
-- citadas), seções/requisitos EXATAMENTE como usados (texto, proveniência), escolhas registradas,
-- conquistas usadas nas dependências, conteúdo dinâmico resolvido (valor, período, fonte), aprovações
-- (avaliador, papel, clube, data, comentário), prazo, percentual. NÃO copia evidências (texto/foto):
-- guarda só referência/flag — o cartão futuro não vira vitrine de dado de menor. Reproduzível sem JOIN
-- com o catálogo atual (que pode ser arquivado/alterado depois).
-- Imutabilidade: gatilho recusa UPDATE em qualquer coluna de conteúdo (só status/revogação, e colunas de
-- FK indo pra NULL por cascata) e recusa DELETE — vale pra qualquer papel, inclusive quem roda SQL como
-- dono. Correção posterior = snapshot_revogar (auditado) ou nova versão; nunca UPDATE destrutivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) estados
-- ---------------------------------------------------------------------
alter table public.member_classes add column if not exists investida_em timestamptz;
alter table public.member_classes drop constraint if exists member_classes_status_check;
alter table public.member_classes add constraint member_classes_status_check check (status in
  ('em_andamento', 'requisitos_concluidos', 'aguardando_revisao', 'apto_investidura', 'investida', 'cancelada', 'concluida'));
-- 'concluida' (modelo antigo) migra: com revisão pendente → aguardando_revisao (sem snapshot ainda — o
-- primeiro re-selamento cria); sem revisão → requisitos_concluidos. Depois o valor sai do CHECK.
update public.member_classes mc set status = case
  when exists (select 1 from public.investiture_reviews ir where ir.member_class_id = mc.id and ir.status = 'pendente') then 'aguardando_revisao'
  else 'requisitos_concluidos' end
where mc.status = 'concluida';
alter table public.member_classes drop constraint if exists member_classes_status_check;
alter table public.member_classes add constraint member_classes_status_check check (status in
  ('em_andamento', 'requisitos_concluidos', 'aguardando_revisao', 'apto_investidura', 'investida', 'cancelada'));

-- ---------------------------------------------------------------------
-- B) registros imutáveis: snapshot, eventos, investidura
-- ---------------------------------------------------------------------
-- Gatilho genérico de imutabilidade: UPDATE só pode mudar as colunas listadas em tg_argv (ou levar uma
-- coluna de FK a NULL, por cascata); DELETE nunca.
create or replace function public._proteger_registro_imutavel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_mutaveis text[] := coalesce(tg_argv, '{}'); k text; v_old jsonb; v_new jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception '% é imutável: não pode ser apagado (revogue com auditoria).', tg_table_name;
  end if;
  v_old := to_jsonb(old); v_new := to_jsonb(new);
  for k in select jsonb_object_keys(v_new) loop
    if v_new -> k is distinct from v_old -> k then
      if k = any (v_mutaveis) then continue; end if;
      if jsonb_typeof(v_new -> k) = 'null' and k like '%\_id' then continue; end if;  -- FK on delete set null
      raise exception '% é imutável: a coluna "%" não pode ser alterada (use revogação/versão nova, com auditoria).', tg_table_name, k;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public._proteger_registro_imutavel() from public, anon, authenticated;

create table if not exists public.class_completion_snapshots (
  id uuid primary key default gen_random_uuid(),
  member_class_id uuid references public.member_classes(id) on delete set null,
  usuario_id uuid references public.profiles(id) on delete set null,
  club_id_origem uuid not null references public.organizational_units(id),
  classe_id uuid references public.classes(id) on delete set null,
  curriculum_version_id uuid references public.curriculum_versions(id) on delete set null,
  versao int not null,
  conteudo jsonb not null,
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'selado' check (status in ('selado', 'substituido', 'revogado')),
  selado_em timestamptz not null default now(),
  gerado_por uuid references public.profiles(id) on delete set null,
  revogado_em timestamptz,
  revogado_por uuid references public.profiles(id) on delete set null,
  revogado_motivo text,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_class_completion_snapshots_versao on public.class_completion_snapshots (member_class_id, versao) where member_class_id is not null;
create index if not exists idx_class_completion_snapshots_usuario on public.class_completion_snapshots (usuario_id, status);

create table if not exists public.class_completion_events (
  id uuid primary key default gen_random_uuid(),
  member_class_id uuid references public.member_classes(id) on delete set null,
  snapshot_id uuid references public.class_completion_snapshots(id) on delete set null,
  usuario_id uuid references public.profiles(id) on delete set null,
  club_id uuid not null references public.organizational_units(id),
  tipo text not null check (tipo in ('requisitos_concluidos', 'conclusao_bloqueada', 'snapshot_selado', 'snapshot_substituido', 'revisao_solicitada',
                                     'revisao_aprovada', 'revisao_correcao', 'investidura_registrada', 'snapshot_revogado', 'investidura_revogada', 'conquista_revogada')),
  ator_id uuid references public.profiles(id) on delete set null,
  ator_papel text,
  observacao text,
  dados jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_class_completion_events_mc on public.class_completion_events (member_class_id, created_at);
create index if not exists idx_class_completion_events_club on public.class_completion_events (club_id, created_at);

create table if not exists public.class_investitures (
  id uuid primary key default gen_random_uuid(),
  member_class_id uuid references public.member_classes(id) on delete set null,
  snapshot_id uuid not null references public.class_completion_snapshots(id),
  usuario_id uuid references public.profiles(id) on delete set null,
  club_id uuid not null references public.organizational_units(id),
  registrado_por uuid references public.profiles(id) on delete set null,
  registrado_papel text not null,
  data_investidura date not null,
  observacao text,
  status text not null default 'registrada' check (status in ('registrada', 'revogada')),
  revogado_em timestamptz,
  revogado_por uuid references public.profiles(id) on delete set null,
  revogado_motivo text,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_class_investitures_mc on public.class_investitures (member_class_id) where status = 'registrada' and member_class_id is not null;
create unique index if not exists ux_class_investitures_snapshot on public.class_investitures (snapshot_id) where status = 'registrada';

alter table public.curriculum_achievements add column if not exists snapshot_id uuid references public.class_completion_snapshots(id) on delete set null;

-- imutabilidade
drop trigger if exists trg_imutavel on public.class_completion_snapshots;
create trigger trg_imutavel before update or delete on public.class_completion_snapshots
for each row execute function public._proteger_registro_imutavel('status', 'revogado_em', 'revogado_por', 'revogado_motivo');
drop trigger if exists trg_imutavel on public.class_completion_events;
create trigger trg_imutavel before update or delete on public.class_completion_events
for each row execute function public._proteger_registro_imutavel();
drop trigger if exists trg_imutavel on public.class_investitures;
create trigger trg_imutavel before update or delete on public.class_investitures
for each row execute function public._proteger_registro_imutavel('status', 'revogado_em', 'revogado_por', 'revogado_motivo');

-- RLS: snapshot e investidura seguem a visibilidade da conquista portátil (dono, liderança do clube
-- emissor, liderança de clube onde a pessoa tem vínculo ativo); eventos são operacionais do clube.
alter table public.class_completion_snapshots enable row level security;
alter table public.class_completion_events enable row level security;
alter table public.class_investitures enable row level security;
revoke insert, update, delete on public.class_completion_snapshots, public.class_completion_events, public.class_investitures from authenticated, anon;
drop policy if exists "dono, emissor ou lideranca de clube com vinculo ativo" on public.class_completion_snapshots;
create policy "dono, emissor ou lideranca de clube com vinculo ativo" on public.class_completion_snapshots for select to authenticated
using (public._pode_ver_conquista_curricular(usuario_id, club_id_origem));
drop policy if exists "dono, emissor ou lideranca de clube com vinculo ativo" on public.class_investitures;
create policy "dono, emissor ou lideranca de clube com vinculo ativo" on public.class_investitures for select to authenticated
using (public._pode_ver_conquista_curricular(usuario_id, club_id));
drop policy if exists "dono ou lideranca do clube" on public.class_completion_events;
create policy "dono ou lideranca do clube" on public.class_completion_events for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));

-- ---------------------------------------------------------------------
-- C) revisão final reusa investiture_reviews (uma linha por pedido; a pendente é única por matrícula)
-- ---------------------------------------------------------------------
alter table public.investiture_reviews
  add column if not exists snapshot_id uuid references public.class_completion_snapshots(id),
  add column if not exists revisado_papel text;
alter table public.investiture_reviews drop constraint if exists investiture_reviews_status_check;
alter table public.investiture_reviews add constraint investiture_reviews_status_check check (status in ('pendente', 'aprovado', 'correcao_solicitada', 'investido', 'recusado'));
alter table public.investiture_reviews drop constraint if exists investiture_reviews_member_class_id_key;
create unique index if not exists ux_investiture_reviews_pendente on public.investiture_reviews (member_class_id) where status = 'pendente';

-- ---------------------------------------------------------------------
-- D) evento de auditoria (helper) + conteúdo do snapshot + selar
-- ---------------------------------------------------------------------
create or replace function public._classe_evento(p_member_class_id uuid, p_tipo text, p_snapshot_id uuid, p_observacao text, p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_mc record; v_uid uuid := auth.uid(); v_id uuid;
begin
  select * into v_mc from public.member_classes where id = p_member_class_id;
  insert into public.class_completion_events (member_class_id, snapshot_id, usuario_id, club_id, tipo, ator_id, ator_papel, observacao, dados)
  values (p_member_class_id, p_snapshot_id, v_mc.usuario_id, v_mc.club_id, p_tipo, v_uid,
          case when v_uid is null then 'sistema' else coalesce(public.papel_no_clube(v_uid, v_mc.club_id), '?') end, p_observacao, p_dados)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public._classe_evento(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- Tudo que o cartão futuro precisa, DESNORMALIZADO (nenhum id de catálogo é necessário pra ler).
create or replace function public._classe_snapshot_conteudo(p_member_class_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_mc record; v_out jsonb;
begin
  select * into v_mc from public.member_classes where id = p_member_class_id;
  if not found then return null; end if;
  select jsonb_build_object(
    'formato', 'conquista.snapshot_classe/1',
    'pessoa', (select jsonb_build_object('id', p.id, 'nome', p.nome) from public.profiles p where p.id = v_mc.usuario_id),
    'clube_origem', (select jsonb_build_object('id', o.id, 'nome', o.nome, 'slug', o.slug) from public.organizational_units o where o.id = v_mc.club_id),
    'matricula', jsonb_build_object('member_class_id', v_mc.id, 'iniciada_em', v_mc.iniciada_em, 'concluida_em', v_mc.concluida_em),
    'classe', (select jsonb_build_object('id', c.id, 'manifesto_id', c.manifesto_id, 'codigo', c.codigo, 'nome', c.nome, 'idade_minima', c.idade_minima,
                 'vigente_desde', c.vigente_desde, 'fonte_url', c.fonte_url, 'fonte_publicado_em', c.fonte_publicado_em, 'proveniencia', c.proveniencia,
                 'prazo_minimo_dias', c.prazo_minimo_dias, 'prazo_maximo_dias', c.prazo_maximo_dias)
               from public.classes c where c.id = v_mc.class_id),
    'curriculum_version', (select jsonb_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao, 'status', v.status,
                 'vigente_desde', v.vigente_desde, 'fonte_hash', v.fonte_hash, 'fonte_arquivo', v.fonte_arquivo, 'fonte_descricao', v.fonte_descricao,
                 'importado_em', v.importado_em, 'manifesto_versao', v.fonte_detalhes ->> 'manifesto_versao', 'gerado_em', v.fonte_detalhes ->> 'gerado_em',
                 'arquivos', v.fonte_detalhes -> 'arquivos', 'documentos_base', v.fonte_detalhes -> 'documentos_base',
                 -- só as OMDs que algum requisito desta classe cita
                 'omds', (select coalesce(jsonb_agg(o), '[]'::jsonb) from jsonb_array_elements(coalesce(v.fonte_detalhes -> 'omds', '[]'::jsonb)) o
                          where o ->> 'id' in (select r.alterado_por_omd from public.class_requirements r join public.class_sections s on s.id = r.section_id where s.class_id = v_mc.class_id
                                               union select r.confirmado_por_omd from public.class_requirements r join public.class_sections s on s.id = r.section_id where s.class_id = v_mc.class_id)))
               from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.id = v_mc.class_id),
    'secoes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'manifesto_id', s.manifesto_id, 'codigo', s.codigo, 'nome', s.nome, 'ordem', s.ordem,
        'requisitos', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', r.id, 'manifesto_id', r.manifesto_id, 'codigo', r.codigo, 'descricao', r.descricao, 'ordem', r.ordem,
            'status_fonte', r.status_fonte, 'alterado_por_omd', r.alterado_por_omd, 'confirmado_por_omd', r.confirmado_por_omd, 'observacao_fonte', r.observacao_fonte,
            'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
            'status', mr.status, 'enviado_em', mr.enviado_em,
            -- referência, não cópia: o snapshot não carrega texto/foto de evidência
            'evidencia', jsonb_build_object('member_requirement_id', mr.id, 'tem_texto', coalesce(mr.evidencia_texto, '') <> '', 'tem_arquivo', coalesce(mr.evidencia_path, '') <> ''),
            'conteudo_dinamico', (select jsonb_build_object('chave', d.chave, 'nome', d.nome) || coalesce(public.conteudo_dinamico_resolver(d.chave, current_date), '{}'::jsonb)
                                  from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
            'escolha', (select jsonb_build_object('n_minimo', g.n_minimo, 'sem_repeticao', g.sem_repeticao, 'pool_sem_repeticao', g.pool_sem_repeticao,
                          'opcoes', (select coalesce(jsonb_agg(o.rotulo order by o.ordem), '[]'::jsonb) from public.requirement_options o where o.grupo_id = g.id),
                          'escolhidas', (select coalesce(jsonb_agg(coalesce(o.rotulo, mo.rotulo_livre) order by o.ordem nulls last, mo.created_at), '[]'::jsonb)
                                         from public.member_requirement_options mo left join public.requirement_options o on o.id = mo.option_id where mo.member_requirement_id = mr.id),
                          'cumpridas_pelo_historico', (select coalesce(jsonb_agg(jsonb_build_object('opcao', o.rotulo, 'conquista_id', a.id, 'club_id_origem', a.club_id_origem, 'concluida_em', a.concluida_em)), '[]'::jsonb)
                                         from public.requirement_options o join public.curriculum_achievements a on a.specialty_id = o.specialty_id and a.usuario_id = v_mc.usuario_id and a.tipo = 'especialidade' and a.status = 'ativa'
                                         where o.grupo_id = g.id and (not g.sem_repeticao or a.concluida_em >= v_mc.iniciada_em)))
                        from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = r.id),
            'dependencias', (select coalesce(jsonb_agg(jsonb_build_object('tipo', dep.depende_de_tipo, 'id', dep.depende_de_id, 'obrigatorio', dep.obrigatorio,
                               'nome', case when dep.depende_de_tipo = 'class' then (select nome from public.classes where id = dep.depende_de_id) else (select nome from public.specialties where id = dep.depende_de_id) end,
                               'satisfeita_por', (select jsonb_build_object('conquista_id', a.id, 'club_id_origem', a.club_id_origem, 'concluida_em', a.concluida_em, 'status', a.status)
                                                  from public.curriculum_achievements a where a.usuario_id = v_mc.usuario_id and a.status = 'ativa'
                                                    and ((dep.depende_de_tipo = 'class' and a.tipo = 'classe' and a.classe_id = dep.depende_de_id) or (dep.depende_de_tipo = 'specialty' and a.tipo = 'especialidade' and a.specialty_id = dep.depende_de_id))
                                                  order by a.concluida_em limit 1))), '[]'::jsonb)
                             from public.curriculum_dependencies dep where dep.alvo_tipo = 'class_requirement' and dep.alvo_id = r.id),
            'aprovacoes', (select coalesce(jsonb_agg(jsonb_build_object('decisao', a.decisao, 'avaliado_por', jsonb_build_object('id', a.avaliado_por, 'nome', p.nome),
                             'papel', a.avaliado_papel, 'club_id', a.club_id, 'comentario', a.comentario, 'em', a.created_at) order by a.created_at), '[]'::jsonb)
                           from public.requirement_approvals a left join public.profiles p on p.id = a.avaliado_por where a.member_requirement_id = mr.id)
          ) order by r.ordem, r.codigo), '[]'::jsonb)
          from public.class_requirements r left join public.member_requirements mr on mr.requirement_id = r.id and mr.member_class_id = v_mc.id
          where r.section_id = s.id and r.ativo
        )
      ) order by s.ordem), '[]'::jsonb)
      from public.class_sections s where s.class_id = v_mc.class_id
    ),
    'dependencias_da_classe', (select coalesce(jsonb_agg(jsonb_build_object('tipo', dep.depende_de_tipo, 'id', dep.depende_de_id,
                                 'satisfeita_por', (select jsonb_build_object('conquista_id', a.id, 'club_id_origem', a.club_id_origem, 'concluida_em', a.concluida_em)
                                                    from public.curriculum_achievements a where a.usuario_id = v_mc.usuario_id and a.status = 'ativa'
                                                      and ((dep.depende_de_tipo = 'class' and a.tipo = 'classe' and a.classe_id = dep.depende_de_id) or (dep.depende_de_tipo = 'specialty' and a.tipo = 'especialidade' and a.specialty_id = dep.depende_de_id))
                                                    order by a.concluida_em limit 1))), '[]'::jsonb)
                               from public.curriculum_dependencies dep where dep.alvo_tipo = 'class' and dep.alvo_id = v_mc.class_id),
    'prazo', (select public.prazo_situacao(v_mc.iniciada_em, c.prazo_minimo_dias, c.prazo_maximo_dias) from public.classes c where c.id = v_mc.class_id),
    'percentual', public.classe_percentual(v_mc.id),
    'gerado_em', now()
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public._classe_snapshot_conteudo(uuid) from public, anon, authenticated;

create or replace function public._snapshot_hash(p_conteudo jsonb) returns text
language sql immutable as $$ select encode(extensions.digest(p_conteudo::text, 'sha256'), 'hex') $$;
revoke all on function public._snapshot_hash(jsonb) from public, anon, authenticated;

-- Selar a conclusão: reconfere TODA regra em todos os requisitos; se bloqueia, fica em
-- requisitos_concluidos e registra os motivos; senão snapshot N (N-1 vira 'substituido') + revisão pendente.
create or replace function public._classe_selar_conclusao(p_member_class_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_mc record; v_bloq jsonb; v_pend int; v_conteudo jsonb; v_hash text; v_versao int; v_snap uuid; v_prazo jsonb;
begin
  select * into v_mc from public.member_classes where id = p_member_class_id for update;
  if not found then raise exception 'Classe do membro não encontrada.'; end if;
  if v_mc.status <> 'requisitos_concluidos' then raise exception 'A matrícula não está em "requisitos concluídos" (status atual: %).', v_mc.status; end if;

  select count(*) into v_pend from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
   where mr.member_class_id = v_mc.id and mr.status <> 'aprovado';
  select coalesce(jsonb_agg(jsonb_build_object('member_requirement_id', mr.id, 'codigo', r.codigo, 'bloqueios', to_jsonb(b))), '[]'::jsonb) into v_bloq
    from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
    cross join lateral public._requisito_bloqueios(mr.id) b
   where mr.member_class_id = v_mc.id and array_length(b, 1) > 0;
  select public.prazo_situacao(v_mc.iniciada_em, c.prazo_minimo_dias, c.prazo_maximo_dias) into v_prazo from public.classes c where c.id = v_mc.class_id;
  if v_pend > 0 or jsonb_array_length(v_bloq) > 0 or not (v_prazo ->> 'minimo_atingido')::boolean then
    perform public._classe_evento(v_mc.id, 'conclusao_bloqueada', null, null,
      jsonb_build_object('requisitos_nao_aprovados', v_pend, 'bloqueios', v_bloq, 'prazo', v_prazo));
    return jsonb_build_object('ok', false, 'status', 'requisitos_concluidos', 'requisitos_nao_aprovados', v_pend, 'bloqueios', v_bloq, 'prazo', v_prazo);
  end if;

  v_conteudo := public._classe_snapshot_conteudo(v_mc.id);
  v_hash := public._snapshot_hash(v_conteudo);
  select coalesce(max(versao), 0) + 1 into v_versao from public.class_completion_snapshots where member_class_id = v_mc.id;
  update public.class_completion_snapshots set status = 'substituido' where member_class_id = v_mc.id and status = 'selado';
  insert into public.class_completion_snapshots (member_class_id, usuario_id, club_id_origem, classe_id, curriculum_version_id, versao, conteudo, hash, gerado_por)
  select v_mc.id, v_mc.usuario_id, v_mc.club_id, v_mc.class_id, c.curriculum_version_id, v_versao, v_conteudo, v_hash, auth.uid()
    from public.classes c where c.id = v_mc.class_id
  returning id into v_snap;
  if v_versao > 1 then perform public._classe_evento(v_mc.id, 'snapshot_substituido', v_snap, null, jsonb_build_object('versao_nova', v_versao)); end if;
  perform public._classe_evento(v_mc.id, 'snapshot_selado', v_snap, null, jsonb_build_object('versao', v_versao, 'hash', v_hash));

  insert into public.investiture_reviews (member_class_id, club_id, usuario_id, snapshot_id) values (v_mc.id, v_mc.club_id, v_mc.usuario_id, v_snap);
  update public.member_classes set status = 'aguardando_revisao', updated_at = now() where id = v_mc.id;
  perform public._classe_evento(v_mc.id, 'revisao_solicitada', v_snap, null, null);
  return jsonb_build_object('ok', true, 'status', 'aguardando_revisao', 'snapshot_id', v_snap, 'versao', v_versao, 'hash', v_hash);
end;
$$;
revoke all on function public._classe_selar_conclusao(uuid) from public, anon, authenticated;

-- gatilho de conclusão: todos aprovados → requisitos_concluidos (+ evento) → tenta selar (nunca levanta erro)
create or replace function public.avaliar_conclusao_classe() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_total int; v_aprovados int; v_mc record; v_prazo_min int;
begin
  if new.status is distinct from 'aprovado' then return new; end if;
  select * into v_mc from public.member_classes where id = new.member_class_id;
  if v_mc.status is distinct from 'em_andamento' then return new; end if;

  select count(*) into v_total from public.class_requirements r join public.class_sections s on s.id = r.section_id where s.class_id = v_mc.class_id and r.ativo;
  select count(*) into v_aprovados from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
   where mr.member_class_id = new.member_class_id and mr.status = 'aprovado';

  if v_total > 0 and v_aprovados >= v_total then
    select prazo_minimo_dias into v_prazo_min from public.classes where id = v_mc.class_id;
    if v_prazo_min is not null and now() < v_mc.iniciada_em + (v_prazo_min || ' days')::interval then
      return new; -- prazo mínimo da classe ainda não atingido: nem "requisitos concluídos"
    end if;
    update public.member_classes set status = 'requisitos_concluidos', concluida_em = now(), updated_at = now() where id = new.member_class_id;
    perform public._classe_evento(new.member_class_id, 'requisitos_concluidos', null, null, jsonb_build_object('aprovados', v_aprovados, 'total', v_total));
    perform public._classe_selar_conclusao(new.member_class_id);
  end if;
  return new;
end;
$$;

-- conquista de CLASSE: só na INVESTIDURA (especialidade continua na conclusão)
create or replace function public.registrar_conquista_curricular() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_argv[0] = 'member_classes' then
    if new.status = 'investida' and (old.status is null or old.status is distinct from 'investida') then
      insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, member_class_id, concluida_em)
      values (new.usuario_id, 'classe', new.class_id, new.club_id, new.id, coalesce(new.investida_em, now()))
      on conflict (usuario_id, classe_id, club_id_origem) where tipo = 'classe' do nothing;
    end if;
  elsif tg_argv[0] = 'member_specialties' then
    if new.status = 'concluida' and (old.status is null or old.status is distinct from 'concluida') then
      insert into public.curriculum_achievements (usuario_id, tipo, specialty_id, club_id_origem, member_specialty_id, concluida_em)
      values (new.usuario_id, 'especialidade', new.specialty_id, new.club_id, new.id, coalesce(new.concluida_em, now()))
      on conflict (usuario_id, specialty_id, club_id_origem) where tipo = 'especialidade' do nothing;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- E) RPCs
-- ---------------------------------------------------------------------
drop function if exists public.investidura_confirmar(uuid, boolean, text);

-- liderança tenta selar de novo uma matrícula parada em requisitos_concluidos (ex.: bloqueio resolvido)
create or replace function public.classe_revisao_solicitar(p_member_class_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_mc record;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club;
  if not found then raise exception 'Classe do membro não encontrada neste clube.'; end if;
  return public._classe_selar_conclusao(v_mc.id);
end;
$$;
revoke all on function public.classe_revisao_solicitar(uuid) from public, anon;
grant execute on function public.classe_revisao_solicitar(uuid) to authenticated;

-- revisão final: aprovado (→ apto_investidura) ou correcao_solicitada (reabre requisitos; → em_andamento)
create or replace function public.revisao_final_decidir(p_member_class_id uuid, p_decisao text, p_observacao text default null, p_requisitos_para_corrigir uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record; v_ir record; v_papel text; v_id uuid; v_n int := 0;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club for update;
  if not found then raise exception 'Classe do membro não encontrada neste clube.'; end if;
  if v_mc.status <> 'aguardando_revisao' then raise exception 'Esta matrícula não está aguardando revisão final (status: %).', v_mc.status; end if;
  select * into v_ir from public.investiture_reviews where member_class_id = v_mc.id and status = 'pendente' for update;
  if not found then raise exception 'Revisão final pendente não encontrada.'; end if;
  v_papel := coalesce(public.papel_no_clube(v_uid, v_club), '?');

  if p_decisao = 'aprovado' then
    update public.investiture_reviews set status = 'aprovado', revisado_por = v_uid, revisado_em = now(), revisado_papel = v_papel, comentario = p_observacao where id = v_ir.id;
    update public.member_classes set status = 'apto_investidura', updated_at = now() where id = v_mc.id;
    perform public._classe_evento(v_mc.id, 'revisao_aprovada', v_ir.snapshot_id, p_observacao, jsonb_build_object('review_id', v_ir.id));
    return jsonb_build_object('ok', true, 'status', 'apto_investidura');
  end if;

  if coalesce(array_length(p_requisitos_para_corrigir, 1), 0) = 0 then raise exception 'Indique ao menos um requisito a corrigir.'; end if;
  if coalesce(trim(p_observacao), '') = '' then raise exception 'Explique o que precisa ser corrigido.'; end if;
  foreach v_id in array p_requisitos_para_corrigir loop
    if not exists (select 1 from public.member_requirements where id = v_id and member_class_id = v_mc.id) then raise exception 'Requisito % não é desta matrícula.', v_id; end if;
    update public.member_requirements set status = 'correcao_solicitada', updated_at = now() where id = v_id;
    insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario)
    select mr.id, mr.requirement_id, c.curriculum_version_id, v_club, 'correcao_solicitada', v_uid, v_papel, 'Revisão final: ' || p_observacao
      from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
     where mr.id = v_id;
    v_n := v_n + 1;
  end loop;
  update public.investiture_reviews set status = 'correcao_solicitada', revisado_por = v_uid, revisado_em = now(), revisado_papel = v_papel, comentario = p_observacao where id = v_ir.id;
  update public.member_classes set status = 'em_andamento', concluida_em = null, updated_at = now() where id = v_mc.id;
  perform public._classe_evento(v_mc.id, 'revisao_correcao', v_ir.snapshot_id, p_observacao, jsonb_build_object('review_id', v_ir.id, 'requisitos', to_jsonb(p_requisitos_para_corrigir)));
  return jsonb_build_object('ok', true, 'status', 'em_andamento', 'requisitos_reabertos', v_n);
end;
$$;
revoke all on function public.revisao_final_decidir(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.revisao_final_decidir(uuid, text, text, uuid[]) to authenticated;

-- investidura: evento próprio; exige apto_investidura + revisão aprovada + snapshot selado + NADA bloqueando agora
create or replace function public.investidura_registrar(p_member_class_id uuid, p_data date default current_date, p_observacao text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record; v_ir record; v_snap record; v_pend int; v_bloq jsonb; v_inv uuid; v_papel text;
begin
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club for update;
  if not found then raise exception 'Classe do membro não encontrada neste clube.'; end if;
  if v_mc.status = 'investida' or exists (select 1 from public.class_investitures where member_class_id = v_mc.id and status = 'registrada') then
    raise exception 'Investidura já registrada para esta matrícula.';
  end if;
  if v_mc.status <> 'apto_investidura' then raise exception 'Investidura não permitida: a revisão final ainda não foi aprovada (status: %).', v_mc.status; end if;
  select * into v_ir from public.investiture_reviews where member_class_id = v_mc.id and status = 'aprovado' order by revisado_em desc limit 1;
  if not found then raise exception 'Investidura não permitida: revisão final aprovada não encontrada.'; end if;
  select * into v_snap from public.class_completion_snapshots where id = v_ir.snapshot_id and status = 'selado';
  if not found then raise exception 'Investidura não permitida: o snapshot da conclusão não está selado.'; end if;
  if p_data is null or p_data > current_date then raise exception 'Data de investidura inválida.'; end if;

  -- reconfere AGORA: requisito pendente, bloqueado, dinâmico sem valor, N-de-M incompleto — nada passa
  select count(*) into v_pend from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo where mr.member_class_id = v_mc.id and mr.status <> 'aprovado';
  select coalesce(jsonb_agg(jsonb_build_object('codigo', r.codigo, 'bloqueios', to_jsonb(b))), '[]'::jsonb) into v_bloq
    from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
    cross join lateral public._requisito_bloqueios(mr.id) b where mr.member_class_id = v_mc.id and array_length(b, 1) > 0;
  if v_pend > 0 then raise exception 'Investidura não permitida: % requisito(s) não aprovado(s).', v_pend; end if;
  if jsonb_array_length(v_bloq) > 0 then raise exception 'Investidura não permitida: requisito bloqueado — %', v_bloq::text; end if;

  v_papel := coalesce(public.papel_no_clube(v_uid, v_club), '?');
  insert into public.class_investitures (member_class_id, snapshot_id, usuario_id, club_id, registrado_por, registrado_papel, data_investidura, observacao)
  values (v_mc.id, v_snap.id, v_mc.usuario_id, v_club, v_uid, v_papel, p_data, p_observacao) returning id into v_inv;
  update public.investiture_reviews set status = 'investido' where id = v_ir.id;
  update public.member_classes set status = 'investida', investida_em = p_data::timestamptz, updated_at = now() where id = v_mc.id;  -- gatilho emite a conquista
  update public.curriculum_achievements set snapshot_id = v_snap.id where member_class_id = v_mc.id and tipo = 'classe' and status = 'ativa' and snapshot_id is null;
  perform public._classe_evento(v_mc.id, 'investidura_registrada', v_snap.id, p_observacao, jsonb_build_object('investidura_id', v_inv, 'data', p_data));
  return jsonb_build_object('ok', true, 'status', 'investida', 'investidura_id', v_inv, 'snapshot_id', v_snap.id,
    'conquista_id', (select id from public.curriculum_achievements where member_class_id = v_mc.id and tipo = 'classe' and status = 'ativa'));
end;
$$;
revoke all on function public.investidura_registrar(uuid, date, text) from public, anon;
grant execute on function public.investidura_registrar(uuid, date, text) to authenticated;

-- correção posterior = revogação AUDITADA (nunca UPDATE destrutivo): só a liderança do clube de ORIGEM.
-- Revoga o snapshot; se havia investidura, ela e a conquista portátil também (soft); a matrícula volta a
-- em_andamento pra uma nova conclusão gerar o snapshot N+1. Nada é apagado.
create or replace function public.snapshot_revogar(p_snapshot_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s record; v_inv record; v_ach record;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da revogação.'; end if;
  select * into v_s from public.class_completion_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'Snapshot não encontrado.'; end if;
  if not public.pode_gerir_no_clube(v_s.club_id_origem) then raise exception 'Sem permissão (só a liderança do clube que emitiu este snapshot pode revogar).'; end if;
  if v_s.status = 'revogado' then raise exception 'Este snapshot já está revogado.'; end if;
  update public.class_completion_snapshots set status = 'revogado', revogado_em = now(), revogado_por = v_uid, revogado_motivo = p_motivo where id = v_s.id;
  perform public._classe_evento(v_s.member_class_id, 'snapshot_revogado', v_s.id, p_motivo, null);
  select * into v_inv from public.class_investitures where snapshot_id = v_s.id and status = 'registrada';
  if found then
    update public.class_investitures set status = 'revogada', revogado_em = now(), revogado_por = v_uid, revogado_motivo = p_motivo where id = v_inv.id;
    perform public._classe_evento(v_s.member_class_id, 'investidura_revogada', v_s.id, p_motivo, jsonb_build_object('investidura_id', v_inv.id));
    select * into v_ach from public.curriculum_achievements where member_class_id = v_s.member_class_id and tipo = 'classe' and status = 'ativa';
    if found then
      update public.curriculum_achievements set status = 'revogada', revogada_em = now(), revogada_por = v_uid, revogada_motivo = p_motivo where id = v_ach.id;
      perform public._classe_evento(v_s.member_class_id, 'conquista_revogada', v_s.id, p_motivo, jsonb_build_object('conquista_id', v_ach.id));
    end if;
  end if;
  update public.investiture_reviews set status = 'recusado' where snapshot_id = v_s.id and status in ('pendente', 'aprovado');
  if v_s.member_class_id is not null then
    update public.member_classes set status = 'em_andamento', concluida_em = null, investida_em = null, updated_at = now() where id = v_s.member_class_id;
  end if;
  return json_build_object('ok', true)::jsonb;
end;
$$;
revoke all on function public.snapshot_revogar(uuid, text) from public, anon;
grant execute on function public.snapshot_revogar(uuid, text) to authenticated;

-- integridade: recalcula o hash do conteúdo e compara (quem vê o snapshot pode verificar)
create or replace function public.snapshot_verificar(p_snapshot_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('snapshot_id', s.id, 'versao', s.versao, 'status', s.status, 'hash_registrado', s.hash,
                            'hash_recalculado', public._snapshot_hash(s.conteudo), 'integro', s.hash = public._snapshot_hash(s.conteudo))
  from public.class_completion_snapshots s
  where s.id = p_snapshot_id and (auth.uid() is null or public._pode_ver_conquista_curricular(s.usuario_id, s.club_id_origem));  -- uid nulo = contexto de serviço/SQL (anon não tem EXECUTE)
$$;
revoke all on function public.snapshot_verificar(uuid) from public, anon;
grant execute on function public.snapshot_verificar(uuid) to authenticated;

-- fila da liderança: conclusões do clube em uso em requisitos_concluidos / aguardando_revisao / apto_investidura
create or replace function public.classe_revisoes_pendentes() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'member_class_id', mc.id, 'status', mc.status, 'concluida_em', mc.concluida_em, 'iniciada_em', mc.iniciada_em,
    'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
    'classe_nome', c.nome, 'classe_manifesto_id', c.manifesto_id, 'percentual', public.classe_percentual(mc.id),
    'snapshot', (select json_build_object('id', s.id, 'versao', s.versao, 'hash', s.hash, 'selado_em', s.selado_em, 'status', s.status,
                    'manifesto_versao', s.conteudo -> 'curriculum_version' ->> 'manifesto_versao')
                 from public.class_completion_snapshots s where s.member_class_id = mc.id and s.status = 'selado' order by s.versao desc limit 1),
    'revisao', (select json_build_object('id', ir.id, 'status', ir.status, 'solicitado_em', ir.solicitado_em, 'revisado_em', ir.revisado_em, 'comentario', ir.comentario)
                from public.investiture_reviews ir where ir.member_class_id = mc.id order by ir.solicitado_em desc limit 1),
    'bloqueios', (select coalesce(json_agg(json_build_object('codigo', r.codigo, 'bloqueios', to_json(b))), '[]'::json)
                  from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
                  cross join lateral public._requisito_bloqueios(mr.id) b where mr.member_class_id = mc.id and array_length(b, 1) > 0),
    'ultimo_evento', (select json_build_object('tipo', e.tipo, 'em', e.created_at, 'dados', e.dados) from public.class_completion_events e where e.member_class_id = mc.id order by e.created_at desc limit 1),
    'requisitos', (select coalesce(json_agg(json_build_object('member_requirement_id', mr.id, 'secao', s.codigo, 'codigo', r.codigo, 'descricao', r.descricao, 'status', mr.status,
                      'aprovado_por', (select pp.nome from public.requirement_approvals a join public.profiles pp on pp.id = a.avaliado_por where a.member_requirement_id = mr.id and a.decisao = 'aprovado' order by a.created_at desc limit 1))
                      order by s.ordem, r.ordem, r.codigo), '[]'::json)
                   from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id join public.class_sections s on s.id = r.section_id where mr.member_class_id = mc.id and r.ativo)
  ) order by mc.concluida_em nulls last, mc.updated_at), '[]'::json)
  from public.member_classes mc
  join public.classes c on c.id = mc.class_id
  join public.profiles p on p.id = mc.usuario_id
  where mc.club_id = public.clube_atual_id() and mc.status in ('requisitos_concluidos', 'aguardando_revisao', 'apto_investidura')
    and public.pode_gerir_no_clube(public.clube_atual_id());
$$;
revoke all on function public.classe_revisoes_pendentes() from public, anon;
grant execute on function public.classe_revisoes_pendentes() to authenticated;

-- ---------------------------------------------------------------------
-- F) minha_classe(): 'conclusao' (snapshot/revisão/investidura) no lugar do antigo 'investidura'
-- ---------------------------------------------------------------------
create or replace function public.minha_classe(p_member_class_id uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record;
begin
  if v_uid is null or v_club is null then return null; end if;
  if p_member_class_id is not null then
    select * into v_mc from public.member_classes where id = p_member_class_id and usuario_id = v_uid and club_id = v_club;
  else
    select * into v_mc from public.member_classes
     where usuario_id = v_uid and club_id = v_club
     order by (status = 'em_andamento') desc, iniciada_em desc
     limit 1;
  end if;
  if v_mc.id is null then return null; end if;

  return json_build_object(
    'member_class', json_build_object(
      'id', v_mc.id, 'status', v_mc.status, 'iniciada_em', v_mc.iniciada_em, 'concluida_em', v_mc.concluida_em, 'investida_em', v_mc.investida_em,
      'percentual', public.classe_percentual(v_mc.id)
    ),
    'classe', (select json_build_object('id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
                                        'idade_minima', c.idade_minima, 'manifesto_id', c.manifesto_id, 'vigente_desde', c.vigente_desde,
                                        'fonte_url', c.fonte_url, 'fonte_publicado_em', c.fonte_publicado_em)
               from public.classes c where c.id = v_mc.class_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao,
               'vigente_desde', ver.vigente_desde, 'fonte_hash', ver.fonte_hash, 'importado_em', ver.importado_em)
      from public.classes c join public.curriculum_versions ver on ver.id = c.curriculum_version_id where c.id = v_mc.class_id
    ),
    'conclusao', json_build_object(
      'snapshot', (select json_build_object('id', s.id, 'versao', s.versao, 'hash', s.hash, 'selado_em', s.selado_em, 'status', s.status)
                   from public.class_completion_snapshots s where s.member_class_id = v_mc.id and s.status = 'selado' order by s.versao desc limit 1),
      'revisao', (select json_build_object('status', ir.status, 'solicitado_em', ir.solicitado_em, 'revisado_em', ir.revisado_em, 'comentario', ir.comentario,
                    'revisado_por_nome', (select nome from public.profiles where id = ir.revisado_por), 'revisado_papel', ir.revisado_papel)
                  from public.investiture_reviews ir where ir.member_class_id = v_mc.id order by ir.solicitado_em desc limit 1),
      'investidura', (select json_build_object('data', i.data_investidura, 'registrado_em', i.created_at, 'observacao', i.observacao,
                        'registrado_por_nome', (select nome from public.profiles where id = i.registrado_por), 'status', i.status)
                      from public.class_investitures i where i.member_class_id = v_mc.id order by i.created_at desc limit 1)
    ),
    'secoes', (
      select coalesce(json_agg(json_build_object(
        'id', s.id, 'codigo', s.codigo, 'nome', s.nome, 'ordem', s.ordem,
        'requisitos', (
          select coalesce(json_agg(json_build_object(
            'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao, 'manifesto_id', r.manifesto_id, 'status_fonte', r.status_fonte,
            'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
            'member_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
            'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
            'conteudo_dinamico', (select public.conteudo_dinamico_resolver(d.chave, current_date)
                                  from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
            'escolha', (
              select (public._requisito_escolha_estado(mr.id) || jsonb_build_object(
                'opcoes', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'rotulo', o.rotulo, 'specialty_id', o.specialty_id) order by o.ordem), '[]'::jsonb)
                           from public.requirement_options o where o.grupo_id = g.id)))::json
              from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = r.id and mr.id is not null
            ),
            'bloqueios', case when mr.id is null then '[]'::json else to_json(public._requisito_bloqueios(mr.id)) end,
            'avaliacoes', (
              select coalesce(json_agg(json_build_object(
                'decisao', a.decisao, 'avaliado_por_nome', p.nome, 'avaliado_papel', a.avaliado_papel,
                'comentario', a.comentario, 'created_at', a.created_at
              ) order by a.created_at), '[]'::json)
              from public.requirement_approvals a
              join public.profiles p on p.id = a.avaliado_por
              where mr.id is not null and a.member_requirement_id = mr.id
            )
          ) order by r.ordem, r.codigo), '[]'::json)
          from public.class_requirements r
          left join public.member_requirements mr on mr.requirement_id = r.id and mr.member_class_id = v_mc.id
          where r.section_id = s.id and r.ativo
        )
      ) order by s.ordem), '[]'::json)
      from public.class_sections s where s.class_id = v_mc.class_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------
-- G) requisito_avaliar: a AUDITORIA (requirement_approvals) entra ANTES do status mudar. Achado desta
--    fase: a ordem antiga (status → gatilho de conclusão → snapshot → só então o insert da aprovação)
--    deixava a última aprovação fora do snapshot. Corpo idêntico ao da migration 41 fora a ordem.
-- ---------------------------------------------------------------------
create or replace function public.requisito_avaliar(p_member_requirement_id uuid, p_decisao text, p_comentario text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_papel text; v_bloq text[];
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements where id = p_member_requirement_id and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado neste clube.'; end if;

  if p_decisao = 'aprovado' then
    v_bloq := public._requisito_bloqueios(v_mr.id);
    if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
  end if;

  v_papel := public.papel_no_clube(v_uid, v_club);
  insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario)
  select v_mr.id, v_mr.requirement_id, ver.id, v_club, p_decisao, v_uid, coalesce(v_papel, '?'), p_comentario
  from public.class_requirements r
  join public.class_sections s on s.id = r.section_id
  join public.classes c on c.id = s.class_id
  join public.curriculum_versions ver on ver.id = c.curriculum_version_id
  where r.id = v_mr.requirement_id;

  update public.member_requirements set status = p_decisao, updated_at = now() where id = v_mr.id;  -- gatilho de conclusão roda aqui, já com a aprovação gravada
  return json_build_object('ok', true);
end;
$$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-snapshot-curricular-e-investidura.sql')
on conflict (arquivo) do update set aplicada_em = now();
