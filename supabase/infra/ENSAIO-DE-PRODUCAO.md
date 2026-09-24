# Ensaio de produção — o upgrade sobre uma cópia real, antes da janela

> Fase 9.1, itens 3 e 4. Ferramenta: `scripts/ensaio-producao.mjs`. Evidências:
> `supabase/e2e/evidencias-fase9_1/ensaio-*.md`.

Produção está no estado **legado** (baseline + SQLs antigos aplicados à mão; nenhuma migration do
SaaS). O upgrade simulado do `run-tests.sh` prova o caminho com dados **sintéticos**. Isto aqui prova
o mesmo caminho com os dados **de verdade** — sem tocar em produção: o dono baixa um backup, e o
ensaio restaura esse arquivo num ambiente descartável local e faz tudo lá.

```
backup de produção → ambiente descartável → restore → pré-voo → migrations do SaaS (uma por vez,
como o SQL Editor, ledger na mesma transação) → verificações pós-upgrade → antes × depois linha a
linha → suíte de banco → Tenant 001 pela API → (opcional) UAT no navegador
```

## 1. O backup (o dono faz, uma vez)

- **Painel do Supabase → Database → Backups → Download** do backup diário mais recente (plano Pro).
  Vem um `db_cluster-<data>.backup.gz` (SQL puro). O ensaio aceita esse arquivo como está.
- Alternativas aceitas: `pg_dump -Fc` (`.dump`), `pg_dump` em SQL (`.sql`), qualquer um em `.gz`.
- **Guarde o arquivo FORA do repositório** (ou em `staging/backups/`, que é ignorado). Ele tem dado
  real de criança e hash de senha. O `.gitignore` recusa `*.backup`, `*.backup.gz` e `db_cluster-*`.
- O backup do banco **não traz os arquivos do Storage** (fotos): traz os metadados. O ensaio compara
  os metadados; os arquivos só entram se o dono exportar o Storage e passar `--arquivos storage.tgz`.

## 2. Rodar

```bash
node scripts/ensaio-producao.mjs ensaiar /caminho/db_cluster-XX-XX-XXXX.backup.gz --rotulo producao-AAAA-MM-DD
```

Cerca de 2–3 minutos num banco pequeno. Termina com **ENSAIO OK** ou **NO-GO** e grava o relatório
em `supabase/e2e/evidencias-fase9_1/ensaio-<rotulo>.md` — **só números** (contagens, nomes de
tabela e de verificação). O script recusa gravar o relatório se encontrar algo com cara de e-mail.

Para a UAT no navegador sobre a cópia:

```bash
ENSAIO_SENHA_UAT=<senha-8+-letras-e-numeros> node scripts/ensaio-producao.mjs ensaiar <arquivo> --rotulo producao-uat --manter --uat
npm run dev -- --port 4373 --strictPort --mode ensaio
```

`--uat` troca, **só na cópia**, a senha de 4 contas reais (diretoria, tesouraria, um desbravador com
unidade, um responsável) e lista quais em `restore/uat-contas.json` (apagado junto com o ambiente).
Depois: `node scripts/ensaio-producao.mjs descartar`.

## 3. O que cada etapa prova

| etapa | prova | NO-GO se |
|---|---|---|
| 1. restore | o arquivo restaura inteiro num stack separado (portas 56xxx, chave própria); o banco nasce com o dono `postgres` e o papel do SQL Editor ainda cria no `public` | erro de restore que não seja papel/schema da plataforma já existente |
| 2. estado | qual ledger existe e quantas migrations do SaaS faltam; pg_cron **pausado** na cópia (os jobs não mexem em dado durante o ensaio) | há tabela do SaaS sem ledger (alguém aplicou à mão sem registrar) |
| 3. pré-voo | `supabase/PREFLIGHT-PRODUCAO.sql` roda numa transação **somente leitura** (prova de que não escreve) | qualquer PROBLEMA — a janela real pararia ali. Exceção única: ledger do CLI ausente, cuja correção documentada o ensaio aplica, como o operador faria |
| 4. migrations | cada arquivo numa execução, como `postgres`, com a linha do ledger na mesma transação; ledger conferido pelo **conjunto** | qualquer migration falha, ou falta versão no ledger |
| 5. entidades | contas, perfis, vínculos, unidades, pontos (e a soma), mensalidades (e o caixa), jogos, mensagens, avisos, fotos, objetos do Storage, configurações, responsáveis, agenda, atividades, leilões, documentos, matrículas: antes = depois | qualquer contagem diferente |
| 6. linha a linha | cada tabela que existia, linha por linha e coluna por coluna (`supabase/infra/ensaio/`) | diferença que nenhuma regra de `scripts/lib/ensaio-regras.mjs` explica |
| 7. invariantes | 1 vínculo por perfil, no Tenant 001; papel/situação/unidade do vínculo = os do perfil de antes; toda linha antiga ganhou o clube certo; todo objeto do Storage no controle de uso; reconciliação sem nada a ajustar; conteúdo `[TESTE]` invisível | qualquer violação |
| 8. suíte | `supabase/tests/*.sql` sobre a cópia (cada teste em transação com ROLLBACK). Os que usam o Tenant 001 como "clube A" e contam linhas exatas colidem com o dado real: ficam listados, com a assinatura da colisão conferida; os que só esbarram no leilão aberto rodam de novo num clone com esse leilão cancelado | falha fora da assinatura de colisão |
| 9. Tenant 001 | login real pelo Auth (e, no sintético, com a senha de ANTES — o hash voltou), Home, membros, unidades, pontos, ranking, jogos, chat, mensalidades (caixa), Gestão, classes (recurso desligado recusado no servidor), responsável | qualquer jornada quebrada |

### Diferença inexplicada é NO-GO — e como tratar

Não se "alarga" uma regra para a diferença sumir. Ache a migration que causa a mudança; se ela for
a intenção da migration, escreva uma regra **estreita** que também prove o resultado (ex.: a
mensagem apagada só conta como explicada se o texto original estiver na trilha da moderação); se
não for, é defeito da migration — corrigir antes da janela.

## 4. Provado até agora

| ensaio | backup | resultado |
|---|---|---|
| `ensaio-sintetico` | sintético: 80 SQLs legados + dados vivos simulados (`pre_dados.sql`), sem ledger do CLI | ENSAIO OK |
| `ensaio-sintetico-sabotado` | o mesmo, com `--sabotar` (depois das migrations: 1 caixa pago → pendente, 1 foto apagada, 1 desbravador suspenso) | **NO-GO**, apontando as três |

**Pendente:** o ensaio com o backup REAL (depende do dono baixar o arquivo). Até lá, o item
"upgrade de cópia real da produção" do Go/No-Go continua **não comprovado**.
