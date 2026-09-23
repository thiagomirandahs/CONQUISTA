// Toast e confirmação (fase 7.1): o que substituiu 74 `alert()`/`confirm()` nativos.
// O que estes testes travam: a SEMÂNTICA (cada categoria vira o componente certo), o fato de o
// texto cru do servidor nunca chegar à tela, e o comportamento de falha fechada sem provider.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { AvisosProvider, useAvisos, avisar } from './avisos.jsx'

function Tela() {
  const { sucesso, info, erro, confirmar } = useAvisos()
  return (
    <div>
      <button onClick={() => sucesso('Salvo!')}>ok</button>
      <button onClick={() => info('Só um recado')}>recado</button>
      <button onClick={() => erro(new Error('PGRST204: column "club_id" does not exist'), 'Não consegui salvar a atividade.')}>falhar</button>
      <button onClick={async () => { const r = await confirmar({ titulo: 'Apagar a foto?', descricao: 'Não dá pra desfazer.', rotulo: 'Apagar a foto' }); document.title = r ? 'sim' : 'nao' }}>apagar</button>
    </div>
  )
}
const renderT = () => render(<AvisosProvider><Tela /></AvisosProvider>)

beforeEach(() => { document.title = '' })

describe('toast', () => {
  it('sucesso é anunciado como status (não rouba o foco)', async () => {
    renderT()
    fireEvent.click(screen.getByText('ok'))
    const t = await screen.findByText('Salvo!')
    expect(t.closest('[role="status"]')).toBeTruthy()
  })

  it('erro é anunciado como alert e diz o que houve E o que fazer', async () => {
    renderT()
    fireEvent.click(screen.getByText('falhar'))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não consegui salvar a atividade.')
    expect(alerta).toHaveTextContent(/Tente de novo|nada do que você fez foi perdido/)
  })

  it('o texto CRU do servidor nunca chega à tela', async () => {
    renderT()
    fireEvent.click(screen.getByText('falhar'))
    await screen.findByRole('alert')
    expect(document.body.textContent).not.toMatch(/PGRST|club_id|does not exist/)
  })

  it('sucesso some sozinho; erro NÃO some (a pessoa precisa ler e agir)', async () => {
    vi.useFakeTimers()
    try {
      render(<AvisosProvider><Tela /></AvisosProvider>)
      fireEvent.click(screen.getByText('ok'))
      fireEvent.click(screen.getByText('falhar'))
      expect(screen.getByText('Salvo!')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(4000) })
      expect(screen.queryByText('Salvo!')).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })

  it('dá pra fechar no botão, com nome acessível', async () => {
    renderT()
    fireEvent.click(screen.getByText('recado'))
    await screen.findByText('Só um recado')
    fireEvent.click(screen.getAllByRole('button', { name: 'Fechar aviso' })[0])
    expect(screen.queryByText('Só um recado')).not.toBeInTheDocument()
  })
})

describe('confirmação', () => {
  it('abre um diálogo com o rótulo da AÇÃO no botão — nunca "OK"', async () => {
    renderT()
    fireEvent.click(screen.getByText('apagar'))
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent('Apagar a foto?')
    expect(dialogo).toHaveTextContent('Não dá pra desfazer.')
    expect(screen.getByRole('button', { name: 'Apagar a foto' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument()
  })

  it('confirmar devolve true; cancelar devolve false', async () => {
    renderT()
    fireEvent.click(screen.getByText('apagar'))
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar a foto' }))
    await waitFor(() => expect(document.title).toBe('sim'))

    fireEvent.click(screen.getByText('apagar'))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(document.title).toBe('nao'))
  })

  it('Esc cancela (não confirma por engano)', async () => {
    renderT()
    fireEvent.click(screen.getByText('apagar'))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.title).toBe('nao'))
  })
})

describe('ponte imperativa (usada pelas telas legadas)', () => {
  it('sem provider montado, confirmar responde FALSE — falha fechada numa ação destrutiva', async () => {
    await expect(avisar.confirmar({ titulo: 'x' })).resolves.toBe(false)
  })

  it('com o provider montado, a ponte mostra o toast', async () => {
    renderT()
    act(() => { avisar.sucesso('veio pela ponte') })
    expect(await screen.findByText('veio pela ponte')).toBeInTheDocument()
  })
})
