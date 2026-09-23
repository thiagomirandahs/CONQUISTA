# Readiness — Fase 8.1: hardening e otimização orientada pelas medições

Continuação de [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md), que é a **baseline**. Aqui há
só o que mudou, com o antes e o depois medidos no mesmo ambiente local isolado, mesmo dataset
sintético e mesmo script de carga. **Nada tocou produção.**

> **A regra que valeu para tudo:** primeiro congelar o comportamento em teste, depois mexer.
> A otimização do chat só foi aceita porque a matriz de acesso (62 asserts, 7 conversas × 15
> pessoas × 3 superfícies) passa **idêntica** antes e depois.

---

## 1. O resumo em uma tabela

| VUs | Fase 8 — erros / Home p95 / req/s | **Fase 8.1** — erros / Home p95 / req/s |
|---:|---|---|
| 100 | 0,32% / **241 ms** / 22,2 | 0,43% / **7,5 ms** / 25,7 |
| 300 | 5,42% / **9,18 s** / — | **0,51%** / **6,1 ms** / — |
| 450 | *(já colapsado)* | 0,46% / 7,0 ms / 112 |
| 800 | *(já colapsado)* | 1,57% / 7,2 ms / **197 — pico** |
| 1.200 | **45,87%** / 10 s (timeout) / 66 | **2,63%** / **6,1 ms** / 168 |

E a medição que responde a pergunta do produto:

| Cenário do item 6 | Resultado |
|---|---|
| **3.000 aparelhos abrindo a Home em 60 s** (pico de push, o único momento em que a base inteira converge) | 3.001 iterações · 100 req/s sustentados · **0% de erro** · Home p95 **5,4 ms**, p99 **10,9 ms** |

**O joelho saiu de ~200 VUs para ~800 VUs**, e a Home passou de 241 ms para 7,5 ms no mesmo ponto.

---

## 2. O que mudou, e a evidência de cada coisa

### 2.1 Chat — a policy deixou de ser avaliada linha a linha

`chat_pode_ver(conversa_id)` era `STABLE` e o planejador a chamava **uma vez por linha candidata**.
Virou `chat_conversas_visiveis()`: o conjunto de conversas que a pessoa alcança, calculado de uma
vez, e as três policies passaram a ser `conversa_id in (select …)` — subplano hasheado, avaliado
uma vez por consulta.

Medido com 100 clubes / 261.000 mensagens, as duas implementações no mesmo banco e na mesma sessão
(`supabase/carga/bench-chat.sql`):

| Consulta | Antes | Depois | Ganho |
|---|---:|---:|---:|
| achar a conversa geral (escala com o nº de conversas da instalação) | 1.021 buffers · 2,02 ms | **44 · 0,47 ms** | 23× |
| ler a página de 300 (o que o app pede) | 3.017 buffers · 7,52 ms | **59 · 0,59 ms** | 51× |
| a forma do audit da Fase 8 (join) | 9.041 buffers · 19,40 ms | **116 · 1,23 ms** | 78× |

### 2.2 Uma correção à Fase 8

> A Fase 8 afirmou que *"o custo do chat cresce com o histórico da conversa"*. **Não cresce.**

A varredura por tamanho de página mostra o que realmente acontecia: a implementação antiga gastava
**10,1 buffers por linha retornada, constante**.

| Página (linhas) | Antiga | buffers/linha | Nova | buffers/linha |
|---:|---:|---:|---:|---:|
| 50 | 505 | 10,1 | 47 | 0,94 |
| 300 | 3.017 | 10,1 | 59 | 0,20 |
| 1.000 | 10.077 | 10,1 | 119 | 0,12 |

O custo escalava com a **página** e com o **número de conversas da instalação**, não com o
histórico — `idx_chat_mensagens_conversa`, que existe desde 2026-08-24, já limitava a varredura.
Isso também explica por que o índice candidato de chat da Fase 8 não deu ganho: **era duplicata
dele**. O achado central da Fase 8 (a função respondia por ~92% do custo) estava certo; o
enquadramento, não.

### 2.3 Mural — o índice que a Fase 8 comprovou

`idx_fotos_club_recente (club_id, created_at desc)`, migration 51: **912 → 94 buffers, 1,94 → 0,26 ms**.
O teste 46 dá volume (3.000 fotos + `analyze`) antes de olhar o plano — forçar `enable_seqscan=off`
provaria que o índice é *usável*, não que é *escolhido*.

---

## 3. O novo gargalo

**Parei de aumentar carga quando o gargalo mudou de lugar**, como a fase determina.

| | Fase 8 | Fase 8.1 |
|---|---|---|
| **Gargalo** | pool do PostgREST (10 conexões) | **CPU do banco** |
| **Como falha** | fila → latência explode → timeout de 10 s | conexão recusada na borda (`dial: i/o timeout`, `EOF`) |
| **Latência sob estresse** | p95 vai a 9–10 s | **fica plana em ~6 ms** |
| **Conexões no Postgres** | 27 total / 11 ativas / 0 lock | 23 total / 1–3 ativas / **0 lock** |

CPU por container, medida durante o degrau de 800 VUs:

| Container | Pico |
|---|---:|
| **db** | **75–95%** |
| kong | 14,4% |
| rest (PostgREST) | 14,3% |
| storage | 2,3% |
| realtime | 2,2% |

A assinatura de saturação é o throughput **caindo** quando a carga sobe: 197 req/s a 800 VUs,
168 req/s a 1.200. Latência plana + erro de conexão + CPU alta = o serviço recusa na porta em vez
de enfileirar. É um modo de falha melhor que o anterior (quem entra é atendido rápido), mas é
saturação do mesmo jeito.

> **Caveat que vale para todos os números:** laptop, Supabase CLI, um container de cada serviço, e o
> gerador de carga (k6) disputando a mesma CPU. Isto mede **a forma da curva e onde está o
> gargalo** — não a capacidade do Supabase hospedado.

---

## 4. Os blockers da Fase 8

| # | Blocker | Situação | Evidência |
|---|---|---|---|
| **B1** | Restore nunca testado | ✅ **testado** | `supabase/infra/restaurar-teste.sh`: 157 MB, dump 2 s, restore 4 s, **0 divergências** em tabelas, funções, policies, gatilhos, índices, RLS e contagem de linhas |
| **B2** | Push nativo do APK não funcionava | ✅ **corrigido** | rota FCM HTTP v1 na Edge Function; `push_destinatarios_nativos()` com o mesmo público da rota web; teste 47 (24 asserts) |
| **B3** | Webhook do push criado à mão no painel | ✅ **versionado** | gatilho `trg_notificacao_push` (migration 52) com `pg_net` + Vault; falta de configuração vira linha em `infra_falhas` |
| **B4** | CSP sem `script-src`; APK sem CSP | ✅ **corrigido** | `vite-plugin-csp.js`: `default-src 'self'` + `script-src 'self'` só com hashes, sem `unsafe-inline`/`unsafe-eval`/`data:`; como `<meta>`, vale para navegador **e** WebView |
| **B5** | Confirmação de e-mail desligada | ✅ **ligada** | + senha 8 com letras e números, `secure_password_change`; e2e de 20 asserts cobrindo cadastro → confirmação → login → recuperação |
| **B6** | Plano Free não serve | 📋 **documentado** (§6) | não é problema de código, como a fase determinou |
| **B7** | Zero observabilidade | ✅ **corrigida** | migration 53 + `src/lib/observabilidade.js`; teste 48 (27 asserts, quase todos negativos) |

### O que cada um custou descobrir

Quatro coisas só apareceram **fazendo**, e viraram teste:

1. **O probe `data:` do `@vitejs/plugin-legacy` existe em dois lugares** — no `index.html` e dentro
   do chunk de entrada. O segundo só aparece quando o navegador executa o bundle.
2. **O `renderChunk` precisa de `enforce: 'post'`** e não pode ser `generateBundle`: o hash do
   *nome* do arquivo é calculado entre os dois, e transformar depois deixaria quem tem a versão
   velha em cache com ela para sempre.
3. **O parser de HTML normaliza CRLF para LF** antes de expor o conteúdo do `<script>`. O
   `index.html` do projeto é CRLF, então o hash dos bytes crus nunca batia — e o script do tema
   ficava bloqueado em produção, dando um piscar de tema errado a cada abertura.
4. **`pg_restore --no-acl` passa em todas as contagens e devolve um banco inutilizável**: sem os
   GRANTs, `authenticated` não lê uma única tabela. A RLS decide quem vê o quê *depois* do grant.

E dois achados de segurança encontrados escrevendo teste:

- **Toda função nova nasce executável por `authenticated`.** O projeto tem
  `alter default privileges … grant execute on functions to authenticated`; `revoke from public`
  não basta. Sem o revoke explícito, qualquer membro poderia enumerar os aparelhos do clube.
- **`storage.objects` tem duas colunas de dono** (`owner` legado e `owner_id` atual). Olhar só uma
  deixava parte do acervo sem contabilizar.

---

## 5. Armazenamento por clube (item 4)

A pendência da Fase 5 (`limite_uso(…, 'armazenamento_mb')` devolvia `NULL`) está fechada, e **sem**
o algoritmo por sufixo de URL que levou 154 segundos.

A contabilidade é **incremental, na escrita**, e a idempotência vem da forma, não de cuidado ao
chamar: um livro-razão com uma linha por objeto, chave `(bucket_id, name)` — a mesma do Storage — e
o agregado recebe sempre o **delta** entre o que a linha dizia e o que passou a dizer.

| Cenário | Resultado (teste 49, 26 asserts) |
|---|---|
| upload novo | soma no clube certo, por path `<club_id>/…` **ou** pelo dono (caminhos legados) |
| re-upload idêntico 3× | **delta zero** — nada é somado, e a linha não duplica |
| substituição maior / menor | aplica a diferença, não o total |
| exclusão | subtrai exatamente aquele objeto; nunca fica negativo |
| **50 objetos simultâneos** | somam **5.000 exatos** — nenhuma escrita perdida |
| reconciliação | detecta deriva de −999.999 e corrige; agendada semanalmente |

Leitura passou a ser O(1). **Nenhum path existente foi movido** — mudar path de objeto quebraria
toda URL já salva em `fotos.url`, `profiles.foto` e nas comprovações.

---

## 6. Recomendação de compute e pool para o primeiro ambiente de produção

O que a medição diz, e só isso:

- **Conexão não é o limite.** 23 de 100, 1–3 ativas, zero espera de lock, nos quatro degraus.
  Aumentar `max_connections` ou o pool **não resolveria nada** — resolveria um problema que não existe.
- **CPU do banco é o limite.** 75–95% enquanto Kong e PostgREST ficam em 14%.
- **A capacidade útil medida** é ~200 req/s de pico, ~800 pessoas simultâneas em uso contínuo, e o
  pico de push de 3.000 aparelhos passa com folga (100 req/s, 0% de erro).

| Item | Recomendação | Por quê |
|---|---|---|
| Plano | **Supabase Pro** | fim da pausa por inatividade e PITR de 7 dias. É o B6, e não é código. |
| Compute | **Small (2 vCPU / 2 GB)** para começar | o limite medido é CPU. Micro seria a mesma classe do container local que saturou a 200 req/s. |
| Pool do PostgREST | **manter o padrão** (não mexer ainda) | o pool deixou de ser o gargalo. Mexer agora seria otimizar às cegas — exatamente o que esta fase evita. Revisar só se a medição em produção mostrar espera de conexão. |
| Supavisor | **não precisa ainda** | serve para muitas conexões curtas (serverless). A arquitetura atual é PostgREST com pool persistente. |
| Réplica de leitura | **não** | com o banco a 14% de uso de conexões e o gargalo em CPU, uma réplica resolveria o problema errado. |

**O que fazer no primeiro mês de produção, antes de qualquer upgrade:** medir de novo. Os números
acima vêm de um laptop; o valor deles é a *forma da curva* (onde está o gargalo, como falha), não a
capacidade absoluta.

---

## 7. O que continua aberto — e por quê

| # | Item | Situação | Justificativa |
|---|---|---|---|
| **E4** | Push sem idempotência: reentrega duplica o aviso | **aberto** | Fora do escopo dos seis itens da Fase 8.1. Precisa de uma chave de deduplicação por (notificação, destino) e de registro de quem recebeu — que é também o que resolve "Edge Function parcialmente falha". É a próxima coisa que eu faria. |
| **E6** | Sem paginação real (`.range()` em zero lugares; 21 `select('*')`) | **aberto** | Mudança de contrato em ~20 telas; nada a ver com os blockers desta fase. O teto do PostgREST (`max_rows = 1000`) segura por ora. |
| **E7** | Alerta de falha de cron | **parcial** | `cron_falhas` e `infra_falhas` **gravam**; ninguém é avisado. Falta o canal de alerta, que depende de uma decisão de ferramenta. |
| **E8** | 6 RPCs `security definer` aceitam UUID arbitrário | **aberto** | Vazamento cross-tenant de baixo valor + oráculo de existência. Não é blocker, mas entra antes de escalar. |
| — | 5 tabelas com RLS ligada e zero policy | **a investigar** | Detectado pelo teste de restore. Pode ser correto (tabela só de service_role) ou um bloqueio acidental. |
| — | `pg_cron` não acompanha um restore para banco novo | **documentado** | Os 9 jobs agendados precisam ser recriados à mão. Num PITR do Supabase o banco mantém o nome e isso não ocorre; numa restauração para projeto novo, ocorre. |
| — | `exigir_partida` (anticheat) nasce desligado | **aberto** | Pós-MVP, como na Fase 8. |

---

## 8. Checklist atualizada para o primeiro clube pagante

- [x] Restore testado e íntegro, com procedimento escrito e reexecutável
- [x] Push nativo do APK entregando de verdade
- [x] Webhook do push em migration, não no painel
- [x] CSP com `script-src` na web **e** no APK
- [x] Confirmação de e-mail, senha de 8 com letras e números, recuperação de senha funcionando
- [x] Rastreio de erro em produção, sem token, evidência, mensagem ou dado de menor
- [x] Medição de armazenamento por clube, com reconciliação
- [ ] **Plano Pro contratado** (B6 — não é código)
- [ ] **`site_url` e `additional_redirect_urls` de produção** conferidos no painel (inclusive `/nova-senha`)
- [ ] **Segredos do push no Vault** do projeto de produção (`supabase/infra/configurar-push.sql`)
- [ ] **`FCM_SERVICE_ACCOUNT`** cadastrado em Edge Functions → Secrets
- [ ] **Canal de alerta** para `cron_falhas` e `infra_falhas`
- [ ] Rodada final dos gates contra o projeto de produção antes de abrir

---

## 9. Gates

| Gate | Resultado |
|---|---|
| `npm run lint` | 0 erros |
| `npm run test` (Vitest) | 408 testes |
| `npm run build` | ok |
| `npm run test:db` | **50 arquivos, 0 falhas** |
| `npm run test:auth:e2e` | 20 asserts, todos verdes |
| Red-team do chat | matriz de 62 asserts idêntica antes/depois; teste 46 prova que o plano não chama a função por linha e que a superfície nova está fechada para anônimo, não aceita parâmetro e devolve conjunto vazio para quem não tem vínculo |

## Como reproduzir

```bash
# dataset + tokens
docker cp supabase/carga supabase_db_CONQUISTA:/tmp/
docker exec -i supabase_db_CONQUISTA psql -U postgres -f /tmp/carga/gerar-dataset.sql
node supabase/carga/gerar-tokens.mjs supabase/carga/usuarios.json

# benchmark do chat (antiga x nova, no mesmo banco)
docker exec -i supabase_db_CONQUISTA psql -U postgres -f /tmp/carga/bench-chat.sql

# carga: base(100) fino(450) joelho(300) alto(800) completo(1200) pico3000
bash supabase/carga/rodar-carga.sh base

# restore em ambiente descartável
bash supabase/infra/restaurar-teste.sh

# limpar
docker exec -i supabase_db_CONQUISTA psql -U postgres -f /tmp/carga/limpar-dataset.sql
```
