// O que o botão FÍSICO de voltar do Android faz. Lógica pura (testável); o listener em src/lib/nativo.js só executa o resultado.
//  1) há camada aberta (folha, story, lightbox)      -> fechar a camada;
//  2) a tela é a RAIZ de uma aba (Início, Jornada…)   -> minimizar o app (padrão do Android; antes andava pela pilha de abas);
//  3) há histórico                                    -> voltar;
//  4) senão                                           -> minimizar.
export const RAIZES = ['/', '/inicio', '/jornada', '/meu-clube', '/jogos', '/eu', '/gestao', '/rede', '/meu-filho', '/institucional']

export function decidirVoltarFisico({ caminho = '/', temCamada = false, canGoBack = false } = {}) {
  if (temCamada) return 'fechar-camada'
  const limpo = String(caminho).split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  if (RAIZES.includes(limpo)) return 'minimizar'
  return canGoBack ? 'voltar' : 'minimizar'
}
