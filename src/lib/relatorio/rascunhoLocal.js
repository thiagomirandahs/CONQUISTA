// Rascunho OFFLINE do relatório estruturado: o que a criança digitou fica guardado NESTE aparelho
// (localStorage) enquanto o 4G cai e volta. Só guarda rascunho — nunca envia nada para avaliação.
//
//  chave:  cq.rel.<userId>.<alvo>.<requirementId>          (alvo = 'classe' | 'especialidade')
//  valor:  { v:1, conteudo, anexos, base, editadoEm, sincronizado }
//          `base` = hash do rascunho DO SERVIDOR sobre o qual o local foi editado (detecta conflito).
//  backup: a mesma chave + ".backup" — a versão que NÃO foi escolhida num conflito (ou o texto de um
//          requisito que já foi enviado/aprovado). Recuperável enquanto o requisito não for enviado.
//
// Tudo em try/catch: storage bloqueado/cheio nunca quebra a tela (cai para "só servidor", sem erro visível).

export const PREFIXO_LOCAL = 'cq.rel.'
const SUFIXO_BACKUP = '.backup'

export const chaveLocalDe = (userId, alvo, requirementId) => (
  userId && alvo && requirementId ? `${PREFIXO_LOCAL}${userId}.${alvo}.${requirementId}` : null
)

function armazenamento() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

// JSON canônico (chaves ordenadas): o mesmo conteúdo dá sempre o mesmo texto, em qualquer ordem de chaves.
function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

// Hash curto e estável (cyrb53) do rascunho. Servidor sem rascunho (null) = { } e [ ].
export function hashRascunho(conteudo, anexos) {
  const s = canonico({ c: conteudo ?? {}, a: anexos ?? [] })
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function ler(chave) {
  const st = armazenamento()
  if (!st || !chave) return null
  try {
    const v = JSON.parse(st.getItem(chave) || 'null')
    return v && v.v === 1 && typeof v.conteudo === 'object' ? v : null
  } catch { return null }
}
function gravar(chave, valor) {
  const st = armazenamento()
  if (!st || !chave) return false
  try { st.setItem(chave, JSON.stringify({ v: 1, ...valor })); return true } catch { return false }
}
function apagar(chave) {
  const st = armazenamento()
  if (!st || !chave) return
  try { st.removeItem(chave) } catch { /* ok */ }
}

export const lerLocal = (chave) => ler(chave)
export function gravarLocal(chave, { conteudo, anexos, base, sincronizado = false }, agora = Date.now()) {
  return gravar(chave, { conteudo: conteudo ?? {}, anexos: anexos ?? [], base: base ?? null, editadoEm: agora, sincronizado })
}
export const limparLocal = (chave) => { apagar(chave); apagar(chave ? chave + SUFIXO_BACKUP : null) } // envio bem-sucedido: local E backup
export const apagarSoLocal = (chave) => apagar(chave) // só o principal (o backup fica)
export const lerBackup = (chave) => (chave ? ler(chave + SUFIXO_BACKUP) : null)
export const gravarBackup = (chave, { conteudo, anexos }, agora = Date.now()) => (
  chave ? gravar(chave + SUFIXO_BACKUP, { conteudo: conteudo ?? {}, anexos: anexos ?? [], base: null, editadoEm: agora, sincronizado: false }) : false
)

// Remove todos os rascunhos (e backups) deste aparelho — ou só os de um usuário. Chamado ao sair da conta.
export function limparRascunhosLocais(userId = null) {
  const st = armazenamento()
  if (!st) return 0
  const prefixo = userId ? `${PREFIXO_LOCAL}${userId}.` : PREFIXO_LOCAL
  let n = 0
  try {
    const chaves = []
    for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k && k.startsWith(prefixo)) chaves.push(k) }
    chaves.forEach((k) => { st.removeItem(k); n++ })
  } catch { /* ok */ }
  return n
}

// Requisito que já não aceita edição (enviado/aprovado) mas tem texto local ainda não sincronizado:
// o local sai do lugar principal e vira CÓPIA DE SEGURANÇA (nada se perde). Devolve true se havia o que guardar.
export function descartarLocalComBackup(chave) {
  const local = ler(chave)
  if (!local) return false
  const pendente = local.sincronizado !== true
  if (pendente) gravarBackup(chave, local)
  apagar(chave)
  return pendente
}

// Decide o que fazer ao abrir o formulário. `servidor` = { conteudo, anexos, editavel }.
//  'servidor'        usa o do servidor (limpar:true → o local era igual/já sincronizado e pode ser apagado)
//  'local'           servidor não mudou desde a edição local → usa o local e sincroniza (sem conflito)
//  'conflito'        local pendente E servidor diferente da base → NUNCA sobrescrever em silêncio
//  'descartar-local' requisito já enviado/aprovado com local pendente → cópia de segurança + aviso
export function decidirCarga({ local, servidor }) {
  if (!local) return { acao: 'servidor' }
  const hashServidor = hashRascunho(servidor?.conteudo, servidor?.anexos)
  if (servidor && servidor.editavel === false) {
    return local.sincronizado === true || hashRascunho(local.conteudo, local.anexos) === hashServidor
      ? { acao: 'servidor', limpar: true }
      : { acao: 'descartar-local', backup: true }
  }
  if (local.sincronizado === true || hashRascunho(local.conteudo, local.anexos) === hashServidor) return { acao: 'servidor', limpar: true }
  if (local.base != null && local.base === hashServidor) return { acao: 'local' }
  return { acao: 'conflito' }
}
