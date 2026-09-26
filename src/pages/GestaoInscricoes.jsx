import { useCallback, useEffect, useState } from 'react'
import { useClube } from '../context/Clube.jsx'
import { codigoAtual, gerarCodigo, revogarCodigo } from '../services/entrada.js'
import { qrSvg } from '../lib/qr.js'
import { Card, Botao, Cabecalho } from '../ui/index.jsx'
import SolicitacoesPendentes from '../components/SolicitacoesPendentes.jsx'
import { avisar } from '../ui/avisos.jsx'

const PRAZOS = [
  { valor: '', texto: 'Sem prazo' },
  { valor: '7', texto: '7 dias' },
  { valor: '30', texto: '30 dias' },
  { valor: '90', texto: '90 dias' },
]

const dia = (iso) => { try { return new Date(iso).toLocaleDateString('pt-BR') } catch { return '' } }

// Gestão → Inscrições — jornada própria pro código público de entrada, que antes só existia
// escondido dentro de Aprovações. Reaproveita 100% do backend já seguro (club_entry_codes,
// clube_codigo_gerar/atual/revogar, entrada_abrir/solicitar) — nenhuma tabela, RPC ou mecanismo
// novo. O código em claro só existe NA TELA, no instante em que é gerado (o banco guarda só o
// hash) — por isso "copiar link"/"QR" só aparecem logo depois de gerar, nunca depois: não tem
// como reexibir um código já existente, por desenho (mesmo princípio de uma senha).
export default function GestaoInscricoes() {
  const { podeAdministrar: podeGerir, clubeId, marca } = useClube()   // migration 210: inscrições são só da diretoria
  const [estado, setEstado] = useState(null)
  const [novo, setNovo] = useState(null) // { codigo } — só nesta sessão de tela
  const [prazo, setPrazo] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [qtdPendentes, setQtdPendentes] = useState(null)

  const carregar = useCallback(() => {
    codigoAtual().then(setEstado).catch(() => setEstado(null))
  }, [])
  useEffect(() => {
    if (!podeGerir) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpa o código recém-gerado ao trocar de clube (mesmo padrão de recarregar-ao-mudar-contexto já usado no projeto)
    setNovo(null)
    carregar()
  }, [podeGerir, clubeId, carregar])

  if (!podeGerir) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área restrita</p>
        <p className="text-sm text-faint">Apenas a diretoria gerencia inscrições.</p>
      </div>
    )
  }

  const linkDe = (codigo) => `${window.location.origin}/entrar?codigo=${encodeURIComponent(codigo)}`

  async function gerar() {
    setErro(''); setOcupado(true)
    try {
      const r = await gerarCodigo(prazo ? Number(prazo) : null)
      setNovo({ codigo: r.codigo })
      carregar()
    } catch (e) { setErro(e.message) }
    setOcupado(false)
  }

  async function revogar() {
    setErro(''); setOcupado(true)
    try { await revogarCodigo(); setNovo(null); carregar() } catch (e) { setErro(e.message) }
    setOcupado(false)
  }

  async function copiar(texto, rotulo) {
    try { await navigator.clipboard.writeText(texto); avisar.sucesso(`${rotulo} copiado.`) } catch { /* clipboard indisponível — sem drama */ }
  }

  async function compartilhar(link) {
    const dados = { title: `Inscrição no ${marca?.nome || 'clube'}`, text: `Peça sua entrada no ${marca?.nome || 'clube'} pelo DesbravaClube:`, url: link }
    if (navigator.share) { try { await navigator.share(dados); return } catch { return } }
    copiar(link, 'Link')
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone="🔗" titulo="Inscrições" descricao="Link e QR Code para novos membros" />
      <p className="text-sm text-muted -mt-2 mb-4" data-testid="clube-da-inscricao">Clube: <strong className="text-ink">{marca?.nome}</strong></p>

      <Card className="p-4 mb-5" data-testid="codigo-de-entrada">
        <p className="font-extrabold text-ink">Código/link de entrada do clube</p>
        <p className="text-xs text-muted mt-1 mb-3">
          Divulgue em cartaz, Instagram, WhatsApp ou QR. Quem usar entra numa fila de aprovação — o
          código <strong>não</strong> libera ninguém sozinho, e não concede papel nenhum de liderança.
        </p>

        {novo && (
          <div className="rounded-xl bg-surface2 p-3 mb-3 text-center" data-testid="codigo-novo">
            <p className="font-mono text-lg tracking-[0.2em] font-extrabold text-ink break-all">{novo.codigo}</p>
            <p className="text-[11px] text-muted mt-1 mb-3">
              Anote/salve agora: por segurança, este código não aparece de novo depois que você sair
              desta tela.
            </p>
            <div className="w-36 h-36 mx-auto mb-2" dangerouslySetInnerHTML={{ __html: qrSvg(linkDe(novo.codigo)) }} />
            <p className="text-[11px] text-muted break-all mb-3" data-testid="link-completo">{linkDe(novo.codigo)}</p>
            <button onClick={() => compartilhar(linkDe(novo.codigo))} data-testid="compartilhar-link"
              className="w-full min-h-[44px] mb-2 text-sm font-bold rounded-lg bg-gradient-to-r from-brand to-brand2 text-white">
              Compartilhar link
            </button>
            <div className="flex gap-2">
              <button onClick={() => copiar(linkDe(novo.codigo), 'Link')} className="flex-1 min-h-[44px] text-xs font-semibold rounded-lg border border-line">
                Copiar link
              </button>
              <button onClick={() => copiar(novo.codigo, 'Código')} className="flex-1 min-h-[44px] text-xs font-semibold rounded-lg border border-line">
                Copiar código
              </button>
            </div>
          </div>
        )}

        {estado?.existe ? (
          <p className="text-xs text-muted mb-3" data-testid="codigo-situacao">
            Há um código no ar (começa com <strong className="font-mono">{estado.prefixo}</strong>),
            criado em {dia(estado.criado_em)}
            {estado.expira_em ? `, válido até ${dia(estado.expira_em)}` : ', sem prazo'}
            {estado.vencido ? ' — vencido.' : '.'}
            {!novo && ' O link/QR só aparecem de novo se você gerar outro (o código em claro não fica guardado).'}
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
              {estado?.existe ? 'Gerar outro (revoga o atual)' : 'Gerar código'}
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

      <h3 className="text-sm font-extrabold text-ink mb-2">
        Solicitações pendentes{qtdPendentes !== null ? ` (${qtdPendentes})` : ''}
      </h3>
      <SolicitacoesPendentes onContagem={setQtdPendentes} />

      {/* Convites de equipe (papel privilegiado) são deliberadamente uma seção separada — nunca
          o mesmo QR/link público, e continuam fora desta tela até terem front-end próprio. */}
      <div className="mt-6 pt-4 border-t border-line">
        <h3 className="text-sm font-extrabold text-ink mb-1">Convites da equipe</h3>
        <p className="text-xs text-faint">
          Convites individuais para diretoria/instrutor/tesouraria continuam sendo gerados de outra
          forma — nunca pelo código público acima. Esta seção ainda não tem tela própria.
        </p>
      </div>
    </div>
  )
}
