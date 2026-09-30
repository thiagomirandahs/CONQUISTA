import { useCallback, useEffect, useState } from 'react'
import { carregarPortfolio } from '../services/jornada.js'
import { Cabecalho, Vazio, mensagemDeErro } from '../ui/index.jsx'
import StatusRequisito from '../components/jornada/StatusRequisito.jsx'

const fmt = (iso) => { try { return iso ? new Date(iso).toLocaleDateString('pt-BR') : '' } catch { return '' } }

export default function Portfolio() {
  const [itens, setItens] = useState(null)
  const [proximo, setProximo] = useState(null)
  const [erro, setErro] = useState('')
  const [maisErro, setMaisErro] = useState('')
  const [carregandoMais, setCarregandoMais] = useState(false)

  const inicial = useCallback(() => {
    setErro(''); setItens(null)
    carregarPortfolio().then((r) => { setItens(r.itens); setProximo(r.proximo) })
      .catch((e) => setErro(mensagemDeErro(e, 'Não consegui carregar o seu portfólio.')))
  }, [])
  useEffect(() => { inicial() }, [inicial])

  const verMais = () => {
    setMaisErro(''); setCarregandoMais(true)
    carregarPortfolio({ depois: proximo })
      .then((r) => { setItens((a) => [...a, ...r.itens]); setProximo(r.proximo) })
      .catch((e) => setMaisErro(mensagemDeErro(e, 'Não consegui carregar mais itens.')))
      .finally(() => setCarregandoMais(false))
  }

  return (
    <div className="mx-auto max-w-2xl pb-8" data-testid="pagina-portfolio">
      <Cabecalho icone="🗂️" titulo="Portfólio" descricao="Os requisitos que você cumpriu e que foram aprovados." />
      <p className="mb-4 rounded-2xl bg-surface2 p-4 text-base text-ink">
        O Portfólio é o seu registro de atividades e é separado do cartão oficial da Classe. Ele mostra só um resumo curto do que você entregou, sem fotos.
      </p>
      {erro ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-base text-rose-800">
          <p>{erro}</p>
          <button type="button" onClick={inicial} className="mt-3 min-h-[44px] rounded-xl bg-[#0b1f4d] px-4 text-base font-bold text-white">Tentar de novo</button>
        </div>
      ) : itens === null ? (
        <div role="status" aria-label="Carregando portfólio" className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface2 motion-reduce:animate-none" />)}
        </div>
      ) : itens.length === 0 ? (
        <Vazio icone="🗂️" titulo="Nada no portfólio ainda">Quando um requisito seu for aprovado, ele aparece aqui.</Vazio>
      ) : (
        <>
          <ul className="space-y-3">
            {itens.map((i, n) => (
              <li key={`${i.aprovado_em}-${n}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base font-bold text-ink">{i.origem}</span>
                  <StatusRequisito status="aprovado" />
                </div>
                <p className="text-base text-muted">{i.alvo === 'classe' ? 'Classe' : 'Especialidade'} · {i.requisito_codigo}</p>
                <p className="mt-1 text-base text-ink">{i.requisito}</p>
                {i.resumo ? <p className="mt-2 text-base italic text-ink">“{i.resumo}”</p> : null}
                <p className="mt-2 text-base text-muted">
                  Aprovado em {fmt(i.aprovado_em)}{i.avaliador ? ` por ${i.avaliador}` : ''}{i.anexos > 0 ? ` · ${i.anexos} anexo(s) enviado(s)` : ''}
                </p>
              </li>
            ))}
          </ul>
          {maisErro && <p role="alert" className="mt-3 text-base text-rose-800">{maisErro}</p>}
          {proximo && (
            <button type="button" onClick={verMais} disabled={carregandoMais}
              className="mt-4 min-h-[44px] w-full rounded-xl bg-[#0b1f4d] px-4 text-base font-bold text-white disabled:opacity-60">
              {carregandoMais ? 'Carregando…' : maisErro ? 'Tentar de novo' : 'Ver mais'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
