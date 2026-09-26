// Migration 230: cargos DA UNIDADE (capitão, secretário...) — só a diretoria define, pela tela de Usuários.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CARGOS_DE_UNIDADE } from '../lib/cargos.js'

let papel = 'diretoria'
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu' } }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel }) }))
vi.mock('../components/Avatar.jsx', () => ({ default: () => null }))
vi.mock('../components/ConvitesDeEquipe.jsx', () => ({ ConvidarEquipe: () => null }))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { confirmar: vi.fn(), erro: vi.fn() } }))
const definirCargoDeUnidade = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarUsuarios: async () => [
    { id: 'ana', nome: 'Ana', papel: 'desbravador', status: 'ativo', unidade_id: 'u1', teste: false },
    { id: 'caio', nome: 'Caio', papel: 'conselheiro', status: 'ativo', unidade_id: 'u1', teste: false },
    { id: 'semuni', nome: 'Sem Uni', papel: 'desbravador', status: 'ativo', unidade_id: null, teste: false },
  ],
  listarUnidades: async () => [{ id: 'u1', nome: 'Águias' }],
  carregarCargosDeUnidade: async () => ({ caio: { unidade_id: 'u1', cargo: 'conselheiro' } }),
  definirCargoDeUnidade: (...a) => definirCargoDeUnidade(...a),
  resetarSenha: vi.fn(), mudarCargo: vi.fn(), mudarUnidade: vi.fn(), lancarPontosIndividual: vi.fn(),
  excluirUsuario: vi.fn(), definirTesteUsuario: vi.fn(), definirAtivoUsuario: vi.fn(),
}))
const { default: Usuarios } = await import('./Usuarios.jsx')

beforeEach(() => { papel = 'diretoria'; definirCargoDeUnidade.mockReset().mockResolvedValue() })

describe('Usuários: cargo na unidade', () => {
  it('diretoria vê o seletor só para quem está numa unidade, com o cargo atual', async () => {
    render(<Usuarios />)
    const caio = await screen.findByRole('combobox', { name: 'Cargo de Caio na unidade' })
    expect(await screen.findByDisplayValue('🎗️ Conselheiro(a)')).toBe(caio)
    expect(screen.getByRole('combobox', { name: 'Cargo de Ana na unidade' })).toHaveValue('')
    expect(screen.queryByRole('combobox', { name: 'Cargo de Sem Uni na unidade' })).toBeNull()
  })

  it('desbravador não recebe cargos de liderança; define capitão pelo servidor', async () => {
    render(<Usuarios />)
    const ana = await screen.findByRole('combobox', { name: 'Cargo de Ana na unidade' })
    const opcoes = [...ana.querySelectorAll('option')].map((o) => o.value)
    expect(opcoes).toEqual(['', ...CARGOS_DE_UNIDADE.filter((c) => !c.lideranca).map((c) => c.valor)])
    await userEvent.selectOptions(ana, 'capitao')
    expect(definirCargoDeUnidade).toHaveBeenCalledWith('ana', 'capitao')
    expect(ana).toHaveValue('capitao')
  })

  it('instrutor não vê o seletor (só a diretoria define)', async () => {
    papel = 'instrutor'
    render(<Usuarios />)
    await screen.findByText('Ana')
    expect(screen.queryByRole('combobox', { name: /na unidade/ })).toBeNull()
  })
})
