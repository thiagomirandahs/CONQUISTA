// Vigia do index.html (public/vigia-abertura.js): se o app NÃO iniciar em 15 s, a abertura oferece
// "Tentar de novo" em vez de girar para sempre (fase 7). O app marca window.__cqIniciou ao começar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const codigo = readFileSync(resolve(raiz, 'public/vigia-abertura.js'), 'utf8')
const html = readFileSync(resolve(raiz, 'index.html'), 'utf8')
const main = readFileSync(resolve(raiz, 'src/main.jsx'), 'utf8')

function abertura() {
  document.body.innerHTML = '<div id="abertura"><div class="ab-barra"><i></i></div></div><div id="root"></div>'
  delete window.__cqIniciou
}
const rodar = () => new Function(codigo)()

beforeEach(() => { vi.useFakeTimers(); abertura() })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; delete window.__cqIniciou })

describe('vigia da abertura', () => {
  it('app NÃO iniciou em 15 s → mostra o aviso e o botão "Tentar de novo"', () => {
    rodar()
    vi.advanceTimersByTime(14999)
    expect(document.querySelector('.ab-problema')).toBeNull()
    vi.advanceTimersByTime(2)
    const caixa = document.querySelector('[data-testid="vigia-abertura"]')
    expect(caixa).not.toBeNull()
    expect(caixa.textContent).toContain('Não deu para abrir agora')
    expect(caixa.querySelector('button').textContent).toBe('Tentar de novo')
    expect(document.querySelector('.ab-barra').style.display).toBe('none')
  })

  it('app iniciou → o vigia não faz nada', () => {
    rodar()
    window.__cqIniciou = true
    vi.advanceTimersByTime(60000)
    expect(document.querySelector('.ab-problema')).toBeNull()
  })

  it('abertura já removida pelo app → não quebra nem recria nada', () => {
    rodar()
    document.getElementById('abertura').remove()
    expect(() => vi.advanceTimersByTime(60000)).not.toThrow()
    expect(document.querySelector('.ab-problema')).toBeNull()
  })

  it('não duplica o aviso se rodar duas vezes', () => {
    rodar(); rodar()
    vi.advanceTimersByTime(15001)
    expect(document.querySelectorAll('.ab-problema')).toHaveLength(1)
  })
})

describe('ligação com o app', () => {
  it('index.html carrega o vigia ANTES do app, do mesmo domínio (sem script inline novo)', () => {
    const i = html.indexOf('/vigia-abertura.js'); const j = html.indexOf('/src/main.jsx')
    expect(i).toBeGreaterThan(0)
    expect(i).toBeLessThan(j)
    expect(html).toMatch(/<script src="\/vigia-abertura\.js"><\/script>/)
  })
  it('main.jsx marca que iniciou ANTES de montar o React', () => {
    expect(main.indexOf('window.__cqIniciou = true')).toBeGreaterThan(0)
    expect(main.indexOf('window.__cqIniciou = true')).toBeLessThan(main.indexOf('ReactDOM.createRoot'))
  })
})
