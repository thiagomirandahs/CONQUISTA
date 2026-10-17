import { Link } from 'react-router-dom'
import { Card } from '../ui/index.jsx'

const blocos = [
  ['🏆', 'Desafios globais', 'Publicar, revisar e ocultar desafios', 'desafios-globais'],
  ['🏕️', 'Clubes', 'Acessar clubes, planos e situação', 'clubes'],
  ['💳', 'Assinaturas', 'Pagamentos, planos e cortesias', 'assinaturas'],
  ['📚', 'Conteúdo', 'Jogos, leituras e materiais', 'recursos'],
  ['📣', 'Comunicação', 'Avisos oficiais para os clubes', 'avisos'],
  ['🛡️', 'Segurança', 'Auditoria e ações administrativas', 'auditoria'],
]

export default function AdminNovo() {
  return <main className="min-h-dvh bg-bg px-4 py-6 sm:px-6">
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-brand">DesbravaClube</p><h1 className="mt-1 text-3xl font-extrabold text-ink">Central de administração</h1><p className="mt-1 text-sm text-muted">Tudo que precisa de atenção em um só lugar.</p></div>
        <Link to="/inicio" className="rounded-xl bg-surface px-4 py-3 text-sm font-bold text-ink shadow-soft">Sair do admin</Link>
      </header>
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card><p className="text-xs font-bold uppercase text-muted">Ações pendentes</p><p className="mt-2 text-3xl font-extrabold text-ink">—</p><p className="text-sm text-muted">carregando dados da plataforma</p></Card>
        <Card><p className="text-xs font-bold uppercase text-muted">Clubes ativos</p><p className="mt-2 text-3xl font-extrabold text-ink">—</p><p className="text-sm text-muted">consulte a visão geral</p></Card>
        <Card className="border-2 border-brand/20"><p className="text-xs font-bold uppercase text-brand">Atalho recomendado</p><Link to="/admin?aba=desafios-globais" className="mt-2 block text-lg font-extrabold text-ink">Revisar desafios globais →</Link><p className="text-sm text-muted">Controle a semana do ranking.</p></Card>
      </section>
      <h2 className="mb-3 text-lg font-extrabold text-ink">O que você quer fazer?</h2>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {blocos.map(([icone, titulo, descricao, aba]) => <Link key={aba} to={`/admin?aba=${aba}`} className="group rounded-2xl bg-surface p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-brand"><span className="text-3xl" aria-hidden="true">{icone}</span><h3 className="mt-3 font-extrabold text-ink">{titulo}</h3><p className="mt-1 text-sm text-muted">{descricao}</p><span className="mt-4 block text-sm font-bold text-brand">Abrir módulo →</span></Link>)}
      </section>
    </div>
  </main>
}
