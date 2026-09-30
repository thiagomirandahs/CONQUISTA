// Cria (ou atualiza) a entrada de uma especialidade no manifesto da área SEM escrever SQL nem JSON à mão.
//   node supabase/especialidades-manifesto/nova-especialidade.mjs HM-049 "Arte com Barbante" --nivel 1 --fonte-url https://mda.wiki.br/... [--fonte-oficial https://www.adventistas.org/...]
// Cria areas/<AREA>.json (se não existir) e adiciona a especialidade como "catalogo" (só nome; NÃO publicável).
// Depois: copie os requisitos de modelos-de-requisito.json, preencha com o texto CONFERIDO (paráfrase própria),
// troque estado para "publicavel", rode `npm run especialidades:validar` e gere a migration (README).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dirAreas, validarEspecialidades } from './validar.mjs'

const AREAS = { AA: 'Atividades Agrícolas', AD: 'ADRA', AM: 'Atividades Missionárias e Comunitárias', AP: 'Atividades Profissionais', AR: 'Atividades Recreativas', CS: 'Ciência e Saúde', EN: 'Estudos da Natureza', HD: 'Habilidades Domésticas', HM: 'Artes e Habilidades Manuais' }

export function adicionarEspecialidade(dados, { codigo, nome, nivel, fonteUrl }) {
  const area = codigo.slice(0, 2)
  const base = dados ?? {
    formato: 'conquista.especialidades/2', versao: 1, area, area_nome: AREAS[area] || area, preparado_em: new Date().toISOString().slice(0, 10),
    fonte: { nome: 'A DEFINIR (fonte oficial ainda não aprovada)', url: 'https://www.adventistas.org/pt/desbravadores/especialidades/', consultada_em: new Date().toISOString().slice(0, 10), status: 'pendente' },
    especialidades: [],
  }
  if (base.especialidades.some((e) => e.codigo === codigo)) throw new Error(`${codigo} já está no manifesto.`)
  base.especialidades.push({ codigo, nome, ...(nivel ? { nivel } : {}), fonte_url: fonteUrl, estado: 'catalogo' })
  base.especialidades.sort((a, b) => a.codigo.localeCompare(b.codigo))
  return base
}

const ehCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (ehCli) {
  const [codigo, nome, ...resto] = process.argv.slice(2)
  const opt = (n) => { const i = resto.indexOf(n); return i >= 0 ? resto[i + 1] : undefined }
  if (!/^[A-Z]{2}(-EB)?-\d{3}$/.test(codigo || '') || !nome) { console.error('Uso: nova-especialidade.mjs HM-049 "Nome" [--nivel 1] --fonte-url https://…'); process.exit(1) }
  const fonteUrl = opt('--fonte-url')
  if (!fonteUrl) { console.error('Informe --fonte-url (https) da página da especialidade.'); process.exit(1) }
  const arq = join(dirAreas, `${codigo.slice(0, 2)}.json`)
  mkdirSync(dirAreas, { recursive: true })
  const atual = existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : null
  const novo = adicionarEspecialidade(atual, { codigo, nome, nivel: opt('--nivel') ? Number(opt('--nivel')) : undefined, fonteUrl })
  const { erros } = validarEspecialidades([{ arquivo: `${novo.area}.json`, dados: novo }])
  if (erros.length) { erros.forEach((e) => console.error('  FAIL ' + e)); process.exit(1) }
  writeFileSync(arq, JSON.stringify(novo, null, 1) + '\n', 'utf8')
  console.log(`  ${codigo} adicionada como "catalogo" em areas/${codigo.slice(0, 2)}.json. Próximo passo: requisitos conferidos (modelos-de-requisito.json) → estado "publicavel" → npm run especialidades:validar.`)
}
