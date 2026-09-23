// Traduz mensagens de erro do Supabase para um português amigável
export function traduzErro(msg = '') {
  const m = String(msg).toLowerCase()
  if (m.includes('invalid login')) return 'E-mail ou senha incorretos.'
  // Confirmação de e-mail passou a ser exigida na fase 8.1: esta mensagem deixou de ser rara e
  // virou o caminho normal de quem acabou de se cadastrar. Diz o que fazer, não só o que houve.
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar — o link está na sua caixa de entrada.'
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('already exists'))
    return 'Este e-mail já está cadastrado.'
  // As duas regras de senha da fase 8.1 (mínimo 8, com letra e número) chegam em mensagens
  // diferentes do GoTrue; as duas precisam virar a mesma instrução clara.
  if (m.includes('password should contain') || m.includes('lower_upper') || m.includes('letters_digits'))
    return 'A senha precisa ter letras e números.'
  if (m.includes('password should be at least') || m.includes('at least 8') || m.includes('at least 6'))
    return 'A senha precisa ter pelo menos 8 caracteres.'
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'E-mail inválido.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Espere um pouco e tente de novo.'
  return 'Algo deu errado. Tente novamente em instantes.'
}
