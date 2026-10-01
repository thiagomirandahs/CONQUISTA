import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

import { solicitarSaneamento } from './saneamentoImagem.js'

describe('solicitarSaneamento (best-effort, nunca bloqueia o envio)', () => {
  beforeEach(() => { rpc.mockReset() })

  it('enfileira o objeto recém-enviado e devolve na hora (sem Promise para esperar)', () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    const r = solicitarSaneamento('comunidade', 'c/u/x.webp')
    expect(r).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('imagem_saneamento_enfileirar', { p_bucket: 'comunidade', p_caminho: 'c/u/x.webp' })
  })

  it('RPC que rejeita (rede, migration 529 ausente) não vira erro nem "unhandled rejection"', async () => {
    rpc.mockRejectedValue(new Error('function does not exist'))
    expect(() => solicitarSaneamento('imagens', 'perfis/u-1.jpg')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })

  it('RPC que lança de forma síncrona (cliente quebrado) também não derruba o envio', () => {
    rpc.mockImplementation(() => { throw new Error('boom') })
    expect(() => solicitarSaneamento('imagens', 'perfis/u-1.jpg')).not.toThrow()
  })

  it('RPC que devolve { error } (caminho que não é do usuário) é ignorada', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Objeto inválido.' } })
    expect(() => solicitarSaneamento('comprovacoes', 'a/b.jpg')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })

  it('não chama o servidor para bucket fora do escopo, URL pública ou caminho vazio', () => {
    solicitarSaneamento('publico', 'clube/logo.png')
    solicitarSaneamento('documentos-emitidos', 'x.png')
    solicitarSaneamento('imagens', 'https://exemplo.com/storage/v1/object/public/imagens/a.jpg')
    solicitarSaneamento('imagens', '')
    solicitarSaneamento('imagens', null)
    solicitarSaneamento(undefined, 'a.jpg')
    expect(rpc).not.toHaveBeenCalled()
  })
})
