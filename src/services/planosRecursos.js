// Painéis por plano (migration 410): o admin da plataforma escolhe quais recursos cada plano libera.
// O servidor é a fonte (billing_plans.recursos entra em recurso_habilitado_no_clube e nos gatilhos);
// aqui só há wrappers das RPCs, que exigem admin e auditam.
import { supabase } from '../lib/supabase.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

export const planosRecursosListar = async () => (await rpc('admin_planos_recursos')) || []

// Remover recurso de plano com clube devolve { precisa_confirmar, impacto } sem alterar nada;
// só com confirmar = true a remoção é aplicada.
export const planoRecursoDefinir = (planoId, recurso, incluir, confirmar = false) =>
  rpc('admin_plano_recurso_definir', { p_plan_id: planoId, p_feature: recurso, p_incluir: incluir, p_confirmar: confirmar })
