// Ajuda mostra a versão das telas e o resultado da última checagem de atualização (diagnóstico do "o app não atualizou").
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel: 'desbravador', temRecurso: () => true }) }))
vi.mock('../context/Escopo.jsx', () => ({ useEscopo: () => ({ temEscopo: false }) }))
vi.mock('../components/tutorial/GuiaDeUso.jsx', () => ({ default: () => null }))
vi.mock('../components/TourDaArea.jsx', () => ({ default: () => null }))
const { default: Ajuda } = await import('./Ajuda.jsx')
const { registrarDiagnostico } = await import('../lib/atualizacaoOta.js')

beforeEach(() => localStorage.clear())

describe('Ajuda: versão e diagnóstico da atualização', () => {
  it('sem checagem registrada mostra só a versão', () => {
    render(<MemoryRouter><Ajuda /></MemoryRouter>)
    const t = screen.getByTestId('versao-do-app').textContent
    expect(t).toMatch(/Versão das telas:/)
    expect(t).not.toMatch(/Última checagem/)
  })
  it('com checagem registrada mostra o resultado em português e o APK', () => {
    registrarDiagnostico({ acao: 'ignorar', motivo: 'nativo-antigo' }, { nativo: '1.3.0-ci20' })
    render(<MemoryRouter><Ajuda /></MemoryRouter>)
    const t = screen.getByTestId('versao-do-app').textContent
    expect(t).toMatch(/APK 1\.3\.0-ci20/)
    expect(t).toMatch(/precisa instalar o APK novo/)
  })
})
