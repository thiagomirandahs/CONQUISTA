-- =====================================================================
--  Filhos da Conquista — Excluir usuário de vez (2026-07-15)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente.
--
--  ⚠️ DESTRUTIVO E SEM VOLTA. Apagar o perfil leva junto (em cascata) TUDO
--  da pessoa: pontos, entregas, mensalidades, jogos e fotos. A média da
--  unidade muda retroativamente. Use "Desativar" no dia a dia; isto aqui é
--  só pra cadastro duplicado/de teste.
--
--  Por isso NÃO existe policy de delete solta: apagar só por esta função,
--  que exige DIRETORIA (status ativo) e impede apagar a si mesmo.
--
--  OBS: o login (auth.users) não é removido daqui — o e-mail continua
--  reservado, mas a pessoa fica bloqueada (sem perfil, o app não deixa
--  entrar). Pra liberar o e-mail de novo, apague o usuário no painel do
--  Supabase em Authentication > Users.
-- =====================================================================

create or replace function public.excluir_usuario(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_nome text;
begin
  if not exists (
    select 1 from public.profiles
    where id = v_uid and papel = 'diretoria' and status = 'ativo'
  ) then
    raise exception 'Só a diretoria pode excluir usuários.';
  end if;

  if p_id = v_uid then
    raise exception 'Você não pode excluir a si mesmo.';
  end if;

  select nome into v_nome from public.profiles where id = p_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;

  -- Solta as referências de AUDITORIA ("quem lançou/criou/avaliou"). Sem isto o
  -- delete trava numa foreign key e a liderança só vê um erro incompreensível.
  -- Vira null: o registro do clube continua, só sem o nome de quem fez.
  update public.atividades   set criado_por     = null where criado_por     = p_id;
  update public.entregas     set avaliado_por   = null where avaliado_por   = p_id;
  update public.pontos       set lancado_por    = null where lancado_por    = p_id;
  update public.mensalidades set registrado_por = null where registrado_por = p_id;
  update public.notificacoes set criado_por     = null where criado_por     = p_id;
  -- Fotos do mural FICAM (são memória do clube); só perdem o autor.
  update public.fotos        set autor_id       = null where autor_id       = p_id;

  -- Agora sim: apaga o perfil. Em cascata vão os registros PRÓPRIOS da pessoa
  -- (pontos dela, entregas, mensalidades, jogos, vínculos de responsável).
  delete from public.profiles where id = p_id;
  return json_build_object('ok', true, 'nome', v_nome);
end;
$$;
grant execute on function public.excluir_usuario(uuid) to authenticated;

notify pgrst, 'reload schema';
