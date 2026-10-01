// O código do clube que viaja COM A CONTA (user_metadata.entrada_codigo).
//
// Por quê: o retorno do fluxo (`?proximo=` e sessionStorage) vive no navegador onde a pessoa abriu o
// link. A confirmação de e-mail muitas vezes abre em OUTRO navegador/aparelho — lá nada disso existe, e
// a pessoa cairia em "Entrar com código" sem o código. O metadado vai junto do signUp e sobrevive.
//
// Segurança: o metadado é só um SEGREDO de destino (o mesmo código que já viaja na URL), nunca papel,
// clube ou status. Quem valida e decide é o servidor (entrada_solicitar); o gatilho handle_new_user
// só lê nome/tipo/convite_responsavel/nascimento/cargo e ignora qualquer outra chave.

export const CHAVE_METADADO = 'entrada_codigo'

// Código gerado pelo servidor: hexadecimal em maiúsculas (16). Aqui aceitamos alfanumérico de 8 a 32
// para não amarrar o cliente ao tamanho exato; qualquer coisa fora disso nunca é gravada nem enviada.
const FORMATO = /^[A-Z0-9]{8,32}$/

// Devolve o código normalizado (maiúsculas, sem espaços nas pontas) ou null se o formato não servir.
export function codigoValido(valor) {
  if (typeof valor !== 'string') return null
  const c = valor.trim().toUpperCase()
  return FORMATO.test(c) ? c : null
}

// Do caminho de retorno ("/entrar?codigo=XXXX&pedir=1") extrai o código — só da porta de entrada.
export function codigoDoRetorno(retorno) {
  if (typeof retorno !== 'string') return null
  try {
    const u = new URL(retorno, 'http://local.invalid')
    if (u.origin !== 'http://local.invalid' || u.pathname.replace(/\/+$/, '') !== '/entrar') return null
    return codigoValido(u.searchParams.get('codigo'))
  } catch { return null }
}

// Do usuário da sessão (session.user): o código guardado na conta, se existir e tiver formato válido.
export function codigoDoMetadado(user) {
  return codigoValido(user?.user_metadata?.[CHAVE_METADADO])
}
