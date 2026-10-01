// @vitest-environment node
// GC seguro do Storage (Fase 9): lógica pura de classificação + garantias do script de dry-run.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CARENCIA_MINIMA_DIAS, BUCKETS_PROTEGIDOS, CATEGORIAS_CANDIDATAS, ehCandidata, carenciaEfetiva,
  classificarObjeto, conferirInvariantes, mascararCaminho, montarRelatorio, normalizarReferencia, resumoHumano,
} from './storageGc.js'

const U1 = '11111111-2222-3333-4444-555555555555'
const U2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const U3 = '99999999-8888-7777-6666-555555555555'
const AGORA = new Date('2026-10-10T12:00:00Z')

// fatos de um arquivo; por padrão: órfão antigo (30 dias) em 'imagens'
const f = (o = {}) => ({
  bucket: 'imagens', name: `perfis/${U1}-1700000000.jpg`, bytes: 1000, criado_em: '2026-09-10T12:00:00Z', idade_dias: 30,
  existe_linha: true, clube_situacao: null, referencias: 0, em_fila: false, ...o,
})
const cat = (o, op) => classificarObjeto(f(o), { agora: AGORA, ...op }).categoria

describe('classificarObjeto — as 6 classes pedidas', () => {
  it('(1) órfão: sem referência, fora de bucket protegido, com mais de 7 dias => candidato', () => {
    expect(cat()).toBe('orfao')
    expect(ehCandidata('orfao')).toBe(true)
  })

  it('referenciado NUNCA é candidato, por mais antigo que seja', () => {
    expect(cat({ referencias: 1, idade_dias: 4000 })).toBe('referenciado')
    expect(ehCandidata('referenciado')).toBe(false)
    // nem em clube expurgado nem em pasta conclusao-anterior
    expect(cat({ referencias: 2, clube_situacao: 'expurgado', idade_dias: 4000 })).toBe('referenciado')
    expect(cat({ bucket: 'comprovacoes', name: `${U1}/${U2}/conclusao-anterior/${U3}.jpg`, referencias: 1 })).toBe('referenciado')
  })

  it('recente (< 7 dias) NUNCA é candidato — nem se órfão, nem de clube expurgado, nem conclusao-anterior', () => {
    expect(cat({ idade_dias: 6.9 })).toBe('recente')
    expect(cat({ idade_dias: 0.1, clube_situacao: 'expurgado' })).toBe('recente')
    expect(cat({ bucket: 'comprovacoes', name: `${U1}/${U2}/conclusao-anterior/${U3}.jpg`, idade_dias: 2 })).toBe('recente')
    expect(cat({ idade_dias: 7 })).toBe('orfao') // exatamente na carência já passa
  })

  it('a carência mínima é 7 dias e ninguém baixa disso (nem pedindo 0 ou 1)', () => {
    expect(CARENCIA_MINIMA_DIAS).toBe(7)
    expect(carenciaEfetiva(0)).toBe(7)
    expect(carenciaEfetiva(1)).toBe(7)
    expect(carenciaEfetiva(-5)).toBe(7)
    expect(carenciaEfetiva('abc')).toBe(7)
    expect(carenciaEfetiva(30)).toBe(30)
    expect(cat({ idade_dias: 3 }, { carenciaDias: 1 })).toBe('recente')
    expect(cat({ idade_dias: 20 }, { carenciaDias: 30 })).toBe('recente')
  })

  it('(3) clube expurgado: arquivo antigo, sem referência, no prefixo do clube expurgado => candidato', () => {
    const r = cat({ bucket: 'comprovacoes', name: `${U1}/${U2}/requisitos/a.jpg`, clube_situacao: 'expurgado' })
    expect(r).toBe('clube_expurgado')
    expect(ehCandidata(r)).toBe(true)
  })

  it('clube na LIXEIRA (recuperável) nunca é candidato', () => {
    expect(cat({ bucket: 'comprovacoes', name: `${U1}/${U2}/x.jpg`, clube_situacao: 'excluido' })).toBe('clube_na_lixeira')
    expect(ehCandidata('clube_na_lixeira')).toBe(false)
  })

  it('(4) conclusao-anterior plantado sem registro => candidato, com o motivo certo', () => {
    const ok = classificarObjeto(f({ bucket: 'comprovacoes', name: `${U1}/${U2}/conclusao-anterior/${U3}.jpg` }), { agora: AGORA })
    expect(ok).toEqual({ categoria: 'conclusao_anterior_sem_registro', motivo: 'sem_registro' })
    const lixo = classificarObjeto(f({ bucket: 'comprovacoes', name: `${U1}/${U2}/conclusao-anterior/script.exe` }), { agora: AGORA })
    expect(lixo).toEqual({ categoria: 'conclusao_anterior_sem_registro', motivo: 'formato_invalido' })
    // a mesma pasta em outro bucket não é tratada como conclusao-anterior
    expect(cat({ bucket: 'imagens', name: `${U1}/${U2}/conclusao-anterior/${U3}.jpg` })).toBe('orfao')
  })

  it('buckets protegidos (documentos, assinaturas, marca) NUNCA são candidatos, mesmo órfãos e antigos', () => {
    expect(BUCKETS_PROTEGIDOS).toEqual(['documentos-emitidos', 'assinaturas-desenhadas', 'publico', 'parceiros'])
    for (const bucket of BUCKETS_PROTEGIDOS) {
      expect(cat({ bucket, name: `${U1}/algo.pdf`, idade_dias: 9999 })).toBe('protegido_bucket')
    }
  })

  it('bucket que ninguém decidiu é falha fechada (fora do escopo), nunca candidato', () => {
    expect(cat({ bucket: 'bucket-novo', idade_dias: 9999 })).toBe('bucket_fora_do_escopo')
    expect(cat({ bucket: 'bucket-novo', referencias: 1 })).toBe('bucket_fora_do_escopo')
  })

  it('o que está na fila da limpeza da Rede é dela, não do GC', () => {
    expect(cat({ bucket: 'comunidade', name: `${U1}/${U2}/${U3}.jpg`, em_fila: true })).toBe('em_fila_de_remocao')
  })

  it('sem data de criação (listagem) nunca é candidato', () => {
    expect(cat({ criado_em: null, idade_dias: undefined })).toBe('sem_data')
  })

  it('idade calculada da data quando o SQL não manda idade_dias', () => {
    expect(cat({ idade_dias: undefined, criado_em: '2026-10-09T12:00:00Z' })).toBe('recente')
    expect(cat({ idade_dias: undefined, criado_em: '2026-08-01T00:00:00Z' })).toBe('orfao')
  })
})

describe('(2) arquivo físico sem linha em storage.objects (listagem da API)', () => {
  it('sem linha + sem referência + antigo => candidato arquivo_sem_linha', () => {
    expect(cat({ existe_linha: false })).toBe('arquivo_sem_linha')
    expect(ehCandidata('arquivo_sem_linha')).toBe(true)
  })
  it('sem linha mas REFERENCIADO é anomalia relatada, nunca candidato', () => {
    expect(cat({ existe_linha: false, referencias: 1 })).toBe('sem_linha_referenciado')
    expect(ehCandidata('sem_linha_referenciado')).toBe(false)
  })
  it('sem linha e recente continua recente', () => {
    expect(cat({ existe_linha: false, idade_dias: 1 })).toBe('recente')
  })
})

describe('montarRelatorio', () => {
  const fatos = [
    f({ name: `perfis/${U1}-1.jpg`, bytes: 100 }), // órfão
    f({ name: `perfis/${U1}-2.jpg`, referencias: 1, bytes: 200 }), // referenciado
    f({ name: `perfis/${U1}-3.jpg`, idade_dias: 2, bytes: 300 }), // recente
    f({ bucket: 'comprovacoes', name: `${U2}/${U3}/requisitos/x.jpg`, clube_situacao: 'expurgado', bytes: 400 }),
    f({ bucket: 'comprovacoes', name: `${U1}/${U2}/conclusao-anterior/${U3}.jpg`, bytes: 500 }),
    f({ bucket: 'documentos-emitidos', name: `${U1}/${U2}/${U3}/1.pdf`, bytes: 600 }),
  ]
  const quebradas = [{ origem: 'entregas.foto_url', bucket: 'comprovacoes', name: 'x/y.jpg' }, { origem: 'entregas.foto_url', bucket: 'comprovacoes', name: 'x/z.jpg' }]
  const rel = montarRelatorio({ fatos, quebradas }, { agora: AGORA, chaveCurta: () => 'abc123' })

  it('conta candidatos só nas categorias candidatas e soma os bytes', () => {
    expect(rel.candidatos).toEqual({ n: 3, bytes: 100 + 400 + 500 })
    expect(rel.por_categoria.orfao).toEqual({ n: 1, bytes: 100 })
    expect(rel.por_categoria.referenciado.n).toBe(1)
    expect(rel.por_categoria.recente.n).toBe(1)
    expect(rel.por_categoria.protegido_bucket.n).toBe(1)
    expect(rel.por_bucket['documentos-emitidos'].candidatos).toBe(0)
    expect(rel.totais).toEqual({ objetos: 6, bytes: 2100 })
  })

  it('(5) referência quebrada só é RELATADA, por origem', () => {
    expect(rel.referencias_quebradas).toEqual({ total: 2, por_origem: { 'entregas.foto_url': 2 } })
    expect(rel.candidatos.n).toBe(3) // quebrada não vira candidato de nada
  })

  it('declara que nada foi apagado e que aplicar não existe', () => {
    expect(rel.nada_foi_apagado).toBe(true)
    expect(rel.somente_leitura).toBe(true)
    expect(rel.aplicar).toMatch(/nao_implementado/)
    expect(CATEGORIAS_CANDIDATAS).not.toContain('referenciado')
  })

  it('por padrão NÃO tem caminho completo nem dado pessoal (UUID inteiro, nome de arquivo)', () => {
    const txt = JSON.stringify(rel)
    for (const u of [U1, U2, U3]) expect(txt).not.toContain(u)
    expect(txt).not.toContain('requisitos/x.jpg')
    expect(rel.lista_candidatos).toBeUndefined()
    expect(rel.caminhos).toBe('mascarados')
    expect(rel.amostras.orfao[0].caminho).toBe('imagens/perfis/….jpg')
    expect(rel.amostras.clube_expurgado[0].caminho).toBe('comprovacoes/aaaaaaaa…/99999999…/requisitos/….jpg')
  })

  it('com incluirCaminhos traz a lista completa, só dos candidatos', () => {
    const r2 = montarRelatorio({ fatos, quebradas }, { agora: AGORA, incluirCaminhos: true })
    expect(r2.lista_candidatos).toHaveLength(3)
    expect(r2.lista_candidatos.every((c) => CATEGORIAS_CANDIDATAS.includes(c.categoria))).toBe(true)
    expect(r2.lista_candidatos.map((c) => c.name)).not.toContain(`perfis/${U1}-2.jpg`) // o referenciado
  })

  it('o resumo humano diz que nada foi apagado e que --aplicar não existe', () => {
    const t = resumoHumano(rel)
    expect(t).toMatch(/NADA foi apagado/)
    expect(t).toMatch(/--aplicar: NÃO implementado/)
    expect(t).toMatch(/Sem listagem da API/)
  })

  it('acusa divergência quando o SQL e o script discordam', () => {
    const r3 = montarRelatorio({ fatos: [f({ categoria: 'referenciado' })] }, { agora: AGORA })
    expect(r3.divergencias_sql_js).toBe(1)
    expect(r3.avisos.join(' ')).toMatch(/DIVERGÊNCIA/)
    const ok = montarRelatorio({ fatos: [f({ categoria: 'orfao' })] }, { agora: AGORA })
    expect(ok.divergencias_sql_js).toBe(0)
  })

  it('a especialização por listagem não conta como divergência', () => {
    const r4 = montarRelatorio({ fatos: [f({ existe_linha: false, categoria: 'orfao' })], listagemUsada: true }, { agora: AGORA })
    expect(r4.divergencias_sql_js).toBe(0)
    expect(r4.por_categoria.arquivo_sem_linha.n).toBe(1)
  })
})

describe('conferirInvariantes (rede de segurança)', () => {
  const cand = { bucket: 'imagens', name: 'a/b.jpg', categoria: 'orfao', referencias: 0, em_fila: false, idade: 30, clube_situacao: null }
  it('aceita candidato legítimo', () => expect(() => conferirInvariantes([cand], 7)).not.toThrow())
  it.each([
    ['referenciado', { referencias: 1 }],
    ['em fila', { em_fila: true }],
    ['bucket protegido', { bucket: 'publico' }],
    ['bucket fora do escopo', { bucket: 'x' }],
    ['clube na lixeira', { clube_situacao: 'excluido' }],
    ['recente', { idade: 3 }],
    ['sem data', { idade: null }],
  ])('aborta se um candidato for %s', (_n, o) => {
    expect(() => conferirInvariantes([{ ...cand, ...o }], 7)).toThrow(/Invariante violada/)
  })
})

describe('mascararCaminho / normalizarReferencia', () => {
  it('UUID vira 8 caracteres, nome do arquivo some, só pasta estrutural fica', () => {
    expect(mascararCaminho('comprovacoes', `${U1}/${U2}/conclusao-anterior/${U3}.heic`)).toBe('comprovacoes/11111111…/aaaaaaaa…/conclusao-anterior/….heic')
    expect(mascararCaminho('imagens', `perfis/${U1}-1700.jpg`)).toBe('imagens/perfis/….jpg')
    expect(mascararCaminho('suporte-anexos', `${U1}/segredo-da-crianca/foto.png`)).toBe('suporte-anexos/11111111…/…/….png')
  })
  it('URL do Storage e caminho puro viram bucket/caminho; URL externa e rota interna não são Storage', () => {
    expect(normalizarReferencia('https://x.supabase.co/storage/v1/object/public/imagens/perfis/a.jpg', 'comprovacoes')).toBe('imagens/perfis/a.jpg')
    expect(normalizarReferencia('https://x.supabase.co/storage/v1/object/sign/comprovacoes/u/r/1.jpg?token=abc', 'imagens')).toBe('comprovacoes/u/r/1.jpg')
    expect(normalizarReferencia('u/missoes/1.jpg', 'comprovacoes')).toBe('comprovacoes/u/missoes/1.jpg')
    expect(normalizarReferencia('https://youtube.com/watch?v=1', 'imagens')).toBeNull()
    expect(normalizarReferencia('/icon-192.png', 'imagens')).toBeNull()
    expect(normalizarReferencia('', 'imagens')).toBeNull()
    expect(normalizarReferencia(null, 'imagens')).toBeNull()
    expect(normalizarReferencia('sem-bucket.jpg', null)).toBeNull()
  })
})

describe('script scripts/storage-gc-dryrun.mjs — só lê, só com --db explícito, sem --aplicar', () => {
  const caminho = fileURLToPath(new URL('../../scripts/storage-gc-dryrun.mjs', import.meta.url))
  const fonte = readFileSync(caminho, 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join(' ') // só código, sem comentários
  const rodar = (...a) => spawnSync(process.execPath, [caminho, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH } })

  it('sem --db: recusa (exit 2) e explica', () => {
    const r = rodar()
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/--db/)
  })
  it('--aplicar (e sinônimos de apagar) NÃO existem: exit 3, mesmo com --db', () => {
    for (const flag of ['--aplicar', '--apagar', '--remover', '--delete', '--executar']) {
      const r = rodar('--db', 'postgresql://x:y@localhost:1/z', flag)
      expect(r.status).toBe(3)
      expect(r.stderr).toMatch(/NÃO está implementado/)
    }
  })
  it('--db que não é URL postgres é recusado', () => {
    expect(rodar('--db', 'banco-qualquer').status).toBe(2)
  })
  it('--incluir-caminhos exige --json (caminho completo não vai para o terminal)', () => {
    expect(rodar('--db', 'postgresql://x:y@localhost:1/z', '--incluir-caminhos').status).toBe(2)
  })
  it('o código nunca lê o ambiente para achar o banco nem arquivos .env, e não tem remoção', () => {
    expect(fonte).not.toMatch(/DB_URL|DATABASE_URL|SUPABASE_DB|desbravaclube-prod|dotenv|loadEnvFile|\.env['"`]/i)
    expect(fonte).not.toMatch(/process\.env\.[A-Z_]*(URL|PASSWORD|KEY)/)
    expect(fonte).not.toMatch(/\.remove\(|delete\s+from|allow_delete_query|drop\s+(table|function)|truncate/i)
    expect(fonte).toMatch(/begin read only/)
    expect(fonte).toMatch(/default_transaction_read_only=on/)
  })
  it('a migration 531 é só leitura: nada de delete/update/insert/DDL de tabela nem apagar do Storage', () => {
    const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260930000531_storage-gc-catalogo-e-relatorio.sql', import.meta.url)), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(sql).not.toMatch(/\bdelete\s+from\b|\bupdate\s+public\.|\binsert\s+into\b|\bcreate\s+table\b|allow_delete_query|\btruncate\b|\bdrop\s+table\b/i)
  })
})
