-- =====================================================================
--  Filhos da Conquista — <TÍTULO CURTO> (AAAA-MM-DD)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente (rodar 2x não quebra). Nada é apagado.
--
--  O QUE MUDA / POR QUÊ: <explique em 1-3 linhas o risco/feature.>
--
--  RODAR ANTES: <migrations das quais esta depende, se houver>
-- =====================================================================

-- Exemplo de função (idempotente + grants):
-- create or replace function public.minha_funcao(p_x int)
-- returns json language plpgsql security definer set search_path = '' as $$
-- begin
--   if auth.uid() is null then raise exception 'Não autenticado.'; end if;
--   -- ... regra ...
--   return json_build_object('ok', true);
-- end;
-- $$;
-- revoke execute on function public.minha_funcao(int) from public, anon;
-- grant execute on function public.minha_funcao(int) to authenticated;

-- Exemplo de tabela/coluna/política (todos idempotentes):
-- create table if not exists public.minha_tabela (id uuid primary key default gen_random_uuid());
-- alter table public.minha_tabela add column if not exists nova_coluna text;
-- drop policy if exists "minha policy" on public.minha_tabela;
-- create policy "minha policy" on public.minha_tabela for select to authenticated using (true);

-- SEMPRE no fim: recarrega a API e registra no ledger (ver GUIA-MIGRATIONS.md)
notify pgrst, 'reload schema';
insert into public.migracoes_aplicadas (arquivo)
values ('AAAA-MM-DD-descricao-curta.sql')  -- <-- troque pelo nome REAL deste arquivo
on conflict (arquivo) do update set aplicada_em = now();
