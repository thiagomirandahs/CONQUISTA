import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import Avatar from './Avatar.jsx'
import {
  carregarDuelos, criarDuelo, julgarDuelo, cancelarDuelo, progressoDuelo,
  salvarDesafioUnidade, excluirDesafioUnidade,
} from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const TIPOS_ACOMP = [
  ['manual', 'No olho (a liderança avalia)'],
  ['missoes', 'Missões feitas'],
  ['presenca', 'Presenças na reunião'],
  ['jogos', 'Jogos jogados'],
  ['devocional', 'Devocionais feitos'],
]
const rotuloTipo = (t) => (TIPOS_ACOMP.find(([k]) => k === t) || [])[1] || 'No olho'
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30'

// Duelo entre unidades: uma unidade desafia a outra a cumprir um requisito do
// catálogo. Qualquer desbravador lança; a liderança julga; quem cumpre leva os
// pontos de time. As regras de verdade são checadas no banco (RPC), não aqui.
// onMudou: avisa a página pai (aba Semana) que os pontos mudaram, pra ela
// recarregar o ranking depois de um duelo julgado.
export default function Duelos({ onMudou }) {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [dados, setDados] = useState({ duelos: [], unidades: [], catalogo: [] })
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [desafiando, setDesafiando] = useState(false)
  const [julgando, setJulgando] = useState(null)
  const [verCatalogo, setVerCatalogo] = useState(false)
  const [progresso, setProgresso] = useState(null)

  async function carregar() {
    setCarregando(true); setErro('')
    try { setDados(await carregarDuelos()) } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  const minhaUni = profile?.unidade_id || null
  const ativos = (dados.catalogo || []).filter((d) => d.ativo)
  const podeDesafiar = !!minhaUni && ativos.length > 0

  async function cancelar(d) {
    if (!window.confirm('Cancelar este duelo?')) return
    try { await cancelarDuelo(d.id); carregar() } catch (e) { alert(e?.message || e) }
  }

  if (carregando) return <p className="text-slate-400 text-sm">Carregando duelos...</p>

  if (erro) {
    // Tabela ausente = SQL não rodado. Qualquer outro erro (rede, etc.) não pode
    // mentir dizendo "rode o SQL" — mostra o erro de verdade + tentar de novo.
    // 'relation' sozinho era frouxo: "permission denied for relation duelos" cairia
    // aqui e mandaria rodar de novo um SQL já aplicado. "does not exist" já cobre.
    const faltaSQL = /does not exist|schema cache|could not find the (table|relation)/i.test(erro)
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        {faltaSQL ? (
          <>
            <p className="font-semibold mb-1">Duelos ainda não configurados</p>
            <p className="text-xs">Rode <code className="bg-amber-100 rounded px-1">supabase/2026-07-14-duelos.sql</code> no Supabase.</p>
          </>
        ) : (
          <>
            <p className="font-semibold mb-1">Não deu pra carregar os duelos</p>
            <p className="text-xs mb-3">{erro}</p>
            <button onClick={carregar} className="bg-amber-600 text-white font-bold rounded-xl px-4 py-2 text-xs">Tentar de novo</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {podeDesafiar && (
          <motion.button whileTap={{ scale: 0.97 }} onClick={() => setDesafiando(true)}
            className="flex-1 bg-azul text-white font-bold rounded-xl py-2.5 text-sm">
            ⚔️ Desafiar uma unidade
          </motion.button>
        )}
        {ehAdmin && (
          <button onClick={() => setVerCatalogo(true)}
            className="bg-white text-slate-600 font-bold rounded-xl py-2.5 px-4 text-sm shadow-sm shrink-0">
            📋 Catálogo
          </button>
        )}
      </div>

      {!minhaUni && (
        <p className="text-xs text-slate-400 mb-3">Você precisa estar numa unidade pra lançar um desafio.</p>
      )}
      {minhaUni && ativos.length === 0 && (
        <p className="text-xs text-slate-400 mb-3">A liderança ainda vai cadastrar os desafios no catálogo.</p>
      )}

      {dados.duelos.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">⚔️</div>
          <p className="font-semibold text-slate-700">Nenhum duelo ainda</p>
          <p className="text-sm text-slate-400">
            {podeDesafiar ? 'Seja o primeiro a desafiar outra unidade!' : 'Em breve as unidades vão poder se desafiar.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {dados.duelos.map((d) => (
            <CardDuelo key={d.id} d={d} ehAdmin={ehAdmin} meuId={profile?.id}
              onJulgar={() => setJulgando(d)} onCancelar={() => cancelar(d)} onProgresso={() => setProgresso(d)} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {desafiando && (
          <ModalDesafiar key="desafiar" catalogo={ativos}
            unidades={dados.unidades.filter((u) => u.id !== minhaUni)}
            onFechar={() => setDesafiando(false)}
            onCriar={async (desafioId, uniB) => {
              await criarDuelo(desafioId, uniB)
              setDesafiando(false)
              carregar()
            }} />
        )}
        {julgando && (
          <ModalJulgar key="julgar" d={julgando} onFechar={() => setJulgando(null)}
            onJulgar={async (v) => {
              await julgarDuelo(julgando.id, v)
              setJulgando(null)
              carregar()
              onMudou?.() // o duelo virou pontos de time: atualiza o ranking da aba Semana
            }} />
        )}
        {verCatalogo && (
          <ModalCatalogo key="catalogo" lista={dados.catalogo}
            onFechar={() => setVerCatalogo(false)} onMudou={carregar} />
        )}
        {progresso && (
          <ModalProgresso key="progresso" duelo={progresso} onFechar={() => setProgresso(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

function CardDuelo({ d, ehAdmin, meuId, onJulgar, onCancelar, onProgresso }) {
  const aberto = d.status === 'aberto'
  const temProgresso = d.desafio.tipo && d.desafio.tipo !== 'manual'
  const venceu = (lado) => d.vencedor === lado || d.vencedor === 'ambos'
  const podeCancelar = aberto && (ehAdmin || d.criado_por === meuId)
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) // yyyy-mm-dd
  const encerrado = aberto && d.prazo && String(d.prazo).slice(0, 10) < hoje

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-bold text-azul bg-azul/10 rounded-full px-2.5 py-0.5 truncate">
          {d.desafio.titulo} · +{d.desafio.pontos}
        </span>
        {aberto ? (
          <span className={`text-[11px] font-bold shrink-0 ${encerrado ? 'text-amber-600' : 'text-slate-400'}`}>
            {encerrado ? '⏰ prazo encerrado' : `até ${fmtData(d.prazo)}`}
          </span>
        ) : (
          <span className="text-[11px] font-bold text-green-600 shrink-0">✓ julgado</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <LadoUnidade u={d.a} vencedor={!aberto && venceu('a')} perdedor={!aberto && !venceu('a')} />
        <span className="text-slate-300 font-extrabold text-xs shrink-0">VS</span>
        <LadoUnidade u={d.b} vencedor={!aberto && venceu('b')} perdedor={!aberto && !venceu('b')} />
      </div>

      {d.desafio.descricao && <p className="text-xs text-slate-500 mt-2">{d.desafio.descricao}</p>}

      {!aberto && d.vencedor === 'ninguem' && (
        <p className="text-xs text-slate-500 mt-2 font-semibold">Ninguém cumpriu — sem pontos.</p>
      )}
      {!aberto && d.vencedor === 'ambos' && (
        <p className="text-xs text-green-700 mt-2 font-semibold">As duas cumpriram! Cada uma levou +{d.desafio.pontos}.</p>
      )}

      {temProgresso && (
        <button onClick={onProgresso}
          className="w-full mt-3 bg-azul/10 text-azul font-bold rounded-xl py-2 text-sm">
          📊 Ver desenvolvimento
        </button>
      )}

      {aberto && (ehAdmin || podeCancelar) && (
        <div className="flex gap-2 mt-2">
          {ehAdmin && (
            <button onClick={onJulgar} className="flex-1 bg-dourado text-azul font-bold rounded-xl py-2 text-sm">
              ⚖️ Julgar
            </button>
          )}
          {podeCancelar && (
            <button onClick={onCancelar} className="bg-slate-100 text-slate-600 font-bold rounded-xl py-2 px-3 text-sm">
              Cancelar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function LadoUnidade({ u, vencedor, perdedor }) {
  return (
    <div className={`flex-1 min-w-0 flex items-center gap-2 rounded-xl p-2 ${vencedor ? 'bg-green-50 ring-1 ring-green-300' : perdedor ? 'opacity-50' : ''}`}>
      <Avatar foto={u.emblema} nome={u.nome || '?'} cor={u.cor} size="w-8 h-8" textSize="text-xs" />
      <span className="font-bold text-slate-800 text-sm truncate">{u.nome}</span>
      {vencedor && <span className="text-sm shrink-0">🏆</span>}
    </div>
  )
}

function Overlay({ children, onFechar }) {
  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      {children}
    </motion.div>
  )
}

function ModalDesafiar({ catalogo, unidades, onFechar, onCriar }) {
  const [desafio, setDesafio] = useState(catalogo[0]?.id || '')
  const [uni, setUni] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const travado = useRef(false)

  async function enviar(e) {
    e.preventDefault()
    if (!desafio) { setErro('Escolha um desafio.'); return }
    if (!uni) { setErro('Escolha a unidade adversária.'); return }
    if (travado.current) return
    travado.current = true; setEnviando(true); setErro('')
    try {
      await onCriar(desafio, uni)
    } catch (err) {
      setErro(err?.message || String(err))
      travado.current = false
      setEnviando(false)
    }
  }

  const sel = catalogo.find((c) => c.id === desafio)

  return (
    <Overlay onFechar={enviando ? undefined : onFechar}>
      <motion.form onClick={(e) => e.stopPropagation()} onSubmit={enviar}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[88vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-slate-800 mb-1">⚔️ Desafiar uma unidade</h3>
        <p className="text-sm text-slate-500 mb-4">Quem cumprir leva os pontos de time.</p>

        <label className="block text-xs font-semibold text-slate-500 mb-1">Desafio</label>
        <select className={inputClass} value={desafio} onChange={(e) => setDesafio(e.target.value)}>
          {catalogo.map((c) => <option key={c.id} value={c.id}>{c.titulo} (+{c.pontos})</option>)}
        </select>
        {sel && (
          <p className="text-xs text-slate-400 mt-1 mb-3">
            {sel.descricao ? sel.descricao + ' · ' : ''}prazo de {sel.dias} dia(s)
          </p>
        )}

        <label className="block text-xs font-semibold text-slate-500 mb-1 mt-2">Unidade adversária</label>
        <select className={inputClass + ' mb-3'} value={uni} onChange={(e) => setUni(e.target.value)}>
          <option value="">Escolha...</option>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>

        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}

        <div className="flex gap-2">
          <button type="button" onClick={onFechar} disabled={enviando}
            className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5 disabled:opacity-60">Cancelar</button>
          <button type="submit" disabled={enviando}
            className="flex-1 rounded-xl bg-azul text-white font-semibold py-2.5 disabled:opacity-60">
            {enviando ? 'Enviando...' : 'Lançar duelo'}
          </button>
        </div>
      </motion.form>
    </Overlay>
  )
}

function ModalJulgar({ d, onFechar, onJulgar }) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const travado = useRef(false)

  async function escolher(v) {
    if (travado.current) return
    travado.current = true; setEnviando(true); setErro('')
    try {
      await onJulgar(v)
    } catch (e) {
      setErro(e?.message || String(e))
      travado.current = false
      setEnviando(false)
    }
  }

  const opcoes = [
    ['a', `🏆 ${d.a.nome} cumpriu`],
    ['b', `🏆 ${d.b.nome} cumpriu`],
    ['ambos', '🤝 As duas cumpriram'],
    ['ninguem', '❌ Ninguém cumpriu'],
  ]

  return (
    <Overlay onFechar={enviando ? undefined : onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6">
        <h3 className="text-lg font-extrabold text-slate-800 mb-1">⚖️ Julgar duelo</h3>
        <p className="text-sm text-slate-500 mb-4">
          <b>{d.desafio.titulo}</b> — quem cumpriu leva <b>+{d.desafio.pontos}</b> pontos de time.
        </p>
        <div className="space-y-2">
          {opcoes.map(([v, lbl]) => (
            <button key={v} onClick={() => escolher(v)} disabled={enviando}
              className="w-full bg-slate-50 hover:bg-slate-100 rounded-xl py-3 font-bold text-slate-700 text-sm disabled:opacity-60">
              {lbl}
            </button>
          ))}
        </div>
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mt-3">{erro}</div>}
        <button onClick={onFechar} disabled={enviando}
          className="w-full mt-4 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5 disabled:opacity-60">Fechar</button>
      </motion.div>
    </Overlay>
  )
}

function ModalCatalogo({ lista, onFechar, onMudou }) {
  const [editando, setEditando] = useState(null) // objeto = editar; {} = novo

  return (
    <Overlay onFechar={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-extrabold text-slate-800">📋 Catálogo de desafios</h3>
          {!editando && (
            <button onClick={() => setEditando({})}
              className="text-sm bg-azul text-white rounded-xl px-3 py-1.5 font-semibold">+ Novo</button>
          )}
        </div>
        <p className="text-sm text-slate-500 mb-3">Os requisitos que as unidades usam pra se desafiar.</p>

        {editando ? (
          <FormDesafio inicial={editando} onFechar={() => setEditando(null)}
            onSalvo={() => { setEditando(null); onMudou() }} />
        ) : (
          <>
            <div className="space-y-2">
              {lista.length === 0 && <p className="text-sm text-slate-400">Nenhum desafio cadastrado ainda.</p>}
              {lista.map((c) => (
                <div key={c.id} className="bg-slate-50 rounded-xl p-3 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-800 text-sm">
                      {c.titulo} <span className="text-dourado">+{c.pontos}</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {c.dias} dia(s){c.ativo ? '' : ' · desativado'}
                    </div>
                    {c.descricao && <div className="text-xs text-slate-500 mt-0.5">{c.descricao}</div>}
                  </div>
                  <button onClick={() => setEditando(c)} className="text-xs text-azul font-semibold shrink-0 p-3 -m-3">Editar</button>
                </div>
              ))}
            </div>
            <button onClick={onFechar} className="w-full mt-4 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Fechar</button>
          </>
        )}
      </motion.div>
    </Overlay>
  )
}

function FormDesafio({ inicial, onFechar, onSalvo }) {
  const [f, setF] = useState({
    titulo: inicial.titulo || '',
    descricao: inicial.descricao || '',
    pontos: inicial.pontos ?? 50,
    dias: inicial.dias ?? 7,
    tipo: inicial.tipo || 'manual',
    meta: inicial.meta ?? 1,
    ativo: inicial.ativo !== false,
  })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))

  async function salvar(e) {
    e.preventDefault()
    if (!f.titulo.trim()) { setErro('Escreva o título.'); return }
    setSalvando(true); setErro('')
    try {
      await salvarDesafioUnidade(f, inicial.id)
      onSalvo()
    } catch (err) {
      setErro(err?.message || String(err))
      setSalvando(false)
    }
  }

  async function apagar() {
    if (!window.confirm('Apagar este desafio do catálogo?')) return
    try { await excluirDesafioUnidade(inicial.id); onSalvo() }
    catch (err) { setErro(err?.message || String(err)) }
  }

  return (
    <form onSubmit={salvar} className="space-y-2">
      <input className={inputClass} maxLength={80} placeholder="Título (ex.: Presença total)"
        value={f.titulo} onChange={(e) => set('titulo', e.target.value)} />
      <textarea className={inputClass} rows="2" maxLength={240} placeholder="O que a unidade precisa cumprir"
        value={f.descricao} onChange={(e) => set('descricao', e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Pontos</label>
          <input type="number" min="1" max="500" className={inputClass}
            value={f.pontos} onChange={(e) => set('pontos', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Prazo (dias)</label>
          <input type="number" min="1" max="90" className={inputClass}
            value={f.dias} onChange={(e) => set('dias', e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Como acompanhar</label>
          <select className={inputClass} value={f.tipo} onChange={(e) => set('tipo', e.target.value)}>
            {TIPOS_ACOMP.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </select>
        </div>
        {f.tipo !== 'manual' && (
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Meta por pessoa</label>
            <input type="number" min="1" max="50" className={inputClass}
              value={f.meta} onChange={(e) => set('meta', e.target.value)} />
          </div>
        )}
      </div>
      {f.tipo !== 'manual' && (
        <p className="text-[11px] text-slate-400">O app conta sozinho e mostra o progresso de cada criança no duelo.</p>
      )}
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.ativo} onChange={(e) => set('ativo', e.target.checked)} className="w-4 h-4 accent-azul" />
        Ativo (aparece pras unidades escolherem)
      </label>

      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onFechar}
          className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Voltar</button>
        {inicial.id && (
          <button type="button" onClick={apagar}
            className="rounded-xl bg-red-50 text-red-600 font-semibold py-2.5 px-3 text-sm">🗑️</button>
        )}
        <button type="submit" disabled={salvando}
          className="flex-1 rounded-xl bg-azul text-white font-semibold py-2.5 disabled:opacity-60">
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}

// Desenvolvimento do duelo: quem cumpriu e quanto cada um fez, por unidade.
function ModalProgresso({ duelo, onFechar }) {
  const [prog, setProg] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    progressoDuelo(duelo.id)
      .then((p) => { if (vivo) { setProg(p); setCarregando(false) } })
      .catch((e) => { if (vivo) { setErro(e?.message || 'Erro'); setCarregando(false) } })
    return () => { vivo = false }
  }, [duelo.id])

  const lados = prog && prog.tipo !== 'manual' ? [[duelo.a, prog.a], [duelo.b, prog.b]] : []

  return (
    <Overlay onFechar={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-slate-800 mb-1">📊 {duelo.desafio.titulo}</h3>
        {prog && prog.tipo !== 'manual' && (
          <p className="text-sm text-slate-500 mb-4">Meta: <b>{prog.meta}</b> por pessoa · {rotuloTipo(prog.tipo).toLowerCase()}</p>
        )}

        {carregando ? (
          <p className="text-sm text-slate-400">Carregando...</p>
        ) : erro ? (
          <p className="text-sm text-red-600">{erro}</p>
        ) : !prog || prog.tipo === 'manual' ? (
          <p className="text-sm text-slate-500">Esse desafio é avaliado no olho pela liderança (o app não mede sozinho).</p>
        ) : (
          lados.map(([uni, lado], i) => (
            <div key={i} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Avatar foto={uni.emblema} nome={uni.nome || '?'} cor={uni.cor} size="w-7 h-7" textSize="text-xs" />
                <span className="font-bold text-slate-800 flex-1 truncate">{uni.nome}</span>
                <span className="text-xs font-bold text-green-600 shrink-0">{lado?.cumpriram || 0}/{lado?.total || 0} cumpriram</span>
              </div>
              {(lado?.membros || []).length === 0 ? (
                <p className="text-xs text-slate-400">Sem membros nesta unidade.</p>
              ) : (
                <div className="space-y-1">
                  {lado.membros.map((m, j) => (
                    <div key={j} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate text-slate-600">{m.nome}{m.cumpriu ? ' ✅' : ''}</span>
                      <span className={`font-bold shrink-0 ${m.cumpriu ? 'text-green-600' : 'text-slate-400'}`}>{m.feito}/{prog.meta}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        <button onClick={onFechar} className="w-full mt-2 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Fechar</button>
      </motion.div>
    </Overlay>
  )
}
