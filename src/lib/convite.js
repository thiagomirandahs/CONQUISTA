// Token de convite de responsável.
//
// O token vai no FRAGMENTO da URL (#convite=...): o navegador nunca envia o fragmento ao
// servidor, então ele não cai em log de acesso (Vercel), analytics nem no header Referer.
// Links antigos (?convite=...) continuam funcionando; depois de lido, o token sai da barra
// de endereço para não ficar no histórico/compartilhamento de tela.
const TOKEN_RE = /^[0-9a-f]{48}$/i

export function montarLinkConvite(origin, token) {
  return `${String(origin).replace(/\/+$/, '')}/cadastro#convite=${encodeURIComponent(token)}`
}

// loc = window.location (só usa hash e search). Devolve '' se não houver token bem-formado.
export function lerTokenConvite(loc) {
  const hash = String(loc?.hash || '').replace(/^#/, '')
  const search = String(loc?.search || '').replace(/^\?/, '')
  for (const bruto of [hash, search]) {
    const token = new URLSearchParams(bruto).get('convite')?.trim()
    if (token && TOKEN_RE.test(token)) return token.toLowerCase()
  }
  return ''
}

export function limparConviteDaUrl(loc, hist) {
  if (!loc || !hist?.replaceState) return
  hist.replaceState(null, '', loc.pathname)
}

// Rótulo e cor de cada estado devolvido por listar_convites_responsavel()
export const STATUS_CONVITE = {
  ativo: { rotulo: 'Ativo', classe: 'bg-green-100 text-green-700' },
  usado: { rotulo: 'Usado', classe: 'bg-blue-100 text-blue-700' },
  expirado: { rotulo: 'Expirado', classe: 'bg-slate-100 text-slate-500' },
  revogado: { rotulo: 'Revogado', classe: 'bg-red-100 text-red-600' },
}
