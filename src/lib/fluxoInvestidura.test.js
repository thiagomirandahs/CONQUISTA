import { describe, it, expect } from 'vitest'
import { rotuloDaEtapa, etapaAtual, linhaDoHistorico, situacaoDaEtapa } from './fluxoInvestidura.js'

const ETAPAS = [
  { ordem: 1, chave: 'revisao_clube', escopo_tipo: 'clube', nome: 'Revisão do clube', decisao: { decisao: 'aprovado' } },
  { ordem: 2, chave: 'aprovacao_intermediaria', escopo_tipo: 'distrito', nome: 'Aprovação do distrito', decisao: null },
  { ordem: 3, chave: 'aprovacao_intermediaria', escopo_tipo: 'regiao', nome: 'Aprovação da região', decisao: null },
  { ordem: 4, chave: 'investidura', escopo_tipo: 'clube', nome: 'Investidura', decisao: null },
]

describe('fluxo do cartão de classe', () => {
  it('rótulos da etapa atual', () => {
    expect(rotuloDaEtapa(ETAPAS[0])).toBe('Aguardando revisão do clube')
    expect(rotuloDaEtapa(ETAPAS[1])).toBe('Aguardando distrito')
    expect(rotuloDaEtapa(ETAPAS[2])).toBe('Aguardando região')
    expect(rotuloDaEtapa(ETAPAS[3])).toBe('Apto à investidura')
    expect(rotuloDaEtapa(null)).toBeNull()
  })

  it('etapa atual só enquanto a corrida anda', () => {
    expect(etapaAtual({ etapa_atual_ordem: 2, etapas: ETAPAS }).escopo_tipo).toBe('distrito')
    expect(etapaAtual({ etapa_atual_ordem: null, etapas: ETAPAS })).toBeNull()
  })

  it('situação de cada etapa (aprovada, pulada, devolvida, atual, futura)', () => {
    const linha = { etapa_atual_ordem: 2, etapas: ETAPAS }
    expect(ETAPAS.map((e) => situacaoDaEtapa(e, linha))).toEqual(['aprovada', 'atual', 'futura', 'futura'])
    expect(situacaoDaEtapa({ ...ETAPAS[1], decisao: { decisao: 'pulada_nivel_ausente' } }, linha)).toBe('pulada')
    expect(situacaoDaEtapa({ ...ETAPAS[2], decisao: { decisao: 'correcao_solicitada' } }, linha)).toBe('devolvida')
  })

  it('converte a corrida do histórico (decisor/escopo aninhados)', () => {
    const l = linhaDoHistorico({ status: 'em_andamento', etapa_atual_ordem: 3, etapas: [
      { ordem: 2, chave: 'aprovacao_intermediaria', escopo_tipo: 'distrito', nome: 'Aprovação do distrito',
        decisao: { decisao: 'aprovado', decidido_em: '2026-09-26T10:00:00Z', decisor: { nome: 'Ana' }, escopo: { nome: 'Distrito Sul' } } },
    ] })
    expect(l.etapas[0].decisao.decisor_nome).toBe('Ana')
    expect(l.etapas[0].decisao.escopo_nome).toBe('Distrito Sul')
    expect(l.etapa_atual_ordem).toBe(3)
  })
})
