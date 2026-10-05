import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { carregarMinhaJornada } from '../services/jornada.js'
import { Cabecalho, Vazio, mensagemDeErro } from '../ui/index.jsx'
import BarraProgresso from '../components/jornada/BarraProgresso.jsx'
import StatusRequisito from '../components/jornada/StatusRequisito.jsx'

const fmt = (iso) => { try { return iso ? new Date(iso).toLocaleDateString('pt-BR') : '' } catch { return '' } }
const statusDe = (s) => (s === 'concluida' || s === 'concluido' ? 'aprovado' : s === 'em_andamento' ? 'rascunho' : 'nao_iniciado')

function Secao({ titulo, children }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-lg font-bold text-ink">{titulo}</h2>
      {children}
    </section>
  )
}

function Linha({ nome, percentual, status, data }) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-ink">{nome}</span>
        <StatusRequisito status={statusDe(status)} rotulo={status === 'concluida' ? 'Concluída' : undefined} />
      </div>
      <BarraProgresso valor={percentual} rotulo={`Progresso em ${nome}`} />
      {data ? <p className="mt-1 text-base text-muted">{data}</p> : null}
    </li>
  )
}

const CHAVES = ['classes', 'especialidades', 'investiduras', 'conquistas', 'leituras']

export default function MinhaJornada() {
  const [d, setD] = useState(undefined)   // undefined=carregando, null=sem vínculo
  const [erro, setErro] = useState('')
  const carregar = useCallback(() => {
    setErro(''); setD(undefined)
    carregarMinhaJornada().then(setD).catch((e) => setErro(mensagemDeErro(e, 'Não consegui carregar a sua jornada.')))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const vazio = d && CHAVES.every((k) => d[k].length === 0)

  return (
    <div className="mx-auto max-w-2xl pb-8" data-testid="pagina-minha-jornada">
      <Cabecalho voltar={{ para: '/jornada', rotulo: 'a Jornada' }} icone="🧭" titulo="Minha Jornada" descricao="Tudo o que você já começou e conquistou, em um só lugar." />
      <Link to="/jornada/portfolio" className="mb-4 inline-flex min-h-[44px] items-center rounded-xl border-2 border-[#0b1f4d] px-4 text-base font-bold text-[#0b1f4d]">Ver meu Portfólio</Link>
      {erro ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-base text-rose-800">
          <p>{erro}</p>
          <button type="button" onClick={carregar} className="mt-3 min-h-[44px] rounded-xl bg-[#0b1f4d] px-4 text-base font-bold text-white">Tentar de novo</button>
        </div>
      ) : d === undefined ? (
        <div role="status" aria-label="Carregando sua jornada" className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface2 motion-reduce:animate-none" />)}
        </div>
      ) : d === null || vazio ? (
        <Vazio icone="🧭" titulo="Sua jornada ainda não começou">Quando você iniciar uma classe ou leitura, o seu caminho aparece aqui.</Vazio>
      ) : (
        <>
          {d.classes.length > 0 && <Secao titulo="Classes"><ul className="space-y-3">
            {d.classes.map((c) => <Linha key={c.member_class_id} nome={c.nome} percentual={c.percentual} status={c.status}
              data={c.investida_em ? `Investida em ${fmt(c.investida_em)}` : c.concluida_em ? `Concluída em ${fmt(c.concluida_em)}` : c.iniciada_em ? `Iniciada em ${fmt(c.iniciada_em)}` : ''} />)}
          </ul></Secao>}
          {d.especialidades.length > 0 && <Secao titulo="Especialidades"><ul className="space-y-3">
            {d.especialidades.map((e) => <Linha key={e.member_specialty_id} nome={e.nome} percentual={e.percentual} status={e.status}
              data={e.concluida_em ? `Concluída em ${fmt(e.concluida_em)}` : e.iniciada_em ? `Iniciada em ${fmt(e.iniciada_em)}` : ''} />)}
          </ul></Secao>}
          {d.investiduras.length > 0 && <Secao titulo="Investiduras"><ul className="space-y-2">
            {d.investiduras.map((i, n) => <li key={n} className="rounded-2xl border border-slate-200 bg-white p-4 text-base"><span className="font-bold">{i.classe}</span> · {fmt(i.data)}</li>)}
          </ul></Secao>}
          {d.conquistas.length > 0 && <Secao titulo="Conquistas"><ul className="space-y-2">
            {d.conquistas.map((c, n) => <li key={n} className="rounded-2xl border border-slate-200 bg-white p-4 text-base"><span aria-hidden="true">🏅 </span><span className="font-bold">{c.nome}</span> · {fmt(c.concluida_em)}</li>)}
          </ul></Secao>}
          {d.leituras.length > 0 && <Secao titulo="Leituras"><ul className="space-y-2">
            {d.leituras.map((l, n) => <li key={n} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-base">
              <span className="font-bold">{l.titulo}</span>
              <StatusRequisito status={l.concluido ? 'aprovado' : 'rascunho'} rotulo={l.concluido ? 'Concluída' : `Capítulo ${l.capitulo || 1}`} />
            </li>)}
          </ul></Secao>}
        </>
      )}
    </div>
  )
}
