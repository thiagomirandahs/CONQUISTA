# Auditoria de navegação — fase 8

## Situação encontrada
A fase 7 já limitou a barra de baixo a 5 destinos por papel. O problema atual não era excesso, e sim destino que podia levar a hub VAZIO quando o clube desliga recursos.

| Papel | Barra (tudo ligado) |
|---|---|
| desbravador | Início · Jornada · Clube · Jogos · Eu |
| conselheiro, instrutor, tesoureiro, diretoria | Início · Jornada · Clube · Gestão · Eu (jogos ficam dentro de Clube) |
| responsável (pais) | Meus filhos · Eu (confinado a CAMINHOS_DO_RESPONSAVEL) |
| coordenação (sem clube) | Portal · Criar meu clube (destinosSemClube; fora do AppLayout) |

Observação: o papel "coordenação" não usa a barra do clube. Tesoureiro/conselheiro veem Gestão, mas só as ferramentas da matriz (permissoes.js); a trava real é RLS/RPC.

## Onde mora cada tela nova
- Minha Jornada, Portfólio, Leituras (recurso `classes`), Especialidades (`especialidades`): hub Jornada.
- Rede DBV (`comunidade`): hub Clube e atalho "Ir para" do Início (rede tem barra própria, dentro de /rede).
- Atalhos do Início: Rede DBV e Minha classe, cada um só se o recurso está ligado; cards do servidor passam por `rotaLiberada`.

## Redundâncias
Nenhuma nova. A gaveta ☰ já havia sido removida no celular; o PC lista tudo agrupado. Rede aparece em Clube e no Início de propósito (atalho pedido pelo dono, 29/09).

## Hipótese avaliada
Início · Jornada · Rede · Gestão · Conta: REJEITADA. Rede tem layout e barra próprios, é opcional (nasce desligada) e o desbravador perderia Clube (Ranking, Unidades, Agenda, Chat) e Jogos como porta principal. Mantida a estrutura da fase 7.

## Decisão (mudança mínima)
`destinosDoPapel` agora tira da barra o destino cujo hub ficaria vazio: Jornada (nenhum de classes/especialidades/experiências/atividades/missões/bíblia ligado) e Jogos (nenhum recurso de jogo ligado). Início, Clube (núcleo: Ranking e Unidades), Gestão e Eu nunca saem. Nada perde acesso: hub vazio não tem tela. Tudo que sai continua por hub/Clube/atalho do Início; as rotas seguem guardadas por RecursoOpcional/RotaRestrita.
Barra (AppLayout): lados da barra passam a respeitar `--seguro-esq/--seguro-dir`; foco visível (`focus-visible`) nos links.

## Segurança da barra (o que já cobre)
- `viewport-fit=cover` no index.html; `--seguro-baixo/topo/esq/dir` = max(env(safe-area-inset-*), --safe-area-inset-*) em index.css.
- Barra: `bottom: calc(10px + var(--seguro-baixo))`; faixa sólida atrás (84px + seguro); `main` com `pb-[calc(7rem+var(--seguro-baixo))]`.
- APK: MainActivity aplica os insets reais (systemBars+cutout+ime) como padding da raiz; o WebView só ocupa o espaço ENTRE as barras do sistema (3 botões ou gestos), então a barra nunca fica atrás delas. `capacitor.config.json` tem SystemBars `insetsHandling: disable` (coerente: quem trata é o nativo; o comentário do index.css cita "css", está desatualizado).
- Alvos: min-h 52px; grade de colunas iguais (sem rolagem lateral); rótulo + ícone; `aria-current="page"` via NavLink.

## NÃO provável sem aparelho físico
Comportamento real em Android com 3 botões vs gestos vs gesto "pílula" do fabricante, Android < 10 sem insets de gesto, teclado aberto (ime) com a barra, rotação/dobráveis, fontes do sistema aumentadas (rótulos de 12px com "Meus filhos"), e o toque de borda no gesto de voltar sobre a barra.

## Testes
- Novos: `src/components/AppLayout.test.jsx` (≤5 links, rótulo, 44px, aria-current único, safe-area, recurso desligado, responsável); bloco "fase 8" em `src/lib/navegacao.test.js` (≤5 em qualquer combinação, Início+Eu fixos, hub nunca vazio, nada some, Rede por recurso, liderança alcança jogos por Clube).
- Ajustes em testes existentes: nenhum (as asserções de tudo-ligado continuam iguais).
