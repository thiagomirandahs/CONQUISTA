# Piloto com o primeiro clube — condições de implantação

Documento de implantação do candidato a piloto. Consolida, num lugar só, o que precisa acontecer
para o primeiro clube pagante entrar — e o que **não** pode ser esquecido no caminho.

| | |
|---|---|
| **Candidato** | tag local `checkpoint/piloto-primeiro-clube` |
| **Branch** | `saas-produto-multiclube` (local, sem push) |
| **Veredito** | **PRONTO PARA PILOTO**, com o limite de escala da §5 |
| **Fora do escopo** | gateway de pagamento (não integrado, por decisão) |

Os relatórios que sustentam isto: [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) (capacidade),
[PRODUCTION-READINESS-8.1.md](PRODUCTION-READINESS-8.1.md) (otimizações medidas),
[GO-LIVE-READINESS.md](GO-LIVE-READINESS.md) (a matriz de gate).

---

## 1. O que o candidato contém

Oito commits, seis migrations, quatro arquivos de teste novos.

| Migration | O que resolve |
|---|---|
| `…55_push-idempotente` | evento → destinatários → tentativas; chave final por **aparelho**; restore deixa de disparar push |
| `…56_rpcs-cross-tenant` | fecha 7 funções que atravessavam tenant + conserta a varredura que as escondia |
| `…57_canal-de-alerta` | 6 categorias, destino sem fornecedor, alerta por ausência |
| `…58_paginacao-keyset-chat` | cursor de tupla `(created_at, id)` no chat |
| `…59_mensalidades-ano-agregado` | fim do truncamento silencioso na aba Ano (era erro de dinheiro) |
| `…60_leilao-rateio-unico` | reserva e cobrança do lance conjunto saem da mesma conta |

| Teste | Asserts |
|---|---:|
| `50_push_idempotente` | 47 |
| `51_rpcs_cross_tenant` | 26 |
| `52_paginacao_keyset` | 33 |
| `53_leilao_rateio_conjunto` | 65 |
| `smoke/smoke.mjs` | 7 passos |

---

## 2. Antes de subir — o que precisa existir

Ordem importa: o que está antes não depende do que vem depois.

### 2.1 Projeto

- [ ] Projeto Supabase **Pro** criado (o Free pausa por inatividade e tem backup curto)
- [ ] Compute **Small** (2 vCPU / 2 GB) — o limite medido é CPU do banco, não conexão
- [ ] **Não mexer no pool do PostgREST.** Ele deixou de ser o gargalo na fase 8.1 (23 conexões de
      100, zero espera de lock). Aumentá-lo resolveria um problema que não existe

### 2.2 Banco

- [ ] `supabase/PREFLIGHT-PRODUCAO.sql` executado e conferido
- [ ] Migrations aplicadas **na ordem**, até a `20260925000060`
- [ ] Conferir que as 140 migrations aplicaram sem erro (o SQL Editor é atômico por execução: uma
      migration que falha não aplica nada)

### 2.3 Segredos

Nada disto entra no repositório.

| Onde | Nome | Se faltar |
|---|---|---|
| Edge Functions → Secrets | `PUSH_WEBHOOK_SECRET` | a função responde 401 a tudo (falha fechada) |
| Edge Functions → Secrets | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | push web não sai |
| Edge Functions → Secrets | `FCM_SERVICE_ACCOUNT` | push do APK não sai, e vira linha em `infra_falhas` |
| **Vault** do banco | `push_edge_url` | o gatilho registra a falta e a notificação é gravada mesmo assim |
| **Vault** do banco | `push_webhook_secret` (o **mesmo** valor do secret) | idem |

Os dois do Vault entram por `supabase/infra/configurar-push.sql`, que confere no fim mostrando que
os segredos existem **sem imprimir o valor**.

### 2.4 Autenticação

Conferir no painel do projeto (ele tem cópia própria dessas opções):

- [ ] `enable_confirmations` = **true**
- [ ] `minimum_password_length` = **8**, `password_requirements` = `letters_digits`
- [ ] `secure_password_change` = **true**
- [ ] `site_url` = o domínio real do app
- [ ] `additional_redirect_urls` inclui **`/nova-senha`** — sem isso a recuperação de senha falha
      no último passo

### 2.5 Front

- [ ] Deploy na Vercel
- [ ] **Abrir o app e olhar o console: zero erro de CSP.** Um script bloqueado não derruba a
      página — degrada em silêncio, que é pior

### 2.6 Operação

- [ ] Destino de alerta configurado. O destino `painel` já vem por migration (é o piso); um
      `webhook_json` para Slack/Discord/Teams é um INSERT em `alerta_destinos` + um segredo no Vault
- [ ] **Restore testado neste projeto**, não só localmente (`supabase/infra/restaurar-teste.sh`)
- [ ] `heartbeat_registrar('restore_teste', ...)` chamado depois do teste — senão o alerta de
      "backup sem teste há 35 dias" dispara sozinho, e com razão

### 2.7 Conta de smoke

- [ ] Criar **uma** conta dedicada, marcá-la `profiles.teste = true` (senão ela entra em ranking,
      lembrete de ausência e prêmio de cron do clube real) e aprovar o vínculo
- [ ] Guardar as credenciais no cofre da equipe
- [ ] `npm run test:smoke` verde contra o ambiente

---

## 3. Depois de subir — a ordem de deploy

Migrations → Edge Function → front. Nessa ordem, o front novo nunca chega antes do schema de que
ele depende. As migrations do projeto são aditivas por convenção, então o front antigo continua
funcionando durante a janela.

---

## 4. Como voltar atrás

| Camada | Como | Tempo |
|---|---|---|
| Front | promover o deploy anterior na Vercel | ~1 min |
| Front, no cliente | já existe: o app recarrega uma vez sozinho se um chunk falhar | automático |
| Edge Function | republicar a versão anterior no painel | ~1 min |
| Migration que falhou | não aplicou nada — o SQL Editor é atômico por execução | imediato |
| Migration já aplicada | não há `down` automático: o caminho é uma migration nova que corrige | minutos |
| Banco | PITR do plano Pro | ver §2.1 |

**RTO medido** para o restore: 7 s de máquina para 157 MB (dump 2 s + restore 4 s). É **piso**, não
promessa — o RTO real soma decisão humana, provisionamento e reapontamento do app.

Dois detalhes que só aparecem restaurando de verdade, e que estão no procedimento:

1. `pg_restore --no-acl` passa em todas as contagens e devolve um banco **inutilizável** — sem os
   GRANTs, `authenticated` não lê uma única tabela.
2. `pg_cron` **não** acompanha um restore para banco novo. Os jobs se perdem e precisam ser
   recriados. Num PITR do Supabase o banco mantém o nome e isso não ocorre.

---

## 5. O limite deste piloto

> **Vale para um clube de até ~300 membros.** Acima disso, fechar antes os itens abaixo.

11 das 14 superfícies mapeadas ainda não têm paginação. Elas continuam limitadas pelo
`max_rows = 1000` do PostgREST, que **trunca e devolve 200** — sem erro, sem header. Nenhuma delas
é dinheiro (a de dinheiro foi corrigida), e nenhuma chega a 1.000 linhas num clube desse porte.

**Gatilho para fechar:** o segundo clube pagante, ou o piloto passar de 300 membros — o que vier
primeiro. O padrão keyset já está implementado e testado; replicar é trabalho mecânico.

---

## 6. O que observar na primeira semana

| O quê | Onde | O que significa |
|---|---|---|
| Alertas abertos | `painel_alertas(72)` | qualquer `critico` é para agir hoje |
| Erros do app | `painel_erros(24)` | o mesmo par (rota, código) em 3+ abas não é azar |
| Falhas de infra | `infra_falhas` | quase sempre é configuração de push faltando |
| Entregas de push | `push_tentativas` | taxa de `falhou` acima de 50% é push degradado |
| Falhas de cron | `cron_falhas` | deve ficar vazia |
| Conexões e CPU | painel do Supabase | o gargalo medido é CPU, não conexão |

A leitura de todas essas tabelas é da **operação da plataforma** (`eh_admin_plataforma()`), papel
deliberadamente separado das diretorias de clube — a diretoria não lê a telemetria de ninguém.

**Gatilho para subir compute:** espera de conexão aparecendo em `pg_stat_activity`, ou CPU do banco
sustentada acima de 80% fora de pico. Aí, e só aí — e antes de mexer no pool.

---

## 7. O que este candidato sabe que não sabe

Registrado para não virar surpresa:

| Item | Por que fica |
|---|---|
| 11 superfícies sem paginação | §5, com gatilho declarado |
| Idempotência de push com janela de 1 minuto | a chave automática (conteúdo + minuto) cobre cron repetido no mesmo minuto e duplo toque. Uma reexecução de cron **horas depois** ainda passa; a chave explícita com a data fecha isso quando esses crons forem revistos |
| `exigir_partida` (anticheat de jogos) desligado | é jogo, não cobrança |
| Bundle com 1,37 MB de Phaser | carregado sob demanda; pesa na primeira abertura dos jogos |
| Números de carga vêm de um laptop | medem a **forma da curva** e onde está o gargalo, não a capacidade do Supabase hospedado. Remedir no primeiro mês |

---

## 8. Reproduzir os gates

```bash
npm run check            # eslint + vitest + build
npm run test:db          # 54 arquivos SQL
npm run test:db:upgrade  # upgrade de produção simulado
npm run test:auth:e2e    # cadastro -> confirmação -> login -> recuperação
npm run test:smoke       # pós-deploy, seguro para ambiente real
```
