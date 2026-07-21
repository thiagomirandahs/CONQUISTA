import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import {
  carregarUsuarios, resetarSenha, mudarCargo, mudarUnidade, listarUnidades,
  lancarPontosIndividual, definirAtivoUsuario, excluirUsuario, definirTesteUsuario,
} from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const rotuloPapel = {
  desbravador: 'Desbravador', conselheiro: 'Conselheiro', instrutor: 'Instrutor',
  tesoureiro: 'Tesoureiro', diretoria: 'Diretoria', pais: 'Pais',
}

// Gera uma senha temporária fácil de passar (sem caracteres ambíguos).
function gerarSenha() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

export default function Usuarios() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [usuarios, setUsuarios] = useState([])
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [alvo, setAlvo] = useState(null)
  const [pontosPara, setPontosPara] = useState(null)
  const [excluindo, setExcluindo] = useState(null) // usuário no modal de exclusão
  const [erroCarregar, setErroCarregar] = useState('')
  const ehDiretoria = profile?.papel === 'diretoria'

  // Desativar/reativar: bloqueia (ou libera) o acesso sem apagar o histórico.
  async function alternarAtivo(u) {
    const desativando = u.status === 'ativo'
    if (desativando && !window.confirm(`Desativar ${u.nome || 'esta pessoa'}?\n\nEla não vai mais conseguir entrar e some do ranking, mas o histórico fica guardado. Dá pra reativar depois.`)) return
    try {
      await definirAtivoUsuario(u.id, !desativando)
      setUsuarios((us) => us.map((x) => (x.id === u.id ? { ...x, status: desativando ? 'inativo' : 'ativo' } : x)))
    } catch (e) {
      alert('Não foi possível: ' + (e?.message || e))
    }
  }

  // Conta de teste: usa o app à vontade sem pontuar e sem entrar no ranking.
  async function alternarTeste(u) {
    const ligando = !u.teste
    if (ligando && !window.confirm(`Marcar ${u.nome || 'esta conta'} como TESTE?\n\nEla para de ganhar pontos, pode repetir jogos/missões sem limite e some do ranking. Dá pra desmarcar depois.`)) return
    try {
      await definirTesteUsuario(u.id, ligando)
      setUsuarios((us) => us.map((x) => (x.id === u.id ? { ...x, teste: ligando } : x)))
    } catch (e) {
      alert('Não foi possível: ' + (e?.message || e))
    }
  }

  async function trocarCargo(u, novoPapel) {
    if (novoPapel === u.papel) return
    try {
      const r = await mudarCargo(u.id, novoPapel)
      setUsuarios((us) => us.map((x) => (x.id === u.id
        ? { ...x, papel: novoPapel, unidade_id: r?.limpouUnidade ? null : x.unidade_id }
        : x)))
    } catch (e) {
      alert('Não foi possível trocar o cargo: ' + (e?.message || e))
    }
  }

  async function trocarUnidade(u, novoId) {
    const alvoId = novoId || null
    if (alvoId === (u.unidade_id || null)) return
    try {
      await mudarUnidade(u.id, alvoId)
      setUsuarios((us) => us.map((x) => (x.id === u.id ? { ...x, unidade_id: alvoId } : x)))
    } catch (e) {
      alert('Não foi possível trocar a unidade: ' + (e?.message || e))
    }
  }

  useEffect(() => {
    if (!ehAdmin) { setCarregando(false); return }
    carregarUsuarios()
      .then((us) => {
        setUsuarios(us)
        setCarregando(false)
        // Unidades são secundárias: se falhar, a lista de usuários continua funcionando
        listarUnidades().then(setUnidades).catch(() => {})
      })
      .catch((e) => { setErroCarregar(e?.message || 'Erro ao carregar'); setCarregando(false) })
  }, [ehAdmin])

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área da diretoria</p>
        <p className="text-sm text-slate-400">Apenas diretoria/instrutor podem gerenciar usuários.</p>
      </div>
    )
  }

  const lista = usuarios.filter((u) => (u.nome || '').toLowerCase().includes(busca.toLowerCase()))

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">👥 Usuários</h2>
        <p className="text-sm text-slate-500">Trocar cargo e unidade, lançar pontos e resetar senha</p>
      </div>

      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar por nome..."
        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm mb-3 outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : erroCarregar ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
          <p className="font-semibold mb-1">Não consegui carregar os usuários</p>
          <p className="text-xs mb-2">{erroCarregar}</p>
          <p className="text-xs">Se a página é nova, falta rodar o SQL no Supabase (SQL Editor):
            <code className="bg-amber-100 rounded px-1 ml-1">supabase/2026-06-29-usuarios-reset-sql.sql</code></p>
        </div>
      ) : lista.length === 0 ? (
        <p className="text-slate-400 text-sm">Nenhum usuário encontrado.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
          {lista.map((u) => (
            <div key={u.id} className="px-3 py-3">
              <div className="flex items-center gap-3">
                <Avatar foto={u.foto} nome={u.nome} cor="#1e3a8a" size="w-9 h-9" textSize="text-sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm truncate">
                    {u.nome || '(sem nome)'}
                    {u.status === 'pendente' && <span className="ml-2 text-[10px] text-amber-600 font-normal">pendente</span>}
                    {u.status === 'inativo' && <span className="ml-2 text-[10px] text-slate-500 font-normal bg-slate-100 rounded px-1.5 py-0.5">desativado</span>}
                    {u.teste && <span className="ml-2 text-[10px] text-purple-700 font-normal bg-purple-100 rounded px-1.5 py-0.5">🧪 teste</span>}
                    {!u.unidade_id && (u.papel === 'desbravador' || u.papel === 'conselheiro') && (
                      <span className="ml-2 text-[10px] text-orange-600 font-normal">sem unidade</span>
                    )}
                  </div>
                  {u.email && <div className="text-[11px] text-azul/80 truncate">✉️ {u.email}</div>}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <select value={u.papel} onChange={(e) => trocarCargo(u, e.target.value)}
                  className="text-xs rounded-lg border border-slate-300 px-2 py-2 bg-white text-slate-700 outline-none">
                  {Object.entries(rotuloPapel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={u.unidade_id || ''} onChange={(e) => trocarUnidade(u, e.target.value)}
                  className="text-xs rounded-lg border border-slate-300 px-2 py-2 bg-white text-slate-700 outline-none max-w-[9.5rem]">
                  <option value="">🏳️ Sem unidade</option>
                  {unidades.map((un) => <option key={un.id} value={un.id}>🏠 {un.nome}</option>)}
                </select>
                <button onClick={() => setPontosPara(u)}
                  className="text-xs bg-dourado/20 text-amber-700 rounded-lg px-3 py-2 font-semibold">🎖️ Pontos</button>
                <button onClick={() => setAlvo(u)}
                  className="text-xs bg-azul/10 text-azul rounded-lg px-3 py-2 font-semibold">🔑 Senha</button>
                <button onClick={() => alternarAtivo(u)}
                  className={`text-xs rounded-lg px-3 py-2 font-semibold ${u.status === 'ativo' ? 'bg-slate-100 text-slate-600' : 'bg-green-50 text-green-700'}`}>
                  {u.status === 'ativo' ? '🚫 Desativar' : '✅ Reativar'}
                </button>
                {ehDiretoria && (
                  <button onClick={() => alternarTeste(u)}
                    className={`text-xs rounded-lg px-3 py-2 font-semibold ${u.teste ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                    {u.teste ? '🧪 Sair do teste' : '🧪 Teste'}
                  </button>
                )}
                {ehDiretoria && u.id !== profile?.id && (
                  <button onClick={() => setExcluindo(u)}
                    className="text-xs bg-red-50 text-red-600 rounded-lg px-3 py-2 font-semibold">🗑️ Excluir</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {excluindo && (
          <ModalExcluir usuario={excluindo} onFechar={() => setExcluindo(null)}
            onExcluido={(id) => { setUsuarios((us) => us.filter((x) => x.id !== id)); setExcluindo(null) }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {alvo && <ModalReset usuario={alvo} onFechar={() => setAlvo(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {pontosPara && <ModalPontos usuario={pontosPara} lancadoPor={profile?.id} onFechar={() => setPontosPara(null)} />}
      </AnimatePresence>
    </div>
  )
}

function ModalPontos({ usuario, lancadoPor, onFechar }) {
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function confirmar() {
    const n = parseInt(valor, 10)
    if (!n) { setErro('Digite os pontos (ex.: 20, ou -10 pra tirar).'); return }
    setSalvando(true)
    setErro('')
    try {
      await lancarPontosIndividual({ userId: usuario.id, pontos: n, motivo: motivo.trim(), lancadoPor })
      onFechar()
    } catch (e) {
      setErro('Não foi possível: ' + (e?.message || e))
      setSalvando(false)
    }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-slate-800 mb-1">🎖️ Pontos pra {(usuario.nome || '').split(' ')[0]}</h3>
        <p className="text-sm text-slate-500 mb-4">Pontos individuais (entram no ranking). Use número negativo pra tirar.</p>

        <label className="block text-xs font-semibold text-slate-500 mb-1">Pontos</label>
        <input type="number" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="ex.: 20"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm mb-2 outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />
        <div className="flex gap-1.5 mb-3">
          {[10, 20, 50, -10].map((q) => (
            <button type="button" key={q} onClick={() => setValor(String(q))}
              className="flex-1 rounded-lg py-1.5 text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50">{q > 0 ? '+' : ''}{q}</button>
          ))}
        </div>

        <label className="block text-xs font-semibold text-slate-500 mb-1">Motivo (opcional)</label>
        <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={120} placeholder="ex.: Ajudou na limpeza"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm mb-3 outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />

        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}
        <div className="flex gap-2">
          <button onClick={onFechar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Cancelar</button>
          <motion.button onClick={confirmar} disabled={salvando} whileTap={{ scale: 0.97 }}
            className="flex-1 rounded-xl bg-azul text-white font-semibold py-2.5 disabled:opacity-60">{salvando ? '...' : 'Lançar'}</motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ModalReset({ usuario, onFechar }) {
  const [senha, setSenha] = useState(gerarSenha)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [pronto, setPronto] = useState(false)
  const [copiado, setCopiado] = useState(false)

  async function confirmar() {
    if (senha.length < 6) { setErro('A senha precisa ter pelo menos 6 caracteres.'); return }
    setSalvando(true)
    setErro('')
    try {
      await resetarSenha(usuario.id, senha)
      setPronto(true)
    } catch (e) {
      setErro('Não foi possível: ' + (e?.message || e))
      setSalvando(false)
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch { /* alguns navegadores bloqueiam: a senha já está visível */ }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-slate-800 mb-1">🔑 Resetar senha</h3>
        <p className="text-sm text-slate-500 mb-3">Nova senha para <strong>{usuario.nome}</strong>.</p>

        {usuario.email ? (
          <div className="bg-slate-50 rounded-xl p-3 mb-4 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-slate-400">E-mail do cadastro</div>
              <div className="font-medium text-slate-800 text-sm truncate select-all">{usuario.email}</div>
            </div>
            <a href={`mailto:${usuario.email}`} className="text-azul text-xs font-semibold bg-azul/10 rounded-lg px-3 py-2 shrink-0">✉️ Enviar</a>
          </div>
        ) : (
          <div className="bg-slate-50 rounded-xl p-3 mb-4 text-xs text-slate-400">Sem e-mail no cadastro.</div>
        )}

        {pronto ? (
          <>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center mb-4">
              <p className="text-sm text-green-700 font-semibold mb-1">✅ Senha redefinida!</p>
              <p className="text-xs text-slate-500 mb-2">Passe esta senha para {(usuario.nome || '').split(' ')[0]}:</p>
              <div className="text-xl font-extrabold tracking-wider text-slate-800 bg-white rounded-lg py-2 border border-slate-200 select-all">{senha}</div>
              <button onClick={copiar} className="text-xs text-azul font-semibold mt-2">{copiado ? 'Copiado! ✓' : '📋 Copiar senha'}</button>
            </div>
            <button onClick={onFechar} className="w-full rounded-xl bg-azul text-white font-semibold py-2.5">Fechar</button>
          </>
        ) : (
          <>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Nova senha (mín. 6)</label>
            <div className="flex gap-2 mb-3">
              <input value={senha} onChange={(e) => setSenha(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />
              <button type="button" onClick={() => setSenha(gerarSenha())}
                className="text-xs bg-slate-100 text-slate-600 rounded-lg px-3 font-semibold">🎲 Gerar</button>
            </div>
            {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}
            <div className="flex gap-2">
              <button onClick={onFechar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Cancelar</button>
              <motion.button onClick={confirmar} disabled={salvando} whileTap={{ scale: 0.97 }}
                className="flex-1 rounded-xl bg-azul text-white font-semibold py-2.5 disabled:opacity-60">
                {salvando ? 'Salvando...' : 'Definir senha'}
              </motion.button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

// Exclusão definitiva: mostra o que se perde e exige digitar EXCLUIR.
function ModalExcluir({ usuario, onFechar, onExcluido }) {
  const [texto, setTexto] = useState('')
  const [apagando, setApagando] = useState(false)
  const [erro, setErro] = useState('')
  const confirmado = texto.trim().toUpperCase() === 'EXCLUIR'

  async function apagar() {
    if (!confirmado || apagando) return
    setApagando(true); setErro('')
    try {
      await excluirUsuario(usuario.id)
      onExcluido(usuario.id)
    } catch (e) {
      setErro(e?.message || String(e))
      setApagando(false)
    }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={apagando ? undefined : onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-red-600 mb-1">🗑️ Excluir {usuario.nome || 'usuário'}</h3>
        <p className="text-sm text-slate-600 mb-3">Isso é <strong>permanente</strong>. Vai apagar junto:</p>
        <ul className="text-sm text-slate-600 bg-red-50 border border-red-200 rounded-xl p-3 mb-3 space-y-0.5">
          <li>• Todos os <b>pontos</b> dela (a média da unidade muda)</li>
          <li>• <b>Entregas</b> de atividades, <b>mensalidades</b> e <b>jogos</b></li>
          <li className="text-slate-500">• As <b>fotos do mural</b> ficam (só perdem o autor)</li>
        </ul>
        <p className="text-xs text-slate-500 mb-3">
          Se a pessoa só saiu do clube, prefira <b>🚫 Desativar</b> — guarda o histórico e dá pra reativar.
        </p>

        <label className="block text-xs font-semibold text-slate-500 mb-1">Digite <b>EXCLUIR</b> pra confirmar</label>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="EXCLUIR" disabled={apagando}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200 mb-3" />

        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}

        <div className="flex gap-2">
          <button onClick={onFechar} disabled={apagando}
            className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5 disabled:opacity-60">Cancelar</button>
          <button onClick={apagar} disabled={!confirmado || apagando}
            className="flex-1 rounded-xl bg-red-600 text-white font-bold py-2.5 disabled:opacity-40">
            {apagando ? 'Excluindo...' : 'Excluir de vez'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
