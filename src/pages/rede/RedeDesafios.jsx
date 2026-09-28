import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { carregarDesafios } from '../../services/rede.js'
import { Carregando } from '../../ui/index.jsx'
import { useRede } from './contexto.js'
import { CARD, GRADIENTE, Icone, PILL, PILL_CLARA, TXT, TXT_SUAVE, VazioRede, textoDoErro } from './componentes.jsx'

// Desafios da Rede DBV (criados pelo admin da plataforma). Participar = publicar vinculado ao desafio.
// Os pontos são SÓ da rede (aparecem no perfil da rede); não entram no ranking do clube.
const dias = (n) => (n === 0 ? 'último dia' : n === 1 ? 'falta 1 dia' : `faltam ${n} dias`)

function Participar({ d, podePublicar, clara }) {
  if (d.participei) return <span className={`${PILL} ${clara ? 'bg-white/20 text-white' : 'bg-[#e7f6ea] text-[#1f5a2e]'}`}>Você participou ✅</span>
  if (!podePublicar) return null
  return (
    <Link to={`/rede/publicar?desafio=${d.id}`} className={clara ? `${PILL} bg-white text-[#3b2bd9]` : PILL_CLARA}>Participar</Link>
  )
}

export default function RedeDesafios() {
  const { status } = useRede()
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)
  const carregar = useCallback(async () => {
    setErro(null)
    try { setDados(await carregarDesafios()) } catch (e) { setErro(e) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  if (erro) return <div className={`${CARD} p-6 text-center`}><p className={TXT}>{textoDoErro(erro, 'Não consegui abrir os desafios.')}</p>
    <button type="button" onClick={carregar} className={`${PILL_CLARA} mt-3`}>Tentar de novo</button></div>
  if (!dados) return <Carregando />
  const { semana, outros = [] } = dados
  const pode = !!status?.pode_publicar

  return (
    <div className="space-y-4">
      {semana ? (
        <section aria-labelledby="desafio-semana" className={`${GRADIENTE} rounded-3xl p-5 text-white shadow-[0_14px_30px_-16px_#4b3cff]`}>
          <p className="text-xs font-bold uppercase tracking-wider opacity-90 flex items-center gap-1"><Icone nome="trofeu" className="w-4 h-4" /> Desafio da semana</p>
          <h1 id="desafio-semana" className="text-2xl font-black mt-1 leading-tight">{semana.titulo}</h1>
          {semana.descricao && <p className="mt-2 text-sm opacity-95 whitespace-pre-line">{semana.descricao}</p>}
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs font-bold">
            <span className="rounded-full bg-white/20 px-3 py-1">+{semana.pontos} pontos</span>
            <span className="rounded-full bg-white/20 px-3 py-1">{dias(semana.dias_restantes)}</span>
            <span className="rounded-full bg-white/20 px-3 py-1">{semana.participantes} participando</span>
          </div>
          <div className="mt-4"><Participar d={semana} podePublicar={pode} clara /></div>
        </section>
      ) : (
        <VazioRede icone="🏅" titulo="Nenhum desafio aberto agora">Logo tem desafio novo na rede!</VazioRede>
      )}
      {outros.length > 0 && (
        <section aria-labelledby="outros-desafios">
          <h2 id="outros-desafios" className={`font-extrabold ${TXT} mb-2`}>Outros desafios</h2>
          <ul className="space-y-3">
            {outros.map((d) => (
              <li key={d.id} className={`${CARD} p-4`}>
                <p className={`font-extrabold ${TXT}`}>{d.titulo}</p>
                {d.descricao && <p className={`text-sm ${TXT_SUAVE} mt-1`}>{d.descricao}</p>}
                <div className="flex items-center justify-between gap-2 mt-3">
                  <p className={`text-xs font-bold ${TXT_SUAVE}`}>+{d.pontos} pts · {dias(d.dias_restantes)}</p>
                  <Participar d={d} podePublicar={pode} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className={`text-xs ${TXT_SUAVE} text-center`}>Os pontos dos desafios valem só aqui na Rede DBV (aparecem no seu perfil da rede).</p>
    </div>
  )
}
