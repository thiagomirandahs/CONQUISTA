import { useMemo, useState } from 'react'
import { useAuth } from '../context/Auth.jsx'
import { Botao, Cabecalho, Card, Progresso, Selo } from '../ui/index.jsx'
import { embaralhar } from '../features/jogos/utils/comum.js'
import { LICOES, REQUISITOS_LENCO, MINIMO_PARA_CONCLUIR, acharPergunta } from '../features/aspirante/licoes.js'
import { lerProgresso, salvarProgresso, registrarNota, licaoConcluida, alternarLenco } from '../features/aspirante/progresso.js'

// Trilha do Aspirante: o caminho de quem acabou de entrar no clube até a cerimônia do lenço.
// Cada lição = texto curto + mini-quiz de 3 perguntas. O progresso fica neste aparelho; quem confere os requisitos é a liderança.

function sortear(licao) {
  const qs = embaralhar(licao.quiz.map(acharPergunta).filter(Boolean)).slice(0, 3)
  return qs.map((q) => ({ p: q.q, opcoes: embaralhar([q.certa, ...q.errados]), certa: q.certa, e: q.e }))
}

function MiniQuiz({ licao, aoTerminar, aoVoltar }) {
  const [perguntas] = useState(() => sortear(licao))
  const [n, setN] = useState(0)
  const [acertos, setAcertos] = useState(0)
  const [resposta, setResposta] = useState(null)
  const q = perguntas[n]

  function responder(op) {
    if (resposta) return
    setResposta(op)
  }
  function seguir() {
    const total = acertos + (resposta === q.certa ? 1 : 0)
    setResposta(null)
    if (n + 1 >= perguntas.length) aoTerminar(total, perguntas.length)
    else { setAcertos(total); setN(n + 1) }
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-muted">Pergunta {n + 1} de {perguntas.length}</span>
        <button type="button" onClick={aoVoltar} className="text-xs text-faint p-3 -m-3">Voltar à lição</button>
      </div>
      <p className="text-ink font-semibold mb-4">{q.p}</p>
      <div className="space-y-2">
        {q.opcoes.map((op) => {
          const certa = resposta && op === q.certa
          const errada = resposta && op === resposta && op !== q.certa
          return (
            <button key={op} type="button" onClick={() => responder(op)} disabled={!!resposta}
              className={`w-full min-h-[44px] rounded-xl py-3 px-3 text-sm font-semibold text-left ${
                certa ? 'bg-green-100 text-green-800 ring-2 ring-green-500' : errada ? 'bg-red-100 text-red-800 ring-2 ring-red-400' : 'bg-surface2 text-ink'
              } ${resposta && !certa && !errada ? 'opacity-60' : ''}`}>
              {op}
            </button>
          )
        })}
      </div>
      {resposta && (
        <div role="status" className="mt-3">
          <p className={`text-sm font-bold ${resposta === q.certa ? 'text-green-600' : 'text-amber-600'}`}>
            {resposta === q.certa ? 'Isso! ✅' : `Era: ${q.certa}`}
          </p>
          {q.e && <p className="text-xs text-muted mt-1">{q.e}</p>}
          <div className="mt-3"><Botao aoTocar={seguir}>{n + 1 >= perguntas.length ? 'Ver resultado' : 'Próxima'}</Botao></div>
        </div>
      )}
    </Card>
  )
}

export default function Aspirante() {
  const { profile, session } = useAuth() || {}
  const uid = profile?.id || session?.user?.id
  const [prog, setProg] = useState(() => lerProgresso(uid))
  const [aberta, setAberta] = useState(null) // id da lição
  const [fase, setFase] = useState('texto') // texto | quiz | fim
  const [nota, setNota] = useState(null)

  const feitas = LICOES.filter((l) => licaoConcluida(prog, l.id, MINIMO_PARA_CONCLUIR)).length
  const marcados = REQUISITOS_LENCO.filter((_, i) => prog.lenco[i]).length
  const licao = useMemo(() => LICOES.find((l) => l.id === aberta), [aberta])

  function guardar(novo) { setProg(novo); salvarProgresso(uid, novo) }
  function abrir(id) { setAberta(id); setFase('texto'); setNota(null) }
  function terminarQuiz(acertos, total) {
    guardar(registrarNota(prog, licao.id, acertos))
    setNota({ acertos, total }); setFase('fim')
  }

  if (licao) {
    const indice = LICOES.findIndex((l) => l.id === licao.id)
    const proxima = LICOES[indice + 1]
    return (
      <div className="max-w-2xl mx-auto">
        <button type="button" onClick={() => setAberta(null)} className="min-h-[44px] text-sm font-semibold text-muted mb-1">← Todas as lições</button>
        <Cabecalho icone={licao.icone} titulo={licao.titulo} descricao={`Lição ${indice + 1} de ${LICOES.length}`} />
        {fase === 'texto' && (
          <div className="space-y-3">
            <Card><p className="text-ink leading-relaxed">{licao.resumo}</p></Card>
            <Card>
              <h2 className="font-bold text-ink mb-2">Para fixar</h2>
              <ul className="list-disc pl-5 space-y-1.5 text-sm text-ink">
                {licao.pontos.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </Card>
            <Botao aoTocar={() => setFase('quiz')}>Fazer o mini-quiz</Botao>
          </div>
        )}
        {fase === 'quiz' && <MiniQuiz licao={licao} aoTerminar={terminarQuiz} aoVoltar={() => setFase('texto')} />}
        {fase === 'fim' && nota && (
          <Card className="text-center">
            <div className="text-4xl mb-2" aria-hidden="true">{nota.acertos >= MINIMO_PARA_CONCLUIR ? '🎉' : '💪'}</div>
            <p className="font-extrabold text-ink text-lg">Você acertou {nota.acertos} de {nota.total}</p>
            <p className="text-sm text-muted mt-1">
              {nota.acertos >= MINIMO_PARA_CONCLUIR ? 'Lição concluída! Pode seguir para a próxima.' : 'Releia a lição e tente de novo — você consegue.'}
            </p>
            <div className="mt-4 space-y-2">
              {nota.acertos >= MINIMO_PARA_CONCLUIR && proxima && <Botao aoTocar={() => abrir(proxima.id)}>Próxima lição</Botao>}
              <Botao variacao="secundario" aoTocar={() => setFase('texto')}>Reler a lição</Botao>
              <Botao variacao="discreto" aoTocar={() => setAberta(null)}>Voltar à lista</Botao>
            </div>
          </Card>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone="🧭" titulo="Trilha do Aspirante" descricao="10 lições e o checklist do lenço: o caminho de quem entrou agora no clube" />
      <Card className="mb-4">
        <Progresso valor={feitas} total={LICOES.length} rotulo={`${feitas} de ${LICOES.length} lições concluídas`} />
      </Card>
      <ol className="space-y-2.5">
        {LICOES.map((l, i) => {
          const ok = licaoConcluida(prog, l.id, MINIMO_PARA_CONCLUIR)
          return (
            <li key={l.id}>
              <button type="button" onClick={() => abrir(l.id)}
                className="w-full min-h-[44px] text-left bg-surface rounded-2xl shadow-soft p-4 flex items-center gap-3 active:scale-[0.98] transition-transform">
                <span className="text-2xl leading-none shrink-0" aria-hidden="true">{l.icone}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-ink">{i + 1}. {l.titulo}</span>
                  <span className="block text-sm text-faint leading-snug">3 perguntas no fim</span>
                </span>
                {ok ? <Selo tom="ok">Feita ✓</Selo> : <span className="text-faint" aria-hidden="true">›</span>}
              </button>
            </li>
          )
        })}
      </ol>

      <section className="mt-6" aria-labelledby="lenco-titulo">
        <h2 id="lenco-titulo" className="font-extrabold text-ink text-lg">🧣 Pronto para o lenço?</h2>
        <p className="text-sm text-muted mb-3">Os 10 requisitos da cerimônia do lenço. Marque o que você já sabe fazer; quem confere é a liderança do clube.</p>
        <Card>
          <Progresso valor={marcados} total={REQUISITOS_LENCO.length} rotulo={`${marcados} de ${REQUISITOS_LENCO.length} requisitos`} />
          <ul className="mt-3 divide-y divide-line">
            {REQUISITOS_LENCO.map((r, i) => (
              <li key={r}>
                <label className="flex items-center gap-3 min-h-[44px] py-2 cursor-pointer">
                  <input type="checkbox" className="h-5 w-5 shrink-0" checked={!!prog.lenco[i]} onChange={() => guardar(alternarLenco(prog, i))} />
                  <span className="text-sm text-ink">{i + 1}. {r}</span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
        <p className="text-xs text-faint mt-3">Fonte: Guia do Aspirante (Ministério Jovem, União Nordeste Brasileira, 2012). Seu progresso fica salvo neste aparelho.</p>
      </section>
    </div>
  )
}
