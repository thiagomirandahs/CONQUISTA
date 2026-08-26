// Desenho do bichinho (mascote virtual) — SVG gerado por código, com
// carinhas de humor. Estilo "blobzinho" fofo (cabeça+corpo juntos), pra
// funcionar bem pequeno na tela e em qualquer aparelho, sem imagem externa.
//
// montarBichinhoSvg({ especie, humor, estagio }) devolve o MIOLO do svg
// (sem a tag <svg>), pronto pra <svg dangerouslySetInnerHTML>. Nada aqui
// vem de texto digitado pelo usuário (o nome do bichinho é renderizado como
// texto React, nunca dentro do SVG), então não há superfície de injeção.

export const ESPECIES = [
  { id: 'cachorro', nome: 'Cachorrinho', emoji: '🐶', cor: '#c9975b', cor2: '#a9793f' },
  { id: 'gato', nome: 'Gatinho', emoji: '🐱', cor: '#9aa3ad', cor2: '#7c848d' },
  { id: 'coelho', nome: 'Coelhinho', emoji: '🐰', cor: '#eef0f3', cor2: '#d5d8dd' },
  { id: 'passaro', nome: 'Passarinho', emoji: '🐥', cor: '#f5c518', cor2: '#e0a800' },
]

// Humores possíveis (a tela deriva do estado das barrinhas):
//  feliz | ok | triste | doente | dormindo | morto
export const HUMORES = ['feliz', 'ok', 'triste', 'doente', 'dormindo', 'morto']

export function especieInfo(id) {
  return ESPECIES.find((e) => e.id === id) || ESPECIES[0]
}

// ---- Orelhas/traços por espécie (ficam no topo da cabeça) ----
function tracosEspecie(e) {
  switch (e.id) {
    case 'cachorro':
      return `
        <ellipse cx="26" cy="40" rx="9" ry="15" fill="${e.cor2}" transform="rotate(-18 26 40)"/>
        <ellipse cx="74" cy="40" rx="9" ry="15" fill="${e.cor2}" transform="rotate(18 74 40)"/>`
    case 'gato':
      return `
        <path d="M 26 34 L 22 14 L 40 28 Z" fill="${e.cor}"/>
        <path d="M 74 34 L 78 14 L 60 28 Z" fill="${e.cor}"/>
        <path d="M 27 32 L 25 20 L 35 29 Z" fill="#f6b8c8"/>
        <path d="M 73 32 L 75 20 L 65 29 Z" fill="#f6b8c8"/>`
    case 'coelho':
      return `
        <ellipse cx="38" cy="20" rx="7" ry="20" fill="${e.cor}"/>
        <ellipse cx="62" cy="20" rx="7" ry="20" fill="${e.cor}"/>
        <ellipse cx="38" cy="22" rx="3.5" ry="14" fill="#f6b8c8"/>
        <ellipse cx="62" cy="22" rx="3.5" ry="14" fill="#f6b8c8"/>`
    case 'passaro':
      return `
        <path d="M 47 16 Q 50 8 53 16 Z" fill="${e.cor2}"/>
        <ellipse cx="18" cy="60" rx="8" ry="12" fill="${e.cor2}" transform="rotate(20 18 60)"/>
        <ellipse cx="82" cy="60" rx="8" ry="12" fill="${e.cor2}" transform="rotate(-20 82 60)"/>`
    default:
      return ''
  }
}

// ---- Rosto por humor (olhos + boca + efeitos), centrado ~ (50,56) ----
function rostoHumor(humor) {
  const olhoL = 40, olhoR = 60, olhoY = 52
  switch (humor) {
    case 'feliz':
      return `
        <path d="M 36 52 Q 40 47 44 52" stroke="#2b2b2b" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M 56 52 Q 60 47 64 52" stroke="#2b2b2b" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M 42 62 Q 50 70 58 62" stroke="#2b2b2b" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <circle cx="32" cy="60" r="4" fill="#ff9db0" opacity="0.6"/>
        <circle cx="68" cy="60" r="4" fill="#ff9db0" opacity="0.6"/>
        <path d="M 78 30 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5 z" fill="#f5c518"/>`
    case 'ok':
      return `
        <circle cx="${olhoL}" cy="${olhoY}" r="3.4" fill="#2b2b2b"/>
        <circle cx="${olhoR}" cy="${olhoY}" r="3.4" fill="#2b2b2b"/>
        <path d="M 44 63 Q 50 67 56 63" stroke="#2b2b2b" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    case 'triste':
      return `
        <circle cx="${olhoL}" cy="${olhoY + 1}" r="3.4" fill="#2b2b2b"/>
        <circle cx="${olhoR}" cy="${olhoY + 1}" r="3.4" fill="#2b2b2b"/>
        <path d="M 34 47 L 44 50" stroke="#2b2b2b" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 66 47 L 56 50" stroke="#2b2b2b" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 43 66 Q 50 61 57 66" stroke="#2b2b2b" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <path d="M 38 56 q -2 5 0 7 q 2 -2 0 -7" fill="#7dd3fc"/>`
    case 'doente':
      return `
        <path d="M 36 50 l 8 6 M 44 50 l -8 6" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M 56 50 l 8 6 M 64 50 l -8 6" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M 43 65 q 3.5 -3 7 0 t 7 0" stroke="#2b2b2b" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <circle cx="34" cy="62" r="4.5" fill="#86efac" opacity="0.7"/>
        <circle cx="66" cy="62" r="4.5" fill="#86efac" opacity="0.7"/>`
    case 'dormindo':
      return `
        <path d="M 35 52 Q 40 55 45 52" stroke="#2b2b2b" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <path d="M 55 52 Q 60 55 65 52" stroke="#2b2b2b" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <circle cx="50" cy="63" r="3" fill="none" stroke="#2b2b2b" stroke-width="1.6"/>
        <text x="72" y="34" font-family="system-ui" font-size="12" font-weight="700" fill="#64748b">z</text>
        <text x="80" y="26" font-family="system-ui" font-size="9" font-weight="700" fill="#94a3b8">z</text>`
    case 'morto':
      return `
        <path d="M 36 50 l 8 8 M 44 50 l -8 8" stroke="#64748b" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M 56 50 l 8 8 M 64 50 l -8 8" stroke="#64748b" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M 44 66 Q 50 62 56 66" stroke="#64748b" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    default:
      return ''
  }
}

// Enfeite por estágio de crescimento (filhote=1, jovem=2, adulto=3+).
function enfeiteEstagio(estagio) {
  if (estagio >= 3) return `<path d="M 40 24 L 46 30 L 54 22 L 60 30 L 50 34 Z" fill="#f5c518" stroke="#e0a800" stroke-width="0.8"/>` // coroinha
  if (estagio >= 2) return `<path d="M 60 30 q 6 -4 8 2 q -6 1 -8 -2 z" fill="#ef4444"/><circle cx="60" cy="31" r="1.6" fill="#ef4444"/>` // lacinho
  return ''
}

export function montarBichinhoSvg({ especie = 'cachorro', humor = 'ok', estagio = 1 } = {}) {
  const e = especieInfo(especie)
  const morto = humor === 'morto'
  const corpo = morto ? '#cbd5e1' : e.cor
  const corpo2 = morto ? '#94a3b8' : e.cor2
  // patinhas
  const pes = `
    <ellipse cx="40" cy="86" rx="8" ry="5" fill="${corpo2}"/>
    <ellipse cx="60" cy="86" rx="8" ry="5" fill="${corpo2}"/>`
  const e2 = { ...e, cor: corpo, cor2: corpo2 }
  return `
    ${pes}
    ${tracosEspecie(e2)}
    <ellipse cx="50" cy="56" rx="32" ry="30" fill="${corpo}"/>
    <ellipse cx="50" cy="66" rx="18" ry="14" fill="#ffffff" opacity="0.25"/>
    ${especie === 'passaro' && !morto ? '<path d="M 46 60 L 54 60 L 50 66 Z" fill="#e0a800"/>' : ''}
    ${rostoHumor(morto ? 'morto' : humor)}
    ${morto ? '' : enfeiteEstagio(estagio)}
    ${morto ? '<ellipse cx="50" cy="30" rx="10" ry="3.4" fill="none" stroke="#f5c518" stroke-width="2"/>' : ''}
  `
}
