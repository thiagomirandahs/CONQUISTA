# Plano da JANELA DE PRODUÇÃO — Fase 8 (NÃO EXECUTADO; aguarda autorização explícita do dono)

Estado de referência: produção na migration **513**, front publicado = `main` `eb897ef`. Local: branch `fase-7-conteudo-e-comunidade` com as migrations **514–527**.
Regra de ouro: **migrations primeiro (uma por vez), front por último.** Nunca: `migration repair`, `db reset`, `db push --linked`, editar o ledger à mão, force push.

## 0. Ordem (obrigatória; o script recusa fora de ordem)
`514 → 516 → 515 → 517 → 518 → 519 → 520 → 521 → 522 → 523 → 524 → 525 → 526 → 527 → FRONTEND`
Por quê: o front novo NÃO funciona com o banco 513 (16 RPCs ausentes + 3 assinaturas: `rede_publicar(p_alcance)`, `comunidade_comentarios(p_antes_id)`, `rede_foto_exige_aprovacao(p_alcance)`), enquanto o front ANTIGO funciona com o banco final (321 RPCs presentes; contratos PostgREST de Rede/Classes/Requisitos 38 asserts). A 516 vai antes da 515/517 porque só desliga áudios (tabelas da 514).
Prova (ensaio local): `npm run test:db:ensaio-janela` aplica 514…527 num banco no estado de produção e, **depois de cada uma**, confere o front atualmente publicado (contrato antigo 19 asserts + todas as RPCs do front antigo + comprovações antigas idênticas) → OK nas 14.

## 1. Pré-requisitos (todos "sim" antes de começar)
- [ ] Dono confirmou o teste em **Android real** (ao menos blocos 1–3 do roteiro) e **autorizou a janela**.
- [ ] `git status` limpo para arquivos versionados; HEAD = o relatado; `origin/main` = `eb897ef`; tag de retorno criada: `git tag pre-fase8-main-eb897ef eb897ef` (e enviada só na janela).
- [ ] **Backups feitos e conferidos** (seção 2).
- [ ] Ledger de produção = 513 (`bash scripts/janela-fase8/aplicar-migration.sh 514` sem confirmação mostra o plano e recusa se não for).
- [ ] Nenhuma transação longa aberta (a leitura `00-pre-leitura.sql` mostra `transacoes_abertas_ha_mais_de_30s = 0`).
- [ ] Modo manutenção: NÃO ligar (as migrations são curtas e o front antigo segue funcionando); ligar só se o dono preferir.

## 2. Backup (banco ≠ Storage)
O plano atual do Supabase **não** entrega backup automático utilizável (API: 0 backups, PITR desligado). Portanto:
1. **Banco (lógico):** `bash scripts/janela-fase8/backup-banco.sh` → `~/.desbravaclube-backups/pre-fase8-<data>/conquista-prod-pre-fase8.dump` (pg_dump -Fc de `public`, `auth`, `storage` [**só metadados**], `supabase_migrations`) + `SHA256.txt` + `TAMANHO.txt` + `LISTA-DO-DUMP.txt`. Tamanho de referência: o dump da Fase 7 tinha ~6 MB.
2. **Restaurável?** `bash scripts/janela-fase8/backup-banco.sh --testar-restauracao <pasta>` restaura num banco local descartável e conta tabelas/linhas. Provado hoje com o dump da Fase 7: 185 tabelas, 51 vínculos, ledger 503; apenas 2 erros ignoráveis (schema `public` já existe; schema `supabase_functions` ausente localmente).
3. **Storage (arquivos) — SEPARADO:** o pg_dump **NÃO inclui** os arquivos. Hoje: **447 objetos, ~672 MB** (comprovacoes 64 obj/219 MB; imagens 369/484 MB; comunidade 10/1,1 MB; publico 4/0,2 MB). `node scripts/janela-fase8/backup-storage.mjs` baixa tudo (somente leitura) para `~/.desbravaclube-backups/storage-<data>/` com `MANIFESTO.tsv` (sha256) e confere contagem/bytes contra `storage.objects`. `--so-listar` só confere. (O download em si não foi exercitado hoje; só a listagem.)
4. Guardar uma cópia **fora deste computador**. Nada de Storage é apagado em nenhuma etapa.

## 3. Execução, migration por migration
Para CADA migration `N` na ordem acima:
1. **Plano (não grava):** `bash scripts/janela-fase8/aplicar-migration.sh N` — confere ordem e ledger, salva leitura geral e a impressão digital do Tenant 001 ANTES.
2. **Aplicar** (somente na janela autorizada):
   `CONFIRMO_JANELA_FASE8=SIM JANELA_PRODUCAO_AUTORIZADA_PELO_DONO=SIM bash scripts/janela-fase8/aplicar-migration.sh N`
   → UMA transação (`--single-transaction`), `lock_timeout 5s`, `statement_timeout 300s`, **ledger inserido na mesma transação**; erro ⇒ ROLLBACK automático e **PARE**.
3. **Depois (o script faz):** impressão do Tenant 001 idêntica antes × depois; ledger; `99-pos-invariantes.sql` (RLS em todas as tabelas, `search_path` fixo, `anon` só nas RPCs públicas, sem escrita direta de `anon`, objetos da migration existem).
4. Se **qualquer** verificação falhar: PARE, não siga para a próxima, avise o dono. Depois do COMMIT não há rollback automático (não existem migrations "down"); a recuperação é corrigir para frente ou, em desastre, restaurar do backup.
- **Travas do script:** recusa fora de ordem, recusa migration já no ledger, recusa gravar em produção sem a segunda variável `JANELA_PRODUCAO_AUTORIZADA_PELO_DONO=SIM`. Ensaio local: `JANELA_DB_URL=postgresql://…@127.0.0.1:54322/<banco>` (nunca toca produção).
- **Cuidados por migration:** 515 faz backfill dos posts (os de diretoria/instrutor viram "Comunidade", o resto "Só meu clube"); 521 recria o índice de conquistas; 527 cria `classe_codigo` + índice único de conquista ativa e **aborta** se existir conquista ativa duplicada (produção tem 0 conquistas de classe).

## 4. Depois da 527 e antes do front
- `psql "$DB_URL_PRODUCAO" -X -v ON_ERROR_STOP=1 -v clube_slug=filhos-da-conquista -f scripts/janela-fase8/smoke-fase8-producao.sql` — smoke que termina em **ROLLBACK** (34 asserts: leituras novas, relato→devolução→reenvio→histórico imutável, registro de classe concluída, revogação, 1 conquista ativa única, papéis de publicação na Rede, anon). Usa pessoas do clube só como identidade e altera nascimento/recursos só dentro da transação.
- Conferir o front **antigo** (o publicado hoje) no navegador: login, Minha Classe, Rede (se habilitada), Gestão → tudo funcional.

## 5. Front (só depois do passo 4)
1. `git push origin fase-7-conteudo-e-comunidade:main` — **fast-forward** (sem `--force`); a Vercel publica `main` sozinha. Enviar também a tag de retorno.
2. Aguardar o deploy "Production success"; conferir no navegador: landing nova, `/entrar?codigo=…`, Minha Classe (seções), Rede (abas), Gestão → Inscrições (link com `https://app.desbravaclube.com.br`).
3. OTA do APK: o commit gera a atualização por `android/OTA.md`; conferir a versão no aparelho (item do roteiro).
4. PWA: abrir, atualizar o service worker sem loop.

## 6. Rollback do FRONT (simples)
O front antigo é compatível com o banco final: se algo estiver errado no front novo, promover o deploy anterior na Vercel (ou `git revert` do range e novo push) — **não** é preciso mexer no banco.

## 7. Critérios para ABORTAR (e não prosseguir)
Qualquer migration falhar · impressão do Tenant 001 mudar · invariante FALHOU · ledger diferente do esperado · front antigo quebrar no ensaio ou na checagem manual · smoke FALHOU · backup não restaurável.

## 8. O que NÃO fazer
`migration repair`, `db reset`, `db push --linked`, marcar ledger à mão, force push, apagar Storage, ligar flags de Especialidades, importar catálogo real, mudar Auth/SMTP durante a janela (SMTP/confirmação de e-mail seguem em trilha própria: `AUTH-SMTP-PROXIMOS-PASSOS.md`).

## 9. Arquivos do procedimento
`scripts/janela-fase8/{00-pre-leitura.sql, aplicar-migration.sh, 99-pos-invariantes.sql, smoke-fase8-producao.sql, backup-banco.sh, backup-storage.mjs}`, `supabase/tests/compat/{ensaio-janela-fase8.sh, contrato-rpc-front.mjs}`, evidências da Fase 7 como modelo em `supabase/e2e/evidencias-fase7/`.
