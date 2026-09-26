import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import LinkApp from '../components/LinkApp.jsx'
import { carregarPlanos, formatarPreco } from '../services/comercial.js'
import { Icone } from './landing/Icones.jsx'
import { NotebookPainel, CelularClasse, CardTentativas } from './landing/Mockups.jsx'
import { MARCA_PRODUTO } from '../lib/marca.js'

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
  { href: '#recursos', rotulo: 'Recursos' },
  { href: '#como-funciona', rotulo: 'Como funciona' },
  { href: '#seguranca', rotulo: 'Segurança' },
  { href: '#planos', rotulo: 'Planos' },
  { href: '#faq', rotulo: 'FAQ' },
]

function Marca({ claro = false }) {
  return (
    <span className="flex items-center gap-2.5">
      <img src={MARCA_PRODUTO.logoUrl} alt="" width="36" height="36" className="w-9 h-9 rounded-xl" />
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
          <Link to="/adquirir" className={`${BOTAO_PRIMARIO} min-h-[42px] px-5 text-sm`}>Criar meu clube</Link>
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
            <Link to="/adquirir" className={BOTAO_PRIMARIO}>Criar meu clube</Link>
          </div>
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  const selos = ['Feito para o celular', 'Cada clube isolado', 'Pagamento combinado depois']
  return (
    <section id="inicio" className="relative overflow-hidden bg-[#0b1b46] text-white">
      {/* Fundo decorativo em CSS puro (sem imagem): brilho azul + trilha de estrelas. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-[#1d4ed8]/50 blur-3xl" />
        <div className="absolute -bottom-40 -left-24 h-80 w-80 rounded-full bg-[#f5b012]/20 blur-3xl" />
        <svg className="absolute inset-x-0 bottom-0 h-24 w-full text-white" viewBox="0 0 1440 96" preserveAspectRatio="none"><path fill="currentColor" d="M0 64c240 32 480 32 720 0s480-32 720 0v32H0Z" /></svg>
      </div>
      <div className={`${CONTAINER} relative grid items-center gap-10 pt-10 pb-28 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-36`}>
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs sm:text-sm font-semibold text-[#ffd873]">
            <Icone nome="estrela" className="w-4 h-4" /> Para Clubes de Desbravadores
          </p>
          <h1 className="mt-5 text-[2.35rem] leading-[1.08] sm:text-5xl xl:text-6xl font-extrabold tracking-tight">
            O clube na <span className="text-[#f5b012]">palma da mão</span>.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-blue-100 leading-relaxed">
            Classes, avaliações, documentos, mensalidades e comunicação do clube num só app — pelo celular,
            sem papelada e sem planilha espalhada.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link to="/adquirir" className={`${BOTAO_PRIMARIO} bg-[#f5b012] hover:bg-[#ffc23a] text-[#0b1b46] focus-visible:ring-white focus-visible:ring-offset-[#0b1b46]`}>Criar meu clube <Icone nome="seta" className="w-5 h-5" /></Link>
            <Link to="/planos" className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-xl border border-white/30 text-white font-bold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Ver planos</Link>
          </div>
          <p className="mt-3 text-sm text-blue-100">
            Já usa o DesbravaClube? <LinkApp to="/login" className="inline-flex min-h-[44px] items-center font-bold text-white underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-md">Já tenho conta — entrar</LinkApp>
          </p>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
            {selos.map((t) => (
              <li key={t} className="flex items-center gap-2 text-sm font-semibold text-blue-50">
                <span className="grid place-items-center w-5 h-5 rounded-full bg-emerald-400/20 text-emerald-300 shrink-0"><Icone nome="check" className="w-3.5 h-3.5" /></span>{t}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative mx-auto w-full max-w-xs sm:max-w-sm lg:max-w-md">
          <CelularClasse className="mx-auto" />
        </div>
      </div>
    </section>
  )
}

function Secao({ id, fundo = 'bg-white', children, className = '' }) {
  return (
    <section id={id} tabIndex={-1} className={`${fundo} scroll-mt-16 py-14 sm:py-20 lg:py-24 focus:outline-none ${className}`}>
      <div className={CONTAINER}>{children}</div>
    </section>
  )
}

function Titulo({ sobre, titulo, texto, claro = false, centro = true }) {
  return (
    <div className={`${centro ? 'mx-auto text-center' : ''} max-w-3xl mb-8 lg:mb-12`}>
      {sobre && <p className={`text-sm font-bold uppercase tracking-wider ${claro ? 'text-[#f5b012]' : 'text-[#1d4ed8]'}`}>{sobre}</p>}
      <h2 className={`mt-2 text-[1.75rem] leading-tight sm:text-4xl font-extrabold tracking-tight ${claro ? 'text-white' : NAVY}`}>{titulo}</h2>
      {texto && <p className={`mt-4 text-base sm:text-lg leading-relaxed ${claro ? 'text-blue-100' : 'text-slate-600'}`}>{texto}</p>}
    </div>
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

const PROBLEMAS = [
  ['papel', 'Papelada que se perde', 'Fichas, cartões e assinaturas espalhados em pastas e fotos no WhatsApp.', 'Tudo registrado no app, com documento gerado pelo sistema.'],
  ['classes', 'Classes difíceis de acompanhar', 'Ninguém sabe ao certo quem cumpriu qual requisito.', 'Requisitos por classe, com comprovação e avaliação da liderança.'],
  ['conversa', 'Comunicação desencontrada', 'Aviso importante some no meio do grupo.', 'Avisos, agenda e chat moderado dentro do clube.'],
]

function Problemas() {
  return (
    <Secao id="problemas" fundo="bg-white">
      <Titulo sobre="Por que o DesbravaClube" titulo="Menos planilha. Mais tempo com os desbravadores." texto="O que hoje toma o fim de semana da diretoria vira rotina simples no celular." />
      <ul className="grid gap-4 md:grid-cols-3">
        {PROBLEMAS.map(([icone, titulo, dor, solucao]) => (
          <li key={titulo} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <span className="grid place-items-center w-11 h-11 rounded-xl bg-red-50 text-red-700"><Icone nome={icone} /></span>
            <h3 className={`mt-4 text-lg font-bold ${NAVY}`}>{titulo}</h3>
            <p className="mt-1 text-slate-600">{dor}</p>
            <p className="mt-3 flex gap-2 font-semibold text-emerald-800">
              <Icone nome="check" className="w-5 h-5 shrink-0 mt-0.5" />{solucao}
            </p>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

// Só recursos que existem HOJE no produto. Especialidades ficam de fora (fora do piloto).
const RECURSOS = [
  ['classes', 'Classes com requisitos oficiais', 'Cada requisito no celular do desbravador, com comprovação por foto ou texto.'],
  ['estrela', 'Classes avançadas', 'Acompanhamento das classes avançadas junto com as regulares.'],
  ['avaliacoes', 'Avaliação pela liderança', 'Fila única para aprovar ou pedir correção, com histórico de cada tentativa.'],
  ['documentos', 'Documentos e certificados', 'PDF gerado pelo sistema, com assinatura e verificação pública por QR Code.'],
  ['jogos', 'Jogos e ranking', 'Jogos, desafios e ranking por unidade para manter a turma engajada.'],
  ['mensalidades', 'Mensalidades e controle', 'O que está pago e o que está pendente, com a chave Pix do clube.'],
  ['qrcode', 'Inscrição por link ou QR', 'Quem quer entrar pede pelo link do clube; a diretoria aprova.'],
  ['camadas', 'Multiclube', 'Quem participa de mais de um clube alterna entre eles, com dados separados.'],
  ['mapa', 'Painel da coordenação', 'Coordenação distrital e regional acompanha os clubes da sua área.'],
]

function Recursos() {
  return (
    <Secao id="recursos" fundo="bg-slate-50">
      <Titulo sobre="Recursos" titulo="Tudo o que o clube precisa, num lugar só" texto="Do requisito cumprido pelo desbravador ao certificado assinado pela diretoria." />
      <ul className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {RECURSOS.map(([icone, titulo, texto]) => (
          <li key={titulo} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-[0_1px_2px_rgba(11,27,70,0.04)]">
            <span className="grid place-items-center w-11 h-11 shrink-0 rounded-xl bg-[#e8efff] text-[#1d4ed8]"><Icone nome={icone} /></span>
            <div>
              <h3 className={`font-bold ${NAVY}`}>{titulo}</h3>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">{texto}</p>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

function Destaques() {
  return (
    <Secao id="para-clubes" fundo="bg-white">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <Titulo centro={false} sobre="Para o desbravador" titulo="Cada um acompanha a própria classe" texto="Pelo celular, o desbravador vê o que falta, envia a comprovação na hora e recebe a correção explicada." />
          <Lista itens={[
            'Requisitos com status: a fazer, enviado, correção, aprovado',
            'Comprovação com foto ou texto, direto na tela do requisito',
            'Reenvio sem perder o histórico',
          ]} />
        </div>
        <div className="grid gap-6 justify-items-center"><CardTentativas /></div>
      </div>
      <div className="mt-16 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="order-2 lg:order-1"><NotebookPainel /></div>
        <div className="order-1 lg:order-2">
          <Titulo centro={false} sobre="Para a diretoria" titulo="O clube inteiro num painel" texto="Membros, unidades, presença, avaliações, mensalidades e documentos — com cada ação registrada." />
          <Lista itens={[
            'Aprovação de entrada e cargos por pessoa',
            'Fila de avaliação da liderança',
            'Documentos com assinatura e QR Code de verificação',
          ]} />
        </div>
      </div>
    </Secao>
  )
}

function ComoFunciona() {
  const passos = [
    ['bandeira', 'Crie o clube', 'Cadastre-se e crie o espaço do seu clube em poucos minutos.'],
    ['qrcode', 'Convide a turma', 'Compartilhe o link ou o QR Code; a diretoria aprova cada entrada.'],
    ['celular', 'Use no dia a dia', 'Classes, avaliações, avisos e documentos pelo celular.'],
  ]
  return (
    <Secao id="como-funciona" fundo="bg-[#0b1b46]">
      <Titulo claro sobre="Como funciona" titulo="Em 3 passos, o clube no app" />
      <ol className="grid gap-4 md:grid-cols-3">
        {passos.map(([icone, t, d], i) => (
          <li key={t} className="relative rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-3">
              <span className="grid place-items-center w-11 h-11 rounded-xl bg-[#f5b012] text-[#0b1b46] font-extrabold" aria-hidden="true">{i + 1}</span>
              <Icone nome={icone} className="w-6 h-6 text-[#ffd873]" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white"><span className="sr-only">Passo {i + 1}: </span>{t}</h3>
            <p className="mt-1 text-blue-100">{d}</p>
          </li>
        ))}
      </ol>
      <div className="mt-10 text-center">
        <Link to="/adquirir" className={`${BOTAO_PRIMARIO} bg-[#f5b012] hover:bg-[#ffc23a] text-[#0b1b46] focus-visible:ring-white focus-visible:ring-offset-[#0b1b46]`}>Começar agora <Icone nome="seta" className="w-5 h-5" /></Link>
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
    ['escudo', 'Dados das crianças protegidos', 'Fotos, evidências e dados dos membros não ficam públicos.'],
    ['camadas', 'Cada clube isolado', 'Os dados de um clube não aparecem para outro.'],
    ['usuario', 'Acesso por cargo', 'Cada pessoa vê e faz só o que o seu papel permite.'],
    ['responsaveis', 'Responsáveis confirmados', 'O vínculo com o filho só vale depois da confirmação da diretoria.'],
    ['historico', 'Histórico de ações', 'Aprovações, assinaturas e revogações ficam registradas.'],
    ['cadeado', 'Consentimento registrado', 'O responsável concede ou revoga o consentimento, com registro.'],
  ]
  return (
    <Secao id="seguranca" fundo="bg-slate-50">
      <Titulo sobre="Segurança e privacidade" titulo="Cuidado de verdade com os dados do clube" texto="Um produto independente, pensado desde o início para lidar com dados de crianças e adolescentes." />
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
  ['Funciona no celular?', 'Sim. O DesbravaClube foi feito primeiro para o celular e também funciona no computador e no tablet. Não é obrigatório instalar: dá para abrir pelo navegador e adicionar à tela inicial.'],
  ['Como funcionam as Classes?', 'O desbravador vê os requisitos e envia a comprovação com foto ou texto. A liderança avalia: aprova ou pede correção com um comentário. Cada tentativa fica no histórico.'],
  ['O que os responsáveis veem?', 'Depois que a diretoria confirma o vínculo, o responsável acompanha pontos, presenças e faltas e a mensalidade pendente, e registra o consentimento do filho.'],
  ['Como os membros entram no clube?', 'A liderança compartilha o link ou o QR Code do clube; quem acessa pede a entrada e a diretoria aprova.'],
  ['Existe acesso para a coordenação?', 'Sim. Coordenação distrital e regional tem um painel próprio com a visão que o seu papel permite. Os dados privados de cada clube continuam sob a gestão do clube.'],
  ['Como funciona a licença?', 'É uma licença anual para o clube, não uma mensalidade. Os valores vigentes aparecem em Planos. Nesta fase, o pagamento é combinado diretamente com a equipe da plataforma.'],
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
        <h2 className="mx-auto max-w-3xl text-3xl sm:text-4xl font-extrabold tracking-tight text-white">Leve o seu clube para a palma da mão.</h2>
        <p className="mx-auto mt-3 max-w-xl text-blue-100">Crie o clube agora e combine o pagamento depois.</p>
        <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
          <Link to="/adquirir" className={`${BOTAO_PRIMARIO} bg-[#f5b012] hover:bg-[#ffc23a] text-[#0b1b46] focus-visible:ring-white focus-visible:ring-offset-[#0b1b46]`}>Quero criar meu clube</Link>
          <a href="#planos" className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-xl border border-white/30 text-white font-bold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Ver planos</a>
        </div>
      </div>
    </section>
  )
}

function Rodape() {
  const WHATSAPP = 'https://wa.me/5581989499469?text=' + encodeURIComponent('Olá! Vim pelo site do DesbravaClube e quero saber mais.')
  const emBreve = 'text-slate-400 cursor-default'
  return (
    <footer className="bg-[#07122f] text-slate-300">
      <div className={`${CONTAINER} grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4`}>
        <div>
          <Marca claro />
          <p className="mt-3 text-sm text-slate-400 max-w-xs">O clube na palma da mão. Produto independente para Clubes de Desbravadores.</p>
        </div>
        <nav aria-label="Produto">
          <h2 className="text-sm font-bold text-white">Produto</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><a href="#recursos" className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Recursos</a></li>
            <li><a href="#planos" className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Planos</a></li>
            <li><LinkApp to="/login" className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">Entrar</LinkApp></li>
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
          © {new Date().getFullYear()} DesbravaClube — Thiago Henrique da Silva Miranda. Todos os direitos reservados.
          É proibida a reprodução, cópia ou distribuição, total ou parcial, do conteúdo, da marca, do código e do
          design deste site e do aplicativo sem autorização expressa do titular (Lei 9.610/98 e Lei 9.609/98).
        </p>
      </div>
    </footer>
  )
}

export default function Landing() {
  useEffect(() => {
    const antes = document.title
    document.title = `${MARCA_PRODUTO.nome} — ${MARCA_PRODUTO.lema.toLowerCase()}`
    return () => { document.title = antes }
  }, [])
  return (
    <div className="min-h-full bg-white text-slate-800">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-bold focus:text-[#0b1b46] focus:shadow">Pular para o conteúdo</a>
      <Cabecalho />
      <main id="conteudo">
        <Hero />
        <Problemas />
        <Recursos />
        <Destaques />
        <ComoFunciona />
        <Seguranca />
        <Planos />
        <Faq />
        <ChamadaFinal />
      </main>
      <Rodape />
    </div>
  )
}
