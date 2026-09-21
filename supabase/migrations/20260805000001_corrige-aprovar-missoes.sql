-- =====================================================================
--  Filhos da Conquista — Conserta a APROVAÇÃO das missões de foto 2026-08-05
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole tudo -> Run.
--  Idempotente e SEGURO de re-rodar. Nada é apagado.
--
--  PROBLEMA: a missão de foto ia parar numa tabela que não existia (ou na
--  antiga `devocional`), e a tela "Aprovar missões" procura na tabela nova
--  `missoes_feitas`. Este script cria a tabela certa, alinha TODAS as funções
--  de missão pra usarem ela (sem tirar o guard de conta-teste) e MIGRA o que
--  já foi enviado. Depois disso, foto enviada aparece pra liderança aprovar.
-- =====================================================================

-- 0) Garante a coluna 'teste' e a função eh_teste (o registrar_missao usa)
alter table public.profiles add column if not exists teste boolean not null default false;
create or replace function public.eh_teste()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select teste from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.eh_teste() to authenticated;

-- 1) Tabela própria das missões (1 por dia por criança) + RLS
create table if not exists public.missoes_feitas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.profiles(id) on delete cascade,
  data date not null,
  foto_url text,
  acertou_quiz boolean default false,
  status text not null default 'aprovada',
  pontos_dados int default 0,
  created_at timestamptz default now(),
  unique (usuario_id, data)
);
alter table public.missoes_feitas enable row level security;
drop policy if exists "ler missoes_feitas" on public.missoes_feitas;
create policy "ler missoes_feitas" on public.missoes_feitas for select to authenticated
  using (usuario_id = auth.uid() or public.pode_gerir());

-- 2) registrar_missao (desafio do dia; foto -> pendente; conta teste não pontua)
create or replace function public.registrar_missao(p_foto_url text, p_resposta int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text; v_correta int; v_pede_foto boolean := false;
  v_acertou boolean := false; v_pontos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select public.classe_por_nascimento(nascimento) into v_classe from public.profiles where id = v_uid;
  with d as (
    select ds.correta, ds.pede_foto, row_number() over (order by ds.created_at, ds.id) - 1 as i
    from public.desafios ds where ds.ativo and (ds.classe = v_classe or ds.classe is null)
  ), n as (select count(*) c from d)
  select d.correta, d.pede_foto into v_correta, v_pede_foto
  from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));

  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  v_pontos := case when v_acertou then 10 else 5 end;

  if public.eh_teste() then
    return json_build_object('acertou', v_acertou, 'pontos', 0, 'status', 'aprovada', 'teste', true);
  end if;

  if v_pede_foto then
    insert into public.missoes_feitas (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados)
    values (v_uid, v_hoje, p_foto_url, false, 'pendente', 10);
    return json_build_object('status', 'pendente');
  else
    insert into public.missoes_feitas (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados)
    values (v_uid, v_hoje, p_foto_url, v_acertou, 'aprovada', v_pontos);
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_uid, 'missao', v_pontos, 'Missão ' || to_char(v_hoje, 'DD/MM') || case when v_acertou then ' (acertou)' else '' end);
    return json_build_object('acertou', v_acertou, 'pontos', v_pontos, 'status', 'aprovada');
  end if;
exception when unique_violation then raise exception 'Você já fez a missão de hoje! Volte amanhã. 🙂';
end;
$$;
grant execute on function public.registrar_missao(text, int) to authenticated;

-- 3) missao_do_dia (só desafios) — o que o app mostra
create or replace function public.missao_do_dia()
returns table (tipo text, texto text, referencia text, tema text, pergunta text, opcoes jsonb, pede_foto boolean, classe text)
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text;
begin
  select public.classe_por_nascimento(nascimento) into v_classe from public.profiles where id = auth.uid();
  return query
  with d as (
    select ds.texto, ds.tema, ds.pergunta, ds.opcoes, ds.pede_foto,
           row_number() over (order by ds.created_at, ds.id) - 1 as i
    from public.desafios ds where ds.ativo and (ds.classe = v_classe or ds.classe is null)
  ), n as (select count(*) c from d)
  select 'desafio'::text, d.texto, null::text, d.tema, d.pergunta, d.opcoes, d.pede_foto, v_classe
  from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));
end;
$$;
grant execute on function public.missao_do_dia() to authenticated;

-- 4) meu_resumo_missoes (feito hoje? status? sequência) — tabela missoes_feitas
create or replace function public.meu_resumo_missoes()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_feito boolean := false; v_foto text; v_status text; v_seq int := 0; v_d date;
begin
  if v_uid is null then return json_build_object('feito', false, 'sequencia', 0); end if;
  select foto_url, status into v_foto, v_status from public.missoes_feitas where usuario_id = v_uid and data = v_hoje;
  v_feito := found;
  v_d := case when v_feito then v_hoje else v_hoje - 1 end;
  loop
    exit when not exists (select 1 from public.missoes_feitas where usuario_id = v_uid and data = v_d);
    v_seq := v_seq + 1; v_d := v_d - 1;
  end loop;
  return json_build_object('feito', v_feito, 'foto', v_foto, 'sequencia', v_seq, 'status', v_status);
end;
$$;
grant execute on function public.meu_resumo_missoes() to authenticated;

-- 5) missoes_pendentes + avaliar_missao — na tabela missoes_feitas (só liderança)
create or replace function public.missoes_pendentes()
returns table (id uuid, nome text, foto_url text, data date)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.status = 'ativo' and pr.papel in ('instrutor','diretoria')) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  return query
  select m.id, p.nome, m.foto_url, m.data
  from public.missoes_feitas m join public.profiles p on p.id = m.usuario_id
  where m.status = 'pendente' order by m.created_at;
end;
$$;
grant execute on function public.missoes_pendentes() to authenticated;

create or replace function public.avaliar_missao(p_id uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row record;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and papel in ('instrutor','diretoria')) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  select * into v_row from public.missoes_feitas where id = p_id and status = 'pendente';
  if not found then raise exception 'Missão não encontrada ou já avaliada.'; end if;
  if p_aprovar then
    update public.missoes_feitas set status = 'aprovada' where id = p_id;
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_row.usuario_id, 'missao', coalesce(v_row.pontos_dados, 10), 'Missão ' || to_char(v_row.data, 'DD/MM') || ' (aprovada)');
  else
    update public.missoes_feitas set status = 'reprovada' where id = p_id;
  end if;
end;
$$;
grant execute on function public.avaliar_missao(uuid, boolean) to authenticated;

-- 6) MIGRA pendências antigas (tabela devocional -> missoes_feitas), se houver
do $$
begin
  if to_regclass('public.devocional') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='devocional' and column_name='status')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='devocional' and column_name='foto_url') then
    insert into public.missoes_feitas (usuario_id, data, foto_url, status, pontos_dados)
    select d.usuario_id, d.data, d.foto_url, 'pendente', 10
    from public.devocional d
    where d.status = 'pendente' and d.foto_url is not null
    on conflict (usuario_id, data) do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
