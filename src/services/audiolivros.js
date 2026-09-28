// Serviço dos AUDIOLIVROS das Classes (migration 370). Catálogo global: o app lê os livros ativos;
// só o admin da plataforma troca o vídeo de um capítulo ou desativa um livro.
import { supabase } from '../lib/supabase.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

// O catálogo muda raramente: uma leitura por sessão basta (uma tela de classe tem vários requisitos).
let emCache = null
export function audiolivros() {
  if (!emCache) emCache = rpc('audiolivros_listar').then((d) => d || []).catch((e) => { emCache = null; throw e })
  return emCache
}

export const adminAudiolivros = async () => (await rpc('admin_audiolivros_listar')) || []
export const adminTrocarVideoDoCapitulo = (capituloId, videoId) =>
  rpc('admin_audiolivro_capitulo_trocar', { p_capitulo_id: capituloId, p_video_id: videoId }).then((r) => { emCache = null; return r })
export const adminAtivarAudiolivro = (id, ativo) =>
  rpc('admin_audiolivro_ativar', { p_id: id, p_ativo: ativo }).then((r) => { emCache = null; return r })
