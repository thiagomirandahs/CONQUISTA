import { definirRedeComoNoTransporte } from './supabase.js'

// REDE DBV para a COORDENAÇÃO (migration 490). Quem entra pela tela do portal (/institucional) entra na
// rede "como coordenação": a aba guarda isso (sessionStorage, some ao fechar a aba) e manda o header
// x-rede-como. Não é autorização: o servidor só aceita com vínculo ativo de coordenação, e sem o recurso
// ligado em algum clube da área a rede mostra "ainda não está liberada na sua área".
// Quem entra pelo app do clube (Início, menu) continua como membro do clube; o "Sair" da rede apaga o modo.
const CHAVE = 'rede_como'
// (protegido: nos testes o transporte costuma vir de um mock sem esta função)
function transporte(modo) { try { definirRedeComoNoTransporte(modo) } catch { /* sem transporte */ } }

export function redeComoCoordenacao() {
  try { return sessionStorage.getItem(CHAVE) === 'coordenacao' } catch { return false }
}

export function entrarNaRedeComoCoordenacao() {
  try { sessionStorage.setItem(CHAVE, 'coordenacao') } catch { /* sem storage: vale só nesta carga */ }
  transporte('coordenacao')
}

export function sairDoModoCoordenacao() {
  try { sessionStorage.removeItem(CHAVE) } catch { /* sem storage */ }
  transporte(null)
}

// De onde a pessoa veio (última tela do APP antes de abrir a Rede): o "voltar" da Rede leva para lá, não sempre ao Início.
// Só caminhos internos do app; telas de entrada/conta pública nunca viram destino.
const CHAVE_ORIGEM = 'rede_origem'
const FORA_DO_APP = /^\/(login|cadastro|recuperar|nova-senha|verificar|entrar|conheca|adquirir|clubes|parceiros|privacidade|termos)(\/|$|\?)/
const internoValido = (c) => typeof c === 'string' && c.startsWith('/') && !c.startsWith('//') && !c.startsWith('/rede') && !/[\s\\]/.test(c) && c.length <= 300

export function lembrarOrigemDaRede(caminho) {
  if (!internoValido(caminho) || caminho === '/' || FORA_DO_APP.test(caminho)) return
  try { sessionStorage.setItem(CHAVE_ORIGEM, caminho) } catch { /* sem storage: volta ao Início */ }
}

// Para onde o "voltar" da rede leva: o portal, se entrou como coordenação; senão a tela do app de onde veio (ou o Início).
export function destinoDeSaidaDaRede(coordenacao = redeComoCoordenacao()) {
  if (coordenacao) return '/institucional'
  try {
    const o = sessionStorage.getItem(CHAVE_ORIGEM)
    if (internoValido(o) && !FORA_DO_APP.test(o)) return o
  } catch { /* sem storage */ }
  return '/inicio'
}

// recarregar a página no meio da rede mantém o modo desta aba
transporte(redeComoCoordenacao() ? 'coordenacao' : null)
