// Editor de planos (/admin → Planos): conversões puras entre o que a pessoa digita (reais, "229,90") e o que o servidor guarda
// (centavos inteiros). Dinheiro NUNCA passa por ponto flutuante: a conta é feita em texto/inteiros.
export const LIMITES = [
  ['membros', 'Membros'], ['administradores', 'Administradores'], ['clubes', 'Clubes'], ['fotos', 'Fotos'], ['armazenamento_mb', 'Armazenamento (MB)'],
]
export const CICLOS = [['anual', 'Anual'], ['mensal', 'Mensal']]

// "229,90" | "229.90" | "R$ 1.299,90" | "230" -> centavos (number) ; vazio -> null ; inválido -> NaN
export function reaisParaCentavos(texto) {
  const t = String(texto ?? '').replace(/R\$/gi, '').replace(/\s/g, '')
  if (t === '') return null
  // formato brasileiro (vírgula decimal, ponto de milhar) ou simples (ponto decimal)
  let normal = t
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '') // ponto só como milhar (1.299 = 1299)
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return NaN
  const [inteiro, frac = ''] = normal.split('.')
  return Number(inteiro) * 100 + Number((frac + '00').slice(0, 2))
}

// centavos -> "229,90" (campo de texto)
export function centavosParaCampo(centavos) {
  if (centavos == null || centavos === '') return ''
  const c = Math.round(Number(centavos))
  return `${Math.floor(c / 100)},${String(c % 100).padStart(2, '0')}`
}

// valor da parcela, arredondado para CIMA (nunca cobra menos do que o total)
export function parcelaCentavos(totalCentavos, parcelas) {
  const n = Number(parcelas)
  if (!Number.isInteger(n) || n < 1) return null
  return Math.ceil(Number(totalCentavos) / n)
}

// formulário <- plano do servidor (versão publicada vira ponto de partida de um rascunho)
export function formDoPlano(plano) {
  const precos = Object.fromEntries((plano?.precos || []).filter((p) => p.ativo !== false).map((p) => [p.ciclo, p]))
  const f = {
    chave: plano?.chave || '', nome: plano?.nome || '', descricao: plano?.descricao || '', publico: plano ? plano.publico !== false : true,
    ciclos: {}, limites: {},
  }
  for (const [c] of CICLOS) {
    const p = precos[c]
    f.ciclos[c] = {
      oferecer: !!p, valor: centavosParaCampo(p?.valor_centavos), pix: centavosParaCampo(p?.metadata?.pix_centavos),
      parcelas: p?.metadata?.parcelas_cartao ? String(p.metadata.parcelas_cartao) : '',
    }
  }
  for (const [k] of LIMITES) f.limites[k] = plano?.limites?.[k] != null ? String(plano.limites[k]) : ''
  return f
}

// formulário -> argumentos da RPC. Devolve { erro } se algo estiver errado (mensagem em português) ou { args }.
export function argsDoForm(f) {
  const nome = f.nome.trim()
  if (nome.length < 3) return { erro: 'Dê um nome ao plano (pelo menos 3 letras).' }
  const precos = []
  for (const [c, rotulo] of CICLOS) {
    const x = f.ciclos[c]
    if (!x?.oferecer) continue
    const valor = reaisParaCentavos(x.valor)
    if (valor == null || Number.isNaN(valor)) return { erro: `Informe o valor ${rotulo.toLowerCase()} (ex.: 229,90).` }
    const item = { ciclo: c, valor_centavos: valor }
    if (x.pix.trim() !== '') {
      const pix = reaisParaCentavos(x.pix)
      if (Number.isNaN(pix)) return { erro: `O preço no Pix (${rotulo.toLowerCase()}) está inválido (ex.: 199,90).` }
      if (pix > valor) return { erro: `O preço no Pix (${rotulo.toLowerCase()}) não pode ser maior que o valor cheio.` }
      item.pix_centavos = pix
    }
    if (x.parcelas.trim() !== '') {
      const n = Number(x.parcelas)
      if (!Number.isInteger(n) || n < 1 || n > 12) return { erro: 'As parcelas no cartão vão de 1 a 12.' }
      item.parcelas_cartao = n
      item.parcela_centavos = parcelaCentavos(valor, n)
    }
    precos.push(item)
  }
  const limites = {}
  for (const [k, rotulo] of LIMITES) {
    const t = String(f.limites[k] ?? '').trim()
    if (t === '') { limites[k] = null; continue }
    if (!/^\d+$/.test(t)) return { erro: `O limite de ${rotulo.toLowerCase()} precisa ser um número inteiro (ou vazio para ilimitado).` }
    limites[k] = Number(t)
  }
  return { args: { chave: f.chave.trim().toLowerCase(), nome, descricao: f.descricao.trim(), publico: !!f.publico, limites, precos } }
}

// "plano-novo" a partir do nome (só quando a pessoa cria um plano do zero)
export function chaveDoNome(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}
