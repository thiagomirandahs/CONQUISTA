# Rollout — multi-tenant completo (migrations 01–28)

Nada aqui foi aplicado em produção. Este guia é para **quando** você decidir aplicar.
Produção é manual (SQL Editor) e o front é automático (Vercel no push): a ordem importa.
A matriz de cada módulo está em `supabase/AUDITORIA-MULTITENANT.md`.

## Antes de qualquer coisa
1. **Backup** (Supabase → Database → Backups). É o único "rollback" real: as migrations trocam
   policies/funções, renomeiam papéis (`responsavel` → `pais`), mudam chaves primárias (config, catálogo de jogos) e
   removem os helpers globais legados.
2. **Pré-voo (somente leitura)**: cole `supabase/PREFLIGHT-PRODUCAO.sql` no SQL Editor e rode. Só siga se a
   primeira linha (`RESUMO`) disser **ok**. Ele lista, com o nome do arquivo antigo a rodar, qualquer tabela/coluna/função
   legada que falte (ex.: `ajudas`, `partidas`, `bichinho-sono`, `rodizio`, ledger) e os dados que fariam uma
   migration abortar (nome de unidade repetido, mensalidade duplicada, papel fora do vocabulário).
3. **Publique o front ANTES do SQL** (merge → Vercel). O front novo grava PIX/popup/rodízio pela RPC `config_gravar` e, se ela ainda
   não existe, cai no upsert antigo — então funciona antes e depois do SQL. (Front/APK antigo em cache **não** sabe gravar essas
   configs depois do SQL: leitura e o resto seguem; atualize o app.)
4. Aplique **tudo na mesma janela**: as migrations `20260921000001`–`12` (SaaS) **e** `13`–`28`.
   Não pare no meio: a `11` remove o alvo de conflito antigo de mensalidades e a `14` o devolve; a `24` troca a chave do catálogo de jogos.
5. O SQL Editor é atômico por execução: se uma migration falhar, ela **não** aplica nada — corrija a causa e rode de novo.
   Cada uma das `03`–`06` e `08`–`12` deve ser aplicada **uma vez** (não são reaplicáveis); as `13`–`28` são idempotentes. (A `02` também: aplique uma vez.)

## Ordem
| # | O quê | Onde |
|---|-------|------|
| 0 | `PREFLIGHT-PRODUCAO.sql` → `RESUMO = ok` | SQL Editor |
| 1 | Merge do front (Vercel publica sozinho) | GitHub |
| 2 | SQL `…000001` a `…000012` (na ordem) | SQL Editor, um por vez |
| 3 | SQL `…000013` → … → `…000028` (na ordem) | SQL Editor, um por vez |
| 4 | Verificações abaixo | SQL Editor |
| 5 | **Edge Function `enviar-push`**: colar o novo `supabase/functions/enviar-push/index.ts` | Painel → Edge Functions (só **depois** do `…17`) |

O que cada migration faz: `13` papéis/vínculos + escopo do legado · `14` RLS por clube + blindagem dos responsáveis ·
`15` leilão (cron = "Encerrar agora") · `16` RPCs/storage isolados + responsáveis por clube · `17` convites e push por clube ·
`18` correções da revisão de segurança · `19` correções da revisão de regressão (excluir usuário, foto do mural, `nova_temporada`, desempenho) ·
**`20` config do clube por clube + provisionamento** · **`21` duelos** · **`22` missões/devocional** · **`23` leilão** ·
**`24` jogos (trilha, rodízio, recordes, ajudas, chefão, catálogo, cron)** · **`25` chat, bichinho, bíblia** ·
**`26` remove os helpers legados** (+ view do chat) · **`27` conteúdo (missões/versículos) por clube** · **`28` correções das revisões da rodada 2** (cron de leilão isolado por leilão + registro de falhas em `cron_falhas`, teto de pontos, limites do bucket `imagens`, push que segue o usuário logado, sem TRUNCATE para usuário, erro claro do instrutor).

## Verificações depois do SQL
```sql
-- 1) todo perfil tem 1 vínculo de clube e o papel/status batem (esperado: 0 e 0)
select count(*) from profiles p where not exists (select 1 from organization_memberships m where m.user_id = p.id);
select public.reconciliar_vinculos_perfis();   -- esperado: 0 (nada a ajustar)

-- 2) ninguém sem login executa RPC (esperado: só clube_legado_id)
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');

-- 3) nenhuma linha ficou sem clube nos módulos novos (esperado: 0 em todas)
select (select count(*) from config_clube where club_id is null) + (select count(*) from jogos_trilha where club_id is null)
     + (select count(*) from desafios where club_id is null) + (select count(*) from chat_mensagens where club_id is null);

-- 4) o Tenant 001 tem o chat geral, o catálogo de jogos e o conteúdo de antes
select (select count(*) from chat_conversas where tipo = 'geral'), (select count(*) from jogos_trilha), (select count(*) from desafios);
```
Teste manual rápido (logando como cada papel): liderança vê **Aprovações**; membro vê ranking/mural; **responsável** só vê "Meu Filho";
leilão fecha pelo botão e pelo cron com a mesma cobrança; **Gestão → 🎮 Jogos** liga/desliga; **Gestão → Conteúdo** edita missões
e versículos; **PIX e popup** salvam; chat geral e da unidade funcionam; **Ranking** e **Perfil** abrem rápido.

## Comportamentos novos que você vai notar (todos intencionais)
- **Responsável (`pais`)** só enxerga o portal "Meus Filhos". **Instrutor** não redefine senha de instrutor/diretoria nem abre nova temporada.
- **INSERT manual no SQL Editor**: em `unidades`, `atividades`, `eventos`, `config_clube`, `jogos_trilha`, `desafios`, `versiculos`,
  `leiloes`… é preciso informar `club_id` (sem sessão de usuário não há clube "atual"); `update config_clube … where chave = 'x'`
  sem filtrar `club_id` atinge o mesmo `x` de **todos** os clubes. Fotos/avisos/pontos sem clube caem no Tenant 001 (como sempre).
- **Jogo NOVO** no catálogo: use `select public.catalogo_jogo_definir('chave','Nome','🎲',ordem,false,true)` (cria em todos os clubes;
  o último `true` liga só no clube legado). `insert into jogos_trilha` puro deixou de servir.
- **Clube novo** (`insert into organizational_units … type='clube'`) já nasce com config, catálogo de jogos (só a memória ligada), desafios
  de unidade, chat geral e uma cópia do conteúdo do clube legado.
- Sessões já abertas **não** são derrubadas ao resetar senha/excluir usuário (o token expira sozinho, ~1 h).

## Notas das revisões independentes (o que mudou de comportamento e o que observar)
- **Cargo de liderança**: o instrutor tentando promover a diretoria/instrutor/tesoureiro, ou desativar/rebaixar quem já tem esses cargos,
  agora recebe uma **mensagem de erro clara** (antes o cargo era revertido em silêncio e a unidade da pessoa era apagada); a tela de
  Usuários nem oferece essas opções ao instrutor. A diretoria faz tudo como antes.
- **Push "para todos"** não chega mais a responsáveis nem a inativos (o sino já os excluía desde 14/07). Quem entra num aparelho passa a
  ser o dono dele (o app chama `push_registrar` ao entrar e apaga a inscrição de quem sai).
- **Membros não leem perfis de inativos, pendentes e responsáveis** (blindagem dos menores): o autor de uma mensagem antiga de chat,
  se hoje estiver inativo, aparece como "?". A liderança segue vendo todos.
- **Front/APK antigo em cache**: PIX continua salvando (o front antigo usa `update`); **popup, rodízio e "só desbravador" falham** até
  atualizar o app (o upsert por `chave` deixou de existir). O APK é o que não se atualiza sozinho.
- **Leilão com o front publicado antes do SQL**: o front trata a tabela `club_features` inexistente como "leilão ligado" (compat).
- **Migration 26** faz `drop function` sem `cascade` nos 4 helpers antigos: se abortar listando uma policy/view criada **à mão** em
  produção que depende de `pode_gerir()`, troque essa policy por `pode_gerir_no_clube(club_id)` e rode de novo (nada é aplicado pela metade).
- **SQL solto `2026-09-16-mais-missoes-foto.sql`** (missões de foto): agora funciona nos DOIS bancos (antigo e multi-clube) e é idempotente.
- **Cron**: a falha de um clube não derruba os outros e fica registrada: `select * from public.cron_falhas order by quando desc;`
  (o job aparece como sucesso no `cron.job_run_details`; olhe essa tabela).
- **Pontos**: cada lançamento tem teto de ±1.000.000; leilão: item/lance até 1.000.000. `imagens`: só imagem, até 15 MB.

## Testes (local, sem produção)
```bash
npm run test:db          # replay do zero de TODAS as migrations + seed num banco isolado + 23 arquivos de teste
npm run test:db:upgrade  # simula o upgrade de produção: schema legado + dados vivos + pré-voo → 01..28 (96 asserts)
npm run test:db:real     # `supabase db reset` DE VERDADE (CLI 2.117.0 via npx) + a suíte no banco resultante
npm run check            # lint + vitest + build
```
`supabase db reset` recria o banco local de trabalho (só tem dados do seed). Nunca use `--linked`.

## O que ainda NÃO é por clube
Nada de negócio. Restam só as exceções declaradas em `AUDITORIA-MULTITENANT.md` (conteúdo da Bíblia, dispositivos de push, ledger) e os
riscos residuais listados lá (bucket `imagens` público por URL, front antigo em cache, esm.sh não fixado).
