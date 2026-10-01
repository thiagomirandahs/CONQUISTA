// Relato complementar (520): rascunho local → servidor, offline, conflito, limite, compatibilidade e "nunca envia sozinho".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createRef } from 'react'
import RelatoComplementar from './RelatoComplementar.jsx'
import { RelatoIndisponivel } from '../../lib/relatorio/relato.js'
import { lerLocal, gravarLocal, hashRascunho } from '../../lib/relatorio/rascunhoLocal.js'

const K = 'cq.rel.u1.classe-relato.r1'
const campo = () => screen.getByLabelText(/Relato \/ comprovação \(opcional\)/)
const estado = () => screen.getByTestId('estado-relato')
const digitar = (v) => fireEvent.change(campo(), { target: { value: v } })
const passar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const internet = (on) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
const montar = (props = {}) => render(
  <RelatoComplementar requirementId="r1" chaveLocal={K} salvarRelato={vi.fn().mockResolvedValue()} {...props} />,
)

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); internet(true) })
afterEach(() => { vi.useRealTimers(); internet(true) })

describe('RelatoComplementar — bloco COMPROVAÇÃO', () => {
  it('mostra o texto de apoio, o rótulo opcional, a contagem e 16px (text-base)', () => {
    montar()
    expect(screen.getByText('Conte ao instrutor como você cumpriu este requisito.')).toBeInTheDocument()
    expect(campo()).toHaveAttribute('autocapitalize', 'sentences')
    expect(campo().className).toMatch(/text-base/)
    expect(screen.getByTestId('contagem-relato')).toHaveTextContent('0 de 2000 caracteres')
    expect(screen.getByText(/não muda o requisito oficial/)).toBeInTheDocument()
  })

  it('quando o requisito já exige texto o rótulo é "Relato complementar"', () => {
    montar({ exigeTexto: true })
    expect(screen.getByLabelText('Relato complementar (opcional)')).toBeInTheDocument()
  })

  it('limite de 2000 caracteres (maxLength) e contador', () => {
    montar()
    expect(campo()).toHaveAttribute('maxLength', '2000')
    digitar('a'.repeat(2000))
    expect(screen.getByTestId('contagem-relato')).toHaveTextContent('2000 de 2000 caracteres')
  })

  it('digitou → grava no aparelho → sincroniza com o servidor (debounce)', async () => {
    const salvar = vi.fn().mockResolvedValue()
    montar({ salvarRelato: salvar })
    digitar('Fiz a trilha com a minha unidade')
    await passar(400)
    expect(estado()).toHaveTextContent('Salvo neste aparelho')
    expect(lerLocal(K).conteudo).toEqual({ relato: 'Fiz a trilha com a minha unidade' })
    expect(salvar).not.toHaveBeenCalled()
    await passar(1500)
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(salvar).toHaveBeenCalledWith('Fiz a trilha com a minha unidade')
    expect(estado()).toHaveTextContent(/^Salvo$/)
  })

  it('offline: mantém "Salvo neste aparelho"; ao voltar a internet sincroniza UMA vez', async () => {
    internet(false)
    const salvar = vi.fn().mockResolvedValue()
    montar({ salvarRelato: salvar })
    digitar('escrevi sem internet')
    await passar(2500)
    expect(salvar).not.toHaveBeenCalled()
    expect(estado()).toHaveTextContent('Salvo neste aparelho')
    internet(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(salvar).toHaveBeenCalledWith('escrevi sem internet')
    expect(estado()).toHaveTextContent(/^Salvo$/)
    await passar(120000)
    expect(salvar).toHaveBeenCalledTimes(1)
  })

  it('o texto offline sobrevive a fechar e abrir', async () => {
    internet(false)
    const { unmount } = montar()
    digitar('não perder')
    await passar(400)
    unmount()
    montar()
    expect(campo()).toHaveValue('não perder')
    expect(estado()).toHaveTextContent('Salvo neste aparelho')
  })

  it('recusa do servidor: "Erro ao sincronizar" + "Tentar de novo" sem perder o texto', async () => {
    const salvar = vi.fn().mockRejectedValueOnce(new Error('O relato passou de 2000 caracteres.')).mockResolvedValue()
    montar({ salvarRelato: salvar })
    digitar('meu relato')
    await passar(1800)
    expect(estado()).toHaveTextContent('Erro ao sincronizar')
    expect(campo()).toHaveValue('meu relato')
    expect(lerLocal(K).conteudo).toEqual({ relato: 'meu relato' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' })) })
    expect(salvar).toHaveBeenCalledTimes(2)
    expect(estado()).toHaveTextContent(/^Salvo$/)
  })

  it('conflito aparelho × nuvem considera o relato: mostra as duas versões e não sobrescreve sozinho', async () => {
    gravarLocal(K, { conteudo: { relato: 'versão do aparelho' }, anexos: [], base: hashRascunho({ relato: 'base antiga' }, []), sincronizado: false })
    const salvar = vi.fn().mockResolvedValue()
    montar({ salvarRelato: salvar, relatoInicial: 'versão da nuvem', rascunhoEm: '2026-09-30T10:00:00Z' })
    expect(screen.getByTestId('conflito-rascunho')).toBeInTheDocument()
    expect(screen.getByTestId('versao-aparelho-previa')).toHaveTextContent('versão do aparelho')
    expect(screen.getByTestId('versao-nuvem-previa')).toHaveTextContent('versão da nuvem')
    await passar(5000)
    expect(salvar).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usar da nuvem' })) })
    expect(campo()).toHaveValue('versão da nuvem')
  })

  it('NUNCA envia sozinho: só salva o rascunho, sem botão de enviar', async () => {
    const salvar = vi.fn().mockResolvedValue()
    montar({ salvarRelato: salvar })
    digitar('texto')
    await passar(120000)
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /Enviar/ })).toBeNull()
  })

  it('preparar() grava o relato pendente antes do envio; sem relato não chama o servidor', async () => {
    const ref = createRef()
    const salvar = vi.fn().mockResolvedValue()
    montar({ ref, salvarRelato: salvar })
    await act(async () => { await ref.current.preparar() })
    expect(salvar).not.toHaveBeenCalled() // enviar SEM relato continua permitido
    digitar('relato final')
    await act(async () => { await ref.current.preparar() })
    expect(salvar).toHaveBeenCalledWith('relato final')
  })

  it('preparar() offline falha com mensagem clara e o texto fica guardado', async () => {
    const ref = createRef()
    internet(false)
    montar({ ref, salvarRelato: vi.fn().mockRejectedValue(new Error('Failed to fetch')) })
    digitar('texto offline')
    await passar(400)
    await expect(act(async () => { await ref.current.preparar() })).rejects.toThrow(/Sem internet/)
    expect(lerLocal(K).conteudo).toEqual({ relato: 'texto offline' })
  })

  it('preparar() com conflito aberto bloqueia o envio', async () => {
    gravarLocal(K, { conteudo: { relato: 'a' }, anexos: [], base: hashRascunho({ relato: 'x' }, []), sincronizado: false })
    const ref = createRef()
    montar({ ref, relatoInicial: 'b' })
    await expect(act(async () => { await ref.current.preparar() })).rejects.toThrow(/Escolha qual versão/)
  })

  it('apagar o relato manda texto vazio ao servidor (apaga)', async () => {
    const salvar = vi.fn().mockResolvedValue()
    montar({ salvarRelato: salvar, relatoInicial: 'antigo' })
    digitar('')
    await passar(1800)
    expect(salvar).toHaveBeenCalledWith('')
  })
})

describe('RelatoComplementar — compatibilidade com banco sem a 520', () => {
  it('disponivel=false (payload sem `relato`): não renderiza nada', () => {
    const { container } = montar({ disponivel: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('RPC inexistente: o bloco some, sem erro, e preparar() não bloqueia o envio', async () => {
    const ref = createRef()
    montar({ ref, salvarRelato: vi.fn().mockRejectedValue(new RelatoIndisponivel()) })
    digitar('texto')
    await passar(1800)
    expect(screen.queryByTestId('relato-complementar')).toBeNull()
    await act(async () => { await ref.current.preparar() })
  })
})
