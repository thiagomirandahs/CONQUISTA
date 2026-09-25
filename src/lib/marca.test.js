import { describe, it, expect, beforeEach } from 'vitest'
import {
  MARCA_LEGADA, marcaDaResposta, aplicarMarca, contrasteComBranco, CONTRASTE_MINIMO, COR_TEMA_PADRAO, esquecerMarcaSalva,
} from './marca.js'

function montarDocumento() {
  document.head.innerHTML = '<meta name="theme-color" content="#1e3a8a"><link rel="icon" href="/logo.png"><title>x</title>'
  document.documentElement.removeAttribute('style')
}

describe('marcaDaResposta: o servidor manda snake_case e campos ausentes', () => {
  it('converte para camelCase e preenche o que falta com null (nunca com a marca de OUTRO clube)', () => {
    const m = marcaDaResposta({ nome: 'Clube B', sigla: 'CB' })
    expect(m).toEqual({ nome: 'Clube B', sigla: 'CB', lema: null, descricao: null, desde: null, corPrimaria: null, corSecundaria: null, logoUrl: null })
  })
  it('lê todos os campos do Tenant 001 como o banco os entrega', () => {
    const m = marcaDaResposta({ nome: 'Filhos da Conquista', sigla: 'FC', lema: 'Desbravadores · 1994', descricao: 'Clube de Desbravadores · 1994', desde: 1994, logo_url: '/icon-192.png' })
    expect(m.lema).toBe('Desbravadores · 1994')
    expect(m.desde).toBe(1994)
    expect(m.logoUrl).toBe('/icon-192.png')
    expect(m.corPrimaria).toBeNull()
  })
  it('só aceita cor no formato #rrggbb (qualquer outra coisa vira "sem cor": nada de CSS vindo do servidor)', () => {
    expect(marcaDaResposta({ nome: 'x', cor_primaria: '#ABCDEF' }).corPrimaria).toBe('#abcdef')
    for (const ruim of ['red', '#12345', '#12345g', 'url(x)', '#111; background:red', 'rgb(1,2,3)', '', null, 12]) {
      expect(marcaDaResposta({ nome: 'x', cor_primaria: ruim, cor_secundaria: ruim }).corPrimaria).toBeNull()
    }
  })
  it('logo: só http(s) ou caminho do próprio app', () => {
    expect(marcaDaResposta({ nome: 'x', logo_url: 'https://p.supabase.co/storage/v1/object/public/publico/c/logo.png' }).logoUrl).toContain('https://')
    expect(marcaDaResposta({ nome: 'x', logo_url: '/icon-192.png' }).logoUrl).toBe('/icon-192.png')
    for (const ruim of ['javascript:alert(1)', 'data:image/png;base64,AAA', '//evil.test/x.png', 'ftp://x/y', '']) {
      expect(marcaDaResposta({ nome: 'x', logo_url: ruim }).logoUrl).toBeNull()
    }
  })
  it('resposta vazia/lixo não quebra: nome genérico, nunca "Filhos da Conquista"', () => {
    for (const lixo of [null, undefined, 42, 'x', []]) {
      const m = marcaDaResposta(lixo)
      expect(m.nome).toBe('Clube')
      expect(m.nome).not.toBe(MARCA_LEGADA.nome)
    }
  })
  it('sigla ausente vira a inicial do nome', () => {
    expect(marcaDaResposta({ nome: 'águias' }).sigla).toBe('Á')
  })
})

describe('contraste da cor da marca (o texto sobre ela é branco)', () => {
  it('preto = 21, branco = 1, e a cor padrão do app passa', () => {
    expect(contrasteComBranco('#000000')).toBeCloseTo(21, 0)
    expect(contrasteComBranco('#ffffff')).toBeCloseTo(1, 1)
    expect(contrasteComBranco('#3b5bfd')).toBeGreaterThanOrEqual(CONTRASTE_MINIMO)
    expect(contrasteComBranco(COR_TEMA_PADRAO)).toBeGreaterThan(8)
  })
  it('cor clara demais NÃO passa; entrada inválida vale 0', () => {
    expect(contrasteComBranco('#ffff00')).toBeLessThan(CONTRASTE_MINIMO)
    expect(contrasteComBranco('#f5c518')).toBeLessThan(CONTRASTE_MINIMO)
    expect(contrasteComBranco('amarelo')).toBe(0)
    expect(contrasteComBranco(null)).toBe(0)
  })
})

describe('aplicarMarca: escreve a marca na página', () => {
  beforeEach(montarDocumento)

  // Decisão de produto (25/09): a identidade GLOBAL é sempre DesbravaClube — título da aba, favicon e
  // cor da barra (o que o PWA instalado e a aba mostram). O clube empresta só as cores do tema.
  it('clube em uso NÃO troca título, cor da barra nem favicon: continuam DesbravaClube', () => {
    aplicarMarca({ nome: 'Clube B', sigla: 'CB', corPrimaria: '#112233', corSecundaria: null, logoUrl: 'https://p/x/logo.png' })
    expect(document.title).toBe('DesbravaClube')
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe(COR_TEMA_PADRAO)
    expect(document.querySelector('link[rel="icon"]').getAttribute('href')).toBe('/logo.png')
  })

  it('cores viram variáveis CSS; só a primária => a secundária é derivada dela (não a do outro clube)', () => {
    aplicarMarca({ nome: 'x', corPrimaria: '#112233', corSecundaria: null, logoUrl: null })
    const st = document.documentElement.style
    expect(st.getPropertyValue('--marca-1')).toBe('#112233')
    expect(st.getPropertyValue('--marca-2')).toContain('#112233')
    expect(st.getPropertyValue('--marca-1-dark')).toContain('#112233')
  })

  it('duas cores escolhidas: as duas valem como estão', () => {
    aplicarMarca({ nome: 'x', corPrimaria: '#112233', corSecundaria: '#aabbcc', logoUrl: null })
    expect(document.documentElement.style.getPropertyValue('--marca-2')).toBe('#aabbcc')
  })

  it('sem cor: REMOVE a sobrescrita (o tema padrão volta idêntico); identidade global intacta', () => {
    aplicarMarca({ nome: 'A', corPrimaria: '#112233', corSecundaria: '#aabbcc', logoUrl: 'https://p/x/logo.png' })
    aplicarMarca({ nome: 'B', corPrimaria: null, corSecundaria: null, logoUrl: null })
    const st = document.documentElement.style
    for (const v of ['--marca-1', '--marca-2', '--marca-1-dark', '--marca-2-dark']) expect(st.getPropertyValue(v)).toBe('')
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe(COR_TEMA_PADRAO)
    expect(document.querySelector('link[rel="icon"]').getAttribute('href')).toBe('/logo.png')
    expect(document.title).toBe('DesbravaClube')
  })

  it('trocar de clube não deixa resto da marca do anterior', () => {
    aplicarMarca({ nome: 'A', corPrimaria: '#112233', corSecundaria: '#aabbcc', logoUrl: null })
    aplicarMarca({ nome: 'B', corPrimaria: '#445566', corSecundaria: null, logoUrl: null })
    expect(document.documentElement.style.getPropertyValue('--marca-1')).toBe('#445566')
    expect(document.documentElement.style.getPropertyValue('--marca-2')).not.toContain('aabbcc')
  })

  // MUDOU NA 8.5 (item 1): sem marca, a identidade e a do PRODUTO. Este fallback era a marca do
  // Tenant 001, entao toda tela sem contexto de clube — a entrada, o primeiro quadro, o estado
  // "escolha um clube" — levava o nome de um cliente especifico.
  it('sem marca usa a do produto (sem contexto de clube, a identidade e DesbravaClube)', () => {
    aplicarMarca(null)
    expect(document.title).toBe('DesbravaClube')
  })
})

describe('cache da marca do clube (removido: a abertura é sempre DesbravaClube)', () => {
  beforeEach(() => { localStorage.clear() })
  it('esquecer apaga a chave que versões anteriores gravaram', () => {
    localStorage.setItem('cq.marca.v1', JSON.stringify({ uid: 'u1', clubeId: 'c1', marca: { nome: 'Clube B' } }))
    esquecerMarcaSalva()
    expect(localStorage.getItem('cq.marca.v1')).toBeNull()
  })
})

import { formularioDaMarca, diferencasDaMarca, errosDaMarca } from './marca.js'

describe('formulário de identidade', () => {
  const atual = marcaDaResposta({ nome: 'Clube B', sigla: 'CB', lema: 'Lema', desde: 2010, cor_primaria: '#112233', logo_url: 'https://p/x.png' })

  it('formularioDaMarca: tudo vira texto; ausente vira vazio', () => {
    expect(formularioDaMarca(atual)).toEqual({ nome: 'Clube B', sigla: 'CB', lema: 'Lema', descricao: '', desde: '2010', corPrimaria: '#112233', corSecundaria: '', logoUrl: 'https://p/x.png' })
    expect(formularioDaMarca(null).nome).toBe('')
  })

  it('diferencasDaMarca: só o que mudou, no formato do servidor', () => {
    const form = { ...formularioDaMarca(atual), nome: 'Clube B Oficial', corSecundaria: '#AABBCC' }
    expect(diferencasDaMarca(form, atual)).toEqual({ nome: 'Clube B Oficial', cor_secundaria: '#AABBCC' })
  })

  it('nada mudou => nada a enviar (não "congela" o padrão derivado do nome)', () => {
    expect(diferencasDaMarca(formularioDaMarca(atual), atual)).toEqual({})
  })

  it('campo esvaziado vira null (volta ao padrão); ano vira número', () => {
    const form = { ...formularioDaMarca(atual), lema: '', desde: '1999', logoUrl: '' }
    expect(diferencasDaMarca(form, atual)).toEqual({ lema: null, desde: 1999, logo_url: null })
  })

  it('espaços nas pontas não contam como mudança', () => {
    expect(diferencasDaMarca({ ...formularioDaMarca(atual), nome: '  Clube B  ' }, atual)).toEqual({})
  })

  it('errosDaMarca: as regras do servidor, antes de enviar', () => {
    const ok = formularioDaMarca(atual)
    expect(errosDaMarca(ok)).toEqual([])
    expect(errosDaMarca({ ...ok, nome: 'x' })).toHaveLength(1)
    expect(errosDaMarca({ ...ok, nome: 'a'.repeat(61) })).toHaveLength(1)
    expect(errosDaMarca({ ...ok, sigla: 'ABCDE' })).toHaveLength(1)
    expect(errosDaMarca({ ...ok, sigla: 'A B' })).toHaveLength(1)
    expect(errosDaMarca({ ...ok, lema: 'a'.repeat(81) })).toHaveLength(1)
    expect(errosDaMarca({ ...ok, descricao: 'a'.repeat(121) })).toHaveLength(1)
    expect(errosDaMarca({ ...ok, desde: '1500' })).toHaveLength(1)
    expect(errosDaMarca({ ...ok, desde: 'abcd' })).toHaveLength(1)
    expect(errosDaMarca({ ...ok, nome: '<b>oi</b>' })).toHaveLength(1)
  })

  it('errosDaMarca: cor fora do formato e cor CLARA demais (texto branco ilegível) são recusadas', () => {
    const ok = formularioDaMarca(atual)
    expect(errosDaMarca({ ...ok, corPrimaria: 'azul' })[0]).toMatch(/#rrggbb/)
    expect(errosDaMarca({ ...ok, corPrimaria: '#ffff00' })[0]).toMatch(/clara demais/)
    expect(errosDaMarca({ ...ok, corSecundaria: '#fefefe' })[0]).toMatch(/secundária.*clara demais/)
    expect(errosDaMarca({ ...ok, corPrimaria: '#1e3a8a', corSecundaria: '#3b5bfd' })).toEqual([])
  })

  it('a sigla aceita acento', () => {
    expect(errosDaMarca({ ...formularioDaMarca(atual), sigla: 'ÁG' })).toEqual([])
  })
})
