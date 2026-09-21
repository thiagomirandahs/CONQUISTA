-- =====================================================================
-- Missões do dia, devocional e catálogos POR CLUBE. Rodar DEPOIS da 20260921000021. Idempotente.
--
--  * missoes_feitas e devocional ganham club_id (o do dono do registro; gatilho genérico
--    definir_club_por_usuario, reaproveitado pelos módulos seguintes). O que existe fica no Tenant 001.
--  * O membro registra missão/devocional no PRÓPRIO clube; cadastro pendente e responsável não pontuam.
--  * A liderança lista/avalia só as missões pendentes do próprio clube; UUID de outro clube = "não encontrada".
--  * Catálogos (desafios = missões do dia, versiculos = devocional) são conteúdo da PLATAFORMA: iguais
--    para todos os clubes, lidos só por RPC; pela API só a liderança lê e NINGUÉM grava (só o dono do banco).
--  * Saem os gatilhos que fechavam missões/devocional ao clube legado.
-- =====================================================================

-- ==================== A) gatilho genérico: o registro nasce no clube do dono ====================
-- Uso: create trigger ... before insert on <tabela> for each row execute function public.definir_club_por_usuario('<coluna do usuário>')
create or replace function public.definir_club_por_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (to_jsonb(new) ->> tg_argv[0])::uuid; v_club uuid;
begin
  v_club := public.clube_vinculo_do_usuario(v_user);
  if v_club is null then
    raise exception 'Usuário sem clube.';
  end if;
  new.club_id := v_club;
  return new;
end;
$$;
revoke all on function public.definir_club_por_usuario() from public, anon, authenticated;

-- ==================== B) colunas e dados ====================
alter table public.missoes_feitas
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.missoes_feitas m
   set club_id = coalesce(public.clube_vinculo_do_usuario(m.usuario_id), public.clube_legado_id())
 where m.club_id is null;
alter table public.missoes_feitas alter column club_id set not null;
create index if not exists idx_missoes_feitas_club on public.missoes_feitas(club_id, status);

alter table public.devocional
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.devocional d
   set club_id = coalesce(public.clube_vinculo_do_usuario(d.usuario_id), public.clube_legado_id())
 where d.club_id is null;
alter table public.devocional alter column club_id set not null;
create index if not exists idx_devocional_club on public.devocional(club_id);

drop trigger if exists trg_exigir_clube_legado on public.missoes_feitas;
drop trigger if exists trg_exigir_clube_legado on public.devocional;
drop trigger if exists trg_definir_club_por_usuario on public.missoes_feitas;
drop trigger if exists trg_definir_club_por_usuario on public.devocional;
create trigger trg_definir_club_por_usuario before insert on public.missoes_feitas
for each row execute function public.definir_club_por_usuario('usuario_id');
create trigger trg_definir_club_por_usuario before insert on public.devocional
for each row execute function public.definir_club_por_usuario('usuario_id');

-- ==================== C) policies ====================
drop policy if exists "ler missoes_feitas" on public.missoes_feitas;
drop policy if exists "membro le as proprias missoes ou lideranca do clube" on public.missoes_feitas;
create policy "membro le as proprias missoes ou lideranca do clube" on public.missoes_feitas for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));

drop policy if exists "ler devocional" on public.devocional;
drop policy if exists "membro le o proprio devocional ou lideranca do clube" on public.devocional;
create policy "membro le o proprio devocional ou lideranca do clube" on public.devocional for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));

-- catálogos da plataforma: só a liderança lê (tem a resposta certa); ninguém grava pela API
drop policy if exists "ler desafios" on public.desafios;
drop policy if exists "gerir desafios" on public.desafios;
drop policy if exists "lideranca le catalogo de desafios" on public.desafios;
create policy "lideranca le catalogo de desafios" on public.desafios for select to authenticated
using (public.pode_gerir_no_clube(public.clube_atual_id()));

drop policy if exists "ler versiculos" on public.versiculos;
drop policy if exists "gerir versiculos" on public.versiculos;
drop policy if exists "lideranca le catalogo de versiculos" on public.versiculos;
create policy "lideranca le catalogo de versiculos" on public.versiculos for select to authenticated
using (public.pode_gerir_no_clube(public.clube_atual_id()));

-- ==================== D) RPCs ====================
CREATE OR REPLACE FUNCTION public.registrar_missao(p_foto_url text, p_resposta integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text; v_correta int; v_pede_foto boolean := false;
  v_acertou boolean := false; v_pontos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(public.clube_atual_id()) then
    raise exception 'Sem permissão: só quem é membro ativo do clube pontua.';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.registrar_devocional(p_resposta integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_correta int; v_acertou boolean := false;
  v_livro_abrev text; v_capitulo int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(public.clube_atual_id()) then
    raise exception 'Sem permissão: só quem é membro ativo do clube pontua.';
  end if;
  with v as (
    select vs.correta, vs.livro_abrev, vs.capitulo, row_number() over (order by vs.created_at, vs.id) - 1 as i
    from public.versiculos vs where vs.ativo
  ), n as (select count(*) c from v)
  select v.correta, v.livro_abrev, v.capitulo into v_correta, v_livro_abrev, v_capitulo
  from v cross join n where n.c > 0 and v.i = (v_idx % nullif(n.c, 0));
  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  insert into public.devocional (usuario_id, data, acertou_quiz)
  values (v_uid, v_hoje, v_acertou);
  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'devocional', 5, 'Devocional ' || to_char(v_hoje, 'DD/MM'));
  return json_build_object('acertou', v_acertou, 'pontos', 5, 'livro_abrev', v_livro_abrev, 'capitulo', v_capitulo);
exception when unique_violation then
  raise exception 'Você já fez o devocional de hoje! 🙂';
end;
$function$;

CREATE OR REPLACE FUNCTION public.notif_missao_avaliada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status is distinct from old.status and new.status in ('aprovada','reprovada') then
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
    values (
      case when new.status='aprovada' then '✅ Missão aprovada!' else '↺ Missão não aprovada' end,
      case when new.status='aprovada'
           then 'Sua missão de foto foi aprovada. Pontos no ranking! 🎉'
           else 'Sua missão de foto não foi aprovada desta vez.' end,
      'missao', '/missoes', 'pessoal', new.usuario_id, new.club_id);
  end if;
  return new;
end;
$function$;



create or replace function public.missoes_pendentes()
returns table (id uuid, nome text, foto_url text, data date)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  return query
  select m.id, p.nome, m.foto_url, m.data
  from public.missoes_feitas m join public.profiles p on p.id = m.usuario_id
  where m.status = 'pendente' and m.club_id = v_club order by m.created_at;
end;
$$;

create or replace function public.avaliar_missao(p_id uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row record; v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  -- missão de outro clube = mesma resposta de "não encontrada" (sem revelar que o UUID existe)
  select * into v_row from public.missoes_feitas where id = p_id and status = 'pendente' and club_id = v_club;
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

-- ACL: nada novo ficou executável por PUBLIC/anon (só a do cadastro público)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-missoes-e-devocional-por-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
