import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, it, expect } from 'vitest'
import { FERRAMENTAS, PAPEIS_POR_ROTA, RECURSO_POR_ROTA } from './permissoes.js'
import { RECURSOS_PADRAO } from './clube.js'

// Trava, no CI, as decisões da camada de produto multi-clube: o app pergunta ao ClubeContext (vínculo no clube em uso), nunca ao perfil
// global, e não conhece nenhum clube pelo nome. Se um destes testes falhar, alguém reintroduziu uma suposição de "clube único".
const RAIZ = join(process.cwd(), 'src')

function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho]
  })
}
const codigo = arquivos(RAIZ)
  .filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.(js|jsx)$/.test(f))
  .map((f) => ({ arquivo: relative(RAIZ, f).split(sep).join('/'), texto: readFileSync(f, 'utf8') }))
const ler = (rel) => readFileSync(join(RAIZ, rel), 'utf8')

describe('o app não assume papel nem unidade GLOBAIS do perfil', () => {
  it('nenhum arquivo lê profile.papel / profile?.papel (o papel é do VÍNCULO: useClube().papel)', () => {
    const achados = codigo.filter((c) => /\bprofile\??\.papel\b/.test(c.texto)).map((c) => c.arquivo)
    expect(achados).toEqual([])
  })
  it('nenhum arquivo lê profile.unidade_id / profile?.unidade_id (a unidade é do vínculo: useClube().unidadeId)', () => {
    const achados = codigo.filter((c) => /\bprofile\??\.unidade_id\b/.test(c.texto)).map((c) => c.arquivo)
    expect(achados).toEqual([])
  })
  it('a varredura enxerga o código (não passa no vazio)', () => {
    expect(codigo.length).toBeGreaterThan(80)
    expect(codigo.some((c) => c.arquivo === 'pages/Chat.jsx')).toBe(true)
  })
  it('o papel e a unidade vêm do contexto nas telas que precisam deles', () => {
    for (const tela of ['pages/Gestao.jsx', 'pages/Chat.jsx', 'pages/Leilao.jsx', 'components/Duelos.jsx', 'pages/Apontamentos.jsx', 'pages/Perfil.jsx']) {
      expect(ler(tela), tela).toMatch(/useClube\(\)/)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Listas de pessoas nunca pelo ESPELHO profiles.
//
// profiles é a única tabela de pessoas cuja RLS é por PESSOA (enxerga quem divide QUALQUER clube
// com você), e profiles.papel/status/unidade_id são um espelho do clube PRIMÁRIO da pessoa. Toda
// tela que filtrava ou agrupava por essas colunas errava duas vezes para quem está em dois clubes:
// trazia gente do outro clube e punha a criança na unidade do clube primário (ela sumia da chamada,
// do ranking e das unidades competidoras do clube secundário). A fonte certa é a RPC
// membros_do_clube (services/membros.js), com papel/unidade/status do VÍNCULO no clube da aba.
//
// Continua permitido ler profiles por id para nome, foto e avatar (autor de mensagem, etc.).
// ---------------------------------------------------------------------------------------------
const COLUNAS_DO_ESPELHO = /^(\*|status|papel|unidade_id)$/
const ARG = String.raw`(?:[^()]|\((?:[^()]|\([^()]*\))*\))*` // argumentos com até 2 níveis de parênteses
const CADEIA = new RegExp(String.raw`\.from\(\s*(['"\`])profiles\1\s*\)((?:\s*\.\s*\w+\s*\(${ARG}\))*)`, 'g')
const VARIAVEL = /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?supabase\s*\.from\(\s*(['"`])profiles\2\s*\)/g
const FILTRO = /\.\s*(?:eq|neq|in|not|is|filter|gt|gte|lt|lte|like|ilike)\s*\(\s*(['"`])(status|papel|unidade_id)\1/
const FILTRO_MATCH = /\.\s*match\s*\(\s*\{[^}]*\b(status|papel|unidade_id)\s*:/
const SELECT = /\.\s*select\s*\(\s*(?:(['"`])([^'"`]*)\1)?\s*[,)]/g
const EMBED = /[\s,'"`:(]profiles(?:!\w+){0,2}\s*\(([^()]*)\)/g
// colunas de um select do PostgREST: "a, b:c, d::text" -> ['a', 'c', 'd']
const colunasDe = (lista) => lista.split(',').map((c) => c.trim().split('::')[0].split(':').pop().trim()).filter(Boolean)
const trazEspelho = (lista) => colunasDe(lista).some((c) => COLUNAS_DO_ESPELHO.test(c))

// Devolve os motivos pelos quais o texto lê o espelho. Vazio = limpo.
export function leituraDoEspelho(texto) {
  const motivos = []
  for (const [, , cadeia] of texto.matchAll(CADEIA)) {
    if (FILTRO.test(cadeia) || FILTRO_MATCH.test(cadeia)) motivos.push(`filtro por papel/status/unidade_id: from('profiles')${cadeia.slice(0, 120)}`)
    for (const [, , colunas] of cadeia.matchAll(SELECT)) {
      // .select() sem argumento é '*' no supabase-js
      if (colunas === undefined || trazEspelho(colunas)) motivos.push(`select traz papel/status/unidade_id: from('profiles')${cadeia.slice(0, 120)}`)
    }
  }
  // consulta montada em partes: const q = supabase.from('profiles')...; q.eq('status', ...)
  for (const [, nome] of texto.matchAll(VARIAVEL)) {
    const uso = new RegExp(String.raw`\b${nome}\s*${FILTRO.source.slice(0)}`)
    if (uso.test(texto)) motivos.push(`filtro por papel/status/unidade_id na consulta montada em '${nome}'`)
  }
  // embutido em outra consulta: pessoa:profiles!usuario_id(nome, status)
  for (const [trecho, colunas] of texto.matchAll(EMBED)) {
    if (trazEspelho(colunas)) motivos.push(`profiles embutido com papel/status/unidade_id: ${trecho.trim()}`)
  }
  return motivos
}

// Exceção EXPLÍCITA (e só esta):
//  * services/clubes.js — fallback legado de carregarContexto para quando a RPC meu_contexto não
//    existe (banco anterior à migration 33). Lê a própria pessoa; sai quando todo ambiente tiver a 33+.
// context/Auth.jsx era a outra (select('*') do próprio perfil). Desde a migration 86 ele lê pela RPC
// meu_perfil, e o fallback dele pede colunas explícitas sem papel/status/unidade_id — deixou de
// precisar de exceção e passa pela regra como todo mundo.
const EXCECOES_DO_ESPELHO = ['services/clubes.js']

describe('listas de pessoas vêm do VÍNCULO no clube da aba, nunca do espelho profiles', () => {
  it('nenhum arquivo (fora das exceções) filtra ou seleciona profiles por papel/status/unidade_id', () => {
    const achados = codigo
      .filter((c) => !EXCECOES_DO_ESPELHO.includes(c.arquivo))
      .flatMap((c) => leituraDoEspelho(c.texto).map((m) => `${c.arquivo}: ${m}`))
    expect(achados).toEqual([])
  })

  it('as exceções existem e continuam sendo só leitura da PRÓPRIA pessoa (por id)', () => {
    for (const arq of EXCECOES_DO_ESPELHO) {
      const texto = ler(arq)
      expect(texto, arq).toMatch(/from\(\s*'profiles'\s*\)/)
      const cadeias = [...texto.matchAll(CADEIA)].map((m) => m[2])
      for (const cadeia of cadeias) expect(cadeia, arq).toMatch(/\.eq\(\s*'id'\s*,/)
    }
  })

  // O detector precisa pegar o código que CAUSOU os achados da auditoria multi-clube — se um
  // destes deixar de ser pego, a trava acima passa a ser decorativa.
  it.each([
    ['ranking (select * + filtro)', "supabase.from('profiles').select('*').eq('status', 'ativo').neq('papel', 'pais'),"],
    ['mensalidades', "await supabase.from('profiles').select('id,nome,foto,papel')\n        .eq('status', 'ativo').in('papel', ['desbravador', 'conselheiro']).order('nome')"],
    ['unidades competidoras (.not em unidade_id)', "supabase.from('profiles').select('unidade_id').eq('status', 'ativo').in('papel', ['desbravador', 'conselheiro']).not('unidade_id', 'is', null),"],
    ['chamada montada em partes (Apontamentos)', "const qPessoas = supabase.from('profiles').select('*')\n      .eq('unidade_id', unidadeId).eq('status', 'ativo')\n    if (ehAdmin) qPessoas.neq('papel', 'pais')\n    else qPessoas.eq('papel', 'desbravador')"],
    ['busca com let q = ... (VinculosPais)', "let q = supabase.from('profiles')\n    .select('id,nome,foto').order('nome').limit(20)\n  if (termo) q = q.in('papel', ['desbravador'])"],
    ['radar de faltas (embutido)', ".select('usuario_id, data, marca, pessoa:profiles!usuario_id(nome, foto, status)')"],
    ['embutido com alias e cast', ".select('id, autor:profiles!usuario_id(nome, u:unidade_id::text)')"],
    ['portão do login (select status por id)', "await supabase.from('profiles').select('status').eq('id', data.user.id).single()"],
    ['lookup por id que traz a unidade do espelho', "await supabase.from('profiles').select('id,nome,foto,unidade_id').in('id', outroIds)"],
    ['select() sem argumento', "supabase.from('profiles').select().eq('id', x)"],
    ['contagem por status', "supabase.from('profiles').select('id', head).eq('status', 'pendente'),"],
    ['aspas duplas e match', 'supabase.from("profiles").select("id").match({ status: "ativo" })'],
  ])('pega o código antigo: %s', (_, trecho) => {
    expect(leituraDoEspelho(trecho)).not.toEqual([])
  })

  it.each([
    ['autores do chat por id', "await supabase.from('profiles').select('id,nome,foto').in('id', autorIds)"],
    ['autor único por id', "await supabase.from('profiles').select('id,nome,foto').eq('id', nova.autor_id).single()"],
    ['foto da própria pessoa', "await supabase.from('profiles').update({ foto: pub.publicUrl }).eq('id', userId)"],
    ['notificações vistas', "await supabase.from('profiles').update({ notif_visto_em: agora }).eq('id', userId)"],
    ['nome embutido', ".select('id, texto, autor:profiles!usuario_id(nome)')"],
    ['unidade embutida de OUTRA tabela', ".select('id,pessoa:profiles!usuario_id(nome),unidade:unidades!unidade_id(nome)')"],
    ['status de outra tabela', "supabase.from('entregas').select('id', head).eq('status', 'pendente')"],
    ['a RPC nova', "supabase.rpc('membros_do_clube', { p_papeis: ['desbravador'] })"],
  ])('não acusa o que é permitido: %s', (_, trecho) => {
    expect(leituraDoEspelho(trecho)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// A data de nascimento só pela RPC meu_perfil (migration 86).
//
// A policy de profiles deixa ler a linha de quem divide QUALQUER clube com você, e o grant de
// SELECT era da tabela inteira: qualquer desbravador lia pela API a data de nascimento completa
// das outras crianças. A 86 tira `nascimento` do SELECT direto (revoke da tabela + grant por
// coluna) e entrega a própria linha, com o nascimento, pela RPC meu_perfil().
//
// Consequência para o front, e é o que esta trava protege: um select('*') ou select() em profiles
// — ou um embutido profiles!fk(*) — passa a dar "permission denied" e quebra a tela inteira (no
// Auth, quebraria o login de todo mundo). Pedir `nascimento` pela tabela também.
// ---------------------------------------------------------------------------------------------
const COLUNAS_FORA_DA_TABELA = /^(\*|nascimento)$/
const SELECT_ABRE = /\.\s*select\s*\(/g
// coluna que o contrato não consegue ler (vem de variável/template): pode ser qualquer coisa
const colunaOpaca = (c) => c.includes('${')

export function leituraDoNascimento(texto) {
  const motivos = []
  for (const [, , cadeia] of texto.matchAll(CADEIA)) {
    const literais = [...cadeia.matchAll(SELECT)]
    // .select(COLUNAS) com constante: o SELECT acima só casa string literal — sem esta conta, uma
    // constante com '*' passaria calada
    if ((cadeia.match(SELECT_ABRE) || []).length > literais.length) {
      motivos.push(`select em profiles com colunas fora de uma string literal: from('profiles')${cadeia.slice(0, 120)}`)
    }
    for (const [, , colunas] of literais) {
      const cols = colunas === undefined ? ['*'] : colunasDe(colunas)   // .select() sem argumento é '*'
      if (cols.some((c) => COLUNAS_FORA_DA_TABELA.test(c) || colunaOpaca(c))) {
        motivos.push(`select em profiles com '*' ou nascimento: from('profiles')${cadeia.slice(0, 120)}`)
      }
    }
  }
  for (const [trecho, colunas] of texto.matchAll(EMBED)) {
    if (colunasDe(colunas).some((c) => COLUNAS_FORA_DA_TABELA.test(c) || colunaOpaca(c))) {
      motivos.push(`profiles embutido com '*' ou nascimento: ${trecho.trim()}`)
    }
  }
  return motivos
}

describe('a data de nascimento sai só pela RPC meu_perfil, nunca por select em profiles', () => {
  it('nenhum arquivo (SEM exceções) lê profiles com * ou nascimento', () => {
    const achados = codigo.flatMap((c) => leituraDoNascimento(c.texto).map((m) => `${c.arquivo}: ${m}`))
    expect(achados).toEqual([])
  })

  it('o Auth carrega o perfil da própria pessoa pela RPC meu_perfil', () => {
    const auth = ler('context/Auth.jsx')
    expect(auth).toMatch(/\.rpc\(\s*'meu_perfil'\s*\)/)
    expect(leituraDoNascimento(auth)).toEqual([])
  })

  it.each([
    ['o Auth antigo', "await supabase.from('profiles').select('*').eq('id', id).single()"],
    ['select() sem argumento', "supabase.from('profiles').select().eq('id', x)"],
    ['nascimento pedido pelo nome', "supabase.from('profiles').select('id,nome,nascimento').in('id', ids)"],
    ['nascimento com alias e cast', "supabase.from('profiles').select('id, n:nascimento::text')"],
    ['colunas numa constante', "supabase.from('profiles').select(COLUNAS).eq('id', id)"],
    ['colunas num template', 'supabase.from(\'profiles\').select(`id,${extra}`)'],
    ['embutido com *', ".select('id, autor:profiles!usuario_id(*)')"],
    ['embutido com nascimento', ".select('id, pessoa:profiles!usuario_id(nome, nascimento)')"],
  ])('pega: %s', (_, trecho) => {
    expect(leituraDoNascimento(trecho)).not.toEqual([])
  })

  it.each([
    ['a RPC nova', "await supabase.rpc('meu_perfil')"],
    ['colunas explícitas por id', "await supabase.from('profiles').select('id,nome,foto').in('id', autorIds)"],
    ['embutido só com nome', ".select('id, texto, autor:profiles!usuario_id(nome)')"],
    ['update da própria foto', "await supabase.from('profiles').update({ foto: pub.publicUrl }).eq('id', userId)"],
    ['* de OUTRA tabela', "supabase.from('recursos_catalogo').select('*').order('ordem')"],
  ])('não acusa: %s', (_, trecho) => {
    expect(leituraDoNascimento(trecho)).toEqual([])
  })
})

describe('o app não conhece nenhum clube pelo nome', () => {
  it('"Filhos da Conquista", o lema e o ano do Tenant 001 só existem em lib/marca.js (a MARCA_LEGADA de compatibilidade)', () => {
    const achados = codigo
      .filter((c) => c.arquivo !== 'lib/marca.js')
      .filter((c) => /Filhos da Conquista|Desbravadores · 1994|Desde 1994|icon-192/.test(c.texto))
      .map((c) => c.arquivo)
    expect(achados).toEqual([])
  })
  it('as telas que mostram a marca leem do contexto (menu, login, logo)', () => {
    expect(ler('components/AppLayout.jsx')).toMatch(/marca\.nome/)
    expect(ler('pages/Login.jsx')).toMatch(/marca\.nome/)
    expect(ler('components/Logo.jsx')).toMatch(/marca\.logoUrl/)
  })
  it('as cores do tema aceitam a marca do clube (e sem marca ficam as de sempre)', () => {
    const css = ler('index.css')
    expect(css).toMatch(/--c-brand:\s*var\(--marca-1, #3b5bfd\)/)
    expect(css).toMatch(/--c-brand2:\s*var\(--marca-2, #12c6ff\)/)
    expect(css).toMatch(/--c-brand:\s*var\(--marca-1-dark, #5f7bff\)/)
  })
})

describe('recursos (feature flags) e rotas', () => {
  // só a árvore de rotas do APP: o site público (RotasDoSite) tem um /planos próprio, que é a vitrine
  const app = ler('App.jsx').split('export default function App')[1]
  const rotaDe = (caminho) => app.match(new RegExp(`<Route path="${caminho}" element=\\{([^\\n]*)\\} />`))?.[1] || ''

  it('todo recurso citado na matriz existe no catálogo', () => {
    for (const [rota, recurso] of Object.entries(RECURSO_POR_ROTA)) {
      expect(Object.keys(RECURSOS_PADRAO), `${rota} -> ${recurso}`).toContain(recurso)
    }
  })
  it('toda rota com recurso está PROTEGIDA em App.jsx (RecursoOpcional para telas abertas; RotaRestrita para ferramentas)', () => {
    for (const [rota, recurso] of Object.entries(RECURSO_POR_ROTA)) {
      const el = rotaDe(rota)
      expect(el, `rota ${rota} não encontrada em App.jsx`).not.toBe('')
      const guardada = el.includes(`<RecursoOpcional recurso="${recurso}">`) || el.includes('<RotaRestrita>')
      expect(guardada, `${rota} deveria exigir o recurso "${recurso}"`).toBe(true)
    }
  })
  it('toda ferramenta da Gestão tem rota embrulhada em RotaRestrita', () => {
    for (const f of FERRAMENTAS) {
      expect(rotaDe(f.to), f.to).toContain('<RotaRestrita>')
    }
  })
  it('a ferramenta de identidade e recursos existe e é da liderança', () => {
    expect(PAPEIS_POR_ROTA['/clube']).toEqual(['diretoria', 'instrutor'])
  })
})

describe('montagem do app', () => {
  it('o ClubeProvider é montado DENTRO do AuthProvider (precisa da sessão) e envolve o App', () => {
    const main = ler('main.jsx')
    const a = main.indexOf('<AuthProvider>')
    const c = main.indexOf('<ClubeProvider>')
    const app = main.indexOf('<App />')
    expect(a).toBeGreaterThan(-1)
    expect(c).toBeGreaterThan(a)
    expect(app).toBeGreaterThan(c)
  })
  it('só entra no app quem passa pelo porteiro do clube (ClubeGuard dentro do Protegido)', () => {
    expect(ler('App.jsx')).toMatch(/<ClubeGuard>\{children\}<\/ClubeGuard>/)
  })
  it('o contexto antigo de recursos saiu (uma fonte só)', () => {
    expect(existsSync(join(RAIZ, 'context', 'Recursos.jsx'))).toBe(false)
    expect(codigo.filter((c) => /useRecursos|RecursosProvider/.test(c.texto)).map((c) => c.arquivo)).toEqual([])
  })
})
