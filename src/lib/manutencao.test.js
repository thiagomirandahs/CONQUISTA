import { describe, it, expect, beforeEach } from 'vitest'
import { normalizarEstado, deveMostrarTela, textoDaFaixa, ehErroDeManutencao, rotaLivreNaManutencao } from './manutencao.js'
import { lerRascunho, salvarRascunho, limparRascunho, limparRascunhosVencidos, PREFIXO_RASCUNHO, VALIDADE_RASCUNHO_MS } from './rascunhos.js'
import { mensagemDeErro } from '../ui/index.jsx'
import { enviarFila, enfileirar, itensDaFila, deveGuardar } from '../services/filaJogos.js'

const AGORA = new Date('2026-09-28T20:00:00Z') // 17h em São Paulo

describe('modo manutenção — regras puras', () => {
  it('normaliza o JSON do servidor; lixo/null = normal', () => {
    expect(normalizarEstado(null)).toMatchObject({ ativo: false, souAdmin: false })
    const e = normalizarEstado({ ativo: true, mensagem: 'x', aviso_inicio: null, sou_admin: true })
    expect(e).toMatchObject({ ativo: true, mensagem: 'x', souAdmin: true, avisoInicio: null })
    expect(normalizarEstado({ ativo: 'true' }).ativo).toBe(false) // só booleano de verdade liga
  })

  it('tela só com manutenção ligada, para quem não é admin, fora do login', () => {
    expect(deveMostrarTela(normalizarEstado({ ativo: true }), '/inicio')).toBe(true)
    expect(deveMostrarTela(normalizarEstado({ ativo: true, sou_admin: true }), '/inicio')).toBe(false)
    expect(deveMostrarTela(normalizarEstado({ ativo: true }), '/login')).toBe(false)
    expect(deveMostrarTela(normalizarEstado({ ativo: false }), '/inicio')).toBe(false)
    expect(deveMostrarTela(null, '/inicio')).toBe(false)
    expect(rotaLivreNaManutencao('/verificar/abc')).toBe(true)
    expect(rotaLivreNaManutencao('/admin')).toBe(false)
  })

  it('faixa: horário em São Paulo; some 2h depois do horário', () => {
    const e = normalizarEstado({ aviso_inicio: '2026-09-28T21:30:00Z', aviso_mensagem: 'Atualização das Classes.' })
    expect(textoDaFaixa(e, AGORA)).toBe('O app vai entrar em manutenção às 18:30. Termine o que está fazendo. Atualização das Classes.')
    expect(textoDaFaixa(e, new Date('2026-09-28T22:00:00Z'))).toMatch(/a qualquer momento/)
    expect(textoDaFaixa(e, new Date('2026-09-29T00:00:00Z'))).toBeNull()
    expect(textoDaFaixa(normalizarEstado({ ativo: true }), AGORA)).toBeNull()
  })

  it('reconhece o erro do servidor e traduz para a pessoa', () => {
    const erro = new Error('MANUTENCAO: o DesbravaClube está em manutenção. Nada foi alterado; tente de novo em instantes.')
    expect(ehErroDeManutencao(erro)).toBe(true)
    expect(ehErroDeManutencao(new Error('Sem permissão'))).toBe(false)
    expect(mensagemDeErro(erro)).toMatch(/Nada foi perdido/)
  })
})

describe('rascunhos locais', () => {
  beforeEach(() => localStorage.clear())

  it('guarda por usuário: o irmão no mesmo celular não vê', () => {
    salvarRascunho('A', 'req:1', 'minha resposta')
    expect(lerRascunho('A', 'req:1')).toBe('minha resposta')
    expect(lerRascunho('B', 'req:1')).toBeNull()
  })

  it('texto vazio apaga; limpar apaga; vencido some', () => {
    salvarRascunho('A', 'x', 'oi'); salvarRascunho('A', 'x', '   ')
    expect(lerRascunho('A', 'x')).toBeNull()
    salvarRascunho('A', 'y', 'oi'); limparRascunho('A', 'y')
    expect(lerRascunho('A', 'y')).toBeNull()
    salvarRascunho('A', 'z', 'velho', 0)
    limparRascunhosVencidos(VALIDADE_RASCUNHO_MS + 1)
    expect(localStorage.getItem(`${PREFIXO_RASCUNHO}A:z`)).toBeNull()
  })

  it('sem uid não guarda (nunca rascunho "de ninguém")', () => {
    expect(salvarRascunho(null, 'x', 'oi')).toBe(false)
  })
})

describe('fila de jogos durante a manutenção', () => {
  beforeEach(() => localStorage.clear())
  const MANUT = () => new Error('MANUTENCAO: o DesbravaClube está em manutenção.')

  it('erro de manutenção GUARDA (como rede), não descarta', async () => {
    expect(deveGuardar(MANUT())).toBe(true)
    expect(deveGuardar(new Error('Rápido demais'))).toBe(false)
    const agora = new Date('2026-09-23T15:00:00Z')
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'reflexo', valor: 50 }, agora)
    const r = await enviarFila({ uid: 'A', clube: 'C', enviar: () => Promise.reject(MANUT()), agora })
    expect(r).toMatchObject({ enviados: 0, descartados: 0, restantes: 1 })
    expect(itensDaFila('A', 'C')).toHaveLength(1)
  })
})
