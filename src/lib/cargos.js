// Cargos/funções do clube (mostrados no cadastro)
export const CARGOS = [
  'Desbravador',
  'Capitão', 'Capitã',
  'Tesoureiro de Unidade',
  'Conselheiro', 'Conselheira',
  'Instrutor', 'Instrutora',
  'Capelão',
  'Secretário', 'Secretária',
  'Tesoureiro',
  'Diretor', 'Diretora',
  'Diretor Associado', 'Diretora Associada',
]

// Cargos considerados de liderança (destaque na aprovação)
export const CARGOS_LIDERANCA = [
  'Conselheiro', 'Conselheira', 'Instrutor', 'Instrutora', 'Capelão',
  'Secretário', 'Secretária', 'Tesoureiro',
  'Diretor', 'Diretora', 'Diretor Associado', 'Diretora Associada',
]

// Cargos que pertencem a uma unidade (precisam escolher unidade no cadastro).
// Diretoria, Instrutor, Tesoureiro, Capelão, Secretário são do clube → sem unidade.
export const CARGOS_COM_UNIDADE = [
  'Desbravador', 'Capitão', 'Capitã', 'Tesoureiro de Unidade', 'Conselheiro', 'Conselheira',
]
export const precisaUnidade = (cargo) => CARGOS_COM_UNIDADE.includes(cargo)
