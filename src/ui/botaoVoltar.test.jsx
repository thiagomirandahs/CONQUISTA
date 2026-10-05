// Seta de voltar única: usa o histórico quando existe, cai no destino de emergência quando a tela foi aberta por link; fecha camadas; confirma descarte.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { BotaoVoltar, Cabecalho, Folha } from './index.jsx'
import { limparCamadas, fecharCamadaDoTopo } from '../lib/camadas.js'

beforeEach(() => limparCamadas())

function Onde() { const l = useLocation(); return <p data-testid="onde">{l.pathname}</p> }
function Ir({ para }) { const n = useNavigate(); return <button onClick={() => n(para)}>ir</button> }
const App = ({ inicial = ['/hub'], children }) => (
  <MemoryRouter initialEntries={inicial}>
    <Onde />
    <Routes>
      <Route path="/hub" element={<Ir para="/sub" />} />
      <Route path="/sub" element={children} />
    </Routes>
  </MemoryRouter>
)

describe('BotaoVoltar', () => {
  it('veio navegando dentro do app: volta no histórico (para a tela de onde veio)', async () => {
    const u = userEvent.setup()
    render(<App><BotaoVoltar para="/hub" rotulo="o Hub" /></App>)
    await u.click(screen.getByRole('button', { name: 'ir' }))
    expect(screen.getByTestId('onde')).toHaveTextContent('/sub')
    await u.click(screen.getByRole('button', { name: 'Voltar para o Hub' }))
    expect(screen.getByTestId('onde')).toHaveTextContent('/hub')
  })
  it('abriu a tela direto (link/notificação, sem histórico): vai para o destino de emergência em vez de ficar preso', async () => {
    const u = userEvent.setup()
    render(<App inicial={['/sub']}><BotaoVoltar para="/hub" /></App>)
    await u.click(screen.getByTestId('botao-voltar'))
    expect(screen.getByTestId('onde')).toHaveTextContent('/hub')
  })
  it('aoVoltar devolvendo false cancela (confirmar descarte de formulário)', async () => {
    const u = userEvent.setup()
    render(<App inicial={['/sub']}><BotaoVoltar para="/hub" aoVoltar={() => false} /></App>)
    await u.click(screen.getByTestId('botao-voltar'))
    expect(screen.getByTestId('onde')).toHaveTextContent('/sub')
  })
  it('alvo de 44px e aria-label sempre; variação ícone só tem a seta', () => {
    render(<App inicial={['/sub']}><BotaoVoltar variacao="icone" /></App>)
    const b = screen.getByTestId('botao-voltar')
    expect(b).toHaveAttribute('aria-label', 'Voltar')
    expect(b.className).toContain('min-h-[44px]'); expect(b.className).toContain('min-w-[44px]')
    expect(b.textContent).toBe('')
  })
  it('Cabecalho com voltar mostra a seta padrão', () => {
    render(<App inicial={['/sub']}><Cabecalho titulo="Minha Classe" voltar={{ para: '/hub', rotulo: 'a Jornada' }} /></App>)
    expect(screen.getByRole('button', { name: 'Voltar para a Jornada' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Minha Classe/ })).toBeInTheDocument()
  })
})

describe('Folha + botão físico de voltar', () => {
  it('enquanto a folha está aberta, fecharCamadaDoTopo() a fecha (é o que o Android chama); depois não há mais camada', async () => {
    const aoFechar = vi.fn()
    const { rerender } = render(<Folha aberta aoFechar={aoFechar} titulo="Teste"><p>conteúdo</p></Folha>)
    expect(fecharCamadaDoTopo()).toBe(true)
    expect(aoFechar).toHaveBeenCalledTimes(1)
    rerender(<Folha aberta={false} aoFechar={aoFechar} titulo="Teste"><p>conteúdo</p></Folha>)
    expect(fecharCamadaDoTopo()).toBe(false)
  })
})
