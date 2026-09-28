// Moderação da Rede DBV (diretoria): Manter · Ocultar · Remover mapeados para as ações do servidor,
// fotos Aprovar/Recusar, quem denunciou nunca aparece, interruptor "autorização de imagem arquivada".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = {
  filaModeracao: vi.fn(), moderar: vi.fn(), encerrarSuspensao: vi.fn(), urlDaFoto: vi.fn(),
  membrosAutorizacaoImagem: vi.fn(), marcarAutorizacaoImagem: vi.fn(),
}
vi.mock('../../services/rede.js', async () => {
  const real = await vi.importActual('../../services/rede.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../../lib/imagens.js', () => ({ useImagem: (v) => v }))
const avisos = { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) }
vi.mock('../../ui/avisos.jsx', () => ({ avisar: avisos }))

const { renderRede } = await import('./_testeRede.jsx')
const { default: RedeModeracao } = await import('./RedeModeracao.jsx')

const agora = new Date().toISOString()
const FILA = {
  denuncias: [
    { tipo: 'post', id: 'p1', texto: 'post escondido', status: 'oculto_denuncia', autor: 'Ana Clara Souza', criado_em: agora, denuncias: 2, motivos: ['ofensivo'] },
    { tipo: 'post', id: 'p2', texto: 'post no ar', status: 'publicado', autor: 'Beto Lima', criado_em: agora, denuncias: 1, motivos: ['outro'], foto: 'c/u/f.webp' },
  ],
  fotos: [{ tipo: 'post', id: 'p3', foto: 'c/u/g.webp', status: 'em_analise', autor: 'Caio', criado_em: agora }],
  suspensos: [], historico: [],
}

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.filaModeracao.mockResolvedValue(FILA)
  f.moderar.mockResolvedValue({ ok: true })
  f.urlDaFoto.mockResolvedValue('blob:foto')
})

describe('Rede DBV — moderação', () => {
  it('denúncias: motivo, foto e botões; Ocultar só aparece no que ainda está no ar', async () => {
    renderRede(<RedeModeracao />)
    const [escondido, noAr] = await screen.findAllByTestId('item-fila')
    expect(within(escondido).getByText('Ofensivo ou desrespeitoso')).toBeInTheDocument()
    expect(within(escondido).queryByRole('button', { name: 'Ocultar' })).toBeNull()
    expect(within(noAr).getByRole('button', { name: 'Ocultar' })).toBeInTheDocument()
    expect(await within(noAr).findByAltText('Foto para revisar')).toBeInTheDocument()
  })

  it('Manter = restaurar, Ocultar = ocultar, Remover = remover (com confirmação)', async () => {
    const u = userEvent.setup()
    renderRede(<RedeModeracao />)
    const [escondido, noAr] = await screen.findAllByTestId('item-fila')
    await u.click(within(escondido).getByRole('button', { name: 'Manter' }))
    expect(f.moderar).toHaveBeenLastCalledWith('post', 'p1', 'restaurar')
    await u.click(within(noAr).getByRole('button', { name: 'Ocultar' }))
    expect(f.moderar).toHaveBeenLastCalledWith('post', 'p2', 'ocultar')
    await u.click(within(noAr).getByRole('button', { name: 'Remover' }))
    expect(avisos.confirmar).toHaveBeenCalled()
    expect(f.moderar).toHaveBeenLastCalledWith('post', 'p2', 'remover')
  })

  it('fotos em análise: Aprovar e Recusar', async () => {
    const u = userEvent.setup()
    renderRede(<RedeModeracao />)
    await screen.findAllByTestId('item-fila')
    await u.click(screen.getByRole('tab', { name: /Fotos/ }))
    await u.click(screen.getByRole('button', { name: 'Aprovar' }))
    expect(f.moderar).toHaveBeenLastCalledWith('post', 'p3', 'aprovar_foto')
  })

  it('autorização de imagem: interruptor por membro chama a RPC da diretoria', async () => {
    const u = userEvent.setup()
    f.membrosAutorizacaoImagem.mockResolvedValue([
      { usuario_id: 'm1', nome: 'Ana Clara Souza', papel: 'desbravador', arquivada: false, desligada_pelo_responsavel: false },
      { usuario_id: 'm2', nome: 'Beto Lima', papel: 'desbravador', arquivada: true, desligada_pelo_responsavel: true },
    ])
    f.marcarAutorizacaoImagem.mockResolvedValue({ ok: true, arquivada: true })
    renderRede(<RedeModeracao />)
    await u.click(await screen.findByRole('tab', { name: 'Imagem' }))
    const chave = await screen.findByRole('switch', { name: 'Autorização de imagem arquivada de Ana Clara Souza' })
    expect(chave).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Responsável desligou')).toBeInTheDocument()
    await u.click(chave)
    expect(f.marcarAutorizacaoImagem).toHaveBeenCalledWith('m1', true)
    expect(chave).toHaveAttribute('aria-checked', 'true')
  })
})
