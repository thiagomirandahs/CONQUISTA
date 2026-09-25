-- =============================================================================
--  Etapa 2 do pedido pós-migração: jornada pedagógica de entrega/correção/reenvio de requisitos
--  de Classe, SEM assinatura nenhuma aqui (isso é Etapa 3/4, sobre o dossiê final — nunca por
--  requisito). Reaproveita tudo que já existia (member_requirements, requirement_approvals,
--  requisito_salvar/enviar/avaliar, classe_avaliacoes_pendentes) — não redesenha, evolui.
--
--  DECISÃO DE ESTADOS (item 2.3 do pedido): NÃO criamos "enviado"/"em avaliação"/"reenviado" como
--  estados persistidos novos em member_requirements.status. O CHECK continua exatamente com os 5
--  estados de sempre (nao_iniciado, em_andamento, aguardando_avaliacao, aprovado,
--  correcao_solicitada). Motivo: os três estados extras pedidos são 100% deriváveis de
--  `status atual + quantidade de requirement_submissions + última submissão + última decisão`, e
--  guardá-los à parte criaria uma segunda fonte de verdade que pode dessincronizar do histórico
--  real (exatamente o tipo de bug que os testes 56/61 foram desenhados pra pegar). "Enviado" é
--  "há uma submissão sem decisão ainda"; "em avaliação" é sinônimo do status aguardando_avaliacao
--  já existente; "reenviado" é "há mais de uma submissão". Tudo isso a view/RPC calcula, nunca
--  grava. Estado mínimo + histórico imutável, como pedido.
-- =============================================================================

-- ==================== 1) requirement_submissions — append-only, uma linha por tentativa ====================
-- usuario_id/club_id/requirement_id são DERIVADOS do member_requirement_id pai por gatilho —
-- NUNCA aceitos do cliente, mesmo padrão de definir_escopo_progresso (migration 37).
--
-- member_requirement_id/usuario_id são NULLABLE com "on delete set null" de propósito — mesmo
-- padrão já usado em class_completion_snapshots (migration 44): excluir o desbravador não pode
-- apagar a trilha de auditoria de quem avaliou o quê; a submissão fica órfã/anonimizada, nunca
-- some (teste 63_defeitos_do_pre_voo.sql já cobre exatamente esse comportamento para o avaliador,
-- e o mesmo princípio vale pro autor da evidência).
create table if not exists public.requirement_submissions (
  id uuid primary key default gen_random_uuid(),
  member_requirement_id uuid references public.member_requirements(id) on delete set null,
  requirement_id uuid not null references public.class_requirements(id),
  usuario_id uuid references public.profiles(id) on delete set null,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  tentativa_numero integer not null,
  tipo_evidencia_entregue text not null check (tipo_evidencia_entregue in ('nenhuma', 'texto', 'foto', 'arquivo')),
  evidencia_texto text,
  evidencia_path text,
  enviado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (member_requirement_id, tentativa_numero)
);
create index if not exists idx_requirement_submissions_mr on public.requirement_submissions(member_requirement_id, tentativa_numero desc);
create index if not exists idx_requirement_submissions_club on public.requirement_submissions(club_id);
create index if not exists idx_requirement_submissions_usuario on public.requirement_submissions(usuario_id, club_id);

create or replace function public._definir_escopo_submissao() returns trigger
language plpgsql as $$
declare v_mr record;
begin
  select member_class_id, requirement_id, usuario_id, club_id into v_mr
  from public.member_requirements where id = new.member_requirement_id;
  if not found then raise exception 'Requisito de membro inexistente.'; end if;
  new.requirement_id := v_mr.requirement_id;
  new.usuario_id := v_mr.usuario_id;
  new.club_id := v_mr.club_id;
  return new;
end;
$$;
drop trigger if exists trg_definir_escopo_submissao on public.requirement_submissions;
create trigger trg_definir_escopo_submissao before insert on public.requirement_submissions
  for each row execute function public._definir_escopo_submissao();

-- Reaproveita o gatilho genérico já testado (_proteger_registro_imutavel, migration 44) em vez de
-- inventar um novo: ele já sabe permitir uma coluna "%_id" virar NULL (é exatamente o "on delete
-- set null" acima, quando o perfil do autor é excluído) e bloquear qualquer outra mudança, incluindo
-- DELETE direto — "append-only" de verdade, sem exceção nem para quem roda SQL como dono.
drop trigger if exists trg_submissao_imutavel on public.requirement_submissions;
create trigger trg_submissao_imutavel before update or delete on public.requirement_submissions
  for each row execute function public._proteger_registro_imutavel();

alter table public.requirement_submissions enable row level security;

drop policy if exists "dono ou lideranca do clube le submissoes" on public.requirement_submissions;
create policy "dono ou lideranca do clube le submissoes" on public.requirement_submissions for select to authenticated
using (
  club_id = public.clube_atual_id()
  and (usuario_id = auth.uid() or public.pode_gerir_no_clube(club_id))
);
-- insert só pela RPC requisito_enviar (security definer) — nenhum insert direto do cliente.
revoke all on public.requirement_submissions from public, anon, authenticated;
grant select on public.requirement_submissions to authenticated;

-- ==================== 2) requirement_approvals ganha submission_id — qual tentativa foi decidida ====================
-- Nullable por compatibilidade com decisões históricas anteriores a esta migration (não tinham
-- submissão vinculada); toda decisão NOVA passa a exigir. O unique garante a trava de concorrência
-- do item 2.9: duas decisões não podem existir pra mesma tentativa — a segunda simplesmente falha
-- na constraint, e a RPC traduz isso numa mensagem clara, não num erro de banco cru.
alter table public.requirement_approvals add column if not exists submission_id uuid references public.requirement_submissions(id);
create unique index if not exists idx_requirement_approvals_submission_unica on public.requirement_approvals(submission_id) where submission_id is not null;

-- ==================== 3) requisito_enviar passa a criar uma submissão imutável ====================
-- requisito_salvar continua EXATAMENTE como era: rascunho em member_requirements.evidencia_texto/
-- evidencia_path, antes de enviar. Isso não muda — é trabalho em andamento, não uma tentativa.
-- A mudança é só em requisito_enviar: em vez de só marcar status, ele CONGELA o rascunho atual como
-- uma linha nova de requirement_submissions (a tentativa), preservando qualquer uma anterior.
-- Reescrita SOBRE a versão mais recente (migration 86, não a original 36): preserva
-- _exigir_classes_habilitado, _classe_do_catalogo_oficial, _requisito_bloqueios e
-- _fixar_conteudo_do_requisito exatamente como estavam — só acrescenta a submissão imutável.
create or replace function public.requisito_enviar(p_requirement_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
  v_mr record; v_req record; v_bloq text[]; v_tipo text; v_prox_tentativa int; v_submission_id uuid;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  select * into v_req from public.class_requirements where id = p_requirement_id;
  if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
    raise exception 'Este requisito exige uma evidência antes de enviar.';
  end if;
  v_bloq := public._requisito_bloqueios(v_mr.id);
  if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
  -- o conteúdo do ano em que a criança ENVIOU passa a ser o do requisito (correção e reenvio não trocam)
  perform public._fixar_conteudo_do_requisito(v_mr.id, 'envio');

  -- NOVO nesta etapa: congela o rascunho atual como uma tentativa imutável, preservando qualquer
  -- tentativa anterior (correção/reenvio nunca mais sobrescreve o que foi entregue antes).
  v_tipo := case
    when v_mr.evidencia_path is not null and v_req.tipo_evidencia = 'arquivo' then 'arquivo'
    when v_mr.evidencia_path is not null then 'foto'
    when coalesce(trim(v_mr.evidencia_texto), '') <> '' then 'texto'
    else 'nenhuma'
  end;
  select coalesce(max(tentativa_numero), 0) + 1 into v_prox_tentativa
  from public.requirement_submissions where member_requirement_id = v_mr.id;
  insert into public.requirement_submissions
    (member_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path)
  values (v_mr.id, v_prox_tentativa, v_tipo, v_mr.evidencia_texto, v_mr.evidencia_path)
  returning id into v_submission_id;

  update public.member_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true, 'submission_id', v_submission_id, 'tentativa_numero', v_prox_tentativa);
end;
$$;
revoke all on function public.requisito_enviar(uuid) from public, anon;
grant execute on function public.requisito_enviar(uuid) to authenticated;

-- ==================== 4) requisito_avaliar ganha a trava de concorrência (item 2.9) ====================
-- p_submission_id é NOVO, opcional, por último — chamadas antigas (3 argumentos posicionais,
-- exatamente como todo o resto do repo e da suíte já chama) continuam funcionando IDÊNTICAS: quando
-- omitido, resolve sozinho pra tentativa mais recente pendente (o comportamento de sempre). É o
-- front NOVO que passa o submission_id explícito que ele acabou de ver na fila — só aí a trava fica
-- de fato ativa: A e B abrem a Tentativa 2; A aprova; B tenta corrigir a MESMA tentativa 2 → a
-- segunda chamada encontra p_submission_id já decidido (ou não é mais a mais recente) e é recusada
-- com mensagem clara, nunca com erro cru de constraint.
-- Reescrita SOBRE a versão mais recente (migration 86): preserva _exigir_classes_habilitado,
-- _classe_do_catalogo_oficial, _requisito_bloqueios, _fixar_conteudo_do_requisito e
-- conteudo_avaliado exatamente como estavam. NÃO adiciona um bloqueio genérico de "já aprovado" —
-- esse guard não existia antes e reavaliar um requisito aprovado é um caso legítimo já usado por
-- outras rotinas (reprocessamento de conclusão); a trava de concorrência é só sobre a TENTATIVA
-- (submission_id), não sobre o requisito como um todo.
create or replace function public.requisito_avaliar(p_member_requirement_id uuid, p_decisao text, p_comentario text default null, p_submission_id uuid default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_papel text; v_bloq text[]; v_conteudo jsonb; v_sub_id uuid;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if p_decisao = 'correcao_solicitada' and coalesce(trim(p_comentario), '') = '' then
    raise exception 'Explique o que precisa ser corrigido.';
  end if;
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements where id = p_member_requirement_id and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado neste clube.';
  end if;

  -- trava de concorrência (item 2.9): só entra em jogo quando o front passa a tentativa que viu.
  select id into v_sub_id from public.requirement_submissions
   where member_requirement_id = p_member_requirement_id order by tentativa_numero desc limit 1
   for update;
  if p_submission_id is not null then
    if v_sub_id is null or p_submission_id <> v_sub_id then
      raise exception 'Esta não é mais a tentativa mais recente — o membro já reenviou, ou a tentativa não existe. Recarregue a fila.';
    end if;
  end if;
  v_sub_id := coalesce(p_submission_id, v_sub_id);
  if v_sub_id is not null and exists (select 1 from public.requirement_approvals where submission_id = v_sub_id) then
    raise exception 'Esta tentativa já foi avaliada por outra pessoa — recarregue a fila.';
  end if;

  if p_decisao = 'aprovado' then
    v_bloq := public._requisito_bloqueios(v_mr.id);
    if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
    perform public._fixar_conteudo_do_requisito(v_mr.id, 'aprovacao');
  end if;
  select conteudo_fixado into v_conteudo from public.member_requirements where id = v_mr.id;

  v_papel := public.papel_no_clube(v_uid, v_club);
  begin
    insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario, conteudo_avaliado, submission_id)
    select v_mr.id, v_mr.requirement_id, ver.id, v_club, p_decisao, v_uid, coalesce(v_papel, '?'), p_comentario, v_conteudo, v_sub_id
    from public.class_requirements r
    join public.class_sections s on s.id = r.section_id
    join public.classes c on c.id = s.class_id
    join public.curriculum_versions ver on ver.id = c.curriculum_version_id
    where r.id = v_mr.requirement_id;
  exception when unique_violation then
    raise exception 'Esta tentativa já foi avaliada por outra pessoa — recarregue a fila.';
  end;

  update public.member_requirements set status = p_decisao, updated_at = now() where id = v_mr.id;  -- gatilho de conclusão roda aqui, já com a aprovação gravada
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.requisito_avaliar(uuid, text, text, uuid) from public, anon;
grant execute on function public.requisito_avaliar(uuid, text, text, uuid) to authenticated;
-- Postgres trata (uuid,text,text) e (uuid,text,text,uuid default) como OVERLOADS DIFERENTES, não
-- como "o mesmo replace" — sem este drop, uma chamada com exatamente 3 argumentos ficaria ambígua
-- entre as duas. Só pode existir uma versão.
drop function if exists public.requisito_avaliar(uuid, text, text);

-- ==================== 5) histórico completo de um requisito — o que a tela "Ver histórico" usa ====================
-- Por member_requirement_id (não requirement_id): requirement_id sozinho NÃO é único por clube —
-- duas pessoas do mesmo clube têm o mesmo requirement_id, cada uma com seu próprio
-- member_requirement_id. Um parâmetro por requirement_id ficaria ambíguo assim que a liderança
-- (que não filtra por usuario_id = si mesma) tentasse ver o histórico de uma pessoa específica —
-- acharia "a primeira linha que bater", não necessariamente a certa. member_requirement_id já é
-- único (mesmo padrão de requisito_avaliar/classe_avaliacoes_pendentes). Dono ou liderança do
-- clube; nunca vaza entre clubes (club_id = clube_atual_id() sempre).
create or replace function public.requisito_historico(p_member_requirement_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  select * into v_mr from public.member_requirements
   where id = p_member_requirement_id and club_id = v_club
     and (usuario_id = v_uid or public.pode_gerir_no_clube(v_club));
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;

  return json_build_object(
    'requirement_id', v_mr.requirement_id,
    'status_atual', v_mr.status,
    'tentativas', (
      select coalesce(json_agg(json_build_object(
        'submission_id', sub.id,
        'tentativa_numero', sub.tentativa_numero,
        'tipo_evidencia', sub.tipo_evidencia_entregue,
        'evidencia_texto', sub.evidencia_texto,
        'evidencia_path', sub.evidencia_path,
        'enviado_em', sub.enviado_em,
        'decisao', ap.decisao,
        'avaliado_por_nome', av.nome,
        'avaliado_papel', ap.avaliado_papel,
        'comentario', ap.comentario,
        'avaliado_em', ap.created_at
      ) order by sub.tentativa_numero), '[]'::json)
      from public.requirement_submissions sub
      left join public.requirement_approvals ap on ap.submission_id = sub.id
      left join public.profiles av on av.id = ap.avaliado_por
      where sub.member_requirement_id = v_mr.id
    )
  );
end;
$$;
revoke all on function public.requisito_historico(uuid) from public, anon;
grant execute on function public.requisito_historico(uuid) to authenticated;

-- ==================== 6) classe_avaliacoes_pendentes ganha submission_id/tentativa/unidade ====================
-- Reescrita SOBRE a versão mais recente (migration 86) — preserva _exigir_classes_habilitado,
-- _classe_do_catalogo_oficial, _requisito_escolha_estado, _conteudo_do_requisito, _requisito_bloqueios
-- e o "retorna [] em vez de lançar erro quando não há clube/permissão" que essa versão já tinha.
-- Sem o submission_id a tela de avaliar não teria como chamar requisito_avaliar com a trava de
-- concorrência (item 2.9).
create or replace function public.classe_avaliacoes_pendentes() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then return '[]'::json; end if;
  perform public._exigir_classes_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'member_requirement_id', mr.id,
      'submission_id', sub.id,
      'tentativa_numero', sub.tentativa_numero,
      'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
      'classe_nome', c.nome, 'secao_nome', s.nome,
      'requisito_id', r.id, 'requisito_codigo', r.codigo, 'requisito_descricao', r.descricao,
      'tipo_evidencia', coalesce(sub.tipo_evidencia_entregue, r.tipo_evidencia),
      'evidencia_texto', coalesce(sub.evidencia_texto, mr.evidencia_texto),
      'evidencia_path', coalesce(sub.evidencia_path, mr.evidencia_path),
      'enviado_em', mr.enviado_em,
      'escolha', public._requisito_escolha_estado(mr.id),
      'conteudo_dinamico', (select public._conteudo_do_requisito(mr.id, d.chave) from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
      'bloqueios', to_json(public._requisito_bloqueios(mr.id)),
      'unidade_nome', u.nome
    ) order by mr.enviado_em)
    from public.member_requirements mr
    join public.member_classes mc on mc.id = mr.member_class_id
    join public.class_requirements r on r.id = mr.requirement_id
    join public.class_sections s on s.id = r.section_id
    join public.classes c on c.id = s.class_id
    join public.profiles p on p.id = mr.usuario_id
    left join lateral (
      select * from public.requirement_submissions s2
       where s2.member_requirement_id = mr.id order by s2.tentativa_numero desc limit 1
    ) sub on true
    left join public.organization_memberships om on om.user_id = mr.usuario_id and om.organizational_unit_id = mr.club_id and om.status = 'ativo'
    left join public.unidades u on u.id = om.unidade_id
    where mr.club_id = v_club and mr.status = 'aguardando_avaliacao'
      and public._classe_do_catalogo_oficial(mc.class_id)
  ), '[]'::json);
end;
$$;
revoke all on function public.classe_avaliacoes_pendentes() from public, anon;
grant execute on function public.classe_avaliacoes_pendentes() to authenticated;

-- ==================== 7) fila unificada — Classes + Especialidades, formato de linha comum ====================
-- Escopo desta etapa: Classes e Especialidades (as duas já têm o mesmo desenho de
-- nao_iniciado/.../correcao_solicitada). Experiências/Atividades/Missões continuam com telas
-- próprias por ora — unificá-las exigiria antes dar a elas o mesmo conceito de "tentativa", que
-- não é o pedido desta etapa (evitar "implementar de forma genérica ou fictícia", regra 2.4).
create or replace function public.fila_avaliacao_unificada(p_tipo text default null, p_unidade_id uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_classes_ok boolean := true; v_especialidades_ok boolean := true;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  -- os dois recursos são opt-in por clube; uma fila unificada não pode listar o que o clube não
  -- tem ligado (mesma regra que classe_avaliacoes_pendentes/especialidade_avaliacoes_pendentes já
  -- aplicam cada uma na sua tela própria) — aqui só filtra em vez de lançar erro, pra um recurso
  -- desligado não derrubar a fila inteira.
  begin perform public._exigir_classes_habilitado(v_club); exception when others then v_classes_ok := false; end;
  begin perform public._exigir_especialidades_habilitado(v_club); exception when others then v_especialidades_ok := false; end;

  return coalesce((
    select json_agg(x order by x->>'enviado_em')
    from (
      select json_build_object(
        'tipo', 'classe',
        'item_id', mr.id,
        'submission_id', sub.id,
        'tentativa_numero', sub.tentativa_numero,
        'usuario_id', p.id, 'usuario_nome', p.nome,
        'titulo', c.nome, 'subtitulo', r.descricao,
        'tipo_evidencia', coalesce(sub.tipo_evidencia_entregue, r.tipo_evidencia),
        'enviado_em', mr.enviado_em,
        'unidade_id', u.id, 'unidade_nome', u.nome
      ) as x
      from public.member_requirements mr
      join public.member_classes mc on mc.id = mr.member_class_id
      join public.class_requirements r on r.id = mr.requirement_id
      join public.class_sections s on s.id = r.section_id
      join public.classes c on c.id = s.class_id
      join public.profiles p on p.id = mr.usuario_id
      left join lateral (
        select * from public.requirement_submissions s2
         where s2.member_requirement_id = mr.id order by s2.tentativa_numero desc limit 1
      ) sub on true
      left join public.organization_memberships om on om.user_id = mr.usuario_id and om.organizational_unit_id = mr.club_id and om.status = 'ativo'
      left join public.unidades u on u.id = om.unidade_id
      where v_classes_ok and mr.club_id = v_club and mr.status = 'aguardando_avaliacao'
        and public._classe_do_catalogo_oficial(mc.class_id)
        and (p_tipo is null or p_tipo = 'classe')
        and (p_unidade_id is null or u.id = p_unidade_id)

      union all

      select json_build_object(
        'tipo', 'especialidade',
        'item_id', msr.id,
        'submission_id', null,
        'tentativa_numero', 1,
        'usuario_id', p.id, 'usuario_nome', p.nome,
        'titulo', sp.nome, 'subtitulo', sr.descricao,
        'tipo_evidencia', case when msr.evidencia_path is not null then 'foto' when coalesce(trim(msr.evidencia_texto),'')<>'' then 'texto' else 'nenhuma' end,
        'enviado_em', msr.enviado_em,
        'unidade_id', u.id, 'unidade_nome', u.nome
      ) as x
      from public.member_specialty_requirements msr
      join public.specialty_requirements sr on sr.id = msr.specialty_requirement_id
      join public.member_specialties ms on ms.id = msr.member_specialty_id
      join public.specialties sp on sp.id = ms.specialty_id
      join public.profiles p on p.id = msr.usuario_id
      left join public.organization_memberships om on om.user_id = msr.usuario_id and om.organizational_unit_id = msr.club_id and om.status = 'ativo'
      left join public.unidades u on u.id = om.unidade_id
      where v_especialidades_ok and msr.club_id = v_club and msr.status = 'aguardando_avaliacao'
        and public._especialidade_do_catalogo_oficial(sp.id)
        and public._pode_avaliar_especialidade(msr.member_specialty_id, v_club)
        and (p_tipo is null or p_tipo = 'especialidade')
        and (p_unidade_id is null or u.id = p_unidade_id)
    ) t
  ), '[]'::json);
end;
$$;
revoke all on function public.fila_avaliacao_unificada(text, uuid) from public, anon;
grant execute on function public.fila_avaliacao_unificada(text, uuid) to authenticated;

-- ==================== 8) Storage: caminho novo com club_id, sem migrar arquivos antigos ====================
-- Formato novo (só para uploads NOVOS, a partir de agora): <club_id>/<usuario_id>/requisitos/
-- <member_requirement_id>/<submission_id>/arquivo.<ext> — o club_id entra no PRÓPRIO caminho desta
-- vez (defesa em profundidade: mesmo se algum dia alguém esquecer de checar lideranca_ve_comprovacao
-- pelos dados, o upload em si já exige bater com o clube em uso). Formato antigo
-- (<usuario_id>/requisitos/<timestamp>.jpg) continua funcionando para leitura — nada é migrado.
-- lideranca_ve_comprovacao() não muda (já pergunta aos DADOS, não ao caminho — funciona para os
-- dois formatos automaticamente). Só as policies de "é o meu próprio arquivo" precisam reconhecer
-- os dois formatos.
drop policy if exists "comprovacao dono ou lideranca le" on storage.objects;
create policy "comprovacao dono ou lideranca le" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprovacoes'
    and (
      -- formato antigo: <usuario_id>/...
      (storage.foldername(name))[1] = auth.uid()::text
      -- formato novo: <club_id>/<usuario_id>/... — dono, no clube certo
      or ((storage.foldername(name))[2] = auth.uid()::text
          and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
          and (storage.foldername(name))[1]::uuid = public.clube_atual_id())
      -- liderança do clube DONO da evidência, por qualquer formato (pergunta aos dados)
      or public.lideranca_ve_comprovacao(name)
    )
  );

drop policy if exists "comprovacao dono envia" on storage.objects;
create policy "comprovacao dono envia" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprovacoes'
    and (
      -- formato antigo continua aceito (compatibilidade com qualquer código ainda não atualizado)
      (storage.foldername(name))[1] = auth.uid()::text
      -- formato novo: exige o clube em uso bater com o primeiro segmento do caminho
      or ((storage.foldername(name))[2] = auth.uid()::text
          and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
          and (storage.foldername(name))[1]::uuid = public.clube_atual_id())
    )
  );
