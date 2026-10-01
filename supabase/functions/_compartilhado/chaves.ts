// Leitura CENTRALIZADA das chaves do projeto nas Edge Functions (Deno/TypeScript, sem dependências).
//
// Por que existe: o projeto tem DOIS pares de chaves — as LEGACY (`anon` / `service_role`, JWT) e as NOVAS
// (`sb_publishable_…` / `sb_secret_…`). As funções não podem depender, sem querer, das legacy: quando o dono desativar as legacy
// no painel, a função precisa seguir de pé usando as novas. E, enquanto só as legacy existirem (ou só as novas), nada pode quebrar.
//
// ORDEM (explícita; a primeira que existir e tiver o formato certo vence):
//   chave de SERVIÇO (privilégio total; só no servidor):
//     1. SB_SECRET_KEY                 secret NOSSA, configurada por função/ambiente (`sb_secret_…`)
//     2. SUPABASE_SECRET_KEYS          JSON injetado pela plataforma: {"default":"sb_secret_…", …}  (usa "default" ou a primeira `sb_secret_`)
//     3. SUPABASE_SERVICE_ROLE_KEY     LEGACY (transição) — origem 'legacy'
//   chave PÚBLICA (cliente "como o usuário"; o JWT dele vai no Authorization):
//     1. SB_PUBLISHABLE_KEY            (`sb_publishable_…`)
//     2. SUPABASE_PUBLISHABLE_KEYS     JSON injetado pela plataforma: {"default":"sb_publishable_…", …}
//     3. SUPABASE_ANON_KEY             LEGACY (transição) — origem 'legacy'
//
// CHAVES_MODO (opcional; também é uma "alavanca de rollback" sem redeploy de código):
//   'auto'   (padrão) nova -> legacy, como acima;
//   'nova'   só as novas; se não houver, FALHA FECHADA (usar quando as legacy já foram desativadas, para ninguém depender delas);
//   'legacy' só as legacy (voltar ao comportamento anterior ao primeiro uso das novas).
//
// Garantias:
//   * o valor da chave NUNCA aparece em erro, log, JSON ou template string: o objeto devolvido guarda o valor numa propriedade
//     NÃO enumerável (`.valor`); `JSON.stringify`, `console.log` e `${...}` mostram só a origem e o NOME da variável;
//   * sem nenhuma chave utilizável: lança Error com mensagem GENÉRICA (falha fechada), sem dizer qual variável nem o valor;
//   * valor com espaço/quebra de linha nas pontas é aparado (secret colada com "\n" é comum); valor fora do formato esperado
//     (ex.: um JWT em SB_SECRET_KEY) é IGNORADO, nunca usado por engano.

export type Origem = 'nova' | 'legacy'

export interface ChaveResolvida {
  /** Valor da chave. Propriedade NÃO enumerável: não vai para JSON.stringify/console.log. Nunca registre nem devolva isto. */
  readonly valor: string
  readonly origem: Origem
  /** NOME da variável de ambiente de onde veio (nunca o valor). */
  readonly fonte: string
}

type LeitorEnv = (nome: string) => string | undefined

const PREFIXO_SERVICO = 'sb_secret_'
const PREFIXO_PUBLICA = 'sb_publishable_'
const ERRO_GENERICO = 'Chaves do projeto indisponíveis (configuração da função).'

function leitorPadrao(): LeitorEnv {
  return (nome) => {
    try { return (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(nome) } catch { return undefined }
  }
}

function limpo(v: string | undefined): string {
  return typeof v === 'string' ? v.trim() : ''
}

function modo(env: LeitorEnv): 'auto' | 'nova' | 'legacy' {
  const m = limpo(env('CHAVES_MODO')).toLowerCase()
  return m === 'nova' || m === 'legacy' ? m : 'auto'
}

/** Extrai a chave de um JSON de chaves da plataforma. Aceita {"default":"sb_…"}, {"nome":{"api_key":"sb_…"}} ou ["sb_…"]. */
function dePacote(bruto: string | undefined, prefixo: string): string {
  const txt = limpo(bruto)
  if (!txt) return ''
  let j: unknown
  try { j = JSON.parse(txt) } catch { return '' }
  const valorDe = (x: unknown): string => {
    if (typeof x === 'string') return x.trim()
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      for (const k of ['api_key', 'key', 'value']) if (typeof o[k] === 'string') return (o[k] as string).trim()
    }
    return ''
  }
  const candidatos: string[] = []
  if (Array.isArray(j)) {
    for (const x of j) candidatos.push(valorDe(x))
  } else if (j && typeof j === 'object') {
    const o = j as Record<string, unknown>
    if ('default' in o) candidatos.push(valorDe(o.default))
    for (const [k, x] of Object.entries(o)) if (k !== 'default') candidatos.push(valorDe(x))
  } else if (typeof j === 'string') {
    candidatos.push(j.trim())
  }
  return candidatos.find((c) => c.startsWith(prefixo)) ?? ''
}

function montar(valor: string, origem: Origem, fonte: string): ChaveResolvida {
  const r = { origem, fonte } as { origem: Origem; fonte: string }
  Object.defineProperty(r, 'valor', { value: valor, enumerable: false })
  Object.defineProperty(r, 'toString', { value: () => `[chave ${origem} oculta]`, enumerable: false })
  Object.defineProperty(r, 'toJSON', { value: () => ({ origem, fonte }), enumerable: false })
  return r as unknown as ChaveResolvida
}

function resolver(env: LeitorEnv, p: { propria: string; pacote: string; legacy: string; prefixo: string }): ChaveResolvida {
  const m = modo(env)
  if (m !== 'legacy') {
    const propria = limpo(env(p.propria))
    if (propria.startsWith(p.prefixo)) return montar(propria, 'nova', p.propria)
    const doPacote = dePacote(env(p.pacote), p.prefixo)
    if (doPacote) return montar(doPacote, 'nova', p.pacote)
  }
  if (m !== 'nova') {
    const legacy = limpo(env(p.legacy))
    // a legacy é JWT (três partes separadas por ponto); qualquer outra coisa é configuração errada e é ignorada
    if (legacy.split('.').length === 3) return montar(legacy, 'legacy', p.legacy)
  }
  throw new Error(ERRO_GENERICO)
}

/** Chave de SERVIÇO (privilégio total). Só para operações que realmente exigem service role (Storage admin, RPC só-serviço). */
export function chaveServico(env: LeitorEnv = leitorPadrao()): ChaveResolvida {
  return resolver(env, { propria: 'SB_SECRET_KEY', pacote: 'SUPABASE_SECRET_KEYS', legacy: 'SUPABASE_SERVICE_ROLE_KEY', prefixo: PREFIXO_SERVICO })
}

/** Chave PÚBLICA (publishable/anon). Para o cliente "como o usuário": o JWT dele vai no header Authorization. */
export function chavePublica(env: LeitorEnv = leitorPadrao()): ChaveResolvida {
  return resolver(env, { propria: 'SB_PUBLISHABLE_KEY', pacote: 'SUPABASE_PUBLISHABLE_KEYS', legacy: 'SUPABASE_ANON_KEY', prefixo: PREFIXO_PUBLICA })
}

/** URL do projeto (SUPABASE_URL, injetada). Falha fechada se faltar. */
export function urlProjeto(env: LeitorEnv = leitorPadrao()): string {
  const u = limpo(env('SUPABASE_URL')).replace(/\/+$/, '')
  if (!u) throw new Error(ERRO_GENERICO)
  return u
}

/** Resumo SEGURO para log de inicialização (origem e nome da variável; nunca o valor). `null` = indisponível. */
export function resumoDasChaves(env: LeitorEnv = leitorPadrao(), usaPublica = false): string {
  const um = (f: () => ChaveResolvida) => { try { const k = f(); return `${k.origem}:${k.fonte}` } catch { return 'indisponivel' } }
  return JSON.stringify({ servico: um(() => chaveServico(env)), ...(usaPublica ? { publica: um(() => chavePublica(env)) } : {}), modo: modo(env) })
}
