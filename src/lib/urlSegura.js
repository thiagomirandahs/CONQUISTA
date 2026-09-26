// Link externo vindo de DADO (catálogo, cadastro da liderança): só http(s). Qualquer outro esquema
// (javascript:, data:, vbscript:...) vira null e o link simplesmente não é desenhado.
export function hrefExterno(valor) {
  if (typeof valor !== 'string') return null
  const v = valor.trim()
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}
