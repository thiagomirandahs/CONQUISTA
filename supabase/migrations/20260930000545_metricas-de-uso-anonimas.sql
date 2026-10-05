-- =============================================================================
--  Métricas de uso ANÔNIMAS para a administração da plataforma (05/10/2026).
--
--  Pergunta do dono: "quantas visitas o site teve e quantos estão usando o aplicativo agora?".
--
--  Privacidade (LGPD, produto com crianças): NADA identifica ninguém. Cada aba/app gera um código
--  aleatório de sessão no próprio aparelho e manda um "sinal de vida" a cada 60 s enquanto a tela está
--  aberta. Não há user_id, IP, e-mail, clube, caminho de URL nem user-agent. Só: código da sessão,
--  origem (site | app | apk), dia, primeiro/último sinal, nº de páginas vistas e "estava logado?"
--  (sim/não — sem dizer quem).
--
--  1) public.metricas_sessoes   — fechada (RLS ligada, sem policy, sem grant): só as funções abaixo tocam nela.
--  2) metrica_registrar(...)    — anon + authenticated. Idempotente por sessão; limite por sessão (1 sinal a
--                                  cada 20 s) e teto global de sessões NOVAS por minuto contra enchente.
--  3) admin_metricas()          — SÓ administrador da plataforma: agora, hoje/7/30 dias e série de 14 dias.
--  4) metricas_limpar() + cron  — apaga sessões com mais de 40 dias, todo dia.
-- =============================================================================

create table if not exists public.metricas_sessoes (
  sessao       uuid primary key,
  origem       text not null check (origem in ('site', 'app', 'apk')),
  dia          date not null,
  primeiro_em  timestamptz not null default now(),
  ultimo_em    timestamptz not null default now(),
  paginas      int not null default 1 check (paginas between 1 and 500),
  logado       boolean not null default false
);
create index if not exists metricas_sessoes_ultimo_em_idx on public.metricas_sessoes (ultimo_em desc);
create index if not exists metricas_sessoes_primeiro_em_idx on public.metricas_sessoes (primeiro_em desc);
create index if not exists metricas_sessoes_dia_idx on public.metricas_sessoes (dia, origem);

alter table public.metricas_sessoes enable row level security;
revoke all on public.metricas_sessoes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- registro (público): a tela do login/site também conta, então anon executa
--   p_pagina = true  → o sinal é uma PÁGINA nova (troca de tela); false = só "continuo aqui"
-- ---------------------------------------------------------------------------
create or replace function public.metrica_registrar(p_sessao uuid, p_origem text, p_pagina boolean default false, p_logado boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_sessao is null or p_origem is null or p_origem not in ('site', 'app', 'apk') then
    return;   -- entrada inválida: ignora em silêncio (não é oráculo de nada)
  end if;

  if exists (select 1 from public.metricas_sessoes where sessao = p_sessao) then
    -- sinal repetido em menos de 20 s e sem página nova: não gasta escrita
    update public.metricas_sessoes
       set ultimo_em = now(),
           paginas = least(paginas + case when p_pagina then 1 else 0 end, 500),
           logado = logado or coalesce(p_logado, false)
     where sessao = p_sessao
       and (p_pagina or ultimo_em < now() - interval '20 seconds' or (coalesce(p_logado, false) and not logado));
    return;
  end if;

  -- teto global contra enchente de sessões falsas (600 novas por minuto é muito além do uso real)
  if (select count(*) from public.metricas_sessoes where primeiro_em > now() - interval '1 minute') >= 600 then
    return;
  end if;

  insert into public.metricas_sessoes (sessao, origem, dia, logado)
  values (p_sessao, p_origem, v_dia, coalesce(p_logado, false))
  on conflict (sessao) do nothing;
end;
$$;
revoke all on function public.metrica_registrar(uuid, text, boolean, boolean) from public;
grant execute on function public.metrica_registrar(uuid, text, boolean, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- leitura (só admin da plataforma)
--   agora : sessões com sinal nos últimos 2 minutos, por origem
--   visitas: sessões ÚNICAS e páginas por origem em hoje / 7 dias / 30 dias (dia de Brasília)
--   serie : últimos 14 dias, 1 item por dia (inclui dias zerados)
-- ---------------------------------------------------------------------------
create or replace function public.admin_metricas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_agora jsonb;
  v_visitas jsonb;
  v_serie jsonb;
begin
  perform public._exigir_admin_plataforma();

  select jsonb_build_object(
    'site', count(*) filter (where origem = 'site'),
    'app',  count(*) filter (where origem = 'app'),
    'apk',  count(*) filter (where origem = 'apk'),
    'app_logados', count(*) filter (where origem in ('app', 'apk') and logado),
    'total', count(*))
    into v_agora
    from public.metricas_sessoes where ultimo_em > now() - interval '2 minutes';

  select jsonb_object_agg(k, jsonb_build_object(
      'site', jsonb_build_object('visitantes', s_site, 'paginas', p_site),
      'app',  jsonb_build_object('sessoes', s_app, 'paginas', p_app)))
    into v_visitas
    from (
      select j.k,
             count(*) filter (where m.origem = 'site') as s_site, coalesce(sum(m.paginas) filter (where m.origem = 'site'), 0) as p_site,
             count(*) filter (where m.origem in ('app', 'apk')) as s_app, coalesce(sum(m.paginas) filter (where m.origem in ('app', 'apk')), 0) as p_app
        from (values ('hoje', 0), ('d7', 6), ('d30', 29)) as j(k, dias)
        left join public.metricas_sessoes m on m.dia >= v_hoje - j.dias
       group by j.k
    ) t;

  select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'site', coalesce(x.site, 0), 'app', coalesce(x.app, 0)) order by d.dia), '[]'::jsonb)
    into v_serie
    from generate_series(v_hoje - 13, v_hoje, interval '1 day') as g(dia_ts)
    cross join lateral (select g.dia_ts::date as dia) d
    left join (
      select dia, count(*) filter (where origem = 'site') as site, count(*) filter (where origem in ('app', 'apk')) as app
        from public.metricas_sessoes where dia >= v_hoje - 13 group by dia
    ) x on x.dia = d.dia;

  return jsonb_build_object('agora', v_agora, 'visitas', v_visitas, 'serie', v_serie, 'gerado_em', now());
end;
$$;
revoke all on function public.admin_metricas() from public, anon;
grant execute on function public.admin_metricas() to authenticated;

-- ---------------------------------------------------------------------------
-- limpeza diária (pg_cron): sessões com mais de 40 dias
-- ---------------------------------------------------------------------------
create or replace function public.metricas_limpar() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.metricas_sessoes where ultimo_em < now() - interval '40 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.metricas_limpar() from public, anon, authenticated;
grant execute on function public.metricas_limpar() to service_role;

select cron.schedule('limpar-metricas', '40 4 * * *', 'select public.metricas_limpar()')
 where not exists (select 1 from cron.job where jobname = 'limpar-metricas');

-- toda migration que cria tabela termina instalando a guarda do modo manutenção (teste 100)
select public._manutencao_instalar_guarda();

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-metricas-de-uso-anonimas.sql')
on conflict (arquivo) do update set aplicada_em = now();
