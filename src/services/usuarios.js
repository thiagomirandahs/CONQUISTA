// Serviço: usuarios — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'
import { comprimirImagem } from '../lib/imagem.js'
import { validarImagem } from '../lib/upload.js'


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


// Desativa/reativa uma pessoa. Desativada não entra no app e some do ranking
// e das listas, mas o histórico dela (pontos, fotos) fica preservado.
// Usa a permissão que a liderança já tem de editar perfil — sem SQL novo.
export async function definirAtivoUsuario(userId, ativo) {
  const { data, error } = await supabase.from('profiles')
    .update({ status: ativo ? 'ativo' : 'inativo' }).eq('id', userId).select('id,status')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Sem permissão (só liderança).')
  return data[0]
}


// Liga/desliga o MODO TESTE de uma conta: não pontua, não trava no 1x/dia e
// não aparece no ranking. Serve pra testar o app sem sujar nada.
export async function definirTesteUsuario(userId, teste) {
  const { data, error } = await supabase.from('profiles')
    .update({ teste: !!teste }).eq('id', userId).select('id,teste')
  if (error) {
    throw new Error(/teste|column|schema cache/i.test(error.message)
      ? 'Rode o SQL supabase/2026-07-15-modo-teste.sql primeiro.'
      : error.message)
  }
  if (!data || data.length === 0) throw new Error('Sem permissão (só liderança).')
  return data[0]
}


// ⚠️ APAGA a pessoa e TUDO dela (pontos, entregas, mensalidades, jogos, fotos).
// Sem volta. Só diretoria (a checagem de verdade é no banco).
export async function excluirUsuario(userId) {
  const { data, error } = await supabase.rpc('excluir_usuario', { p_id: userId })
  if (error) throw new Error(error.message)
  return data
}


// Muda a unidade (time) de um membro — passe null/'' pra deixar "sem unidade".
// Mesmo RLS do cargo: só liderança (o trigger protege_campos_perfil não reverte pra pode_aprovar).
export async function mudarUnidade(userId, unidadeId) {
  const { error } = await supabase.from('profiles').update({ unidade_id: unidadeId || null }).eq('id', userId)
  if (error) throw new Error(error.message)
}


// Envia/troca a foto de perfil do próprio usuário — o RLS deixa cada um editar seu perfil.
export async function atualizarFotoPerfil({ userId, file }) {
  await validarImagem(file) // tipo REAL + tamanho (hardening etapa 2)
  file = await comprimirImagem(file, { maxLado: 640 })
  const ext = file.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase()
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

export async function salvarAvatar(avatar, tipo = 'personagem') {
  const { data, error } = await supabase.rpc('salvar_avatar', { p_avatar: avatar, p_tipo: tipo })
  if (error) throw new Error(error.message)
  return data
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

