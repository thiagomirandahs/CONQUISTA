// CONTRATO (Fase 9): nenhum envio de FOTO DE PESSOA ao Storage pode mandar o arquivo original (com EXIF/GPS), nem como "fallback"
// quando o processamento falha. Varre o código: todo `.upload(` precisa estar numa lista que declara COMO a imagem é saneada no
// cliente (servidor sanea de novo, mas o cliente nunca deve ser o elo fraco). Arquivo novo que sobe ao Storage e não está na lista FALHA.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
const arquivos = []
;(function varrer(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) varrer(p)
    else if (/\.(js|jsx)$/.test(n) && !/\.test\./.test(n) && !/\.contract\./.test(n)) arquivos.push(p)
  }
})(RAIZ)
const rel = (p) => p.slice(RAIZ.length + 1).split(String.fromCharCode(92)).join('/')
const sobem = arquivos.filter((p) => /\.storage\s*\.from\([^)]*\)\s*\.upload\(/.test(readFileSync(p, 'utf8')) || /\.from\([^)]*\)\s*\n?\s*\.upload\(/.test(readFileSync(p, 'utf8')))

// arquivo -> o que garante o saneamento (regex que TEM de aparecer no próprio arquivo)
const FOTOS_DE_PESSOA = {
  'lib/upload.js': /comprimirImagem\(file, \{ semMetadados: true \}\)/,
  'services/mural.js': /comprimirImagem\(file, \{ semMetadados: true \}\)/,
  'services/documentoIdade.js': /comprimirImagem\(file, \{ semMetadados: true \}\)/,
  'services/suporte.js': /comprimirImagem\(arquivo, \{ semMetadados: true/,
  'services/usuarios.js': /otimizarFoto\(file, FOTO_AVATAR\)[^\n]*semMetadados: true/,
  'pages/Cadastro.jsx': /otimizarFoto\(foto, FOTO_AVATAR\)[^\n]*semMetadados: true/,
  'services/rede.js': /otimizarFoto\(/,
  'services/comunidade.js': /limparFotoParaComunidade\(/,
  'services/classesAnteriores.js': /processarImagem\(/,
}
// não são fotos de pessoa (logo/emblema institucional ou desenho de assinatura gerado em canvas): ficam como estão, por decisão registrada
const INSTITUCIONAIS = {
  'pages/Unidades.jsx': 'emblema/bandeira de unidade (imagem institucional; logos não são alteradas)',
  'services/clubes.js': 'logo do clube (nunca alterada)',
  'services/vitrine.js': 'logo de parceiro (institucional)',
  'services/documentos.js': 'assinatura desenhada gerada em canvas pelo próprio app (PNG sem EXIF)',
}

describe('uploads de foto: nunca o original com EXIF/GPS (nem em fallback)', () => {
  it('todo arquivo que sobe ao Storage está declarado (foto de pessoa × institucional)', () => {
    const nao = sobem.map(rel).filter((r) => !(r in FOTOS_DE_PESSOA) && !(r in INSTITUCIONAIS))
    expect(nao, `arquivo(s) novos com .upload(): declare como é saneado -> ${nao.join(', ')}`).toEqual([])
  })
  it.each(Object.entries(FOTOS_DE_PESSOA))('%s sanea a imagem antes de subir', (arq, regex) => {
    expect(readFileSync(join(RAIZ, arq), 'utf8')).toMatch(regex)
  })
  it('nenhum fallback de foto de pessoa chama comprimirImagem SEM semMetadados', () => {
    for (const arq of Object.keys(FOTOS_DE_PESSOA)) {
      const linhas = readFileSync(join(RAIZ, arq), 'utf8').split('\n').filter((l) => /comprimirImagem\(/.test(l) && !/^\s*(\/\/|import )/.test(l) && !/^\s*export /.test(l))
      for (const l of linhas) {
        if (/maxLado: 400/.test(l)) continue // miniatura gerada a partir da imagem JÁ saneada (mural)
        expect(l, `${arq}: ${l.trim()}`).toMatch(/semMetadados: true/)
      }
    }
  })
  it('as exceções institucionais continuam listadas com motivo', () => {
    for (const [arq, motivo] of Object.entries(INSTITUCIONAIS)) {
      expect(motivo.length).toBeGreaterThan(10)
      expect(sobem.map(rel)).toContain(arq)
    }
  })
})
