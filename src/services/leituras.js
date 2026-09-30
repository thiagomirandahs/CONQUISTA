// Serviço do CATÁLOGO DE LEITURA (migration 514). O currículo segue sendo a fonte do requisito;
// aqui só se lê o material relacionado e se guarda o progresso de leitura/áudio (nunca aprova nada).
import { supabase } from '../lib/supabase.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

export const FILTROS_LEITURA = ['todos', 'minha_classe', 'curso', 'com_audio', 'concluidos']

export async function carregarLeituras(filtro = 'todos') {
  const d = await rpc('leituras_catalogo', { p_filtro: FILTROS_LEITURA.includes(filtro) ? filtro : 'todos' })
  return Array.isArray(d?.itens) ? d.itens : []
}

export const salvarProgressoLeitura = ({ materialId, capitulo, posicaoSeg, duracaoSeg, concluido = false }) =>
  rpc('leitura_progresso_salvar', {
    p_material_id: materialId,
    p_capitulo: Math.max(1, Math.round(Number(capitulo) || 1)),
    p_posicao_seg: Math.max(0, Math.round(Number(posicaoSeg) || 0)),
    p_duracao_seg: duracaoSeg == null || !Number.isFinite(Number(duracaoSeg)) ? null : Math.max(0, Math.round(Number(duracaoSeg))),
    p_concluido: !!concluido,
  })

// Administração (só administrador da plataforma; o servidor confere)
export const adminLeituraListar = async () => (await rpc('admin_leitura_listar')) || []
export const adminLeituraSalvar = (id, dados) => rpc('admin_leitura_salvar', { p_id: id || null, p_dados: dados })
export const adminLeituraAuditoria = async (materialId = null, limite = 50) =>
  (await rpc('admin_leitura_auditoria', { p_material_id: materialId, p_limite: limite })) || []
