-- =============================================================================
-- 420 — Preferências de acessibilidade salvas na conta (tamanho de letra e alto contraste)
-- =============================================================================
-- Pedido do dono (28/09): crianças, pais e coordenadores idosos, 100% no celular. A pessoa escolhe
-- A− / A / A+ / A++ e liga/desliga o alto contraste no menu da conta; a escolha vale em qualquer
-- aparelho em que ela entrar (por isso fica no banco, não só no navegador).
--
-- Onde: profiles.preferencias (jsonb). NÃO entra no grant de colunas do SELECT direto (86): só a
-- própria pessoa lê, pela meu_perfil() (que devolve p.* da própria linha).
-- Escrita: só pela RPC salvar_preferencias_acessibilidade, que grava SEMPRE na linha de auth.uid()
-- (não recebe id — não há como apontar para a conta de outra pessoa) e valida cada valor.
-- Chaves conhecidas: fonte ('pequena'|'normal'|'grande'|'enorme') e alto_contraste (boolean).
-- =============================================================================

alter table public.profiles
  add column if not exists preferencias jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.profiles add constraint profiles_preferencias_objeto
    check (jsonb_typeof(preferencias) = 'object' and pg_column_size(preferencias) <= 2048);
exception when duplicate_object then null; end $$;

create or replace function public.salvar_preferencias_acessibilidade(p_fonte text, p_alto_contraste boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_nova jsonb;
begin
  if v_uid is null then
    raise exception 'Entre na sua conta para salvar as preferências.' using errcode = '42501';
  end if;
  if p_fonte is null or p_fonte not in ('pequena', 'normal', 'grande', 'enorme') then
    raise exception 'Tamanho de letra inválido.' using errcode = '22023';
  end if;
  if p_alto_contraste is null then
    raise exception 'Informe se o alto contraste fica ligado ou desligado.' using errcode = '22023';
  end if;

  update public.profiles p
     set preferencias = coalesce(p.preferencias, '{}'::jsonb)
                        || jsonb_build_object('fonte', p_fonte, 'alto_contraste', p_alto_contraste)
   where p.id = v_uid
  returning p.preferencias into v_nova;

  if v_nova is null then
    raise exception 'Perfil não encontrado.' using errcode = 'P0002';
  end if;
  return v_nova;
end $$;

revoke all on function public.salvar_preferencias_acessibilidade(text, boolean) from public, anon;
grant execute on function public.salvar_preferencias_acessibilidade(text, boolean) to authenticated;

comment on column public.profiles.preferencias is
  'Preferências da própria pessoa (acessibilidade: fonte, alto_contraste). Gravadas só por salvar_preferencias_acessibilidade(); lidas só por meu_perfil().';
