// Detecção de WebGL — o motor dos jogos (Phaser 4) SÓ renderiza com WebGL.
// Em celulares antigos/fracos (ou com o WebView desatualizado / driver de vídeo
// bloqueado) o WebGL não existe ou vem quebrado, e o jogo viraria TELA PRETA.
// Este check roda 1x e deixa a tela dos jogos escolher a versão clássica
// (canvas 2D) nesses aparelhos.
let cache = null

export function suportaWebGL() {
  if (cache !== null) return cache
  try {
    const cv = document.createElement('canvas')
    const gl = cv.getContext('webgl2') || cv.getContext('webgl') || cv.getContext('experimental-webgl')
    // contexto pode "existir" mas já nascer perdido (driver na lista negra)
    cache = !!gl && !(gl.isContextLost && gl.isContextLost())
  } catch {
    cache = false
  }
  return cache
}
