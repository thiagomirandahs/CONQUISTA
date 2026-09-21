-- =====================================================================
--  Filhos da Conquista — Correções URGENTES da varredura (2026-07-06)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole TUDO -> Run.
--  Idempotente: pode rodar quantas vezes quiser, sem duplicar nada.
--
--  Resolve (lado do banco) os itens urgentes:
--    1) Ranking somado no banco (acaba o limite silencioso de 1000 linhas)
--    2) Storage: cada um só sobrescreve a PRÓPRIA foto (fecha o "trocar foto dos outros")
--    3) Apontamentos numa transação única (não perde ponto pela metade)
--    4) Aprovar entrega atômico e idempotente (nunca dobra nem some com pontos)
--    6) Excluir usuário sem travar / sem apagar histórico financeiro
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) RANKING: soma no banco em vez de baixar a tabela inteira no celular
--    Retorna { pessoas:[{id,total}], times:[{id,total}] } num JSON só.
-- ---------------------------------------------------------------------
create or replace function public.ranking_totais()
returns json language sql security definer set search_path = '' as $$
  select json_build_object(
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (
        select usuario_id, sum(pontos)::int as total
        from public.pontos
        where usuario_id is not null
        group by usuario_id
      ) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (
        select unidade_id, sum(pontos)::int as total
        from public.pontos
        where usuario_id is null and unidade_id is not null
        group by unidade_id
      ) t), '[]'::json)
  );
$$;
grant execute on function public.ranking_totais() to authenticated;


-- ---------------------------------------------------------------------
-- 2) STORAGE: só o DONO (ou a liderança) pode sobrescrever um arquivo.
--    Antes: qualquer logado sobrescrevia a foto de qualquer um.
--    Uploads normais criam caminho novo (com data/hora), então nada quebra.
-- ---------------------------------------------------------------------
drop policy if exists "atualizar imagens" on storage.objects;
create policy "atualizar imagens" on storage.objects for update to authenticated
  using  (bucket_id = 'imagens' and (owner = auth.uid() or public.pode_gerir()))
  with check (bucket_id = 'imagens' and (owner = auth.uid() or public.pode_gerir()));

-- Apagar arquivo do Storage: só o dono ou a liderança (antes: ninguém podia)
drop policy if exists "apagar imagens" on storage.objects;
create policy "apagar imagens" on storage.objects for delete to authenticated
  using (bucket_id = 'imagens' and (owner = auth.uid() or public.pode_gerir()));


-- ---------------------------------------------------------------------
-- 3) APONTAMENTOS numa transação única: apaga+regrava a reunião inteira
--    de uma vez. Se qualquer linha falhar, NADA é alterado (sem perda).
--    Teto anti-abuso de 100 pts por pessoa/reunião (o máximo legítimo hoje é
--    60; a folga evita truncar sem querer se a liderança mudar os valores).
-- ---------------------------------------------------------------------
create or replace function public.salvar_reuniao(p_data date, p_motivo text, p_itens jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_item jsonb;
  v_alvo uuid;
  v_pts  int;
  v_n    int := 0;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_alvo := (v_item->>'usuario_id')::uuid;
    -- mesma regra do app: só quem pode apontar aquela pessoa
    if not public.pode_apontar(v_alvo) then
      raise exception 'Sem permissão para apontar esta pessoa.';
    end if;
    v_pts := greatest(0, least(100, coalesce((v_item->>'pontos')::int, 0)));

    delete from public.pontos
      where usuario_id = v_alvo and origem = 'apontamento' and motivo = p_motivo;
    insert into public.pontos (usuario_id, origem, pontos, motivo, data, lancado_por, marca)
      values (v_alvo, 'apontamento', v_pts, p_motivo, p_data, v_uid, (v_item->'marca'));
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;
grant execute on function public.salvar_reuniao(date, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 4) APROVAR ENTREGA de forma atômica e idempotente.
--    Só credita pontos se a entrega AINDA estava 'pendente' -> nunca dobra,
--    nunca fica "aprovada sem pontos". Tudo numa transação só.
-- ---------------------------------------------------------------------
create or replace function public.aprovar_entrega(p_entrega_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ent public.entregas;
  v_atv public.atividades;
  v_pts int;
begin
  if not public.pode_gerir() then raise exception 'Sem permissão.'; end if;

  update public.entregas
     set status = 'aprovada', avaliado_por = v_uid
   where id = p_entrega_id and status = 'pendente'
   returning * into v_ent;

  -- já tinha sido avaliada (ou não existe): não faz nada, não duplica pontos
  if v_ent.id is null then
    return json_build_object('ok', false, 'motivo', 'ja_avaliada');
  end if;

  select * into v_atv from public.atividades where id = v_ent.atividade_id;
  v_pts := coalesce(v_atv.pontos, 0);

  update public.entregas set pontos_dados = v_pts where id = v_ent.id;
  insert into public.pontos (usuario_id, origem, pontos, motivo, lancado_por)
    values (v_ent.usuario_id, 'atividade', v_pts,
            'Atividade: ' || coalesce(v_atv.titulo, ''), v_uid);

  return json_build_object('ok', true, 'pontos', v_pts);
end;
$$;
grant execute on function public.aprovar_entrega(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6) EXCLUIR USUÁRIO sem travar e sem apagar histórico.
--    Troca as FKs de AUDITORIA (quem criou/aprovou/lançou) para
--    ON DELETE SET NULL, e preserva o histórico de mensalidades.
--    Robusto: acha o nome real de cada FK antes de recriar.
-- ---------------------------------------------------------------------
do $$
declare
  alvos text[][] := array[
    array['atividades','criado_por'],
    array['entregas','avaliado_por'],
    array['pontos','lancado_por'],
    array['fotos','autor_id'],
    array['mensalidades','registrado_por'],
    array['notificacoes','criado_por'],
    array['mensalidades','desbravador_id']  -- preserva o caixa: não some no cascade
  ];
  a text[];
  cn text;
begin
  foreach a slice 1 in array alvos loop
    for cn in
      select con.conname
      from pg_constraint con
      join pg_class c   on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = a[1] and con.contype = 'f'
        and (select attname from pg_attribute
             where attrelid = con.conrelid and attnum = con.conkey[1]) = a[2]
    loop
      execute format('alter table public.%I drop constraint %I', a[1], cn);
    end loop;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on delete set null',
      a[1], a[1] || '_' || a[2] || '_fkey', a[2]);
  end loop;
end $$;


-- Recarrega o cache da API pra tudo aparecer na hora
notify pgrst, 'reload schema';
