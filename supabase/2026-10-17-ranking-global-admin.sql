-- Controle administrativo dos desafios globais. Preserva resultados e auditoria.
create or replace function public.ranking_global_desafio_ocultar(p_desafio_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not public.eh_admin_plataforma() then raise exception 'Apenas o administrador da plataforma pode ocultar desafios.'; end if;
  update public.ranking_global_desafios set ativo = false where id = p_desafio_id;
  if not found then raise exception 'Desafio global não encontrado.'; end if;
  return jsonb_build_object('ok', true, 'id', p_desafio_id);
end; $$;
revoke all on function public.ranking_global_desafio_ocultar(uuid) from public, anon;
grant execute on function public.ranking_global_desafio_ocultar(uuid) to authenticated;
