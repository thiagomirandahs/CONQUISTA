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

// Classe Avançada → a regular pareada (manifesto 2026.4). A avançada usa a MESMA cor da regular dela
// (é o mesmo cartão), e a tela a identifica com o selo "Avançada" + o detalhe próprio do emblema.
const AVANCADAS = {
  'amigo da natureza': 'amigo',
  'companheiro de excursionismo': 'companheiro',
  'pesquisador de campo e bosque': 'pesquisador',
  'pioneiro de novas fronteiras': 'pioneiro',
  'excursionista na mata': 'excursionista',
  'guia de exploracao': 'guia',
}

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Regular pareada de uma Classe Avançada (chave sem acento, ex.: 'amigo'), ou null se não for avançada.
export function regularDaAvancada(nome) {
  return AVANCADAS[normalizar(nome)] || null
}

export function ehClasseAvancada(nome) {
  return regularDaAvancada(nome) !== null
}

export function corDaClasse(nome) {
  const n = normalizar(nome)
  return CORES[n] || CORES[AVANCADAS[n]] || null
}
