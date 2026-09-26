import { describe, it, expect, vi, beforeEach } from 'vitest'

// Quem está no clube, em que unidade e com que papel vem do VÍNCULO no clube da aba (RPC
// membros_do_clube) — nunca do espelho profiles.papel/status/unidade_id, que é do clube PRIMÁRIO
// da pessoa. Estes testes montam o caso que a auditoria multi-clube achou no staging: a Lia é
// desbravadora em dois clubes; na aba do clube B ela está na unidade B1 ("Andorinhas"), mas o
// espelho dela aponta para a unidade do clube A. Ela TEM de cair na B1 em todas as telas de B.

// Vínculos do clube B (o clube da aba). O dublê da RPC filtra como o servidor filtra.
const VINCULOS_B = [
  { id: 'lia', nome: 'Lia', papel: 'desbravador', unidade_id: 'B1', status: 'ativo', teste: false, aniversario: '09-24' },
  { id: 'rui', nome: 'Rui', papel: 'desbravador', unidade_id: 'B1', status: 'ativo', teste: false, aniversario: '03-10' },
  { id: 'zeca', nome: 'Zeca', papel: 'conselheiro', unidade_id: 'B1', status: 'ativo', teste: false, aniversario: null },
  { id: 'carlos', nome: 'Carlos', papel: 'instrutor', unidade_id: null, status: 'ativo', teste: false, aniversario: '12-01' },
  { id: 'tst', nome: 'Conta Teste', papel: 'desbravador', unidade_id: 'B2', status: 'ativo', teste: true, aniversario: null },
  { id: 'mae', nome: 'Mãe da Lia', papel: 'pais', unidade_id: null, status: 'ativo', teste: false, aniversario: '09-02' },
  { id: 'nina', nome: 'Nina', papel: 'desbravador', unidade_id: 'B2', status: 'pendente', teste: false, aniversario: null },
].map((v) => ({ foto: null, avatar: null, avatar_tipo: null, ...v }))

function servidorMembros(args = {}) {
  const papeis = args.p_papeis ?? null
  const status = args.p_status ?? ['ativo']
  const busca = (args.p_busca || '').toLowerCase()
  return VINCULOS_B
    .filter((v) => (papeis ? papeis.includes(v.papel) : v.papel !== 'pais'))
    .filter((v) => !args.p_unidade_id || v.unidade_id === args.p_unidade_id)
    .filter((v) => status.includes(v.status))
    .filter((v) => !busca || v.nome.toLowerCase().includes(busca))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

// Construtor de consulta "thenable": cada método devolve ele mesmo; await devolve o resultado.
function consulta(resultado, registro) {
  const c = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'not', 'is', 'order', 'limit', 'gte', 'ilike', 'update', 'insert', 'maybeSingle', 'single']) {
    c[m] = vi.fn((...args) => { registro?.push([m, ...args]); return c })
  }
  c.then = (res, rej) => Promise.resolve(resultado).then(res, rej)
  return c
}

const UNIDADES_B = [
  { id: 'B1', nome: 'Andorinhas', cor: '#111' },
  { id: 'B2', nome: 'Águia Real', cor: '#222' },
  { id: 'B3', nome: 'Sem Ninguém', cor: '#333' },
]

let chamadasRpc, tabelasLidas, opsProfiles, respostasRpc, tabelas, sessao
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    rpc: (nome, args) => {
      chamadasRpc.push([nome, args])
      const r = respostasRpc[nome]
      return Promise.resolve(typeof r === 'function' ? r(args) : (r ?? { data: null, error: { message: `rpc ${nome} não existe no dublê` } }))
    },
    from: (tabela) => {
      tabelasLidas.push(tabela)
      // O ESPELHO contradiz o vínculo de propósito: se alguém ler daqui, o teste enxerga.
      if (tabela === 'profiles') {
        return consulta({ data: [{ id: 'lia', nome: 'Lia', papel: 'diretoria', unidade_id: 'A1', status: 'ativo' }], error: null }, opsProfiles)
      }
      return consulta(tabelas[tabela] ?? { data: [], error: null })
    },
    auth: { getSession: () => Promise.resolve({ data: { session: sessao } }) },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: null }),
        getPublicUrl: (path) => ({ data: { publicUrl: `https://arquivos.exemplo/${path}` } }),
      }),
    },
  },
}))
vi.mock('../lib/upload.js', () => ({ validarImagem: () => Promise.resolve() }))
vi.mock('../lib/imagem.js', () => ({ comprimirImagem: (f) => Promise.resolve(f) }))

const { membrosDoClube, chamadaDaUnidade, PAPEIS_DE_UNIDADE } = await import('./membros.js')
const { carregarRanking, carregarDesafiosSemana, carregarRadarFaltas } = await import('./ranking.js')
const { carregarUnidadesCompetidoras } = await import('./unidades.js')
const { listarColegasChat, mesclarMensagens } = await import('./chat.js')
const { listarColegas } = await import('./jogos.js')
const { buscarDesbravadores, carregarAniversariantes, definirTesteUsuario, atualizarFotoPerfil } = await import('./usuarios.js')
const { mensagemDeErro } = await import('../ui/index.jsx')

const argsDaRpc = (nome) => chamadasRpc.filter(([n]) => n === nome).map(([, a]) => a)

beforeEach(() => {
  chamadasRpc = []
  tabelasLidas = []
  opsProfiles = []
  sessao = { user: { id: 'carlos' } }
  respostasRpc = {
    membros_do_clube: (args) => ({ data: servidorMembros(args), error: null }),
    ranking_totais: { data: { pessoas: [{ id: 'lia', total: 50 }, { id: 'rui', total: 30 }, { id: 'carlos', total: 10 }, { id: 'tst', total: 999 }], times: [] }, error: null },
    ranking_semana: { data: { inicio: '2026-09-21', pessoas: [{ id: 'lia', total: 20 }, { id: 'tst', total: 500 }], times: [] }, error: null },
  }
  tabelas = { unidades: { data: UNIDADES_B, error: null } }
})

describe('membrosDoClube: só manda o que a tela pediu (o resto é o padrão do servidor)', () => {
  it('sem opções: nenhum parâmetro (todos os papéis menos pais, só vínculo ativo)', async () => {
    await membrosDoClube()
    expect(argsDaRpc('membros_do_clube')).toEqual([{}])
  })
  it('com filtros: papéis, unidade, status e busca aparada', async () => {
    await membrosDoClube({ papeis: PAPEIS_DE_UNIDADE, unidadeId: 'B1', status: ['ativo', 'pendente'], busca: '  li ' })
    expect(argsDaRpc('membros_do_clube')).toEqual([
      { p_papeis: ['desbravador', 'conselheiro'], p_unidade_id: 'B1', p_status: ['ativo', 'pendente'], p_busca: 'li' },
    ])
  })
  it('erro do servidor sobe (a tela decide o que mostrar; nunca vira "ninguém no clube" calado)', async () => {
    respostasRpc.membros_do_clube = { data: null, error: { message: 'Sem vínculo ativo neste clube.' } }
    await expect(membrosDoClube()).rejects.toThrow('Sem vínculo ativo')
  })
})

describe('a criança de dois clubes cai na unidade do VÍNCULO no clube da aba (B1), não na do espelho', () => {
  it('ranking: a Lia está na B1, conta na média da B1 e aparece como "Andorinhas" no individual', async () => {
    const { unidades, individual } = await carregarRanking()
    const b1 = unidades.find((u) => u.id === 'B1')
    expect(b1.membros.map((m) => m.id)).toEqual(['lia', 'rui', 'zeca'])
    expect(b1.membros.find((m) => m.id === 'lia').papel).toBe('desbravador')
    expect(b1.membros.find((m) => m.id === 'lia').pts).toBe(50)
    const lia = individual.find((p) => p.id === 'lia')
    expect(lia).toMatchObject({ unidade: 'Andorinhas', papel: 'desbravador', pts: 50 })
    // líder sem unidade só no individual; conta de teste e responsável fora de tudo
    expect(individual.find((p) => p.id === 'carlos').unidade).toBe('')
    expect(individual.map((p) => p.id)).not.toContain('tst')
    expect(individual.map((p) => p.id)).not.toContain('mae')
    expect(unidades.find((u) => u.id === 'B2').membros).toEqual([])
    expect(tabelasLidas).not.toContain('profiles')
  })

  it('corrida da semana: os pontos da Lia puxam a B1 para a frente (e a conta de teste não)', async () => {
    const { inicio, unidades } = await carregarDesafiosSemana()
    expect(inicio).toBe('2026-09-21')
    expect(unidades[0].id).toBe('B1')
    expect(unidades[0].membros.map((m) => m.id)).toContain('lia')
    expect(unidades.find((u) => u.id === 'B2').pontos).toBe(0)
    expect(tabelasLidas).not.toContain('profiles')
  })

  it('Modo Acampamento: a B1 é competidora por causa do vínculo (B3 sem ninguém fica fora)', async () => {
    const us = await carregarUnidadesCompetidoras()
    expect(argsDaRpc('membros_do_clube')).toEqual([{ p_papeis: ['desbravador', 'conselheiro'] }])
    expect(us.map((u) => u.id)).toEqual(['B1', 'B2'])
    expect(tabelasLidas).not.toContain('profiles')
  })

  it('chamada da B1 para o conselheiro: só desbravadores, com a Lia dentro', async () => {
    const lista = await chamadaDaUnidade('B1', { soDesbravadores: true })
    expect(argsDaRpc('membros_do_clube')).toEqual([{ p_unidade_id: 'B1', p_papeis: ['desbravador'] }])
    expect(lista.map((p) => p.id)).toEqual(['lia', 'rui'])
    expect(tabelasLidas).not.toContain('profiles')
  })

  it('chamada da B1 para a liderança: todo mundo da unidade (menos pais), desbravadores antes, selo do papel DAQUI', async () => {
    const lista = await chamadaDaUnidade('B1')
    expect(argsDaRpc('membros_do_clube')).toEqual([{ p_unidade_id: 'B1' }])
    expect(lista.map((p) => [p.id, p.papel])).toEqual([['lia', 'desbravador'], ['rui', 'desbravador'], ['zeca', 'conselheiro']])
  })

  it('chamada: conta de teste fica fora e sem unidade não chama o servidor', async () => {
    const b2 = await chamadaDaUnidade('B2')
    expect(b2).toEqual([])
    chamadasRpc = []
    expect(await chamadaDaUnidade('')).toEqual([])
    expect(chamadasRpc).toEqual([])
  })
})

describe('listas de seleção pelo vínculo do clube da aba', () => {
  it('colegas do chat: desbravadores/conselheiros ativos daqui, sem a própria pessoa', async () => {
    const colegas = await listarColegasChat('lia')
    expect(argsDaRpc('membros_do_clube')).toEqual([{ p_papeis: ['desbravador', 'conselheiro'] }])
    expect(colegas.map((c) => c.id)).toEqual(['tst', 'rui', 'zeca'])
    expect(tabelasLidas).not.toContain('profiles')
  })

  it('amigos para pedir ajuda: todos menos pais, sem a própria pessoa', async () => {
    const amigos = await listarColegas('lia')
    expect(argsDaRpc('membros_do_clube')).toEqual([{}])
    expect(amigos.map((c) => c.id).sort()).toEqual(['carlos', 'rui', 'tst', 'zeca'])
    expect(tabelasLidas).not.toContain('profiles')
  })

  it('busca do filho (VinculosPais): ativo OU pendente neste clube, pela busca do servidor', async () => {
    const achados = await buscarDesbravadores('ni')
    expect(argsDaRpc('membros_do_clube')).toEqual([{ p_papeis: ['desbravador', 'conselheiro'], p_status: ['ativo', 'pendente'], p_busca: 'ni' }])
    expect(achados.map((p) => p.id)).toEqual(['nina'])
  })

  it('busca do filho: devolve no máximo 20', async () => {
    respostasRpc.membros_do_clube = { data: Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, nome: `Criança ${i}` })), error: null }
    expect(await buscarDesbravadores('')).toHaveLength(20)
  })

  it('aniversariantes: só dia e mês (MM-DD), nunca a data completa, e sem responsáveis', async () => {
    const lista = await carregarAniversariantes()
    expect(lista).toEqual([
      { id: 'carlos', nome: 'Carlos', foto: null, aniversario: '12-01' },
      { id: 'lia', nome: 'Lia', foto: null, aniversario: '09-24' },
      { id: 'rui', nome: 'Rui', foto: null, aniversario: '03-10' },
    ])
    expect(lista.some((p) => 'nascimento' in p)).toBe(false)
  })
})

describe('radar de faltas: só quem tem vínculo ATIVO neste clube', () => {
  it('quem saiu deste clube (mas segue ativo em outro) não recebe "sentimos sua falta"', async () => {
    tabelas.pontos = {
      data: [
        { usuario_id: 'lia', data: '2026-09-20', marca: { presenca: 'faltou' } },
        { usuario_id: 'ex', data: '2026-09-20', marca: { presenca: 'faltou' } },
        { usuario_id: 'lia', data: '2026-09-13', marca: { presenca: 'faltou' } },
        { usuario_id: 'ex', data: '2026-09-13', marca: { presenca: 'faltou' } },
        { usuario_id: 'ex', data: '2026-09-06', marca: { presenca: 'faltou' } },
        { usuario_id: 'rui', data: '2026-09-20', marca: { presenca: 'naHora' } },
      ],
      error: null,
    }
    const radar = await carregarRadarFaltas()
    expect(radar).toEqual([{ id: 'lia', nome: 'Lia', foto: null, faltas: 2, ultima: '2026-09-20' }])
    expect(tabelasLidas).not.toContain('profiles')
  })

  it('falta JUSTIFICADA no Cantinho da unidade não conta como "sumindo"', async () => {
    tabelas.pontos = {
      data: [
        { usuario_id: 'lia', data: '2026-09-20', marca: { presenca: 'faltou' } },
        { usuario_id: 'lia', data: '2026-09-13', marca: { presenca: 'faltou' } },
      ],
      error: null,
    }
    respostasRpc.cantinho_justificativas_do_clube = { data: [{ usuario_id: 'lia', data: '2026-09-13' }], error: null }
    expect(await carregarRadarFaltas()).toEqual([])
  })
})

describe('liderança mexendo no perfil de OUTRA pessoa: por RPC, não por UPDATE em profiles', () => {
  it('modo teste: chama membro_definir_teste', async () => {
    respostasRpc.membro_definir_teste = { data: null, error: null }
    expect(await definirTesteUsuario('lia', 1)).toEqual({ id: 'lia', teste: true })
    expect(argsDaRpc('membro_definir_teste')).toEqual([{ p_usuario_id: 'lia', p_teste: true }])
    expect(tabelasLidas).not.toContain('profiles')
  })

  it('modo teste: a recusa para quem está em dois clubes chega à pessoa com o porquê', async () => {
    const recusa = 'Esta pessoa também participa de outro clube: a marcação de teste vale para todos os clubes dela.'
    respostasRpc.membro_definir_teste = { data: null, error: { message: recusa } }
    const erro = await definirTesteUsuario('lia', true).catch((e) => e)
    expect(erro.message).toBe(recusa)
    expect(mensagemDeErro(erro, 'Não consegui aplicar a mudança.')).toMatch(/também participa de outro clube/)
    // e não confunde com os outros erros de "outro clube" que já existiam
    expect(mensagemDeErro(new Error('A unidade escolhida pertence a outro clube.'))).not.toMatch(/também participa/)
  })

  it('foto de OUTRO membro: chama membro_definir_foto com a URL enviada', async () => {
    respostasRpc.membro_definir_foto = { data: null, error: null }
    const url = await atualizarFotoPerfil({ userId: 'lia', file: { type: 'image/jpeg', name: 'x.jpg' } })
    expect(argsDaRpc('membro_definir_foto')).toEqual([{ p_usuario_id: 'lia', p_foto: url }])
    expect(url).toMatch(/^https:\/\/arquivos\.exemplo\/perfis\/lia-\d+\.jpg$/)
    expect(tabelasLidas).not.toContain('profiles')
  })

  it('foto de OUTRO membro: a recusa do servidor sobe como erro', async () => {
    respostasRpc.membro_definir_foto = { data: null, error: { message: 'Esta pessoa também participa de outro clube.' } }
    await expect(atualizarFotoPerfil({ userId: 'lia', file: { type: 'image/jpeg', name: 'x.jpg' } })).rejects.toThrow('outro clube')
  })

  it('a PRÓPRIA foto continua sendo o UPDATE do próprio perfil (sem RPC de liderança)', async () => {
    sessao = { user: { id: 'lia' } }
    await atualizarFotoPerfil({ userId: 'lia', file: { type: 'image/jpeg', name: 'x.jpg' } })
    expect(argsDaRpc('membro_definir_foto')).toEqual([])
    expect(opsProfiles.map(([m]) => m)).toEqual(['update', 'eq'])
    expect(opsProfiles[1]).toEqual(['eq', 'id', 'lia'])
  })
})

describe('chat: a releitura (fallback do tempo real) não duplica mensagens', () => {
  const m = (id, quando, extra = {}) => ({ id, autor_id: 'u1', texto: id, created_at: quando, apagada: false, autor: { nome: 'Ana' }, ...extra })

  it('junta por id e mantém a ordem de chegada', () => {
    const tela = [m('m1', '2026-09-24T10:00:00Z'), m('m2', '2026-09-24T10:01:00Z')]
    const servidor = [m('m1', '2026-09-24T10:00:00Z'), m('m2', '2026-09-24T10:01:00Z'), m('m3', '2026-09-24T10:02:00Z')]
    expect(mesclarMensagens(tela, servidor).map((x) => x.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('a versão do servidor vence (mensagem apagada pela liderança) e o que só está na tela fica', () => {
    const tela = [m('m1', '2026-09-24T10:00:00Z'), m('m9', '2026-09-24T10:05:00Z')]
    const servidor = [m('m1', '2026-09-24T10:00:00Z', { apagada: true, texto: null })]
    const r = mesclarMensagens(tela, servidor)
    expect(r.map((x) => [x.id, x.apagada])).toEqual([['m1', true], ['m9', false]])
  })

  it('nada mudou: devolve a MESMA lista (a releitura periódica não redesenha a conversa)', () => {
    const tela = [m('m1', '2026-09-24T10:00:00Z')]
    expect(mesclarMensagens(tela, [m('m1', '2026-09-24T10:00:00Z')])).toBe(tela)
  })

  it('mensagem que chegou pelo tempo real sem autor ganha o autor da releitura', () => {
    const tela = [m('m1', '2026-09-24T10:00:00Z', { autor: undefined })]
    const r = mesclarMensagens(tela, [m('m1', '2026-09-24T10:00:00Z')])
    expect(r[0].autor).toEqual({ nome: 'Ana' })
  })
})
