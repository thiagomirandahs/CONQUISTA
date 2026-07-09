// Gera e baixa um arquivo CSV no próprio navegador (sem servidor).
// Usa ";" (o Excel em PT-BR abre melhor) e BOM UTF-8 pra acentos saírem certos.
export function baixarCSV(nomeArquivo, cabecalhos, linhas) {
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const conteudo = [cabecalhos, ...linhas].map((row) => row.map(esc).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
