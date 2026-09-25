import { useState, useEffect, useCallback, useMemo } from 'react'
import { Cabecalho, Card, Botao, Aviso, Selo, Carregando, Vazio, Selecao, Campo } from '../ui/index.jsx'
import { carregarDocumentosDoClube, gerarPdf, baixarPdf, assinarLote, gerarRepresentacaoFinal, ROTULO_ESTADO } from '../services/documentos.js'
import AssinarDocumentoModal from '../components/AssinarDocumentoModal.jsx'
import RevisarDocumentoModal from '../components/RevisarDocumentoModal.jsx'
import { useClube } from '../context/Clube.jsx'
import { avisar } from '../ui/avisos.jsx'

const TOM_ESTADO = {
  em_preparacao: 'atencao', pronto_revisao: 'atencao', correcao_solicitada: 'perigo',
  pronto_para_assinatura: 'info', parcialmente_assinado: 'info',
  assinado: 'ok', substituido: 'neutro', revogado: 'perigo',
}
const REVISAVEIS = ['pronto_revisao', 'correcao_solicitada']
const ASSINAVEIS = ['pronto_para_assinatura', 'parcialmente_assinado']
const DECLARACAO_LOTE = 'Declaro que revisei os documentos selecionados e confirmo suas assinaturas eletrônicas.'

const fmt = (iso) => { try { return new Date(iso).toLocaleDateString('pt-BR') } catch { return '—' } }

// Gestão → Documentos (Fase 4: Bloco 1 = PDF; Bloco 2 = assinatura eletrônica). REÚNE o que já
// existia — não cria um segundo sistema de documentos, não corrige requisito/evidência/aprovação
// (isso continua em Avaliar Classes/Especialidades; esta tela nunca toca member_requirements).
export default function GestaoDocumentos() {
  const { clubeId } = useClube()
  const [docs, setDocs] = useState(null)
  const [erro, setErro] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [ocupado, setOcupado] = useState(null)
  const [assinando, setAssinando] = useState(null) // documento sendo assinado (abre o modal)
  const [revisando, setRevisando] = useState(null) // documento sendo revisado (abre o modal)
  const [selecionados, setSelecionados] = useState(() => new Set())
  const [loteAberto, setLoteAberto] = useState(false)
  const [consentimentoLote, setConsentimentoLote] = useState('')
  const [loteOcupado, setLoteOcupado] = useState(false)

  const carregar = useCallback(() => {
    carregarDocumentosDoClube().then(setDocs).catch((e) => setErro(e.message))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    if (!docs) return []
    return filtroEstado ? docs.filter((d) => d.estado === filtroEstado) : docs
  }, [docs, filtroEstado])

  async function gerar(token) {
    setOcupado(token)
    try { await gerarPdf(token); avisar.sucesso('PDF gerado.'); carregar() } catch (e) { avisar.erro(e) }
    setOcupado(null)
  }

  async function gerarFinal(token) {
    setOcupado(token)
    try {
      const r = await gerarRepresentacaoFinal(token)
      avisar.sucesso(r.gerado_agora ? 'Representação final (H2) gerada.' : 'Representação final já existia para estas assinaturas.')
      carregar()
    } catch (e) { avisar.erro(e) }
    setOcupado(null)
  }

  async function baixar(d) {
    if (!d.pdf_storage_path) return
    setOcupado(d.token)
    try {
      // entrega o PDF JÁ ARMAZENADO — nunca regenera só para "ver/baixar" (regenerar é uma ação
      // explícita própria, botão "Gerar novo PDF"). URL assinada, curta (5 min), bucket privado.
      const url = await baixarPdf(d.pdf_storage_path)
      window.open(url, '_blank', 'noopener')
    } catch (e) { avisar.erro(e) }
    setOcupado(null)
  }

  function alternarSelecao(token) {
    setSelecionados((s) => {
      const novo = new Set(s)
      if (novo.has(token)) novo.delete(token); else novo.add(token)
      return novo
    })
  }

  async function confirmarLote() {
    if (consentimentoLote.trim().length < 20) { avisar.erro(null, 'Confirme a declaração antes de assinar em lote.'); return }
    setLoteOcupado(true)
    try {
      const r = await assinarLote([...selecionados], consentimentoLote.trim())
      const falhas = (r.itens || []).filter((i) => !i.ok)
      if (falhas.length === 0) avisar.sucesso(`${r.assinados} documento(s) assinado(s).`)
      else avisar.erro(null, `${r.assinados} assinado(s), ${r.recusados} recusado(s): ${falhas.map((f) => f.motivo).join('; ')}`)
      setSelecionados(new Set()); setLoteAberto(false); setConsentimentoLote('')
      carregar()
    } catch (e) { avisar.erro(e) }
    setLoteOcupado(false)
  }

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (!docs) return <Carregando />

  return (
    <div className="max-w-3xl mx-auto">
      <Cabecalho icone="📄" titulo="Documentos" descricao="Documentos de classe emitidos neste clube — PDF, assinatura eletrônica e verificação" />

      <Aviso tom="info">
        Esta tela não corrige requisito, evidência ou aprovação — isso continua em Avaliar
        Classes/Especialidades. A assinatura é eletrônica interna do DesbravaClube (não é
        ICP-Brasil/qualificada/avançada).
      </Aviso>

      <Selecao id="filtro-estado" rotulo="Filtrar por status" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}
        opcoes={[['', 'Todos'], ...Object.entries(ROTULO_ESTADO)]} />

      {selecionados.size > 0 && (
        <div className="sticky top-0 z-10 bg-surface rounded-xl shadow-soft p-3 mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{selecionados.size} documento(s) selecionado(s)</p>
          <Botao aoTocar={() => setLoteAberto(true)} data-testid="abrir-lote">Assinar selecionados</Botao>
        </div>
      )}

      {filtrados.length === 0
        ? <Vazio icone="📄" titulo="Nenhum documento" >Nenhum documento emitido ainda neste clube{filtroEstado ? ' com esse status' : ''}.</Vazio>
        : (
          <div className="space-y-3">
            {filtrados.map((d) => (
              <Card key={d.documento_id} data-testid="documento-item">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-start gap-2">
                    {ASSINAVEIS.includes(d.estado) && (
                      <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" aria-label={`Selecionar ${d.titular_nome}`}
                        checked={selecionados.has(d.token)} onChange={() => alternarSelecao(d.token)} />
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-ink truncate">{d.titular_nome}</p>
                      <p className="text-xs text-muted">{d.classe_nome} · {d.tipo === 'final' ? 'Documento final' : 'Acompanhamento'} · emitido {fmt(d.emitido_em)}</p>
                      <p className="text-xs text-faint">Conferência {d.conferencia}{d.pdf_versao > 0 ? ` · PDF v${d.pdf_versao}` : ''}{d.assinaturas_exigidas > 0 ? ` · ${d.assinaturas_registradas}/${d.assinaturas_exigidas} assinatura(s)` : ''}</p>
                    </div>
                  </div>
                  <Selo tom={TOM_ESTADO[d.estado] || 'neutro'}>{ROTULO_ESTADO[d.estado] || d.estado}</Selo>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Botao variacao="secundario" aoTocar={() => gerar(d.token)} carregando={ocupado === d.token}
                    desabilitado={['assinado', 'parcialmente_assinado', 'revogado', 'substituido'].includes(d.estado)}>
                    {d.pdf_versao > 0 ? 'Gerar novo PDF' : 'Gerar PDF'}
                  </Botao>
                  {d.pdf_versao > 0 && (
                    <Botao variacao="contorno" aoTocar={() => baixar(d)} carregando={ocupado === d.token}>Ver/baixar</Botao>
                  )}
                  {REVISAVEIS.includes(d.estado) && (
                    <Botao aoTocar={() => setRevisando(d)} data-testid="abrir-revisao">
                      {d.estado === 'correcao_solicitada' ? 'Revisar de novo' : 'Revisar'}
                    </Botao>
                  )}
                  {ASSINAVEIS.includes(d.estado) && (
                    <Botao aoTocar={() => setAssinando(d)} data-testid="abrir-assinatura">Assinar</Botao>
                  )}
                  {['assinado', 'parcialmente_assinado'].includes(d.estado) && (
                    <Botao variacao="contorno" aoTocar={() => gerarFinal(d.token)} carregando={ocupado === d.token} data-testid="gerar-h2">
                      Gerar representação final (H2)
                    </Botao>
                  )}
                </div>
                {d.estado === 'correcao_solicitada' && d.revisao && (
                  <div className="mt-2 text-xs bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-900">
                    <p><strong>O que corrigir:</strong> {d.revisao.motivo}</p>
                    {d.revisao.orientacao && <p className="mt-0.5">{d.revisao.orientacao}</p>}
                  </div>
                )}
                {['assinado', 'parcialmente_assinado'].includes(d.estado) && (
                  <p className="text-xs text-faint mt-2">
                    {d.estado === 'assinado'
                      ? 'Documento com todas as assinaturas exigidas — o PDF não pode mais ser regenerado por cima.'
                      : 'Já há assinatura registrada neste documento — regenerar o PDF fica bloqueado até revogar.'}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}

      <AssinarDocumentoModal aberta={!!assinando} aoFechar={() => setAssinando(null)} documento={assinando}
        clubId={clubeId} aoAssinado={carregar} />
      <RevisarDocumentoModal aberta={!!revisando} aoFechar={() => setRevisando(null)} documento={revisando}
        aoDecidido={carregar} />

      {loteAberto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
          <button type="button" aria-label="Fechar" onClick={() => setLoteAberto(false)} className="absolute inset-0 bg-black/50" />
          <div className="relative w-full sm:max-w-md bg-surface rounded-t-3xl sm:rounded-3xl shadow-2xl p-5">
            <h2 className="font-extrabold text-ink mb-2">Assinar {selecionados.size} documentos</h2>
            <p className="text-sm text-muted mb-3">
              Você está prestes a assinar eletronicamente {selecionados.size} documento(s). Cada um
              recebe sua própria assinatura, com o hash do PDF dele — uma falha em um item não afeta
              os outros.
            </p>
            <Campo id="consentimento-lote" rotulo="" linhas={2} placeholder={DECLARACAO_LOTE}
              value={consentimentoLote} onChange={(e) => setConsentimentoLote(e.target.value)} data-testid="consentimento-lote" />
            <button type="button" onClick={() => setConsentimentoLote(DECLARACAO_LOTE)} className="text-xs text-brand underline mb-3">
              Usar declaração padrão
            </button>
            <div className="flex gap-2">
              <Botao variacao="secundario" aoTocar={() => setLoteAberto(false)} desabilitado={loteOcupado}>Cancelar</Botao>
              <Botao aoTocar={confirmarLote} carregando={loteOcupado} desabilitado={consentimentoLote.trim().length < 20} data-testid="confirmar-lote">
                Assinar documentos
              </Botao>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
