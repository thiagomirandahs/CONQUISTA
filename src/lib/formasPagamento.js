// Formas de pagamento da mensalidade (config_clube, por clube — sem tabela nova).
//   'formas_pagamento'  = JSON [{ tipo, rotulo, detalhe }]   ·   'mensalidade_valor' = número em texto
//   'pix'               = chave PIX antiga: continua valendo e é espelhada da primeira forma PIX.
// Quem lê (pais, tesoureiro) usa `lerFormas`; quem grava (diretoria) usa `serializarFormas`.

export const TIPOS_FORMA = {
  pix:      { rotulo: 'PIX', icone: '⚡', dica: 'Chave PIX (CNPJ, telefone, e-mail ou chave aleatória)', copiavel: true },
  dinheiro: { rotulo: 'Dinheiro na reunião', icone: '💵', dica: 'Quem recebe? (ex.: entregar ao tesoureiro)', copiavel: false },
  conta:    { rotulo: 'Transferência / depósito', icone: '🏦', dica: 'Banco, agência e conta', copiavel: true },
  link:     { rotulo: 'Link de pagamento', icone: '🔗', dica: 'Endereço começando com https://', copiavel: false },
  outro:    { rotulo: 'Outra forma', icone: '💬', dica: 'Explique como pagar', copiavel: false },
}
export const MAX_FORMAS = 8
const LIMITE_DETALHE = 300
const LIMITE_ROTULO = 60

export function linkHttpsSeguro(s) {
  try {
    const u = new URL(String(s || '').trim())
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null
  } catch { return null }
}

function limpar(f) {
  if (!f || typeof f !== 'object' || !TIPOS_FORMA[f.tipo]) return null
  const detalhe = String(f.detalhe ?? '').trim().slice(0, LIMITE_DETALHE)
  if (!detalhe) return null
  if (f.tipo === 'link' && !linkHttpsSeguro(detalhe)) return null
  return { tipo: f.tipo, rotulo: String(f.rotulo ?? '').trim().slice(0, LIMITE_ROTULO), detalhe }
}

// Lê o que está no banco. Sem lista nova, aproveita a chave PIX antiga.
export function lerFormas(mapa = {}) {
  let formas = []
  try {
    const arr = JSON.parse(mapa.formas_pagamento || '[]')
    if (Array.isArray(arr)) formas = arr.map(limpar).filter(Boolean).slice(0, MAX_FORMAS)
  } catch { /* JSON ruim = como se não houvesse */ }
  if (!formas.length && (mapa.pix || '').trim()) formas = [{ tipo: 'pix', rotulo: '', detalhe: mapa.pix.trim().slice(0, LIMITE_DETALHE) }]
  const v = Number(String(mapa.mensalidade_valor ?? '').replace(',', '.'))
  return { formas, valor: Number.isFinite(v) && v > 0 ? v : null }
}

// Valida o que a diretoria digitou. Devolve { erro } ou as linhas para `config_gravar`.
export function serializarFormas({ formas, valor }) {
  const limpas = []
  for (const f of formas || []) {
    const detalhe = String(f?.detalhe ?? '').trim()
    if (!detalhe) continue // linha em branco: ignora
    const ok = limpar(f)
    if (!ok) return { erro: f?.tipo === 'link' ? 'O link de pagamento precisa começar com https://' : 'Confira as formas de pagamento.' }
    limpas.push(ok)
  }
  if (limpas.length > MAX_FORMAS) return { erro: `No máximo ${MAX_FORMAS} formas de pagamento.` }
  const txt = String(valor ?? '').trim().replace(',', '.')
  const v = txt === '' ? null : Number(txt)
  if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100000)) return { erro: 'Valor da mensalidade inválido.' }
  const primeiroPix = limpas.find((f) => f.tipo === 'pix')
  return {
    linhas: [
      { chave: 'formas_pagamento', valor: JSON.stringify(limpas) },
      { chave: 'mensalidade_valor', valor: v ? String(v) : '' },
      { chave: 'pix', valor: primeiroPix ? primeiroPix.detalhe : '' },
    ],
  }
}

export const dinheiroBR = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 })
