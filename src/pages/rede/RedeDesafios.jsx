import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { carregarDesafios } from '../../services/rede.js'
import { Carregando } from '../../ui/index.jsx'
import { useRede } from './contexto.js'
import { CARD, Icone, PILL, PILL_CLARA, PILL_PRIMARIA, TXT, TXT_SUAVE, VazioRede, textoDoErro } from './componentes.jsx'

// Desafios da Rede DBV (criados pelo admin da plataforma). Participar = publicar vinculado ao desafio.
// Os pontos são SÓ da rede (aparecem no perfil da rede); não entram no ranking do clube.
// Visual branco/limpo (29/09/2026): destaque por um card claro com selo roxo, sem gradiente forte.
const dias = (n) => (n === 0 ? 'último dia' : n === 1 ? 'falta 1 dia' : `faltam ${n} dias`)

function Participar({ d, podePublicar, destaque }) {
  if (d.participei) return <span className={`${PILL} bg-[var(--rede-sucesso-suave)] text-[var(--rede-sucesso)]`}>Você participou ✅</span>
  if (!podePublicar) return null
  return (
    <Link to={`/rede/publicar?desafio=${d.id}`} className={destaque ? PILL_PRIMARIA : PILL_CLARA}>Participar</Link>
  )
}
const CHIP = `rounded-full bg-[var(--rede-superficie)] px-3 py-1 ${TXT}`

export default function RedeDesafios() {
  const { status } = useRede()
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)
  const carregar = useCallback(async () => {
    setErro(null)
    try { setDados(await carregarDesafios()) } catch (e) { setErro(e) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  if (erro) return <div className="p-6 text-center"><p className={TXT}>{textoDoErro(erro, 'Não consegui abrir os desafios.')}</p>
    <button type="button" onClick={carregar} className={`${PILL_CLARA} mt-3`}>Tentar de novo</button></div>
  if (!dados) return <div className="p-4"><Carregando /></div>
  const { semana, outros = [] } = dados
  const pode = !!status?.pode_publicar

  return (
    <div className="space-y-4 px-3 py-4">
      <h1 className={`text-[22px] font-extrabold ${TXT} px-1`}>Desafios</h1>
      {semana ? (
        <section aria-labelledby="desafio-semana" className={`${CARD} p-4`}>
          <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--rede-acao)] bg-[var(--rede-acao-suave)] rounded-full px-2.5 py-0.5">
            <Icone nome="trofeu" className="w-3.5 h-3.5" /> Desafio da semana
          </p>
          <h2 id="desafio-semana" className={`text-xl font-bold mt-2 leading-tight ${TXT}`}>{semana.titulo}</h2>
          {semana.descricao && <p className={`mt-1.5 text-[14px] ${TXT_SUAVE} whitespace-pre-line`}>{semana.descricao}</p>}
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs font-semibold">
            <span className={CHIP}>+{semana.pontos} pontos</span>
            <span className={CHIP}>{dias(semana.dias_restantes)}</span>
            <span className={CHIP}>{semana.participantes} participando</span>
          </div>
          <div className="mt-4"><Participar d={semana} podePublicar={pode} destaque /></div>
        </section>
      ) : (
        <VazioRede icone="🏅" titulo="Nenhum desafio aberto agora">Logo tem desafio novo na rede!</VazioRede>
      )}
      {outros.length > 0 && (
        <section aria-labelledby="outros-desafios">
          <h2 id="outros-desafios" className={`text-[13px] font-semibold ${TXT_SUAVE} px-1 mb-2`}>Outros desafios</h2>
          <ul className="space-y-3">
            {outros.map((d) => (
              <li key={d.id} className={`${CARD} p-4`}>
                <p className={`font-semibold ${TXT}`}>{d.titulo}</p>
                {d.descricao && <p className={`text-sm ${TXT_SUAVE} mt-1`}>{d.descricao}</p>}
                <div className="flex items-center justify-between gap-2 mt-3">
                  <p className={`text-xs font-semibold ${TXT_SUAVE}`}>+{d.pontos} pts · {dias(d.dias_restantes)}</p>
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
