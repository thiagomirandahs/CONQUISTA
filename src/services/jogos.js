// Serviço: jogos — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'

// Jogo da semana: a chave do jogo sorteado que vale +20 pro melhor no domingo.
// É o agendador (SQL 2026-07-30-rodada-semana) que sorteia e grava. Aqui só lê.
export async function lerJogoDaSemana() {
  const { data } = await supabase.from('config_clube').select('valor')
    .eq('chave', 'jogo_da_semana').maybeSingle()
  return data?.valor || ''
}

// ------- Popup de aviso (a liderança escreve a mensagem que abre no app) -------
// Guardado no config_clube (chave/valor). Se as chaves ainda não existem, o
// upsert cria — por isso esta feature não precisa de SQL novo.
const CHAVES_POPUP = ['popup_ativo', 'popup_titulo', 'popup_texto', 'popup_alvo']

export async function lerConfigPopup() {
  const { data } = await supabase.from('config_clube').select('chave,valor').in('chave', CHAVES_POPUP)
  const m = Object.fromEntries((data || []).map((r) => [r.chave, r.valor]))
  return {
    ativo: m.popup_ativo === 'sim',
    titulo: m.popup_titulo || '',
    texto: m.popup_texto || '',
    alvo: m.popup_alvo === 'devendo' ? 'devendo' : 'todos',
  }
}

export async function salvarConfigPopup(cfg) {
  const linhas = [
    { chave: 'popup_ativo', valor: cfg.ativo ? 'sim' : 'nao' },
    { chave: 'popup_titulo', valor: (cfg.titulo || '').trim() },
    { chave: 'popup_texto', valor: (cfg.texto || '').trim() },
    { chave: 'popup_alvo', valor: cfg.alvo === 'devendo' ? 'devendo' : 'todos' },
  ]
  const { error } = await supabase.from('config_clube').upsert(linhas, { onConflict: 'chave' })
  if (error) throw new Error(error.message)
}


// Trilha do Acampamento — meu progresso (jogou hoje? passos) e registrar o jogo.
// Progresso dos jogos: { feito, passos, hoje: ['memoria','caca'] } — 'hoje' são
// os jogos JÁ jogados hoje (cada jogo pode ser jogado 1x por dia).
export async function carregarTrilha() {
  const { data, error } = await supabase.rpc('meu_progresso_trilha')
  if (error) throw new Error(error.message)
  const d = data || {}
  return { feito: !!d.feito, passos: d.passos || 0, hoje: Array.isArray(d.hoje) ? d.hoje : [] }
}

// ---- Anti-cheat (hardening etapa 2): sessão de partida ----
// Ao ABRIR um jogo, o app pede uma "partida" ao servidor (iniciar_jogo). Ao
// terminar, registrar_jogo/registrar_recorde levam o id junto — o banco valida
// dono, jogo, validade, duração mínima e consome atomicamente. Se a RPC de
// início não existir ainda (SQL não rodado) ou falhar, segue sem partida
// (modo transição do servidor decide).
const _partidas = {}

export async function iniciarPartida(jogo) {
  try {
    const { data, error } = await supabase.rpc('iniciar_jogo', { p_tipo: jogo })
    if (error) throw error
    _partidas[jogo] = data?.id || null
  } catch { _partidas[jogo] = null }
  return _partidas[jogo]
}


export async function registrarJogo(tipo, estrelas) {
  const { data, error } = await supabase.rpc('registrar_jogo', {
    p_tipo: tipo, p_estrelas: estrelas, p_partida: _partidas[tipo] ?? null,
  })
  if (error) {
    // servidor antigo (sem o parâmetro novo): tenta do jeito antigo — a janela
    // de deploy nunca pode quebrar o jogo da criança
    if (/p_partida|function public\.registrar_jogo/i.test(error.message || '')) {
      const r2 = await supabase.rpc('registrar_jogo', { p_tipo: tipo, p_estrelas: estrelas })
      if (r2.error) throw new Error(r2.error.message)
      return r2.data
    }
    throw new Error(error.message)
  }
  delete _partidas[tipo] // partida consumida
  return data
}

// Bônus por completar os jogos do dia (o servidor confere o conjunto e o valor, 1x/dia).
// Devolve { completo, total, feitos, ganhou }. Silencioso se o SQL não rodou.
export async function bonusTodosJogos() {
  const { data, error } = await supabase.rpc('bonus_todos_jogos')
  if (error) return { completo: false, total: 0, feitos: 0, ganhou: 0 }
  return data || { completo: false, total: 0, feitos: 0, ganhou: 0 }
}

// Jogos da Trilha (quais estão ativos) — todos leem; liderança liga/desliga.
export async function carregarJogosTrilha() {
  const { data } = await supabase.from('jogos_trilha').select('*').order('ordem')
  return data || []
}

// ⚡ Modo sem fim: registra a corrida e o banco guarda só o MELHOR da semana.
// Devolve { recorde, melhorou }. Repetição é livre — não dá +10/+5 (sem farm).
export async function registrarRecorde(jogo, pontos) {
  const { data, error } = await supabase.rpc('registrar_recorde', {
    p_jogo: jogo, p_pontos: pontos, p_partida: _partidas[jogo] ?? null,
  })
  if (error) {
    // servidor antigo (sem o parâmetro novo): cai pro jeito antigo
    if (/p_partida|function public\.registrar_recorde/i.test(error.message || '')) {
      const r2 = await supabase.rpc('registrar_recorde', { p_jogo: jogo, p_pontos: pontos })
      if (r2.error) throw new Error(r2.error.message)
      return r2.data || { recorde: pontos, melhorou: false }
    }
    throw new Error(error.message)
  }
  // arcade NÃO consome a partida (vale a sessão inteira de replays)
  return data || { recorde: pontos, melhorou: false }
}


// Interruptor: só desbravadores disputam os recordes (liderança fica de fora
// do ranking e do prêmio). A regra de verdade é aplicada no servidor.
export async function lerReflexoSoDesbravador() {
  const { data } = await supabase.from('config_clube').select('valor')
    .eq('chave', 'reflexo_so_desbravador').maybeSingle()
  return (data?.valor ?? 'sim') === 'sim'
}

export async function salvarReflexoSoDesbravador(so) {
  const { error } = await supabase.from('config_clube')
    .upsert([{ chave: 'reflexo_so_desbravador', valor: so ? 'sim' : 'nao' }], { onConflict: 'chave' })
  if (error) throw new Error(error.message)
}


// Interruptor do rodízio 🥇 Jogos do Dia (3 abertos/dia + prêmio +10).
// Desligado = todos os jogos abertos. A regra de verdade é aplicada no servidor.
export async function lerRodizioJogos() {
  const { data } = await supabase.from('config_clube').select('valor')
    .eq('chave', 'rodizio_jogos').maybeSingle()
  return (data?.valor ?? 'sim') === 'sim'
}

export async function salvarRodizioJogos(ligado) {
  const { error } = await supabase.from('config_clube')
    .upsert([{ chave: 'rodizio_jogos', valor: ligado ? 'sim' : 'nao' }], { onConflict: 'chave' })
  if (error) throw new Error(error.message)
}


// Liderança: apaga o recorde DA SEMANA de alguém (ex.: valor forjado).
// A pessoa pode cravar um novo jogando de verdade.
export async function excluirRecorde(usuarioId, jogo) {
  const sp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const dow = (sp.getDay() + 6) % 7 // 0 = segunda
  sp.setDate(sp.getDate() - dow)
  const semana = `${sp.getFullYear()}-${String(sp.getMonth() + 1).padStart(2, '0')}-${String(sp.getDate()).padStart(2, '0')}`
  const { data, error } = await supabase.from('recordes').delete()
    .eq('usuario_id', usuarioId).eq('jogo', jogo).eq('semana', semana).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Sem permissão (só liderança) ou recorde não encontrado.')
}


// Ranking de recordes da semana (top 20). O maior ganha +20 no domingo.
export async function carregarRecordesSemana(jogo) {
  const { data, error } = await supabase.rpc('recordes_semana', { p_jogo: jogo })
  if (error) throw new Error(error.message)
  return data || []
}


// ---------- 🆘 Pedir ajuda a um amigo (jogos de palavra) ----------
// Lista de amigos ativos (não pais) pro seletor — a RLS de profiles já libera
// pra membro ativo. Tira o próprio id da lista.
export async function listarColegas(meuId) {
  const { data } = await supabase.from('profiles').select('id,nome,foto,unidade_id')
    .eq('status', 'ativo').neq('papel', 'pais').order('nome')
  return (data || []).filter((p) => p.id !== meuId)
}

export async function pedirAjuda({ para, jogo, enunciado, resposta }) {
  const { data, error } = await supabase.rpc('pedir_ajuda',
    { p_para: para, p_jogo: jogo, p_enunciado: enunciado, p_resposta: resposta })
  if (error) throw new Error(error.message)
  return data // id do pedido
}

export async function ajudasRecebidas() {
  const { data, error } = await supabase.rpc('ajudas_recebidas')
  if (error) throw new Error(error.message)
  return data || []
}

export async function resolverAjuda(id, tentativa) {
  const { data, error } = await supabase.rpc('resolver_ajuda', { p_id: id, p_tentativa: tentativa })
  if (error) throw new Error(error.message)
  return data || { ok: false }
}

export async function ajudaStatus(id) {
  const { data, error } = await supabase.rpc('ajuda_status', { p_id: id })
  if (error) throw new Error(error.message)
  return data || { status: 'nao' }
}

export async function cancelarAjuda(id) { await supabase.rpc('cancelar_ajuda', { p_id: id }) }

export async function recusarAjuda(id) { await supabase.rpc('recusar_ajuda', { p_id: id }) }


// Painel da liderança: quem jogou hoje/na semana e quem está sumido (2+ dias).
export async function atividadeJogos() {
  const { data, error } = await supabase.rpc('atividade_jogos')
  if (error) throw new Error(error.message)
  return data || { hoje: 0, semana: 0, total: 0, ausentes: [] }
}


export async function alternarJogoTrilha(chave, ativo) {
  const { data, error } = await supabase.from('jogos_trilha').update({ ativo }).eq('chave', chave).select('chave')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Sem permissão (só liderança).')
}

// Ranking dos Jogos, POR JOGO. Devolve { geral:[...], memoria:[...], ... }
// com {id,nome,foto,passos,estrelas} ordenados. Jogo sem plays não vira chave.
export async function carregarRankingTrilha() {
  const { data, error } = await supabase.rpc('ranking_trilha')
  if (error) throw new Error(error.message)
  return data || {}
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


// 🥇 Jogos do Dia: trio de hoje + liberados manualmente + quando cada um abre
export async function statusJogosDoDia() {
  const { data, error } = await supabase.rpc('status_jogos_do_dia')
  if (error) throw new Error(error.message)
  return data
}

export async function liberarJogo(chave) {
  const { data, error } = await supabase.rpc('liberar_jogo', { p_chave: chave })
  if (error) throw new Error(error.message)
  return data
}

export async function trancarJogo(chave) {
  const { data, error } = await supabase.rpc('trancar_jogo', { p_chave: chave })
  if (error) throw new Error(error.message)
  return data
}
