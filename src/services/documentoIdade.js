// Foto do DOCUMENTO nos requisitos de idade (migration 380). Dado sensível de criança:
//  * vai SÓ para o bucket privado 'comprovacoes' — nunca cai no bucket público antigo (ao contrário de
//    subirComprovacao, aqui não existe o desvio de transição: se falhar, a pessoa tenta de novo);
//  * não entra no histórico de tentativas; só o dono e o avaliador do clube veem;
//  * depois da aprovação o arquivo é APAGADO (por quem aprovou e, de reserva, pelo app do dono).
import { supabase } from '../lib/supabase.js'
import { solicitarSaneamento } from '../lib/saneamentoImagem.js'
import { validarImagem } from '../lib/upload.js'
import { comprimirImagem } from '../lib/imagem.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

const apagarArquivo = async (path) => {
  if (!path) return
  const { error } = await supabase.storage.from('comprovacoes').remove([path])
  if (error) throw new Error(error.message)
}

export const documentosDaMinhaClasse = async (memberClassId) =>
  (await rpc('documentos_da_minha_classe', { p_member_class_id: memberClassId })) || {}

export const documentoDoRequisito = (memberRequirementId) =>
  rpc('documento_do_requisito', { p_member_requirement_id: memberRequirementId })

export async function enviarDocumento({ requirementId, file, userId }) {
  await validarImagem(file)
  const pronta = await comprimirImagem(file, { semMetadados: true })
  const path = `${userId}/documentos/${Date.now()}.jpg`
  const { error } = await supabase.storage.from('comprovacoes').upload(path, pronta, { upsert: false, contentType: 'image/jpeg' })
  if (error) throw new Error('Não foi possível enviar a foto: ' + error.message)
  solicitarSaneamento('comprovacoes', path)
  let r
  try {
    r = await rpc('documento_enviar', { p_requirement_id: requirementId, p_path: path })
  } catch (e) {
    await apagarArquivo(path).catch(() => {})
    throw e
  }
  // a foto antiga (troca) deixou de ser usada: sai do armazenamento
  if (r?.caminho_antigo) await apagarArquivo(r.caminho_antigo).catch(() => {})
  return path
}

// Depois da aprovação: apaga o arquivo e deixa só o registro "conferido por … em …".
// Sem documento ou já apagado: não faz nada. Falhar aqui nunca desfaz a aprovação.
export async function apagarDocumentoConferido(memberRequirementId, path = null) {
  let caminho = path
  if (!caminho) {
    const d = await documentoDoRequisito(memberRequirementId).catch(() => null)
    if (d?.documento?.status !== 'conferido') return false
    caminho = d.documento.evidencia_path
  }
  if (!caminho) return false
  await apagarArquivo(caminho)
  await rpc('documento_marcar_apagado', { p_member_requirement_id: memberRequirementId })
  return true
}
