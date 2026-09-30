// Manifesto de Especialidades (fase 7): provas de cada rejeição do validador, do gerador determinístico e das travas
// contra conteúdo de teste em produção / conteúdo real antes da aprovação do dono.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { validarEspecialidades, carregarAreas, carregarTeste } from '../../supabase/especialidades-manifesto/validar.mjs'
import { gerarSql, montarPacote, ARQUIVO_FIXTURE } from '../../supabase/especialidades-manifesto/gerar-importacao.mjs'

const OFICIAL = 'https://www.adventistas.org/pt/desbravadores/especialidades/'
const WIKI = 'https://mda.wiki.br/Especialidade_de_Jardinagem_e_Horticultura'
const fonte = (o = {}) => ({ nome: 'Site oficial', url: OFICIAL, consultada_em: '2026-09-30', status: 'conferido', ...o })
const modelo = (campos) => ({ versao: 1, campos })
const conf = { chave: 'fiz', tipo: 'confirmacao', rotulo: 'Fiz', obrigatorio: true }
const req = (o = {}) => ({ ordem: 1, descricao: 'Texto conferido na fonte oficial.', tipo_evidencia: 'atividade', modelo: modelo([conf]), fonte_url: OFICIAL, status_fonte: 'conferido', ...o })
const esp = (o = {}) => ({ codigo: 'AA-002', nome: 'Jardinagem', nivel: 1, fonte_url: OFICIAL, estado: 'publicavel', requisitos: [req()], ...o })
const arq = (especialidades = [esp()], o = {}, nome = 'AA.json') => ({ arquivo: nome, dados: { formato: 'conquista.especialidades/2', versao: 1, area: 'AA', area_nome: 'Atividades Agrícolas', fonte: fonte(), especialidades, ...o } })
const erros = (...a) => validarEspecialidades(a).erros.join('\n')

describe('validador de especialidades (formato /2)', () => {
  it('aceita um arquivo correto', () => { expect(validarEspecialidades([arq()]).erros).toEqual([]) })
  it('"catalogo" (só nome/área) é válido e não precisa de requisito', () => {
    expect(validarEspecialidades([arq([esp({ estado: 'catalogo', requisitos: undefined })])]).erros).toEqual([])
  })

  describe('não se inventa requisito', () => {
    it('"publicavel" sem requisitos é recusado', () => { expect(erros(arq([esp({ requisitos: [] })]))).toMatch(/não se inventa requisito/) })
    it('"catalogo" com requisitos é recusado', () => { expect(erros(arq([esp({ estado: 'catalogo' })]))).toMatch(/catalogo/) })
    it('requisito só com texto CONFERIDO', () => { expect(erros(arq([esp({ requisitos: [req({ status_fonte: 'pendente' })] })]))).toMatch(/conferido/) })
    it('fonte sem https / de domínio desconhecido é recusada (especialidade e requisito)', () => {
      expect(erros(arq([esp({ fonte_url: 'http://mda.wiki.br/x' })]))).toMatch(/fonte_url/)
      expect(erros(arq([esp({ requisitos: [req({ fonte_url: 'https://blog-qualquer.com/x' })] })]))).toMatch(/fonte_url/)
    })
    it('a WIKI comunitária não vale como fonte "conferido" oficial do arquivo', () => {
      expect(erros(arq([esp()], { fonte: fonte({ url: WIKI }) }))).toMatch(/OFICIAL/)
    })
    it('"publicavel" exige fonte do arquivo "conferido"', () => {
      expect(erros(arq([esp()], { fonte: fonte({ status: 'pendente' }) }))).toMatch(/exige fonte.status/)
    })
  })

  describe('proveniência e versão', () => {
    it('exige fonte {nome,url,consultada_em,status}', () => {
      expect(erros(arq([esp()], { fonte: undefined }))).toMatch(/fonte \(proveniência\) obrigatória/)
      expect(erros(arq([esp()], { fonte: fonte({ consultada_em: '30/09/2026' }) }))).toMatch(/consultada_em/)
      expect(erros(arq([esp()], { fonte: fonte({ status: 'talvez' }) }))).toMatch(/fonte.status/)
    })
    it('exige versao inteira', () => { expect(erros(arq([esp()], { versao: 0 }))).toMatch(/versao inteira/) })
  })

  describe('tipos, modelo, grupos, dependência, prazo', () => {
    it('tipo desconhecido e tipo sem modelo são recusados', () => {
      expect(erros(arq([esp({ requisitos: [req({ tipo_evidencia: 'video' })] })]))).toMatch(/tipo_evidencia inválido/)
      expect(erros(arq([esp({ requisitos: [req({ modelo: undefined })] })]))).toMatch(/exige "modelo"/)
    })
    it('modelo inválido é recusado (campo de tipo desconhecido)', () => {
      expect(erros(arq([esp({ requisitos: [req({ modelo: modelo([{ chave: 'x', tipo: 'holograma', rotulo: 'X' }]) })] })]))).toMatch(/tipo desconhecido/)
    })
    it('relatório precisa de campos próprios (não só confirmação)', () => {
      expect(erros(arq([esp({ requisitos: [req({ tipo_evidencia: 'relatorio' })] })]))).toMatch(/campos próprios/)
    })
    it('grupo N de M: precisa existir, ter requisitos e mínimo coerente', () => {
      expect(erros(arq([esp({ requisitos: [req({ grupo: 'x' })] })]))).toMatch(/não declarado/)
      const g = (minimo) => esp({ grupos: [{ chave: 'tec', rotulo: 'Técnicas', minimo }], requisitos: [req({ grupo: 'tec' }), req({ ordem: 2, grupo: 'tec' })] })
      expect(validarEspecialidades([arq([g(1)])]).erros).toEqual([])
      expect(erros(arq([g(3)]))).toMatch(/maior que os 2 requisitos/)
      expect(erros(arq([esp({ grupos: [{ chave: 'vazio', rotulo: 'V', minimo: 1 }] })]))).toMatch(/sem requisitos/)
    })
    it('dependência só para ordens MENORES e nunca para requisito de grupo', () => {
      expect(validarEspecialidades([arq([esp({ requisitos: [req(), req({ ordem: 2, depende_de: [1] })] })])]).erros).toEqual([])
      expect(erros(arq([esp({ requisitos: [req({ depende_de: [1] })] })]))).toMatch(/ordens MENORES/)
      expect(erros(arq([esp({ requisitos: [req({ ordem: 1 }), req({ ordem: 2, depende_de: [3] }), req({ ordem: 3 })] })]))).toMatch(/ordens MENORES/)
    })
    it('prazo entre 1 e 730 dias', () => {
      expect(erros(arq([esp({ requisitos: [req({ prazo_dias: 0 })] })]))).toMatch(/prazo_dias/)
      expect(validarEspecialidades([arq([esp({ requisitos: [req({ prazo_dias: 30 })] })])]).erros).toEqual([])
    })
    it('código fora do padrão, de outra área ou repetido; ordem sequencial; chave desconhecida', () => {
      expect(erros(arq([esp({ codigo: 'X1' })]))).toMatch(/fora do padrão/)
      expect(erros(arq([esp({ codigo: 'EN-001' })]))).toMatch(/outra área/)
      expect(erros(arq([esp(), esp()]))).toMatch(/repetido/)
      expect(erros(arq([esp({ requisitos: [req({ ordem: 2 })] })]))).toMatch(/sequencial/)
      expect(erros(arq([esp({ extra: 1 })]))).toMatch(/chave desconhecida/)
    })
  })

  describe('teste x real', () => {
    it('"teste": true só na pasta teste/, e arquivo da pasta teste/ precisa dele', () => {
      expect(erros(arq([esp()], { teste: true }))).toMatch(/só na pasta teste/)
      expect(erros({ ...arq([esp()], {}, 'x.json'), doDirTeste: true })).toMatch(/precisa de "teste": true/)
    })
    it('marca [TESTE]/[EXEMPLO] em arquivo real é recusada', () => {
      expect(erros(arq([esp({ nome: '[TESTE] X' })]))).toMatch(/marca de teste/)
    })
  })

  it('o manifesto versionado hoje é válido', () => {
    const arqs = [...carregarAreas(), ...carregarTeste()].filter((a) => a.dados)
    expect(validarEspecialidades(arqs).erros).toEqual([])
  })
})

describe('gerador de SQL', () => {
  it('é determinístico e só leva "publicavel"', () => {
    const dados = arq([esp(), esp({ codigo: 'AA-003', estado: 'catalogo', requisitos: undefined })]).dados
    const a = gerarSql(dados); const b = gerarSql(dados)
    expect(a.sql).toBe(b.sql)
    expect(a.hash).toBe(b.hash)
    expect(montarPacote(dados).especialidades.map((e) => e.codigo)).toEqual(['AA-002'])
    expect(a.sql).toMatch(/insert into public\.specialties/)
    expect(a.sql).toMatch(/insert into public\.specialty_requirements/)
  })
  it('mudou o conteúdo → mudou o hash (e o SQL recusa reimportar a mesma versão com hash diferente)', () => {
    const a = gerarSql(arq([esp()]).dados)
    const b = gerarSql(arq([esp({ requisitos: [req({ descricao: 'Outro texto conferido.' })] })]).dados)
    expect(a.hash).not.toBe(b.hash)
    expect(a.sql).toMatch(/já existe com OUTRO conteúdo/)
  })
  it('manifesto de TESTE nunca vira migration; fixture só aceita teste', () => {
    const teste = { ...arq([esp()]).dados, teste: true }
    expect(() => gerarSql(teste)).toThrow(/nunca vira migration/)
    expect(gerarSql(teste, { modo: 'fixture' }).sql).toMatch(/especialidades-teste-local/)
    expect(() => gerarSql(arq([esp()]).dados, { modo: 'fixture' })).toThrow(/só aceita manifesto de teste/)
  })
  it('recusa gerar a partir de manifesto sem "publicavel"', () => {
    expect(gerarSql(arq([esp({ estado: 'catalogo', requisitos: undefined })]).dados)).toBeNull()
  })
  it('a fixture versionada bate com o manifesto de teste (npm run especialidades:fixture)', () => {
    const t = carregarTeste().filter((a) => a.dados)
    const esperado = t.map((a) => gerarSql(a.dados, { modo: 'fixture' })?.sql).filter(Boolean).join('\n')
    expect(readFileSync(ARQUIVO_FIXTURE, 'utf8')).toBe(esperado)
  })
})

describe('travas de segurança do conteúdo', () => {
  it('o manifesto de teste cobre todos os tipos e recursos do motor', () => {
    const [{ dados }] = carregarTeste().filter((a) => a.dados)
    const reqs = dados.especialidades[0].requisitos
    const tipos = new Set(reqs.map((r) => r.tipo_evidencia))
    for (const t of ['leitura', 'resposta', 'relatorio', 'foto', 'arquivo', 'atividade', 'validacao']) expect(tipos.has(t), t).toBe(true)
    expect(reqs.some((r) => r.grupo)).toBe(true)
    expect(reqs.some((r) => r.depende_de?.length)).toBe(true)
    expect(reqs.some((r) => r.prazo_dias)).toBe(true)
    expect(reqs.some((r) => r.modelo.campos.some((c) => c.tipo === 'numero' && c.min))).toBe(true)      // meta/quantidade
    expect(reqs.some((r) => r.modelo.campos.some((c) => c.tipo === 'anexos' && c.max > 1))).toBe(true)  // vários anexos
  })
  it('nenhuma migration carrega a especialidade de teste', () => {
    const dir = 'supabase/migrations'
    for (const f of readdirSync(dir)) {
      const s = readFileSync(`${dir}/${f}`, 'utf8')
      expect(s.includes('especialidades-teste-local'), f).toBe(false)
      expect(s.includes('TE-001'), f).toBe(false)
    }
  })
  it('ENQUANTO o dono não aprovar a fonte: nenhuma especialidade real "publicavel" no manifesto', () => {
    for (const a of carregarAreas().filter((x) => x.dados)) {
      expect(a.dados.especialidades.filter((e) => e.estado === 'publicavel'), a.arquivo).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Cadastrar uma especialidade completa pelo manifesto, sem escrever SQL: modelos prontos + criação da entrada.
// ---------------------------------------------------------------------------------------------------------------
import { adicionarEspecialidade } from '../../supabase/especialidades-manifesto/nova-especialidade.mjs'

describe('cadastro pelo manifesto (sem SQL manual)', () => {
  const modelos = JSON.parse(readFileSync('supabase/especialidades-manifesto/modelos-de-requisito.json', 'utf8')).modelos

  it('cada modelo de requisito pronto é VÁLIDO (o cadastro nunca começa quebrado)', () => {
    for (const [nome, m] of Object.entries(modelos)) {
      const extra = {}
      if (nome === 'grupo_n_de_m') extra.grupos = [{ chave: 'tecnicas', rotulo: 'Técnicas', minimo: 1 }]
      const reqs = nome === 'dependente' ? [req({ ordem: 1, descricao: 'Primeiro requisito conferido.' }), { ...m, ordem: 2, depende_de: [1] }] : [{ ...m, ordem: 1 }]
      expect(validarEspecialidades([arq([esp({ ...extra, requisitos: reqs })])]).erros, nome).toEqual([])
    }
  })
  it('os modelos cobrem todos os tipos do motor', () => {
    const tipos = new Set(Object.values(modelos).map((m) => m.tipo_evidencia))
    for (const t of ['leitura', 'resposta', 'relatorio', 'foto', 'arquivo', 'atividade', 'validacao']) expect(tipos.has(t), t).toBe(true)
    expect(Object.keys(modelos)).toEqual(expect.arrayContaining(['meta_quantidade', 'escolha_dentro_do_requisito', 'dependente', 'prazo', 'grupo_n_de_m']))
  })
  it('nova-especialidade cria a área e a entrada "catalogo" (não publicável)', () => {
    const d = adicionarEspecialidade(null, { codigo: 'HM-049', nome: 'Arte com Barbante', nivel: 1, fonteUrl: WIKI })
    expect(d.area).toBe('HM')
    expect(d.especialidades[0]).toMatchObject({ codigo: 'HM-049', estado: 'catalogo' })
    expect(d.fonte.status).toBe('pendente')
    expect(validarEspecialidades([{ arquivo: 'HM.json', dados: d }]).erros).toEqual([])
    expect(gerarSql(d)).toBeNull()                       // "catalogo" nunca gera SQL de conteúdo
  })
  it('recusa duplicar', () => {
    const d = adicionarEspecialidade(null, { codigo: 'HM-049', nome: 'X', fonteUrl: WIKI })
    expect(() => adicionarEspecialidade(d, { codigo: 'HM-049', nome: 'Y', fonteUrl: WIKI })).toThrow(/já está/)
  })
  it('fluxo completo: entrada → requisitos conferidos → "publicavel" → SQL determinístico', () => {
    const d = adicionarEspecialidade(null, { codigo: 'HM-049', nome: 'Arte com Barbante', nivel: 1, fonteUrl: OFICIAL })
    d.fonte = fonte()
    d.especialidades[0].estado = 'publicavel'
    d.especialidades[0].requisitos = [{ ...modelos.resposta, ordem: 1 }, { ...modelos.atividade_pratica, ordem: 2, depende_de: [1] }]
    expect(validarEspecialidades([{ arquivo: 'HM.json', dados: d }]).erros).toEqual([])
    const a = gerarSql(d), b = gerarSql(d)
    expect(a.sql).toBe(b.sql)
    expect(a.sql).toMatch(/'HM-049'/)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// ESCALA: 552 especialidades × 10 requisitos (dados SINTÉTICOS só em memória — nada disto é versionado como catálogo).
// ---------------------------------------------------------------------------------------------------------------
describe('escala do manifesto (552 especialidades × 10 requisitos, sintético)', () => {
  const AREAS = { AA: 16, AD: 9, AM: 58, AP: 68, AR: 119, CS: 43, EN: 105, HD: 13, HM: 121 }
  const sintetico = () => Object.entries(AREAS).map(([area, n]) => arq(
    Array.from({ length: n }, (_, i) => esp({
      codigo: `${area}-${String(i + 1).padStart(3, '0')}`, nome: `Sintética ${area} ${i + 1}`,
      requisitos: Array.from({ length: 10 }, (_, k) => req({ ordem: k + 1, descricao: `Requisito sintético ${k + 1} conferido.`, ...(k === 9 && i > 0 ? { depende_de: [1] } : {}) })),
    })), { area, area_nome: `Área ${area}` }, `${area}.json`))

  it('valida 552 especialidades / 5.520 requisitos em poucos segundos, sem erro', () => {
    const arqs = sintetico()
    const t0 = Date.now()
    const { erros } = validarEspecialidades(arqs)
    expect(erros).toEqual([])
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(arqs.reduce((n, a) => n + a.dados.especialidades.length, 0)).toBe(552)
  })
  it('gera 1 SQL por área, determinístico, e o tamanho total é razoável para migration', () => {
    const arqs = sintetico()
    let bytes = 0
    for (const a of arqs) {
      const x = gerarSql(a.dados), y = gerarSql(a.dados)
      expect(x.sql).toBe(y.sql)
      bytes += x.sql.length
    }
    expect(bytes).toBeLessThan(6 * 1024 * 1024)          // < 6 MB no total (uma migration por área fica bem abaixo disso)
  })
  it('uma área grande (AR, 119 especialidades) cabe numa migration só e recusa mudança silenciosa', () => {
    const ar = sintetico().find((a) => a.arquivo === 'AR.json')
    const x = gerarSql(ar.dados)
    expect(x.sql.length).toBeLessThan(2 * 1024 * 1024)
    ar.dados.especialidades[0].requisitos[0].descricao = 'Texto alterado depois de publicado.'
    expect(gerarSql(ar.dados).hash).not.toBe(x.hash)
  })
})
