// Site × aplicativo no MESMO build: quem decide é o hostname.
//   desbravaclube.com.br / www.  → 'site'  (landing, planos, aquisição, verificação pública)
//   app.desbravaclube.com.br     → 'app'   (login e tudo que exige conta)
//   qualquer outro (localhost, *.vercel.app, APK)  → 'unico' (comportamento de sempre: tudo junto)
// `site.<host>` e `app.<host>` também valem para testar localmente (ex.: site.localhost:5173).
const DOMINIO = 'desbravaclube.com.br'

export function modoDoHost(host = globalThis.location?.hostname || '') {
  const h = String(host).toLowerCase()
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
  const base = loc.hostname.toLowerCase().replace(/^app\./, '')
  return montar(loc, base === DOMINIO ? DOMINIO : `site.${base}`, caminho)
}

// Rotas que o site público serve; o resto pertence ao aplicativo.
// /clubes, /clubes/:slug e /parceiros são a VITRINE: só existem no site (nunca dentro do app).
const ROTAS_DO_SITE = [/^\/$/, /^\/planos\/?$/, /^\/adquirir\/?$/, /^\/verificar\/[^/]+\/?$/,
  /^\/clubes\/?$/, /^\/clubes\/[a-z0-9-]+\/?$/i, /^\/parceiros\/?$/]
// Rotas que são SÓ do site: no domínio do app são mandadas de volta para o site.
const SO_DO_SITE = [/^\/clubes(\/[a-z0-9-]+)?\/?$/i, /^\/parceiros\/?$/]
export const rotaSoDoSite = (caminho) => SO_DO_SITE.some((r) => r.test(caminho))
export const rotaDoSite = (caminho) => ROTAS_DO_SITE.some((r) => r.test(caminho))
