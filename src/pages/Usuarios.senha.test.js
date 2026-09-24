import { describe, it, expect } from 'vitest'
import { gerarSenha, senhaValida } from './Usuarios.jsx'

// A senha que a tela SUGERE ao redefinir a de um membro tem de passar na regra que o servidor
// aplica desde a migration 77 (8 caracteres, com letras e números). Antes, ~1 em 10 saía só com
// letras — e a própria sugestão da tela seria recusada.
describe('senha sugerida ao redefinir a de um membro', () => {
  it('2000 sugestões seguidas: todas passam na regra do servidor', () => {
    const invalidas = Array.from({ length: 2000 }, gerarSenha).filter((s) => !senhaValida(s))
    expect(invalidas).toEqual([])
  })

  it('a regra da tela é a do servidor: 8, com letras e números', () => {
    expect(senhaValida('123456')).toBe(false)
    expect(senhaValida('abcdefgh')).toBe(false)
    expect(senhaValida('12345678')).toBe(false)
    expect(senhaValida('abcd1234')).toBe(true)
  })
})
