// Confirma usuário no Auth; uma chave pública/service JWT não é uma sessão de pessoa.
export async function usuarioAutenticado(req, cliente) {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ') || !auth.slice(7).trim()) return null
  const { data, error } = await cliente.auth.getUser(auth.slice(7))
  return !error && data?.user?.id ? data.user : null
}
