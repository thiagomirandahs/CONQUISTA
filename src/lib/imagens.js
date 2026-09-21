// Imagens PRIVADAS do bucket 'imagens' (avatar, foto do mural, emblema/bandeira de unidade).
//
// O bucket deixou de ser público (migration 32): quem tem só a URL não abre mais a foto de uma criança. O banco continua
// guardando a URL de sempre (…/storage/v1/object/public/imagens/<caminho> — formato que o front/APK antigos entendem); para
// EXIBIR, este módulo troca por uma URL ASSINADA, que o Storage só entrega a quem passa na policy do clube (migration 31).
//
// Regras deste módulo:
//  * só mexe em URL do bucket 'imagens' — qualquer outra URL (externa, blob:, data:) passa direto;
//  * pedidos do mesmo instante viram UMA chamada (createSignedUrls) e o mesmo caminho nunca é pedido duas vezes;
//  * a URL assinada dura 24 h e fica guardada (memória + localStorage, POR USUÁRIO): a URL estável mantém o cache HTTP do
//    navegador funcionando — sem isso todo avatar seria baixado de novo a cada abertura do app (rede móvel!);
//  * se a assinatura falhar (rede, front novo antes do SQL, arquivo que não existe mais) devolve a URL ORIGINAL: com o bucket
//    ainda público ela abre; com o bucket privado o <img> falha e o Avatar cai nas iniciais. Falha é lembrada por 1 min
//    (sem tempestade de pedidos);
//  * sair da conta (ou trocar de usuário) apaga tudo: um aparelho compartilhado nunca reaproveita a URL de outra pessoa.
import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

const BUCKET = 'imagens'
const VALIDADE_S = 24 * 60 * 60
const MARGEM_MS = 2 * 60 * 60 * 1000       // só reaproveita se ainda restarem 2 h de validade
const FALHA_MS = 60 * 1000
const LOTE = 100
const CHAVE_LOCAL = 'cq.imagens.v1'
const MAX_LOCAL = 300

const RE_URL = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/imagens\/([^?#]+)/

const cache = new Map()        // caminho -> { url, ate }   (url null = falhou; ate = ms epoch)
const pendentes = new Map()    // caminho -> [resolve, ...]
let dono = null                // id do usuário dono do cache
let agendado = false
let salvando = null

// Caminho no bucket de um valor guardado no banco; null se não for arquivo do bucket 'imagens'.
export function caminhoDaImagem(valor) {
  if (typeof valor !== 'string') return null
  const m = valor.match(RE_URL)
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return m[1] }
}

// ---- persistência local (por usuário) ----
function lerLocal(uid) {
  try {
    const bruto = localStorage.getItem(CHAVE_LOCAL)
    if (!bruto) return
    const o = JSON.parse(bruto)
    if (o?.uid !== uid || !o.itens) return
    const agora = Date.now()
    for (const [caminho, v] of Object.entries(o.itens)) {
      if (Array.isArray(v) && typeof v[0] === 'string' && v[1] - agora > MARGEM_MS) cache.set(caminho, { url: v[0], ate: v[1] })
    }
  } catch { /* storage bloqueado ou corrompido: só perde o cache */ }
}

function agendarSalvar() {
  if (salvando) return
  salvando = setTimeout(() => {
    salvando = null
    try {
      if (!dono) return
      const agora = Date.now()
      const validos = [...cache.entries()].filter(([, v]) => v.url && v.ate - agora > MARGEM_MS)
      validos.sort((a, b) => b[1].ate - a[1].ate)          // os mais novos primeiro
      const itens = {}
      for (const [caminho, v] of validos.slice(0, MAX_LOCAL)) itens[caminho] = [v.url, v.ate]
      localStorage.setItem(CHAVE_LOCAL, JSON.stringify({ uid: dono, itens }))
    } catch { /* cota cheia/bloqueado: segue só com a memória */ }
  }, 500)
}

// Chamado pela Auth quando a sessão muda (login, logout, troca de conta). Trocou de pessoa ou saiu => cache zerado e o
// armazenamento local apagado; a MESMA pessoa voltando reaproveita o que já tinha assinado (dentro da validade).
export function definirUsuarioImagens(uid) {
  const novo = uid || null
  if (novo === dono) return
  dono = novo
  cache.clear()
  if (salvando) { clearTimeout(salvando); salvando = null }
  try {
    const bruto = localStorage.getItem(CHAVE_LOCAL)
    if (!bruto) return
    if (novo && JSON.parse(bruto)?.uid === novo) lerLocal(novo)
    else localStorage.removeItem(CHAVE_LOCAL)
  } catch {
    try { localStorage.removeItem(CHAVE_LOCAL) } catch { /* sem storage */ }
  }
}

function valida(entrada) {
  if (!entrada) return false
  if (!entrada.url) return entrada.ate > Date.now()                     // falha lembrada por 1 min
  return entrada.ate - Date.now() > MARGEM_MS
}

// URL já pronta (sem rede) ou null. Para o 1º render não piscar.
export function urlAssinadaEmCache(valor) {
  const caminho = caminhoDaImagem(valor)
  if (!caminho) return valor || null
  const e = cache.get(caminho)
  return e && e.url && valida(e) ? e.url : null
}

async function enviarLote(caminhos) {
  const donoDoPedido = dono
  let resultado = new Map()
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(caminhos, VALIDADE_S)
    if (!error && Array.isArray(data)) {
      for (const item of data) if (item?.path && item.signedUrl && !item.error) resultado.set(item.path, item.signedUrl)
    }
  } catch { resultado = new Map() }
  const agora = Date.now()
  const mesmoUsuario = donoDoPedido === dono      // trocou de conta no meio do pedido: NÃO guarda a URL do usuário anterior
  for (const caminho of caminhos) {
    const url = mesmoUsuario ? resultado.get(caminho) || null : null
    if (mesmoUsuario) cache.set(caminho, url ? { url, ate: agora + VALIDADE_S * 1000 } : { url: null, ate: agora + FALHA_MS })
    const esperando = pendentes.get(caminho) || []
    pendentes.delete(caminho)
    for (const r of esperando) r(url)
  }
  if (mesmoUsuario) agendarSalvar()
}

function descarregar() {
  agendado = false
  const caminhos = [...pendentes.keys()]
  for (let i = 0; i < caminhos.length; i += LOTE) enviarLote(caminhos.slice(i, i + LOTE))
}

function assinar(caminho) {
  return new Promise((resolve) => {
    const fila = pendentes.get(caminho)
    if (fila) { fila.push(resolve); return }
    pendentes.set(caminho, [resolve])
    if (!agendado) { agendado = true; setTimeout(descarregar, 0) }
  })
}

// Devolve a URL para EXIBIR (assinada quando for do bucket 'imagens'; a original em qualquer outro caso ou se a assinatura falhar).
export async function resolverImagem(valor) {
  if (!valor) return null
  const caminho = caminhoDaImagem(valor)
  if (!caminho) return valor
  const e = cache.get(caminho)
  if (valida(e)) return e.url || valor
  const url = await assinar(caminho)
  return url || valor
}

// Hook: a URL para usar no <img src>. Enquanto assina (só na 1ª vez) devolve null — o componente mostra o "vazio" (iniciais etc.).
// URL que não é do bucket volta na hora, sem passar por aqui.
export function useImagem(valor) {
  const ehDoBucket = !!caminhoDaImagem(valor)
  // estado DERIVADO: `resolvido` só guarda o desfecho de UM valor (assinada, ou a original se a assinatura falhou);
  // trocou o valor => o antigo é ignorado (nunca mostra a foto do valor anterior)
  const [resolvido, setResolvido] = useState({ valor: null, url: null })
  const pronta = ehDoBucket ? urlAssinadaEmCache(valor) : null
  useEffect(() => {
    if (!ehDoBucket || pronta) return undefined
    let vivo = true
    resolverImagem(valor).then((u) => { if (vivo) setResolvido({ valor, url: u }) })
    return () => { vivo = false }
  }, [valor, ehDoBucket, pronta])
  if (!valor) return null
  if (!ehDoBucket) return valor
  return pronta || (resolvido.valor === valor ? resolvido.url : null)
}

// Só para teste: volta o módulo ao estado de fábrica.
export function _reiniciarImagens() {
  cache.clear(); pendentes.clear(); dono = null; agendado = false
  if (salvando) { clearTimeout(salvando); salvando = null }
}
