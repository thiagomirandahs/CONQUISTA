-- =============================================================================
--  540 — EDITOR DE PLANOS NO PAINEL DA PLATAFORMA (rascunho -> publicar versão)
--
--  Pedido do dono (02/10/2026): "os planos podem ser adaptáveis por mim lá?". Até aqui preço, nome, descrição e limites só mudavam por
--  migration. Agora a administração da plataforma edita pelo /admin SEM mexer em quem já assinou:
--    * cada plano é VERSIONADO (billing_plans.chave + versao). Quem assinou continua na versão em que assinou;
--    * a edição acontece num RASCUNHO (uma versão nova, status 'rascunho', fora da vitrine);
--    * PUBLICAR torna o rascunho a versão vigente para NOVAS contratações (planos_disponiveis já mostra a mais nova publicada);
--      as assinaturas existentes ficam na versão antiga até alguém migrá-las (plano_mudar, que já existia);
--    * a versão publicada NÃO é editada (preço histórico); corrigir = novo rascunho.
--  Os painéis (recursos) de cada plano continuam em "Painéis do plano" (admin_plano_recurso_definir), que também vale para o rascunho.
--
--  RPCs (todas security definer, search_path '', exclusivas do admin da plataforma, auditadas em platform_admin_audit):
--    admin_plano_rascunho_salvar(chave, nome, descricao, publico, limites, precos)  cria/atualiza o rascunho da chave
--    admin_plano_publicar(plano_id, motivo)                                         publica o rascunho
--    admin_plano_rascunho_descartar(plano_id)                                       apaga o rascunho (nunca uma versão publicada)
--    admin_plano_visibilidade_definir(plano_id, publico)                            mostra/oculta na vitrine (não muda preço)
--    admin_plano_arquivar(plano_id, motivo)                                         tira de circulação (só sem assinatura viva; nunca o legado-fundador)
--    admin_plano_excluir(plano_id, motivo)                                          apaga DE VERDADE uma versão que nunca teve assinatura
--    admin_planos_listar()                                                          agora também devolve o metadata dos preços (Pix, parcelas)
--  Nenhuma tabela nova (nada para a guarda de manutenção).
-- =============================================================================

-- no máximo UM rascunho por plano
create unique index if not exists uq_billing_plans_rascunho_por_chave on public.billing_plans (chave) where status = 'rascunho';

-- limites aceitos: as mesmas chaves que limite_uso mede; valor inteiro >= 0; null/ausente = ilimitado
create or replace function public._plano_limites_validar(p_limites jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; r jsonb := '{}'::jsonb;
begin
  if p_limites is null or jsonb_typeof(p_limites) = 'null' then return '{}'::jsonb; end if;
  if jsonb_typeof(p_limites) <> 'object' then raise exception 'Limites inválidos.'; end if;
  for k, v in select * from jsonb_each(p_limites) loop
    if k not in ('membros', 'administradores', 'clubes', 'fotos', 'armazenamento_mb') then
      raise exception 'Limite desconhecido: %.', k;
    end if;
    if jsonb_typeof(v) = 'null' then continue; end if;       -- vazio = ilimitado
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric < 0
       or (v #>> '{}')::numeric > 1000000000 then
      raise exception 'O limite de % precisa ser um número inteiro maior ou igual a zero (ou vazio para ilimitado).', k;
    end if;
    r := r || jsonb_build_object(k, (v #>> '{}')::bigint);
  end loop;
  return r;
end;
$$;
revoke all on function public._plano_limites_validar(jsonb) from public, anon, authenticated;

-- preços: lista de {ciclo:'mensal'|'anual', valor_centavos, pix_centavos?, parcelas_cartao?, parcela_centavos?} (no máximo 1 por ciclo)
create or replace function public._plano_precos_validar(p_precos jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare e jsonb; ciclos text[] := array[]::text[]; r jsonb := '[]'::jsonb; c text; v numeric; meta jsonb; x numeric;
begin
  if p_precos is null or jsonb_typeof(p_precos) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(p_precos) <> 'array' then raise exception 'Preços inválidos.'; end if;
  if jsonb_array_length(p_precos) > 2 then raise exception 'No máximo um preço por ciclo (mensal e anual).'; end if;
  for e in select * from jsonb_array_elements(p_precos) loop
    c := e ->> 'ciclo';
    if c not in ('mensal', 'anual') then raise exception 'Ciclo de preço inválido (use mensal ou anual).'; end if;
    if c = any (ciclos) then raise exception 'Preço repetido para o ciclo %.', c; end if;
    ciclos := array_append(ciclos, c);
    if jsonb_typeof(e -> 'valor_centavos') <> 'number' then raise exception 'Informe o valor do ciclo %.', c; end if;
    v := (e ->> 'valor_centavos')::numeric;
    if v <> trunc(v) or v < 0 or v > 100000000 then raise exception 'Valor inválido no ciclo %.', c; end if;
    meta := '{}'::jsonb;
    if e ? 'pix_centavos' and jsonb_typeof(e -> 'pix_centavos') = 'number' then
      x := (e ->> 'pix_centavos')::numeric;
      if x <> trunc(x) or x < 0 or x > v then raise exception 'O preço no Pix precisa ser um valor inteiro entre 0 e o valor cheio.'; end if;
      meta := meta || jsonb_build_object('pix_centavos', x::bigint);
    end if;
    if e ? 'parcelas_cartao' and jsonb_typeof(e -> 'parcelas_cartao') = 'number' then
      x := (e ->> 'parcelas_cartao')::numeric;
      if x <> trunc(x) or x < 1 or x > 12 then raise exception 'As parcelas no cartão vão de 1 a 12.'; end if;
      meta := meta || jsonb_build_object('parcelas_cartao', x::int);
      if e ? 'parcela_centavos' and jsonb_typeof(e -> 'parcela_centavos') = 'number' then
        meta := meta || jsonb_build_object('parcela_centavos', (e ->> 'parcela_centavos')::numeric::bigint);
      end if;
    end if;
    r := r || jsonb_build_array(jsonb_build_object('ciclo', c, 'valor_centavos', v::bigint, 'metadata', meta));
  end loop;
  return r;
end;
$$;
revoke all on function public._plano_precos_validar(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- listagem (agora com o metadata do preço)
create or replace function public.admin_planos_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select json_agg(json_build_object(
      'id', p.id, 'chave', p.chave, 'versao', p.versao, 'nome', p.nome, 'descricao', p.descricao,
      'publico', p.publico, 'status', p.status, 'ativo', p.ativo, 'provisorio', p.provisorio,
      'recursos', p.recursos, 'limites', p.limites, 'criado_em', p.created_at,
      'assinaturas', (select count(*) from public.subscriptions s where s.plan_id = p.id and s.status <> 'cancelada'),
      'assinaturas_total', (select count(*) from public.subscriptions s where s.plan_id = p.id),
      'precos', coalesce((select json_agg(json_build_object('ciclo', pr.ciclo, 'moeda', pr.moeda, 'valor_centavos', pr.valor_centavos,
                                          'ativo', pr.ativo, 'provisorio', pr.provisorio, 'vigente_de', pr.vigente_de,
                                          'vigente_ate', pr.vigente_ate, 'metadata', pr.metadata) order by pr.ciclo, pr.vigente_de desc)
                          from public.billing_prices pr where pr.plan_id = p.id), '[]'::json)
    ) order by p.chave, p.versao desc)
    from public.billing_plans p), '[]'::json);
end;
$$;

-- ---------------------------------------------------------------- salvar o rascunho (cria a versão nova se ainda não existe)
create or replace function public.admin_plano_rascunho_salvar(
  p_chave text, p_nome text, p_descricao text, p_publico boolean, p_limites jsonb, p_precos jsonb
) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public._exigir_admin_plataforma(); v_chave text := lower(btrim(coalesce(p_chave, '')));
  v_nome text := btrim(coalesce(p_nome, '')); v_desc text := btrim(coalesce(p_descricao, ''));
  v_lim jsonb; v_prec jsonb; v_pl public.billing_plans; v_base public.billing_plans; v_novo boolean := false; e jsonb;
begin
  if v_chave !~ '^[a-z][a-z0-9-]{1,39}$' then raise exception 'A chave do plano usa letras minúsculas, números e hífen (2 a 40 caracteres, começando por letra).'; end if;
  if v_chave = 'legado-fundador' then raise exception 'O plano do clube fundador não é editável por aqui.'; end if;
  if length(v_nome) < 3 or length(v_nome) > 60 then raise exception 'O nome do plano precisa ter de 3 a 60 caracteres.'; end if;
  if length(v_desc) > 400 then raise exception 'A descrição pode ter no máximo 400 caracteres.'; end if;
  if v_nome ~ '[<>]' or v_desc ~ '[<>]' then raise exception 'Não use < nem > nos textos.'; end if;
  v_lim := public._plano_limites_validar(p_limites);
  v_prec := public._plano_precos_validar(p_precos);

  select * into v_pl from public.billing_plans where chave = v_chave and status = 'rascunho' for update;
  if not found then
    select * into v_base from public.billing_plans where chave = v_chave order by versao desc limit 1;
    insert into public.billing_plans (chave, versao, nome, descricao, publico, status, ativo, recursos, limites, provisorio)
    values (v_chave, coalesce(v_base.versao, 0) + 1, v_nome, v_desc, coalesce(p_publico, true), 'rascunho', true,
            case when v_base.id is null then array[]::text[] else v_base.recursos end, v_lim, true)
    returning * into v_pl;
    v_novo := true;
  else
    update public.billing_plans set nome = v_nome, descricao = v_desc, publico = coalesce(p_publico, publico), limites = v_lim
     where id = v_pl.id returning * into v_pl;
  end if;

  delete from public.billing_prices where plan_id = v_pl.id;
  for e in select * from jsonb_array_elements(v_prec) loop
    insert into public.billing_prices (plan_id, moeda, ciclo, valor_centavos, ativo, provisorio, metadata)
    values (v_pl.id, 'BRL', e ->> 'ciclo', (e ->> 'valor_centavos')::bigint, true, true, e -> 'metadata');
  end loop;

  perform public._admin_auditar('plano_rascunho_salvar', 'plano', v_pl.id,
    jsonb_build_object('chave', v_chave, 'versao', v_pl.versao, 'novo_rascunho', v_novo, 'precos', v_prec, 'limites', v_lim));
  return public.admin_planos_listar();
end;
$$;
revoke all on function public.admin_plano_rascunho_salvar(text, text, text, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.admin_plano_rascunho_salvar(text, text, text, boolean, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- publicar o rascunho
create or replace function public.admin_plano_publicar(p_plano_id uuid, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pl public.billing_plans; v_vivas int := 0; v_sem_painel boolean;
begin
  perform public._exigir_admin_plataforma();
  select * into v_pl from public.billing_plans where id = p_plano_id for update;
  if not found then raise exception 'Plano não encontrado.'; end if;
  if v_pl.status <> 'rascunho' then raise exception 'Só um rascunho pode ser publicado.'; end if;
  if v_pl.publico and not exists (select 1 from public.billing_prices where plan_id = v_pl.id) then
    raise exception 'Informe ao menos um preço antes de publicar um plano que aparece na vitrine.';
  end if;
  v_sem_painel := v_pl.recursos is not null and cardinality(v_pl.recursos) = 0;
  if v_sem_painel then raise exception 'Escolha os painéis deste plano (em "Painéis do plano") antes de publicar.'; end if;

  update public.billing_plans set status = 'publicado', provisorio = false, ativo = true where id = v_pl.id;
  update public.billing_prices set vigente_de = now(), ativo = true, provisorio = false where plan_id = v_pl.id;
  select count(*) into v_vivas from public.subscriptions s join public.billing_plans o on o.id = s.plan_id
   where o.chave = v_pl.chave and o.id <> v_pl.id and s.status <> 'cancelada';

  perform public._admin_auditar('plano_publicar', 'plano', v_pl.id,
    jsonb_build_object('chave', v_pl.chave, 'versao', v_pl.versao, 'motivo', left(coalesce(p_motivo, ''), 300), 'assinaturas_na_versao_anterior', v_vivas));
  return jsonb_build_object('ok', true, 'chave', v_pl.chave, 'versao', v_pl.versao, 'ficam_na_versao_anterior', v_vivas);
end;
$$;
revoke all on function public.admin_plano_publicar(uuid, text) from public, anon;
grant execute on function public.admin_plano_publicar(uuid, text) to authenticated;

-- ---------------------------------------------------------------- descartar rascunho
create or replace function public.admin_plano_rascunho_descartar(p_plano_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_pl public.billing_plans;
begin
  perform public._exigir_admin_plataforma();
  select * into v_pl from public.billing_plans where id = p_plano_id for update;
  if not found then raise exception 'Plano não encontrado.'; end if;
  if v_pl.status <> 'rascunho' then raise exception 'Só um rascunho pode ser descartado (versão publicada nunca se apaga).'; end if;
  delete from public.billing_prices where plan_id = v_pl.id;
  delete from public.billing_plans where id = v_pl.id;
  perform public._admin_auditar('plano_rascunho_descartar', 'plano', v_pl.id, jsonb_build_object('chave', v_pl.chave, 'versao', v_pl.versao));
  return public.admin_planos_listar();
end;
$$;
revoke all on function public.admin_plano_rascunho_descartar(uuid) from public, anon;
grant execute on function public.admin_plano_rascunho_descartar(uuid) to authenticated;

-- ---------------------------------------------------------------- mostrar/ocultar na vitrine
create or replace function public.admin_plano_visibilidade_definir(p_plano_id uuid, p_publico boolean) returns json
language plpgsql security definer set search_path = '' as $$
declare v_pl public.billing_plans;
begin
  perform public._exigir_admin_plataforma();
  if p_publico is null then raise exception 'Informe se o plano aparece na vitrine.'; end if;
  select * into v_pl from public.billing_plans where id = p_plano_id for update;
  if not found then raise exception 'Plano não encontrado.'; end if;
  if v_pl.chave = 'legado-fundador' then raise exception 'O plano do clube fundador não é editável por aqui.'; end if;
  update public.billing_plans set publico = p_publico where id = v_pl.id;
  perform public._admin_auditar('plano_visibilidade', 'plano', v_pl.id, jsonb_build_object('chave', v_pl.chave, 'versao', v_pl.versao, 'publico', p_publico));
  return public.admin_planos_listar();
end;
$$;
revoke all on function public.admin_plano_visibilidade_definir(uuid, boolean) from public, anon;
grant execute on function public.admin_plano_visibilidade_definir(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- arquivar (sem assinatura viva)
create or replace function public.admin_plano_arquivar(p_plano_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_pl public.billing_plans; v_vivas int;
begin
  perform public._exigir_admin_plataforma();
  select * into v_pl from public.billing_plans where id = p_plano_id for update;
  if not found then raise exception 'Plano não encontrado.'; end if;
  if v_pl.chave = 'legado-fundador' then raise exception 'O plano do clube fundador não é editável por aqui.'; end if;
  if v_pl.status = 'rascunho' then raise exception 'Rascunho se descarta, não se arquiva.'; end if;
  select count(*) into v_vivas from public.subscriptions where plan_id = v_pl.id and status <> 'cancelada';
  if v_vivas > 0 then raise exception 'Há % assinatura(s) nesta versão. Mude-as de plano antes de arquivar.', v_vivas; end if;
  update public.billing_plans set status = 'arquivado', publico = false where id = v_pl.id;
  perform public._admin_auditar('plano_arquivar', 'plano', v_pl.id, jsonb_build_object('chave', v_pl.chave, 'versao', v_pl.versao, 'motivo', left(coalesce(p_motivo, ''), 300)));
  return public.admin_planos_listar();
end;
$$;
revoke all on function public.admin_plano_arquivar(uuid, text) from public, anon;
grant execute on function public.admin_plano_arquivar(uuid, text) to authenticated;

-- ---------------------------------------------------------------- excluir DEFINITIVAMENTE (só plano que NUNCA teve assinatura)
-- Versão que já teve assinatura (mesmo cancelada) nunca se apaga: histórico, faturas e auditoria apontam para ela. Só arquiva.
create or replace function public.admin_plano_excluir(p_plano_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_pl public.billing_plans; v_hist int;
begin
  perform public._exigir_admin_plataforma();
  select * into v_pl from public.billing_plans where id = p_plano_id for update;
  if not found then raise exception 'Plano não encontrado.'; end if;
  if v_pl.chave = 'legado-fundador' then raise exception 'O plano do clube fundador não é editável por aqui.'; end if;
  if v_pl.status = 'rascunho' then raise exception 'Rascunho se descarta, não se exclui.'; end if;
  select count(*) into v_hist from public.subscriptions where plan_id = v_pl.id;
  if v_hist > 0 then
    raise exception 'Esta versão já teve % assinatura(s) e não pode ser excluída (o histórico depende dela). Arquive-a.', v_hist;
  end if;
  perform public._admin_auditar('plano_excluir', 'plano', v_pl.id,
    jsonb_build_object('chave', v_pl.chave, 'versao', v_pl.versao, 'nome', v_pl.nome, 'motivo', left(coalesce(p_motivo, ''), 300)));
  delete from public.billing_prices where plan_id = v_pl.id;
  delete from public.billing_plans where id = v_pl.id;
  return public.admin_planos_listar();
end;
$$;
revoke all on function public.admin_plano_excluir(uuid, text) from public, anon;
grant execute on function public.admin_plano_excluir(uuid, text) to authenticated;

notify pgrst, 'reload schema';
