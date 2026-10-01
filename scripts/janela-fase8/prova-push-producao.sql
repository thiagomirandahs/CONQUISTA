-- PROVA em PRODUÇÃO do caminho de push após a 528 — transação que termina em ROLLBACK: nada é enviado (o pg_net só envia no COMMIT).
-- Esperado: gatilho legado ausente; 1 notificação nova => EXATAMENTE 1 chamada na fila, só com Content-Type e x-push-webhook-secret (sem Authorization).
\set ON_ERROR_STOP on
begin;
do $$
declare club uuid; q0 int; q1 int; p text; hdrs text; ev uuid; nlegacy int;
begin
  select club_id, para into club, p from public.notificacoes order by created_at desc limit 1;
  select count(*) into q0 from net.http_request_queue;
  select count(*) into nlegacy from pg_trigger where tgname = 'push-notificacoes';
  insert into public.notificacoes (titulo, corpo, tipo, para, club_id, chave_push)
  values ('prova-fase9 (rollback)', 'nao enviar', 'teste', p, club, 'prova-fase9-' || gen_random_uuid());
  select count(*) into q1 from net.http_request_queue;
  select regexp_replace(headers::text, ':[^,}]*', ':<v>', 'g') into hdrs from net.http_request_queue order by id desc limit 1;
  select push_evento_id into ev from public.notificacoes where titulo = 'prova-fase9 (rollback)' limit 1;
  raise notice 'R|gatilho legado existe=%|%', nlegacy, case when nlegacy = 0 then 'PASSOU' else 'FALHOU' end;
  raise notice 'R|nova notificacao enfileira EXATAMENTE 1 chamada pelo caminho novo (% -> %)|%', q0, q1, case when q1 = q0 + 1 then 'PASSOU' else 'FALHOU' end;
  raise notice 'R|cabecalhos da chamada: %|%', hdrs, case when hdrs ~ 'x-push-webhook-secret' and hdrs !~* 'authorization' then 'PASSOU' else 'FALHOU' end;
  raise notice 'R|evento de push criado e marcado como despachado|%', case when ev is not null and exists (select 1 from public.push_eventos e where e.id = ev and e.despachado_em is not null) then 'PASSOU' else 'FALHOU' end;
end $$;
rollback;
