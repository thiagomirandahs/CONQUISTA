// Prova cada rejeição do validador de Especialidades (fase 7) e o determinismo do gerador.
import { describe, it, expect } from 'vitest'
import { validarEspecialidades, carregarAreas } from '../../supabase/especialidades-manifesto/validar.mjs'
import { gerarSql, montarPacote } from '../../supabase/especialidades-manifesto/gerar-importacao.mjs'

const FONTE = 'https://mda.wiki.br/Especialidade_de_Jardinagem_e_Horticultura'
const req = (o = {}) => ({ ordem: 1, descricao: 'Texto conferido na fonte oficial.', tipo_evidencia: 'texto', fonte_url: FONTE, status_fonte: 'conferido', ...o })
const esp = (o = {}) => ({ codigo: 'AA-002', nome: 'Jardinagem', nivel: 1, fonte_url: FONTE, estado: 'publicavel', requisitos: [req()], ...o })
const area = (especialidades = [esp()], o = {}) => ({ arquivo: 'AA.json', dados: { formato: 'conquista.especialidades/1', area: 'AA', area_nome: 'Atividades Agrícolas', especialidades, ...o } })
const erros = (...a) => validarEspecialidades(a).erros.join('\n')

describe('validador de especialidades', () => {
  it('aceita um arquivo correto', () => { expect(validarEspecialidades([area()]).erros).toEqual([]) })
  it('"catalogo" (só nome/área) é válido e não precisa de requisito', () => {
    expect(validarEspecialidades([area([esp({ estado: 'catalogo', requisitos: undefined })])]).erros).toEqual([])
  })
  it('NÃO se inventa requisito: "publicavel" sem requisitos é recusado', () => {
    expect(erros(area([esp({ requisitos: [] })]))).toMatch(/não se inventa requisito/)
  })
  it('"catalogo" com requisitos é recusado', () => { expect(erros(area([esp({ estado: 'catalogo' })]))).toMatch(/catalogo/) })
  it('requisito só entra com texto CONFERIDO na fonte', () => {
    expect(erros(area([esp({ requisitos: [req({ status_fonte: 'pendente' })] })]))).toMatch(/conferido/)
  })
  it('fonte sem https ou de domínio desconhecido é recusada (na especialidade e no requisito)', () => {
    expect(erros(area([esp({ fonte_url: 'http://mda.wiki.br/x' })]))).toMatch(/fonte_url/)
    expect(erros(area([esp({ requisitos: [req({ fonte_url: 'https://blog-qualquer.com/x' })] })]))).toMatch(/fonte_url/)
  })
  it('código fora do padrão, de outra área ou repetido', () => {
    expect(erros(area([esp({ codigo: 'X1' })]))).toMatch(/fora do padrão/)
    expect(erros(area([esp({ codigo: 'EN-001' })]))).toMatch(/outra área/)
    expect(erros(area([esp(), esp()]))).toMatch(/repetido/)
  })
  it('ordem sequencial, tipo de evidência válido e chave desconhecida', () => {
    expect(erros(area([esp({ requisitos: [req({ ordem: 2 })] })]))).toMatch(/sequencial/)
    expect(erros(area([esp({ requisitos: [req({ tipo_evidencia: 'video' })] })]))).toMatch(/tipo_evidencia/)
    expect(erros(area([esp({ extra: 1 })]))).toMatch(/chave desconhecida/)
  })
  it('exemplo/teste não vaza para arquivo real', () => {
    expect(erros(area([esp({ nome: '[EXEMPLO] X' })]))).toMatch(/marca de teste/)
  })
  it('o manifesto versionado hoje é válido (só estrutura + exemplo)', () => {
    const arqs = carregarAreas().filter((a) => a.dados)
    expect(validarEspecialidades(arqs).erros).toEqual([])
  })
})

describe('gerador de importação', () => {
  it('é determinístico e só leva "publicavel"', () => {
    const arqs = [area([esp(), esp({ codigo: 'AA-003', estado: 'catalogo', requisitos: undefined })])]
    const a = gerarSql(arqs); const b = gerarSql(arqs)
    expect(a.sql).toBe(b.sql)
    expect(a.hash).toBe(b.hash)
    expect(montarPacote(arqs).especialidades.map((e) => e.codigo)).toEqual(['AA-002'])
    expect(a.sql).toMatch(/curriculo_importar_especialidades/)
  })
  it('recusa gerar a partir de manifesto inválido', () => {
    expect(() => gerarSql([area([esp({ requisitos: [] })])])).toThrow(/Manifesto inválido/)
  })
})
