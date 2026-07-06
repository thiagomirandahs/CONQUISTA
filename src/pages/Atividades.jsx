import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/Auth.jsx'
import { comprimirImagem } from '../lib/imagem.js'
import { hojeLocalISO } from '../lib/data.js'

const categorias = [
  { icon: '✨', nome: 'Todas' },
  { icon: '🙏', nome: 'Espiritual' },
  { icon: '🎖️', nome: 'Especialidades' },
  { icon: '🤝', nome: 'Serviço' },
  { icon: '🏕️', nome: 'Eventos' },
  { icon: '✅', nome: 'Presença' },
]
const iconeCat = { Espiritual: '🙏', Especialidades: '🎖️', Serviço: '🤝', Eventos: '🏕️', Presença: '✅' }
const unidadesAlvo = ['Todas as unidades']
const PODE_GERIR = ['instrutor', 'diretoria']
const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30'

const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : 'sem prazo')
// Compara no fuso de Brasília e recalcula a cada render (não "trava" o dia)
const prazoEncerrado = (iso) => iso && String(iso).slice(0, 10) < hojeLocalISO()
// Detecta se a comprovação enviada é um vídeo (pela extensão do arquivo no Storage)
const ehVideo = (url = '') => /\.(mp4|mov|m4v|webm|ogg|3gp|3gpp|avi|mkv|qt)(\?|$)/i.test(url)
const MAX_MB = 50 // limite amigável pra vídeo não estourar o upload
function badgesCriterio(c = {}) {
  const arr = []
  if (c.foto) arr.push('📷 Foto/🎥 vídeo')
  if (c.texto) arr.push('✍️ Texto')
  if (c.arquivo) arr.push('📎 Arquivo')
  return arr.length ? arr : ['Sem comprovação']
}

export default function Atividades() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [atividades, setAtividades] = useState([])
  const [entregues, setEntregues] = useState({})
  const [carregando, setCarregando] = useState(true)
  const [erroBanco, setErroBanco] = useState('')
  const [filtro, setFiltro] = useState('Todas')
  const [criando, setCriando] = useState(false)
  const [editando, setEditando] = useState(null) // atividade sendo editada
  const [entregando, setEntregando] = useState(null)
  const [aba, setAba] = useState('atividades')
  const [pendentes, setPendentes] = useState([])
  const [entregas, setEntregas] = useState([])
  const [avaliando, setAvaliando] = useState(null) // id da entrega sendo aprovada/reprovada
  const [membros, setMembros] = useState([]) // desbravadores/conselheiros ativos (pra ver quem falta)
  const [abertoFaltam, setAbertoFaltam] = useState(null) // atividade com a lista de pendentes aberta

  async function carregar() {
    const { data: ats, error } = await supabase.from('atividades').select('*').order('created_at', { ascending: false })
    if (error) setErroBanco(error.message)
    else setErroBanco('')
    setAtividades(ats || [])
    if (profile?.id) {
      const { data: ents } = await supabase.from('entregas').select('atividade_id,status,feedback').eq('usuario_id', profile.id)
      const map = {}
      ;(ents || []).forEach((e) => { map[e.atividade_id] = { status: e.status, feedback: e.feedback } })
      setEntregues(map)
    }
    if (ehAdmin) {
      const { data: pend } = await supabase.from('entregas')
        .select('id, usuario_id, texto, foto_url, created_at, atividade:atividades(titulo,pontos), autor:profiles!usuario_id(nome)')
        .eq('status', 'pendente').order('created_at', { ascending: true })
      setPendentes(pend || [])
      const { data: todas } = await supabase.from('entregas')
        .select('id, atividade_id, usuario_id, status, texto, foto_url, created_at, atividade:atividades(titulo,pontos), autor:profiles!usuario_id(nome)')
        .order('created_at', { ascending: false })
        .limit(200)
      setEntregas(todas || [])
      // quem PODE entregar (pra calcular quem ainda não entregou)
      const { data: mem } = await supabase.from('profiles').select('id,nome')
        .eq('status', 'ativo').in('papel', ['desbravador', 'conselheiro']).order('nome')
      setMembros(mem || [])
    }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [profile?.id]) // eslint-disable-line

  const lista = filtro === 'Todas' ? atividades : atividades.filter((a) => a.categoria === filtro)

  async function salvarAtividade(nova, id) {
    const dados = {
      titulo: nova.titulo, descricao: nova.descricao, categoria: nova.categoria,
      pontos: nova.pts, prazo: nova.prazo || null, alvo: nova.alvo, criterios: nova.criterios,
    }
    const resp = id
      ? await supabase.from('atividades').update(dados).eq('id', id)
      : await supabase.from('atividades').insert({ ...dados, criado_por: profile?.id })
    if (resp.error) { alert('Não foi possível salvar: ' + resp.error.message); return }
    setCriando(false)
    setEditando(null)
    carregar()
  }

  async function excluirAtividade(a) {
    if (!window.confirm(`Excluir a atividade "${a.titulo}"?`)) return
    const { error } = await supabase.from('atividades').delete().eq('id', a.id)
    if (error) { alert('Não foi possível excluir: ' + error.message); return }
    carregar()
  }

  async function confirmarEntrega(atividade, dados) {
    let fotoUrl = null
    // Envia a comprovação de verdade para o Storage (bucket imagens).
    // Foto é comprimida; vídeo passa direto (comprimirImagem só mexe em imagem).
    if (dados.foto) {
      const arquivo = await comprimirImagem(dados.foto)
      const ext = (arquivo.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `atividades/${atividade.id}-${profile?.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('imagens').upload(path, arquivo, { upsert: true })
      if (upErr) throw new Error('Não foi possível enviar a foto: ' + upErr.message)
      const { data: pub } = supabase.storage.from('imagens').getPublicUrl(path)
      fotoUrl = pub.publicUrl
    }
    // upsert: primeira entrega = insere; reenvio (após reprovar) = volta pra 'pendente'
    const { error } = await supabase.from('entregas').upsert({
      atividade_id: atividade.id, usuario_id: profile?.id,
      texto: dados.texto || null, foto_url: fotoUrl, status: 'pendente', feedback: null,
    }, { onConflict: 'atividade_id,usuario_id' })
    if (error) throw new Error(error.message)
    setEntregando(null)
    carregar()
  }

  async function aprovarEntrega(e) {
    if (avaliando) return
    setAvaliando(e.id)
    // RPC atômica e idempotente: só credita os pontos se a entrega ainda estava
    // 'pendente' — nunca dobra (duplo toque) nem fica "aprovada sem pontos".
    const { data, error } = await supabase.rpc('aprovar_entrega', { p_entrega_id: e.id })
    setAvaliando(null)
    if (error) { alert('Não consegui aprovar: ' + (error.message || error)); return }
    if (data && data.ok === false) { alert('Essa entrega já tinha sido avaliada — atualizei a lista.') }
    carregar()
  }
  async function reprovarEntrega(e, feedback) {
    if (avaliando) return
    setAvaliando(e.id)
    const { error } = await supabase.from('entregas')
      .update({ status: 'reprovada', avaliado_por: profile?.id, feedback: feedback || null })
      .eq('id', e.id).eq('status', 'pendente')
    setAvaliando(null)
    if (error) { alert('Não consegui reprovar: ' + (error.message || error)); return }
    carregar()
  }
  async function excluirEntrega(e) {
    if (!window.confirm(`Apagar a entrega de ${e.autor?.nome || 'desbravador'} em "${e.atividade?.titulo || ''}"?`)) return
    // Remove os pontos ANTES da entrega (o vínculo entrega_id vira null ao apagá-la).
    if (e.status === 'aprovada') {
      const { data: del } = await supabase.from('pontos').delete().eq('entrega_id', e.id).select('id')
      if (!del || del.length === 0) {
        // entrega antiga (aprovada antes do vínculo): usa o motivo como antes
        await supabase.from('pontos').delete()
          .eq('usuario_id', e.usuario_id).eq('origem', 'atividade')
          .eq('motivo', `Atividade: ${e.atividade?.titulo || ''}`)
      }
    }
    const { error } = await supabase.from('entregas').delete().eq('id', e.id)
    if (error) { alert('Não foi possível apagar: ' + error.message); return }
    carregar()
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800">Atividades</h2>
          <p className="text-sm text-slate-500">Entregue e ganhe pontos · líderes cadastram aqui</p>
        </div>
        {ehAdmin && (
          <motion.button whileTap={{ scale: 0.94 }} whileHover={{ scale: 1.04 }} onClick={() => setCriando(true)}
            className="shrink-0 text-sm bg-azul text-white rounded-xl px-4 py-2 font-semibold shadow-sm">
            + Nova atividade
          </motion.button>
        )}
      </div>

      {erroBanco && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3 mb-4">
          ⚠️ Não consegui carregar as atividades agora. Verifique a internet e toque em 🔄 Atualizar app. Se persistir, avise a diretoria.
        </div>
      )}

      {ehAdmin && (
        <div className="bg-white rounded-xl p-1 flex shadow-sm mb-4 max-w-md">
          {[['atividades', '📋 Atividades'], ['corrigir', `✅ Corrigir${pendentes.length ? ` (${pendentes.length})` : ''}`], ['entregas', '📦 Entregas']].map(([k, lbl]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${aba === k ? 'bg-azul text-white' : 'text-slate-500'}`}>{lbl}</button>
          ))}
        </div>
      )}

      {aba === 'corrigir' ? (
        <CorrigirView pendentes={pendentes} onAprovar={aprovarEntrega} onReprovar={reprovarEntrega} avaliando={avaliando} />
      ) : aba === 'entregas' ? (
        <EntregasView entregas={entregas} onExcluir={excluirEntrega} />
      ) : (
      <>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 no-scrollbar">
        {categorias.map((c) => {
          const ativo = filtro === c.nome
          return (
            <button key={c.nome} onClick={() => setFiltro(c.nome)}
              className={`relative shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${ativo ? 'text-white' : 'text-slate-600 bg-white border border-slate-200 hover:border-azul-claro'}`}>
              {ativo && <motion.span layoutId="cat-pill" className="absolute inset-0 bg-azul rounded-full" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
              <span className="relative z-10"><span className="mr-1">{c.icon}</span>{c.nome}</span>
            </button>
          )
        })}
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : lista.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">📋</div>
          <p className="font-semibold text-slate-700">Nenhuma atividade ainda</p>
          <p className="text-sm text-slate-400">{ehAdmin ? 'Toque em "+ Nova atividade" para criar a primeira.' : 'A liderança ainda vai cadastrar as atividades.'}</p>
        </div>
      ) : (
        <motion.div layout className="grid sm:grid-cols-2 gap-3">
          <AnimatePresence mode="popLayout">
            {lista.map((a) => {
              const minha = entregues[a.id]
              const status = minha?.status
              const encerrado = prazoEncerrado(a.prazo)
              const entreguesSet = ehAdmin ? new Set(entregas.filter((e) => e.atividade_id === a.id).map((e) => e.usuario_id)) : null
              const faltam = ehAdmin ? membros.filter((m) => !entreguesSet.has(m.id)) : []
              return (
                <motion.div key={a.id} layout
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                  className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-2">
                  <div className="flex items-start gap-3">
                    <div className="text-3xl">{iconeCat[a.categoria] || '📋'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold text-azul-claro">{a.categoria} · {a.alvo}</div>
                      <div className="font-bold text-slate-800 leading-tight">{a.titulo}</div>
                      <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{a.descricao}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-dourado font-extrabold leading-none">+{a.pontos}</div>
                      <div className="text-[10px] text-slate-400">pontos</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {badgesCriterio(a.criterios).map((b) => (
                      <span key={b} className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{b}</span>
                    ))}
                  </div>

                  {ehAdmin && membros.length > 0 && (
                    <div className="text-[11px]">
                      <button type="button" onClick={() => setAbertoFaltam(abertoFaltam === a.id ? null : a.id)}
                        className="font-semibold text-slate-500 hover:text-azul">
                        ✅ {entreguesSet.size}/{membros.length} entregaram{faltam.length ? ` · ${faltam.length} faltando ▾` : ' 🎉'}
                      </button>
                      {abertoFaltam === a.id && faltam.length > 0 && (
                        <div className="mt-1 text-slate-500 bg-slate-50 rounded-lg p-2 leading-relaxed">
                          <span className="font-semibold">Faltam entregar:</span> {faltam.map((m) => m.nome || '—').join(', ')}
                        </div>
                      )}
                    </div>
                  )}

                  {status === 'reprovada' && minha?.feedback && (
                    <div className="text-[11px] bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-2">
                      <span className="font-semibold">Motivo:</span> {minha.feedback}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-1 gap-2">
                    <span className={`text-xs ${encerrado ? 'text-red-400 font-medium' : 'text-slate-400'}`}>📅 {fmtData(a.prazo)}</span>
                    <div className="flex items-center gap-2">
                      {ehAdmin && (
                        <>
                          <button onClick={() => setEditando(a)} title="Editar"
                            className="text-xs text-slate-500 hover:bg-slate-100 rounded-lg px-2 py-1.5">✏️</button>
                          <button onClick={() => excluirAtividade(a)} title="Excluir"
                            className="text-xs text-red-500 hover:bg-red-50 rounded-lg px-2 py-1.5">🗑️</button>
                        </>
                      )}
                      {status === 'aprovada' ? (
                        <span className="text-xs font-semibold text-green-600">✅ Aprovada</span>
                      ) : status === 'reprovada' ? (
                        <motion.button whileTap={{ scale: 0.92 }} whileHover={{ scale: 1.05 }} onClick={() => setEntregando(a)}
                          className="text-xs bg-amber-100 text-amber-700 rounded-lg px-3 py-1.5 font-semibold">↺ Enviar de novo</motion.button>
                      ) : status ? (
                        <span className="text-xs font-semibold text-slate-500">✅ Entregue</span>
                      ) : encerrado ? (
                        <span className="text-xs font-semibold text-red-400">⏰ Prazo encerrado</span>
                      ) : (
                        <motion.button whileTap={{ scale: 0.92 }} whileHover={{ scale: 1.05 }} onClick={() => setEntregando(a)}
                          className="text-xs bg-azul text-white rounded-lg px-3 py-1.5 font-medium">Entregar</motion.button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </motion.div>
      )}
      </>
      )}

      <AnimatePresence>
        {criando && <NovaAtividadeModal key="nova" onFechar={() => setCriando(false)} onSalvar={(d) => salvarAtividade(d)} />}
      </AnimatePresence>
      <AnimatePresence>
        {editando && <NovaAtividadeModal key="editar" inicial={editando} onFechar={() => setEditando(null)} onSalvar={(d) => salvarAtividade(d, editando.id)} />}
      </AnimatePresence>
      <AnimatePresence>
        {entregando && <EntregarModal key="entrega" atividade={entregando} onFechar={() => setEntregando(null)} onConfirmar={confirmarEntrega} />}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Aba de correção das entregas (liderança) ---------- */
function CorrigirView({ pendentes, onAprovar, onReprovar, avaliando }) {
  const [ampliar, setAmpliar] = useState(null)
  const [motivos, setMotivos] = useState({})
  if (!pendentes.length) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🎉</div>
        <p className="font-semibold text-slate-700">Nada para corrigir!</p>
        <p className="text-sm text-slate-400">Todas as entregas já foram avaliadas.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {pendentes.map((e) => (
        <div key={e.id} className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-slate-800">{e.autor?.nome || 'Desbravador'}</div>
              <div className="text-xs text-azul-claro font-semibold">{e.atividade?.titulo}</div>
            </div>
            <div className="text-dourado font-extrabold shrink-0">+{e.atividade?.pontos || 0}</div>
          </div>
          {e.texto && <p className="text-sm text-slate-600 mt-2 bg-slate-50 rounded-lg p-2 italic">"{e.texto}"</p>}
          {e.foto_url && (e.foto_url.startsWith('http') ? (
            ehVideo(e.foto_url) ? (
              <video src={e.foto_url} controls playsInline preload="metadata" className="mt-2 w-full max-h-64 rounded-lg bg-black" />
            ) : (
              <button onClick={() => setAmpliar(e.foto_url)} className="mt-2 block w-full">
                <img src={e.foto_url} alt="comprovação" loading="lazy" className="w-full max-h-56 object-cover rounded-lg" />
                <span className="text-[11px] text-slate-400">toque para ampliar 🔍</span>
              </button>
            )
          ) : (
            <p className="text-xs text-slate-400 mt-1">📎 {e.foto_url}</p>
          ))}
          <input value={motivos[e.id] || ''} onChange={(ev) => setMotivos((m) => ({ ...m, [e.id]: ev.target.value }))}
            maxLength={200} placeholder="Motivo, se for reprovar (a criança vê e pode reenviar)"
            className="w-full mt-3 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />
          <div className="flex gap-2 mt-2">
            <button onClick={() => onReprovar(e, motivos[e.id])} disabled={!!avaliando}
              className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Reprovar</button>
            <button onClick={() => onAprovar(e)} disabled={!!avaliando}
              className="flex-1 rounded-lg bg-green-600 hover:bg-green-700 text-white py-2 text-sm font-semibold disabled:opacity-60">{avaliando === e.id ? '...' : `✅ Aprovar (+${e.atividade?.pontos || 0})`}</button>
          </div>
        </div>
      ))}

      <AnimatePresence>
        {ampliar && (
          <motion.div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAmpliar(null)}>
            <img src={ampliar} alt="comprovação" className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Aba de todas as entregas (liderança) — ver e apagar ---------- */
function EntregasView({ entregas, onExcluir }) {
  const [ampliar, setAmpliar] = useState(null)
  if (!entregas.length) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">📦</div>
        <p className="font-semibold text-slate-700">Nenhuma entrega ainda</p>
        <p className="text-sm text-slate-400">As entregas dos desbravadores aparecem aqui.</p>
      </div>
    )
  }
  const badge = (s) => (s === 'aprovada' ? 'bg-green-100 text-green-700' : s === 'reprovada' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700')
  const rotulo = (s) => (s === 'aprovada' ? '✅ Aprovada' : s === 'reprovada' ? '↺ Reprovada' : '⏳ Pendente')
  return (
    <div className="space-y-3">
      {entregas.map((e) => (
        <div key={e.id} className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-slate-800">{e.autor?.nome || 'Desbravador'}</div>
              <div className="text-xs text-azul-claro font-semibold">{e.atividade?.titulo}</div>
            </div>
            <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 shrink-0 ${badge(e.status)}`}>{rotulo(e.status)}</span>
          </div>
          {e.texto && <p className="text-sm text-slate-600 mt-2 bg-slate-50 rounded-lg p-2 italic">"{e.texto}"</p>}
          {e.foto_url && e.foto_url.startsWith('http') && (
            ehVideo(e.foto_url) ? (
              <video src={e.foto_url} controls playsInline preload="metadata" className="mt-2 w-full max-h-56 rounded-lg bg-black" />
            ) : (
              <button onClick={() => setAmpliar(e.foto_url)} className="mt-2 block w-full">
                <img src={e.foto_url} alt="comprovação" loading="lazy" className="w-full max-h-48 object-cover rounded-lg" />
              </button>
            )
          )}
          <button onClick={() => onExcluir(e)}
            className="mt-3 w-full rounded-lg bg-red-50 text-red-600 hover:bg-red-100 py-2 text-sm font-semibold">
            🗑️ Apagar entrega{e.status === 'aprovada' ? ' (e os pontos)' : ''}
          </button>
        </div>
      ))}
      <AnimatePresence>
        {ampliar && (
          <motion.div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAmpliar(null)}>
            <img src={ampliar} alt="comprovação" className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Modal: criar nova atividade ---------- */
function NovaAtividadeModal({ onFechar, onSalvar, inicial }) {
  const [form, setForm] = useState(inicial ? {
    titulo: inicial.titulo || '', categoria: inicial.categoria || 'Espiritual',
    descricao: inicial.descricao || '', pts: inicial.pontos ?? 50,
    prazo: inicial.prazo ? String(inicial.prazo).slice(0, 10) : '',
    alvo: inicial.alvo || 'Todas as unidades',
    criterios: inicial.criterios || { foto: false, texto: true, arquivo: false },
  } : {
    titulo: '', categoria: 'Espiritual', descricao: '', pts: 50, prazo: '', alvo: 'Todas as unidades',
    criterios: { foto: false, texto: true, arquivo: false },
  })
  const [salvando, setSalvando] = useState(false)
  const set = (campo, v) => setForm((f) => ({ ...f, [campo]: v }))
  const toggle = (c) => setForm((f) => ({ ...f, criterios: { ...f.criterios, [c]: !f.criterios[c] } }))

  async function salvar(e) {
    e.preventDefault()
    setSalvando(true)
    await onSalvar({ ...form, pts: Number(form.pts) || 0 })
    setSalvando(false)
  }

  return (
    <Overlay onFechar={onFechar}>
      <Painel titulo={inicial ? '✏️ Editar atividade' : '➕ Nova atividade'} onFechar={onFechar}>
        <form onSubmit={salvar} className="p-5 space-y-3 overflow-y-auto">
          <Campo label="Título da atividade">
            <input className={inputClass} required value={form.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ex.: Ler o livro de João" />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Categoria">
              <select className={inputClass} value={form.categoria} onChange={(e) => set('categoria', e.target.value)}>
                {categorias.filter((c) => c.nome !== 'Todas').map((c) => <option key={c.nome}>{c.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Pontos">
              <input type="number" min="0" className={inputClass} value={form.pts} onChange={(e) => set('pts', e.target.value)} />
            </Campo>
          </div>
          <Campo label="Descrição / instruções">
            <textarea rows="3" className={inputClass} value={form.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="O que o desbravador deve fazer?" />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Prazo">
              <input type="date" className={inputClass} value={form.prazo} onChange={(e) => set('prazo', e.target.value)} />
            </Campo>
            <Campo label="Para quem">
              <select className={inputClass} value={form.alvo} onChange={(e) => set('alvo', e.target.value)}>
                {unidadesAlvo.map((u) => <option key={u}>{u}</option>)}
              </select>
            </Campo>
          </div>
          <Campo label="O que precisa entregar? (critérios)">
            <div className="flex gap-2">
              <Toggle ativo={form.criterios.foto} onClick={() => toggle('foto')}>📷 Foto/🎥 vídeo</Toggle>
              <Toggle ativo={form.criterios.texto} onClick={() => toggle('texto')}>✍️ Texto</Toggle>
              <Toggle ativo={form.criterios.arquivo} onClick={() => toggle('arquivo')}>📎 Arquivo</Toggle>
            </div>
          </Campo>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onFechar} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-semibold text-slate-600">Cancelar</button>
            <button type="submit" disabled={salvando} className="flex-1 rounded-lg bg-azul text-white py-2.5 font-semibold shadow disabled:opacity-60">{salvando ? 'Salvando...' : (inicial ? 'Salvar alterações' : 'Salvar atividade')}</button>
          </div>
        </form>
      </Painel>
    </Overlay>
  )
}

/* ---------- Modal: entregar atividade ---------- */
function EntregarModal({ atividade, onFechar, onConfirmar }) {
  const c = atividade.criterios || {}
  const [texto, setTexto] = useState('')
  const [foto, setFoto] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const previaEhVideo = foto?.type?.startsWith('video/')

  function escolherFoto(f) {
    setErro('')
    if (f && f.size > MAX_MB * 1024 * 1024) {
      setErro(`Arquivo grande demais (${(f.size / 1024 / 1024).toFixed(0)}MB). Máx. ${MAX_MB}MB — grave um vídeo mais curto.`)
      setFoto(null); setPrevia(null); return
    }
    setFoto(f || null)
    setPrevia(f ? URL.createObjectURL(f) : null)
  }

  async function confirmar() {
    if (c.foto && !foto) { setErro('Anexe a foto ou o vídeo de comprovação.'); return }
    setEnviando(true)
    setErro('')
    try {
      await onConfirmar(atividade, { texto, foto })
    } catch (e) {
      setErro(e?.message || String(e))
      setEnviando(false)
    }
  }

  return (
    <Overlay onFechar={onFechar}>
      <Painel titulo="📤 Entregar atividade" onFechar={onFechar}>
        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="font-bold text-slate-800">{atividade.titulo}</div>
            <div className="text-xs text-slate-500">{atividade.descricao}</div>
            <div className="text-xs text-dourado font-bold mt-1">Vale +{atividade.pontos} pontos</div>
          </div>
          {c.texto && (
            <Campo label="✍️ Sua resposta">
              <textarea rows="3" className={inputClass} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva aqui..." />
            </Campo>
          )}
          {(c.foto || c.arquivo) && (
            <Campo label={c.foto ? '📷 Foto ou 🎥 vídeo de comprovação' : '📎 Arquivo'}>
              <input type="file" accept={c.foto ? 'image/*,video/*' : undefined} className="text-sm w-full" onChange={(e) => escolherFoto(e.target.files?.[0])} />
              {previa && (previaEhVideo
                ? <video src={previa} controls playsInline className="mt-2 w-full max-h-56 rounded-lg bg-black" />
                : <img src={previa} alt="prévia" className="mt-2 w-full max-h-48 object-cover rounded-lg" />)}
              {foto && !previa && <p className="text-xs text-green-600 mt-1">Anexado: {foto.name}</p>}
              {c.foto && <p className="text-[11px] text-slate-400 mt-1">Pode ser foto ou vídeo (até {MAX_MB}MB).</p>}
            </Campo>
          )}
          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}
          <div className="flex gap-2 pt-2">
            <button onClick={onFechar} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-semibold text-slate-600">Cancelar</button>
            <button onClick={confirmar} disabled={enviando} className="flex-1 rounded-lg bg-azul text-white py-2.5 font-semibold shadow disabled:opacity-60">{enviando ? 'Enviando...' : 'Confirmar entrega'}</button>
          </div>
        </div>
      </Painel>
    </Overlay>
  )
}

/* ---------- Peças reutilizáveis ---------- */
function Overlay({ children, onFechar }) {
  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      {children}
    </motion.div>
  )
}
function Painel({ titulo, children, onFechar }) {
  return (
    <motion.div onClick={(e) => e.stopPropagation()}
      initial={{ y: 60, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 60, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
      <div className="bg-azul text-white px-5 py-4 flex items-center justify-between">
        <h3 className="font-extrabold">{titulo}</h3>
        <button onClick={onFechar} className="w-8 h-8 rounded-full bg-white/20 grid place-items-center">✕</button>
      </div>
      {children}
    </motion.div>
  )
}
function Campo({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  )
}
function Toggle({ ativo, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 rounded-xl px-2 py-2 text-sm font-medium border transition ${ativo ? 'bg-azul text-white border-azul shadow' : 'bg-white text-slate-600 border-slate-200'}`}>
      {children}
    </button>
  )
}
