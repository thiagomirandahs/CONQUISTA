// MATRIZ API → UI (fase 3.1): pras 6 Classes Regulares 2026, a tela renderiza CADA requisito do
// manifesto — uma vez, na ordem, com o texto exato — e apresenta dinâmico/N-de-M como estrutura.
// O payload aqui é montado a partir do MESMO manifesto validado, no formato que minha_classe() entrega
// (o elo manifesto → API é o teste SQL 38; o elo manifesto → banco é o 36). Se alguém mudar a tela e
// um requisito sumir, duplicar, trocar de ordem ou de texto, este teste falha.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('framer-motion', () => ({ motion: { div: (p) => <div {...Object.fromEntries(Object.entries(p).filter(([k]) => !['initial', 'animate', 'transition'].includes(k)))} /> } }))
const carregarMinhaClasse = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarMinhaClasse: (...a) => carregarMinhaClasse(...a),
  carregarClassesDisponiveis: vi.fn().mockResolvedValue([]),
  iniciarClasse: vi.fn(), salvarRequisito: vi.fn(), enviarRequisito: vi.fn(), escolherOpcoesRequisito: vi.fn(), carregarOrigemRequisito: vi.fn(),
}))
const { default: MinhaClasse } = await import('./MinhaClasse.jsx')

const dirClasses = join(process.cwd(), 'supabase', 'curriculo-manifesto', 'classes')
const REGULARES = readdirSync(dirClasses).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(dirClasses, f), 'utf8')).classe_regular)

// mesmo formato de minha_classe(): estado inicial (nada iniciado, sem conteúdo do ano cadastrado,
// nenhuma escolha registrada) — exatamente como fica logo depois da importação
function payload(classe) {
  return {
    member_class: { id: 'mc', status: 'em_andamento', iniciada_em: '2026-09-01', percentual: 0 },
    classe: { id: classe.id, nome: classe.nome, idade_minima: classe.idade_minima, manifesto_id: classe.id, vigente_desde: classe.vigente_desde },
    curriculum_version: { origem: 'oficial', identificador: 'classes-regulares-dsa', versao: '2026.1' },
    investidura: null,
    secoes: classe.secoes.map((s) => ({
      id: s.id, codigo: s.codigo, nome: s.nome, ordem: s.ordem,
      requisitos: s.requisitos.map((r) => {
        const escolha = (r.tipo || '').startsWith('escolha') ? {
          grupo_id: 'g:' + r.id, n_minimo: r.escolha?.n ?? 1, sem_repeticao: r.tipo === 'escolha_n_de_m_sem_repeticao', pool_sem_repeticao: r.grupo_sem_repeticao || null,
          total_opcoes: (r.escolha?.opcoes || []).length, aceita_texto_livre: !(r.escolha?.opcoes || []).length,
          escolhidas: [], satisfeitas_automaticamente: 0, opcoes_automaticas: [], violacoes_sem_repeticao: [], validas: 0, satisfeito: false,
          opcoes: (r.escolha?.opcoes || []).map((o, i) => ({ id: `o:${r.id}:${i + 1}`, rotulo: o, specialty_id: null })),
        } : null
        const dinamico = r.tipo === 'anual_dinamico' ? { chave: 'curso_leitura_' + classe.id, valor: null } : null
        const bloqueios = [
          ...(dinamico ? [`O conteúdo oficial deste período (Curso de Leitura do ano — ${classe.nome}) ainda não está disponível.`] : []),
          ...(escolha ? [`Escolha pelo menos ${escolha.n_minimo} das ${escolha.total_opcoes} opções (0 de ${escolha.n_minimo} até agora).`] : []),
        ]
        return { id: 'r:' + r.id, codigo: r.codigo, descricao: r.descricao_resumida, manifesto_id: r.id, status_fonte: r.status || 'CONFIRMADO',
          tipo_evidencia: 'nenhuma', evidencia_obrigatoria: false, member_requirement_id: 'mr:' + r.id, status: 'nao_iniciado',
          evidencia_texto: null, evidencia_path: null, enviado_em: null, conteudo_dinamico: dinamico, escolha, bloqueios, avaliacoes: [] }
      }),
    })),
  }
}

describe('matriz manifesto → UI: as 6 Classes Regulares 2026', () => {
  beforeEach(() => carregarMinhaClasse.mockReset())

  it('as 6 classes estão no manifesto, 149 requisitos', () => {
    expect(REGULARES.map((c) => c.id).sort()).toEqual(['amigo', 'companheiro', 'excursionista', 'guia', 'pesquisador', 'pioneiro'])
    expect(REGULARES.reduce((n, c) => n + c.secoes.reduce((m, s) => m + s.requisitos.length, 0), 0)).toBe(149)
  })

  for (const classe of REGULARES) {
    it(`${classe.nome}: cada requisito uma vez, na ordem, com o texto exato; seções na ordem; dinâmico e N-de-M como estrutura`, async () => {
      carregarMinhaClasse.mockResolvedValue(payload(classe))
      const { unmount } = render(<MinhaClasse />)
      await screen.findByRole('heading', { level: 3, name: classe.nome })

      // seções: mesma quantidade e ordem (h4 "CÓDIGO. Nome")
      const secoes = screen.getAllByTestId('secao')
      expect(secoes.map((s) => within(s).getByRole('heading', { level: 4 }).textContent)).toEqual(classe.secoes.map((s) => `${s.codigo}. ${s.nome}`))

      // requisitos: por seção, mesma ordem e texto EXATO "codigo. descricao_resumida"
      const esperado = classe.secoes.map((s) => s.requisitos.map((r) => `${r.codigo}. ${r.descricao_resumida}`))
      const obtido = secoes.map((s) => within(s).getAllByTestId('requisito-texto').map((el) => el.textContent))
      expect(obtido).toEqual(esperado)
      // unicidade por (seção, código) — o TEXTO pode repetir legitimamente entre seções (Amigo V.1/VII.1 e
      // Pesquisador VII.2/VIII.2: "Completar 1 especialidade à escolha", com opções diferentes)
      const chaves = obtido.flatMap((reqs, si) => reqs.map((t) => `${si}:${t.split('. ')[0]}`))
      expect(new Set(chaves).size).toBe(chaves.length)
      expect(chaves.length).toBe(classe.secoes.reduce((m, s) => m + s.requisitos.length, 0))

      // requisito dinâmico: aviso de "ainda não disponível" + bloqueado; N-de-M: fieldset com as opções na ordem do cartão
      const cards = screen.getAllByTestId('requisito')
      const reqs = classe.secoes.flatMap((s) => s.requisitos)
      reqs.forEach((r, i) => {
        const card = cards[i]
        if (r.tipo === 'anual_dinamico') {
          expect(within(card).getAllByText(/ainda não está disponível/)).toHaveLength(1)
          expect(within(card).getByTestId('situacao')).toHaveAttribute('data-situacao', 'bloqueado')
          expect(within(card).getByRole('button', { name: /Enviar para avaliação/ })).toBeDisabled()
          expect(within(card).getByTestId('requisito-texto').textContent).not.toMatch(/20\d\d/)
        } else if ((r.tipo || '').startsWith('escolha')) {
          const grupo = within(card).getByRole('group')
          const n = r.escolha?.n ?? 1
          const m = (r.escolha?.opcoes || []).length
          expect(within(grupo).getByText(new RegExp(`^Escolha ${n}${m ? ` de ${m}` : ''}`), { selector: 'legend' })).toBeInTheDocument()
          if (m) expect(within(grupo).getAllByRole('checkbox').map((c) => c.closest('label').textContent)).toEqual(r.escolha.opcoes)
          else expect(within(grupo).getByLabelText('Qual especialidade você fez?')).toBeInTheDocument()
          if (r.tipo === 'escolha_n_de_m_sem_repeticao') expect(within(grupo).getByText(/não vale especialidade já realizada/)).toBeInTheDocument()
          expect(within(card).getByTestId('situacao')).toHaveAttribute('data-situacao', 'bloqueado')
        } else {
          expect(within(card).queryByRole('group')).not.toBeInTheDocument()
          expect(within(card).getByTestId('situacao')).toHaveAttribute('data-situacao', 'nao_iniciado')
          expect(within(card).getByRole('button', { name: 'Enviar para avaliação' })).toBeEnabled()
        }
        // nada técnico no card: OMD, hash e id do manifesto só na "Origem do requisito"
        expect(card.textContent).not.toMatch(/OMD-|[0-9a-f]{64}|manifesto_id/)
        expect(within(card).getByRole('button', { name: 'Origem do requisito' })).toBeInTheDocument()
      })
      unmount()
    })
  }
})
