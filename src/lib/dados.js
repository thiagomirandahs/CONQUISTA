// FACHADA DE COMPATIBILIDADE (refatoração etapa 3).
// As funções foram organizadas por domínio em src/services/*.js. Este arquivo
// RE-EXPORTA tudo, então qualquer `import { X } from '../lib/dados.js'` continua
// funcionando igual. Para código novo, prefira importar do serviço específico.
export * from '../services/ranking.js'
export * from '../services/usuarios.js'
export * from '../services/unidades.js'
export * from '../services/jogos.js'
export * from '../services/missoes.js'
export * from '../services/atividades.js'
export * from '../services/mural.js'
export * from '../services/notificacoes.js'
export * from '../services/conteudo.js'
export * from '../services/leilao.js'
export * from '../services/chat.js'
export * from '../services/biblia.js'
export * from '../services/bichinho.js'
export * from '../services/chefao.js'
