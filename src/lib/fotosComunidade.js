// Fotos da REDE DBV (bucket PRIVADO 'comunidade'): assina em LOTE e guarda em cache de memória, do mesmo
// jeito que lib/imagens.js faz com os avatares do bucket 'imagens'. Sem isto, cada foto do feed, da grade do
// perfil e da moderação fazia uma chamada INDIVIDUAL de createSignedUrl que não era reaproveitada — rolar pra
// baixo e voltar reassinava tudo de novo (rede móvel fraca).
//
// Diferenças para imagens.js: aqui o valor guardado no banco JÁ é o caminho do bucket (não uma URL), e o bucket
// é sempre 'comunidade'. Mesma regra de segurança: o cache é POR USUÁRIO e é ZERADO no logout/troca de conta
// (Auth chama definirUsuarioComunidade) — num aparelho compartilhado ninguém reaproveita a URL assinada de outra
// pessoa. Só memória (sem localStorage): a persistência offline entre sessões entra junto com o trabalho de offline.
import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

const BUCKET = 'comunidade'
const VALIDADE_S = 600            // 10 min — igual ao que urlDaFoto usava
const FALHA_MS = 60 * 1000        // falha lembrada por 1 min (sem tempestade de pedidos)
const LOTE = 100                  // createSignedUrls aceita ~100 caminhos por chamada

const cache = new Map()           // caminho -> { url, ate }  (url null = falhou)
const pendentes = new Map()       // caminho -> [resolve, ...]
let dono = null
let agendado = false

// Auth chama isto quando a sessão muda (login, logout, troca de conta): zera o cache por segurança.
export function definirUsuarioComunidade(uid) {
  const novo = uid || null
  if (novo === dono && novo !== null) return
  dono = novo
  cache.clear()
  pendentes.clear()
}

const valido = (e) => !!e && e.ate > Date.now()

// URL já pronta (sem rede) ou null — para o 1º render não piscar.
export function urlComunidadeEmCache(path) {
  if (!path) return null
  const e = cache.get(path)
  return e && e.url && valido(e) ? e.url : null
}

async function enviarLote(caminhos) {
  const donoDoPedido = dono
  const resultado = new Map()
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(caminhos, VALIDADE_S)
    if (!error && Array.isArray(data)) {
      for (const item of data) if (item?.path && item.signedUrl && !item.error) resultado.set(item.path, item.signedUrl)
    }
  } catch { /* rede: todos falham nesta rodada */ }
  const agora = Date.now()
  const mesmoUsuario = donoDoPedido === dono     // trocou de conta no meio: NÃO guarda a URL do anterior
  for (const caminho of caminhos) {
    const url = mesmoUsuario ? resultado.get(caminho) || null : null
    if (mesmoUsuario) cache.set(caminho, url ? { url, ate: agora + VALIDADE_S * 1000 } : { url: null, ate: agora + FALHA_MS })
    const esperando = pendentes.get(caminho) || []
    pendentes.delete(caminho)
    for (const r of esperando) r(url)
  }
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

export async function resolverFotoComunidade(path) {
  if (!path) return null
  const e = cache.get(path)
  if (valido(e)) return e.url            // url (válida) ou null (falha lembrada por 1 min)
  return assinar(path)
}

// Hook: a URL para usar no <img src>. Enquanto assina (só na 1ª vez de cada caminho) devolve null — o
// componente mostra o esqueleto. Caminhos do mesmo instante viram UMA chamada em lote.
export function useFotoComunidade(path) {
  const pronta = urlComunidadeEmCache(path)
  const [resolvido, setResolvido] = useState({ path: null, url: null })
  useEffect(() => {
    if (!path || pronta) return undefined
    let vivo = true
    resolverFotoComunidade(path).then((u) => { if (vivo) setResolvido({ path, url: u }) })
    return () => { vivo = false }
  }, [path, pronta])
  if (!path) return null
  return pronta || (resolvido.path === path ? resolvido.url : null)
}

// Só para teste: volta o módulo ao estado de fábrica.
export function _reiniciarFotosComunidade() {
  cache.clear(); pendentes.clear(); dono = null; agendado = false
}
