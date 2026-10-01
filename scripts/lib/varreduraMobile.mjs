// Varredura estática de padronização visual/mobile (Fase 9). Só LÊ arquivos de src/.
// Usada pelo teste src/lib/varreduraMobile.test.js (contrato) e pela CLI scripts/varredura-mobile.mjs (relatório).
//
// Heurística (texto, não AST): serve para LISTAR candidatos e travar regressões, não para provar nada.
//  - inputsDeArquivoCrus: `<input type="file">` fora das peças aprovadas, ou com `hidden`/display:none
//    (some do teclado e do leitor de tela; o padrão é `sr-only` dentro de um <label> de >= 44px).
//  - alvosPequenos: elementos clicáveis com altura declarada < 44px (h-N com N < 11, min-h-[Npx] com N < 44).
//  - coresHardcoded: hex (#rrggbb) em className/style fora de src/lib e dos arquivos de tokens.
//  - botoesGradienteAvulsos: `from-brand to-brand2` escrito à mão em vez de <Botao>.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

export const RAIZ_SRC = 'src'

// Peças onde o input de arquivo cru é legítimo: o próprio componente e telas que já usam sr-only + label >= 44px.
export const INPUT_FILE_PERMITIDO = [
  'src/ui/zonaUpload.jsx',
  'src/components/LayoutConta.jsx',            // avatar: o input é acionado por ref a partir de um botão
  'src/components/DocumentoDaIdade.jsx',       // label de 56px com sr-only
  'src/components/relatorio/FormularioRelatorio.jsx', // caixa de foto do relatório, sr-only
]
// A Rede DBV tem personalidade própria (stories/publicar): inputs sr-only dentro de caixas dela.
export const PREFIXOS_REDE = ['src/pages/rede/']

export function listarFontes(raiz = RAIZ_SRC) {
  const saida = []
  const andar = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome)
      if (statSync(p).isDirectory()) { if (nome !== 'node_modules') andar(p); continue }
      if (/\.(jsx|js)$/.test(nome) && !/\.(test|spec)\./.test(nome)) saida.push(p)
    }
  }
  andar(raiz)
  return saida.map((p) => p.split(sep).join('/'))
}

// Junta o JSX de uma tag aberta que atravessa linhas (`<input ... \n ... />`) numa string só.
function tagsDe(texto, nome) {
  const re = new RegExp(`<${nome}\\b[^>]*?(?:=>[^>]*?)*?/?>`, 'gs')
  return [...texto.matchAll(re)].map((m) => ({ texto: m[0], linha: texto.slice(0, m.index).split('\n').length }))
}

export function inputsDeArquivoCrus(arquivos = listarFontes()) {
  const achados = []
  for (const arq of arquivos) {
    const txt = readFileSync(arq, 'utf8')
    for (const t of tagsDe(txt, 'input')) {
      if (!/type=["']file["']/.test(t.texto)) continue
      const hidden = /className=["'][^"']*(^|\s)hidden(\s|["'])/.test(t.texto)
      const permitido = INPUT_FILE_PERMITIDO.includes(arq) || PREFIXOS_REDE.some((p) => arq.startsWith(p))
      if (!permitido || hidden) achados.push({ arquivo: arq, linha: t.linha, motivo: hidden ? 'hidden' : 'cru' })
    }
  }
  return achados
}

const CLICAVEL = /<(button|Link|a|label|CardAcao)\b|role=["']button["']|onClick=/
export function alvosPequenos(arquivos = listarFontes()) {
  const achados = []
  for (const arq of arquivos) {
    const linhas = readFileSync(arq, 'utf8').split('\n')
    linhas.forEach((bruta, i) => {
      if (!CLICAVEL.test(bruta) || /sr-only|min-h-\[44px\]|min-h-11|min-h-12|min-h-\[4[5-9]px\]|min-h-\[[5-9]\d+px\]/.test(bruta)) return
      // ícones/imagens dentro do botão (h-5 w-5) não são o alvo de toque
      const l = bruta.replace(/<(?:Icone|svg|img|Avatar[A-Za-z]*)\s[^>]*>/g, '')
      const h = [...l.matchAll(/(?<![-\w])h-(\d+(?:\.\d+)?)(?![\d\w[])/g)].map((m) => Number(m[1]) * 4)
      const mh = [...l.matchAll(/min-h-\[(\d+)px\]/g)].map((m) => Number(m[1]))
      const pequeno = [...h, ...mh].filter((px) => px < 44)
      if (pequeno.length) achados.push({ arquivo: arq, linha: i + 1, px: Math.min(...pequeno) })
    })
  }
  return achados
}

export function coresHardcoded(arquivos = listarFontes()) {
  const porArquivo = {}
  for (const arq of arquivos) {
    if (arq.startsWith('src/lib/') || arq.startsWith('src/features/jogos/') || /marca|tema|cores?/i.test(arq)) continue
    const n = (readFileSync(arq, 'utf8').match(/#[0-9a-fA-F]{6}\b/g) || []).length
    if (n) porArquivo[arq] = n
  }
  return porArquivo
}

export function botoesGradienteAvulsos(arquivos = listarFontes()) {
  const achados = []
  for (const arq of arquivos) {
    if (arq === 'src/ui/index.jsx' || arq === 'src/ui/lista.jsx') continue
    readFileSync(arq, 'utf8').split('\n').forEach((l, i) => {
      if (/from-brand to-brand2/.test(l)) achados.push({ arquivo: arq, linha: i + 1 })
    })
  }
  return achados
}
