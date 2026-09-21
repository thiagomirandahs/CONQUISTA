import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, it, expect } from 'vitest'
import { FERRAMENTAS, PAPEIS_POR_ROTA, RECURSO_POR_ROTA } from './permissoes.js'
import { RECURSOS_PADRAO } from './clube.js'

// Trava, no CI, as decisões da camada de produto multi-clube: o app pergunta ao ClubeContext (vínculo no clube em uso), nunca ao perfil
// global, e não conhece nenhum clube pelo nome. Se um destes testes falhar, alguém reintroduziu uma suposição de "clube único".
const RAIZ = join(process.cwd(), 'src')

function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho]
  })
}
const codigo = arquivos(RAIZ)
  .filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.(js|jsx)$/.test(f))
  .map((f) => ({ arquivo: relative(RAIZ, f).split(sep).join('/'), texto: readFileSync(f, 'utf8') }))
const ler = (rel) => readFileSync(join(RAIZ, rel), 'utf8')

describe('o app não assume papel nem unidade GLOBAIS do perfil', () => {
  it('nenhum arquivo lê profile.papel / profile?.papel (o papel é do VÍNCULO: useClube().papel)', () => {
    const achados = codigo.filter((c) => /\bprofile\??\.papel\b/.test(c.texto)).map((c) => c.arquivo)
    expect(achados).toEqual([])
  })
  it('nenhum arquivo lê profile.unidade_id / profile?.unidade_id (a unidade é do vínculo: useClube().unidadeId)', () => {
    const achados = codigo.filter((c) => /\bprofile\??\.unidade_id\b/.test(c.texto)).map((c) => c.arquivo)
    expect(achados).toEqual([])
  })
  it('a varredura enxerga o código (não passa no vazio)', () => {
    expect(codigo.length).toBeGreaterThan(80)
    expect(codigo.some((c) => c.arquivo === 'pages/Chat.jsx')).toBe(true)
  })
  it('o papel e a unidade vêm do contexto nas telas que precisam deles', () => {
    for (const tela of ['pages/Gestao.jsx', 'pages/Chat.jsx', 'pages/Leilao.jsx', 'components/Duelos.jsx', 'pages/Apontamentos.jsx', 'pages/Perfil.jsx']) {
      expect(ler(tela), tela).toMatch(/useClube\(\)/)
    }
  })
})

describe('o app não conhece nenhum clube pelo nome', () => {
  it('"Filhos da Conquista", o lema e o ano do Tenant 001 só existem em lib/marca.js (a MARCA_LEGADA de compatibilidade)', () => {
    const achados = codigo
      .filter((c) => c.arquivo !== 'lib/marca.js')
      .filter((c) => /Filhos da Conquista|Desbravadores · 1994|Desde 1994|icon-192/.test(c.texto))
      .map((c) => c.arquivo)
    expect(achados).toEqual([])
  })
  it('as telas que mostram a marca leem do contexto (menu, login, logo)', () => {
    expect(ler('components/AppLayout.jsx')).toMatch(/marca\.nome/)
    expect(ler('pages/Login.jsx')).toMatch(/marca\.nome/)
    expect(ler('components/Logo.jsx')).toMatch(/marca\.logoUrl/)
  })
  it('as cores do tema aceitam a marca do clube (e sem marca ficam as de sempre)', () => {
    const css = ler('index.css')
    expect(css).toMatch(/--c-brand:\s*var\(--marca-1, #3b5bfd\)/)
    expect(css).toMatch(/--c-brand2:\s*var\(--marca-2, #12c6ff\)/)
    expect(css).toMatch(/--c-brand:\s*var\(--marca-1-dark, #5f7bff\)/)
  })
})

describe('recursos (feature flags) e rotas', () => {
  const app = ler('App.jsx')
  const rotaDe = (caminho) => app.match(new RegExp(`<Route path="${caminho}" element=\\{([^\\n]*)\\} />`))?.[1] || ''

  it('todo recurso citado na matriz existe no catálogo', () => {
    for (const [rota, recurso] of Object.entries(RECURSO_POR_ROTA)) {
      expect(Object.keys(RECURSOS_PADRAO), `${rota} -> ${recurso}`).toContain(recurso)
    }
  })
  it('toda rota com recurso está PROTEGIDA em App.jsx (RecursoOpcional para telas abertas; RotaRestrita para ferramentas)', () => {
    for (const [rota, recurso] of Object.entries(RECURSO_POR_ROTA)) {
      const el = rotaDe(rota)
      expect(el, `rota ${rota} não encontrada em App.jsx`).not.toBe('')
      const guardada = el.includes(`<RecursoOpcional recurso="${recurso}">`) || el.includes('<RotaRestrita>')
      expect(guardada, `${rota} deveria exigir o recurso "${recurso}"`).toBe(true)
    }
  })
  it('toda ferramenta da Gestão tem rota embrulhada em RotaRestrita', () => {
    for (const f of FERRAMENTAS) {
      expect(rotaDe(f.to), f.to).toContain('<RotaRestrita>')
    }
  })
  it('a ferramenta de identidade e recursos existe e é da liderança', () => {
    expect(PAPEIS_POR_ROTA['/clube']).toEqual(['diretoria', 'instrutor'])
  })
})

describe('montagem do app', () => {
  it('o ClubeProvider é montado DENTRO do AuthProvider (precisa da sessão) e envolve o App', () => {
    const main = ler('main.jsx')
    const a = main.indexOf('<AuthProvider>')
    const c = main.indexOf('<ClubeProvider>')
    const app = main.indexOf('<App />')
    expect(a).toBeGreaterThan(-1)
    expect(c).toBeGreaterThan(a)
    expect(app).toBeGreaterThan(c)
  })
  it('só entra no app quem passa pelo porteiro do clube (ClubeGuard dentro do Protegido)', () => {
    expect(ler('App.jsx')).toMatch(/<ClubeGuard>\{children\}<\/ClubeGuard>/)
  })
  it('o contexto antigo de recursos saiu (uma fonte só)', () => {
    expect(existsSync(join(RAIZ, 'context', 'Recursos.jsx'))).toBe(false)
    expect(codigo.filter((c) => /useRecursos|RecursosProvider/.test(c.texto)).map((c) => c.arquivo)).toEqual([])
  })
})
