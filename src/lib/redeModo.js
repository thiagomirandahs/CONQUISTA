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

// Para onde o "Sair" da rede leva: o portal, se entrou como coordenação; o app do clube, se não.
export const destinoDeSaidaDaRede = (coordenacao = redeComoCoordenacao()) => (coordenacao ? '/institucional' : '/inicio')

// recarregar a página no meio da rede mantém o modo desta aba
transporte(redeComoCoordenacao() ? 'coordenacao' : null)
