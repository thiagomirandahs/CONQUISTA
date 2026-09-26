import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { conviteAbrir, conviteAceitar, rotuloPapel, TIPO_ROTULO } from '../services/hierarquia.js'
import { EsqueletoTela } from '../ui/carregamento.jsx'

// /coordenacao?token=... — convite de coordenação gerado no /admin (migration 130).
// Exige sessão (a rota passa por SessaoObrigatoria: sem conta, a pessoa cria/entra e volta pra cá).
// Link com unidade definida: o vínculo nasce ATIVO. Link genérico: a pessoa escolhe a unidade e o
// vínculo fica PENDENTE até a administração confirmar. O servidor decide tudo pelo token.
export default function ConviteCoordenacao() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [convite, setConvite] = useState(null)
  const [erro, setErro] = useState('')
  const [escolha, setEscolha] = useState('')
  const [resultado, setResultado] = useState(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!token) { setConvite({ encontrado: false }); return }
    conviteAbrir(token).then(setConvite).catch((e) => setErro(e?.message || String(e)))
  }, [token])

  const aceitar = async () => {
    setEnviando(true); setErro('')
    try {
      const r = await conviteAceitar(token, convite.modo === 'escolha' ? escolha || null : null)
      if (!r?.encontrado) setConvite({ encontrado: false })
      else setResultado(r)
    } catch (e) { setErro(e?.message || String(e)) }
    setEnviando(false)
  }

  const caixa = 'rounded-2xl border border-line bg-surface p-5'
  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-xl font-extrabold text-ink mb-4">Convite de coordenação</h1>
      {erro && <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 mb-4">{erro}</div>}
      {convite === null && !erro && <EsqueletoTela cabecalho={false} cartoes={2} />}

      {convite && !convite.encontrado && (
        <div className={caixa}>
          <p className="font-semibold text-ink">Link inválido ou vencido</p>
          <p className="text-sm text-muted mt-1">Peça um link novo à administração.</p>
        </div>
      )}

      {convite?.encontrado && !resultado && (
        <div className={caixa}>
          <p className="text-sm text-muted">Você foi convidado(a) para</p>
          <p className="text-lg font-bold text-ink">{rotuloPapel(convite.papel)}</p>
          {convite.modo === 'fixo' && convite.unidade && (
            <p className="text-sm text-ink mt-1">{convite.unidade.caminho || convite.unidade.nome}</p>
          )}
          {convite.modo === 'escolha' && (
            <div className="mt-3">
              <label htmlFor="cc-unidade" className="block text-xs font-semibold text-muted mb-1">
                Escolha o seu {TIPO_ROTULO[convite.tipo_unidade]?.toLowerCase() || 'unidade'}
              </label>
              <select id="cc-unidade" value={escolha} onChange={(e) => setEscolha(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm text-ink">
                <option value="">Escolha…</option>
                {(convite.opcoes || []).map((o) => <option key={o.id} value={o.id}>{o.caminho || o.nome}</option>)}
              </select>
              <p className="text-xs text-faint mt-2">Seu acesso começa depois que a administração confirmar.</p>
            </div>
          )}
          <p className="text-xs text-faint mt-3">
            O portal da coordenação mostra só números gerais dos clubes — nunca chat, fotos, financeiro ou dados das famílias.
          </p>
          <button type="button" onClick={aceitar} disabled={enviando || (convite.modo === 'escolha' && !escolha)}
            className="mt-4 w-full min-h-[48px] rounded-xl border-2 border-brand text-brand font-bold disabled:opacity-60">
            {enviando ? 'Só um instante…' : 'Aceitar convite'}
          </button>
        </div>
      )}

      {resultado && (
        <div className={caixa} data-testid="convite-coordenacao-ok">
          {resultado.situacao === 'pendente'
            ? <><p className="font-semibold text-ink">Pedido enviado</p><p className="text-sm text-muted mt-1">Aguardando a confirmação da administração{resultado.unidade ? ` para ${resultado.unidade}` : ''}.</p></>
            : <><p className="font-semibold text-ink">Tudo certo!</p><p className="text-sm text-muted mt-1">Você já está na coordenação{resultado.unidade ? ` de ${resultado.unidade}` : ''}.</p></>}
          {resultado.situacao !== 'pendente' && (
            <Link to="/institucional" className="mt-4 flex items-center justify-center w-full min-h-[48px] rounded-xl border-2 border-brand text-brand font-bold">
              Abrir o portal
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
