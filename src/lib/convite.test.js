import { describe, it, expect, vi } from 'vitest'
import { montarLinkConvite, lerTokenConvite, limparConviteDaUrl, STATUS_CONVITE } from './convite.js'

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678abcdef01'

describe('convite de responsável (token fora dos logs)', () => {
  it('monta o link com o token no FRAGMENTO, nunca na query', () => {
    const link = montarLinkConvite('https://app.exemplo.com', TOKEN)
    expect(link).toBe(`https://app.exemplo.com/cadastro#convite=${TOKEN}`)
    expect(link).not.toContain('?')
  })

  it('ignora barra final no origin', () => {
    expect(montarLinkConvite('https://app.exemplo.com/', TOKEN)).toBe(`https://app.exemplo.com/cadastro#convite=${TOKEN}`)
  })

  it('lê o token do fragmento', () => {
    expect(lerTokenConvite({ hash: `#convite=${TOKEN}`, search: '' })).toBe(TOKEN)
  })

  it('aceita link antigo com ?convite= (compat)', () => {
    expect(lerTokenConvite({ hash: '', search: `?convite=${TOKEN}` })).toBe(TOKEN)
  })

  it('o fragmento tem prioridade sobre a query', () => {
    const outro = 'f'.repeat(48)
    expect(lerTokenConvite({ hash: `#convite=${TOKEN}`, search: `?convite=${outro}` })).toBe(TOKEN)
  })

  it('normaliza para minúsculas', () => {
    expect(lerTokenConvite({ hash: `#convite=${TOKEN.toUpperCase()}`, search: '' })).toBe(TOKEN)
  })

  it('rejeita token mal formado (tamanho, caracteres, vazio)', () => {
    expect(lerTokenConvite({ hash: '#convite=curto', search: '' })).toBe('')
    expect(lerTokenConvite({ hash: `#convite=${'z'.repeat(48)}`, search: '' })).toBe('')
    expect(lerTokenConvite({ hash: '#convite=', search: '' })).toBe('')
    expect(lerTokenConvite({ hash: '', search: '' })).toBe('')
    expect(lerTokenConvite(undefined)).toBe('')
  })

  it('não confunde outros parâmetros com o convite', () => {
    expect(lerTokenConvite({ hash: '#outro=1', search: '?x=2' })).toBe('')
  })

  it('limpa a URL (tira hash e query) sem recarregar', () => {
    const replaceState = vi.fn()
    limparConviteDaUrl({ pathname: '/cadastro' }, { replaceState })
    expect(replaceState).toHaveBeenCalledWith(null, '', '/cadastro')
  })

  it('não quebra sem history/location', () => {
    expect(() => limparConviteDaUrl(undefined, undefined)).not.toThrow()
  })

  it('tem rótulo para todos os estados que o banco devolve', () => {
    for (const s of ['ativo', 'usado', 'expirado', 'revogado']) {
      expect(STATUS_CONVITE[s].rotulo).toBeTruthy()
    }
  })
})
