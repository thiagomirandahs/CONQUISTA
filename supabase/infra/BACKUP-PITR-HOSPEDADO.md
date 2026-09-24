# Backup e PITR do projeto hospedado — o que existe e o que foi provado

> Fase 9.1, item 7. Ferramenta: `scripts/verificar-backup-hospedado.mjs` (só GET na Management API,
> mais dois registros de restore feito). Procedimentos vizinhos: `DEPLOY-E-RECUPERACAO.md` (passos
> 5, 10 e 11) e `ENSAIO-DE-PRODUCAO.md`.

**Status: PENDENTE.** Nada foi conferido no projeto do piloto: esta rodada não tem acesso a ele.
A ferramenta e o procedimento estão prontos. No staging **local**, o restore foi provado na fase 9
(53,4 s, manifesto idêntico) e a recuperação de migration também (17,2 s). No projeto real, nenhum
dos dois foi feito.

---

## 1. O que conta como verde, e o que não conta

O drill da fase 9 achou um restore que devolvia todos os dados, passava na suíte e **quebrava a
próxima migration**, porque o banco voltava com o dono errado. Ninguém veria isso olhando o painel.
Por isso a regra deste item é dura:

| não conta como verde | conta |
|---|---|
| "a opção de backup existe no painel" | um backup **baixado e restaurado** num ambiente descartável, com a etapa 1 do ensaio inteira OK |
| "o PITR está ligado" | um restore **no próprio projeto** (PITR ou diário) executado, com hora, ponto restaurado, tempo medido e conferência depois |
| "o plano Pro tem backup de 7 dias" | a lista de backups do projeto, lida pela API, com um backup de menos de 36 h |
| "sabemos restaurar" | um responsável e um substituto com nome no registro, RPO e RTO alvo escritos, e quem decide restaurar |

O `verificar-backup-hospedado.mjs` separa as duas colunas. A API mostra o que **existe**. O que foi
**provado** entra por dois arquivos que o dono gera fazendo o restore. Sem esses dois, o veredito
nunca é VERDE, de propósito.

## 2. Checklist

**O que existe** (o script confere pela API; confira também no painel):

- [ ] **Plano** Pro ou acima (o Free pausa e não dá backup baixável; `AMBIENTE-DE-PRODUCAO.md` §1). Critério `plano-pago`
- [ ] **Compute** Small ou acima. Além de ser o alvo medido, o add-on de PITR exige compute a partir de Small (**confira no painel**: Add-ons)
- [ ] **Backups diários** disponíveis em Database → Backups, e o mais novo com menos de 36 h. Critério `backup-diario-recente`
- [ ] **Retenção** de pelo menos 7 dias de pontos de restauração (Pro guarda 7 diários). Um projeto com menos de 7 dias de vida fica NAO-VERIFICAVEL até completar. Critério `retencao`
- [ ] **PITR habilitado** (add-on pago, com janela de 7, 14 ou 28 dias) e janela ≥ 7 dias. Critérios `pitr-habilitado` e `pitr-janela`. **Sem PITR**, o RPO é o do backup diário (até ~24 h de escrita perdida), e o passo 10 do `DEPLOY-E-RECUPERACAO.md` ("PITR para o instante do passo 5") simplesmente não existe. Se o dono decidir não contratar, registre a decisão e o RPO de 24 h. O critério continua FAIL, de propósito: a decisão fica visível, não escondida

**O que foi provado** (só com restore de verdade):

- [ ] **Restore de teste do backup diário**, sem tocar no projeto (§3.A). Critério `restore-diario-testado`
- [ ] **Restore no próprio projeto**, antes de haver dado real (§3.B). Critério `restore-no-projeto-testado`
- [ ] **Responsabilidade operacional** registrada (§4). Critério `responsabilidade-definida`

## 3. Os dois restores

### 3.A Backup diário → ambiente descartável (não toca no projeto)

Prova que o **arquivo** do backup restaura inteiro, com o dono certo, e que a próxima migration
ainda passa. Roda na máquina do dono, com o mesmo `ensaio-producao.mjs` do ensaio de produção.

1. **Retrato do projeto**, no SQL Editor do piloto. É só leitura e só números:

   ```sql
   select 'contas' as o_que, count(*) as linhas, max(created_at) as mais_recente from auth.users
   union all select 'perfis',             count(*), max(created_at) from public.profiles
   union all select 'clubes e distritos', count(*), max(created_at) from public.organizational_units
   union all select 'vinculos',           count(*), max(created_at) from public.organization_memberships
   union all select 'pontos',             count(*), null            from public.pontos
   union all select 'mensalidades',       count(*), max(created_at) from public.mensalidades
   union all select 'fotos do mural',     count(*), max(created_at) from public.fotos
   union all select 'mensagens do chat',  count(*), max(created_at) from public.chat_mensagens
   union all select 'arquivos (Storage)', count(*), max(created_at) from storage.objects
   order by 1;
   ```

2. **Baixar** o diário mais novo em Database → Backups → Download (`db_cluster-<data>.backup.gz`).
   Guarde **fora do repositório**: ele tem dado de criança e hash de senha. O `.gitignore` recusa
   `*.backup.gz` e `db_cluster-*`. Se o painel não oferecer download (com PITR ligado, a tela de
   backups muda), um `pg_dump -Fc` com a connection string do painel serve. É leitura, e o ensaio
   aceita `.dump`.
3. **Ensaiar**: `node scripts/ensaio-producao.mjs ensaiar <arquivo> --rotulo piloto-AAAA-MM-DD --manter`
4. **Mesmo retrato na cópia**: `docker exec -i supabase_db_CONQUISTA-RESTORE psql -U supabase_admin -d postgres -X`
   e cole a consulta do passo 1. Cada contagem da cópia tem de ser **≤** a do painel, e o
   `mais_recente` tem de estar perto da hora do backup. Contagem maior, ou data de dias atrás, quer
   dizer que o arquivo não é o backup que se pensava.
5. `node scripts/ensaio-producao.mjs descartar`
6. **Conferir**:
   `node scripts/verificar-backup-hospedado.mjs --ensaio supabase/e2e/evidencias-fase9_1/ensaio-piloto-AAAA-MM-DD.json`

**Atenção: o ensaio foi escrito para o upgrade da produção legada.** As etapas 3 (pré-voo),
7 (invariantes do Tenant 001), 8 (suíte, com colisões de contagem no Tenant 001) e 9 (jornadas do
Tenant 001) partem de um banco legado com um clube só. Um backup do piloto já está no schema do
SaaS e tem vários clubes, então essas etapas podem dar NO-GO sem dizer nada sobre o restore. O que
prova o restore é a **etapa 1**, com quatro verificações: restore sem erro, dono `postgres`, o papel
do SQL Editor ainda cria no `public` (a próxima migration passa) e auth/API/storage de pé. O
verificador lê exatamente essa etapa. Ele aceita NO-GO **só** nas etapas 3, 7, 8 e 9, e mostra
quantas falharam. Qualquer falha na etapa 1, ou fora dessas quatro etapas, é FAIL. O certo seria o
ensaio ter um modo "só restore" para backups que já estão no SaaS. Fica como pendência para o dono
do script (não foi implementado aqui).

**O que o backup do banco não traz:** os **arquivos** do Storage (fotos, evidências). Ele traz só os
metadados. O ensaio compara os metadados. Os arquivos só entram se o dono exportar o bucket e passar
`--arquivos`.

### 3.B Restore no próprio projeto (o drill)

Prova que **o projeto** volta no tempo, que o app continua de pé e que o deploy seguinte ainda é
possível. É destrutivo por definição: o projeto fica fora do ar durante o restore e tudo o que foi
escrito depois do ponto escolhido se perde. **Faça antes de o piloto ter criança de verdade** (ou
num staging hospedado com o mesmo plano e add-ons) e repita a cada 90 dias.

1. **Marcadores**: com uma conta de teste, publique uma foto no mural (marcador 1) e anote a hora.
   Espere 5 minutos e publique outra (marcador 2).
2. **Antes**: rode o retrato do §3.A e `select jobname, active from cron.job order by 1;`.
3. **Restaurar** para um instante entre os dois marcadores: Database → Backups → Point in Time
   (sem PITR, restaure o diário). Cronometre do clique até o app abrir de novo: esse é o **RTO medido**.
4. **Conferir**:
   - o marcador 1 existe e o marcador 2 não existe;
   - login, Home e ranking funcionam para uma conta de cada clube;
   - os jobs do `pg_cron` continuam lá, iguais;
   - **o próximo deploy continua possível**. É o achado do drill da fase 9, e aqui ele é só leitura:

     ```sql
     select pg_get_userbyid(datdba) as dono,                                    -- tem de ser postgres
            has_schema_privilege('postgres', 'public', 'CREATE') as sql_editor_cria   -- tem de ser true
       from pg_database where datname = current_database();
     ```
   - **Storage**: o restore volta o **banco**, não os arquivos. Arquivo enviado depois do ponto
     vira órfão (existe no bucket, sem linha). Arquivo apagado depois do ponto tem linha sem arquivo.
     Anote o que aconteceu com a foto do marcador 2.
5. **Registrar** no arquivo do §5 e conferir:
   `node scripts/verificar-backup-hospedado.mjs --registro <arquivo>`.

## 4. Responsabilidade operacional

O restore do piloto não é um procedimento técnico só. Ele volta o sistema **de todos os clubes** no
tempo, e o produto não tem modo manutenção: tudo o que foi escrito depois do ponto se perde.
Decidir isso é trabalho de alguém, com nome.

| campo | o que é | sugestão para o piloto (decisão do dono) |
|---|---|---|
| `responsavel` | quem executa e responde pelo restore | o dono do projeto |
| `substituto` | quem executa quando o responsável não pode | uma segunda pessoa com acesso ao painel. **Sem ela, o RTO real é "quando o dono voltar"** |
| `quem_decide_restaurar` | quem autoriza perder as escritas depois do ponto | o responsável, avisando as diretorias dos clubes |
| `rpo_alvo_min` | quanto dado se aceita perder | com PITR, minutos (15). Sem PITR, **1440** (24 h). Um alvo menor que 24 h sem PITR é FAIL no verificador: é promessa que ninguém cumpre |
| `rto_alvo_min` | quanto tempo fora do ar se aceita | medir no drill e somar decisão humana e aviso aos clubes. Por exemplo, 240 |
| quando | a janela | fora do horário das reuniões. **Sábado de manhã é o pior momento possível** |
| como avisar | o que os clubes ouvem | "o app voltou ao estado de HH:MM. O que foi lançado depois precisa ser lançado de novo" |

## 5. O registro (modelo)

Guarde fora do repositório, ou dentro de `supabase/e2e/evidencias-fase9_1/` usando **papéis em vez
de nomes**.

```json
{
  "projeto_ref": "<ref do piloto>",
  "responsavel": "dono do projeto",
  "substituto": "segunda pessoa com acesso ao painel",
  "quem_decide_restaurar": "responsavel, avisando as diretorias",
  "rpo_alvo_min": 1440,
  "rto_alvo_min": 240,
  "restore_no_projeto": {
    "tipo": "pitr",
    "data": "2026-10-01T13:00:00Z",
    "ponto_restaurado": "2026-10-01T12:52:00Z",
    "rto_medido_min": 18,
    "conferencia_ok": true,
    "proxima_migration_ok": true,
    "observacoes": "marcador 1 presente, marcador 2 ausente; foto do marcador 2 ficou órfã no bucket"
  }
}
```

`tipo` é `pitr` ou `diario`. O verificador recusa: registro de outro projeto; `tipo: pitr` com o PITR
desligado hoje; conferência que não está OK; `proxima_migration_ok` diferente de `true`; RTO medido
acima do alvo; drill com mais de 90 dias; RPO alvo abaixo de 24 h sem PITR.

## 6. Rodar o verificador

```bash
SUPABASE_ACCESS_TOKEN=<token pessoal, só para isto> PROJECT_REF=<ref do piloto> \
  node scripts/verificar-backup-hospedado.mjs \
    --ensaio supabase/e2e/evidencias-fase9_1/ensaio-piloto-AAAA-MM-DD.json \
    --registro <registro.json> \
    --saida supabase/e2e/evidencias-fase9_1/backup-hospedado-piloto-AAAA-MM-DD.json
```

GETs feitos: `/v1/projects/<ref>`, `/v1/organizations/<org>` (plano), `/v1/projects/<ref>/billing/addons`
(PITR e compute) e `/v1/projects/<ref>/database/backups`. A guarda de produção é a mesma do Auth
(`scripts/lib/hospedado.mjs`), e alvo local é recusado: o backup do Docker é o
`scripts/restaurar-staging.mjs`. Parâmetros: `BACKUP_RETENCAO_DIAS` (7), `BACKUP_PITR_DIAS` (7) e
`BACKUP_EVIDENCIA_MAX_DIAS` (30; o drill vale 3× isso). Códigos de saída iguais aos do Auth
(0 VERDE, 1 FAIL, 2 incompleto, 3 recusado).

## 7. O que foi provado nesta rodada

Nada no projeto real. O verificador rodou contra um projeto **simulado**: o `fetch` foi trocado e
nenhuma requisição saiu da máquina.

| cenário simulado | resultado |
|---|---|
| Pro, PITR 7 dias, sem registros de restore | 6 PASS, 3 NAO-VERIFICAVEL → INCOMPLETO (saída 2). "Existir" não basta |
| + ensaio real do piloto + registro de restore | VERDE (saída 0) |
| ensaio **sintético** do repositório passado como prova | FAIL: "prova a ferramenta, não o backup deste projeto" |
| ensaio do piloto com NO-GO só nas etapas do upgrade (7 e 9) | `restore-diario-testado` PASS, com a nota de quantas falharam |
| ensaio com falha na etapa 1 (dono do banco), ou na etapa 5 | FAIL |
| sem PITR, registro dizendo `pitr` | FAIL: "o registro diz PITR, mas o projeto está com PITR desligado" |
| sem PITR, RPO alvo de 15 min | FAIL em `responsabilidade-definida` |
| plano Free, sem backups | 4 FAIL |
| PROJECT_REF da produção real, com o `fetch` bloqueado | recusado, 0 requisições, saída 3 |
