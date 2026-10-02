import { describe, it, expect } from 'vitest'
import { sanitizarTexto, sanitizarUrl, sanitizarRota, descreverErro, framesDoStack, montarContextoTecnico } from './sanitizarErro.js'

// Valores de TESTE com a forma dos segredos reais (nenhum é credencial de verdade).
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
const PUB = 'sb_publishable_AbCdEfGhIjKlMnOpQrStUv_0123456789'
const SEC = 'sb_secret_ZyXwVuTsRqPoNmLkJiHgFe_9876543210'
const ASSINADA = 'https://abc.supabase.co/storage/v1/object/sign/comprovacoes/pasta/foto.jpg?token=eyJabc.def.ghi&download=1'

const vazou = (saida, ...valores) => valores.forEach((v) => expect(saida).not.toContain(v))

describe('sanitizarTexto: segredos embutidos saem mascarados, nunca o valor', () => {
  it('JWT inteiro (3 partes) e eyJ solto', () => {
    const s = sanitizarTexto(`falhou com ${JWT} agora`)
    vazou(s, 'eyJhbGci', 'SflKxwRJ', 'eyJzdWIi')
    expect(s).toContain('[jwt]')
    vazou(sanitizarTexto('token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 sozinho'), 'eyJhbGci')
  })

  it('Authorization: Bearer e Basic', () => {
    const s = sanitizarTexto(`Authorization: Bearer ${JWT}`)
    vazou(s, 'eyJ', 'Bearer eyJ')
    vazou(sanitizarTexto('header Bearer abc123tokensecreto'), 'abc123tokensecreto')
    vazou(sanitizarTexto('Basic dXNlcjpwYXNzd29yZA=='), 'dXNlcjpwYXNzd29yZA')
    vazou(sanitizarTexto('{"Authorization":"Token xyz-segredo-123"}'), 'xyz-segredo-123')
  })

  it('chaves do Supabase: sb_publishable_, sb_secret_ e eyJ (anon/service_role)', () => {
    const s = sanitizarTexto(`apikey ${PUB} e ${SEC} e ${JWT}`)
    vazou(s, PUB, SEC, 'AbCdEfGh', 'ZyXwVu', 'eyJ')
    expect(s).toContain('[chave]')
  })

  it('query de URL some inteira: ?token=, ?apikey=, URL assinada do Storage', () => {
    const s = sanitizarTexto(`GET ${ASSINADA} falhou`)
    vazou(s, 'token=', 'eyJabc', 'download=1')
    expect(s).toContain('foto.jpg?[query]')
    vazou(sanitizarTexto('https://x.supabase.co/rest/v1/profiles?apikey=SEGREDOAPI&id=eq.7'), 'SEGREDOAPI', 'eq.7')
    vazou(sanitizarTexto('https://app.x.com/cb#access_token=abc123&refresh_token=def456'), 'abc123', 'def456')
    expect(sanitizarUrl('https://user:senha123@host.com/a?x=1')).toBe('https://host.com/a?[query]')
  })

  it('token no CAMINHO da URL (segmento longo ou uuid)', () => {
    vazou(sanitizarTexto('https://x.co/storage/v1/object/sign/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AB/arquivo'), 'AbCdEfGhIj')
    vazou(sanitizarTexto('https://x.co/storage/v1/object/11111111-2222-3333-4444-555555555555/foto.jpg'), '11111111-2222')
  })

  it('pares nome=valor fora de URL: token, senha, apikey, cookie (texto, JSON, formulário)', () => {
    vazou(sanitizarTexto('access_token=ABCSEGREDO1&x=2'), 'ABCSEGREDO1')
    vazou(sanitizarTexto('{"password":"minhaSenha!9","email":"a@b.com"}'), 'minhaSenha!9', 'a@b.com')
    vazou(sanitizarTexto('senha: 123456abc'), '123456abc')
    vazou(sanitizarTexto('refresh_token: r3fr3sh-v4lu3'), 'r3fr3sh-v4lu3')
    vazou(sanitizarTexto('apikey=SEGREDOAPI'), 'SEGREDOAPI')
  })

  it('cookies: o valor inteiro do cabeçalho (com ; e espaços) some', () => {
    const s = sanitizarTexto('Cookie: sb-access-token=AAA111; sb-refresh-token=BBB222; theme=dark')
    vazou(s, 'AAA111', 'BBB222', 'theme=dark')
    vazou(sanitizarTexto('Set-Cookie: sid=ZZZ999; HttpOnly; Secure'), 'ZZZ999')
  })

  it('dados pessoais por forma: e-mail, telefone, CPF, uuid', () => {
    vazou(sanitizarTexto('falhou para maria.silva@exemplo.com.br'), 'maria', 'exemplo')
    vazou(sanitizarTexto('ligar (11) 98765-4321'), '98765', '4321')
    vazou(sanitizarTexto('tel +55 11 98765-4321'), '98765')
    vazou(sanitizarTexto('CPF 123.456.789-09 inválido'), '123.456.789-09')
    vazou(sanitizarTexto('cpf 12345678909'), '12345678909')
    vazou(sanitizarTexto('perfil 11111111-2222-3333-4444-555555555555 não achado'), '11111111-2222')
  })

  it('valores entre aspas e Key (col)=(valor) do Postgres (citados:true)', () => {
    const s = sanitizarTexto('duplicate key: Key (email)=(joao@x.com) already exists; "Maria Souza" ja existe', 200, { citados: true })
    vazou(s, 'joao@x.com', 'Maria Souza')
    // identificador curto minúsculo (nome de coluna/etapa) continua legível
    expect(sanitizarTexto('Termine a etapa "revisao" antes', 100, { citados: true })).toContain('"revisao"')
  })

  it('sequências opacas longas (hex 16+, base64url 32+, MAIÚSCULAS 16+)', () => {
    vazou(sanitizarTexto('codigo 0123456789abcdef0123'), '0123456789abcdef')
    vazou(sanitizarTexto('7V8XC44WJ1NTYHMEK0ER abriu'), '7V8XC44WJ1NTYHMEK0ER')
    vazou(sanitizarTexto('x AbCdEfGhIjKlMnOpQrStUvWxYz012345_- y'), 'AbCdEfGhIjKlMnOpQrStUvWx')
  })

  it('mensagem enorme: trunca no limite (com reticências) e é rápida', () => {
    const t0 = Date.now()
    const s = sanitizarTexto('abc def '.repeat(200000), 100)
    expect(s.length).toBeLessThanOrEqual(100)
    expect(s.endsWith('…')).toBe(true)
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('texto normal e nomes de arquivo/linha de bundle não são destruídos', () => {
    expect(sanitizarTexto("Cannot read properties of undefined (reading 'map')")).toBe("Cannot read properties of undefined (reading 'map')")
    expect(sanitizarTexto('em Trilha-AbC123x.js:1:2345')).toBe('em Trilha-AbC123x.js:1:2345')
  })

  it('entradas esquisitas nunca lançam', () => {
    for (const v of [undefined, null, 0, NaN, {}, [], Symbol.iterator, () => 1, 12n]) {
      expect(() => sanitizarTexto(v)).not.toThrow()
    }
  })
})

describe('sanitizarRota', () => {
  it('sem query/fragmento; /verificar e /documento viram :token; segmento opaco some', () => {
    expect(sanitizarRota('/avaliar/abc?token=xyz#frag')).toBe('/avaliar/abc')
    expect(sanitizarRota('/documento/7V8XC44WJ1NTYHMEK0ER')).toBe('/documento/:token')
    expect(sanitizarRota('/verificar/qualquercoisa')).toBe('/verificar/:token')
    expect(sanitizarRota('/x/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AB')).toBe('/x/[segredo]')
    expect(sanitizarRota('/' + 'ab/'.repeat(100)).length).toBeLessThanOrEqual(120)
  })
})

describe('descreverErro: preserva nome, mensagem, stack (local) e cause', () => {
  it('Error comum: nome, mensagem e onde nasceu', () => {
    const e = new Error('Falhou ao somar')
    e.stack = 'Error: Falhou ao somar\n    at f (https://app.desbravaclube.com.br/assets/Trilha-AbC123.js:10:20)\n    at g (https://app.desbravaclube.com.br/assets/index-Zz9.js:3:4)'
    const d = descreverErro(e)
    expect(d.nome).toBe('Error')
    expect(d.mensagem).toBe('Falhou ao somar')
    expect(d.frames).toEqual(['Trilha-AbC123.js:10:20', 'index-Zz9.js:3:4'])
  })

  it('stack no formato Firefox/Safari (f@url:l:c)', () => {
    expect(framesDoStack('f@https://x.co/assets/A-1.js:5:6\ng@https://x.co/assets/B-2.js?v=1:7:8')).toEqual(['A-1.js:5:6', 'B-2.js:7:8'])
  })

  it('cause aninhado em várias camadas, em ordem, limitado a 3', () => {
    const c4 = new Error('quarta')
    const c3 = new Error('terceira', { cause: c4 })
    const c2 = new TypeError('segunda', { cause: c3 })
    const e = new Error('topo', { cause: c2 })
    const d = descreverErro(e)
    expect(d.causas.map((c) => c.mensagem)).toEqual(['segunda', 'terceira', 'quarta'])
    expect(d.causas[0].nome).toBe('TypeError')
  })

  it('cause circular não trava nem repete', () => {
    const a = new Error('a'); const b = new Error('b', { cause: a }); a.cause = b
    const d = descreverErro(a)
    expect(d.causas.length).toBeLessThanOrEqual(3)
    expect(d.causas.some((c) => c.nome === 'ciclo')).toBe(true)
  })

  it('objeto lançado com referência circular não lança', () => {
    const o = { message: 'boom', code: 'X1' }; o.self = o; o.cause = o
    expect(() => descreverErro(o)).not.toThrow()
    expect(descreverErro(o).mensagem).toBe('boom')
  })

  it('getters que explodem e Proxy hostil não derrubam', () => {
    const hostil = { get message() { throw new Error('nao leia') }, get stack() { throw new Error('nao leia') }, get name() { throw new Error('x') } }
    expect(() => descreverErro(hostil)).not.toThrow()
    const proxy = new Proxy({}, { get() { throw new Error('proxy') } })
    expect(() => descreverErro(proxy)).not.toThrow()
  })

  it('string lançada', () => {
    const d = descreverErro('algo deu errado para joana@x.com')
    expect(d.tipo).toBe('texto')
    expect(d.mensagem).toBe('algo deu errado para [e-mail]')
  })

  it('objeto lançado simples (sem Error)', () => {
    expect(descreverErro({ message: 'sem rede' }).mensagem).toBe('sem rede')
    expect(descreverErro({ foo: 1 }).mensagem).toBe('')
  })

  it('erro Supabase/PostgREST (code/message/details/hint): message preservada, valores mascarados', () => {
    const d = descreverErro({ code: '23505', message: 'duplicate key value violates unique constraint "membros_email_key"', details: 'Key (email)=(joao@x.com) already exists.', hint: null })
    expect(d.mensagem).toContain('duplicate key value violates unique constraint')
    vazou(d.mensagem, 'joao@x.com')
    // só details (sem message): usa details, mascarado
    vazou(descreverErro({ details: 'Key (email)=(joao@x.com) already exists.' }).mensagem, 'joao@x.com')
  })

  it('erro de fetch (TypeError: Failed to fetch) e AbortError', () => {
    const d = descreverErro(new TypeError('Failed to fetch'))
    expect(d.nome).toBe('TypeError')
    expect(d.mensagem).toBe('Failed to fetch')
    expect(descreverErro(new DOMException('The user aborted a request.', 'AbortError')).nome).toBe('AbortError')
  })

  it('mensagem do Error com segredo sai mascarada (message, cause e stack-sem-segredo)', () => {
    const e = new Error(`GET ${ASSINADA} -> 401 Authorization: Bearer ${JWT}`, { cause: new Error(`apikey=${PUB}`) })
    const d = descreverErro(e)
    vazou(JSON.stringify(d), 'eyJ', PUB, 'sb_publishable', 'token=', 'download=1')
  })

  it('Event (falha de recurso): só tipo e tag, nunca src', () => {
    const ev = new Event('error')
    Object.defineProperty(ev, 'target', { value: { tagName: 'IMG', src: 'https://x.co/a.png?token=SEGREDO' } })
    const d = descreverErro(ev)
    expect(d.nome).toBe('Evento:error:IMG')
    vazou(JSON.stringify(d), 'SEGREDO')
  })

  it('valores primitivos (número, undefined, null)', () => {
    expect(descreverErro(undefined).tipo).toBe('nenhum')
    expect(descreverErro(null).tipo).toBe('nenhum')
    expect(descreverErro(42).tipo).toBe('number')
  })
})

describe('montarContextoTecnico: cabe em 200 e prioriza o que acha o bug', () => {
  const base = { tipo: 'objeto', nome: 'TypeError', mensagem: "Cannot read properties of undefined (reading 'map')", frames: ['Trilha-AbC123.js:10:20', 'index-Zz9.js:3:4'], causas: [] }

  it('frase + Nome: mensagem + local', () => {
    const c = montarContextoTecnico('A tela quebrou e o app precisou se recuperar.', base)
    expect(c).toBe("A tela quebrou e o app precisou se recuperar. | TypeError: Cannot read properties of undefined (reading 'map') [Trilha-AbC123.js:10:20 < index-Zz9.js:3:4]")
    expect(c.length).toBeLessThanOrEqual(200)
  })

  it('mensagem gigante: trunca, mas o local (onde nasceu) sempre sobrevive', () => {
    const c = montarContextoTecnico('Frase', { ...base, mensagem: 'x '.repeat(500).trim() })
    expect(c.length).toBeLessThanOrEqual(200)
    expect(c).toContain('[Trilha-AbC123.js:10:20 < index-Zz9.js:3:4]')
    expect(c).toContain('…')
  })

  it('cause aparece quando cabe; some antes da mensagem quando não cabe', () => {
    const comCausa = { ...base, causas: [{ nome: 'Error', mensagem: 'raiz' }] }
    expect(montarContextoTecnico('F', comCausa)).toContain('<- Error: raiz')
    const longa = { ...comCausa, mensagem: 'm'.repeat(170) }
    const c = montarContextoTecnico('F', longa)
    expect(c.length).toBeLessThanOrEqual(200)
    expect(c).not.toContain('<- Error')
  })

  it('sem erro (undefined): só a frase', () => {
    expect(montarContextoTecnico('Não consegui salvar.', descreverErro(undefined))).toBe('Não consegui salvar.')
  })
})
