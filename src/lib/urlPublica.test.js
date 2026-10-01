import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { urlPublicaDoApp, origemPublicaDoApp, URL_PUBLICA_APP } from './dominios.js'
import { montarLinkConvite } from './convite.js'
import { montarLinkCoordenacao } from '../services/hierarquia.js'
import { qrSvg } from './qr.js'

const loc = (hostname, { protocol = 'https:', port = '' } = {}) => ({ hostname, protocol, port, host: port ? `${hostname}:${port}` : hostname })
const PROIBIDOS = /localhost|127\.0\.0\.1|capacitor:\/\/|ionic:\/\/|file:\/\//i

afterEach(() => { delete globalThis.Capacitor; vi.unstubAllEnvs() })

const apk = () => { globalThis.Capacitor = { isNativePlatform: () => true } }

describe('urlPublicaDoApp', () => {
  it('APK simulado (host localhost): tudo começa com o app de produção, sem localhost', () => {
    apk()
    for (const l of [loc('localhost', { protocol: 'http:' }), loc('localhost', { protocol: 'https:' }), loc('', { protocol: 'capacitor:' }), loc('localhost', { protocol: 'file:' })]) {
      const inscricao = urlPublicaDoApp('/entrar?codigo=AB12', l)
      const convite = montarLinkConvite(origemPublicaDoApp(l), 'a'.repeat(48))
      const coord = montarLinkCoordenacao(origemPublicaDoApp(l), 'tok')
      const verificar = urlPublicaDoApp('/verificar/xyz', l)
      for (const u of [inscricao, convite, coord, verificar]) {
        expect(u.startsWith('https://app.desbravaclube.com.br/')).toBe(true)
        expect(u).not.toMatch(PROIBIDOS)
      }
      expect(inscricao).toBe('https://app.desbravaclube.com.br/entrar?codigo=AB12')
      expect(qrSvg(inscricao)).toContain('<svg')
    }
  })

  it('APK: VITE_URL_PUBLICA_APP https é respeitada; valor inseguro é ignorado', () => {
    apk()
    vi.stubEnv('VITE_URL_PUBLICA_APP', 'https://app.exemplo.com.br/')
    expect(urlPublicaDoApp('/entrar', loc('localhost', { protocol: 'http:' }))).toBe('https://app.exemplo.com.br/entrar')
    vi.stubEnv('VITE_URL_PUBLICA_APP', 'http://localhost:5173')
    expect(urlPublicaDoApp('/entrar', loc('localhost', { protocol: 'http:' }))).toBe(`${URL_PUBLICA_APP}/entrar`)
  })

  it('web/PWA em app.desbravaclube.com.br usa a própria origem', () => {
    expect(urlPublicaDoApp('/entrar?codigo=X', loc('app.desbravaclube.com.br'))).toBe('https://app.desbravaclube.com.br/entrar?codigo=X')
  })

  it('site público (desbravaclube.com.br / www) aponta para o app', () => {
    expect(urlPublicaDoApp('/entrar?codigo=X', loc('desbravaclube.com.br'))).toBe('https://app.desbravaclube.com.br/entrar?codigo=X')
    expect(urlPublicaDoApp('/cadastro', loc('www.desbravaclube.com.br'))).toBe('https://app.desbravaclube.com.br/cadastro')
  })

  it('desenvolvimento continua na origem atual (localhost, app.localhost, preview Vercel)', () => {
    expect(urlPublicaDoApp('/entrar', loc('localhost', { protocol: 'http:', port: '5173' }))).toBe('http://localhost:5173/entrar')
    expect(urlPublicaDoApp('/entrar', loc('127.0.0.1', { protocol: 'http:', port: '5173' }))).toBe('http://127.0.0.1:5173/entrar')
    expect(urlPublicaDoApp('/entrar', loc('app.localhost', { protocol: 'http:', port: '5173' }))).toBe('http://app.localhost:5173/entrar')
    expect(urlPublicaDoApp('/entrar', loc('meu-app-git-x.vercel.app'))).toBe('https://meu-app-git-x.vercel.app/entrar')
  })

  it('copiar, compartilhar e QR usam a mesma URL (mesma função, mesma entrada)', () => {
    apk()
    const l = loc('localhost', { protocol: 'http:' })
    const a = urlPublicaDoApp('/entrar?codigo=Z9', l)
    const b = urlPublicaDoApp('/entrar?codigo=Z9', l)
    expect(a).toBe(b)
    expect(qrSvg(a)).toBe(qrSvg(b))
  })
})

describe('contrato: sem origin da janela em link compartilhável', () => {
  const raiz = path.resolve(__dirname, '..')
  const arquivos = []
  const varrer = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) varrer(p)
      else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) arquivos.push(p)
    }
  }
  varrer(raiz)
  // Único uso legítimo: origem do player do YouTube (parâmetro `origin` do iframe, não é link).
  const PERMITIDOS = ['PlayerAudio.jsx', 'dominios.js'] // dominios.js só cita no comentário

  it('nenhum arquivo de src/ usa location.origin fora do helper', () => {
    const achados = arquivos.filter((f) => !PERMITIDOS.some((p) => f.endsWith(p)) && /location\.origin/.test(fs.readFileSync(f, 'utf8')))
    expect(achados.map((f) => path.relative(raiz, f))).toEqual([])
  })
})
