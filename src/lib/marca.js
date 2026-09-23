import { variaveisDeContraste } from '../ui/contraste.js'

// Marca (branding) do clube: nome, sigla, lema, cores e logo. Lógica pura + aplicação no documento.
// A marca vem do SERVIDOR, por clube (`meu_contexto()`); nada de "Filhos da Conquista" fixo nas telas.
//
// MARCA_LEGADA é o ÚNICO lugar do front que ainda conhece o Tenant 001: é o que se mostra quando o banco ainda não tem o SQL do
// multi-clube (front publicado antes do SQL — regra do rollout) e antes de a primeira resposta chegar. Depois do SQL, o Tenant 001
// recebe essa mesma marca do banco (migration 33) e este objeto deixa de ser usado. Pode sair quando o rollout terminar.
export const MARCA_LEGADA = Object.freeze({
  nome: 'Filhos da Conquista',
  sigla: 'FC',
  lema: 'Desbravadores · 1994',
  descricao: 'Clube de Desbravadores · 1994',
  desde: 1994,
  corPrimaria: null,
  corSecundaria: null,
  logoUrl: '/icon-192.png',
})

// cor da barra do navegador quando o clube não escolheu cor (a mesma do index.html)
export const COR_TEMA_PADRAO = '#1e3a8a'

const HEX = /^#[0-9a-f]{6}$/i
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
// logo: só http(s) ou caminho do próprio app ("/x.png"); nada de javascript:, data: ou "//host" (o servidor já valida; aqui é a 2ª trava)
const urlSegura = (v) => { const t = texto(v); return t && /^(https?:\/\/|\/(?!\/))/i.test(t) ? t : null }

// resposta do servidor (snake_case, campos ausentes) -> objeto camelCase completo. Só cor no formato #rrggbb é aceita.
export function marcaDaResposta(m) {
  const o = m && typeof m === 'object' ? m : {}
  const cor = (v) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null)
  const desde = Number(o.desde)
  return {
    nome: texto(o.nome) || 'Clube',
    sigla: texto(o.sigla) || (texto(o.nome) ? texto(o.nome)[0].toUpperCase() : '?'),
    lema: texto(o.lema),
    descricao: texto(o.descricao),
    desde: Number.isInteger(desde) && desde >= 1900 ? desde : null,
    corPrimaria: cor(o.cor_primaria ?? o.corPrimaria),
    corSecundaria: cor(o.cor_secundaria ?? o.corSecundaria),
    logoUrl: urlSegura(o.logo_url ?? o.logoUrl),
  }
}

// ---- contraste (o texto sobre a cor da marca é BRANCO: uma cor clara demais deixa o app ilegível para todo mundo) ----
function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
// razão de contraste WCAG da cor contra o branco (1 = igual ao branco; 21 = preto)
export function contrasteComBranco(hex) {
  if (typeof hex !== 'string' || !HEX.test(hex)) return 0
  return 1.05 / (luminancia(hex) + 0.05)
}
export const CONTRASTE_MINIMO = 3   // WCAG para texto grande/negrito

// ---- aplicação no documento ----
const CHAVE_SALVA = 'cq.marca.v1'

// Escreve a marca na página: título, cor da barra, favicon (só se o clube tem logo própria) e as variáveis de cor do tema.
// Sem cor definida, REMOVE a sobrescrita (o tema padrão volta idêntico ao de sempre).
export function aplicarMarca(marca, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return
  const m = marca || MARCA_LEGADA
  const raiz = doc.documentElement
  doc.title = m.nome

  const tema = doc.querySelector('meta[name="theme-color"]')
  if (tema) tema.setAttribute('content', m.corPrimaria || COR_TEMA_PADRAO)

  const icone = doc.querySelector('link[rel="icon"]')
  if (icone) {
    if (!icone.dataset.padrao) icone.dataset.padrao = icone.getAttribute('href') || ''
    icone.setAttribute('href', m.logoUrl || icone.dataset.padrao)
  }

  const p1 = m.corPrimaria
  // só a primária: a secundária vira uma versão mais clara dela (o app usa as duas em degradê)
  const p2 = m.corSecundaria || (p1 ? `color-mix(in srgb, ${p1} 62%, white)` : null)
  const escolher = (nome, valor) => { if (valor) raiz.style.setProperty(nome, valor); else raiz.style.removeProperty(nome) }
  escolher('--marca-1', p1)
  escolher('--marca-1-dark', p1 ? `color-mix(in srgb, ${p1} 72%, white)` : null)   // no tema escuro a cor precisa de mais luz
  escolher('--marca-2', p2)
  escolher('--marca-2-dark', m.corSecundaria ? `color-mix(in srgb, ${m.corSecundaria} 72%, white)` : (p1 ? `color-mix(in srgb, ${p1} 50%, white)` : null))

  // Fase 7 — contraste protegido: a cor que o clube escolheu não pode deixar nada ilegível.
  // `--marca-1-texto`  = o que escrever EM CIMA da cor (branco ou tinta escura, pelo contraste real);
  // `--marca-1-legivel`= a cor usada COMO texto, escurecida até alcançar 4.5:1 se precisar.
  // Sem cor definida, as duas somem e o tema padrão volta idêntico ao de sempre.
  const contraste = variaveisDeContraste(p1)
  escolher('--marca-1-texto', contraste['--marca-1-texto'] || null)
  escolher('--marca-1-legivel', contraste['--marca-1-legivel'] || null)
}

// A última marca vista fica guardada: a tela de login (antes de entrar) e o 1º quadro do app mostram a do SEU clube, sem "piscar".
// (Não é dado sensível: é a identidade pública do clube. Trocou de conta => a próxima resposta do servidor sobrescreve.)
export function lerMarcaSalva() {
  try {
    const o = JSON.parse(localStorage.getItem(CHAVE_SALVA) || 'null')
    return o && o.marca ? marcaDaResposta(o.marca) : null      // marcaDaResposta aceita camelCase e snake_case
  } catch { return null }
}
export function salvarMarca(clubeId, marca) {
  try { localStorage.setItem(CHAVE_SALVA, JSON.stringify({ clubeId, marca })) } catch { /* sem storage */ }
}
export function esquecerMarcaSalva() {
  try { localStorage.removeItem(CHAVE_SALVA) } catch { /* sem storage */ }
}

// ---- formulário de identidade (tela da liderança) ----
const CAMPOS_DO_FORMULARIO = [
  ['nome', 'nome'], ['sigla', 'sigla'], ['lema', 'lema'], ['descricao', 'descricao'], ['desde', 'desde'],
  ['corPrimaria', 'cor_primaria'], ['corSecundaria', 'cor_secundaria'], ['logoUrl', 'logo_url'],
]

// marca (camelCase) -> valores de formulário (tudo texto)
export function formularioDaMarca(marca) {
  const m = marca || {}
  return Object.fromEntries(CAMPOS_DO_FORMULARIO.map(([k]) => [k, m[k] == null ? '' : String(m[k])]))
}

// SÓ o que mudou em relação à marca em uso, no formato do servidor (snake_case). Campo esvaziado vira null (= voltar ao padrão).
// Não reenviar o que não mudou evita "congelar" como escolha do clube um valor que era só o padrão derivado do nome.
export function diferencasDaMarca(form, marcaAtual) {
  const atual = formularioDaMarca(marcaAtual)
  const saida = {}
  for (const [k, api] of CAMPOS_DO_FORMULARIO) {
    const novo = String(form?.[k] ?? '').trim()
    if (novo === atual[k]) continue
    saida[api] = novo === '' ? null : (k === 'desde' ? Number(novo) : novo)
  }
  return saida
}

// Mesmas regras do servidor (`clube_marca_gravar`), para avisar ANTES de enviar — e a do contraste, que só o app conhece.
export function errosDaMarca(form) {
  const erros = []
  const f = (k) => String(form?.[k] ?? '').trim()
  const anoMax = new Date().getFullYear() + 1
  if (f('nome') && (f('nome').length < 2 || f('nome').length > 60)) erros.push('O nome deve ter de 2 a 60 caracteres.')
  if (f('sigla') && !/^[\p{L}\p{N}]{1,4}$/u.test(f('sigla'))) erros.push('A sigla deve ter de 1 a 4 letras ou números.')
  if (f('lema').length > 80) erros.push('O lema deve ter no máximo 80 caracteres.')
  if (f('descricao').length > 120) erros.push('A descrição deve ter no máximo 120 caracteres.')
  if (f('desde') && (!/^\d{4}$/.test(f('desde')) || Number(f('desde')) < 1900 || Number(f('desde')) > anoMax)) erros.push(`O ano de fundação deve estar entre 1900 e ${anoMax}.`)
  for (const k of ['nome', 'sigla', 'lema', 'descricao']) if (/[<>]/.test(f(k))) erros.push('Não use < nem > nos textos.')
  for (const [k, rotulo] of [['corPrimaria', 'principal'], ['corSecundaria', 'secundária']]) {
    if (!f(k)) continue
    if (!HEX.test(f(k))) erros.push(`A cor ${rotulo} precisa estar no formato #rrggbb.`)
    else if (contrasteComBranco(f(k)) < CONTRASTE_MINIMO) erros.push(`A cor ${rotulo} é clara demais: o texto branco ficaria ilegível. Escolha uma mais escura.`)
  }
  return [...new Set(erros)]
}
