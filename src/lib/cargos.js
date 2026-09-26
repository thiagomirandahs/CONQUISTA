// Cargos/funções do clube — nomes do Manual Administrativo do Clube de Desbravadores (DSA,
// adventistas.org/desbravadores): diretoria do clube (3.3) e oficiais da unidade (3.2.2).

// "Função no clube" mostrada no cadastro (texto informativo; o papel de acesso quem define é a liderança)
export const CARGOS = [
  'Desbravador', 'Desbravadora',
  'Capitão da Unidade', 'Capitã da Unidade',
  'Secretário da Unidade', 'Secretária da Unidade',
  'Tesoureiro da Unidade', 'Tesoureira da Unidade',
  'Capelão da Unidade', 'Capelã da Unidade',
  'Conselheiro Associado', 'Conselheira Associada',
  'Conselheiro', 'Conselheira',
  'Instrutor', 'Instrutora',
  'Capelão', 'Capelã',
  'Secretário', 'Secretária',
  'Tesoureiro', 'Tesoureira',
  'Diretor Associado', 'Diretora Associada',
  'Diretor', 'Diretora',
]

// Cargos considerados de liderança (destaque na aprovação)
export const CARGOS_LIDERANCA = [
  'Conselheiro', 'Conselheira', 'Conselheiro Associado', 'Conselheira Associada',
  'Instrutor', 'Instrutora', 'Capelão', 'Capelã',
  'Secretário', 'Secretária', 'Tesoureiro', 'Tesoureira',
  'Diretor', 'Diretora', 'Diretor Associado', 'Diretora Associada',
]

// Cargos que pertencem a uma unidade (a unidade é atribuída pela liderança depois — regra 8.6).
export const CARGOS_COM_UNIDADE = [
  'Desbravador', 'Desbravadora', 'Capitão da Unidade', 'Capitã da Unidade',
  'Secretário da Unidade', 'Secretária da Unidade', 'Tesoureiro da Unidade', 'Tesoureira da Unidade',
  'Capelão da Unidade', 'Capelã da Unidade', 'Conselheiro Associado', 'Conselheira Associada',
  'Conselheiro', 'Conselheira',
]
export const precisaUnidade = (cargo) => CARGOS_COM_UNIDADE.includes(cargo)

// Cargos DA UNIDADE (organization_memberships.cargo_unidade — migration 230). Fonte: Manual
// Administrativo, 3.2 "Sistema de Unidades" (um Conselheiro e no máximo um Conselheiro Associado)
// e 3.2.2 "Os oficiais da Unidade" (principais: Capitão e Secretário; opcionais: Tesoureiro,
// Almoxarife, Coordenador de recreação, Padioleiro e Capelão). Cada cargo é único por unidade.
// Sem cargo = Desbravador (membro comum). "lideranca" = só quem já é liderança no clube.
export const CARGOS_DE_UNIDADE = [
  { valor: 'conselheiro', rotulo: 'Conselheiro(a)', icone: '🎗️', lideranca: true },
  { valor: 'conselheiro_associado', rotulo: 'Conselheiro(a) Associado(a)', icone: '🎗️', lideranca: true },
  { valor: 'capitao', rotulo: 'Capitão/Capitã', icone: '🚩' },
  { valor: 'secretario', rotulo: 'Secretário(a)', icone: '📋' },
  { valor: 'tesoureiro', rotulo: 'Tesoureiro(a)', icone: '💰' },
  { valor: 'capelao', rotulo: 'Capelão/Capelã', icone: '📖' },
  { valor: 'almoxarife', rotulo: 'Almoxarife', icone: '🎒' },
  { valor: 'coordenador_recreacao', rotulo: 'Coordenador(a) de recreação', icone: '🎲' },
  { valor: 'padioleiro', rotulo: 'Padioleiro(a)', icone: '🩹' },
]
export const cargoDeUnidade = (valor) => CARGOS_DE_UNIDADE.find((c) => c.valor === valor) || null
