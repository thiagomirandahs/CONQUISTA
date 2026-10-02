-- =============================================================================
--  536 — AVISO INSTITUCIONAL: coordenação -> liderança dos clubes da área; plataforma -> todos os clubes
--
--  Pedido do dono (02/10/2026): "aviso geral, tipo aviso do distrital, regional, departamental".
--  Até aqui só a diretoria do PRÓPRIO clube avisava (tela Avisos). Agora:
--    * COORDENAÇÃO (distrital, regional, campo, união, divisão…): envia para a LIDERANÇA de todos os clubes DA SUA ÁREA
--      (os mesmos clubes que o painel do coordenador já mostra: _clubes_descendentes do escopo em uso). Só liderança:
--      nunca para criança/membro comum (decisão conservadora; ampliar é outra decisão).
--    * PLATAFORMA (administrador): envia para a liderança OU para todos os membros de TODOS os clubes ativos.
--  Nada de tabela nova: reaproveita `notificacoes` (um aviso por clube, com o clube explícito — o gatilho respeita
--  rotina do banco; o push sai pelo caminho existente, um evento por clube) e `auditoria_operacoes` (quem enviou,
--  quantos clubes, destino; também é o contador do limite diário). Aditiva: não altera função existente.
--
--  SEGURANÇA: security definer + search_path ''; só authenticated executa (anon/public não); a coordenação só alcança
--  clubes DESCENDENTES do escopo que ela mesma tem vínculo ativo COM permissão de painel (header forjado é ignorado
--  por escopo_atual_id); admin só com eh_admin_plataforma; texto sem caracteres de controle e com tamanho limitado;
--  limite de 5 envios/dia por pessoa (10 para a plataforma); nada vaza dado de criança (é só o texto do aviso).
-- =============================================================================

create or replace function public.aviso_institucional_enviar(
  p_titulo text, p_corpo text default null, p_destino text default 'lideranca', p_plataforma boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_dest text := coalesce(nullif(btrim(p_destino), ''), 'lideranca');
  v_tit text; v_cor text; v_esc uuid; v_origem text; v_clubes uuid[]; v_c uuid;
  v_ok int := 0; v_falha int := 0; v_limite int; v_hoje int;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  if v_dest not in ('lideranca', 'todos') then raise exception 'Destino inválido.'; end if;
  -- título: uma linha (controles e quebras viram espaço, espaços repetidos viram um); corpo: mantém as quebras de linha
  v_tit := left(btrim(regexp_replace(regexp_replace(coalesce(p_titulo, ''), '[[:cntrl:]]+', ' ', 'g'), ' {2,}', ' ', 'g')), 80);
  v_cor := nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p_corpo, ''), '[--]+', ' ', 'g'), '[ 	]{2,}', ' ', 'g')), 500), '');
  if length(v_tit) < 3 then raise exception 'Escreva um título (pelo menos 3 letras).'; end if;

  if coalesce(p_plataforma, false) then
    if not public.eh_admin_plataforma(v_uid) then raise exception 'Sem permissão (apenas a administração da plataforma).'; end if;
    v_origem := 'DesbravaClube';
    v_limite := 10;
    select array_agg(u.id order by u.nome) into v_clubes from public.organizational_units u where u.type = 'clube' and u.status = 'ativo';
  else
    -- coordenação: só 'lideranca', só os clubes do escopo em uso (com permissão de painel) e seus descendentes
    if v_dest <> 'lideranca' then raise exception 'A coordenação envia só para a liderança dos clubes.'; end if;
    select e.escopo into v_esc from public._escopo_em_uso_com_painel() e;
    if v_esc is null then raise exception 'Sem permissão (apenas a coordenação, na sua área).'; end if;
    select u.nome into v_origem from public.organizational_units u where u.id = v_esc;
    v_limite := 5;
    select array_agg(distinct c.club_id) into v_clubes
      from public._clubes_descendentes(v_esc) c
      join public.organizational_units u on u.id = c.club_id and u.type = 'clube' and u.status = 'ativo';
  end if;

  if coalesce(array_length(v_clubes, 1), 0) = 0 then raise exception 'Nenhum clube ativo na sua área.'; end if;

  select count(*) into v_hoje from public.auditoria_operacoes a
   where a.ator = v_uid and a.operacao = 'aviso_institucional' and a.quando > now() - interval '1 day';
  if v_hoje >= v_limite then
    return jsonb_build_object('ok', false, 'motivo', 'limite',
      'mensagem', 'Você já enviou ' || v_hoje || ' avisos nas últimas 24 horas. Tente de novo mais tarde.');
  end if;

  foreach v_c in array v_clubes loop
    begin
      insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id, criado_por)
      values (left('📣 ' || v_origem || ': ' || v_tit, 120), v_cor, 'geral', '/', v_dest, v_c, v_uid);
      v_ok := v_ok + 1;
    exception when others then
      v_falha := v_falha + 1;
      raise warning 'aviso institucional: clube não alcançado (%)', sqlstate;
    end;
  end loop;

  perform public._auditar('aviso_institucional', v_esc, null,
    jsonb_build_object('origem', v_origem, 'destino', v_dest, 'plataforma', coalesce(p_plataforma, false),
                       'clubes', v_ok, 'falhas', v_falha, 'titulo_tamanho', length(v_tit)));
  return jsonb_build_object('ok', v_ok > 0, 'clubes', v_ok, 'falhas', v_falha, 'destino', v_dest,
    'mensagem', case when v_ok = 0 then 'Não consegui enviar o aviso.'
                     else 'Aviso enviado para ' || v_ok || case when v_ok = 1 then ' clube.' else ' clubes.' end end);
end;
$$;
revoke all on function public.aviso_institucional_enviar(text, text, text, boolean) from public, anon;
grant execute on function public.aviso_institucional_enviar(text, text, text, boolean) to authenticated;

-- Quantos clubes um envio alcançaria (para a confirmação "Enviar para N clubes?"). Mesmas regras de autorização;
-- não grava nada.
create or replace function public.aviso_institucional_alcance(p_plataforma boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_esc uuid; v_n int := 0; v_origem text;
begin
  if v_uid is null then return jsonb_build_object('pode', false, 'clubes', 0); end if;
  if coalesce(p_plataforma, false) then
    if not public.eh_admin_plataforma(v_uid) then return jsonb_build_object('pode', false, 'clubes', 0); end if;
    select count(*) into v_n from public.organizational_units u where u.type = 'clube' and u.status = 'ativo';
    return jsonb_build_object('pode', true, 'clubes', v_n, 'origem', 'DesbravaClube', 'plataforma', true);
  end if;
  select e.escopo into v_esc from public._escopo_em_uso_com_painel() e;
  if v_esc is null then return jsonb_build_object('pode', false, 'clubes', 0); end if;
  select u.nome into v_origem from public.organizational_units u where u.id = v_esc;
  select count(distinct c.club_id) into v_n
    from public._clubes_descendentes(v_esc) c join public.organizational_units u on u.id = c.club_id and u.type = 'clube' and u.status = 'ativo';
  return jsonb_build_object('pode', v_n > 0, 'clubes', v_n, 'origem', v_origem, 'plataforma', false);
end;
$$;
revoke all on function public.aviso_institucional_alcance(boolean) from public, anon;
grant execute on function public.aviso_institucional_alcance(boolean) to authenticated;
