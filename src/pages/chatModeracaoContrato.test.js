import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// O texto original de mensagem apagada só é entregue pela VIEW (a tabela guarda só o marcador; migration 29).
// Estes testes travam o front para ninguém voltar a ler `chat_mensagens` direto e mostrar o marcador como se fosse o texto.
const ler = (...p) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8')

describe('chat: o texto de mensagem moderada vem só da view', () => {
  it('a tela de moderação lê chat_mensagens_visiveis (não a tabela)', () => {
    const f = ler('pages', 'ChatModeracao.jsx')
    expect(f).toMatch(/from\('chat_mensagens_visiveis'\)/)
    expect(f).not.toMatch(/from\('chat_mensagens'\)/)
  })

  it('o chat dos membros também lê a view', () => {
    const f = ler('services', 'chat.js')
    expect(f).toMatch(/from\('chat_mensagens_visiveis'\)/)
    expect(f).not.toMatch(/from\('chat_mensagens'\)\s*\.select/)
  })
})
