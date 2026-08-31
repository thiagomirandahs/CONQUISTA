-- =====================================================================
--  Filhos da Conquista — Chefão: prêmio PROPORCIONAL ao dano (2026-08-31)
--
--  Antes: +15 fixo pra quem deu 1 golpe + 30 pro time. Sem graça.
--  Agora: na VITÓRIA, a VIDA do chefão vira o prêmio e é dividida entre todos
--  proporcional ao DANO que cada um causou. Ex.: chefão de 3000 de vida →
--  3000 pontos repartidos; quem fez 10% do dano leva ~300. Quanto mais você
--  jogou/golpeou, mais ganha. Justo e escalável (boss maior = prêmio maior).
--
--  Dano de cada um = seus pontos do fim de semana (jogos/missões/Bíblia, tirando
--  os prêmios 'campeao'/'chefao') + os golpes especiais. Só na vitória o prêmio
--  é liberado; se o chefão foge, ninguém perde os pontos que já ganhou (segue a
--  mensagem gentil). Roda no cron de domingo (já agendado), idempotente.
--
--  Redefine só chefao_premiar (base 2026-08-29-chefao-fds.sql). NÃO re-rode o
--  chefao-fds depois deste (voltaria pro +15/+30).
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
-- =====================================================================

set lock_timeout = '10s';

create or replace function public.chefao_premiar()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ativo boolean;
  v_inicio text;
  v_vida int;
  v_nome text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_dano numeric;   -- dano total do clube (pontos + golpes de membros ativos)
  v_premio int;
  r record;
begin
  v_ativo := coalesce((select valor from public.config_clube where chave = 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := (select valor from public.config_clube where chave = 'chefao_inicio');
  if not v_ativo or v_inicio is null then return; end if;
  if (select valor from public.config_clube where chave = 'chefao_pago') is not distinct from v_inicio then return; end if;

  v_vida := greatest(1, coalesce((select valor from public.config_clube where chave = 'chefao_vida'), '3000')::int);
  v_nome := coalesce((select valor from public.config_clube where chave = 'chefao_nome'), 'Chefão');
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days';

  perform pg_advisory_xact_lock(hashtext('chefao:' || v_inicio));

  -- dano total (mesmos filtros do dano por pessoa abaixo → as proporções fecham)
  select coalesce((select sum(p.pontos) from public.pontos p
      join public.profiles pr on pr.id = p.usuario_id
      where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false), 0)
    + coalesce((select sum(g.dano) from public.chefao_golpes g
      join public.profiles pr on pr.id = g.usuario_id
      where g.criado_em >= v_ini and g.criado_em < v_fim
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false), 0)
  into v_dano;

  if v_dano >= v_vida then
    -- VITÓRIA: reparte a vida (v_vida) proporcional ao dano de cada um
    for r in
      select uid, sum(dano)::numeric as dano_user from (
        select p.usuario_id as uid, sum(p.pontos)::numeric as dano
        from public.pontos p join public.profiles pr on pr.id = p.usuario_id
        where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
          and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false
        group by p.usuario_id
        union all
        select g.usuario_id, sum(g.dano)::numeric
        from public.chefao_golpes g join public.profiles pr on pr.id = g.usuario_id
        where g.criado_em >= v_ini and g.criado_em < v_fim
          and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false
        group by g.usuario_id
      ) t
      group by uid
    loop
      v_premio := round(v_vida * r.dano_user / v_dano)::int;
      if v_premio > 0 then
        insert into public.pontos (usuario_id, origem, pontos, motivo)
        values (r.uid, 'chefao', v_premio,
          '⚔️ Derrotou o ' || v_nome || '! ' || round(r.dano_user)::int || ' de dano → +' || v_premio
          || ' (' || to_char(v_ini, 'DD/MM') || ')');
      end if;
    end loop;

    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('⚔️ Chefão derrotado!',
      'O clube uniu forças e derrotou o ' || v_nome || '! Cada um levou pontos proporcionais ao dano que causou. 🎉',
      'geral', '/chefao', 'todos');
  else
    -- fugiu (gentil, sem "vocês falharam"); ninguém perde os pontos já ganhos
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🌙 O ' || v_nome || ' recuou...',
      'O ' || v_nome || ' fugiu por pouco! Foi muita luta junto — semana que vem tem mais aventura. 💪',
      'geral', '/chefao', 'todos');
  end if;

  insert into public.config_clube (chave, valor) values ('chefao_pago', v_inicio)
  on conflict (chave) do update set valor = excluded.valor;
  update public.config_clube set valor = 'nao' where chave = 'chefao_ativo';
end;
$$;
revoke all on function public.chefao_premiar() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
