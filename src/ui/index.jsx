import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { EsqueletoTela } from './carregamento.jsx'
export { TelaDeAbertura, EsqueletoTela } from './carregamento.jsx'

// =============================================================================
//  Design system do DesbravaClube (fase 7).
//
//  Antes desta fase cada tela recriava o seu card, o seu botão e o seu input: 149 cards em 48
//  arquivos, 88 botões em 38, e a altura de toque correta (44px) existia em 5 telas de 47.
//  Aqui ficam as peças únicas. Regras que valem para TODAS elas:
//
//   * alvo de toque mínimo 44×44 em qualquer coisa clicável;
//   * texto informativo nunca abaixo de 12px (o app é usado por criança de 10 anos);
//   * a cor do clube entra por variável CSS, e o TEXTO em cima dela vem de --marca-1-texto,
//     calculado por contraste — uma cor ruim escolhida pelo clube não deixa nada ilegível;
//   * estado de carregamento é anunciado (role="status"), erro é anunciado (role="alert");
//   * animação respeita prefers-reduced-motion (o app inteiro está sob MotionConfig).
// =============================================================================

const juntar = (...c) => c.filter(Boolean).join(' ')

// ---------------------------------------------------------------- Cabeçalho
export function Cabecalho({ icone, titulo, descricao, acao }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold text-ink leading-tight">
          {icone && <span aria-hidden="true">{icone} </span>}{titulo}
        </h1>
        {descricao && <p className="text-sm text-muted mt-0.5">{descricao}</p>}
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </header>
  )
}

// ---------------------------------------------------------------- Card
export function Card({ children, className, as: Tag = 'div', ...resto }) {
  return <Tag className={juntar('bg-surface rounded-2xl shadow-soft p-4', className)} {...resto}>{children}</Tag>
}

// Card que é um link/botão — o alvo inteiro é clicável e tem 44px garantidos.
export function CardAcao({ para, aoTocar, children, className, ...resto }) {
  const classe = juntar('block w-full text-left bg-surface rounded-2xl shadow-soft p-4 min-h-[44px]',
    'transition-[background-color,transform] duration-150 active:scale-[0.98] hover:bg-surface2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand', className)
  if (para) return <Link to={para} className={classe} {...resto}>{children}</Link>
  return <button type="button" onClick={aoTocar} className={classe} {...resto}>{children}</button>
}

// ---------------------------------------------------------------- Botão
const VARIACOES = {
  // `--marca-1-texto` é calculado por contraste: com uma cor de clube clara, o texto vira escuro.
  primario: 'bg-gradient-to-r from-brand to-brand2 shadow-glow font-extrabold',
  secundario: 'bg-surface2 text-ink font-bold',
  contorno: 'border-2 border-brand font-bold',
  perigo: 'bg-rose-600 text-white font-bold',
  discreto: 'text-ink font-semibold',
}

export function Botao({ variacao = 'primario', para, aoTocar, tipo = 'button', carregando, desabilitado,
  children, className, ...resto }) {
  const estilo = variacao === 'primario' ? { color: 'var(--marca-1-texto, #fff)' }
    : variacao === 'contorno' ? { color: 'var(--marca-1-legivel, var(--c-brand))' } : undefined
  const classe = juntar('inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl',
    'text-sm transition-[color,background-color,transform,opacity] duration-150 active:scale-[0.97] disabled:active:scale-100 disabled:opacity-60 disabled:cursor-not-allowed',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    VARIACOES[variacao] || VARIACOES.primario, className)
  if (para && !desabilitado) return <Link to={para} className={classe} style={estilo} {...resto}>{children}</Link>
  return (
    <button type={tipo} onClick={aoTocar} disabled={desabilitado || carregando} className={classe} style={estilo}
      aria-busy={carregando || undefined} {...resto}>
      {carregando ? 'Só um instante…' : children}
    </button>
  )
}

// ---------------------------------------------------------------- Campo
export function Campo({ id, rotulo, ajuda, erro, tipo = 'text', linhas, className, ...resto }) {
  const Controle = linhas ? 'textarea' : 'input'
  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-xs font-semibold text-muted mb-1">{rotulo}</label>
      <Controle id={id} rows={linhas} type={linhas ? undefined : tipo}
        aria-describedby={ajuda ? `${id}-ajuda` : undefined}
        aria-invalid={erro ? 'true' : undefined}
        className={juntar('w-full min-h-[44px] rounded-xl bg-surface px-3 py-2.5 text-sm text-ink',
          'border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
          erro ? 'border-rose-400' : 'border-line', className)} {...resto} />
      {ajuda && !erro && <p id={`${id}-ajuda`} className="text-xs text-faint mt-1">{ajuda}</p>}
      {erro && <p className="text-xs text-rose-600 mt-1" role="alert">{erro}</p>}
    </div>
  )
}

export function Selecao({ id, rotulo, ajuda, opcoes = [], className, ...resto }) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-xs font-semibold text-muted mb-1">{rotulo}</label>
      <select id={id}
        className={juntar('w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand', className)} {...resto}>
        {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
      {ajuda && <p className="text-xs text-faint mt-1">{ajuda}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- Estados
// Um único componente de carregamento, anunciado para leitor de tela e com esqueleto em vez de
// "Carregando..." solto (eram 8 variantes textuais diferentes no app).
export function Carregando({ linhas = 3, texto = 'Carregando' }) {
  return <EsqueletoTela cabecalho={false} cartoes={linhas} texto={texto} />
}

export function Vazio({ icone = '🗂️', titulo, children, acao }) {
  return (
    <div className="bg-surface rounded-2xl shadow-soft p-8 text-center">
      <div className="text-4xl mb-2" aria-hidden="true">{icone}</div>
      <p className="font-bold text-ink">{titulo}</p>
      {children && <p className="text-sm text-faint mt-1 leading-snug">{children}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  )
}

// Mensagem humana. `erro` nunca recebe o texto cru do servidor: quem chama traduz com `mensagemDeErro`.
const TOM = {
  erro: 'bg-amber-50 border-amber-200 text-amber-900',
  ok: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  info: 'bg-sky-50 border-sky-200 text-sky-900',
}
export function Aviso({ tom = 'info', titulo, children, acao }) {
  return (
    <div role={tom === 'erro' ? 'alert' : 'status'}
      className={juntar('border rounded-2xl p-4 text-sm mb-4', TOM[tom] || TOM.info)}>
      {titulo && <p className="font-bold mb-0.5">{titulo}</p>}
      {children}
      {acao && <div className="mt-3">{acao}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- Selo e progresso
const SELOS = {
  neutro: 'bg-surface2 text-muted', ok: 'bg-emerald-50 text-emerald-800',
  atencao: 'bg-amber-50 text-amber-800', info: 'bg-sky-50 text-sky-800', perigo: 'bg-rose-50 text-rose-800',
}
export function Selo({ tom = 'neutro', children, className }) {
  return <span className={juntar('inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full',
    SELOS[tom] || SELOS.neutro, className)}>{children}</span>
}

export function Progresso({ valor = 0, total = 100, rotulo }) {
  const pct = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted mb-1">
        <span>{rotulo}</span><span className="font-bold text-ink">{pct}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-surface2 overflow-hidden" role="progressbar"
        aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={rotulo}>
        <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand2" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Abas
export function Abas({ abas = [], ativa, aoTrocar, rotulo = 'Seções' }) {
  return (
    <div role="tablist" aria-label={rotulo} className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 mb-4">
      {abas.map((a) => {
        const sel = a.chave === ativa
        return (
          <button key={a.chave} role="tab" aria-selected={sel} type="button" onClick={() => aoTrocar(a.chave)}
            className={juntar('shrink-0 min-h-[44px] px-3.5 rounded-xl text-sm font-bold transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              sel ? 'bg-gradient-to-r from-brand to-brand2 shadow-glow' : 'bg-surface text-muted')}
            style={sel ? { color: 'var(--marca-1-texto, #fff)' } : undefined}>
            {a.icone && <span aria-hidden="true">{a.icone} </span>}{a.rotulo}
            {a.contador > 0 && <span className="ml-1.5 text-xs opacity-90">({a.contador})</span>}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- Folha (bottom sheet)
// No celular sobe de baixo (o polegar alcança); no PC vira um diálogo central.
// Entra subindo e sai descendo (CSS, 200ms/160ms — sem o motor do framer-motion); com movimento
// reduzido, a regra global do index.css zera as durações e ela aparece/some na hora.
export function Folha({ aberta, aoFechar, titulo, children }) {
  const caixa = useRef(null)
  const [montada, setMontada] = useState(aberta)
  const [saindo, setSaindo] = useState(false)
  if (aberta && !montada) setMontada(true)
  if (aberta && saindo) setSaindo(false)
  if (!aberta && montada && !saindo) setSaindo(true)
  useEffect(() => {
    if (!saindo) return undefined
    const t = setTimeout(() => { setMontada(false); setSaindo(false) }, 170)
    return () => clearTimeout(t)
  }, [saindo])
  useEffect(() => {
    if (!aberta) return undefined
    const antes = document.activeElement
    caixa.current?.focus()
    const tecla = (e) => { if (e.key === 'Escape') aoFechar?.() }
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('keydown', tecla); antes?.focus?.() }
  }, [aberta, aoFechar])
  if (!montada) return null
  return (
    <div className={`fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center folha${saindo ? ' folha-saindo' : ''}`}>
      <button type="button" aria-label="Fechar" onClick={aoFechar} tabIndex={saindo ? -1 : undefined}
        className="folha-fundo absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div ref={caixa} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo}
        className="folha-caixa relative w-full sm:max-w-md bg-surface rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] overflow-y-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="sticky top-0 bg-surface flex items-center justify-between gap-3 px-5 py-4 border-b border-line">
          <h2 className="font-extrabold text-ink">{titulo}</h2>
          <button type="button" onClick={aoFechar} aria-label="Fechar"
            className="w-11 h-11 -mr-2 rounded-full grid place-items-center text-ink hover:bg-surface2">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Erros humanos
// Traduz a falha para o que a pessoa precisa saber: o que houve e o que dá pra fazer.
// O texto cru do servidor NUNCA vai para a tela (eram ~24 telas mostrando `e.message`).
const TRADUCOES = [
  // Recusa ESPERADA de membro_definir_teste / membro_definir_foto: a flag de teste e a foto são da
  // PESSOA e valem em todos os clubes dela, então o servidor não deixa um clube mudá-las quando ela
  // também está em outro. Vem antes de "sem permissão" porque a pessoa precisa saber o PORQUÊ.
  // Estreita de propósito: "pertence a outro clube" (unidade, autor, participante) é OUTRO erro.
  [/também (participa|está|faz parte)[^.]*outros? clubes?|vínculos?[^.]*em outros? clubes?|mais de um clube/i,
    'Essa pessoa também participa de outro clube, e isso vale para todos os clubes dela — por isso não dá para mudar por aqui.'],
  [/sem permiss|apenas a liderança|Sem vínculo|não tem permissão/i,
    'Isso é coisa da liderança do clube. Se você acha que deveria poder, fale com a diretoria.'],
  // Teto de membros (migration 220): o número do limite é o que a diretoria precisa saber.
  [/atingiu o limite de (\d+) membros/i, (m) =>
    `O clube atingiu o limite de ${m[1]} membros do plano. Encerre vínculos que não são mais usados ou fale com o suporte para ampliar o limite (responsáveis não contam).`],
  [/desabilitado neste clube/i, 'Este recurso está desligado no seu clube. A diretoria pode ligar em Configurações.'],
  [/não está incluído no plano/i, 'Isso não está no plano do clube. Quem responde pela conta pode ampliar o plano.'],
  [/sem clube em uso|não encontrada neste clube|não encontrado neste clube/i,
    'Não achamos isso no clube em que você está agora. Confira se escolheu o clube certo.'],
  [/já foi publicada|não pode mudar/i, 'Isso já foi publicado e não muda mais. Crie uma versão nova para alterar.'],
  [/já foi concluída/i, 'Isso já está concluído — não precisa enviar de novo.'],
  [/não aceita HTML|conteúdo não permitido/i, 'Escreva só texto, sem códigos ou símbolos como < e >.'],
  [/Escreva um pouco mais/i, 'Escreva um pouco mais para poder enviar.'],
  [/pede um arquivo/i, 'Esta etapa precisa de um arquivo. Escolha a foto ou o documento e tente de novo.'],
  [/Failed to fetch|NetworkError|network/i, 'Parece que a internet caiu. Confira a conexão e tente de novo.'],
  [/JWT|token|expired|401/i, 'Sua sessão expirou. Entre de novo para continuar.'],
]
// `contexto` é a frase que a tela já dizia ("Não consegui aprovar a entrega"): ela é preservada,
// porque diz O QUE falhou. O que nunca vai para a tela é o texto do servidor.
export function mensagemDeErro(erro, contexto) {
  const bruto = typeof erro === 'string' ? erro : (erro?.message || '')
  for (const [regra, traducao] of TRADUCOES) {
    const m = bruto.match(regra)
    if (!m) continue
    const texto = typeof traducao === 'function' ? traducao(m) : traducao
    return contexto ? `${contexto} ${texto}` : texto
  }
  const generico = 'Tente de novo em instantes — nada do que você fez foi perdido.'
  return contexto ? `${contexto} ${generico}` : `Não deu certo agora. ${generico}`
}

export { variaveisDeContraste, corDeTextoSobre, corDeMarcaLegivel, razaoDeContraste } from './contraste.js'
