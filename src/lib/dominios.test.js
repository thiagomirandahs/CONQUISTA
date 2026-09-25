import { describe, it, expect } from 'vitest'
import { modoDoHost, urlDoApp, urlDoSite, rotaDoSite } from './dominios.js'

const loc = (hostname, port = '', protocol = 'https:') => ({ hostname, port, protocol })

describe('modoDoHost', () => {
  it.each([
    ['desbravaclube.com.br', 'site'], ['www.desbravaclube.com.br', 'site'], ['WWW.DesbravaClube.com.br', 'site'],
    ['app.desbravaclube.com.br', 'app'], ['site.localhost', 'site'], ['app.localhost', 'app'],
    ['localhost', 'unico'], ['conquista.vercel.app', 'unico'], ['127.0.0.1', 'unico'], ['', 'unico'],
  ])('%s → %s', (host, modo) => expect(modoDoHost(host)).toBe(modo))
})

describe('urlDoApp / urlDoSite', () => {
  it('do site oficial (raiz ou www) vai para app.desbravaclube.com.br, preservando caminho e parâmetros', () => {
    expect(urlDoApp('/criar-clube?plano=anual&ciclo=anual', loc('desbravaclube.com.br')))
      .toBe('https://app.desbravaclube.com.br/criar-clube?plano=anual&ciclo=anual')
    expect(urlDoApp('/login', loc('www.desbravaclube.com.br'))).toBe('https://app.desbravaclube.com.br/login')
  })
  it('do app volta para a raiz do site oficial', () => {
    expect(urlDoSite('/adquirir', loc('app.desbravaclube.com.br'))).toBe('https://desbravaclube.com.br/adquirir')
  })
  it('teste local: site.localhost ↔ app.localhost, mantendo porta e protocolo', () => {
    expect(urlDoApp('/login', loc('site.localhost', '5173', 'http:'))).toBe('http://app.localhost:5173/login')
    expect(urlDoSite('/', loc('app.localhost', '5173', 'http:'))).toBe('http://site.localhost:5173/')
  })
  it('fora do modo dividido (localhost, preview, APK) o caminho continua relativo', () => {
    expect(urlDoApp('/login', loc('localhost', '5173', 'http:'))).toBe('/login')
    expect(urlDoSite('/adquirir', loc('conquista.vercel.app'))).toBe('/adquirir')
    expect(urlDoApp('/login', loc('app.desbravaclube.com.br'))).toBe('/login')
  })
})

describe('rotaDoSite', () => {
  it.each([['/', true], ['/planos', true], ['/adquirir', true], ['/verificar/abc123', true],
    ['/login', false], ['/criar-clube', false], ['/admin', false], ['/inicio', false], ['/verificar', false]])(
    '%s → %s', (c, v) => expect(rotaDoSite(c)).toBe(v))
})

describe('Gestão → Pessoas: Inscrições vem antes de Aprovações', async () => {
  const { FERRAMENTAS } = await import('./permissoes.js')
  it('ordem do grupo Pessoas', () => {
    const pessoas = FERRAMENTAS.filter((f) => f.grupo === 'pessoas').map((f) => f.titulo)
    expect(pessoas).toEqual(['Inscrições', 'Aprovações', 'Apontamentos', 'Usuários', 'Radar de faltas', 'Vínculos dos pais'])
  })
  it('Inscrições é só da liderança (desbravador e responsável não veem)', () => {
    const ins = FERRAMENTAS.find((f) => f.to === '/gestao/inscricoes')
    expect(ins.papeis).toEqual(['diretoria', 'instrutor'])
    expect(ins.desc).toBe('Link e QR Code para novos membros')
  })
})
