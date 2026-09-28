import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'

// Comprovacao DE VERDADE (só a assinatura da URL é simulada): prova que a foto de cada tentativa
// é pedida ao Storage e abre ampliada — a 360 liberou a liderança a abrir tentativas anteriores.
const assinar = vi.fn(async (p) => `https://assinada.test/${p}`)
vi.mock('../lib/dados.js', () => ({ urlComprovacao: (...a) => assinar(...a) }))
const { default: HistoricoDeTentativas, rotuloDaDecisao } = await import('./HistoricoDeTentativas.jsx')

const TENTATIVAS = [
  { submission_id: 's1', tentativa_numero: 1, enviado_em: '2026-09-20T12:00:00Z', evidencia_path: 'u/classes/t1.jpg',
    decisao: 'correcao_solicitada', comentario: 'Faltou o nó', avaliado_por_nome: 'Ana', avaliado_papel: 'instrutor' },
  { submission_id: 's2', tentativa_numero: 2, enviado_em: '2026-09-22T12:00:00Z', evidencia_path: 'u/classes/t2.jpg', decisao: null },
  { submission_id: 's3', tentativa_numero: 3, evidencia_texto: 'Só texto', decisao: 'aprovado' },
]

describe('Histórico por tentativa com a foto de cada uma', () => {
  it('mostra a foto de TODAS as tentativas (inclusive as anteriores), ampliável', async () => {
    render(<HistoricoDeTentativas tentativas={TENTATIVAS} mostrarAvaliador />)
    const b1 = await screen.findByRole('button', { name: 'Ampliar foto da tentativa 1' })
    expect(await screen.findByRole('button', { name: 'Ampliar foto da tentativa 2' })).toBeInTheDocument()
    expect(assinar).toHaveBeenCalledWith('u/classes/t1.jpg')
    expect(assinar).toHaveBeenCalledWith('u/classes/t2.jpg')
    expect(screen.queryByRole('button', { name: /tentativa 3/ })).toBeNull()   // só texto: sem foto
    fireEvent.click(b1)
    expect(screen.getAllByAltText('foto da tentativa 1').length).toBeGreaterThan(1)  // abriu em tela cheia
  })

  it('status com símbolo E palavra (nunca só cor), orientação e avaliador', () => {
    render(<HistoricoDeTentativas tentativas={TENTATIVAS} mostrarAvaliador />)
    expect(screen.getByText('↺ Correção solicitada')).toBeInTheDocument()
    expect(screen.getByText('⏳ Aguardando avaliação')).toBeInTheDocument()
    expect(screen.getByText('✅ Aprovado')).toBeInTheDocument()
    expect(screen.getByText('"Faltou o nó"').parentElement).toHaveTextContent('orientação: "Faltou o nó"')
    expect(screen.getByText(/por Ana \(instrutor\)/)).toBeInTheDocument()
  })

  it('rótulos das decisões', () => {
    expect(rotuloDaDecisao('aprovado')).toMatch(/Aprovado/)
    expect(rotuloDaDecisao(undefined)).toMatch(/Aguardando/)
  })

  it('as três telas usam o mesmo histórico com foto (AvaliarClasse, GestaoAvaliacoes, MinhaClasse)', () => {
    for (const tela of ['AvaliarClasse', 'GestaoAvaliacoes', 'MinhaClasse']) {
      const src = readFileSync(join(process.cwd(), 'src', 'pages', `${tela}.jsx`), 'utf8')
      expect(src, tela).toMatch(/<HistoricoDeTentativas\b/)
    }
  })
})
