// Coleta o CATÁLOGO de especialidades de Desbravadores do MDA Wiki (fonte indicada pelo dono em 29/09/2026:
// https://mda.wiki.br/Especialidades/). Guarda SÓ dados de catálogo (nome, área, código, nível, ano,
// instituição de origem, link da página) — o texto dos requisitos NÃO é copiado (o site não declara licença;
// o app aponta para a página da especialidade). Aventureiros ficam de fora (o app é de Desbravadores).
// Uso: node supabase/especialidades-catalogo/coletar-mda.mjs  → grava catalogo-mda.json ao lado.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://mda.wiki.br'
const HEAD = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
async function pagina(url) {
  for (let t = 1; t <= 3; t++) {
    const r = await fetch(url, { headers: HEAD })
    if (r.ok) return r.text()
    await espera(1500 * t)
  }
  throw new Error(`falhou ${url}`)
}
const semTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const AREAS = {
  AD: 'ADRA', HM: 'Artes e Habilidades Manuais', AA: 'Atividades Agrícolas', AM: 'Atividades Missionárias e Comunitárias',
  'AM-EB': 'Ensinos Bíblicos', AP: 'Atividades Profissionais', AR: 'Atividades Recreativas', CS: 'Ciência e Saúde',
  EN: 'Estudos da Natureza', HD: 'Habilidades Domésticas', ME: 'Mestrados',
}

function dadosDaPagina(html) {
  const m = html.match(/<table[^>]*class=["'](templ_especialidade_[a-z]+)["'][\s\S]*?<\/table>/)
  if (!m) return null
  const celulas = [...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => semTags(c[1]))
  // 1ª célula de cada linha é a imagem da insígnia (rowspan): os valores começam 2 depois de "Instituição"
  const i = celulas.findIndex((c) => /Institui/.test(c))
  const [area, codigo, nivel, ano, origem] = celulas.slice(i + 2, i + 7)
  const oficial = (html.match(/<template class=['"]mda-code['"]>([^<]+)</) || [])[1]
  return {
    modelo: m[1], area: (area || '').split(' ')[0], codigo: (codigo || '').trim(), oficial: oficial ? oficial.trim() : null, nivel: (nivel || '').trim(),
    ano: /^\d{4}/.test(ano || '') ? ano.slice(0, 4) : null, origem: origem && origem !== '-' ? origem : null,
  }
}

const indice = await pagina(`${BASE}/Especialidades/`)
// extintas: pela página da categoria (a página da especialidade não traz marcação)
const paginaExtintas = await pagina(`${BASE}/Especialidades_Extintas`)
const extintas = new Set([...paginaExtintas.matchAll(/href=["']([^"']*Especialidade_de_[^"']+)["']/g)].map((m) => new URL(m[1], BASE).href))
const links = [...new Map([...indice.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*(Especialidade de [^<]+?)\s*<\/a>/g)]
  .map((m) => [new URL(m[1], BASE).href, semTags(m[2])])).entries()]
console.log(`${links.length} páginas "Especialidade de …"`)

const saida = []; const semTabela = []; let feitas = 0
const fila = [...links]
await Promise.all(Array.from({ length: 3 }, async () => {
  while (fila.length) {
    const [href, titulo] = fila.shift()
    try {
      const d = dadosDaPagina(await pagina(href))
      if (!d) semTabela.push(titulo)
      else if (d.modelo === 'templ_especialidade_dbv') {
        saida.push({ nome: titulo.replace(/^Especialidade de /, ''), area: d.area, area_nome: AREAS[d.area] || d.area,
          codigo: d.oficial || `${d.area}-${d.codigo}`, nivel: Number(d.nivel) || null, ano: d.ano, origem: d.origem,
          extinta: extintas.has(href), fonte_url: href })
      }
    } catch (e) { semTabela.push(`${titulo} (erro: ${e.message})`) }
    if (++feitas % 50 === 0) console.log(`  ${feitas}/${links.length}`)
    await espera(250)
  }
}))

// Web Design × Web designer: o site tem duas páginas com o MESMO código — fica a primeira
const vistos = new Set(); const apelidos = []
for (let k = saida.length - 1; k >= 0; k--) { if (vistos.has(saida[k].codigo)) apelidos.push([saida[k].nome, saida.splice(k, 1)[0].codigo]); else vistos.add(saida[k].codigo) }

// ---- Mestrados: página de cada um lista as especialidades que contam (ignora os links aleatórios da lateral, classe "fw600")
const norm = (x) => decodeURIComponent(x).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/_/g, ' ').replace(/s*-s*/g, ' - ').toLowerCase().trim()
const porNome = new Map([...saida.map((x) => [norm(x.nome), x.codigo]), ...apelidos.map(([n, c]) => [norm(n), c])])
const paginaMestrados = await pagina(`${BASE}/Mestrados`)
const linksMestrado = [...new Set([...paginaMestrados.matchAll(/href=["']([^"']*\/Mestrado_em_[^"']+)["']/g)].map((m) => new URL(m[1], BASE).href))]
const mestrados = []
for (const href of linksMestrado) {
  const html = await pagina(href)
  const codigo = ((html.match(/<template class=['"]mda-code['"]>([^<]+)</) || [])[1] || '').trim()
  const nome = decodeURIComponent(href.split('/').pop()).replace(/_/g, ' ')
  const itens = [...html.matchAll(/<a ([^>]*)>/g)].map((m) => m[1]).filter((a) => !/fw600/.test(a))
    .map((a) => (a.match(/href=["'][^"']*Especialidade_de_([^"'#]+)["']/) || [])[1]).filter(Boolean)
  const codigos = [...new Set(itens.map((n) => porNome.get(norm(n))).filter(Boolean))]
  const semPar = [...new Set(itens.filter((n) => !porNome.get(norm(n))).map((n) => decodeURIComponent(n).replace(/_/g, ' ')))]
  // regra numérica ("Ter 7 especialidades…"); mestrado sem lista = "qualquer especialidade da área (XX)"
  const texto = semTags(html)
  const NUM = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15 }
  // só números (dígito ou por extenso) — "ter as especialidades…" em outro trecho da página não conta
  const q = (texto.match(new RegExp(`(?:Ter|Completar|Possuir)\\s+(\\d+|${Object.keys(NUM).join('|')})\\s+(?:das\\s+seguintes\\s+)?especialidades`, 'i')) || [])[1]
  const minimo = q ? (Number(q) || NUM[q.toLowerCase()] || null) : null
  // a lista oficial traz o código entre parênteses: "Acampamento I (AR 050)" — é a fonte mais confiável
  const porCodigo = new Set(saida.map((x) => x.codigo))
  const listados = [...new Set([...texto.matchAll(/\(((?:AM-EB)|[A-Z]{2})\s?-?\s?(\d{3})\)/g)].map((m) => `${m[1]}-${m[2]}`))]
  const areaDaRegra = listados.length || codigos.length ? null : ((texto.match(/especialidades (?:em|de|da área de)[^()]{0,80}\(([A-Z]{2}(?:-EB)?)\)/i) || [])[1] || null)
  const lista = areaDaRegra ? saida.filter((x) => x.area === areaDaRegra).map((x) => x.codigo) : (listados.length ? listados : codigos)
  mestrados.push({ codigo, nome, fonte_url: href, minimo, area: areaDaRegra,
    especialidades: lista.filter((c) => porCodigo.has(c)),
    nao_encontradas_no_catalogo: listados.length ? listados.filter((c) => !porCodigo.has(c)) : semPar })
  await espera(250)
}

saida.sort((a, b) => a.area.localeCompare(b.area) || a.codigo.localeCompare(b.codigo) || a.nome.localeCompare(b.nome))
const destino = join(dirname(fileURLToPath(import.meta.url)), 'catalogo-mda.json')
writeFileSync(destino, JSON.stringify({ fonte: `${BASE}/Especialidades/`, coletado_em: new Date().toISOString(),
  observacao: 'Só dados de catálogo; requisitos ficam na página de origem (fonte_url).', total: saida.length,
  sem_tabela_ou_aventureiros_fora: semTabela, especialidades: saida, mestrados }, null, 1))
console.log(`OK: ${saida.length} especialidades de Desbravadores → ${destino}`)
console.log(`Mestrados: ${mestrados.length} — ${mestrados.map((m) => `${m.nome} (${m.especialidades.length})`).join(', ')}`)
console.log(`Sem tabela (provavelmente extintas/antigas): ${semTabela.length}`)
