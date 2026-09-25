import { Link } from 'react-router-dom'

// Landing PÚBLICA (item 4): a raiz "/" sem sessão. Não usa <Logo/> de propósito — aquele componente
// lê a marca do CLUBE em uso (useClube()), e aqui ainda não existe clube nenhum escolhido; esta tela
// é da PLATAFORMA, não de um clube. Usa /logo.png (identidade oficial da plataforma, fornecida pelo
// usuário) — mesmo arquivo do favicon e dos ícones do PWA.
const BENEFICIOS = [
  { icone: '🗺️', titulo: 'Jornada do desbravador', texto: 'Classes, especialidades, pontos e presença num só lugar — a criança acompanha o próprio progresso.' },
  { icone: '🧑‍🤝‍🧑', titulo: 'Gestão da diretoria', texto: 'Aprovações, avaliações, mensalidades e documentos oficiais sem planilha nem grupo de WhatsApp perdido.' },
  { icone: '👨‍👩‍👧', titulo: 'Pais acompanham de verdade', texto: 'Consentimento, pontuação, presença e mensalidade do filho — direto do celular do responsável.' },
  { icone: '📄', titulo: 'Documentos com validade', texto: 'PDF gerado pelo servidor, assinatura eletrônica e verificação pública por QR code.' },
]

export default function Landing() {
  return (
    <div className="min-h-full bg-surface2">
      <header className="max-w-3xl mx-auto px-5 pt-10 pb-8 text-center">
        <img src="/logo.png" alt="DesbravaClube" className="w-20 h-20 mx-auto mb-4 rounded-full shadow-glow object-contain" />
        <h1 className="text-3xl font-extrabold text-ink">DesbravaClube</h1>
        <p className="text-muted mt-2 leading-snug">
          O app do clube de Desbravadores: jornada, gestão e documentos oficiais — tudo pelo celular.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <Link to="/adquirir" className="min-h-[48px] px-6 grid place-items-center rounded-xl bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-bold">
            Quero criar meu clube
          </Link>
          <Link to="/login" className="min-h-[48px] px-6 grid place-items-center rounded-xl border border-line bg-surface text-ink font-bold">
            Já tenho conta — entrar
          </Link>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-5 pb-10 grid gap-4 sm:grid-cols-2">
        {BENEFICIOS.map((b) => (
          <div key={b.titulo} className="bg-surface rounded-2xl shadow-soft p-4">
            <div className="text-2xl mb-1">{b.icone}</div>
            <div className="font-bold text-ink">{b.titulo}</div>
            <p className="text-sm text-muted leading-snug mt-1">{b.texto}</p>
          </div>
        ))}
      </section>

      <section className="max-w-3xl mx-auto px-5 pb-14 text-center">
        <Link to="/adquirir" className="text-brand font-bold underline">Ver os planos</Link>
      </section>
    </div>
  )
}
