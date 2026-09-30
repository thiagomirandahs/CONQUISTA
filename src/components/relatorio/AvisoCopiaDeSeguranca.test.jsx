import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AvisoCopiaDeSeguranca from './AvisoCopiaDeSeguranca.jsx'
import { gravarLocal, lerLocal, lerBackup } from '../../lib/relatorio/rascunhoLocal.js'

const K = 'cq.rel.u1.classe.r1'
beforeEach(() => localStorage.clear())

describe('AvisoCopiaDeSeguranca', () => {
  it('requisito já enviado/aprovado com texto pendente: avisa e guarda cópia de segurança', () => {
    gravarLocal(K, { conteudo: { resumo: 'meu texto' }, base: 'b' })
    render(<AvisoCopiaDeSeguranca chaveLocal={K} />)
    expect(screen.getByTestId('aviso-copia-seguranca')).toHaveTextContent('Este requisito já foi enviado/aprovado; guardamos uma cópia do seu texto neste aparelho')
    expect(lerLocal(K)).toBeNull()
    expect(lerBackup(K).conteudo).toEqual({ resumo: 'meu texto' })
  })
  it('sem rascunho pendente: não mostra nada', () => {
    const { container } = render(<AvisoCopiaDeSeguranca chaveLocal={K} />)
    expect(container).toBeEmptyDOMElement()
  })
})
