// Limpeza de fotos ÓRFÃS de comprovação de requisito (migration 173).
//
// O que faz: pergunta ao banco (RPC comprovacoes_orfas, só service_role) quais objetos do bucket
// 'comprovacoes' no prefixo <uid>/requisitos/ têm mais de N dias (mínimo 7) e NÃO são referenciados
// por member_requirements / requirement_submissions / member_specialty_requirements / snapshot selado.
// Por padrão só LISTA. Com --apagar, remove pela API do Storage (que apaga o arquivo físico; DELETE
// direto em storage.objects é proibido pelo Supabase). Antes de apagar cada lote, pergunta de novo ao
// banco — o que deixou de ser órfão no meio do caminho não é apagado.
//
// Uso (a chave de serviço vem do ambiente; nunca fica no repositório):
//   SUPABASE_URL=https://xxx.supabase.co SERVICE_ROLE_KEY=... node scripts/limpar-comprovacoes-orfas.mjs
//   ... node scripts/limpar-comprovacoes-orfas.mjs --dias 14 --apagar
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const apagar = args.includes('--apagar')
const iDias = args.indexOf('--dias')
const dias = Math.max(7, iDias >= 0 ? Number(args[iDias + 1]) || 7 : 7)
const url = process.env.SUPABASE_URL
const chave = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !chave) {
  console.error('Defina SUPABASE_URL e SERVICE_ROLE_KEY no ambiente.')
  process.exit(2)
}
const sb = createClient(url, chave, { auth: { persistSession: false } })

async function orfas() {
  const { data, error } = await sb.rpc('comprovacoes_orfas', { p_dias: dias, p_limite: 500 })
  if (error) throw new Error(error.message)
  return data || []
}

const lista = await orfas()
const total = lista.reduce((s, o) => s + Number(o.bytes || 0), 0)
console.log(`${lista.length} foto(s) órfã(s) com mais de ${dias} dias (${(total / 1048576).toFixed(1)} MB).`)
for (const o of lista.slice(0, 20)) console.log(`  ${o.criado_em}  ${o.nome}`)
if (!apagar) {
  console.log('Só listagem. Rode de novo com --apagar para remover.')
  process.exit(0)
}
// confirma de novo com o banco (nada que virou referenciado é apagado) e remove em lotes de 100
const aindaOrfas = new Set((await orfas()).map((o) => o.nome))
const alvo = lista.map((o) => o.nome).filter((n) => aindaOrfas.has(n) && /^[0-9a-f-]{36}\/requisitos\/[^/]+$/.test(n))
let apagadas = 0
for (let i = 0; i < alvo.length; i += 100) {
  const lote = alvo.slice(i, i + 100)
  const { data, error } = await sb.storage.from('comprovacoes').remove(lote)
  if (error) { console.error('Falhou um lote:', error.message); continue }
  apagadas += (data || []).length
}
console.log(`Apagadas: ${apagadas}.`)
