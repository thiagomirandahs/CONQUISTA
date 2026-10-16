-- =============================================================================
--  554 — AVISO INSTITUCIONAL: ESCOLHER OS DESTINATÁRIOS (16/10/2026).
--  Pedido do dono: a coordenação manda aviso "escolhendo qual clube, podendo selecionar mais de um, ou por região".
--  Antes (536/537) o aviso ia para TODOS os clubes da área, sem escolha.
--
--  Agora `p_alvos uuid[]` (opcional): uma lista de unidades — clubes e/ou unidades intermediárias (região, distrito…).
--  Cada unidade intermediária vale por TODOS os clubes ativos abaixo dela. O resultado é SEMPRE recortado pelo que a
--  pessoa já podia alcançar (a área da coordenação em uso; a plataforma inteira para o admin): um id de fora da área é
--  ignorado em silêncio, nunca amplia o alcance. Sem p_alvos (ou vazio) = todos da área, como antes.
--  aviso_institucional_destinos(): lista a árvore da área (unidades + clubes ativos) para a tela montar a escolha.
--  Mesmas regras de 536/537: só liderança para a coordenação; limite diário; auditoria; texto limpo.
-- =============================================================================
begin;

drop function if exists public.aviso_institucional_enviar(text, text, text, boolean);
drop function if exists public.aviso_institucional_alcance(boolean);

-- clubes que a pessoa PODE alcançar (sem escolha) + nome da origem; null = sem permissão
create or replace function public._aviso_permitidos(p_plataforma boolean, out clubes uuid[], out origem text, out escopo uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  clubes := null; origem := null; escopo := null;
  if v_uid is null then return; end if;
  if coalesce(p_plataforma, false) then
    if not public.eh_admin_plataforma(v_uid) then return; end if;
    origem := 'DesbravaClube';
    select coalesce(array_agg(u.id order by u.nome), '{}') into clubes from public.organizational_units u where u.type = 'clube' and u.status = 'ativo';
    return;
  end if;
  select e.escopo into escopo from public._escopo_em_uso_com_painel() e;
  if escopo is null then return; end if;
  select u.nome into origem from public.organizational_units u where u.id = escopo;
  select coalesce(array_agg(distinct c.club_id), '{}') into clubes
    from public._clubes_descendentes(escopo) c
    join public.organizational_units u on u.id = c.club_id and u.type = 'clube' and u.status = 'ativo';
end $$;
revoke all on function public._aviso_permitidos(boolean) from public, anon, authenticated;

-- recorta a escolha: cada alvo vale por ele mesmo (clube) ou por todos os clubes abaixo dele; sempre dentro do permitido
create or replace function public._aviso_recortar(p_permitidos uuid[], p_alvos uuid[]) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case when p_alvos is null or coalesce(array_length(p_alvos, 1), 0) = 0 then coalesce(p_permitidos, '{}')
    else coalesce((select array_agg(distinct c) from unnest(coalesce(p_permitidos, '{}')) c
                    where exists (select 1 from unnest(p_alvos) a cross join lateral public._clubes_descendentes(a) d where d.club_id = c)), '{}')
  end;
$$;
revoke all on function public._aviso_recortar(uuid[], uuid[]) from public, anon, authenticated;

-- a árvore da área para a tela: unidades intermediárias + clubes ativos (com quantos clubes cada unidade alcança)
create or replace function public.aviso_institucional_destinos(p_plataforma boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p record; v_raiz uuid;
begin
  select * into p from public._aviso_permitidos(p_plataforma);
  if p.clubes is null then return jsonb_build_object('pode', false, 'unidades', '[]'::jsonb); end if;
  v_raiz := p.escopo;
  return jsonb_build_object('pode', coalesce(array_length(p.clubes, 1), 0) > 0, 'origem', p.origem, 'raiz', v_raiz,
    'unidades', coalesce((
      with recursive area as (
        select u.id, u.nome, u.type, u.parent_id from public.organizational_units u
         where (v_raiz is not null and u.id = v_raiz) or (v_raiz is null and u.parent_id is null)
        union
        select o.id, o.nome, o.type, o.parent_id from public.organizational_units o join area a on o.parent_id = a.id
      )
      select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'tipo', a.type, 'pai', a.parent_id,
               'clubes', (select count(*) from public._clubes_descendentes(a.id) d where d.club_id = any (p.clubes)))
             order by a.type <> 'clube', a.nome)
        from area a
       where (a.type <> 'clube' or a.id = any (p.clubes))
         and (a.type = 'clube' or exists (select 1 from public._clubes_descendentes(a.id) d where d.club_id = any (p.clubes)))
    ), '[]'::jsonb));
end $$;
revoke all on function public.aviso_institucional_destinos(boolean) from public, anon;
grant execute on function public.aviso_institucional_destinos(boolean) to authenticated;

-- quantos clubes o envio alcançaria (para a confirmação), já com a escolha
create or replace function public.aviso_institucional_alcance(p_plataforma boolean default false, p_alvos uuid[] default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p record; v_n int;
begin
  if auth.uid() is null then return jsonb_build_object('pode', false, 'clubes', 0); end if;   -- sem sessão: nada (o gate completo está em _aviso_permitidos)
  select * into p from public._aviso_permitidos(p_plataforma);
  if p.clubes is null then return jsonb_build_object('pode', false, 'clubes', 0); end if;
  v_n := coalesce(array_length(public._aviso_recortar(p.clubes, p_alvos), 1), 0);
  return jsonb_build_object('pode', coalesce(array_length(p.clubes, 1), 0) > 0, 'clubes', v_n,
    'clubes_area', coalesce(array_length(p.clubes, 1), 0), 'origem', p.origem, 'plataforma', coalesce(p_plataforma, false));
end $$;
revoke all on function public.aviso_institucional_alcance(boolean, uuid[]) from public, anon;
grant execute on function public.aviso_institucional_alcance(boolean, uuid[]) to authenticated;

create or replace function public.aviso_institucional_enviar(
  p_titulo text, p_corpo text default null, p_destino text default 'lideranca', p_plataforma boolean default false, p_alvos uuid[] default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_dest text := coalesce(nullif(btrim(p_destino), ''), 'lideranca');
  v_tit text; v_cor text; p record; v_clubes uuid[]; v_c uuid;
  v_ok int := 0; v_falha int := 0; v_limite int; v_hoje int; v_autor uuid; v_escolha boolean;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  select pr.id into v_autor from public.profiles pr where pr.id = v_uid;   -- admin sem perfil: autor nulo (537)
  if v_dest not in ('lideranca', 'todos') then raise exception 'Destino inválido.'; end if;
  v_tit := left(btrim(regexp_replace(regexp_replace(coalesce(p_titulo, ''), '[[:cntrl:]]+', ' ', 'g'), ' {2,}', ' ', 'g')), 80);
  v_cor := nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p_corpo, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]+', ' ', 'g'), '[ \t]{2,}', ' ', 'g')), 500), '');
  if length(v_tit) < 3 then raise exception 'Escreva um título (pelo menos 3 letras).'; end if;

  select * into p from public._aviso_permitidos(p_plataforma);
  if p.clubes is null then
    if coalesce(p_plataforma, false) then raise exception 'Sem permissão (apenas a administração da plataforma).'; end if;
    raise exception 'Sem permissão (apenas a coordenação, na sua área).';
  end if;
  if not coalesce(p_plataforma, false) and v_dest <> 'lideranca' then raise exception 'A coordenação envia só para a liderança dos clubes.'; end if;
  v_limite := case when coalesce(p_plataforma, false) then 10 else 5 end;

  v_escolha := p_alvos is not null and coalesce(array_length(p_alvos, 1), 0) > 0;
  v_clubes := public._aviso_recortar(p.clubes, p_alvos);
  if coalesce(array_length(v_clubes, 1), 0) = 0 then
    if v_escolha then raise exception 'Escolha pelo menos um clube da sua área.'; end if;
    raise exception 'Nenhum clube ativo na sua área.';
  end if;

  select count(*) into v_hoje from public.auditoria_operacoes a
   where a.ator = v_uid and a.operacao = 'aviso_institucional' and a.quando > now() - interval '1 day';
  if v_hoje >= v_limite then
    return jsonb_build_object('ok', false, 'motivo', 'limite',
      'mensagem', 'Você já enviou ' || v_hoje || ' avisos nas últimas 24 horas. Tente de novo mais tarde.');
  end if;

  foreach v_c in array v_clubes loop
    begin
      insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id, criado_por)
      values (left('📣 ' || p.origem || ': ' || v_tit, 120), v_cor, 'geral', '/', v_dest, v_c, v_autor);
      v_ok := v_ok + 1;
    exception when others then
      v_falha := v_falha + 1;
      raise warning 'aviso institucional: clube não alcançado (%)', sqlstate;
    end;
  end loop;

  perform public._auditar('aviso_institucional', p.escopo, null,
    jsonb_build_object('origem', p.origem, 'destino', v_dest, 'plataforma', coalesce(p_plataforma, false),
                       'clubes', v_ok, 'falhas', v_falha, 'escolha', v_escolha, 'titulo_tamanho', length(v_tit)));
  return jsonb_build_object('ok', v_ok > 0, 'clubes', v_ok, 'falhas', v_falha, 'destino', v_dest,
    'mensagem', case when v_ok = 0 then 'Não consegui enviar o aviso.'
                     else 'Aviso enviado para ' || v_ok || case when v_ok = 1 then ' clube.' else ' clubes.' end end);
end $$;
revoke all on function public.aviso_institucional_enviar(text, text, text, boolean, uuid[]) from public, anon;
grant execute on function public.aviso_institucional_enviar(text, text, text, boolean, uuid[]) to authenticated;

notify pgrst, 'reload schema';
insert into public.migracoes_aplicadas (arquivo) values ('2026-10-16-aviso-escolher-clubes-e-regioes.sql') on conflict (arquivo) do nothing;
commit;
