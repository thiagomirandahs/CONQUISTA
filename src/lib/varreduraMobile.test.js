// Contrato de padronização mobile (Fase 9): trava regressões que a varredura estática consegue enxergar.
// Relatório completo: `node scripts/varredura-mobile.mjs` (ver PADRONIZACAO-MOBILE-FASE9.md).
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inputsDeArquivoCrus, alvosPequenos, botoesGradienteAvulsos, listarFontes } from '../../scripts/lib/varreduraMobile.mjs'

const fontes = listarFontes('src')

describe('varredura mobile (contrato)', () => {
  it('acha as fontes do app', () => {
    expect(fontes.length).toBeGreaterThan(100)
  })

  it('nenhum <input type="file"> cru ou display:none: use ZonaUpload (caixa) ou BotaoUpload (botão)', () => {
    expect(inputsDeArquivoCrus(fontes)).toEqual([])
  })

  it('nenhum alvo clicável com altura declarada < 44px', () => {
    expect(alvosPequenos(fontes)).toEqual([])
  })

  it('sanidade: o detector pega um botão de 32px e um input de arquivo escondido', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varredura-'))
    const ruim = join(dir, 'Ruim.jsx')
    writeFileSync(ruim, ['<button onClick={x} className="h-8 w-8">x</button>', '<input type="file" className="hidden" />', ''].join('\n'))
    try {
      expect(alvosPequenos([ruim])).toHaveLength(1)
      expect(inputsDeArquivoCrus([ruim])).toHaveLength(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('botão primário à mão (gradiente brand→brand2) não cresce além do que existe hoje (orçamento)', () => {
    // Dívida conhecida: 98 usos escritos à mão em vez de <Botao>. Não pode AUMENTAR; ao migrar, baixe o número.
    // Unificar a cor do primário (decisão de identidade, ver PADRONIZACAO-MOBILE-FASE9.md) passa pelos tokens.
    expect(botoesGradienteAvulsos(fontes).length).toBeLessThanOrEqual(98)
  })
})
