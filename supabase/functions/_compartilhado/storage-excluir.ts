// Núcleo PURO da Edge Function `storage-excluir` (migration 532): decisões sem rede, testáveis em vitest.
// A função só apaga o que o BANCO devolveu (public._storage_exclusao_processar); este núcleo é a segunda trava (defesa em
// profundidade) e traduz a resposta da API do Storage para o código que o banco guarda (sem caminho, sem texto livre).

// Mesma lista de public._storage_exclusao_politica(). NUNCA: publico, parceiros, documentos-emitidos, assinaturas-desenhadas.
export const BUCKETS_ELEGIVEIS = Object.freeze(['imagens', 'comprovacoes', 'comunidade', 'suporte-anexos'])

export function bucketElegivel(bucket: unknown): boolean {
  return typeof bucket === 'string' && (BUCKETS_ELEGIVEIS as readonly string[]).includes(bucket)
}

// Caminho que a função aceita passar para remove(): relativo, sem "..", sem "//", sem barra no fim, sem controle/contrabarra, até 512.
export function caminhoSeguro(caminho: unknown): boolean {
  if (typeof caminho !== 'string' || caminho.length === 0 || caminho.length > 512) return false
  if (caminho.startsWith('/') || caminho.endsWith('/') || caminho.includes('//')) return false
  if (/[\u0000-\u001f\u007f\\]/.test(caminho)) return false
  return !caminho.split('/').some((seg) => seg === '..' || seg === '.')
}

export type ItemDoBanco = { bucket?: unknown; caminho?: unknown }

// O item que o banco devolveu é aceitável para apagar? (nunca vira remove() se não for)
export function itemAceitavel(item: ItemDoBanco | null | undefined): item is { bucket: string; caminho: string } {
  return !!item && bucketElegivel(item.bucket) && caminhoSeguro(item.caminho)
}

export type ResultadoRemocao = { ok: boolean; msg: string }

// Resposta do supabase-js `remove()`: { data: objetos removidos | null, error }.
//   erro            -> ok=false, "erro_api <status>" (NUNCA a mensagem do erro: pode conter o caminho)
//   removeu 1       -> ok=true "removido"
//   lista vazia     -> ok=true "ja_ausente" (a API confirmou que o objeto não existe mais)
export function interpretarRemocao(
  res: { data?: unknown; error?: { status?: unknown; statusCode?: unknown } | null } | null | undefined,
): ResultadoRemocao {
  if (!res) return { ok: false, msg: 'erro_api sem_resposta' }
  if (res.error) {
    const st = String(res.error.statusCode ?? res.error.status ?? '').replace(/[^0-9]/g, '').slice(0, 3)
    return { ok: false, msg: st ? `erro_api ${st}` : 'erro_api' }
  }
  if (Array.isArray(res.data)) return res.data.length > 0 ? { ok: true, msg: 'removido' } : { ok: true, msg: 'ja_ausente' }
  return { ok: false, msg: 'erro_api resposta_invalida' }
}
