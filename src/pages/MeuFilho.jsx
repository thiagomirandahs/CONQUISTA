import { useState, useEffect } from 'react'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import AvisoOffline from '../components/AvisoOffline.jsx'
import AutorizacaoComunidade from '../components/AutorizacaoComunidade.jsx'
import { carregarMeusFilhos, meusPedidosVinculo, pedirVinculo, lerPix, concederConsentimento, revogarConsentimento } from '../lib/dados.js'
import { Carregando as Esqueleto, Cabecalho, Card, Botao, Campo, Aviso, mensagemDeErro } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'

const MESES = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// Página do responsável: acompanha o(s) filho(s) aprovado(s) — pontos, presença,
// mensalidade + PIX — e pede vínculo de novos filhos (a diretoria confirma).
// Fase 6: erro sempre humano (`mensagemDeErro`), revogar pede confirmação e toda ação dá retorno.
// As regras de quem pode conceder/revogar continuam no servidor — aqui nada mudou.
export default function MeuFilho() {
  const { profile } = useAuth()
  const [filhos, setFilhos] = useState([])
  const [pedidos, setPedidos] = useState([])
  const [pix, setPix] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [msg, setMsg] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      const [f, p, px] = await Promise.all([carregarMeusFilhos(), meusPedidosVinculo(), lerPix()])
      setFilhos(f); setPedidos(p); setPix(px)
    } catch (e) { setErro(mensagemDeErro(e, 'Não consegui carregar os dados do seu filho.')) }
    setCarregando(false)
  }
  useEffect(() => { if (profile?.id) carregar() }, [profile?.id]) // eslint-disable-line

  async function pedir(e) {
    e.preventDefault()
    if (!nome.trim() || enviando) return
    setEnviando(true); setMsg(''); setErro('')
    try { await pedirVinculo(nome.trim()); setNome(''); setMsg('Pedido enviado! A diretoria vai confirmar. 🙂'); await carregar() }
    catch (err) { setErro(mensagemDeErro(err, 'Não consegui enviar o pedido.')) }
    setEnviando(false)
  }

  const [consentindo, setConsentindo] = useState(null)
  async function conceder(vinculoId) {
    setConsentindo(vinculoId); setErro('')
    try { await concederConsentimento(vinculoId); avisar.sucesso('Consentimento registrado.'); await carregar() }
    catch (err) { setErro(mensagemDeErro(err, 'Não consegui registrar o consentimento.')) }
    setConsentindo(null)
  }
  async function revogar(consentimentoId, nomeFilho) {
    const ok = await avisar.confirmar({
      titulo: 'Revogar o consentimento?',
      descricao: `Sem o seu consentimento, o clube deixa de tratar os dados de ${nomeFilho || 'seu filho(a)'} pelo app. Você pode conceder de novo quando quiser.`,
      rotulo: 'Revogar consentimento',
    })
    if (!ok) return
    setConsentindo(consentimentoId); setErro('')
    try { await revogarConsentimento(consentimentoId); avisar.sucesso('Consentimento revogado.'); await carregar() }
    catch (err) { setErro(mensagemDeErro(err, 'Não consegui revogar o consentimento.')) }
    setConsentindo(null)
  }

  function copiarPix() {
    try { navigator.clipboard?.writeText(pix); avisar.sucesso('Chave PIX copiada!'); setMsg('Chave PIX copiada! 📋') } catch { /* sem clipboard */ }
  }

  const pendentes = pedidos.filter((p) => p.status === 'pendente')

  if (carregando) return <Esqueleto />

  return (
    <div>
      <AvisoOffline />
      <Cabecalho icone="👨‍👩‍👧" titulo="Meu Filho" descricao="Acompanhe seu(s) filho(s) no clube" />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {filhos.map((c) => (
        <Card key={c.id} className="p-0 overflow-hidden mb-3">
          <div className="p-4 flex items-center gap-3 border-b border-line">
            <Avatar foto={c.foto} nome={c.nome || '?'} size="w-14 h-14" textSize="text-xl" />
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-ink truncate">{c.nome}</div>
              <div className="text-xs text-faint">{c.unidade || 'Sem unidade'}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-line text-center">
            <div className="p-3"><div className="text-xl font-extrabold text-gold">{c.pontos}</div><div className="text-xs text-faint">pontos</div></div>
            <div className="p-3"><div className="text-xl font-extrabold text-green-600">{c.presencas}</div><div className="text-xs text-faint">presenças</div></div>
            <div className="p-3"><div className="text-xl font-extrabold text-faint">{c.faltas}</div><div className="text-xs text-faint">faltas</div></div>
          </div>
          {(c.mensalidades_pendentes || []).length > 0 && (
            <div className="p-4 bg-amber-50 border-t border-amber-100">
              <p className="text-sm font-bold text-amber-800">💰 Mensalidade pendente</p>
              <p className="text-xs text-amber-700 mt-0.5">
                {c.mensalidades_pendentes.map((m) => `${MESES[m.mes] || m.mes}/${String(m.ano).slice(2)}`).join(' · ')}
              </p>
              {pix ? (
                <div className="mt-2 bg-surface rounded-xl p-3">
                  <p className="text-xs text-faint mb-0.5">Chave PIX do clube (toque pra copiar)</p>
                  <button type="button" onClick={copiarPix} aria-label={`Copiar a chave PIX ${pix}`}
                    className="min-h-[44px] text-sm font-bold text-brand break-all text-left w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">{pix}</button>
                </div>
              ) : (
                <p className="text-xs text-amber-600 mt-1">Fale com a tesouraria pra acertar o pagamento.</p>
              )}
            </div>
          )}
          <div className="p-4 border-t border-line">
            {c.consentimento_id ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-emerald-700">✅ Consentimento concedido</p>
                <Botao variacao="discreto" className="text-xs text-muted underline" aoTocar={() => revogar(c.consentimento_id, c.nome)}
                  carregando={consentindo === c.consentimento_id} aria-label={`Revogar o consentimento de ${c.nome}`}>
                  Revogar
                </Botao>
              </div>
            ) : (
              <div>
                <p className="text-xs text-faint mb-2">
                  Consentimento como responsável por {c.nome} ainda não registrado.
                </p>
                <Botao variacao="contorno" className="w-full" aoTocar={() => conceder(c.vinculo_id)} carregando={consentindo === c.vinculo_id}>
                  Conceder consentimento
                </Botao>
              </div>
            )}
          </div>
        </Card>
      ))}

      <AutorizacaoComunidade />

      {/* Pedir vínculo */}
      <Card>
        <p className="font-bold text-ink mb-1">{filhos.length ? 'Vincular outro filho' : 'Vincular seu filho(a)'}</p>
        <p className="text-xs text-faint mb-3">Digite o nome do desbravador. A diretoria confirma o vínculo. 🙂</p>
        <form onSubmit={pedir}>
          <Campo id="nome-filho" rotulo="Nome do seu filho(a)" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80}
            placeholder="Nome do seu filho(a)" autoComplete="off" />
          <Botao tipo="submit" className="w-full" carregando={enviando} desabilitado={!nome.trim()}>Pedir vínculo</Botao>
        </form>
        {msg && <p className="text-xs text-muted mt-2" role="status">{msg}</p>}

        {pendentes.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3">
            {pendentes.map((p) => (
              <li key={p.id} className="text-xs text-muted flex items-center gap-2">
                <span aria-hidden="true">⏳</span> <span className="truncate">"{p.nome_digitado}" — aguardando a diretoria</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
