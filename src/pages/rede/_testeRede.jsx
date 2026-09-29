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

// `eu` = o meu perfil GATEADO (rede_perfil), como o LayoutRede compartilha (500); por padrão só o nome.
export function renderRede(elemento, { status = STATUS, eu = { id: 'eu', nome: 'Eu Mesmo' }, rota = '/', caminho = '*' } = {}) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <RedeContexto.Provider value={{ status, eu, recarregar: vi.fn() }}>
        <Routes><Route path={caminho} element={elemento} /></Routes>
      </RedeContexto.Provider>
    </MemoryRouter>,
  )
}
