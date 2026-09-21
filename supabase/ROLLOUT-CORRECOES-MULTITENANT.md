# Rollout — correções multi-tenant (migrations 13–17)

Nada aqui foi aplicado em produção. Este guia é para **quando** você decidir aplicar.
Produção é manual (SQL Editor) e o front é automático (Vercel no push): a ordem importa.

## Antes de qualquer coisa
1. **Backup** (Supabase → Database → Backups). É o único "rollback" real: as migrations trocam
   policies/funções e renomeiam papéis (`responsavel` → `pais`).
2. Aplique **tudo na mesma janela**: as migrations `20260921000001`–`12` (SaaS) **e** `13`–`17` (correções).
   Não pare no meio: a `11` remove o alvo de conflito antigo de mensalidades e a `14` o devolve.
3. Confira que não há mensalidade duplicada (a `14` aborta com mensagem clara se houver):
   `select desbravador_id, mes, ano, count(*) from mensalidades group by 1,2,3 having count(*) > 1;`

## Ordem
| # | O quê | Onde |
|---|-------|------|
| 1 | SQL `…000001` a `…000012` (na ordem) | SQL Editor, um por vez |
| 2 | SQL `…000013` → `…000014` → `…000015` → `…000016` → `…000017` (na ordem) | SQL Editor, um por vez |
| 3 | Verificações abaixo | SQL Editor |
| 4 | **Edge Function `enviar-push`**: colar o novo `supabase/functions/enviar-push/index.ts` | Painel → Edge Functions (só **depois** do `…17`) |
| 5 | Merge do front (Vercel publica sozinho) | GitHub |

Por que o front pode ir depois (ou antes) sem quebrar:
- **Mensalidades**: o front publicado grava com `onConflict(desbravador_id,mes,ano)`. O front desta branch
  **mantém** esse alvo (não usa o `club_id,…`), e a `14` recria a constraint antiga ao lado da nova. As duas
  formas funcionam antes e depois do SQL. PWA/APK antigos em cache também.
- **Cadastro de responsável**: a partir do SQL, responsável só entra com link de convite. O front antigo
  (aba "Sou responsável" sem convite) passa a receber "Cadastro de responsável exige convite" — é o esperado.
- **Convites**: o front novo lê o token do fragmento `#convite=` e ainda aceita links antigos `?convite=`.
  Sem o SQL `…17`, a lista de convites mostra erro dentro do cartão (não derruba a tela).
- **Edge Function**: a nova versão chama `push_destinatarios` (criada no `…17`). Se publicar **antes** do SQL,
  ela responde 500 e não envia push (falha fechada, de propósito). Publique depois do SQL.

## Verificações depois do SQL
```sql
-- 1) todo perfil tem 1 vínculo de clube e o papel/status batem (esperado: 0 e 0)
select count(*) from profiles p where not exists (select 1 from organization_memberships m where m.user_id = p.id);
select public.reconciliar_vinculos_perfis();   -- esperado: 0 (nada a ajustar)

-- 2) ninguém sem login executa RPC (esperado: só clube_legado_id)
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');

-- 3) o cadastro público continua listando as unidades (rode como anon no app: abrir /cadastro)
```
Teste manual rápido (logando como cada papel): liderança vê **Aprovações** com um cadastro novo; membro vê
ranking/mural; **responsável** só vê "Meu Filho"; leilão fecha pelo botão e pelo cron com a mesma cobrança.

## Testes (local, sem produção)
```bash
npm run test:db      # replay do zero de TODAS as migrations + seed num banco isolado + 10 arquivos de teste
npm run check        # lint + vitest + build
```
Para validar com um `supabase db reset` de verdade: rode o reset e depois
`bash supabase/tests/run-tests.sh --db postgres --no-replay`.

## O que ainda NÃO está separado por clube (fechado para outros clubes, funcionando só no Tenant 001)
Leilão (itens/lances/rateio/cron), jogos/chefão/recordes, missões, duelos, chat, bichinho, bíblia,
`config_clube` (PIX, rodízio, popup) e o bucket público `imagens` (URL pública; a tabela do mural é isolada,
o arquivo em si não). Enquanto isso, um segundo clube em produção **não usa** essas telas.
