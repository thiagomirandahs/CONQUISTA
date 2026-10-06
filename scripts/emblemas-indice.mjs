// Gera src/lib/emblemasEspecialidades.js a partir dos arquivos de public/especialidades/ (código.png|jpg|webp).
// Rode depois de colocar emblemas novos na pasta:  node scripts/emblemas-indice.mjs
// O teste src/lib/emblemasEspecialidades.test.js falha se o índice ficar desatualizado.
import { readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pasta = path.join(raiz, 'public', 'especialidades')
const mapa = {}
for (const f of readdirSync(pasta).sort()) {
  const m = /^([a-z]{2}(?:-[a-z]{2})?-\d{3})\.(png|jpg|webp)$/.exec(f)
  if (m) mapa[m[1].toUpperCase()] = m[2]
}
const linhas = Object.entries(mapa).map(([c, e]) => `  '${c}': '${e}',`).join('\n')
writeFileSync(path.join(raiz, 'src', 'lib', 'emblemasEspecialidades.js'),
`// GERADO por scripts/emblemas-indice.mjs — não edite à mão. Código da especialidade → extensão do arquivo em public/especialidades/.
export const EMBLEMAS_ESPECIALIDADES = {
${linhas}
}
`)
console.log(Object.keys(mapa).length + ' emblemas indexados')
