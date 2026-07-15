import { supabase } from './supabase.js'
import { comprimirImagem } from './imagem.js'
import { hojeLocalISO } from './data.js'

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
    supabase.from('profiles').select('id,nome,foto,unidade_id,papel').eq('status', 'ativo').neq('papel', 'pais'),
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
      return { id: u.id, nome: u.nome, cor: u.cor || '#1e3a8a', emblema: u.emblema, lema: u.lema, grito: u.grito, bandeira: u.bandeira, membros, media, avulsos, pontos }
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
    supabase.from('profiles').select('id,nome,foto,unidade_id,papel').eq('status', 'ativo').neq('papel', 'pais'),
    supabase.rpc('ranking_semana'),
  ])
  const inicio = sem?.inicio || null
  const totalPessoa = {}
  const totalTime = {}
  ;(sem?.pessoas || []).forEach((r) => { totalPessoa[r.id] = r.total || 0 })
  ;(sem?.times || []).forEach((r) => { totalTime[r.id] = r.total || 0 })

  const unidades = (us || [])
    .map((u) => {
      // Mesma regra do ranking geral: só desbravador/conselheiro entram na média.
      const membros = (ps || [])
        .filter((p) => p.unidade_id === u.id && (p.papel === 'desbravador' || p.papel === 'conselheiro'))
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

// Mensalidade pendente do PRÓPRIO usuário (pro popup de cobrança). O RLS já
// limita às próprias, mas a liderança (financeiro) vê todas — por isso filtramos
// por desbravador_id, pra o líder não receber o popup dos outros. Devolve a mais
// antiga pendente + quantas no total.
export async function minhaMensalidadePendente(userId) {
  if (!userId) return null
  const { data } = await supabase
    .from('mensalidades')
    .select('mes,ano,valor')
    .eq('desbravador_id', userId)
    .eq('status', 'pendente')
    .order('ano', { ascending: true })
    .order('mes', { ascending: true })
  const pend = data || []
  if (!pend.length) return null
  return { ...pend[0], quantas: pend.length }
}

// ------- Portal dos Pais (responsável -> filho) -------
// Pai pede o vínculo digitando o nome do filho; a diretoria aprova.
export async function pedirVinculo(nome) {
  const { data, error } = await supabase.rpc('pedir_vinculo', { p_nome: nome })
  if (error) throw new Error(error.message)
  return data
}
// Meus pedidos de vínculo (pra o pai ver o status: pendente/aprovado/rejeitado).
export async function meusPedidosVinculo() {
  const { data } = await supabase.from('responsaveis')
    .select('id,nome_digitado,status,criado_em').order('criado_em', { ascending: false })
  return data || []
}
// Dados dos filhos aprovados (pontos, presença, mensalidade). RLS/segurança no banco.
export async function carregarMeusFilhos() {
  const { data, error } = await supabase.rpc('meus_filhos')
  if (error) throw new Error(error.message)
  return data || []
}
// Diretoria: pedidos de vínculo aguardando aprovação.
export async function carregarVinculosPendentes() {
  const { data, error } = await supabase.rpc('vinculos_pendentes')
  if (error) throw new Error(error.message)
  return data || []
}
// Diretoria: buscar desbravadores por nome (pra escolher o filho certo ao aprovar).
export async function buscarDesbravadores(termo) {
  let q = supabase.from('profiles')
    .select('id,nome,foto,unidade_id').eq('status', 'ativo')
    .in('papel', ['desbravador', 'conselheiro']).order('nome').limit(20)
  if (termo && termo.trim()) q = q.ilike('nome', `%${termo.trim()}%`)
  const { data } = await q
  return data || []
}
export async function aprovarVinculo(id, desbravadorId) {
  const { error } = await supabase.rpc('aprovar_vinculo', { p_id: id, p_desbravador_id: desbravadorId })
  if (error) throw new Error(error.message)
}
export async function rejeitarVinculo(id) {
  const { error } = await supabase.rpc('rejeitar_vinculo', { p_id: id })
  if (error) throw new Error(error.message)
}
// PIX do clube (config_clube). Todos leem; liderança salva.
export async function lerPix() {
  const { data } = await supabase.from('config_clube').select('valor').eq('chave', 'pix').maybeSingle()
  return data?.valor || ''
}
export async function salvarPix(valor) {
  const { error } = await supabase.from('config_clube').update({ valor: (valor || '').trim() }).eq('chave', 'pix')
  if (error) throw new Error(error.message)
}

// ------- Duelo entre unidades (uma unidade desafia a outra) -------
// Traz tudo o que a tela precisa numa rodada só: duelos + unidades + catálogo.
export async function carregarDuelos() {
  const [{ data: ds, error: erroDuelos }, { data: us, error: erroUni }, { data: cat, error: erroCat }] = await Promise.all([
    // Cancelado é filtrado NO BANCO: senão ele gastaria a cota de 60 e empurraria
    // o histórico julgado pra fora da tela. status asc põe os 'aberto' primeiro,
    // então o limite nunca corta um duelo aberto (que ainda conta no teto lá).
    supabase.from('duelos').select('*')
      .neq('status', 'cancelado')
      .order('status', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(60),
    supabase.from('unidades').select('id,nome,cor,emblema').order('nome'),
    supabase.from('desafios_unidade').select('*').order('titulo'),
  ])
  // Sem as tabelas (SQL não rodado), a tela mostra "rode o SQL" em vez de "nenhum duelo".
  // O catálogo também precisa checar erro: senão a tela mentiria dizendo que a
  // liderança não cadastrou nada, quando na verdade foi a rede que falhou.
  if (erroDuelos) throw new Error(erroDuelos.message)
  if (erroCat) throw new Error(erroCat.message)
  if (erroUni) throw new Error(erroUni.message) // senão os cards viriam com nome "?"
  const uni = Object.fromEntries((us || []).map((u) => [u.id, u]))
  const des = Object.fromEntries((cat || []).map((d) => [d.id, d]))
  const semUni = { nome: '?', cor: '#1e3a8a' }
  const duelos = (ds || [])
    .map((d) => {
      const cat0 = des[d.desafio_id] || {}
      return {
        ...d,
        a: uni[d.unidade_a] || semUni,
        b: uni[d.unidade_b] || semUni,
        // Usa o SNAPSHOT gravado no duelo; o catálogo só entra como reserva
        // (editar o catálogo não pode reescrever o histórico já julgado).
        desafio: {
          titulo: d.titulo || cat0.titulo || 'Desafio',
          // '||' (e não '??') de propósito: duelo antigo sem snapshot vem com 0,
          // e 0 tem que cair no catálogo — senão a tela mostraria "+0".
          pontos: d.pontos || cat0.pontos || 0,
          descricao: cat0.descricao || null,
          tipo: cat0.tipo || 'manual', // se o app mede, dá pra ver o progresso
        },
      }
    })
    .sort((x, y) => (x.status === y.status ? 0 : x.status === 'aberto' ? -1 : 1))
  return { duelos, unidades: us || [], catalogo: cat || [] }
}

// Qualquer desbravador desafia OUTRA unidade (as regras são checadas no banco).
export async function criarDuelo(desafioId, unidadeB) {
  const { data, error } = await supabase.rpc('criar_duelo', { p_desafio_id: desafioId, p_unidade_b: unidadeB })
  if (error) throw new Error(error.message)
  return data
}

// Desenvolvimento do duelo: quem cumpriu e quanto cada um fez (por unidade).
// Só para desafios que o app mede (missões/presença/jogos/devocional).
export async function progressoDuelo(id) {
  const { data, error } = await supabase.rpc('progresso_duelo', { p_id: id })
  if (error) throw new Error(error.message)
  return data || { tipo: 'manual' }
}

// Só liderança: define quem cumpriu ('a' | 'b' | 'ambos' | 'ninguem') e premia.
export async function julgarDuelo(id, vencedor) {
  const { data, error } = await supabase.rpc('julgar_duelo', { p_id: id, p_vencedor: vencedor })
  if (error) throw new Error(error.message)
  return data
}

// Cancelar: MARCA como cancelado (não apaga). Liderança sempre; o autor só
// enquanto o duelo está aberto. Apagar de vez zerava os contadores e permitia
// criar/apagar em loop tocando o push do clube — por isso é RPC, não delete.
export async function cancelarDuelo(id) {
  const { data, error } = await supabase.rpc('cancelar_duelo', { p_id: id })
  if (error) throw new Error(error.message)
  return data
}

// Catálogo de desafios de unidade (só liderança edita — RLS "gerir desafios_unidade")
export async function salvarDesafioUnidade(d, id) {
  const base = {
    titulo: (d.titulo || '').trim(),
    descricao: (d.descricao || '').trim() || null,
    pontos: Math.max(1, Math.min(500, parseInt(d.pontos, 10) || 50)),
    dias: Math.max(1, Math.min(90, parseInt(d.dias, 10) || 7)),
    ativo: d.ativo !== false,
  }
  const comTipo = {
    ...base,
    tipo: ['manual', 'missoes', 'presenca', 'jogos', 'devocional'].includes(d.tipo) ? d.tipo : 'manual',
    meta: Math.max(1, Math.min(50, parseInt(d.meta, 10) || 1)),
  }
  const grava = (linha) => (id
    ? supabase.from('desafios_unidade').update(linha).eq('id', id).select('id')
    : supabase.from('desafios_unidade').insert(linha).select('id'))
  let { data, error } = await grava(comTipo)
  // Janela de deploy: se tipo/meta ainda não existem no banco, grava sem elas.
  if (error && /tipo|meta|column|schema cache/i.test(error.message || '')) {
    ;({ data, error } = await grava(base))
  }
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Sem permissão (só liderança).')
}

export async function excluirDesafioUnidade(id) {
  const { error } = await supabase.from('desafios_unidade').delete().eq('id', id)
  // Se já foi usado num duelo, o banco barra (on delete restrict) — desative em vez de apagar.
  if (error) throw new Error(/violates foreign key|restrict/i.test(error.message)
    ? 'Esse desafio já foi usado num duelo. Desative-o em vez de apagar.'
    : error.message)
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

// Identidade da unidade: lema e grito (a bandeira/emblema sobem pelo Storage
// direto na tela). Só liderança consegue (policy "gerir unidades").
export async function salvarIdentidadeUnidade({ unidadeId, lema, grito }) {
  const { error } = await supabase.from('unidades').update({
    lema: (lema || '').trim() || null,
    grito: (grito || '').trim() || null,
  }).eq('id', unidadeId)
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
// Progresso dos jogos: { feito, passos, hoje: ['memoria','caca'] } — 'hoje' são
// os jogos JÁ jogados hoje (cada jogo pode ser jogado 1x por dia).
export async function carregarTrilha() {
  const { data, error } = await supabase.rpc('meu_progresso_trilha')
  if (error) throw new Error(error.message)
  const d = data || {}
  return { feito: !!d.feito, passos: d.passos || 0, hoje: Array.isArray(d.hoje) ? d.hoje : [] }
}
export async function registrarJogo(tipo, estrelas) {
  const { data, error } = await supabase.rpc('registrar_jogo', { p_tipo: tipo, p_estrelas: estrelas })
  if (error) throw new Error(error.message)
  return data
}
// Jogos da Trilha (quais estão ativos) — todos leem; liderança liga/desliga.
export async function carregarJogosTrilha() {
  const { data } = await supabase.from('jogos_trilha').select('*').order('ordem')
  return data || []
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
