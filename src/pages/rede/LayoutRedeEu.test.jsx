// Coerência do "eu" na Rede DBV (migration 500): a barra de baixo mostra a MESMA representação que os
// outros veem — o perfil gateado de rede_perfil() (personagem, ou foto só com a autorização de imagem),
// nunca a foto do profile do Auth (que fazia a pessoa ver a própria foto na barra e iniciais no perfil).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const f = { meuStatus: vi.fn(), carregarPerfil: vi.fn() }
vi.mock('../../services/rede.js', async () => {
  const real = await vi.importActual('../../services/rede.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../../lib/supabase.js', () => ({ definirRedeComoNoTransporte: vi.fn(), supabase: {} }))
vi.mock('../../lib/imagens.js', () => ({ useImagem: (v) => v }))
vi.mock('../../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) } }))
// o Auth TEM uma foto gravada (a mesma URL do app do clube) — a rede não pode usá-la sem o gate
vi.mock('../../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu', nome: 'Eu Mesmo', foto: 'http://x/storage/v1/object/public/imagens/perfis/eu-1.jpg' } }) }))
vi.mock('../../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'clube-a', papel: 'desbravador' }) }))
vi.mock('../../components/Notificacoes.jsx', () => ({ default: () => null }))

const { STATUS } = await import('./_testeRede.jsx')
const { default: LayoutRede } = await import('./LayoutRede.jsx')
const { useRede } = await import('./contexto.js')

function Filho() {
  const { eu } = useRede()
  return <p data-testid="eu-do-contexto">{eu?.avatar_tipo || (eu?.foto ? 'foto' : 'iniciais')}</p>
}
const montar = () => render(
  <MemoryRouter initialEntries={['/rede']}>
    <Routes><Route element={<LayoutRede />}><Route path="/rede" element={<Filho />} /></Route></Routes>
  </MemoryRouter>,
)
const barra = () => screen.getByRole('navigation', { name: 'Navegação da Rede DBV' })

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.meuStatus.mockResolvedValue({ ...STATUS, unidade_id: 'clube-a' })
})

describe('LayoutRede — o "eu" gateado', () => {
  it('sem autorização de imagem: barra com INICIAIS, mesmo com foto no Auth', async () => {
    f.carregarPerfil.mockResolvedValue({ id: 'eu', eu: true, nome: 'Eu Mesmo', foto: null, imagem_autorizada: false })
    montar()
    await waitFor(() => expect(f.carregarPerfil).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('eu-do-contexto')).toHaveTextContent('iniciais'))
    expect(within(barra()).getByTestId('avatar-iniciais')).toHaveTextContent('EM')
    expect(within(barra()).queryByRole('img')).toBeNull()
    expect(f.carregarPerfil).toHaveBeenCalledWith(null)
  })

  it('personagem: barra com o DESENHO', async () => {
    f.carregarPerfil.mockResolvedValue({ id: 'eu', eu: true, nome: 'Eu Mesmo', foto: null, avatar_tipo: 'personagem', avatar: { cabelo: 'curto', roupa: 'lisa' } })
    montar()
    await waitFor(() => expect(screen.getByTestId('eu-do-contexto')).toHaveTextContent('personagem'))
    expect(within(barra()).getByTestId('avatar-personagem').querySelector('svg')).not.toBeNull()
  })

  it('foto autorizada pelo servidor: barra com a <img>', async () => {
    f.carregarPerfil.mockResolvedValue({ id: 'eu', eu: true, nome: 'Eu Mesmo', foto: 'http://x/storage/v1/object/public/imagens/perfis/eu-1.jpg', imagem_autorizada: true })
    montar()
    await waitFor(() => expect(screen.getByTestId('eu-do-contexto')).toHaveTextContent('foto'))
    expect(barra().querySelector('img[src*="perfis/eu-1.jpg"]')).not.toBeNull()
  })

  it('enquanto rede_perfil não chegou (ou falhou): iniciais do nome do Auth, nunca a foto dele', async () => {
    f.carregarPerfil.mockRejectedValue(new Error('rede fora do ar'))
    montar()
    await screen.findByTestId('eu-do-contexto')
    await waitFor(() => expect(f.carregarPerfil).toHaveBeenCalled())
    expect(within(barra()).getByTestId('avatar-iniciais')).toHaveTextContent('EM')
    expect(within(barra()).queryByRole('img')).toBeNull()
  })

  it('sem acesso à rede (pode_ver = false): não pede o perfil', async () => {
    f.meuStatus.mockResolvedValue({ pode_ver: false, motivo: 'recurso_desligado' })
    montar()
    expect(await screen.findByText('A Rede DBV não está liberada')).toBeInTheDocument()
    expect(f.carregarPerfil).not.toHaveBeenCalled()
  })
})
