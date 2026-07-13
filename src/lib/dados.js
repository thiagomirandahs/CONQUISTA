import { supabase } from './supabase.js'
import { comprimirImagem } from './imagem.js'
import { hojeLocalISO } from './data.js'

// Carrega unidades, membros e pontos reais do banco e monta o ranking
export async function carregarRanking() {
  const [{ data: us }, { data: ps }] = await Promise.all([
    supabase.from('unidades').select('id,nome,cor,emblema').order('nome'),
    // Ranking individual mostra todos os cargos ativos (menos "pais"); só desbravador/conselheiro
    // têm unidade_id, então os demais aparecem só no individual, sem afetar a média das unidades.
    supabase.from('profiles').select('id,nome,foto,unidade_id,papel').eq('status', 'ativo').neq('papel', 'pais'),
  ])

  // Pontos individuais (por pessoa) e pontos avulsos de time (por unidade)
  const totalPessoa = {}
  const totalTime = {}
  // Soma no BANCO (RPC) pra não esbarrar no limite silencioso de 1000 linhas do Supabase.
  const { data: tot, error: totErr } = await supabase.rpc('ranking_totais')
  if (!totErr && tot) {
    ;(tot.pessoas || []).forEach((r) => { totalPessoa[r.id] = r.total || 0 })
    ;(tot.times || []).forEach((r) => { totalTime[r.id] = r.total || 0 })
  } else {
    // Plano B (RPC indisponível): soma no cliente, alinhado à temporada atual.
    const { data: ini } = await supabase.rpc('temporada_inicio')
    let q = supabase.from('pontos').select('usuario_id,unidade_id,pontos')
    if (ini && !String(ini).startsWith('-inf')) q = q.gte('data', ini)
    const { data: pts } = await q
    ;(pts || []).forEach((p) => {
      if (p.usuario_id) totalPessoa[p.usuario_id] = (totalPessoa[p.usuario_id] || 0) + (p.pontos || 0)
      else if (p.unidade_id) totalTime[p.unidade_id] = (totalTime[p.unidade_id] || 0) + (p.pontos || 0)
    })
  }

  const corUni = Object.fromEntries((us || []).map((u) => [u.id, u.cor || '#1e3a8a']))
  const nomeUni = Object.fromEntries((us || []).map((u) => [u.id, u.nome]))

  const unidades = (us || [])
    .map((u) => {
      const membros = (ps || [])
        // Só desbravadores e conselheiros entram na média do time. Assim, um membro
        // promovido a líder (instrutor/tesoureiro/diretoria) que ainda tenha unidade
        // antiga NÃO puxa mais a média pra baixo.
        .filter((p) => p.unidade_id === u.id && (p.papel === 'desbravador' || p.papel === 'conselheiro'))
        .map((p) => ({ id: p.id, nome: p.nome, foto: p.foto, papel: p.papel, cor: u.cor || '#1e3a8a', pts: totalPessoa[p.id] || 0 }))
        .sort((a, b) => b.pts - a.pts || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
      const media = membros.length ? Math.round(membros.reduce((s, m) => s + m.pts, 0) / membros.length) : 0
      const avulsos = totalTime[u.id] || 0
      // Método escolhido: pontos avulsos do time + média dos desbravadores (ambos justos com o tamanho)
      const pontos = avulsos + media
      return { id: u.id, nome: u.nome, cor: u.cor || '#1e3a8a', emblema: u.emblema, membros, media, avulsos, pontos }
    })
    // Ranking de unidades: maior pontuação total primeiro (desempate por nome) → 1º, 2º, 3º...
    .sort((a, b) => b.pontos - a.pontos || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))

  const individual = (ps || [])
    .map((p) => ({
      id: p.id, nome: p.nome, foto: p.foto, papel: p.papel,
      unidade: nomeUni[p.unidade_id] || '', cor: corUni[p.unidade_id] || '#1e3a8a',
      pts: totalPessoa[p.id] || 0,
    }))
    // Ranking individual: maior pontuação primeiro (desempate por nome)
    .sort((a, b) => b.pts - a.pts || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))

  return { unidades, individual }
}

// ------- Temporadas (zerar o ranking guardando histórico) — só diretoria -------
// Encerra a temporada atual (guardando os campeões que o app já calculou) e
// começa outra do zero. Passe os nomes dos campeões atuais pra registrar.
export async function iniciarNovaTemporada({ campeaoIndividual, campeaoUnidade }) {
  const { data, error } = await supabase.rpc('nova_temporada', {
    p_campeao_individual: campeaoIndividual || null,
    p_campeao_unidade: campeaoUnidade || null,
  })
  if (error) throw new Error(error.message)
  return data
}
export async function carregarTemporadas() {
  const { data } = await supabase.from('temporadas')
    .select('numero, inicio, fim, campeao_individual, campeao_unidade')
    .not('fim', 'is', null)
    .order('numero', { ascending: false })
  return data || []
}

// Lança pontos avulsos de time direto para uma unidade (sem atividade nem pessoa).
// O RLS só deixa a liderança (instrutor/diretoria) fazer isso.
export async function lancarPontosUnidade({ unidadeId, pontos, motivo, lancadoPor }) {
  const { error } = await supabase.from('pontos').insert({
    unidade_id: unidadeId, pontos, motivo: motivo || null, origem: 'unidade', lancado_por: lancadoPor,
  })
  if (error) throw error
}

// Resumo pro Painel da Diretoria: números do clube numa olhada, com atalhos.
export async function carregarPainelDiretoria() {
  const agora = new Date()
  const mes = agora.getMonth() + 1
  const ano = agora.getFullYear()
  const head = { count: 'exact', head: true }
  const [cad, ent, ativos, mens, miss] = await Promise.all([
    supabase.from('profiles').select('id', head).eq('status', 'pendente'),
    supabase.from('entregas').select('id', head).eq('status', 'pendente'),
    supabase.from('profiles').select('id', head).eq('status', 'ativo').in('papel', ['desbravador', 'conselheiro']),
    supabase.from('mensalidades').select('id', head).eq('mes', mes).eq('ano', ano).eq('status', 'pago'),
    supabase.rpc('missoes_pendentes').then((r) => (r.data || []).length).catch(() => 0),
  ])
  return {
    cadastros: cad.count || 0,
    entregas: ent.count || 0,
    membros: ativos.count || 0,
    mensPagas: mens.count || 0,
    missoes: miss || 0,
  }
}

// Radar de faltas: quem faltou nas últimas reuniões seguidas (2+). Lê os
// apontamentos recentes e conta as faltas mais recentes de cada pessoa.
export async function carregarRadarFaltas() {
  const { data } = await supabase.from('pontos')
    .select('usuario_id, data, marca, pessoa:profiles!usuario_id(nome, foto, status)')
    .eq('origem', 'apontamento')
    .order('data', { ascending: false })
    .limit(500)
  const porPessoa = {}
  ;(data || []).forEach((p) => {
    if (!p.usuario_id) return
    ;(porPessoa[p.usuario_id] ||= { pessoa: p.pessoa, linhas: [] }).linhas.push(p)
  })
  const radar = []
  Object.entries(porPessoa).forEach(([id, info]) => {
    if (!info.pessoa || info.pessoa.status !== 'ativo') return
    let faltas = 0
    for (const l of info.linhas) { // linhas em ordem decrescente de data
      if (l.marca && l.marca.presenca === 'faltou') faltas++
      else break
    }
    if (faltas >= 2) radar.push({ id, nome: info.pessoa.nome, foto: info.pessoa.foto, faltas, ultima: info.linhas[0]?.data })
  })
  radar.sort((a, b) => b.faltas - a.faltas || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
  return radar
}

// Aviso PESSOAL (só uma pessoa vê/recebe) — usa a coluna para_usuario. Só liderança (RLS).
export async function enviarAvisoPessoal({ userId, titulo, corpo, criadoPor }) {
  const { error } = await supabase.from('notificacoes').insert({
    titulo, corpo: corpo || null, tipo: 'geral', link: '/', para: 'pessoal', para_usuario: userId, criado_por: criadoPor,
  })
  if (error) throw new Error(error.message)
}

// ------- Agenda do clube (eventos) — todos leem, liderança gerencia (RLS) -------
export async function carregarEventos({ futuros = true } = {}) {
  let q = supabase.from('eventos').select('*')
  if (futuros) q = q.gte('data', hojeLocalISO())
  const { data, error } = await q.order('data').order('hora', { nullsFirst: true })
  if (error) throw new Error(error.message)
  return data || []
}
export async function salvarEvento(dados, id) {
  const resp = id
    ? await supabase.from('eventos').update(dados).eq('id', id).select('id')
    : await supabase.from('eventos').insert(dados).select('id')
  if (resp.error) throw new Error(resp.error.message)
  if (!resp.data || resp.data.length === 0) throw new Error('Sem permissão (só liderança).')
}
export async function excluirEvento(id) {
  const { data, error } = await supabase.from('eventos').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Sem permissão (só liderança).')
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
    .limit(300)
  return data || []
}

// Envia o arquivo ao Storage e cria o registro da foto na categoria escolhida.
export async function adicionarFoto({ file, evento, legenda, autorId }) {
  file = await comprimirImagem(file)
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

// Muda o papel (cargo) de um membro — o RLS deixa a liderança atualizar perfis.
// Só desbravador/conselheiro pertencem a uma unidade: ao promover pra líder,
// limpa a unidade pra pessoa não continuar contando na média do time antigo.
export async function mudarCargo(userId, papel) {
  const mantemUnidade = papel === 'desbravador' || papel === 'conselheiro'
  const patch = mantemUnidade ? { papel } : { papel, unidade_id: null }
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
  if (error) throw new Error(error.message)
  return { limpouUnidade: !mantemUnidade }
}

// Muda a unidade (time) de um membro — passe null/'' pra deixar "sem unidade".
// Mesmo RLS do cargo: só liderança (o trigger protege_campos_perfil não reverte pra pode_aprovar).
export async function mudarUnidade(userId, unidadeId) {
  const { error } = await supabase.from('profiles').update({ unidade_id: unidadeId || null }).eq('id', userId)
  if (error) throw new Error(error.message)
}

// Envia um aviso geral (aparece no sino de todos, ou só da liderança).
// O RLS "criar notificacao" já exige liderança; o push sai sozinho se ativado.
export async function enviarAviso({ titulo, corpo, para, criadoPor }) {
  const { error } = await supabase.from('notificacoes').insert({
    titulo, corpo: corpo || null, tipo: 'geral', link: '/', para: para || 'todos', criado_por: criadoPor,
  })
  if (error) throw new Error(error.message)
}

// Lista as unidades (id, nome, cor) pra escolher no gerenciamento de usuários.
export async function listarUnidades() {
  const { data, error } = await supabase.from('unidades').select('id,nome,cor').order('nome')
  if (error) throw new Error(error.message)
  return data || []
}

// Lança pontos avulsos a um membro (individual), com motivo — só liderança (RLS).
export async function lancarPontosIndividual({ userId, pontos, motivo, lancadoPor }) {
  const { error } = await supabase.from('pontos').insert({
    usuario_id: userId, origem: 'manual', pontos, motivo: motivo || 'Ajuste manual', lancado_por: lancadoPor,
  })
  if (error) throw new Error(error.message)
}

// Extrato dos pontos de um usuário (os últimos lançamentos) — todos podem ver os
// próprios (RLS "ler pontos" é liberado). Mostra de onde veio cada ponto.
export async function carregarMeuExtrato(userId) {
  const { data } = await supabase
    .from('pontos')
    .select('id,origem,pontos,motivo,data')
    .eq('usuario_id', userId)
    .order('data', { ascending: false })
    .limit(100)
  return data || []
}

// Métricas pras conquistas/insígnias (derivadas do que já existe): passos da
// trilha, sequência das missões e fotos no mural. Resiliente a erro.
export async function carregarMetricasConquistas(userId) {
  const [trilha, resumoRes, fotosRes] = await Promise.all([
    carregarTrilha().catch(() => ({ passos: 0 })),
    supabase.rpc('meu_resumo_missoes'),
    supabase.from('fotos').select('id', { count: 'exact', head: true }).eq('autor_id', userId),
  ])
  return {
    passos: trilha?.passos || 0,
    sequencia: resumoRes?.data?.sequencia || 0,
    fotos: fotosRes?.count || 0,
  }
}

// Envia/troca a foto de perfil do próprio usuário — o RLS deixa cada um editar seu perfil.
export async function atualizarFotoPerfil({ userId, file }) {
  file = await comprimirImagem(file, { maxLado: 640 })
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `perfis/${userId}-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from('imagens').upload(path, file, { upsert: true })
  if (upErr) throw new Error('Não foi possível enviar a foto: ' + upErr.message)
  const { data: pub } = supabase.storage.from('imagens').getPublicUrl(path)
  const { error } = await supabase.from('profiles').update({ foto: pub.publicUrl }).eq('id', userId)
  if (error) throw new Error(error.message)
  return pub.publicUrl
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

// Trilha do Acampamento — meu progresso (jogou hoje? passos) e registrar o jogo.
export async function carregarTrilha() {
  const { data, error } = await supabase.rpc('meu_progresso_trilha')
  if (error) throw new Error(error.message)
  return data || { feito: false, passos: 0 }
}
export async function registrarJogo(tipo, estrelas) {
  const { data, error } = await supabase.rpc('registrar_jogo', { p_tipo: tipo, p_estrelas: estrelas })
  if (error) throw new Error(error.message)
  return data
}
// Ranking da Trilha (todos): soma de estrelas + nº de jogos por pessoa.
export async function carregarRankingTrilha() {
  const { data, error } = await supabase.rpc('ranking_trilha')
  if (error) throw new Error(error.message)
  return data || []
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
    foto = await comprimirImagem(foto)
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

// ------- Painel de conteúdo (versículos e desafios) — só liderança (RLS) -------
// O RLS "ler/gerir versiculos|desafios" já limita tudo a pode_gerir(); a criança
// nunca lê a tabela (a resposta certa continua secreta).
const TABELAS_CONTEUDO = ['versiculos', 'desafios']
function tabelaOk(tabela) {
  if (!TABELAS_CONTEUDO.includes(tabela)) throw new Error('Tabela inválida')
  return tabela
}
export async function carregarConteudo(tabela) {
  const { data, error } = await supabase.from(tabelaOk(tabela)).select('*').order('created_at')
  if (error) throw new Error(error.message)
  return data || []
}
export async function salvarConteudo(tabela, dados, id) {
  const t = tabelaOk(tabela)
  const resp = id
    ? await supabase.from(t).update(dados).eq('id', id).select('id')
    : await supabase.from(t).insert(dados).select('id')
  if (resp.error) throw new Error(resp.error.message)
  if (!resp.data || resp.data.length === 0) throw new Error('Sem permissão (só liderança).')
}
export async function excluirConteudo(tabela, id) {
  const { data, error } = await supabase.from(tabelaOk(tabela)).delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Sem permissão (só liderança).')
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
