// Onde voltar depois de logar/cadastrar — usado quando a sessão é exigida no meio de um fluxo
// público (ex.: /entrar com um código, sem sessão ainda). Guarda só um CAMINHO relativo da própria
// origem (nunca um club_id nem qualquer autoridade — o "segredo" aqui é exatamente o mesmo código/
// token que já viaja na URL, só preservado através do login/cadastro). sessionStorage, não
// localStorage: some sozinho ao fechar a aba, nunca persiste entre sessões diferentes do aparelho.
const CHAVE = 'pos-login-retorno'

// Só aceita caminho relativo da própria origem começando com "/" e sem "//" (evita virar um
// redirecionamento pra outro domínio se algo escrever aqui errado).
function caminhoSeguro(destino) {
  if (typeof destino !== 'string') return null
  if (!/^\/(?![/\\])/.test(destino)) return null
  // "\" e caracteres de controle: navegadores tratam "/\evil.test" como "//evil.test" (auditoria 26/09)
  if (destino.includes('\\') || [...destino].some((c) => c.charCodeAt(0) < 0x20)) return null
  return destino
}

export function guardarRetorno(destino) {
  const seguro = caminhoSeguro(destino)
  if (!seguro) return
  try { sessionStorage.setItem(CHAVE, seguro) } catch { /* modo privado etc. — sem retorno, sem problema */ }
}

export function lerRetorno() {
  try {
    const v = sessionStorage.getItem(CHAVE)
    return caminhoSeguro(v)
  } catch { return null }
}

// O mesmo destino vindo na URL (`?proximo=/entrar?codigo=...`): sobrevive a refresh e a abrir o
// login/cadastro por outro caminho. Passa pela mesma validação de caminho relativo.
export function retornoDaUrl(search) {
  try { return caminhoSeguro(new URLSearchParams(search).get('proximo')) } catch { return null }
}

export function limparRetorno() {
  try { sessionStorage.removeItem(CHAVE) } catch { /* ignora */ }
}
