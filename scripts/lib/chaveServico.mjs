// =============================================================================
//  Chave de SERVIÇO (e pública) dos scripts de manutenção/teste que falam com o projeto HOSPEDADO — num lugar só.
//
//  Por quê: os scripts pegavam a chave `service_role` LEGACY (JWT) pela Management API (`name === 'service_role'`). Quando as chaves legacy forem
//  desativadas no painel, todos quebrariam de uma vez. Este helper PREFERE a chave nova (`type: 'secret'`, `sb_secret_…`) e só cai na legacy
//  se a nova não existir — com aviso — para a transição.
//
//  Ordem (serviço):  1. SB_SECRET_KEY no ambiente (`sb_secret_…`; útil contra o Supabase LOCAL, sem chamar a Management API)
//                    2. Management API: chave `type === 'secret'` (a `default` primeiro)
//                    3. Management API: `name === 'service_role'` (LEGACY) + aviso
//                    CHAVES_EXIGIR_NOVA=1 (ou `exigirNova: true`) proíbe o passo 3: sem chave nova, falha fechada.
//  Ordem (pública):  SB_PUBLISHABLE_KEY -> `type === 'publishable'` -> `name === 'anon'` (LEGACY) + aviso.
//
//  Garantias: o VALOR nunca é impresso nem vai em mensagem de erro (propriedade não enumerável; erros genéricos, sem corpo de resposta);
//  só GET na Management API (fixa: o token pessoal nunca vai para outro host); chave com máscara (••• ou ***) é descartada.
//  O PRIVILÉGIO não aumenta: a secret key tem o mesmo poder da service_role (ignora RLS), só que revogável por chave.
// =============================================================================
export const API_GESTAO = 'https://api.supabase.com'
const MASCARADA = /[•*…]/
const REF_OK = /^[a-z0-9]{16,32}$/

function montar(valor, origem, nome) {
  const r = { origem, nome }
  Object.defineProperty(r, 'valor', { value: valor, enumerable: false })
  Object.defineProperty(r, 'toString', { value: () => `[chave ${origem} oculta]`, enumerable: false })
  Object.defineProperty(r, 'toJSON', { value: () => ({ origem, nome }), enumerable: false })
  return r
}

const utilizavel = (k, prefixo) => typeof k?.api_key === 'string' && k.api_key.startsWith(prefixo) && !MASCARADA.test(k.api_key)
const ehJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && !MASCARADA.test(v)

/** PURA: escolhe a chave na lista devolvida pela Management API. `tipo`: 'servico' | 'publica'. Devolve { chave, aviso } ou lança. */
export function escolherChave(lista, tipo, { exigirNova = false } = {}) {
  const itens = Array.isArray(lista) ? lista : []
  const [tipoNovo, prefixo, nomeLegacy] = tipo === 'servico' ? ['secret', 'sb_secret_', 'service_role'] : ['publishable', 'sb_publishable_', 'anon']
  const novas = itens.filter((k) => k?.type === tipoNovo && utilizavel(k, prefixo)).sort((a, b) => (b.name === 'default') - (a.name === 'default'))
  if (novas.length) return { chave: montar(novas[0].api_key, 'nova', String(novas[0].name ?? tipoNovo)), aviso: null }
  const legacy = itens.find((k) => k?.name === nomeLegacy && ehJwt(k.api_key))
  if (legacy && !exigirNova) {
    return { chave: montar(legacy.api_key, 'legacy', nomeLegacy), aviso: `AVISO: não há chave ${tipoNovo} utilizável no projeto; usando a chave ${nomeLegacy} LEGACY (será desativada). Crie uma ${tipoNovo === 'secret' ? 'secret key (sb_secret_…)' : 'publishable key (sb_publishable_…)'} no painel.` }
  }
  throw new Error(exigirNova
    ? `Não há chave ${tipoNovo} utilizável e o uso da chave legacy foi proibido (CHAVES_EXIGIR_NOVA).`
    : `Nenhuma chave ${tipo === 'servico' ? 'de serviço' : 'pública'} utilizável retornada pela Management API.`)
}

async function listarChaves({ ref, token, fetchImpl }) {
  if (!REF_OK.test(String(ref ?? ''))) throw new Error('Referência de projeto inválida.')
  if (!token) throw new Error('Falta o token da Management API (SUPABASE_ACCESS_TOKEN).')
  const get = (q) => fetchImpl(`${API_GESTAO}/v1/projects/${ref}/api-keys${q}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  // reveal=true devolve o valor COMPLETO das secret keys (sem ele a API mascara); se a API não aceitar o parâmetro, tenta sem.
  let r = await get('?reveal=true')
  if (r.status === 400 || r.status === 422) r = await get('')
  if (!r.ok) throw new Error(`Management API respondeu HTTP ${r.status} ao listar as chaves.`)
  return r.json()
}

async function obter(tipo, { ref, token, env = process.env, fetchImpl = fetch, avisar = (m) => console.error(m), exigirNova } = {}) {
  const exigir = exigirNova ?? env.CHAVES_EXIGIR_NOVA === '1'
  const [varNome, prefixo] = tipo === 'servico' ? ['SB_SECRET_KEY', 'sb_secret_'] : ['SB_PUBLISHABLE_KEY', 'sb_publishable_']
  const doEnv = String(env[varNome] ?? '').trim()
  if (doEnv.startsWith(prefixo)) return montar(doEnv, 'nova', `env:${varNome}`)
  const { chave, aviso } = escolherChave(await listarChaves({ ref, token, fetchImpl }), tipo, { exigirNova: exigir })
  if (aviso) avisar(aviso)
  return chave
}

/** Chave de serviço (privilégio total). Prefere a secret nova; cai na service_role legacy com aviso. */
export const obterChaveServico = (opts) => obter('servico', opts)
/** Chave pública (publishable; cai na anon legacy com aviso). */
export const obterChavePublica = (opts) => obter('publica', opts)

/**
 * Cabeçalhos de uma chamada REST/Storage com a chave. Chave nova: SÓ `apikey` (a sb_secret_ não é um JWT; o gateway a converte — mandá-la
 * como `Authorization: Bearer` é desnecessário e foi recusado sozinha). Chave legacy: `apikey` + `Authorization: Bearer`, como antes.
 */
export function cabecalhosServico(chave, extra = {}) {
  const v = chave.valor
  return chave.origem === 'nova' ? { apikey: v, ...extra } : { apikey: v, Authorization: `Bearer ${v}`, ...extra }
}
