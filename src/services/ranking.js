// Serviço: ranking — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'
import { carregarTrilha } from './jogos.js'


// Carrega unidades, membros e pontos reais do banco e monta o ranking
export async function carregarRanking() {
  // Busca tudo em paralelo (inclusive o placar): o ranking_totais não depende de
  // us/ps, então deixá-lo no mesmo Promise.all corta 1 ida ao servidor na 1ª tela.
  const [{ data: us }, { data: ps }, { data: tot, error: totErr }] = await Promise.all([
    // '*' (não lista colunas) pra não quebrar se lema/grito/bandeira ainda não
    // existirem no banco (janela entre o deploy e rodar o SQL da identidade).
    supabase.from('unidades').select('*').order('nome'),
    // Ranking individual mostra todos os cargos ativos (menos "pais"); só desbravador/conselheiro
    // têm unidade_id, então os demais aparecem só no individual, sem afetar a média das unidades.
    // '*' (não lista colunas) pra não quebrar antes de rodar o SQL do modo teste.
    supabase.from('profiles').select('*').eq('status', 'ativo').neq('papel', 'pais'),
    // Soma no BANCO (RPC) pra não esbarrar no limite silencioso de 1000 linhas do Supabase.
    supabase.rpc('ranking_totais'),
  ])

  // Pontos individuais (por pessoa) e pontos avulsos de time (por unidade)
  const totalPessoa = {}
  const totalTime = {}
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

  // Conta de TESTE não entra no ranking nem puxa a média da unidade.
  const pessoas = (ps || []).filter((p) => !p.teste)

  const corUni = Object.fromEntries((us || []).map((u) => [u.id, u.cor || '#1e3a8a']))
  const nomeUni = Object.fromEntries((us || []).map((u) => [u.id, u.nome]))

  // Média geral do clube (por membro que está numa unidade). Serve pra NIVELAR as
  // unidades pequenas: uma unidade de 2 não fica em 1º só por ter 2 craques.
  const emUnidade = pessoas.filter((p) => p.unidade_id && nomeUni[p.unidade_id])
  const mediaClube = emUnidade.length
    ? emUnidade.reduce((s, p) => s + (totalPessoa[p.id] || 0), 0) / emUnidade.length
    : 0
  const K_NIVELA = 4 // "membros fantasma" na média do clube (maior = nivela mais)

  const unidades = (us || [])
    .map((u) => {
      const membros = pessoas
        // TODO MUNDO que está DENTRO da unidade conta na média — inclusive líderes
        // (decisão do dono em 24/07/2026: a unidade da liderança disputa de igual).
        // Quem é promovido continua saindo da unidade antiga automaticamente
        // (mudarCargo), então líder só conta se for realocado numa unidade.
        .filter((p) => p.unidade_id === u.id)
        .map((p) => ({ id: p.id, nome: p.nome, foto: p.foto, avatar: p.avatar, avatarTipo: p.avatar_tipo, papel: p.papel, cor: u.cor || '#1e3a8a', pts: totalPessoa[p.id] || 0 }))
        .sort((a, b) => b.pts - a.pts || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
      // MÉDIA NIVELADA (Bayesian): completa a unidade com K membros na média do
      // clube. Unidade pequena é puxada pra média geral (não dispara com 2 craques);
      // unidade grande quase não muda. Assim fica justo dos dois lados.
      const soma = membros.reduce((s, m) => s + m.pts, 0)
      const media = membros.length ? Math.round((soma + K_NIVELA * mediaClube) / (membros.length + K_NIVELA)) : 0
      const avulsos = totalTime[u.id] || 0
      const pontos = avulsos + media
      return { id: u.id, nome: u.nome, cor: u.cor || '#1e3a8a', emblema: u.emblema, lema: u.lema, grito: u.grito, bandeira: u.bandeira, membros, media, avulsos, pontos }
    })
    // Ranking de unidades: maior pontuação total primeiro (desempate por nome) → 1º, 2º, 3º...
    .sort((a, b) => b.pontos - a.pontos || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))

  const individual = pessoas
    .map((p) => ({
      id: p.id, nome: p.nome, foto: p.foto, avatar: p.avatar, avatarTipo: p.avatar_tipo, papel: p.papel,
      unidade: nomeUni[p.unidade_id] || '', cor: corUni[p.unidade_id] || '#1e3a8a',
      pts: totalPessoa[p.id] || 0,
    }))
    // Ranking individual: maior pontuação primeiro (desempate por nome)
    .sort((a, b) => b.pts - a.pts || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))

  return { unidades, individual }
}


// ------- Desafios da Semana (corrida que zera toda segunda) -------
// Metas da cartela pessoal: o que a criança faz na semana, contado por origem.
export const METAS_SEMANA = [
  { chave: 'missao', emoji: '🎯', nome: 'Missões', meta: 5 },
  { chave: 'trilha', emoji: '🎮', nome: 'Jogos', meta: 8 },
  { chave: 'devocional', emoji: '📖', nome: 'Devocional', meta: 5 },
  { chave: 'atividade', emoji: '📋', nome: 'Atividades', meta: 1 },
]


// Corrida das unidades NA SEMANA: mesma média do ranking geral, mas só dos
// pontos desde a segunda (ranking_semana() faz a janela no banco).
export async function carregarDesafiosSemana() {
  const [{ data: us }, { data: ps }, { data: sem }] = await Promise.all([
    supabase.from('unidades').select('id,nome,cor,emblema').order('nome'),
    // '*' pra trazer também a coluna 'teste' (conta de teste fica fora da corrida)
    supabase.from('profiles').select('*').eq('status', 'ativo').neq('papel', 'pais'),
    supabase.rpc('ranking_semana'),
  ])
  const inicio = sem?.inicio || null
  const totalPessoa = {}
  const totalTime = {}
  ;(sem?.pessoas || []).forEach((r) => { totalPessoa[r.id] = r.total || 0 })
  ;(sem?.times || []).forEach((r) => { totalTime[r.id] = r.total || 0 })

  const unidades = (us || [])
    .map((u) => {
      // Mesma regra do ranking geral: todo mundo da unidade conta na média
      // (inclusive líderes); conta de teste fica fora.
      const membros = (ps || [])
        .filter((p) => p.unidade_id === u.id && !p.teste)
        .map((p) => ({ id: p.id, nome: p.nome, foto: p.foto, papel: p.papel, pts: totalPessoa[p.id] || 0 }))
      const media = membros.length ? Math.round(membros.reduce((s, m) => s + m.pts, 0) / membros.length) : 0
      const avulsos = totalTime[u.id] || 0
      return { id: u.id, nome: u.nome, cor: u.cor || '#1e3a8a', emblema: u.emblema, membros, media, avulsos, pontos: avulsos + media }
    })
    .sort((a, b) => b.pontos - a.pontos || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))

  return { inicio, unidades }
}


// Cartela pessoal da semana: conta os PRÓPRIOS pontos por origem desde a segunda.
// (RLS deixa ler os próprios; filtramos por usuário + data, poucas linhas.)
export async function carregarMinhaCartela(inicio, meuId) {
  if (!inicio || !meuId) return METAS_SEMANA.map((m) => ({ ...m, feito: 0 }))
  const { data } = await supabase.from('pontos').select('origem').eq('usuario_id', meuId).gte('data', inicio)
  const cont = {}
  ;(data || []).forEach((p) => { cont[p.origem] = (cont[p.origem] || 0) + 1 })
  return METAS_SEMANA.map((m) => ({ ...m, feito: cont[m.chave] || 0 }))
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


// ------- Nível e avatar customizável -------
export async function meuTotalPontos() {
  const { data, error } = await supabase.rpc('meu_total_pontos')
  if (error) throw new Error(error.message)
  return data || 0
}
