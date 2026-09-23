import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { normalizarContexto, contextoLegado } from '../lib/clube.js'

// ---- dublês: a sessão (quem está logado), o serviço (o que o servidor responde) e o "clube desta
// aba" que vai no header x-clube-atual de toda chamada (lib/supabase.js) ----
let sessao
const carregarContexto = vi.fn()
const definirClubeAtivoNoTransporte = vi.fn()
vi.mock('./Auth.jsx', () => ({ useAuth: () => ({ session: sessao }) }))
vi.mock('../services/clubes.js', () => ({ carregarContexto: (...a) => carregarContexto(...a) }))
vi.mock('../lib/supabase.js', () => ({ definirClubeAtivoNoTransporte: (...a) => definirClubeAtivoNoTransporte(...a) }))

const { ClubeProvider, useClube } = await import('./Clube.jsx')
const wrapper = ({ children }) => <ClubeProvider>{children}</ClubeProvider>
const logar = (id) => { sessao = id ? { user: { id } } : null }

// vínculo como o servidor entrega
const vinc = (o = {}) => ({
  club_id: 'A', nome: 'Filhos da Conquista', slug: 'filhos-da-conquista', timezone: 'America/Recife',
  papel: 'desbravador', status: 'ativo', selecionavel: true, unidade_id: 'uA1', unidade_nome: 'Águias',
  marca: { nome: 'Filhos da Conquista', sigla: 'FC', lema: 'Desbravadores · 1994', logo_url: '/icon-192.png' },
  recursos: { chat: true, mural: true, leilao: true }, ...o,
})
const vincB = (o = {}) => vinc({
  club_id: 'B', nome: 'Clube B', slug: 'b', papel: 'instrutor', unidade_id: 'uB1', unidade_nome: 'Lobos',
  marca: { nome: 'Clube B Oficial', sigla: 'CB', cor_primaria: '#112233' }, recursos: { chat: false, mural: true, leilao: false }, ...o,
})
const servidor = (vinculos, atual) => ({ usuario_id: 'u', clube_atual_id: atual === undefined ? (vinculos[0]?.club_id ?? null) : atual, vinculos })
const responder = (raw) => carregarContexto.mockResolvedValue(normalizarContexto(raw))

async function montar() {
  const r = renderHook(() => useClube(), { wrapper })
  await waitFor(() => expect(r.result.current.carregando).toBe(false))
  return r
}

beforeEach(() => {
  carregarContexto.mockReset()
  definirClubeAtivoNoTransporte.mockClear()
  localStorage.clear()
  document.head.innerHTML = '<meta name="theme-color" content="#1e3a8a"><link rel="icon" href="/logo.png"><title>x</title>'
  document.documentElement.removeAttribute('style')
  logar('u1')
})

describe('usuário com UM clube', () => {
  it('resolve clube, papel NO clube, unidade, marca e recursos numa vez', async () => {
    responder(servidor([vinc()]))
    const { result } = await montar()
    const c = result.current
    expect(c).toMatchObject({ clubeId: 'A', papel: 'desbravador', status: 'ativo', unidadeId: 'uA1', unidadeNome: 'Águias', semVinculo: false, erro: null, legado: false })
    expect(c.marca).toMatchObject({ nome: 'Filhos da Conquista', sigla: 'FC', lema: 'Desbravadores · 1994' })
    expect(c.temRecurso('chat')).toBe(true)
    expect(c.temRecurso('inexistente')).toBe(false)
    expect(c.vinculos).toHaveLength(1)
  })

  it('desbravador: sem gestão e sem financeiro', async () => {
    responder(servidor([vinc()]))
    const { result } = await montar()
    expect(result.current).toMatchObject({ podeGerir: false, podeFinanceiro: false, temGestao: false, ehPais: false, ehMembroAtivo: true })
  })

  it('aplica a marca do clube na página (título e cor da barra)', async () => {
    responder(servidor([vincB({ selecionavel: true })], 'B'))
    await montar()
    expect(document.title).toBe('Clube B Oficial')
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#112233')
    expect(document.documentElement.style.getPropertyValue('--marca-1')).toBe('#112233')
  })

  it('Tenant 001 sem cor própria: NENHUMA sobrescrita de cor (o tema padrão fica idêntico)', async () => {
    responder(servidor([vinc()]))
    await montar()
    expect(document.documentElement.style.getPropertyValue('--marca-1')).toBe('')
    expect(document.title).toBe('Filhos da Conquista')
  })
})

describe('liderança e responsável', () => {
  it('diretoria: gere, financeiro, gestão', async () => {
    responder(servidor([vinc({ papel: 'diretoria' })]))
    const { result } = await montar()
    expect(result.current).toMatchObject({ papel: 'diretoria', ehDiretoria: true, podeGerir: true, podeFinanceiro: true, temGestao: true })
  })
  it('instrutor: gere, mas não é diretoria nem financeiro', async () => {
    responder(servidor([vinc({ papel: 'instrutor' })]))
    const { result } = await montar()
    expect(result.current).toMatchObject({ podeGerir: true, ehDiretoria: false, podeFinanceiro: false, temGestao: true })
  })
  it('tesoureiro: financeiro sem gerir o clube', async () => {
    responder(servidor([vinc({ papel: 'tesoureiro' })]))
    const { result } = await montar()
    expect(result.current).toMatchObject({ podeFinanceiro: true, podeGerir: false, temGestao: true })
  })
  it('responsável (pais): é pais, sem gestão, sem unidade — só o portal do filho', async () => {
    responder(servidor([vinc({ papel: 'pais', unidade_id: null, unidade_nome: null })]))
    const { result } = await montar()
    expect(result.current).toMatchObject({ papel: 'pais', ehPais: true, podeGerir: false, temGestao: false, ehMembroAtivo: false, unidadeId: null })
  })
})

describe('usuário com MÚLTIPLOS clubes', () => {
  it('lista os dois; em uso fica o clube em que o SERVIDOR age', async () => {
    responder(servidor([vinc(), vincB()], 'B'))
    const { result } = await montar()
    expect(result.current.vinculos.map((v) => v.clubeId)).toEqual(['A', 'B'])
    expect(result.current.clubeId).toBe('B')
    expect(result.current.papel).toBe('instrutor')             // o papel é do VÍNCULO: no B ele é instrutor
  })

  it('o papel, a unidade, a marca e os recursos são de CADA clube (nada vaza de um para o outro)', async () => {
    responder(servidor([vinc(), vincB()], 'A'))
    const { result } = await montar()
    expect(result.current).toMatchObject({ clubeId: 'A', papel: 'desbravador', unidadeId: 'uA1' })
    expect(result.current.marca.nome).toBe('Filhos da Conquista')
    expect(result.current.temRecurso('chat')).toBe(true)
    await act(async () => { await result.current.trocarClube('B') })
    expect(result.current).toMatchObject({ clubeId: 'B', papel: 'instrutor', unidadeId: 'uB1', podeGerir: true })
    expect(result.current.marca.nome).toBe('Clube B Oficial')
    expect(result.current.temRecurso('chat')).toBe(false)      // o B desligou o chat
    expect(result.current.temRecurso('leilao')).toBe(false)
  })
})

describe('troca de clube', () => {
  it('troca quando o vínculo é ativo e o servidor age no clube; guarda a escolha e a marca acompanha', async () => {
    responder(servidor([vinc(), vincB()], 'A'))
    const { result } = await montar()
    let r
    await act(async () => { r = await result.current.trocarClube('B') })
    expect(r).toEqual({ ok: true })
    expect(result.current.clubeId).toBe('B')
    expect(document.title).toBe('Clube B Oficial')
    expect(document.documentElement.style.getPropertyValue('--marca-1')).toBe('#112233')
    expect(JSON.parse(localStorage.getItem('cq.clube.v1'))).toEqual({ uid: 'u1', clubeId: 'B' })
  })

  it('trocar de clube atualiza o header x-clube-atual (lib/supabase.js) — é o que faz o servidor honrar a troca', async () => {
    responder(servidor([vinc(), vincB()], 'A'))
    const { result } = await montar()
    expect(definirClubeAtivoNoTransporte).toHaveBeenCalledWith('A')
    await act(async () => { await result.current.trocarClube('B') })
    expect(definirClubeAtivoNoTransporte).toHaveBeenLastCalledWith('B')
  })

  it('voltar ao clube anterior remove a cor do outro (sem resto de marca)', async () => {
    responder(servidor([vinc(), vincB()], 'A'))
    const { result } = await montar()
    await act(async () => { await result.current.trocarClube('B') })
    await act(async () => { await result.current.trocarClube('A') })
    expect(result.current.clubeId).toBe('A')
    expect(document.documentElement.style.getPropertyValue('--marca-1')).toBe('')
    expect(document.title).toBe('Filhos da Conquista')
  })

  it('reabrir o app volta ao clube escolhido (por usuário)', async () => {
    responder(servidor([vinc(), vincB()], 'A'))
    const primeira = await montar()
    await act(async () => { await primeira.result.current.trocarClube('B') })
    primeira.unmount()
    const segunda = await montar()
    expect(segunda.result.current.clubeId).toBe('B')
  })

  it('outra pessoa no mesmo aparelho NÃO herda a escolha', async () => {
    responder(servidor([vinc(), vincB()], 'A'))
    const primeira = await montar()
    await act(async () => { await primeira.result.current.trocarClube('B') })
    primeira.unmount()
    logar('u2')
    const outra = await montar()
    expect(outra.result.current.clubeId).toBe('A')
  })

  it('vínculo não selecionável (ex.: servidor recusou por qualquer motivo): trocar é recusado (indisponível) e nada muda', async () => {
    responder(servidor([vinc(), vincB({ selecionavel: false })], 'A'))
    const { result } = await montar()
    let r
    await act(async () => { r = await result.current.trocarClube('B') })
    expect(r).toEqual({ ok: false, motivo: 'indisponivel' })
    expect(result.current.clubeId).toBe('A')
    expect(result.current.papel).toBe('desbravador')
    expect(localStorage.getItem('cq.clube.v1')).toBeNull()
  })

  it('a escolha guardada de um clube que deixou de ser utilizável é ignorada', async () => {
    localStorage.setItem('cq.clube.v1', JSON.stringify({ uid: 'u1', clubeId: 'B' }))
    responder(servidor([vinc(), vincB({ selecionavel: false })], 'A'))
    const { result } = await montar()
    expect(result.current.clubeId).toBe('A')
  })
})

describe('tentativa de acessar clube SEM vínculo', () => {
  it('trocar para um clube que a pessoa não tem: recusado, e o clube em uso não muda', async () => {
    responder(servidor([vinc()], 'A'))
    const { result } = await montar()
    let r
    await act(async () => { r = await result.current.trocarClube('clube-alheio') })
    expect(r).toEqual({ ok: false, motivo: 'sem_vinculo' })
    expect(result.current).toMatchObject({ clubeId: 'A', papel: 'desbravador' })
    expect(localStorage.getItem('cq.clube.v1')).toBeNull()
  })

  it('escolha guardada (adulterada) de um clube SEM vínculo nunca vira acesso', async () => {
    localStorage.setItem('cq.clube.v1', JSON.stringify({ uid: 'u1', clubeId: 'clube-alheio' }))
    responder(servidor([vinc()], 'A'))
    const { result } = await montar()
    expect(result.current.clubeId).toBe('A')
    expect(result.current.vinculos.map((v) => v.clubeId)).toEqual(['A'])
  })

  it('conta SEM nenhum vínculo: semVinculo, papel nulo, nenhuma permissão nem recurso', async () => {
    responder(servidor([], null))
    const { result } = await montar()
    const c = result.current
    expect(c).toMatchObject({ semVinculo: true, clubeId: null, papel: null, vinculo: null, erro: null })
    expect(c).toMatchObject({ podeGerir: false, podeFinanceiro: false, temGestao: false, ehPais: false, ehMembroAtivo: false, ehDiretoria: false })
    expect(c.temRecurso('chat')).toBe(false)
    expect(c.recursos).toEqual({})
  })

  it('sem vínculo, trocar para qualquer clube é recusado', async () => {
    responder(servidor([], null))
    const { result } = await montar()
    let r
    await act(async () => { r = await result.current.trocarClube('A') })
    expect(r).toEqual({ ok: false, motivo: 'sem_vinculo' })
    expect(result.current.semVinculo).toBe(true)
  })

  it('cadastro PENDENTE: aparece na lista mas não dá papel nem acesso (semVinculo)', async () => {
    responder(servidor([vinc({ status: 'pendente', selecionavel: false, papel: 'diretoria' })], null))
    const { result } = await montar()
    expect(result.current).toMatchObject({ semVinculo: true, papel: null, podeGerir: false, clubeId: null })
    expect(result.current.vinculos[0].status).toBe('pendente')
  })

  it('vínculo SUSPENSO com papel de diretoria não dá privilégio nenhum', async () => {
    responder(servidor([vinc({ status: 'suspenso', selecionavel: false, papel: 'diretoria' })], null))
    const { result } = await montar()
    expect(result.current).toMatchObject({ semVinculo: true, papel: null, podeGerir: false, podeFinanceiro: false })
  })
})

describe('falhas e sessão', () => {
  it('erro do servidor: falha FECHADA (sem papel, sem permissão) e o erro fica visível — não confunde com "sem vínculo"', async () => {
    carregarContexto.mockRejectedValue(new Error('rede caiu'))
    const { result } = await montar()
    expect(result.current.erro).toBeInstanceOf(Error)
    expect(result.current).toMatchObject({ semVinculo: false, papel: null, podeGerir: false, temGestao: false })
  })

  it('recarregar depois de um erro recupera', async () => {
    carregarContexto.mockRejectedValueOnce(new Error('rede caiu'))
    const { result } = await montar()
    responder(servidor([vinc({ papel: 'diretoria' })]))
    await act(async () => { await result.current.recarregar() })
    expect(result.current).toMatchObject({ erro: null, papel: 'diretoria' })
  })

  it('recarregar traz a marca nova (a liderança editou a identidade)', async () => {
    responder(servidor([vinc()]))
    const { result } = await montar()
    responder(servidor([vinc({ marca: { nome: 'Nome Novo', sigla: 'NN', cor_primaria: '#445566' } })]))
    await act(async () => { await result.current.recarregar() })
    expect(result.current.marca).toMatchObject({ nome: 'Nome Novo', corPrimaria: '#445566' })
    expect(document.title).toBe('Nome Novo')
  })

  it('sem sessão (login/logout): sem contexto, sem carregar, e a escolha de clube é esquecida', async () => {
    responder(servidor([vinc(), vincB()], 'A'))
    const logado = await montar()
    await act(async () => { await logado.result.current.trocarClube('B') })
    logar(null)
    logado.rerender()
    await waitFor(() => expect(logado.result.current.vinculos).toEqual([]))
    expect(logado.result.current).toMatchObject({ carregando: false, papel: null, semVinculo: false, podeGerir: false })
    await waitFor(() => expect(localStorage.getItem('cq.clube.v1')).toBeNull())
  })

  it('troca de conta: o contexto da pessoa anterior NUNCA aparece para a nova, nem enquanto carrega', async () => {
    responder(servidor([vinc({ papel: 'diretoria' })]))
    const r = await montar()
    expect(r.result.current.podeGerir).toBe(true)
    let liberar
    carregarContexto.mockReturnValue(new Promise((res) => { liberar = res }))
    logar('u2')
    r.rerender()
    expect(r.result.current).toMatchObject({ carregando: true, papel: null, podeGerir: false, clubeId: null })
    liberar(normalizarContexto(servidor([vinc({ papel: 'desbravador' })])))
    await waitFor(() => expect(r.result.current.carregando).toBe(false))
    expect(r.result.current).toMatchObject({ papel: 'desbravador', podeGerir: false })
  })

  it('resposta ATRASADA da pessoa anterior (recarregar em voo) é descartada', async () => {
    responder(servidor([vinc({ papel: 'diretoria' })]))
    const r = await montar()
    let liberarAntiga
    carregarContexto.mockReturnValueOnce(new Promise((res) => { liberarAntiga = res }))
    let pendente
    act(() => { pendente = r.result.current.recarregar() })          // u1 pede de novo...
    logar('u2')                                                      // ...e a conta troca antes da resposta
    responder(servidor([vinc({ papel: 'desbravador', club_id: 'Z' })]))
    r.rerender()
    await waitFor(() => expect(r.result.current.carregando).toBe(false))
    expect(r.result.current).toMatchObject({ clubeId: 'Z', papel: 'desbravador' })
    await act(async () => { liberarAntiga(normalizarContexto(servidor([vinc({ papel: 'diretoria' })]))); await pendente })
    expect(r.result.current).toMatchObject({ clubeId: 'Z', papel: 'desbravador', podeGerir: false })   // continua sendo o da pessoa nova
  })
})

describe('front publicado ANTES do SQL (modo legado)', () => {
  it('o serviço devolve o contexto do perfil: o app segue igual para o Tenant 001', async () => {
    carregarContexto.mockResolvedValue(contextoLegado({ perfil: { id: 'u1', papel: 'instrutor', unidade_id: 'u9', status: 'ativo' }, recursos: { leilao: true } }))
    const { result } = await montar()
    expect(result.current).toMatchObject({ legado: true, papel: 'instrutor', podeGerir: true, unidadeId: 'u9' })
    expect(result.current.marca.nome).toBe('Filhos da Conquista')
    expect(result.current.temRecurso('leilao')).toBe(true)
    expect(result.current.temRecurso('chat')).toBe(true)
  })
  it('o modo legado NÃO grava a marca "salva" (só a marca vinda do servidor entra no cache do login)', async () => {
    carregarContexto.mockResolvedValue(contextoLegado({ perfil: { id: 'u1', papel: 'desbravador', status: 'ativo' }, recursos: {} }))
    await montar()
    expect(localStorage.getItem('cq.marca.v1')).toBeNull()
  })
})

describe('marca guardada para o login', () => {
  it('a marca do clube fica guardada e a próxima abertura (antes de entrar) já mostra a dele', async () => {
    responder(servidor([vincB({ selecionavel: true })], 'B'))
    const primeira = await montar()
    primeira.unmount()
    expect(JSON.parse(localStorage.getItem('cq.marca.v1')).marca.nome).toBe('Clube B Oficial')
    logar(null)
    const semSessao = renderHook(() => useClube(), { wrapper })
    expect(semSessao.result.current.marca.nome).toBe('Clube B Oficial')
  })

  // A contrapartida, encontrada na jornada de navegador da 8.4: FECHAR o app e SAIR do app são
  // gestos diferentes. Quem fecha volta e quer ver o próprio clube (o teste acima). Quem sai está
  // entregando o aparelho — e a tela de login seguia com sigla, nome, lema, cores e "desde" do
  // clube anterior para a próxima pessoa que abrisse.
  it('SAIR limpa a marca: a tela de login não fica com o clube de quem saiu', async () => {
    responder(servidor([vincB({ selecionavel: true })], 'B'))
    const r = await montar()
    expect(r.result.current.marca.nome).toBe('Clube B Oficial')

    logar(null)
    r.rerender()
    await waitFor(() => expect(localStorage.getItem('cq.marca.v1')).toBeNull())
    // e some da TELA na mesma hora, sem depender de recarregar a página
    expect(r.result.current.marca.nome).not.toBe('Clube B Oficial')
    expect(document.title).not.toBe('Clube B Oficial')
  })
})
