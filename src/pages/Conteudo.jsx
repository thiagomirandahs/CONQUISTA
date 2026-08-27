import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarConteudo, salvarConteudo, excluirConteudo } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const CLASSES = ['Amigo', 'Companheiro', 'Pesquisador', 'Pioneiro', 'Excursionista', 'Guia']
const inputClass =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-brand focus:ring-2 focus:ring-brand/30'

// Painel pra liderança cadastrar o versículo do dia e os desafios das classes,
// sem depender de rodar SQL. O RLS já limita tudo a quem pode gerir.
export default function Conteudo() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [aba, setAba] = useState('versiculos')
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState(null) // item (edição) ou {} (novo)

  async function carregar() {
    setCarregando(true); setErro('')
    try { setLista(await carregarConteudo(aba)) } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  useEffect(() => { if (ehAdmin) carregar(); else setCarregando(false) }, [aba, ehAdmin]) // eslint-disable-line

  if (!ehAdmin) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área da liderança</p>
        <p className="text-sm text-faint">Apenas diretoria/instrutor podem editar o conteúdo.</p>
      </div>
    )
  }

  async function alternarAtivo(item) {
    try { await salvarConteudo(aba, { ativo: !item.ativo }, item.id); carregar() }
    catch (e) { alert('Não foi possível: ' + (e?.message || e)) }
  }
  async function excluir(item) {
    if (!window.confirm('Apagar este item? Ele sai do rodízio das missões.')) return
    try { await excluirConteudo(aba, item.id); carregar() }
    catch (e) { alert('Não foi possível: ' + (e?.message || e)) }
  }

  const ehVers = aba === 'versiculos'
  const ativos = lista.filter((i) => i.ativo).length

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">📖 Conteúdo</h2>
        <p className="text-sm text-muted">Versículos e desafios das missões diárias</p>
      </div>

      <div className="bg-surface rounded-xl p-1 flex shadow-soft mb-4 max-w-xs">
        {[['versiculos', '📖 Versículos'], ['desafios', '🎯 Desafios']].map(([k, lbl]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${aba === k ? 'bg-gradient-to-r from-brand to-brand2 text-white shadow-glow' : 'text-muted'}`}>{lbl}</button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-faint">{ativos} ativo{ativos === 1 ? '' : 's'} no rodízio · {lista.length} no total</span>
        <motion.button whileTap={{ scale: 0.94 }} onClick={() => setEditando({})}
          className="text-sm bg-gradient-to-r from-brand to-brand2 text-white rounded-xl px-4 py-2 font-semibold shadow-glow">+ Novo</motion.button>
      </div>

      {carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : erro ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">{erro}</div>
      ) : lista.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">{ehVers ? '📖' : '🎯'}</div>
          <p className="font-semibold text-ink">Nada cadastrado ainda</p>
          <p className="text-sm text-faint">Toque em "+ Novo" pra adicionar o primeiro.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map((item) => (
            <div key={item.id} className={`bg-surface rounded-2xl p-3 shadow-soft flex items-start gap-3 ${item.ativo ? '' : 'opacity-60'}`}>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink text-sm break-words">
                  {ehVers ? (item.texto || '(sem texto)') : (item.pergunta || '(sem pergunta)')}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {ehVers && item.referencia && <span className="text-[11px] bg-surface2 text-muted rounded-full px-2 py-0.5">📗 {item.referencia}</span>}
                  {!ehVers && <span className="text-[11px] bg-brand/10 text-brand rounded-full px-2 py-0.5">{item.classe || 'Geral'}</span>}
                  {!ehVers && item.pede_foto && <span className="text-[11px] bg-surface2 text-muted rounded-full px-2 py-0.5">📷 Foto</span>}
                  {!ehVers && !item.pede_foto && Array.isArray(item.opcoes) && <span className="text-[11px] bg-surface2 text-muted rounded-full px-2 py-0.5">❓ {item.opcoes.length} opções</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <button onClick={() => alternarAtivo(item)}
                  className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${item.ativo ? 'bg-green-100 text-green-700' : 'bg-surface2 text-muted'}`}>
                  {item.ativo ? '✅ Ativo' : '💤 Inativo'}
                </button>
                <div className="flex gap-1">
                  <button onClick={() => setEditando(item)} title="Editar" className="text-xs text-muted hover:bg-surface2 rounded-lg px-2 py-1">✏️</button>
                  <button onClick={() => excluir(item)} title="Apagar" className="text-xs text-red-500 hover:bg-red-50 rounded-lg px-2 py-1">🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {editando && (
          <FormConteudo aba={aba} inicial={editando.id ? editando : null}
            onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar() }} />
        )}
      </AnimatePresence>
    </div>
  )
}

function FormConteudo({ aba, inicial, onFechar, onSalvo }) {
  const ehVers = aba === 'versiculos'
  const [form, setForm] = useState(() => inicial ? {
    texto: inicial.texto || '', referencia: inicial.referencia || '',
    pergunta: inicial.pergunta || (ehVers ? 'De qual livro da Bíblia é este versículo?' : ''),
    tema: inicial.tema || '', classe: inicial.classe || '', pede_foto: !!inicial.pede_foto,
    opcoes: Array.isArray(inicial.opcoes) && inicial.opcoes.length ? inicial.opcoes.map(String) : ['', ''],
    correta: inicial.correta ?? 0, ativo: inicial.ativo !== false,
  } : {
    texto: '', referencia: '',
    pergunta: ehVers ? 'De qual livro da Bíblia é este versículo?' : '',
    tema: '', classe: '', pede_foto: false,
    opcoes: ['', ''], correta: 0, ativo: true,
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const semQuiz = !ehVers && form.pede_foto // desafio de foto não tem quiz

  const setOpcao = (i, v) => setForm((f) => ({ ...f, opcoes: f.opcoes.map((o, j) => (j === i ? v : o)) }))
  const addOpcao = () => setForm((f) => ({ ...f, opcoes: [...f.opcoes, ''] }))
  const removeOpcao = (i) => setForm((f) => {
    const opcoes = f.opcoes.filter((_, j) => j !== i)
    let correta = f.correta
    if (correta === i) correta = 0
    else if (correta > i) correta -= 1
    return { ...f, opcoes, correta }
  })

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (ehVers && !form.texto.trim()) return setErro('Escreva o versículo.')
    if (ehVers && !form.referencia.trim()) return setErro('Informe a referência (ex.: João 3:16).')
    if (!form.pergunta.trim()) return setErro(semQuiz ? 'Escreva a instrução da missão.' : 'Escreva a pergunta do quiz.')
    let opcoes = [], correta = 0
    if (!semQuiz) {
      opcoes = form.opcoes.map((o) => o.trim())
      if (opcoes.length < 2 || opcoes.some((o) => !o)) return setErro('Preencha pelo menos 2 opções, sem deixar nenhuma vazia.')
      correta = Math.min(Math.max(0, form.correta), opcoes.length - 1) // blinda contra índice fora do range
    }
    const payload = ehVers
      ? { texto: form.texto.trim(), referencia: form.referencia.trim(), pergunta: form.pergunta.trim(), opcoes, correta, ativo: form.ativo }
      : {
          tema: form.tema.trim() || null, texto: form.texto.trim() || null, pergunta: form.pergunta.trim(),
          opcoes, correta, classe: form.classe || null, pede_foto: form.pede_foto, ativo: form.ativo,
        }
    setSalvando(true)
    try { await salvarConteudo(aba, payload, inicial?.id); onSalvo() }
    catch (e2) { setErro(e2?.message || String(e2)); setSalvando(false) }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="bg-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="bg-gradient-to-r from-brand to-brand2 text-white px-5 py-4 flex items-center justify-between shrink-0">
          <h3 className="font-extrabold">{inicial ? 'Editar' : 'Novo'} {ehVers ? 'versículo' : 'desafio'}</h3>
          <button onClick={onFechar} className="w-8 h-8 rounded-full bg-white/20 grid place-items-center">✕</button>
        </div>

        <form onSubmit={salvar} className="p-5 space-y-3 overflow-y-auto">
          {ehVers ? (
            <>
              <Campo label="Versículo">
                <textarea rows="3" maxLength={400} className={inputClass} value={form.texto} onChange={(e) => set('texto', e.target.value)} placeholder="Ex.: Porque Deus amou o mundo de tal maneira..." />
              </Campo>
              <Campo label="Referência">
                <input className={inputClass} value={form.referencia} onChange={(e) => set('referencia', e.target.value)} placeholder="Ex.: João 3:16" />
              </Campo>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Tema (opcional)">
                  <input className={inputClass} value={form.tema} onChange={(e) => set('tema', e.target.value)} placeholder="Ex.: Nós, Lei..." />
                </Campo>
                <Campo label="Classe">
                  <select className={inputClass} value={form.classe} onChange={(e) => set('classe', e.target.value)}>
                    <option value="">Geral (todas)</option>
                    {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Campo>
              </div>
              <Campo label="Texto pra ler (opcional)">
                <textarea rows="3" className={inputClass} value={form.texto} onChange={(e) => set('texto', e.target.value)}
                  placeholder="A história, versículo ou explicação que a criança lê antes de responder. Aparece na missão." />
              </Campo>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={form.pede_foto} onChange={(e) => set('pede_foto', e.target.checked)} className="w-4 h-4 accent-brand" />
                📷 Missão de foto (a criança faz a tarefa e envia foto — sem quiz)
              </label>
            </>
          )}

          <Campo label={semQuiz ? 'Instrução da missão' : 'Pergunta do quiz'}>
            <input className={inputClass} value={form.pergunta} onChange={(e) => set('pergunta', e.target.value)}
              placeholder={semQuiz ? 'Ex.: Tire uma foto ajudando em casa' : 'Ex.: De qual livro é este versículo?'} />
          </Campo>

          {!semQuiz && (
            <Campo label="Opções (marque ⚪ a certa)">
              <div className="space-y-2">
                {form.opcoes.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="radio" name="correta" checked={form.correta === i} onChange={() => set('correta', i)} className="w-4 h-4 accent-brand shrink-0" />
                    <input value={o} onChange={(e) => setOpcao(i, e.target.value)} placeholder={`Opção ${i + 1}`} className={inputClass} />
                    {form.opcoes.length > 2 && (
                      <button type="button" onClick={() => removeOpcao(i)} className="text-red-400 hover:text-red-600 text-xl leading-none px-1 shrink-0">×</button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addOpcao} className="inline-block text-xs text-brand font-semibold mt-1 py-3 pr-4">+ opção</button>
            </Campo>
          )}

          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.ativo} onChange={(e) => set('ativo', e.target.checked)} className="w-4 h-4 accent-brand" />
            Ativo (entra no rodízio das missões)
          </label>

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onFechar} className="flex-1 rounded-lg border border-line py-2.5 font-semibold text-muted">Cancelar</button>
            <button type="submit" disabled={salvando} className="flex-1 rounded-lg bg-gradient-to-r from-brand to-brand2 text-white py-2.5 font-semibold shadow-glow disabled:opacity-60">{salvando ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

function Campo({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      {children}
    </div>
  )
}
