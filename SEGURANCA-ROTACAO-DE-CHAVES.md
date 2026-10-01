# Plano seguro de rotação de credenciais (NADA executado — depende da sua autorização explícita)

Estado (01/10/2026): chaves **legacy** (`anon`, `service_role`, JWT HS256) **e** chaves novas (`publishable` `sb_pub…`, `secret` `sb_sec…`) existem no projeto; JWKS presente. O front publicado já usa a **publicável nova**. Edge Functions leem a `service_role` injetada automaticamente (`SUPABASE_SERVICE_ROLE_KEY`; também há `SUPABASE_SECRET_KEYS`).

## Regras de execução (valem para tudo abaixo)
1. Uma credencial por vez, fora de horário de uso, com backup recente (pré-Fase 8 serve; refazer se passar de 7 dias).
2. Segredo novo **nunca** passa pelo chat, por commit, por log; vai direto para o gerenciador de senhas e para o `~/.desbravaclube-prod.env` (por você).
3. Depois de cada rotação: teste de fumaça (login, Minha Classe, Rede, push de teste, `scripts/janela-fase8/00-pre-leitura.sql`), e só então a próxima.
4. Antes de qualquer rotação: aplicar a migration 528 (tira o segredo do banco) — para a chave nova não nascer de novo dentro de um gatilho.

## 1. `service_role`
**Consumidores a mapear antes** (checklist): 4 Edge Functions (`enviar-push`, `gerar-documento-pdf`, `gerar-documento-pdf-final`, `limpar-fotos-rede`) — usam a variável injetada; `scripts/janela-fase8/backup-storage.mjs` (lê pela Management API); E2E locais (chaves demo, não afetados). **Nenhum** componente usa a cópia do gatilho legado.
**Caminhos** (escolher com você):
- **A. Migrar para as chaves novas e desativar as legacy (recomendado).** (1) confirmar quais clientes ainda enviam a `anon` legada (web: não — usa `sb_publishable`; **APK 1.3.8: conferir a chave embutida**; PWA antigos em cache se atualizam sozinhos); (2) redeploy das 4 Edge Functions lendo `SUPABASE_SECRET_KEYS` (ou o nome novo que o Supabase injeta) — hoje a função usa `SUPABASE_SERVICE_ROLE_KEY`, então exige pequena mudança de código + teste de bundle; (3) desativar as chaves legacy no painel (Settings → API Keys); (4) conferir 24 h. **Reversível** enquanto o painel permitir reativar.
- **B. Rotacionar o JWT secret legado.** Gera novas `anon` e `service_role` e **invalida as antigas e as sessões assinadas com o segredo antigo** → todos os usuários precisariam entrar de novo e qualquer APK/PWA com a `anon` antiga quebra até atualizar. Só faria se houvesse suspeita real de uso indevido; custo alto.
**Impacto de A:** baixo se o APK não depender da `anon` legada; **impacto de B:** logout geral + APKs antigos sem acesso até atualizar. Em ambos, backups antigos continuam contendo a chave velha — por isso o passo "apagar/criptografar backups antigos" (abaixo).

## 2. Senha do banco
Painel → Database → Settings → **Reset database password** (gerar forte, 24+ caracteres). Efeitos: invalida `DB_URL_PRODUCAO` do `~/.desbravaclube-prod.env` (você atualiza), a conexão do pooler, e o secret `SUPABASE_DB_URL` das Edge Functions (o Supabase atualiza o injetado; **conferir** se alguma função o usa). Não afeta usuários do app. Testar: `psql "$DB_URL_PRODUCAO" -c 'select 1'` e `00-pre-leitura.sql`. **Prioridade alta**: a senha da "Etapa 2" (24/09) está em texto no documento local (ver investigação §7) e a rotação nunca foi confirmada.

## 3. `SUPABASE_ACCESS_TOKEN` (Management API) e tokens temporários
- Revogar em Account → Access Tokens: o token do `~/.desbravaclube-prod.env` **e** o da "Etapa 2" (prefixo `sbp_…`, citado no documento local).
- Criar **um novo token com validade curta** só para a janela seguinte (e revogar ao fim). O env file só deve existir durante a janela.
- Outros tokens temporários encontrados: nenhum outro no repositório; o `gh` usa o cofre do sistema (conferir escopos em GitHub → Settings → Developer settings); Vercel/CI: segredos ficam no painel (rever quem tem acesso). Não há `.env` de produção versionado (`.env.local` é só chave publicável + URL).

## 4. Higiene dos backups locais
Pastas com a chave antiga (todas fora do Git): `backup-conquista-pre-fase6-2026-09-30`, `…pre-fase7-2026-09-30`, `…2026-09-24`, `…janela-real-final`, `…migracao-2026-09-24` e `~/.desbravaclube-backups/pre-fase8-janela`. **Depois da rotação**, as cópias antigas deixam de dar acesso, mas ainda contêm dados pessoais → criptografar (`7z -mhe=on -p`) ou apagar as que não forem necessárias (decisão sua; as de 24/09 repetem ~675 MB cada).

## 5. Ordem recomendada
(1) aplicar 528 → (2) senha do banco → (3) tokens de acesso → (4) service_role pelo caminho A → (5) criptografar/limpar backups antigos → (6) apagar o env file e o documento com a senha. Cada passo com sua autorização.

---
## Atualização — rodada de segurança da Fase 9 (01/10/2026, depois da execução)
**Feito em produção (autorizado):** migration **528** (webhook legado removido; auditoria de segredos: **0 JWT literal** em gatilhos, funções, views e cron; `pg_stat_statements` sem JWT; push novo intacto — prova em `scripts/janela-fase8/prova-push-producao.sql`).
**Ainda NÃO feito (decisão sua):** rotação de qualquer credencial; criptografia/eliminação dos backups antigos.

**Verificação do APK (antes de qualquer mudança em chave legada):** baixei os APKs publicados (v1.3.0, v1.3.3, v1.3.6, v1.3.8) e o APK de teste da Fase 8 e procurei, sem imprimir valores, as chaves embutidas: **todos embutem a chave publicável nova (`sb_publishable_…`) e nenhum JWT legado** (`anon`/`service_role`). O front web também. Consequência: desativar as chaves *legacy* **não deve quebrar nenhum APK 1.3.x nem o site** — o risco que sobra é o das Edge Functions (leem `SUPABASE_SERVICE_ROLE_KEY` injetada) e de scripts/integrações externas que eu não enxergo. APKs 1.2.x carregam o site direto (usam a chave do site = publicável). **Não rotacionei nem desativei nada.**

**Ordem prática recomendada a partir daqui (cada passo com a sua autorização):**
1. Senha do banco → reset no painel; atualizar `~/.desbravaclube-prod.env`; testar `psql … select 1` e `00-pre-leitura.sql`.
2. Tokens de acesso (Management API): revogar o do env file e o da "Etapa 2"; criar um novo, curto e com escopo mínimo, só para as próximas janelas.
3. `service_role` legada: trocar as 4 Edge Functions para a chave secreta nova (pequena mudança de código + `test:edge:bundle` + redeploy), observar 24 h, só então **desativar as chaves legacy** no painel (nada de rotacionar o JWT secret: desloga todos).
4. Backups antigos: `bash scripts/seguranca/backups-com-segredo-plano.sh` (lista, somente leitura) → criptografar com `gpg --symmetric` → provar a volta pelo hash → só então apagar o texto claro (com a sua confirmação). Backups feitos **depois** da 528 já não contêm a chave.
5. Apagar o env file de produção e o `PLANO-JANELA-MIGRACAO-REAL.md` (senha/token em texto) quando terminar a janela.

---
## Execução da contenção pós-incidente (01/10/2026, noite)
**Contexto:** a senha do banco de produção foi impressa por engano numa mensagem de erro de script (já corrigido) e ficou na transcrição desta sessão; considerada COMPROMETIDA.
- **Senha do banco: ROTACIONADA** (`scripts/seguranca/rotacionar-senha-banco.mjs`, Management API `PATCH /v1/projects/{ref}/database/password`). Nova senha aleatória de 48 caracteres, gravada só no `~/.desbravaclube-prod.env` (antes do envio, num `.novo`), nunca impressa. Provas: antes a antiga era aceita; depois a nova é ACEITA e a antiga RECUSADA. Dependências: **só** o env file local usado pelos scripts de janela/backup. Edge Functions não usam a URL do banco (usam as chaves injetadas), GitHub Actions não guarda senha do banco, o Vault e o pg_cron/pg_net não dependem dela.
- **Senha "Etapa 2" do PLANO-JANELA-MIGRACAO-REAL.md:** já estava RECUSADA pelo banco antes desta rotação. O arquivo foi **zerado e removido** (não versionado; não está na Lixeira). Ele tinha só PREFIXOS truncados de token (9–10 caracteres, nenhum casa com o token em uso).
- **Token da Management API (`SUPABASE_ACCESS_TOKEN`):** a API pública **não tem endpoint para listar/revogar/criar tokens pessoais** (só o painel: Account → Access Tokens). Não foi revogado. Ele nunca foi impresso; segue necessário para as próximas janelas. **Ação do dono no painel:** quando terminarmos as janelas, revogar e (se preciso) criar um novo token de escopo mínimo; depois apagar o env file.
- **`service_role` / chaves legacy:** NÃO desativadas (as legacy estão `enabled`). Dependências mapeadas: front (bundle atual), os APKs 1.3.0/1.3.3/1.3.6/1.3.8 e o de teste e os secrets do GitHub usam só a chave **publicável**; as 6 Edge Functions leem `SUPABASE_SERVICE_ROLE_KEY` **injetada** pela plataforma; scripts de janela buscam a chave pela Management API em memória. **Incerto:** o comportamento da injeção nas Edge Functions com as legacy desativadas, as variáveis do painel da Vercel (a CLI não está logada) e integrações externas que eu não enxergo → por regra, **pendência**, não executado. Também não rotacionei o JWT secret (deslogaria todos).
- **Backups:** inventariados, nada apagado (ver relatório). Os dumps feitos ANTES da 528 contêm a `service_role` legacy (que continua válida) e hashes de `auth.users` — tratar como segredo.
