import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decidir, criarAtualizador, compararVersaoNativa, versaoNativaLegivel, INTERVALO_MS } from './atualizacaoOta.js'

const SHA = 'a'.repeat(64)
const manifesto = (extra = {}) => ({ versao: '202609291200-abc1234', url: 'https://app.desbravaclube.com.br/ota/bundle-x.zip', sha256: SHA, minimoNativo: '1.3.0', ...extra })

describe('OTA: decidir', () => {
  const base = { versaoAtual: '202609281000-0000000', versaoNativa: 'v1.3.0', pendente: null }
  it('versão nova e nativo compatível → aplicar', () => {
    expect(decidir({ ...base, manifesto: manifesto() }).acao).toBe('aplicar')
  })
  it('versão igual → ignorar', () => {
    expect(decidir({ ...base, manifesto: manifesto({ versao: base.versaoAtual }) }).motivo).toBe('mesma-versao')
  })
  it('nativo mais antigo que o mínimo → ignorar (precisa APK novo)', () => {
    expect(decidir({ ...base, versaoNativa: '1.2.9', manifesto: manifesto() }).motivo).toBe('nativo-antigo')
    expect(decidir({ ...base, versaoNativa: '1.10.0', manifesto: manifesto() }).acao).toBe('aplicar')
  })
  it('versionName ilegível ("main", "dev", "0", vazio) NÃO trava o OTA; numérico antigo continua travando', () => {
    for (const v of ['main', 'dev', '0', '', undefined]) expect(decidir({ ...base, versaoNativa: v, manifesto: manifesto() }).acao, String(v)).toBe('aplicar')
    for (const v of ['1.3.0-ci41', 'v1.3.8', '1.4.0']) expect(decidir({ ...base, versaoNativa: v, manifesto: manifesto() }).acao, v).toBe('aplicar')
    for (const v of ['1.2.9', 'v1.0', '1.2.0-ci3']) expect(decidir({ ...base, versaoNativa: v, manifesto: manifesto() }).motivo, v).toBe('nativo-antigo')
    expect(['1.3.0', 'v2.0.1', '1.3.0-ci7'].every(versaoNativaLegivel)).toBe(true)
    expect(['main', '0', '', 'abc'].some(versaoNativaLegivel)).toBe(false)
  })
  it('o workflow do APK nunca usa ref_name solto como versionName (sem tag vira numérico)', () => {
    const wf = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'android.yml'), 'utf8')
    expect(wf).not.toMatch(/appVersionName=\$\{\{\s*github\.ref_name/)
    expect(wf).toMatch(/appVersionName=\$\{\{\s*steps\.ver\.outputs\.nome/)
    expect(wf).toMatch(/otaMinimoNativo/)
  })
  it('já baixada e pendente → não baixa de novo', () => {
    expect(decidir({ ...base, pendente: manifesto().versao, manifesto: manifesto() }).motivo).toBe('ja-baixada')
  })
  it('manifesto torto (sem sha, http, vazio) → ignorar', () => {
    expect(decidir({ ...base, manifesto: manifesto({ sha256: 'x' }) }).motivo).toBe('manifesto-invalido')
    expect(decidir({ ...base, manifesto: manifesto({ url: 'http://x/y.zip' }) }).motivo).toBe('manifesto-invalido')
    expect(decidir({ ...base, manifesto: null }).motivo).toBe('manifesto-invalido')
  })
  it('compara versão nativa numericamente', () => {
    expect(compararVersaoNativa('v1.3.0', '1.3.0')).toBe(0)
    expect(compararVersaoNativa('1.10', '1.9.9')).toBeGreaterThan(0)
  })
})

function montar({ manifestoPublicado = manifesto(), checksum = SHA, rede = true } = {}) {
  let t = 1_000_000
  const plugin = {
    current: vi.fn(async () => ({ native: '1.3.0', bundle: { id: 'builtin' } })),
    download: vi.fn(async () => ({ id: 'b1', checksum })),
    next: vi.fn(async () => ({})),
    set: vi.fn(),
    delete: vi.fn(async () => {}),
    setMultiDelay: vi.fn(async () => {}),
  }
  const buscarManifesto = vi.fn(async () => { if (!rede) throw new Error('offline'); return manifestoPublicado })
  const a = criarAtualizador({ plugin, buscarManifesto, versaoAtual: '202609281000-0000000', agora: () => t })
  return { a, plugin, buscarManifesto, avancar: (ms) => { t += ms } }
}

describe('OTA: atualizador', () => {
  it('baixa com checksum, confere e marca para a PRÓXIMA abertura (nunca set)', async () => {
    const { a, plugin } = montar()
    expect((await a.verificar()).acao).toBe('aplicar')
    expect(plugin.download).toHaveBeenCalledWith(expect.objectContaining({ checksum: SHA, version: manifesto().versao }))
    expect(plugin.next).toHaveBeenCalledWith({ id: 'b1' })
    expect(plugin.set).not.toHaveBeenCalled()
  })
  it('sha errado → apaga o baixado e não marca', async () => {
    const { a, plugin } = montar({ checksum: 'b'.repeat(64) })
    expect((await a.verificar()).motivo).toBe('sha-errado')
    expect(plugin.delete).toHaveBeenCalledWith({ id: 'b1' })
    expect(plugin.next).not.toHaveBeenCalled()
  })
  it('erro de rede → silêncio, nada baixado', async () => {
    const { a, plugin } = montar({ rede: false })
    expect((await a.verificar()).motivo).toBe('rede')
    expect(plugin.download).not.toHaveBeenCalled()
  })
  it('falha no download → silêncio', async () => {
    const { a, plugin } = montar()
    plugin.download.mockRejectedValueOnce(new Error('timeout'))
    expect((await a.verificar()).motivo).toBe('rede')
    expect(plugin.next).not.toHaveBeenCalled()
  })
  it('no máximo 1 consulta a cada 30 min', async () => {
    const { a, buscarManifesto, avancar } = montar({ rede: false })
    await a.verificar()
    avancar(INTERVALO_MS - 1)
    expect((await a.verificar()).motivo).toBe('intervalo')
    expect(buscarManifesto).toHaveBeenCalledTimes(1)
    avancar(1)
    await a.verificar()
    expect(buscarManifesto).toHaveBeenCalledTimes(2)
  })
  it('versão igual à atual → não baixa', async () => {
    const { a, plugin } = montar({ manifestoPublicado: manifesto({ versao: '202609281000-0000000' }) })
    expect((await a.verificar()).motivo).toBe('mesma-versao')
    expect(plugin.download).not.toHaveBeenCalled()
  })
})

describe('Contrato do APK embutido', () => {
  const cfg = JSON.parse(readFileSync(join(process.cwd(), 'capacitor.config.json'), 'utf8'))
  it('capacitor.config.json NÃO tem server.url (telas embutidas, não moldura do site)', () => {
    expect(cfg.server?.url).toBeUndefined()
    expect(cfg.webDir).toBe('dist')
    expect(cfg.server?.androidScheme).toBe('https')
  })
  it('updater em modo manual e sem falar com a Capgo', () => {
    const u = cfg.plugins.CapacitorUpdater
    expect(u.autoUpdate).toBe(false)
    expect(u.updateUrl).toBe('')
    expect(u.statsUrl).toBe('')
    expect(u.channelUrl).toBe('')
  })
})
