import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Templates de e-mail do Supabase Auth (aplicados em produção por scripts/auth/aplicar-auth-producao.mjs, SÓ depois do SMTP próprio):
// em português, com a marca DesbravaClube, com o link do Supabase ({{ .ConfirmationURL }}) e sem localhost/marca antiga.
const DIR = join(process.cwd(), 'supabase', 'auth-templates')
const html = readdirSync(DIR).filter((n) => n.endsWith('.html'))

describe('templates de e-mail do Auth', () => {
  it('existem os cinco usados pelo app', () => {
    expect(html.sort()).toEqual(['confirmacao.html', 'convite.html', 'recuperacao.html', 'senha-alterada.html', 'troca-email.html'])
  })
  for (const n of ['confirmacao.html', 'convite.html', 'recuperacao.html', 'troca-email.html']) {
    it(`${n}: botão com {{ .ConfirmationURL }} e o endereço por extenso`, () => {
      const t = readFileSync(join(DIR, n), 'utf8')
      expect((t.match(/\{\{ \.ConfirmationURL \}\}/g) || []).length).toBeGreaterThanOrEqual(2)
    })
  }
  it('todos em português, com a marca atual e sem localhost/127.0.0.1/capacitor/marca antiga', () => {
    for (const n of html) {
      const t = readFileSync(join(DIR, n), 'utf8')
      expect(t, n).toContain('DesbravaClube')
      expect(t, n).not.toMatch(/localhost|127\.0\.0\.1|capacitor:|ionic:|file:/i)
      expect(t, n).not.toMatch(/Conquista/)
      expect(t, n).not.toMatch(/Confirm your|Reset your|Follow the link|You've been|Your password/)
      expect(t, n).toMatch(/você|Você|sua |Sua |seu |e-mail/i)
    }
  })
  it('os assuntos estão em português com a marca', () => {
    const a = JSON.parse(readFileSync(join(DIR, 'assuntos.json'), 'utf8'))
    expect(Object.keys(a)).toEqual(expect.arrayContaining(['mailer_subjects_confirmation', 'mailer_subjects_recovery']))
    for (const v of Object.values(a)) expect(v).toMatch(/DesbravaClube$/)
  })
})
