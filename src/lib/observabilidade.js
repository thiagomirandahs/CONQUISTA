// Observabilidade mínima do cliente (fase 8.1, blocker B7).
//
// Até aqui o build de produção rodava com `drop_console: true` e nenhum rastreio: um clube pagante
// ligava dizendo "não consigo lançar pontos" e não havia nada para investigar.
//
// O que torna isto barato de fazer: a fase 7.1 já tinha transformado `avisar.erro` no funil único
// por onde passa TODO erro que chega à pessoa. Instrumentando esse ponto (mais o error boundary e
// os dois handlers globais), cobre-se o produto inteiro sem espalhar try/catch por 35 telas.
//
// O QUE É ENVIADO, e só isto:
//   origem, rota (sem querystring), a frase humana da tela, um CÓDIGO técnico curto, um id de
//   correlação aleatório por aba e o agente do navegador truncado.
//
// O QUE NUNCA É ENVIADO:
//   a mensagem crua do servidor (carrega nome de coluna, valor, às vezes e-mail), token, senha,
//   conteúdo de chat, evidência, foto, nome ou qualquer dado de pessoa. O público é
//   majoritariamente menor de idade — telemetria que grava demais é vazamento esperando acontecer.
//   O `user_id` e o clube são preenchidos pelo SERVIDOR a partir do JWT e do header, nunca pelo
//   cliente: assim ninguém consegue registrar erro em nome de outra pessoa.
import { supabase } from './supabase.js'

// Id de correlação: aleatório, por aba, sem relação com a identidade. Serve para juntar os erros
// de uma mesma sessão de uso ("tentou três vezes seguidas") sem precisar saber quem é.
// sessionStorage e não localStorage: some ao fechar a aba, que é o escopo certo.
function correlacaoDaAba() {
  const CHAVE = 'cq-correlacao'
  try {
    const guardada = sessionStorage.getItem(CHAVE)
    if (guardada) return guardada
    const nova = (crypto.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 24)
    sessionStorage.setItem(CHAVE, nova)
    return nova
  } catch {
    // aba anônima / storage bloqueado: um id só para esta carga da página já serve
    return (crypto.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 24)
  }
}
const CORRELACAO = correlacaoDaAba()

// Expõe o id para quem precisa CITAR ("informe o código X ao suporte"). Só isso.
export const idDeCorrelacao = () => CORRELACAO

// Extrai um CÓDIGO curto e sem dado de ninguém a partir do erro. É a peça que decide o que sai
// daqui: se não casar com um padrão conhecido, vai só o nome do tipo do erro — nunca o texto.
const PADROES = [
  /\b(PGRST\d{3})\b/,          // PostgREST
  /\b(2[0-9A-Z]{4})\b/,        // SQLSTATE (42501 = permissão negada, 23505 = duplicado...)
  /\b(4[0-9A-Z]{4})\b/,
  /\b(5[0-9A-Z]{4})\b/,
]
export function codigoDoErro(erro) {
  if (!erro) return ''
  const bruto = typeof erro === 'string' ? erro : (erro.code || erro.message || '')
  for (const p of PADROES) {
    const m = String(bruto).match(p)
    if (m) return m[1]
  }
  // sem código reconhecido: o NOME do tipo (TypeError, NetworkError...). Nunca a mensagem —
  // "duplicate key value violates unique constraint ... (email)=(alguem@x.com)" já vazaria.
  const nome = (erro && erro.name) || ''
  if (nome && nome !== 'Error') return String(nome).slice(0, 40)
  if (/fetch|network|failed to fetch/i.test(String(bruto))) return 'RedeIndisponivel'
  return 'Desconhecido'
}

// A rota sem querystring nem fragmento: `/avaliar/uuid-de-alguem?foo=1` vira `/avaliar/uuid...`.
// O id na rota é aceitável (é o que permite reproduzir); a query não, porque é onde tokens andam.
function rotaAtual() {
  try { return (window.location.pathname || '').slice(0, 120) } catch { return '' }
}

let ligado = false
let enviando = 0
const TETO_POR_CARGA = 20 // espelha o teto do servidor: um laço quebrado não vira mil chamadas

// Envia sem nunca atrapalhar: falha de telemetria é engolida de propósito. O produto não pode
// quebrar porque o registro de erro não foi.
export async function reportarErro(erro, { origem = 'ui', contexto = '' } = {}) {
  if (enviando >= TETO_POR_CARGA) return
  enviando++
  try {
    const { data: sessao } = await supabase.auth.getSession()
    if (!sessao?.session) return // sem login não há o que correlacionar, e a RPC exigiria auth
    await supabase.rpc('registrar_erro', {
      p_origem: origem,
      p_correlacao: CORRELACAO,
      p_rota: rotaAtual(),
      p_contexto: String(contexto || '').slice(0, 200),
      p_codigo: codigoDoErro(erro),
      p_agente: String(navigator.userAgent || '').slice(0, 120),
    })
  } catch { /* telemetria nunca atrapalha o produto */ }
}

// Handlers globais: pegam o que escapou de todo try/catch. Instalados uma vez só.
export function ligarObservabilidade() {
  if (ligado || typeof window === 'undefined') return
  ligado = true
  window.addEventListener('error', (e) => {
    reportarErro(e?.error || e?.message, { origem: 'janela', contexto: 'Erro não tratado na tela.' })
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportarErro(e?.reason, { origem: 'promessa', contexto: 'Operação falhou sem tratamento.' })
  })
}
