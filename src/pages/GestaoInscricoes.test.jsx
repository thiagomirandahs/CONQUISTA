// Gestão → Inscrições (Etapa 3 desta rodada): reaproveita 100% do backend já seguro
// (club_entry_codes / clube_codigo_gerar / entrada_abrir) — nenhum mecanismo novo. O código em
// claro só existe na tela no instante em que é gerado (o banco guarda só o hash), então
// copiar/QR só podem aparecer logo depois de `gerar`, nunca a partir do estado salvo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let clube = { podeAdministrar: true, clubeId: 'clube-a', marca: { nome: 'Clube Águia' } }
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))

const codigoAtual = vi.fn()
const gerarCodigo = vi.fn()
const revogarCodigo = vi.fn()
vi.mock('../services/entrada.js', () => ({
  codigoAtual: (...a) => codigoAtual(...a),
  gerarCodigo: (...a) => gerarCodigo(...a),
  revogarCodigo: (...a) => revogarCodigo(...a),
  entradasPendentes: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/qr.js', () => ({ qrSvg: (texto) => `<svg data-qr="${texto}"></svg>` }))

const escrever = vi.fn().mockResolvedValue()
Object.assign(navigator, { clipboard: { writeText: (...a) => escrever(...a) } })

const { default: GestaoInscricoes } = await import('./GestaoInscricoes.jsx')

beforeEach(() => {
  clube = { podeAdministrar: true, clubeId: 'clube-a', marca: { nome: 'Clube Águia' } }
  codigoAtual.mockReset().mockResolvedValue({ existe: false })
  gerarCodigo.mockReset()
  revogarCodigo.mockReset()
  escrever.mockClear()
})

describe('GestaoInscricoes: acesso', () => {
  it('sem podeGerir, mostra "área restrita" e nunca chama o backend de código', async () => {
    clube = { podeAdministrar: false, clubeId: 'clube-a' }
    render(<GestaoInscricoes />)
    expect(screen.getByText('Área restrita')).toBeInTheDocument()
    expect(codigoAtual).not.toHaveBeenCalled()
  })
  it('instrutor (lidera, mas não administra — migration 210) também não abre as inscrições', async () => {
    clube = { podeGerir: true, podeAvaliar: true, podeAdministrar: false, clubeId: 'clube-a' }
    render(<GestaoInscricoes />)
    expect(screen.getByText('Área restrita')).toBeInTheDocument()
    expect(codigoAtual).not.toHaveBeenCalled()
  })
})

describe('GestaoInscricoes: código em claro só aparece ao gerar', () => {
  it('sem código ativo, não mostra QR nem botões de copiar', async () => {
    render(<GestaoInscricoes />)
    expect(await screen.findByText('Nenhum código ativo.')).toBeInTheDocument()
    expect(screen.queryByTestId('codigo-novo')).toBeNull()
  })

  it('há código ativo salvo (prefixo): mostra a situação, mas NUNCA o código em claro', async () => {
    codigoAtual.mockResolvedValue({ existe: true, prefixo: 'DF4A', criado_em: '2026-09-01', expira_em: null, vencido: false })
    render(<GestaoInscricoes />)
    const situacao = await screen.findByTestId('codigo-situacao')
    expect(situacao).toHaveTextContent('DF4A')
    expect(screen.queryByTestId('codigo-novo')).toBeNull()
  })

  it('gerar código: mostra o código em claro, o QR (aponta pro link público) e os botões de copiar', async () => {
    gerarCodigo.mockResolvedValue({ codigo: 'DF4A3BEE' })
    render(<GestaoInscricoes />)
    await userEvent.click(await screen.findByTestId('codigo-gerar'))

    const novo = await screen.findByTestId('codigo-novo')
    expect(novo).toHaveTextContent('DF4A3BEE')

    const qr = novo.querySelector('[data-qr]')
    expect(qr).not.toBeNull()
    // o QR aponta para a MESMA rota pública /entrar?codigo=... — nunca embute club_id/uuid/papel.
    expect(qr.getAttribute('data-qr')).toMatch(/\/entrar\?codigo=DF4A3BEE$/)
    expect(qr.getAttribute('data-qr')).not.toMatch(/clube|uuid|papel|role/i)

    await userEvent.click(screen.getByRole('button', { name: 'Copiar link' }))
    expect(escrever).toHaveBeenCalledWith(expect.stringContaining('/entrar?codigo=DF4A3BEE'))

    await userEvent.click(screen.getByRole('button', { name: 'Copiar código' }))
    expect(escrever).toHaveBeenCalledWith('DF4A3BEE')
  })

  it('revogar limpa o código exibido e some com o QR', async () => {
    codigoAtual.mockResolvedValue({ existe: true, prefixo: 'DF4A', criado_em: '2026-09-01', expira_em: null, vencido: false })
    gerarCodigo.mockResolvedValue({ codigo: 'DF4A3BEE' })
    render(<GestaoInscricoes />)
    await userEvent.click(await screen.findByTestId('codigo-gerar'))
    await screen.findByTestId('codigo-novo')

    codigoAtual.mockResolvedValue({ existe: false })
    await userEvent.click(screen.getByTestId('codigo-revogar'))
    expect(revogarCodigo).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('codigo-novo')).toBeNull()
  })
})

describe('GestaoInscricoes: nome do clube, link completo e compartilhar', () => {
  it('mostra o clube e, ao gerar, o link completo; compartilhar usa o menu nativo com o link', async () => {
    const share = vi.fn().mockResolvedValue()
    Object.assign(navigator, { share })
    gerarCodigo.mockResolvedValue({ codigo: 'AB12CD34EF56AB78', prefixo: 'AB12', expira_em: null })
    render(<GestaoInscricoes />)
    expect(await screen.findByTestId('clube-da-inscricao')).toHaveTextContent('Clube Águia')
    await userEvent.click(await screen.findByRole('button', { name: /Gerar código/ }))
    const link = `${window.location.origin}/entrar?codigo=AB12CD34EF56AB78`
    expect(await screen.findByTestId('link-completo')).toHaveTextContent(link)
    await userEvent.click(screen.getByTestId('compartilhar-link'))
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: link, title: 'Inscrição no Clube Águia' }))
    delete navigator.share
  })
})
