-- =====================================================================
-- DesbravaClube — Correções multi-tenant 2/5: RLS por clube + blindagem de responsáveis
--
-- As policies de leitura/escrita dos dados do clube usavam tem_vinculo_unidade(), que
-- conta QUALQUER vínculo ativo — inclusive o do responsável (pais). Resultado: um
-- responsável lia pontos, fotos, perfis (com data de nascimento) de todos os menores do
-- clube (a blindagem do portal dos pais, de 14/07, tinha se perdido). Aqui os dados do
-- clube passam a exigir membro_ativo_no_clube() (papel diferente de 'pais'); o
-- responsável só enxerga o próprio filho pela RPC meus_filhos() (migration 16).
--
-- Também: defaults de clube (unidades/atividades) seguem o clube de quem cria (antes
-- caíam no clube legado e o Tenant 002 não conseguia criar nada), rankings só para
-- membros, e o alvo de conflito legado de mensalidades volta a existir (compat).
-- =====================================================================

-- ---------- defaults: o clube de quem cria (falha fechada se a pessoa não tem clube) ----------
alter table public.unidades alter column club_id set default public.clube_atual_id();
alter table public.atividades alter column club_id set default public.clube_atual_id();

-- ---------- unidades ----------
drop policy if exists "membro le unidades do proprio clube" on public.unidades;
create policy "membro le unidades do proprio clube" on public.unidades for select to authenticated
using (public.membro_ativo_no_clube(club_id));

-- ---------- atividades ----------
drop policy if exists "membro le atividades do proprio clube" on public.atividades;
create policy "membro le atividades do proprio clube" on public.atividades for select to authenticated
using (public.membro_ativo_no_clube(club_id));

-- ---------- entregas ----------
drop policy if exists "participante le entrega do proprio clube" on public.entregas;
create policy "participante le entrega do proprio clube" on public.entregas for select to authenticated
using (public.membro_ativo_no_clube(club_id) and (usuario_id = auth.uid() or public.pode_gerir_no_clube(club_id)));

drop policy if exists "participante envia entrega no proprio clube" on public.entregas;
create policy "participante envia entrega no proprio clube" on public.entregas for insert to authenticated
with check (usuario_id = auth.uid() and status = 'pendente' and public.membro_ativo_no_clube(club_id));

drop policy if exists "participante reenvia entrega no proprio clube" on public.entregas;
create policy "participante reenvia entrega no proprio clube" on public.entregas for update to authenticated
using (usuario_id = auth.uid() and status = 'reprovada' and public.membro_ativo_no_clube(club_id))
with check (usuario_id = auth.uid() and status = 'pendente' and public.membro_ativo_no_clube(club_id));

-- ---------- pontos ----------
drop policy if exists "membro le pontos do proprio clube" on public.pontos;
create policy "membro le pontos do proprio clube" on public.pontos for select to authenticated
using (public.membro_ativo_no_clube(club_id));

drop policy if exists "lideranca lanca pontos do proprio clube" on public.pontos;
create policy "lideranca lanca pontos do proprio clube" on public.pontos for insert to authenticated
with check (
  public.membro_ativo_no_clube(club_id)
  and (public.pode_gerir_no_clube(club_id) or (unidade_id is null and public.pode_apontar(usuario_id)))
);

drop policy if exists "lideranca apaga pontos do proprio clube" on public.pontos;
create policy "lideranca apaga pontos do proprio clube" on public.pontos for delete to authenticated
using (
  public.membro_ativo_no_clube(club_id)
  and (public.pode_gerir_no_clube(club_id) or (unidade_id is null and public.pode_apontar(usuario_id)))
);

-- ---------- fotos (mural) ----------
drop policy if exists "membro le fotos do proprio clube" on public.fotos;
create policy "membro le fotos do proprio clube" on public.fotos for select to authenticated
using (public.membro_ativo_no_clube(club_id));

drop policy if exists "membro posta foto no proprio clube" on public.fotos;
create policy "membro posta foto no proprio clube" on public.fotos for insert to authenticated
with check (autor_id = auth.uid() and public.membro_ativo_no_clube(club_id));

drop policy if exists "autor ou lideranca apaga foto do proprio clube" on public.fotos;
create policy "autor ou lideranca apaga foto do proprio clube" on public.fotos for delete to authenticated
using (public.membro_ativo_no_clube(club_id) and (autor_id = auth.uid() or public.pode_gerir_no_clube(club_id)));

-- ---------- agenda e temporadas ----------
drop policy if exists "membro le eventos do proprio clube" on public.eventos;
create policy "membro le eventos do proprio clube" on public.eventos for select to authenticated
using (public.membro_ativo_no_clube(club_id));

drop policy if exists "membro le temporadas do proprio clube" on public.temporadas;
create policy "membro le temporadas do proprio clube" on public.temporadas for select to authenticated
using (public.membro_ativo_no_clube(club_id));

-- ---------- notificações: pessoal (inclusive do responsável) OU aviso geral do clube (só membro) ----------
drop policy if exists "membro le notificacoes do proprio clube" on public.notificacoes;
create policy "membro le notificacoes do proprio clube" on public.notificacoes for select to authenticated
using (
  (para_usuario = auth.uid() and public.tem_vinculo_unidade(club_id))
  or (
    para_usuario is null and public.membro_ativo_no_clube(club_id)
    and (para = 'todos' or (para = 'lideranca' and public.pode_gerir_no_clube(club_id)))
  )
);

-- ---------- mensalidades: a própria (membro) ou o financeiro do clube ----------
drop policy if exists "membro le propria mensalidade do clube" on public.mensalidades;
create policy "membro le propria mensalidade do clube" on public.mensalidades for select to authenticated
using (public.membro_ativo_no_clube(club_id) and (desbravador_id = auth.uid() or public.pode_financeiro_no_clube(club_id)));

-- COMPAT front x migration: o front PUBLICADO grava mensalidades com
-- onConflict(desbravador_id,mes,ano). A migration 11 removeu esse alvo e o front novo usava
-- club_id,... — os dois lados quebravam quando o deploy do front e o SQL manual saíam
-- fora de ordem. Como cada pessoa pertence a UM clube, (desbravador,mes,ano) continua único:
-- devolve o alvo antigo e mantém o novo. As duas formas de upsert funcionam antes e depois.
do $$
begin
  if exists (select 1 from public.mensalidades group by desbravador_id, mes, ano having count(*) > 1) then
    raise exception 'Há mensalidades duplicadas (mesmo desbravador, mês e ano). Resolva antes de aplicar esta migration.';
  end if;
end $$;
alter table public.mensalidades drop constraint if exists mensalidades_desbravador_id_mes_ano_key;
alter table public.mensalidades add constraint mensalidades_desbravador_id_mes_ano_key unique (desbravador_id, mes, ano);

-- ---------- tela de Usuários da liderança: gente do PRÓPRIO clube, inclusive desativada/rejeitada ----------
-- (a versão anterior filtrava vínculo pendente/ativo: quem era desativado sumia da lista e a
-- liderança não conseguia mais reativar nem excluir)
create or replace function public.listar_usuarios()
returns table (id uuid, nome text, foto text, papel text, status text, unidade_id uuid, email text, teste boolean)
language sql security definer set search_path = '' as $$
  select p.id, p.nome, p.foto, p.papel, p.status, p.unidade_id,
         u.email::text, coalesce(p.teste, false)
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.lideranca_gere_usuario(p.id)
  order by p.nome;
$$;

-- ---------- rankings: só MEMBRO do clube (responsável recebe vazio), sempre do clube dele ----------
create or replace function public.ranking_totais()
returns json language sql security definer set search_path = '' as $$
  select case when public.membro_ativo_no_clube(public.clube_atual_id()) then json_build_object(
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (select usuario_id, sum(pontos)::int as total from public.pontos
            where club_id = public.clube_atual_id()
              and usuario_id is not null
              and coalesce(data, '-infinity'::timestamptz) >= public.temporada_inicio()
            group by usuario_id) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (select unidade_id, sum(pontos)::int as total from public.pontos
            where club_id = public.clube_atual_id()
              and usuario_id is null and unidade_id is not null
              and coalesce(data, '-infinity'::timestamptz) >= public.temporada_inicio()
            group by unidade_id) t), '[]'::json)
  ) else json_build_object('pessoas', '[]'::json, 'times', '[]'::json) end;
$$;

create or replace function public.ranking_semana()
returns json language sql security definer set search_path = '' as $$
  with ini as (
    select (date_trunc('week', (now() at time zone 'America/Sao_Paulo'))
            at time zone 'America/Sao_Paulo') as ts
  )
  select case when public.membro_ativo_no_clube(public.clube_atual_id()) then json_build_object(
    'inicio', (select ts from ini),
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (select usuario_id, sum(pontos)::int as total from public.pontos
            where club_id = public.clube_atual_id()
              and usuario_id is not null and data >= (select ts from ini)
            group by usuario_id) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (select unidade_id, sum(pontos)::int as total from public.pontos
            where club_id = public.clube_atual_id()
              and usuario_id is null and unidade_id is not null and data >= (select ts from ini)
            group by unidade_id) t), '[]'::json)
  ) else json_build_object('inicio', null, 'pessoas', '[]'::json, 'times', '[]'::json) end;
$$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-rls-por-clube-e-blindagem-de-responsaveis.sql')
on conflict (arquivo) do update set aplicada_em = now();
