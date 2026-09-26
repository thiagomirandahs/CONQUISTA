// Inativação com MOTIVO e histórico do vínculo (migration 310, decisão do dono 26/09: inativo não
// se apaga; fica no clube com o motivo registrado). Só a diretoria usa estas telas — o servidor
// confere (pode_administrar_clube) e o membro nunca vê o motivo.
import { useState, useEffect } from 'react'
import { inativarMembro, reativarMembro, historicoDoMembro } from '../lib/dados.js'
import { MOTIVOS_INATIVACAO, ROTULO_MOTIVO, ROTULO_ACAO, MOTIVO_TEXTO_MAX } from '../lib/motivosInativacao.js'

const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

function Folha({ titulo, children, onFechar, ocupado }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6"
      onClick={ocupado ? undefined : onFechar}>
      <div role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-ink mb-2">{titulo}</h3>
        {children}
      </div>
    </div>
  )
}

// Desativar: motivo obrigatório (lista + texto curto; "Outro" exige texto).
export function ModalInativar({ usuario, onFechar, onFeito }) {
  const [categoria, setCategoria] = useState('')
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const valido = !!categoria && (categoria !== 'outro' || texto.trim().length > 0)

  async function confirmar() {
    if (!valido || ocupado) return
    setOcupado(true); setErro('')
    try {
      await inativarMembro(usuario.id, { categoria, texto })
      onFeito?.(usuario, { categoria, texto: texto.trim() })
    } catch (e) {
      setErro(e?.message || String(e)); setOcupado(false)
    }
  }

  return (
    <Folha titulo={`Desativar ${usuario.nome || 'esta pessoa'}`} onFechar={onFechar} ocupado={ocupado}>
      <p className="text-sm text-muted mb-3">
        Ela perde o acesso a este clube e some do ranking. Ao entrar, verá que o acesso está suspenso.
        Nada é apagado: pontos e classes ficam guardados e dá pra reativar depois.
      </p>
      <fieldset>
        <legend className="text-sm font-semibold text-ink mb-1">Motivo (obrigatório)</legend>
        <div className="space-y-1">
          {MOTIVOS_INATIVACAO.map((m) => (
            <label key={m.valor} className="flex items-center gap-3 min-h-[44px] rounded-xl border border-line px-3 text-sm text-ink">
              <input type="radio" name="motivo-inativacao" value={m.valor} checked={categoria === m.valor}
                onChange={() => setCategoria(m.valor)} disabled={ocupado} />
              {m.rotulo}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor="motivo-texto" className="block text-sm font-semibold text-ink mt-3">
        {categoria === 'outro' ? 'Escreva o motivo' : 'Observação (opcional)'}
      </label>
      <textarea id="motivo-texto" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={MOTIVO_TEXTO_MAX} rows={2}
        disabled={ocupado} className="mt-1 w-full rounded-xl border border-line bg-surface2 text-ink px-3 py-2 text-sm outline-none focus:border-brand" />
      <p className="text-xs text-faint">Só a diretoria vê o motivo. {texto.length}/{MOTIVO_TEXTO_MAX}</p>
      {erro && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mt-2">{erro}</div>}
      <div className="flex gap-2 mt-3">
        <button onClick={onFechar} disabled={ocupado} className="flex-1 min-h-[44px] rounded-xl bg-surface2 text-ink font-semibold">Cancelar</button>
        <button onClick={confirmar} disabled={!valido || ocupado} data-testid="confirmar-inativar"
          className="flex-1 min-h-[44px] rounded-xl bg-red-600 text-white font-bold disabled:opacity-40">
          {ocupado ? 'Desativando...' : 'Desativar'}
        </button>
      </div>
    </Folha>
  )
}

// Reativar: motivo opcional (também vai para o histórico).
export function ModalReativar({ usuario, onFechar, onFeito }) {
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  async function confirmar() {
    if (ocupado) return
    setOcupado(true); setErro('')
    try {
      await reativarMembro(usuario.id, { texto })
      onFeito?.(usuario)
    } catch (e) {
      setErro(e?.message || String(e)); setOcupado(false)
    }
  }

  return (
    <Folha titulo={`Reativar ${usuario.nome || 'esta pessoa'}`} onFechar={onFechar} ocupado={ocupado}>
      <p className="text-sm text-muted mb-2">Ela volta a ter acesso a este clube, com todo o histórico.</p>
      <label htmlFor="reativar-texto" className="block text-sm font-semibold text-ink">Motivo (opcional)</label>
      <textarea id="reativar-texto" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={MOTIVO_TEXTO_MAX} rows={2}
        disabled={ocupado} className="mt-1 w-full rounded-xl border border-line bg-surface2 text-ink px-3 py-2 text-sm outline-none focus:border-brand" />
      {erro && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mt-2">{erro}</div>}
      <div className="flex gap-2 mt-3">
        <button onClick={onFechar} disabled={ocupado} className="flex-1 min-h-[44px] rounded-xl bg-surface2 text-ink font-semibold">Cancelar</button>
        <button onClick={confirmar} disabled={ocupado} data-testid="confirmar-reativar"
          className="flex-1 min-h-[44px] rounded-xl bg-green-600 text-white font-bold disabled:opacity-40">
          {ocupado ? 'Reativando...' : 'Reativar'}
        </button>
      </div>
    </Folha>
  )
}

// Linha do tempo de inativações e reativações do membro neste clube.
export function ModalHistorico({ usuario, onFechar }) {
  const [itens, setItens] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    historicoDoMembro(usuario.id).then(setItens).catch((e) => setErro(e?.message || String(e)))
  }, [usuario.id])

  return (
    <Folha titulo={`Histórico de ${usuario.nome || 'membro'}`} onFechar={onFechar}>
      {erro ? <p role="alert" className="text-sm text-red-700">{erro}</p>
        : itens === null ? <p className="text-sm text-muted">Carregando...</p>
          : itens.length === 0 ? <p className="text-sm text-muted">Nenhuma inativação registrada.</p>
            : (
              <ol className="relative ml-1.5 space-y-3 border-l border-line pl-4" data-testid="historico-lista">
                {itens.map((h) => (
                  <li key={h.id}>
                    <p className="text-sm font-semibold text-ink">
                      {ROTULO_ACAO[h.acao] || h.acao} <span className="text-muted font-normal">· {dataBR(h.em)}</span>
                    </p>
                    {(h.motivo_categoria || h.motivo_texto) && (
                      <p className="text-sm text-muted">
                        {h.motivo_categoria ? ROTULO_MOTIVO[h.motivo_categoria] || h.motivo_categoria : ''}
                        {h.motivo_texto ? `${h.motivo_categoria ? ': ' : ''}${h.motivo_texto}` : ''}
                      </p>
                    )}
                    {h.feito_por_nome && <p className="text-xs text-faint">por {h.feito_por_nome}</p>}
                  </li>
                ))}
              </ol>
            )}
      <button onClick={onFechar} className="w-full min-h-[44px] rounded-xl bg-surface2 text-ink font-semibold mt-4">Fechar</button>
    </Folha>
  )
}
