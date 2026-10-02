// CONTRATO DE CAMADAS (z-index) — achado de 02/10/2026 na validação autenticada em produção:
// "Publicar para todos os clubes" NÃO funcionava ao clicar. A folha de confirmação (Folha, z-50) abria POR TRÁS da tela de
// novo story (fixed inset-0 z-[70]): o botão existia no DOM mas o clique real caía no overlay (o element.click() do console
// ignora a sobreposição e escondia o defeito). Os testes de interação não pegavam porque mockavam `avisar`.
// Este arquivo fixa a regra: folha > overlays de tela cheia dos stories; aviso (toast) > folha.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..', '..')
const ler = (p) => readFileSync(join(RAIZ, p), 'utf8')
const zDe = (classe) => {
  const m = classe.match(/\bz-\[(\d+)\]/) || classe.match(/\bz-(\d+)\b/)
  return m ? Number(m[1]) : null
}
// z-index do PRIMEIRO elemento `fixed ... z-*` que contém o trecho dado
const zDoTrecho = (fonte, trecho) => {
  const i = fonte.indexOf(trecho)
  expect(i, `trecho não encontrado: ${trecho}`).toBeGreaterThan(-1)
  const aspas = fonte.lastIndexOf('className=', i)
  const fim = fonte.indexOf('\n', i)
  return zDe(fonte.slice(aspas, fim > -1 ? fim : undefined))
}

describe('camadas: folha (confirmações, denúncia, comentários) x telas cheias dos stories x avisos', () => {
  const folha = zDoTrecho(ler('src/ui/index.jsx'), 'fixed inset-0 z-')
  const toast = zDoTrecho(ler('src/ui/avisos.jsx'), 'fixed z-')
  const stories = ler('src/pages/rede/Stories.jsx')
  const overlays = [...stories.matchAll(/className="fixed inset-0 z-\[(\d+)\]/g)].map((m) => Number(m[1]))

  it('a Folha tem z-index MAIOR que todo overlay de tela cheia de story (criador e visualizador)', () => {
    expect(overlays.length, 'esperava ao menos o criador e o visualizador de story').toBeGreaterThanOrEqual(2)
    for (const z of overlays) expect(folha, `Folha z-${folha} fica atrás de um overlay z-${z}`).toBeGreaterThan(z)
  })

  it('o aviso (toast) fica ACIMA da folha: erro/sucesso de uma ação feita dentro dela continua visível', () => {
    expect(toast).toBeGreaterThan(folha)
  })
})
