// /admin › Painéis do plano: o servidor decide e audita (teste SQL 101); aqui garantimos que a tela
// chama a RPC certa, que a remoção com clubes mostra o impacto e só aplica com confirmação explícita,
// e que o switch tem alvo de toque ≥ 44px.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { planosRecursosListar: vi.fn(), planoRecursoDefinir: vi.fn() }
vi.mock('../services/planosRecursos.js', () => ({
  planosRecursosListar: (...a) => f.planosRecursosListar(...a),
  planoRecursoDefinir: (...a) => f.planoRecursoDefinir(...a),
}))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), erro: vi.fn() } }))

const { default: AdminPaineisPlano } = await import('./AdminPaineisPlano.jsx')

const PLANOS = [{
  id: 'p1', chave: 'anual', versao: 1, nome: 'Licença Anual', status: 'publicado', ativo: true, publico: true, todos: true, clubes: 2,
  recursos: [
    { chave: 'agenda', nome: 'Agenda', descricao: '', icone: '📅', somente_plataforma: false, incluido: true },
    { chave: 'leilao', nome: 'Leilão', descricao: '', icone: '🔨', somente_plataforma: false, incluido: false },
    { chave: 'especialidades', nome: 'Especialidades', descricao: '', icone: '🏅', somente_plataforma: true, incluido: true },
  ],
}]

beforeEach(() => {
  f.planosRecursosListar.mockReset().mockResolvedValue(PLANOS)
  f.planoRecursoDefinir.mockReset()
})

async function abrirPlano() {
  render(<AdminPaineisPlano />)
  await userEvent.click(await screen.findByTestId('plano-paineis'))
}

describe('AdminPaineisPlano', () => {
  it('lista os planos e abre os painéis com switches acessíveis e grandes', async () => {
    await abrirPlano()
    const sw = screen.getByRole('switch', { name: /Agenda no plano Licença Anual/ })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(sw.className).toMatch(/h-11/)
    expect(screen.getByRole('switch', { name: /Leilão/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Liberado pela plataforma, clube a clube')).toBeInTheDocument()
  })

  it('incluir chama o servidor direto', async () => {
    f.planoRecursoDefinir.mockResolvedValue({ alterado: true, incluido: true })
    await abrirPlano()
    await userEvent.click(screen.getByTestId('switch-leilao'))
    expect(f.planoRecursoDefinir).toHaveBeenCalledWith('p1', 'leilao', true, false)
  })

  it('remover mostra quantos clubes serão afetados e só aplica com confirmação', async () => {
    f.planoRecursoDefinir
      .mockResolvedValueOnce({ alterado: false, precisa_confirmar: true, impacto: { clubes_no_plano: 2, clubes_usando: 1, clubes: ['Clube A', 'Clube B'] } })
      .mockResolvedValueOnce({ alterado: true, incluido: false })
    await abrirPlano()
    await userEvent.click(screen.getByTestId('switch-agenda'))
    expect(f.planoRecursoDefinir).toHaveBeenLastCalledWith('p1', 'agenda', false, false)
    expect(screen.getByTestId('impacto-remocao')).toHaveTextContent('2 clube(s) estão neste plano')
    expect(screen.getByTestId('impacto-remocao')).toHaveTextContent('Nenhum dado é apagado')
    await userEvent.click(screen.getByText('Confirmar e tirar do plano'))
    expect(f.planoRecursoDefinir).toHaveBeenLastCalledWith('p1', 'agenda', false, true)
    expect(f.planoRecursoDefinir).toHaveBeenCalledTimes(2)
  })

  it('cancelar a remoção não chama o servidor de novo', async () => {
    f.planoRecursoDefinir.mockResolvedValueOnce({ precisa_confirmar: true, impacto: { clubes_no_plano: 1, clubes_usando: 1, clubes: ['Clube A'] } })
    await abrirPlano()
    await userEvent.click(screen.getByTestId('switch-agenda'))
    await userEvent.click(screen.getByText('Cancelar'))
    expect(screen.queryByTestId('impacto-remocao')).toBeNull()
    expect(f.planoRecursoDefinir).toHaveBeenCalledTimes(1)
  })
})
