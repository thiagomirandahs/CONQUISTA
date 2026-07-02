import { supabase } from './supabase.js'

// Carrega unidades, membros e pontos reais do banco e monta o ranking
export async function carregarRanking() {
  const [{ data: us }, { data: ps }, { data: pts }] = await Promise.all([
    supabase.from('unidades').select('id,nome,cor,emblema').order('nome'),
    // Ranking individual mostra todos os cargos ativos (menos "pais"); só desbravador/conselheiro
    // têm unidade_id, então os demais aparecem só no individual, sem afetar a média das unidades.
    supabase.from('profiles').select('id,nome,foto,unidade_id,papel').eq('status', 'ativo').neq('papel', 'pais'),
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
        .filter((p) => p.unidade_id === u.id) // desbravadores + conselheiros da unidade entram na média
        .map((p) => ({ id: p.id, nome: p.nome, foto: p.foto, papel: p.papel, cor: u.cor || '#1e3a8a', pts: totalPessoa[p.id] || 0 }))
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

// Lançamentos de pontos recentes (individual e de unidade) para a liderança remover.
export async function carregarLancamentos() {
  const { data } = await supabase
    .from('pontos')
    .select('id,pontos,origem,motivo,data,usuario_id,unidade_id,pessoa:profiles!usuario_id(nome),unidade:unidades!unidade_id(nome)')
    .order('data', { ascending: false })
    .limit(200)
  return data || []
}

// Remove um lançamento de pontos (o RLS só deixa a liderança). Ranking se ajusta sozinho.
export async function removerLancamento(id) {
  const { data, error } = await supabase.from('pontos').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Não foi possível remover (sem permissão).')
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

// =====================================================================
//  USUÁRIOS (gestão da liderança) — listar e resetar senha
// =====================================================================

// Lista os usuários COM o e-mail do cadastro (função SQL listar_usuarios,
// que só responde para liderança). Sem Edge Function — só RPC.
export async function carregarUsuarios() {
  const { data, error } = await supabase.rpc('listar_usuarios')
  if (error) throw new Error(error.message)
  return data || []
}

// Define uma nova senha para um membro (função SQL resetar_senha_membro).
export async function resetarSenha(userId, novaSenha) {
  const { error } = await supabase.rpc('resetar_senha_membro', { alvo: userId, nova_senha: novaSenha })
  if (error) throw new Error(error.message)
  return { ok: true }
}

// =====================================================================
//  DEVOCIONAL DIÁRIO — versículo do dia + quiz + foto + sequência
// =====================================================================

export async function carregarDevocional() {
  const [{ data: vers }, { data: resumo }] = await Promise.all([
    supabase.rpc('versiculo_do_dia'),
    supabase.rpc('meu_resumo_devocional'),
  ])
  const versiculo = Array.isArray(vers) ? vers[0] : vers
  return {
    versiculo: versiculo || null,
    resumo: resumo || { feito: false, sequencia: 0, foto: null },
  }
}

// Classe do desbravador pela idade (padrão Desbravadores).
export function classeDoUsuario(nascimento) {
  if (!nascimento) return null
  const [a, m, d] = String(nascimento).split('-').map(Number)
  const hoje = new Date()
  let idade = hoje.getFullYear() - a
  const jaFez = hoje.getMonth() + 1 > m || (hoje.getMonth() + 1 === m && hoje.getDate() >= d)
  if (!jaFez) idade--
  const mapa = { 10: 'Amigo', 11: 'Companheiro', 12: 'Pesquisador', 13: 'Pioneiro', 14: 'Excursionista', 15: 'Guia' }
  return mapa[idade] || (idade < 10 ? 'Amigo' : 'Guia')
}

// Missão do dia (devocional OU desafio da classe) + resumo (feito/sequência).
export async function carregarMissao() {
  const [{ data: m }, { data: resumo }] = await Promise.all([
    supabase.rpc('missao_do_dia'),
    supabase.rpc('meu_resumo_missoes'),
  ])
  const missao = Array.isArray(m) ? m[0] : m
  return { missao: missao || null, resumo: resumo || { feito: false, sequencia: 0, foto: null } }
}

// Devocional (popup diário): já fez hoje? + o versículo do dia (sem a resposta).
export async function carregarDevocionalPopup() {
  const [{ data: feito }, { data: v }] = await Promise.all([
    supabase.rpc('devocional_feito_hoje'),
    supabase.rpc('versiculo_do_dia'),
  ])
  const versiculo = Array.isArray(v) ? v[0] : v
  return { feito: !!feito, versiculo: versiculo || null }
}

// Registra o devocional do popup (ler + quiz) e ganha 5 pontos, 1x/dia.
export async function fazerDevocional(resposta) {
  const { data, error } = await supabase.rpc('registrar_devocional', { p_resposta: resposta ?? null })
  if (error) throw new Error(error.message)
  return data
}

// Envia a foto (se a missão pedir) e registra a missão do dia (pontua na hora).
export async function enviarMissao({ foto, resposta, userId }) {
  let fotoUrl = null
  if (foto) {
    const ext = (foto.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `missoes/${userId}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('imagens').upload(path, foto, { upsert: true })
    if (upErr) throw new Error('Não foi possível enviar a foto: ' + upErr.message)
    const { data: pub } = supabase.storage.from('imagens').getPublicUrl(path)
    fotoUrl = pub.publicUrl
  }
  const { data, error } = await supabase.rpc('registrar_missao', { p_foto_url: fotoUrl, p_resposta: resposta ?? null })
  if (error) throw new Error(error.message)
  return data
}

// Missões de foto aguardando aprovação (só liderança).
export async function carregarMissoesPendentes() {
  const { data, error } = await supabase.rpc('missoes_pendentes')
  if (error) throw new Error(error.message)
  return data || []
}

// Aprovar (vira pontos) ou reprovar (0) uma missão de foto.
export async function avaliarMissao(id, aprovar) {
  const { error } = await supabase.rpc('avaliar_missao', { p_id: id, p_aprovar: aprovar })
  if (error) throw new Error(error.message)
}

// Envia a foto pro Storage e registra o devocional do dia (pontua na hora).
// resposta = índice da opção escolhida no quiz (ou null).
export async function enviarDevocional({ foto, resposta, userId }) {
  let fotoUrl = null
  if (foto) {
    const ext = (foto.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `devocional/${userId}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('imagens').upload(path, foto, { upsert: true })
    if (upErr) throw new Error('Não foi possível enviar a foto: ' + upErr.message)
    const { data: pub } = supabase.storage.from('imagens').getPublicUrl(path)
    fotoUrl = pub.publicUrl
  }
  const { data, error } = await supabase.rpc('registrar_devocional', { p_foto_url: fotoUrl, p_resposta: resposta ?? null })
  if (error) throw new Error(error.message)
  return data // { acertou, pontos }
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
