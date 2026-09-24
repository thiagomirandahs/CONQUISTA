// Fase 9, item 9 — Especialidades FORA do piloto.
// O catálogo de especialidades ainda é só de teste ("[PILOTO/TESTE]") e não pode aparecer para os clubes convidados.
// Antes, todas as telas de especialidade dependiam do recurso 'classes': um clube que ligava as Classes oficiais levava
// junto as especialidades de teste para todas as crianças. Agora elas têm recurso próprio, 'especialidades'.
//
// Estes testes montam o cenário que importa — 'classes' LIGADO e 'especialidades' DESLIGADO — e provam, tela por tela,
// que nada de especialidade aparece nem abre. (É navegação: a trava de verdade são as RPCs no servidor.)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { permissoesDoPapel } from '../lib/clube.js'
import { RECURSO_POR_ROTA } from '../lib/permissoes.js'

let clube
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))
// quando o recurso barra, o guarda pergunta ao servidor QUAL camada barrou (plano ou clube)
const verificarOperacao = vi.fn()
vi.mock('../services/comercial.js', () => ({ verificarOperacao: (...a) => verificarOperacao(...a) }))
const carregarAvaliacoesPendentes = vi.fn()
vi.mock('../services/inicio.js', () => ({ carregarAvaliacoesPendentes: (...a) => carregarAvaliacoesPendentes(...a) }))

const { default: RotaRestrita } = await import('../components/RotaRestrita.jsx')
const { default: RecursoOpcional } = await import('../components/RecursoOpcional.jsx')
const { Jornada } = await import('./Hub.jsx')
const { default: Gestao, FilaDeAvaliacao } = await import('./Gestao.jsx')

// quem a pessoa é NESTE clube e o que o clube tem ligado
function como(papel, recursos) {
  clube = {
    carregando: false, erro: null, semVinculo: false, vinculos: [], marca: { nome: 'Clube A' }, recarregar: vi.fn(),
    ...permissoesDoPapel(papel), recursos, temRecurso: (c) => recursos[c] === true,
  }
}
const SO_CLASSES = { classes: true, especialidades: false, missoes: true, experiencias: true, atividades: true }
const COM_ESPECIALIDADES = { ...SO_CLASSES, especialidades: true }
const naRota = (rota, ui) => render(<MemoryRouter initialEntries={[rota]}>{ui}</MemoryRouter>)

beforeEach(() => {
  verificarOperacao.mockReset().mockResolvedValue({ permitido: false, bloqueio: 'clube' })
  carregarAvaliacoesPendentes.mockReset().mockResolvedValue({ classes: 2, especialidades: 3, investiduras: 0 })
})

describe('as rotas de especialidade não abrem com só "classes" ligado', () => {
  it('App.jsx protege /minhas-especialidades com o recurso "especialidades" (não "classes")', () => {
    const app = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8')
    const rota = app.match(/<Route path="\/minhas-especialidades" element=\{([^\n]*)\} \/>/)?.[1] || ''
    expect(rota).toContain('<RecursoOpcional recurso="especialidades"><MinhasEspecialidades />')
    expect(rota).not.toContain('recurso="classes"')
    // /avaliar-especialidades vai pela RotaRestrita, que pega o recurso da matriz única
    expect(app).toMatch(/<Route path="\/avaliar-especialidades" element=\{<RotaRestrita><AvaliarEspecialidades \/><\/RotaRestrita>\} \/>/)
  })

  it('/minhas-especialidades: o desbravador vê "recurso não habilitado", não a tela', () => {
    como('desbravador', SO_CLASSES)
    naRota('/minhas-especialidades',
      <RecursoOpcional recurso={RECURSO_POR_ROTA['/minhas-especialidades']}><p>tela das especialidades</p></RecursoOpcional>)
    expect(screen.queryByText('tela das especialidades')).toBeNull()
    expect(screen.getByText('Recurso não habilitado')).toBeInTheDocument()
  })

  it('/avaliar-especialidades: nem a diretoria abre (digitando a URL), mesmo com "classes" ligado', () => {
    for (const papel of ['diretoria', 'instrutor']) {
      como(papel, SO_CLASSES)
      const r = naRota('/avaliar-especialidades', <RotaRestrita><p>avaliar especialidades</p></RotaRestrita>)
      expect(screen.queryByText('avaliar especialidades'), papel).toBeNull()
      expect(screen.getByText('Recurso não habilitado')).toBeInTheDocument()
      r.unmount()
    }
  })

  it('com "classes" ligado, a tela de CLASSE continua abrindo (a separação não derrubou as classes)', () => {
    como('diretoria', SO_CLASSES)
    naRota('/avaliar-classe', <RotaRestrita><p>avaliar classe</p></RotaRestrita>)
    expect(screen.getByText('avaliar classe')).toBeInTheDocument()
  })

  it('com o recurso "especialidades" ligado, as duas telas abrem', () => {
    como('diretoria', COM_ESPECIALIDADES)
    const r = naRota('/avaliar-especialidades', <RotaRestrita><p>avaliar especialidades</p></RotaRestrita>)
    expect(screen.getByText('avaliar especialidades')).toBeInTheDocument()
    r.unmount()
    como('desbravador', COM_ESPECIALIDADES)
    naRota('/minhas-especialidades',
      <RecursoOpcional recurso={RECURSO_POR_ROTA['/minhas-especialidades']}><p>tela das especialidades</p></RecursoOpcional>)
    expect(screen.getByText('tela das especialidades')).toBeInTheDocument()
  })
})

describe('hub Jornada', () => {
  it('com só "classes" ligado: mostra Minha Classe, sem card nem promessa de especialidades', () => {
    como('desbravador', SO_CLASSES)
    naRota('/jornada', <Jornada />)
    expect(screen.getByRole('link', { name: /Minha Classe/ })).toHaveAttribute('href', '/minha-classe')
    expect(document.querySelector('a[href="/minhas-especialidades"]')).toBeNull()
    expect(document.body.textContent).not.toMatch(/especialidade/i)
  })

  it('com "especialidades" ligado, o card e o subtítulo voltam', () => {
    como('desbravador', COM_ESPECIALIDADES)
    naRota('/jornada', <Jornada />)
    expect(screen.getByRole('link', { name: /Especialidades/ })).toHaveAttribute('href', '/minhas-especialidades')
    expect(screen.getByText(/Classe, especialidades e tudo/)).toBeInTheDocument()
  })
})

describe('Gestão', () => {
  it('com só "classes" ligado: nem o card de especialidades nem a fila delas (mesmo se o servidor ainda contar)', async () => {
    como('diretoria', SO_CLASSES)
    naRota('/gestao', <Gestao />)
    // a fila vem do servidor: 2 de classe e 3 de especialidade (contadas sob 'classes', como o banco fazia)
    const fila = await screen.findByTestId('fila-avaliacao')
    expect(fila).toHaveTextContent('Requisitos de classe')
    expect(fila.querySelector('a[href="/avaliar-especialidades"]')).toBeNull()
    // o card de ferramenta também não existe, nem atrás de "ver todas"
    expect(document.querySelector('a[href="/avaliar-especialidades"]')).toBeNull()
    const verMais = screen.queryAllByRole('button', { name: /^Ver / })
    expect(verMais.length).toBeGreaterThan(0)
    for (const botao of verMais) await userEvent.click(botao)
    expect(screen.getByRole('link', { name: /Avaliar classes/ })).toHaveAttribute('href', '/avaliar-classe')   // o grupo abriu mesmo
    expect(document.querySelector('a[href="/avaliar-especialidades"]')).toBeNull()
  })

  it('se só havia especialidade na fila, a liderança vê "nada esperando" (o total não conta o que está escondido)', async () => {
    carregarAvaliacoesPendentes.mockResolvedValue({ classes: 0, especialidades: 5 })
    como('diretoria', SO_CLASSES)
    naRota('/gestao/avaliar', <FilaDeAvaliacao />)
    expect(await screen.findByText(/Nada esperando a sua avaliação/)).toBeInTheDocument()
  })

  it('com "especialidades" ligado, a fila de especialidades volta', async () => {
    como('diretoria', COM_ESPECIALIDADES)
    naRota('/gestao/avaliar', <FilaDeAvaliacao />)
    const fila = await screen.findByTestId('fila-avaliacao')
    expect(fila.querySelector('a[href="/avaliar-especialidades"]')).not.toBeNull()
  })
})
