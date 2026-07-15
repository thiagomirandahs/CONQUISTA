-- =====================================================================
--  Filhos da Conquista — Portal dos Pais (ETAPA 1) — 2026-07-14
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  O responsável se cadastra, digita o nome do filho e PEDE o vínculo; a
--  DIRETORIA aprova (escolhendo o desbravador certo; corrige se o nome errar).
--  Aprovado, o pai vê os dados do filho: pontos, presença e mensalidade + PIX.
--
--  SEGURANÇA (o que este arquivo garante):
--   * O pai nasce papel='pais' e status='ativo' (pra logar e pedir o vínculo),
--     NUNCA papel privilegiado (o tipo vem do cadastro, e só 'pais' é aceito).
--   * Vincular só por função. A leitura dos dados do filho passa SÓ pela função
--     meus_filhos(), que devolve apenas filhos com vínculo APROVADO ligado a
--     auth.uid() — um pai jamais vê outra criança.
--   * Aprovar/rejeitar: só diretoria (status ativo).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Cadastro pode nascer 'pais' (ativo). Desbravador segue 'pendente'.
--    O tipo vem do metadata do signup; só 'pais' é aceito (nunca líder).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tipo text := new.raw_user_meta_data->>'tipo';
begin
  insert into public.profiles (id, nome, nascimento, unidade_id, cargo, papel, status)
  values (
    new.id,
    new.raw_user_meta_data->>'nome',
    (nullif(new.raw_user_meta_data->>'nascimento', ''))::date,
    (nullif(new.raw_user_meta_data->>'unidade_id', ''))::uuid,
    new.raw_user_meta_data->>'cargo',
    case when v_tipo = 'pais' then 'pais' else 'desbravador' end,
    case when v_tipo = 'pais' then 'ativo' else 'pendente' end
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Vínculo pai -> filho
-- ---------------------------------------------------------------------
create table if not exists public.responsaveis (
  id uuid primary key default gen_random_uuid(),
  responsavel_id uuid not null references public.profiles(id) on delete cascade,
  desbravador_id uuid references public.profiles(id) on delete cascade,  -- null até aprovar
  nome_digitado text not null,               -- o nome que o pai digitou (a diretoria confere)
  status text not null default 'pendente',   -- pendente | aprovado | rejeitado
  criado_em timestamptz default now(),
  aprovado_por uuid references public.profiles(id) on delete set null,
  aprovado_em timestamptz,
  constraint responsaveis_status_valido check (status in ('pendente', 'aprovado', 'rejeitado'))
);
-- Não deixa aprovar o mesmo par pai+filho duas vezes
create unique index if not exists responsaveis_par_aprovado_key
  on public.responsaveis (responsavel_id, desbravador_id) where status = 'aprovado';
create index if not exists idx_responsaveis_status on public.responsaveis(status);

alter table public.responsaveis enable row level security;

-- O pai vê os PRÓPRIOS pedidos; a liderança vê todos. Escrever só por função.
drop policy if exists "ler responsaveis" on public.responsaveis;
create policy "ler responsaveis" on public.responsaveis for select to authenticated
  using (responsavel_id = auth.uid() or public.pode_gerir());
drop policy if exists "apagar responsaveis" on public.responsaveis;
create policy "apagar responsaveis" on public.responsaveis for delete to authenticated
  using (public.pode_gerir() or (responsavel_id = auth.uid() and status = 'pendente'));

-- ---------------------------------------------------------------------
-- 3) Funções do vínculo
-- ---------------------------------------------------------------------
-- Pai pede o vínculo digitando o nome do filho (a diretoria confere e aprova).
create or replace function public.pedir_vinculo(p_nome text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_papel text; v_pend int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select papel into v_papel from public.profiles where id = v_uid;
  if v_papel <> 'pais' then raise exception 'Só responsáveis pedem vínculo.'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Digite o nome do seu filho(a).'; end if;

  select count(*) into v_pend from public.responsaveis
   where responsavel_id = v_uid and status = 'pendente';
  if v_pend >= 5 then raise exception 'Você já tem pedidos demais aguardando. Espere a diretoria. 🙂'; end if;

  insert into public.responsaveis (responsavel_id, nome_digitado) values (v_uid, trim(p_nome));
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.pedir_vinculo(text) to authenticated;

-- Diretoria aprova ESCOLHENDO o desbravador certo (corrige se o pai errou o nome).
create or replace function public.aprovar_vinculo(p_id uuid, p_desbravador_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_status text;
begin
  if not exists (select 1 from public.profiles where id = v_uid and papel = 'diretoria' and status = 'ativo') then
    raise exception 'Só a diretoria aprova vínculos.';
  end if;
  if not exists (select 1 from public.profiles where id = p_desbravador_id) then
    raise exception 'Desbravador não encontrado.';
  end if;
  select status into v_status from public.responsaveis where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_status = 'aprovado' then raise exception 'Esse vínculo já foi aprovado.'; end if;

  update public.responsaveis
     set desbravador_id = p_desbravador_id, status = 'aprovado', aprovado_por = v_uid, aprovado_em = now()
   where id = p_id;
  return json_build_object('ok', true);
exception when unique_violation then
  raise exception 'Esse responsável já está vinculado a esse desbravador.';
end;
$$;
grant execute on function public.aprovar_vinculo(uuid, uuid) to authenticated;

create or replace function public.rejeitar_vinculo(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.profiles where id = v_uid and papel = 'diretoria' and status = 'ativo') then
    raise exception 'Só a diretoria.';
  end if;
  update public.responsaveis set status = 'rejeitado' where id = p_id and status = 'pendente';
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.rejeitar_vinculo(uuid) to authenticated;

-- Diretoria: pedidos pendentes (pai + nome digitado) pra aprovar. Não-liderança recebe [].
create or replace function public.vinculos_pendentes()
returns json language sql security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'id', r.id, 'nome_digitado', r.nome_digitado, 'criado_em', r.criado_em, 'responsavel', p.nome
  ) order by r.criado_em), '[]'::json)
  from public.responsaveis r
  join public.profiles p on p.id = r.responsavel_id
  where r.status = 'pendente' and public.pode_gerir();
$$;
grant execute on function public.vinculos_pendentes() to authenticated;

-- ---------------------------------------------------------------------
-- 4) MEU FILHO — a ÚNICA porta pros dados da criança. Devolve pontos,
--    presença e mensalidade SÓ dos filhos com vínculo APROVADO do pai logado.
-- ---------------------------------------------------------------------
create or replace function public.meus_filhos()
returns json language sql security definer set search_path = '' as $$
  select coalesce(json_agg(f order by f->>'nome'), '[]'::json) from (
    select json_build_object(
      'id', c.id, 'nome', c.nome, 'foto', c.foto, 'unidade', u.nome,
      'pontos', coalesce((select sum(pontos)::int from public.pontos where usuario_id = c.id), 0),
      'presencas', coalesce((select count(*) from public.pontos
                    where usuario_id = c.id and origem = 'apontamento' and marca->>'presenca' = 'presente'), 0),
      'faltas', coalesce((select count(*) from public.pontos
                    where usuario_id = c.id and origem = 'apontamento' and marca->>'presenca' = 'faltou'), 0),
      'mensalidades_pendentes', coalesce((
                    select json_agg(json_build_object('mes', m.mes, 'ano', m.ano, 'valor', m.valor) order by m.ano, m.mes)
                    from public.mensalidades m where m.desbravador_id = c.id and m.status = 'pendente'), '[]'::json)
    ) as f
    from public.responsaveis r
    join public.profiles c on c.id = r.desbravador_id
    left join public.unidades u on u.id = c.unidade_id
    where r.responsavel_id = auth.uid() and r.status = 'aprovado'
  ) t;
$$;
grant execute on function public.meus_filhos() to authenticated;

-- ---------------------------------------------------------------------
-- 5) PIX do clube (a diretoria/tesouraria cadastra; todos leem)
-- ---------------------------------------------------------------------
create table if not exists public.config_clube (
  chave text primary key,
  valor text
);
alter table public.config_clube enable row level security;
drop policy if exists "ler config" on public.config_clube;
create policy "ler config" on public.config_clube for select to authenticated using (true);
drop policy if exists "gerir config" on public.config_clube;
create policy "gerir config" on public.config_clube for all to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());
insert into public.config_clube (chave, valor) values ('pix', '') on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 6) BLINDAGEM (crítico) — dados de menor
--
--    As tabelas base profiles/pontos/fotos eram "qualquer logado lê tudo"
--    (using true). Isso só era seguro porque "logado" = membro APROVADO. Mas
--    o cadastro público cria contas sem aprovação: o pai nasce ativo, e o
--    desbravador nasce pendente (mas ainda recebe um token logo após o signup).
--    Sem esta blindagem, qualquer uma dessas contas leria, direto pela API,
--    nome/foto/nascimento/pontos/presença de TODAS as crianças.
--
--    Regra nova: só MEMBRO ATIVO (aprovado, não-pais) lê as tabelas/rankings.
--    O pai vê o filho SÓ pela meus_filhos() (que exige vínculo aprovado).
-- ---------------------------------------------------------------------
create or replace function public.eh_membro_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'ativo' and papel <> 'pais'
  );
$$;
grant execute on function public.eh_membro_ativo() to authenticated;

-- Tabelas base: só o próprio perfil (todos) OU membro ativo (lê o resto).
drop policy if exists "ler perfis" on public.profiles;
create policy "ler perfis" on public.profiles for select to authenticated
  using (id = auth.uid() or public.eh_membro_ativo());

drop policy if exists "ler pontos" on public.pontos;
create policy "ler pontos" on public.pontos for select to authenticated
  using (public.eh_membro_ativo());

drop policy if exists "ler fotos" on public.fotos;
create policy "ler fotos" on public.fotos for select to authenticated
  using (public.eh_membro_ativo());

-- Notificações: o pessoal (para o próprio) sempre; os avisos GERAIS só pra
-- membro ativo (senão o pai lia o aviso de aniversário com o nome da criança).
drop policy if exists "ler notificacoes" on public.notificacoes;
create policy "ler notificacoes" on public.notificacoes for select to authenticated using (
  para_usuario = auth.uid()
  or (para_usuario is null and public.eh_membro_ativo()
      and (para = 'todos' or (para = 'lideranca' and public.pode_aprovar())))
);

-- RPCs de ranking (security definer): devolviam nome/foto/pontos de todas as
-- crianças pra QUALQUER logado — reabriam o vazamento por fora das tabelas.
-- Agora só respondem pra membro ativo; pra pai/pendente, vazio.
create or replace function public.ranking_trilha()
returns json language sql security definer set search_path = '' as $$
  select case when public.eh_membro_ativo() then (
    with base as (
      select p.id, p.nome, p.foto,
             coalesce(nullif(j.tipo, ''), 'memoria') as tipo,
             coalesce(j.estrelas, 0)                 as estrelas
      from public.trilha_jogos j
      join public.profiles p on p.id = j.usuario_id
      where p.status = 'ativo' and p.papel <> 'pais'
    ),
    agg as (
      select tipo, id, nome, foto, count(*)::int as passos, sum(estrelas)::int as estrelas
      from base group by tipo, id, nome, foto
      union all
      select 'geral' as tipo, id, nome, foto, count(*)::int as passos, sum(estrelas)::int as estrelas
      from base group by id, nome, foto
    )
    select coalesce(json_object_agg(tipo, linhas), '{}'::json)
    from (
      select tipo, json_agg(json_build_object('id', id, 'nome', nome, 'foto', foto,
             'passos', passos, 'estrelas', estrelas) order by estrelas desc, passos desc, nome) as linhas
      from agg group by tipo
    ) x
  ) else '{}'::json end;
$$;

create or replace function public.ranking_totais()
returns json language sql security definer set search_path = '' as $$
  select case when public.eh_membro_ativo() then json_build_object(
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (select usuario_id, sum(pontos)::int as total from public.pontos
            where usuario_id is not null and coalesce(data, '-infinity'::timestamptz) >= public.temporada_inicio()
            group by usuario_id) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (select unidade_id, sum(pontos)::int as total from public.pontos
            where usuario_id is null and unidade_id is not null and coalesce(data, '-infinity'::timestamptz) >= public.temporada_inicio()
            group by unidade_id) t), '[]'::json)
  ) else json_build_object('pessoas', '[]'::json, 'times', '[]'::json) end;
$$;

create or replace function public.ranking_semana()
returns json language sql security definer set search_path = '' as $$
  with ini as (
    select (date_trunc('week', (now() at time zone 'America/Sao_Paulo'))
            at time zone 'America/Sao_Paulo') as ts
  )
  select case when public.eh_membro_ativo() then json_build_object(
    'inicio', (select ts from ini),
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (select usuario_id, sum(pontos)::int as total from public.pontos
            where usuario_id is not null and data >= (select ts from ini) group by usuario_id) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (select unidade_id, sum(pontos)::int as total from public.pontos
            where usuario_id is null and unidade_id is not null and data >= (select ts from ini) group by unidade_id) t), '[]'::json)
  ) else json_build_object('inicio', null, 'pessoas', '[]'::json, 'times', '[]'::json) end;
$$;

notify pgrst, 'reload schema';
