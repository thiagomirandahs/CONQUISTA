// Serviço: config do clube (config_clube: chave/valor POR CLUBE — PIX, popup, rodízio, interruptores).
// A mesma chave existe em vários clubes, então o "upsert por chave" antigo não existe mais no banco:
// a gravação passa pela RPC config_gravar (grava no clube de quem chama, só liderança).
import { supabase } from '../lib/supabase.js'

// A RPC só existe depois do SQL "config por clube". Num banco que ainda não recebeu o SQL
// (front novo publicado antes do SQL), cai no upsert antigo — a ordem do deploy não quebra a tela.
export function rpcInexistente(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  return code === 'PGRST202' || code === '42883' || /could not find the function|schema cache/i.test(msg)
}

export async function gravarConfig(linhas) {
  const { error } = await supabase.rpc('config_gravar', { p_linhas: linhas })
  if (!error) return
  if (!rpcInexistente(error)) throw new Error(error.message)
  const antigo = await supabase.from('config_clube').upsert(linhas, { onConflict: 'chave' })
  if (antigo.error) throw new Error(antigo.error.message)
}
