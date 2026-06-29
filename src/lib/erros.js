// Traduz mensagens de erro do Supabase para um português amigável
export function traduzErro(msg = '') {
  const m = String(msg).toLowerCase()
  if (m.includes('invalid login')) return 'E-mail ou senha incorretos.'
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.'
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('already exists'))
    return 'Este e-mail já está cadastrado.'
  if (m.includes('password should be at least') || m.includes('at least 6')) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'E-mail inválido.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Espere um pouco e tente de novo.'
  return 'Algo deu errado. Tente novamente em instantes.'
}
