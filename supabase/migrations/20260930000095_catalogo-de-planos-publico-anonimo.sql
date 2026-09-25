-- Fechamento (item 4): a landing pública e o fluxo de aquisição precisam mostrar o catálogo de
-- planos ANTES do login (quem está decidindo se assina ainda não tem conta). planos_disponiveis()
-- já existe (fundação comercial) e já filtra pra só o que é vitrine (publico e ativo e
-- status='publicado') — nenhum dado de conta, assinatura ou pessoa. Só falta o anônimo poder chamar.
grant execute on function public.planos_disponiveis() to anon;

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-catalogo-de-planos-publico-anonimo.sql')
on conflict (arquivo) do update set aplicada_em = now();
