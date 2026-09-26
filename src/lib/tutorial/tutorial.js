// Lógica PURA do tutorial (/ajuda): filtro por papel, busca, atalho permitido e o "tour" de primeiro acesso.
// O conteúdo mora em ./conteudo.js; aqui só as regras — testáveis sem React.
//
// Atalho "Abrir essa tela": é NAVEGAÇÃO, não segurança (RLS e RPCs continuam sendo a trava). Mesmo assim o
// tutorial nunca mostra atalho para uma tela que o papel não abre — a regra vem da MESMA matriz que a
// RotaRestrita e o menu usam (PAPEIS_POR_ROTA / RECURSO_POR_ROTA), sem duplicar nada.
import { PAPEIS_POR_ROTA, RECURSO_POR_ROTA } from '../permissoes.js'
import { PAPEIS_DO_TUTORIAL, TOPICOS } from './conteudo.js'

// Papel do VÍNCULO no clube em uso -> seção do tutorial.
const SECAO_DO_PAPEL = {
  desbravador: 'desbravador',
  pais: 'responsavel',
  conselheiro: 'conselheiro',
  instrutor: 'instrutor',
  diretoria: 'diretoria',
  tesoureiro: 'diretoria',
}

export function secaoDoPapel(papel, { temEscopo = false } = {}) {
  if (papel && SECAO_DO_PAPEL[papel]) return SECAO_DO_PAPEL[papel]
  if (temEscopo) return 'coordenacao'
  return null
}

// Seções em ordem, com a do papel da pessoa PRIMEIRO (as outras continuam lá, para quem quer conhecer).
export function secoesOrdenadas(secaoDaPessoa) {
  if (!secaoDaPessoa) return [...PAPEIS_DO_TUTORIAL]
  const minha = PAPEIS_DO_TUTORIAL.find((p) => p.chave === secaoDaPessoa)
  return minha ? [minha, ...PAPEIS_DO_TUTORIAL.filter((p) => p !== minha)] : [...PAPEIS_DO_TUTORIAL]
}

// Tópicos que existem neste contexto.
//   modo 'site': só o que é do produto em geral — nada marcado `soNoApp` (ex.: recursos fora do piloto).
//   modo 'app': o tópico que depende de um recurso desligado neste clube não aparece.
export function topicosVisiveis({ modo = 'app', temRecurso = () => true } = {}, topicos = TOPICOS) {
  return topicos.filter((t) => {
    if (modo === 'site') return !t.soNoApp
    return !t.recurso || temRecurso(t.recurso) === true
  })
}

export const topicosDaSecao = (secao, topicos = TOPICOS) => topicos.filter((t) => t.papel === secao)

// Busca por palavra: ignora maiúsculas e acentos; todas as palavras digitadas precisam aparecer no tópico.
export function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function textoDoTopico(t) {
  return normalizar([
    t.titulo, t.paraQueServe, ...(t.passos || []), ...(t.dicas || []),
    ...(t.problemas || []).flatMap((p) => [p.quando, p.solucao]), ...(t.palavras || []),
  ].join(' '))
}

export function buscarTopicos(termo, topicos = TOPICOS) {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return topicos
  return topicos.filter((t) => {
    const texto = textoDoTopico(t)
    return palavras.every((p) => texto.includes(p))
  })
}

// A pessoa abre essa rota? Mesmas regras de App.jsx:
//   - rota da matriz (RotaRestrita) -> o papel tem de estar na lista;
//   - rota que depende de recurso -> o recurso tem de estar ligado;
//   - /institucional -> só quem tem escopo (coordenação); /meu-filho -> só responsável;
//   - /gestao -> só quem tem a aba Gestão.
const SO_GESTAO = ['conselheiro', 'instrutor', 'diretoria', 'tesoureiro']
export function atalhoPermitido(rota, { papel = null, temRecurso = () => false, temEscopo = false } = {}) {
  if (typeof rota !== 'string' || !rota.startsWith('/')) return false
  const caminho = rota.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase() || '/'
  if (caminho === '/institucional') return temEscopo === true
  if (caminho === '/criar-clube') return true
  if (!papel) return false
  if (caminho === '/meu-filho') return papel === 'pais'
  if (caminho === '/gestao') return SO_GESTAO.includes(papel)
  const papeis = PAPEIS_POR_ROTA[caminho]
  if (papeis && !papeis.includes(papel)) return false
  const recurso = RECURSO_POR_ROTA[caminho]
  if (recurso && temRecurso(recurso) !== true) return false
  return true
}

// ---------------------------------------------------------------- tour de primeiro acesso
// Uma vez por usuário, neste aparelho. localStorage pode faltar (aba anônima, dados bloqueados): nesse caso
// o tour simplesmente não volta a incomodar na mesma sessão (o componente guarda o "fechado" em estado).
const chaveDoTour = (uid) => `dc:tour-visto:${uid}`

export function tourJaVisto(uid) {
  if (!uid) return true
  try { return globalThis.localStorage?.getItem(chaveDoTour(uid)) === '1' } catch { return false }
}

export function marcarTourVisto(uid) {
  if (!uid) return
  try { globalThis.localStorage?.setItem(chaveDoTour(uid), '1') } catch { /* sem armazenamento: tudo bem */ }
}

export const PASSOS_DO_TOUR = [
  { icone: '🏠', titulo: 'Início', texto: 'Aqui aparece o que é importante agora: o que falta na sua classe, avisos e atalhos do dia.' },
  { icone: '🎖️', titulo: 'Jornada', texto: 'Sua classe e tudo o que você está conquistando: requisitos, missões e experiências do clube.' },
  { icone: '🏕️', titulo: 'Clube', texto: 'Ranking, o cantinho da sua unidade e as outras coisas do clube.' },
  { icone: '👤', titulo: 'Eu', texto: 'Seu perfil, trocar de clube, atualizar o app e "Ajuda / Como usar" — onde você pode rever este tour.' },
]
