// /ajuda no app e no site + tour de primeiro acesso.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

let clube = { papel: 'desbravador', temRecurso: () => true }
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u-1' } }) }))
vi.mock('../context/Escopo.jsx', () => ({ useEscopo: () => ({ temEscopo: false }) }))

const { default: Ajuda } = await import('./Ajuda.jsx')
const { default: SiteAjuda } = await import('./site/SiteAjuda.jsx')
const { default: TourPrimeiroAcesso } = await import('../components/TourPrimeiroAcesso.jsx')

const montar = (el, rota = '/ajuda') => render(<MemoryRouter initialEntries={[rota]}>{el}</MemoryRouter>)

beforeEach(() => {
  localStorage.clear()
  clube = { papel: 'desbravador', temRecurso: () => true }
})

describe('/ajuda no app', () => {
  it('"Primeiros passos" no topo e, logo depois, a seção do papel da pessoa', () => {
    clube = { papel: 'pais', temRecurso: () => true }
    montar(<Ajuda />)
    const secoes = screen.getAllByTestId(/^secao-/)
    expect(secoes[0].dataset.testid).toBe('secao-primeiros-passos')
    expect(secoes[1].dataset.testid).toBe('secao-responsavel')
  })

  it('sem papel, as seções seguem a ordem Primeiros passos · Desbravadores · Responsáveis · … · Coordenação', () => {
    clube = { papel: null, temRecurso: () => true }
    montar(<Ajuda />)
    const ordem = screen.getAllByTestId(/^secao-/).map((s) => s.dataset.testid.replace('secao-', ''))
    expect(ordem.slice(0, 7)).toEqual(['primeiros-passos', 'desbravador', 'responsavel', 'conselheiro', 'instrutor', 'diretoria', 'coordenacao'])
  })

  it('"Rever tour" lista os tours do papel: Gestão só para diretoria/instrutor', () => {
    montar(<Ajuda />)
    expect(screen.getByTestId('rever-tour').textContent).toBe('Primeiros passos')
    expect(screen.getByTestId('rever-tour-classes')).toBeTruthy()
    expect(screen.getByTestId('rever-tour-rede')).toBeTruthy()
    expect(screen.queryByTestId('rever-tour-gestao')).toBeNull()
  })

  it('instrutor vê o tour de Gestão e consegue revê-lo', async () => {
    clube = { papel: 'instrutor', temRecurso: () => true }
    montar(<Ajuda />)
    await userEvent.click(screen.getByTestId('rever-tour-gestao'))
    expect(screen.getByTestId('tour').dataset.tour).toBe('gestao')
  })

  it('o tópico da Rede DBV existe e fala da confirmação e dos 90 dias', () => {
    montar(<Ajuda />, '/ajuda#rede-dbv')
    const t = document.getElementById('topico-rede-dbv')
    expect(t.textContent).toMatch(/Tem certeza|tem certeza/)
    expect(t.textContent).toMatch(/90 dias/)
  })

  it('chegando pela âncora, o tópico abre com o atalho permitido', () => {
    montar(<Ajuda />, '/ajuda#minha-classe')
    const topico = document.getElementById('topico-minha-classe')
    expect(within(topico).getByTestId('abrir-tela').getAttribute('href')).toBe('/minha-classe')
  })

  it('desbravador não vê atalho para tela da diretoria', () => {
    montar(<Ajuda />, '/ajuda#usuarios-equipe')
    const topico = document.getElementById('topico-usuarios-equipe')
    expect(within(topico).getByText(/Convidar para a equipe/)).toBeTruthy()
    expect(within(topico).queryByTestId('abrir-tela')).toBeNull()
  })

  it('diretoria vê o atalho de Usuários', () => {
    clube = { papel: 'diretoria', temRecurso: () => true }
    montar(<Ajuda />, '/ajuda#usuarios-equipe')
    expect(within(document.getElementById('topico-usuarios-equipe')).getByTestId('abrir-tela').getAttribute('href')).toBe('/usuarios')
  })

  it('a busca filtra os tópicos', async () => {
    montar(<Ajuda />)
    await userEvent.type(screen.getByLabelText('Buscar no tutorial'), 'cadeado')
    const titulos = screen.getAllByTestId('topico').map((t) => t.textContent)
    expect(titulos.some((t) => /Minha Classe/.test(t))).toBe(true)
    expect(titulos.some((t) => /Plano do clube/.test(t))).toBe(false)
  })

  it('recurso desligado no clube esconde o tópico', () => {
    clube = { papel: 'desbravador', temRecurso: (r) => r !== 'especialidades' }
    montar(<Ajuda />)
    expect(document.getElementById('topico-minhas-especialidades')).toBeNull()
  })
})

describe('/ajuda no site', () => {
  it('não tem atalhos para telas logadas, tem "Criar meu clube" e não cita especialidades', () => {
    montar(<SiteAjuda />)
    expect(screen.queryByTestId('abrir-tela')).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Criar meu clube' }).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/especialidade/i)
    // mesmo com todos os tópicos abertos pela busca
  })
  it('com a busca abrindo tudo, continua sem atalho', async () => {
    montar(<SiteAjuda />)
    await userEvent.type(screen.getByLabelText('Buscar no tutorial'), 'a')
    expect(screen.queryByTestId('abrir-tela')).toBeNull()
    expect(document.body.textContent).not.toMatch(/especialidade/i)
  })
})

describe('tour de primeiro acesso', () => {
  it('aparece uma vez e "Pular" não deixa voltar', async () => {
    const { unmount } = montar(<TourPrimeiroAcesso uid="u-9" />)
    expect(await screen.findByTestId('tour')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Pular' }))
    await waitFor(() => expect(screen.queryByTestId('tour')).toBeNull())
    unmount()
    montar(<TourPrimeiroAcesso uid="u-9" />)
    expect(screen.queryByTestId('tour')).toBeNull()
  })
  it('passa pelos 4 passos e termina em "Concluir"', async () => {
    montar(<TourPrimeiroAcesso uid="u-8" />)
    await screen.findByTestId('tour')
    for (let i = 0; i < 3; i++) await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    await waitFor(() => expect(screen.queryByTestId('tour')).toBeNull())
  })
  it('é reaberto em /ajuda por "Rever tour: Primeiros passos"', async () => {
    localStorage.setItem('dc:tour-visto:u-1', '1')
    montar(<Ajuda />)
    expect(screen.queryByTestId('tour')).toBeNull()
    await userEvent.click(screen.getByTestId('rever-tour'))
    expect(screen.getByTestId('tour')).toBeTruthy()
  })
})
