import { useState } from 'react'
import { EMBLEMAS_ESPECIALIDADES } from '../lib/emblemasEspecialidades.js'
import { ehApkNativo, URL_PUBLICA_APP } from '../lib/dominios.js'

export const urlDoEmblema = (codigo) => {
  const c = String(codigo || '').toUpperCase()
  const ext = EMBLEMAS_ESPECIALIDADES[c]
  if (!ext) return null
  // No APK as imagens NÃO vão embutidas (19 MB): vêm do site, e o WebView guarda em cache.
  return `${ehApkNativo() ? URL_PUBLICA_APP : ''}/especialidades/${c.toLowerCase()}.${ext}`
}

// Emblema (imagem) da especialidade, pelo código do catálogo (ex.: AP-002). Carrega só quando aparece na tela.
// Sem imagem para o código (ou se ela falhar), mostra um selo neutro com a sigla da área — a não ser que
// `semSelo` (aí não desenha nada). É decorativo: o nome da especialidade sempre vem escrito ao lado.
export default function EmblemaEspecialidade({ codigo, tamanho = 48, semSelo = false, className = '' }) {
  const [falhou, setFalhou] = useState(false)
  const src = urlDoEmblema(codigo)
  if (src && !falhou) {
    return <img src={src} alt="" aria-hidden="true" width={tamanho} height={tamanho} loading="lazy" decoding="async"
      onError={() => setFalhou(true)} data-testid="emblema-especialidade"
      className={`shrink-0 rounded-lg object-contain bg-white ${className}`} />
  }
  if (semSelo) return null
  const sigla = String(codigo || '??').split('-')[0].slice(0, 2).toUpperCase()
  return (
    <span aria-hidden="true" data-testid="emblema-selo" style={{ width: tamanho, height: tamanho }}
      className={`shrink-0 grid place-items-center rounded-lg bg-surface2 text-xs font-extrabold text-muted ring-1 ring-inset ring-line ${className}`}>{sigla}</span>
  )
}
