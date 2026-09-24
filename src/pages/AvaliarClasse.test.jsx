// Avaliar classes: o avaliador vê de QUAL ANO é o conteúdo anual do requisito (migration 84). O
// servidor manda o valor FIXADO no envio — o livro que a criança leu —, não o do dia da avaliação:
// numa avaliação feita em janeiro de um requisito enviado em dezembro, a tela tem de dizer o ano
// certo. Fixtures sintéticas.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel: 'diretoria' }) }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
const carregarAvaliacoesPendentesDeClasse = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarAvaliacoesPendentesDeClasse: (...a) => carregarAvaliacoesPendentesDeClasse(...a),
  avaliarRequisito: vi.fn(),
}))

const { default: AvaliarClasse } = await import('./AvaliarClasse.jsx')

const item = (over) => ({
  member_requirement_id: 'mr1', usuario_id: 'u1', usuario_nome: 'Criança Teste', usuario_foto: null,
  classe_nome: 'Classe Teste', secao_nome: 'Seção I', requisito_id: 'r1', requisito_codigo: '4',
  requisito_descricao: 'Ler o livro do ano [TESTE].', tipo_evidencia: 'nenhuma', evidencia_texto: null, evidencia_path: null,
  enviado_em: '2026-12-20T12:00:00Z', escolha: null, bloqueios: [], ...over,
})

describe('AvaliarClasse — conteúdo anual', () => {
  it('mostra o ANO do conteúdo que a criança usou (o fixado no envio)', async () => {
    carregarAvaliacoesPendentesDeClasse.mockResolvedValue([item({ conteudo_dinamico: { chave: 'slot', valor: 'Livro de teste [TESTE]', ano: 2026, ano_referencia: 2026 } })])
    render(<AvaliarClasse />)
    expect(await screen.findByText(/Conteúdo de 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Livro de teste \[TESTE\]/)).toBeInTheDocument()
  })

  it('sem o ano (servidor antigo) cai no texto de antes; sem valor diz que ainda não foi cadastrado', async () => {
    carregarAvaliacoesPendentesDeClasse.mockResolvedValue([item({ conteudo_dinamico: { chave: 'slot', valor: null } })])
    render(<AvaliarClasse />)
    expect(await screen.findByText(/Conteúdo do período/)).toBeInTheDocument()
    expect(screen.getByText('ainda não cadastrado')).toBeInTheDocument()
  })
})
