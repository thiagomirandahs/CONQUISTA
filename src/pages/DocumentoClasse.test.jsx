// Documento imprimível: renderiza o conteúdo vindo do snapshot (via documento_conteudo), o QR
// apontando pra verificação, o disclaimer de "não substitui registro oficial", o espaço de
// assinaturas (sem fingir validade) e distingue acompanhamento de final. Acentuação/texto longo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const conteudoDocumento = vi.fn()
vi.mock('../services/documentos.js', () => ({ conteudoDocumento: (...a) => conteudoDocumento(...a) }))
const { default: DocumentoClasse } = await import('./DocumentoClasse.jsx')

const REQ_LONGO = 'Demonstrar, na prática e por escrito, o cuidado com a corda e executar corretamente os seguintes nós: direito, cirurgião, escota, volta do fiel, lais de guia — explicando a aplicação de cada um em situações de acampamento.'
const CONTEUDO = {
  documento: { tipo: 'final', conferencia: 'ABCD1234', emitido_em: '2026-09-22T10:00:00Z', estado: 'valido', integro: true, template: { chave: 'caderno-desbravaclube', versao: 1, nome: 'Caderno Digital DesbravaClube' } },
  pessoa: { nome: 'Ana Conceição de Assunção' },
  clube_emissor: { nome: 'Clube Filhos da Conquista' },
  classe: { nome: 'Amigo', idade_minima: 10, fonte_url: 'https://x.test' },
  curriculum_version: { identificador: 'classes-regulares-dsa', versao: '2026.2', manifesto_versao: '2026.2', vigente_desde: '2026-01-01' },
  periodo: { iniciada_em: '2026-03-01', concluida_em: '2026-09-20', investidura: { data: '2026-09-21', registrado_por_nome: 'Líder A', registrado_papel: 'diretoria' } },
  revisao: { revisado_em: '2026-09-20', revisado_por_nome: 'Líder A', revisado_papel: 'diretoria' },
  secoes: [
    { codigo: 'I', nome: 'Gerais', ordem: 10, requisitos: [
      { codigo: '4', descricao: 'Ler o livro do Curso de Leitura do ano.', situacao: 'aprovado', conteudo_dinamico: { nome: 'Curso de Leitura', valor: 'Livro do ano [TESTE]' }, aprovado_por: { nome: 'Líder A', papel: 'diretoria', em: '2026-09-10' } },
      { codigo: '5', descricao: 'Ler o livro da classe: "Vaso de Barro".', situacao: 'aprovado', aprovado_por: { nome: 'Líder A', papel: 'diretoria', em: '2026-09-11' } },
    ] },
    { codigo: 'VIII', nome: 'Arte de Acampar', ordem: 80, requisitos: [
      { codigo: '1', descricao: REQ_LONGO, situacao: 'aprovado', aprovado_por: { nome: 'Conselheiro João', papel: 'conselheiro', em: '2026-09-12' } },
      { codigo: '2', descricao: 'Completar 1 das especialidades à escolha.', situacao: 'aprovado', escolha: { n_minimo: 1, escolhidas: ['Natação principiante I'] }, aprovado_por: { nome: 'Líder A', papel: 'diretoria', em: '2026-09-13' } },
    ] },
  ],
  percentual: 100,
}
const renderT = () => render(
  <MemoryRouter initialEntries={['/documento/TESTTOKEN']}>
    <Routes><Route path="/documento/:token" element={<DocumentoClasse />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => { conteudoDocumento.mockReset(); window.print = vi.fn() })

describe('DocumentoClasse (imprimível)', () => {
  it('documento final: identificação, período, requisitos com situação/escolha/aprovador, QR e disclaimer', async () => {
    conteudoDocumento.mockResolvedValue(CONTEUDO)
    renderT()
    expect(await screen.findByRole('heading', { name: 'Documento de conclusão de classe' })).toBeInTheDocument()
    expect(screen.getByText('Ana Conceição de Assunção')).toBeInTheDocument() // acentuação
    expect(screen.getByText('Clube Filhos da Conquista')).toBeInTheDocument()
    expect(screen.getByText(REQ_LONGO)).toBeInTheDocument() // texto longo inteiro
    expect(screen.getByText(/Livro do ano \[TESTE\]/)).toBeInTheDocument() // conteúdo dinâmico congelado
    expect(screen.getByText(/Escolha: Natação principiante I/)).toBeInTheDocument()
    expect(screen.getByText(/Aprovado por Conselheiro João \(conselheiro\)/)).toBeInTheDocument()
    expect(screen.getByText('ABCD-1234')).toBeInTheDocument()
    // QR aponta pra verificação, não carrega dados curriculares
    const qr = document.querySelector('.qr svg')
    expect(qr).toBeTruthy()
    expect(qr.getAttribute('aria-label')).toBe('QR code de verificação')
    expect(screen.getByText(/Verifique em:/)).toHaveTextContent('/verificar/TESTTOKEN')
    // disclaimer + assinaturas
    expect(screen.getByText(/Não substitui/)).toBeInTheDocument()
    expect(screen.getByText('Conselheiro(a) da unidade')).toBeInTheDocument()
    expect(screen.getByText(/ainda não possui assinatura digital/)).toBeInTheDocument()
  })

  it('acompanhamento: título e aviso de que não é comprovante de investidura', async () => {
    conteudoDocumento.mockResolvedValue({ ...CONTEUDO, documento: { ...CONTEUDO.documento, tipo: 'acompanhamento', estado: 'acompanhamento' }, periodo: { ...CONTEUDO.periodo, investidura: null } })
    renderT()
    expect(await screen.findByRole('heading', { name: 'Caderno de acompanhamento de classe' })).toBeInTheDocument()
    expect(screen.getByText(/não é comprovante de investidura/)).toBeInTheDocument()
  })

  it('revogado/substituído mostram faixa de estado no topo', async () => {
    conteudoDocumento.mockResolvedValue({ ...CONTEUDO, documento: { ...CONTEUDO.documento, estado: 'revogado' } })
    const { unmount } = renderT()
    expect(await screen.findByText('DOCUMENTO REVOGADO')).toBeInTheDocument()
    unmount()
    conteudoDocumento.mockResolvedValue({ ...CONTEUDO, documento: { ...CONTEUDO.documento, estado: 'substituido' } })
    renderT()
    expect(await screen.findByText(/SUBSTITUÍDO POR UMA VERSÃO MAIS RECENTE/)).toBeInTheDocument()
  })

  it('sem acesso: mensagem de indisponível', async () => {
    conteudoDocumento.mockResolvedValue(null)
    renderT()
    expect(await screen.findByText('Documento indisponível')).toBeInTheDocument()
  })
})
