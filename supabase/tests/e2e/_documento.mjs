// Ajuda dos E2E: requisitos de idade pedem a FOTO DO DOCUMENTO antes de enviar (migration 380). Os E2E mais antigos
// enviavam todos os requisitos sem isso. Este helper envia normalmente e, se o servidor pedir o documento, sobe uma
// imagem minúscula de teste (bucket privado, só local), registra com documento_enviar e tenta de novo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
export async function enviarRequisitoComDocumento(cliente, requirementId) {
  let r = await cliente.rpc('requisito_enviar', { p_requirement_id: requirementId })
  if (r.error && /foto do documento/.test(r.error.message)) {
    const uid = (await cliente.auth.getUser()).data.user.id
    const path = `${uid}/documentos/e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`
    const up = await cliente.storage.from('comprovacoes').upload(path, PNG, { contentType: 'image/png' })
    if (up.error) return { error: up.error }
    const d = await cliente.rpc('documento_enviar', { p_requirement_id: requirementId, p_path: path })
    if (d.error) return { error: d.error }
    r = await cliente.rpc('requisito_enviar', { p_requirement_id: requirementId })
  }
  return r
}
