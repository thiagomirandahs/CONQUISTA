// Relatório da varredura de padronização visual/mobile (Fase 9). Só leitura.
// Uso: node scripts/varredura-mobile.mjs [--json]
import { inputsDeArquivoCrus, alvosPequenos, coresHardcoded, botoesGradienteAvulsos } from './lib/varreduraMobile.mjs'

const r = {
  inputsDeArquivoCrus: inputsDeArquivoCrus(),
  alvosPequenos: alvosPequenos(),
  coresHardcoded: coresHardcoded(),
  botoesGradienteAvulsos: botoesGradienteAvulsos(),
}
if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0) }

const lista = (t, xs, f) => { console.log(`\n== ${t} (${xs.length}) ==`); xs.forEach((x) => console.log('  ' + f(x))) }
lista('Inputs de arquivo crus/hidden', r.inputsDeArquivoCrus, (x) => `${x.arquivo}:${x.linha} [${x.motivo}]`)
lista('Alvos clicáveis < 44px (candidatos)', r.alvosPequenos, (x) => `${x.arquivo}:${x.linha} (${x.px}px)`)
lista('Botões com gradiente brand→brand2 escrito à mão', r.botoesGradienteAvulsos, (x) => `${x.arquivo}:${x.linha}`)
const cores = Object.entries(r.coresHardcoded).sort((a, b) => b[1] - a[1])
lista('Cores #rrggbb fora dos tokens (por arquivo)', cores, ([a, n]) => `${a}: ${n}`)
