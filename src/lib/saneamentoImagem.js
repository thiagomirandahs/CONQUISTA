// Pede ao servidor para sanear (tirar EXIF/GPS/metadados) uma imagem que ACABOU de subir ao Storage (migration 529).
//
// ADITIVO e MELHOR-ESFORÇO: nunca lança, nunca é esperado (quem chama não faz `await`), nunca atrasa nem bloqueia o envio.
// Se a chamada falhar (rede, front novo antes da migration 529, caminho que não é do próprio usuário), nada acontece: a
// varredura do servidor (cron) enfileira o mesmo objeto de qualquer jeito. Só enfileira; quem lê/regrava o arquivo é a
// Edge Function `sanear-imagens`. Não é a única linha de defesa: o app continua removendo EXIF no cliente (canvas).
import { supabase } from './supabase.js'

const BUCKETS = ['imagens', 'comprovacoes', 'comunidade', 'suporte-anexos']

export function solicitarSaneamento(bucket, caminho) {
  try {
    if (!BUCKETS.includes(bucket) || typeof caminho !== 'string' || !caminho || /^https?:/i.test(caminho)) return
    Promise.resolve(supabase.rpc('imagem_saneamento_enfileirar', { p_bucket: bucket, p_caminho: caminho })).then(
      () => {},
      () => {},
    )
  } catch {
    /* nunca atrapalha o envio */
  }
}
