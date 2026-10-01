// Confirmação de e-mail em OUTRO navegador: sem sessionStorage e sem `?proximo=`, o código do clube
// só existe na conta (user_metadata.entrada_codigo). Ao entrar, o porteiro executa o MESMO fluxo de
// sempre (entrada_solicitar: o servidor valida, cria vínculo PENDENTE e decide o papel) e limpa o metadado.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let clube
let sessao
const recarregar = vi.fn()
const rpc = vi.fn()
const updateUser = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a), auth: { updateUser: (...a) => updateUser(...a) } } }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ sair: vi.fn(), session: sessao }) }))
vi.mock('../context/Escopo.jsx', () => ({ useEscopo: () => ({ temEscopo: false, escopos: [], carregando: false }) }))
vi.mock('../services/admin.js', () => ({ souAdminPlataforma: () => Promise.resolve(false) }))
const { default: ClubeGuard } = await import('./ClubeGuard.jsx')

const CODIGO = 'AB12CD34EF56AB78'
const marca = { nome: 'DesbravaClube' }
const comSessao = (meta) => { sessao = { user: { id: 'u1', user_metadata: meta } } }
const semClube = (extra = {}) => { clube = { carregando: false, erro: null, semVinculo: true, vinculos: [], marca, recarregar, ...extra } }
const montar = () => render(<MemoryRouter><ClubeGuard><p>app-do-clube</p></ClubeGuard></MemoryRouter>)

beforeEach(() => {
  rpc.mockReset(); updateUser.mockReset().mockResolvedValue({ data: {}, error: null }); recarregar.mockReset().mockResolvedValue()
  sessionStorage.clear()
  semClube()
})

describe('ClubeGuard + user_metadata.entrada_codigo', () => {
  it('login em outro navegador (sem sessionStorage/?proximo) com o metadado: pede a entrada e limpa o metadado', async () => {
    comSessao({ nome: 'Ana', entrada_codigo: CODIGO })
    rpc.mockResolvedValue({ data: { encontrado: true, ok: true, ja_era: false, situacao: 'pendente', papel: 'desbravador' }, error: null })
    montar()
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('entrada_solicitar', { p_codigo: CODIGO }))
    // só o código vai para o servidor: nada de papel/clube escolhido pelo cliente
    expect(Object.keys(rpc.mock.calls[0][1])).toEqual(['p_codigo'])
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ data: { entrada_codigo: null } }))
    await waitFor(() => expect(recarregar).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('não mostra "Entrar com código" enquanto aplica (sem piscar a tela errada)', async () => {
    comSessao({ entrada_codigo: CODIGO })
    let solta
    rpc.mockReturnValue(new Promise((r) => { solta = r }))
    montar()
    expect(screen.queryByText('Você ainda não está em um clube')).toBeNull()
    solta({ data: { encontrado: true, ok: true, ja_era: false, situacao: 'pendente' }, error: null })
    await waitFor(() => expect(updateUser).toHaveBeenCalled())
  })

  it('código inválido/expirado: mensagem amigável, cai no "Entrar com código", limpa o metadado e não trava', async () => {
    comSessao({ entrada_codigo: CODIGO })
    rpc.mockResolvedValue({ data: { encontrado: false }, error: null })
    montar()
    expect(await screen.findByTestId('aviso-entrada-codigo')).toHaveTextContent(/não está mais valendo|Peça um código novo/i)
    expect(screen.getByTestId('ir-entrar')).toBeInTheDocument()
    expect(updateUser).toHaveBeenCalledWith({ data: { entrada_codigo: null } })
    expect(recarregar).not.toHaveBeenCalled()
  })

  it('falha de rede/limite: não apaga o metadado (tenta de novo na próxima abertura) e não trava', async () => {
    comSessao({ entrada_codigo: CODIGO })
    rpc.mockResolvedValue({ data: null, error: { message: 'Muitas tentativas.' } })
    montar()
    expect(await screen.findByTestId('ir-entrar')).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('quem já tem vínculo/pedido: o servidor responde ja_era, nada repete, o metadado é limpo', async () => {
    comSessao({ entrada_codigo: CODIGO })
    semClube({ vinculos: [{ status: 'pendente', marca: { nome: 'Clube X' } }] })
    rpc.mockResolvedValue({ data: { encontrado: true, ok: true, ja_era: true, situacao: 'pendente' }, error: null })
    montar()
    await waitFor(() => expect(updateUser).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('sem metadado: não chama nada', async () => {
    comSessao({ nome: 'Ana' })
    montar()
    expect(await screen.findByTestId('ir-entrar')).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('metadado fora do formato (forjado/lixo): ignorado, nada vai ao servidor', async () => {
    for (const ruim of ['abc', '<b>x</b>', 'A'.repeat(80), 12345, { a: 1 }]) {
      rpc.mockReset(); comSessao({ entrada_codigo: ruim })
      const { unmount } = montar()
      expect(await screen.findByTestId('ir-entrar')).toBeInTheDocument()
      expect(rpc).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('espera o contexto do clube carregar antes de agir', () => {
    comSessao({ entrada_codigo: CODIGO })
    semClube({ carregando: true })
    montar()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('nunca escreve o código no console', async () => {
    const espioes = ['log', 'info', 'warn', 'error'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    comSessao({ entrada_codigo: CODIGO })
    rpc.mockResolvedValue({ data: { encontrado: false }, error: null })
    montar()
    await screen.findByTestId('aviso-entrada-codigo')
    for (const e of espioes) expect(JSON.stringify(e.mock.calls)).not.toContain(CODIGO)
    espioes.forEach((e) => e.mockRestore())
  })
})
