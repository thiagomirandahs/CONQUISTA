// Serviço: como uma pessoa ENTRA num clube.
//
// Até a fase 8.6, cadastrar-se colocava a pessoa dentro do Tenant 001 — a última suposição de
// clube único que o produto tinha. Agora o cadastro cria a conta, e o vínculo nasce por aqui.
//
// A regra que atravessa tudo neste arquivo: o cliente NUNCA diz para qual clube está entrando.
// Ele apresenta um segredo (código ou token) e o servidor descobre o clube. Um `club_id` na URL
// seria um palpite editável; um segredo é uma prova.
import { supabase } from '../lib/supabase.js'

// `encontrado: false` em vez de erro, e isso é de propósito no servidor: uma exceção desfaria a
// transação e levaria junto o registro da tentativa, deixando o limite de abuso sem nada para
// contar. Aqui a consequência é que quem chama precisa olhar o flag, não só o `error`.
const conferir = (data, error) => {
  if (error) throw error
  if (!data?.encontrado) return null
  return data
}

// "Você está entrando em…" — a identidade PÚBLICA do clube de destino, e nada além dela.
// A mesma identidade pública, para quem abre o link SEM conta (limite por origem no servidor).
export async function abrirCodigoPublico(codigo) {
  const { data, error } = await supabase.rpc('entrada_abrir_publico', { p_codigo: codigo })
  return conferir(data, error)
}

export async function abrirCodigo(codigo) {
  const { data, error } = await supabase.rpc('entrada_abrir', { p_codigo: codigo })
  return conferir(data, error)
}

// Cria a SOLICITAÇÃO. Não é entrada: o código identifica o destino, e quem decide quem entra
// continua sendo a liderança do clube.
export async function solicitarEntrada(codigo) {
  const { data, error } = await supabase.rpc('entrada_solicitar', { p_codigo: codigo })
  return conferir(data, error)
}

export async function abrirConvite(token) {
  const { data, error } = await supabase.rpc('convite_abrir', { p_token: token })
  return conferir(data, error)
}

export async function aceitarConvite(token) {
  const { data, error } = await supabase.rpc('convite_aceitar', { p_token: token })
  return conferir(data, error)
}

// ---- lado da liderança ----

export async function codigoAtual() {
  const { data, error } = await supabase.rpc('clube_codigo_atual')
  if (error) throw error
  return data
}

// O código em claro volta UMA vez, aqui. Depois disto nem o banco sabe qual era — ele guarda o
// hash. Quem perder o papel onde anotou gera outro, e gerar revoga o anterior no mesmo ato.
export async function gerarCodigo(dias) {
  const { data, error } = await supabase.rpc('clube_codigo_gerar', { p_dias: dias ?? null })
  if (error) throw error
  return data
}

export async function revogarCodigo() {
  const { data, error } = await supabase.rpc('clube_codigo_revogar')
  if (error) throw error
  return data
}

export async function entradasPendentes() {
  const { data, error } = await supabase.rpc('entradas_pendentes')
  if (error) throw error
  return data || []
}
