import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import LinkApp from '../components/LinkApp.jsx'
import { carregarPlanos, formatarPreco } from '../services/comercial.js'
import { Icone } from './landing/Icones.jsx'
import { Celular, EscudoClasse } from './landing/Celular.jsx'
import { TELAS } from './landing/telas.js'
import { META_LANDING, AREAS, CLASSES_ITENS, CLASSES_REGULARES, FAIXA, FLUXO, GESTAO_ITENS, PERGUNTAS, REDE_ITENS, REDE_NAO_E, SEGURANCA } from './landing/conteudo.js'
import { MARCA_PRODUTO } from '../lib/marca.js'
import { useMetaDaPagina } from '../lib/metaDaPagina.js'
import FaixaParceiros from './site/FaixaParceiros.jsx'

// Site comercial PÚBLICO da plataforma (a raiz "/" sem sessão). Não usa <Logo/> nem as cores do CLUBE
// em uso: esta página é da PLATAFORMA. Visual = o do aplicativo (tokens de src/index.css: fundo em degradê
// claro, cartões brancos arredondados com sombra suave, botão em degradê brand→brand2, dourado só de acento).
// Preço e composição da licença vêm do banco (planos_disponiveis) — nada de preço hardcoded aqui.
// Texto e veracidade: src/pages/landing/conteudo.js e LANDING-VERACIDADE.md (só o que existe HOJE).

const CONTAINER = 'mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8'
const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 rounded-md'
const BOTAO_PRIMARIO = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-2xl bg-gradient-to-r from-brand via-brand to-brand2 shadow-glow text-white font-bold transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2'
const BOTAO_SECUNDARIO = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-2xl border border-line bg-surface shadow-soft text-ink font-bold transition-colors hover:bg-surface2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2'
const CARTAO = 'rounded-3xl border border-line bg-surface shadow-soft'

const NAV = [
  { href: '#recursos', rotulo: 'Recursos' },
  { href: '#como-funciona', rotulo: 'Como funciona' },
  { href: '#seguranca', rotulo: 'Segurança' },
  { href: '#planos', rotulo: 'Planos' },
  { href: '#faq', rotulo: 'FAQ' },
]
// páginas públicas da vitrine (só no site): clubes que usam o DesbravaClube e parceiros
const PAGINAS = [
  { to: '/conheca', rotulo: 'Conheça' },
  { to: '/clubes', rotulo: 'Clubes' },
  { to: '/parceiros', rotulo: 'Parceiros' },
  { to: '/ajuda', rotulo: 'Como usar' },
]

function Marca({ claro = false }) {
  return (
    <span className="flex items-center gap-2.5">
      <img src={MARCA_PRODUTO.logoUrl} alt="" width="36" height="36" className="w-9 h-9 rounded-xl" />
      <span className={`text-lg font-extrabold tracking-tight ${claro ? 'text-white' : 'text-ink'}`}>DesbravaClube</span>
    </span>
  )
}

// Também usado pelas páginas /clubes e /parceiros (naLanding=false): lá as âncoras apontam para "/#secao".
export function Cabecalho({ naLanding = true }) {
  const [aberto, setAberto] = useState(false)
  const botao = useRef(null)

  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e) => { if (e.key === 'Escape') { setAberto(false); botao.current?.focus() } }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberto])

  // Fecha o menu ANTES de rolar: esconder o painel no meio de uma rolagem suave encolhe a página e o
  // navegador pode abandonar a rolagem até a âncora. O foco vai para a seção (teclado/leitor de tela).
  function irPara(e, href) {
    if (!naLanding) { setAberto(false); return }
    e.preventDefault()
    flushSync(() => setAberto(false))
    const alvo = document.querySelector(href)
    if (!alvo) return
    alvo.scrollIntoView()
    alvo.focus({ preventScroll: true })
    history.pushState(null, '', href)
  }

  const linkDesk = `inline-flex min-h-[44px] items-center text-sm font-semibold text-muted hover:text-ink ${FOCO}`
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur" style={{ paddingTop: 'var(--seguro-topo)' }}>
      <div className={`${CONTAINER} flex h-16 items-center justify-between gap-4`}>
        {naLanding
          ? <a href="#inicio" className={`inline-flex min-h-[44px] items-center ${FOCO}`} aria-label="DesbravaClube — início"><Marca /></a>
          : <Link to="/" className={`inline-flex min-h-[44px] items-center ${FOCO}`} aria-label="DesbravaClube — início"><Marca /></Link>}
        <nav aria-label="Principal" className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {NAV.map((n) => (
              <li key={n.href}><a href={naLanding ? n.href : `/${n.href}`} className={linkDesk}>{n.rotulo}</a></li>
            ))}
            {PAGINAS.map((n) => (
              <li key={n.to}><Link to={n.to} className={linkDesk}>{n.rotulo}</Link></li>
            ))}
          </ul>
        </nav>
        <div className="hidden lg:flex items-center gap-3">
          <LinkApp to="/login" className={`inline-flex min-h-[44px] items-center px-3 text-sm font-bold text-ink hover:underline ${FOCO}`}>Entrar</LinkApp>
          <Link to="/adquirir" className={`${BOTAO_PRIMARIO} min-h-[44px] px-5 text-sm`}>Criar meu clube</Link>
        </div>
        <button
          ref={botao}
          type="button"
          className={`lg:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl border border-line bg-surface text-ink ${FOCO}`}
          aria-expanded={aberto}
          aria-controls="menu-movel"
          aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setAberto((v) => !v)}
        >
          <Icone nome={aberto ? 'fechar' : 'menu'} className="w-6 h-6" />
        </button>
      </div>
      <div id="menu-movel" hidden={!aberto} className="lg:hidden border-t border-line bg-white">
        <nav aria-label="Menu" className={`${CONTAINER} py-3`}>
          <ul className="flex flex-col">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={naLanding ? n.href : `/${n.href}`} onClick={(e) => irPara(e, n.href)} className={`flex min-h-[48px] items-center text-base font-semibold text-ink ${FOCO}`}>{n.rotulo}</a>
              </li>
            ))}
            {PAGINAS.map((n) => (
              <li key={n.to}>
                <Link to={n.to} onClick={() => setAberto(false)} className={`flex min-h-[48px] items-center text-base font-semibold text-ink ${FOCO}`}>{n.rotulo}</Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-3 pb-2">
            <LinkApp to="/login" className={BOTAO_SECUNDARIO}>Entrar</LinkApp>
            <Link to="/adquirir" className={BOTAO_PRIMARIO}>Criar meu clube</Link>
          </div>
        </nav>
      </div>
    </header>
  )
}

// ---- blocos de apoio ------------------------------------------------------------------------------
function Secao({ id, fundo = '', children, className = '' }) {
  return (
    <section id={id} tabIndex={-1} className={`${fundo} scroll-mt-16 py-12 sm:py-16 lg:py-20 focus:outline-none ${className}`}>
      <div className={CONTAINER}>{children}</div>
    </section>
  )
}

function Titulo({ sobre, titulo, texto, centro = true, id }) {
  return (
    <div className={`${centro ? 'mx-auto text-center' : ''} max-w-3xl mb-8 lg:mb-12`}>
      {sobre && <p className="text-sm font-bold uppercase tracking-wider text-brand">{sobre}</p>}
      <h2 id={id} className="mt-2 text-[1.75rem] leading-tight sm:text-4xl font-extrabold tracking-tight text-ink">{titulo}</h2>
      {texto && <p className="mt-4 text-base sm:text-lg leading-relaxed text-muted">{texto}</p>}
    </div>
  )
}

function Chip({ children, ouro = false }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${ouro ? 'bg-gold/20 text-[#7a5200]' : 'bg-surface2 text-brand ring-1 ring-line'}`}>{children}</span>
  )
}

function Lista({ itens }) {
  return (
    <ul className="space-y-3">
      {itens.map((t) => (
        <li key={t} className="flex gap-3 text-ink">
          <span className="mt-0.5 grid place-items-center w-6 h-6 rounded-full shrink-0 bg-surface2 text-brand ring-1 ring-line"><Icone nome="check" className="w-4 h-4" /></span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

// ---- 1. HERO --------------------------------------------------------------------------------------
function Hero() {
  const selos = ['Feito para o seu celular', 'Cada clube com os dados separados', 'Você combina o pagamento depois']
  return (
    <section id="inicio" className="relative overflow-hidden">
      <div className={`${CONTAINER} grid items-center gap-10 pt-8 pb-12 sm:pt-14 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-20`}>
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs sm:text-sm font-bold text-brand shadow-soft">
            <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" /> Para Clubes de Desbravadores
          </p>
          <h1 className="mt-5 text-[clamp(1.75rem,9.4vw,2.5rem)] leading-none sm:text-6xl xl:text-7xl font-black uppercase tracking-[0.04em] text-ink">DesbravaClube</h1>
          <span className="mt-4 block h-1.5 w-16 rounded-full bg-gold" aria-hidden="true" />
          <p className="mt-5 max-w-xl text-lg sm:text-xl leading-relaxed text-muted">
            Uma plataforma para gestão, desenvolvimento e conexão dos Clubes de Desbravadores.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link to="/conheca" className={BOTAO_PRIMARIO}>Conhecer o DesbravaClube <Icone nome="seta" className="w-5 h-5" /></Link>
            <Link to="/planos" className={BOTAO_SECUNDARIO}>Ver planos</Link>
          </div>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 text-sm text-muted">
            <LinkApp to="/login" className="inline-flex min-h-[44px] items-center font-bold text-brand underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md">Já tenho conta — entrar</LinkApp>
            <span aria-hidden="true">·</span>
            <Link to="/adquirir" className="inline-flex min-h-[44px] items-center font-bold text-brand underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md">Criar meu clube</Link>
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {selos.map((t) => (
              <li key={t} className="flex items-center gap-2 text-sm font-semibold text-ink">
                <span className="grid place-items-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 shrink-0"><Icone nome="check" className="w-3.5 h-3.5" /></span>{t}
              </li>
            ))}
          </ul>
        </div>
        {/* Composição: no celular, UM aparelho grande (rolagem vertical rápida); de sm para cima, três sobrepostos. */}
        <div className="relative mx-auto w-full max-w-[19rem] sm:max-w-md lg:max-w-lg">
          <div className="relative z-10 mx-auto w-[78%] sm:w-[50%]">
            <Celular tela={TELAS.inicio} prioridade />
          </div>
          <div className="absolute left-0 top-[9%] hidden w-[40%] sm:block"><Celular tela={TELAS.classe} /></div>
          <div className="absolute right-0 top-[9%] hidden w-[40%] sm:block"><Celular tela={TELAS.rede} /></div>
        </div>
      </div>
    </section>
  )
}

// ---- 2. CONHEÇA O APLICATIVO ----------------------------------------------------------------------
function Aplicativo() {
  return (
    <Secao id="recursos" fundo="bg-white/60">
      <Titulo sobre="Recursos" titulo="Conheça o aplicativo" texto="As áreas que o seu clube usa no dia a dia, do desbravador à coordenação." />
      <ul className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AREAS.map((a) => (
          <li key={a.id} className={`${CARTAO} flex gap-4 p-4 sm:p-5`}>
            <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface2 text-2xl ring-1 ring-line">{a.icone}</span>
            <div className="min-w-0">
              <h3 className="font-extrabold text-ink">{a.titulo}</h3>
              <p className="mt-1 text-[0.95rem] leading-relaxed text-muted">{a.texto}</p>
              <p className="mt-2"><Chip>{a.onde}</Chip></p>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

// ---- 3. VEJA COMO FUNCIONA (faixa de celulares) ---------------------------------------------------
function ComoFunciona() {
  return (
    <Secao id="como-funciona">
      <Titulo sobre="Como funciona" titulo="Veja como funciona" texto="Telas reais do aplicativo, com dados fictícios." />
      {/* Rolagem horizontal CONTIDA no celular (a página não ganha barra); grade a partir do desktop. */}
      <ul
        role="list"
        aria-label="Telas do aplicativo"
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0"
        style={{ scrollbarWidth: 'thin' }}
      >
        {FAIXA.map((f) => (
          <li key={f.tela} className="w-[62%] shrink-0 snap-center sm:w-[40%] md:w-[30%] lg:w-auto">
            <Celular tela={TELAS[f.tela]} />
            <h3 className="mt-4 font-extrabold text-ink">{f.titulo}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">{f.legenda}</p>
          </li>
        ))}
      </ul>
      <div className="mt-8 text-center">
        <Link to="/conheca" className={BOTAO_SECUNDARIO}>Ver a demonstração guiada <Icone nome="seta" className="w-5 h-5" /></Link>
      </div>
    </Secao>
  )
}

// ---- 4. FLUXO DO CLUBE ----------------------------------------------------------------------------
function Fluxo() {
  return (
    <Secao id="fluxo" fundo="bg-white/60">
      <Titulo sobre="Passo a passo" titulo="O fluxo do clube em 7 passos" texto="Da criação do clube à participação na Rede DBV." />
      <ol className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FLUXO.map((p, i) => (
          <li key={p.titulo} className={`${CARTAO} relative p-5 ${i === FLUXO.length - 1 ? 'sm:col-span-2 lg:col-span-1' : ''}`}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold text-lg font-extrabold text-[#07122f]" aria-hidden="true">{i + 1}</span>
            <h3 className="mt-3 font-extrabold text-ink"><span className="sr-only">Passo {i + 1}: </span>{p.titulo}</h3>
            <p className="mt-1 text-[0.95rem] leading-relaxed text-muted">{p.texto}</p>
          </li>
        ))}
      </ol>
    </Secao>
  )
}

// ---- 5. CLASSES -----------------------------------------------------------------------------------
function Classes() {
  return (
    <Secao id="classes">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="order-2 lg:order-1">
          <Titulo centro={false} sobre="Classes" titulo="A classe do desbravador, do primeiro requisito ao documento" texto="O coração do aplicativo: cada requisito com comprovação, avaliação e histórico." />
          <Lista itens={CLASSES_ITENS} />
          <ul aria-label="Classes regulares" className="mt-8 flex flex-wrap gap-3">
            {CLASSES_REGULARES.map((c) => (
              <li key={c} className="flex w-[4.5rem] flex-col items-center gap-1 text-center">
                <EscudoClasse nome={c} className="h-12 w-10" />
                <span className="text-xs font-bold text-ink">{c}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">Cada classe regular tem a sua versão avançada.</p>
        </div>
        <div className="order-1 lg:order-2">
          <div className="relative mx-auto w-full max-w-[19rem] sm:max-w-md">
            <div className="w-[62%]"><Celular tela={TELAS.classe} /></div>
            <div className="absolute right-0 top-[12%] w-[56%]"><Celular tela={TELAS.requisitos} /></div>
          </div>
        </div>
      </div>
    </Secao>
  )
}

// ---- 6. REDE DBV ----------------------------------------------------------------------------------
function Rede() {
  return (
    <Secao id="rede" fundo="bg-white/60">
      <div className="grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="mx-auto w-full max-w-[16rem] sm:max-w-xs"><Celular tela={TELAS.rede} /></div>
        <div>
          <Titulo centro={false} sobre="Rede DBV" titulo="Uma comunidade para os Clubes" texto="Os clubes se conhecem, se inspiram e celebram o que fazem, dentro de regras claras." />
          <p className="mb-4 flex flex-wrap gap-2"><Chip ouro>Disponível para clubes habilitados</Chip><Chip>Liberada aos poucos, clube a clube</Chip></p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {REDE_ITENS.map(([t, d]) => (
              <li key={t} className={`${CARTAO} p-4`}>
                <h3 className="font-extrabold text-ink">{t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{d}</p>
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-3xl border border-line bg-surface2 p-5">
            <h3 className="font-extrabold text-ink">Não é uma rede social aberta</h3>
            <ul className="mt-3 space-y-2">
              {REDE_NAO_E.map((t) => (
                <li key={t} className="flex gap-2 text-[0.95rem] text-muted">
                  <Icone nome="escudo" className="mt-0.5 h-5 w-5 shrink-0 text-brand" /><span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Secao>
  )
}

// ---- 7. GESTÃO ------------------------------------------------------------------------------------
function Gestao() {
  return (
    <Secao id="gestao">
      <Titulo sobre="Gestão" titulo="O clube inteiro, organizado" texto="As ferramentas da liderança, do pedido de entrada ao documento assinado." />
      <div className="grid items-start gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16">
        <ul className="order-2 grid gap-3 sm:grid-cols-2 lg:order-1">
          {GESTAO_ITENS.map((g) => (
            <li key={g.titulo} className={`${CARTAO} flex items-center gap-3 p-4`}>
              <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface2 text-xl ring-1 ring-line">{g.icone}</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-extrabold text-ink">{g.titulo}</h3>
                <p className="text-sm leading-snug text-muted">{g.texto}</p>
              </div>
              <span aria-hidden="true" className="text-xl text-faint">›</span>
            </li>
          ))}
        </ul>
        <div className="order-1 mx-auto w-full max-w-[16rem] sm:max-w-xs lg:order-2"><Celular tela={TELAS.gestao} /></div>
      </div>
      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted">
        As mensalidades são um controle do clube, com a chave Pix do próprio clube. O pagamento acontece fora do aplicativo.
      </p>
    </Secao>
  )
}

// ---- 8. ADMINISTRAÇÃO CENTRALIZADA (uma frase, sem detalhes) ---------------------------------------
function Administracao() {
  return (
    <section aria-label="Administração da plataforma" className="py-2">
      <p className={`${CONTAINER} text-center text-sm sm:text-base font-semibold text-muted`}>
        A plataforma tem administração centralizada, que mantém o serviço no ar e atende os clubes.
      </p>
    </section>
  )
}

// ---- 9. SEGURANÇA, PLANOS, FAQ, CTA FINAL -------------------------------------------------------
function Seguranca() {
  return (
    <Secao id="seguranca" fundo="bg-white/60">
      <Titulo sobre="Segurança e privacidade" titulo="Cuidado de verdade com os dados do seu clube" texto="Pensado desde o início para proteger os dados das suas crianças e adolescentes." />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SEGURANCA.map(([icone, t, d]) => (
          <li key={t} className={`${CARTAO} flex gap-4 p-5`}>
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-[#0b1b46] text-gold shrink-0"><Icone nome={icone} /></span>
            <div>
              <h3 className="font-extrabold text-ink">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

function Planos() {
  const [planos, setPlanos] = useState(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let vivo = true
    carregarPlanos().then((p) => { if (vivo) setPlanos(p) }).catch(() => { if (vivo) setErro(true) })
    return () => { vivo = false }
  }, [])

  return (
    <Secao id="planos">
      <Titulo sobre="Planos" titulo="Uma licença, tudo incluso" texto="Uma licença anual para o seu clube — não é mensalidade." />
      {planos === null && !erro && <p role="status" className="text-center text-muted">Carregando a oferta vigente…</p>}
      {(erro || (planos && planos.length === 0)) && (
        <div className="text-center">
          <p className="text-muted">Não conseguimos carregar a oferta agora.</p>
          <Link to="/adquirir" className={`mt-4 ${BOTAO_PRIMARIO}`}>Ver a licença</Link>
        </div>
      )}
      {planos && planos.length > 0 && (
        <ul className={`mx-auto grid gap-6 ${planos.length > 1 ? 'md:grid-cols-2 lg:grid-cols-3 max-w-6xl' : 'max-w-xl'}`}>
          {planos.map((p) => <CartaoPlano key={p.chave} plano={p} />)}
        </ul>
      )}
      <p className="mx-auto mt-6 max-w-xl text-center text-sm text-muted">
        Você cria a sua conta e o seu clube normalmente, e combina o pagamento direto com a gente.
      </p>
    </Secao>
  )
}

function CartaoPlano({ plano }) {
  const preco = (plano.precos || [])[0]
  const meta = preco?.metadata || {}
  const lim = plano.limites || {}
  const destaques = [
    lim.membros && `Até ${lim.membros} membros`,
    lim.clubes && `Até ${lim.clubes} ${lim.clubes === 1 ? 'clube' : 'clubes'}`,
    lim.administradores && `Até ${lim.administradores} administradores`,
    lim.armazenamento_mb && `${Math.round(lim.armazenamento_mb / 1024)} GB de armazenamento`,
    !plano.recursos && 'Todos os recursos incluídos',
  ].filter(Boolean)
  const destino = `/criar-clube?plano=${encodeURIComponent(plano.chave)}${preco ? `&ciclo=${encodeURIComponent(preco.ciclo)}` : ''}`
  return (
    <li className="rounded-3xl border border-line bg-surface p-6 sm:p-8 shadow-soft ring-2 ring-brand/30">
      {meta.campanha && <p className="inline-block rounded-full bg-gold/20 px-3 py-1 text-xs font-bold text-[#7a5200]">{meta.campanha}</p>}
      <h3 className="mt-3 text-2xl font-extrabold text-ink">{plano.nome}</h3>
      {plano.descricao && <p className="mt-2 text-muted">{plano.descricao}</p>}
      {preco && (
        <div className="mt-6">
          <div className="text-4xl font-extrabold text-ink">{formatarPreco(preco.valor_centavos, preco.moeda)}</div>
          <div className="text-sm text-muted">{preco.ciclo === 'anual' ? 'por ano, no cartão' : 'por mês'}</div>
          {(meta.parcelas_cartao && meta.parcela_centavos) || meta.pix_centavos ? (
            <div className="mt-4 space-y-1 rounded-2xl bg-surface2 p-4 text-sm text-ink">
              {meta.parcelas_cartao && meta.parcela_centavos && <p>Até {meta.parcelas_cartao}x de {formatarPreco(meta.parcela_centavos, preco.moeda)} sem juros para o clube</p>}
              {meta.pix_centavos && <p>{formatarPreco(meta.pix_centavos, preco.moeda)} no Pix</p>}
            </div>
          ) : null}
        </div>
      )}
      {destaques.length > 0 && <div className="mt-6"><Lista itens={destaques} /></div>}
      <LinkApp to={destino} className={`mt-8 w-full ${BOTAO_PRIMARIO}`}>Começar agora</LinkApp>
    </li>
  )
}

function Faq() {
  return (
    <Secao id="faq" fundo="bg-white/60">
      <Titulo sobre="FAQ" titulo="Perguntas frequentes" />
      <div className="mx-auto max-w-3xl divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
        {PERGUNTAS.map(([p, r]) => (
          <details key={p} className="group">
            <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold text-ink [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
              {p}
              <Icone nome="mais" className="w-5 h-5 shrink-0 text-brand motion-safe:transition-transform group-open:rotate-45" />
            </summary>
            <p className="px-5 pb-5 leading-relaxed text-muted">{r}</p>
          </details>
        ))}
      </div>
    </Secao>
  )
}

function ChamadaFinal() {
  return (
    <section className="bg-[#0b1b46]">
      <div className={`${CONTAINER} py-14 sm:py-20 text-center`}>
        <h2 className="mx-auto max-w-3xl text-3xl sm:text-4xl font-extrabold tracking-tight text-white">Leve o seu clube para a palma da mão.</h2>
        <p className="mx-auto mt-3 max-w-xl text-blue-100">Crie o seu clube agora e combine o pagamento depois.</p>
        <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
          <Link to="/adquirir" className={`${BOTAO_PRIMARIO} focus-visible:ring-offset-[#0b1b46]`}>Quero criar meu clube</Link>
          <Link to="/planos" className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-2xl border border-white/30 text-white font-bold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Ver planos</Link>
        </div>
      </div>
    </section>
  )
}

export function Rodape({ naLanding = true }) {
  const ancora = (h) => (naLanding ? h : `/${h}`)
  const WHATSAPP = 'https://wa.me/5581989499469?text=' + encodeURIComponent('Olá! Vim pelo site do DesbravaClube e quero saber mais.')
  const emBreve = 'text-slate-400 cursor-default'
  const link = 'inline-flex min-h-[44px] items-center hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded'
  return (
    <footer className="bg-[#07122f] text-slate-300">
      <div className={`${CONTAINER} grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4`}>
        <div>
          <Marca claro />
          <p className="mt-3 text-sm text-slate-400 max-w-xs">Seu clube na palma da mão. Produto independente para Clubes de Desbravadores.</p>
        </div>
        <nav aria-label="Produto">
          <h2 className="text-sm font-bold text-white">Produto</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><a href={ancora('#recursos')} className={link}>Recursos</a></li>
            <li><a href={ancora('#planos')} className={link}>Planos</a></li>
            <li><Link to="/conheca" className={link}>Conheça</Link></li>
            <li><Link to="/clubes" className={link}>Clubes</Link></li>
            <li><Link to="/parceiros" className={link}>Parceiros</Link></li>
            <li><Link to="/ajuda" className={link}>Como usar</Link></li>
            <li><LinkApp to="/login" className={link}>Entrar</LinkApp></li>
          </ul>
        </nav>
        <div>
          <h2 className="text-sm font-bold text-white">Suporte</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" data-testid="contato-whatsapp"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#25D366] px-4 font-bold text-[#07122f] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <span aria-hidden="true">💬</span> Falar no WhatsApp
              </a>
            </li>
            <li className="text-slate-400">(81) 98949-9469</li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Legal</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className={emBreve}>Privacidade (em breve)</li>
            <li className={emBreve}>Termos (em breve)</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className={`${CONTAINER} py-5 text-xs text-slate-400`}>
          © {new Date().getFullYear()} DesbravaClube — Thiago Miranda. Todos os direitos reservados.
          É proibida a reprodução, cópia ou distribuição, total ou parcial, do conteúdo, da marca, do código e do
          design deste site e do aplicativo sem autorização expressa do titular (Lei 9.610/98 e Lei 9.609/98).
        </p>
      </div>
    </footer>
  )
}

export default function Landing() {
  useMetaDaPagina(META_LANDING.titulo, META_LANDING.descricao, '/')
  return (
    <div className="min-h-full text-ink">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-bold focus:text-[#0b1b46] focus:shadow">Pular para o conteúdo</a>
      <Cabecalho />
      <main id="conteudo">
        <Hero />
        <Aplicativo />
        <ComoFunciona />
        <Fluxo />
        <Classes />
        <Rede />
        <Gestao />
        <Administracao />
        <Seguranca />
        <Planos />
        <Faq />
        <ChamadaFinal />
        <FaixaParceiros />
      </main>
      <Rodape />
    </div>
  )
}
