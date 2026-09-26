-- =============================================================================
--  Pendência do piloto: FOTO ÓRFÃ de comprovação de requisito.
--
--  O envio de comprovação é em dois passos: sobe a foto para o bucket privado 'comprovacoes'
--  (<uid>/requisitos/<ts>.<ext>) e só depois grava o caminho pela RPC (requisito_salvar /
--  especialidade). Se o segundo passo falha (rede caiu), a foto sobra no bucket sem ninguém apontar
--  para ela. Duas defesas:
--
--  1) CLIENTE: se a etapa seguinte falhar, o app apaga a foto que acabou de subir. Para isso o dono
--     ganha DELETE — só no próprio prefixo <uid>/requisitos/ e só de objeto que NINGUÉM referencia
--     (_comprovacao_referenciada). Uma foto já ligada a um requisito, a um envio (histórico) ou a um
--     snapshot selado nunca é apagável pelo cliente.
--
--  2) ROTINA (operador): comprovacoes_orfas(p_dias, p_limite) lista os objetos de
--     comprovacoes/*/requisitos/ com mais de p_dias (padrão 7) e não referenciados. A remoção em si é
--     pela API do Storage (o Supabase proíbe DELETE direto em storage.objects — o arquivo físico
--     ficaria para trás), com o script scripts/limpar-comprovacoes-orfas.mjs (ver cabeçalho dele):
--     por padrão só LISTA; apaga com --apagar. Só service_role executa a listagem.
--
--  "Referenciado" = o caminho aparece em qualquer um destes:
--     member_requirements.evidencia_path, requirement_submissions.evidencia_path,
--     member_specialty_requirements.evidencia_path, class_completion_snapshots.conteudo (texto).
--  Qualquer outro prefixo (missoes/, atividades/, experiencias/) fica FORA — nunca é listado.
-- =============================================================================

create or replace function public._comprovacao_referenciada(p_nome text) returns boolean
language sql stable security definer set search_path = '' as $$
  -- sem oráculo: para uma conta logada, caminho que não é do próprio prefixo conta sempre como
  -- "referenciado" (a função não revela nada sobre arquivos alheios). Rotina (sem uid) vê tudo.
  select (auth.uid() is not null and p_nome not like auth.uid()::text || '/%')
      or exists (select 1 from public.member_requirements where evidencia_path = p_nome)
      or exists (select 1 from public.requirement_submissions where evidencia_path = p_nome)
      or exists (select 1 from public.member_specialty_requirements where evidencia_path = p_nome)
      or exists (select 1 from public.class_completion_snapshots where strpos(conteudo::text, p_nome) > 0);
$$;
revoke all on function public._comprovacao_referenciada(text) from public, anon;
grant execute on function public._comprovacao_referenciada(text) to authenticated;  -- usada pela policy

drop policy if exists "comprovacao dono apaga requisito orfao" on storage.objects;
create policy "comprovacao dono apaga requisito orfao" on storage.objects for delete to authenticated
  using (
    bucket_id = 'comprovacoes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = 'requisitos'
    and array_length(storage.foldername(name), 1) = 2
    and not public._comprovacao_referenciada(name)
  );

create or replace function public.comprovacoes_orfas(p_dias int default 7, p_limite int default 500)
returns table (nome text, criado_em timestamptz, bytes bigint)
language sql stable security definer set search_path = '' as $$
  select o.name, o.created_at, coalesce((o.metadata ->> 'size')::bigint, 0)
    from storage.objects o
   where o.bucket_id = 'comprovacoes'
     and (storage.foldername(o.name))[2] = 'requisitos'
     and array_length(storage.foldername(o.name), 1) = 2
     and (storage.foldername(o.name))[1] ~ '^[0-9a-f-]{36}$'
     and o.created_at < now() - make_interval(days => greatest(coalesce(p_dias, 7), 7))
     and not public._comprovacao_referenciada(o.name)
   order by o.created_at
   limit least(greatest(coalesce(p_limite, 500), 1), 1000);
$$;
revoke all on function public.comprovacoes_orfas(int, int) from public, anon, authenticated;
grant execute on function public.comprovacoes_orfas(int, int) to service_role;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-comprovacoes-orfas.sql')
on conflict (arquivo) do update set aplicada_em = now();
