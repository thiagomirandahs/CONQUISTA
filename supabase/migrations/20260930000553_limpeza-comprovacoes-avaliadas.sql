-- 553 — APAGAR AS COMPROVAÇÕES DE ATIVIDADES E MISSÕES 7 DIAS DEPOIS DE AVALIADAS (16/10/2026).
-- Pedido do dono: "os arquivos das missões após entrega precisam ser apagados" + "usar o plano grátis o maior tempo possível".
-- Medido em produção (16/10): 571 MB no Storage, dos quais ~416 MB são entregas de ATIVIDADE já aprovadas (22 vídeos), 25 MB fotos
-- de MISSÃO aprovadas e 75 MB de arquivos órfãos (sem linha nenhuma) nas mesmas pastas.
--
-- O QUE PODE SER APAGADO (e o que NÃO): só `entregas.foto_url` (atividades) e `missoes_feitas.foto_url` (missões do dia). O ponto fica
-- em public.pontos, independente do arquivo. Evidência de REQUISITO de classe/especialidade NÃO é tocada (histórico imutável da
-- investidura: requirement_submissions/member_requirements e afins ficam como estão).
--
-- COMO (reaproveita a fila segura da 532, que já roda em produção a cada 15 min):
--   1. avaliado_em: marcado ao aprovar/reprovar (gatilho BEFORE); volta a nulo se a entrega for reenviada (status pendente).
--   2. comprovacoes_expirar() (pg_cron diário): 7 dias após avaliado_em, zera foto_url e grava foto_apagada_em. O gatilho da 532
--      enfileira o caminho antigo; como o arquivo já ficou os 7 dias combinados visível, o item da fila é liberado na hora e a
--      Edge Function storage-excluir apaga no próximo ciclo — SEMPRE reverificando no catálogo (se o arquivo ainda for usado em
--      outro lugar, fica 'mantido').
--   3. Vídeos LEGADOS em imagens/atividades/<atividade_id>-<uid>-<ts>: o dono é o 2º id do nome; a regra de dono passa a aceitar
--      esse formato (o id do dono continua sendo exigido no caminho — forjar caminho alheio continua impossível).
--   4. Já avaliados hoje: avaliado_em = agora (prazo de 7 dias contando de hoje). Órfãos dessas pastas: entram na fila com a
--      carência normal de 7 dias e só saem se o catálogo confirmar que ninguém usa.
--   5. Vídeo de comprovação: limite do bucket `comprovacoes` cai de 60 MB para 20 MB (o app também limita).
begin;

alter table public.entregas add column if not exists avaliado_em timestamptz;
alter table public.entregas add column if not exists foto_apagada_em timestamptz;
alter table public.missoes_feitas add column if not exists avaliado_em timestamptz;
alter table public.missoes_feitas add column if not exists foto_apagada_em timestamptz;

-- 1) marca a avaliação
create or replace function public._comprovacao_marcar_avaliacao() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status in ('aprovada', 'reprovada') then
      new.avaliado_em := coalesce(case when tg_op = 'UPDATE' and old.status = new.status then old.avaliado_em end, now());
    elsif new.status = 'pendente' then
      new.avaliado_em := null;
      new.foto_apagada_em := null;
    end if;
  end if;
  -- reenviar uma foto nova numa linha já limpa: a marca de "apagada" deixa de valer
  if tg_op = 'UPDATE' and nullif(btrim(coalesce(new.foto_url, '')), '') is not null
     and new.foto_url is distinct from old.foto_url then
    new.foto_apagada_em := null;
  end if;
  return new;
end $$;
revoke all on function public._comprovacao_marcar_avaliacao() from public, anon, authenticated;

drop trigger if exists comprovacao_marcar_avaliacao on public.entregas;
create trigger comprovacao_marcar_avaliacao before insert or update of status, foto_url on public.entregas
  for each row execute function public._comprovacao_marcar_avaliacao();
drop trigger if exists comprovacao_marcar_avaliacao on public.missoes_feitas;
create trigger comprovacao_marcar_avaliacao before insert or update of status, foto_url on public.missoes_feitas
  for each row execute function public._comprovacao_marcar_avaliacao();

-- 3) regra de dono: aceita também o formato legado atividades/<atividade_id>-<dono>-<ts>.ext (o dono continua obrigatório no caminho)
create or replace function public._storage_exclusao_dono_confere(p_caminho text, p_dono uuid) returns boolean
language sql immutable set search_path = '' as $$
  select p_dono is not null and p_caminho is not null and exists (
    select 1
      from (select split_part(p_caminho, '/', 1) as s1, split_part(p_caminho, '/', 2) as s2) s
     where s.s1 = p_dono::text or s.s1 like p_dono::text || '-%'
        or s.s2 = p_dono::text or s.s2 like p_dono::text || '-%'
        or (s.s1 = 'atividades' and s.s2 ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-' || p_dono::text || '-'))
  );
$$;
revoke all on function public._storage_exclusao_dono_confere(text, uuid) from public, anon, authenticated;

-- 2) a limpeza diária
create or replace function public.comprovacoes_expirar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_chaves text[] := '{}'; v_m text[] := '{}'; n_e int; n_m int; n_fila int;
begin
  -- guarda o caminho ANTIGO de cada linha limpa (o gatilho da 532 enfileira esse mesmo caminho)
  with alvo as (
    select id, foto_url from public.entregas
     where status in ('aprovada', 'reprovada') and avaliado_em <= now() - interval '7 days'
       and nullif(btrim(coalesce(foto_url, '')), '') is not null
     for update
  ), upd as (
    update public.entregas e set foto_url = null, foto_apagada_em = now() from alvo where e.id = alvo.id returning alvo.foto_url
  )
  select coalesce(array_agg(public._storage_ref_chave(foto_url, 'comprovacoes')), '{}') into v_chaves from upd;
  n_e := coalesce(array_length(v_chaves, 1), 0);
  with alvo as (
    select id, foto_url from public.missoes_feitas
     where status in ('aprovada', 'reprovada') and avaliado_em <= now() - interval '7 days'
       and nullif(btrim(coalesce(foto_url, '')), '') is not null
     for update
  ), upd as (
    update public.missoes_feitas m set foto_url = null, foto_apagada_em = now() from alvo where m.id = alvo.id returning alvo.foto_url
  )
  select coalesce(array_agg(public._storage_ref_chave(foto_url, 'comprovacoes')), '{}') into v_m from upd;
  n_m := coalesce(array_length(v_m, 1), 0);
  -- o arquivo já ficou os 7 dias combinados visível: libera ESSES itens na fila (a reverificação no catálogo continua valendo)
  update public.storage_exclusao_fila set processar_apos = now(), atualizada_em = now()
   where estado = 'pendente' and (bucket || '/' || caminho) = any (v_chaves || v_m);
  get diagnostics n_fila = row_count;
  return jsonb_build_object('entregas', n_e, 'missoes', n_m, 'na_fila', n_fila);
end $$;
revoke all on function public.comprovacoes_expirar() from public, anon, authenticated;
grant execute on function public.comprovacoes_expirar() to service_role;

select cron.schedule('comprovacoes-expirar', '50 4 * * *', 'select public.comprovacoes_expirar()')
 where not exists (select 1 from cron.job where jobname = 'comprovacoes-expirar');

-- 4a) já avaliados: o prazo de 7 dias conta a partir de hoje
update public.entregas set avaliado_em = now()
 where status in ('aprovada', 'reprovada') and avaliado_em is null;
update public.missoes_feitas set avaliado_em = now()
 where status in ('aprovada', 'reprovada') and avaliado_em is null;

-- 4b) órfãos das pastas de atividades/missões (arquivo sem nenhuma linha que o use): fila com a carência normal (7 dias).
--     O processamento reverifica no catálogo inteiro; se alguém usar, fica 'mantido'.
do $$
declare o record; v_dono uuid;
begin
  for o in
    select so.bucket_id, so.name from storage.objects so
     where so.bucket_id in ('imagens', 'comprovacoes') and so.name ~ '(^|/)(atividades|missoes)/'
       and not exists (select 1 from public.entregas e where public._storage_ref_chave(e.foto_url, 'comprovacoes') = so.bucket_id || '/' || so.name)
       and not exists (select 1 from public.missoes_feitas m where public._storage_ref_chave(m.foto_url, 'comprovacoes') = so.bucket_id || '/' || so.name)
  loop
    v_dono := null;
    begin
      if split_part(o.name, '/', 1) = 'atividades' then
        v_dono := substring(split_part(o.name, '/', 2) from '^[0-9a-f-]{36}-([0-9a-f-]{36})-')::uuid;
      else
        v_dono := split_part(o.name, '/', 1)::uuid;
      end if;
    exception when others then v_dono := null;
    end;
    perform public._storage_exclusao_enfileirar(o.name, o.bucket_id, 'orfao.atividades_missoes', 'apagado', v_dono);
  end loop;
end $$;

-- 5) vídeo de comprovação até 20 MB
update storage.buckets set file_size_limit = 20971520 where id = 'comprovacoes' and coalesce(file_size_limit, 0) > 20971520;

notify pgrst, 'reload schema';
insert into public.migracoes_aplicadas (arquivo) values ('2026-10-16-limpeza-comprovacoes-avaliadas.sql') on conflict (arquivo) do nothing;
commit;
