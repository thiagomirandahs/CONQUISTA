// Cada limpeza é independente: storage bloqueado ou erro em um cache não impede as demais.
export function limparSessaoLocal({ chaveSessao, limparImagens, limparRascunhos }) {
  try { globalThis.localStorage?.removeItem(chaveSessao) } catch { /* armazenamento indisponível */ }
  try { globalThis.sessionStorage?.removeItem('pos-login-retorno') } catch { /* idem */ }
  try { limparImagens() } catch { /* segue para os rascunhos */ }
  try { limparRascunhos() } catch { /* sessão já removida */ }
}
