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
