-- =====================================================================
--  Filhos da Conquista — Bichinho: itens (enfeites) + galeria do clube
--  (2026-08-26)
--
--  Enfeites (boné, laço, óculos, cartola, coroa...) DESBLOQUEIAM por NÍVEL
--  (igual ao avatar) — não têm compra/moeda. A criança equipa um enfeite
--  no bichinho e todos veem na galeria "Pets do clube".
--
--  SEGURANÇA: bichinho_equipar() confere no SERVIDOR que (a) o item é um da
--  lista e (b) já foi desbloqueado pro nível de quem equipa. O item também
--  tem CHECK no banco — assim nunca entra um valor "inventado" que seria
--  injetado no SVG que TODA a galeria renderiza (XSS armazenado).
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Depende de 2026-08-26-bichinho.sql e de nivel_por_pontos()/
--  meu_total_pontos() (2026-08-24-avatar.sql) já rodados.
-- =====================================================================

alter table public.bichinhos add column if not exists item text not null default 'nenhum';
alter table public.bichinhos drop constraint if exists bichinhos_item_ok;
alter table public.bichinhos add constraint bichinhos_item_ok
  check (item in ('nenhum', 'bone', 'laco', 'oculos', 'gravata', 'cachecol', 'chapeu', 'coroa'));

-- Nível mínimo de cada item (tem que bater com ITENS em src/lib/bichinhoPecas.js).
create or replace function public._bichinho_nivel_item(p_item text)
returns int language sql immutable as $$
  select case p_item
    when 'nenhum' then 1 when 'bone' then 1 when 'laco' then 2 when 'oculos' then 3
    when 'gravata' then 4 when 'cachecol' then 5 when 'chapeu' then 6 when 'coroa' then 8
    else null end;
$$;

-- ---------- Equipar um enfeite (valida nível no servidor) ----------
create or replace function public.bichinho_equipar(p_item text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_min int;
  v_nivel int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  v_min := public._bichinho_nivel_item(p_item);
  if v_min is null then raise exception 'Enfeite inválido.'; end if;
  v_nivel := public.nivel_por_pontos(public.meu_total_pontos());
  if v_nivel < v_min then raise exception 'Esse enfeite abre no nível %. Continue juntando pontos! ✨', v_min; end if;

  update public.bichinhos set item = p_item where usuario_id = v_uid and vivo;
  if not found then raise exception 'Você não tem um bichinho vivo pra enfeitar.'; end if;
  return json_build_object('ok', true, 'item', p_item);
end;
$$;
grant execute on function public.bichinho_equipar(text) to authenticated;

-- ---------- meu_bichinho: agora devolve o item equipado e o meu nível ----------
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

-- ---------- Galeria: os bichinhos de todo o clube (só aparência) ----------
-- Devolve o visual (espécie, nome do pet, estágio, enfeite, vivo) + o dono
-- (nome/avatar). NÃO expõe as barrinhas privadas (fome etc.). Só membros
-- ativos (não responsáveis) enxergam.
create or replace function public.pets_do_clube()
returns table (
  dono_id uuid, dono_nome text, dono_avatar jsonb, dono_avatar_tipo text, dono_foto text,
  especie text, pet_nome text, estagio int, item text, vivo boolean, ofensiva int
) language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, p.avatar, p.avatar_tipo, p.foto,
    b.especie, b.nome, public._bichinho_estagio(b.dias_cuidados), b.item,
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
