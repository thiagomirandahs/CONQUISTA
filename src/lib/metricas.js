// Contador ANÔNIMO de uso (migration 545): site e app mandam um "sinal de vida" à plataforma.
// Nada identifica a pessoa: código aleatório da sessão (só desta aba/app), origem e "logado sim/não".
// Falha de rede ou de permissão (ex.: modo manutenção) é ignorada — medir nunca atrapalha o uso.
import { supabase } from './supabase.js'
import { ehApkNativo, modoDoHost } from './dominios.js'

export const INTERVALO_MS = 60_000
const CHAVE = 'dbv:sessao-uso'

// 'apk' (app Android) · 'site' (desbravaclube.com.br) · 'app' (app.desbravaclube.com.br/PWA e demais)
export function origemDeUso(host = globalThis.location?.hostname || '') {
  if (ehApkNativo()) return 'apk'
  return modoDoHost(host) === 'site' ? 'site' : 'app'
}

// Robôs de busca/monitoramento não são visitas de gente.
export function ehRobo(ua = globalThis.navigator?.userAgent || '') {
  return /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|preview|monitor|uptime|curl|wget|python-requests/i.test(ua)
}

// Telas que não entram na conta: a própria administração.
export function caminhoContavel(caminho = '') {
  return !/^\/admin(\/|$|\?)/.test(caminho)
}

let memoria = null
export function sessaoDeUso() {
  try {
    const guardada = sessionStorage.getItem(CHAVE)
    if (guardada) return guardada
    const nova = crypto.randomUUID()
    sessionStorage.setItem(CHAVE, nova)
    return nova
  } catch {
    // storage bloqueado: vale para a vida da página
    return (memoria ||= (globalThis.crypto?.randomUUID?.() || null))
  }
}

export async function enviarSinal({ pagina = false, logado = false } = {}) {
  try {
    const sessao = sessaoDeUso()
    if (!sessao || ehRobo()) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    await supabase.rpc('metrica_registrar', { p_sessao: sessao, p_origem: origemDeUso(), p_pagina: pagina, p_logado: logado })
  } catch { /* medir não pode atrapalhar */ }
}
