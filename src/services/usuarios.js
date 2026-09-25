// Serviço: usuarios — extraído de lib/dados.js.
import { supabase } from '../lib/supabase.js'
import { comprimirImagem } from '../lib/imagem.js'
import { validarImagem } from '../lib/upload.js'
import { membrosDoClube, PAPEIS_DE_UNIDADE } from './membros.js'


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

// Dados dos filhos aprovados (pontos, presença, mensalidade, vinculo_id, consentimento_id quando
// já concedido). RLS/segurança no banco.
export async function carregarMeusFilhos() {
  const { data, error } = await supabase.rpc('meus_filhos')
  if (error) throw new Error(error.message)
  return data || []
}

// Consentimento AUDITÁVEL do responsável (infraestrutura real; texto do termo pendente de revisão
// jurídica, marcado explicitamente). Só sobre o PRÓPRIO vínculo já aprovado.
export async function concederConsentimento(vinculoId) {
  const { data, error } = await supabase.rpc('consentimento_conceder', { p_vinculo_id: vinculoId })
  if (error) throw new Error(error.message)
  return data
}

export async function revogarConsentimento(consentimentoId, motivo = null) {
  const { data, error } = await supabase.rpc('consentimento_revogar', { p_consentimento_id: consentimentoId, p_motivo: motivo })
  if (error) throw new Error(error.message)
  return data
}

// Diretoria: pedidos de vínculo aguardando aprovação.
export async function carregarVinculosPendentes() {
  const { data, error } = await supabase.rpc('vinculos_pendentes')
  if (error) throw new Error(error.message)
  return data || []
}

// Diretoria: buscar desbravadores por nome (pra escolher o filho certo ao aprovar).
// Pelo VÍNCULO no clube da aba, com status ativo OU pendente — a mesma regra do aprovar_vinculo.
// Antes vinha do espelho profiles: o diretor de dois clubes recebia crianças só do outro clube
// (e o "limite 20" podia empurrar a certa para fora), e a criança ainda pendente AQUI não aparecia.
const LIMITE_BUSCA = 20
export async function buscarDesbravadores(termo) {
  const lista = await membrosDoClube({ papeis: PAPEIS_DE_UNIDADE, status: ['ativo', 'pendente'], busca: termo })
  return lista.slice(0, LIMITE_BUSCA)
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


// Muda o papel (cargo) de um membro NO CLUBE EM USO — via vinculo_gerir (papel/status/unidade
// são do VÍNCULO, não de profiles; a coluna profiles.papel não é mais gravável direto).
// Só desbravador/conselheiro pertencem a uma unidade: ao promover pra líder,
// limpa a unidade pra pessoa não continuar contando na média do time antigo.
export async function mudarCargo(userId, papel) {
  const mantemUnidade = papel === 'desbravador' || papel === 'conselheiro'
  const { error } = await supabase.rpc('vinculo_gerir', mantemUnidade
    ? { p_user_id: userId, p_papel: papel }
    : { p_user_id: userId, p_papel: papel, p_limpar_unidade: true })
  if (error) throw new Error(error.message)
  return { limpouUnidade: !mantemUnidade }
}


// Desativa/reativa uma pessoa NO CLUBE EM USO. Desativada (vínculo suspenso) perde o acesso a ESTE
// clube — a conta continua entrando e vê "Seu acesso está suspenso" (ClubeGuard); em outro clube
// dela nada muda — e some do ranking e das listas, mas o histórico (pontos, fotos) fica preservado.
export async function definirAtivoUsuario(userId, ativo) {
  const { error } = await supabase.rpc('vinculo_gerir', { p_user_id: userId, p_status: ativo ? 'ativo' : 'inativo' })
  if (error) throw new Error(error.message)
  return { id: userId, status: ativo ? 'ativo' : 'inativo' }
}


// Liga/desliga o MODO TESTE de uma conta: não pontua, não trava no 1x/dia e
// não aparece no ranking. Serve pra testar o app sem sujar nada.
// Pela RPC membro_definir_teste (diretoria do clube da aba), não mais por UPDATE direto em
// profiles: a flag é da PESSOA e vale em todos os clubes dela, então o servidor RECUSA quando o
// alvo também está em outro clube (senão a diretoria de A tirava a criança do ranking de B sem
// ninguém de B saber). O erro do servidor sobe como está e a tela o traduz com o porquê
// (ui/index.jsx, TRADUCOES) — essa recusa é esperada, não é falha.
export async function definirTesteUsuario(userId, teste) {
  const { error } = await supabase.rpc('membro_definir_teste', { p_usuario_id: userId, p_teste: !!teste })
  if (error) throw new Error(error.message)
  return { id: userId, teste: !!teste }
}


// ⚠️ APAGA a pessoa e TUDO dela (pontos, entregas, mensalidades, jogos, fotos).
// Sem volta. Só diretoria (a checagem de verdade é no banco).
export async function excluirUsuario(userId) {
  const { data, error } = await supabase.rpc('excluir_usuario', { p_id: userId })
  if (error) throw new Error(error.message)
  return data
}


// Muda a unidade (time) de um membro NO CLUBE EM USO — passe null/'' pra deixar "sem unidade".
// Mesma RPC do cargo (vinculo_gerir): só liderança do clube desta pessoa.
export async function mudarUnidade(userId, unidadeId) {
  const { error } = await supabase.rpc('vinculo_gerir', unidadeId
    ? { p_user_id: userId, p_unidade_id: unidadeId }
    : { p_user_id: userId, p_limpar_unidade: true })
  if (error) throw new Error(error.message)
}


// Envia/troca a foto de perfil. Da PRÓPRIA pessoa: UPDATE direto (o RLS deixa cada um editar o
// seu perfil). De OUTRO membro: pela RPC membro_definir_foto (liderança do clube da aba) — o UPDATE
// direto da liderança em profiles deixou de existir, porque a foto é global da pessoa e a liderança
// de B trocava a foto que as crianças de A viam. O servidor recusa alvo que também está em outro
// clube; o erro dele sobe como está.
export async function atualizarFotoPerfil({ userId, file }) {
  await validarImagem(file) // tipo REAL + tamanho (hardening etapa 2)
  file = await comprimirImagem(file, { maxLado: 640 })
  const ext = file.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `perfis/${userId}-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from('imagens').upload(path, file, { upsert: true })
  if (upErr) throw new Error('Não foi possível enviar a foto: ' + upErr.message)
  const { data: pub } = supabase.storage.from('imagens').getPublicUrl(path)
  const { data: sessao } = await supabase.auth.getSession()
  const { error } = sessao?.session?.user?.id === userId
    ? await supabase.from('profiles').update({ foto: pub.publicUrl }).eq('id', userId)
    : await supabase.rpc('membro_definir_foto', { p_usuario_id: userId, p_foto: pub.publicUrl })
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


// Aniversariantes: membros do clube da aba (vínculo ativo, menos 'pais') que têm aniversário.
// O servidor devolve só dia e mês ('MM-DD'), nunca a data de nascimento completa — o card não
// precisa do ano, e a idade da criança não é assunto do clube inteiro. Antes vinha do espelho
// profiles: na aba B apareciam os aniversariantes SÓ de A, com a data completa.
export async function carregarAniversariantes() {
  const lista = await membrosDoClube()
  return lista
    .filter((p) => /^\d{2}-\d{2}$/.test(p.aniversario || ''))
    .map((p) => ({ id: p.id, nome: p.nome, foto: p.foto, aniversario: p.aniversario }))
}

