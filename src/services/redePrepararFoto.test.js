import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: vi.fn(), storage: { from: vi.fn() } } }))

import { prepararFoto } from './rede.js'

describe('prepararFoto (Rede) usa MIME real', () => {
  it('recusa SVG com nome e type de JPEG', async () => {
    const f = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'foto.jpg', { type: 'image/jpeg' })
    await expect(prepararFoto(f)).rejects.toThrow(/foto válida/)
  })
  it('recusa GIF mesmo declarado como image/jpeg', async () => {
    const f = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0])], 'a.jpg', { type: 'image/jpeg' })
    await expect(prepararFoto(f)).rejects.toThrow(/foto válida/)
  })
})
