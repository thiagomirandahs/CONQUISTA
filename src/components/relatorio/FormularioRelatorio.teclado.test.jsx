// Teclado do celular (fase 7): maiúscula no começo de frase, sem preenchimento automático, teclado numérico, campos ≥ 16 px.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import FormularioRelatorio from './FormularioRelatorio.jsx'

const schema = { versao: 1, campos: [
  { chave: 'curto', tipo: 'texto_curto', rotulo: 'Curto' }, { chave: 'longo', tipo: 'texto_longo', rotulo: 'Longo' },
  { chave: 'n', tipo: 'numero', rotulo: 'Quantidade', inteiro: true }, { chave: 'q', tipo: 'numero', rotulo: 'Distância' },
  { chave: 'd', tipo: 'data', rotulo: 'Data' },
  { chave: 'l', tipo: 'lista', rotulo: 'Lista', min: 2, max: 3, rotulo_item: 'Item', tipo_item: 'texto_curto' },
] }

describe('teclado do celular', () => {
  it('texto: maiúscula na frase, sem autocompletar, tecla certa; número: teclado numérico/decimal; data nativa', () => {
    const { container } = render(<FormularioRelatorio schema={schema} valorInicial={{ conteudo: {}, anexos: [] }} onSalvarRascunho={async () => {}} onEnviar={async () => {}} />)
    const curto = container.querySelector('input[type=text]')
    const longo = container.querySelector('textarea')
    expect(curto).toHaveAttribute('autocapitalize', 'sentences'); expect(curto).toHaveAttribute('autocomplete', 'off'); expect(curto).toHaveAttribute('enterkeyhint', 'next')
    expect(longo).toHaveAttribute('autocapitalize', 'sentences'); expect(longo).toHaveAttribute('enterkeyhint', 'enter')
    const nums = [...container.querySelectorAll('input[type=number]')]
    expect(nums.map((n) => n.getAttribute('inputmode'))).toEqual(['numeric', 'decimal'])
    expect(container.querySelector('input[type=date]')).toBeTruthy()
  })
  it('itens de lista também seguem a regra (são digitados no celular)', () => {
    const { container } = render(<FormularioRelatorio schema={schema} valorInicial={{ conteudo: { l: ['a', 'b'] }, anexos: [] }} onSalvarRascunho={async () => {}} onEnviar={async () => {}} />)
    const itens = [...container.querySelectorAll('input[type=text]')].filter((i) => /Item/.test(i.getAttribute('placeholder') || ''))
    expect(itens.length).toBeGreaterThanOrEqual(2)
    itens.forEach((i) => { expect(i).toHaveAttribute('autocapitalize', 'sentences'); expect(i).toHaveAttribute('enterkeyhint', 'next') })
  })
  it('todos os campos usam a classe de 16 px (text-base) — iOS não dá zoom ao focar', () => {
    const { container } = render(<FormularioRelatorio schema={schema} valorInicial={{ conteudo: {}, anexos: [] }} onSalvarRascunho={async () => {}} onEnviar={async () => {}} />)
    const campos = [...container.querySelectorAll('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea')]
    expect(campos.length).toBeGreaterThan(4)
    campos.forEach((c) => expect(c.className).toMatch(/text-base/))
  })
})
