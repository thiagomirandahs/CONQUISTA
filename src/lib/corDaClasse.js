// Cor oficial de cada Classe Regular de Desbravadores (a cor do lenço/insígnia da classe) — só
// visual, para a criança reconhecer a própria classe de relance. Classe sem cor conhecida = null.
// hex    = a cor da classe (fundo do cabeçalho, barra, botões)
// texto  = cor do texto POR CIMA de hex (contraste legível: no amarelo, texto escuro)
// escuro = versão da cor para texto/borda sobre fundo claro (o amarelo puro some no branco)
// claro  = fundo suave da cor (cabeçalho de seção, destaques)
const CORES = {
  amigo: { nome: 'Azul', hex: '#1d4ed8', texto: '#ffffff', escuro: '#1e40af', claro: '#dbeafe' },
  companheiro: { nome: 'Vermelho', hex: '#dc2626', texto: '#ffffff', escuro: '#b91c1c', claro: '#fee2e2' },
  pesquisador: { nome: 'Verde', hex: '#16a34a', texto: '#ffffff', escuro: '#15803d', claro: '#dcfce7' },
  pioneiro: { nome: 'Cinza', hex: '#6b7280', texto: '#ffffff', escuro: '#4b5563', claro: '#f3f4f6' },
  excursionista: { nome: 'Vinho', hex: '#7f1d3a', texto: '#ffffff', escuro: '#7f1d3a', claro: '#fce7ef' },
  guia: { nome: 'Amarelo', hex: '#eab308', texto: '#1f2937', escuro: '#a16207', claro: '#fef9c3' },
}

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export function corDaClasse(nome) {
  return CORES[normalizar(nome)] || null
}
