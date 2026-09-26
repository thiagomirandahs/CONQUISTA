import { describe, it, expect } from 'vitest'
import { hrefExterno } from './urlSegura'
import { guardarRetorno, lerRetorno, retornoDaUrl } from './retornoPosLogin'

describe('hrefExterno', () => {
  it('aceita http(s)', () => {
    expect(hrefExterno('https://exemplo.test/a?b=1')).toBe('https://exemplo.test/a?b=1')
    expect(hrefExterno(' http://exemplo.test ')).toBe('http://exemplo.test/')
  })
  it('recusa esquemas perigosos e lixo', () => {
    for (const v of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', '/relativo', '', null, 42]) {
      expect(hrefExterno(v)).toBeNull()
    }
  })
})

describe('retorno pós-login (redirecionamento aberto)', () => {
  it('recusa barra invertida e controle, que o navegador transforma em outro domínio', () => {
    for (const v of ['/\\evil.test', '/\\/evil.test', '//evil.test', '/\t/evil.test', 'https://evil.test']) {
      expect(retornoDaUrl('?proximo=' + encodeURIComponent(v))).toBeNull()
    }
  })
  it('aceita caminho relativo normal', () => {
    expect(retornoDaUrl('?proximo=' + encodeURIComponent('/entrar?codigo=ABC'))).toBe('/entrar?codigo=ABC')
    guardarRetorno('/\\evil.test')
    expect(lerRetorno()).toBeNull()
  })
})
