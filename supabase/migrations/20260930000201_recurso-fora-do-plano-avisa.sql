-- Ligar um recurso que o PLANO do clube não inclui era aceito em silêncio: o botão voltava sozinho para
-- desligado e a liderança não sabia por quê (Exército da colina, plano 'Gratuito', 26/09). Agora o servidor
-- avisa com todas as letras. Resto de recurso_definir igual à versão em produção.

-- o que o PLANO permite (sem olhar se a liderança ligou): true = permitido
create or replace function public.recursos_do_clube_sem_ajuste(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $function$
declare v_sub record; v_plan record; v_permitidos text[]; v_tudo boolean := true;
begin
  select s.* into v_sub from public.subscriptions s where s.id = public.assinatura_do_clube_id(p_club_id);
  if found then
    select p.* into v_plan from public.billing_plans p where p.id = v_sub.plan_id;
    if v_plan.id is null then v_tudo := false; v_permitidos := '{}';
    elsif v_plan.recursos is not null then v_tudo := false; v_permitidos := v_plan.recursos;
    end if;
  end if;
  return coalesce((select jsonb_object_agg(c.chave, v_tudo or c.chave = any (coalesce(v_permitidos, '{}'))) from public.recursos_catalogo c), '{}'::jsonb);
end $function$;
revoke all on function public.recursos_do_clube_sem_ajuste(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recurso_definir(p_feature text, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_club uuid := public.clube_atual_id(); v_cat record;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas a liderança do clube).';
  end if;
  if p_enabled is null then
    raise exception 'Informe se o recurso fica ligado ou desligado.';
  end if;
  select * into v_cat from public.recursos_catalogo where chave = p_feature;
  if not found then
    raise exception 'Recurso desconhecido.';
  end if;
  if v_cat.somente_plataforma then
    raise exception 'O recurso "%" é liberado pela plataforma, não pela liderança do clube.', v_cat.nome;
  end if;
  if p_enabled and not coalesce((public.recursos_do_clube_sem_ajuste(v_club) ->> p_feature)::boolean, true) then
    raise exception 'O recurso "%" não faz parte do plano deste clube. Fale com o DesbravaClube para mudar de plano.', v_cat.nome;
  end if;
  -- desligar o leilão com leilão em andamento esconderia a tela com pontos das unidades em jogo
  if p_feature = 'leilao' and not p_enabled
     and exists (select 1 from public.leiloes where club_id = v_club and status = 'aberto') then
    raise exception 'Há leilão aberto: encerre ou cancele antes de desligar o leilão.';
  end if;
  insert into public.club_features (club_id, feature, enabled) values (v_club, p_feature, p_enabled)
  on conflict (club_id, feature) do update set enabled = excluded.enabled, updated_at = now();
  perform public._auditar('recurso_alterado', v_club, null, jsonb_build_object('recurso', p_feature, 'ligado', p_enabled));
  return public.recursos_do_clube(v_club);
end;
$function$;
