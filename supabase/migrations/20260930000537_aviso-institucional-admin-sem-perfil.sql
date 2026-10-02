-- =============================================================================
--  537 — Aviso institucional: conta de administração da plataforma SEM perfil (profiles) não derrubava a coordenação, mas
--  derrubava o envio da PLATAFORMA (violação da chave estrangeira notificacoes.criado_por -> profiles, 4 de 4 clubes).
--  Achado no smoke de produção da 536 (02/10/2026), antes de o front ser publicado. Correção: criado_por = o perfil se existir, senão nulo
--  (o envio continua auditado em auditoria_operacoes com o ator). Só redefine a função; mesma assinatura e mesmos grants.
-- =============================================================================

create or replace function public.aviso_institucional_enviar(
  p_titulo text, p_corpo text default null, p_destino text default 'lideranca', p_plataforma boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_dest text := coalesce(nullif(btrim(p_destino), ''), 'lideranca');
  v_tit text; v_cor text; v_esc uuid; v_origem text; v_clubes uuid[]; v_c uuid;
  v_ok int := 0; v_falha int := 0; v_limite int; v_hoje int; v_autor uuid;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  -- notificacoes.criado_por referencia profiles: a conta de administração da plataforma pode não ter perfil (achado no smoke de produção) -> fica sem autor, o envio é auditado do mesmo jeito
  select p.id into v_autor from public.profiles p where p.id = v_uid;
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
      values (left('📣 ' || v_origem || ': ' || v_tit, 120), v_cor, 'geral', '/', v_dest, v_c, v_autor);
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
