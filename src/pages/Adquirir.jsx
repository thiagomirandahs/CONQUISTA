import { mensagemDeErro } from '../ui/index.jsx'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import LinkApp from '../components/LinkApp.jsx'
import { carregarPlanos, formatarPreco } from '../services/comercial.js'
import { EsqueletoTela } from '../ui/carregamento.jsx'
import SiteLayout, { useMetaDaPagina } from './site/SiteLayout.jsx'

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
  const { pathname } = useLocation()
  useMetaDaPagina('Planos e licença — DesbravaClube', 'Licença anual para o seu clube de Desbravadores, com teste grátis para começar. Veja o que está incluso e combine o pagamento direto.', pathname === '/planos' ? '/planos' : '/adquirir')

  useEffect(() => {
    let vivo = true
    carregarPlanos().then((p) => { if (vivo) setPlanos(p) }).catch((e) => { if (vivo) setErro(mensagemDeErro(e, 'Não consegui carregar os planos.')) })
    return () => { vivo = false }
  }, [])

  return (
    <SiteLayout>
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="mb-5 text-center">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink">A licença do seu clube</h1>
        <p className="text-sm text-muted mt-1">Licença anual — não é mensalidade. Comece agora, combine o pagamento depois.</p>
      </header>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 mb-5 leading-snug">
        <strong>Pagamento online ainda não integrado.</strong> Você cria a conta e o clube normalmente;
        a cobrança será combinada diretamente com a administração da plataforma.
      </div>

      {erro && <div role="alert" className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700 mb-4">{erro}</div>}
      {planos === null && !erro && <EsqueletoTela cabecalho={false} cartoes={2} />}

      <ul className="space-y-3">
        {(planos || []).map((p) => {
          const preco = (p.precos || [])[0]
          const meta = preco?.metadata || {}
          return (
            <li key={`${p.chave}-${p.versao}`} className="bg-surface rounded-3xl border border-line p-5 shadow-soft">
              {meta.campanha && (
                <div className="inline-block bg-gold/20 text-amber-800 text-xs font-bold rounded-full px-3 py-1 mb-2">
                  🏆 {meta.campanha}
                </div>
              )}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-ink">{p.nome}</div>
                  <p className="text-xs text-muted leading-snug mt-0.5">{p.descricao}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-extrabold text-ink">{preco ? formatarPreco(preco.valor_centavos, preco.moeda) : '—'}</div>
                  <div className="text-xs text-faint">no cartão</div>
                </div>
              </div>
              {preco && (meta.parcelas_cartao || meta.pix_centavos) && (
                <div className="mt-2 bg-surface2 rounded-xl p-3 text-xs text-muted space-y-0.5">
                  {meta.parcelas_cartao && meta.parcela_centavos && (
                    <p>💳 Até {meta.parcelas_cartao}x de {formatarPreco(meta.parcela_centavos, preco.moeda)} sem juros para o clube</p>
                  )}
                  {meta.pix_centavos && (
                    <p>💰 {formatarPreco(meta.pix_centavos, preco.moeda)} no Pix</p>
                  )}
                </div>
              )}
              <p className="text-xs text-faint mt-2 leading-snug">
                {p.recursos === null
                  ? 'Inclui todos os recursos do DesbravaClube.'
                  : `Inclui: ${(p.recursos || []).map((r) => RECURSO_NOME[r] || r).join(', ')}.`}
              </p>
              {p.provisorio && <p className="text-xs text-amber-700 mt-1">Preço e composição provisórios.</p>}
              <LinkApp to={`/criar-clube?plano=${encodeURIComponent(p.chave)}${preco ? `&ciclo=${encodeURIComponent(preco.ciclo)}` : ''}`}
                className="block text-center mt-4 min-h-[48px] leading-[48px] rounded-2xl bg-gradient-to-r from-brand via-brand to-brand2 shadow-glow text-white font-bold">
                Quero este plano
              </LinkApp>
            </li>
          )
        })}
      </ul>

      {planos !== null && planos.length === 0 && !erro && (
        <p className="text-sm text-faint text-center">Nenhum plano publicado no catálogo ainda.</p>
      )}

      <p className="text-center text-sm mt-6">
        <Link to="/" className="inline-flex min-h-[44px] items-center text-brand font-semibold underline">Voltar</Link>
      </p>
    </div>
    </SiteLayout>
  )
}
