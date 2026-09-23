-- =====================================================================
-- Fase 7 — INÍCIO CONTEXTUAL: motor de prioridades declarativo. Rodar DEPOIS da 20260921000049.
-- Idempotente. SOMENTE LEITURA.
--
-- O que esta migration NÃO faz (a fase 7 é reorganização de experiência, não reimplementação):
--   * não cria tabela, não altera tabela, não cria policy, não muda nenhuma RPC de escrita;
--   * não relaxa nenhuma autorização: cada regra só conta o que a PESSOA já poderia ver de qualquer
--     jeito, e tudo passa por membro_ativo_no_clube / pode_gerir_no_clube / recurso habilitado.
--
-- Por que no SERVIDOR e não no cliente:
--   1. a regra de "quem vê o quê" não é duplicada no navegador — ela continua onde sempre esteve;
--   2. o celular faz UMA chamada em vez de oito ao abrir o app.
--
-- O motor é DECLARATIVO, não IA: uma lista fixa de regras, cada uma com peso, texto humano e rota.
-- Ordena por peso e devolve tudo; a tela mostra as 3 primeiras e guarda o resto em "ver mais".
-- =====================================================================

-- Uma linha do Início. `peso` é a prioridade (maior primeiro), `rota` é para onde o toque leva.
create or replace function public._inicio_item(
  p_chave text, p_peso int, p_icone text, p_titulo text, p_descricao text, p_rota text, p_contador int default null
) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('chave', p_chave, 'peso', p_peso, 'icone', p_icone,
                            'titulo', p_titulo, 'descricao', p_descricao, 'rota', p_rota,
                            'contador', p_contador);
$$;
revoke all on function public._inicio_item(text, int, text, text, text, text, int) from public, anon, authenticated;

-- "1 coisa" / "N coisas" sem ficar com texto de robô
create or replace function public._plural(p_n int, p_um text, p_varios text) returns text
language sql immutable set search_path = '' as $$
  select case when p_n = 1 then '1 ' || p_um else p_n::text || ' ' || p_varios end;
$$;
revoke all on function public._plural(int, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- meu_inicio() — o que é mais importante para MIM agora, neste clube
-- ---------------------------------------------------------------------
create or replace function public.meu_inicio() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_gere boolean;
  v_itens jsonb := '[]'::jsonb;
  v_n int;
  v_txt text;
  v_rota text;
  r record;
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then
    return '[]'::json;
  end if;
  v_gere := public.pode_gerir_no_clube(v_club);

  -- ===== peso 100: um requisito de classe voltou para correção =====
  if public.recurso_habilitado_no_clube(v_club, 'classes') then
    select count(*) into v_n
      from public.member_requirements mr
      join public.member_classes mc on mc.id = mr.member_class_id
     where mr.usuario_id = v_uid and mr.club_id = v_club and mr.status = 'correcao_solicitada'
       and mc.status not in ('investida', 'cancelada');
    if v_n > 0 then
      select cl.nome into v_txt
        from public.member_requirements mr
        join public.member_classes mc on mc.id = mr.member_class_id
        join public.classes cl on cl.id = mc.class_id
       where mr.usuario_id = v_uid and mr.club_id = v_club and mr.status = 'correcao_solicitada'
       order by mr.updated_at desc limit 1;
      v_itens := v_itens || public._inicio_item('classe_correcao', 100, '✏️',
        'Seu instrutor pediu uma correção',
        case when v_n = 1 then 'Tem um item da classe ' || coalesce(v_txt, '') || ' para refazer.'
             else v_n::text || ' itens da classe ' || coalesce(v_txt, '') || ' esperam a sua correção.' end,
        '/minha-classe', v_n);
    end if;

    -- ===== peso 40: especialidade com requisito devolvido =====
    select count(*) into v_n
      from public.member_specialty_requirements msr
     where msr.usuario_id = v_uid and msr.club_id = v_club and msr.status = 'correcao_solicitada';
    if v_n > 0 then
      v_itens := v_itens || public._inicio_item('especialidade_correcao', 96, '✏️',
        'Correção em uma especialidade',
        public._plural(v_n, 'item espera', 'itens esperam') || ' a sua correção.',
        '/minhas-especialidades', v_n);
    end if;
  end if;

  -- ===== peso 95: uma etapa de experiência voltou =====
  if public.recurso_habilitado_no_clube(v_club, 'experiencias') then
    select count(*) into v_n
      from public.experience_submissions x
      join public.experience_participations p on p.id = x.participation_id
     where x.club_id = v_club and x.status in ('correcao', 'rejeitada')
       and (p.usuario_id = v_uid or p.unidade_id in (
            select m.unidade_id from public.organization_memberships m
             where m.user_id = v_uid and m.organizational_unit_id = v_club and m.status = 'ativo'));
    if v_n > 0 then
      v_itens := v_itens || public._inicio_item('experiencia_correcao', 95, '🔁',
        'Refaça uma etapa',
        public._plural(v_n, 'etapa de experiência voltou', 'etapas de experiência voltaram') || ' para você.',
        '/experiencias', v_n);
    end if;
  end if;

  -- ===== peso 90 (liderança): envios esperando avaliação =====
  if v_gere then
    v_n := 0;
    if public.recurso_habilitado_no_clube(v_club, 'classes') then
      v_n := v_n
        + (select count(*) from public.member_requirements where club_id = v_club and status = 'aguardando_avaliacao')
        + (select count(*) from public.member_specialty_requirements where club_id = v_club and status = 'aguardando_avaliacao');
    end if;
    if public.recurso_habilitado_no_clube(v_club, 'experiencias') then
      v_n := v_n + (select count(*) from public.experience_submissions where club_id = v_club and status = 'enviada');
    end if;
    if public.recurso_habilitado_no_clube(v_club, 'atividades') then
      v_n := v_n + (select count(*) from public.entregas where club_id = v_club and status = 'pendente');
    end if;
    if public.recurso_habilitado_no_clube(v_club, 'missoes') then
      v_n := v_n + (select count(*) from public.missoes_feitas where club_id = v_club and status = 'pendente');
    end if;
    if v_n > 0 then
      v_itens := v_itens || public._inicio_item('avaliar', 90, '🔎',
        'Tem gente esperando você',
        public._plural(v_n, 'envio espera', 'envios esperam') || ' a sua avaliação.',
        '/gestao/avaliar', v_n);
    end if;

    -- ===== peso 85 (liderança): cadastros a aprovar =====
    select count(*) into v_n from public.organization_memberships
     where organizational_unit_id = v_club and status = 'pendente';
    if v_n > 0 then
      v_itens := v_itens || public._inicio_item('aprovacoes', 85, '👋',
        'Alguém quer entrar no clube',
        public._plural(v_n, 'pessoa aguarda', 'pessoas aguardam') || ' a sua aprovação.',
        '/aprovacoes', v_n);
    end if;
  end if;

  -- ===== peso 80: classe quase pronta (>= 80% dos requisitos aprovados) =====
  if public.recurso_habilitado_no_clube(v_club, 'classes') then
    for r in
      select cl.nome, mc.id,
             count(*) filter (where mr.status = 'aprovado') as ok,
             count(*) as total
        from public.member_classes mc
        join public.classes cl on cl.id = mc.class_id
        join public.member_requirements mr on mr.member_class_id = mc.id
       where mc.usuario_id = v_uid and mc.club_id = v_club and mc.status = 'em_andamento'
       group by cl.nome, mc.id
      having count(*) > 0 and count(*) filter (where mr.status = 'aprovado') * 100 / count(*) between 80 and 99
       order by 3 desc limit 1
    loop
      v_itens := v_itens || public._inicio_item('classe_quase', 80, '🎖️',
        'Falta pouco!',
        'Você já fez ' || (r.ok * 100 / r.total)::text || '% da classe ' || r.nome || '.',
        '/minha-classe', null);
    end loop;

    -- ===== peso 60: requisitos prontos para enviar =====
    select count(*) into v_n
      from public.member_requirements mr
      join public.member_classes mc on mc.id = mr.member_class_id and mc.status = 'em_andamento'
     where mr.usuario_id = v_uid and mr.club_id = v_club and mr.status = 'em_andamento'
       and (coalesce(mr.evidencia_texto, '') <> '' or mr.evidencia_path is not null);
    if v_n > 0 then
      v_itens := v_itens || public._inicio_item('requisitos_prontos', 60, '📤',
        'Pronto para enviar',
        public._plural(v_n, 'item da sua classe está pronto', 'itens da sua classe estão prontos') || ' para enviar.',
        '/minha-classe', v_n);
    end if;

    -- ===== peso 40: especialidade em andamento =====
    select sp.nome into v_txt
      from public.member_specialties ms
      join public.specialties sp on sp.id = ms.specialty_id
     where ms.usuario_id = v_uid and ms.club_id = v_club and ms.status = 'em_andamento'
     order by ms.updated_at desc limit 1;
    if v_txt is not null then
      v_itens := v_itens || public._inicio_item('especialidade', 40, '🏅',
        'Continue de onde parou', 'Você está fazendo a especialidade ' || v_txt || '.',
        '/minhas-especialidades', null);
    end if;
  end if;

  -- ===== peso 70: experiência terminando em até 3 dias =====
  if public.recurso_habilitado_no_clube(v_club, 'experiencias') then
    for r in
      select e.titulo, e.fim
        from public.experiences e
        join public.experience_participations p on p.experience_id = e.id and p.status = 'em_andamento'
       where e.club_id = v_club and e.status = 'publicada' and e.fim is not null
         and e.fim > now() and e.fim <= now() + interval '3 days'
         and (p.usuario_id = v_uid or p.unidade_id in (
              select m.unidade_id from public.organization_memberships m
               where m.user_id = v_uid and m.organizational_unit_id = v_club and m.status = 'ativo'))
       order by e.fim limit 1
    loop
      v_n := greatest(1, extract(day from r.fim - now())::int);
      v_itens := v_itens || public._inicio_item('experiencia_acabando', 70, '⏳',
        'Está acabando',
        r.titulo || ' termina em ' || public._plural(v_n, 'dia', 'dias') || '.',
        '/experiencias', null);
    end loop;
  end if;

  -- ===== peso 50: evento nos próximos 7 dias =====
  if public.recurso_habilitado_no_clube(v_club, 'agenda') then
    for r in
      select titulo, data from public.eventos
       where club_id = v_club and data >= current_date and data <= current_date + 7
       order by data limit 1
    loop
      v_itens := v_itens || public._inicio_item('evento', 50, '📅',
        'Vem aí',
        r.titulo || ' — ' || to_char(r.data, 'DD/MM') || '.',
        '/agenda', null);
    end loop;
  end if;

  -- ===== peso 30: conquista recente (últimos 7 dias) =====
  if public.recurso_habilitado_no_clube(v_club, 'experiencias') then
    select count(*) into v_n from public.member_badges
     where club_id = v_club and usuario_id = v_uid and concedida_em > now() - interval '7 days';
    if v_n > 0 then
      v_itens := v_itens || public._inicio_item('conquista', 30, '🎉',
        'Você conquistou!',
        public._plural(v_n, 'conquista nova', 'conquistas novas') || ' nos últimos dias.',
        '/experiencias', v_n);
    end if;
  end if;
  if public.recurso_habilitado_no_clube(v_club, 'classes') then
    select count(*) into v_n from public.class_investitures
     where club_id = v_club and usuario_id = v_uid and status = 'registrada'
       and data_investidura > (current_date - 30);
    if v_n > 0 then
      v_itens := v_itens || public._inicio_item('investidura', 32, '🏆',
        'Parabéns pela investidura!', 'Sua classe foi investida. O documento já pode ser emitido.',
        '/minha-classe', null);
    end if;
  end if;

  return coalesce((select json_agg(x order by (x ->> 'peso')::int desc)
                   from jsonb_array_elements(v_itens) x), '[]'::json);
end;
$$;
revoke all on function public.meu_inicio() from public, anon;
grant execute on function public.meu_inicio() to authenticated;

-- ---------------------------------------------------------------------
-- avaliacoes_pendentes() — a FILA ÚNICA da liderança, só contagens
-- ---------------------------------------------------------------------
-- A auditoria achou 3 entradas separadas de avaliação espalhadas entre 21 cards de Gestão
-- (classes, especialidades, experiências) mais entregas e missões. Isto devolve as 5 contagens de
-- uma vez para a tela "Avaliar" mostrar tudo num lugar só. Somente leitura, sem policy nova: cada
-- contagem respeita o recurso ligado e só existe para quem gere o clube.
create or replace function public.avaliacoes_pendentes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas a liderança do clube).';
  end if;
  return jsonb_build_object(
    'classes', case when public.recurso_habilitado_no_clube(v_club, 'classes')
      then (select count(*) from public.member_requirements where club_id = v_club and status = 'aguardando_avaliacao') end,
    'especialidades', case when public.recurso_habilitado_no_clube(v_club, 'classes')
      then (select count(*) from public.member_specialty_requirements where club_id = v_club and status = 'aguardando_avaliacao') end,
    'investiduras', case when public.recurso_habilitado_no_clube(v_club, 'classes')
      then (select count(*) from public.member_classes where club_id = v_club and status in ('requisitos_concluidos', 'aguardando_revisao', 'apto_investidura')) end,
    'experiencias', case when public.recurso_habilitado_no_clube(v_club, 'experiencias')
      then (select count(*) from public.experience_submissions where club_id = v_club and status = 'enviada') end,
    'atividades', case when public.recurso_habilitado_no_clube(v_club, 'atividades')
      then (select count(*) from public.entregas where club_id = v_club and status = 'pendente') end,
    'missoes', case when public.recurso_habilitado_no_clube(v_club, 'missoes')
      then (select count(*) from public.missoes_feitas where club_id = v_club and status = 'pendente') end,
    'cadastros', (select count(*) from public.organization_memberships where organizational_unit_id = v_club and status = 'pendente'));
end;
$$;
revoke all on function public.avaliacoes_pendentes() from public, anon;
grant execute on function public.avaliacoes_pendentes() to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-inicio-contextual.sql')
on conflict (arquivo) do update set aplicada_em = now();
