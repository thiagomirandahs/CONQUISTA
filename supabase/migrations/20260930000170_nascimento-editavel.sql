-- =============================================================================
--  Pendência do piloto: corrigir a DATA DE NASCIMENTO depois do cadastro.
--
--  O nascimento define a idade que libera as Classes (idade mínima), e não havia tela para corrigir.
--  Agora há UM caminho só, pelo servidor:
--    · a própria pessoa (Meu perfil);
--    · a liderança (pode_gerir_no_clube) do clube da aba, para quem é membro ATIVO desse clube.
--  Validação: não pode ser no futuro nem absurda (mais de 100 anos atrás). Cada mudança fica na
--  trilha auditoria_operacoes (77) — SEM a data (dado de criança): só quem mudou, de quem e em qual clube.
--
--  O UPDATE direto da coluna `nascimento` (grant por coluna da 34) é revogado: sem isso a validação e a
--  auditoria poderiam ser contornadas pela API. O front nunca gravou nascimento direto (o cadastro vai
--  pelo metadata do Auth -> handle_new_user, que roda como dono).
--  Leitura: continua o padrão da 86 — o nascimento completo só sai para a própria pessoa (meu_perfil)
--  e, aqui, para a liderança do clube do membro (membro_nascimento), nunca para colegas.
-- =============================================================================

revoke update (nascimento) on public.profiles from authenticated, anon;

-- quem pode mexer no nascimento de p_alvo, no clube da aba (null = pode, e devolve o clube para auditoria)
create or replace function public._nascimento_pode_editar(p_alvo uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    p_alvo = auth.uid()
    or (public.clube_atual_id() is not null
        and public.pode_gerir_no_clube(public.clube_atual_id())
        and exists (select 1 from public.organization_memberships m
                     where m.user_id = p_alvo and m.organizational_unit_id = public.clube_atual_id()
                       and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())))
  );
$$;
revoke all on function public._nascimento_pode_editar(uuid) from public, anon, authenticated;

-- a liderança vê o nascimento atual do membro para corrigir (mesma regra de quem pode editar)
create or replace function public.membro_nascimento(p_usuario_id uuid) returns date
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public._nascimento_pode_editar(p_usuario_id) then
    raise exception 'Sem permissão (apenas a própria pessoa ou a liderança do clube dela).';
  end if;
  return (select nascimento from public.profiles where id = p_usuario_id);
end;
$$;
revoke all on function public.membro_nascimento(uuid) from public, anon;
grant execute on function public.membro_nascimento(uuid) to authenticated;

create or replace function public.nascimento_definir(p_usuario_id uuid, p_nascimento date) returns json
language plpgsql security definer set search_path = '' as $$
declare v_proprio boolean := (p_usuario_id = auth.uid()); v_antes date;
begin
  if not public._nascimento_pode_editar(p_usuario_id) then
    raise exception 'Sem permissão (apenas a própria pessoa ou a liderança do clube dela).';
  end if;
  if p_nascimento is null then
    raise exception 'Informe a data de nascimento.';
  end if;
  if p_nascimento > current_date then
    raise exception 'A data de nascimento não pode ser no futuro.';
  end if;
  if p_nascimento < (current_date - interval '100 years')::date then
    raise exception 'Data de nascimento inválida: confira o ano.';
  end if;
  select nascimento into v_antes from public.profiles where id = p_usuario_id for update;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  if v_antes is not distinct from p_nascimento then
    return json_build_object('ok', true, 'alterado', false);
  end if;
  update public.profiles set nascimento = p_nascimento where id = p_usuario_id;
  -- sem a data na trilha (dado de criança): só o fato, quem fez e se foi a própria pessoa
  perform public._auditar('nascimento_alterado', case when v_proprio then null else public.clube_atual_id() end,
    p_usuario_id, jsonb_build_object('pela_propria_pessoa', v_proprio, 'tinha_valor', v_antes is not null));
  return json_build_object('ok', true, 'alterado', true);
end;
$$;
revoke all on function public.nascimento_definir(uuid, date) from public, anon;
grant execute on function public.nascimento_definir(uuid, date) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-nascimento-editavel.sql')
on conflict (arquivo) do update set aplicada_em = now();
