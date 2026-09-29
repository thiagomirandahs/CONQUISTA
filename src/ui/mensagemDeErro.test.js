// Fase 6: duas recusas do servidor com instrução útil não podem cair no texto genérico.
import { describe, it, expect } from 'vitest'
import { mensagemDeErro } from './index.jsx'

describe('mensagemDeErro — recusas com instrução', () => {
  it('leilão aberto: diz o que fazer, sem o texto cru', () => {
    const t = mensagemDeErro(new Error('Há leilão aberto: encerre ou cancele antes de desligar o leilão.'), 'Não consegui salvar.')
    expect(t).toMatch(/Encerre ou cancele o leilão/)
    expect(t).toMatch(/^Não consegui salvar\./)
  })
  it('onboarding: preserva a etapa que falta', () => {
    const t = mensagemDeErro(new Error('Termine a etapa Unidades antes de ir para Convites.'))
    expect(t).toBe('Ainda falta uma etapa: Termine a etapa Unidades antes de ir para Convites.')
  })
  it('erro técnico continua virando o genérico', () => {
    expect(mensagemDeErro(new Error('relation "public.x" does not exist'))).not.toMatch(/relation/)
  })
})
