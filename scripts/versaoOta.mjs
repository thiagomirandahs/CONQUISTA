// Versão do pacote de telas (OTA do APK). DETERMINÍSTICA por commit: data do commit + hash curto.
// Assim o APK montado de uma tag e o pacote publicado pela Vercel no MESMO commit têm a mesma
// versão — o aparelho não baixa de novo o que já tem embutido.
import { execFileSync } from 'node:child_process'

export function versaoOta() {
  if (process.env.OTA_VERSAO) return process.env.OTA_VERSAO
  try {
    const s = execFileSync('git', ['log', '-1', '--date=format:%Y%m%d%H%M', '--format=%cd-%h'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (s) return s
  } catch { /* sem git (ex.: tarball) */ }
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7)
  const d = new Date().toISOString().replace(/\D/g, '').slice(0, 12)
  return `${d}-${sha}`
}
