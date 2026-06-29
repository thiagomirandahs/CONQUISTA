import { supabase } from './supabase.js'

// Carrega unidades, membros e pontos reais do banco e monta o ranking
export async function carregarRanking() {
  const [{ data: us }, { data: ps }, { data: pts }] = await Promise.all([
    supabase.from('unidades').select('id,nome,cor,emblema').order('nome'),
    supabase.from('profiles').select('id,nome,foto,unidade_id,papel').eq('status', 'ativo').in('papel', ['desbravador', 'conselheiro']),
    supabase.from('pontos').select('usuario_id,pontos'),
  ])

  const total = {}
  ;(pts || []).forEach((p) => { total[p.usuario_id] = (total[p.usuario_id] || 0) + (p.pontos || 0) })

  const corUni = Object.fromEntries((us || []).map((u) => [u.id, u.cor || '#1e3a8a']))
  const nomeUni = Object.fromEntries((us || []).map((u) => [u.id, u.nome]))

  const unidades = (us || [])
    .map((u) => {
      const membros = (ps || [])
        .filter((p) => p.unidade_id === u.id && p.papel === 'desbravador')
        .map((p) => ({ id: p.id, nome: p.nome, foto: p.foto, cor: u.cor || '#1e3a8a', pts: total[p.id] || 0 }))
        .sort((a, b) => b.pts - a.pts || a.nome.localeCompare(b.nome, 'pt-BR'))
      const media = membros.length ? Math.round(membros.reduce((s, m) => s + m.pts, 0) / membros.length) : 0
      return { id: u.id, nome: u.nome, cor: u.cor || '#1e3a8a', emblema: u.emblema, membros, media }
    })
    // Ranking de unidades: maior média primeiro (desempate por nome) → 1º, 2º, 3º...
    .sort((a, b) => b.media - a.media || a.nome.localeCompare(b.nome, 'pt-BR'))

  const individual = (ps || [])
    .map((p) => ({
      id: p.id, nome: p.nome, foto: p.foto,
      unidade: nomeUni[p.unidade_id] || '', cor: corUni[p.unidade_id] || '#1e3a8a',
      pts: total[p.id] || 0,
    }))
    // Ranking individual: maior pontuação primeiro (desempate por nome)
    .sort((a, b) => b.pts - a.pts || a.nome.localeCompare(b.nome, 'pt-BR'))

  return { unidades, individual }
}

// =====================================================================
//  MURAL DE FOTOS — fotos reais do banco, agrupadas por categoria (evento)
// =====================================================================

// Carrega todas as fotos do mural, da mais nova para a mais antiga.
export async function carregarFotos() {
  const { data } = await supabase
    .from('fotos')
    .select('id,url,legenda,evento,autor_id,created_at')
    .order('created_at', { ascending: false })
  return data || []
}

// Envia o arquivo ao Storage e cria o registro da foto na categoria escolhida.
export async function adicionarFoto({ file, evento, legenda, autorId }) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `mural/${autorId}-${Date.now()}.${ext}`

  const { error: upErr } = await supabase.storage.from('imagens').upload(path, file, { upsert: true })
  if (upErr) throw upErr

  const { data: pub } = supabase.storage.from('imagens').getPublicUrl(path)
  const { data, error } = await supabase
    .from('fotos')
    .insert({ url: pub.publicUrl, evento, legenda: legenda || null, autor_id: autorId })
    .select('id,url,legenda,evento,autor_id,created_at')
    .single()
  if (error) throw error
  return data
}

// Exclui uma foto. O RLS só deixa o autor (ou a liderança) apagar; se nada
// for apagado, sinaliza falta de permissão (ex.: policy de exclusão ainda não aplicada).
export async function excluirFoto(id) {
  const { data, error } = await supabase.from('fotos').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('SEM_PERMISSAO')
}
