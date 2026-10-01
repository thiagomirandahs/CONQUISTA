// Site × aplicativo no MESMO build: quem decide é o hostname.
//   desbravaclube.com.br / www.  → 'site'  (landing, planos, aquisição, verificação pública)
//   app.desbravaclube.com.br     → 'app'   (login e tudo que exige conta)
//   qualquer outro (localhost, *.vercel.app, APK)  → 'unico' (comportamento de sempre: tudo junto)
// `site.<host>` e `app.<host>` também valem para testar localmente (ex.: site.localhost:5173).
const DOMINIO = 'desbravaclube.com.br'

// Dentro do APK (Capacitor, telas embutidas desde a 1.3.0) o host é `localhost`: sem isto o app caía no
// modo 'unico' e abria a LANDING em "/" (achado do dono, 29/09). No APK é sempre o APLICATIVO.
export const ehApkNativo = () => !!globalThis.Capacitor?.isNativePlatform?.()

export function modoDoHost(host = globalThis.location?.hostname || '') {
  const h = String(host).toLowerCase()
  if (ehApkNativo() && (h === 'localhost' || h === '')) return 'app'
  if (h === DOMINIO || h === `www.${DOMINIO}` || h.startsWith('site.')) return 'site'
  if (h.startsWith('app.')) return 'app'
  return 'unico'
}

function montar(loc, host, caminho) {
  return `${loc.protocol}//${host}${loc.port ? `:${loc.port}` : ''}${caminho}`
}

// Caminho no APLICATIVO. Fora do modo 'site' continua relativo (mesma origem).
export function urlDoApp(caminho, loc = globalThis.location) {
  if (modoDoHost(loc.hostname) !== 'site') return caminho
  return montar(loc, `app.${loc.hostname.toLowerCase().replace(/^(www\.|site\.)/, '')}`, caminho)
}

// Caminho no SITE público. Fora do modo 'app' continua relativo.
export function urlDoSite(caminho, loc = globalThis.location) {
  if (modoDoHost(loc.hostname) !== 'app') return caminho
  if (ehApkNativo()) return `https://${DOMINIO}${caminho}` // no APK o site é o público de verdade
  const base = loc.hostname.toLowerCase().replace(/^app\./, '')
  return montar(loc, base === DOMINIO ? DOMINIO : `site.${base}`, caminho)
}

// ---- URL PÚBLICA COMPARTILHÁVEL (única fonte para link/QR/WhatsApp/e-mail) ----------------------
// Nunca use `window.location.origin` para montar link que SAI do aparelho: no APK (Capacitor) a
// origem é `http://localhost` e o link chegava quebrado a quem recebia. O app público é sempre
// app.desbravaclube.com.br (rotas /entrar, /cadastro, /coordenacao, /nova-senha, /verificar).
export const URL_PUBLICA_APP = `https://app.${DOMINIO}`

function baseConfigurada() {
  let v = ''
  try { v = String(import.meta.env?.VITE_URL_PUBLICA_APP || '').trim().replace(/\/+$/, '') } catch { /* sem env */ }
  return /^https:\/\/[^\s/]+$/i.test(v) ? v : URL_PUBLICA_APP
}

export function urlPublicaDoApp(caminho = '/', loc = globalThis.location) {
  const cam = caminho.startsWith('/') ? caminho : `/${caminho}`
  const host = String(loc?.hostname || '').toLowerCase()
  const http = /^https?:$/.test(loc?.protocol || '')
  // APK, esquema não-http (capacitor://, ionic://, file://) ou site público → app de produção.
  if (ehApkNativo() || !http || modoDoHost(host) === 'site') return `${baseConfigurada()}${cam}`
  // Web/PWA (app.desbravaclube.com.br), dev (localhost, app.localhost) e preview Vercel: origem atual.
  if (host === '') return `${baseConfigurada()}${cam}`
  return `${loc.protocol}//${loc.host || host}${cam}`
}

// Só a origem (sem barra final), para os montadores que recebem `origin`.
export const origemPublicaDoApp = (loc = globalThis.location) => urlPublicaDoApp('/', loc).replace(/\/$/, '')

// Rotas que o site público serve; o resto pertence ao aplicativo.
// /clubes, /clubes/:slug e /parceiros são a VITRINE: só existem no site (nunca dentro do app).
const ROTAS_DO_SITE = [/^\/$/, /^\/planos\/?$/, /^\/adquirir\/?$/, /^\/verificar\/[^/]+\/?$/,
  /^\/clubes\/?$/, /^\/clubes\/[a-z0-9-]+\/?$/i, /^\/parceiros\/?$/, /^\/ajuda\/?$/, /^\/conheca\/?$/]
// Rotas que são SÓ do site: no domínio do app são mandadas de volta para o site.
const SO_DO_SITE = [/^\/clubes(\/[a-z0-9-]+)?\/?$/i, /^\/parceiros\/?$/]
export const rotaSoDoSite = (caminho) => SO_DO_SITE.some((r) => r.test(caminho))
export const rotaDoSite = (caminho) => ROTAS_DO_SITE.some((r) => r.test(caminho))

// ---- URL CANÔNICA DO SITE PÚBLICO (SEO e compartilhamento) -------------------------------------
// Sempre https://desbravaclube.com.br: nunca a origem atual (localhost, *.vercel.app, www., app.).
export const URL_PUBLICA_SITE = `https://${DOMINIO}`
export const urlPublicaDoSite = (caminho = '/') => `${URL_PUBLICA_SITE}${caminho.startsWith('/') ? caminho : `/${caminho}`}`
// Imagem de compartilhamento (1200x630) — URL absoluta, exigida pelo WhatsApp/Facebook/X.
export const URL_IMAGEM_COMPARTILHAR = urlPublicaDoSite('/og-desbravaclube.png')
