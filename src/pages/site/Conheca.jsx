import { useCallback, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import SiteLayout, { BOTAO_PRIMARIO, CONTAINER, useMetaDaPagina } from './SiteLayout.jsx'
import { CTA_FINAL, ETAPAS, indiceDoHash } from '../../lib/apresentacao/etapas.js'
import { MARCA_PRODUTO } from '../../lib/marca.js'
import VideoCurto from '../../components/VideoCurto.jsx'
import { Celular } from '../landing/Celular.jsx'
import { TELAS } from '../landing/telas.js'

// /conheca: demonstração guiada do produto em 8 etapas (Fase 6, item 7), com as telas REAIS do app (dados fictícios). Estrutura pronta para vídeo curto e
// mockup por etapa; o conteúdo mora em src/lib/apresentacao/etapas.js.
//   · uma etapa por vez, com Anterior/Próximo (≥ 44 px), pontos de progresso, setas do teclado e arrastar no celular;
//   · link direto por `#etapa-N` (o hash acompanha a etapa em uso, sem empilhar histórico);
//   · vídeo: só o poster + play; o iframe do youtube-nocookie nasce DEPOIS do toque — nunca toca sozinho;
//   · etapa com `telas`: celulares em CSS com as capturas reais; sem vídeo, sem player vazio e sem data prometida;
//   · sem imagem nem telas, a ilustração-padrão (número dourado + emblema do produto) ocupa o lugar, de propósito.

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2'
const BOTAO_NAV = `inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl font-bold transition-colors ${FOCO}`
const ARRASTE_MINIMO = 48 // px: menos que isso é toque, não arrasto

const pad = (n) => String(n).padStart(2, '0')

function SetaEsq({ className = 'w-5 h-5' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
}
function SetaDir({ className = 'w-5 h-5' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
}

// Ilustração-padrão quando a etapa ainda não tem mockup: degradê marinho, número dourado grande e o emblema.
export function IlustracaoPadrao({ numero, titulo }) {
  return (
    <div data-testid="ilustracao-padrao" role="img" aria-label={`Ilustração da etapa ${numero}: ${titulo}`}
      className="relative aspect-[4/3] sm:aspect-[16/10] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-[#07122f] via-[#0b1f4d] to-[#143a8a]">
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #ffffff 0, transparent 40%), radial-gradient(circle at 80% 80%, #f5b012 0, transparent 45%)' }} />
      <span className="absolute left-5 top-4 text-7xl sm:text-8xl font-black leading-none tracking-tighter text-[#f5b012]/90 select-none">{pad(numero)}</span>
      <img src={MARCA_PRODUTO.logoUrl} alt="" width="96" height="96" className="absolute bottom-5 right-5 h-20 w-20 sm:h-24 sm:w-24 rounded-2xl shadow-lg ring-2 ring-white/20" />
      <span className="absolute bottom-6 left-5 text-xs font-bold uppercase tracking-widest text-white/70">DesbravaClube</span>
    </div>
  )
}

// Vídeo curto mora em src/components/VideoCurto.jsx (reusado no tutorial); re-exportado aqui por compatibilidade.
export { VideoCurto }

// Celular(es) com a tela real da etapa, sobre um painel claro (o mesmo fundo suave do app).
function TelasDaEtapa({ chaves }) {
  return (
    <div data-testid="telas-da-etapa" className="flex items-start justify-center gap-3 rounded-2xl bg-surface2 px-4 py-6 ring-1 ring-line">
      {chaves.map((k, i) => (
        <div key={k} className={chaves.length > 1 ? 'w-[44%] max-w-[12rem]' : 'w-[62%] max-w-[15rem]'} style={chaves.length > 1 && i === 1 ? { marginTop: '1.5rem' } : undefined}>
          <Celular tela={TELAS[k]} />
        </div>
      ))}
    </div>
  )
}

function Etapa({ etapa }) {
  return (
    <article id={`etapa-${etapa.numero}`} aria-labelledby={`titulo-etapa-${etapa.numero}`} className="grid gap-6 lg:grid-cols-2 lg:items-center">
      <div>
        {etapa.video
          ? <VideoCurto key={etapa.video.youtubeId} youtubeId={etapa.video.youtubeId} poster={etapa.video.poster} titulo={etapa.titulo} />
          : etapa.telas
            ? <TelasDaEtapa chaves={etapa.telas} />
            : etapa.imagem
              ? <img src={etapa.imagem.src} alt={etapa.imagem.alt} className="w-full rounded-2xl object-cover shadow-md" />
              : <IlustracaoPadrao numero={etapa.numero} titulo={etapa.titulo} />}
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-brand">Etapa {pad(etapa.numero)} de {pad(ETAPAS.length)}</p>
        <h2 id={`titulo-etapa-${etapa.numero}`} className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">{etapa.titulo}</h2>
        <p className="mt-3 text-base leading-relaxed text-muted">{etapa.descricao}</p>
        {etapa.cta && (
          <Link to={etapa.cta.para} className={`mt-6 ${BOTAO_PRIMARIO}`}>{etapa.cta.rotulo}</Link>
        )}
      </div>
    </article>
  )
}

export default function Conheca() {
  useMetaDaPagina('Conheça o DesbravaClube', 'Demonstração guiada em 8 etapas, com telas reais do aplicativo: clube, desbravadores, classes, Rede DBV, gestão e coordenação.', '/conheca')
  const location = useLocation()
  const navigate = useNavigate()
  // A etapa em uso É o hash da URL (fonte única): link direto, voltar/avançar e os botões passam todos por aqui.
  const atual = indiceDoHash(location.hash)
  const toque = useRef(null)
  const palco = useRef(null)
  const total = ETAPAS.length
  const etapa = ETAPAS[atual]

  const irPara = useCallback((i) => {
    const alvo = Math.max(0, Math.min(total - 1, i))
    if (alvo === atual) return
    navigate({ hash: `#etapa-${alvo + 1}` }, { replace: true })
    palco.current?.focus({ preventScroll: true })
  }, [atual, total, navigate])

  const anterior = () => irPara(atual - 1)
  const proximo = () => irPara(atual + 1)

  const aoTeclar = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); proximo() }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); anterior() }
    else if (e.key === 'Home') { e.preventDefault(); irPara(0) }
    else if (e.key === 'End') { e.preventDefault(); irPara(total - 1) }
  }

  // arrastar no celular: só horizontal e só além do mínimo (rolagem vertical continua livre)
  const aoTocar = (e) => { const t = e.touches[0]; toque.current = { x: t.clientX, y: t.clientY } }
  const aoSoltar = (e) => {
    const inicio = toque.current; toque.current = null
    if (!inicio) return
    const t = e.changedTouches[0]
    const dx = t.clientX - inicio.x, dy = t.clientY - inicio.y
    if (Math.abs(dx) < ARRASTE_MINIMO || Math.abs(dx) < Math.abs(dy)) return
    if (dx < 0) proximo(); else anterior()
  }

  const ultima = atual === total - 1

  return (
    <SiteLayout>
      <section>
        <div className={`${CONTAINER} py-8 sm:py-12`}>
          <p className="text-xs font-bold uppercase tracking-widest text-brand">Demonstração guiada</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">Conheça o DesbravaClube</h1>
          <p className="mt-3 max-w-2xl text-muted">Em 8 etapas curtas, o que o aplicativo faz por desbravadores, pais, liderança e coordenação. As telas são reais, com dados fictícios.</p>
          {/* stepper: uma parada por etapa */}
          <ol aria-label="Etapas" className="mt-6 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap" style={{ scrollbarWidth: 'none' }}>
            {ETAPAS.map((e, i) => (
              <li key={e.id} className="shrink-0">
                <button type="button" onClick={() => irPara(i)} aria-current={i === atual ? 'step' : undefined}
                  aria-label={`Etapa ${e.numero}: ${e.titulo}`}
                  className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition-colors ${FOCO} ${
                    i === atual ? 'bg-gradient-to-r from-brand via-brand to-brand2 text-white shadow-glow' : 'border border-line bg-surface text-ink hover:bg-surface2'}`}>
                  <span className="tabular-nums">{pad(e.numero)}</span>
                  <span className="hidden md:inline">{e.titulo}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className={`${CONTAINER} py-8`}>
        <div ref={palco} tabIndex={-1} onKeyDown={aoTeclar} onTouchStart={aoTocar} onTouchEnd={aoSoltar}
          role="region" aria-roledescription="apresentação" aria-label={`Etapa ${etapa.numero} de ${total}`}
          className={`rounded-3xl border border-line bg-surface p-5 sm:p-8 shadow-soft outline-none ${FOCO}`}>
          <div key={etapa.id} className="motion-safe:animate-[conheca-entrar_.25s_ease-out]">
            <Etapa etapa={etapa} />
          </div>

          {/* controles */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <button type="button" onClick={anterior} disabled={atual === 0}
              className={`${BOTAO_NAV} border border-line bg-surface text-ink hover:bg-surface2 disabled:opacity-40 disabled:cursor-not-allowed`}>
              <SetaEsq /> <span>Anterior</span>
            </button>
            <ol aria-label="Progresso" className="order-last flex w-full items-center justify-center gap-0.5 sm:order-none sm:w-auto sm:gap-1.5">
              {ETAPAS.map((e, i) => (
                <li key={e.id}>
                  <button type="button" onClick={() => irPara(i)} aria-label={`Ir para a etapa ${e.numero}`} aria-current={i === atual ? 'step' : undefined}
                    className={`grid h-11 w-8 place-items-center sm:w-11 ${FOCO} rounded-full`}>
                    <span className={`block rounded-full transition-all ${i === atual ? 'h-2.5 w-6 bg-gold' : 'h-2 w-2 bg-faint/40'}`} />
                  </button>
                </li>
              ))}
            </ol>
            {ultima
              ? <Link to={CTA_FINAL.para} className={`${BOTAO_NAV} bg-gradient-to-r from-brand via-brand to-brand2 text-white shadow-glow`}>{CTA_FINAL.rotulo} <SetaDir /></Link>
              : <button type="button" onClick={proximo} className={`${BOTAO_NAV} bg-gradient-to-r from-brand via-brand to-brand2 text-white shadow-glow`}><span>Próximo</span> <SetaDir /></button>}
          </div>
          <p className="mt-3 text-center text-xs text-muted">Use as setas do teclado ou arraste para o lado no celular.</p>
        </div>
      </div>
      <style>{'@keyframes conheca-entrar{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}'}</style>
    </SiteLayout>
  )
}
