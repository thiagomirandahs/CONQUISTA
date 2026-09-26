import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Contrato de segurança das Edge Functions de PDF (Deno; não rodam no vitest) — auditoria 26/09.
const ler = (f) => readFileSync(join(process.cwd(), 'supabase', 'functions', f, 'index.ts'), 'utf8')

for (const f of ['gerar-documento-pdf', 'gerar-documento-pdf-final']) {
  describe(`Edge Function ${f}: segurança`, () => {
    const fonte = ler(f)
    it('CORS por lista de origens, nunca "*"', () => {
      expect(fonte).not.toMatch(/Access-Control-Allow-Origin':\s*'\*'/)
      expect(fonte).toMatch(/ORIGENS\.has\(origem\)/)
    })
    it('URL de verificação do PDF/QR vem de base fixa, nunca do cabeçalho Origin', () => {
      expect(fonte).not.toMatch(/headers\.get\('origin'\)\s*\?\?/)
      expect(fonte).toMatch(/URL_VERIFICACAO/)
    })
    it('token do documento validado por formato e tamanho', () => {
      expect(fonte).toMatch(/TOKEN_OK\.test\(token\)/)
    })
    it('exceção e erro de Storage não voltam ao cliente', () => {
      expect(fonte).not.toMatch(/e instanceof Error \? e\.message : String\(e\)\}`/)
      expect(fonte).not.toMatch(/erroUpload\.message\}/)
    })
  })
}

describe('config.toml: verify_jwt explícito por função', () => {
  const cfg = readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8')
  it('PDF exige JWT; enviar-push usa segredo próprio', () => {
    expect(cfg).toMatch(/\[functions\.gerar-documento-pdf\]\s*\r?\nverify_jwt = true/)
    expect(cfg).toMatch(/\[functions\.gerar-documento-pdf-final\]\s*\r?\nverify_jwt = true/)
    expect(cfg).toMatch(/\[functions\.enviar-push\]\s*\r?\nverify_jwt = false/)
  })
})
