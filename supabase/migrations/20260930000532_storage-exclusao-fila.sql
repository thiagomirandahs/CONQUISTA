-- =============================================================================
-- 532 — PREVENIR NOVOS ARQUIVOS ÓRFÃOS NO STORAGE (fila de exclusão com carência)
-- =============================================================================
-- Causa (provada em produção, STORAGE-GC-AUDITORIA-88-E-INVENTARIO.md): apagar uma atividade (entregas.atividade_id on delete
-- cascade), uma foto do mural, trocar a foto de perfil ou reenviar uma entrega remove/troca a LINHA do banco, mas o ARQUIVO do
-- Storage fica para trás. O SQL não pode apagar arquivo físico (só a linha de storage.objects), então o desenho é:
--
--   1. GATILHOS (AFTER DELETE / AFTER UPDATE OF <coluna>) nas tabelas que guardam arquivo PRÓPRIO do usuário enfileiram o caminho
--      ANTIGO em public.storage_exclusao_fila. O caminho vem SEMPRE do valor que estava guardado no banco (normalizado a partir de
--      URL pública/assinada ou caminho puro) — nunca de parâmetro do cliente. NÃO existe RPC de enfileiramento para o app.
--   2. Nada é apagado na hora: o item espera uma CARÊNCIA (7 dias) e é REVERIFICADO no momento de processar (_storage_exclusao_processar):
--      sem nenhuma outra referência no catálogo (_storage_referencias, migration 531), objeto existe e é mais velho que a carência,
--      bucket elegível, dono do caminho = dono da linha (impede forjar caminho alheio). Só devolve o que passou em tudo.
--   3. Quem apaga o arquivo é a Edge Function `storage-excluir` (API do Storage, service_role). Ela confirma cada resultado ao banco
--      (_storage_exclusao_confirmar): 'excluido' só depois que a API confirmou; falha NÃO é escondida (estado 'falhou' + tentativas,
--      recuo crescente, teto de tentativas, registro em infra_falhas).
--   4. Cron NASCE DESLIGADO (mesmo padrão da 529). Ligar só com autorização do dono, depois da função publicada e do Vault configurado.
--
-- Esta migration é ADITIVA: cria 1 tabela, funções e gatilhos AFTER (que nunca falham a operação do usuário: erro dentro do gatilho
-- é engolido e registrado). Não altera dado existente, policy, bucket nem RPC do app. Os 88 arquivos já órfãos NÃO entram aqui
-- (continuam com o GC de STORAGE-GC-IMPLEMENTACAO.md).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Política (uma função só: gatilho, processamento e teste citam os mesmos números)
-- ---------------------------------------------------------------------------
create or replace function public._storage_exclusao_politica() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'carencia_dias', 7,                 -- tempo na fila antes de poder ser processado (nunca abaixo do mínimo do GC)
    'reserva_minutos', 10,              -- quanto tempo um lote reservado pela Edge Function fica "dela"
    'max_tentativas', 5,                -- falhas da API do Storage antes de virar 'falhou' (visível ao admin)
    'lote_maximo', 20,
    'buckets_elegiveis', jsonb_build_array('imagens', 'comprovacoes', 'comunidade', 'suporte-anexos')
    -- NUNCA elegíveis: publico, parceiros, documentos-emitidos, assinaturas-desenhadas (documento emitido, assinatura, marca)
  );
$$;
revoke all on function public._storage_exclusao_politica() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. A fila. Só service_role/postgres mexem (RLS ligado, sem policy, sem grant).
--    Sem dado pessoal além do caminho (que já tem o id do dono): a mensagem é um CÓDIGO curto, nunca texto livre do erro.
-- ---------------------------------------------------------------------------
create table if not exists public.storage_exclusao_fila (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (length(bucket) between 1 and 63),
  caminho text not null check (length(caminho) between 1 and 512),
  origem text not null check (length(origem) <= 80),             -- tabela.coluna que apontava para o arquivo
  motivo text not null check (motivo in ('apagado', 'trocado')),  -- a linha foi apagada ou o valor foi trocado
  dono_linha uuid,                                                -- dono da LINHA (usuario_id/autor_id/id) no momento do evento
  dono_confere boolean not null default false,                    -- o caminho pertence ao dono da linha? (anti-forja)
  enfileirada_em timestamptz not null default now(),
  processar_apos timestamptz not null,
  estado text not null default 'pendente' check (estado in ('pendente', 'excluido', 'mantido', 'falhou')),
  tentativas int not null default 0,
  ultima_mensagem text check (ultima_mensagem is null or length(ultima_mensagem) <= 120),
  reservado_ate timestamptz,
  resolvida_em timestamptz,
  atualizada_em timestamptz not null default now(),
  unique (bucket, caminho)
);
create index if not exists storage_exclusao_fila_devidas_idx on public.storage_exclusao_fila (processar_apos) where estado = 'pendente';
alter table public.storage_exclusao_fila enable row level security;
revoke all on public.storage_exclusao_fila from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. O caminho pertence ao dono da linha?
--    Formatos reais: <uid>/<tipo>/<ts>.ext · <clube>/<uid>/... · perfis/<uid>-<ts>.ext · mural/<uid>-<ts>.ext ·
--    atividades/<uid>-<ts>.ext (legado) · unidades/<unidade>-<campo>-<ts>.ext. Regra: o 1º ou o 2º segmento é o dono, ou começa
--    com "<dono>-". Quem forja foto_url apontando para o arquivo de OUTRA pessoa nunca satisfaz isto (o id no caminho é o da vítima).
-- ---------------------------------------------------------------------------
create or replace function public._storage_exclusao_dono_confere(p_caminho text, p_dono uuid) returns boolean
language sql immutable set search_path = '' as $$
  select p_dono is not null and p_caminho is not null and exists (
    select 1
      from (select split_part(p_caminho, '/', 1) as s1, split_part(p_caminho, '/', 2) as s2) s
     where s.s1 = p_dono::text or s.s1 like p_dono::text || '-%'
        or s.s2 = p_dono::text or s.s2 like p_dono::text || '-%'
  );
$$;
revoke all on function public._storage_exclusao_dono_confere(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enfileirar (interno: só os gatilhos chamam; ninguém da API executa)
-- ---------------------------------------------------------------------------
create or replace function public._storage_exclusao_enfileirar(
  p_valor text, p_bucket_padrao text, p_origem text, p_motivo text, p_dono uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_pol jsonb := public._storage_exclusao_politica();
  v_chave text; v_bucket text; v_caminho text; v_conf boolean;
  v_dias int := greatest((v_pol ->> 'carencia_dias')::int, (public._storage_gc_politica() -> 'carencia_minima_dias')::int);
begin
  v_chave := public._storage_ref_chave(p_valor, p_bucket_padrao);       -- URL externa/rota interna/vazio => null
  if v_chave is null or strpos(v_chave, '/') = 0 then return false; end if;
  v_bucket := split_part(v_chave, '/', 1);
  v_caminho := substr(v_chave, strpos(v_chave, '/') + 1);
  if not ((v_pol -> 'buckets_elegiveis') ? v_bucket) then return false; end if;      -- bucket protegido/desconhecido: nem entra
  if v_caminho = '' or length(v_caminho) > 512 or v_caminho ~ '(^/|//|/$)' or v_caminho ~ '(^|/)\.\.?(/|$)'
     or v_caminho ~ '[[:cntrl:]\\]' then return false; end if;
  v_conf := public._storage_exclusao_dono_confere(v_caminho, p_dono);

  insert into public.storage_exclusao_fila as f (bucket, caminho, origem, motivo, dono_linha, dono_confere, processar_apos)
  values (v_bucket, v_caminho, left(p_origem, 80), p_motivo, p_dono, v_conf, now() + make_interval(days => v_dias))
  on conflict (bucket, caminho) do update
     set estado = 'pendente',
         tentativas = case when f.estado = 'pendente' then f.tentativas else 0 end,
         ultima_mensagem = case when f.estado = 'pendente' then f.ultima_mensagem else null end,
         resolvida_em = null,
         reservado_ate = case when f.estado = 'pendente' then f.reservado_ate else null end,
         processar_apos = case when f.estado = 'pendente' then greatest(f.processar_apos, excluded.processar_apos) else excluded.processar_apos end,
         origem = excluded.origem, motivo = excluded.motivo, enfileirada_em = now(), atualizada_em = now(),
         -- uma alegação VÁLIDA de dono vale; uma forjada nunca derruba uma válida nem promove uma inválida
         dono_confere = f.dono_confere or excluded.dono_confere,
         dono_linha = case when excluded.dono_confere then excluded.dono_linha else f.dono_linha end;
  return true;
end $$;
revoke all on function public._storage_exclusao_enfileirar(text, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Gatilho genérico. Argumentos: TG_ARGV[0] = coluna do dono da linha; TG_ARGV[1..] = 'coluna:bucket-padrão'.
--    NUNCA falha a operação do usuário: qualquer erro aqui é engolido e vira registro em infra_falhas.
--    Não enfileira se o MESMO valor ainda está em outra linha/coluna da própria tabela (barato; o resto é conferido ao processar).
-- ---------------------------------------------------------------------------
create or replace function public._storage_exclusao_gatilho() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
  v_dono uuid;
  a text; v_col text; v_bucket text; v_antigo text; v_ainda boolean; v_col2 text;
begin
  begin
    begin v_dono := nullif(v_old ->> tg_argv[0], '')::uuid; exception when others then v_dono := null; end;
    for i in 1 .. coalesce(array_length(tg_argv, 1), 1) - 1 loop
      a := tg_argv[i];
      v_col := split_part(a, ':', 1); v_bucket := nullif(split_part(a, ':', 2), '');
      v_antigo := nullif(btrim(coalesce(v_old ->> v_col, '')), '');
      if v_antigo is null then continue; end if;
      if tg_op = 'UPDATE' and v_antigo is not distinct from nullif(btrim(coalesce(v_new ->> v_col, '')), '') then continue; end if;
      -- o valor antigo ainda está em OUTRA coluna da linha nova, ou em outra linha da tabela?
      v_ainda := false;
      if tg_op = 'UPDATE' then
        for j in 1 .. array_length(tg_argv, 1) - 1 loop
          v_col2 := split_part(tg_argv[j], ':', 1);
          if v_col2 <> v_col and nullif(btrim(coalesce(v_new ->> v_col2, '')), '') = v_antigo then v_ainda := true; end if;
        end loop;
      end if;
      if not v_ainda then
        for j in 1 .. array_length(tg_argv, 1) - 1 loop
          v_col2 := split_part(tg_argv[j], ':', 1);
          execute format('select exists (select 1 from public.%I where %I = $1)', tg_table_name, v_col2) into v_ainda using v_antigo;
          exit when v_ainda;
        end loop;
      end if;
      if v_ainda then continue; end if;
      perform public._storage_exclusao_enfileirar(v_antigo, v_bucket, tg_table_name || '.' || v_col,
        case when tg_op = 'DELETE' then 'apagado' else 'trocado' end, v_dono);
    end loop;
  exception when others then
    begin
      insert into public.infra_falhas (origem, detalhe) values ('storage/exclusao-gatilho', left('gatilho ' || tg_table_name || ': ' || sqlstate, 200));
    exception when others then null;
    end;
  end;
  return null;
end $$;
revoke all on function public._storage_exclusao_gatilho() from public, anon, authenticated;

-- Quem enfileira (dono da linha; bucket padrão quando o valor é caminho puro). Valor em URL do Storage ignora o padrão.
drop trigger if exists zz_storage_exclusao_fotos on public.fotos;
create trigger zz_storage_exclusao_fotos after delete or update of url, thumb on public.fotos
  for each row execute function public._storage_exclusao_gatilho('autor_id', 'url:imagens', 'thumb:imagens');
drop trigger if exists zz_storage_exclusao_entregas on public.entregas;
create trigger zz_storage_exclusao_entregas after delete or update of foto_url on public.entregas
  for each row execute function public._storage_exclusao_gatilho('usuario_id', 'foto_url:comprovacoes');
drop trigger if exists zz_storage_exclusao_missoes_feitas on public.missoes_feitas;
create trigger zz_storage_exclusao_missoes_feitas after delete or update of foto_url on public.missoes_feitas
  for each row execute function public._storage_exclusao_gatilho('usuario_id', 'foto_url:comprovacoes');
drop trigger if exists zz_storage_exclusao_devocional on public.devocional;
create trigger zz_storage_exclusao_devocional after delete or update of foto_url on public.devocional
  for each row execute function public._storage_exclusao_gatilho('usuario_id', 'foto_url:comprovacoes');
drop trigger if exists zz_storage_exclusao_profiles on public.profiles;
create trigger zz_storage_exclusao_profiles after delete or update of foto on public.profiles
  for each row execute function public._storage_exclusao_gatilho('id', 'foto:imagens');
drop trigger if exists zz_storage_exclusao_unidades on public.unidades;
create trigger zz_storage_exclusao_unidades after delete or update of emblema, bandeira on public.unidades
  for each row execute function public._storage_exclusao_gatilho('id', 'emblema:imagens', 'bandeira:imagens');

-- ---------------------------------------------------------------------------
-- 5. PROCESSAR (Edge Function / cron, service_role): reserva um lote de itens vencidos, REVERIFICA cada um e devolve só os
--    excluíveis. O SQL nunca apaga arquivo físico. Itens que falharam na reverificação são RESOLVIDOS aqui ('mantido' + código).
--    Duas execuções simultâneas nunca pegam o mesmo item (FOR UPDATE SKIP LOCKED + reservado_ate).
--    Códigos de 'mantido': bucket_nao_elegivel, caminho_invalido, dono_diferente, objeto_ausente, referenciado,
--      em_fila_de_remocao, clube_na_lixeira, <outra categoria do GC que não seja candidata segura>.
--    Objeto novo demais ('recente') continua 'pendente' e volta quando completar a carência.
-- ---------------------------------------------------------------------------
create or replace function public._storage_exclusao_processar(p_limite int default 8)
returns table (bucket text, caminho text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_pol jsonb := public._storage_exclusao_politica();
  v_dias int := greatest((v_pol ->> 'carencia_dias')::int, (public._storage_gc_politica() -> 'carencia_minima_dias')::int);
  v_lim int := least(greatest(coalesce(p_limite, 8), 1), (v_pol ->> 'lote_maximo')::int);
  v_lote jsonb;
  r jsonb; v_id uuid; v_b text; v_c text; v_obj record; v_fonte jsonb := '[]'::jsonb; v_motivo text; f record;
begin
  with c as (
    select q.id from public.storage_exclusao_fila q
     where q.estado = 'pendente' and q.processar_apos <= now() and (q.reservado_ate is null or q.reservado_ate < now())
     order by q.processar_apos
     limit v_lim
     for update skip locked
  ), u as (
    update public.storage_exclusao_fila q
       set reservado_ate = now() + make_interval(mins => (v_pol ->> 'reserva_minutos')::int), atualizada_em = now()
      from c where q.id = c.id
    returning q.id, q.bucket, q.caminho, q.dono_confere
  )
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_lote from u;

  -- 1) verificações que não precisam do catálogo
  for r in select * from jsonb_array_elements(v_lote) loop
    v_id := (r ->> 'id')::uuid; v_b := r ->> 'bucket'; v_c := r ->> 'caminho'; v_motivo := null;
    if not ((v_pol -> 'buckets_elegiveis') ? v_b) then v_motivo := 'bucket_nao_elegivel';
    elsif v_c ~ '(^/|//|/$)' or v_c ~ '(^|/)\.\.?(/|$)' or v_c ~ '[[:cntrl:]\\]' then v_motivo := 'caminho_invalido';
    elsif not (r ->> 'dono_confere')::boolean then v_motivo := 'dono_diferente';
    else
      select o.created_at as criado_em, coalesce((o.metadata ->> 'size')::bigint, 0) as bytes into v_obj
        from storage.objects o where o.bucket_id = v_b and o.name = v_c;
      if not found then v_motivo := 'objeto_ausente'; end if;
    end if;
    if v_motivo is not null then
      update public.storage_exclusao_fila q set estado = 'mantido', ultima_mensagem = v_motivo, reservado_ate = null,
             resolvida_em = now(), atualizada_em = now() where q.id = v_id;
    else
      v_fonte := v_fonte || jsonb_build_object('bucket', v_b, 'name', v_c, 'bytes', v_obj.bytes, 'criado_em', v_obj.criado_em);
    end if;
  end loop;

  -- 2) catálogo completo, UMA passada para o lote todo (referências em qualquer tabela/JSON/histórico, carência do objeto, clube)
  if jsonb_array_length(v_fonte) > 0 then
    for f in select * from public._storage_gc_fatos(v_fonte, v_dias) loop
      select q.id into v_id from public.storage_exclusao_fila q where q.bucket = f.bucket and q.caminho = f.name;
      if f.categoria in ('orfao', 'clube_expurgado') then
        bucket := f.bucket; caminho := f.name; return next;                -- continua reservado até a Edge Function confirmar
      elsif f.categoria = 'recente' then
        update public.storage_exclusao_fila q
           set processar_apos = greatest(now() + interval '1 hour', f.criado_em + make_interval(days => v_dias)),
               reservado_ate = null, atualizada_em = now()
         where q.id = v_id;
      else
        update public.storage_exclusao_fila q
           set estado = 'mantido', ultima_mensagem = left(f.categoria, 60), reservado_ate = null, resolvida_em = now(), atualizada_em = now()
         where q.id = v_id;
      end if;
    end loop;
  end if;
  return;
end $$;
revoke all on function public._storage_exclusao_processar(int) from public, anon, authenticated;
grant execute on function public._storage_exclusao_processar(int) to service_role;

-- ---------------------------------------------------------------------------
-- 6. CONFIRMAR (Edge Function): o resultado da API do Storage. Idempotente. 'excluido' só aqui, e só para item que o processador
--    entregou (reservado). A mensagem é limpa (sem uuid/caminho) e cortada: nunca dado pessoal.
--    Falha: tentativas+1, recuo 1h·2^(n-1) (1h, 2h, 4h, 8h), ao atingir o teto vira 'falhou' e é registrada em infra_falhas.
-- ---------------------------------------------------------------------------
create or replace function public._storage_exclusao_confirmar(p_bucket text, p_caminho text, p_ok boolean, p_msg text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_pol jsonb := public._storage_exclusao_politica();
  q public.storage_exclusao_fila;
  v_msg text := left(regexp_replace(regexp_replace(coalesce(p_msg, ''), '[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}', '<id>', 'g'), '[^A-Za-z0-9_ .:<>-]', '', 'g'), 120);
  v_tent int;
begin
  select * into q from public.storage_exclusao_fila f where f.bucket = p_bucket and f.caminho = p_caminho for update;
  if not found then return 'inexistente'; end if;
  if q.estado <> 'pendente' then return q.estado; end if;                       -- já resolvido: idempotente
  if q.reservado_ate is null then return 'nao_reservado'; end if;               -- nunca foi entregue pelo processador: não vale
  if coalesce(p_ok, false) then
    update public.storage_exclusao_fila f set estado = 'excluido', ultima_mensagem = nullif(v_msg, ''), reservado_ate = null,
           resolvida_em = now(), atualizada_em = now() where f.id = q.id;
    return 'excluido';
  end if;
  v_tent := q.tentativas + 1;
  if v_tent >= (v_pol ->> 'max_tentativas')::int then
    update public.storage_exclusao_fila f set estado = 'falhou', tentativas = v_tent, ultima_mensagem = coalesce(nullif(v_msg, ''), 'erro'),
           reservado_ate = null, resolvida_em = now(), atualizada_em = now() where f.id = q.id;
    insert into public.infra_falhas (origem, detalhe)
    values ('storage/exclusao', left('exclusão do Storage falhou ' || v_tent || ' vezes (bucket ' || q.bucket || '): ' || coalesce(nullif(v_msg, ''), 'erro'), 300));
    return 'falhou';
  end if;
  update public.storage_exclusao_fila f set tentativas = v_tent, ultima_mensagem = coalesce(nullif(v_msg, ''), 'erro'), reservado_ate = null,
         processar_apos = now() + make_interval(hours => (power(2, v_tent - 1))::int), atualizada_em = now() where f.id = q.id;
  return 'pendente';
end $$;
revoke all on function public._storage_exclusao_confirmar(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public._storage_exclusao_confirmar(text, text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Visibilidade para o admin da plataforma (sem caminho, sem dado pessoal): contagens por estado/motivo e falhas.
-- ---------------------------------------------------------------------------
create or replace function public.admin_storage_exclusao_resumo() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return jsonb_build_object(
    'por_estado', coalesce((select jsonb_object_agg(estado, n) from (select estado, count(*) n from public.storage_exclusao_fila group by estado) x), '{}'::jsonb),
    'por_motivo_mantido', coalesce((select jsonb_object_agg(coalesce(ultima_mensagem, '?'), n) from
        (select ultima_mensagem, count(*) n from public.storage_exclusao_fila where estado = 'mantido' group by ultima_mensagem) x), '{}'::jsonb),
    'por_bucket_pendente', coalesce((select jsonb_object_agg(bucket, n) from
        (select bucket, count(*) n from public.storage_exclusao_fila where estado = 'pendente' group by bucket) x), '{}'::jsonb),
    'vencidas_agora', (select count(*) from public.storage_exclusao_fila where estado = 'pendente' and processar_apos <= now()),
    'falhas', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'origem', origem, 'tentativas', tentativas,
        'mensagem', ultima_mensagem, 'quando', atualizada_em) order by atualizada_em desc)
        from (select * from public.storage_exclusao_fila where estado = 'falhou' order by atualizada_em desc limit 20) z), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_storage_exclusao_resumo() from public, anon;
grant execute on function public.admin_storage_exclusao_resumo() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Rotina do cron: se há item vencido e o Vault tem 'storage_excluir_url' + 'storage_excluir_secret', chama a Edge Function
--    por pg_net. Sem eles só registra em infra_falhas (no máximo 1 aviso por hora). NASCE DESLIGADA.
-- ---------------------------------------------------------------------------
create or replace function public.storage_exclusao_rotina() returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_segredo text;
begin
  if not exists (select 1 from public.storage_exclusao_fila where estado = 'pendente' and processar_apos <= now()
                    and (reservado_ate is null or reservado_ate < now())) then return; end if;
  begin
    select decrypted_secret into v_url     from vault.decrypted_secrets where name = 'storage_excluir_url';
    select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'storage_excluir_secret';
  exception when others then v_url := null;
  end;
  if v_url is null or v_segredo is null then
    if not exists (select 1 from public.infra_falhas where origem = 'storage/exclusao-config' and quando > now() - interval '1 hour') then
      insert into public.infra_falhas (origem, detalhe)
      values ('storage/exclusao-config', 'sem storage_excluir_url/storage_excluir_secret no Vault: fila com itens vencidos, Edge Function storage-excluir não chamada');
    end if;
    return;
  end if;
  perform net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-storage-excluir-secret', v_segredo),
    body := '{}'::jsonb, timeout_milliseconds := 10000);
end $$;
revoke all on function public.storage_exclusao_rotina() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'storage-excluir';
    perform cron.schedule('storage-excluir', '*/15 * * * *', 'select public.storage_exclusao_rotina()');
    -- NASCE DESLIGADO (decisão do dono, Fase 9). Ligar só depois de: função publicada + secret + Vault + autorização:
    --   select cron.alter_job((select jobid from cron.job where jobname = 'storage-excluir'), active := true);
    perform cron.alter_job((select jobid from cron.job where jobname = 'storage-excluir'), active := false);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Trava de schema do GC (teste 135): a fila tem colunas "de caminho", mas NÃO mantém arquivo vivo (não é referência de uso).
--    Redefine a lista de exceções da 531 (idêntica + 2 linhas). Quem acrescentar exceção depois mexe nesta função de novo.
-- ---------------------------------------------------------------------------
create or replace function public._storage_referencias_excecoes()
returns table (tabela text, coluna text, motivo text)
language sql immutable set search_path = '' as $$
  select * from (values
    ('class_requirements', 'evidencia_obrigatoria', 'booleano de regra do currículo'),
    ('class_requirements', 'tipo_evidencia', 'tipo (texto/foto) da regra, não caminho'),
    ('specialty_requirements', 'evidencia_obrigatoria', 'booleano de regra do currículo'),
    ('specialty_requirements', 'tipo_evidencia', 'tipo da regra, não caminho'),
    ('classes', 'fonte_url', 'URL externa da fonte oficial do currículo'),
    ('curriculum_versions', 'fonte_url', 'URL externa da fonte do currículo'),
    ('curriculum_versions', 'fonte_arquivo', 'nome do arquivo do manifesto no repositório, não do Storage'),
    ('dynamic_content_values', 'fonte_url', 'URL externa da fonte'),
    ('dynamic_content_values', 'manifesto_arquivo', 'nome de arquivo do manifesto no repositório'),
    ('especialidades_catalogo', 'fonte_url', 'URL externa da fonte (MDA Wiki)'),
    ('mestrados_catalogo', 'fonte_url', 'URL externa da fonte'),
    ('specialties', 'fonte_url', 'URL externa da fonte'),
    ('specialty_requirements', 'fonte_url', 'URL externa da fonte'),
    ('leitura_materiais', 'pdf_fonte_licenca', 'texto da licença do PDF, não caminho'),
    ('class_documents', 'pdf_hash', 'hash do PDF, não caminho (o caminho está em pdf_storage_path)'),
    ('document_final_renders', 'pdf_hash', 'hash do PDF, não caminho'),
    ('document_signatures', 'pdf_hash', 'hash do PDF, não caminho'),
    ('comunidade_posts', 'foto_alt', 'texto alternativo da foto'),
    ('experience_stages', 'evidencia', 'texto da etapa da experiência (regra), não caminho'),
    ('member_requirements', 'evidencia_texto', 'texto escrito pela criança'),
    ('member_specialty_requirements', 'evidencia_texto', 'texto escrito pela criança'),
    ('requirement_submissions', 'evidencia_texto', 'texto histórico da tentativa'),
    ('requirement_submissions', 'tipo_evidencia_entregue', 'tipo (texto/foto), não caminho'),
    ('specialty_requirement_submissions', 'evidencia_texto', 'texto histórico da tentativa'),
    ('specialty_requirement_submissions', 'tipo_evidencia_entregue', 'tipo, não caminho'),
    ('profiles', 'avatar_tipo', 'rótulo (personagem|foto), não caminho'),
    ('club_storage_objetos', 'bucket_id', 'razão de cota: espelha storage.objects, não é referência de uso'),
    ('rede_limpeza_log', 'arquivos', 'contador'),
    ('migracoes_aplicadas', 'arquivo', 'nome do arquivo de migration'),
    ('club_badges', 'icone', 'chave de ícone/emoji do app'),
    ('recursos_catalogo', 'icone', 'chave de ícone/emoji do app'),
    ('notificacoes', 'link', 'rota interna do app'),
    ('site_partners', 'link', 'link externo do parceiro'),
    ('club_showcase', 'link_inscricao', 'rota/URL de inscrição, não arquivo'),
    ('desafios', 'pede_foto', 'booleano de regra'),
    ('imagem_saneamento', 'bucket', 'fila de saneamento (529): aponta objeto já referenciado por outra tabela; não mantém objeto vivo'),
    ('imagem_saneamento', 'caminho', 'fila de saneamento (529): aponta objeto já referenciado por outra tabela; não mantém objeto vivo'),
    ('storage_exclusao_fila', 'bucket', 'fila de exclusão (532): aponta objeto já sem referência; não mantém objeto vivo'),
    ('storage_exclusao_fila', 'caminho', 'fila de exclusão (532): aponta objeto já sem referência; não mantém objeto vivo'),
    ('plataforma_acesso_log', 'bucket', 'nome do bucket no log de acesso do admin (530), não caminho; o log nunca guarda o caminho físico')
  ) v(tabela, coluna, motivo);
$$;
revoke all on function public._storage_referencias_excecoes() from public, anon, authenticated;

select public._manutencao_instalar_guarda();

notify pgrst, 'reload schema';
