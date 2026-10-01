# PADRONIZAÇÃO VISUAL / MOBILE — FASE 9 (01/10/2026)

Escopo: padronizar sem redesenhar. Só local (sem push/deploy/tag/migration). Logo, `MARCA_PRODUTO` e testes de
contrato de identidade intocados. Visual **NÃO TESTADO no navegador** (ver "Depende de aparelho real").

Ferramenta nova (versionada): `node scripts/varredura-mobile.mjs [--json]` (lógica em `scripts/lib/varreduraMobile.mjs`,
contrato em `src/lib/varreduraMobile.test.js`). Lista inputs de arquivo crus/`hidden`, alvos clicáveis < 44px, gradientes
`from-brand to-brand2` escritos à mão e cores `#rrggbb` fora dos tokens. É heurística de texto (não AST): serve para listar
candidatos e travar regressão, não para provar ausência de problema.

## 1. Botão primário azul→ciano (identidade) — NÃO APLICADO, decisão do dono

Onde: `src/ui/index.jsx:55` (`Botao`, variação primário: `bg-gradient-to-r from-brand to-brand2 shadow-glow`), também
`index.jsx:179/195` e `src/ui/lista.jsx:127`. Tokens em `src/index.css:55-56`: `--c-brand: var(--marca-1, #3b5bfd)`,
`--c-brand2: var(--marca-2, #12c6ff)` (escuro: `#5f7bff` / `#38e1ff`).

Por que não apliquei:
- `--marca-1/2` são as **cores do clube** (white-label); o azul→ciano é só o padrão de quando o clube não escolheu cor.
  Trocar o padrão é decisão de identidade do produto.
- Há teste de contrato que fixa o padrão: `src/lib/produtoMulticlube.contract.test.js:239`
  (`--c-brand2: var(--marca-2, #12c6ff)`), além de `marca.test.js` e `ui/contraste.test.js` que citam `#3b5bfd`/`#12c6ff`.
  Não se afrouxa teste de contrato.
- A dívida é espalhada: **98 botões** com o gradiente escrito à mão fora do `<Botao>` (lista: `node scripts/varredura-mobile.mjs`).
  Trocar só `Botao` deixaria o app com dois "primários". O teste `varreduraMobile.test.js` agora trava esse número em
  no máximo 98 (não pode crescer).

Achado de acessibilidade ligado a isso (**BUG REAL de contraste, só no padrão sem cor de clube**): texto branco sobre o
fim ciano do gradiente = **1,99:1** (claro, `#12c6ff`) e **1,57:1** (escuro, `#38e1ff`); AA exige 4,5:1 (texto 14px bold).
Metade direita do botão primário padrão reprova. Início do gradiente: 5,12:1 (claro) e 3,64:1 (escuro). Clubes com cor própria
usam `--marca-1-texto` (calculado por contraste) e não sofrem disso.

Opções (prévia em texto):
- **A — Marinho + dourado (recomendada):** primário sólido `#0b1f4d` com texto branco (15,9:1), foco/realce em dourado
  `#f5c518`; "ação principal" única por tela; sem gradiente. Padrão novo: `--marca-1` default `#0b1f4d`, `--marca-2` default
  `#f5c518` (texto escuro `#07122f` sobre dourado = 11,3:1). Rede mantém a paleta própria (`--rede-*`), com anel de story
  e "curtido" em dourado. Exige: atualizar o contrato `produtoMulticlube.contract.test.js:239`, `marca.test.js`,
  `contraste.test.js`, e reescrever o gradiente nos 98 usos para `<Botao>` (ou aliás de token).
- **B — Manter azul, só consertar contraste:** gradiente `#3b5bfd → #2740c9` (fim escuro, texto branco ≥ 5:1), ciano só
  como detalhe decorativo. Mexe só no padrão do token `--c-brand2`, mas ainda exige atualizar o mesmo contrato.
- Qualquer das duas: decidir se o app "sem clube" (login/cadastro/abertura, sempre DesbravaClube) usa o marinho+dourado
  da marca-produto — o CLAUDE.md fala "visual clean marinho + dourado".

## 2. `input type=file` crus — FEITO

Confirmado por grep: 13 ocorrências (7 telas pedidas + Rede + peças já corretas). Criado `BotaoUpload` em
`src/ui/zonaUpload.jsx` (versão compacta da `ZonaUpload`: input `sr-only` — antes `hidden`/display:none, que some do
teclado e do leitor de tela —, label ≥ 44px, anel de foco via `focus-within`, limpa o input para repetir o mesmo arquivo).

| Tela | Antes | Agora | Teste |
|---|---|---|---|
| Suporte (usuário) `Suporte.jsx` CampoAnexo | input cru | `ZonaUpload` (jpeg/png/webp, `validarAnexo`, remover) | `Suporte.test.jsx` |
| AdminChamados `:180` | input cru | `ZonaUpload` | `AdminChamados.test.jsx` (envia e limpa) |
| Cadastro `:186` | input cru | `ZonaUpload` (sem `capture`: continua aceitando galeria) | `Cadastro.test.jsx` (label exato "Foto de perfil" preservado) |
| Atividades `:616` | input cru | `ZonaUpload` (imagem+vídeo, 50 MB, prévia de vídeo preservada; `*/*` quando só exige arquivo) | `Atividades.upload.test.jsx` (novo; `EntregarModal` passou a ser exportado) |
| Perfil `:138` | `hidden` | `BotaoUpload` | contrato estático |
| Unidades `:225`, `:406` | `hidden` | `BotaoUpload` | contrato estático + `Unidades.diretoria.test.jsx` |
| ClubeConfig `:143` | `hidden` | `BotaoUpload` (gif/jpeg/png/webp) | `ClubeConfig.test.jsx` (já fazia upload) |
| AdminVitrine `:145` | `hidden` | `BotaoUpload` | `AdminVitrine.test.jsx` (novo teste de logo) |

Mantidos (já conformes: `sr-only` + alvo ≥ 44px): `DocumentoDaIdade.jsx:57` (label de 56px), `LayoutConta.jsx:76` (avatar por ref),
`FormularioRelatorio.jsx:449`, `ZonaUpload` e a **Rede** (`RedeFeed:104`, `RedePublicar:269`: caixas próprias, `sr-only`).
`DocumentoDaIdade` não tem `capture` hoje e nada foi alterado ali. Perfil e Unidades/ClubeConfig não têm teste de tela
própria para a troca de imagem: cobertos pelo contrato `varreduraMobile.test.js` (nenhum input cru/`hidden` em `src/`) e pelos testes do `BotaoUpload`.

## 3. Estados vazios, carregamento, erros, MenuAcoes

- `ui/` já tem `carregamento.jsx` (esqueletos), `Vazio`, `Aviso`, `mensagemDeErro`, `MenuAcoes`. A maioria das telas usa.
- Varredura por arquivo (páginas sem `Carregando/Esqueleto/Vazio` e sem `mensagemDeErro/Aviso/avisar`): `Ajuda`, `Aprovacoes`,
  `Eu`, `GestaoAvaliar`, `VerificarDocumento` — todas delegam a componentes que já tratam (ou não buscam dados; `VerificarDocumento` tem estado `erro` próprio).
- **BUG REAL corrigido:** `AdminRedeTodosClubes.jsx` — `await clubesListar()` sem try/catch (rejeição sem tratamento,
  botão parecia travado). Agora `avisar.erro` e nada é tocado. Teste novo em `AdminRedeTodosClubes.test.jsx`.
- `AdminRecursosPlataforma.jsx` mostra `e.message` cru: **intencional** (tela só do dono da plataforma; o comentário diz "escrita como veio"). Mantido.
- **Ficou:** não há auditoria automática de "tela sem estado vazio"; exigiria revisar tela a tela com dados reais.
  MenuAcoes: não foi migrado nenhum botão de ações; sem critério mecânico que separe "lista de ações" de botão comum.

## 4. Alvos < 44px — FEITO (0 candidatos na varredura)

| Arquivo:linha | Antes | Agora |
|---|---|---|
| `Cadastro.jsx:258` ("Trocar") | 40px | 44px |
| `CatalogoEspecialidades.jsx:77, 130` | 40px | 44px |
| `rede/componentes.jsx:516` ("Ver comentários") | 36px | 44px (a Rede é do mesmo produto) |
| `Experiencias.jsx:255` (label de opção) | 36px | 44px |
| `Investiduras.jsx:172`, `MinhaClasse.jsx:1016` (label de checkbox) | 32px | 44px |
| `site/Conheca.jsx:166` pontos de progresso | 32×44, 8 pontos na mesma linha dos botões | 44px de altura; no celular os pontos ganham linha própria (`flex-wrap`, `order-last`, `w-full`, `w-8` com `gap-0.5`); em `sm+` ficam em linha com `w-11` |

Decisão registrada: em celular os pontos continuam com **32px de largura** (8 × 44px não cabem em 360px). Atende o WCAG 2.2 AA 2.5.8
(mínimo 24px); abaixo do alvo de 44 do projeto. Alternativa se o dono quiser 44 inteiro: trocar os pontos por "3 de 8" no celular. Teste em `Conheca.test.jsx`.
Falsos positivos (ícones `h-5 w-5` dentro de botões) são descartados pelo detector. A varredura **não vê** alvos dimensionados
por `py-*`/`p-*` sem `h-`/`min-h-`; esses só aparecem em aparelho real.

## 5. Overflow lateral em 360/390/430/768 — NÃO TESTADO visualmente

Revisão estática: só há `<table>` em `Mensalidades.jsx:248` (`hidden lg:block`), `PainelDoEscopo.jsx:136` (w-full, 3 colunas curtas) e
`components/admin/Tabela.jsx` (cards no celular, tabela a partir de `md`, com `overflow-x-auto`). Nenhum `w-[NNNpx]` ≥ 340px. Os `overflow-x-auto`
existentes são carrosséis intencionais. Rede usa `overflow-x-hidden`. Pendente conferência em 360/390/430/768 (Chrome emulado + aparelho real).
O dev server aberto na sessão aponta para outro worktree e o navegador do painel estava na produção; não mexi nele.

## 6. Tema claro/escuro e contraste

- Tokens `muted/faint/ink` têm contrato AA (`tokensDeCor.test.js`, `contrasteRede.test.js`, `ui/contraste.test.js`): passam.
- Falha conhecida: ver item 1 (branco sobre o ciano do gradiente primário padrão, 1,99:1 / 1,57:1). Não aplicado (identidade).
- Cores `#rrggbb` fixas fora dos tokens: 54 arquivos (maiores: `Mural` 19, `DocumentoClasse` 17, `PlayerAudio` 15, `CartaoDoClube` 13,
  `Missoes` 11, `Admin` 10, `Landing` 10). Lista completa na CLI. Não alterei: cada uma exige olhar de design (algumas são marca fixa,
  ex. WhatsApp `#25D366`, marinho do `/admin`). Sugestão: tokens `--c-marinho`/`--c-dourado` junto com a decisão do item 1.

## 7. Safe-area e teclado

- Já resolvido globalmente: `--seguro-topo/baixo/esq/dir` (`index.css:262-266`), regra para todo overlay `.fixed.inset-0`, `viewport-fit=cover`,
  cabeçalhos `sticky` com `paddingTop: var(--seguro-topo)`, barra da Rede com `paddingBottom: var(--seguro-baixo)`, `safeArea.test.js`.
- **Corrigido:** botão fixo "Preciso de ajuda" (`PainelCoordenador.jsx:208`) respeitava só o inferior; agora também a margem direita (paisagem).
- Sem tratamento de teclado virtual (`visualViewport`): o formulário de comentários da Rede (`componentes.jsx:343`, `sticky bottom-0`) e modais com
  campo dependem do comportamento do navegador. **Depende de aparelho real** (Android com teclado aberto, APK e PWA).

## Resultados (Node 22.22)

- `npx eslint .`: **0 erros** (108 avisos preexistentes; 2 erros que eu mesmo criei na varredura foram corrigidos).
- Vitest, suíte inteira: 195/197 arquivos na 1ª rodada; as 2 falhas eram **timeout de 5 s** em `clube.test.js` e `especialidadesManifesto.test.js`
  (leem centenas de migrations em paralelo) — **INFRA**, passam isoladas (86/86) e na reexecução. Nenhum teste afrouxado.
- `npm run build`: falha sem `VITE_SUPABASE_URL` (fail-closed **por desenho**, INFRA do worktree sem `.env`); com URL/chave de teste: OK (PWA 194 entradas).
- `npm run test:ambiente`: AMBIENTE OK.

## Depende de decisão do dono

1. Unificação do primário (item 1): A (marinho+dourado) ou B (azul com fim escuro), e se o padrão sem clube segue a marca-produto.
2. Pontos do `/conheca`: ficam 32px de largura no celular, ou virar "3 de 8"?
3. Tokens `--c-marinho/--c-dourado` para as 54 telas com hex fixo.

## Depende de aparelho real / navegador (NÃO TESTADO)

- Overflow em 360/390/430/768 (todas as telas), com destaque para `/conheca` (nova linha de pontos) e `PainelDoEscopo`.
- Teclado virtual × barra de comentários da Rede e modais; safe-area em Android com navegação por gestos e iPhone (PWA).
- Contraste real ao sol do botão primário (item 1) e modo escuro.
- Fluxo de câmera dos uploads (`capture`) no APK/Android; `ZonaUpload` com vídeo (Atividades) em 4G fraco.
