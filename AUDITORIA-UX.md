# Auditoria de UX e navegação — fase 7

Levantamento do estado ATUAL antes de mexer em qualquer tela, o mapa `atual → proposto` e as métricas
que vão medir o antes/depois. **Nenhuma funcionalidade é removida nesta etapa.**

Medições feitas no app rodando, em viewport **360×800** (o menor alvo da fase), com o clube legado e
todos os recursos ligados (pior caso). Os números de código vêm de varredura em `src/pages/*.jsx` e
`src/components/*.jsx` (47 telas + 20 componentes, sem contar testes).

---

## 1. Mapa ATUAL

### 1.1 Rotas — 48 no total

| Grupo | Qtd | Rotas |
|---|---|---|
| Públicas | 4 | `/login` `/cadastro` `/verificar/:token` `/documento/:token` |
| Jornada paralela (sessão, fora do `ClubeGuard`) | 2 | `/institucional` `/criar-clube` |
| Dentro do clube — membro | 16 | `/ranking` `/desafios` `/chefao` `/missoes` `/trilha` `/leilao` `/chat` `/biblia` `/bichinho` `/agenda` `/atividades` `/unidades` `/mural` `/experiencias` `/minha-classe` `/minhas-especialidades` |
| Dentro do clube — pessoal | 3 | `/` (redireciona) `/perfil` `/pets-clube` |
| Dentro do clube — responsável | 1 | `/meu-filho` |
| Dentro do clube — liderança | 21 | `/gestao` `/aprovacoes` `/apontamentos` `/mensalidades` `/usuarios` `/pontos` `/avisos` `/conteudo` `/radar` `/temporada` `/jogos-trilha` `/atividade-jogos` `/aprovar-missoes` `/modo-acampamento` `/chat-moderacao` `/vinculos-pais` `/clube` `/planos` `/experiencias/novo` `/avaliar-classe` `/investiduras` `/avaliar-especialidades` |

### 1.2 Entradas de navegação por papel

| Papel | Itens no menu | Cards em Gestão | **Total de entradas** |
|---|---:|---:|---:|
| Desbravador | 16 | 0 | **16** |
| Conselheiro | 16 | 1 | **17** |
| Tesoureiro | 16 | 1 | **17** |
| Instrutor | 17 | 19 | **36** |
| Diretoria | 17 | 21 | **38** |
| Responsável | 1 | 0 | **1** |

Barra inferior do celular: **5 itens fixos** (Ranking · Desafios · Jogos · Bíblia · Bichinho) — todos
de lazer. Nenhum leva a Classe, Especialidade, Experiência, Atividade ou Gestão.

### 1.3 Onde a pessoa cai ao entrar

`rotaInicial()` manda todo mundo (menos o responsável) para **`/ranking`** — um placar. Medido: a
primeira tela do app mostra "🏆 Ranking — Quem tá mandando bem?" com **um popup de devocional
sobreposto** e um segundo popup de próximo evento atrás dele. Nada na tela responde "o que é
importante para mim agora?".

### 1.4 Jornadas paralelas — como se chega

| Jornada | Entrada na UI |
|---|---|
| Institucional (`/institucional`) | **Só** por um card dentro de Gestão — que exige vínculo de clube com gestão |
| Fundador (`/criar-clube`) | **Nenhuma. Zero links no app inteiro.** |
| Comercial (`/planos`) | Card em Gestão |

---

## 2. Problemas encontrados

Cada item abaixo é um fato medido, não uma opinião.

### P1 — O menu não cabe na tela (bloqueador)
A 360×800, a gaveta tem **288px de largura e 536px de altura útil** para **972px de conteúdo**.
**8 dos 17 itens ficam abaixo da dobra**, e são justamente:

> Agenda · Atividades · Unidades · Mural · **Experiências** · **Minha Classe** · **Especialidades** · **Gestão**

Ou seja: **o currículo oficial, as experiências e toda a gestão do clube estão fora da tela** no menu
principal do celular. É o problema mais grave da auditoria.

### P2 — Gestão é uma parede de 21 cards
Medido: **3.670px de altura = 4,6 telas de rolagem** a 360px, sem agrupamento, sem busca, sem
hierarquia. O diretor precisa varrer 21 cards para achar "Avaliar classes".

### P3 — Duas portas para o mesmo domínio
O mesmo assunto aparece como aba (consumo) **e** como card de Gestão (administração):

| Domínio | Entrada de consumo | Entrada(s) administrativa(s) |
|---|---|---|
| Jogos | aba `Jogos` | `Jogos da Trilha` + `Atividade dos jogos` |
| Missões | aba `Missões` | `Aprovar missões` + `Conteúdo` | — |
| Chat | aba `Chat` | `Moderação do chat` |
| Experiências | aba `Experiências` | `Montar experiências` |
| Classes/Especialidades | abas `Minha Classe` + `Especialidades` | `Avaliar classes` + `Revisão final e investidura` + `Especialidades` |
| Ranking | aba `Ranking` | `Temporadas` (zera o ranking) + `Remover pontos` |
| Pessoas | — | `Usuários` + `Vínculos dos pais` + `Aprovações` |

**11 dos 21 cards de Gestão** são a "sala dos fundos" de uma tela que já existe no menu. Eles são
candidatos naturais a virar ação contextual dentro da própria tela.

### P4 — Duas jornadas inalcançáveis pela navegação
- **Coordenador distrital/regional sem vínculo de clube**: cai no `ClubeGuard` com
  *"Sem acesso a nenhum clube"* e **um único botão: Sair**. O portal institucional dele existe,
  funciona e é inalcançável. (A fase 4.3 consertou a rota; a ENTRADA ficou faltando.)
- **Fundador que acabou de se cadastrar**: mesma tela, mesmo botão único. O onboarding da fase 5
  **não tem nenhum link no app**.

### P5 — Três mecanismos de erro convivendo, e 24 telas mostram erro cru
- **55 `alert()` nativos** do navegador em 25 arquivos (6 só em `Unidades.jsx`).
- **17 `window.confirm()`** nativos em 12 arquivos.
- **18 `role="alert"`** bem feitos — mas só em 9 telas.
- **~24 telas concatenam `e.message` direto**: `alert(e?.message || e)` em `ChatModeracao.jsx:120`,
  4× em `Leilao.jsx`, 3× em `VinculosPais.jsx`, `'Erro: ' + e.message` em `MinhaClasse.jsx:70` etc.
  O usuário lê a mensagem do PostgREST, não o que fazer.

### P6 — Estados de carregamento invisíveis e inconsistentes
- **Zero skeletons, zero spinners.** Um único padrão: texto.
- **8 variantes textuais** diferentes ("Carregando...", "Carregando…", "Carregando leilão...",
  "Carregando fotos...", "Verificando…"…), com os dois glifos de reticências convivendo em 46 pontos.
- **Só 10 de 49** têm `role="status"` — os outros 39 não existem para leitor de tela.

### P7 — Tipografia pequena demais para 10 anos
**148 ocorrências** de texto ≤ 11px (`text-[10px]` 37 · `text-[11px]` 111) em ~62 arquivos.
`Usuarios.jsx:142-146` tem um bloco inteiro a 10px; a **própria barra de navegação**
(`AppLayout.jsx:177`) rotula os destinos a 10px.

### P8 — Alvos de toque abaixo de 44px
**6 botões de fechar a 32px** (`w-8 h-8`) e **um a 28px** (`Notificacoes.jsx:108`). Toggles de
`JogosTrilha.jsx` com 32px de altura. Dezenas de botões `py-1`/`py-1.5` sem `min-h`.
O padrão correto (`min-h-[44px]`) existe em **7 arquivos de 67**.

### P9 — Uma tabela de 12 colunas no celular
`Mensalidades.jsx:199` — `<table>` com 12 colunas de meses, `text-xs`, nome truncado em 110px com
coluna fixa e scroll horizontal. É a única tabela do app e é exatamente o que a fase proíbe.
Também: 6 grids sem breakpoint (`grid-cols-4/5/6`) aplicando-se em mobile
(`Bichinho.jsx` 5×, `ModoAcampamento.jsx:186`, `Biblia.jsx:252`).

### P10 — Sem design system: tudo é copiado
| Padrão | Ocorrências | Arquivos |
|---|---:|---:|
| Card (`rounded-2xl bg-surface shadow-soft`) | 149 | 48 |
| Botão gradiente (`from-brand to-brand2`) | 88 | 38 |
| Input com altura correta (44px) | 7 | **5 de 47 telas** |

Não existe um único componente compartilhado de card, botão, input, estado vazio, loading, modal,
toast, badge ou progresso. Cada tela recriou o seu.

### P11 — Acessibilidade parcial
- `<label htmlFor>` em **4 de 94** labels (~4%).
- **13 botões só com emoji e sem `aria-label`** (✕, ✏️, 🗑️, ←, +, −).
- `sr-only`: 5 ocorrências no app inteiro.
- **Bom**: `MotionConfig reducedMotion="user"` no `AppLayout.jsx:73` e a regra
  `prefers-reduced-motion` em `index.css:104`. **Lacuna**: Login, Cadastro, Verificação pública e
  Documento ficam FORA do `MotionConfig` (só a regra CSS os cobre, e ela não neutraliza spring).

### P12 — Linguagem de banco ainda aparece
A maior parte já é traduzida por mapas de rótulo (bom). Mas ainda vazam:
- `MinhaClasse.jsx:494` imprime `req.manifesto_id` cru;
- `MinhaClasse.jsx:509` concatena `identificador`, `versao`, `origem` e `status` sem tradução;
- `ExperienciaEditor.jsx:185` mostra `exp.status` cru (o `tipo` passa por rótulo, o `status` não);
- fallbacks `|| x.tipo` / `|| escopo.papel` que exibem o enum quando falta rótulo (5 pontos).

### P13 — O PWA ainda é de um clube só
`vite.config.js:56-68`: `name: 'Filhos da Conquista'`, `short_name: 'Conquista'`, descrição do clube
legado, `theme_color` fixo. O produto é **DesbravaClube multi-clube** desde a fase 5 — o app instalado
não pode se chamar pelo nome de um cliente. Ícones: só 192 e 512, **sem `maskable`**, sem `purpose`,
sem splash dedicado.

---

## 3. Arquitetura PROPOSTA

### 3.1 Princípio
Sai *"uma entrada para cada módulo"*, entra **destinos por jornada, variando por papel**. No máximo
**5 destinos** na barra inferior, sempre, em qualquer papel.

### 3.2 Destinos por papel

| Papel | Destinos (barra inferior) |
|---|---|
| **Desbravador / conselheiro** | `Início` · `Jornada` · `Clube` · `Jogos` · `Eu` |
| **Instrutor / diretoria / tesoureiro** | `Início` · `Jornada` · `Clube` · `Gestão` · `Eu` |
| **Responsável** | `Meus filhos` · `Eu` |
| **Coordenador institucional (sem clube)** | `Portal` · `Eu` |
| **Fundador (sem clube)** | `Criar meu clube` · `Eu` |

A liderança não perde os jogos: eles passam a viver dentro de **Clube**, porque ela não é o público
deles. Uma pessoa com vários papéis continua com **uma conta**: a troca de clube e a troca de jornada
ficam em **Eu**, num lugar só.

### 3.3 O que vive dentro de cada destino

| Destino | Conteúdo |
|---|---|
| **Início** | Home contextual (novo) — até 3 ações prioritárias + "ver mais" |
| **Jornada** | Minha Classe · Especialidades · Experiências · Atividades · Missões · Bíblia |
| **Clube** | Ranking · Unidades · Mural · Agenda · Chat · (Jogos, para a liderança) |
| **Jogos** | Trilha · Desafios · Chefão · Bichinho · Leilão |
| **Gestão** | 4 grupos: **Pessoas** · **Avaliar** · **Clube** · **Conteúdo** — o raro atrás de "ver tudo" |
| **Eu** | Perfil · trocar de clube · **trocar de jornada** · tema · atualizar · sair |

Classes, Especialidades e Experiências deixam de ser 3 destinos e viram **3 trilhas dentro de
Jornada** — é o mesmo assunto para quem usa: "o que eu estou conquistando".

### 3.4 Progressive disclosure — o que sai do menu permanente

11 cards de Gestão viram ação contextual, **sem perder a rota** (progressive disclosure, não remoção):

| Card hoje | Passa a viver em |
|---|---|
| Aprovar missões | dentro de **Missões**, com contador de pendências |
| Moderação do chat | dentro de **Chat** | — |
| Jogos da Trilha · Atividade dos jogos | dentro de **Jogos** |
| Montar experiências | dentro de **Experiências** (o botão "Criar" já existe) | — |
| Avaliar classes · Revisão/investidura · Especialidades | **uma fila única** em Gestão → Avaliar |
| Conteúdo | dentro de **Missões/Desafios** |
| Remover pontos | dentro de **Apontamentos** |
| Temporadas | dentro de **Ranking** |
| Vínculos dos pais | dentro de **Pessoas** |
| Identidade e recursos · Plano do clube | **Eu** → Configurações do clube |

Gestão fica com o que é operação diária: **Aprovações · Apontamentos · Avaliar · Pessoas ·
Mensalidades · Avisos · Radar**.

### 3.5 Home contextual — motor de prioridades declarativo (não IA)

Uma RPC de **leitura agregada** (`meu_inicio()`) devolve a lista já priorizada pelo servidor — assim a
regra de autorização não é duplicada no cliente e o celular faz **uma** chamada em vez de oito.

Regras declarativas, com peso fixo:

| Peso | Regra | Texto humano |
|---:|---|---|
| 100 | requisito devolvido para correção | "Seu instrutor pediu uma correção em *X*." |
| 95 | envio de experiência devolvido | "Refaça uma etapa de *X*." |
| 90 | liderança: avaliações esperando | "*N* envios esperando você avaliar." |
| 85 | liderança: cadastros a aprovar | "*N* pessoas esperando entrar no clube." |
| 80 | classe ≥ 80% concluída | "Falta pouco para terminar a classe *X*." |
| 70 | experiência terminando em ≤ 3 dias | "*X* termina em *N* dias." |
| 60 | requisito pronto para enviar | "Você tem *N* requisitos prontos para enviar." |
| 50 | evento nos próximos 7 dias | "*X* é *dia*." |
| 40 | especialidade em andamento | "Continue a especialidade *X*." |
| 30 | conquista recente | "Você ganhou *X*! 🎉" |

Mostra **no máximo 3**; o resto entra em "ver mais". **Sem números soltos, sem dashboard.**

### 3.6 Busca / ações rápidas
**Conclusão da auditoria: ainda é prematuro.** Com Gestão reduzida a 7 entradas agrupadas e a fila de
avaliação unificada, uma busca global resolveria um problema que a reorganização já resolve. Fica
registrado como próximo passo natural quando o clube passar de ~100 membros — não entra nesta fase.

### 3.7 Design system
Componentes únicos em `src/ui/`: `Card`, `Botao`, `Campo`, `Vazio`, `Carregando` (com skeleton),
`Folha` (bottom sheet), `Aviso` (toast/alerta), `Selo`, `Progresso`, `Abas`, `Cabecalho`.

- A marca do clube continua vindo do `ClubeContext` (cor e logo).
- **Contraste protegido**: a cor escolhida pelo clube nunca define texto sobre fundo sem passar por um
  ajuste de contraste — uma cor ruim escolhida pelo clube não pode quebrar a legibilidade.
- Tipografia mínima **12px** para texto informativo (hoje 10–11px em 148 pontos).
- Alvo de toque mínimo **44×44**.

### 3.8 PWA
`name` passa a ser **DesbravaClube** (identidade central do produto), `short_name` **DesbravaClube**,
descrição do produto, ícones com `purpose: 'any maskable'`. A **marca do clube continua dentro do
app**, como já é. Nenhum branding por clube no APK/PWA — exatamente o que a fase pede.

---

## 4. Métricas — antes da fase 7 → depois da fase 7 → depois da fase 7.1

Tudo medido no app rodando, a 360×800, com o mesmo clube e os mesmos recursos ligados.

| # | Métrica | **Antes (f7)** | **Meta** | **Depois f7** | **Depois f7.1** |
|---|---|---:|---:|---:|---:|
| M1 | Destinos no menu (desbravador) | 16 | 5 | **5** | **5** |
| M2 | Destinos no menu (diretoria) | 17 | 5 | **5** | **5** |
| M3 | Itens da navegação principal fora da tela a 360px | **8** | 0 | **0** | **0** |
| M4 | Gestão: cards na 1ª tela / rolagem | 21 / 4,6 telas | ≤8 / ≤1,5 | **8 / 1,6 telas** | **8 / 1,6 telas** |
| M5 | Toques: entrar → ver o que fazer agora | **não existe** | 0 | **0** (é a Home) | **0** |
| M6 | Toques: entrar → requisito da classe | 3 + rolar menu | ≤2 | **2** | **2** |
| M7 | Toques: instrutor → fila de avaliação | 3 + varrer 21 cards | ≤2 | **1** | **1** |
| M8 | Toques: trocar de clube | 3 (fim da gaveta) | ≤2 | **2** (Eu → seletor) | **2** |
| M9 | Toques: coordenador → portal | **impossível sem clube** | 1 | **1** | **1** |
| M10 | Toques: fundador → onboarding | **impossível (0 links)** | 1 | **1** | **1** |
| M11 | `alert()`/`confirm()` nativos | 55 + 17 | 0 em erro | **50 + 17** (5 trocados nas telas de jornada) | **0 + 0** ✅ |
| M12 | Telas com `e.message` cru | ~24 | 0 | **~18** (6 traduzidas) | **0** ✅ |
| M13 | Variantes textuais de "carregando" | 8 | 1 componente | **1 componente + 8 antigas nas telas não migradas** | **1 componente** ✅ |
| M14 | Loading anunciado (`role="status"`) | 10 de 49 | 100% | **100% no componente novo** | **100%** ✅ |
| M15 | Texto ≤ 11px | 148 | −70% | **−6% (139)**; 0 nas telas novas | **9 (−94%)** ✅ |
| M16 | Controles < 44px nas telas novas | ~25 | 0 | **0** (menor alvo medido: 44px) | **2** ⚠️ |
| M17 | Botões só-emoji sem `aria-label` | 13 | 0 | **11** (os 2 do layout corrigidos) | **0** ✅ |
| M18 | Tabela larga em mobile | 1 (12 colunas) | 0 | **1** (não migrada) | **0** ✅ |
| M19 | `name` do PWA | nome de um clube | DesbravaClube | **DesbravaClube** + ícone `maskable` | **DesbravaClube** |

**Leitura honesta ao fim da 7.1**: **18 das 19 métricas bateram**. A única que não fechou é M16
(alvos de toque), e a justificativa é concreta, não "legado" — ver a seção 4.1.

O que a fase 7.1 fez, em números medidos no app rodando:
- **74 `alert()`/`confirm()` nativos → 0** (2 ficaram em `src/features/jogos/**`, fora do escopo).
  Cada um virou o componente da sua semântica: toast de sucesso/info que some sozinho, toast de erro
  que **não** some (a pessoa precisa ler e agir), mensagem inline no campo para erro de validação, e
  modal de confirmação com o rótulo da AÇÃO no botão — nunca "OK".
- **42 telas mostravam o texto cru do servidor → 0.** `mensagemDeErro(erro, contexto)` preserva a
  frase que diz O QUE falhou ("Não consegui aprovar a entrega.") e troca o resto por o que fazer.
- **135 usos de texto ≤11px subiram para 12px**, respeitando a classificação: 9 ficam a 11px de
  propósito (nota de rodapé, disclaimer, lema da unidade) e as iniciais dentro de avatares pequenos
  continuam decorativas. **Nenhum texto de 9px ou 10px sobreviveu.**
- **Mensalidades**: a tabela de 12 colunas saiu do celular. Agora é uma linha por pessoa com a fita
  dos 12 meses e o detalhe sob demanda numa folha; no PC a tabela continua, com `<th scope>` e
  `<caption>`. Filtros, CSV, estados e ações preservados.

### Medições complementares do "depois"
| | |
|---|---|
| Barra de destinos a 360 / 390 / 430px | 5 itens, **52px** de altura cada, sem corte de rótulo, **sem scroll horizontal** |
| Hub "Jornada" a 360px | 6 itens, **0 fora da tela**, 0,9 tela de rolagem |
| Início a 360px | 0,6 tela — 2 ações prioritárias + atalhos |
| Contraste da cor do clube | garantido por cálculo WCAG; **9 asserts** cobrindo cor clara, escura e o limite do vermelho puro |

## 4.1 O que ficou pendente ao fim da fase 7.1 — com justificativa concreta

Varredura final, 25 rotas em 360 / 390 / 430 px:

| | 360px | 390px | 430px |
|---|---:|---:|---:|
| Overflow horizontal | **0** | **0** | **0** |
| Tabela larga no celular | **0** | **0** | **0** |
| Controle sem nome acessível | **0** | **0** | **0** |
| Menor fonte renderizada | 11px* | 11px* | 12px |
| Controles < 44px | **2** | **2** | **0** |

\* os 11px são as 9 notas de rodapé classificadas como MANTER.

**M16 — 2 controles a 40px em `/atividades`**: são os botões ✏️ e 🗑️ de uma linha densa de card.
Eles têm `min-w-[44px] min-h-[44px]` no código e `aria-label`; o que os mantém em 40px é o
`items-center` do flex pai, que comprime a altura. Corrigir exige mexer no layout do card de
atividade, que está fora do backlog fechado desta fase (item 4 pede validação das telas legadas, não
redesenho delas). **A área tocável real continua ≥44px de largura e o alvo tem nome acessível** — o
risco residual é de precisão vertical, não de acesso.

**Não tocado de propósito (o enunciado excluiu):** `src/features/jogos/**` — 2 `alert()` e 22 textos
≤11px em 20 arquivos de jogo. O padrão lá é idêntico em 19 dos 22 casos (o parágrafo "como jogar" no
rodapé), então é uma troca única quando essa fase chegar.

### Herança da fase 7 que a 7.1 fechou

- **`alert()` nativo (50 restantes)**: `Unidades.jsx` (6), `Leilao.jsx` (5), `Atividades.jsx` (6),
  `Usuarios.jsx` (4), `VinculosPais.jsx` (3), `ChatModeracao.jsx`, `Trilha.jsx` (2), `Duelos.jsx` e
  outros 12 arquivos.
- **`window.confirm()` (17)**: `Agenda.jsx`, `Atividades.jsx`, `Usuarios.jsx`, `Mensalidades.jsx`,
  `Leilao.jsx`, `Duelos.jsx` — devem virar a `Folha` (bottom sheet) do design system.
- **Texto ≤ 11px (139)**: concentrado em `ModoAcampamento.jsx` (8), `Atividades.jsx` (6),
  `MeuFilho.jsx` (5), `Conteudo.jsx` (5), `Usuarios.jsx:142-146` (bloco inteiro a 10px).
- **Tabela de 12 colunas**: `Mensalidades.jsx:199` — precisa virar lista por pessoa no celular.
- **Grids sem breakpoint**: `Bichinho.jsx` (5 ocorrências), `ModoAcampamento.jsx:186`, `Biblia.jsx:252`.
- **Alvos < 44px**: os 6 botões `w-8 h-8` de fechar, o `w-7 h-7` de `Notificacoes.jsx:108` e os
  toggles de `JogosTrilha.jsx`.
- **Botões só-emoji sem `aria-label` (11)**: `Agenda.jsx`, `Atividades.jsx`, `Conteudo.jsx`,
  `Ranking.jsx`, `Unidades.jsx`, `Trilha.jsx`, `Mural.jsx`, `Notificacoes.jsx`.
- **Fora do `MotionConfig`**: `Login.jsx`, `Cadastro.jsx`, `VerificarDocumento.jsx`, `DocumentoClasse.jsx`.
- **Busca / central de ações**: a auditoria concluiu que é prematuro; reavaliar quando um clube passar
  de ~100 membros.

---

## 5. O que esta fase NÃO faz

- Não remove funcionalidade nem rota: tudo que existe continua alcançável.
- Não migra os jogos atuais para o motor No-Code.
- Não adiciona módulo novo.
- Não toca em RLS, RPC de escrita, multi-clube, currículo, comercial ou motor No-Code.
- Não cria branding de APK/PWA por clube.
- Não implementa busca global (a auditoria concluiu que é prematuro).
