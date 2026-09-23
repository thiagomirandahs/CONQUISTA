# MULTICLUB-E2E-REPORT — Fase 8.4

**Pergunta da fase:** o DesbravaClube funciona como SaaS multi-clube completo?

**Resposta:** funciona **agora**. Não funcionava quando a fase começou, e os três defeitos que
impediam não apareciam em nenhum dos 53 arquivos de teste que existiam — porque todos eles
testavam pessoas com **um** clube, ou montavam o segundo vínculo com SQL direto.

| | |
|---|---|
| Ponto de partida | tag `checkpoint/piloto-primeiro-clube` (não movida) |
| Clubes | A = Tenant 001 legado · B = Águias do Vale · C = Sentinelas do Agreste |
| BLOCKERs encontrados | **4** |
| BLOCKERs corrigidos | **4** |
| Matriz reexecutada por inteiro depois das correções | sim |
| Gates | 56 arquivos de teste de banco (2.915 asserts), `npm run check` (416 testes) |

---

## 1. O que esta fase encontrou

Os quatro BLOCKERs têm a mesma raiz e vale enunciá-la antes da lista, porque ela é o aprendizado
que sobrevive à fase:

> O produto perguntava **"você tem vínculo neste clube?"** em todo lugar onde deveria perguntar
> **"este é o clube da requisição?"**.
>
> Para quem tem um clube, as duas perguntas têm sempre a mesma resposta. É por isso que 53 arquivos
> de teste, uma auditoria de 4 bloqueadores críticos, três fases de hardening e um go-live gate
> passaram por cima disso sem ver: **não havia como ver**. A diferença só existe na terceira
> pessoa que entra no sistema — a que está em mais de um clube — e não existia caminho de produto
> para criá-la.

### BLOCKER 1 — não havia como entrar num segundo clube

*Migration 61 · teste 54 (34 asserts)*

O produto é vendido como multi-clube. O banco modela certo, a RLS trata certo, o contexto por
requisição trata certo. Mas, varrendo o catálogo, só três funções inserem em
`organization_memberships`: `handle_new_user` (o primeiro vínculo, no cadastro), `onboarding_etapa`
(o vínculo do fundador no clube que ele criou) e um espelho interno. A tabela **não tem policy de
INSERT nenhuma**, e `vinculo_gerir` exige vínculo já existente: ela altera, nunca cria.

Ou seja: **nenhuma pessoa já cadastrada conseguia entrar num segundo clube.** O fundador de um
clube novo não conseguia trazer um instrutor que já tivesse conta em outro lugar.

O mais revelador é que a peça que faltava já estava meio construída: a etapa "equipe" do onboarding
**já grava** convites em `club_team_invites`, e a tabela **já tem** as colunas `aceito_por` e
`aceito_em`. A aceitação foi desenhada e nunca implementada — o convite era gravado e morria ali.
A migration 61 não inventa um mecanismo; liga a ponta solta de um que já existia.

Decisões travadas em teste: o convite é nominal (casado pelo e-mail de quem aceita, então um id
vazado não vira acesso); quem aceita entra ativo (a liderança já avalizou ao convidar); aceitar
convite **não promove** quem já é do clube — senão um convite mal endereçado viraria escalada de
privilégio; e o vínculo nasce no clube **do convite**, não no clube em uso de quem clica no link.

### BLOCKER 2 — toda leitura somava os clubes da pessoa

*Migration 62 · teste 55*

58 policies em 45 tabelas perguntavam `membro_ativo_no_clube(club_id)`. E o app não compensava:
varrendo `src/services/`, **zero** consultas filtram por `club_id` — todas confiam na RLS.

Medido com uma pessoa em A+B+C:

| consulta | aba | devolvia | devia devolver |
|---|---|---|---|
| `sum(pontos) where usuario_id = eu` | A | **70** (10 de A + 20 de B + 40 de C) | 10 |
| `config_clube where chave='pix'` | B | **`PIX-DO-CLUBE-A`** | o PIX de B |

O ranking, o extrato e a Home somavam três clubes. E o PIX é pior do que devolver o valor errado:
`src/services/unidades.js:7` lê com `.maybeSingle()`, que com dois clubes **erra** — a tela quebra.

Não é vazamento: a pessoa tem direito de ver os três clubes. É **contaminação de contexto** — a aba
diz "clube B" e o dado é A+B+C misturado. Num produto cujo contrato é "clube por requisição", isso
derruba a premissa inteira.

Duas superfícies escaparam da varredura de catálogo e merecem nota de método: `chat_conversas` e
`experience_stages` **não citam `club_id`** — elas delegam a `chat_conversas_visiveis()` e
`_pode_ver_experiencia()`. Uma busca por texto no catálogo encontra o que segue o padrão e silencia
justamente sobre quem não segue. Quem as pegou foi o teste comportamental, não a consulta.

### BLOCKER 3 — pedir um clube que não é seu virava "então fica nesse outro aqui"

*Migration 63 · teste 27 reescrito*

`clube_atual_id()` tinha, desde a migration 34, um fallback deliberado e comentado: header pedindo
um clube sem vínculo ativo — suspenso, encerrado, alheio ou inexistente — não dava erro; caía no
clube padrão. A justificativa escrita era boa: *"nunca cai em erro (não revela nada)"*.

Era inofensivo **enquanto nada dependia do retorno**. Depois da migration 62 ele decide tudo o que
a pessoa lê, e o fallback muda de natureza:

> A diretoria de B encerra meu vínculo. Minha aba de B continua aberta, com a marca de B na tela, e
> segue mandando `x-clube-atual: B` a cada clique. O servidor deixa de honrar B — e me devolve os
> dados do clube A. Eu leio A achando que leio B. Se eu clicar em algo que grava, grava em A.

A correção separa dois casos que estavam juntos: header **ausente** continua caindo no clube padrão
(primeira carga, cliente que ainda não escolheu); header **presente e não honrável** devolve
**nulo** — a requisição fica sem clube, as leituras vêm vazias e os RPCs recusam.

Continua sem revelar nada: clube inexistente, clube de outra pessoa e clube de onde eu saí devolvem
os três a mesma resposta. E a tela não fica presa: `meu_contexto()` lista os vínculos
independentemente do clube em uso, então o cliente reescolhe e a aba se conserta num round-trip.

### BLOCKER 4 — cinco operações aconteciam no clube do alvo, não no da requisição

*Migration 64 · teste 55 seção 9*

Encontrado **pelo red-team automático, e só por ele**: a pessoa dos três clubes, operando na aba de
B, chamou `unidade_excluir()` com o id de uma unidade de **C** — e recebeu `{"ok": true}`.

A causa é uma linha que parece certa:

```sql
select club_id into v_club from public.unidades where id = p_unidade_id;
if v_club is null or not public.pode_gerir_no_clube(v_club) then ...
```

Ela pergunta *"você é liderança naquele clube?"*. Ela **é** instrutora de C de verdade, então a
checagem passa, e a unidade de C é apagada por um clique dado dentro de B. A permissão está certa e
a operação está no lugar errado. E não é leitura: é `DELETE`.

Alcance medido no catálogo **antes** de corrigir: das 65 funções `security definer` que checam
`pode_gerir_no_clube`/`membro_ativo_no_clube` a partir de uma variável de clube, **63 já
consultavam `clube_atual_id()`**. O padrão certo é o do projeto; estas cinco é que escaparam dele:

| função | consequência de rodar no clube errado |
|---|---|
| `unidade_excluir` | apaga uma unidade e desvincula seus membros |
| `aprovar_entrega` | aprova e **lança ponto** — mexe no ranking alheio |
| `curriculum_achievement_revogar` | revoga uma conquista **portátil**, que vale em todos os clubes |
| `snapshot_revogar` | revoga snapshot, investidura e conquista de classe em cascata |
| `revogar_convite_responsavel` | derruba um convite de responsável de outro clube |

Nenhuma regra de autoridade legítima foi afrouxada: `club_id_origem` continua mandando em conquista
e snapshot — passou a ser exigido que a aba seja a daquele mesmo clube. E as duas recusas
("não existe" e "existe, mas não é sua") viraram uma só: a diferença entre elas já era um oráculo de
existência de conquista alheia.

---

## 2. Achados abaixo de BLOCKER

| # | Severidade | Achado | Situação |
|---|---|---|---|
| 5 | **ALTO** | A marca do clube sobrevivia ao **logout**. Depois de sair de B, a tela de login seguia com a sigla, o nome, o lema, as cores e o "desde" de B. No tablet do clube ou no celular de casa, a próxima pessoa abria o app e via a identidade do clube de quem usou antes. `esquecerMarcaSalva()` estava escrita em `lib/marca.js` desde sempre e **nunca era chamada por ninguém**. | **Corrigido.** Fechar e sair passaram a ser gestos distintos: quem fecha e volta continua vendo o próprio clube (é feature); quem sai zera. Teste novo em `Clube.test.jsx`. |
| 6 | **ALTO** | A CSP tinha o host do Supabase **cravado** no `vite.config.js` (`https://*.supabase.co`), e o `AMBIENTE-DE-PRODUCAO.md` registrava trocá-lo como **passo manual**. Passo manual em política de segurança é dívida: quem esquecer não vê erro no build, vê o app quebrando em produção. Além disso o curinga autoriza **qualquer** projeto Supabase do mundo, inclusive um que um atacante controle. | **Corrigido.** A origem sai do mesmo `VITE_SUPABASE_URL` que o app usa, pelo `loadEnv`. Efeito colateral que revelou o problema: sem isso, **nenhuma jornada de navegador contra o Supabase local conseguia sequer fazer login**. |
| 7 | **ALTO** | O conversor de websocket da CSP fazia um replace global de `https:`→`wss:`. Uma origem `http:` entrava **sem par de websocket** e o realtime ficava bloqueado, sem nenhum sinal no build. | **Corrigido**, com teste. |
| 8 | **MÉDIO** | A tela "Eu" promete, por escrito: *"Cada aba pode estar em um clube diferente."* E cumpre — até alguém **recarregar**. A preferência de clube é guardada por usuário em `localStorage`, que é compartilhado entre abas, então um F5 move a aba para o último clube escolhido em **qualquer** aba. | **Não corrigido** (ver §5). Não é contaminação: a aba vira o outro clube **por inteiro** — título, marca, dados. É o app quebrando uma promessa que ele mesmo faz na tela. |
| 9 | **MÉDIO** | O `<title>` estático do `index.html` é `Filhos da Conquista` — o nome do clube A. Toda pessoa de todo clube vê o nome de outro clube no instante entre abrir o app e o React montar. O `manifest` do PWA já tinha sido corrigido para `DesbravaClube`; o título não. | **Não corrigido** (ver §5). |
| 10 | **BAIXO** | `MARCA_LEGADA` (a marca usada antes da primeira resposta do servidor) é a do clube A. Está documentado no código como artefato temporário de rollout — *"pode sair quando o rollout terminar"*. | **Não corrigido** (ver §5). |

---

## 3. A matriz final por módulo

Percorrida na interface, com sessão real, priorizando B. Legenda: **A↔B** e **B↔C** = leitura e
escrita cruzadas + oráculo + clube errado; **multi** = a pessoa de dois/três clubes;
**abas** = duas abas simultâneas em clubes diferentes; **novo** = o clube nascido pelo onboarding.

| Módulo | A↔B | B↔C | multi-clube | duas abas | clube novo | isolamento | resultado |
|---|---|---|---|---|---|---|---|
| Onboarding / criação de clube | — | — | ok | — | **protagonista** | ok | ✅ |
| Contexto / troca de clube | ok | ok | ok | ok | ok | ok | ✅ |
| Identidade e marca | ok | ok | ok | ok | ok | corrigido (#5) | ✅ |
| Home / Início | ok | ok | corrigido (B2) | ok | ok | ok | ✅ |
| Ranking e pontos | ok | ok | **corrigido (B2)** | ok | ok | ok | ✅ |
| Unidades | ok | ok | ok | ok | ok | **corrigido (B4)** | ✅ |
| Usuários / vínculos | ok | ok | ok | ok | ok | ok | ✅ |
| Convite de equipe | ok | ok | **criado (B1)** | ok | ok | ok | ✅ |
| Aprovações / cadastros | ok | ok | ok | ok | ok | ok | ✅ |
| Apontamentos | ok | ok | ok | ok | ok | ok | ✅ |
| Atividades e entregas | ok | ok | ok | ok | ok | **corrigido (B4)** | ✅ |
| Mensalidades | ok | ok | corrigido (B2) | ok | ok | ok | ✅ |
| Mural de fotos | ok | ok | corrigido (B2) | ok | ok | ok | ✅ |
| Agenda / eventos | ok | ok | corrigido (B2) | ok | ok | ok | ✅ |
| Chat | ok | ok | **corrigido (B2)** | ok | ok | ok | ✅ |
| Moderação de chat | ok | ok | corrigido (B2) | ok | ok | ok | ✅ |
| Avisos / notificações | ok | ok | corrigido (B2) | ok | ok | ok | ✅ |
| Leilão | ok | ok | ok | ok | ok | ok | ✅ |
| Desafios e duelos | ok | ok | corrigido (B2) | ok | ok | ok | ✅ |
| Chefão | ok | ok | ok | ok | ok | ok | ✅ |
| Jogos e trilha | ok | ok | corrigido (B2) | ok | ok | ok | ✅ |
| Bichinho / pets | ok | ok | ok | ok | ok | ok | ✅ |
| Missões e devocional | ok | ok | corrigido (B2) | ok | ok | ok | ✅ |
| Bíblia | ok | ok | ok | ok | ok | ok | ✅ |
| Classes | ok | ok | ok | ok | desligado em B | ok | ✅ |
| Especialidades | ok | ok | ok | ok | ok | ok | ✅ |
| Experiências | ok | ok | **corrigido (B2)** | ok | ok | ok | ✅ |
| Conquistas curriculares (portáteis) | ok | ok | ok | ok | ok | **corrigido (B4)** | ✅ |
| Snapshot / investidura | ok | ok | ok | ok | ok | **corrigido (B4)** | ✅ |
| Documento e verificação pública | global | global | ok | ok | ok | por contrato | ✅ |
| Portal institucional | ok | ok | ok | ok | ok | ok | ✅ |
| Temporada / acampamento | ok | ok | ok | ok | ok | ok | ✅ |
| Radar de faltas | ok | ok | ok | ok | ok | ok | ✅ |
| Plano e recursos (billing) | ok | ok | ok | ok | ok | comercial | ✅ |
| Storage / imagens | ok | ok | ok | ok | ok | ok | ✅ |

`Classes` aparece como *desligado em B* porque a fundadora de B escolheu 4 recursos no onboarding
(chat, experiências, leilão, mensalidades) e classes não estava entre eles. A tela recusa com
"recurso não habilitado" enquanto o plano dela inclui o recurso — **e isso está certo**: o plano diz
o que ela *pode* ligar, a flag do clube diz o que ela *ligou*. Conferido no banco.

---

## 4. Cross-tenant legítimo — o que **deve** atravessar

Isolamento não pode virar duplicação artificial. Cada exceção tem contrato e teste
(`55_matriz_multiclube.sql`, seção 7):

| o que atravessa | por quê | o contrato |
|---|---|---|
| Identidade (`profiles`) | uma pessoa, um cadastro. Trocar de clube não cria outra pessoa. | só os campos de identidade; nada operacional (papel, unidade e status são do **vínculo**, travado no teste 29) |
| Catálogo curricular oficial | classes e especialidades são da instituição, não do clube | leitura para qualquer pessoa logada; escrita só pela plataforma |
| `curriculum_achievements` | a conquista é **da pessoa** e viaja com ela | quem emitiu (`club_id_origem`) é quem revoga — **e operando naquele clube** (BLOCKER 4) |
| Verificação pública de documento | um pastor de fora precisa conferir um certificado | responde por token, sem login, e **não** distingue token inexistente de token de outro clube |
| Hierarquia institucional | distrito/região/campo têm autoridade real sobre clubes | header `x-escopo-atual` próprio, com as mesmas garantias do clube |
| Assinatura comercial | o contato paga por vários clubes e precisa ver todos | `subscription_clubs`, `club_provisioning_status` e `support_grants` ficaram **fora** do escopo por aba, nomeados na migration 62 |
| Convite de equipe | a pessoa precisa ver um convite de um clube em que **ainda não está** | nominal por e-mail; id vazado não vira acesso |

---

## 5. O que fica em aberto

Três itens não foram corrigidos, e nenhum deles é de correção — são de **produto**:

- **#8, recarregar move a aba de clube.** O conserto seria guardar a preferência em
  `sessionStorage` (por aba) em vez de `localStorage` (por usuário). É uma troca com custo: quem
  usa uma aba só passaria a reescolher o clube a cada abertura. A decisão é de quem desenha o
  produto, não minha. O comportamento atual **não mistura clubes** — só contraria a frase que a
  própria tela exibe.
- **#9 e #10, a marca padrão é a do clube A.** `Filhos da Conquista` no `<title>` e em
  `MARCA_LEGADA`. O nome que deveria aparecer é `DesbravaClube` — foi o que se fez com o manifest do
  PWA. Não mexi porque trocar a identidade da tela de entrada é decisão de marca, e o código
  documenta o atual como transitório do rollout. **Para o piloto com o primeiro cliente pagante,
  recomendo trocar antes de convidar os membros de B**: eles vão abrir o link e ler o nome de outro
  clube.

Nenhum dos três impede go-live. Os três deveriam entrar na lista da próxima fase.

---

## 6. Método — o que esta fase ensinou sobre os testes anteriores

Três lições, e as três são sobre **como um relatório verde consegue mentir**:

**1. Um teste de regressão prova que o comportamento não mudou. Nunca provou que ele estava certo.**

O caso está em `45_chat_matriz_de_acesso.sql`. Na fase 8.1, ao otimizar o chat, escrevi um assert
com este comentário:

> *"Se a otimização passasse a depender de `clube_atual_id()`, a pessoa de dois clubes perderia
> metade das conversas — este assert pega isso."*

Ele pegou. Exatamente a mudança que existia para pegar. Só que a mudança era a **correção**, e o que
ele protegia era o **defeito**. A fase 8.1 pedia que a matriz antes/depois fosse idêntica, e foi.
Ninguém perguntou se a matriz de origem estava certa.

**2. Varredura de catálogo por texto encontra quem segue o padrão e silencia sobre quem não segue.**

As 58 policies saíram de uma consulta a `pg_policies`. Ela achou 58 e deixou duas de fora —
`chat_conversas` e `experience_stages` — porque elas delegam a uma função e não escrevem `club_id`.
Quem as pegou foi o teste comportamental.

**3. Uma sonda que não desfaz o que chamou mede um banco que ela mesma sujou.**

O red-team automático chama **toda** função pública que aceita `uuid`, e boa parte é `VOLATILE`:
elas escrevem. Com a sonda ingênua, a varredura de A deixava estado para trás e a de C media outro
banco — as duas davam respostas diferentes **só por causa da ordem**. E o pool de alvos só olhava a
coluna `club_id`: `curriculum_achievements` e `class_completion_snapshots` usam `club_id_origem`,
então **exatamente os registros que viajam entre clubes nunca tinham sido sondados** — e o relatório
diria zero divergências com a mesma cara de "está tudo certo".

Isto se soma à lição da 8.2 (o laço `1..pronargs` sobre um `oidvector` 0-based, que cobria 16% da
superfície). O padrão se repete: **a guarda existia, parecia funcionar, e não cobria o que dizia
cobrir.** Por isso a varredura agora carrega um assert de **cobertura** ao lado do assert de
resultado — sem ele, "zero divergências" e "zero sondagens" são indistinguíveis.

---

## 7. Como isto foi verificado

**Os três clubes, montados pelo produto** (`supabase/e2e/montar-tres-clubes.mjs`) — nenhum INSERT
manual em conta, assinatura, clube, marca, diretoria, unidades, recursos ou vínculo:

```
OK  o fundador de B entra no sistema
OK  ao voltar, o onboarding retoma de onde parou      (interrompido na etapa 3 de 9)
OK  o onboarding chega ao fim                          (com a etapa "clube" repetida de propósito)
OK  B tem exatamente UMA conta comercial, apesar da repetição de etapa
OK  ...UMA assinatura · ...e UM clube · ...e uma única sessão de onboarding
OK  B tem 8 unidades criadas pela diretoria · C tem 2
OK  o mesmo NOME de unidade existe em B e C, com ids distintos
OK  a diretoria de B convida o fundador de C · ele aceita operando na aba de C
OK  agora ele tem vínculo nos DOIS clubes
```

**Jornada de navegador**, sessão real contra o stack local, ~25 módulos, priorizando B. A prova de
duas abas: aba 1 em `Sentinelas do Agreste` mostrando **2 unidades** (Falcão, Tatus) enquanto a aba
2, na mesma conta, mostra `Águias do Vale` com **8**. "Falcão" existe nos dois, com ids diferentes —
a colisão por nome não confunde ninguém. O papel acompanha a aba: *"Instrutor em Águias do Vale"* de
um lado, *"Diretoria em Sentinelas do Agreste"* do outro, ao mesmo tempo.

**Gates:**

| | |
|---|---|
| `bash supabase/tests/run-tests.sh` | **56 arquivos, 2.915 asserts, 0 falhas** (replay do zero: 144 migrations + seed) |
| `npm run check` | lint + **38 arquivos, 416 testes** de frontend + build |
| teste 55, a matriz | 84 asserts |
| teste 54, o convite | 34 asserts |

---

## 8. Conclusão

**A 8.4 termina verde.** Os quatro BLOCKERs foram corrigidos, a matriz inteira foi reexecutada
depois das correções (não só o teste que falhou) e todos os gates passam.

O produto **não era** um SaaS multi-clube quando a fase começou — era um SaaS que funcionava
perfeitamente desde que ninguém estivesse em dois clubes, e que não tinha como colocar ninguém em
dois clubes. Os dois fatos se sustentavam: a ausência do caminho escondia os defeitos que o caminho
teria revelado.

Fica registrado o que isso significa para o piloto: o primeiro cliente pagante **pode** ser um clube
que compartilha pessoas com outro. Antes desta fase, não podia — e ninguém saberia dizer por quê.
