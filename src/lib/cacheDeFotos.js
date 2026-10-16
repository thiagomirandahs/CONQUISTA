// Fotos privadas guardadas NO APARELHO (Cache Storage), pela chave dono + bucket + caminho — economia de 4G e da cota de saída.
//
// Por que (16/10/2026): a URL assinada vale 10 min (política de segurança em imagens/politica.js) e muda de token a cada
// renovação; URL nova = o navegador baixa a mesma foto de novo. Medido em produção: 2,59 GB de saída em 18 dias para ~50 pessoas.
// Os caminhos dos nossos arquivos são ÚNICOS e IMUTÁVEIS (uuid/timestamp no nome; trocar a foto gera outro caminho), então o
// conteúdo baixado uma vez vale para sempre: guardamos o arquivo e o <img> usa um blob: local.
//
// Regras:
//  * POR USUÁRIO: cada pessoa tem o seu cache (nome do cache leva o id). Sair da conta / trocar de conta apaga os de outra pessoa
//    — num celular compartilhado ninguém vê a foto que outra conta baixou;
//  * só IMAGEM (o tipo da resposta precisa ser image/*) e até 3 MB: vídeo nunca entra;
//  * a URL assinada continua sendo pedida ao Storage quando a foto ainda não está no aparelho (a policy do clube decide quem vê);
//  * no máximo MAX_FOTOS fotos por pessoa (as mais antigas saem primeiro);
//  * sem Cache Storage (navegador antigo, modo privado): devolve null e o app segue com a URL assinada, como antes.
const PREFIXO = 'dbv-fotos-'
export const MAX_FOTOS = 500
const MAX_BYTES = 3 * 1024 * 1024

const urls = new Map()   // `${bucket}/${caminho}` -> blob: URL (memória desta sessão)
let dono = null

const disponivel = () => typeof caches !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
const nomeDoCache = (uid) => PREFIXO + uid
const chave = (bucket, caminho) => `${bucket}/${caminho}`
// URL sintética (domínio .invalid nunca resolve): só serve de CHAVE dentro do Cache Storage.
const pedido = (bucket, caminho) => new Request(`https://fotos.desbravaclube.invalid/${encodeURIComponent(bucket)}/${encodeURI(caminho)}`)

function soltarUrls() {
  for (const u of urls.values()) { try { URL.revokeObjectURL(u) } catch { /* ok */ } }
  urls.clear()
}

// Chamado pela Auth (via imagens.js/fotosComunidade.js) quando a sessão muda. Mesma pessoa voltando reaproveita o que já baixou.
export async function definirDonoDasFotos(uid) {
  const novo = uid || null
  if (novo === dono) return
  dono = novo
  soltarUrls()
  if (!disponivel()) return
  try {
    for (const nome of await caches.keys()) {
      if (nome.startsWith(PREFIXO) && nome !== (novo ? nomeDoCache(novo) : '')) await caches.delete(nome)
    }
  } catch { /* sem acesso ao cache: nada a limpar */ }
}

// Já pronta nesta sessão (sem esperar nada): para o 1º render não piscar.
export function fotoLocalPronta(bucket, caminho) {
  return urls.get(chave(bucket, caminho)) || null
}

// Foto já guardada no aparelho → blob: URL; senão null.
export async function fotoLocal(bucket, caminho) {
  if (!dono || !caminho || !disponivel()) return null
  const k = chave(bucket, caminho)
  if (urls.has(k)) return urls.get(k)
  const donoDoPedido = dono
  try {
    const cache = await caches.open(nomeDoCache(donoDoPedido))
    const r = await cache.match(pedido(bucket, caminho))
    if (!r) return null
    const blob = await r.blob()
    if (donoDoPedido !== dono) return null
    const u = URL.createObjectURL(blob)
    urls.set(k, u)
    return u
  } catch { return null }
}

async function podar(cache) {
  try {
    const itens = await cache.keys()
    for (const req of itens.slice(0, Math.max(0, itens.length - MAX_FOTOS))) await cache.delete(req)
  } catch { /* ok */ }
}

// Baixa UMA vez pela URL assinada e guarda no aparelho. Devolve a blob: URL, ou null (aí use a URL assinada mesmo).
export async function guardarFoto(bucket, caminho, urlAssinada) {
  if (!dono || !caminho || !urlAssinada || !disponivel()) return null
  const donoDoPedido = dono
  try {
    const r = await fetch(urlAssinada, { credentials: 'omit' })
    if (!r.ok) return null
    const tipo = r.headers.get('content-type') || ''
    if (!tipo.startsWith('image/')) return null
    const copia = r.clone()                 // a cópia vai para o Cache Storage; a original vira o blob desta tela
    const blob = await r.blob()
    if (!blob.size || blob.size > MAX_BYTES || donoDoPedido !== dono) return null
    const cache = await caches.open(nomeDoCache(donoDoPedido))
    await cache.put(pedido(bucket, caminho), copia)
    podar(cache)
    const u = URL.createObjectURL(blob)
    urls.set(chave(bucket, caminho), u)
    return u
  } catch { return null }
}

// Só para teste.
export function _reiniciarCacheDeFotos() { soltarUrls(); dono = null }
