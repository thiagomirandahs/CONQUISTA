// Erro tipado da fila de anexos: `codigo` é estável (a tela decide o texto), `message` é só para log.
//  ENTRADA        parâmetro inválido (uid/clube/destino/arquivo)
//  TIPO           arquivo não é imagem aceita
//  TAMANHO        anexo acima do limite (ou vazio)
//  LIMITE_ITENS   muitos anexos para o mesmo destino/conta
//  LIMITE_BYTES   a fila da conta (ou do aparelho) estourou o orçamento de bytes
//  COTA_BAIXA     o aparelho está com pouco espaço (navigator.storage.estimate)
//  COTA           o armazenamento recusou a gravação (QuotaExceededError)
//  ID_EM_USO      o id já existe para outra conta/clube (nunca devolve o item alheio)
export class ErroFila extends Error {
  constructor(codigo, mensagem, detalhe = null) {
    super(mensagem || codigo)
    this.name = 'ErroFila'
    this.codigo = codigo
    this.detalhe = detalhe
  }
}

export const ehQuotaExcedida = (e) => !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.codigo === 'COTA'
  || /quota/i.test(String(e.message || '')))
