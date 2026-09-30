// Perfis por finalidade. `comprimir: false` = SEM compressão social agressiva (evidência/documento):
// qualidade alta, lado grande, alvo de KB generoso. O re-render em canvas (remove EXIF) vale para todos.
export const FINALIDADES = ['avatar', 'feed', 'miniatura', 'mural', 'evidencia', 'documento']

const KB = 1024
export const PERFIS = Object.freeze({
  avatar:    { maxLado: 256,  minLado: 160,  alvoBytes: 30 * KB,   qualidade: 0.7,  qualidadeMin: 0.4,  saida: 'webp', comprimir: true,  miniatura: 96 },
  feed:      { maxLado: 1080, minLado: 720,  alvoBytes: 150 * KB,  qualidade: 0.7,  qualidadeMin: 0.5,  saida: 'webp', comprimir: true,  miniatura: 320 },
  miniatura: { maxLado: 320,  minLado: 160,  alvoBytes: 25 * KB,   qualidade: 0.65, qualidadeMin: 0.4,  saida: 'webp', comprimir: true,  miniatura: 160 },
  mural:     { maxLado: 1280, minLado: 800,  alvoBytes: 200 * KB,  qualidade: 0.72, qualidadeMin: 0.5,  saida: 'webp', comprimir: true,  miniatura: 320 },
  evidencia: { maxLado: 2048, minLado: 1600, alvoBytes: 900 * KB,  qualidade: 0.88, qualidadeMin: 0.8,  saida: 'jpeg', comprimir: false, miniatura: 320 },
  documento: { maxLado: 2560, minLado: 2000, alvoBytes: 1200 * KB, qualidade: 0.9,  qualidadeMin: 0.85, saida: 'jpeg', comprimir: false, miniatura: 320 },
})

export function perfilDe(nome) {
  const p = Object.prototype.hasOwnProperty.call(PERFIS, nome) ? PERFIS[nome] : null
  if (!p) throw new Error('Finalidade de imagem desconhecida.')
  return { nome, ...p }
}
