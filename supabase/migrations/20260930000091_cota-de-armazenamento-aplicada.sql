-- =====================================================================
--  Fecha a pendência real deixada pela Fase 8.1 (migration 54): a medição de armazenamento por
--  clube existia (club_storage_objetos/club_storage_uso, _storage_contabilizar, reconciliação
--  semanal), mas NADA impedia um upload de passar do limite do plano — o servidor sabia o número
--  e não fazia nada com ele.
--
--  REUTILIZA _storage_clube_do_objeto (mesma resolução de clube: path novo <club_id>/... primeiro,
--  senão pelo vínculo do dono) e plano_limite/club_storage_uso (mesmas tabelas da medição) — nada
--  de uma segunda lógica de resolução de clube, nada de uma segunda tabela de uso.
--
--  REGRA: só bloqueia CRESCIMENTO. Nunca apaga nada, nunca recusa um arquivo que fica do MESMO
--  tamanho ou menor (sobrescrever com um arquivo menor sempre é permitido, mesmo acima da cota —
--  é isso que deixa um clube que fez downgrade continuar operando, só sem crescer). DELETE nunca é
--  bloqueado (sempre libera espaço). Clube sem plano/assinatura (plano_limite = null) é ilimitado,
--  igual a todos os outros limites do motor comercial.
--
--  CONCORRÊNCIA: pg_advisory_xact_lock por clube serializa duas transações que escrevem no MESMO
--  clube ao mesmo tempo — a segunda só lê `club_storage_uso` depois que a primeira (que já tem seu
--  próprio delta contabilizado pelo gatilho AFTER, na mesma transação) commitou. Clubes diferentes
--  nunca se bloqueiam entre si (hash diferente).
-- =====================================================================

create or replace function public._storage_verificar_cota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid; v_bytes_novo bigint; v_bytes_antigo bigint; v_delta bigint;
  v_limite_mb bigint; v_uso_atual bigint;
begin
  v_club := public._storage_clube_do_objeto(new.name, coalesce(new.owner_id, new.owner::text));
  -- objeto que não dá pra atribuir a nenhum clube: mesma regra da medição (não conta, então
  -- também não bloqueia — bloquear um upload que a própria contabilidade não sabe de quem é
  -- seria pior que o problema que estamos resolvendo).
  if v_club is null then return new; end if;

  -- serializa concorrência POR CLUBE antes de ler o uso — libera sozinho no fim da transação.
  perform pg_advisory_xact_lock(hashtext('storage-cota:' || v_club::text));

  v_bytes_novo := coalesce((new.metadata ->> 'size')::bigint, 0);
  if tg_op = 'UPDATE' then
    select bytes into v_bytes_antigo from public.club_storage_objetos
     where bucket_id = old.bucket_id and name = old.name;
  end if;
  v_delta := v_bytes_novo - coalesce(v_bytes_antigo, 0);

  -- nunca bloqueia quem está do mesmo tamanho, menor, ou é DELETE (delete nem passa por aqui —
  -- o gatilho só está registrado para insert/update).
  if v_delta <= 0 then return new; end if;

  v_limite_mb := public.plano_limite(v_club, 'armazenamento_mb');
  if v_limite_mb is null then return new; end if; -- sem teto (sem assinatura, ou plano ilimitado)

  select coalesce(bytes, 0) into v_uso_atual from public.club_storage_uso where club_id = v_club;
  if coalesce(v_uso_atual, 0) + v_delta > v_limite_mb * 1048576 then
    -- RAISE do plpgsql só aceita `%` cru como marcador (sem printf tipo %.0f) — arredonda em SQL antes.
    raise exception 'Limite de armazenamento do plano atingido (% MB de % MB). Peça pra liderança do clube liberar espaço ou fazer upgrade do plano — nada foi apagado.',
      round((coalesce(v_uso_atual, 0) + v_delta) / 1048576.0), v_limite_mb
      using errcode = '23514'; -- check_violation: o mesmo código que qualquer outro limite do motor comercial já usa
  end if;

  return new;
end $$;
revoke all on function public._storage_verificar_cota() from public, authenticated, anon;

-- BEFORE, e só insert/update (delete sempre libera espaço, nunca precisa ser verificado).
-- Roda ANTES do gatilho de contabilidade (AFTER) — a decisão de bloquear ou não nunca depende de
-- um número que a própria escrita ainda vai gerar.
drop trigger if exists trg_storage_verificar_cota on storage.objects;
create trigger trg_storage_verificar_cota
  before insert or update on storage.objects
  for each row execute function public._storage_verificar_cota();

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-cota-de-armazenamento-aplicada.sql')
on conflict (arquivo) do update set aplicada_em = now();
