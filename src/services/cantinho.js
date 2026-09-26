// Serviço: Cantinho da unidade (migration 260). Tudo por RPC: as tabelas não têm leitura direta, e o servidor
// decide quem vê o quê (conselheiro só a própria unidade, diretoria todas, membro só o que é dele).
import { supabase } from '../lib/supabase.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

export const cantinhoMinhasUnidades = async () => (await rpc('cantinho_minhas_unidades', {})) || []
export const cantinhoVer = (unidadeId) => rpc('cantinho_ver', { p_unidade: unidadeId })

export const cantinhoJustificar = (unidadeId, usuarioId, data, motivo) =>
  rpc('cantinho_justificar', { p_unidade: unidadeId, p_usuario: usuarioId, p_data: data, p_motivo: motivo || null })

export const cantinhoCaixaLancar = (unidadeId, { data, descricao, tipo, valorCentavos }) =>
  rpc('cantinho_caixa_lancar', { p_unidade: unidadeId, p_data: data || null, p_descricao: descricao, p_tipo: tipo, p_valor_centavos: valorCentavos })
export const cantinhoCaixaExcluir = (id) => rpc('cantinho_caixa_excluir', { p_id: id })

export const cantinhoMeditacaoSalvar = (unidadeId, texto, referencia) =>
  rpc('cantinho_meditacao_salvar', { p_unidade: unidadeId, p_texto: texto, p_referencia: referencia || null })

export const cantinhoMuralEnviar = (unidadeId, tipo, texto, privado = false) =>
  rpc('cantinho_mural_enviar', { p_unidade: unidadeId, p_tipo: tipo, p_texto: texto, p_privado: !!privado })
export const cantinhoMuralModerar = (id, oculto) => rpc('cantinho_mural_moderar', { p_id: id, p_oculto: oculto })
export const cantinhoMuralApagar = (id) => rpc('cantinho_mural_apagar', { p_id: id })

export const cantinhoAjudaRegistrar = (unidadeId, descricao) =>
  rpc('cantinho_ajuda_registrar', { p_unidade: unidadeId, p_descricao: descricao || null })
export const cantinhoAjudaConfirmar = (unidadeId, usuarioId, descricao) =>
  rpc('cantinho_ajuda_confirmar', { p_unidade: unidadeId, p_usuario: usuarioId, p_descricao: descricao || null })
export const cantinhoAjudaDesfazer = (id) => rpc('cantinho_ajuda_desfazer', { p_id: id })
export const cantinhoConfigDefinir = (pontos) => rpc('cantinho_config_definir', { p_pontos_ajuda_pais: pontos })

export const cantinhoReuniaoSalvar = (unidadeId, { id, inicio, local, pauta }) =>
  rpc('cantinho_reuniao_salvar', { p_unidade: unidadeId, p_id: id || null, p_inicio: inicio, p_local: local || null, p_pauta: pauta || null })
export const cantinhoReuniaoExcluir = (id) => rpc('cantinho_reuniao_excluir', { p_id: id })

export const cantinhoPlanoSalvar = (unidadeId, { id, titulo, detalhe, status, prazo }) =>
  rpc('cantinho_plano_salvar', { p_unidade: unidadeId, p_id: id || null, p_titulo: titulo, p_detalhe: detalhe || null, p_status: status || 'a_fazer', p_prazo: prazo || null })
export const cantinhoPlanoExcluir = (id) => rpc('cantinho_plano_excluir', { p_id: id })

// Faltas justificadas do clube da aba (o Radar de faltas não conta estas). Banco sem a migration 260 = nenhuma.
export async function justificativasDoClube(desde = null) {
  try {
    const { data, error } = (await supabase.rpc('cantinho_justificativas_do_clube', { p_desde: desde })) || {}
    return error ? [] : data || []
  } catch {
    return []
  }
}

// ---------- apresentação (pura, testável) ----------
// "12,50" / "12" / "R$ 12,50" -> 1250 centavos; inválido/zero -> null
export function paraCentavos(texto) {
  const limpo = String(texto ?? '').replace(/[^\d,.-]/g, '').trim()
  if (!limpo) return null
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo
  const n = Math.round(Number(normal) * 100)
  return Number.isFinite(n) && n > 0 ? n : null
}

export const formatarReal = (centavos) =>
  (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// 'AAAA-MM-DD' -> 'DD/MM'
export const diaMes = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '')

// Hoje é domingo? (a data "hoje" vem do servidor, já no fuso de São Paulo)
export const ehDomingo = (isoHoje) => !!isoHoje && new Date(`${String(isoHoje).slice(0, 10)}T12:00:00Z`).getUTCDay() === 0

export const STATUS_CHAMADA = {
  presente: { rotulo: 'Presente', icone: '✅', tom: 'ok' },
  atrasado: { rotulo: 'Atrasado', icone: '⏰', tom: 'atencao' },
  falta: { rotulo: 'Falta', icone: '❌', tom: 'perigo' },
  justificada: { rotulo: 'Justificada', icone: '📝', tom: 'info' },
}

export const STATUS_PLANO = [['a_fazer', 'A fazer'], ['fazendo', 'Fazendo'], ['feito', 'Feito']]
