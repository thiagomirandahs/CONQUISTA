// Lista PAGINADA do catálogo de especialidades (centenas de itens): busca, área, situação e "Carregar mais".
// Nunca pede o catálogo inteiro: cada chamada traz no máximo `limite` itens e o servidor devolve um cursor.
//
// Corrida de respostas: cada consulta ganha um número (`contador`). Mudou a busca/área/situação (ou chamou
// de novo), o número sobe — quando uma resposta antiga chega, o número dela já não é o atual e ela é IGNORADA.
// Enquanto a nova busca não volta, a lista anterior continua na tela com o aviso "Buscando…".
import { useEffect, useRef, useState } from 'react'
import { buscarEspecialidades } from '../../lib/dados.js'
import { Aviso, Botao, Progresso, mensagemDeErro } from '../../ui/index.jsx'
import { avisar } from '../../ui/avisos.jsx'
import { EsqueletoTela } from '../../ui/carregamento.jsx'

export const ABAS_PADRAO = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'disponiveis', rotulo: 'Disponíveis' },
  { valor: 'iniciadas', rotulo: 'Em andamento' },
  { valor: 'concluidas', rotulo: 'Concluídas' },
]
const VAZIO_POR_SITUACAO = {
  iniciadas: 'Você ainda não começou nenhuma especialidade.',
  concluidas: 'Você ainda não concluiu nenhuma especialidade.',
  disponiveis: 'Nenhuma especialidade disponível agora.',
  todas: 'Nenhuma especialidade cadastrada ainda.',
}
const ATRASO_BUSCA_MS = 350

export default function ListaEspecialidades({ abas = ABAS_PADRAO, situacaoInicial, limite = 30, aoAbrir, aoComecar, className = '' }) {
  const [situacao, setSituacao] = useState(situacaoInicial || abas[0].valor)
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [area, setArea] = useState('')
  const [itens, setItens] = useState([])
  const [proximo, setProximo] = useState(null)
  const [total, setTotal] = useState(0)
  const [areas, setAreas] = useState([])
  const [inicial, setInicial] = useState(true) // ainda não chegou NENHUMA resposta
  const [buscando, setBuscando] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [erro, setErro] = useState('')
  const [iniciando, setIniciando] = useState(null)
  const contador = useRef(0)
  const ultima = useRef({ depois: null })

  // busca com atraso: digitar rápido dispara UMA consulta
  useEffect(() => {
    if (busca === buscaAplicada) return undefined
    const t = setTimeout(() => setBuscaAplicada(busca), ATRASO_BUSCA_MS)
    return () => clearTimeout(t)
  }, [busca, buscaAplicada])

  async function executar(depois) {
    const id = ++contador.current
    ultima.current = { depois }
    if (depois) setCarregandoMais(true); else setBuscando(true)
    setErro('')
    try {
      const r = await buscarEspecialidades({ busca: buscaAplicada, area: area || null, situacao, limite, depois })
      if (id !== contador.current) return // resposta velha: a busca/filtro mudou enquanto ela viajava
      const novos = r?.itens || []
      setItens((atual) => {
        if (!depois) return novos
        const vistos = new Set(atual.map((x) => x.specialty_id))
        return [...atual, ...novos.filter((x) => !vistos.has(x.specialty_id))]
      })
      setProximo(r?.proximo || null)
      setTotal(r?.total ?? 0)
      if (!depois && r?.areas?.length) setAreas(r.areas)
      setInicial(false)
    } catch (e) {
      if (id !== contador.current) return
      setErro(mensagemDeErro(e, 'Não consegui carregar as especialidades.'))
    } finally {
      if (id === contador.current) { setBuscando(false); setCarregandoMais(false) }
    }
  }

  // mudou a consulta → recomeça da 1ª página (cursor zerado)
  useEffect(() => {
    Promise.resolve().then(() => executar(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaAplicada, area, situacao, limite])

  async function comecar(item) {
    setIniciando(item.specialty_id)
    try { await aoComecar?.(item) } catch (e) { avisar.erro(e) } finally { setIniciando(null) }
  }
  function limparFiltros() { setBusca(''); setBuscaAplicada(''); setArea('') }

  const temFiltro = !!(buscaAplicada || area)
  const areaAtual = areas.find((a) => a.categoria === area)

  return (
    <div className={`space-y-3 ${className}`} data-testid="lista-especialidades">
      <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setBuscaAplicada(busca) }}>
        <div className="relative min-w-0 flex-1">
          <label htmlFor="busca-esp" className="sr-only">Buscar especialidade por nome ou código</label>
          <input id="busca-esp" type="search" enterKeyHint="search" autoComplete="off" value={busca} maxLength={60}
            placeholder="Buscar por nome ou código" onChange={(e) => setBusca(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 pr-11 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand" />
          {busca && (
            <button type="button" aria-label="Limpar a busca" onClick={() => { setBusca(''); setBuscaAplicada('') }}
              className="absolute right-0 top-0 grid h-11 w-11 place-items-center text-lg text-muted">✕</button>
          )}
        </div>
      </form>

      <div>
        <label htmlFor="area-esp" className="sr-only">Filtrar por área</label>
        <select id="area-esp" value={area} onChange={(e) => setArea(e.target.value)}
          className="w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-base font-semibold text-ink">
          <option value="">Todas as áreas</option>
          {areas.map((a) => <option key={a.categoria} value={a.categoria}>{a.categoria} ({a.total})</option>)}
          {area && !areaAtual && <option value={area}>{area}</option>}
        </select>
      </div>

      {abas.length > 1 && (
        <div role="tablist" aria-label="Situação" className="flex flex-wrap gap-2">
          {abas.map((a) => (
            <button key={a.valor} type="button" role="tab" aria-selected={situacao === a.valor} onClick={() => setSituacao(a.valor)}
              className={`min-h-[44px] rounded-full px-4 text-sm font-bold ${situacao === a.valor ? 'bg-gradient-to-r from-brand to-brand2 shadow-glow' : 'border border-line bg-surface text-muted'}`}
              style={situacao === a.valor ? { color: 'var(--marca-1-texto, #fff)' } : undefined}>
              {a.rotulo}
            </button>
          ))}
        </div>
      )}

      <p role="status" aria-live="polite" data-testid="contador-especialidades" className="min-h-[1.25rem] text-xs text-muted">
        {buscando ? 'Buscando…' : (!inicial && !erro ? `Mostrando ${itens.length} de ${total}` : '')}
      </p>

      {erro && (
        <Aviso tom="erro" acao={<Botao variacao="secundario" aoTocar={() => executar(ultima.current.depois)}>Tentar de novo</Botao>}>{erro}</Aviso>
      )}

      {inicial && !erro ? (
        <EsqueletoTela cabecalho={false} cartoes={3} />
      ) : (
        <>
          {!erro && itens.length === 0 && !buscando && (
            <div className="rounded-2xl bg-surface p-6 text-center shadow-soft" data-testid="vazio-especialidades">
              {temFiltro ? (
                <>
                  <p className="font-bold text-ink">Nenhuma especialidade encontrada.</p>
                  <p className="mt-1 text-sm text-muted">Tente outra palavra ou tire o filtro.</p>
                  <Botao variacao="secundario" aoTocar={limparFiltros} className="mt-3">Limpar busca e filtro</Botao>
                </>
              ) : (
                <p className="font-bold text-ink">{VAZIO_POR_SITUACAO[situacao] || VAZIO_POR_SITUACAO.todas}</p>
              )}
            </div>
          )}

          <ul className={`space-y-2 ${buscando ? 'opacity-60' : ''}`} aria-busy={buscando || undefined}>
            {itens.map((it) => {
              const dep = it.dependencias_pendentes || []
              const idDep = `dep-${it.specialty_id}`
              return (
                <li key={it.specialty_id} data-testid="cartao-especialidade" data-situacao={it.situacao}
                  className="rounded-2xl bg-surface p-4 shadow-soft">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="break-words text-base font-extrabold leading-snug text-ink">{it.nome}</h3>
                      <p className="mt-0.5 text-xs text-muted">
                        {it.codigo} · {it.categoria}{it.total_requisitos != null ? ` · ${it.total_requisitos} requisito${it.total_requisitos === 1 ? '' : 's'}` : ''}
                      </p>
                    </div>
                    {it.situacao === 'concluida' && (
                      <span className="shrink-0 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-bold text-green-700">✅ Concluída</span>
                    )}
                  </div>

                  {it.situacao === 'em_andamento' && (
                    <div className="mt-2"><Progresso valor={it.percentual ?? 0} total={100} rotulo="Progresso" /></div>
                  )}

                  {it.situacao === 'disponivel' && dep.length > 0 && (
                    <p id={idDep} className="mt-2 text-xs font-semibold text-red-700">🔒 Falta concluir: {dep.join(', ')}</p>
                  )}

                  <div className="mt-3">
                    {it.situacao === 'disponivel' ? (
                      <Botao aoTocar={() => comecar(it)} desabilitado={dep.length > 0 || iniciando != null} carregando={iniciando === it.specialty_id}
                        aria-describedby={dep.length > 0 ? idDep : undefined} aria-label={`Começar ${it.nome}`} className="w-full">
                        Começar
                      </Botao>
                    ) : (
                      <Botao variacao="secundario" aoTocar={() => aoAbrir?.(it)} aria-label={`Abrir ${it.nome}`} className="w-full">
                        {it.situacao === 'concluida' ? 'Ver' : 'Continuar'}
                      </Botao>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {proximo && !erro && (
            <Botao variacao="contorno" aoTocar={() => executar(proximo)} carregando={carregandoMais} desabilitado={buscando} className="w-full">
              Carregar mais
            </Botao>
          )}
        </>
      )}
    </div>
  )
}
