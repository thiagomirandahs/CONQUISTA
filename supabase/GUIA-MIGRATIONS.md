# 🗄️ Guia de Migrations — Filhos da Conquista

Este guia define **como o banco muda daqui pra frente**. Não apaga nada do que já
existe; organiza o fluxo pra ninguém mais rodar SQL fora de ordem e reverter uma
função sem querer.

> Já existe o [`MIGRATION.md`](MIGRATION.md) (como **mudar de servidor** usando o
> `schema.sql`). Este aqui é sobre o **dia a dia**: criar, aplicar e rastrear
> pequenas mudanças.

---

## 1) Fonte da verdade

Duas coisas, com papéis diferentes:

| Arquivo | Papel | Muda? |
|---|---|---|
| **Arquivos `supabase/AAAA-MM-DD-nome.sql`** | O **histórico oficial**: cada mudança do banco, em ordem de data. | **Imutável** depois de aplicado em produção. |
| **`supabase/schema.sql`** | Uma **foto consolidada** do banco inteiro (recria tudo do zero, idempotente). Serve pra montar um servidor novo. | Só é **atualizado** quando você consolida (ver seção 6). |

**Regra de ouro:** o estado real do banco = `schema.sql` **+** todos os `.sql`
datados aplicados **em ordem crescente de data**. Como quase toda função usa
`create or replace`, **quem roda por último vence** — por isso a ordem importa.

⚠️ **O perigo nº 1:** rodar um arquivo **antigo depois** de um novo. Ex.: se você
rodar hoje o `2026-08-02-pontos-por-estrela.sql` (que define uma versão velha de
`registrar_jogo`), ele **desfaz** o `2026-08-28-anticheat-partidas.sql`. O banco
não avisa. A seção 3 (ledger) existe pra impedir isso.

---

## 2) Como CRIAR uma migration nova

1. Crie **um arquivo novo** em `supabase/` com a data de hoje:
   `AAAA-MM-DD-descricao-curta.sql` (ex.: `2026-09-10-leilao-lote.sql`).
2. **Nunca edite** um arquivo já aplicado em produção — crie outro.
3. Escreva **idempotente** (rodar 2× não quebra nem duplica):
   - funções: `create or replace function ...`
   - tabelas: `create table if not exists ...`
   - colunas: `alter table ... add column if not exists ...`
   - políticas: `drop policy if exists "x" on ...; create policy "x" ...`
   - dados de configuração: `insert ... on conflict (...) do nothing/update`
4. Toda função com dados sensíveis termina com os **grants** certos
   (`revoke execute ... from public, anon; grant execute ... to authenticated;`).
5. Termine o arquivo com `notify pgrst, 'reload schema';` (faz a API enxergar a
   mudança na hora) **e** registre no ledger (seção 3):
   ```sql
   insert into public.migracoes_aplicadas (arquivo) values ('2026-09-10-leilao-lote.sql')
   on conflict (arquivo) do update set aplicada_em = now();
   ```

> Use o [`_TEMPLATE-migration.sql`](_TEMPLATE-migration.sql) como ponto de partida.

---

## 3) Como SABER o que já foi aplicado (ledger)

Rode **uma vez** o [`2026-08-28-ledger-migrations.sql`](2026-08-28-ledger-migrations.sql).
Ele cria a tabela `public.migracoes_aplicadas`. A partir daí, cada migration
registra o próprio nome ao rodar (passo 5 acima).

Pra ver o que está aplicado, no SQL Editor:
```sql
select arquivo, aplicada_em from public.migracoes_aplicadas order by arquivo;
```

Antes de rodar qualquer `.sql`, confira se o nome **já aparece** na lista. Se
aparecer, **não rode de novo** (a menos que seja de propósito). Isso mata o
perigo nº 1: você sempre sabe o que já entrou e em que ordem.

> Os arquivos **antigos** (antes do ledger) não estão registrados — tudo bem.
> O ledger vale **daqui pra frente**. Se quiser, registre os antigos de uma vez
> com um `insert ... values ('arquivo1'), ('arquivo2'), ...` — opcional.

---

## 4) Como APLICAR

**Hoje (sem CLI, do jeito que você prefere):**
1. Supabase → **SQL Editor** → **New query**.
2. Cole o conteúdo do arquivo **mais novo ainda não aplicado**.
3. **Run**. Confira que terminou sem erro.
4. O próprio arquivo registra no ledger (passo 5 da seção 2).

**Sempre em ORDEM de data**, um de cada vez, do mais antigo pendente ao mais novo.

> 💡 Dica: o `intellisense` do SQL Editor às vezes atrapalha em SQL grande —
> desligue antes de colar (ver memória do projeto).

---

## 5) Staging antes de produção

O ideal é **testar a migration num banco de teste** antes do de verdade:

- **Opção leve (recomendada agora):** crie um **2º projeto Supabase grátis**
  ("Conquista-STAGING"). Rode nele o `schema.sql` uma vez pra ter a estrutura.
  Toda migration nova: rode **primeiro no staging**, veja se o app (apontando pro
  staging via `.env.staging`) continua funcionando, **depois** rode em produção.
- **Regra:** produção só recebe SQL que já passou no staging.

---

## 6) Consolidar o `schema.sql` (de tempos em tempos)

Quando juntar muitas migrations, atualize a foto:
- Supabase → **Database** → **Schema Visualizer** / ou use o dump do painel, **ou**
- copie as definições atuais das funções/tabelas pro `schema.sql`.

Isso mantém o `schema.sql` capaz de recriar o banco do zero sem precisar rodar as
71 migrations em sequência. **Não apague** as migrations ao consolidar — elas
continuam sendo o histórico.

---

## 7) Rollback (desfazer)

Como as funções são `create or replace`, **desfazer = rodar a versão anterior**:

1. Ache o arquivo que definia a versão **anterior** da função (ex.: pra reverter
   `2026-08-29-anticheat-partidas.sql` você roda o `registrar_jogo` do
   `2026-08-28-hardening-registrar-jogo.sql`). O histórico do git ajuda:
   `git log --oneline -- supabase/` e `git show <commit>:supabase/arquivo.sql`.
2. Crie uma migration nova de rollback (`AAAA-MM-DD-rollback-xyz.sql`) com essa
   definição anterior — **não** reaproveite o arquivo velho (senão quebra o
   ledger/ordem). Registre no ledger normalmente.
3. Pra tabelas novas: `drop table if exists ...` **só** se tiver certeza de que
   nada usa (cuidado com dados). Prefira `alter table ... disable` de recursos a
   dropar dados.

> **Nunca** faça rollback rodando um arquivo antigo direto — isso volta *tudo*
> que veio depois dele. Sempre uma migration nova e específica.

---

## 8) Migração gradual pro fluxo OFICIAL do Supabase CLI (quando quiser)

O fluxo acima (arquivos datados + ledger) já é seguro. Quando o projeto crescer,
vale migrar pro oficial do Supabase, que **rastreia sozinho** o que foi aplicado
(tabela `supabase_migrations.schema_migrations`) e roda tudo com um comando:

**Passo a passo sugerido (sem pressa):**
1. Instale o Supabase CLI e rode `supabase init` (cria `supabase/config.toml` e a
   pasta `supabase/migrations/`).
2. `supabase link --project-ref ezaajfisptbslheogaha` (liga ao projeto).
3. **Baseline:** `supabase db pull` — captura o estado ATUAL do banco como a
   primeira migration oficial (`supabase/migrations/0000_baseline.sql`). A partir
   daqui, o CLI sabe onde o banco está.
4. Novas mudanças passam a ser: `supabase migration new nome` → escreve o SQL →
   `supabase db push` (aplica no remoto e registra). Staging: `supabase db push`
   apontando pro projeto de staging primeiro.
5. Os arquivos datados antigos viram **histórico congelado** (não rode mais); o
   `migrations/` oficial vira a nova fonte da verdade.

> Isso é **opcional** e pode esperar. O importante é: **uma mudança = uma
> migration nova, ordenada e imutável** — o que os dois fluxos garantem.
