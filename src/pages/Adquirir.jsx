import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { carregarPlanos, formatarPreco } from '../services/comercial.js'

// Catálogo público de planos + entrada do fluxo de aquisição (item 4). PÚBLICA de propósito — quem
// está decidindo se assina ainda não tem conta. Preço, nome e composição vêm do banco
// (planos_disponiveis(), agora liberada pro anônimo); nada aqui é hardcoded.
// "Quero este plano" manda pra /criar-clube?plano=<chave> — rota que já exige sessão
// (SessaoObrigatoria): quem não tem conta é levado pro login/cadastro e volta pra cá sozinho depois
// (retornoPosLogin), sem duplicar esse mecanismo.
const RECURSO_NOME = {
  agenda: 'Agenda', atividades: 'Atividades', mural: 'Mural de fotos', missoes: 'Missões',
  chat: 'Chat', desafios: 'Desafios', jogos: 'Jogos', biblia: 'Bíblia', bichinho: 'Bichinho',
  chefao: 'Chefão', mensalidades: 'Mensalidades', leilao: 'Leilão', classes: 'Classes',
}

export default function Adquirir() {
  const [planos, setPlanos] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    carregarPlanos().then((p) => { if (vivo) setPlanos(p) }).catch((e) => { if (vivo) setErro(e?.message || String(e)) })
    return () => { vivo = false }
  }, [])

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="mb-5 text-center">
        <h1 className="text-2xl font-extrabold text-ink">Escolha o plano do seu clube</h1>
        <p className="text-sm text-muted mt-1">Comece em período de teste — nada é cobrado agora.</p>
      </header>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 mb-5 leading-snug">
        <strong>Pagamento online ainda não integrado.</strong> Você cria a conta e o clube normalmente;
        a cobrança, quando existir, será combinada com a administração da plataforma. Valores exibidos
        são provisórios enquanto o catálogo não fecha os preços definitivos.
      </div>

      {erro && <div role="alert" className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700 mb-4">{erro}</div>}
      {planos === null && !erro && <p className="text-faint text-sm text-center" role="status">Carregando…</p>}

      <ul className="space-y-3">
        {(planos || []).map((p) => (
          <li key={`${p.chave}-${p.versao}`} className="bg-surface rounded-2xl p-4 shadow-soft">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold text-ink">{p.nome}</div>
                <p className="text-xs text-muted leading-snug mt-0.5">{p.descricao}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="font-extrabold text-ink">
                  {(() => {
                    const mensal = (p.precos || []).find((x) => x.ciclo === 'mensal')
                    return mensal ? formatarPreco(mensal.valor_centavos, mensal.moeda) : '—'
                  })()}
                </div>
                <div className="text-xs text-faint">por mês</div>
              </div>
            </div>
            <p className="text-xs text-faint mt-2 leading-snug">
              {p.recursos === null
                ? 'Inclui todos os recursos do DesbravaClube.'
                : `Inclui: ${(p.recursos || []).map((r) => RECURSO_NOME[r] || r).join(', ')}.`}
            </p>
            {p.provisorio && <p className="text-xs text-amber-700 mt-1">Preço e composição provisórios.</p>}
            <Link to={`/criar-clube?plano=${encodeURIComponent(p.chave)}`}
              className="block text-center mt-3 min-h-[44px] leading-[44px] rounded-xl bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-bold">
              Quero este plano
            </Link>
          </li>
        ))}
      </ul>

      {planos !== null && planos.length === 0 && !erro && (
        <p className="text-sm text-faint text-center">Nenhum plano publicado no catálogo ainda.</p>
      )}

      <p className="text-center text-sm mt-6">
        <Link to="/" className="text-brand font-semibold underline">Voltar</Link>
      </p>
    </div>
  )
}
