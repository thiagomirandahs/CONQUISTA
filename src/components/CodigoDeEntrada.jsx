import { useCallback, useEffect, useState } from 'react'
import { useClube } from '../context/Clube.jsx'
import { codigoAtual, gerarCodigo, revogarCodigo } from '../services/entrada.js'
import { Card, Botao } from '../ui/index.jsx'

// O código de entrada do clube (fase 8.6) — o cartaz/QR que substitui gerar convite individual
// para cada desbravador.
//
// Duas coisas que a tela precisa deixar claras, porque são contraintuitivas:
//
//   · o código NÃO dá acesso. Quem o usa entra numa fila de aprovação. É por isso que ele pode
//     ficar num mural: vazado, vira no máximo pedidos para a liderança recusar;
//   · o código não é recuperável. Ele aparece UMA vez, aqui, e o banco guarda só o hash. Quem
//     perdeu o papel onde anotou gera outro — e gerar revoga o anterior no mesmo ato, para não
//     existirem dois cartazes válidos ao mesmo tempo.
const PRAZOS = [
  { valor: '', texto: 'Sem prazo' },
  { valor: '7', texto: '7 dias' },
  { valor: '30', texto: '30 dias' },
  { valor: '90', texto: '90 dias' },
]

const dia = (iso) => { try { return new Date(iso).toLocaleDateString('pt-BR') } catch { return '' } }

export default function CodigoDeEntrada() {
  const { podeGerir, clubeId } = useClube()
  const [estado, setEstado] = useState(null)
  const [novo, setNovo] = useState(null)      // o código em claro, só nesta sessão de tela
  const [prazo, setPrazo] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  // Recarrega quando o CLUBE EM USO muda: o código é de um clube, e trocar de aba tem de trocar o
  // que a tela mostra — nunca herdar o do clube anterior.
  const carregar = useCallback(() => {
    codigoAtual().then(setEstado).catch(() => setEstado(null))
  }, [])
  useEffect(() => { if (podeGerir) { setNovo(null); carregar() } }, [podeGerir, clubeId, carregar])

  if (!podeGerir) return null

  async function gerar() {
    setErro(''); setOcupado(true)
    try {
      const r = await gerarCodigo(prazo ? Number(prazo) : null)
      setNovo(r.codigo)
      carregar()
    } catch (e) { setErro(e.message) }
    setOcupado(false)
  }

  async function revogar() {
    setErro(''); setOcupado(true)
    try { await revogarCodigo(); setNovo(null); carregar() } catch (e) { setErro(e.message) }
    setOcupado(false)
  }

  return (
    <Card className="p-4" data-testid="codigo-de-entrada">
      <p className="font-extrabold text-ink">🎟️ Código de entrada</p>
      <p className="text-xs text-muted mt-1 mb-3">
        Divulgue este código para quem vai entrar no clube. Quem usar entra na fila de aprovação —
        o código <strong>não</strong> libera ninguém sozinho.
      </p>

      {novo && (
        <div className="rounded-xl bg-surface2 p-3 mb-3 text-center" data-testid="codigo-novo">
          <p className="font-mono text-lg tracking-[0.2em] font-extrabold text-ink break-all">{novo}</p>
          <p className="text-[11px] text-muted mt-1">
            Anote agora: por segurança, este código não pode ser mostrado de novo.
          </p>
        </div>
      )}

      {estado?.existe ? (
        <p className="text-xs text-muted mb-3" data-testid="codigo-situacao">
          Há um código no ar (começa com <strong className="font-mono">{estado.prefixo}</strong>),
          criado em {dia(estado.criado_em)}
          {estado.expira_em ? `, válido até ${dia(estado.expira_em)}` : ', sem prazo'}
          {estado.vencido ? ' — vencido.' : '.'}
        </p>
      ) : (
        <p className="text-xs text-muted mb-3" data-testid="codigo-situacao">Nenhum código ativo.</p>
      )}

      <div className="flex gap-2">
        <select value={prazo} onChange={(e) => setPrazo(e.target.value)} data-testid="codigo-prazo"
          className="min-h-[44px] text-sm rounded-xl border border-line px-2 bg-surface2 text-ink">
          {PRAZOS.map((p) => <option key={p.valor} value={p.valor}>{p.texto}</option>)}
        </select>
        <div className="flex-1">
          <Botao aoTocar={gerar} carregando={ocupado} data-testid="codigo-gerar">
            {estado?.existe ? 'Gerar outro' : 'Gerar código'}
          </Botao>
        </div>
      </div>
      {estado?.existe && (
        <button onClick={revogar} disabled={ocupado} data-testid="codigo-revogar"
          className="mt-2 w-full min-h-[44px] text-sm text-muted font-semibold">
          Revogar o código atual
        </button>
      )}
      {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
    </Card>
  )
}
