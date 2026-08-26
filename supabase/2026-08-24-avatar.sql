-- =====================================================================
--  Filhos da Conquista — Avatar customizável + Nível visível (2026-08-24)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  Como funciona: cada desbravador monta um personagem (pele, cabelo,
--  roupa, acessório) em vez de (ou além d)a foto — peças novas
--  desbloqueiam conforme o NÍVEL sobe (nível vem dos pontos da temporada).
--  Os limiares de nível têm que bater com src/lib/nivel.js e as peças com
--  src/lib/avatarPecas.js — mudou aqui, muda lá também.
--
--  SEGURANÇA: salvar_avatar() confere no SERVIDOR (nunca confia só na
--  tela) que (a) a peça escolhida já foi desbloqueada pro nível de quem
--  está salvando, e (b) toda cor é um #rrggbb de verdade — sem isso,
--  alguém poderia gravar uma "cor" manipulada que quebra o SVG na tela de
--  QUALQUER outra pessoa que veja aquele avatar (ranking, unidades...).
-- =====================================================================

alter table public.profiles add column if not exists avatar jsonb;
alter table public.profiles add column if not exists avatar_tipo text not null default 'foto';
alter table public.profiles drop constraint if exists profiles_avatar_tipo_valido;
alter table public.profiles add constraint profiles_avatar_tipo_valido check (avatar_tipo in ('foto', 'personagem'));

-- ---------------------------------------------------------------------
-- Total de pontos da temporada — corrige o Perfil, que hoje só soma os
-- ÚLTIMOS 100 lançamentos do extrato (subestima quem tem muitos pontos).
-- ---------------------------------------------------------------------
create or replace function public.meu_total_pontos()
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(sum(pontos)::int, 0) from public.pontos
  where usuario_id = auth.uid() and coalesce(data, '-infinity'::timestamptz) >= public.temporada_inicio();
$$;
grant execute on function public.meu_total_pontos() to authenticated;

-- Nível a partir dos pontos (tem que bater com LIMIARES_NIVEL em src/lib/nivel.js).
create or replace function public.nivel_por_pontos(p_pontos int)
returns int language sql immutable as $$
  select case
    when p_pontos < 100 then 1 when p_pontos < 250 then 2 when p_pontos < 450 then 3
    when p_pontos < 700 then 4 when p_pontos < 1000 then 5 when p_pontos < 1400 then 6
    when p_pontos < 1900 then 7 when p_pontos < 2500 then 8 when p_pontos < 3200 then 9
    when p_pontos < 4000 then 10 when p_pontos < 5000 then 11 when p_pontos < 6200 then 12
    when p_pontos < 7600 then 13 when p_pontos < 9200 then 14
    else 15 + floor((p_pontos - 9200) / 2000.0)::int
  end;
$$;
grant execute on function public.nivel_por_pontos(int) to authenticated;

-- ---------------------------------------------------------------------
-- Salvar avatar — valida nível de CADA peça e o formato de CADA cor.
-- ---------------------------------------------------------------------
create or replace function public.salvar_avatar(p_avatar jsonb, p_tipo text default 'personagem')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_total int;
  v_nivel int;
  v_cabelo text; v_roupa text; v_acessorio text;
  v_pele text; v_cor_cabelo text; v_cor_roupa text; v_cor_acessorio text;
  v_nivel_cabelo int; v_nivel_roupa int; v_nivel_acessorio int;
  v_hex text := '^#[0-9a-fA-F]{6}$';
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_tipo not in ('foto', 'personagem') then raise exception 'Tipo de avatar inválido.'; end if;

  if p_tipo = 'foto' then
    update public.profiles set avatar_tipo = 'foto' where id = v_uid;
    return json_build_object('ok', true);
  end if;

  if p_avatar is null or jsonb_typeof(p_avatar) <> 'object' then raise exception 'Avatar inválido.'; end if;

  v_cabelo := p_avatar->>'cabelo';
  v_roupa := p_avatar->>'roupa';
  v_acessorio := coalesce(p_avatar->>'acessorio', 'nenhum');
  v_pele := p_avatar->>'pele';
  v_cor_cabelo := p_avatar->>'corCabelo';
  v_cor_roupa := p_avatar->>'corRoupa';
  v_cor_acessorio := coalesce(p_avatar->>'corAcessorio', v_cor_roupa);

  -- Toda cor precisa ser exatamente #rrggbb (protege a tela de TODO MUNDO
  -- que for ver esse avatar depois — ranking, unidades etc.).
  if v_pele !~ v_hex or v_cor_cabelo !~ v_hex or v_cor_roupa !~ v_hex or v_cor_acessorio !~ v_hex then
    raise exception 'Cor inválida.';
  end if;

  v_nivel_cabelo := case v_cabelo
    when 'curto' then 1 when 'cacheado' then 1 when 'moicano' then 3
    when 'trancas' then 5 when 'afro' then 7 else 999 end;
  v_nivel_roupa := case v_roupa
    when 'lisa' then 1 when 'listrada' then 4 when 'estrela' then 6 when 'jaqueta' then 8 else 999 end;
  v_nivel_acessorio := case v_acessorio
    when 'nenhum' then 1 when 'bone' then 2 when 'oculos' then 4 when 'lenco' then 6 when 'coroa' then 10 else 999 end;

  select public.meu_total_pontos() into v_total;
  v_nivel := public.nivel_por_pontos(v_total);

  if v_nivel_cabelo > v_nivel or v_nivel_roupa > v_nivel or v_nivel_acessorio > v_nivel then
    raise exception 'Uma dessas peças ainda não foi desbloqueada (seu nível é %).', v_nivel;
  end if;

  update public.profiles
     set avatar = jsonb_build_object(
           'pele', v_pele, 'cabelo', v_cabelo, 'corCabelo', v_cor_cabelo,
           'roupa', v_roupa, 'corRoupa', v_cor_roupa, 'acessorio', v_acessorio, 'corAcessorio', v_cor_acessorio
         ),
         avatar_tipo = 'personagem'
   where id = v_uid;

  return json_build_object('ok', true, 'nivel', v_nivel);
end;
$$;
grant execute on function public.salvar_avatar(jsonb, text) to authenticated;

notify pgrst, 'reload schema';
