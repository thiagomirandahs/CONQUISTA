import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusRequisito, { STATUS } from './StatusRequisito.jsx'
import BarraProgresso from './BarraProgresso.jsx'

describe('StatusRequisito', () => {
  const ESPERADO = {
    nao_iniciado: ['○', 'Não iniciado'], rascunho: ['✎', 'Rascunho'], enviado: ['↑', 'Enviado'], aguardando: ['⏳', 'Aguardando avaliação'],
    correcao: ['⚠', 'Correção solicitada'], aprovado: ['✓', 'Aprovado'], bloqueado: ['🔒', 'Bloqueado'],
  }
  it('os 7 estados têm ícone E texto', () => {
    expect(Object.keys(STATUS).sort()).toEqual(Object.keys(ESPERADO).sort())
    for (const [status, [icone, texto]] of Object.entries(ESPERADO)) {
      const { container, unmount } = render(<StatusRequisito status={status} />)
      expect(screen.getByText(texto)).toBeVisible()
      expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent(icone)
      expect(container.firstChild).toHaveAttribute('data-status', status)
      unmount()
    }
  })
  it('rótulo alternativo mantém o ícone do status; compacto mantém o texto para leitor de tela', () => {
    const { container } = render(<StatusRequisito status="nao_iniciado" rotulo="Cumprido pelo seu histórico" />)
    expect(screen.getByText('Cumprido pelo seu histórico')).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('○')
    const c2 = render(<StatusRequisito status="aprovado" compacto />)
    expect(c2.getByText('Aprovado')).toHaveClass('sr-only')
  })
  it('status desconhecido cai em "Não iniciado"', () => {
    render(<StatusRequisito status="xpto" />)
    expect(screen.getByText('Não iniciado')).toBeInTheDocument()
  })
})

describe('BarraProgresso', () => {
  it('role="progressbar" com aria-valuenow/min/max e nome', () => {
    render(<BarraProgresso valor={78} rotulo="Progresso na classe" mostrarRotulo />)
    const b = screen.getByRole('progressbar', { name: 'Progresso na classe' })
    expect(b).toHaveAttribute('aria-valuenow', '78')
    expect(b).toHaveAttribute('aria-valuemin', '0')
    expect(b).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByText('78%')).toBeInTheDocument() // também em texto
  })
  it('feitos/total e limites 0–100', () => {
    const { rerender } = render(<BarraProgresso feitos={8} total={10} rotulo="Seção" texto="8/10" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByText('8/10')).toBeInTheDocument()
    rerender(<BarraProgresso valor={150} rotulo="Seção" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    rerender(<BarraProgresso feitos={0} total={0} rotulo="Seção" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })
})
