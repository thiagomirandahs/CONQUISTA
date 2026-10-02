// Navegação do /admin (Fase 6, 5.2): barra lateral ≥ lg e gaveta < lg com as 15 seções.
import { useCallback, useRef, useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarAdmin, GavetaAdmin, BotaoMenuAdmin } from './NavegacaoAdmin.jsx'
import { SECOES } from '../../pages/Admin.jsx'

const ROTULOS = ['Visão geral', 'Clubes', 'Planos', 'Assinaturas', 'Armazenamento', 'Onboarding', 'Provisionamento',
  'Hierarquia', 'Recursos', 'Rede DBV', 'Suporte', 'Auditoria', 'Aviso geral', 'Manutenção', 'Lixeira']

function Movel({ aoTrocar }) {
  const [aberto, setAberto] = useState(false)
  const [ativa, setAtiva] = useState('visao')
  const refBotao = useRef(null)
  const fechar = useCallback(() => setAberto(false), [])
  const atual = SECOES.find((s) => s.chave === ativa)
  return (
    <>
      <BotaoMenuAdmin atual={atual} aberto={aberto} aoTocar={() => setAberto((v) => !v)} refBotao={refBotao} totalPendencias={3} />
      <GavetaAdmin aberta={aberto} aoFechar={fechar} secoes={SECOES} ativa={ativa}
        aoTrocar={(c) => { setAtiva(c); aoTrocar(c) }} contadores={{ chamados: 2, suporte: 1 }} refBotao={refBotao} />
    </>
  )
}

describe('SidebarAdmin', () => {
  it('lista as 15 seções na ordem; a ativa é marcada e tocar chama aoTrocar', async () => {
    const aoTrocar = vi.fn()
    render(<SidebarAdmin secoes={SECOES} ativa="clubes" aoTrocar={aoTrocar} contadores={{ provisionamento: 4 }} />)
    const abas = within(screen.getByTestId('admin-sidebar')).getAllByRole('tab')
    expect(abas).toHaveLength(15)
    abas.forEach((a, i) => expect(a).toHaveTextContent(ROTULOS[i]))
    // A navegação é um tablist: a seção ativa vai por aria-selected (equivalente ao aria-current do padrão tab)
    expect(abas.filter((a) => a.getAttribute('aria-selected') === 'true')).toEqual([abas[1]])
    expect(within(abas[6]).getByText('4')).toBeInTheDocument() // badge de pendências
    await userEvent.click(abas[2])
    expect(aoTrocar).toHaveBeenCalledWith('planos')
  })
})

describe('GavetaAdmin (< lg)', () => {
  it('☰ abre a gaveta, Esc fecha e o foco volta ao botão', async () => {
    render(<Movel aoTrocar={vi.fn()} />)
    const botao = screen.getByTestId('admin-menu')
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(botao)
    const gaveta = screen.getByRole('dialog', { name: 'Seções da administração' })
    expect(botao).toHaveAttribute('aria-expanded', 'true')
    expect(within(gaveta).getAllByRole('tab')).toHaveLength(15)
    // o foco entra na seção ativa
    expect(document.activeElement).toBe(within(gaveta).getByRole('tab', { name: /Visão geral/ }))
    // Suporte soma chamados + suporte
    expect(within(gaveta).getByRole('tab', { name: /Suporte/ })).toHaveTextContent('3')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(botao)
  })

  it('escolher uma seção chama aoTrocar e fecha a gaveta', async () => {
    const aoTrocar = vi.fn()
    render(<Movel aoTrocar={aoTrocar} />)
    await userEvent.click(screen.getByTestId('admin-menu'))
    await userEvent.click(screen.getByRole('tab', { name: /Auditoria/ }))
    expect(aoTrocar).toHaveBeenCalledWith('auditoria')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('admin-menu')).toHaveTextContent('Auditoria')
  })

  it('botão ✕ fecha', async () => {
    render(<Movel aoTrocar={vi.fn()} />)
    await userEvent.click(screen.getByTestId('admin-menu'))
    const gaveta = screen.getByRole('dialog')
    await userEvent.click(within(gaveta).getAllByRole('button', { name: 'Fechar menu' }).at(-1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
