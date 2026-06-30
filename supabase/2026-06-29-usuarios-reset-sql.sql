-- =====================================================================
--  Filhos da Conquista — Página Usuários (listar com e-mail + resetar senha)
--  SEM Edge Function: tudo por SQL. Só liderança (instrutor/diretoria).
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole TUDO -> Run.
--  Depois disso a página Gestão > Usuários funciona direto (o app já está
--  publicado pela Vercel). Não precisa de CLI nem de função.
-- =====================================================================

-- pgcrypto fornece crypt()/gen_salt() para gerar o hash bcrypt da senha
create extension if not exists pgcrypto with schema extensions;

-- 1) Lista os perfis JUNTO com o e-mail do cadastro (auth.users).
--    Só liderança ativa pode chamar; os demais recebem erro.
create or replace function public.listar_usuarios()
returns table (id uuid, nome text, foto text, papel text, status text, unidade_id uuid, email text)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles eu
                 where eu.id = auth.uid() and eu.status = 'ativo' and eu.papel in ('instrutor','diretoria')) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  return query
    select p.id, p.nome, p.foto, p.papel, p.status, p.unidade_id, u.email::text
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by p.nome;
end;
$$;
grant execute on function public.listar_usuarios() to authenticated;

-- 2) Define uma nova senha para um membro (grava o hash em auth.users).
--    Só liderança ativa pode chamar.
create or replace function public.resetar_senha_membro(alvo uuid, nova_senha text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles eu
                 where eu.id = auth.uid() and eu.status = 'ativo' and eu.papel in ('instrutor','diretoria')) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  if nova_senha is null or length(nova_senha) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(nova_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = alvo;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
end;
$$;
grant execute on function public.resetar_senha_membro(uuid, text) to authenticated;

notify pgrst, 'reload schema';
