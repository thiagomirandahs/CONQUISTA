# Deploy de migrations e recuperação — o procedimento, passo a passo

> Fase 9, item 9. Cada passo daqui foi **executado** no staging (`scripts/drill-migration.mjs`) e
> no upgrade simulado de produção (`run-tests.sh`, que agora o roda sempre). Onde este documento
> diz "o drill mostrou", há um log em `supabase/e2e/evidencias-fase9/`.

## O que pode dar errado — e por que são dois procedimentos

| | F1 — a migration **aborta** | F2 — a migration **commita e estraga** |
|---|---|---|
| exemplo | erro de SQL no meio do arquivo | um `WHERE` errado: suspende quem não devia, apaga o caixa de um clube |
| o que o SQL Editor diz | erro | **"Success"** |
| estado do banco | **intacto** — o SQL Editor executa o arquivo numa transação só. Medido: a coluna e o índice criados antes do erro **não existem** depois | danificado, e nada avisa |
| quem percebe | quem aplicou | só a **conferência** (passo 6) |
| recuperação | nenhuma no banco: corrigir o arquivo, aplicar numa próxima janela | **restore** do backup de antes da release (passo 8), e a release de novo |
| tempo medido no staging | imediato | **17,2 s** do "decidi restaurar" até a release certa no ar (banco de 2 MB) |

A F2 é a razão de este documento existir. Nenhuma migration corretiva traz de volta um caixa apagado.

---

## Antes da janela

1. **Replay e upgrade verdes** na máquina de quem vai aplicar:
   `bash supabase/tests/run-tests.sh` — roda as 154 migrations do zero, a suíte inteira e, desde
   a fase 9, o **upgrade de produção simulado** (schema legado + dados → todas as migrations).
2. **Pré-voo** em produção (somente leitura): `supabase/PREFLIGHT-PRODUCAO.sql`.
   ⚠️ Ele cobre as dependências das migrations **1 a 28**. As de 29 em diante não têm pré-voo
   próprio; o que as protege é o upgrade simulado do passo 1.
3. **Ordem de deploy** de cada release, lida no cabeçalho das migrations. Hoje há UMA com ordem
   obrigatória: a **74** só depois do **front novo publicado** (ela remove o alvo de upsert que o
   front anterior usa em Mensalidades).
4. **Janela sem uso.** O produto **não tem modo manutenção**. Tudo o que for escrito entre o backup
   (passo 5) e um eventual restore (passo 8) **se perde** — o drill mediu: a escrita feita entre o
   backup e o incidente não voltou, e a feita depois do incidente também não. Combine o horário com
   os clubes; o sábado de reunião é o pior momento possível.

## Na janela

5. **Backup imediatamente antes**, e conferido:
   - produção: confirmar no painel que existe ponto de PITR **depois** do último uso (plano Pro);
   - staging: `node scripts/restaurar-staging.mjs backup` — banco (`pg_dump -Fc` como
     `supabase_admin`), **arquivos do Storage** e manifesto com sha256.
6. **Retrato de antes** — o manifesto (`scripts/lib/manifesto.mjs`): contas, vínculos ativos por
   clube, pontos, mensalidades e fotos por clube, matrículas, documentos, objetos do Storage, cron,
   policies, funções, gatilhos. Guardar a saída.
7. **Aplicar uma migration por vez**, na ordem, cada uma numa execução do SQL Editor, **com a linha
   do ledger no fim do mesmo texto**:

   ```sql
   -- (conteúdo inteiro do arquivo 20260929000073_o-clube-do-ato-e-a-aba.sql)
   ;insert into supabase_migrations.schema_migrations (version, name, statements)
    values ('20260929000073', 'o-clube-do-ato-e-a-aba', array[]::text[]);
   ```

   Na mesma execução, porque é atômica: se a migration cai, o registro cai junto. Sem essa linha,
   ninguém sabe depois o que foi aplicado — o SQL Editor não guarda histórico.

   Depois da última, **conferir o ledger pelo CONJUNTO**, nunca pelo `max(version)`:

   ```sql
   select v from unnest(array['20260929000073','20260929000074']) v
    where v not in (select version from supabase_migrations.schema_migrations);   -- tem de vir VAZIO
   ```

   O drill pegou isso: no primeiro ensaio a 73 falhou, a 74 passou, e o `max()` dizia "74".
8. **Conferência — o passo que pega a F2.** Rodar o manifesto de novo e comparar com o do passo 6.
   Diferenças esperadas são as que a release descreve; **qualquer outra é incidente**. E uma sonda
   de uso: entrar como um membro de cada clube e abrir o app.

## Se a conferência acusar dano (F2)

9. **Parar.** Não aplicar migration "corretiva" em cima de dado apagado.
10. **Restaurar**:
    - produção: **PITR** para o instante do passo 5 (restaura no mesmo projeto: o nome do banco, o
      dono e os jobs do `pg_cron` ficam);
    - staging: `node scripts/restaurar-staging.mjs in-place staging/backups/<instante>`.
11. **Conferir o restore** — manifesto idêntico ao do passo 6, **e o deploy seguinte possível**:

    ```sql
    select pg_get_userbyid(datdba) from pg_database where datname = 'postgres';  -- tem de ser postgres
    ```

    ⚠️ **O achado do drill.** Um restore que recria o banco com outro dono devolve dados, policies e
    GRANTs — a suíte passa — e **quebra a próxima migration**: o schema `public` pertence a
    `pg_database_owner`, e o `postgres` (o papel do SQL Editor) perde o direito de criar nele.
    Medido: "permission denied for schema public" ao reaplicar a 73. O restore do item 8 tinha o
    mesmo defeito e passou sem ver, porque não aplicava nada depois de restaurar. Os dois scripts
    agora criam o banco com `owner postgres` e **provam** que uma migration ainda passa.
12. **Aplicar a release corrigida** (passo 7) e conferir (passo 8).

---

## Onde isto foi medido

| ensaio | comando | resultado |
|---|---|---|
| drill F1 + F2 no staging vivo (72 → 74) | `node scripts/drill-migration.mjs` | DRILL OK — `evidencias-fase9/09-drill-migration.log` |
| legado de produção simulado → 74, com dados | `bash supabase/tests/run-tests.sh --upgrade` | 117 asserts |
| gates da fase sobre o banco atualizado | `run-tests.sh --no-replay` (06, 24, 26, 54–58) | todos OK — depois de duas ações de operador que o banco real também exigiria: encerrar o leilão aberto e decidir o cadastro pendente |
| restore em ambiente descartável | `node scripts/restaurar-staging.mjs completo` | RESTORE COMPROVADO, 53,4 s — `evidencias-fase9/08-backup-restore.log` |

**O que estes números não são:** RTO de produção. São tempos de máquina num banco de 2 MB. O RTO
real soma a decisão humana, o PITR do plano e a conferência; o RPO real é o instante do ponto de
PITR escolhido.
