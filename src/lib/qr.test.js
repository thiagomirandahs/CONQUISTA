import { describe, it, expect } from 'vitest'
import { qrSvg } from './qr.js'

describe('qrSvg', () => {
  it('gera um SVG com viewBox e um path preto (matriz do QR)', () => {
    const svg = qrSvg('https://x.test/verificar/ABCDEFGH')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
    expect(svg).toContain('fill="#000000"')
    expect(svg).toMatch(/<path d="M\d/)
    expect(svg).toContain('aria-label="QR code de verificação"')
  })
  it('é determinístico e muda conforme o conteúdo', () => {
    const a1 = qrSvg('https://x.test/verificar/AAAA')
    const a2 = qrSvg('https://x.test/verificar/AAAA')
    const b = qrSvg('https://x.test/verificar/BBBB')
    expect(a1).toBe(a2)
    expect(a1).not.toBe(b)
  })
})
