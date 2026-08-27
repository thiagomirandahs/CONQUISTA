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

// Itens (enfeites) que o bichinho pode usar — DESBLOQUEIAM por nível (igual
// ao avatar). Os mesmos níveis têm que bater com bichinho_equipar() no banco.
export const ITENS = [
  { id: 'nenhum', nome: 'Nenhum', nivel: 1 },
  { id: 'bone', nome: 'Boné', nivel: 1 },
  { id: 'laco', nome: 'Laço', nivel: 2 },
  { id: 'oculos', nome: 'Óculos', nivel: 3 },
  { id: 'gravata', nome: 'Gravatinha', nivel: 4 },
  { id: 'cachecol', nome: 'Cachecol', nivel: 5 },
  { id: 'chapeu', nome: 'Cartola', nivel: 6 },
  { id: 'coroa', nome: 'Coroa', nivel: 8 },
]
export function nivelMinimoItem(id) { return ITENS.find((i) => i.id === id)?.nivel ?? 99 }

// Cores do corpo (recolorir o bichinho) — DESBLOQUEIAM por nível. 'natural'
// usa a cor da espécie. Guardamos só o NOME (chave), nunca um hex do usuário —
// os mesmos níveis têm que bater com bichinho_vestir() no banco.
export const CORES = [
  { id: 'natural', nome: 'Natural', nivel: 1, cor: null, cor2: null },
  { id: 'rosa', nome: 'Rosa', nivel: 2, cor: '#ff9ec4', cor2: '#f472b6' },
  { id: 'azul', nome: 'Azul', nivel: 3, cor: '#7fb5ff', cor2: '#5b8def' },
  { id: 'verde', nome: 'Verde', nivel: 4, cor: '#8fd694', cor2: '#5cb867' },
  { id: 'roxo', nome: 'Roxo', nivel: 5, cor: '#b79cf0', cor2: '#9575e0' },
  { id: 'laranja', nome: 'Laranja', nivel: 6, cor: '#ffb26b', cor2: '#f59440' },
  { id: 'amarelo', nome: 'Amarelo', nivel: 7, cor: '#ffd95e', cor2: '#f4c430' },
  { id: 'neve', nome: 'Neve', nivel: 8, cor: '#f4f6fb', cor2: '#d8deea' },
]
export function nivelMinimoCor(id) { return CORES.find((c) => c.id === id)?.nivel ?? 99 }
function corInfo(id) {
  const c = CORES.find((x) => x.id === id)
  return (c && c.cor) ? { cor: c.cor, cor2: c.cor2 } : null
}
function corSegura(id) { return CORES.some((c) => c.id === id) ? id : 'natural' }

// Estilos de olho — DESBLOQUEIAM por nível. Só valem quando o bicho está
// feliz/ok e vivo; nos outros humores (triste/doente/dormindo/morto) o olhar
// do humor manda, pra nunca esconder que ele está precisando de você.
export const OLHOS = [
  { id: 'padrao', nome: 'Padrão', nivel: 1 },
  { id: 'aberto', nome: 'Abertos', nivel: 1 },
  { id: 'fofo', nome: 'Fofo', nivel: 2 },
  { id: 'pisca', nome: 'Piscando', nivel: 3 },
  { id: 'estrela', nome: 'Estrela', nivel: 4 },
  { id: 'coracao', nome: 'Coração', nivel: 6 },
]
export function nivelMinimoOlhos(id) { return OLHOS.find((o) => o.id === id)?.nivel ?? 99 }
function olhosSeguro(id) { return OLHOS.some((o) => o.id === id) ? id : 'padrao' }

// Cenários (o "mundinho" atrás do bichinho) — DESBLOQUEIAM por nível.
export const CENARIOS = [
  { id: 'quintal', nome: 'Quintal', nivel: 1 },
  { id: 'parque', nome: 'Parque', nivel: 2 },
  { id: 'praia', nome: 'Praia', nivel: 3 },
  { id: 'acampamento', nome: 'Acampamento', nivel: 4 },
  { id: 'floresta', nome: 'Floresta', nivel: 5 },
  { id: 'neve', nome: 'Neve', nivel: 6 },
  { id: 'noite', nome: 'Noite', nivel: 7 },
  { id: 'espaco', nome: 'Espaço', nivel: 8 },
]
export function nivelMinimoCenario(id) { return CENARIOS.find((c) => c.id === id)?.nivel ?? 99 }
function cenarioSeguro(id) { return CENARIOS.some((c) => c.id === id) ? id : 'quintal' }

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

// ---- Olhos custom (desenhados nas posições padrão dos olhos) ----
function estrelaOlho(cx, cy) {
  return `<path d="M ${cx} ${cy - 5} l 1.4 3 3.3 .3 -2.5 2.2 .8 3.2 -3 -1.7 -3 1.7 .8 -3.2 -2.5 -2.2 3.3 -.3 z" fill="#f5b012"/>`
}
function coracaoOlho(cx, cy) {
  return `<path d="M ${cx} ${cy + 3.4} q -4 -3.4 -4 -6 a 2.2 2.2 0 0 1 4 -1 a 2.2 2.2 0 0 1 4 1 q 0 2.6 -4 6 z" fill="#ff4d7d"/>`
}
function olhosCustom(estilo) {
  const L = 40, R = 60, Y = 52
  switch (estilo) {
    case 'aberto':
      return `<circle cx="${L}" cy="${Y}" r="5" fill="#2b2b2b"/><circle cx="${R}" cy="${Y}" r="5" fill="#2b2b2b"/>` +
        `<circle cx="${L + 1.7}" cy="${Y - 1.7}" r="1.6" fill="#fff"/><circle cx="${R + 1.7}" cy="${Y - 1.7}" r="1.6" fill="#fff"/>`
    case 'fofo':
      return `<ellipse cx="${L}" cy="${Y}" rx="5.4" ry="6.4" fill="#2b2b2b"/><ellipse cx="${R}" cy="${Y}" rx="5.4" ry="6.4" fill="#2b2b2b"/>` +
        `<circle cx="${L + 2}" cy="${Y - 2.4}" r="2" fill="#fff"/><circle cx="${R + 2}" cy="${Y - 2.4}" r="2" fill="#fff"/>` +
        `<circle cx="${L - 1.6}" cy="${Y + 2}" r="0.9" fill="#fff"/><circle cx="${R - 1.6}" cy="${Y + 2}" r="0.9" fill="#fff"/>`
    case 'pisca':
      return `<circle cx="${L}" cy="${Y}" r="4.6" fill="#2b2b2b"/><circle cx="${L + 1.6}" cy="${Y - 1.6}" r="1.5" fill="#fff"/>` +
        `<path d="M ${R - 5} ${Y + 1} Q ${R} ${Y + 5} ${R + 5} ${Y + 1}" stroke="#2b2b2b" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
    case 'estrela':
      return estrelaOlho(L, Y) + estrelaOlho(R, Y)
    case 'coracao':
      return coracaoOlho(L, Y) + coracaoOlho(R, Y)
    default:
      return ''
  }
}

// ---- Rosto por humor (olhos + boca + efeitos), centrado ~ (50,56) ----
// olhos: só troca os olhos quando feliz/ok (nos outros humores o olhar do
// humor é a mensagem de que o bicho precisa de você).
function rostoHumor(humor, olhos = 'padrao') {
  const olhoL = 40, olhoR = 60, olhoY = 52
  const custom = olhos !== 'padrao' ? olhosCustom(olhos) : ''
  switch (humor) {
    case 'feliz':
      return `
        ${custom || `
        <path d="M 36 52 Q 40 47 44 52" stroke="#2b2b2b" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M 56 52 Q 60 47 64 52" stroke="#2b2b2b" stroke-width="2.6" fill="none" stroke-linecap="round"/>`}
        <path d="M 42 62 Q 50 70 58 62" stroke="#2b2b2b" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <circle cx="32" cy="60" r="4" fill="#ff9db0" opacity="0.6"/>
        <circle cx="68" cy="60" r="4" fill="#ff9db0" opacity="0.6"/>
        <path d="M 78 30 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5 z" fill="#f5c518"/>`
    case 'ok':
      return `
        ${custom || `
        <circle cx="${olhoL}" cy="${olhoY}" r="3.4" fill="#2b2b2b"/>
        <circle cx="${olhoR}" cy="${olhoY}" r="3.4" fill="#2b2b2b"/>`}
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

// Enfeites EQUIPÁVEIS (markup fixo, sem nada vindo do usuário). O id é
// validado contra esta lista antes de desenhar (whitelist) — id desconhecido
// não desenha nada, então não há como injetar markup pela galeria dos outros.
const ITEM_SVG = {
  nenhum: () => '',
  bone: () => `
    <path d="M 24 28 Q 24 6 50 6 Q 76 6 76 28 L 76 22 Q 50 12 24 22 Z" fill="#1e3a8a"/>
    <ellipse cx="24" cy="25" rx="11" ry="4.5" fill="#1e3a8a"/>
    <circle cx="50" cy="10" r="2.4" fill="#dbeafe"/>`,
  laco: () => `
    <path d="M 60 22 q -8 -5 -10 3 q 10 3 10 -3 z" fill="#ef4444"/>
    <path d="M 60 22 q 8 -5 10 3 q -10 3 -10 -3 z" fill="#ef4444"/>
    <circle cx="60" cy="23.5" r="2.2" fill="#b91c1c"/>`,
  oculos: () => `
    <circle cx="41" cy="52" r="8" fill="none" stroke="#1e293b" stroke-width="2.4"/>
    <circle cx="59" cy="52" r="8" fill="none" stroke="#1e293b" stroke-width="2.4"/>
    <line x1="49" y1="52" x2="51" y2="52" stroke="#1e293b" stroke-width="2.4"/>`,
  gravata: () => `
    <path d="M 43 78 l 7 -4 7 4 -7 4 z" fill="#7c3aed"/>
    <rect x="47" y="70" width="6" height="6" rx="2" fill="#7c3aed"/>`,
  cachecol: () => `
    <path d="M 30 74 Q 50 84 70 74 L 66 82 Q 50 90 34 82 Z" fill="#16a34a"/>
    <path d="M 62 80 l 6 12 -6 -2 -4 4 z" fill="#15803d"/>`,
  chapeu: () => `
    <ellipse cx="50" cy="26" rx="22" ry="4.5" fill="#111827"/>
    <rect x="38" y="6" width="24" height="20" rx="2" fill="#1f2937"/>
    <rect x="38" y="20" width="24" height="4" fill="#ef4444"/>`,
  coroa: () => `<path d="M 34 20 L 40 30 L 50 16 L 60 30 L 66 20 L 64 34 L 36 34 Z" fill="#f5c518" stroke="#e0a800" stroke-width="1"/>
    <circle cx="50" cy="18" r="1.8" fill="#ef4444"/>`,
}

function itemSeguro(id) {
  return Object.prototype.hasOwnProperty.call(ITEM_SVG, id) ? id : 'nenhum'
}

// ---- Cenários: SVG de fundo (viewBox 0 0 100 100). Feito pra ser desenhado
// com preserveAspectRatio="xMidYMax slice" — o CHÃO (y≈70+) fica colado no
// rodapé do card e o bichinho parece pisar nele. Tudo é markup FIXO por id
// (whitelist): nada vem do usuário, então não há injeção pela galeria. ----
function ceuChao(ceu, chao) {
  return `<rect x="-10" y="-10" width="120" height="130" fill="${ceu}"/>` +
    `<rect x="-10" y="70" width="120" height="60" fill="${chao}"/>`
}
const nuvem = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#ffffff" opacity="0.9"><ellipse cx="0" cy="0" rx="9" ry="6"/><ellipse cx="8" cy="2" rx="7" ry="5"/><ellipse cx="-8" cy="2" rx="7" ry="5"/></g>`
const pinheiro = (x, y, s = 1, c = '#3f8f5b') => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-2" y="0" width="4" height="8" fill="#7a5230"/><path d="M 0 -22 L 10 -4 L -10 -4 Z" fill="${c}"/><path d="M 0 -14 L 8 2 L -8 2 Z" fill="${c}"/></g>`
const estrelinha = (x, y, r = 1.3) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff"/>`

const CENARIO_SVG = {
  quintal: () =>
    ceuChao('#d5efff', '#b7e08f') +
    `<circle cx="84" cy="52" r="9" fill="#ffe08a"/>` + nuvem(24, 44, 1) + nuvem(60, 34, 0.8) +
    `<circle cx="13" cy="70" r="7" fill="#6cbf6c"/><circle cx="22" cy="70" r="6" fill="#7cd07c"/>`,
  parque: () =>
    ceuChao('#d5efff', '#a9dc86') +
    `<circle cx="86" cy="50" r="8" fill="#ffe08a"/>` + nuvem(32, 42, 0.9) +
    `<g transform="translate(15 52)"><rect x="-3" y="0" width="6" height="20" fill="#8a5a34"/><circle cx="0" cy="-6" r="14" fill="#5fb567"/><circle cx="-10" cy="0" r="9" fill="#6cbf6c"/><circle cx="10" cy="0" r="9" fill="#6cbf6c"/></g>`,
  praia: () =>
    `<rect x="-10" y="-10" width="120" height="130" fill="#cdefff"/>` +
    `<rect x="-10" y="58" width="120" height="16" fill="#6fcbe8"/>` +
    `<rect x="-10" y="72" width="120" height="58" fill="#f4e3b0"/>` +
    `<circle cx="84" cy="46" r="8" fill="#ffdf7a"/>` +
    `<path d="M -10 64 q 10 -4 20 0 t 20 0 t 20 0 t 20 0 t 20 0" stroke="#ffffff" stroke-width="1.6" fill="none" opacity="0.7"/>` +
    `<circle cx="16" cy="82" r="4" fill="#ff8a8a"/><path d="M 12 82 h 8 M 16 78 v 8" stroke="#fff" stroke-width="1"/>`,
  acampamento: () =>
    ceuChao('#46528a', '#4e6b46') +
    estrelinha(22, 42) + estrelinha(50, 46, 1) + estrelinha(66, 38) + estrelinha(90, 46) +
    `<circle cx="82" cy="40" r="7" fill="#f2e9b0"/>` +
    pinheiro(13, 70, 1.1, '#2f6b45') + pinheiro(30, 72, 0.8, '#2f6b45') +
    `<path d="M 62 72 L 82 72 L 72 52 Z" fill="#e06a4a"/><path d="M 72 52 L 82 72 L 76 72 Z" fill="#c4553a"/><path d="M 69 72 L 72 60 L 75 72 Z" fill="#7a2f22"/>` +
    `<path d="M 44 74 l 8 -3 M 44 71 l 8 3" stroke="#8a5a34" stroke-width="2.4" stroke-linecap="round"/><path d="M 48 70 q -3 -5 0 -8 q 3 4 3 6 q 2 -2 2 -4 q 3 5 -1 9 z" fill="#ffb02e"/><path d="M 48 70 q -1 -3 0 -5 q 2 3 0 5 z" fill="#ff6a2e"/>`,
  floresta: () =>
    ceuChao('#cfeaff', '#8fce78') +
    nuvem(34, 42, 0.8) + `<circle cx="86" cy="48" r="7" fill="#ffe08a"/>` +
    pinheiro(13, 72, 1.2) + pinheiro(30, 74, 0.9) + pinheiro(87, 72, 1.1) + pinheiro(72, 74, 0.85),
  neve: () =>
    `<rect x="-10" y="-10" width="120" height="130" fill="#e6f2ff"/>` +
    `<rect x="-10" y="70" width="120" height="60" fill="#ffffff"/>` +
    pinheiro(15, 74, 1.1, '#6aa88a') + pinheiro(85, 74, 1, '#6aa88a') +
    estrelinha(30, 44, 1.6) + estrelinha(52, 52, 1.3) + estrelinha(68, 40, 1.6) + estrelinha(44, 62, 1.3) + estrelinha(76, 58, 1.4),
  noite: () =>
    ceuChao('#2a2f5e', '#3c5a48') +
    estrelinha(18, 40) + estrelinha(34, 50) + estrelinha(52, 38, 1.5) + estrelinha(70, 48) + estrelinha(88, 40) + estrelinha(60, 56) +
    `<circle cx="80" cy="38" r="8" fill="#f2e9b0"/><circle cx="76" cy="35" r="7" fill="#2a2f5e"/>`,
  espaco: () =>
    `<rect x="-10" y="-10" width="120" height="130" fill="#161a3a"/>` +
    `<rect x="-10" y="76" width="120" height="54" fill="#6a4aa0"/>` +
    estrelinha(16, 30) + estrelinha(40, 22, 1.5) + estrelinha(64, 34) + estrelinha(88, 26, 1.4) + estrelinha(28, 52) + estrelinha(78, 54) +
    `<g transform="translate(80 42)"><circle cx="0" cy="0" r="8" fill="#7fd3f0"/><ellipse cx="0" cy="0" rx="14" ry="4" fill="none" stroke="#c9a6ff" stroke-width="1.6" transform="rotate(-18)"/></g>` +
    `<circle cx="20" cy="40" r="4" fill="#ffb26b"/>`,
}

// Devolve o MIOLO do svg do cenário (sem a tag <svg>). id fora da lista → quintal.
export function montarCenarioSvg(cenario = 'quintal') {
  const fn = CENARIO_SVG[cenarioSeguro(cenario)] || CENARIO_SVG.quintal
  return fn()
}

const ESCALA_ESTAGIO = { 1: 0.9, 2: 1.0, 3: 1.06 }

// Animações "vivas" (só quando animar=true, no bichinho grande da tela):
// respiração leve no corpo + piscadinha (pálpebras da cor da pele descem
// sobre os olhos de tempos em tempos). Respeita "reduzir animações".
const ANIM_STYLE = `<style>
  @keyframes bicho-idle{
    0%{transform:scale(1) rotate(0deg)}
    25%{transform:scale(1.02) rotate(-1.6deg)}
    50%{transform:scale(1.035) rotate(0deg)}
    75%{transform:scale(1.02) rotate(1.6deg)}
    100%{transform:scale(1) rotate(0deg)}
  }
  @keyframes bicho-blink{0%,92%,100%{transform:scaleY(0)}96%{transform:scaleY(1)}}
  .bicho-body{transform-box:fill-box;transform-origin:50% 90%;animation:bicho-idle 3.6s ease-in-out infinite}
  .bicho-lid{transform-box:fill-box;transform-origin:top;animation:bicho-blink 4.6s ease-in-out infinite}
  @media (prefers-reduced-motion:reduce){.bicho-body,.bicho-lid{animation:none}}
</style>`

export function montarBichinhoSvg({ especie = 'cachorro', humor = 'ok', estagio = 1, item = 'nenhum', cor = 'natural', olhos = 'padrao', animar = false } = {}) {
  const e = especieInfo(especie)
  const morto = humor === 'morto'
  const cInfo = corInfo(corSegura(cor))
  const corBase = cInfo ? cInfo.cor : e.cor
  const cor2Base = cInfo ? cInfo.cor2 : e.cor2
  const corpo = morto ? '#cbd5e1' : corBase
  const corpo2 = morto ? '#94a3b8' : cor2Base
  const olhosOk = olhosSeguro(olhos)
  const pes = `
    <ellipse cx="40" cy="86" rx="8" ry="5" fill="${corpo2}"/>
    <ellipse cx="60" cy="86" rx="8" ry="5" fill="${corpo2}"/>`
  const e2 = { ...e, cor: corpo, cor2: corpo2 }
  const itemFn = ITEM_SVG[itemSeguro(item)] || ITEM_SVG.nenhum
  const escala = ESCALA_ESTAGIO[estagio] || 1
  // pálpebras (piscadinha) — pele por cima dos olhos, só quando anima e vivo.
  // olhos de estrela/coração ficam melhores parados (sem piscar por cima).
  const podePiscar = !['estrela', 'coracao'].includes(olhosOk)
  const palpebras = (animar && !morto && podePiscar) ? `
    <ellipse cx="40" cy="50" rx="5.4" ry="6" fill="${corpo}" class="bicho-lid"/>
    <ellipse cx="60" cy="50" rx="5.4" ry="6" fill="${corpo}" class="bicho-lid"/>` : ''
  const conteudo = `
    ${pes}
    ${tracosEspecie(e2)}
    <ellipse cx="50" cy="56" rx="32" ry="30" fill="${corpo}" stroke="rgba(17,26,61,0.16)" stroke-width="1.2"/>
    <ellipse cx="50" cy="66" rx="18" ry="14" fill="#ffffff" opacity="0.25"/>
    ${especie === 'passaro' && !morto ? '<path d="M 46 60 L 54 60 L 50 66 Z" fill="#e0a800"/>' : ''}
    ${rostoHumor(morto ? 'morto' : humor, olhosOk)}
    ${palpebras}
    ${morto ? '<ellipse cx="50" cy="30" rx="10" ry="3.4" fill="none" stroke="#f5c518" stroke-width="2"/>' : itemFn()}
  `
  // escala pelo estágio (filhote menor, adulto maior), centrado em (50,58)
  const corpoG = `<g transform="translate(50 58) scale(${escala}) translate(-50 -58)">${conteudo}</g>`
  // quando anima, o corpo "respira" num grupo por fora (pra não brigar com o transform da escala)
  return animar ? `${ANIM_STYLE}<g class="bicho-body">${corpoG}</g>` : corpoG
}
