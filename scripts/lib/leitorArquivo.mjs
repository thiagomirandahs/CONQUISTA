// Leitor posicionado de arquivo (fs.read com offset): permite analisar vídeos grandes SEM carregá-los inteiros.
import { openSync, readSync, closeSync, fstatSync } from 'node:fs'

export function abrirLeitor(caminho) {
  const fd = openSync(caminho, 'r')
  const tamanho = fstatSync(fd).size
  return {
    tamanho,
    ler(offset, n) {
      const q = Math.max(0, Math.min(n, tamanho - offset))
      const b = Buffer.alloc(q)
      let lido = 0
      while (lido < q) {
        const r = readSync(fd, b, lido, q - lido, offset + lido)
        if (!r) break
        lido += r
      }
      return lido < q ? b.subarray(0, lido) : b
    },
    fechar() { closeSync(fd) },
  }
}
