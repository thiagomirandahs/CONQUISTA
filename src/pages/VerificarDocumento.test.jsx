// Página PÚBLICA de verificação: só o resumo mínimo, os estados (válido/acompanhamento/substituído/
// revogado/não encontrado), o aviso de integridade e o disclaimer de "não substitui registro oficial".
// Nunca requisitos/avaliadores/evidências.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const verificarDocumento = vi.fn()
vi.mock('../services/documentos.js', () => ({ verificarDocumento: (...a) => verificarDocumento(...a) }))
const { default: VerificarDocumento } = await import('./VerificarDocumento.jsx')

const RESUMO = {
  encontrado: true, nome: 'Fulano de Tal', classe: 'Amigo', clube_emissor: 'Clube Teste',
  versao_curricular: 'classes-regulares-dsa 2026.2', tipo: 'final', data_conclusao: '2026-09-20',
  data_investidura: '2026-09-21', estado: 'valido', integro: true, conferencia: 'ABCD1234', emitido_em: '2026-09-22T10:00:00Z',
}
const renderT = (token = 'TOK') => render(
  <MemoryRouter initialEntries={[`/verificar/${token}`]}>
    <Routes><Route path="/verificar/:token" element={<VerificarDocumento />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => verificarDocumento.mockReset())

describe('VerificarDocumento (público)', () => {
  it('documento válido: nome, classe, clube, currículo, datas e conferência formatada; disclaimer presente', async () => {
    verificarDocumento.mockResolvedValue(RESUMO)
    renderT()
    expect(await screen.findByText('Documento válido')).toBeInTheDocument()
    expect(screen.getByText('Fulano de Tal')).toBeInTheDocument()
    expect(screen.getByText('Amigo')).toBeInTheDocument()
    expect(screen.getByText('Clube Teste')).toBeInTheDocument()
    expect(screen.getByText('classes-regulares-dsa 2026.2')).toBeInTheDocument()
    expect(screen.getByText('ABCD-1234')).toBeInTheDocument()
    expect(screen.getByText('21/09/2026')).toBeInTheDocument()
    expect(screen.getByText(/Não substitui o cartão ou registro oficial/)).toBeInTheDocument()
  })

  it('acompanhamento: deixa claro que NÃO é comprovante de investidura', async () => {
    verificarDocumento.mockResolvedValue({ ...RESUMO, tipo: 'acompanhamento', estado: 'acompanhamento', data_investidura: null })
    renderT()
    expect(await screen.findByText('Caderno de acompanhamento')).toBeInTheDocument()
    expect(screen.getByText(/não é comprovante de investidura/)).toBeInTheDocument()
  })

  it('substituído e revogado aparecem com o estado certo', async () => {
    verificarDocumento.mockResolvedValue({ ...RESUMO, estado: 'substituido' })
    const { unmount } = renderT()
    expect(await screen.findByText(/Substituído por uma versão mais recente/)).toBeInTheDocument()
    unmount()
    verificarDocumento.mockResolvedValue({ ...RESUMO, estado: 'revogado' })
    renderT()
    expect(await screen.findByText('Documento revogado')).toBeInTheDocument()
  })

  it('integridade não confirmada mostra alerta', async () => {
    verificarDocumento.mockResolvedValue({ ...RESUMO, integro: false })
    renderT()
    expect(await screen.findByText(/integridade deste documento não pôde ser confirmada/)).toBeInTheDocument()
  })

  it('token inexistente: mensagem de não encontrado, sem vazar nada', async () => {
    verificarDocumento.mockResolvedValue({ encontrado: false })
    renderT('INEXISTENTE')
    expect(await screen.findByText('Documento não encontrado')).toBeInTheDocument()
    expect(screen.queryByText(/Nome/)).not.toBeInTheDocument()
  })

  it('nunca renderiza requisitos/avaliadores (não estão no resumo público)', async () => {
    verificarDocumento.mockResolvedValue(RESUMO)
    renderT()
    await screen.findByText('Documento válido')
    expect(screen.queryByText(/Requisito|Aprovado por|Seção/i)).not.toBeInTheDocument()
  })
})
