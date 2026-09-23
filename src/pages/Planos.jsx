import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { carregarPlanos, carregarAssinaturaDoClube, formatarPreco, ROTULO_STATUS } from '../services/comercial.js'

// Planos e assinatura do clube (fase 5). Tudo que aparece aqui — nome, composição e PREÇO — vem do
// catálogo versionado do banco. Nada de valor escrito no React: mudar preço é publicar uma versão
// nova do plano, não editar esta tela.
//
// A troca de plano NÃO acontece aqui: é ato comercial da conta (o servidor recusa se o cliente tentar).
// Esta tela informa, mostra o que cabe no plano e o que já está sendo usado.
const AVISO_CLASSE = {
  trial: 'bg-sky-50 border-sky-200 text-sky-800',
  ativa: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  pagamento_pendente: 'bg-amber-50 border-amber-200 text-amber-800',
  inadimplente: 'bg-amber-50 border-amber-200 text-amber-800',
  suspensa: 'bg-rose-50 border-rose-200 text-rose-800',
  cancelada: 'bg-rose-50 border-rose-200 text-rose-800',
}

const RECURSO_NOME = {
  agenda: 'Agenda', atividades: 'Atividades', mural: 'Mural de fotos', missoes: 'Missões',
  chat: 'Chat', desafios: 'Desafios', jogos: 'Jogos', biblia: 'Bíblia', bichinho: 'Bichinho',
  chefao: 'Chefão', mensalidades: 'Mensalidades', leilao: 'Leilão', classes: 'Classes',
}
const LIMITE_NOME = {
  membros: 'Membros', administradores: 'Administradores', clubes: 'Clubes',
  fotos: 'Fotos', armazenamento_mb: 'Armazenamento (MB)',
}

export default function Planos() {
  const [planos, setPlanos] = useState(null)
  const [assinatura, setAssinatura] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const [p, a] = await Promise.all([carregarPlanos(), carregarAssinaturaDoClube().catch(() => null)])
        if (vivo) { setPlanos(p); setAssinatura(a) }
      } catch (e) { if (vivo) setErro(e?.message || String(e)) }
    })()
    return () => { vivo = false }
  }, [])

  if (erro) {
    return <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800 max-w-md mx-auto mt-8">{erro}</div>
  }
  if (planos === null) return <p className="text-faint text-sm text-center mt-10" role="status">Carregando…</p>

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-extrabold text-ink">💳 Plano do clube</h1>
        <p className="text-sm text-muted">O que está incluído e quanto do plano já está sendo usado</p>
      </header>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 mb-5 leading-snug">
        <strong>Valores provisórios.</strong> O DesbravaClube ainda não fechou os preços: o que aparece
        aqui é um rascunho do catálogo, para testar o sistema. Nada está sendo cobrado.
      </div>

      {assinatura && <SituacaoAtual a={assinatura} />}

      <h2 className="text-sm font-extrabold text-ink mb-2 mt-6">Planos</h2>
      <ul className="space-y-3">
        {planos.map((p) => (
          <CardPlano key={`${p.chave}-${p.versao}`} p={p} atual={assinatura?.plano?.chave === p.chave} />
        ))}
      </ul>

      <p className="text-xs text-faint mt-6 leading-snug">
        A troca de plano não é feita por aqui: fale com quem responde pela conta do clube. Nenhuma
        mudança de plano apaga dados — o que já existe continua, mesmo em um plano menor.
      </p>
      <Link to="/gestao" className="inline-block mt-4 text-sm font-semibold text-brand underline">Voltar para a gestão</Link>
    </div>
  )
}

function SituacaoAtual({ a }) {
  if (!a?.tem_assinatura) {
    return (
      <div className="bg-surface rounded-2xl p-5 shadow-soft" data-testid="sem-assinatura">
        <p className="font-semibold text-ink text-sm">Este clube não tem assinatura</p>
        <p className="text-xs text-faint mt-1 leading-snug">
          Nenhum limite comercial se aplica: tudo funciona exatamente como sempre funcionou.
        </p>
      </div>
    )
  }
  const limites = a.limites || {}
  return (
    <section className="space-y-3" aria-labelledby="t-situacao">
      <h2 id="t-situacao" className="sr-only">Situação atual</h2>
      <div className={`rounded-2xl border p-4 ${AVISO_CLASSE[a.status] || 'bg-surface border-line'}`} data-testid="situacao">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-bold">{a.plano?.nome}</div>
            <div className="text-xs opacity-80">Plano {a.plano?.chave} · versão {a.plano?.versao}</div>
          </div>
          <span className="text-xs font-bold shrink-0">{ROTULO_STATUS[a.status] || a.status}</span>
        </div>
        {a.status === 'suspensa' && (
          <p className="text-xs mt-2 leading-snug">
            A criação de coisas novas está pausada. <strong>Nada foi apagado</strong>: as pessoas, as fotos
            e o histórico continuam no lugar e voltam assim que o pagamento for regularizado.
          </p>
        )}
      </div>

      <div className="bg-surface rounded-2xl p-4 shadow-soft">
        <h3 className="text-xs font-extrabold text-ink mb-2">Uso do plano</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {Object.entries(limites).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="text-faint">{LIMITE_NOME[k] || k}</dt>
              <dd className="font-bold text-ink">
                {v?.medicao === 'pendente' ? '—' : `${v?.uso ?? 0}${v?.limite == null ? '' : ` / ${v.limite}`}`}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-faint mt-2 leading-snug">
          Sem número à direita = sem limite. “—” = a plataforma ainda não mede este item.
        </p>
      </div>
    </section>
  )
}

function CardPlano({ p, atual }) {
  const mensal = (p.precos || []).find((x) => x.ciclo === 'mensal')
  const recursos = p.recursos === null ? null : (p.recursos || [])
  return (
    <li className={`bg-surface rounded-2xl p-4 shadow-soft ${atual ? 'ring-2 ring-brand' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-ink">{p.nome} {atual && <span className="text-xs text-brand font-extrabold">· seu plano</span>}</div>
          <p className="text-xs text-muted leading-snug mt-0.5">{p.descricao}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="font-extrabold text-ink">{mensal ? formatarPreco(mensal.valor_centavos, mensal.moeda) : '—'}</div>
          <div className="text-xs text-faint">por mês</div>
        </div>
      </div>
      <p className="text-xs text-faint mt-2 leading-snug">
        {recursos === null
          ? 'Inclui todos os recursos do DesbravaClube.'
          : `Inclui: ${recursos.map((r) => RECURSO_NOME[r] || r).join(', ')}.`}
      </p>
      {p.provisorio && <p className="text-xs text-amber-700 mt-1">Preço e composição provisórios.</p>}
    </li>
  )
}
