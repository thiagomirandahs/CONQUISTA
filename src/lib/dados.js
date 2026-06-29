import { supabase } from './supabase.js'

// Carrega unidades, membros e pontos reais do banco e monta o ranking
export async function carregarRanking() {
  const [{ data: us }, { data: ps }, { data: pts }] = await Promise.all([
    supabase.from('unidades').select('id,nome,cor').order('nome'),
    supabase.from('profiles').select('id,nome,foto,unidade_id').eq('status', 'ativo'),
    supabase.from('pontos').select('usuario_id,pontos'),
  ])

  const total = {}
  ;(pts || []).forEach((p) => { total[p.usuario_id] = (total[p.usuario_id] || 0) + (p.pontos || 0) })

  const corUni = Object.fromEntries((us || []).map((u) => [u.id, u.cor || '#1e3a8a']))
  const nomeUni = Object.fromEntries((us || []).map((u) => [u.id, u.nome]))

  const unidades = (us || []).map((u) => {
    const membros = (ps || [])
      .filter((p) => p.unidade_id === u.id)
      .map((p) => ({ id: p.id, nome: p.nome, foto: p.foto, cor: u.cor || '#1e3a8a', pts: total[p.id] || 0 }))
      .sort((a, b) => b.pts - a.pts)
    const media = membros.length ? Math.round(membros.reduce((s, m) => s + m.pts, 0) / membros.length) : 0
    return { id: u.id, nome: u.nome, cor: u.cor || '#1e3a8a', membros, media }
  })

  const individual = (ps || [])
    .map((p) => ({
      id: p.id, nome: p.nome, foto: p.foto,
      unidade: nomeUni[p.unidade_id] || '', cor: corUni[p.unidade_id] || '#1e3a8a',
      pts: total[p.id] || 0,
    }))
    .sort((a, b) => b.pts - a.pts)

  return { unidades, individual }
}
