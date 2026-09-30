// Rascunho offline: digitou → aparelho → servidor; a rede cai e volta sem perder nada, e nunca envia sozinho.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import FormularioRelatorio from './FormularioRelatorio.jsx'
import { lerLocal, lerBackup, gravarLocal, hashRascunho } from '../../lib/relatorio/rascunhoLocal.js'

vi.mock('../Comprovacao.jsx', () => ({ default: () => null }))

const SCHEMA = { versao: 1, campos: [{ chave: 'resumo', tipo: 'texto_longo', rotulo: 'Conte o que fez' }, { chave: 'fotos', tipo: 'anexos', rotulo: 'Fotos', max: 2 }] }
const K = 'cq.rel.u1.classe.r1'
const VAZIO = { conteudo: {}, anexos: [] }
const campo = () => screen.getByLabelText(/Conte o que fez/)
const estado = () => screen.getByTestId('estado-rascunho')
const digitar = (v) => fireEvent.change(campo(), { target: { value: v } })
const passar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const internet = (on) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
const montar = (props = {}) => render(
  <FormularioRelatorio schema={SCHEMA} valorInicial={VAZIO} chaveLocal={K} onSalvarRascunho={vi.fn().mockResolvedValue()} onEnviar={vi.fn()} {...props} />,
)

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); internet(true) })
afterEach(() => { vi.useRealTimers(); internet(true) })

describe('rascunho offline — guardar e sincronizar', () => {
  it('offline: aparece "Salvo neste aparelho" e o texto sobrevive a fechar e abrir', async () => {
    internet(false)
    const salvar = vi.fn().mockResolvedValue()
    const { unmount } = montar({ onSalvarRascunho: salvar })
    digitar('escrevi sem internet')
    await passar(400)
    expect(estado()).toHaveTextContent('Salvo neste aparelho')
    expect(lerLocal(K).conteudo).toEqual({ resumo: 'escrevi sem internet' })
    await passar(2000)
    expect(salvar).not.toHaveBeenCalled()
    expect(estado()).toHaveTextContent('Salvo neste aparelho')

    unmount() // "fecha o app"
    montar({ onSalvarRascunho: salvar }) // "abre de novo"
    expect(campo()).toHaveValue('escrevi sem internet')
    expect(estado()).toHaveTextContent('Salvo neste aparelho')
  })

  it('a rede volta: sincroniza sozinho UMA vez, mostra "Salvo" e não envia o requisito', async () => {
    internet(false)
    const salvar = vi.fn().mockResolvedValue()
    const onEnviar = vi.fn()
    montar({ onSalvarRascunho: salvar, onEnviar })
    digitar('texto')
    await passar(2000)
    expect(salvar).not.toHaveBeenCalled()
    internet(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(salvar).toHaveBeenCalledWith({ resumo: 'texto' }, [])
    expect(estado()).toHaveTextContent(/^Salvo$/)
    expect(lerLocal(K).sincronizado).toBe(true)
    await act(async () => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')) })
    await passar(120000)
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(onEnviar).not.toHaveBeenCalled()
  })

  it('erro de rede no servidor: mantém o local e tenta de novo pelo backoff (5 s)', async () => {
    const salvar = vi.fn().mockRejectedValueOnce(new Error('TypeError: Failed to fetch')).mockResolvedValue()
    montar({ onSalvarRascunho: salvar })
    digitar('abc')
    await passar(1800)
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(estado()).toHaveTextContent('Salvo neste aparelho')
    expect(lerLocal(K).sincronizado).toBe(false)
    await passar(5100)
    expect(salvar).toHaveBeenCalledTimes(2)
    expect(estado()).toHaveTextContent(/^Salvo$/)
  })

  it('aba volta a ficar visível: tenta sincronizar', async () => {
    const salvar = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue()
    montar({ onSalvarRascunho: salvar })
    digitar('abc')
    await passar(1800)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(salvar).toHaveBeenCalledTimes(2)
  })

  it('erro de validação: "Erro ao sincronizar" com o motivo e "Tentar de novo"; o local fica', async () => {
    const salvar = vi.fn().mockRejectedValueOnce(new Error('Formulário: Conte o que fez: passou de 5 caracteres')).mockResolvedValue()
    montar({ onSalvarRascunho: salvar })
    digitar('abc')
    await passar(1800)
    expect(estado()).toHaveTextContent('Erro ao sincronizar')
    expect(screen.getByTestId('erro-sincronizar')).toHaveTextContent(/passou de 5 caracteres/)
    expect(lerLocal(K).conteudo).toEqual({ resumo: 'abc' })
    await passar(120000)
    expect(salvar).toHaveBeenCalledTimes(1) // não insiste sozinho
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' })) })
    expect(salvar).toHaveBeenCalledTimes(2)
    expect(estado()).toHaveTextContent(/^Salvo$/)
  })

  it('sem chaveLocal: nada é guardado no aparelho (comportamento de antes)', async () => {
    montar({ chaveLocal: null })
    digitar('abc')
    await passar(2000)
    expect(Object.keys(localStorage)).toEqual([])
  })

  it('envio bem-sucedido apaga o rascunho local e o backup', async () => {
    gravarLocal(K + '.backup', { conteudo: { resumo: 'velho' } })
    const onEnviar = vi.fn().mockResolvedValue()
    montar({ onEnviar })
    digitar('final')
    await passar(400)
    expect(lerLocal(K)).not.toBeNull()
    await act(async () => { fireEvent.click(screen.getByTestId('botao-enviar-relatorio')) })
    expect(onEnviar).toHaveBeenCalledTimes(1)
    expect(lerLocal(K)).toBeNull()
    expect(lerBackup(K)).toBeNull()
  })

  it('envio que falha mantém o local', async () => {
    const onEnviar = vi.fn().mockRejectedValue(new Error('Failed to fetch'))
    montar({ onEnviar })
    digitar('final')
    await passar(400)
    await act(async () => { fireEvent.click(screen.getByTestId('botao-enviar-relatorio')) })
    expect(lerLocal(K).conteudo).toEqual({ resumo: 'final' })
  })

  it('sem internet ao anexar: aviso curto, sem guardar arquivo', async () => {
    const subir = vi.fn().mockRejectedValue(new Error('Não foi possível enviar: Failed to fetch'))
    montar({ subirAnexo: subir })
    const foto = new File([new Uint8Array(20)], 'f.jpg', { type: 'image/jpeg' })
    await act(async () => { fireEvent.change(screen.getByLabelText(/Adicionar foto/), { target: { files: [foto] } }) })
    expect(screen.getByRole('alert')).toHaveTextContent('Sem internet: não deu para anexar agora; o texto foi guardado neste aparelho.')
  })
})

describe('rascunho offline — conflito e requisito já enviado', () => {
  const semeiaLocal = (texto, baseConteudo = {}) => gravarLocal(K, { conteudo: { resumo: texto }, base: hashRascunho(baseConteudo, []), sincronizado: false })

  it('servidor não mudou desde a edição local: usa o local e sincroniza, sem conflito', async () => {
    semeiaLocal('do aparelho')
    const salvar = vi.fn().mockResolvedValue()
    montar({ onSalvarRascunho: salvar })
    expect(campo()).toHaveValue('do aparelho')
    expect(screen.queryByTestId('conflito-rascunho')).toBeNull()
    await passar(1600)
    expect(salvar).toHaveBeenCalledWith({ resumo: 'do aparelho' }, [])
  })

  it('servidor mudou: mostra o conflito, NÃO sincroniza e não sobrescreve nada', async () => {
    semeiaLocal('do aparelho')
    const salvar = vi.fn().mockResolvedValue()
    montar({ valorInicial: { conteudo: { resumo: 'do servidor' }, anexos: [] }, onSalvarRascunho: salvar })
    expect(screen.getByText(/Encontramos um rascunho neste aparelho diferente do que está salvo no servidor/)).toBeInTheDocument()
    expect(estado()).toHaveTextContent('Salvo neste aparelho')
    expect(screen.getByTestId('botao-enviar-relatorio')).toBeDisabled()
    await passar(120000)
    expect(salvar).not.toHaveBeenCalled()
    expect(lerLocal(K).conteudo).toEqual({ resumo: 'do aparelho' })
  })

  it('"Usar o do servidor": aplica o do servidor e a versão do aparelho vira backup recuperável', async () => {
    semeiaLocal('do aparelho')
    montar({ valorInicial: { conteudo: { resumo: 'do servidor' }, anexos: [] } })
    fireEvent.click(screen.getByRole('button', { name: 'Usar o do servidor' }))
    expect(campo()).toHaveValue('do servidor')
    expect(screen.queryByTestId('conflito-rascunho')).toBeNull()
    expect(lerBackup(K).conteudo).toEqual({ resumo: 'do aparelho' })
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar a outra versão' }))
    expect(campo()).toHaveValue('do aparelho')
    expect(lerBackup(K).conteudo).toEqual({ resumo: 'do servidor' }) // dá para voltar
  })

  it('"Usar o deste aparelho": sincroniza o local e a versão do servidor vira backup', async () => {
    semeiaLocal('do aparelho')
    const salvar = vi.fn().mockResolvedValue()
    montar({ valorInicial: { conteudo: { resumo: 'do servidor' }, anexos: [] }, onSalvarRascunho: salvar })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usar o deste aparelho' })) })
    await passar(10)
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(salvar).toHaveBeenCalledWith({ resumo: 'do aparelho' }, [])
    expect(lerBackup(K).conteudo).toEqual({ resumo: 'do servidor' })
    expect(screen.getByRole('button', { name: 'Recuperar a outra versão' })).toBeInTheDocument()
  })

  it('servidor mudou ENQUANTO havia local pendente: ao voltar a rede confere e vira conflito (não sobrescreve)', async () => {
    internet(false)
    const salvar = vi.fn().mockResolvedValue()
    const carregarServidor = vi.fn().mockResolvedValue({ conteudo: { resumo: 'outro aparelho' }, anexos: [], editavel: true })
    montar({ onSalvarRascunho: salvar, carregarServidor })
    digitar('meu texto offline')
    await passar(2000)
    internet(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(carregarServidor).toHaveBeenCalledTimes(1)
    expect(salvar).not.toHaveBeenCalled()
    expect(screen.getByTestId('conflito-rascunho')).toBeInTheDocument()
    expect(campo()).toHaveValue('meu texto offline')
  })

  it('servidor igual à base ao voltar a rede: empurra o local normalmente', async () => {
    internet(false)
    const salvar = vi.fn().mockResolvedValue()
    const carregarServidor = vi.fn().mockResolvedValue({ conteudo: {}, anexos: [], editavel: true })
    montar({ onSalvarRascunho: salvar, carregarServidor })
    digitar('meu texto')
    await passar(2000)
    internet(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(salvar).toHaveBeenCalledWith({ resumo: 'meu texto' }, [])
    expect(screen.queryByTestId('conflito-rascunho')).toBeNull()
  })

  it('requisito já enviado/aprovado quando a rede volta: cópia de segurança + aviso, nada é enviado', async () => {
    internet(false)
    const salvar = vi.fn().mockResolvedValue()
    const carregarServidor = vi.fn().mockResolvedValue({ conteudo: {}, anexos: [], editavel: false })
    montar({ onSalvarRascunho: salvar, carregarServidor })
    digitar('meu texto')
    await passar(2000)
    internet(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(screen.getByTestId('aviso-encerrado')).toHaveTextContent('guardamos uma cópia do seu texto neste aparelho')
    expect(salvar).not.toHaveBeenCalled()
    expect(lerLocal(K)).toBeNull()
    expect(lerBackup(K).conteudo).toEqual({ resumo: 'meu texto' })
  })
})
