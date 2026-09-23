-- =============================================================================
--  CONFIGURAÇÃO DO PUSH — o único passo manual que sobrou, e ele está escrito aqui.
--
--  O MECANISMO (gatilho, extensão, funções de destinatário) vem nas migrations: um projeto novo
--  já nasce com tudo ligado. O que NÃO pode vir no repositório são os dois valores específicos
--  do ambiente — a URL da Edge Function e o segredo do webhook. Eles ficam no Vault do Supabase,
--  e é isto que este arquivo instala.
--
--  Antes da Fase 8.1 isto era "abrir o painel, Database Webhooks, criar um, colar a URL, colar o
--  header". Nada disso ficava registrado, e um projeto novo subia sem push em silêncio.
--
--  COMO USAR (SQL Editor do painel, uma vez por ambiente):
--    1. troque os dois valores abaixo;
--    2. rode o arquivo inteiro;
--    3. confira a saída da última consulta — as duas linhas precisam aparecer.
--
--  NÃO comite este arquivo com os valores preenchidos. Ele é um molde.
-- =============================================================================
\set ON_ERROR_STOP on

-- ---- 1. os dois valores do ambiente -----------------------------------------
-- URL:     https://<ref-do-projeto>.supabase.co/functions/v1/enviar-push
-- SEGREDO: o MESMO valor cadastrado em Edge Functions -> Secrets -> PUSH_WEBHOOK_SECRET.
--          Gere com algo como:  openssl rand -base64 32
\set url     'https://SEU-PROJETO.supabase.co/functions/v1/enviar-push'
\set segredo 'COLE-AQUI-O-MESMO-VALOR-DO-PUSH_WEBHOOK_SECRET'

-- ---- 2. grava no Vault (idempotente: rodar de novo ATUALIZA, não duplica) ----
do $$
declare v_url text := :'url'; v_segredo text := :'segredo';
begin
  if v_url like '%SEU-PROJETO%' or v_segredo like 'COLE-AQUI%' then
    raise exception 'Preencha a URL e o segredo antes de rodar este arquivo.';
  end if;

  if exists (select 1 from vault.secrets where name = 'push_edge_url')
    then perform vault.update_secret((select id from vault.secrets where name = 'push_edge_url'), v_url);
    else perform vault.create_secret(v_url, 'push_edge_url', 'URL da Edge Function enviar-push');
  end if;

  if exists (select 1 from vault.secrets where name = 'push_webhook_secret')
    then perform vault.update_secret((select id from vault.secrets where name = 'push_webhook_secret'), v_segredo);
    else perform vault.create_secret(v_segredo, 'push_webhook_secret', 'Fechadura do webhook de push (header x-push-webhook-secret)');
  end if;
end $$;

-- ---- 3. conferência ---------------------------------------------------------
-- Mostra que os dois segredos existem SEM imprimir o valor deles.
select name,
       description,
       length(decrypted_secret) > 0 as preenchido,
       created_at
  from vault.decrypted_secrets
 where name in ('push_edge_url', 'push_webhook_secret')
 order by name;

-- Se aparecerem as duas linhas, a próxima notificação inserida já dispara o push.
-- Para confirmar de ponta a ponta, insira uma notificação de teste e olhe:
--   select * from public.infra_falhas order by id desc limit 5;   -- precisa continuar vazio
--   select * from net._http_response order by id desc limit 5;    -- precisa ter um 200
