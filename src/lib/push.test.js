import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const upsert = vi.fn()
const apagar = vi.fn()
const eq = vi.fn()
vi.mock('./supabase.js', () => ({
  supabase: {
    rpc: (...a) => rpc(...a),
    from: () => ({ upsert: (...a) => upsert(...a), delete: () => ({ eq: (...a) => { eq(...a); return apagar() } }) }),
  },
}))

const { gravarInscricao, sincronizarPush, desassociarPush } = await import('./push.js')

function inscricao(endpoint = 'https://push.exemplo.test/x') {
  return { endpoint, options: {}, toJSON: () => ({ keys: { p256dh: 'k', auth: 'a' } }), unsubscribe: vi.fn() }
}

function aparelhoComPush(sub) {
  vi.stubGlobal('Notification', { permission: 'granted' })
  vi.stubGlobal('PushManager', function PushManager() {})
  Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => (sub ? { pushManager: { getSubscription: async () => sub } } : null) },
  })
}

beforeEach(() => {
  rpc.mockReset(); upsert.mockReset(); apagar.mockReset(); eq.mockReset()
  apagar.mockResolvedValue({ error: null })
})

describe('push — o aparelho segue o usuário logado', () => {
  it('grava pela RPC push_registrar (que reatribui o aparelho a quem entrou)', async () => {
    rpc.mockResolvedValue({ error: null })
    await gravarInscricao('u1', inscricao())
    expect(rpc).toHaveBeenCalledWith('push_registrar', { p_endpoint: 'https://push.exemplo.test/x', p_p256dh: 'k', p_auth: 'a' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('banco sem o SQL novo (RPC inexistente): cai no upsert antigo', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function' } })
    upsert.mockResolvedValue({ error: null })
    await gravarInscricao('u1', inscricao())
    expect(upsert).toHaveBeenCalledWith({ user_id: 'u1', endpoint: 'https://push.exemplo.test/x', p256dh: 'k', auth: 'a' }, { onConflict: 'endpoint' })
  })

  it('erro de validação da RPC (ex.: endpoint http) aparece, sem fallback silencioso', async () => {
    rpc.mockResolvedValue({ error: { code: 'P0001', message: 'Endpoint de push inválido (precisa ser https).' } })
    await expect(gravarInscricao('u1', inscricao('http://x'))).rejects.toMatchObject({ message: expect.stringContaining('https') })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('ao ENTRAR, um aparelho que já tem push ligado passa a ser de quem entrou', async () => {
    aparelhoComPush(inscricao())
    rpc.mockResolvedValue({ error: null })
    expect(await sincronizarPush('u2')).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('ao entrar, aparelho SEM push ligado não registra nada', async () => {
    aparelhoComPush(null)
    expect(await sincronizarPush('u2')).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ao SAIR, apaga a inscrição do usuário que saiu (a do navegador fica para o próximo login)', async () => {
    const sub = inscricao()
    aparelhoComPush(sub)
    await desassociarPush()
    expect(eq).toHaveBeenCalledWith('endpoint', 'https://push.exemplo.test/x')
    expect(sub.unsubscribe).not.toHaveBeenCalled()
  })
})
