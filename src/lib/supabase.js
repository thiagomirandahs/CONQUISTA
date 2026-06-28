import { createClient } from '@supabase/supabase-js'

// As chaves vêm do arquivo .env (criado com os dados do SEU projeto Supabase).
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('⚠️ Supabase ainda não configurado: crie o arquivo .env com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(url || 'http://localhost', anonKey || 'placeholder')
