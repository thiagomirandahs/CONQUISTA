import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PAPEIS, RECURSOS_PADRAO, permissoesDoPapel, rotaInicial, CAMINHOS_DO_RESPONSAVEL,
  normalizarContexto, normalizarVinculo, contextoLegado, escolherClubeAtual, podeTrocarPara, temRecursoNoVinculo,
  lerClubePreferido, guardarClubePreferido, esquecerClubePreferido,
} from './clube.js'
import { MARCA_LEGADA } from './marca.js'

// vínculo como o servidor entrega (snake_case)
const vinc = (o = {}) => ({
  club_id: 'A', nome: 'Clube A', slug: 'a', papel: 'desbravador', status: 'ativo', selecionavel: true,
  unidade_id: 'u1', unidade_nome: 'Águias', marca: { nome: 'Clube A', sigla: 'CA' }, recursos: { chat: true, leilao: false }, ...o,
})

describe('permissoesDoPapel: a fonte única dos grupos que as telas repetiam', () => {
  it('responsável (pais): nada de gestão; só o portal do filho', () => {
    const p = permissoesDoPapel('pais')
    expect(p).toMatchObject({ ehPais: true, podeGerir: false, podeFinanceiro: false, temGestao: false, ehMembroAtivo: false, ehDiretoria: false })
  })
  it('desbravador e conselheiro: membros ativos; conselheiro vê a Gestão mas não gere', () => {
    expect(permissoesDoPapel('desbravador')).toMatchObject({ ehMembroAtivo: true, temGestao: false, podeGerir: false })
    expect(permissoesDoPapel('conselheiro')).toMatchObject({ ehMembroAtivo: true, temGestao: true, podeGerir: false, ehConselheiro: true })
  })
  it('instrutor e diretoria gerem; só a diretoria é "diretoria"', () => {
    expect(permissoesDoPapel('instrutor')).toMatchObject({ podeGerir: true, ehDiretoria: false, temGestao: true, ehLiderancaChat: true })
    expect(permissoesDoPapel('diretoria')).toMatchObject({ podeGerir: true, ehDiretoria: true, podeFinanceiro: true })
  })
  it('tesoureiro: financeiro e gestão, mas NÃO gere o clube', () => {
    expect(permissoesDoPapel('tesoureiro')).toMatchObject({ podeFinanceiro: true, podeGerir: false, temGestao: true })
  })
  it('sem papel (sem vínculo ativo) = NADA (falha fechada); papel desconhecido também', () => {
    for (const nada of [null, undefined, '', 'admin', 'root']) {
      const p = permissoesDoPapel(nada)
      expect(Object.entries(p).filter(([k, v]) => k !== 'papel' && v === true)).toEqual([])
    }
  })
  it('os grupos são exatamente os que as telas usavam (matriz completa)', () => {
    const esperado = {
      desbravador: [], conselheiro: ['temGestao'], instrutor: ['podeGerir', 'temGestao'], diretoria: ['podeGerir', 'podeFinanceiro', 'temGestao'],
      tesoureiro: ['podeFinanceiro', 'temGestao'], pais: [],
    }
    for (const papel of PAPEIS) {
      const p = permissoesDoPapel(papel)
      const ligados = ['podeGerir', 'podeFinanceiro', 'temGestao'].filter((k) => p[k])
      expect(ligados.sort(), papel).toEqual([...esperado[papel]].sort())
    }
  })
  it('rota inicial: responsável no portal do filho; os demais no ranking', () => {
    expect(rotaInicial('pais')).toBe('/meu-filho')
    for (const papel of PAPEIS.filter((p) => p !== 'pais')) expect(rotaInicial(papel)).toBe('/ranking')
    expect(CAMINHOS_DO_RESPONSAVEL).toEqual(['/meu-filho', '/perfil'])
  })
})

describe('normalizarContexto (resposta de meu_contexto)', () => {
  it('um clube: vínculo com papel, unidade, marca e recursos', () => {
    const c = normalizarContexto({ usuario_id: 'u', clube_atual_id: 'A', vinculos: [vinc()] })
    expect(c.vinculos).toHaveLength(1)
    expect(c.servidorClubeId).toBe('A')
    expect(c.vinculos[0]).toMatchObject({ clubeId: 'A', papel: 'desbravador', status: 'ativo', selecionavel: true, unidadeId: 'u1', unidadeNome: 'Águias' })
    expect(c.vinculos[0].marca).toMatchObject({ nome: 'Clube A', sigla: 'CA' })
    expect(c.vinculos[0].recursos).toEqual({ chat: true, leilao: false })
    expect(c.legado).toBe(false)
  })
  it('papel fora do vocabulário vira SEM papel (nunca um papel inventado)', () => {
    expect(normalizarVinculo(vinc({ papel: 'superadmin' })).papel).toBeNull()
  })
  it('recurso só vale se for exatamente true', () => {
    const v = normalizarVinculo(vinc({ recursos: { a: true, b: 'true', c: 1, d: false, e: null } }))
    expect(v.recursos).toEqual({ a: true, b: false, c: false, d: false, e: false })
  })
  it('lixo/ausência não quebra: sem vínculos', () => {
    for (const lixo of [null, undefined, 3, 'x', {}, { vinculos: 'x' }, { vinculos: [null, {}] }]) {
      expect(normalizarContexto(lixo).vinculos).toEqual([])
    }
  })
  it('a marca sem nome usa o nome do vínculo (nunca a marca do Tenant 001)', () => {
    const v = normalizarVinculo(vinc({ nome: 'Clube Z', marca: {} }))
    expect(v.marca.nome).toBe('Clube Z')
  })
})

describe('escolherClubeAtual', () => {
  const A = normalizarVinculo(vinc({ club_id: 'A' }))
  const B = normalizarVinculo(vinc({ club_id: 'B', selecionavel: true }))
  const Bnao = normalizarVinculo(vinc({ club_id: 'B', selecionavel: false }))
  const pendente = normalizarVinculo(vinc({ club_id: 'P', status: 'pendente', selecionavel: false }))

  it('um clube: é ele', () => {
    expect(escolherClubeAtual({ vinculos: [A], servidorClubeId: 'A', preferidoId: null })).toBe('A')
  })
  it('vários clubes: a escolha guardada vale se ainda for utilizável', () => {
    expect(escolherClubeAtual({ vinculos: [A, B], servidorClubeId: 'A', preferidoId: 'B' })).toBe('B')
  })
  it('vários clubes sem escolha: o clube em que o SERVIDOR age', () => {
    expect(escolherClubeAtual({ vinculos: [A, B], servidorClubeId: 'B', preferidoId: null })).toBe('B')
  })
  it('a escolha guardada de um clube que NÃO é mais utilizável é ignorada (cai no do servidor)', () => {
    expect(escolherClubeAtual({ vinculos: [A, Bnao], servidorClubeId: 'A', preferidoId: 'B' })).toBe('A')
  })
  it('a escolha guardada de um clube SEM vínculo é ignorada', () => {
    expect(escolherClubeAtual({ vinculos: [A], servidorClubeId: 'A', preferidoId: 'clube-alheio' })).toBe('A')
  })
  it('só vínculo pendente/suspenso: nenhum clube em uso (sem acesso "por padrão")', () => {
    expect(escolherClubeAtual({ vinculos: [pendente], servidorClubeId: null, preferidoId: 'P' })).toBeNull()
  })
  it('sem vínculos: nenhum clube', () => {
    expect(escolherClubeAtual({ vinculos: [], servidorClubeId: null, preferidoId: null })).toBeNull()
    expect(escolherClubeAtual({ vinculos: undefined, servidorClubeId: 'A', preferidoId: 'A' })).toBeNull()
  })
})

describe('podeTrocarPara: trocar de clube nunca vira acesso a clube sem vínculo', () => {
  const A = normalizarVinculo(vinc({ club_id: 'A' }))
  const Bnao = normalizarVinculo(vinc({ club_id: 'B', selecionavel: false }))
  const susp = normalizarVinculo(vinc({ club_id: 'S', status: 'suspenso', selecionavel: false }))
  it('vínculo ativo e selecionável: ok', () => { expect(podeTrocarPara([A], 'A')).toEqual({ ok: true }) })
  it('clube sem vínculo: recusado', () => { expect(podeTrocarPara([A], 'X')).toEqual({ ok: false, motivo: 'sem_vinculo' }) })
  it('vínculo suspenso/pendente: recusado', () => { expect(podeTrocarPara([A, susp], 'S')).toEqual({ ok: false, motivo: 'vinculo_inativo' }) })
  it('vínculo ativo, mas o servidor ainda não age nesse clube: indisponível', () => { expect(podeTrocarPara([A, Bnao], 'B')).toEqual({ ok: false, motivo: 'indisponivel' }) })
  it('lista vazia/indefinida: recusado', () => {
    expect(podeTrocarPara([], 'A').ok).toBe(false)
    expect(podeTrocarPara(undefined, 'A').ok).toBe(false)
  })
})

describe('temRecursoNoVinculo', () => {
  it('só com vínculo ATIVO e o recurso ligado', () => {
    const ativo = normalizarVinculo(vinc())
    expect(temRecursoNoVinculo(ativo, 'chat')).toBe(true)
    expect(temRecursoNoVinculo(ativo, 'leilao')).toBe(false)
    expect(temRecursoNoVinculo(ativo, 'nao-existe')).toBe(false)
    expect(temRecursoNoVinculo(normalizarVinculo(vinc({ status: 'pendente' })), 'chat')).toBe(false)
    expect(temRecursoNoVinculo(null, 'chat')).toBe(false)
  })
})

describe('contextoLegado (front publicado ANTES do SQL)', () => {
  it('perfil ativo: 1 vínculo do Tenant 001 com o papel e a unidade do perfil, marca legada e recursos como sempre', () => {
    const c = contextoLegado({ perfil: { id: 'u', papel: 'instrutor', unidade_id: 'u9', status: 'ativo' }, recursos: { leilao: true } })
    expect(c.legado).toBe(true)
    expect(c.vinculos).toHaveLength(1)
    expect(c.vinculos[0]).toMatchObject({ papel: 'instrutor', unidadeId: 'u9', status: 'ativo', selecionavel: true })
    expect(c.vinculos[0].marca.nome).toBe(MARCA_LEGADA.nome)
    expect(c.vinculos[0].recursos.leilao).toBe(true)
    expect(c.vinculos[0].recursos.chat).toBe(true)       // o app antigo sempre teve os módulos
  })
  it('leilão vem desligado quando o banco antigo não o liga (mesma regra de antes)', () => {
    expect(contextoLegado({ perfil: { id: 'u', papel: 'desbravador', status: 'ativo' }, recursos: {} }).vinculos[0].recursos.leilao).toBe(false)
  })
  it('perfil não ativo: vínculo pendente, sem papel utilizável', () => {
    const c = contextoLegado({ perfil: { id: 'u', papel: 'diretoria', status: 'pendente' }, recursos: {} })
    expect(c.vinculos[0]).toMatchObject({ status: 'pendente', selecionavel: false })
    expect(escolherClubeAtual({ vinculos: c.vinculos, servidorClubeId: c.servidorClubeId, preferidoId: null })).toBeNull()
  })
  it('sem perfil: sem vínculos', () => {
    expect(contextoLegado({ perfil: null, recursos: {} }).vinculos).toEqual([])
  })
  it('papel desconhecido no perfil vira sem papel', () => {
    expect(contextoLegado({ perfil: { id: 'u', papel: 'zzz', status: 'ativo' }, recursos: {} }).vinculos[0].papel).toBeNull()
  })
})

describe('escolha guardada por usuário', () => {
  beforeEach(() => { localStorage.clear() })
  it('guarda e lê para o MESMO usuário', () => {
    guardarClubePreferido('u1', 'B')
    expect(lerClubePreferido('u1')).toBe('B')
  })
  it('outro usuário no mesmo aparelho NÃO herda a escolha', () => {
    guardarClubePreferido('u1', 'B')
    expect(lerClubePreferido('u2')).toBeNull()
  })
  it('esquecer e lixo => null', () => {
    guardarClubePreferido('u1', 'B'); esquecerClubePreferido()
    expect(lerClubePreferido('u1')).toBeNull()
    localStorage.setItem('cq.clube.v1', '{lixo')
    expect(lerClubePreferido('u1')).toBeNull()
  })
})

describe('catálogo de recursos: o espelho do front não se afasta do banco', () => {
  it('as chaves e os padrões de RECURSOS_PADRAO são exatamente as do catálogo da migration', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20260921000033_contexto-do-clube.sql'), 'utf8')
    const bloco = sql.slice(sql.indexOf('insert into public.recursos_catalogo'), sql.indexOf('on conflict (chave)'))
    const linhas = [...bloco.matchAll(/\('([a-z0-9_]+)',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*(true|false),/g)].map((m) => [m[1], m[2] === 'true'])
    expect(linhas.length).toBeGreaterThanOrEqual(12)
    expect(Object.fromEntries(linhas)).toEqual({ ...RECURSOS_PADRAO })
  })
})
