// Serviço: unidades — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'

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


// Lista as unidades (id, nome, cor) pra escolher no gerenciamento de usuários.
export async function listarUnidades() {
  const { data, error } = await supabase.from('unidades').select('id,nome,cor').order('nome')
  if (error) throw new Error(error.message)
  return data || []
}


// ------- Modo Acampamento (colocação 1º/2º/3º/4º das unidades numa prova) -------
// Só entram as unidades que TÊM desbravador/conselheiro (a "Liderança" fica de fora).
export async function carregarUnidadesCompetidoras() {
  const [{ data: us, error: erroU }, { data: ps, error: erroP }] = await Promise.all([
    supabase.from('unidades').select('id,nome,cor,emblema').order('nome'),
    supabase.from('profiles').select('unidade_id').eq('status', 'ativo').in('papel', ['desbravador', 'conselheiro']).not('unidade_id', 'is', null),
  ])
  if (erroU) throw new Error(erroU.message)
  if (erroP) throw new Error(erroP.message)
  const comCompetidor = new Set((ps || []).map((p) => p.unidade_id))
  return (us || []).filter((u) => comCompetidor.has(u.id))
}


// colocacoes: [{unidade_id, posicao: 1|2|3|4|null, pontos: number}]
export async function lancarColocacaoAcampamento(atividade, colocacoes) {
  const { data, error } = await supabase.rpc('lancar_colocacao_acampamento', { p_atividade: atividade, p_colocacoes: colocacoes })
  if (error) throw new Error(error.message)
  return data
}


// Últimos lançamentos do acampamento (pra liderança ver o que já foi lançado)
export async function carregarHistoricoAcampamento() {
  const { data: ps, error } = await supabase
    .from('pontos').select('id,pontos,motivo,data,unidade_id')
    .eq('origem', 'acampamento').order('data', { ascending: false }).limit(30)
  if (error) throw new Error(error.message)
  const unidadeIds = [...new Set((ps || []).map((p) => p.unidade_id).filter(Boolean))]
  if (!unidadeIds.length) return []
  const { data: us } = await supabase.from('unidades').select('id,nome,cor').in('id', unidadeIds)
  const uniPorId = Object.fromEntries((us || []).map((u) => [u.id, u]))
  return (ps || []).map((p) => ({ ...p, unidade: uniPorId[p.unidade_id] || { nome: '?' } }))
}
