import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import RelatorioLeitura from './RelatorioLeitura.jsx'

vi.mock('../Comprovacao.jsx', () => ({ default: ({ valor, alt }) => <span data-testid="foto">{alt}:{valor}</span> }))

const schema = {
  versao: 1,
  campos: [
    { chave: 'resumo', tipo: 'texto_longo', rotulo: 'Resumo' },
    { chave: 'km', tipo: 'numero', rotulo: 'Distância', unidade: 'km' },
    { chave: 'dia', tipo: 'data', rotulo: 'Quando' },
    { chave: 'sel', tipo: 'selecao', rotulo: 'Como foi', opcoes: [{ chave: 'bom', rotulo: 'Foi bom' }, { chave: 'ruim', rotulo: 'Foi ruim' }] },
    { chave: 'check', tipo: 'checklist', rotulo: 'Técnicas', itens: [{ chave: 'a', rotulo: 'Nó direito' }, { chave: 'b', rotulo: 'Nó de escota' }] },
    { chave: 'lista', tipo: 'lista', rotulo: 'Materiais' },
    { chave: 'fiz', tipo: 'confirmacao', rotulo: 'Fiz' },
    { chave: 'vazio', tipo: 'texto_curto', rotulo: 'Campo em branco' },
    { chave: 'diario', tipo: 'entradas', rotulo: 'Diário', min: 2, max: 2, rotulo_item: 'Dia', campos: [{ chave: 'o', tipo: 'texto_curto', rotulo: 'O que fez' }] },
    { chave: 'como', tipo: 'escolha', rotulo: 'Como cumpriu', opcoes: [{ chave: 'a', rotulo: 'Sozinho', campos: [{ chave: 'x', tipo: 'texto_curto', rotulo: 'Detalhe' }] }, { chave: 'b', rotulo: 'Grupo', campos: [] }] },
    { chave: 'fotos', tipo: 'anexos', rotulo: 'Fotos', max: 2 },
  ],
}
const conteudo = {
  resumo: 'Acampamos no sábado', km: 5, dia: '2026-09-30', sel: 'bom', check: { a: true, b: false },
  lista: ['corda', '', 'barraca'], fiz: true,
  diario: [{ o: 'Caminhada' }, { o: 'Fogueira' }], como: { opcao: 'a', dados: { x: 'com o pai' } },
}

describe('RelatorioLeitura', () => {
  it('mostra rótulos legíveis e valores de cada tipo', () => {
    render(<RelatorioLeitura schema={schema} conteudo={conteudo} anexos={[{ campo: 'fotos', path: 'u/requisitos/1.jpg' }]} />)
    expect(screen.getByText('Acampamos no sábado')).toBeInTheDocument()
    expect(screen.getByText('5 km')).toBeInTheDocument()
    expect(screen.getByText('30/09/2026')).toBeInTheDocument()
    expect(screen.getByText('Foi bom')).toBeInTheDocument()
    expect(screen.getByText(/Sim, fez/)).toBeInTheDocument()
    expect(screen.getByText('Dia 1')).toBeInTheDocument()
    expect(screen.getByText('Fogueira')).toBeInTheDocument()
    expect(screen.getByText('Sozinho')).toBeInTheDocument()
    expect(screen.getByText('com o pai')).toBeInTheDocument()
    expect(screen.getByTestId('foto')).toHaveTextContent('Foto 1:u/requisitos/1.jpg')
  })

  it('checklist mostra só o que foi marcado; lista ignora itens vazios; campo vazio some', () => {
    render(<RelatorioLeitura schema={schema} conteudo={conteudo} />)
    expect(screen.getByText('Nó direito')).toBeInTheDocument()
    expect(screen.queryByText('Nó de escota')).toBeNull()
    const itens = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(itens).toContain('corda')
    expect(itens).toContain('barraca')
    expect(itens.filter((t) => t === '')).toHaveLength(0)
    expect(screen.queryByText('Campo em branco')).toBeNull()
  })

  it('sem modelo cai no texto e na foto de sempre', () => {
    render(<RelatorioLeitura schema={null} evidenciaTexto="Minha resposta antiga" evidenciaPath="u/requisitos/x.jpg" />)
    expect(screen.getByTestId('relatorio-leitura-legado')).toBeInTheDocument()
    expect(screen.getByText(/Minha resposta antiga/)).toBeInTheDocument()
    expect(within(screen.getByTestId('relatorio-leitura-legado')).getByTestId('foto')).toBeInTheDocument()
  })
})
