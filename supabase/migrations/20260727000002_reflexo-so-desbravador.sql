-- =====================================================================
--  Filhos da Conquista — Barrar a liderança no Reflexo (2026-07-27)
--
--  ⚠️ Redefine registrar_recorde (2 args) e premiar_campeao_semana.
--  APOSENTADO após o 2026-08-29-anticheat-partidas.sql — NÃO re-rode depois
--  dele (recria a sobrecarga de 2 args e reverte o prêmio pra versão sem o
--  filtro de arcade). Ver GUIA-MIGRATIONS.md.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  Interruptor em Gestão -> 🎮 Jogos da Trilha: quando LIGADO, só DESBRAVADOR
--  disputa os recordes (conselheiro, instrutor, tesoureiro e diretoria ficam
--  de fora do ranking e não ganham os +20). A liderança continua jogando à
--  vontade — o recorde dela só não entra na competição das crianças.
--
--  Já entra LIGADO (foi o pedido); desligar é um toque na tela.
--  A regra vale no SERVIDOR: não adianta burlar pelo celular.
-- =====================================================================

insert into public.config_clube (chave, valor) values ('reflexo_so_desbravador', 'sim')
on conflict (chave) do nothing;

create or replace function public.reflexo_so_desbravador()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select valor = 'sim' from public.config_clube where chave = 'reflexo_so_desbravador'),
    false);
$$;
grant execute on function public.reflexo_so_desbravador() to authenticated;
revoke execute on function public.reflexo_so_desbravador() from public, anon;

-- 1) Não grava recorde de quem está barrado (devolve 'fora' pra tela avisar)
create or replace function public.registrar_recorde(p_jogo text, p_pontos int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_seg date := (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date;
  v_pts int := greatest(0, least(coalesce(p_pontos, 0), 500));
  v_antigo int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then
    return json_build_object('recorde', v_pts, 'melhorou', false);
  end if;
  if public.eh_teste() then
    return json_build_object('recorde', v_pts, 'melhorou', false, 'teste', true);
  end if;
  if not exists (select 1 from public.jogos_trilha where chave = p_jogo) then
    raise exception 'Jogo inválido.';
  end if;

  -- Liderança barrada: joga normal, mas o recorde não entra na competição
  if public.reflexo_so_desbravador()
     and not exists (select 1 from public.profiles where id = v_uid and papel = 'desbravador') then
    return json_build_object('recorde', v_pts, 'melhorou', false, 'fora', true);
  end if;

  select pontos into v_antigo from public.recordes
  where usuario_id = v_uid and jogo = p_jogo and semana = v_seg;

  insert into public.recordes (usuario_id, jogo, semana, pontos)
  values (v_uid, p_jogo, v_seg, v_pts)
  on conflict (usuario_id, jogo, semana)
  do update set pontos = greatest(public.recordes.pontos, excluded.pontos),
                atualizado_em = now();

  return json_build_object(
    'recorde', greatest(coalesce(v_antigo, 0), v_pts),
    'melhorou', v_pts > coalesce(v_antigo, 0)
  );
end;
$$;
grant execute on function public.registrar_recorde(text, int) to authenticated;
revoke execute on function public.registrar_recorde(text, int) from public, anon;

-- 2) Ranking esconde os barrados (inclusive recordes antigos da liderança)
create or replace function public.recordes_semana(p_jogo text)
returns json language sql stable security definer set search_path = '' as $$
  select case when public.eh_membro_ativo() then coalesce((
    select json_agg(json_build_object(
      'id', t.usuario_id, 'nome', t.nome, 'foto', t.foto, 'pontos', t.pontos
    ) order by t.pontos desc, t.atualizado_em)
    from (
      select r.usuario_id, p.nome, p.foto, r.pontos, r.atualizado_em
      from public.recordes r
      join public.profiles p on p.id = r.usuario_id
      where r.jogo = p_jogo
        and r.semana = (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date
        and r.pontos > 0
        and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
        and (not public.reflexo_so_desbravador() or p.papel = 'desbravador')
      order by r.pontos desc, r.atualizado_em
      limit 20
    ) t
  ), '[]'::json) else '[]'::json end;
$$;
grant execute on function public.recordes_semana(text) to authenticated;
revoke execute on function public.recordes_semana(text) from public, anon;

-- 3) Premiação de domingo também respeita o interruptor
create or replace function public.premiar_campeao_semana()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_seg date := (date_trunc('week', ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')))::date;
  rjogo record; r record;
  v_max int; v_nome_jogo text; v_marca text; v_nomes text;
begin
  for rjogo in select distinct jogo from public.recordes where semana = v_seg loop
    v_marca := rjogo.jogo || ' ' || to_char(v_seg, 'DD/MM/YYYY');

    if exists (
      select 1 from public.pontos
      where origem = 'campeao' and motivo like '%(' || v_marca || ')%'
    ) then
      continue;
    end if;

    select nome into v_nome_jogo from public.jogos_trilha where chave = rjogo.jogo;

    select max(r2.pontos) into v_max
    from public.recordes r2
    join public.profiles p on p.id = r2.usuario_id
    where r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos > 0
      and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
      and (not public.reflexo_so_desbravador() or p.papel = 'desbravador');
    if v_max is null or v_max <= 0 then continue; end if;

    v_nomes := null;
    for r in
      select r2.usuario_id, p.nome
      from public.recordes r2
      join public.profiles p on p.id = r2.usuario_id
      where r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos = v_max
        and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
        and (not public.reflexo_so_desbravador() or p.papel = 'desbravador')
    loop
      insert into public.pontos (usuario_id, origem, pontos, motivo)
      values (r.usuario_id, 'campeao', 20,
        '🏆 Recorde da semana no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' (' || v_marca || ')');
      v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
    end loop;

    -- ninguém elegível (ex.: só a liderança pontuou e ela está barrada)
    if v_nomes is null then continue; end if;

    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🏆 Recorde da semana!',
      v_nomes || ' fez o maior recorde no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' e levou +20 pontos!',
      'geral', '/trilha', 'todos');
  end loop;
end;
$$;
revoke all on function public.premiar_campeao_semana() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
