// Peças do avatar customizável (estilo "faça seu personagem"). Os níveis
// mínimos aqui têm que bater com public.salvar_avatar() no banco — se
// mudar aqui, muda lá também (supabase/2026-08-24-avatar.sql).

export const PELES = ['#FFDBAC', '#F1C27D', '#E0AC69', '#C68642', '#8D5524']
export const CORES_CABELO = ['#2b2b2b', '#5a3820', '#c9a227', '#a83232', '#e5e7eb']
export const CORES_ROUPA = ['#1e3a8a', '#dc2626', '#16a34a', '#7c3aed', '#f59e0b', '#0891b2']

export const CABELOS = [
  { id: 'curto', nome: 'Curto', nivel: 1 },
  { id: 'cacheado', nome: 'Cacheado', nivel: 1 },
  { id: 'moicano', nome: 'Moicano', nivel: 3 },
  { id: 'trancas', nome: 'Tranças', nivel: 5 },
  { id: 'afro', nome: 'Black power', nivel: 7 },
]
export const ROUPAS = [
  { id: 'lisa', nome: 'Camisa lisa', nivel: 1 },
  { id: 'listrada', nome: 'Listrada', nivel: 4 },
  { id: 'estrela', nome: 'Estrela', nivel: 6 },
  { id: 'jaqueta', nome: 'Jaqueta', nivel: 8 },
]
export const ACESSORIOS = [
  { id: 'nenhum', nome: 'Nenhum', nivel: 1 },
  { id: 'bone', nome: 'Boné', nivel: 2 },
  { id: 'oculos', nome: 'Óculos', nivel: 4 },
  { id: 'lenco', nome: 'Lenço de líder', nivel: 6 },
  { id: 'coroa', nome: 'Coroa', nivel: 10 },
]

export const AVATAR_PADRAO = {
  pele: PELES[0], cabelo: 'curto', corCabelo: CORES_CABELO[0],
  roupa: 'lisa', corRoupa: CORES_ROUPA[0], acessorio: 'nenhum', corAcessorio: CORES_ROUPA[0],
}

export function nivelMinimoCabelo(id) { return CABELOS.find((c) => c.id === id)?.nivel ?? 99 }
export function nivelMinimoRoupa(id) { return ROUPAS.find((r) => r.id === id)?.nivel ?? 99 }
export function nivelMinimoAcessorio(id) { return ACESSORIOS.find((a) => a.id === id)?.nivel ?? 99 }

// ---- Formas SVG (cada função devolve o markup interno, sem a tag <svg>) ----
function corpoBase(pele) {
  return `
    <circle cx="50" cy="40" r="26" fill="${pele}"/>
    <circle cx="41" cy="40" r="2.6" fill="#2b2b2b"/>
    <circle cx="59" cy="40" r="2.6" fill="#2b2b2b"/>
    <path d="M 41 50 Q 50 56 59 50" stroke="#a05a2c" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <circle cx="34" cy="46" r="4" fill="${pele}" opacity="0.55"/>
    <circle cx="66" cy="46" r="4" fill="${pele}" opacity="0.55"/>
  `
}
const CABELO_SVG = {
  curto: (cor) => `<path d="M 24 34 Q 24 10 50 10 Q 76 10 76 34 Q 76 24 50 22 Q 24 24 24 34 Z" fill="${cor}"/>`,
  cacheado: (cor) => `
    <circle cx="27" cy="24" r="8" fill="${cor}"/><circle cx="38" cy="15" r="9" fill="${cor}"/>
    <circle cx="50" cy="12" r="9" fill="${cor}"/><circle cx="62" cy="15" r="9" fill="${cor}"/>
    <circle cx="73" cy="24" r="8" fill="${cor}"/><circle cx="50" cy="22" r="14" fill="${cor}"/>`,
  moicano: (cor) => `
    <path d="M 24 32 Q 24 18 50 18 Q 76 18 76 32 Q 68 24 50 24 Q 32 24 24 32 Z" fill="#00000022"/>
    <path d="M 44 4 Q 50 -2 56 4 L 58 24 L 42 24 Z" fill="${cor}"/>`,
  trancas: (cor) => `
    <path d="M 24 34 Q 24 10 50 10 Q 76 10 76 34 Q 76 24 50 22 Q 24 24 24 34 Z" fill="${cor}"/>
    <rect x="18" y="30" width="7" height="30" rx="3.5" fill="${cor}"/>
    <rect x="75" y="30" width="7" height="30" rx="3.5" fill="${cor}"/>
    <circle cx="21.5" cy="60" r="3" fill="#f5c518"/><circle cx="78.5" cy="60" r="3" fill="#f5c518"/>`,
  afro: (cor) => `<circle cx="50" cy="26" r="23" fill="${cor}"/>`,
}
const ROUPA_SVG = {
  lisa: () => '',
  listrada: () => `
    <rect x="26" y="78" width="48" height="4" fill="#ffffff55"/>
    <rect x="26" y="90" width="48" height="4" fill="#ffffff55"/>
    <rect x="26" y="102" width="48" height="4" fill="#ffffff55"/>`,
  estrela: () => `
    <path d="M50 84 l2.4 5 5.5 0.6 -4 3.8 1 5.5 -4.9 -2.7 -4.9 2.7 1 -5.5 -4 -3.8 5.5 -0.6 z" fill="#f5c518"/>`,
  jaqueta: (cor) => `
    <path d="M26 76 L38 70 L50 78 L62 70 L74 76 L74 112 L26 112 Z" fill="${cor}" opacity="0.75"/>
    <rect x="47" y="76" width="6" height="36" fill="#ffffff33"/>`,
}
const ACESSORIO_SVG = {
  nenhum: () => '',
  bone: (cor) => `
    <path d="M 22 30 Q 22 6 50 6 Q 78 6 78 30 L 78 24 Q 50 14 22 24 Z" fill="${cor}"/>
    <ellipse cx="26" cy="27" rx="10" ry="4" fill="${cor}"/>`,
  oculos: () => `
    <circle cx="41" cy="40" r="8" fill="none" stroke="#1e293b" stroke-width="2.4"/>
    <circle cx="59" cy="40" r="8" fill="none" stroke="#1e293b" stroke-width="2.4"/>
    <line x1="49" y1="40" x2="51" y2="40" stroke="#1e293b" stroke-width="2.4"/>`,
  lenco: (cor) => `<path d="M 32 68 Q 50 78 68 68 L 62 88 Q 50 82 38 88 Z" fill="${cor}"/>`,
  coroa: () => `<path d="M 30 17 L 36 28 L 44 15 L 50 28 L 56 15 L 64 28 L 70 17 L 68 32 L 32 32 Z" fill="#f5c518" stroke="#c9a227" stroke-width="1"/>`,
}

// As cores vêm de dados salvos pelo próprio usuário e são jogadas DIRETO
// dentro de um SVG renderizado com dangerouslySetInnerHTML — sem checar o
// formato, alguém poderia "escapar" do atributo fill="..." e injetar
// marcação/script (XSS armazenado, visível pra QUALQUER um que veja aquele
// avatar). Por isso só aceitamos exatamente #rrggbb; qualquer outra coisa
// cai num valor padrão seguro. Isso é reforçado de novo no banco.
const HEX_VALIDO = /^#[0-9a-fA-F]{6}$/
function corSegura(valor, padrao) {
  return typeof valor === 'string' && HEX_VALIDO.test(valor) ? valor : padrao
}

// Devolve o miolo do SVG (sem <svg>/viewBox) pronto pra colocar num <svg dangerouslySetInnerHTML>.
export function montarAvatarSvg(cfg) {
  const a = { ...AVATAR_PADRAO, ...(cfg || {}) }
  const pele = corSegura(a.pele, AVATAR_PADRAO.pele)
  const corRoupa = corSegura(a.corRoupa, AVATAR_PADRAO.corRoupa)
  const corCabelo = corSegura(a.corCabelo, AVATAR_PADRAO.corCabelo)
  const corAcessorio = corSegura(a.corAcessorio, AVATAR_PADRAO.corRoupa)
  const roupaFn = ROUPA_SVG[a.roupa] || ROUPA_SVG.lisa
  const cabeloFn = CABELO_SVG[a.cabelo] || CABELO_SVG.curto
  const acessFn = ACESSORIO_SVG[a.acessorio] || ACESSORIO_SVG.nenhum
  return `
    <rect x="26" y="70" width="48" height="42" rx="16" fill="${corRoupa}"/>
    <rect x="26" y="70" width="48" height="10" rx="5" fill="${corRoupa}" opacity="0.85"/>
    ${roupaFn(corRoupa)}
    ${corpoBase(pele)}
    ${cabeloFn(corCabelo)}
    ${acessFn(corAcessorio)}
  `
}
