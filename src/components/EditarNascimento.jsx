import { useEffect, useState } from 'react'
import { definirNascimento, nascimentoDoMembro, validarNascimento } from '../services/usuarios.js'
import { mensagemDeErro } from '../ui/index.jsx'
import { EsqueletoTela } from '../ui/carregamento.jsx'

const fmt = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

// Corrigir a data de nascimento (migration 170). Serve à própria pessoa (Meu perfil) e à liderança
// (gestão de membros). Dois passos: escolher a data -> confirmar, dizendo o efeito (a idade decide
// quais classes ficam liberadas). Quem decide se pode é o servidor (nascimento_definir).
export default function EditarNascimento({ usuarioId, nome, proprio = false, valorAtual, onFechar, onSalvo }) {
  const [atual, setAtual] = useState(valorAtual ?? null)
  const [carregando, setCarregando] = useState(!proprio && valorAtual === undefined)
  const [data, setData] = useState(valorAtual ? String(valorAtual).slice(0, 10) : '')
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  // a liderança não recebe o nascimento na lista de membros: busca só ao abrir a correção
  useEffect(() => {
    if (proprio || valorAtual !== undefined) return
    let vivo = true
    nascimentoDoMembro(usuarioId)
      .then((d) => { if (vivo) { setAtual(d); setData(d ? String(d).slice(0, 10) : '') } })
      .catch((e) => { if (vivo) setErro(mensagemDeErro(e)) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [usuarioId, proprio, valorAtual])

  function revisar() {
    const problema = validarNascimento(data)
    if (problema) { setErro(problema); return }
    setErro('')
    setConfirmando(true)
  }

  async function salvar() {
    setSalvando(true); setErro('')
    try {
      await definirNascimento(usuarioId, data)
      await onSalvo?.(data)
    } catch (e) {
      setErro(mensagemDeErro(e))
      setSalvando(false)
      setConfirmando(false)
    }
  }

  const quem = proprio ? 'sua' : `de ${(nome || 'esta pessoa').split(' ')[0]}`
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={salvando ? undefined : onFechar}>
      <div role="dialog" aria-modal="true" aria-labelledby="titulo-nascimento" onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto" data-testid="editar-nascimento">
        <h3 id="titulo-nascimento" className="text-lg font-extrabold text-ink mb-1">🎂 Data de nascimento</h3>
        <p className="text-sm text-muted mb-3">
          Corrigir a data {quem}. A idade define quais classes ficam liberadas.
        </p>
        {carregando ? (
          <EsqueletoTela cabecalho={false} cartoes={2} />
        ) : confirmando ? (
          <>
            <p className="text-sm text-ink bg-surface2 rounded-xl p-3 mb-3" data-testid="confirmacao-nascimento">
              Trocar {atual ? <>de <b>{fmt(atual)}</b> </> : ''}para <b>{fmt(data)}</b>?
            </p>
            {erro && <p role="alert" className="text-sm text-red-700 mb-3">{erro}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmando(false)} disabled={salvando}
                className="flex-1 min-h-[48px] rounded-xl bg-surface2 text-ink font-semibold">Voltar</button>
              <button type="button" onClick={salvar} disabled={salvando} data-testid="confirmar-nascimento"
                className="flex-1 min-h-[48px] rounded-xl bg-brand text-white font-bold disabled:opacity-60">
                {salvando ? 'Salvando…' : 'Confirmar'}
              </button>
            </div>
          </>
        ) : (
          <>
            <label htmlFor="campo-nascimento" className="block text-xs font-semibold text-muted mb-1">Nova data</label>
            <input id="campo-nascimento" type="date" value={data} onChange={(e) => setData(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full min-h-[48px] rounded-xl border border-line bg-surface2 text-ink px-3 text-base mb-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
            {erro && <p role="alert" className="text-sm text-red-700 mb-3">{erro}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={onFechar}
                className="flex-1 min-h-[48px] rounded-xl bg-surface2 text-ink font-semibold">Cancelar</button>
              <button type="button" onClick={revisar} data-testid="revisar-nascimento"
                className="flex-1 min-h-[48px] rounded-xl bg-brand text-white font-bold">Continuar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
