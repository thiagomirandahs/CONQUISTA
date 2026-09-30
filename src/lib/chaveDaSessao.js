// Chave onde o cliente do Supabase guarda a sessão no aparelho. É EXATAMENTE a chave padrão da
// biblioteca (`sb-<primeiro rótulo do host>-auth-token`) — declarada aqui para o app poder perguntar
// "existe sessão guardada?" (só sim/não, nunca o conteúdo) sem depender de detalhe interno da lib.
const url = import.meta.env.VITE_SUPABASE_URL || 'http://localhost'

function hostDe(u) {
  try { return new URL(u).hostname } catch { return 'localhost' }
}

export const CHAVE_DA_SESSAO = `sb-${hostDe(url).split('.')[0]}-auth-token`
