import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import LinkApp from '../components/LinkApp.jsx'
import { carregarPlanos, formatarPreco } from '../services/comercial.js'
import { Icone } from './landing/Icones.jsx'
import { NotebookPainel, CelularClasse, CardTentativas, ArvoreMulticlube } from './landing/Mockups.jsx'

// Site comercial PÚBLICO da plataforma (a raiz "/" sem sessão). Não usa <Logo/> nem as cores
// --c-brand de propósito: aqueles leem a marca do CLUBE em uso, e esta página é da PLATAFORMA.
// Preço e composição da licença vêm do banco (planos_disponiveis) — nada de preço hardcoded aqui.
// Textos sobre responsáveis, documentos e hierarquia descrevem só o que o sistema faz hoje.

const NAVY = 'text-[#0b1b46]'
const CONTAINER = 'mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8'
const BOTAO_PRIMARIO = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-xl bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5b012] focus-visible:ring-offset-2'
const BOTAO_SECUNDARIO = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-[#0b1b46] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d4ed8] focus-visible:ring-offset-2'
const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d4ed8] focus-visible:ring-offset-2 rounded-md'

const NAV = [
  { href: '#funcionalidades', rotulo: 'Funcionalidades' },
  { href: '#para-clubes', rotulo: 'Para Clubes' },
  { href: '#documentos', rotulo: 'Documentos' },
  { href: '#planos', rotulo: 'Planos' },
  { href: '#faq', rotulo: 'FAQ' },
]

function Marca({ claro = false }) {
  return (
    <span className="flex items-center gap-2.5">
      <img src="/logo.png" alt="" width="36" height="36" className="w-9 h-9 rounded-full" />
      <span className={`text-lg font-extrabold tracking-tight ${claro ? 'text-white' : NAVY}`}>DesbravaClube</span>
    </span>
  )
}

function Cabecalho() {
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
    e.preventDefault()
    flushSync(() => setAberto(false))
    const alvo = document.querySelector(href)
    if (!alvo) return
    alvo.scrollIntoView()
    alvo.focus({ preventScroll: true })
    history.pushState(null, '', href)
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className={`${CONTAINER} flex h-16 items-center justify-between gap-4`}>
        <a href="#inicio" className={`inline-flex min-h-[44px] items-center ${FOCO}`} aria-label="DesbravaClube — início"><Marca /></a>
        <nav aria-label="Principal" className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {NAV.map((n) => (
              <li key={n.href}><a href={n.href} className={`inline-flex min-h-[44px] items-center text-sm font-semibold text-slate-600 hover:text-[#0b1b46] ${FOCO}`}>{n.rotulo}</a></li>
            ))}
          </ul>
        </nav>
        <div className="hidden lg:flex items-center gap-3">
          <LinkApp to="/login" className={`inline-flex min-h-[44px] items-center text-sm font-bold ${NAVY} px-3 hover:underline ${FOCO}`}>Entrar</LinkApp>
          <Link to="/adquirir" className={`${BOTAO_PRIMARIO} min-h-[42px] px-5 text-sm`}>Começar agora</Link>
        </div>
        <button
          ref={botao}
          type="button"
          className={`lg:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg border border-slate-200 ${NAVY} ${FOCO}`}
          aria-expanded={aberto}
          aria-controls="menu-movel"
          aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setAberto((v) => !v)}
        >
          <Icone nome={aberto ? 'fechar' : 'menu'} className="w-6 h-6" />
        </button>
      </div>
      <div id="menu-movel" hidden={!aberto} className="lg:hidden border-t border-slate-200 bg-white">
        <nav aria-label="Menu" className={`${CONTAINER} py-3`}>
          <ul className="flex flex-col">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} onClick={(e) => irPara(e, n.href)} className={`flex min-h-[48px] items-center text-base font-semibold ${NAVY} ${FOCO}`}>{n.rotulo}</a>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-3 pb-2">
            <LinkApp to="/login" className={BOTAO_SECUNDARIO}>Entrar</LinkApp>
            <Link to="/adquirir" className={BOTAO_PRIMARIO}>Começar agora</Link>
          </div>
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  const indicadores = ['Gestão multiclube', 'Acesso dos responsáveis', 'Documentos verificáveis', '100% responsivo']
  return (
    <section id="inicio" className="relative overflow-hidden bg-gradient-to-b from-[#eef3ff] to-white">
      <div className={`${CONTAINER} grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-24`}>
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-[#f5b012]/50 bg-[#fff8e6] px-3 py-1 text-xs sm:text-sm font-semibold text-[#7a5200]">
            <Icone nome="estrela" className="w-4 h-4" /> Gestão completa para Clubes de Desbravadores
          </p>
          <h1 className={`mt-5 text-4xl sm:text-5xl xl:text-6xl font-extrabold leading-[1.08] tracking-tight ${NAVY}`}>
            Seu clube organizado.<br /><span className="text-[#1d4ed8]">Sua missão em movimento.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-600 leading-relaxed">
            Classes, especialidades, presença, atividades, responsáveis, documentos e gestão em uma única plataforma.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link to="/adquirir" className={BOTAO_PRIMARIO}>Quero criar meu clube <Icone nome="seta" className="w-5 h-5" /></Link>
            <a href="#funcionalidades" className={BOTAO_SECUNDARIO}>Conhecer funcionalidades</a>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Já usa o DesbravaClube? <LinkApp to="/login" className={`inline-flex min-h-[44px] items-center font-bold text-[#1d4ed8] underline ${FOCO}`}>Já tenho conta — entrar</LinkApp>
          </p>
          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 max-w-lg">
            {indicadores.map((t) => (
              <li key={t} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <span className="grid place-items-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 shrink-0"><Icone nome="check" className="w-4 h-4" /></span>{t}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
          <NotebookPainel />
          <CelularClasse className="hidden sm:block absolute -bottom-10 -right-2 lg:-right-8" />
        </div>
      </div>
    </section>
  )
}

function Secao({ id, fundo = 'bg-white', children, className = '' }) {
  return (
    <section id={id} tabIndex={-1} className={`${fundo} scroll-mt-16 py-16 sm:py-20 lg:py-24 focus:outline-none ${className}`}>
      <div className={CONTAINER}>{children}</div>
    </section>
  )
}

function Titulo({ sobre, titulo, texto, claro = false, centro = true }) {
  return (
    <div className={`${centro ? 'mx-auto text-center' : ''} max-w-3xl mb-10 lg:mb-14`}>
      {sobre && <p className={`text-sm font-bold uppercase tracking-wider ${claro ? 'text-[#f5b012]' : 'text-[#1d4ed8]'}`}>{sobre}</p>}
      <h2 className={`mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight ${claro ? 'text-white' : NAVY}`}>{titulo}</h2>
      {texto && <p className={`mt-4 text-lg leading-relaxed ${claro ? 'text-blue-100' : 'text-slate-600'}`}>{texto}</p>}
    </div>
  )
}

function Jornada() {
  const etapas = [
    ['Cadastro', 'usuario'], ['Clube', 'unidades'], ['Classe', 'classes'], ['Atividades', 'atividades'],
    ['Avaliação', 'avaliacoes'], ['Documentos', 'documentos'], ['Investidura', 'estrela'],
  ]
  return (
    <Secao id="jornada" fundo="bg-white">
      <Titulo sobre="A jornada" titulo="Do cadastro à investidura, tudo conectado." texto="Cada etapa alimenta a próxima: o que o desbravador faz vira avaliação, a avaliação vira progresso e o progresso vira documento." />
      <ol className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 lg:gap-2">
        {etapas.map(([nome, icone], i) => (
          <li key={nome} className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4 text-center last:col-span-2 sm:last:col-span-1">
            <span className="grid place-items-center w-11 h-11 rounded-xl bg-[#0b1b46] text-[#f5b012] shrink-0"><Icone nome={icone} className="w-5 h-5" /></span>
            <span>
              <span className="block text-xs font-semibold text-slate-500">Etapa {i + 1}</span>
              <span className={`block font-bold ${NAVY}`}>{nome}</span>
            </span>
          </li>
        ))}
      </ol>
    </Secao>
  )
}

const FUNCIONALIDADES = [
  ['membros', 'Gestão de membros', 'Cadastro, cargos, vínculos e aprovação de entrada.'],
  ['classes', 'Classes', 'Requisitos organizados por classe, com progresso de cada membro.'],
  ['especialidades', 'Especialidades', 'Acompanhamento e avaliação de especialidades.'],
  ['presenca', 'Presença', 'Chamada e apontamentos de cada encontro.'],
  ['atividades', 'Atividades e evidências', 'Envio de texto ou foto direto do celular.'],
  ['avaliacoes', 'Avaliações', 'Fila única para aprovar ou pedir correção, com histórico.'],
  ['responsaveis', 'Responsáveis', 'Pais e responsáveis vinculados aos filhos.'],
  ['mensalidades', 'Mensalidades', 'Controle do que está pago e do que está pendente.'],
  ['documentos', 'Documentos', 'PDF gerado pelo sistema a partir dos dados do clube.'],
  ['assinatura', 'Assinatura eletrônica', 'Assinatura individual ou em lote, com vários signatários.'],
  ['qrcode', 'Inscrições por QR Code', 'Código do clube para pedir entrada sem papelada.'],
  ['unidades', 'Unidades', 'Organização por unidades, com pontuação própria.'],
  ['indicadores', 'Indicadores', 'Ranking, pontos e presença para acompanhar o clube.'],
]

function Funcionalidades() {
  return (
    <Secao id="funcionalidades" fundo="bg-slate-50">
      <Titulo sobre="Funcionalidades" titulo="Tudo que seu clube precisa em um só lugar" texto="Do dia a dia do desbravador à rotina da diretoria, sem planilhas espalhadas nem grupos de mensagens perdidos." />
      <ul className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {FUNCIONALIDADES.map(([icone, titulo, texto]) => (
          <li key={titulo} className="flex gap-4 sm:block rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-[#e8efff] text-[#1d4ed8]"><Icone nome={icone} /></span>
            <div>
              <h3 className={`sm:mt-4 font-bold ${NAVY}`}>{titulo}</h3>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">{texto}</p>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

function Lista({ itens, claro = false }) {
  return (
    <ul className="space-y-3">
      {itens.map((t) => (
        <li key={t} className={`flex gap-3 ${claro ? 'text-blue-50' : 'text-slate-700'}`}>
          <span className={`mt-0.5 grid place-items-center w-6 h-6 rounded-full shrink-0 ${claro ? 'bg-[#f5b012]/20 text-[#f5b012]' : 'bg-[#e8efff] text-[#1d4ed8]'}`}><Icone nome="check" className="w-4 h-4" /></span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

function Desbravador() {
  return (
    <Secao id="desbravador" fundo="bg-white">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <Titulo centro={false} sobre="Para o desbravador" titulo="Cada desbravador acompanha sua própria jornada" texto="Pelo celular, ele vê a classe atual, o que falta e o que já foi aprovado — e envia as atividades na hora." />
          <Lista itens={[
            'Classe atual e progresso sempre à vista',
            'Requisitos com status: a fazer, enviado, correção, aprovado',
            'Envio de atividade com texto ou foto',
            'Correção explicada pelo instrutor e reenvio sem perder o histórico',
            'Especialidades e conquistas registradas',
          ]} />
        </div>
        <div className="grid gap-6 sm:grid-cols-[auto_1fr] items-center justify-items-center">
          <CelularClasse />
          <CardTentativas />
        </div>
      </div>
    </Secao>
  )
}

function Diretoria() {
  const blocos = [
    ['membros', 'Membros e unidades'], ['presenca', 'Presença e apontamentos'], ['avaliacoes', 'Fila de avaliações'],
    ['mensalidades', 'Mensalidades'], ['documentos', 'Central de documentos'], ['qrcode', 'Inscrições por código'],
    ['indicadores', 'Ranking e indicadores'], ['assinatura', 'Assinaturas em lote'],
  ]
  return (
    <Secao id="para-clubes" fundo="bg-slate-50">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="order-2 lg:order-1"><NotebookPainel /></div>
        <div className="order-1 lg:order-2">
          <Titulo centro={false} sobre="Para a diretoria" titulo="Menos planilha. Mais tempo para liderar." texto="Tudo o que a diretoria precisa acompanhar, num painel só — com cada ação registrada." />
          <ul className="grid gap-3 sm:grid-cols-2">
            {blocos.map(([icone, t]) => (
              <li key={t} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <span className="grid place-items-center w-9 h-9 rounded-lg bg-[#0b1b46] text-[#f5b012] shrink-0"><Icone nome={icone} className="w-5 h-5" /></span>
                <span className={`text-sm font-semibold ${NAVY}`}>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Secao>
  )
}

function Responsaveis() {
  const itens = [
    ['responsaveis', 'Filhos vinculados', 'O vínculo é confirmado pela diretoria do clube.'],
    ['estrela', 'Pontuação', 'Os pontos que o filho conquistou no clube.'],
    ['presenca', 'Presenças e faltas', 'Acompanhamento da frequência nos encontros.'],
    ['mensalidades', 'Mensalidade pendente', 'Aviso do que está em aberto, com a chave Pix do clube.'],
    ['escudo', 'Consentimento', 'O responsável concede ou revoga o consentimento, com registro.'],
  ]
  return (
    <Secao id="responsaveis" fundo="bg-white">
      <Titulo sobre="Para os responsáveis" titulo="Os responsáveis também fazem parte da jornada." texto="Depois que a diretoria confirma o vínculo, pais e responsáveis acompanham o filho pelo próprio celular." />
      <ul className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {itens.map(([icone, t, d]) => (
          <li key={t} className="flex gap-4 sm:block rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-[#fff3d6] text-[#8a5a00]"><Icone nome={icone} /></span>
            <div>
              <h3 className={`sm:mt-4 font-bold ${NAVY}`}>{t}</h3>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">{d}</p>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

function Documentos() {
  const fluxo = [['Dossiê', 'classes'], ['PDF', 'documentos'], ['Revisão', 'avaliacoes'], ['Assinatura', 'assinatura'], ['QR Code', 'qrcode'], ['Verificação', 'escudo']]
  return (
    <Secao id="documentos" fundo="bg-[#0b1b46]">
      <Titulo claro sobre="Documentos" titulo="Documentos que saem do digital prontos para o fluxo de assinatura." texto="O que foi registrado e aprovado no sistema vira documento — sem redigitar nada." />
      <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {fluxo.map(([nome, icone], i) => (
          <li key={nome} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
            <span className="mx-auto grid place-items-center w-11 h-11 rounded-xl bg-[#f5b012] text-[#0b1b46]"><Icone nome={icone} className="w-5 h-5" /></span>
            <span className="mt-2 block text-xs text-blue-200">Passo {i + 1}</span>
            <span className="block font-bold text-white">{nome}</span>
          </li>
        ))}
      </ol>
      <div className="mt-12 grid gap-8 lg:grid-cols-2">
        <Lista claro itens={[
          'PDF gerado pelo próprio sistema, a partir dos dados aprovados',
          'Revisão antes da assinatura, com pedido de ajuste quando necessário',
          'Assinatura eletrônica com um ou mais signatários',
        ]} />
        <Lista claro itens={[
          'QR Code para verificação pública do documento',
          'Versões e histórico preservados — nada é sobrescrito em silêncio',
          'Assinaturas podem ser revogadas, e isso também fica registrado',
        ]} />
      </div>
    </Secao>
  )
}

function Multiclube() {
  return (
    <Secao id="multiclube" fundo="bg-white">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <Titulo centro={false} sobre="Multiclube" titulo="Uma plataforma. Vários clubes. Dados separados." texto="Cada clube funciona no seu próprio espaço. Quem participa de mais de um clube alterna entre eles, e cada um enxerga só o que é seu." />
          <Lista itens={['Membros próprios', 'Gestão e diretoria próprias', 'Arquivos e fotos próprios', 'Configurações e identidade próprias', 'Permissões definidas por cargo']} />
        </div>
        <ArvoreMulticlube />
      </div>
    </Secao>
  )
}

function Hierarquia() {
  const niveis = ['Associação / Missão / Campo', 'Região', 'Distrito', 'Clube']
  return (
    <Secao id="institucional" fundo="bg-slate-50">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <ol className="space-y-3" aria-label="Níveis institucionais, do mais amplo ao clube">
          {niveis.map((n, i) => (
            <li key={n} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4" style={{ marginLeft: `${i * 6}%` }}>
              <span className="grid place-items-center w-9 h-9 rounded-lg bg-[#e8efff] text-[#1d4ed8] shrink-0"><Icone nome={i === niveis.length - 1 ? 'bandeira' : 'camadas'} className="w-5 h-5" /></span>
              <span className={`font-bold ${NAVY}`}>{n}</span>
            </li>
          ))}
        </ol>
        <div>
          <Titulo centro={false} sobre="Institucional" titulo="Pensado para a estrutura dos Desbravadores" texto="Distrito, região e associação, missão ou campo têm um portal próprio, com a visão que o papel de cada um permite." />
          <p className="text-slate-600 leading-relaxed">
            Liderança institucional acompanha o que é da sua área. Os dados privados de cada clube — fotos,
            evidências e informações dos membros — continuam sob a gestão do próprio clube.
          </p>
        </div>
      </div>
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
    <Secao id="planos" fundo="bg-white">
      <Titulo sobre="Planos" titulo="Uma licença, tudo incluso" texto="Licença anual para o clube — não é mensalidade." />
      {planos === null && !erro && <p role="status" className="text-center text-slate-500">Carregando a oferta vigente…</p>}
      {(erro || (planos && planos.length === 0)) && (
        <div className="text-center">
          <p className="text-slate-600">Não conseguimos carregar a oferta agora.</p>
          <Link to="/adquirir" className={`mt-4 ${BOTAO_PRIMARIO}`}>Ver planos</Link>
        </div>
      )}
      {planos && planos.length > 0 && (
        <ul className={`mx-auto grid gap-6 ${planos.length > 1 ? 'md:grid-cols-2 lg:grid-cols-3 max-w-6xl' : 'max-w-xl'}`}>
          {planos.map((p) => <CartaoPlano key={p.chave} plano={p} />)}
        </ul>
      )}
      <p className="mx-auto mt-6 max-w-xl text-center text-sm text-slate-500">
        Pagamento online ainda não integrado: você cria a conta e o clube normalmente, e a cobrança é combinada com a equipe da plataforma.
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
    <li className="rounded-3xl border-2 border-[#1d4ed8] bg-white p-6 sm:p-8 shadow-[0_30px_60px_-40px_rgba(29,78,216,0.6)]">
      {meta.campanha && <p className="inline-block rounded-full bg-[#fff3d6] px-3 py-1 text-xs font-bold text-[#7a5200]">{meta.campanha}</p>}
      <h3 className={`mt-3 text-2xl font-extrabold ${NAVY}`}>{plano.nome}</h3>
      {plano.descricao && <p className="mt-2 text-slate-600">{plano.descricao}</p>}
      {preco && (
        <div className="mt-6">
          <div className={`text-4xl font-extrabold ${NAVY}`}>{formatarPreco(preco.valor_centavos, preco.moeda)}</div>
          <div className="text-sm text-slate-500">{preco.ciclo === 'anual' ? 'por ano, no cartão' : 'por mês'}</div>
          {(meta.parcelas_cartao && meta.parcela_centavos) || meta.pix_centavos ? (
            <div className="mt-4 space-y-1 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
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

function Seguranca() {
  const itens = [
    ['camadas', 'Clubes separados', 'Os dados de um clube não aparecem para outro.'],
    ['usuario', 'Níveis de acesso', 'Cada cargo vê e faz só o que lhe cabe.'],
    ['responsaveis', 'Responsáveis vinculados', 'Só depois da confirmação da diretoria.'],
    ['cadeado', 'Documentos privados', 'Arquivos e evidências não ficam públicos.'],
    ['nuvem', 'Armazenamento controlado', 'Espaço por clube, acompanhado pelo sistema.'],
    ['historico', 'Histórico de ações', 'Aprovações, assinaturas e revogações registradas.'],
  ]
  return (
    <Secao id="seguranca" fundo="bg-slate-50">
      <Titulo sobre="Segurança" titulo="Cada clube no seu espaço." />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {itens.map(([icone, t, d]) => (
          <li key={t} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-[#0b1b46] text-[#f5b012] shrink-0"><Icone nome={icone} /></span>
            <div>
              <h3 className={`font-bold ${NAVY}`}>{t}</h3>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

const PERGUNTAS = [
  ['O DesbravaClube funciona no celular?', 'Sim. Ele foi feito primeiro para o celular, e também funciona no computador e no tablet.'],
  ['Preciso instalar aplicativo?', 'Não é obrigatório. Basta abrir pelo navegador; se quiser, dá para adicionar à tela inicial e usar como um aplicativo.'],
  ['Posso cadastrar mais de um clube?', 'Sim. Cada clube tem seus dados separados, e a mesma pessoa pode participar de mais de um clube e alternar entre eles. A quantidade de clubes incluída aparece na licença.'],
  ['Os responsáveis possuem acesso?', 'Sim. Depois que a diretoria confirma o vínculo, o responsável acompanha pontos, presenças e faltas, mensalidade pendente e registra o consentimento do filho.'],
  ['Como funcionam Classes e Especialidades?', 'O desbravador vê os requisitos e envia as atividades. Instrutores e diretoria avaliam: aprovam ou pedem correção com um comentário. Cada tentativa fica guardada no histórico.'],
  ['Posso enviar atividades pelo celular?', 'Sim, com texto ou foto, direto na tela do requisito.'],
  ['Como funcionam os documentos?', 'O sistema gera o PDF a partir dos dados aprovados. O documento passa por revisão, recebe as assinaturas eletrônicas — de um ou mais signatários — e ganha um QR Code para verificação pública.'],
  ['O clube pode usar QR Code para inscrições?', 'Sim. A liderança gera um código do clube com QR Code; quem escaneia pede a entrada e a diretoria aprova.'],
  ['Existe acesso institucional?', 'Sim. Distrito, região e associação, missão ou campo têm um portal próprio, com a visão que cada papel permite. Os dados privados de cada clube continuam sob a gestão do clube.'],
  ['Como funciona a licença?', 'É uma licença anual para o clube, não uma mensalidade. O valor vigente e as condições no cartão e no Pix aparecem na seção Planos. Nesta fase, o pagamento é combinado diretamente com a equipe da plataforma.'],
]

function Faq() {
  return (
    <Secao id="faq" fundo="bg-white">
      <Titulo sobre="FAQ" titulo="Perguntas frequentes" />
      <div className="mx-auto max-w-3xl divide-y divide-slate-200 rounded-2xl border border-slate-200">
        {PERGUNTAS.map(([p, r]) => (
          <details key={p} className="group">
            <summary className={`flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold ${NAVY} [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1d4ed8]`}>
              {p}
              <Icone nome="mais" className="w-5 h-5 shrink-0 text-[#1d4ed8] transition-transform group-open:rotate-45" />
            </summary>
            <p className="px-5 pb-5 text-slate-600 leading-relaxed">{r}</p>
          </details>
        ))}
      </div>
    </Secao>
  )
}

function ChamadaFinal() {
  return (
    <section className="bg-[#0b1b46]">
      <div className={`${CONTAINER} py-16 sm:py-20 text-center`}>
        <h2 className="mx-auto max-w-3xl text-3xl sm:text-4xl font-extrabold tracking-tight text-white">Pronto para levar a gestão do seu clube para outro nível?</h2>
        <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
          <Link to="/adquirir" className={`${BOTAO_PRIMARIO} bg-[#f5b012] hover:bg-[#ffc23a] text-[#0b1b46] focus-visible:ring-white focus-visible:ring-offset-[#0b1b46]`}>Quero criar meu clube</Link>
          <a href="#planos" className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-xl border border-white/30 text-white font-bold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Ver planos</a>
        </div>
      </div>
    </section>
  )
}

function Rodape() {
  const emBreve = 'text-slate-400 cursor-default'
  return (
    <footer className="bg-[#07122f] text-slate-300">
      <div className={`${CONTAINER} grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4`}>
        <div>
          <Marca claro />
          <p className="mt-3 text-sm text-slate-400 max-w-xs">Gestão completa para Clubes de Desbravadores.</p>
        </div>
        <nav aria-label="Produto">
          <h2 className="text-sm font-bold text-white">Produto</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><a href="#funcionalidades" className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Funcionalidades</a></li>
            <li><a href="#planos" className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Planos</a></li>
            <li><LinkApp to="/login" className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Entrar</LinkApp></li>
          </ul>
        </nav>
        <div>
          <h2 className="text-sm font-bold text-white">Suporte</h2>
          <ul className="mt-3 space-y-2 text-sm"><li className={emBreve}>Contato (em breve)</li></ul>
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
        <p className={`${CONTAINER} py-5 text-xs text-slate-400`}>© {new Date().getFullYear()} DesbravaClube</p>
      </div>
    </footer>
  )
}

export default function Landing() {
  return (
    <div className="min-h-full bg-white text-slate-800">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-bold focus:text-[#0b1b46] focus:shadow">Pular para o conteúdo</a>
      <Cabecalho />
      <main id="conteudo">
        <Hero />
        <Jornada />
        <Funcionalidades />
        <Desbravador />
        <Diretoria />
        <Responsaveis />
        <Documentos />
        <Multiclube />
        <Hierarquia />
        <Planos />
        <Seguranca />
        <Faq />
        <ChamadaFinal />
      </main>
      <Rodape />
    </div>
  )
}
