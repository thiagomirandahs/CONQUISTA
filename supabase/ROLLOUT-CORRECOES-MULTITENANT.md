# Rollout — correções multi-tenant (migrations 13–19)

Nada aqui foi aplicado em produção. Este guia é para **quando** você decidir aplicar.
Produção é manual (SQL Editor) e o front é automático (Vercel no push): a ordem importa.

## Antes de qualquer coisa
1. **Backup** (Supabase → Database → Backups). É o único "rollback" real: as migrations trocam
   policies/funções e renomeiam papéis (`responsavel` → `pais`).
2. **Pré-voo (somente leitura)**: cole `supabase/PREFLIGHT-PRODUCAO.sql` no SQL Editor e rode. Só siga se a
   primeira linha (`RESUMO`) disser **ok**. Ele lista, com o nome do arquivo antigo a rodar, qualquer tabela/coluna/função
   legada que falte (ex.: `ajudas`, `partidas`, `bichinho-sono`, `rodizio`, ledger) e os dados que fariam uma
   migration abortar (nome de unidade repetido, mensalidade duplicada, papel fora do vocabulário).
3. Aplique **tudo na mesma janela**: as migrations `20260921000001`–`12` (SaaS) **e** `13`–`19` (correções).
   Não pare no meio: a `11` remove o alvo de conflito antigo de mensalidades e a `14` o devolve.
4. O SQL Editor é atômico por execução: se uma migration falhar, ela **não** aplica nada — corrija a causa e rode de novo.
   Mas cada uma das `03`–`06` e `08`–`12` deve ser aplicada **uma vez** (não são reaplicáveis); as `13`–`19` são idempotentes.

## Ordem
| # | O quê | Onde |
|---|-------|------|
| 0 | `PREFLIGHT-PRODUCAO.sql` → `RESUMO = ok` | SQL Editor |
| 1 | SQL `…000001` a `…000012` (na ordem) | SQL Editor, um por vez |
| 2 | SQL `…000013` → `14` → `15` → `16` → `17` → `18` → `19` (na ordem) | SQL Editor, um por vez |
| 3 | Verificações abaixo | SQL Editor |
| 4 | **Edge Function `enviar-push`**: colar o novo `supabase/functions/enviar-push/index.ts` | Painel → Edge Functions (só **depois** do `…17`) |
| 5 | Merge do front (Vercel publica sozinho) | GitHub |

O que cada correção faz: `13` papéis/vínculos + escopo do legado · `14` RLS por clube + blindagem dos responsáveis ·
`15` leilão (cron = "Encerrar agora") · `16` RPCs/storage isolados + responsáveis por clube · `17` convites e push por clube ·
`18` correções da revisão de segurança independente · `19` correções da revisão de regressão (excluir usuário, foto do mural,
`nova_temporada` só diretoria, desempenho do ranking/chat).

Por que o front pode ir depois (ou antes) sem quebrar:
- **Mensalidades**: o front publicado grava com `onConflict(desbravador_id,mes,ano)`. O front desta branch
  **mantém** esse alvo (não usa o `club_id,…`), e a `14` recria a constraint antiga ao lado da nova. As duas
  formas funcionam antes e depois do SQL. PWA/APK antigos em cache também.
- **Cadastro de responsável**: a partir do SQL, responsável só entra com link de convite. O front antigo
  (aba "Sou responsável" sem convite) passa a receber "Cadastro de responsável exige convite" — é o esperado.
- **Convites**: o front novo lê o token do fragmento `#convite=` e ainda aceita links antigos `?convite=`.
  Sem o SQL `…17`, a lista de convites mostra erro dentro do cartão (não derruba a tela).
- **Comprovações (fotos de missão/atividade)**: o front novo só cai no bucket público se o bucket privado **não existir**;
  qualquer outra falha (permissão, tamanho, rede) mostra erro em vez de mandar foto de criança para o bucket público.
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
ranking/mural; **responsável** só vê "Meu Filho"; leilão fecha pelo botão e pelo cron com a mesma cobrança;
**Ranking** e **Perfil** abrem rápido; diretoria consegue **Excluir usuário** de quem já teve mensalidade.

## Comportamentos novos que você vai notar (todos intencionais)
- **Responsável (`pais`)** só enxerga o portal "Meus Filhos": não lê perfis, pontos, fotos, agenda nem unidades.
- **Instrutor** não redefine senha de instrutor/diretoria e não abre nova temporada (é da diretoria, como antes).
  A tela de Usuários ainda mostra o botão; o erro aparece na própria tela.
- **INSERT manual no SQL Editor** em `unidades`, `atividades` e `eventos` precisa informar `club_id` (sem sessão de usuário
  não há clube "atual"). Pelo app nada muda.
- Sessões já abertas **não** são derrubadas ao resetar senha/excluir usuário (o token expira sozinho, ~1 h).

## Testes (local, sem produção)
```bash
npm run test:db      # replay do zero de TODAS as migrations + seed num banco isolado + 12 arquivos de teste
bash supabase/tests/run-tests.sh --upgrade   # simula o upgrade de produção: schema legado + dados vivos + pré-voo → 01..19
npm run check        # lint + vitest + build
```
Para validar com um `supabase db reset` de verdade (a CLI não estava instalada onde isto foi desenvolvido — o replay acima
faz a mesma sequência num banco isolado): rode o reset e depois
`bash supabase/tests/run-tests.sh --db postgres --no-replay`.

## O que ainda NÃO está separado por clube (fechado para outros clubes, funcionando só no Tenant 001)
Leilão (itens/lances/rateio/cron), jogos/chefão/recordes, missões, duelos, chat, bichinho, bíblia,
`config_clube` (PIX, rodízio, popup) e o bucket público `imagens` (URL pública; a tabela do mural é isolada,
o arquivo em si não). Enquanto isso, um segundo clube em produção **não usa** essas telas.
Ordem sugerida para tenantizar de verdade: `config_clube` (PIX/popup — sem isso um 2º clube não recebe mensalidade) →
duelos → missões → leilão (interno) → jogos/chefão.
