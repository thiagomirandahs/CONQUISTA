import { supabase } from './supabase.js'

// Carrega unidades, membros e pontos reais do banco e monta o ranking
export async function carregarRanking() {
  const [{ data: us }, { data: ps }, { data: pts }] = await Promise.all([
    supabase.from('unidades').select('id,nome,cor,emblema').order('nome'),
    supabase.from('profiles').select('id,nome,foto,unidade_id,papel').eq('status', 'ativo').in('papel', ['desbravador', 'conselheiro']),
    // select('*') de propósito: se a coluna unidade_id ainda não existir (migração
    // não rodada), a leitura não quebra — apenas ignora os pontos de time.
    supabase.from('pontos').select('*'),
  ])

  // Pontos individuais (por pessoa) e pontos avulsos de time (por unidade)
  const totalPessoa = {}
  const totalTime = {}
  ;(pts || []).forEach((p) => {
    if (p.usuario_id) totalPessoa[p.usuario_id] = (totalPessoa[p.usuario_id] || 0) + (p.pontos || 0)
    else if (p.unidade_id) totalTime[p.unidade_id] = (totalTime[p.unidade_id] || 0) + (p.pontos || 0)
  })

  const corUni = Object.fromEntries((us || []).map((u) => [u.id, u.cor || '#1e3a8a']))
  const nomeUni = Object.fromEntries((us || []).map((u) => [u.id, u.nome]))

  const unidades = (us || [])
    .map((u) => {
      const membros = (ps || [])
        .filter((p) => p.unidade_id === u.id && p.papel === 'desbravador')
        .map((p) => ({ id: p.id, nome: p.nome, foto: p.foto, cor: u.cor || '#1e3a8a', pts: totalPessoa[p.id] || 0 }))
        .sort((a, b) => b.pts - a.pts || a.nome.localeCompare(b.nome, 'pt-BR'))
      const media = membros.length ? Math.round(membros.reduce((s, m) => s + m.pts, 0) / membros.length) : 0
      const avulsos = totalTime[u.id] || 0
      // Método escolhido: pontos avulsos do time + média dos desbravadores (ambos justos com o tamanho)
      const pontos = avulsos + media
      return { id: u.id, nome: u.nome, cor: u.cor || '#1e3a8a', emblema: u.emblema, membros, media, avulsos, pontos }
    })
    // Ranking de unidades: maior pontuação total primeiro (desempate por nome) → 1º, 2º, 3º...
    .sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome, 'pt-BR'))

  const individual = (ps || [])
    .map((p) => ({
      id: p.id, nome: p.nome, foto: p.foto,
      unidade: nomeUni[p.unidade_id] || '', cor: corUni[p.unidade_id] || '#1e3a8a',
      pts: totalPessoa[p.id] || 0,
    }))
    // Ranking individual: maior pontuação primeiro (desempate por nome)
    .sort((a, b) => b.pts - a.pts || a.nome.localeCompare(b.nome, 'pt-BR'))

  return { unidades, individual }
}

// Lança pontos avulsos de time direto para uma unidade (sem atividade nem pessoa).
// O RLS só deixa a liderança (instrutor/diretoria) fazer isso.
export async function lancarPontosUnidade({ unidadeId, pontos, motivo, lancadoPor }) {
  const { error } = await supabase.from('pontos').insert({
    unidade_id: unidadeId, pontos, motivo: motivo || null, origem: 'unidade', lancado_por: lancadoPor,
  })
  if (error) throw error
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

// =====================================================================
//  NOTIFICAÇÕES (sininho) — o RLS já filtra o que cada cargo pode ver
// =====================================================================

export async function carregarNotificacoes() {
  const { data } = await supabase
    .from('notificacoes')
    .select('id,titulo,corpo,tipo,link,created_at')
    .order('created_at', { ascending: false })
    .limit(30)
  return data || []
}

// Marca no perfil que a pessoa viu as notificações agora (zera o contador).
export async function marcarNotificacoesVistas(userId) {
  await supabase.from('profiles').update({ notif_visto_em: new Date().toISOString() }).eq('id', userId)
}

// Membros ativos que têm data de nascimento (pro card de aniversariantes).
export async function carregarAniversariantes() {
  const { data } = await supabase
    .from('profiles')
    .select('id,nome,foto,nascimento')
    .eq('status', 'ativo')
    .not('nascimento', 'is', null)
  return data || []
}
