-- =============================================================================
-- 481 — REDE DBV: BUSCAR clubes e pessoas (/rede/buscar)
-- =============================================================================
--   * Só quem está na rede busca (_exigir_comunidade). Só aparecem pessoas que PARTICIPAM da rede
--     (vínculo ativo, recurso ligado no clube, criança com autorização dos pais; responsáveis não
--     aparecem) e clubes com o recurso ligado.
--   * A busca compara o NOME PÚBLICO (nome + sobrenome, o mesmo que o feed mostra) e o nome do
--     clube — nunca o nome completo, para não virar oráculo de nome de criança.
--   * Foto de rosto só com a autorização de imagem (mesmo _comunidade_autor_json).
--   * Termo com pelo menos 2 letras; até 20 pessoas e 10 clubes. p_clube lista as pessoas de um clube.
-- =============================================================================

create or replace function public._rede_busca_norm(p text)
returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g'));
$$;
revoke all on function public._rede_busca_norm(text) from public, anon, authenticated;

create or replace function public.rede_buscar(p_termo text default null, p_clube uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_t text := public._rede_busca_norm(p_termo);
begin
  if p_clube is null and length(v_t) < 2 then
    return jsonb_build_object('pessoas', '[]'::jsonb, 'clubes', '[]'::jsonb);
  end if;
  if p_clube is not null and not public.recurso_habilitado_no_clube(p_clube, 'comunidade') then
    raise exception 'Este clube não participa da Rede DBV.';
  end if;
  return jsonb_build_object(
    'pessoas', (select coalesce(jsonb_agg(y.j order by y.nome), '[]'::jsonb) from (select x.* from (
                  select distinct on (m.user_id) m.user_id,
                         public._comunidade_nome_publico(pr.nome) as nome,
                         public._comunidade_autor_json(m.user_id, m.organizational_unit_id) as j
                    from public.organization_memberships m
                    join public.profiles pr on pr.id = m.user_id
                    join public.organizational_units u on u.id = m.organizational_unit_id
                   where m.status = 'ativo' and m.role <> 'pais'
                     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
                     and (p_clube is null or m.organizational_unit_id = p_clube)
                     and (v_t = '' or public._rede_busca_norm(public._comunidade_nome_publico(pr.nome)) like '%' || v_t || '%'
                          or (p_clube is null and public._rede_busca_norm(u.nome) like '%' || v_t || '%'))
                     and public._rede_participa(m.user_id, m.organizational_unit_id)
                   order by m.user_id, m.starts_at) x
                 order by x.nome limit 20) y),
    'clubes', case when p_clube is not null then '[]'::jsonb else
               (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.nome,
                          'membros', (select count(distinct m.user_id) from public.organization_memberships m
                                       where m.organizational_unit_id = u.id and m.status = 'ativo' and m.role <> 'pais'
                                         and public._rede_participa(m.user_id, u.id))) order by u.nome), '[]'::jsonb)
                  from (select u2.* from public.organizational_units u2
                         where u2.type = 'clube' and public._rede_busca_norm(u2.nome) like '%' || v_t || '%'
                           and public.recurso_habilitado_no_clube(u2.id, 'comunidade')
                         order by u2.nome limit 10) u) end);
end;
$$;
revoke all on function public.rede_buscar(text, uuid) from public, anon;
grant execute on function public.rede_buscar(text, uuid) to authenticated;
