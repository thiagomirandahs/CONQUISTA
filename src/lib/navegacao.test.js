import { describe, it, expect } from 'vitest'
import {
  destinosDoPapel, destinosSemClube, gruposDoMenuLateral, itensDoHub,
  HUB_JORNADA, HUB_CLUBE, HUB_JOGOS, rotaInicial, RECURSO_POR_ROTA, rotaLiberada, descricaoDaJornada,
} from './navegacao.js'
import { permissoesDoPapel, RECURSOS_PADRAO, PAPEIS } from './clube.js'

// Navegação por JORNADA (fase 7): no máximo 5 destinos, que mudam conforme o papel.
// A auditoria mediu 16–17 itens de menu, com 8 abaixo da dobra a 360px. Estes testes travam o
// tamanho da barra e garantem que nenhuma tela sumiu do produto — ela só mudou de porta.
const rotas = (l) => l.map((x) => x.to)
const tudoLigado = () => true
const ligados = (mapa) => (chave) => mapa[chave] === true

describe('destinos por papel', () => {
  it('a barra NUNCA passa de 5 destinos, em nenhum papel', () => {
    for (const papel of PAPEIS) {
      const d = destinosDoPapel(permissoesDoPapel(papel), tudoLigado)
      expect(d.length, papel).toBeLessThanOrEqual(5)
      expect(d.length, papel).toBeGreaterThanOrEqual(2)
    }
  })

  it('desbravador: Início, Jornada, Clube, Jogos e Eu — nunca Gestão', () => {
    const d = rotas(destinosDoPapel(permissoesDoPapel('desbravador'), tudoLigado))
    expect(d).toEqual(['/inicio', '/jornada', '/meu-clube', '/jogos', '/eu'])
    expect(d).not.toContain('/gestao')
  })

  it('quem tem gestão troca Jogos por Gestão (os jogos passam a viver dentro de Clube)', () => {
    for (const papel of ['diretoria', 'instrutor', 'tesoureiro', 'conselheiro']) {
      const d = rotas(destinosDoPapel(permissoesDoPapel(papel), tudoLigado))
      expect(d, papel).toEqual(['/inicio', '/jornada', '/meu-clube', '/gestao', '/eu'])
    }
  })

  it('responsável: só os filhos e o Eu — nunca o app do clube', () => {
    const d = rotas(destinosDoPapel(permissoesDoPapel('pais'), tudoLigado))
    expect(d).toEqual(['/meu-filho', '/eu'])
  })

  it('sem papel (sem vínculo ativo) não ganha Gestão — falha fechada', () => {
    const d = rotas(destinosDoPapel(permissoesDoPapel(null), () => false))
    expect(d).not.toContain('/gestao')
  })
})

describe('quem não tem clube nenhum', () => {
  it('coordenador institucional recebe o portal E a opção de abrir clube', () => {
    expect(rotas(destinosSemClube({ temEscopo: true }))).toEqual(['/institucional', '/criar-clube'])
  })
  it('fundador recém-cadastrado recebe o onboarding (antes não havia NENHUM link no app)', () => {
    expect(rotas(destinosSemClube({ temEscopo: false }))).toEqual(['/criar-clube'])
  })
})

describe('hubs: nenhuma tela sumiu, só mudou de porta', () => {
  it('os três hubs juntos cobrem as telas que eram abas do menu antigo', () => {
    const todas = rotas([...HUB_JORNADA, ...HUB_CLUBE, ...HUB_JOGOS])
    for (const antiga of ['/ranking', '/desafios', '/chefao', '/missoes', '/trilha', '/leilao', '/chat',
      '/biblia', '/bichinho', '/agenda', '/atividades', '/unidades', '/mural', '/experiencias',
      '/minha-classe', '/minhas-especialidades']) {
      expect(todas, antiga).toContain(antiga)
    }
  })

  it('o hub respeita o recurso desligado pelo clube', () => {
    const semChat = itensDoHub(HUB_CLUBE, ligados({ ...RECURSOS_PADRAO, chat: false }))
    expect(rotas(semChat)).not.toContain('/chat')
    expect(rotas(semChat)).toContain('/ranking')       // núcleo continua
  })

  it('clube com tudo desligado ainda mostra o núcleo do hub do clube', () => {
    expect(rotas(itensDoHub(HUB_CLUBE, () => false))).toEqual(['/ranking', '/unidades'])
    expect(itensDoHub(HUB_JOGOS, () => false)).toHaveLength(0)
  })

  it('toda tela de recurso dos hubs está no mapa de recursos por rota', () => {
    for (const item of [...HUB_JORNADA, ...HUB_CLUBE, ...HUB_JOGOS]) {
      if (item.recurso) expect(RECURSO_POR_ROTA[item.to], item.to).toBe(item.recurso)
    }
  })
})

describe('menu lateral (PC) e rota inicial', () => {
  it('no PC tudo continua visível, agrupado por hub', () => {
    const g = gruposDoMenuLateral(permissoesDoPapel('diretoria'), tudoLigado)
    expect(g.map((x) => x.titulo)).toEqual(['Jornada', 'Clube', 'Jogos', 'Liderança'])
  })
  it('responsável não ganha grupo nenhum além dos filhos', () => {
    const g = gruposDoMenuLateral(permissoesDoPapel('pais'), tudoLigado)
    expect(g).toHaveLength(1)
    expect(rotas(g[0].itens)).toEqual(['/meu-filho'])
  })
  it('quem entra vai para o Início contextual; o responsável, para os filhos', () => {
    expect(rotaInicial('pais')).toBe('/meu-filho')
    for (const papel of PAPEIS.filter((p) => p !== 'pais')) expect(rotaInicial(papel)).toBe('/inicio')
  })
})

// Fase 9, item 9: especialidades fora do piloto. O cenário que importa é o do clube que LIGOU as Classes oficiais:
// ele não pode levar junto as especialidades (catálogo de teste) — nem no hub, nem na gaveta, nem em card vindo do servidor.
describe('especialidades: com "classes" ligado e "especialidades" desligado, nada de especialidade aparece', () => {
  const soClasses = ligados({ ...RECURSOS_PADRAO, classes: true, especialidades: false })

  it('o hub Jornada mostra Minha Classe e NÃO mostra Especialidades', () => {
    const jornada = rotas(itensDoHub(HUB_JORNADA, soClasses))
    expect(jornada).toContain('/minha-classe')
    expect(jornada).not.toContain('/minhas-especialidades')
  })

  it('a gaveta lateral (PC) também não mostra, em nenhum papel', () => {
    for (const papel of PAPEIS) {
      const todas = gruposDoMenuLateral(permissoesDoPapel(papel), soClasses).flatMap((g) => rotas(g.itens))
      expect(todas, papel).not.toContain('/minhas-especialidades')
      expect(todas, papel).not.toContain('/avaliar-especialidades')
    }
  })

  it('o item de especialidades volta só quando o PRÓPRIO recurso liga', () => {
    const com = ligados({ ...RECURSOS_PADRAO, classes: true, especialidades: true })
    expect(rotas(itensDoHub(HUB_JORNADA, com))).toContain('/minhas-especialidades')
  })

  it('o padrão do modo legado já nasce com especialidades desligado', () => {
    expect(RECURSOS_PADRAO.especialidades).toBe(false)
    expect(rotas(itensDoHub(HUB_JORNADA, ligados(RECURSOS_PADRAO)))).not.toContain('/minhas-especialidades')
  })

  it('rotaLiberada: card do servidor que leva a especialidades não passa; o de classe passa', () => {
    expect(rotaLiberada('/minhas-especialidades', soClasses)).toBe(false)
    expect(rotaLiberada('/avaliar-especialidades', soClasses)).toBe(false)
    expect(rotaLiberada('/minhas-especialidades/', soClasses)).toBe(false)            // barra final não fura
    expect(rotaLiberada('/Minhas-Especialidades?aba=1', soClasses)).toBe(false)      // nem maiúscula ou query
    expect(rotaLiberada('/minha-classe', soClasses)).toBe(true)
    expect(rotaLiberada('/gestao/avaliar', soClasses)).toBe(true)                    // núcleo (sem recurso) sempre passa
    expect(rotaLiberada('/ranking', () => false)).toBe(true)
  })

  it('o subtítulo da Jornada não promete especialidades desligadas', () => {
    expect(descricaoDaJornada(soClasses)).not.toMatch(/especialidade/i)
    expect(descricaoDaJornada(soClasses)).toMatch(/classe/i)
    expect(descricaoDaJornada(() => false)).not.toMatch(/especialidade|classe/i)
    expect(descricaoDaJornada(ligados({ classes: true, especialidades: true }))).toMatch(/especialidades/)
  })
})
