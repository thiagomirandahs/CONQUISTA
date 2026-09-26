// Cor oficial de cada Classe Regular de Desbravadores (a cor do lenço/insígnia da classe) — só
// visual, para a criança reconhecer a própria classe de relance. Classe sem cor conhecida = null.
const CORES = {
  amigo: { nome: 'Azul', hex: '#1d4ed8' },
  companheiro: { nome: 'Vermelho', hex: '#dc2626' },
  pesquisador: { nome: 'Verde', hex: '#16a34a' },
  pioneiro: { nome: 'Cinza', hex: '#6b7280' },
  excursionista: { nome: 'Vinho', hex: '#7f1d3a' },
  guia: { nome: 'Amarelo', hex: '#eab308' },
}

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export function corDaClasse(nome) {
  return CORES[normalizar(nome)] || null
}
