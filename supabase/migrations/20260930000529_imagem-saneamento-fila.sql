-- =============================================================================
-- 529 — FILA DE SANEAMENTO DE IMAGENS NO SERVIDOR (EXIF/GPS/metadados)
-- =============================================================================
-- O app já tira EXIF no cliente (canvas), mas um cliente adulterado pode subir o original direto no Storage e o Postgres não
-- enxerga o conteúdo do arquivo. Esta migration cria a FILA por objeto de Storage; quem lê o arquivo, remove os metadados e
-- regrava no MESMO caminho é a Edge Function `sanear-imagens` (service_role), com o núcleo puro
-- supabase/functions/_compartilhado/sanear-imagem.ts. Desenho completo: IMAGENS-SANEAMENTO-DESENHO.md.
--
--  * ADITIVA: não muda bucket, caminho, policy nem RPC existente; nenhuma linha imutável (histórico/snapshot) é tocada —
--    só o ARQUIVO é regravado, sem mudar o caminho que o banco guarda.
--  * Estados: pendente | ok | falhou | ignorado (HEIC/GIF/grande/arquivo sumiu). Falha fecha: o objeto continua só visível a
--    quem já podia vê-lo; fica 'pendente' (com recuo) até 3 tentativas e depois 'falhou'.
--  * Quem enfileira: (a) o app, best-effort, logo após o upload (RPC `imagem_saneamento_enfileirar`: só o PRÓPRIO objeto,
--    no formato de caminho que as policies de upload exigem); (b) a varredura (`imagem_saneamento_varrer`, pelo cron), que pega
--    o que um cliente adulterado subiu SEM chamar a RPC.
--  * Versão do objeto = storage.objects.updated_at: um upload novo no mesmo caminho volta o item para 'pendente'.
--  * Sem dado pessoal na fila além do caminho do objeto (que já tem o id do dono) — nada de nome, legenda ou conteúdo.
--  * Ninguém além de service_role (e do cron/postgres) executa as rotinas internas; anon não executa nada daqui.
-- =============================================================================

create table if not exists public.imagem_saneamento (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.organizational_units(id) on delete set null,   -- só informativo (nem todo caminho legado tem clube)
  bucket text not null check (bucket in ('imagens', 'comprovacoes', 'comunidade', 'suporte-anexos')),
  caminho text not null check (length(caminho) between 3 and 512),
  estado text not null default 'pendente' check (estado in ('pendente', 'ok', 'falhou', 'ignorado')),
  motivo text check (motivo is null or length(motivo) <= 60),                   -- código curto (ja_limpa, saneada, heic_nao_suportado...)
  tentativas int not null default 0,
  bytes_antes bigint,
  bytes_depois bigint,
  dono_id uuid,                                                                 -- dono do objeto no Storage (para restaurar o owner após regravar)
  objeto_versao timestamptz,                                                    -- storage.objects.updated_at visto ao enfileirar
  proxima_em timestamptz not null default now(),                                -- recuo entre tentativas
  reservado_ate timestamptz,                                                    -- reserva do lote em processamento (expira sozinha)
  enfileirada_em timestamptz not null default now(),
  saneada_em timestamptz,
  updated_at timestamptz not null default now(),
  unique (bucket, caminho)
);
create index if not exists imagem_saneamento_pendentes_idx on public.imagem_saneamento (proxima_em) where estado = 'pendente';
alter table public.imagem_saneamento enable row level security;
revoke all on public.imagem_saneamento from public, anon, authenticated;

-- -----------------------------------------------------------------------------
--  Internos
-- -----------------------------------------------------------------------------
-- Versão do objeto no Storage (null se não existe).
create or replace function public._imagem_saneamento_versao(p_bucket text, p_caminho text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce(o.updated_at, o.created_at) from storage.objects o where o.bucket_id = p_bucket and o.name = p_caminho;
$$;
revoke all on function public._imagem_saneamento_versao(text, text) from public, anon, authenticated;

-- Clube do caminho quando o 1º segmento é o id de um clube (comunidade, comprovações novas); null nos formatos legados.
create or replace function public._imagem_saneamento_clube(p_caminho text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.organizational_units u where u.id::text = split_part(coalesce(p_caminho, ''), '/', 1);
$$;
revoke all on function public._imagem_saneamento_clube(text) from public, anon, authenticated;

-- Quem pode enfileirar/consultar: o DONO do objeto, no formato de caminho que as policies de upload já exigem.
create or replace function public._imagem_saneamento_pode(p_bucket text, p_caminho text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid;
begin
  if v_uid is null or p_bucket is null or p_caminho is null or length(p_caminho) > 512 then return false; end if;
  v_club := public.clube_atual_id();
  if p_bucket = 'comunidade' then
    return v_club is not null and p_caminho ~ ('^' || v_club::text || '/' || v_uid::text || '/[0-9a-f-]{36}\.(jpg|webp)$');
  elsif p_bucket = 'comprovacoes' then
    return p_caminho ~ ('^' || v_uid::text || '/[^/].*$')
        or (v_club is not null and p_caminho ~ ('^' || v_club::text || '/' || v_uid::text || '/[^/].*$'));
  elsif p_bucket = 'suporte-anexos' then
    return p_caminho ~ ('^' || v_uid::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$');
  elsif p_bucket = 'imagens' then
    return public.pode_subir_imagem(p_caminho);      -- perfis/, mural/, missoes/, atividades/ (próprio) e unidades/ (liderança)
  end if;
  return false;
end;
$$;
revoke all on function public._imagem_saneamento_pode(text, text) from public, anon, authenticated;

-- A imagem já foi saneada E ninguém regravou o arquivo depois? (porta para a Rede: foto só vai ao ar saneada.)
create or replace function public._imagem_saneamento_liberada(p_bucket text, p_caminho text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.imagem_saneamento s
     where s.bucket = p_bucket and s.caminho = p_caminho and s.estado = 'ok' and s.saneada_em is not null
       and coalesce((select coalesce(o.updated_at, o.created_at) from storage.objects o where o.bucket_id = s.bucket and o.name = s.caminho), s.saneada_em) <= s.saneada_em
  );
$$;
revoke all on function public._imagem_saneamento_liberada(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
--  App (authenticated): só o PRÓPRIO objeto. Mensagem única: não vaza se o objeto existe.
-- -----------------------------------------------------------------------------
create or replace function public.imagem_saneamento_enfileirar(p_bucket text, p_caminho text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ver timestamptz; v_dono uuid; v_estado text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  if not public._imagem_saneamento_pode(p_bucket, p_caminho) then raise exception 'Objeto inválido.'; end if;
  select coalesce(o.updated_at, o.created_at), public.dono_do_objeto(o.owner, o.owner_id) into v_ver, v_dono
    from storage.objects o where o.bucket_id = p_bucket and o.name = p_caminho;
  if v_ver is null then raise exception 'Objeto inválido.'; end if;

  insert into public.imagem_saneamento (club_id, bucket, caminho, dono_id, objeto_versao)
  values (public._imagem_saneamento_clube(p_caminho), p_bucket, p_caminho, v_dono, v_ver)
  on conflict (bucket, caminho) do nothing;

  -- arquivo regravado depois do último saneamento: volta para a fila (idempotente quando nada mudou)
  update public.imagem_saneamento
     set estado = 'pendente', motivo = null, tentativas = 0, objeto_versao = v_ver, proxima_em = now(), reservado_ate = null,
         dono_id = coalesce(v_dono, dono_id), updated_at = now()
   where bucket = p_bucket and caminho = p_caminho and objeto_versao is distinct from v_ver;

  select estado into v_estado from public.imagem_saneamento where bucket = p_bucket and caminho = p_caminho;
  return jsonb_build_object('ok', true, 'estado', v_estado);
end;
$$;
revoke all on function public.imagem_saneamento_enfileirar(text, text) from public, anon;
grant execute on function public.imagem_saneamento_enfileirar(text, text) to authenticated;

-- Estado do PRÓPRIO objeto ('nenhum' se nunca foi enfileirado).
create or replace function public.imagem_saneamento_estado(p_bucket text, p_caminho text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  if not public._imagem_saneamento_pode(p_bucket, p_caminho) then raise exception 'Objeto inválido.'; end if;
  return coalesce((select s.estado from public.imagem_saneamento s where s.bucket = p_bucket and s.caminho = p_caminho), 'nenhum');
end;
$$;
revoke all on function public.imagem_saneamento_estado(text, text) from public, anon;
grant execute on function public.imagem_saneamento_estado(text, text) to authenticated;

-- -----------------------------------------------------------------------------
--  Edge Function (service_role): reservar lote, conferir versão, marcar resultado
-- -----------------------------------------------------------------------------
create or replace function public.imagem_saneamento_pendentes(p_limite int default 8)
returns table (id uuid, bucket text, caminho text, versao timestamptz, bytes bigint)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with c as (
    select s0.id from public.imagem_saneamento s0
     where s0.estado = 'pendente' and s0.proxima_em <= now() and (s0.reservado_ate is null or s0.reservado_ate < now())
     order by s0.proxima_em
     limit least(greatest(coalesce(p_limite, 8), 1), 20)
     for update skip locked
  )
  update public.imagem_saneamento s
     set reservado_ate = now() + interval '5 minutes', updated_at = now()
    from c
   where s.id = c.id
  returning s.id, s.bucket, s.caminho, s.objeto_versao,
            (select nullif(o.metadata ->> 'size', '')::bigint from storage.objects o where o.bucket_id = s.bucket and o.name = s.caminho);
end;
$$;
revoke all on function public.imagem_saneamento_pendentes(int) from public, anon, authenticated;
grant execute on function public.imagem_saneamento_pendentes(int) to service_role;

-- O arquivo ainda é a versão que reservamos? (conferir ANTES de regravar: não pisar num upload mais novo)
create or replace function public.imagem_saneamento_conferir(p_id uuid, p_versao timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.imagem_saneamento s
      join storage.objects o on o.bucket_id = s.bucket and o.name = s.caminho
     where s.id = p_id and s.objeto_versao is not distinct from p_versao and coalesce(o.updated_at, o.created_at) is not distinct from p_versao
  );
$$;
revoke all on function public.imagem_saneamento_conferir(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.imagem_saneamento_conferir(uuid, timestamptz) to service_role;

-- Resultado do processamento. Devolve o estado final ('pendente' = vai tentar de novo; 'versao_mudou' = o arquivo foi
-- regravado no meio e o item continua na fila para a versão nova).
create or replace function public.imagem_saneamento_marcar(
  p_id uuid, p_estado text, p_motivo text default null, p_versao timestamptz default null,
  p_bytes_antes bigint default null, p_bytes_depois bigint default null, p_reescrito boolean default false)
returns text
language plpgsql security definer set search_path = '' as $$
declare r public.imagem_saneamento; v_tent int; v_novo text; v_ver timestamptz;
begin
  if p_estado not in ('ok', 'ignorado', 'falhou') then raise exception 'Estado inválido.'; end if;
  select * into r from public.imagem_saneamento where id = p_id for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  if r.estado <> 'pendente' then return r.estado; end if;                        -- já resolvido (idempotente)
  if r.objeto_versao is distinct from p_versao then                              -- upload novo no meio: continua pendente
    update public.imagem_saneamento set reservado_ate = null, updated_at = now() where id = p_id;
    return 'versao_mudou';
  end if;

  if p_estado = 'falhou' then
    v_tent := r.tentativas + 1;
    v_novo := case when v_tent < 3 then 'pendente' else 'falhou' end;
    update public.imagem_saneamento
       set estado = v_novo, tentativas = v_tent, motivo = left(p_motivo, 60), reservado_ate = null,
           proxima_em = now() + make_interval(mins => 10 * v_tent * v_tent), updated_at = now()
     where id = p_id;
    return v_novo;
  end if;

  update public.imagem_saneamento
     set estado = p_estado, motivo = left(p_motivo, 60), reservado_ate = null, saneada_em = now(),
         bytes_antes = p_bytes_antes, bytes_depois = p_bytes_depois, updated_at = now()
   where id = p_id;

  if p_estado = 'ok' and p_reescrito then
    -- regravar pela API com service_role pode zerar o dono do objeto (e as policies do bucket 'imagens' dependem dele): restaura
    update storage.objects set owner_id = r.dono_id::text
     where bucket_id = r.bucket and name = r.caminho and r.dono_id is not null and public.dono_do_objeto(owner, owner_id) is null;
    -- a regravação mudou o updated_at: registra a versão nova para a varredura não enfileirar de novo à toa
    v_ver := public._imagem_saneamento_versao(r.bucket, r.caminho);
    if v_ver is not null then
      update public.imagem_saneamento set objeto_versao = v_ver, saneada_em = now() where id = p_id;
    end if;
  end if;
  return p_estado;
end;
$$;
revoke all on function public.imagem_saneamento_marcar(uuid, text, text, timestamptz, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.imagem_saneamento_marcar(uuid, text, text, timestamptz, bigint, bigint, boolean) to service_role;

-- -----------------------------------------------------------------------------
--  Varredura + rotina do cron
-- -----------------------------------------------------------------------------
-- Enfileira o que está no Storage (imagens recentes dos 4 buckets) e ainda não foi visto naquela versão. É o que pega o cliente
-- adulterado, que nunca chama a RPC. p_dias grande = backfill (rodar à mão, uma vez, depois que a Edge Function estiver no ar).
create or replace function public.imagem_saneamento_varrer(p_dias int default 2) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  insert into public.imagem_saneamento (club_id, bucket, caminho, dono_id, objeto_versao)
  select public._imagem_saneamento_clube(o.name), o.bucket_id, o.name, public.dono_do_objeto(o.owner, o.owner_id), coalesce(o.updated_at, o.created_at)
    from storage.objects o
   where o.bucket_id in ('imagens', 'comprovacoes', 'comunidade', 'suporte-anexos')
     and length(o.name) <= 512
     and coalesce(o.updated_at, o.created_at) > now() - make_interval(days => least(greatest(coalesce(p_dias, 2), 1), 3650))
     and ((o.metadata ->> 'mimetype') ilike 'image/%' or lower(o.name) ~ '\.(jpe?g|png|webp|heic|heif|gif)$')
  on conflict (bucket, caminho) do update
     set estado = 'pendente', motivo = null, tentativas = 0, proxima_em = now(), reservado_ate = null,
         objeto_versao = excluded.objeto_versao, dono_id = coalesce(excluded.dono_id, public.imagem_saneamento.dono_id), updated_at = now()
   where public.imagem_saneamento.objeto_versao is distinct from excluded.objeto_versao;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.imagem_saneamento_varrer(int) from public, anon, authenticated;
grant execute on function public.imagem_saneamento_varrer(int) to service_role;

-- Rotina do cron: varre e, se o Vault tiver 'saneamento_url' e 'saneamento_secret', chama a Edge Function por pg_net.
-- Sem eles (ex.: banco local) só enfileira e registra em infra_falhas (no máximo 1 aviso por hora).
create or replace function public.imagem_saneamento_rotina() returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_segredo text;
begin
  perform public.imagem_saneamento_varrer(2);
  if not exists (select 1 from public.imagem_saneamento where estado = 'pendente' and proxima_em <= now()) then return; end if;
  begin
    select decrypted_secret into v_url     from vault.decrypted_secrets where name = 'saneamento_url';
    select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'saneamento_secret';
  exception when others then v_url := null;
  end;
  if v_url is null or v_segredo is null then
    if not exists (select 1 from public.infra_falhas where origem = 'imagens/saneamento' and quando > now() - interval '1 hour') then
      insert into public.infra_falhas (origem, detalhe)
      values ('imagens/saneamento', 'sem saneamento_url/saneamento_secret no Vault: fila alimentada, Edge Function sanear-imagens não chamada');
    end if;
    return;
  end if;
  perform net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-saneamento-secret', v_segredo),
    body := '{}'::jsonb, timeout_milliseconds := 10000);
end;
$$;
revoke all on function public.imagem_saneamento_rotina() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'imagem-sanear';
    perform cron.schedule('imagem-sanear', '*/10 * * * *', 'select public.imagem_saneamento_rotina()');
    -- NASCE DESLIGADO (decisão do dono, Fase 9): a Edge Function ainda não foi validada contra o Storage real e o Vault ainda não tem
    -- saneamento_url/saneamento_secret. Ligar só depois: select cron.alter_job((select jobid from cron.job where jobname = 'imagem-sanear'), active := true);
    perform cron.alter_job((select jobid from cron.job where jobname = 'imagem-sanear'), active := false);
  end if;
end $$;

select public._manutencao_instalar_guarda();
