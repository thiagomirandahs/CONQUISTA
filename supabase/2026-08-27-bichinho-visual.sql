-- =====================================================================
--  Filhos da Conquista — Bichinho: visual (cenário + cor + olhos)
--  (2026-08-27)
--
--  Agora o bichinho tem um "mundinho": um CENÁRIO de fundo (quintal, parque,
--  praia, acampamento 🏕️, floresta, neve, noite, espaço 🚀), uma COR de corpo
--  e um ESTILO DE OLHOS (abertos, fofo, estrela, coração...). Tudo DESBLOQUEIA
--  por NÍVEL — igual aos enfeites, sem moeda — e aparece na galeria do clube.
--
--  SEGURANÇA (mesma dos enfeites): guardamos só a CHAVE (ex.: 'acampamento'),
--  nunca cor/markup digitado. Cada coluna tem CHECK, e bichinho_vestir() confere
--  no SERVIDOR que o valor é da lista e já foi desbloqueado pro nível de quem
--  equipa. Assim nunca entra um valor "inventado" no SVG que TODA a galeria
--  renderiza (proteção contra XSS armazenado). Os níveis têm que bater com
--  CORES/OLHOS/CENARIOS em src/lib/bichinhoPecas.js.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Depende de 2026-08-26-bichinho.sql, 2026-08-26-bichinho-itens.sql
--  e de nivel_por_pontos()/meu_total_pontos() já rodados.
-- =====================================================================

-- ---------- Colunas novas (com lista fechada no banco) ----------
alter table public.bichinhos add column if not exists cenario text not null default 'quintal';
alter table public.bichinhos drop constraint if exists bichinhos_cenario_ok;
alter table public.bichinhos add constraint bichinhos_cenario_ok
  check (cenario in ('quintal', 'parque', 'praia', 'acampamento', 'floresta', 'neve', 'noite', 'espaco'));

alter table public.bichinhos add column if not exists cor text not null default 'natural';
alter table public.bichinhos drop constraint if exists bichinhos_cor_ok;
alter table public.bichinhos add constraint bichinhos_cor_ok
  check (cor in ('natural', 'rosa', 'azul', 'verde', 'roxo', 'laranja', 'amarelo', 'neve'));

alter table public.bichinhos add column if not exists olhos text not null default 'padrao';
alter table public.bichinhos drop constraint if exists bichinhos_olhos_ok;
alter table public.bichinhos add constraint bichinhos_olhos_ok
  check (olhos in ('padrao', 'aberto', 'fofo', 'pisca', 'estrela', 'coracao'));

-- ---------- Nível mínimo de cada opção (tem que bater com bichinhoPecas.js) ----------
create or replace function public._bichinho_nivel_cenario(p_v text)
returns int language sql immutable as $$
  select case p_v
    when 'quintal' then 1 when 'parque' then 2 when 'praia' then 3 when 'acampamento' then 4
    when 'floresta' then 5 when 'neve' then 6 when 'noite' then 7 when 'espaco' then 8
    else null end;
$$;
create or replace function public._bichinho_nivel_cor(p_v text)
returns int language sql immutable as $$
  select case p_v
    when 'natural' then 1 when 'rosa' then 2 when 'azul' then 3 when 'verde' then 4
    when 'roxo' then 5 when 'laranja' then 6 when 'amarelo' then 7 when 'neve' then 8
    else null end;
$$;
create or replace function public._bichinho_nivel_olhos(p_v text)
returns int language sql immutable as $$
  select case p_v
    when 'padrao' then 1 when 'aberto' then 1 when 'fofo' then 2 when 'pisca' then 3
    when 'estrela' then 4 when 'coracao' then 6
    else null end;
$$;

-- ---------- Vestir o bichinho (cenário/cor/olhos) — valida nível no servidor ----------
create or replace function public.bichinho_vestir(p_campo text, p_valor text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_min int;
  v_nivel int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  -- descobre o nível mínimo do valor pedido (null = valor fora da lista)
  if p_campo = 'cenario' then v_min := public._bichinho_nivel_cenario(p_valor);
  elsif p_campo = 'cor' then v_min := public._bichinho_nivel_cor(p_valor);
  elsif p_campo = 'olhos' then v_min := public._bichinho_nivel_olhos(p_valor);
  else raise exception 'Campo inválido.'; end if;
  if v_min is null then raise exception 'Opção inválida.'; end if;

  v_nivel := public.nivel_por_pontos(public.meu_total_pontos());
  if v_nivel < v_min then raise exception 'Isso abre no nível %. Continue juntando pontos! ✨', v_min; end if;

  -- aplica no campo certo (sem SQL dinâmico; o CHECK ainda é a última barreira)
  if p_campo = 'cenario' then
    update public.bichinhos set cenario = p_valor where usuario_id = v_uid and vivo;
  elsif p_campo = 'cor' then
    update public.bichinhos set cor = p_valor where usuario_id = v_uid and vivo;
  else
    update public.bichinhos set olhos = p_valor where usuario_id = v_uid and vivo;
  end if;
  if not found then raise exception 'Você não tem um bichinho vivo pra personalizar.'; end if;

  return json_build_object('ok', true, 'campo', p_campo, 'valor', p_valor);
end;
$$;
grant execute on function public.bichinho_vestir(text, text) to authenticated;

-- ---------- meu_bichinho: agora também devolve cenário/cor/olhos ----------
create or replace function public.meu_bichinho()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  b record;
  v_vivo boolean;
  v_morto_em timestamptz;
  v_h numeric;
  v_sem numeric;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into b from public.bichinhos where usuario_id = v_uid;
  if not found then return json_build_object('tem', false,
    'nivel', public.nivel_por_pontos(public.meu_total_pontos())); end if;

  v_vivo := b.vivo;
  v_morto_em := b.morto_em;
  v_sem := extract(epoch from (now() - b.ultimo_cuidado_em)) / 3600.0;
  if v_vivo and b.pontuado_em is not null and v_sem > 72 then
    v_vivo := false;
    v_morto_em := b.ultimo_cuidado_em + interval '72 hours';
    update public.bichinhos set vivo = false, morto_em = v_morto_em where usuario_id = v_uid;
  end if;

  v_h := extract(epoch from (now() - b.atualizado_em)) / 3600.0;

  return json_build_object(
    'tem', true, 'especie', b.especie, 'nome', b.nome, 'vivo', v_vivo, 'item', b.item,
    'cenario', b.cenario, 'cor', b.cor, 'olhos', b.olhos,
    'nivel', public.nivel_por_pontos(public.meu_total_pontos()),
    'fome',       case when v_vivo then greatest(0, b.fome       - floor(3 * v_h))::int else 0 end,
    'higiene',    case when v_vivo then greatest(0, b.higiene    - floor(3 * v_h))::int else 0 end,
    'felicidade', case when v_vivo then greatest(0, b.felicidade - floor(3 * v_h))::int else 0 end,
    'estagio', public._bichinho_estagio(b.dias_cuidados),
    'ofensiva', b.ofensiva, 'cuidados_total', b.cuidados_total, 'dias_cuidados', b.dias_cuidados,
    'pode_pontuar', v_vivo and (b.pontuado_em is null or now() - b.pontuado_em >= interval '20 hours'),
    'horas_sem_cuidado', round(v_sem)::int,
    'em_perigo', v_vivo and b.pontuado_em is not null and v_sem >= 36,
    'nascido_em', b.nascido_em, 'morto_em', v_morto_em
  );
end;
$$;
grant execute on function public.meu_bichinho() to authenticated;

-- ---------- pets_do_clube: galeria agora mostra cenário/cor/olhos ----------
-- Ganhou 3 colunas novas (cenario/cor/olhos). CREATE OR REPLACE não pode mudar
-- o tipo de retorno de uma função que já existe (ela tinha 11 colunas), então
-- é preciso DROP antes. O grant logo abaixo restaura a permissão (idempotente).
drop function if exists public.pets_do_clube();
create or replace function public.pets_do_clube()
returns table (
  dono_id uuid, dono_nome text, dono_avatar jsonb, dono_avatar_tipo text, dono_foto text,
  especie text, pet_nome text, estagio int, item text, cenario text, cor text, olhos text,
  vivo boolean, ofensiva int
) language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, p.avatar, p.avatar_tipo, p.foto,
    b.especie, b.nome, public._bichinho_estagio(b.dias_cuidados), b.item, b.cenario, b.cor, b.olhos,
    (b.vivo and (b.pontuado_em is null or now() - b.ultimo_cuidado_em <= interval '72 hours')),
    b.ofensiva
  from public.bichinhos b
  join public.profiles p on p.id = b.usuario_id
  where p.status = 'ativo' and p.papel <> 'pais'
    and exists (select 1 from public.profiles me
                where me.id = auth.uid() and me.status = 'ativo' and me.papel <> 'pais')
  order by b.ofensiva desc, public._bichinho_estagio(b.dias_cuidados) desc, p.nome;
$$;
grant execute on function public.pets_do_clube() to authenticated;

notify pgrst, 'reload schema';
