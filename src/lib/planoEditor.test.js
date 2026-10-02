import { describe, it, expect } from 'vitest'
import { reaisParaCentavos, centavosParaCampo, parcelaCentavos, formDoPlano, argsDoForm, chaveDoNome } from './planoEditor.js'

describe('dinheiro em texto <-> centavos (sem ponto flutuante)', () => {
  it('formatos brasileiros e simples', () => {
    expect(reaisParaCentavos('229,90')).toBe(22990)
    expect(reaisParaCentavos('229.90')).toBe(22990)
    expect(reaisParaCentavos('R$ 1.299,90')).toBe(129990)
    expect(reaisParaCentavos('1.299')).toBe(129900)     // dois ou mais pontos = milhar
    expect(reaisParaCentavos('230')).toBe(23000)
    expect(reaisParaCentavos('0,05')).toBe(5)
    expect(reaisParaCentavos('19,9')).toBe(1990)
    expect(reaisParaCentavos('0,1')).toBe(10)
  })
  it('vazio é null; lixo é NaN; negativo e 3 casas são recusados', () => {
    expect(reaisParaCentavos('')).toBeNull()
    expect(reaisParaCentavos('  ')).toBeNull()
    for (const x of ['abc', '-5', '1,234', '12,3,4', '1e3']) expect(reaisParaCentavos(x), x).toBeNaN()
  })
  it('centavos para o campo e parcela arredondada para cima', () => {
    expect(centavosParaCampo(22990)).toBe('229,90')
    expect(centavosParaCampo(5)).toBe('0,05')
    expect(centavosParaCampo(null)).toBe('')
    expect(parcelaCentavos(22990, 12)).toBe(1916)   // 1915,83 -> 1916 (nunca cobra a menos)
    expect(parcelaCentavos(100, 3)).toBe(34)
    expect(parcelaCentavos(100, 0)).toBeNull()
  })
})

describe('formulário', () => {
  const PLANO = { chave: 'anual', nome: 'Licença Anual', descricao: 'Tudo', publico: true, limites: { membros: 300, clubes: 3 },
    precos: [{ ciclo: 'anual', valor_centavos: 22990, ativo: true, metadata: { pix_centavos: 19990, parcelas_cartao: 12, parcela_centavos: 1916 } }] }
  it('plano publicado vira formulário e volta para os mesmos argumentos', () => {
    const f = formDoPlano(PLANO)
    expect(f.ciclos.anual).toEqual({ oferecer: true, valor: '229,90', pix: '199,90', parcelas: '12' })
    expect(f.ciclos.mensal.oferecer).toBe(false)
    expect(f.limites.membros).toBe('300'); expect(f.limites.fotos).toBe('')
    const { args, erro } = argsDoForm(f)
    expect(erro).toBeUndefined()
    expect(args.precos).toEqual([{ ciclo: 'anual', valor_centavos: 22990, pix_centavos: 19990, parcelas_cartao: 12, parcela_centavos: 1916 }])
    expect(args.limites).toEqual({ membros: 300, administradores: null, clubes: 3, fotos: null, armazenamento_mb: null })
    expect(args.chave).toBe('anual')
  })
  it('erros em português: nome curto, valor faltando, Pix maior, parcelas fora, limite não inteiro', () => {
    const base = () => formDoPlano(PLANO)
    expect(argsDoForm({ ...base(), nome: 'ab' }).erro).toMatch(/nome/i)
    const f1 = base(); f1.ciclos.anual.valor = ''
    expect(argsDoForm(f1).erro).toMatch(/valor anual/)
    const f2 = base(); f2.ciclos.anual.pix = '300,00'
    expect(argsDoForm(f2).erro).toMatch(/Pix/)
    const f3 = base(); f3.ciclos.anual.parcelas = '13'
    expect(argsDoForm(f3).erro).toMatch(/1 a 12/)
    const f4 = base(); f4.limites.membros = '1,5'
    expect(argsDoForm(f4).erro).toMatch(/inteiro/)
  })
  it('sem nenhum ciclo oferecido é permitido (plano sem preço, só interno) e a chave nova sai do nome', () => {
    const f = formDoPlano(null)
    f.nome = 'Plano Básico 2027'; f.chave = chaveDoNome(f.nome)
    const r = argsDoForm(f)
    expect(r.args.precos).toEqual([])
    expect(r.args.chave).toBe('plano-basico-2027')
    expect(chaveDoNome('Licença São João!')).toBe('licenca-sao-joao')
  })
})
