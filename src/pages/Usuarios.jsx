import { Carregando as Esqueleto } from '../ui/index.jsx'
import { useState, useEffect } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import Avatar from '../components/Avatar.jsx'
import {
  carregarUsuarios, resetarSenha, mudarCargo, mudarUnidade, listarUnidades,
  lancarPontosIndividual, definirAtivoUsuario, excluirUsuario, definirTesteUsuario,
} from '../lib/dados.js'
import { avisar } from '../ui/avisos.jsx'
import { ConvidarEquipe } from '../components/ConvitesDeEquipe.jsx'
import EditarNascimento from '../components/EditarNascimento.jsx'
import { carregarClassesDoMembro, cancelarClasse } from '../services/classes.js'
import { mensagemDeErro } from '../ui/index.jsx'

const PODE_GERIR = ['instrutor', 'diretoria']
const rotuloPapel = {
  desbravador: 'Desbravador', conselheiro: 'Conselheiro', instrutor: 'Instrutor',
  tesoureiro: 'Tesoureiro', diretoria: 'Diretoria', pais: 'Pais',
}

// Gera uma senha temporária fácil de passar (sem caracteres ambíguos).
// A política de senha é a do Auth (fase 8.1): 8 caracteres, com letras E números — e desde a
// migration 77 o servidor a aplica também aqui. Sortear 8 de um alfabeto misto dava "só letras" em
// ~1 de cada 10 senhas sugeridas, que o servidor recusaria; por isso uma letra e um dígito são
// garantidos, e a posição deles é embaralhada.
const LETRAS = 'abcdefghijkmnpqrstuvwxyz'
const DIGITOS = '23456789'
const sorteia = (s) => s[Math.floor(Math.random() * s.length)]
export function gerarSenha() {
  const cs = [sorteia(LETRAS), sorteia(DIGITOS)]
  while (cs.length < 8) cs.push(sorteia(LETRAS + DIGITOS))
  for (let i = cs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cs[i], cs[j]] = [cs[j], cs[i]] }
  return cs.join('')
}
export const senhaValida = (s) => s.length >= 8 && /[A-Za-z]/.test(s) && /[0-9]/.test(s)

export default function Usuarios() {
  const { profile } = useAuth()
  const { papel: meuPapel } = useClube()
  const ehAdmin = PODE_GERIR.includes(meuPapel)
  const [usuarios, setUsuarios] = useState([])
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [alvo, setAlvo] = useState(null)
  const [pontosPara, setPontosPara] = useState(null)
  const [excluindo, setExcluindo] = useState(null) // usuário no modal de exclusão
  const [nascimentoDe, setNascimentoDe] = useState(null) // corrigir a data de nascimento (migration 170)
  const [classesDe, setClassesDe] = useState(null) // classes do membro, para cancelar (migration 171)
  const [erroCarregar, setErroCarregar] = useState('')
  const ehDiretoria = meuPapel === 'diretoria'
  // promover a diretoria/instrutor/tesoureiro (ou mexer em quem já tem esses cargos) é só da DIRETORIA
  const CARGOS_DA_DIRETORIA = ['diretoria', 'instrutor', 'tesoureiro']

  // Desativar/reativar: bloqueia (ou libera) o acesso A ESTE CLUBE sem apagar o histórico.
  // O texto do diálogo diz o que de fato acontece. Ele prometia "não vai mais conseguir entrar", e
  // isso deixou de ser verdade quando o login parou de barrar pelo espelho profiles.status: a conta
  // continua entrando (e segue normal em outro clube, se estiver em outro); o que ela perde é ESTE
  // clube — ao entrar, vê "Seu acesso está suspenso" e o recado para falar com a liderança.
  async function alternarAtivo(u) {
    const desativando = u.status === 'ativo'
    if (desativando && !(await avisar.confirmar({ titulo: `Desativar ${u.nome || 'esta pessoa'}?`, descricao: 'Ela perde o acesso a este clube e some do ranking. Ao entrar, verá que o acesso está suspenso. O histórico fica guardado e dá pra reativar depois.', rotulo: 'Desativar' }))) return
    try {
      await definirAtivoUsuario(u.id, !desativando)
      setUsuarios((us) => us.map((x) => (x.id === u.id ? { ...x, status: desativando ? 'inativo' : 'ativo' } : x)))
    } catch (e) {
      avisar.erro(e, 'Não consegui aplicar a mudança.')
    }
  }

  // Conta de teste: usa o app à vontade sem pontuar e sem entrar no ranking.
  async function alternarTeste(u) {
    const ligando = !u.teste
    if (ligando && !(await avisar.confirmar({ titulo: `Marcar ${u.nome || 'esta conta'} como teste?`, descricao: 'Ela para de ganhar pontos, pode repetir jogos e missões sem limite e some do ranking. Dá pra desmarcar depois.', rotulo: 'Marcar como teste', perigo: false }))) return
    try {
      await definirTesteUsuario(u.id, ligando)
      setUsuarios((us) => us.map((x) => (x.id === u.id ? { ...x, teste: ligando } : x)))
    } catch (e) {
      avisar.erro(e, 'Não consegui aplicar a mudança.')
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
      avisar.erro(e, 'Não consegui trocar o cargo.')
    }
  }

  async function trocarUnidade(u, novoId) {
    const alvoId = novoId || null
    if (alvoId === (u.unidade_id || null)) return
    try {
      await mudarUnidade(u.id, alvoId)
      setUsuarios((us) => us.map((x) => (x.id === u.id ? { ...x, unidade_id: alvoId } : x)))
    } catch (e) {
      avisar.erro(e, 'Não consegui trocar a unidade.')
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
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área da diretoria</p>
        <p className="text-sm text-faint">Apenas diretoria/instrutor podem gerenciar usuários.</p>
      </div>
    )
  }

  const lista = usuarios.filter((u) => (u.nome || '').toLowerCase().includes(busca.toLowerCase()))

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">👥 Usuários</h2>
        <p className="text-sm text-muted">Trocar cargo e unidade, lançar pontos e resetar senha</p>
      </div>

      {/* Quem JA tem conta no DesbravaClube entra aqui, por convite — a lista abaixo e de quem ja
          esta no clube. Ate a fase 8.4 nao havia caminho nenhum: o fundador de um clube novo nao
          conseguia trazer um instrutor que ja tivesse conta em outro lugar. */}
      <div className="mb-4"><ConvidarEquipe /></div>

      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar por nome..."
        className="w-full rounded-xl border border-line bg-surface2 text-ink placeholder:text-faint px-3 py-2.5 text-sm mb-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />

      {carregando ? (
        <Esqueleto />
      ) : erroCarregar ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
          <p className="font-semibold mb-1">Não consegui carregar os usuários</p>
          <p className="text-xs mb-2">{erroCarregar}</p>
          <p className="text-xs">Se a página é nova, falta rodar o SQL no Supabase (SQL Editor):
            <code className="bg-amber-100 rounded px-1 ml-1">supabase/2026-06-29-usuarios-reset-sql.sql</code></p>
        </div>
      ) : lista.length === 0 ? (
        <p className="text-faint text-sm">Nenhum usuário encontrado.</p>
      ) : (
        <div className="bg-surface rounded-2xl shadow-soft divide-y divide-line">
          {lista.map((u) => (
            <div key={u.id} className="px-3 py-3">
              <div className="flex items-center gap-3">
                <Avatar foto={u.foto} nome={u.nome} cor="#1e3a8a" size="w-9 h-9" textSize="text-sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink text-sm truncate">
                    {u.nome || '(sem nome)'}
                    {u.status === 'pendente' && <span className="ml-2 text-xs text-amber-600 font-normal">pendente</span>}
                    {u.status === 'inativo' && <span className="ml-2 text-xs text-muted font-normal bg-surface2 rounded px-1.5 py-0.5">desativado</span>}
                    {/* listar_usuarios devolve o vínculo ENCERRADO como 'rejeitado'; sem esta marca ele
                        aparecia igual a um membro ativo, só que sem os botões de senha e teste */}
                    {u.status === 'rejeitado' && <span className="ml-2 text-xs text-muted font-normal bg-surface2 rounded px-1.5 py-0.5">recusado</span>}
                    {u.teste && <span className="ml-2 text-xs text-purple-700 font-normal bg-purple-100 rounded px-1.5 py-0.5">🧪 teste</span>}
                    {!u.unidade_id && (u.papel === 'desbravador' || u.papel === 'conselheiro') && (
                      <span className="ml-2 text-xs text-orange-600 font-normal">sem unidade</span>
                    )}
                  </div>
                  {u.email && <div className="text-xs text-brand/80 truncate">✉️ {u.email}</div>}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <select value={u.papel} onChange={(e) => trocarCargo(u, e.target.value)}
                  disabled={!ehDiretoria && CARGOS_DA_DIRETORIA.includes(u.papel)}
                  className="text-xs rounded-lg border border-line px-2 py-2 bg-surface text-ink outline-none disabled:opacity-60">
                  {Object.entries(rotuloPapel)
                    .filter(([k]) => ehDiretoria || !CARGOS_DA_DIRETORIA.includes(k) || k === u.papel)
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={u.unidade_id || ''} onChange={(e) => trocarUnidade(u, e.target.value)}
                  className="text-xs rounded-lg border border-line px-2 py-2 bg-surface text-ink outline-none max-w-[9.5rem]">
                  <option value="">🏳️ Sem unidade</option>
                  {unidades.map((un) => <option key={un.id} value={un.id}>🏠 {un.nome}</option>)}
                </select>
                <button onClick={() => setPontosPara(u)}
                  className="text-xs bg-gold/20 text-amber-700 rounded-lg px-3 py-2 font-semibold">🎖️ Pontos</button>
                {/* Senha e modo teste só para quem está ATIVO neste clube: o servidor recusa os
                    outros (resetar_senha_membro e membro_definir_teste, migration 80). Recusar
                    'pendente' é de propósito — um vínculo pendente nasce de QUALQUER conta que digita
                    o código, e trocar a senha dela seria tomar uma conta que o clube nem aprovou. O
                    caminho é aprovar (ou reativar) primeiro. Antes os botões apareciam para todos e
                    a liderança só descobria a recusa depois de tocar. */}
                {u.status === 'ativo' && (
                  <button onClick={() => setAlvo(u)} data-testid={`senha-${u.id}`}
                    className="text-xs bg-brand/10 text-brand rounded-lg px-3 py-2 font-semibold">🔑 Senha</button>
                )}
                {u.status === 'ativo' && (
                  <button onClick={() => setNascimentoDe(u)} data-testid={`nascimento-${u.id}`}
                    className="text-xs bg-surface2 text-ink rounded-lg px-3 py-2 font-semibold">🎂 Nascimento</button>
                )}
                {u.status === 'ativo' && u.papel !== 'pais' && (
                  <button onClick={() => setClassesDe(u)} data-testid={`classes-${u.id}`}
                    className="text-xs bg-surface2 text-ink rounded-lg px-3 py-2 font-semibold">🎖️ Classes</button>
                )}
                {(ehDiretoria || !CARGOS_DA_DIRETORIA.includes(u.papel)) && (
                  <button onClick={() => alternarAtivo(u)}
                    className={`text-xs rounded-lg px-3 py-2 font-semibold ${u.status === 'ativo' ? 'bg-surface2 text-muted' : 'bg-green-50 text-green-700'}`}>
                    {u.status === 'ativo' ? '🚫 Desativar' : '✅ Reativar'}
                  </button>
                )}
                {ehDiretoria && u.status === 'ativo' && (
                  <button onClick={() => alternarTeste(u)}
                    className={`text-xs rounded-lg px-3 py-2 font-semibold ${u.teste ? 'bg-purple-100 text-purple-700' : 'bg-surface2 text-muted'}`}>
                    {u.teste ? '🧪 Sair do teste' : '🧪 Teste'}
                  </button>
                )}
                {ehDiretoria && u.id !== profile?.id && (
                  <button onClick={() => setExcluindo(u)}
                    className="text-xs bg-red-50 text-red-600 rounded-lg px-3 py-2 font-semibold">🗑️ Excluir</button>
                )}
              </div>
              {u.status !== 'ativo' && (
                <p className="text-xs text-faint mt-1.5" data-testid={`so-ativo-${u.id}`}>
                  Senha{ehDiretoria ? ' e modo teste' : ''} só para quem está ativo: {u.status === 'pendente' ? 'aprove' : 'reative'} primeiro.
                </p>
              )}
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
      {nascimentoDe && (
        <EditarNascimento usuarioId={nascimentoDe.id} nome={nascimentoDe.nome} proprio={nascimentoDe.id === profile?.id}
          onFechar={() => setNascimentoDe(null)}
          onSalvo={() => { avisar.sucesso('Data de nascimento atualizada.'); setNascimentoDe(null) }} />
      )}
      {classesDe && <ModalClassesDoMembro usuario={classesDe} onFechar={() => setClassesDe(null)} />}
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
        className="bg-surface w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-ink mb-1">🎖️ Pontos pra {(usuario.nome || '').split(' ')[0]}</h3>
        <p className="text-sm text-muted mb-4">Pontos individuais (entram no ranking). Use número negativo pra tirar.</p>

        <label className="block text-xs font-semibold text-muted mb-1">Pontos</label>
        <input type="number" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="ex.: 20"
          className="w-full rounded-lg border border-line bg-surface2 text-ink placeholder:text-faint px-3 py-2.5 text-sm mb-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
        <div className="flex gap-1.5 mb-3">
          {[10, 20, 50, -10].map((q) => (
            <button type="button" key={q} onClick={() => setValor(String(q))}
              className="flex-1 rounded-lg py-1.5 text-xs font-semibold border border-line text-muted hover:bg-surface2">{q > 0 ? '+' : ''}{q}</button>
          ))}
        </div>

        <label className="block text-xs font-semibold text-muted mb-1">Motivo (opcional)</label>
        <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={120} placeholder="ex.: Ajudou na limpeza"
          className="w-full rounded-lg border border-line bg-surface2 text-ink placeholder:text-faint px-3 py-2.5 text-sm mb-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />

        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}
        <div className="flex gap-2">
          <button onClick={onFechar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Cancelar</button>
          <motion.button onClick={confirmar} disabled={salvando} whileTap={{ scale: 0.97 }}
            className="flex-1 rounded-xl bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-semibold py-2.5 disabled:opacity-60">{salvando ? '...' : 'Lançar'}</motion.button>
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
    if (!senhaValida(senha)) { setErro('A senha precisa ter pelo menos 8 caracteres, com letras e números.'); return }
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
        className="bg-surface w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-ink mb-1">🔑 Resetar senha</h3>
        <p className="text-sm text-muted mb-3">Nova senha para <strong>{usuario.nome}</strong>.</p>

        {usuario.email ? (
          <div className="bg-surface2 rounded-xl p-3 mb-4 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-faint">E-mail do cadastro</div>
              <div className="font-medium text-ink text-sm truncate select-all">{usuario.email}</div>
            </div>
            <a href={`mailto:${usuario.email}`} className="text-brand text-xs font-semibold bg-brand/10 rounded-lg px-3 py-2 shrink-0">✉️ Enviar</a>
          </div>
        ) : (
          <div className="bg-surface2 rounded-xl p-3 mb-4 text-xs text-faint">Sem e-mail no cadastro.</div>
        )}

        {pronto ? (
          <>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center mb-4">
              <p className="text-sm text-green-700 font-semibold mb-1">✅ Senha redefinida!</p>
              <p className="text-xs text-muted mb-2">Passe esta senha para {(usuario.nome || '').split(' ')[0]}:</p>
              <div className="text-xl font-extrabold tracking-wider text-ink bg-surface rounded-lg py-2 border border-line select-all">{senha}</div>
              <button onClick={copiar} className="text-xs text-brand font-semibold mt-2">{copiado ? 'Copiado! ✓' : '📋 Copiar senha'}</button>
            </div>
            <button onClick={onFechar} className="w-full rounded-xl bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-semibold py-2.5">Fechar</button>
          </>
        ) : (
          <>
            <label className="block text-xs font-semibold text-muted mb-1">Nova senha (mín. 8, com letras e números)</label>
            <div className="flex gap-2 mb-3">
              <input value={senha} onChange={(e) => setSenha(e.target.value)}
                className="flex-1 rounded-lg border border-line bg-surface2 text-ink placeholder:text-faint px-3 py-2.5 text-sm font-mono outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
              <button type="button" onClick={() => setSenha(gerarSenha())}
                className="text-xs bg-surface2 text-muted rounded-lg px-3 font-semibold">🎲 Gerar</button>
            </div>
            {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}
            <div className="flex gap-2">
              <button onClick={onFechar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Cancelar</button>
              <motion.button onClick={confirmar} disabled={salvando} whileTap={{ scale: 0.97 }}
                className="flex-1 rounded-xl bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-semibold py-2.5 disabled:opacity-60">
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
        className="bg-surface w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-red-600 mb-1">🗑️ Excluir {usuario.nome || 'usuário'}</h3>
        <p className="text-sm text-muted mb-3">Isso é <strong>permanente</strong>. Vai apagar junto:</p>
        <ul className="text-sm text-muted bg-red-50 border border-red-200 rounded-xl p-3 mb-3 space-y-0.5">
          <li>• Todos os <b>pontos</b> dela (a média da unidade muda)</li>
          <li>• <b>Entregas</b> de atividades, <b>mensalidades</b> e <b>jogos</b></li>
          <li className="text-muted">• As <b>fotos do mural</b> ficam (só perdem o autor)</li>
        </ul>
        <p className="text-xs text-muted mb-3">
          Se a pessoa só saiu do clube, prefira <b>🚫 Desativar</b> — guarda o histórico e dá pra reativar.
        </p>

        <label className="block text-xs font-semibold text-muted mb-1">Digite <b>EXCLUIR</b> pra confirmar</label>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="EXCLUIR" disabled={apagando}
          className="w-full rounded-lg border border-line bg-surface2 text-ink placeholder:text-faint px-3 py-2.5 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200 mb-3" />

        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}

        <div className="flex gap-2">
          <button onClick={onFechar} disabled={apagando}
            className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5 disabled:opacity-60">Cancelar</button>
          <button onClick={apagar} disabled={!confirmado || apagando}
            className="flex-1 rounded-xl bg-red-600 text-white font-bold py-2.5 disabled:opacity-40">
            {apagando ? 'Excluindo...' : 'Excluir de vez'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// Classes de um membro (liderança): cancelar a matrícula em andamento. Concluída, em revisão ou
// investida não têm botão (o servidor também recusa). Nada é apagado: o progresso fica no histórico.
export function ModalClassesDoMembro({ usuario, onFechar }) {
  const [classes, setClasses] = useState(null)
  const [erro, setErro] = useState('')
  const [confirmando, setConfirmando] = useState(null) // member_class_id
  const [ocupado, setOcupado] = useState(false)
  const primeiro = (usuario.nome || 'esta pessoa').split(' ')[0]

  useEffect(() => {
    let vivo = true
    carregarClassesDoMembro(usuario.id)
      .then((c) => { if (vivo) setClasses(c) })
      .catch((e) => { if (vivo) { setErro(mensagemDeErro(e)); setClasses([]) } })
    return () => { vivo = false }
  }, [usuario.id])

  async function cancelar(mcId) {
    setOcupado(true); setErro('')
    try {
      await cancelarClasse(mcId)
      setClasses((cs) => cs.filter((c) => c.member_class_id !== mcId))
      setConfirmando(null)
      avisar.sucesso('Classe cancelada. O progresso ficou guardado no histórico.')
    } catch (e) {
      setErro(mensagemDeErro(e))
    }
    setOcupado(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={ocupado ? undefined : onFechar}>
      <div role="dialog" aria-modal="true" aria-labelledby="titulo-classes-membro" onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto" data-testid="classes-do-membro">
        <h3 id="titulo-classes-membro" className="text-lg font-extrabold text-ink mb-1">🎖️ Classes de {primeiro}</h3>
        <p className="text-sm text-muted mb-3">Cancelar uma classe em andamento não apaga nada: o progresso fica no histórico e dá para reiniciar depois.</p>
        {erro && <p role="alert" className="text-sm text-red-700 mb-3">{erro}</p>}
        {classes === null ? (
          <p className="text-sm text-faint" role="status">Carregando…</p>
        ) : classes.length === 0 ? (
          <p className="text-sm text-faint">Nenhuma classe iniciada.</p>
        ) : (
          <ul className="space-y-2">
            {classes.map((c) => (
              <li key={c.member_class_id} className="rounded-xl border border-line p-3" data-testid="classe-do-membro">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{c.nome}</span>
                  <span className="text-sm text-muted">{c.status === 'em_andamento' ? `${c.percentual ?? 0}%` : c.status === 'investida' ? 'Investido' : 'Concluída'}</span>
                </div>
                {c.status === 'em_andamento' && (confirmando === c.member_class_id ? (
                  <div className="mt-2">
                    <p className="text-sm text-ink">Cancelar {c.nome} de {primeiro}? O progresso fica guardado no histórico.</p>
                    <div className="flex gap-2 mt-2">
                      <button type="button" onClick={() => setConfirmando(null)} disabled={ocupado}
                        className="flex-1 min-h-[44px] rounded-xl bg-surface2 text-ink font-semibold">Voltar</button>
                      <button type="button" onClick={() => cancelar(c.member_class_id)} disabled={ocupado} data-testid="confirmar-cancelar-membro"
                        className="flex-1 min-h-[44px] rounded-xl bg-red-600 text-white font-bold disabled:opacity-60">{ocupado ? 'Cancelando…' : 'Sim, cancelar'}</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmando(c.member_class_id)} data-testid="cancelar-classe-membro"
                    className="mt-2 min-h-[44px] w-full rounded-xl bg-surface2 text-red-700 font-semibold">Cancelar matrícula</button>
                ))}
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={onFechar} disabled={ocupado}
          className="mt-4 w-full min-h-[48px] rounded-xl bg-surface2 text-ink font-semibold">Fechar</button>
      </div>
    </div>
  )
}
