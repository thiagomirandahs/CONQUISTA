// Serviço: mural — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'
import { comprimirImagem } from '../lib/imagem.js'
import { validarImagem } from '../lib/upload.js'


// =====================================================================
//  MURAL DE FOTOS — fotos reais do banco, agrupadas por categoria (evento)
// =====================================================================

// Carrega todas as fotos do mural, da mais nova para a mais antiga.
export async function carregarFotos() {
  const { data } = await supabase
    .from('fotos')
    // '*' pra não quebrar a listagem na janela entre o deploy e rodar o SQL da
    // thumb (sem a coluna, cada foto só não traz 'thumb' e o grid cai pra url).
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300)
  return data || []
}


// Envia o arquivo ao Storage e cria o registro da foto na categoria escolhida.
// Sobe DUAS versões: a cheia (~1080px, pro lightbox) e uma miniatura (~400px,
// pro grid/capa) — assim as listas gastam pouca internet.
export async function adicionarFoto({ file, evento, legenda, autorId }) {
  await validarImagem(file) // tipo REAL + tamanho (hardening etapa 2)
  const cheia = await comprimirImagem(file)
  const mini = await comprimirImagem(cheia, { maxLado: 400, qualidade: 0.6 })
  const stamp = `mural/${autorId}-${Date.now()}`
  const extC = (cheia.name.split('.').pop() || 'jpg').toLowerCase()
  const extT = (mini.name.split('.').pop() || 'jpg').toLowerCase()
  const pathCheia = `${stamp}.${extC}`
  const pathThumb = `${stamp}-thumb.${extT}`

  const [upCheia, upThumb] = await Promise.all([
    supabase.storage.from('imagens').upload(pathCheia, cheia, { upsert: true }),
    supabase.storage.from('imagens').upload(pathThumb, mini, { upsert: true }),
  ])
  if (upCheia.error) throw upCheia.error

  const url = supabase.storage.from('imagens').getPublicUrl(pathCheia).data.publicUrl
  // Se a miniatura falhar, o grid cai pra foto cheia (thumb = null) — não trava o envio.
  const thumb = upThumb.error ? null : supabase.storage.from('imagens').getPublicUrl(pathThumb).data.publicUrl

  const base = { url, evento, legenda: legenda || null, autor_id: autorId }
  let ins = await supabase.from('fotos').insert({ ...base, thumb }).select('*').single()
  // Se a coluna thumb ainda não existe (SQL não rodado), grava sem ela — o envio
  // não pode quebrar por causa da janela de deploy.
  if (ins.error && /thumb/i.test(ins.error.message || '')) {
    ins = await supabase.from('fotos').insert(base).select('*').single()
  }
  if (ins.error) throw ins.error
  return ins.data
}


// Exclui uma foto. O RLS só deixa o autor (ou a liderança) apagar; se nada
// for apagado, sinaliza falta de permissão (ex.: policy de exclusão ainda não aplicada).
export async function excluirFoto(id) {
  const { data, error } = await supabase.from('fotos').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('SEM_PERMISSAO')
}
