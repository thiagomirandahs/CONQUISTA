-- =====================================================================
-- Catálogos de CONTEÚDO por clube: desafios (missões do dia) e versiculos (devocional). Idempotente.
-- Rodar DEPOIS da 20260921000026.
--
-- A migration 22 tratou esses catálogos como "conteúdo da plataforma, só leitura" e tirou a escrita da
-- liderança — mas o app TEM o painel Conteúdo (Gestão) em que a liderança cria/edita/apaga missões e versículos.
-- Correção: o catálogo é DO CLUBE. O que existe fica no Tenant 001 (a liderança dele segue editando tudo),
-- clube novo nasce com uma CÓPIA do conteúdo do clube legado (e edita o dele), e a missão/versículo do dia
-- de cada membro sai do catálogo do CLUBE dele.
-- =====================================================================

-- ==================== A) colunas e dados (o que existe é do Tenant 001) ====================
alter table public.desafios
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.desafios set club_id = public.clube_legado_id() where club_id is null;
alter table public.desafios alter column club_id set not null;
alter table public.desafios alter column club_id set default public.clube_atual_id();
create index if not exists idx_desafios_club on public.desafios(club_id, ativo);

alter table public.versiculos
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.versiculos set club_id = public.clube_legado_id() where club_id is null;
alter table public.versiculos alter column club_id set not null;
alter table public.versiculos alter column club_id set default public.clube_atual_id();
create index if not exists idx_versiculos_club on public.versiculos(club_id, ativo);

-- ==================== B) policies: a liderança lê e gere o conteúdo do PRÓPRIO clube ====================
-- (a criança nunca lê a tabela: a resposta certa continua secreta; ela recebe a missão/versículo pelas RPCs)
drop policy if exists "lideranca le catalogo de desafios" on public.desafios;
drop policy if exists "lideranca gere o conteudo de desafios do proprio clube" on public.desafios;
create policy "lideranca gere o conteudo de desafios do proprio clube" on public.desafios for all to authenticated
using (public.pode_gerir_no_clube(club_id))
with check (public.pode_gerir_no_clube(club_id) and club_id = public.clube_atual_id());

drop policy if exists "lideranca le catalogo de versiculos" on public.versiculos;
drop policy if exists "lideranca gere o conteudo de versiculos do proprio clube" on public.versiculos;
create policy "lideranca gere o conteudo de versiculos do proprio clube" on public.versiculos for all to authenticated
using (public.pode_gerir_no_clube(club_id))
with check (public.pode_gerir_no_clube(club_id) and club_id = public.clube_atual_id());

-- ==================== C) clube novo nasce com uma CÓPIA do conteúdo do clube legado ====================
create or replace function public._prov_conteudo(p_club_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.desafios where club_id = p_club_id) then
    insert into public.desafios (club_id, tema, texto, pergunta, opcoes, correta, classe, pede_foto, ativo, created_at)
    select p_club_id, d.tema, d.texto, d.pergunta, d.opcoes, d.correta, d.classe, d.pede_foto, d.ativo, d.created_at
    from public.desafios d where d.club_id = public.clube_legado_id();
  end if;
  if not exists (select 1 from public.versiculos where club_id = p_club_id) then
    insert into public.versiculos (club_id, texto, referencia, pergunta, opcoes, correta, ativo, created_at, livro_abrev, capitulo, versiculo_num)
    select p_club_id, v.texto, v.referencia, v.pergunta, v.opcoes, v.correta, v.ativo, v.created_at, v.livro_abrev, v.capitulo, v.versiculo_num
    from public.versiculos v where v.club_id = public.clube_legado_id();
  end if;
end;
$$;
revoke all on function public._prov_conteudo(uuid) from public, anon, authenticated;
select public.provisionar_clube(id) from public.organizational_units where type = 'clube';

-- ==================== D) missão e versículo do dia: do catálogo do CLUBE de quem chama ====================
CREATE OR REPLACE FUNCTION public.missao_do_dia()
 RETURNS TABLE(tipo text, texto text, referencia text, tema text, pergunta text, opcoes jsonb, pede_foto boolean, classe text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    from public.desafios ds where ds.club_id = public.clube_atual_id() and ds.ativo and (ds.classe = v_classe or ds.classe is null)
  ), n as (select count(*) c from d)
  select 'desafio'::text, d.texto, null::text, d.tema, d.pergunta, d.opcoes, d.pede_foto, v_classe
  from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));
end;
$function$;

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
    from public.desafios ds where ds.club_id = public.clube_atual_id() and ds.ativo and (ds.classe = v_classe or ds.classe is null)
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

CREATE OR REPLACE FUNCTION public.versiculo_do_dia()
 RETURNS TABLE(id uuid, texto text, referencia text, pergunta text, opcoes jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with v as (
    select id, texto, referencia, pergunta, opcoes,
           row_number() over (order by created_at, id) - 1 as idx
    from public.versiculos where club_id = public.clube_atual_id() and ativo = true
  ), n as (select count(*) c from v)
  select v.id, v.texto, v.referencia, v.pergunta, v.opcoes
  from v, n
  where n.c > 0 and v.idx = (((now() at time zone 'America/Sao_Paulo')::date - date '2026-01-01') % n.c);
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
    from public.versiculos vs where vs.club_id = public.clube_atual_id() and vs.ativo
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



-- ACL: nada novo ficou executável por PUBLIC/anon (só a do cadastro público)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-conteudo-por-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
