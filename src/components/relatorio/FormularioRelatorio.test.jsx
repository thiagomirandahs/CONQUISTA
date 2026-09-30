import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import FormularioRelatorio from './FormularioRelatorio.jsx'

vi.mock('../Comprovacao.jsx', () => ({ default: ({ valor, alt }) => <span data-testid="foto">{alt}:{valor}</span> }))

const S = (...campos) => ({ versao: 1, campos })
const TODOS = S(
  { chave: 'resumo', tipo: 'texto_longo', rotulo: 'Resumo do que fez', obrigatorio: true, max: 100 },
  { chave: 'curto', tipo: 'texto_curto', rotulo: 'Título' },
  { chave: 'km', tipo: 'numero', rotulo: 'Distância', unidade: 'km', inteiro: true, min: 1 },
  { chave: 'dia', tipo: 'data', rotulo: 'Quando foi', nao_futura: true },
  { chave: 'sel', tipo: 'selecao', rotulo: 'Como foi', opcoes: [{ chave: 'bom', rotulo: 'Bom' }, { chave: 'ruim', rotulo: 'Ruim' }] },
  { chave: 'check', tipo: 'checklist', rotulo: 'Técnicas', min_marcados: 2, max_marcados: 3, itens: ['a', 'b', 'c', 'd'].map((k) => ({ chave: k, rotulo: `Técnica ${k}` })) },
  { chave: 'lista', tipo: 'lista', rotulo: 'Materiais', min: 1, max: 3, rotulo_item: 'Material' },
  { chave: 'fiz', tipo: 'confirmacao', rotulo: 'Fiz a atividade' },
  { chave: 'fotos', tipo: 'anexos', rotulo: 'Fotos', max: 2, tipos: ['imagem'] },
)
const DIARIO = S({ chave: 'diario', tipo: 'entradas', rotulo: 'Diário', min: 7, max: 7, rotulo_item: 'Dia', campos: [{ chave: 'o', tipo: 'texto_curto', rotulo: 'O que fez', obrigatorio: true }] })
const ESCOLHA = S({
  chave: 'como', tipo: 'escolha', rotulo: 'Como cumpriu', obrigatorio: true,
  opcoes: [
    { chave: 'a', rotulo: 'Fiz sozinho', campos: [{ chave: 'x', tipo: 'texto_curto', rotulo: 'Detalhe do A', obrigatorio: true }] },
    { chave: 'b', rotulo: 'Fiz em grupo', campos: [{ chave: 'y', tipo: 'texto_curto', rotulo: 'Detalhe do B' }] },
    { chave: 'p', rotulo: 'Outra forma', campos: [], pendente: true },
  ],
})

afterEach(() => { vi.useRealTimers() })

describe('FormularioRelatorio — renderização por tipo', () => {
  it('monta cada tipo de campo a partir do schema, com rótulos ligados', () => {
    render(<FormularioRelatorio schema={TODOS} onEnviar={vi.fn()} />)
    expect(screen.getByLabelText(/Resumo do que fez/)).toBeInTheDocument()
    expect(screen.getByLabelText('Título')).toBeInTheDocument()
    expect(screen.getByLabelText(/Distância/)).toHaveAttribute('type', 'number')
    expect(screen.getByLabelText('Quando foi')).toHaveAttribute('type', 'date')
    expect(screen.getByRole('radio', { name: 'Bom' })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: /Técnica/ })).toHaveLength(4)
    expect(screen.getByLabelText('Material 1')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Fiz a atividade/ })).toBeInTheDocument()
    expect(screen.getByText('0 de 2 foto(s)')).toBeInTheDocument()
  })

  it('texto longo mostra a contagem de caracteres', () => {
    render(<FormularioRelatorio schema={TODOS} />)
    expect(screen.getByTestId('contagem-resumo')).toHaveTextContent('0 de 100 caracteres')
    fireEvent.change(screen.getByLabelText(/Resumo do que fez/), { target: { value: 'abcde' } })
    expect(screen.getByTestId('contagem-resumo')).toHaveTextContent('5 de 100 caracteres')
  })

  it('checklist mostra a contagem e trava no máximo de marcados', () => {
    render(<FormularioRelatorio schema={TODOS} />)
    for (const k of ['a', 'b', 'c']) fireEvent.click(screen.getByRole('checkbox', { name: `Técnica ${k}` }))
    expect(screen.getByTestId('marcados-check')).toHaveTextContent('3 marcados')
    expect(screen.getByRole('checkbox', { name: 'Técnica d' })).toBeDisabled()
  })

  it('lista: "Adicionar item" até o máximo, e remove', () => {
    render(<FormularioRelatorio schema={TODOS} />)
    const add = () => screen.getByRole('button', { name: /Adicionar item/ })
    fireEvent.click(add()); fireEvent.click(add())
    expect(screen.getByLabelText('Material 3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Adicionar item/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remover Material 3' }))
    expect(screen.queryByLabelText('Material 3')).toBeNull()
  })

  it('entradas repetíveis: diário mostra Dia 1 a Dia 7', () => {
    render(<FormularioRelatorio schema={DIARIO} />)
    expect(screen.getAllByTestId('entrada-diario')).toHaveLength(7)
    expect(screen.getByText('Dia 1')).toBeInTheDocument()
    expect(screen.getByText('Dia 7')).toBeInTheDocument()
  })

  it('escolha troca os campos e a opção pendente aparece desativada com aviso', () => {
    render(<FormularioRelatorio schema={ESCOLHA} />)
    expect(screen.queryByLabelText(/Detalhe do/)).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /Fiz sozinho/ }))
    expect(screen.getByLabelText(/Detalhe do A/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Fiz em grupo/ }))
    expect(screen.queryByLabelText(/Detalhe do A/)).toBeNull()
    expect(screen.getByLabelText(/Detalhe do B/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Outra forma/ })).toBeDisabled()
    expect(screen.getByText(/Decisão pendente/)).toBeInTheDocument()
  })
})

describe('FormularioRelatorio — envio', () => {
  it('bloqueia o envio incompleto, mostra os problemas em português e não chama onEnviar', () => {
    const onEnviar = vi.fn()
    render(<FormularioRelatorio schema={TODOS} onEnviar={onEnviar} />)
    fireEvent.click(screen.getByTestId('botao-enviar-relatorio'))
    const resumo = screen.getByTestId('erros-formulario')
    expect(within(resumo).getByText('Preencha: Resumo do que fez')).toBeInTheDocument()
    expect(onEnviar).not.toHaveBeenCalled()
    // o texto do erro também aparece perto do campo
    expect(screen.getByLabelText(/Resumo do que fez/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('checklist abaixo do mínimo e diário incompleto (aponta o dia) bloqueiam', () => {
    render(<FormularioRelatorio schema={S(TODOS.campos[5], ...DIARIO.campos)} onEnviar={vi.fn()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Técnica a' }))
    fireEvent.click(screen.getByTestId('botao-enviar-relatorio'))
    const resumo = screen.getByTestId('erros-formulario')
    expect(within(resumo).getByText(/marque pelo menos 2/)).toBeInTheDocument()
    expect(within(resumo).getByText('Dia 1: Preencha: O que fez')).toBeInTheDocument()
  })

  it('completo: envia o conteúdo limpo (sem vazios) e os anexos', async () => {
    const onEnviar = vi.fn().mockResolvedValue()
    render(<FormularioRelatorio schema={S(TODOS.campos[0], TODOS.campos[1], TODOS.campos[6])} onEnviar={onEnviar} />)
    fireEvent.change(screen.getByLabelText(/Resumo do que fez/), { target: { value: 'Fiz tudo' } })
    fireEvent.change(screen.getByLabelText('Material 1'), { target: { value: 'corda' } })
    await act(async () => { fireEvent.click(screen.getByTestId('botao-enviar-relatorio')) })
    expect(onEnviar).toHaveBeenCalledWith({ resumo: 'Fiz tudo', lista: ['corda'] }, [])
  })

  it('erro do servidor no envio aparece na tela (sem alert)', async () => {
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const onEnviar = vi.fn().mockRejectedValue(new Error('Formulário incompleto: falta algo'))
    render(<FormularioRelatorio schema={S({ chave: 'f', tipo: 'confirmacao', rotulo: 'Fiz' })} onEnviar={onEnviar} />)
    await act(async () => { fireEvent.click(screen.getByTestId('botao-enviar-relatorio')) })
    expect(await screen.findByRole('alert')).toHaveTextContent(/incompleto|falta/i)
    expect(alerta).not.toHaveBeenCalled()
    alerta.mockRestore()
  })

  it('enviarDesativado trava o botão', () => {
    render(<FormularioRelatorio schema={ESCOLHA} enviarDesativado descricaoEnviarId="motivo" onEnviar={vi.fn()} />)
    expect(screen.getByTestId('botao-enviar-relatorio')).toBeDisabled()
  })
})

describe('FormularioRelatorio — rascunho automático', () => {
  it('salva só depois de ~1,5 s parado, uma vez, e mostra "Rascunho salvo"', async () => {
    vi.useFakeTimers()
    const salvar = vi.fn().mockResolvedValue()
    const onEnviar = vi.fn()
    render(<FormularioRelatorio schema={S(TODOS.campos[0])} onSalvarRascunho={salvar} onEnviar={onEnviar} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(salvar).not.toHaveBeenCalled() // sem mudança, sem salvar
    fireEvent.change(screen.getByLabelText(/Resumo/), { target: { value: 'a' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    fireEvent.change(screen.getByLabelText(/Resumo/), { target: { value: 'ab' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(salvar).not.toHaveBeenCalled() // o debounce reiniciou
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(salvar).toHaveBeenCalledWith({ resumo: 'ab' }, [])
    expect(screen.getByTestId('estado-rascunho')).toHaveTextContent('Rascunho salvo')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(onEnviar).not.toHaveBeenCalled() // rascunho NUNCA envia
  })

  it('falha ao salvar mostra aviso discreto e não envia', async () => {
    vi.useFakeTimers()
    const salvar = vi.fn().mockRejectedValue(new Error('rede'))
    render(<FormularioRelatorio schema={S(TODOS.campos[0])} onSalvarRascunho={salvar} onEnviar={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Resumo/), { target: { value: 'a' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(screen.getByTestId('estado-rascunho')).toHaveTextContent(/Não consegui salvar o rascunho/)
  })

  it('somente leitura não salva nada', async () => {
    vi.useFakeTimers()
    const salvar = vi.fn()
    render(<FormularioRelatorio schema={S(TODOS.campos[0])} desativado onSalvarRascunho={salvar} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(salvar).not.toHaveBeenCalled()
  })
})

describe('FormularioRelatorio — anexos', () => {
  const foto = (n = 'f.jpg') => new File([new Uint8Array(20)], n, { type: 'image/jpeg' })

  it('sobe a foto pela função recebida e respeita o máximo', async () => {
    const subir = vi.fn().mockImplementation(async (f) => `u/requisitos/${f.name}`)
    render(<FormularioRelatorio schema={S(TODOS.campos[8])} subirAnexo={subir} onEnviar={vi.fn()} />)
    const input = () => screen.getByLabelText(/Adicionar foto/)
    await act(async () => { fireEvent.change(input(), { target: { files: [foto('1.jpg')] } }) })
    await act(async () => { fireEvent.change(input(), { target: { files: [foto('2.jpg')] } }) })
    expect(subir).toHaveBeenCalledWith(expect.any(File), 'fotos')
    expect(screen.getAllByTestId('foto')).toHaveLength(2)
    expect(screen.getByText('2 de 2 foto(s)')).toBeInTheDocument()
    expect(input()).toBeDisabled()
    expect(screen.getByText('Limite de fotos atingido')).toBeInTheDocument()
  })

  it('remove a foto; foto NÃO é obrigatória quando o modelo não pede', async () => {
    const onEnviar = vi.fn().mockResolvedValue()
    render(<FormularioRelatorio schema={S(TODOS.campos[8])} valorInicial={{ conteudo: {}, anexos: [{ campo: 'fotos', path: 'u/requisitos/a.jpg' }] }} onEnviar={onEnviar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remover foto 1' }))
    expect(screen.queryAllByTestId('foto')).toHaveLength(0)
    await act(async () => { fireEvent.click(screen.getByTestId('botao-enviar-relatorio')) })
    expect(onEnviar).toHaveBeenCalledWith({}, [])
  })

  it('anexo com mínimo no modelo bloqueia o envio sem foto', () => {
    const onEnviar = vi.fn()
    render(<FormularioRelatorio schema={S({ chave: 'fotos', tipo: 'anexos', rotulo: 'Foto do projeto', min: 1, max: 3 })} onEnviar={onEnviar} />)
    fireEvent.click(screen.getByTestId('botao-enviar-relatorio'))
    expect(screen.getByTestId('erros-formulario')).toHaveTextContent(/pelo menos 1 anexo/)
    expect(onEnviar).not.toHaveBeenCalled()
  })

  it('erro na subida aparece como texto', async () => {
    const subir = vi.fn().mockRejectedValue(new Error('Esse arquivo não é uma foto válida'))
    render(<FormularioRelatorio schema={S(TODOS.campos[8])} subirAnexo={subir} />)
    await act(async () => { fireEvent.change(screen.getByLabelText(/Adicionar foto/), { target: { files: [foto()] } }) })
    expect(screen.getByRole('alert')).toHaveTextContent(/foto válida/)
  })
})

describe('FormularioRelatorio — leitura e devolução', () => {
  it('somente leitura: campos desativados, sem botão de enviar', () => {
    render(<FormularioRelatorio schema={TODOS} desativado valorInicial={{ conteudo: { resumo: 'oi' }, anexos: [] }} />)
    expect(screen.getByLabelText(/Resumo do que fez/)).toBeDisabled()
    expect(screen.getByLabelText(/Resumo do que fez/)).toHaveValue('oi')
    expect(screen.queryByTestId('botao-enviar-relatorio')).toBeNull()
    expect(screen.queryByRole('button', { name: /Adicionar item/ })).toBeNull()
  })

  it('comentário de devolução em destaque, com o valor anterior preenchido', () => {
    render(<FormularioRelatorio schema={TODOS} comentarioDevolucao="Conte melhor o que fez" valorInicial={{ conteudo: { resumo: 'antes' }, anexos: [] }} />)
    expect(screen.getByText('A liderança pediu correção')).toBeInTheDocument()
    expect(screen.getByTestId('comentario-devolucao')).toHaveTextContent('Conte melhor o que fez')
    expect(screen.getByLabelText(/Resumo do que fez/)).toHaveValue('antes')
  })
})
