// Fase 6: duas recusas do servidor com instrução útil não podem cair no texto genérico.
import { describe, it, expect } from 'vitest'
import { mensagemDeErro } from './index.jsx'

describe('mensagemDeErro — recusas com instrução', () => {
  it('leilão aberto: diz o que fazer, sem o texto cru', () => {
    const t = mensagemDeErro(new Error('Há leilão aberto: encerre ou cancele antes de desligar o leilão.'), 'Não consegui salvar.')
    expect(t).toMatch(/Encerre ou cancele o leilão/)
    expect(t).toMatch(/^Não consegui salvar\./)
  })
  it('onboarding: diz que falta uma etapa, sem vazar as chaves internas', () => {
    const t = mensagemDeErro(new Error('Termine a etapa "conta" antes de ir para "clube".'))
    expect(t).toBe('Ainda falta concluir a etapa anterior. Termine ela e continue.')
  })
  it('erro técnico continua virando o genérico', () => {
    expect(mensagemDeErro(new Error('relation "public.x" does not exist'))).not.toMatch(/relation/)
  })
})
