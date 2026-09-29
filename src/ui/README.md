# Design system do DesbravaClube (`src/ui`)

Tudo sai de `import { … } from '../ui/index.jsx'`. Regras que valem para todas as peças:

- alvo de toque mínimo **44×44** em qualquer coisa clicável;
- texto informativo nunca abaixo de **12px**;
- a cor do clube entra por variável CSS e o texto em cima dela vem de `--marca-1-texto` (contraste calculado);
- carregamento é anunciado (`role="status"`), erro é anunciado (`role="alert"`);
- animação respeita `prefers-reduced-motion`;
- visual clean (azul-marinho + dourado), nada de neon.

## Quando usar o quê

| Peça | Use quando… | Não use para… |
|---|---|---|
| `Cabecalho` | topo da **tela** (h1) com ícone, descrição e uma ação | seções dentro da tela (use `CabecalhoSecao`) |
| `CabecalhoSecao` | título de uma **seção** (h2) com descrição, `contador`, `badge` e `acao` | o título da tela |
| `Card` / `CardAcao` | agrupar conteúdo; `CardAcao` quando o cartão inteiro é o link/botão | listas longas de linhas iguais (use `GrupoLista`) |
| `GrupoLista` + `ItemLista` | listas "estilo ajustes": ícone, título, descrição, `info`/`badge` à direita, seta. `to` → Link, `onClick` → button, nada → linha simples. `desabilitado` esmaece e trava | grades de cartões |
| `Botao` | qualquer ação: `primario`, `secundario`, `contorno`, `perigo`, `discreto`; `carregando` mostra "Só um instante…" | links de navegação em texto corrido |
| `Campo` / `Selecao` | input/textarea/select com rótulo, ajuda e erro inline | — |
| `Chip` | filtro selecionável (`selecionado`, `aria-pressed`, `contador`); sem `onClick` vira etiqueta | status (use `Selo`) |
| `Abas` | trocar entre seções de uma tela (`role="tablist"`) | filtros combináveis (use `Chip`) |
| `Selo` | status curto com tom (`ok`, `atencao`, `info`, `perigo`, `neutro`) — nunca só por cor | botões |
| `Progresso` | barra 0–100 com `rotulo` e porcentagem | carregamento indeterminado (use `Carregando`) |
| `Carregando` / `EsqueletoTela` / `TelaDeAbertura` | dado chegando (esqueleto), rota abrindo, sessão resolvendo | texto "Carregando…" solto |
| `Vazio` | lista sem itens: ícone, título, explicação e `acao` | erro (use `Aviso`) |
| `Aviso` | mensagem fixa na tela (`erro`, `ok`, `info`) com `acao` opcional | feedback passageiro (use toast) |
| `useAvisos` / `avisar` (`avisos.jsx`) | toast de sucesso/info (some sozinho), toast de erro (não some), `confirmar()` para decisão destrutiva | erro de campo (fica inline no `Campo`) |
| `mensagemDeErro` | traduzir a falha do servidor para uma frase humana — o texto cru nunca vai para a tela | — |
| `Folha` | bottom sheet no celular / diálogo no PC; Esc fecha, foco restaurado | menus de 2–5 ações (use `MenuAcoes`) |
| `MenuAcoes` | botão "⋯" com lista de ações; celular → `Folha`, ≥ md → popover com setas; `tom: 'perigo'` fica por último, em vermelho | navegação principal |
| `ZonaUpload` | escolher foto/arquivo: caixa tracejada grande, estados `vazio` → `selecionado` → `enviando` → `concluido`/`erro`, remover/trocar, `accept`/`capture` | upload em segundo plano sem UI |
| `FilaDePopupsProvider` + `usePopup` | qualquer popup que abre sozinho ao entrar (avisos, devocional, evento, tour): só um por vez, prioridade, e não reabre na mesma sessão | diálogos abertos por toque da pessoa (use `Folha` direto) |

## Exemplos rápidos

```jsx
<GrupoLista titulo="Conta">
  <ItemLista to="/perfil" icone="🪪" titulo="Meu perfil" descricao="Foto e dados" />
  <ItemLista onClick={atualizar} icone="🔄" titulo="Atualizar o app" badge="novo" tomBadge="info" />
  <ItemLista icone="📦" titulo="Versão" info="1.3.0" />
</GrupoLista>

<CabecalhoSecao titulo="Pendentes" contador={3} acao={<Botao variacao="discreto" para="/todos">Ver todos</Botao>} />

<Chip selecionado={f === 'todos'} onClick={() => setF('todos')} contador={12}>Todos</Chip>

<MenuAcoes rotulo="Ações da foto" acoes={[
  { rotulo: 'Editar legenda', icone: '✏️', onClick: editar },
  { rotulo: 'Apagar', icone: '🗑️', tom: 'perigo', onClick: apagar },
]} />

<ZonaUpload rotulo="Foto de comprovação" obrigatorio capture="environment"
  arquivo={foto} aoEscolher={setFoto} aoRemover={() => setFoto(null)}
  estado={enviando ? 'enviando' : erro ? 'erro' : undefined} progresso={pct} erro={erro} />

// popup que entra na fila (o provider fica na raiz do app)
const { minhaVez, fechar } = usePopup('devocional', { prioridade: 5, ativo: !!devocional })
if (!minhaVez) return null
return <Folha aberta aoFechar={fechar} titulo="Devocional">…</Folha>
```

## Arquivos

- `index.jsx` — peças base + re-exporta tudo abaixo
- `lista.jsx` — `GrupoLista`, `ItemLista`, `CabecalhoSecao`, `Chip`
- `menuAcoes.jsx` — `MenuAcoes`
- `zonaUpload.jsx` — `ZonaUpload`
- `popups.jsx` — `FilaDePopupsProvider`, `usePopup`, `usePopups`, `popupJaVisto`, `marcarPopupVisto`, `esquecerPopupVisto` (lógica pura em `src/lib/filaDePopups.js`)
- `avisos.jsx` — toast, confirmação, `avisar`, `useAnuncio`
- `carregamento.jsx` — `TelaDeAbertura`, `EsqueletoTela`, `FimDaAbertura`
- `contraste.js` — cálculo de contraste da cor do clube
