// Relatórios de um toque do painel do coordenador (PDF pela impressão do navegador, planilha CSV e
// resumo em texto para o WhatsApp). Funções PURAS: recebem o resumo do servidor
// (escopo_resumo_coordenador, migration 390) — que já é só agregado por clube — e devolvem texto.
// Nunca acrescentam dado nenhum além do que veio: nome do clube + números + datas.

export const WHATSAPP_SUPORTE = '5581989499469' // mesmo número do site (Landing / Parceiros)
export const linkAjudaWhatsApp = (quem = '') =>
  `https://wa.me/${WHATSAPP_SUPORTE}?text=${encodeURIComponent(
    `Olá! Sou da coordenação${quem ? ` (${quem})` : ''} e preciso de ajuda com o painel do DesbravaClube.`)}`

export const PERIODOS = [
  { chave: 'mes', rotulo: 'Este mês' },
  { chave: 'trimestre', rotulo: 'Este trimestre' },
  { chave: 'ano', rotulo: 'Este ano' },
]
export const rotuloPeriodo = (p) => (PERIODOS.find((x) => x.chave === p)?.rotulo || 'Este mês')

export const DIAS_PARADO = 30

export const dataBR = (iso) => {
  if (!iso) return ''
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return a && m && d ? `${d}/${m}/${a}` : ''
}
const num = (v) => Number(v || 0)
export const pctTexto = (v) => (v === null || v === undefined ? 'sem classe começada' : `${Math.round(Number(v))}%`)

export function estaParado(c) {
  return c?.dias_sem_avancar === null || c?.dias_sem_avancar === undefined || num(c.dias_sem_avancar) > DIAS_PARADO
}

// Frase curta sobre o avanço, sem siglas: "Avançou hoje", "Avançou há 3 dias", "Ainda não começou".
export function fraseAvanco(c) {
  if (c?.dias_sem_avancar === null || c?.dias_sem_avancar === undefined) return 'Ainda não começou as classes no aplicativo'
  const d = num(c.dias_sem_avancar)
  if (d === 0) return 'Avançou hoje'
  if (d === 1) return 'Avançou ontem'
  return `Avançou pela última vez há ${d} dias`
}

export function fraseVisita(c) {
  if (num(c?.visitas_ano) === 0) return 'Ainda não visitado este ano'
  return `Visitado ${num(c.visitas_ano) === 1 ? '1 vez' : `${num(c.visitas_ano)} vezes`} este ano — última em ${dataBR(c.ultima_visita)}`
}

// ---------------------------------------------------------------- CSV (Excel em pt-BR: ; e BOM UTF-8)
const celula = (v) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function gerarCSV(resumo) {
  const cab = ['Clube', 'Desbravadores fazendo classe', 'Requisitos aprovados (%)', 'Requisitos aprovados no período',
    'Última vez que avançou', 'Dias sem avançar', 'Parado há mais de 30 dias', 'Visitas no ano', 'Visitas no período',
    'Última visita', 'Próxima visita']
  const linhas = (resumo?.clubes || []).map((c) => [
    c.nome, num(c.desbravadores_em_classe), c.requisitos_pct ?? '', num(c.aprovados_no_periodo),
    dataBR(c.ultimo_avanco), c.dias_sem_avancar ?? '', estaParado(c) ? 'Sim' : 'Não', num(c.visitas_ano),
    num(c.visitas_periodo), dataBR(c.ultima_visita), dataBR(c.proxima_visita),
  ])
  return '﻿' + [cab, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------- texto para WhatsApp
export function gerarTextoWhatsApp(resumo) {
  const t = resumo?.totais || {}
  const clubes = resumo?.clubes || []
  const parados = clubes.filter(estaParado)
  const l = [
    `*Como estão meus clubes — ${resumo?.escopo?.nome || 'Coordenação'}*`,
    `${rotuloPeriodo(resumo?.periodo)} (desde ${dataBR(resumo?.desde)})`,
    '',
    `🏕️ Clubes: ${num(t.clubes)}`,
    `🎓 Desbravadores fazendo classe: ${num(t.desbravadores_em_classe)}`,
    `✅ Requisitos aprovados: ${pctTexto(t.requisitos_pct)}`,
    `📝 Aprovados no período: ${num(t.aprovados_no_periodo)}`,
    `🚗 Visitas do ano: ${num(t.visitados_ano)} visitados, ${num(t.faltando_visitar_ano)} faltando`,
  ]
  if (parados.length) {
    l.push('', '⚠️ Precisam de atenção:')
    parados.forEach((c) => l.push(c.dias_sem_avancar == null ? `• ${c.nome}: ainda não começou` : `• ${c.nome}: não avança há ${c.dias_sem_avancar} dias`))
  }
  l.push('', '*Por clube:*')
  clubes.forEach((c) => l.push(`• ${c.nome}: ${num(c.desbravadores_em_classe)} fazendo classe, ${pctTexto(c.requisitos_pct)} aprovados`))
  l.push('', 'Enviado pelo DesbravaClube')
  return l.join('\n')
}

// ---------------------------------------------------------------- página imprimível (vira PDF no "Salvar como PDF")
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
export function gerarHTMLImpressao(resumo) {
  const t = resumo?.totais || {}
  const linhas = (resumo?.clubes || []).map((c) => `<tr${estaParado(c) ? ' class="parado"' : ''}>
<td>${esc(c.nome)}</td><td>${num(c.desbravadores_em_classe)}</td><td>${esc(pctTexto(c.requisitos_pct))}</td>
<td>${num(c.aprovados_no_periodo)}</td><td>${esc(dataBR(c.ultimo_avanco) || '—')}</td>
<td>${num(c.visitas_ano)}</td><td>${esc(dataBR(c.ultima_visita) || '—')}</td></tr>`).join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Como estão meus clubes</title>
<style>body{font-family:system-ui,Arial,sans-serif;color:#07122f;margin:24px;font-size:14px}
h1{font-size:22px;margin:0}p{margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #c9d1e3;padding:6px;text-align:left}th{background:#0b1f4d;color:#fff}
tr.parado td{background:#fff4d6}.totais{margin-top:12px}</style></head><body>
<h1>Como estão meus clubes — ${esc(resumo?.escopo?.nome || '')}</h1>
<p>${esc(rotuloPeriodo(resumo?.periodo))} (desde ${esc(dataBR(resumo?.desde))}) · gerado em ${esc(dataBR(resumo?.hoje))}</p>
<div class="totais"><p>Clubes: <b>${num(t.clubes)}</b> · Desbravadores fazendo classe: <b>${num(t.desbravadores_em_classe)}</b>
 · Requisitos aprovados: <b>${esc(pctTexto(t.requisitos_pct))}</b></p>
<p>Visitas do ano: <b>${num(t.visitados_ano)}</b> visitados, <b>${num(t.faltando_visitar_ano)}</b> faltando ·
 Parados há mais de ${DIAS_PARADO} dias: <b>${num(t.clubes_parados)}</b></p></div>
<table><thead><tr><th>Clube</th><th>Fazendo classe</th><th>Requisitos aprovados</th><th>Aprovados no período</th>
<th>Último avanço</th><th>Visitas no ano</th><th>Última visita</th></tr></thead><tbody>${linhas}</tbody></table>
<p style="margin-top:16px;font-size:12px">Somente números gerais de cada clube. DesbravaClube.</p>
</body></html>`
}
