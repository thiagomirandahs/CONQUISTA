// Serviço: "classe já concluída" registrada pela liderança (migration 521). O servidor decide tudo;
// aqui só chamamos as RPCs e cuidamos do comprovante opcional (bucket privado 'comprovacoes').
import { supabase } from '../lib/supabase.js'
import { processarImagem } from '../lib/imagens/processar.js'
import { novoUuid } from '../lib/imagens/caminho.js'
import { extensaoDoMime } from '../lib/imagens/validar.js'
import { rpcAusente } from '../lib/classeAnterior.js'

const BUCKET = 'comprovacoes'
const SEGURO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

// Classes oficiais publicadas (regulares e avançadas). O servidor revalida na hora de registrar.
export async function carregarClassesOficiais() {
  const { data, error } = await supabase
    .from('classes')
    .select('id, codigo, nome, tipo_classe, ordem, curriculum_versions!inner(origem, status)')
    .eq('ativo', true)
    .eq('curriculum_versions.origem', 'oficial')
    .eq('curriculum_versions.status', 'publicado')
    .order('ordem', { ascending: true })
  if (error) throw new Error(error.message)
  const vistos = new Set()
  const lista = []
  for (const c of data || []) {
    if (vistos.has(c.codigo)) continue
    vistos.add(c.codigo)
    lista.push({ id: c.id, codigo: c.codigo, nome: c.nome, avancada: c.tipo_classe === 'avancada' })
  }
  return lista
}

// Conclusões de um membro, vistas pela liderança. Banco sem a 521 -> { disponivel: false }.
export async function carregarConclusoesDoMembro(usuarioId) {
  const { data, error } = await supabase.rpc('classe_concluidas_do_membro', { p_usuario_id: usuarioId })
  if (error) {
    if (rpcAusente(error)) return { disponivel: false, itens: [] }
    throw new Error(error.message)
  }
  return { disponivel: true, itens: Array.isArray(data) ? data : [] }
}

// Foto opcional: valida o tipo real, re-renderiza (sem EXIF) no perfil 'evidencia' e sobe em
// <clube>/<membro>/conclusao-anterior/<uuid>.<ext>. Devolve o caminho. PDF não é aceito pelo bucket.
export async function enviarComprovanteAnterior({ file, clubeId, membroId }) {
  if (!SEGURO.test(String(clubeId || '')) || !SEGURO.test(String(membroId || ''))) {
    throw new Error('Não consegui identificar o clube ou a pessoa agora. Volte e tente de novo.')
  }
  const r = await processarImagem(file, 'evidencia')
  const ext = extensaoDoMime(r.mime)
  if (!ext) throw new Error('Tipo de imagem inesperado.')
  const path = `${clubeId}/${membroId}/conclusao-anterior/${novoUuid()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, r.principal, { contentType: r.mime, upsert: false })
  if (error) throw new Error('Não foi possível enviar o comprovante: ' + error.message)
  return path
}

const apagarEnviado = async (path) => {
  if (!path) return
  try { await supabase.storage.from(BUCKET).remove([path]) } catch { /* melhor esforço */ }
}

// Envia o comprovante (se houver) e registra. Se o registro falhar (erro ou ok:false), apaga o arquivo enviado.
export async function registrarClasseAnterior({ usuarioId, classId, data, dataDesconhecida, observacao, arquivo, clubeId }) {
  let path = null
  if (arquivo) path = await enviarComprovanteAnterior({ file: arquivo, clubeId, membroId: usuarioId })
  let r
  try {
    const res = await supabase.rpc('classe_concluida_anteriormente_registrar', {
      p_usuario_id: usuarioId,
      p_class_id: classId,
      p_concluida_em: dataDesconhecida ? null : data,
      p_data_desconhecida: !!dataDesconhecida,
      p_observacao: String(observacao || '').trim(),
      p_comprovante_path: path,
    })
    if (res.error) throw new Error(res.error.message)
    r = res.data
  } catch (e) {
    await apagarEnviado(path)
    throw e
  }
  if (!r?.ok) {
    await apagarEnviado(path)
    throw new Error('Não foi possível registrar.')
  }
  return r
}

export async function revogarRegistroAnterior(achievementId, motivo) {
  const { data, error } = await supabase.rpc('classe_concluida_anteriormente_revogar', {
    p_achievement_id: achievementId, p_motivo: String(motivo || '').trim(),
  })
  if (error) throw new Error(error.message)
  if (!data?.ok) throw new Error('Não foi possível corrigir o registro.')
  return data
}

// Link temporário (2 min) para a liderança conferir o comprovante.
export async function urlComprovanteAnterior(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120)
  if (error) throw new Error(error.message)
  return data?.signedUrl || null
}
