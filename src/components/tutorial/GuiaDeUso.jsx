import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  buscarTopicos, secoesOrdenadas, topicosDaSecao, topicosVisiveis,
} from '../../lib/tutorial/tutorial.js'

// O miolo do tutorial, igual no APP e no SITE. Quem decide o que muda é quem monta:
//   modo 'app'  -> `podeAbrir(rota)` diz se o atalho "Abrir essa tela" aparece; a seção do papel vem primeiro.
//   modo 'site' -> nunca há atalho para tela logada (podeAbrir ausente); tópicos `soNoApp` ficam de fora.
export default function GuiaDeUso({ modo = 'app', secaoDaPessoa = null, podeAbrir = null, temRecurso, tons = 'app' }) {
  const { hash } = useLocation()
  const [termo, setTermo] = useState('')
  const [abertos, setAbertos] = useState(() => new Set(hash ? [hash.slice(1)] : []))

  const visiveis = useMemo(() => topicosVisiveis({ modo, temRecurso }), [modo, temRecurso])
  const achados = useMemo(() => buscarTopicos(termo, visiveis), [termo, visiveis])
  const secoes = secoesOrdenadas(secaoDaPessoa)

  // Chegou por "?" de uma tela (/ajuda#minha-classe): o cartão já nasce aberto (estado inicial); aqui só rola até ele.
  useEffect(() => {
    if (!hash) return
    const id = hash.slice(1)

    const el = typeof document !== 'undefined' ? document.getElementById(`topico-${id}`) : null
    el?.scrollIntoView?.({ block: 'start' })
  }, [hash])

  const alternar = (id) => setAbertos((a) => {
    const n = new Set(a)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const site = tons === 'site'
  const cartao = site ? 'border border-slate-200 bg-white' : 'border border-line bg-surface'
  const tituloCor = site ? 'text-[#0b1b46]' : 'text-ink'
  const textoCor = site ? 'text-slate-600' : 'text-muted'
  const buscando = termo.trim().length > 0

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="ajuda-busca" className={`block text-sm font-bold ${tituloCor}`}>Buscar no tutorial</label>
        <input id="ajuda-busca" type="search" value={termo} onChange={(e) => setTermo(e.target.value)}
          placeholder="Ex.: foto, senha, cadeado, chamada"
          className={`mt-1 w-full min-h-[48px] rounded-2xl px-4 text-base outline-none focus:ring-2 focus:ring-[#f5b012] ${site ? 'border border-slate-300 bg-white text-slate-800' : 'border border-line bg-surface text-ink'}`} />
        {buscando && <p className={`mt-1 text-sm ${textoCor}`} aria-live="polite">{achados.length} {achados.length === 1 ? 'tópico encontrado' : 'tópicos encontrados'}</p>}
      </div>

      {secoes.map((s) => {
        const lista = topicosDaSecao(s.chave, achados)
        if (lista.length === 0) return null
        const minha = s.chave === secaoDaPessoa
        return (
          <section key={s.chave} aria-labelledby={`secao-${s.chave}`} data-testid={`secao-${s.chave}`}>
            <h2 id={`secao-${s.chave}`} className={`mb-1 flex items-center gap-2 text-lg font-extrabold ${tituloCor}`}>
              <span aria-hidden="true">{s.icone}</span>{s.titulo}
              {minha && <span className="rounded-full bg-[#f5b012] px-2 py-0.5 text-xs font-extrabold text-[#07122f]">Você</span>}
            </h2>
            <p className={`mb-2 text-sm ${textoCor}`}>{s.resumo}</p>
            <ul className="space-y-2">
              {lista.map((t) => (
                <Topico key={t.id} t={t} aberto={buscando || abertos.has(t.id)} aoAlternar={() => alternar(t.id)}
                  atalho={podeAbrir && t.rota && podeAbrir(t.rota) ? t.rota : null}
                  classes={{ cartao, tituloCor, textoCor }} />
              ))}
            </ul>
          </section>
        )
      })}

      {achados.length === 0 && (
        <p className={`rounded-2xl p-4 text-center text-sm ${cartao} ${textoCor}`}>
          Nada encontrado com “{termo}”. Tente outra palavra, como “classe”, “foto” ou “senha”.
        </p>
      )}
    </div>
  )
}

function Topico({ t, aberto, aoAlternar, atalho, classes }) {
  const { cartao, tituloCor, textoCor } = classes
  return (
    <li id={`topico-${t.id}`} className={`scroll-mt-20 overflow-hidden rounded-2xl ${cartao}`} data-testid="topico">
      <button type="button" onClick={aoAlternar} aria-expanded={aberto} aria-controls={`corpo-${t.id}`}
        className="flex w-full min-h-[56px] items-center gap-3 px-4 py-3 text-left">
        <span className="text-xl" aria-hidden="true">{t.icone}</span>
        <span className={`flex-1 text-[15px] font-bold ${tituloCor}`}>{t.titulo}</span>
        <span className={`text-lg ${textoCor}`} aria-hidden="true">{aberto ? '−' : '+'}</span>
      </button>
      {aberto && (
        <div id={`corpo-${t.id}`} className={`space-y-3 px-4 pb-4 text-[15px] ${textoCor}`}>
          <p><strong className={tituloCor}>Para que serve: </strong>{t.paraQueServe}</p>
          {t.passos?.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5">
              {t.passos.map((p) => <li key={p}>{p}</li>)}
            </ol>
          )}
          {t.dicas?.length > 0 && (
            <div>
              <p className={`font-bold ${tituloCor}`}>💡 Dicas</p>
              <ul className="list-disc space-y-1 pl-5">{t.dicas.map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}
          {t.problemas?.length > 0 && (
            <div>
              <p className={`font-bold ${tituloCor}`}>🛠️ Problemas comuns</p>
              <dl className="space-y-1.5">
                {t.problemas.map((p) => (
                  <div key={p.quando}>
                    <dt className={`font-semibold ${tituloCor}`}>{p.quando}</dt>
                    <dd>{p.solucao}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {atalho && (
            <Link to={atalho} data-testid="abrir-tela"
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl bg-[#0b1f4d] px-5 text-sm font-extrabold text-white active:opacity-90">
              Abrir essa tela →
            </Link>
          )}
        </div>
      )}
    </li>
  )
}
