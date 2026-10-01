import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { catalogoEspecialidades } from '../services/catalogoEspecialidades.js'
import { filtrar, rotuloNivel } from '../lib/catalogoEspecialidades.js'
import { EsqueletoTela } from '../ui/carregamento.jsx'
import { mensagemDeErro } from '../ui/index.jsx'

// Catálogo de Especialidades e Mestrados (migration 460). Só consulta: nome, código, área, nível e o
// link "Ver requisitos" (página de origem). Mobile-first: busca grande, áreas em botões que quebram
// linha (sem rolagem lateral), lista em blocos de 40 para o Android simples não travar.
const POR_VEZ = 40

export default function CatalogoEspecialidades() {
  const [params, setParams] = useSearchParams()
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState(params.get('aba') === 'mestrados' ? 'mestrados' : 'especialidades')
  const [busca, setBusca] = useState(params.get('q') || '')
  const [area, setArea] = useState('')
  const [limite, setLimite] = useState(POR_VEZ)

  useEffect(() => { catalogoEspecialidades().then(setDados).catch((e) => setErro(mensagemDeErro(e, 'Não consegui carregar o catálogo.'))) }, [])
  useEffect(() => { setLimite(POR_VEZ) }, [busca, area, aba])

  const areas = useMemo(() => {
    const m = new Map()
    for (const e of (dados?.especialidades || []).filter((x) => !x.extinta)) m.set(e.area, { area: e.area, nome: e.area_nome, n: (m.get(e.area)?.n || 0) + 1 })
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome))
  }, [dados])
  const porCodigo = useMemo(() => new Map((dados?.especialidades || []).map((e) => [e.codigo, e])), [dados])
  const lista = useMemo(() => filtrar((dados?.especialidades || []).filter((e) => !e.extinta), { busca, area }), [dados, busca, area])

  function buscar(v) {
    setBusca(v)
    const p = new URLSearchParams(params); if (v) p.set('q', v); else p.delete('q'); setParams(p, { replace: true })
  }

  if (erro) return <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Não deu para carregar o catálogo: {erro}</p>
  if (!dados) return <EsqueletoTela />

  const aberta = (x) => `rounded-xl px-3 min-h-[44px] text-sm font-bold ${x ? 'bg-brand text-white' : 'bg-surface2 text-ink'}`
  return (
    <div className="space-y-4" data-testid="catalogo-especialidades">
      <div>
        <Link to="/minha-classe" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-muted">← Minha Classe</Link>
        <h2 className="mt-1 text-2xl font-extrabold text-ink">📚 Especialidades e mestrados</h2>
        <p className="text-sm text-muted">{dados.especialidades.filter((e) => !e.extinta).length} especialidades de Desbravadores e {dados.mestrados.length} mestrados. Toque em "Ver requisitos" para abrir a página completa.</p>
      </div>

      <div className="grid grid-cols-2 gap-2" role="tablist">
        <button type="button" role="tab" aria-selected={aba === 'especialidades'} className={aberta(aba === 'especialidades')} onClick={() => setAba('especialidades')}>🏅 Especialidades</button>
        <button type="button" role="tab" aria-selected={aba === 'mestrados'} className={aberta(aba === 'mestrados')} onClick={() => setAba('mestrados')}>🎓 Mestrados</button>
      </div>

      {aba === 'especialidades' ? (
        <>
          <label className="block">
            <span className="sr-only">Buscar especialidade</span>
            <input type="search" value={busca} onChange={(e) => buscar(e.target.value)} placeholder="🔎 Buscar pelo nome ou código (ex.: nós, AR-050)"
              className="w-full min-h-[52px] rounded-2xl border-2 border-line bg-surface px-4 text-base text-ink focus:border-brand focus:outline-none" />
          </label>
          {/* área num seletor só (antes: 11 botões que ocupavam meia tela no celular) */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">Área</span>
            <div className="relative">
              <select value={area} onChange={(e) => setArea(e.target.value)} data-testid="filtro-area"
                className="w-full min-h-[52px] appearance-none rounded-2xl border-2 border-line bg-surface pl-4 pr-10 text-base font-semibold text-ink focus:border-brand focus:outline-none">
                <option value="">Todas as áreas ({areas.reduce((t, a) => t + a.n, 0)})</option>
                {areas.map((a) => <option key={a.area} value={a.area}>{a.nome} ({a.n})</option>)}
              </select>
              <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted">▾</span>
            </div>
          </label>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted" aria-live="polite">{lista.length} encontrada(s)</p>
            {(area || busca) && (
              <button type="button" onClick={() => { setArea(''); buscar('') }} className="min-h-[44px] px-2 text-xs font-bold text-brand">Limpar filtros</button>
            )}
          </div>
          <ul className="space-y-2">
            {lista.slice(0, limite).map((e) => (
              <li key={e.codigo} data-testid="especialidade-item" className="rounded-2xl border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{e.nome}</p>
                    <p className="text-xs text-muted">{e.codigo} · {e.area_nome}{e.nivel ? ` · nível ${e.nivel} ` : ''}<span aria-hidden="true">{rotuloNivel(e.nivel)}</span>{e.ano ? ` · desde ${e.ano}` : ''}</p>
                  </div>
                  <a href={e.url} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 inline-flex min-h-[44px] items-center rounded-xl bg-brand/10 px-3 text-sm font-bold text-brand">Ver requisitos ↗</a>
                </div>
              </li>
            ))}
          </ul>
          {lista.length > limite && (
            <button type="button" onClick={() => setLimite((l) => l + POR_VEZ)} className="w-full min-h-[48px] rounded-xl border-2 border-line text-sm font-bold text-ink">
              Mostrar mais ({lista.length - limite} restantes)
            </button>
          )}
          {lista.length === 0 && <p className="rounded-2xl bg-surface2 p-4 text-center text-sm text-muted">Nenhuma especialidade com esse nome. Tente outra palavra.</p>}
        </>
      ) : (
        <ul className="space-y-2">
          {dados.mestrados.map((m) => <Mestrado key={m.codigo} m={m} porCodigo={porCodigo} />)}
        </ul>
      )}
      <p className="text-xs text-faint">Fonte do catálogo: MDA Wiki (mda.wiki.br). Os requisitos oficiais ficam na página de cada especialidade.</p>
    </div>
  )
}

function Mestrado({ m, porCodigo }) {
  const [aberto, setAberto] = useState(false)
  const itens = m.especialidades.map((c) => porCodigo.get(c)).filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome))
  const regra = m.area
    ? `Ter ${m.minimo || 'as'} especialidades da área ${itens[0]?.area_nome || m.area}`
    : `Ter ${m.minimo || 'as pedidas'} das ${itens.length} especialidades da lista`
  return (
    <li className="rounded-2xl border border-line bg-surface p-3" data-testid="mestrado-item">
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className="flex w-full min-h-[44px] items-center justify-between gap-2 text-left">
        <span className="min-w-0">
          <span className="block font-bold text-ink">{m.nome.replace(/^Mestrado em /, '🎓 ')}</span>
          <span className="block text-xs text-muted">{m.codigo} · {regra}</span>
        </span>
        <span aria-hidden="true" className="text-muted">{aberto ? '▲' : '▼'}</span>
      </button>
      {aberto && (
        <div className="mt-2 space-y-2">
          <ul className="grid gap-1">
            {itens.map((e) => (
              <li key={e.codigo}><a href={e.url} target="_blank" rel="noopener noreferrer" className="flex min-h-[44px] items-center justify-between rounded-lg px-2 text-sm text-ink hover:bg-surface2">
                <span>{e.nome}</span><span className="text-xs text-muted">{e.codigo}</span></a></li>
            ))}
          </ul>
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-sm font-bold text-brand">Ver regras do mestrado ↗</a>
        </div>
      )}
    </li>
  )
}
