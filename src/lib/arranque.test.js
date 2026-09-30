// Marcos do arranque e telemetria sem dado pessoal (fase 7).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { marcar, limparMarcas, montarRegistro, etapaPresa, existeSessaoGuardada, guardarPendente, lerPendentes, enviarPendentes, recarregarAbertura } from './arranque.js'

function memoria() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

beforeEach(() => { limparMarcas() })

describe('existeSessaoGuardada: só sim/não, nunca o conteúdo', () => {
  it('true quando há refresh_token (dá para recuperar a sessão)', () => {
    const s = memoria(); s.setItem('k', JSON.stringify({ access_token: 'a', refresh_token: 'r' }))
    expect(existeSessaoGuardada('k', s)).toBe(true)
  })
  it.each([[null], ['lixo{{'], [JSON.stringify({ access_token: 'a' })], [JSON.stringify(null)]])('false para %s', (v) => {
    const s = memoria(); if (v !== null) s.setItem('k', v)
    expect(existeSessaoGuardada('k', s)).toBe(false)
  })
})

describe('registro de abertura lenta', () => {
  it('diz EM QUE ETAPA travou (sessão/perfil/clube)', () => {
    marcar('sessao_inicio'); marcar('sessao_lento')
    expect(etapaPresa()).toBe('sessao')
    marcar('perfil_inicio')
    expect(etapaPresa()).toBe('perfil')
    marcar('clube_inicio')
    expect(etapaPresa()).toBe('clube')
  })

  it('o código e o contexto NÃO carregam dado pessoal (sem e-mail, sem uuid, sem token)', () => {
    marcar('sessao_inicio'); marcar('sessao_lento'); marcar('sessao_resposta'); marcar('perfil_inicio'); marcar('perfil_fim')
    const r = montarRegistro({ problema: 'sem_conexao', tentativas: 2, online: false, nativo: true })
    const tudo = `${r.codigo} ${r.contexto}`
    expect(tudo).not.toMatch(/@/)
    expect(tudo).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
    expect(tudo).not.toMatch(/eyJ/) // início de todo JWT
    expect(r.codigo).toMatch(/^BOOT:(sessao|perfil|clube|inicio):(lento|sem_conexao|erro):(ate3s|ate8s|ate20s|mais20s)$/)
    expect(r.codigo.length).toBeLessThanOrEqual(80)
    expect(r.contexto.length).toBeLessThanOrEqual(200)
    expect(r.contexto).toContain('retry=2')
    expect(r.contexto).toContain('online=0')
    expect(r.contexto).toContain('app=1')
  })
})

describe('fila local de telemetria (sobrevive ao fechar o app)', () => {
  it('guarda no máximo 5', () => {
    const s = memoria()
    for (let i = 0; i < 8; i++) guardarPendente({ codigo: `BOOT:sessao:lento:ate8s#${i}`, contexto: 'x' }, s)
    expect(lerPendentes(s)).toHaveLength(5)
  })

  it('envio que FALHA mantém o item para a próxima abertura; o que dá certo sai', async () => {
    const s = memoria()
    guardarPendente({ codigo: 'A', contexto: '' }, s)
    guardarPendente({ codigo: 'B', contexto: '' }, s)
    const enviados = await enviarPendentes(async (item) => { if (item.codigo === 'B') throw new Error('sem rede') }, s)
    expect(enviados).toBe(1)
    expect(lerPendentes(s).map((x) => x.codigo)).toEqual(['B'])
    expect(await enviarPendentes(async () => {}, s)).toBe(1)
    expect(lerPendentes(s)).toEqual([])
  })

  it('storage bloqueado não quebra nada', () => {
    const quebrado = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') }, removeItem: () => {} }
    expect(() => guardarPendente({ codigo: 'A' }, quebrado)).not.toThrow()
    expect(lerPendentes(quebrado)).toEqual([])
  })
})

describe('recarregarAbertura: recomeçar a abertura sem formar laço', () => {
  it('manual (botão) SEMPRE recarrega', () => {
    const s = memoria(); const recarregar = vi.fn()
    expect(recarregarAbertura({ manual: true, agora: 1000, storage: s, recarregar })).toBe(true)
    expect(recarregarAbertura({ manual: true, agora: 1001, storage: s, recarregar })).toBe(true)
    expect(recarregar).toHaveBeenCalledTimes(2)
  })
  it('automático recarrega no máximo 1x a cada 20 s', () => {
    const s = memoria(); const recarregar = vi.fn()
    expect(recarregarAbertura({ agora: 100000, storage: s, recarregar })).toBe(true)
    expect(recarregarAbertura({ agora: 110000, storage: s, recarregar })).toBe(false)
    expect(recarregarAbertura({ agora: 120001, storage: s, recarregar })).toBe(true)
    expect(recarregar).toHaveBeenCalledTimes(2)
  })
  it('sem sessionStorage (aba anônima bloqueada) ainda recarrega o botão e não quebra', () => {
    const quebrado = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    const recarregar = vi.fn()
    expect(recarregarAbertura({ manual: true, storage: quebrado, recarregar })).toBe(true)
    expect(recarregar).toHaveBeenCalled()
  })
})
