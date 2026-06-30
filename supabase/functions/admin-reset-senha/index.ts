// Edge Function: admin-reset-senha
// Permite que a LIDERANÇA (instrutor/diretoria) defina uma nova senha para um membro.
// A chave admin (service_role) fica só aqui no servidor — nunca no app.
//
// Deploy: supabase functions deploy admin-reset-senha
// (Não precisa de secrets extras: SUPABASE_URL, SUPABASE_ANON_KEY e
//  SUPABASE_SERVICE_ROLE_KEY já são injetados automaticamente.)

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization') ?? ''

    // 1) Identifica quem está chamando (pelo token do usuário logado)
    const asUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } })
    const { data: u } = await asUser.auth.getUser()
    const caller = u?.user
    if (!caller) return json({ error: 'Não autenticado.' }, 401)

    // 2) Confirma que é liderança ATIVA (instrutor/diretoria)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { data: perfil } = await admin.from('profiles').select('papel,status').eq('id', caller.id).single()
    if (!perfil || perfil.status !== 'ativo' || !['instrutor', 'diretoria'].includes(perfil.papel)) {
      return json({ error: 'Sem permissão (apenas diretoria/instrutor).' }, 403)
    }

    // 3) Troca a senha do alvo
    const { userId, novaSenha } = await req.json()
    if (!userId || !novaSenha || String(novaSenha).length < 6) {
      return json({ error: 'Informe o usuário e uma senha de pelo menos 6 caracteres.' }, 400)
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password: String(novaSenha) })
    if (error) return json({ error: error.message }, 400)

    return json({ ok: true })
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
