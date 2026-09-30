import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ConflitoRascunho from './ConflitoRascunho.jsx'
import FormularioRelatorio from './FormularioRelatorio.jsx'
import { lerLocal, lerBackup, gravarLocal, hashRascunho } from '../../lib/relatorio/rascunhoLocal.js'

vi.mock('../Comprovacao.jsx', () => ({ default: () => null }))

// hoje às h:m (horário local) — o "hoje HH:MM" do aviso é relativo ao relógio real
const hoje = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime() }

describe('ConflitoRascunho (apresentação)', () => {
  it('mostra as duas versões com horário e prévia, e as duas escolhas', () => {
    const escolher = vi.fn()
    render(<ConflitoRascunho aoEscolher={escolher} conflito={{
      local: { conteudo: { resumo: 'texto do aparelho' }, anexos: [], em: hoje(14, 32) },
      servidor: { conteudo: { resumo: 'texto da nuvem' }, anexos: [], em: null },
    }} />)
    expect(screen.getByText(/Encontramos duas versões deste relatório\./)).toBeInTheDocument()
    expect(screen.getByTestId('versao-aparelho-horario')).toHaveTextContent('hoje 14:32')
    expect(screen.getByTestId('versao-aparelho-previa')).toHaveTextContent('texto do aparelho')
    expect(screen.getByTestId('versao-nuvem-horario')).toHaveTextContent('horário indisponível')
    expect(screen.getByTestId('versao-nuvem-previa')).toHaveTextContent('texto da nuvem')
    expect(screen.getByText('Versão deste aparelho')).toBeInTheDocument()
    expect(screen.getByText('Versão salva na nuvem')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Usar deste aparelho' }))
    fireEvent.click(screen.getByRole('button', { name: 'Usar da nuvem' }))
    expect(escolher.mock.calls).toEqual([['local'], ['servidor']])
  })
})

describe('conflito com horários dentro do formulário', () => {
  const SCHEMA = { versao: 1, campos: [{ chave: 'resumo', tipo: 'texto_longo', rotulo: 'Conte o que fez' }] }
  const K = 'cq.rel.u1.classe.rh'
  beforeEach(() => localStorage.clear())
  const montar = (rascunhoEm, salvar = vi.fn().mockResolvedValue()) => {
    gravarLocal(K, { conteudo: { resumo: 'do aparelho' }, base: hashRascunho({}, []), sincronizado: false }, hoje(10, 5))
    render(<FormularioRelatorio schema={SCHEMA} chaveLocal={K} onSalvarRascunho={salvar} onEnviar={vi.fn()}
      valorInicial={{ conteudo: { resumo: 'da nuvem' }, anexos: [], rascunhoEm }} />)
    return salvar
  }

  it('o horário do aparelho (editadoEm) e o da nuvem (rascunho_em) aparecem, com as prévias', () => {
    montar(new Date(hoje(9, 0) - 86400000 * 3).toISOString())
    const c = screen.getByTestId('conflito-rascunho')
    expect(within(c).getByTestId('versao-aparelho-horario')).toHaveTextContent('hoje 10:05')
    expect(within(c).getByTestId('versao-aparelho-previa')).toHaveTextContent('do aparelho')
    expect(within(c).getByTestId('versao-nuvem-horario')).toHaveTextContent(/^\d{2}\/\d{2} 09:00$/)
    expect(within(c).getByTestId('versao-nuvem-previa')).toHaveTextContent('da nuvem')
  })

  it('rascunho antigo do servidor, sem horário: "horário indisponível"', () => {
    montar(null)
    expect(screen.getByTestId('versao-nuvem-horario')).toHaveTextContent('horário indisponível')
  })

  it('enquanto o conflito não é resolvido: não envia, não sincroniza e nada é sobrescrito', () => {
    const salvar = montar('2026-09-01T10:00:00Z')
    expect(screen.getByTestId('botao-enviar-relatorio')).toBeDisabled()
    expect(salvar).not.toHaveBeenCalled()
    expect(lerLocal(K).conteudo).toEqual({ resumo: 'do aparelho' })
  })

  it('"Usar da nuvem": aplica a nuvem e guarda a do aparelho como cópia de segurança', () => {
    montar('2026-09-01T10:00:00Z')
    fireEvent.click(screen.getByRole('button', { name: 'Usar da nuvem' }))
    expect(screen.getByLabelText(/Conte o que fez/)).toHaveValue('da nuvem')
    expect(lerBackup(K).conteudo).toEqual({ resumo: 'do aparelho' })
    expect(screen.queryByTestId('conflito-rascunho')).toBeNull()
  })

  it('"Usar deste aparelho": mantém o do aparelho e guarda o da nuvem como cópia de segurança', () => {
    montar('2026-09-01T10:00:00Z')
    fireEvent.click(screen.getByRole('button', { name: 'Usar deste aparelho' }))
    expect(screen.getByLabelText(/Conte o que fez/)).toHaveValue('do aparelho')
    expect(lerBackup(K).conteudo).toEqual({ resumo: 'da nuvem' })
  })
})
