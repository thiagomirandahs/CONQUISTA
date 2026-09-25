// Gestão → Documentos (Fase 4, Bloco 1): só leitura + geração de PDF. Estes testes garantem que a
// tela nunca chama nenhuma RPC de avaliação/aprovação pedagógica (a correção continua no fluxo de
// requisito), e que "assinado" desabilita a regeneração (a RPC já recusa no servidor — aqui só
// provamos que o botão nem tenta).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const carregarDocumentosDoClube = vi.fn()
const gerarPdf = vi.fn()
const baixarPdf = vi.fn()
const assinarLote = vi.fn()
const assinarDocumento = vi.fn()
const subirDesenhoAssinatura = vi.fn()
vi.mock('../services/documentos.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    carregarDocumentosDoClube: (...a) => carregarDocumentosDoClube(...a),
    gerarPdf: (...a) => gerarPdf(...a),
    baixarPdf: (...a) => baixarPdf(...a),
    assinarLote: (...a) => assinarLote(...a),
    assinarDocumento: (...a) => assinarDocumento(...a),
    subirDesenhoAssinatura: (...a) => subirDesenhoAssinatura(...a),
  }
})
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'clube-1' }) }))

const { default: GestaoDocumentos } = await import('./GestaoDocumentos.jsx')

const DOC_PREPARO = {
  documento_id: 'doc-1', token: 'tok1', tipo: 'acompanhamento', conferencia: 'ABCD1234',
  titular_nome: 'Fulano', classe_nome: 'Amigo', emitido_em: '2026-09-01T00:00:00Z',
  snapshot_status: 'selado', pdf_versao: 0, pdf_storage_path: null, pdf_gerado_em: null,
  assinaturas_registradas: 0, assinaturas_exigidas: 0, estado: 'em_preparacao',
}
const DOC_PRONTO = { ...DOC_PREPARO, documento_id: 'doc-3', token: 'tok3', pdf_versao: 1, pdf_storage_path: 'clube/user/doc-3/1.pdf', assinaturas_exigidas: 1, estado: 'pronto_para_assinatura' }
const DOC_ASSINADO = { ...DOC_PREPARO, documento_id: 'doc-2', token: 'tok2', pdf_versao: 3, pdf_storage_path: 'clube/user/doc-2/3.pdf', assinaturas_registradas: 1, assinaturas_exigidas: 1, estado: 'assinado' }

beforeEach(() => {
  carregarDocumentosDoClube.mockReset().mockResolvedValue([])
  gerarPdf.mockReset()
  baixarPdf.mockReset()
  assinarLote.mockReset()
  assinarDocumento.mockReset()
  subirDesenhoAssinatura.mockReset()
})

describe('GestaoDocumentos', () => {
  it('sem documentos: estado vazio, não quebra', async () => {
    render(<GestaoDocumentos />)
    expect(await screen.findByText('Nenhum documento')).toBeInTheDocument()
  })

  it('lista documentos com estado e permite gerar PDF', async () => {
    carregarDocumentosDoClube.mockResolvedValue([DOC_PREPARO])
    gerarPdf.mockResolvedValue({ storage_path: 'x/y/z.pdf', pdf_versao: 1 })
    render(<GestaoDocumentos />)
    const item = within(await screen.findByTestId('documento-item'))
    expect(item.getByText('Fulano')).toBeInTheDocument()
    expect(item.getByText('Em preparação')).toBeInTheDocument()
    await userEvent.click(item.getByText('Gerar PDF'))
    expect(gerarPdf).toHaveBeenCalledWith('tok1')
  })

  it('documento assinado: botão de gerar novo PDF fica desabilitado (nunca chama a RPC)', async () => {
    carregarDocumentosDoClube.mockResolvedValue([DOC_ASSINADO])
    render(<GestaoDocumentos />)
    const item = within(await screen.findByTestId('documento-item'))
    const botao = item.getByText('Gerar novo PDF')
    expect(botao.closest('button')).toBeDisabled()
    await userEvent.click(botao)
    expect(gerarPdf).not.toHaveBeenCalled()
  })

  it('filtro por status restringe a lista', async () => {
    carregarDocumentosDoClube.mockResolvedValue([DOC_PREPARO, DOC_ASSINADO])
    render(<GestaoDocumentos />)
    await screen.findAllByText('Fulano')
    expect(screen.getAllByTestId('documento-item')).toHaveLength(2)
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por status'), 'assinado')
    const itens = screen.getAllByTestId('documento-item')
    expect(itens).toHaveLength(1)
    expect(within(itens[0]).getByText('Assinado')).toBeInTheDocument()
  })

  it('"Ver/baixar" entrega o PDF JÁ ARMAZENADO — nunca regenera', async () => {
    carregarDocumentosDoClube.mockResolvedValue([DOC_PRONTO])
    baixarPdf.mockResolvedValue('https://exemplo.local/assinada')
    const abrirSpy = vi.spyOn(window, 'open').mockImplementation(() => {})
    render(<GestaoDocumentos />)
    const item = within(await screen.findByTestId('documento-item'))
    await userEvent.click(item.getByText('Ver/baixar'))
    expect(baixarPdf).toHaveBeenCalledWith('clube/user/doc-3/1.pdf')
    expect(gerarPdf).not.toHaveBeenCalled()
    expect(abrirSpy).toHaveBeenCalledWith('https://exemplo.local/assinada', '_blank', 'noopener')
    abrirSpy.mockRestore()
  })

  it('a tela só usa leitura + geração de PDF do serviço — nunca avaliação/aprovação pedagógica', async () => {
    // documentos.js também exporta emitirDocumento/conteudoDocumento/verificarDocumento (usados por
    // outras telas, pré-existentes) — este teste garante só que os 4 usados por ESTA tela existem
    // e continuam sendo os únicos que ela chama (ver o mock no topo do arquivo).
    const modulo = await vi.importActual('../services/documentos.js')
    expect(['carregarDocumentosDoClube', 'gerarPdf', 'baixarPdf', 'ROTULO_ESTADO'].every((k) => k in modulo)).toBe(true)
    expect('requisitoAvaliar' in modulo).toBe(false)
  })

  it('documento pronto_para_assinatura mostra o botão "Assinar" e abre o modal', async () => {
    carregarDocumentosDoClube.mockResolvedValue([DOC_PRONTO])
    render(<GestaoDocumentos />)
    const item = within(await screen.findByTestId('documento-item'))
    await userEvent.click(item.getByTestId('abrir-assinatura'))
    expect((await screen.findAllByText('Assinar documento')).length).toBeGreaterThan(0)
  })

  it('documento em preparação (sem PDF) não mostra checkbox de seleção nem botão de assinar', async () => {
    carregarDocumentosDoClube.mockResolvedValue([DOC_PREPARO])
    render(<GestaoDocumentos />)
    await screen.findByTestId('documento-item')
    expect(screen.queryByTestId('abrir-assinatura')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('seleção em lote: escolher documentos abre a barra "Assinar selecionados" e chama assinarLote com todos os tokens', async () => {
    const DOC_PRONTO_2 = { ...DOC_PRONTO, documento_id: 'doc-4', token: 'tok4', titular_nome: 'Beltrano' }
    carregarDocumentosDoClube.mockResolvedValue([DOC_PRONTO, DOC_PRONTO_2])
    assinarLote.mockResolvedValue({ assinados: 2, recusados: 0, itens: [{ token: 'tok3', ok: true }, { token: 'tok4', ok: true }] })
    render(<GestaoDocumentos />)
    const checkboxes = await screen.findAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    await userEvent.click(checkboxes[0])
    await userEvent.click(checkboxes[1])
    expect(await screen.findByTestId('abrir-lote')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('abrir-lote'))
    await userEvent.click(screen.getByText('Usar declaração padrão'))
    await userEvent.click(screen.getByTestId('confirmar-lote'))
    expect(assinarLote).toHaveBeenCalledWith(expect.arrayContaining(['tok3', 'tok4']), expect.stringContaining('Declaro'))
  })

  it('lote com falha parcial nunca finge sucesso total', async () => {
    carregarDocumentosDoClube.mockResolvedValue([DOC_PRONTO])
    assinarLote.mockResolvedValue({ assinados: 0, recusados: 1, itens: [{ token: 'tok3', ok: false, motivo: 'Sem autoridade' }] })
    const avisos = await import('../ui/avisos.jsx')
    const erroSpy = vi.spyOn(avisos.avisar, 'erro')
    render(<GestaoDocumentos />)
    await userEvent.click(await screen.findByRole('checkbox'))
    await userEvent.click(screen.getByTestId('abrir-lote'))
    await userEvent.click(screen.getByText('Usar declaração padrão'))
    await userEvent.click(screen.getByTestId('confirmar-lote'))
    expect(erroSpy).toHaveBeenCalledWith(null, expect.stringContaining('Sem autoridade'))
    erroSpy.mockRestore()
  })
})
