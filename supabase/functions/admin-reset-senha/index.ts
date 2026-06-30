// Edge Function: admin-reset-senha
// Ferramentas de usuário para a LIDERANÇA (instrutor/diretoria):
//   - acao: 'listar'  -> lista os perfis COM o e-mail do cadastro
//   - acao: 'resetar' -> define uma nova senha para um membro
// A chave admin (service_role) e os e-mails ficam só aqui no servidor.
//
// Deploy: supabase functions deploy admin-reset-senha
// (SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são automáticos.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Garante que quem chama é liderança ATIVA. Retorna o client admin ou um erro pronto.
async function autenticarAdmin(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? ''
  const asUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } })
  const { data: u } = await asUser.auth.getUser()
  const caller = u?.user
  if (!caller) return { erro: json({ error: 'Não autenticado.' }, 401) }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  const { data: perfil } = await admin.from('profiles').select('papel,status').eq('id', caller.id).single()
  if (!perfil || perfil.status !== 'ativo' || !['instrutor', 'diretoria'].includes(perfil.papel)) {
    return { erro: json({ error: 'Sem permissão (apenas diretoria/instrutor).' }, 403) }
  }
  return { admin }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { admin, erro } = await autenticarAdmin(req)
    if (erro) return erro

    const body = await req.json().catch(() => ({}))
    const acao = body.acao ?? (body.userId && body.novaSenha ? 'resetar' : '')

    if (acao === 'listar') {
      const { data: perfis } = await admin!.from('profiles')
        .select('id,nome,foto,papel,status,unidade_id').order('nome')

      // E-mails ficam em auth.users — só acessível com a chave admin.
      const emails: Record<string, string> = {}
      let page = 1
      while (page <= 20) {
        const { data: lista } = await admin!.auth.admin.listUsers({ page, perPage: 1000 })
        const users = lista?.users ?? []
        for (const us of users) emails[us.id] = us.email ?? ''
        if (users.length < 1000) break
        page++
      }
      const usuarios = (perfis ?? []).map((p: any) => ({ ...p, email: emails[p.id] ?? '' }))
      return json({ usuarios })
    }

    if (acao === 'resetar') {
      const { userId, novaSenha } = body
      if (!userId || !novaSenha || String(novaSenha).length < 6) {
        return json({ error: 'Informe o usuário e uma senha de pelo menos 6 caracteres.' }, 400)
      }
      const { error } = await admin!.auth.admin.updateUserById(userId, { password: String(novaSenha) })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Ação desconhecida.' }, 400)
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
