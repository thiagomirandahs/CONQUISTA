import { useCallback, useEffect, useRef, useState } from 'react'
import { carregarLeituras } from '../services/leituras.js'
import { useAuth } from '../context/Auth.jsx'
import { Folha, Cabecalho, Vazio, mensagemDeErro } from '../ui/index.jsx'
import CapaLivro from '../components/leitura/CapaLivro.jsx'
import DetalheLeitura from '../components/leitura/DetalheLeitura.jsx'
import { FILTROS, acaoDoCard, estaConcluido, subtitulo, temAudio } from '../lib/leitura.js'

// /leituras — catálogo de leitura (migration 514). Material RELACIONADO ao currículo; o requisito
// continua sendo o do currículo. Uma leitura por filtro (cache na tela): trocar de chip já visto não recarrega.
export default function Leituras() {
  const { profile } = useAuth() || {}
  const userId = profile?.id
  const [filtro, setFiltro] = useState('todos')
  const [dados, setDados] = useState({})        // filtro -> itens
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null)    // id do material aberto
  const pedidos = useRef(new Set())

  const carregar = useCallback((f, forcar = false) => {
    if (!forcar && pedidos.current.has(f)) return
    pedidos.current.add(f)
    setErro('')
    carregarLeituras(f)
      .then((itens) => setDados((d) => ({ ...d, [f]: itens })))
      .catch((e) => { pedidos.current.delete(f); setErro(mensagemDeErro(e, 'Não consegui carregar as leituras.')) })
  }, [])
  useEffect(() => { carregar(filtro) }, [filtro, carregar])

  // Progresso mudou dentro do player: atualiza o card em todas as listas já carregadas (sem nova chamada).
  const aoProgresso = useCallback((id) => (p) => {
    setDados((d) => Object.fromEntries(Object.entries(d).map(([k, itens]) => [k, itens.map((m) => (m.id !== id ? m : {
      ...m, progresso: { capitulo: p.capitulo, posicao_seg: p.posicao_seg, duracao_seg: p.duracao_seg, concluido: !!(m.progresso?.concluido || p.concluido), ultima_em: new Date().toISOString() },
    }))])))
  }, [])

  const itens = dados[filtro]
  const todos = Object.values(dados).flat()
  const material = aberto ? todos.find((m) => m.id === aberto) : null

  return (
    <div className="mx-auto max-w-2xl pb-8" data-testid="pagina-leituras">
      <Cabecalho icone="📚" titulo="Leituras" descricao="Livros da sua Classe e do Curso de Leitura, para ler ou ouvir." />
      <div role="group" aria-label="Filtrar leituras" className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button key={f.chave} type="button" onClick={() => setFiltro(f.chave)} aria-pressed={filtro === f.chave}
            className={`min-h-[44px] rounded-full border-2 px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${filtro === f.chave ? 'border-[#0b1f4d] bg-[#0b1f4d] text-white' : 'border-slate-300 bg-white text-[#0b1f4d]'}`}>
            {filtro === f.chave && <span aria-hidden="true">✓ </span>}{f.rotulo}
          </button>
        ))}
      </div>

      {erro && !itens ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p>{erro}</p>
          <button type="button" onClick={() => carregar(filtro, true)}
            className="mt-3 min-h-[44px] rounded-xl bg-[#0b1f4d] px-4 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Tentar de novo</button>
        </div>
      ) : !itens ? (
        <div role="status" aria-label="Carregando leituras" className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface2 motion-reduce:animate-none" />)}
        </div>
      ) : itens.length === 0 ? (
        <Vazio icone="📚" titulo="Nada por aqui ainda">Quando houver leituras para este filtro, elas aparecem nesta lista.</Vazio>
      ) : (
        <ul className="space-y-3">
          {itens.map((m) => <CardLeitura key={m.id} m={m} aoAbrir={() => setAberto(m.id)} />)}
        </ul>
      )}

      <Folha aberta={!!material} aoFechar={() => setAberto(null)} titulo={material?.titulo || 'Leitura'}>
        {material && <DetalheLeitura key={material.id} material={material} userId={userId} aoProgresso={aoProgresso(material.id)} />}
      </Folha>
    </div>
  )
}

function CardLeitura({ m, aoAbrir }) {
  const concluido = estaConcluido(m)
  return (
    <li>
      <button type="button" onClick={aoAbrir}
        className="flex w-full min-h-[44px] items-stretch gap-3 rounded-2xl bg-surface p-3 text-left shadow-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:bg-surface2">
        <CapaLivro titulo={m.titulo} url={m.capa_url} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-base font-extrabold leading-tight text-ink">{m.titulo}</span>
          {subtitulo(m) && <span className="text-xs text-muted">{subtitulo(m)}</span>}
          {temAudio(m) && <span className="text-xs font-semibold text-[#0b1f4d]">🎧 Audiobook disponível</span>}
          <span className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <span className="inline-flex min-h-[36px] items-center rounded-lg bg-[#0b1f4d] px-3 text-xs font-extrabold text-white">{acaoDoCard(m)}</span>
            {concluido && <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800 ring-1 ring-inset ring-emerald-600/20"><span aria-hidden="true">✓ </span>Concluído</span>}
          </span>
        </span>
      </button>
    </li>
  )
}
