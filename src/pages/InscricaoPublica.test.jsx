// Link/QR do clube: sem conta, mostra o clube (resolvido pelo servidor) e leva a login/cadastro
// carregando o código; com conta e `pedir=1`, o pedido de entrada segue sozinho, uma vez só.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const recarregar = vi.fn()
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ recarregar }) }))
const f = { abrirCodigo: vi.fn(), abrirCodigoPublico: vi.fn(), solicitarEntrada: vi.fn(), abrirConvite: vi.fn(), aceitarConvite: vi.fn() }
vi.mock('../services/entrada.js', () => Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])))
const { default: Entrar, InscricaoPublica } = await import('./Entrar.jsx')

const CLUBE = { encontrado: true, clube: 'Clube Águia Dourada', sigla: 'CAD', lema: 'Sempre alerta', logo_url: null }
const VOLTA = '/entrar?codigo=AB12CD34EF56AB78&pedir=1'

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  recarregar.mockReset().mockResolvedValue()
  sessionStorage.clear()
})

const abrir = (url, el = <InscricaoPublica />) => render(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>)

describe('Inscrição pública (sem conta)', () => {
  it('código válido: mostra "Inscrição no clube" com o nome vindo do servidor e as duas saídas com o código', async () => {
    f.abrirCodigoPublico.mockResolvedValue(CLUBE)
    abrir('/entrar?codigo=AB12CD34EF56AB78')
    expect(await screen.findByText('Clube Águia Dourada')).toBeInTheDocument()
    expect(screen.getByText('Inscrição no clube')).toBeInTheDocument()
    expect(screen.getByText(/Você está solicitando participação neste clube/)).toBeInTheDocument()
    expect(f.abrirCodigoPublico).toHaveBeenCalledWith('AB12CD34EF56AB78')
    const esperado = `?proximo=${encodeURIComponent(VOLTA)}`
    expect(screen.getByTestId('ja-tenho-conta')).toHaveAttribute('href', `/login${esperado}`)
    expect(screen.getByTestId('criar-conta')).toHaveAttribute('href', `/cadastro${esperado}`)
  })

  it('escolher uma saída também guarda o retorno (sobrevive a refresh no login/cadastro)', async () => {
    f.abrirCodigoPublico.mockResolvedValue(CLUBE)
    abrir('/entrar?codigo=AB12CD34EF56AB78')
    ;(await screen.findByTestId('criar-conta')).click()
    expect(sessionStorage.getItem('pos-login-retorno')).toBe(VOLTA)
  })

  it('código inválido/vencido/revogado: mensagem única, sem revelar o motivo nem o clube', async () => {
    f.abrirCodigoPublico.mockResolvedValue(null)
    abrir('/entrar?codigo=QUALQUER')
    expect(await screen.findByTestId('inscricao-invalida')).toHaveTextContent('não é válido ou não está mais ativo')
    expect(screen.queryByTestId('criar-conta')).toBeNull()
  })

  it('nunca lista clubes nem aceita club_id: sem código, só orienta a usar o link', async () => {
    abrir('/entrar?club_id=00000000-0000-0000-0000-000000000001')
    expect(await screen.findByTestId('inscricao-invalida')).toHaveTextContent('use o link ou o QR Code')
    expect(f.abrirCodigoPublico).not.toHaveBeenCalled()
  })
})

describe('Entrar com sessão e pedir=1 (voltando do login/cadastro)', () => {
  it('pede a entrada sozinho, UMA vez, e mostra que ficou pendente', async () => {
    f.abrirCodigo.mockResolvedValue({ ...CLUBE, papel: 'desbravador' })
    f.solicitarEntrada.mockResolvedValue({ encontrado: true, ok: true, ja_era: false, situacao: 'pendente' })
    abrir(VOLTA, <Entrar />)
    expect(await screen.findByTestId('resultado-entrada')).toBeInTheDocument()
    await waitFor(() => expect(f.solicitarEntrada).toHaveBeenCalledTimes(1))
    expect(f.solicitarEntrada).toHaveBeenCalledWith('AB12CD34EF56AB78')
  })

  it('sem pedir=1 continua pedindo confirmação (link digitado/colado)', async () => {
    f.abrirCodigo.mockResolvedValue({ ...CLUBE, papel: 'desbravador' })
    abrir('/entrar?codigo=AB12CD34EF56AB78', <Entrar />)
    expect(await screen.findByTestId('confirmar-entrada')).toBeInTheDocument()
    expect(f.solicitarEntrada).not.toHaveBeenCalled()
  })
})
