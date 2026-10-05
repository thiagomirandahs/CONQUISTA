import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ErroDeCarga } from './index.jsx'

describe('ErroDeCarga', () => {
  it('mostra o título, o detalhe e chama "Tentar de novo"', async () => {
    const aoTentar = vi.fn()
    render(<ErroDeCarga titulo="Não consegui carregar a agenda." detalhe="timeout" aoTentar={aoTentar} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Não consegui carregar a agenda.')
    expect(screen.getByText('timeout')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(aoTentar).toHaveBeenCalledTimes(1)
  })
  it('sem aoTentar não desenha o botão', () => {
    render(<ErroDeCarga />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('texto de desenvolvimento não vaza para a tela', () => {
  const varre = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? varre(p) : /\.jsx$/.test(n) && !/\.test\./.test(n) ? [p] : []
  })
  it('nenhuma tela manda a pessoa "rodar o SQL" / abrir arquivo .sql no Supabase', () => {
    const achados = varre(join(__dirname, '..')).filter((p) => /\.sql<\/code>|rode o SQL|rodar o SQL/i.test(readFileSync(p, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')))
    expect(achados).toEqual([])
  })
})
