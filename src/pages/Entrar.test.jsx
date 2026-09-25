// Achado F-R1 da revisão da fase 9.1: quem já tem vínculo no clube (desativado, recusado, ainda
// pendente) digitava o código e via "✅ Pedido enviado" — mas o servidor NÃO cria pedido nesse caso
// (entrada_solicitar devolve `ja_era: true` e a `situacao` do vínculo que já existe) e a liderança
// não via nada. A pessoa ficava esperando uma aprovação que nunca vinha. Estes testes usam as
// respostas REAIS do banco (medidas no replay_rev pela revisão cética).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const recarregar = vi.fn()
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ recarregar }) }))
const abrirCodigo = vi.fn()
const solicitarEntrada = vi.fn()
const abrirConvite = vi.fn()
const aceitarConvite = vi.fn()
vi.mock('../services/entrada.js', () => ({
  abrirCodigo: (...a) => abrirCodigo(...a),
  solicitarEntrada: (...a) => solicitarEntrada(...a),
  abrirConvite: (...a) => abrirConvite(...a),
  aceitarConvite: (...a) => aceitarConvite(...a),
}))
const { default: Entrar } = await import('./Entrar.jsx')

const DESTINO = { encontrado: true, clube: 'Clube do Teste', sigla: 'CT', lema: null, logo_url: null, papel: 'desbravador' }

beforeEach(() => {
  recarregar.mockReset().mockResolvedValue()
  abrirCodigo.mockReset().mockResolvedValue(DESTINO)
  solicitarEntrada.mockReset()
  abrirConvite.mockReset()
  aceitarConvite.mockReset()
})

// Passo 1 (código) -> passo 2 (confirmar) -> resultado
async function pedirComCodigo() {
  render(<MemoryRouter initialEntries={['/entrar']}><Entrar /></MemoryRouter>)
  await userEvent.type(screen.getByTestId('campo-codigo'), 'DF4A3BEE')
  await userEvent.click(screen.getByTestId('conferir-codigo'))
  await userEvent.click(await screen.findByTestId('confirmar-entrada'))
  return screen.findByTestId('resultado-entrada')
}

describe('Entrar: a mensagem final diz o que o servidor FEZ', () => {
  it('pedido novo: "Pedido enviado" (o único caso em que isso é verdade)', async () => {
    solicitarEntrada.mockResolvedValue({ encontrado: true, ok: true, ja_era: false, situacao: 'pendente' })
    const texto = await pedirComCodigo()
    expect(screen.getByText('✅ Pedido enviado')).toBeInTheDocument()
    expect(texto).toHaveTextContent('A liderança de Clube do Teste recebeu seu pedido')
    expect(recarregar).toHaveBeenCalledTimes(1)
  })

  it('DESATIVADO (vínculo suspenso): diz que o acesso está suspenso e manda falar com a liderança', async () => {
    solicitarEntrada.mockResolvedValue({ encontrado: true, ok: true, ja_era: true, situacao: 'suspenso' })
    const texto = await pedirComCodigo()
    expect(screen.queryByText('✅ Pedido enviado')).toBeNull()
    expect(screen.getByText('⏸️ Acesso suspenso')).toBeInTheDocument()
    expect(texto).toHaveTextContent('Você já faz parte de Clube do Teste, mas seu acesso está suspenso')
    expect(texto).toHaveTextContent('fale com a liderança')
    expect(texto).not.toHaveTextContent(/recebeu seu pedido/)
  })

  it('RECUSADO (vínculo encerrado): diz que o pedido anterior foi recusado e que o código não o reabre', async () => {
    solicitarEntrada.mockResolvedValue({ encontrado: true, ok: true, ja_era: true, situacao: 'encerrado' })
    const texto = await pedirComCodigo()
    expect(screen.queryByText('✅ Pedido enviado')).toBeNull()
    expect(screen.getByText('🚫 Pedido recusado')).toBeInTheDocument()
    expect(texto).toHaveTextContent('Seu pedido anterior para entrar em Clube do Teste foi recusado')
    expect(texto).toHaveTextContent('fale com a liderança')
  })

  it('pedido repetido (ainda pendente): não finge um pedido novo', async () => {
    solicitarEntrada.mockResolvedValue({ encontrado: true, ok: true, ja_era: true, situacao: 'pendente' })
    const texto = await pedirComCodigo()
    expect(screen.getByText('⏳ Pedido já enviado')).toBeInTheDocument()
    expect(texto).toHaveTextContent('continua aguardando a liderança')
  })

  it('já é membro ativo: diz isso, sem pedido', async () => {
    solicitarEntrada.mockResolvedValue({ encontrado: true, ok: true, ja_era: true, situacao: 'ativo' })
    const texto = await pedirComCodigo()
    expect(screen.getByText('✅ Você já faz parte deste clube')).toBeInTheDocument()
    expect(texto).toHaveTextContent('Você já faz parte de Clube do Teste')
  })

  it('situação que a tela não conhece: mensagem neutra, nunca "Pedido enviado"', async () => {
    solicitarEntrada.mockResolvedValue({ encontrado: true, ok: true, ja_era: true, situacao: 'outra_coisa' })
    await pedirComCodigo()
    expect(screen.queryByText('✅ Pedido enviado')).toBeNull()
    expect(screen.getByText('ℹ️ Você já tinha cadastro aqui')).toBeInTheDocument()
  })

  it('a tela de resultado tem saída (no app instalado não há botão de voltar)', async () => {
    solicitarEntrada.mockResolvedValue({ encontrado: true, ok: true, ja_era: true, situacao: 'suspenso' })
    await pedirComCodigo()
    expect(screen.getByTestId('voltar-inicio')).toHaveAttribute('href', '/')
  })
})

describe('Entrar por convite', () => {
  async function aceitar() {
    abrirConvite.mockResolvedValue(DESTINO)
    render(<MemoryRouter initialEntries={['/entrar?convite=tok123']}><Entrar /></MemoryRouter>)
    await userEvent.click(await screen.findByTestId('confirmar-entrada'))
    return screen.findByTestId('resultado-entrada')
  }

  it('convite novo: "Você agora faz parte"', async () => {
    aceitarConvite.mockResolvedValue({ encontrado: true, ok: true, ja_era_membro: false })
    const texto = await aceitar()
    expect(aceitarConvite).toHaveBeenCalledWith('tok123')
    expect(screen.getByText('🎉 Pronto!')).toBeInTheDocument()
    expect(texto).toHaveTextContent('Você agora faz parte de Clube do Teste')
  })

  it('quem JÁ tinha vínculo (talvez suspenso): o convite não promete acesso que não deu', async () => {
    aceitarConvite.mockResolvedValue({ encontrado: true, ok: true, ja_era_membro: true })
    const texto = await aceitar()
    expect(screen.queryByText('🎉 Pronto!')).toBeNull()
    expect(texto).not.toHaveTextContent(/agora faz parte/)
    expect(texto).toHaveTextContent('Você já tinha um cadastro em Clube do Teste')
  })
})

// `?codigo=` (Gestão → Inscrições, Etapa 3 desta rodada): o QR/link do clube já resolve o destino
// sozinho, igual ao `?convite=` — a pessoa não digita o que acabou de escanear. O servidor continua
// sendo quem decide (mesma abrirCodigo do passo 1 manual); a URL só evita a etapa de digitação.
describe('Entrar por ?codigo= (link/QR do clube)', () => {
  it('abre direto no passo 2 (confirmar), sem exigir digitação', async () => {
    render(<MemoryRouter initialEntries={['/entrar?codigo=df4a3bee']}><Entrar /></MemoryRouter>)
    await screen.findByTestId('destino')
    expect(abrirCodigo).toHaveBeenCalledWith('df4a3bee')
    expect(screen.getByText('Clube do Teste')).toBeInTheDocument()
  })

  it('código inexistente/revogado/vencido: mesma mensagem genérica do passo 1 manual', async () => {
    abrirCodigo.mockResolvedValue(null)
    render(<MemoryRouter initialEntries={['/entrar?codigo=xxxxxxxx']}><Entrar /></MemoryRouter>)
    expect(await screen.findByTestId('erro-codigo')).toHaveTextContent('Código não encontrado')
    expect(screen.queryByTestId('destino')).toBeNull()
  })

  it('confirmar a partir do link segue solicitando entrada (nunca aceita convite)', async () => {
    solicitarEntrada.mockResolvedValue({ encontrado: true, ok: true, ja_era: false, situacao: 'pendente' })
    render(<MemoryRouter initialEntries={['/entrar?codigo=df4a3bee']}><Entrar /></MemoryRouter>)
    await userEvent.click(await screen.findByTestId('confirmar-entrada'))
    await screen.findByTestId('resultado-entrada')
    expect(solicitarEntrada).toHaveBeenCalledWith('df4a3bee')
    expect(aceitarConvite).not.toHaveBeenCalled()
  })

  it('manipular a URL para um club_id/uuid não muda nada: só o código (segredo) é lido', async () => {
    render(<MemoryRouter initialEntries={['/entrar?codigo=df4a3bee&club_id=11111111-1111-1111-1111-111111111111']}><Entrar /></MemoryRouter>)
    await screen.findByTestId('destino')
    // abrirCodigo só recebe o código — nenhum parâmetro extra da URL chega ao servidor por aqui.
    expect(abrirCodigo).toHaveBeenCalledWith('df4a3bee')
    expect(abrirCodigo).toHaveBeenCalledTimes(1)
  })

  it('convite tem prioridade quando os dois vierem juntos na URL (caso não deveria acontecer, mas não pode travar)', async () => {
    abrirConvite.mockResolvedValue(DESTINO)
    render(<MemoryRouter initialEntries={['/entrar?convite=tok123&codigo=df4a3bee']}><Entrar /></MemoryRouter>)
    await screen.findByTestId('destino')
    expect(abrirConvite).toHaveBeenCalledWith('tok123')
    expect(abrirCodigo).not.toHaveBeenCalled()
  })
})
