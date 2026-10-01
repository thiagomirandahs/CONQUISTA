# Segurança — chave `service_role` na definição do webhook legado (investigação, 01/10/2026)

Somente leitura em produção. Nenhum valor de segredo foi gravado neste documento. Correção desenhada e testada **localmente** (migration 528 + teste 136); **nada aplicado em produção**.

## 1. Onde está
- **Um único objeto**: o gatilho `push-notificacoes` em `public.notificacoes` (AFTER INSERT → `supabase_functions.http_request(url, 'POST', cabeçalhos…)`), criado pelo painel do Supabase (webhook de banco). O cabeçalho `Authorization: Bearer <JWT>` carrega o JWT cujo payload decodificado tem `role = service_role` do projeto.
- Varredura feita em produção (somente leitura, sem imprimir o valor): gatilhos, corpos de funções (todos os schemas, exceto catálogo), views, jobs do `pg_cron`, 4 segredos do Vault (apenas nomes: `rede_limpeza_url`, `rede_limpeza_secret`, `push_edge_url`, `push_webhook_secret`), `infra_falhas`, `app_erros`, `net._http_response`, fila do `pg_net`, `pg_stat_statements`. **Só o gatilho contém JWT literal.**
- No repositório (versionado): só as chaves *demo* públicas do Supabase local (`supabase-demo`). Nada de produção.

## 2. Quem consegue ler
- Qualquer papel de banco lê a definição de gatilho (catálogo `pg_trigger`), **mas só com conexão SQL direta**. Pela API (PostgREST) o projeto expõe só `public` e `graphql_public`, e **nenhuma RPC pública lê o catálogo** (verificado) — então usuário comum/`anon` do app **não** alcança.
- Alcançam: quem tem acesso ao painel (SQL Editor/Studio/Table editor de gatilhos), quem tem a **senha do banco/URL do pooler**, quem tem um **token de acesso (Management API)** com permissão de ler o banco, e **qualquer cópia de dump**.

## 3. Onde aparece
- **Dumps** (`pg_dump` inclui `CREATE TRIGGER` com os argumentos): sim.
  - `~/.desbravaclube-backups/pre-fase8-janela/conquista-prod-pre-fase8.dump` (1 ocorrência; `LISTA-DO-DUMP.txt` não tem — só nomes).
  - Pastas locais **fora do Git** (ignoradas por `.gitignore`): `backup-conquista-pre-fase6-2026-09-30`, `backup-conquista-pre-fase7-2026-09-30`, e, dentro do worktree, `backup-conquista-2026-09-24` (2 arquivos), `backup-conquista-janela-real-final` (1), `backup-conquista-migracao-2026-09-24` (1). `staging/backups`: nenhuma.
- **Logs**: não aparece em `infra_falhas`, `app_erros`, `pg_stat_statements`, respostas do `pg_net`, nem fila do `pg_net`. **Apareceu na saída de um comando desta sessão** (erro do `pg_restore` ao restaurar o backup de teste imprimiu o `CREATE TRIGGER`), portanto está no histórico/transcrição local da sessão. Não foi enviado ao Git.
- **Outros objetos**: nenhum. `supabase_functions.hooks` (1971 linhas) guarda só `id, hook_table_id, hook_name, created_at, request_id` (sem cabeçalhos).
- **Front/APK**: o bundle publicado usa a chave publicável nova (`sb_publishable_…`); nenhum JWT no bundle (verificado). O APK 1.3.8 embute o bundle da época do build — **conferir** qual chave o secret do CI usava antes de desativar a chave `anon` legada.

## 4. Quem depende dela
- **Nenhum componente** depende desse *webhook*. As Edge Functions usam `SUPABASE_SERVICE_ROLE_KEY` **injetada automaticamente** pelo Supabase (não a cópia do gatilho). Scripts locais obtêm a chave pela Management API em memória (`backup-storage.mjs`). Testes locais usam as chaves demo.
- O projeto já tem as **chaves novas** (`publishable` e `secret`, além de `anon`/`service_role` *legacy* e JWKS).

## 5. O webhook ainda é usado? Os 401 são dele?
- É **disparado** a cada notificação (hoje: 26 chamadas no `pg_net`), mas **sempre falha com 401**: a Edge Function `enviar-push` exige o cabeçalho `x-push-webhook-secret` (valor do secret `PUSH_WEBHOOK_SECRET`) e o legado envia só `Authorization`. Em 01/10/2026: **13 respostas 200 (caminho novo) × 13 respostas 401 (legado)** — os 401 antigos são exatamente ele.
- O caminho que funciona: `trg_notificacao_push` → `_push_disparar()` (security definer, `search_path ''`) lê `push_edge_url` e `push_webhook_secret` do **Vault** e chama a função com `x-push-webhook-secret`. Esse caminho **já é o mecanismo seguro** pedido (Vault) — não há segredo literal nele (teste 136 prova).

## 6. Correção (pronta, NÃO aplicada)
- **Migration `20260930000528_remove-webhook-legado-push-com-segredo.sql`**: `drop trigger if exists "push-notificacoes" on public.notificacoes;` — idempotente, aditiva, sem efeito em bancos locais (o gatilho só existe em produção). Efeito em produção: some o 401 duplicado e some o segredo da definição. **O push continua pelo caminho do Vault.**
- **Teste SQL 136** (`supabase/tests/136_sem_segredo_em_definicoes.sql`, 5 asserts): nenhum JWT literal em gatilhos/funções/views; controle negativo (um JWT plantado é detectado); `push-notificacoes` ausente; `_push_disparar` usa Vault + `x-push-webhook-secret` e não tem `eyJ`; `trg_notificacao_push` ativo. Ele protege contra a reintrodução do problema (qualquer migration futura com segredo literal falha).
- **Script de auditoria** `scripts/auditoria-segredos-em-definicoes.sql` (somente leitura; imprime só tipo/objeto/`role` do JWT, nunca o valor) — após aplicar a 528 em produção o esperado é **nenhuma linha**.
- **Ordem sugerida para produção (quando você autorizar):** (1) backup; (2) aplicar a 528 uma transação, conferir Tenant 001 e que `trg_notificacao_push` segue ativo; (3) enviar uma notificação de teste real e ver 200 no `pg_net`; (4) só então decidir a rotação (ver `SEGURANCA-ROTACAO-DE-CHAVES.md`) — **remover o gatilho não apaga as cópias já existentes nos backups**.

## 7. `PLANO-JANELA-MIGRACAO-REAL.md`
**Contém segredo, sim**: o §A7 registra, em texto, um **token de acesso (prefixo `sbp_…`)** e uma **senha de banco da "Etapa 2"** (24/09), ambos com a nota "não confirmado se foi revogado/resetado". O arquivo é **não versionado** (untracked; nunca esteve no Git). Nesta rodada uma checagem por padrões acabou **exibindo essas duas linhas na saída do terminal** (falha da máscara do meu comando) — está na transcrição local desta sessão; não repito os valores. **Registrado para remoção segura**: apagar o arquivo (e as cópias nas pastas de backup, se existirem) **depois** de você resetar a senha e revogar o token; não apaguei (é seu documento e pode ter valor histórico — se quiser, eu removo as duas linhas e mantenho o resto).
