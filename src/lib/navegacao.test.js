import { describe, it, expect } from 'vitest'
import { abasDoMenu, abasDoRodape, ABAS_BASE } from './navegacao.js'
import { permissoesDoPapel, RECURSOS_PADRAO } from './clube.js'
import { RECURSO_POR_ROTA } from './permissoes.js'

const tudoLigado = (chave) => RECURSOS_PADRAO[chave] === true         // como um clube que nunca escolheu (leilão desligado)
const ligados = (mapa) => (chave) => mapa[chave] === true
const rotas = (abas) => abas.map((a) => a.to)

describe('menu por papel (do vínculo) e por recurso do clube', () => {
  it('desbravador: as abas dos recursos ligados, sem Gestão e sem Leilão (desligado por padrão)', () => {
    const abas = rotas(abasDoMenu(permissoesDoPapel('desbravador'), tudoLigado))
    expect(abas).toContain('/ranking')
    expect(abas).toContain('/chat')
    expect(abas).not.toContain('/leilao')
    expect(abas).not.toContain('/gestao')
  })

  it('liderança e conselheiro ganham a Gestão; tesoureiro também', () => {
    for (const papel of ['conselheiro', 'instrutor', 'diretoria', 'tesoureiro']) {
      expect(rotas(abasDoMenu(permissoesDoPapel(papel), tudoLigado)), papel).toContain('/gestao')
    }
  })

  it('responsável: SÓ o portal do filho, mesmo com todos os recursos ligados', () => {
    const abas = abasDoMenu(permissoesDoPapel('pais'), () => true)
    expect(abas).toEqual([{ to: '/meu-filho', label: 'Meu Filho', icon: '👨‍👩‍👧' }])
  })

  it('clube que LIGA o leilão mostra a aba; quem desliga o chat perde a aba do chat', () => {
    const abas = rotas(abasDoMenu(permissoesDoPapel('desbravador'), ligados({ ...RECURSOS_PADRAO, leilao: true, chat: false })))
    expect(abas).toContain('/leilao')
    expect(abas).not.toContain('/chat')
  })

  it('clube com tudo desligado só mostra o núcleo (ranking e unidades)', () => {
    const abas = rotas(abasDoMenu(permissoesDoPapel('desbravador'), () => false))
    expect(abas).toEqual(['/ranking', '/unidades'])
  })

  it('sem papel (sem vínculo ativo): só o núcleo, nunca Gestão (falha fechada)', () => {
    const abas = rotas(abasDoMenu(permissoesDoPapel(null), () => false))
    expect(abas).not.toContain('/gestao')
  })

  it('toda aba de recurso do menu tem a rota no mapa de recursos (não some sem querer nem aparece sem flag)', () => {
    for (const aba of ABAS_BASE) {
      if (['/ranking', '/unidades'].includes(aba.to)) expect(RECURSO_POR_ROTA[aba.to], aba.to).toBeUndefined()
      else expect(RECURSO_POR_ROTA[aba.to], aba.to).toBeTruthy()
    }
  })

  it('a barra de baixo perde as telas que o clube desligou', () => {
    expect(rotas(abasDoRodape(tudoLigado))).toEqual(['/ranking', '/desafios', '/trilha', '/biblia', '/bichinho'])
    expect(rotas(abasDoRodape(ligados({ ...RECURSOS_PADRAO, bichinho: false, jogos: false })))).toEqual(['/ranking', '/desafios', '/biblia'])
  })
})
