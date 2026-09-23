# Production Readiness Review e Capacity Baseline — fase 8

Levantamento com **evidência medida**, não estimativa. Tudo rodou em ambiente local isolado
(Docker + Supabase CLI, Postgres 17.6), **nada tocou produção**.

> **Aviso de calibragem, que vale para o documento inteiro:** os números de carga foram obtidos num
> notebook, com a stack local do Supabase CLI (um container de cada serviço). Eles medem **a forma da
> curva e onde está o gargalo**, não a capacidade do Supabase hospedado. Onde o número é do ambiente
> local e não do produto, está dito explicitamente.

---

## 1. Inventário de arquitetura

### 1.1 O caminho real de uma requisição

```
PWA (Vercel) ────┐
                 ├──> Kong ──> GoTrue (auth)
APK (Capacitor, ─┘              PostgREST ──> PostgreSQL ──> pg_cron (9 jobs)
 dist embutido)                 Storage   ──> 3 buckets
                                Realtime  ──> 1 canal (chat)
                                     │
                          Database Webhook ──> Edge Function `enviar-push` ──> FCM/Mozilla/…
```

| Camada | O que é | Evidência |
|---|---|---|
| Front web | Vite + PWA, deploy automático da Vercel no push | `vercel.json`, `README.md:27` |
| Front APK | Capacitor, **embute o `dist`** (`webDir: "dist"`), não aponta para URL | `capacitor.config.json:4` |
| Cliente Supabase | 1 instância, fetch customizado que injeta `x-clube-atual` e `x-escopo-atual` | `src/lib/supabase.js:29-40` |
| API | **124 RPCs distintas** + **136 queries diretas** sobre 29 tabelas | varredura em `src/` |
| Banco | Postgres 17.6, RLS em tudo, ~130 migrations | `supabase/migrations/` |
| Storage | 3 buckets: `imagens` (privado), `comprovacoes` (privado), `publico` | `…032:17`, `…008:24`, `…031:132` |
| Edge Function | **uma só**: `enviar-push` | `supabase/functions/enviar-push/index.ts` |
| Cron | **9 jobs** em `pg_cron`, dentro do mesmo Postgres | ver 1.2 |
| Realtime | **um** canal: INSERT em `chat_mensagens` | `src/pages/Chat.jsx:193-207` |
| Externos | **nenhum** `fetch` para terceiro no front; zero CDN, zero analytics | varredura |

### 1.2 Jobs de cron

| Job | Cron | Varre todos os clubes? |
|---|---|---|
| `fechar-leiloes-vencidos` | `*/5 * * * *` | não (por leilão, `for update skip locked`) |
| `aniversariantes-do-dia` | `0 12 * * *` | não (por pessoa) |
| `lembrete-eventos` | `0 12 * * *` | não (por evento) |
| `lembrar-ausentes` | `0 13 * * *` | **sim** |
| `lembrar-jogos-do-dia` | `0 21 * * *` | **sim** |
| `melhores-do-dia` | `5 3 * * *` | **sim** |
| `campeao-recorde-semana` | `50 2 * * 1` | **sim** |
| `rodada-semana` | `55 2 * * 1` | **sim** |
| `chefao-fim` | `56 2 * * 1` | **sim** |

Os 6 que varrem clubes já isolam cada clube num `begin/exception` e registram em `cron_falhas`
(`…028:409-412`) — uma falha não derruba os outros. **Com 100 clubes isso é um laço de 100
iterações por job; com 1.000 clubes, de 1.000.** Não foi medido sob volume.

### 1.3 Pontos únicos de falha

| SPOF | Consequência medida/observada |
|---|---|
| **Um único projeto Supabase** | Auth, API, banco, Storage, Realtime, cron e Edge Function no mesmo projeto. Sem réplica, sem segunda região, sem URL alternativa. |
| **Storage fora do ar** | Upload de avatar/mural/logo/comprovação falha sem alternativa. Exibição **tem** fallback (`src/lib/imagens.js:109`), mas com o bucket privado a URL de fallback não abre. |
| **Cron parado** | Leilões vencidos **não fecham** (único caminho automático); prêmios de semana/dia não são pagos; lembretes não saem. |
| **Edge Function falhando** | **Nenhum push entregue** — é o único caminho. A notificação continua no banco e aparece no app; perde-se só o aviso no aparelho. |
| **Tokens FCM órfãos** | O APK grava tokens em `push_tokens` (`src/lib/pushNativo.js:35-37`), mas **nenhum código no repositório os consome**. Push nativo no Android não funciona hoje. |
| **Webhook do push não versionado** | É criado à mão no painel; não existe em migration. Um projeto novo sobe sem push e nada avisa. |

---

## 2. Cenários de carga — "3.000 usuários" ≠ "3.000 requisições"

Uma pessoa usando o app **não** gera uma requisição por segundo. O modelo usado:

| Cenário | Modelagem | RPS implícito |
|---|---|---|
| 3.000 sessões autenticadas | sessão é um JWT guardado; **não gera carga sozinha** | ~0 |
| 3.000 ativos em janela curta (1 h) | ~4 aberturas de app/hora × 2 RPCs + 1 leitura | **~2,5 RPS** |
| Uso normal simultâneo (o que medimos) | 1 VU = 1 pessoa: contexto + home, pensa 1–3 s, 1 leitura, pensa 2–5 s | **~0,22 RPS por VU** |
| **Pico de push** (o pior caso real) | 3.000 aparelhos abrem a Home em ~60 s | **~100 RPS de `meu_inicio` + `meu_contexto`** |

**Mix aplicado no teste** (`supabase/carga/k6-mix.js`): 100% contexto+home por iteração, depois
30% ranking · 25% experiências · 20% chat · 15% fila de avaliação (só liderança) · 10% troca de clube.

---

## 3. Baseline medida

### 3.1 Dataset (item 4)

Gerador determinístico e descartável: `supabase/carga/gerar-dataset.sql` / `limpar-dataset.sql`.
Sem dado pessoal: nomes de lista fixa + número, e-mails em `@carga.local`, senhas com hash inválido.

> **Achado do próprio gerador:** a primeira versão prometia idempotência via `on conflict do nothing`,
> mas `pontos`, `chat_mensagens`, `fotos` e `notificacoes` não têm chave natural — uma segunda rodada
> **triplicou** o volume e teria invalidado qualquer comparação antes/depois. Corrigido: o gerador
> **limpa antes de gerar**, e isso foi provado rodando duas vezes com contagem idêntica.

| Tabela | Linhas | Tamanho total |
|---|---:|---:|
| `pontos` | 250.000 | 229 MB (140 dados + 89 índices) |
| `chat_mensagens` | 100.000 | 149 MB |
| `member_requirements` | 110.000 | 74 MB |
| `fotos` | 30.000 | 31 MB |
| `notificacoes` | 20.000 | 23 MB |
| `experience_submissions` | 11.000 | 8,6 MB |
| **banco inteiro** | — | **559 MB** |

100 clubes · 5.000 pessoas · 5.500 vínculos (500 pessoas em 2 clubes) · 500 experiências.

**Projeção de crescimento**: `pontos` é 916 bytes/linha (índices inclusos) e cresce com cada
lançamento. A 50 lançamentos/membro/ano: **~46 MB por 1.000 membros por ano**, só nessa tabela.

### 3.2 Configuração do Postgres local

`max_connections = 100` · `shared_buffers = 128 MB` · `work_mem = 4 MB` · `effective_cache_size = 128 MB`.
São os defaults do CLI — **não** os do Supabase hospedado.

---

## 4. Query audit (item 5)

`EXPLAIN (ANALYZE, BUFFERS)` rodando **como `authenticated`**, com a RLS ativa, sobre o dataset acima.

| Operação | Tempo | Buffers | Leitura |
|---|---:|---:|---|
| `meu_contexto()` — toda abertura do app | 4,7 ms | 1.858 | pesada para o caminho mais quente |
| `meu_inicio()` — a Home | 9,8 ms | 2.849 | 10 regras, cada uma uma consulta |
| Ranking (top 50) | 0,9 ms | 190 | ok |
| Mural (30 últimas) | 1,9 ms | 912 | **sem índice de ordenação** |
| **Chat (50 últimas)** | **17,7 ms** | **9.111** | **o pior caso** |
| `experiencias_do_clube()` | 5,3 ms | 7.606 | pesada |
| `avaliacoes_pendentes()` | 1,1 ms | 275 | ok |

### 4.1 Índices — antes/depois, com demonstração

**Só um dos dois candidatos se pagou.** Isto é o que significa "não adicione índice porque parece bom":

| Índice candidato | Antes | Depois | Veredito |
|---|---|---|---|
| `fotos (club_id, created_at desc)` | 912 buffers · 1,94 ms | **94 buffers · 0,26 ms** | **−90% buffers, −87% tempo → vale** |
| `chat_mensagens (conversa_id, created_at desc)` | 9.111 buffers · 17,7 ms | 9.073 buffers · 17,4 ms | **−0,4% → NÃO vale, foi descartado** |

### 4.2 A causa real do chat: função de RLS avaliada linha a linha

A policy de `chat_mensagens` é `chat_pode_ver(conversa_id)` — uma função **STABLE** que o planejador
chama **uma vez por linha candidata**. Com 1.000 mensagens na conversa, são 1.000 execuções.

Prova de conceito medida (`supabase/carga/poc-chat.sql`), mesmo resultado, três formas:

| | Buffers | Tempo |
|---|---:|---:|
| A) como a RLS avalia hoje (função por linha) | 771 | 2,32 ms |
| B) filtrando antes pelo `club_id` **que já existe na linha** | 64 | 0,22 ms |
| C) B + índice `(conversa_id, created_at desc)` | 31 | — |

**A função é ~92% do custo.** E o custo cresce com o histórico da conversa, não com o que se lê:
pedir as 50 últimas de uma conversa com 100.000 mensagens custa 100× mais que numa com 1.000.

> **Não apliquei a correção.** Mexer em policy de RLS é mexer em autorização, e o enunciado pede
> medição e causa antes de otimização arquitetural. A medição e a causa estão aqui; a mudança
> (acrescentar `club_id = clube_atual_id()` ao predicado, mantendo a função para os casos de
> conversa de unidade/direta) precisa de aprovação e de teste de isolamento próprio.

### 4.3 Outros achados estruturais

- **`select('*')` em 21 pontos** e **`.range()` em zero**: não há paginação real em lugar nenhum.
  11 queries têm `.limit()`; as demais crescem com o histórico.
- Queries **sem limite** sobre tabelas que só crescem: `ranking.js:31` e `:135` (`pontos`),
  `Apontamentos.jsx:61` (`pontos`), `Atividades.jsx:73,75`, `Mensalidades.jsx:56` (ano inteiro),
  `ranking.js:17,105` (`profiles`), `conteudo.js:16`.
- O cap real hoje é o `max_rows = 1000` do PostgREST — um teto de servidor, não paginação.

---

## 5. Pool e conexões (item 6) — **o gargalo não é o banco**

Durante o teste com 300 VUs, medindo `pg_stat_activity` a cada 10 s:

```
conn=27  ativas=11  esperando_lock=0     (estável durante todo o teste)
```

**27 conexões de 100, 11 ativas, zero contenção de lock — enquanto a API já devolvia 5% de erro e
p95 de 9 s.** O PostgreSQL estava ocioso.

Causa: o container do PostgREST não define `PGRST_DB_POOL`, ou seja, usa o **default de 10 conexões**.
Toda a concorrência do app passa por essas 10; o resto vira fila e depois timeout.

**Implicação para produção:** a arquitetura **não** derruba o Postgres abrindo milhares de conexões —
o PostgREST já a protege. O limite fica no tamanho do pool e no número de instâncias de API. No
Supabase hospedado isso é o plano (pool do PostgREST + Supavisor); localmente é um container só.

---

## 6. Storage por clube (item 7) — pendência da fase 5 resolvida no desenho

Hoje `limite_uso(clube, 'armazenamento_mb')` devolve `NULL` porque os caminhos do Storage não
carregam o clube (`perfis/`, `mural/`, `unidades/`, `<user_id>/…`).

PoC com 35.000 objetos sintéticos (5,8 GB declarados), `supabase/carga/storage-por-clube.sql`:

| Abordagem | Plano | Tempo |
|---|---|---:|
| **A) objeto → dono → vínculo** (`owner_id` → `organization_memberships`) | Hash Join, 2 seq scans | **24,9 ms** |
| **B) objeto → registro de negócio por sufixo de URL** (`fotos.url like '%' \|\| o.name`) | **Nested Loop com Materialize, 30.002 × 35.000** | **154.175 ms** |

**B é inviável** — 154 segundos, e o custo é o produto das duas tabelas. A é viável mas só resolve o
que tem dono (perfis e comprovações), e atribui a foto ao clube **do dono**, que pode estar em dois.

**Desenho proposto (não implementado):** medir no momento da escrita, não na leitura.
1. `fotos` (e as demais tabelas que apontam para objeto) ganham `bytes int` preenchido no upload —
   o app já conhece o tamanho do arquivo comprimido.
2. Um agregado por clube (`club_storage_usage`) atualizado por gatilho na escrita.
3. Caminhos **novos** passam a nascer com `<club_id>/` na frente; os antigos continuam válidos —
   a leitura aceita os dois, então não há migração em massa de path.
4. `limite_uso` passa a somar o agregado, que é O(1).

---

## 7. Edge Functions e push (item 8)

Achados de código (`supabase/functions/enviar-push/index.ts`):

| Aspecto | Situação |
|---|---|
| Autenticação | Segredo próprio (`x-push-webhook-secret`) comparado em tempo constante, **falha fechada** (`:35-46`) ✅ |
| CORS | **Nenhum header** — correto, é webhook-only ✅ |
| Validação de payload | Tamanho, UUID, `link` só interno, recusa virar broadcast (`:51-101`) ✅ |
| **Idempotência** | **NÃO EXISTE.** Sem chave de deduplicação: reentrega do webhook = push duplicado ❌ |
| **Retry** | Delegado ao webhook via 500; 200 deliberado em payload inválido para não re-tentar (`:79-107`) ⚠️ |
| **Timeout** | **Nenhum** — sem `AbortController`, sem timeout no `sendNotification` ❌ |
| **Lote / fila** | **`Promise.all` sobre TODOS os destinatários** (`:117-132`), sem concorrência limitada e sem paginação ❌ |
| Limpeza | Apaga inscrição em 404/410 ✅ |

**O `Promise.all` é o problema de escala**: um clube com 500 membros dispara 500 requisições HTTP
simultâneas dentro de um único invoke, sem teto. Um aviso para todo o clube em 100 clubes seria
dezenas de milhares de conexões de saída em paralelo. **Precisa de lote com concorrência limitada
(ex.: 20–50 por vez) e paginação dos destinatários.**

E, como já registrado em 1.3: **os tokens FCM do APK não são consumidos por ninguém** — push nativo
no Android não funciona hoje, mesmo com a Edge Function saudável.

---

## 8. Resiliência (item 9) — o que existe e o que não existe

| Procedimento | Situação |
|---|---|
| **Backup** | Existe no Supabase (automático por plano). **Não há procedimento escrito no repositório.** |
| **Restore testado** | **Nunca foi testado.** Backup sem restore testado não conta como estratégia. ❌ |
| **Migration que falha** | **Coberto e bom**: o SQL Editor é atômico por execução; o rollout documenta que uma migration que falha não aplica nada (`ROLLOUT:27`); há pré-voo (`PREFLIGHT-PRODUCAO.sql`) e teste de replay do zero a cada rodada. ✅ |
| **Deploy ruim (front)** | Vercel mantém deploys anteriores (rollback de 1 clique) — **mas não está escrito em lugar nenhum**. Há rede de segurança no cliente: recarrega 1× sozinho se um chunk falhar (`App.jsx:106`). ⚠️ |
| **Banco indisponível** | Front não tem cache de resposta autenticada (removido de propósito). Tela sem dado. Não há página de status. ⚠️ |
| **Storage indisponível** | Upload falha; exibição tem fallback parcial (`imagens.js:109`), inútil com bucket privado. ⚠️ |
| **Webhook duplicado** | **Comercial: resolvido** (unique `(provider, evento_externo_id)`, fase 5, testado). **Push: não resolvido** (sem idempotência). |
| **Cron repetido** | Parcial: `fechar_leiloes_vencidos` usa `for update skip locked` ✅; `premiar_melhores_do_dia` tem guarda temporal ✅; os demais dependem de idempotência própria, **não verificada sob repetição**. ⚠️ |
| **Edge Function parcial** | Um destinatário que falha não interrompe os outros (`Promise.all`), mas **não há registro de quem recebeu** — não dá para saber o que reenviar. ❌ |

---

## 9. Observabilidade (item 10) — o mínimo que falta

O que **existe** hoje: `cron_falhas` (com expurgo de 90 dias), `platform_admin_audit` (imutável),
`experience_events` (imutável), `subscription_events`, `billing_events`.

O que **não existe**:

| Item | Situação |
|---|---|
| Logs estruturados do front | `drop_console: true` no build — **nada é registrado em produção** |
| Rastreio de erro do cliente | Nenhum (sem Sentry/equivalente) |
| Latência de API | Nenhuma medição própria |
| Alerta de falha de cron | `cron_falhas` **grava**, mas ninguém é avisado |
| Alerta de push falhando | Nenhum |
| Disponibilidade / uptime | Nenhum monitor externo |

**Regra de privacidade para quando isso for implementado:** nunca registrar token, conteúdo de
evidência, texto de mensagem de chat, nem nome/foto/contato de menor. Id de clube e id de usuário
são suficientes para depurar.

---

## 10. Segurança pré-produção (item 11)

Classificação correta: a chave `anon` e a VAPID pública **são públicas por design** e vão no bundle.
Varredura completa do repo e do `dist/`: **nenhum segredo real vazado**; `service_role` só existe na
Edge Function; `.env` não commitado.

**Correto e verificado**: HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy`, `frame-ancestors`, `object-src 'none'`; superfície anônima de apenas **2**
funções; **nenhuma** `security definer` sem `search_path` em 130 migrations; uploads validados por
magic bytes com SVG bloqueado; buckets privados; painel admin todo atrás de `_exigir_admin_plataforma`.

**Achados:**

| Severidade | Achado |
|---|---|
| **ALTO** | CSP **sem `script-src` nem `default-src`** (`vercel.json:9`) — execução de script irrestrita, agravada por sessão em `localStorage`. A omissão é consistente com o pipeline (4 scripts inline sem nonce no `dist/index.html`), mas **não está documentada como decisão**. |
| MÉDIO | **O APK roda sem CSP nenhuma** — os headers só existem na Vercel e o `index.html` não tem meta CSP. |
| MÉDIO | `exigir_partida` nasce `'nao'` e **nenhuma migration o liga** — `registrar_jogo` ainda aceita chamada sem partida. A linha que ligaria está comentada (`…001:407`). |
| MÉDIO | **6 RPCs `security definer` aceitam UUID arbitrário sem conferir clube**: `leilao_saldo_unidade`, `especialidade_ja_concluida_pela_pessoa`, `dependencias_pendentes`, `unidade_ancestral`, `_experiencia_no_publico`, `recurso_situacao`. Vazamento cross-tenant de baixo valor + oráculo de existência. |
| MÉDIO | Auth: confirmação de e-mail **desligada**, senha mínima **6** sem composição, `secure_password_change = false`, `site_url` ainda em `127.0.0.1` (conferir no painel). |
| BAIXO | `react-router-dom@7.18.0` — 2 avisos *high*, mas o advisory é sobre RSC Mode, que este app não usa. Correção é um patch. |
| BAIXO | `documento_verificar` sem rate limit (enumeração inviável por token de 100 bits; risco é custo/DoS). |

---

## 11. Teste de carga (item 12)

Ferramenta: **k6** (container `grafana/k6`), ramp-up gradual, mix realista, critérios definidos
**antes**: `http_req_failed < 1%`, `home p95 < 800 ms`, `contexto p95 < 500 ms`.

### Curva medida

| Pico de VUs | Erros | Home p95 | Contexto p95 | Chat p95 | Veredito |
|---:|---:|---:|---:|---:|---|
| **100** | **0,32%** | **242 ms** | 991 ms | 4,37 s | ✅ dentro do critério de erro; contexto estourou |
| **300** | 5,42% | 9,18 s | 10 s | — | ❌ degradado |
| **1.200** | **45,87%** | 10 s (timeout) | 10 s | 11,3 s | ❌ colapso |

Throughput no ponto saudável: **22 RPS / 9 iterações-de-usuário por segundo**.

### Leitura honesta

- **O joelho está entre 100 e 300 VUs neste ambiente.** Acima disso a fila do PostgREST estoura antes
  de qualquer coisa no banco.
- **O banco nunca foi o gargalo**: 11 conexões ativas de 100, zero espera de lock, durante um teste
  que já devolvia 5% de erro.
- **O chat é o outlier em qualquer nível de carga** (p95 de 4,4 s já com 100 VUs) — coerente com a
  causa medida em 4.2.
- **Não declaro "suporta 3.000".** O que está medido é: com este pool e esta stack, o teto útil é da
  ordem de **100–200 pessoas simultâneas**. Chegar a 3.000 exige, nesta ordem: (1) corrigir o chat,
  (2) dimensionar o pool/instâncias de API, (3) medir de novo em ambiente equivalente ao de produção.

### SLO sugerido — e por que

Com base no comportamento medido no ponto saudável, e **não** num número escolhido para passar:

| Métrica | Alvo inicial | Justificativa |
|---|---|---|
| Disponibilidade | 99,5%/mês | Compatível com um único projeto Supabase sem réplica (≈3,6 h/mês) |
| Home p95 | < 800 ms | Medido 242 ms com folga de 3× no ponto saudável |
| Erro 5xx | < 1% | Medido 0,32% |
| Chat p95 | **sem SLO ainda** | 4,4 s medido; prometer número antes de corrigir a causa seria inventar |

---

## 12. Custos e infraestrutura (item 13)

| Opção | Custo/mês | Operação | Backup | Escala | Complexidade | Quando faz sentido |
|---|---|---|---|---|---|---|
| **Supabase Free (hoje)** | US$ 0 | nenhuma | 0–7 dias | ~mesmo teto medido | mínima | Enquanto for 1 clube piloto. **Pausa por inatividade e sem backup sério: não serve para cliente pagante.** |
| **Supabase Pro** | ~US$ 25 + uso | nenhuma | 7 dias PITR | pool maior, sem pausa | mínima | **É a recomendação para o 1º cliente pagante.** Resolve pausa, backup e pool — os três bloqueadores de infra — sem mudar uma linha de código. |
| Supabase Pro + add-ons (compute) | US$ 25 + US$ 60–400 | nenhuma | PITR | vertical | baixa | Quando a medição mostrar CPU/pool como limite **de novo, já corrigido o chat** |
| + Cloudflare/CDN à frente | + ~US$ 0–20 | baixa | — | cache de asset | baixa | Se o custo de banda do Storage aparecer |
| **VPS gerenciada por nós** | US$ 20–80 | **alta** | **nossa responsabilidade** | manual | **alta** | **Não recomendo.** Trocaria US$ 25/mês por operar Postgres, backup, restore, TLS, upgrade e monitoramento — com uma pessoa. O gargalo medido é pool de API, que o Pro resolve sozinho. |
| Cloud dedicada (RDS + ECS…) | US$ 200+ | muito alta | gerenciado | alta | muito alta | Só com receita que justifique um responsável por infra |

**Recomendação com base no que foi medido:** ficar no Supabase e subir para **Pro** quando houver o
primeiro clube pagante. Nada no que medimos indica necessidade de sair da arquitetura atual — o
gargalo é configuração de pool e uma policy de RLS, não a plataforma.

---

## 13. Classificação dos achados

### 🔴 BLOCKER MVP — sem isto não aceito o primeiro clube pagante

| # | Achado | Onde |
|---|---|---|
| B1 | **Restore nunca testado.** Backup sem restore provado não é estratégia. | §8 |
| B2 | **Push nativo (APK) não funciona**: tokens FCM gravados e nunca consumidos. O app promete aviso no celular e não entrega. | §1.3, §7 |
| B3 | **Webhook do push não versionado** — criado à mão no painel; um projeto novo sobe sem push, em silêncio. | §1.3 |
| B4 | **CSP sem `script-src`** e **APK sem CSP alguma**. | §10 |
| B5 | **Confirmação de e-mail desligada** + senha mínima 6: qualquer e-mail de terceiro vira conta ativa. | §10 |
| B6 | **Plano Free não serve para cliente pagante** (pausa por inatividade, backup curto). | §12 |
| B7 | **Zero observabilidade de erro em produção** (`drop_console` + nenhum rastreio): um cliente pagante relata um bug e não há como investigar. | §9 |

### 🟠 ANTES DE ESCALAR — antes de passar de ~100 pessoas simultâneas

| # | Achado | Evidência |
|---|---|---|
| E1 | **RLS do chat avaliada linha a linha** — 92% do custo, e cresce com o histórico. | §4.2, medido |
| E2 | **Pool do PostgREST no default (10)** — é o teto real; o banco fica ocioso. | §5, medido |
| E3 | **Push em `Promise.all` sem lote nem paginação.** | §7 |
| E4 | **Push sem idempotência** — reentrega duplica. | §7 |
| E5 | **Índice `fotos (club_id, created_at desc)`** — −90% buffers, demonstrado. | §4.1 |
| E6 | **Sem paginação real** (`.range()` em zero lugares); 21 `select('*')`. | §4.3 |
| E7 | **Alerta de falha de cron** — a tabela grava, ninguém é avisado. | §9 |
| E8 | **6 RPCs com vazamento cross-tenant** por UUID arbitrário. | §10 |

### 🟡 PÓS-MVP

- Medição de armazenamento por clube (desenho pronto em §6).
- `exigir_partida = 'sim'` (anticheat de jogos nasce desligado).
- Bundle: 1,37 MB de Phaser num chunk só.
- Laços de cron por clube medidos sob volume (100 → 1.000 clubes).
- `react-router-dom` para 7.18.2.

### 🔵 IDEIA FUTURA

- Réplica de leitura / segunda região.
- Fila dedicada para push.
- Cache de borda para leituras públicas.
- Particionamento de `pontos` e `chat_mensagens` por período.

---

## 14. Checklist para aceitar o primeiro clube pagante

- [ ] **Restore testado**: restaurar um backup num projeto descartável e provar que o app sobe.
- [ ] **Push nativo funcionando** no APK, ou remover a promessa da interface.
- [ ] **Webhook do push em migration** (ou script de provisionamento versionado).
- [ ] **CSP com `script-src`** na Vercel e **meta CSP no `index.html`** para cobrir o APK.
- [ ] **Confirmação de e-mail ligada** e senha mínima 8 no painel do Supabase.
- [ ] **Plano Pro contratado** (fim da pausa por inatividade + PITR de 7 dias).
- [ ] **Rastreio de erro em produção** ligado, sem registrar token, evidência, mensagem ou dado de menor.
- [ ] **Alerta** quando `cron_falhas` receber linha e quando a Edge Function devolver 5xx.
- [ ] `site_url` e `additional_redirect_urls` conferidos no painel.
- [ ] Rodada final dos gates (44 testes SQL + upgrade + e2e + Vitest) contra o projeto de produção
      **antes** de abrir para o cliente.

**Fora do escopo desta fase, de propósito:** nenhum gateway de pagamento foi integrado; nenhuma
otimização arquitetural foi aplicada — as duas mudanças com maior impacto medido (RLS do chat e pool
do PostgREST) estão documentadas com causa e número, aguardando decisão.

---

## Como reproduzir

```bash
# 1. dataset sintético (determinístico, descartável)
docker cp supabase/carga supabase_db_CONQUISTA:/tmp/carga
docker exec -i supabase_db_CONQUISTA psql -U postgres -f /tmp/carga/gerar-dataset.sql

# 2. query audit
docker exec -i supabase_db_CONQUISTA psql -U postgres -f /tmp/carga/audit-queries.sql

# 3. tokens + carga (ramp-up: base | joelho | completo)
node supabase/carga/gerar-tokens.mjs supabase/carga/usuarios.json
docker run --rm -v "$PWD/supabase/carga:/carga" -e ANON=<anon> -e USERS=/carga/usuarios.json \
  -e DEGRAU=base grafana/k6 run /carga/k6-mix.js

# 4. limpar tudo
docker exec -i supabase_db_CONQUISTA psql -U postgres -f /tmp/carga/limpar-dataset.sql
```
