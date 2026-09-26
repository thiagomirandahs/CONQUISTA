// /ajuda no app e no site + tour de primeiro acesso.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
  it('mostra primeiro a seção do papel da pessoa', () => {
    clube = { papel: 'pais', temRecurso: () => true }
    montar(<Ajuda />)
    const secoes = screen.getAllByTestId(/^secao-/)
    expect(secoes[0].dataset.testid).toBe('secao-responsavel')
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
    expect(screen.getByTestId('tour')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Pular' }))
    expect(screen.queryByTestId('tour')).toBeNull()
    unmount()
    montar(<TourPrimeiroAcesso uid="u-9" />)
    expect(screen.queryByTestId('tour')).toBeNull()
  })
  it('passa pelos 4 passos e termina em "Começar"', async () => {
    montar(<TourPrimeiroAcesso uid="u-8" />)
    for (let i = 0; i < 3; i++) await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Começar' }))
    expect(screen.queryByTestId('tour')).toBeNull()
  })
  it('é reaberto em /ajuda por "Ver o tour de novo"', async () => {
    localStorage.setItem('dc:tour-visto:u-1', '1')
    montar(<Ajuda />)
    expect(screen.queryByTestId('tour')).toBeNull()
    await userEvent.click(screen.getByTestId('rever-tour'))
    expect(screen.getByTestId('tour')).toBeTruthy()
  })
})
