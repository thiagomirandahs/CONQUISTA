// Apoio dos testes da Rede DBV: mocks das dependências e um render com o contexto da rede.
import { vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RedeContexto } from './contexto.js'

export const STATUS = { pode_ver: true, papel: 'desbravador', pode_publicar: true, suspenso_ate: null }

export const post = (extra = {}) => ({
  id: 'p1', tipo: 'livre', legenda: 'Acampamento incrível!', foto: null, foto_alt: null, foto_expirada: false,
  autor: { id: 'u-ana', nome: 'Ana Souza', clube: 'Clube Águias', foto: null }, clube_id: 'clube-b',
  crianca: true, meu: false, criado_em: new Date().toISOString(), curtidas: 2, comentarios: 0,
  eu_curti: false, eu_salvei: false, repost: null, ...extra,
})

export function renderRede(elemento, { status = STATUS, rota = '/', caminho = '*' } = {}) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <RedeContexto.Provider value={{ status, recarregar: vi.fn() }}>
        <Routes><Route path={caminho} element={elemento} /></Routes>
      </RedeContexto.Provider>
    </MemoryRouter>,
  )
}
