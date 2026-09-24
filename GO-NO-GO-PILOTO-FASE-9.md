# Fase 9 — Staging e Piloto Técnico Multi-Clube A/B/C · Go/No-Go

| | |
|---|---|
| Branch candidata | `saas-produto-multiclube` — checkpoints preservados (`piloto-primeiro-clube`, `multiclube-validado`, `fundacao-multitenant-2026-09-21`) |
| Staging | segundo stack local, separado em tudo (decisão do dono do projeto) |
| Migrations da fase | `20260929000073` a `…079` — sete, todas classificadas no freeze |
| Banco | **61 arquivos, 3.059 asserts** + **upgrade de produção simulado, 117 asserts** — 0 falhas |
| Frontend | **41 arquivos, 440 testes** · gate de ambiente (4 builds) verde |
| Gates pela API real | **1.114 verificações, 0 falhas** (staging vivo, conferido no banco) |
| Red-team | **50 ataques segurados, 0 furos** (1 furo real achado e fechado antes) |
| UAT no navegador | **19 jornadas** + varredura de 50 rotas por papel — **2 BLOCKERS achados e corrigidos** |
| Restore | **comprovado** em ambiente descartável: 53,4 s de máquina |
| Drill de migration | **OK** — recuperação de migration que estraga dado em 17,2 s |
| Carga (não-validante) | leitura, escrita e upload aguentam 500 simultâneos; rajada aguenta 3.000 abrindo em 10 s |

Evidência bruta de cada item em `supabase/e2e/evidencias-fase9/`.

---

## 1. Freeze — o que mudou, e em que categoria

Só entrou mudança de **BLOCKER PILOTO, SEGURANÇA, PERDA DE DADOS, ISOLAMENTO, OBSERVABILIDADE ou
RECUPERAÇÃO**. Toda ela nasceu de uma medição desta fase — nenhuma foi planejada antes.

| mudança | categoria | achada por |
|---|---|---|
| **73** — o clube de uma escrita é o da **aba**, não o da pessoa (mensalidade, foto, ajuda, aviso pessoal; um `club_id` explícito deixa de ser ignorado em silêncio) | ISOLAMENTO | sonda nova (teste 58): pessoa em A+B agindo nas duas abas |
| **74** — mensalidade única **por clube**; some a UNIQUE legada `(desbravador, mês, ano)`, que também era um **oráculo** do caixa do outro clube | ISOLAMENTO | teste 58 |
| **75** — o "clube em uso" só pode ser um **clube** (um distrito no header virava clube em uso e recebia foto e bichinho) | ISOLAMENTO | gate de API, contexto "distrito" |
| **76** — `clube_legado_id()` deixa de responder a **anônimo** | SEGURANÇA | red-team |
| **77** — trilha das operações críticas (vínculo, senha redefinida, recurso); telemetria sem segredo **no servidor**; senha redefinida pela liderança na política do Auth | OBSERVABILIDADE + SEGURANÇA | inventário do item 7 |
| **78** — chat, bíblia, bichinho, lance conjunto, duelo e `minha_unidade` decidindo pelo **espelho do perfil** (só o clube primário); a leitura da bíblia feita em A **caía em B** | ISOLAMENTO | **teste de carga** (o dataset tinha gente em dois clubes) |
| **79** — o token de **documento** (20 maiúsculas/dígitos) escapava da máscara da 77 pela rota `/documento/:token` | OBSERVABILIDADE | mapa de rotas conferido depois da 77 |
| front: tela de **Usuários** da liderança quebrava inteira | **BLOCKER PILOTO** | UAT |
| front: **fundador** terminava o onboarding e via "você não está em um clube" | **BLOCKER PILOTO** | UAT |
| front: Mensalidades com o alvo de upsert por clube; senha na tela de Usuários (8, letras e números) e gerador que sempre a cumpre | ISOLAMENTO / SEGURANÇA | junto da 74 e da 77 |
| ferramentas: staging, povoamento, gates de API, red-team, restore, drill, aplicar-migration, rampa de carga | RECUPERAÇÃO / OBSERVABILIDADE | — |

**Backlog (conveniência, fora do freeze):** o rótulo "mín. 6 caracteres" no cadastro; a lista de
amigos do "pedir ajuda" não filtra pela aba; a leitura **direta** da tabela `experiences` dá erro
para qualquer membro (falha fechada — o app lê pela RPC); as duas versões publicadas do plano
Essencial aparecem como duas opções no onboarding (o servidor usa a mais nova).

---

## 2. Staging

Stack próprio (`CONQUISTA-STAGING`, portas 55xxx, front 4273), com **segredo JWT e chave de
assinatura próprios**. `node scripts/staging.mjs conferir` prova, por experimento, que um token do
desenvolvimento é **recusado** pelo staging. O gate de ambiente (`npm run test:ambiente`) constrói
LOCAL, PRODUÇÃO e STAGING e prova que nenhum bundle carrega o endpoint de outro ambiente, e que
produção sem endpoint **falha o build**. O front de staging no navegador tem `connect-src` só para
`127.0.0.1:55321`. Runbook: `supabase/infra/STAGING.md`.

O que o staging ensinou sobre si mesmo — e que vale para qualquer staging local:

- **"Separado" não era.** Segredos, bancos e portas diferentes, e um token de um valia no outro: o
  CLI embarca a mesma chave de assinatura EC em todo projeto local. Corrigido com chave própria.
- **`supabase status` recalcula as chaves** do segredo que enxerga — sem a variável, devolve as do
  desenvolvimento apontando para o staging. A fonte de verdade é `.env.staging`.
- Com chave própria, o PostgREST do staging aceita **só ES256**: token HS256 dá 401.
- **Duas credenciais entraram em commit** (a chave de assinatura e um arquivo de tokens do seeder) e
  saíram no mesmo minuto; o histórico não as tem. Regra que ficou: saída de seeder entra no
  `.gitignore` antes de o seeder rodar.

---

## 3. Dados sintéticos A/B/C

`supabase/e2e/popular-staging.mjs`, **pelo produto**: cadastro, código de entrada, aprovação, convite
de equipe, convite de responsável, RPCs na aba de quem age. Nenhum dado pessoal real
(`@staging.local`, nomes inventados, imagem de 1 pixel).

| identidade | como nasceu |
|---|---|
| só A · só A (2ª) · só B · só B (2ª) · só C | código de entrada → aprovação |
| A+B · A+B+C | códigos de dois/três clubes → aprovações |
| diretoria A + membro B | convite de equipe (A) + código (B) |
| instrutor A+B | dois convites de equipe |
| responsável | convite de responsável → pedido de vínculo → aprovação: vê **exatamente uma** filha |
| coordenador distrital | **SQL de plataforma** (distrito com A e B; C fora) |
| fundador sem clube | cadastro, onboarding nunca iniciado (e, na UAT, completado pela tela) |

Clubes diferentes em marca, unidades, plano e recursos (C é gratuito: mensalidade, jogos e
experiência **recusados** lá, e o povoamento confere a recusa). Dados: pontos, mensalidades, fotos,
partidas, evidência de criança no bucket privado, classe **concluída até a investidura com
documento**, progresso parcial em B, experiência publicada em B.

Duas coisas **não têm caminho de produto** e foram feitas por SQL de plataforma, marcadas na saída:
criar distrito/dar papel de coordenador, e publicar o **conteúdo do período** ("Curso de Leitura do
ano"). A segunda pesa: **sem ela nenhuma classe pode ser concluída** — o requisito fica bloqueado.

Rodado na versão 72 com as 9 recusas do defeito que a 73 corrige marcadas como conhecidas (82 OK);
na versão 74, **91 OK e nenhuma recusa**.

---

## 4. A regra de sessão do harness

`supabase/e2e/HARNESS.md`: mesma conta em clubes diferentes = **abas** (o clube vive em
`sessionStorage`); contas diferentes = **contextos de navegador separados**, ou em sequência — a
sessão do supabase-js vive em `localStorage`, compartilhado por origem, e logar numa aba troca a
sessão de todas. A UAT seguiu a regra: uma identidade por vez; duas abas só para a mesma conta.

---

## 5. Os cinco gates, reexecutados

Duas camadas, e as duas medem o **banco fora da RLS**, nunca só o status HTTP.

**SQL no banco vivo do staging** (`run-tests.sh --db postgres --no-replay`): 43 de 59 passaram. As 16
que não passaram foram lidas uma a uma — todas **ambientais**: contagem exata que o povoamento mudou
(08, 11, 18, 25, 43, 49), configuração mudada pelo produto (34: a liderança ligou `classes`),
conteúdo do período publicado pela operação de plataforma colidindo com o que os testes inserem
(36–42), seed exclusivo por desenho (`multi_tenant_isolation`), reaplicar migration antiga sobre dado
real (09). Os gates de isolamento — 06, 24, 26, 27, 51, 54, 55, 56, 57, 58 — passaram todos.

**Pela API real** (`supabase/e2e/gates-api-staging.mjs`): JWT do auth do staging, header
`x-clube-atual`, identidades e dados do povoamento, 13 identidades × 7 contextos (A, B, C, sem
header, lixo, clube inexistente, **distrito**):

| gate | verificações | falhas | o que mede |
|---|---|---|---|
| isolamento de leitura | 731 | 0 | cada tabela operacional só devolve o clube da aba, e só se for da pessoa; piso provado no banco |
| isolamento de escrita | 351 | 0 | escrever no próprio clube, no alheio, forjando `club_id`, PATCH e DELETE alheios — contado no banco |
| integridade de contexto | 14 | 0 | mesma sessão em três abas; header alheio/lixo/inexistente/**distrito** → nenhum clube; sem header → o padrão da própria pessoa |
| fronteira do portátil | 13 | 0 | documento conferível por token sem expor e-mail/nascimento/id; matrícula em andamento é do clube; evidência não viaja |
| isolamento de identidade | 5 | 0 | token adulterado → 401; token de outro ambiente → 401; autor alheio no corpo não vale; logout |

O gate achou um defeito (**75**) antes de passar. O mesmo conjunto SQL foi rodado sobre o banco do
**upgrade de produção simulado**: 06, 24, 26, 54–58 OK.

---

## 6. UAT no navegador

19 jornadas contra o front de staging, em viewport de celular, uma identidade por vez, cada resultado
**conferido no banco**. Detalhe e método em `evidencias-fase9/06-uat-navegador.md`.

| jornada | resultado |
|---|---|
| cadastro sem clube → confirmação de e-mail → código → pedido → aprovação | ✅ trilha: pedido pela pessoa (pendente) → aprovação pela liderança de C |
| convite para um segundo clube | ✅ |
| pessoa A+B+C trocando de clube | ✅ marca e dados mudam; mural 50/34/11 = banco |
| troca e recarga com duas abas da mesma conta | ✅ cada aba mantém o seu clube |
| membro · responsável · coordenador | ✅ |
| instrutor aprova requisito enviado pela criança | ✅ aprovado **no clube da aba** |
| diretoria | ❌→✅ **BLOCKER corrigido** |
| fundador / onboarding | ❌→✅ **BLOCKER corrigido** |
| classe · especialidade · documento · experiência · jogos · mensalidade | ✅ (especialidade: catálogo só de teste) |
| sair → entrar com outra identidade | ✅ aba, semente, marca e sessão zeradas |
| **varredura das 50 rotas** por papel (diretoria, membro, responsável, coordenador, A+B+C na aba de C) | ✅ zero quebras depois da correção |

Os dois blockers:

1. **A tela de Usuários da liderança quebrava inteira** — desde a fase 8.5, nenhuma liderança de
   nenhum clube conseguia trocar papel, desativar, redefinir senha, pôr na unidade ou convidar equipe.
   O formulário de convite passava objetos a um componente que espera pares. Nenhum teste
   renderizava o formulário. A telemetria (item 7) registrou o crash de ponta a ponta: rota, código,
   clube e quem. Corrigido com teste que renderiza.
2. **Quem terminava o onboarding via "Você ainda não está em um clube"** — com "Criar um clube" logo
   abaixo. O vínculo existia; a tela estava velha. Corrigido: o botão recarrega o contexto antes de
   entrar.

Não exercitado pela tela: o **envio de foto de evidência** (o painel não envia arquivo; o caminho do
Storage foi exercitado pela API no povoamento, no restore e no red-team).

---

## 7. Observabilidade

| área | quem | o quê | clube | quando | componente | onde |
|---|---|---|---|---|---|---|
| Auth | ✔ | login, logout, cadastro | — (global) | ✔ | GoTrue | `auth.audit_log_entries` (**sem** tentativa falha) |
| erro visto pela pessoa (RPC, tela) | ✔ (servidor) | rota + código SQLSTATE + frase | ✔ (header) | ✔ | origem | `app_erros` (sem o nome da RPC) |
| crash de tela | ✔ | rota + tipo do erro | ✔ | ✔ | `boundary` | `app_erros` — **provado com o crash real da UAT** |
| Edge Function (push) | destinatário | canal, estado, código, duração | ✔ | ✔ | ✔ | `push_tentativas`, `push_eventos` |
| cron | — | rotina + erro | ✔ | ✔ | ✔ | `infra_falhas`, `cron.job_run_details` |
| alertas | — | categoria, severidade, resumo | ✔ | ✔ | ✔ | `alertas`, `alerta_entregas` |
| **vínculo** (aprovar, suspender, papel, unidade) | ✔ | de → para | ✔ | ✔ | gatilho | `auditoria_operacoes` — **novo (77)**, provado na UAT |
| **senha redefinida pela liderança** | ✔ | sobre quem | ✔ | ✔ | RPC | idem — **novo (77)** |
| **recurso ligado/desligado** | ✔ | qual, como ficou | ✔ | ✔ | RPC | idem — **novo (77)** |
| convite, código, mensalidade, pontos, documento, avaliação, investidura | `*_por` | a própria linha | ✔ | ✔ | — | as tabelas |

**O que nunca é gravado**, provado no servidor (teste 60) e ao vivo no staging: senha, token de
convite (querystring **e fragmento**), token de documento no caminho (`/verificar/` e `/documento/`),
código de entrada completo, e-mail no texto. O UUID de um registro continua, porque é o que permite
reproduzir. A trilha e a telemetria são lidas só pela operação da plataforma — nem a diretoria.

Lacunas que ficam: tentativa de login falha não vai para o banco; o erro de RPC não carrega o nome
da RPC; sem política de retenção para a trilha nova; e a fronteira de erro mostra **"saiu uma versão
nova"** para qualquer crash — manda a pessoa atualizar em vez de relatar (a telemetria registra; a
pessoa é que não fica sabendo).

---

## 8. Backup e restore

`node scripts/restaurar-staging.mjs completo`: marcador → backup (banco `pg_dump -Fc` como
`supabase_admin` + **arquivos do Storage** + manifesto com sha256) → segundo marcador → **terceiro
stack** descartável (porta 56321, segredo e chave próprios) → troca do banco inteiro → arquivos →
serviços → conferência → descarte.

- **manifesto idêntico campo a campo**: migração, contas, identidades, vínculos por clube, pontos,
  mensalidades, fotos, matrículas, requisitos aprovados, documentos, objetos do Storage, cron,
  policies, funções, gatilhos, tabelas com RLS;
- **o sistema volta pela API**: as 10 identidades entram com a senha de antes, os vínculos voltam
  exatos, a responsável vê a filha certa, a classe volta investida, o documento confere, a evidência
  baixa para a dona **e continua proibida para outra criança**, a foto do mural abre, e um token do
  staging é recusado pelo descartável;
- **o próximo deploy continua possível** (dono do banco e uma migration de prova);
- **RTO de máquina: 53,4 s** (provisionar 40,7 · banco 5,5 · storage e serviços ~5 · conferência ~2);
- **RPO**: o instante do dump — a escrita feita antes voltou, a feita depois não.

---

## 9. Drill de migration

`node scripts/drill-migration.mjs`, no staging vivo na versão 72: backup → release 73+74 aplicada
**como o SQL Editor** (uma transação por arquivo, papel `postgres`, ledger na mesma transação) →

- **F1, migration que aborta no meio**: nada dela fica (coluna e índice criados antes do erro não
  existem), o ledger não anda, o app segue;
- **F2, migration que commita e estraga** (suspende os membros de B e apaga o caixa de B): o SQL
  Editor diz *Success*; o **manifesto** e a **sonda de uso** acusam; **restore in-place** do backup
  de antes da release; release certa de novo → **17,2 s** do "decidi restaurar" à release no ar;
- **RPO medido**: as escritas legítimas entre o backup e o incidente, e depois dele, **se perdem** —
  o produto não tem modo manutenção.

E "versão N → migrations completas → gates": o **upgrade de produção simulado** (schema legado +
dados de produção simulados → pré-voo → todas as migrations → verificação) passa com 117 asserts, e
os gates da fase passam em cima dele. As migrations 75–79 foram levadas ao staging pelo mesmo
procedimento (`scripts/aplicar-migration.mjs`), conferindo o ledger pelo conjunto.

O que o drill achou, e está corrigido: (1) **o restore recriava o banco com o dono errado** — tudo
voltava, a suíte passava, e a **próxima migration** falhava; (2) **o ledger mentia pelo `max()`**
(dizia 74 com a 73 faltando); (3) **o modo `--upgrade` estava vermelho desde a 8.5** sem ninguém ver
— agora roda em toda rodada completa.

Procedimento operacional, passo a passo: `supabase/infra/DEPLOY-E-RECUPERACAO.md`.

---

## 10. Carga — NÃO-VALIDANTE

Rampa 50 → 100 → 250 → 500 → 1.000 → 2.000 → 3.000 no staging, quatro famílias separadas, critério de
parada escrito **antes** (falha > 5%, p95 > 3 s, p99 > 8 s) e critério de "aguenta" por degrau
(falha ≤ 1%, p95 ≤ 1 s, p99 ≤ 3 s, medido só no patamar). `supabase/carga/k6-rampa-fase9.js`.

| família | aguenta até | nesse degrau | onde para |
|---|---|---|---|
| leitura (contexto, início, ranking, experiências, chat) | **500** simultâneos | 260 req/s · p95 14 ms · 0,01% | 1.000: 5,7% de falha |
| escrita (chat do clube, foto no mural) | **500** | 175 req/s · p95 20 ms · 0,02% | 1.000: 7,4% |
| upload (Storage) | **500** | 93 req/s · p95 17 ms · 0,04% | 1.000: 6,9% |
| rajada (todos abrindo o app em 10 s) | **3.000** | 596 req/s · p95 190 ms · 0,29% | não parou |

**O que o número prova:** o banco nunca foi o limite — pico de 22–42 conexões, 3–6 ativas de 100,
**zero espera por lock**, a consulta mais cara com média de 3–6 ms. As falhas são **timeouts sem
resposta** enquanto as respostas atendidas continuam rápidas: o teto é o número de **conexões
simultâneas pela rede do Docker no Windows** (~1.000 usuários virtuais com conexão persistente). A
rajada, que abre poucas conexões, chega a 600 req/s.

**O que ele não prova:** capacidade do Supabase de produção. É esta máquina. Os percentis contam só
as respostas recebidas (os timeouts entram como falha, não no p99).

**Medição honesta:** a 1ª rodada teve 3–6% de falha no degrau de 50 em três famílias — drenagem da
família anterior, que abortou com milhares de conexões abertas. Arquivada como CONTAMINADA e refeita
limpa: **0%**. E o teste de carga achou um defeito de isolamento (**78**) — o dataset sintético
tinha gente em dois clubes.

---

## 11. Red-team

`supabase/e2e/redteam-staging.mjs` — cada ataque pela API, com token de verdade, e a defesa medida
**no banco** (o estado não mudou), não na resposta. Rodada final com todas as migrations: **50
segurados, 0 furos**.

| área | ataques | resultado |
|---|---|---|
| código de entrada | revela só a identidade pública; pedir não abre o clube; revogado morre na hora (e gerar outro revoga o anterior — a UAT esbarrou nisso); revogado = inexistente; 10 erros travam a conta | segurou |
| convites | de outra pessoa, mesmo com o id; revogado; token de responsável reusado; responsável sem filho aprovado | segurou |
| pessoa em vários clubes | diretoria de A na aba B; na aba A contra membro de B; fila de B; instrutor de A e B mexendo em B pela aba A | segurou |
| suspenso | com o **mesmo token**, perde leitura e escrita na hora; reativado, volta | segurou |
| Storage | pasta de outra criança, id alheio, traversal, bucket público, prefixo inventado, **upsert sobre arquivo alheio**, listagem, download entre clubes, URL pública de bucket privado | segurou |
| evidência de criança | outra criança do clube, membro e liderança de outro clube, coordenador, atacante: nem URL assinada, nem download; a liderança **do clube dela** vê | segurou |
| APIs / RPC | nenhuma RPC devolve dado sem login; nenhuma tabela; liderança de B não troca senha de criança de A | **1 furo, fechado (76)** |
| headers | lista, JSON, maiúsculas, espaços, injeção, uuid nulo, escopo institucional forjado | segurou |
| rate limit | entrada (10/10 min), pedir ajuda (5/5 min), chat (30/5 min) | segurou |
| logout | refresh revogado | segurou |
| **login** | 40 senhas erradas em 2,4 s, **nenhuma recusa** | **não demonstrável localmente** — o CLI não repassa o limite ao Auth |

---

## 12. Go/No-Go

### Classificação dos achados que ficam abertos

**BLOCKER PILOTO**

- **P1 — O deploy desta branch sobre os dados reais do clube A nunca foi ensaiado.** São 79
  migrations; o pré-voo de produção cobre as dependências só das **1 a 28**
  (`PREFLIGHT-PRODUCAO.sql`); o upgrade foi simulado com dados **sintéticos** (117 asserts). Uma
  migration que aborte por causa de um dado real perde a janela sem estragar nada (F1, provado);
  uma que commite dano só volta por PITR (F2, provado no staging — nunca no projeto real).
- **P2 — O ambiente do piloto não foi conferido nos pontos que o staging local não prova:** restore e
  PITR **no próprio projeto** (o checklist de `AMBIENTE-DE-PRODUCAO.md` já exige, e está em aberto);
  o **limite de login** do Auth (no staging local não existe: 40 senhas erradas em 2,4 s); os
  **templates de e-mail em português** (no staging, a confirmação chega em inglês — e a criança que
  não confirma não entra).

**ALTO**

- **Classes só concluem com uma operação de plataforma por SQL** (publicar o conteúdo do período,
  por classe e por ano). Sem ela, nenhuma classe chega à investidura. Pesa só se o piloto oferecer
  Classes (o recurso nasce desligado e se chama "(piloto)").

**MÉDIO**

- Telas que listam pessoas pelo **espelho de `profiles`** (Mensalidades, Apontamentos, Atividades,
  ranking individual, contagem por unidade, colegas do chat e dos jogos): a criança de **dois clubes
  some da chamada e da unidade do segundo clube**; uma liderança de dois clubes vê, na lista de um,
  gente do outro. O servidor segura a escrita (nada cai no clube errado) — é a tela que mente.
- A fronteira de erro diz **"saiu uma versão nova"** para qualquer crash.
- O cadastro diz **"é só entrar"** sem avisar da confirmação de e-mail.
- **Especialidades** com catálogo só de teste ("[PILOTO/TESTE]").
- **Sem modo manutenção**: escrita durante a janela de deploy se perde num restore.
- **Capacidade de produção não medida** (a local é não-validante; para 2–3 clubes o risco é baixo).

**BAIXO**

- Access token vale até expirar (≤ 60 min) depois do logout; o vínculo continua checado a cada
  requisição. · Limite de tentativa de código é por conta, não por IP (código de 16 hex, que expira).
  · A responsável não abre a evidência de classe da filha (decisão de produto). · Tentativa de login
  falha fora do banco; erro de RPC sem o nome da RPC; sem retenção definida para a trilha. · Coordenador
  e distrito só por SQL de plataforma. · Rótulo "mín. 6"; plano Essencial duplicado na tela; lista de
  amigos sem filtro de aba; leitura direta de `experiences` com erro.

### Matriz

| critério | evidência | resultado | risco residual |
|---|---|---|---|
| 1. freeze | 7 migrations e 4 mudanças de front, cada uma com categoria e o achado que a motivou | ✅ | nenhuma mudança de conveniência entrou; backlog listado |
| 2. staging separado e reproduzível | `staging.mjs recriar/conferir`: token de um ambiente recusado no outro; gate de ambiente em 4 builds; CSP do front de staging só para o staging | ✅ | local: não substitui um staging de nuvem |
| 3. três organizações sintéticas | povoamento pelo produto: 10 identidades, 3 marcas/planos, 91 OK na versão final | ✅ | 2 operações sem caminho de produto (distrito, conteúdo do período) |
| 4. regra de sessão | `HARNESS.md`; UAT seguiu a regra | ✅ | — |
| 5. cinco gates | API: 1.114 verificações, 0 falhas, conferidas fora da RLS; SQL: gates de isolamento verdes no banco vivo e no upgrade | ✅ | 16 testes SQL ambientais no banco vivo (lidos um a um) |
| 6. UAT | 19 jornadas + 50 rotas por papel, conferidas no banco | ✅ depois de **2 blockers corrigidos** | upload de foto pela tela não exercitado; telas pelo espelho do perfil (MÉDIO) |
| 7. observabilidade | trilha nova (77), telemetria sem segredo no servidor (77, 79), teste 60; crash real da UAT registrado | ✅ | login falho fora do banco; crash mostrado como "versão nova" |
| 8. backup/restore | terceiro stack; manifesto idêntico; sistema volta pela API; RTO 53,4 s; RPO medido | ✅ **no staging** | **não feito no projeto real (P2)** |
| 9. drill de migration | F1 e F2 com recuperação em 17,2 s; upgrade simulado 117 asserts; runbook | ✅ **no staging** | **nunca sobre os dados reais (P1)** |
| 10. carga | rampa 50→3.000 em 4 famílias; banco nunca foi o limite | ⚠️ não-validante (decisão prévia) | capacidade de produção não medida |
| 11. red-team | 50 ataques segurados, 1 furo real fechado (76) | ✅ | limite de login não demonstrável localmente (P2) |

---

## A resposta

**O DesbravaClube está pronto para receber dois ou três clubes convidados em um piloto controlado?**

**Ainda não.** O produto está: os 1.114 cruzamentos de identidade × contexto × tabela não deixaram
nada vazar nem cair no clube errado, 50 ataques foram segurados, as 19 jornadas funcionam de ponta a
ponta — depois de corrigidos os dois defeitos que as impediam —, e backup, restore e recuperação de
migration foram provados com números. O que falta não é código. São os dois pontos que esta fase não
podia provar porque o staging é local, e que decidem se o primeiro clube convidado entra num sistema
seguro:

1. **Ensaiar o deploy sobre uma cópia real da produção** — backup do projeto → restore num ambiente
   descartável → as migrations aplicadas pelo passo 7 do `DEPLOY-E-RECUPERACAO.md` → verificação de
   upgrade e gates. Hoje o pré-voo só cobre as migrations 1–28, e o upgrade só foi visto com dados
   sintéticos.
2. **Conferir o projeto do piloto no que o local não mostra** — restore/PITR feito **no próprio
   projeto**; limite de login do Auth ativo; e-mail de confirmação em português.

Feito isso, e com três regras de operação para o piloto — **cada criança em um clube só**, **Classes
só com a publicação do conteúdo do ano feita pela plataforma** (ou fora do piloto), **Especialidades
fora do piloto** —, a evidência desta fase sustenta o sim.
