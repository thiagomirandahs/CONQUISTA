import { corSegura, linkWhatsApp, urlSegura } from '../../services/vitrine.js'

// Cartão de visita do clube (usado no site e na pré-visualização das Configurações do clube).
// Arquivo sem dependência da landing, para a pré-visualização no app não carregar o site inteiro.
const BOTAO_PRIMARIO = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5b012] focus-visible:ring-offset-2'
const BOTAO_WHATSAPP = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl bg-[#25D366] hover:brightness-95 text-[#07122f] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d4ed8] focus-visible:ring-offset-2'

export function Emblema({ clube, tamanho = 'w-14 h-14', texto = 'text-lg' }) {
  const logo = urlSegura(clube.logo_url)
  const cor = corSegura(clube.cor) || '#0b1b46'
  if (logo) return <img src={logo} alt="" loading="lazy" className={`${tamanho} rounded-2xl object-contain bg-white border border-slate-200 shrink-0`} />
  return (
    <span aria-hidden="true" className={`${tamanho} ${texto} rounded-2xl grid place-items-center font-extrabold text-white shrink-0`} style={{ background: cor }}>
      {(clube.sigla || clube.nome || '?').slice(0, 4).toUpperCase()}
    </span>
  )
}

export function CartaoDoClube({ clube }) {
  const cor = corSegura(clube.cor) || '#0b1b46'
  const zap = linkWhatsApp(clube.whatsapp, `Olá! Vi o ${clube.nome} no DesbravaClube e quero saber como participar.`)
  const inscricao = urlSegura(clube.link_inscricao)
  const email = typeof clube.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clube.email) ? clube.email : null
  const reuniao = [clube.reuniao_dia, clube.reuniao_horario].filter(Boolean).join(' · ')
  // "Quero participar": link de inscrição publicado; senão, a conversa no WhatsApp; senão, e-mail
  const participar = inscricao || zap || (email ? `mailto:${email}` : null)

  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-lg border border-slate-200" aria-label={`Cartão do ${clube.nome}`}>
      <div className="px-5 pt-6 pb-5 text-white" style={{ background: `linear-gradient(135deg, ${cor}, #0b1b46)` }}>
        <div className="flex items-center gap-4">
          <Emblema clube={clube} tamanho="w-20 h-20" texto="text-2xl" />
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight">{clube.nome}</h1>
            {clube.lema && <p className="text-sm text-white/85">{clube.lema}</p>}
            {(clube.cidade || clube.estado) && <p className="mt-1 text-sm font-semibold text-[#f5b012]">{[clube.cidade, clube.estado].filter(Boolean).join(' · ')}</p>}
          </div>
        </div>
      </div>
      <div className="space-y-5 p-5">
        {clube.apresentacao && <p className="text-slate-700 whitespace-pre-line">{clube.apresentacao}</p>}
        {(reuniao || clube.reuniao_local) && (
          <div className="rounded-2xl bg-slate-50 p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Reuniões</h2>
            {reuniao && <p className="mt-1 font-bold text-[#0b1b46]">{reuniao}</p>}
            {clube.reuniao_local && <p className="text-sm text-slate-600">{clube.reuniao_local}</p>}
          </div>
        )}
        {(clube.diretor_nome || email || zap) && (
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Fale com a diretoria</h2>
            {clube.diretor_nome && <p className="mt-1 font-bold text-[#0b1b46]">{clube.diretor_nome}</p>}
            {email && <a href={`mailto:${email}`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[#1d4ed8] underline break-all">{email}</a>}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {zap && <a href={zap} target="_blank" rel="noopener noreferrer" className={BOTAO_WHATSAPP}><span aria-hidden="true">💬</span> Chamar no WhatsApp</a>}
          {participar && (
            <a href={participar} target={participar.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer" className={BOTAO_PRIMARIO}>
              Quero participar
            </a>
          )}
        </div>
      </div>
    </article>
  )
}

