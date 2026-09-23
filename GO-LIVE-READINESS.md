# Go-Live Gate — primeiro ambiente comercial

Fase 8.2. Continuação de [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) (fase 8) e
[PRODUCTION-READINESS-8.1.md](PRODUCTION-READINESS-8.1.md). Tudo em ambiente local isolado;
**nenhum deploy, nenhum push, nenhum Supabase remoto tocado.** Nenhum gateway de pagamento
integrado.

---

## Conclusão

> # ✅ PRONTO PARA PILOTO COM O PRIMEIRO CLUBE
>
> **Com três condições de infraestrutura que não são código** (§6) e **um limite declarado de
> escala** (§4): este veredito vale para **um clube piloto de até ~300 membros**. O segundo clube
> pagante exige fechar os itens marcados `ANTES DE ESCALAR`.

Nenhum item ficou em **FAIL**. O que sustenta isso está medido, não estimado — e o caminho até
aqui derrubou a classificação da fase 8 em dois pontos importantes (§2 e §3).

---

## 1. A matriz

| # | Item | Situação | Evidência |
|---|---|---|---|
| 1 | **Push idempotente** | **PASS** | migration 55 · teste 50, 47 asserts · inclui concorrência real |
| 2 | **Paginação real** | **ACEITO_COM_RISCO** | migration 58 + 59 · teste 52, 33 asserts · 3 de 14 superfícies fechadas (§4) |
| 3 | **RPCs cross-tenant** | **PASS** | migration 56 · teste 51, 26 asserts · + causa-raiz corrigida (§3) |
| 4 | **Canal de alerta** | **PASS** | migration 57 · exercitado de ponta a ponta |
| 5 | **Matriz de readiness** | **PASS** | este documento |
| 6 | **Infraestrutura-alvo** | **ACEITO_COM_RISCO** | `supabase/infra/AMBIENTE-DE-PRODUCAO.md` · 3 passos manuais restantes (§6) |
| 7 | **Smoke test** | **PASS** | `npm run test:smoke` · 7 passos · roda contra ambiente real sem destruir dado |
| 8 | **Carga sem regressão** | **PASS** | §5 |
| — | Gateway de pagamento | **NÃO_APLICÁVEL** | fora do escopo por instrução |
| — | Plano Supabase Pro | **NÃO_APLICÁVEL** (não é código) | §6 |

---

## 2. Push idempotente (item 1)

O que existia antes, medido e não estimado: **nada**. Nenhuma constraint, nenhum registro de
entrega, nenhuma chave de negócio. `notificacoes.id` é `gen_random_uuid()` — dois INSERTs para o
mesmo fato do mundo real recebem ids diferentes, então a chave não colide e não deduplica nada. A
Edge Function sequer lia o id: recalculava o público a cada invoke e descartava tudo no fim.

A auditoria encontrou **11 caminhos de duplicata**, todos reais. Os que mais importam:

| Caminho | Onde |
|---|---|
| cron sem guarda nenhuma | aniversariantes, eventos de amanhã |
| duplicata **dentro de uma única execução** | o join de membros não tem `distinct`, e a mesma pessoa pode ter dois vínculos ativos no mesmo clube com papéis diferentes |
| `timeout_milliseconds := 5000` no gatilho | a função trabalha em lotes que passam disso — o pg_net marcava `timed_out` numa entrega que estava acontecendo |
| invoke morre no lote 12 de 20 | os 11 primeiros já chegaram, e não havia registro nenhum |
| rotação de token do FCM | o **mesmo** aparelho vira duas linhas: a duplicata que sobrevive a qualquer chave de evento |
| **restaurar um backup** | replica os INSERTs históricos e todo membro de todo clube recebe meses de notificação de uma vez |

**Três níveis, três chaves** — exatamente o "evento → destinatários → tentativas" pedido:

- `push_eventos` — chave de **negócio** única. Mata cron repetido, duplo toque e replay **antes do
  pg_net**: se o evento não nasce, o gatilho nem dispara. Não depende de a Edge Function ser correta.
- `push_evento_destinatarios` — público **congelado** no instante do evento. Recalcular no envio
  faria o retry mirar um conjunto diferente do original.
- `push_tentativas` — uma linha por tentativa + índice único parcial em **(destinatário, APARELHO)**
  `where estado in ('enviando','entregue')`. `'falhou'` sai do índice, então o retry reserva de
  novo — exatamente-uma-vez na entrega **e** histórico completo.

A chave final é por **aparelho** e não por pessoa, e as duas falhas são simétricas: por pessoa, o
tablet ficaria calado (trocaríamos duplicata por **perda**, pior num aviso para criança); e por
pessoa nem resolveria, porque durante a rotação o mesmo aparelho tem duas linhas.

**O conserto do restore é por intenção positiva:** `notificacoes.push_evento_id` é nulável, e sem
evento não há push. Uma guarda pela negativa dependeria de todo script futuro lembrar de ligá-la;
aqui, esquecer significa não enviar — e silêncio é o modo de falha certo para push. `seed.sql` e
`_fixtures.sql` passaram a declarar `chave_push = ''`; antes disso, semear um projeto configurado
disparava push de verdade, e só não acontecia porque o Vault local está vazio (acidente do
ambiente, não guarda).

---

## 3. Os RPCs cross-tenant (item 3) — e a causa-raiz

A fase 8 listou seis funções e chamou o problema de *"vazamento de baixo valor + oráculo de
existência"*. Um red-team adversarial atacou cada uma no banco, com SQL executado, e **refutou
essa classificação em todas as seis**.

| Função | Por que atravessava | O que atravessava | Quem podia chamar | Alvo | Veredito |
|---|---|---|---|---|---|
| `recurso_situacao` | entitlement das 3 camadas | plano, overrides da diretoria e **suspensão da assinatura** de qualquer clube | **qualquer conta logada, inclusive com zero vínculos** | parâmetro do cliente | **gate por `clube_atual_id()`** |
| `dependencias_pendentes` | regra curricular | nomes de itens que a RLS esconde (rascunho/arquivado) + se alguém de outro clube concluiu | qualquer logado | parâmetro | **fora da API** |
| `especialidade_ja_concluida_pela_pessoa` | histórico portátil | conquista curricular de um **menor** de outro clube | qualquer logado, inclusive `pais` | parâmetro | **fora da API** |
| `unidade_ancestral` | hierarquia institucional | árvore organizacional de outro tenant; oráculo de existência **e de tipo** | qualquer logado | parâmetro | **fora da API** |
| `_experiencia_no_publico` | motor de experiências | confirma nominalmente terceiros; responde sobre **rascunho** | qualquer logado | parâmetro | **fora da API** |
| `leilao_saldo_unidade` | leilão por unidade | saldo de unidade alheia; **fura o entitlement**; vaza por **erro** (22003 × 0) | qualquer logado | parâmetro | **gate + entitlement** |
| `pontos_temporada_unidade` | — | **não estava na lista da fase 8** | qualquer logado | parâmetro | **gate por `clube_atual_id()`** |

**O que nenhuma delas pode retornar:** nada que distinga um alvo de outro clube de um uuid
inexistente — nem valor, nem `null` diferente, nem sqlstate, nem mensagem. O teste 51 compara as
duas respostas caractere a caractere, inclusive no estado sobre-reservado que antes levantava
`22003`.

### A causa-raiz, que vale mais que as sete correções

O teste 24 é a guarda do projeto contra oráculos de UUID. Ele percorria `proargtypes::oid[]` **a
partir do índice 1** — e esse array vem de um `oidvector`, que é **0-based**.

> **Medido no banco: a varredura sondava 19 das 118 posições uuid existentes. 16%.**
> Toda função com 2+ argumentos era descartada em silêncio.

Era por essa fresta que tudo passou, fase após fase. Corrigido, mais um assert de **cobertura**
que compara o que a varredura alcança com o que existe — para o buraco não voltar sem ninguém ver.
Com a varredura corrigida, o único achado novo foi um falso positivo legítimo (uma função
`IMMUTABLE` que devolve o próprio argumento), agora excluída por regra geral: função que não pode
ler o banco não pode vazar o estado dele.

### Um erro meu, no meio disso

A primeira versão da migration 56 revogou também `comparar_versoes_curriculares`,
`classe_esta_publicada`, `especialidade_esta_publicada` e as duas `explicar_requisito_*`,
derrubando nove arquivos de teste. As três primeiras são **catálogo da plataforma** (mesma resposta
para todo clube, zero dado de tenant) e API documentada; as duas `explicar_*` são capacidade real
do produto — explicam à pessoa por que um requisito está bloqueado. Precaução que remove capacidade
sem fechar vazamento é dano, não precaução. As `explicar_*` ganharam **gate** (a cópia literal da
policy de `member_requirements`) em vez de revoke.

---

## 4. Paginação (item 2) — o item ACEITO_COM_RISCO

A auditoria mapeou **14 superfícies** que crescem sem teto. Foram fechadas **3**, e é preciso ser
exato sobre o que isso significa.

**O que foi feito:**

| Superfície | O que mudou |
|---|---|
| Chat — histórico e moderação | `chat_pagina()` com cursor **keyset** (migration 58) |
| Mensalidades — aba Ano | `mensalidades_ano()` agregado: N linhas em vez de N×12 (migration 59) |
| (o padrão) | cursor de **tupla** `(created_at, id)`, índice espelhando o `ORDER BY`, teto próprio abaixo do `max_rows` |

**A armadilha que o keyset ingênuo não vê, e que aqui é real:** `created_at` **empata**, porque
`now()` no Postgres é o instante de **início da transação** — toda rotina que grava várias linhas
num laço produz timestamps idênticos byte a byte (a auditoria achou três dessas). Cursor só com a
data **pula** linhas (com `<`) ou entra em **laço infinito** (com `<=`). O teste 52 prova os seis
casos que a fase pediu — primeira página, próxima, item inserido entre páginas, exclusão, **empate
de timestamp** e fim da coleção — mais uma guarda explícita contra laço infinito dentro do bloco
empatado.

**O achado de dinheiro, medido:**

> Com **1.320 mensalidades** de um ano num clube, a API devolvia **1.000 linhas e HTTP 200**.
> Sem erro, sem header que o app leia. A tela mostrava **320 pagamentos como não pagos**.
> Um clube de 83 membros ainda passa (996 linhas); com 84, começa a mentir.

Era a tela que justifica a mensalidade do produto. Fechado.

**O que fica aberto, e o risco de verdade:** as outras 11 superfícies (membros, ranking, avaliações
pendentes, mural, atividades, painel institucional, apontamentos) continuam limitadas pelo mesmo
`max_rows = 1000`, que **trunca e devolve 200**. Nenhuma delas é dinheiro, e nenhuma delas chega a
1.000 linhas num clube de até ~300 membros. Acima disso, começam a mostrar dado incompleto em
silêncio.

| | |
|---|---|
| **Justificativa** | o risco é de completude de leitura, não de autorização nem de dinheiro; e não se materializa no porte de um clube piloto |
| **Impacto** | listas truncadas sem aviso acima de ~1.000 linhas por coleção |
| **Mitigação** | o padrão keyset está implementado e testado — replicar é trabalho mecânico, não desenho; o teto de 300 membros é o gatilho |
| **Responsável futuro** | fechar antes do **segundo clube pagante** ou de o piloto passar de 300 membros, o que vier primeiro |

---

## 5. Carga (item 8) — sem regressão

Mesmo cenário, mesmo dataset, mesmos critérios definidos **antes**: `http_req_failed < 1%`,
`home p95 < 800 ms`, `chat p95 < 800 ms`.

| VUs | 8.1 erros | **8.2 erros** | 8.1 Home p95 | **8.2 Home p95** | 8.1 req/s | **8.2 req/s** |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 0,43% | 0,37% | 7,47 ms | 7,59 ms | 25,7 | 25,6 |
| 300 | 0,51% | 0,52% | 6,14 ms | **5,47 ms** | — | 62,3 |
| 800 | 1,57% | 1,60% | 7,15 ms | **5,50 ms** | 197 | **198,8** |
| 1.200 | 2,63% | 2,52% | 6,10 ms | **5,64 ms** | 168 | 167,5 |

**Burst de 3.000 aparelhos abrindo a Home em 60 s:** 3.001 iterações, 100 req/s sustentados,
**0% de erro**, Home p95 **6,24 ms**, p99 9,21 ms.

Conexões do Postgres em todos os degraus: **23–24 de 100, 2–4 ativas, zero espera de lock**. O
gargalo continua sendo CPU do banco, como na 8.1 — as três tabelas novas de push, as quatro de
alerta e o índice keyset **não custaram nada mensurável**. O chat até melhorou (p95 de 11,7 → 9,8 ms).

> Caveat que vale para todos os números: laptop, Supabase CLI, um container por serviço, e o k6
> disputando a mesma CPU. Isto mede a **forma da curva**, não a capacidade do Supabase hospedado.

---

## 6. O que falta, e não é código

| # | Item | Situação |
|---|---|---|
| 1 | **Plano Supabase Pro + compute Small** | Free pausa por inatividade e tem backup curto. Documentado em `AMBIENTE-DE-PRODUCAO.md`; não dá para resolver por código, como a própria fase determinou |
| 2 | **Segredos no ambiente de produção** | `PUSH_WEBHOOK_SECRET`, VAPID, `FCM_SERVICE_ACCOUNT` nos Secrets; `push_edge_url` e `push_webhook_secret` no Vault (`supabase/infra/configurar-push.sql`) |
| 3 | **`site_url` e `/nova-senha`** conferidos no painel | sem isso o link de confirmação aponta para a máquina da própria pessoa e a recuperação de senha falha no último passo |
| 4 | **Destino de alerta configurado** | o destino `painel` já vem por migration (é o piso); um `webhook_json` para Slack/Discord/Teams é um INSERT + um segredo no Vault |
| 5 | **Restore testado no projeto de produção** | o procedimento existe e é reexecutável (`restaurar-teste.sh`); falta rodá-lo **lá** |

---

## 7. Permanece aberto, com justificativa

| Item | Situação | Por quê |
|---|---|---|
| 11 superfícies sem paginação | **ACEITO_COM_RISCO** | §4 — gatilho declarado: 2º clube ou 300 membros |
| Sobre-reserva no leilão sem teto | **ACEITO_COM_RISCO** | achado do red-team: `confirmar_lance_conjunto` exige que a **soma** das unidades cubra o lance, mas reserva o valor **cheio de cada uma** — 1.800.000 reservados contra 27 pontos próprios. É bug de regra de jogo, não de segurança nem de dinheiro real; o oráculo por erro que ele habilitava **foi fechado** |
| `exigir_partida` (anticheat) desligado | **ACEITO_COM_RISCO** | vem da fase 8; jogo, não cobrança |
| Bundle com 1,37 MB de Phaser | **ACEITO_COM_RISCO** | carregado sob demanda; pesa na primeira abertura dos jogos |
| Idempotência das outras fontes de notificação | **ACEITO_COM_RISCO** | a chave automática (conteúdo + minuto) cobre cron repetido no mesmo minuto e duplo toque. Uma reexecução de cron **horas depois** ainda passa; a chave explícita com a data fecha isso quando esses crons forem revistos |

---

## 8. Gates

| Gate | Resultado |
|---|---|
| `npm run lint` | **0 erros** (75 avisos) |
| `npm run test` | **413 testes** |
| `npm run build` | ok |
| `npm run test:db` | **53 arquivos, 0 falhas** |
| `npm run test:db:upgrade` | 116 asserts |
| `npm run test:auth:e2e` | 20 asserts |
| `npm run test:smoke` | 7 passos, verde |
| Red-team do chat | matriz de 62 asserts idêntica antes/depois (fase 8.1) + 26 asserts de paginação com a autorização da migration 51 |

**Testes novos nesta fase:** 50 (push idempotente, 47 asserts), 51 (RPCs cross-tenant, 26), 52
(paginação keyset, 33). Mais a correção de cobertura do teste 24, que passou de 16% para 100% das
posições uuid.

---

## 9. O que esta fase ensina sobre as anteriores

Três vezes seguidas, o que o relatório anterior afirmava não resistiu à medição:

- a fase 8 disse que o custo do chat **crescia com o histórico**. A fase 8.1 mediu: era 10,1
  buffers **por linha retornada**, constante.
- a fase 8 classificou os RPCs cross-tenant como **baixo valor**. O red-team refutou nos seis.
- e a guarda que deveria ter pego tudo isso cobria **16%** da superfície há quem sabe quantas fases.

Não é um problema de descuido: é o padrão previsível de uma auditoria que lê o código em vez de
executá-lo. Vale como método para as próximas fases — **o que não foi atacado no banco não foi
verificado**, e uma varredura automática precisa provar a própria cobertura antes de servir como
garantia.
