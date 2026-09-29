import { Link } from 'react-router-dom'
import { Selo } from './index.jsx'

// =============================================================================
//  Listas, cabeçalhos de seção e chips (fase 6.3).
//
//  A tela "Eu" tinha a sua própria lista estilo "ajustes do celular" (Grupo/ItemLink/ItemBotao) e
//  outras telas reinventavam a mesma linha com ícone + título + seta. Aqui fica a versão única.
//  Regras que valem para tudo neste arquivo:
//   * alvo de toque mínimo 44px (linha e chip interativos);
//   * texto nunca abaixo de 12px;
//   * o que é decorativo (ícone, seta) é aria-hidden — o nome acessível é o título.
// =============================================================================

const juntar = (...c) => c.filter(Boolean).join(' ')

/**
 * Cartão que agrupa linhas (`ItemLista`), com um título pequeno em caixa alta por cima.
 *
 * @example
 * <GrupoLista titulo="Conta">
 *   <ItemLista to="/perfil" icone="🪪" titulo="Meu perfil" descricao="Foto e dados" />
 *   <ItemLista onClick={sair} icone="🚪" titulo="Sair" />
 * </GrupoLista>
 */
export function GrupoLista({ titulo, children, className, ...resto }) {
  return (
    <section className={className} {...resto}>
      {titulo && <h2 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-faint">{titulo}</h2>}
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">{children}</ul>
    </section>
  )
}

/**
 * Uma linha de lista: ícone à esquerda, título + descrição no meio, informação/selo/seta à direita.
 *
 * Vira `<Link>` quando recebe `to`, `<button>` quando recebe `onClick`, e uma linha simples (sem
 * seta) quando não recebe nenhum dos dois. A seta aparece sozinha nas linhas clicáveis; passe
 * `seta={false}` para esconder.
 *
 * @param {object} p
 * @param {string} [p.to]              rota → renderiza um Link
 * @param {Function} [p.onClick]       ação → renderiza um button
 * @param {import('react').ReactNode} [p.icone]     emoji ou ícone (decorativo)
 * @param {string} p.titulo            nome acessível da linha
 * @param {string} [p.descricao]       linha pequena abaixo do título
 * @param {import('react').ReactNode} [p.info]      texto/valor à direita (ex.: "3 novos", "R$ 20")
 * @param {string} [p.badge]           texto do `Selo` à direita
 * @param {string} [p.tomBadge]        tom do Selo (neutro | ok | atencao | info | perigo)
 * @param {boolean} [p.seta]           mostra a seta ›; padrão: só quando clicável
 * @param {boolean} [p.desabilitado]   não responde ao toque e fica esmaecida
 * @param {string} [p.testid]          data-testid no elemento clicável
 */
export function ItemLista({ to, onClick, icone, titulo, descricao, info, badge, tomBadge = 'neutro', seta,
  desabilitado = false, testid, className, ...resto }) {
  const clicavel = !!(to || onClick)
  const mostrarSeta = seta ?? clicavel
  const conteudo = (
    <>
      {icone != null && (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface2 text-lg" aria-hidden="true">{icone}</span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] font-semibold text-ink">{titulo}</span>
        {descricao && <span className="block truncate text-xs text-faint">{descricao}</span>}
      </span>
      {info != null && <span className="shrink-0 text-sm text-muted" data-testid="item-info">{info}</span>}
      {badge && <Selo tom={tomBadge}>{badge}</Selo>}
      {mostrarSeta && <span className="shrink-0 text-faint" aria-hidden="true">›</span>}
    </>
  )
  const classe = juntar('flex w-full min-h-[44px] items-center gap-3 px-3.5 py-2.5 text-left',
    clicavel && !desabilitado && 'active:bg-surface2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
    desabilitado && 'opacity-50 cursor-not-allowed', className)

  let miolo
  if (to && !desabilitado) {
    miolo = <Link to={to} data-testid={testid} className={classe} {...resto}>{conteudo}</Link>
  } else if (clicavel) {
    miolo = (
      <button type="button" onClick={onClick} disabled={desabilitado} aria-disabled={desabilitado || undefined}
        data-testid={testid} className={classe} {...resto}>{conteudo}</button>
    )
  } else {
    miolo = <div data-testid={testid} className={classe} {...resto}>{conteudo}</div>
  }
  return <li>{miolo}</li>
}

/**
 * Cabeçalho de uma seção dentro da tela (h2): título, descrição, contador e uma ação à direita.
 * Para o topo da TELA (h1) continua valendo `Cabecalho`.
 *
 * @example
 * <CabecalhoSecao titulo="Pendentes" contador={3} acao={<Botao variacao="discreto">Ver todos</Botao>} />
 */
export function CabecalhoSecao({ titulo, descricao, acao, contador, badge, tomBadge = 'neutro', className, id }) {
  return (
    <div className={juntar('mb-2 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-base font-extrabold leading-tight text-ink">
          <span>{titulo}</span>
          {contador != null && (
            <span className="inline-grid min-w-[1.5rem] place-items-center rounded-full bg-surface2 px-1.5 text-xs font-bold text-muted"
              aria-label={`${contador} ${contador === 1 ? 'item' : 'itens'}`}>{contador}</span>
          )}
          {badge && <Selo tom={tomBadge}>{badge}</Selo>}
        </h2>
        {descricao && <p className="mt-0.5 text-sm text-muted">{descricao}</p>}
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </div>
  )
}

/**
 * Chip de filtro. Com `onClick` vira um botão de 44px com `aria-pressed`; sem `onClick` é só uma
 * etiqueta. `contador` aparece entre parênteses.
 *
 * @example
 * <Chip selecionado={f === 'todos'} onClick={() => setF('todos')} contador={12}>Todos</Chip>
 */
export function Chip({ selecionado = false, onClick, contador, icone, desabilitado, children, className, ...resto }) {
  const classe = juntar('inline-flex items-center gap-1.5 rounded-full px-3.5 text-sm font-bold transition-colors',
    onClick ? 'min-h-[44px]' : 'min-h-[32px]',
    selecionado ? 'bg-gradient-to-r from-brand to-brand2 shadow-glow' : 'bg-surface text-muted border border-line',
    onClick && !desabilitado && 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.97]',
    desabilitado && 'opacity-50 cursor-not-allowed', className)
  const estilo = selecionado ? { color: 'var(--marca-1-texto, #fff)' } : undefined
  const miolo = (
    <>
      {icone && <span aria-hidden="true">{icone}</span>}
      <span>{children}</span>
      {contador != null && <span className="text-xs opacity-90">({contador})</span>}
    </>
  )
  if (!onClick) return <span className={classe} style={estilo} {...resto}>{miolo}</span>
  return (
    <button type="button" onClick={onClick} aria-pressed={selecionado} disabled={desabilitado}
      className={classe} style={estilo} {...resto}>{miolo}</button>
  )
}
