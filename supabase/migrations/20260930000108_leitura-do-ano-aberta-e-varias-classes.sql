-- =============================================================================
--  108 — Curso de Leitura do ano NÃO trava + listar as várias classes da pessoa
--
--  1) Decisão do dono do produto: o livro do Curso de Leitura muda todo ano e nem sempre está
--     cadastrado a tempo. Sem valor do ano em dynamic_content_values, o requisito anual_dinamico
--     deixa de ser BLOQUEADO: a criança escreve o nome do livro e o resumo (evidência de texto
--     obrigatória, que já era exigida) e segue para envio, aprovação e conclusão normalmente.
--     Com valor cadastrado nada muda: a tela mostra o livro e o valor é FIXADO no envio/aprovação
--     (_fixar_conteudo_do_requisito já não fixa nada quando não há valor).
--     _requisito_bloqueios é a ÚNICA fonte do bloqueio (usada por requisito_enviar,
--     requisito_avaliar, classe_revisao_solicitar, investidura_registrar, explicar e as filas),
--     então só ela muda — o resto da função fica idêntico à migration 86.
--
--  2) minhas_classes(): as matrículas (não canceladas) da PRÓPRIA pessoa no clube em uso, com
--     nome e percentual, para a tela alternar entre várias classes ao mesmo tempo.
-- =============================================================================

create or replace function public._requisito_bloqueios(p_member_requirement_id uuid)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_mr record; v_out text[] := '{}'; v_dep text[]; v_esc jsonb;
begin
  select * into v_mr from public.member_requirements where id = p_member_requirement_id;
  if not found then return v_out; end if;

  v_dep := public.dependencias_pendentes('class_requirement', v_mr.requirement_id, v_mr.usuario_id, v_mr.club_id);
  if coalesce(array_length(v_dep, 1), 0) > 0 then
    v_out := array_append(v_out, 'Falta concluir antes: ' || array_to_string(v_dep, ', ') || '.');
  end if;

  -- conteúdo anual (Curso de Leitura): NÃO bloqueia mais (migration 108). Sem o valor do ano, a
  -- pessoa informa o livro na própria evidência de texto; com valor, ele é mostrado e fixado.

  v_esc := public._requisito_escolha_estado(p_member_requirement_id);
  if v_esc is not null then
    if jsonb_array_length(v_esc -> 'violacoes_sem_repeticao') > 0 then
      v_out := array_append(v_out, 'Não vale repetir especialidade já realizada antes desta classe: '
        || (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(v_esc -> 'violacoes_sem_repeticao') x) || '.');
    end if;
    if not (v_esc ->> 'satisfeito')::boolean then
      v_out := array_append(v_out, format('Escolha pelo menos %s %s (%s de %s até agora).',
        v_esc ->> 'n_minimo',
        case when (v_esc ->> 'total_opcoes')::int > 0 then 'das ' || (v_esc ->> 'total_opcoes') || ' opções' else 'e informe qual foi' end,
        v_esc ->> 'validas', v_esc ->> 'n_minimo'));
    end if;
  end if;
  return v_out;
end;
$$;
revoke all on function public._requisito_bloqueios(uuid) from public, anon, authenticated;

-- As classes da própria pessoa no clube em uso (em andamento primeiro, depois as outras), para as abas
-- de Minha Classe. Mesmo filtro de minha_classe(): só catálogo oficial, sem 'cancelada'.
create or replace function public.minhas_classes()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null then return '[]'::json; end if;
  perform public._exigir_classes_habilitado(v_club);
  return (
    select coalesce(json_agg(json_build_object(
      'member_class_id', mc.id, 'class_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'status', mc.status,
      'iniciada_em', mc.iniciada_em, 'concluida_em', mc.concluida_em, 'percentual', public.classe_percentual(mc.id)
    ) order by (mc.status = 'em_andamento') desc, c.ordem, c.nome, mc.iniciada_em), '[]'::json)
    from public.member_classes mc
    join public.classes c on c.id = mc.class_id
    where mc.usuario_id = v_uid and mc.club_id = v_club and mc.status <> 'cancelada'
      and public._classe_do_catalogo_oficial(mc.class_id)
  );
end;
$$;
revoke all on function public.minhas_classes() from public, anon;
grant execute on function public.minhas_classes() to authenticated;

notify pgrst, 'reload schema';
