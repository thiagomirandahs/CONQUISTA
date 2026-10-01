// CONTRATO (Fase 9 — privacidade de mídia): VÍDEO e HEIC só podem entrar no app pelos pontos conhecidos e declarados abaixo. Qualquer tela nova que aceite
// vídeo (accept com `video/` ou `*/*` que chegue a upload, ou `permitirVideo: true`) ou que mencione HEIC fora da lista FALHA — para que ninguém reabra o buraco
// (hoje o vídeo sobe ORIGINAL, com possível localização embutida; o tratamento está em VIDEO-SANEAMENTO-DESENHO.md e HEIC-SANEAMENTO-DESENHO.md, ainda NÃO ligado).
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
const com = (re) => arquivos.filter((p) => re.test(readFileSync(p, 'utf8'))).map(rel).sort()

// onde VÍDEO entra (cliente): um único ponto
const PONTOS_DE_VIDEO = {
  'pages/Atividades.jsx': 'comprovação de atividade: accept image/*,video/* + subirComprovacao({ permitirVideo: true }); vídeo sobe ORIGINAL (máx. 60 MB) para comprovacoes/atividades — SEM saneamento (pendente)',
  'lib/upload.js': 'define validarMidia/permitirVideo (assinatura mágica; máx. 60 MB) — não é uma tela',
}
// onde HEIC é mencionado (detecção/validação), nunca para subir sem redesenho
const PONTOS_DE_HEIC = {
  'lib/upload.js': 'detecta HEIC pela assinatura; o envio de foto passa por comprimirImagem({ semMetadados: true }) (canvas) e FALHA se o navegador não decodifica',
  'lib/imagens/validar.js': 'validação do pipeline de imagens (processarImagem)',
  'lib/storageGc.js': 'classificação do GC (HEIC não saneável)',
  'services/rede.js': 'comentário/tratamento da foto da Rede (otimizarFoto)',
  'lib/tutorial/conteudo.js': 'texto do tutorial (não é caminho de upload)',
}

describe('mídia: vídeo e HEIC só entram pelos pontos declarados', () => {
  it('permitirVideo: true só em Atividades.jsx', () => {
    const usam = com(/permitirVideo\s*:\s*true/)
    expect(usam, `novo ponto que ENVIA VÍDEO: ${usam.join(', ')} — declare em PONTOS_DE_VIDEO e trate o saneamento`).toEqual(['pages/Atividades.jsx'])
  })
  it('accept com video/ só em Atividades.jsx', () => {
    const usam = com(/accept\s*=\s*[{"'][^>]*video\//)
    expect(usam).toEqual(['pages/Atividades.jsx'])
  })
  it('nenhum campo de arquivo "qualquer tipo" (*/*) que suba direto ao Storage fora de Atividades/Experiencias (que validam o tipo REAL antes)', () => {
    const usam = com(/accept\s*=\s*\{?[^>]*\*\/\*/)
    expect(usam, `novo accept */*: ${usam.join(', ')}`).toEqual(['pages/Atividades.jsx', 'pages/Experiencias.jsx'])
  })
  it('subirComprovacao: o vídeo é o ÚNICO caminho que sobe o arquivo ORIGINAL (imagem sempre passa por comprimirImagem semMetadados)', () => {
    const s = readFileSync(join(RAIZ, 'lib/upload.js'), 'utf8')
    expect(s).toMatch(/let pronta = file[\s\S]*?if \(t\.midia === 'imagem'\) \{[\s\S]*?comprimirImagem\(file, \{ semMetadados: true \}\)/)
    expect(s).toMatch(/maxVideoMB = 60/)
  })
  it('HEIC só é mencionado nos arquivos declarados', () => {
    const usam = com(/heic|heif/i)
    const fora = usam.filter((r) => !(r in PONTOS_DE_HEIC))
    expect(fora, `HEIC fora da lista: ${fora.join(', ')}`).toEqual([])
  })
  it('as listas declaradas ainda existem (não apodrecem)', () => {
    for (const r of [...Object.keys(PONTOS_DE_VIDEO), ...Object.keys(PONTOS_DE_HEIC)]) expect(arquivos.map(rel)).toContain(r)
  })
})
