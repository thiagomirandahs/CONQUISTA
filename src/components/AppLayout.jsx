import { useState } from 'react'
import { Outlet, NavLink, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import Logo from './Logo.jsx'
import Notificacoes from './Notificacoes.jsx'
import DevocionalPopup from './DevocionalPopup.jsx'
import AvisosPopup from './AvisosPopup.jsx'
import { useAuth } from '../context/Auth.jsx'

const abasBase = [
  { to: '/ranking', label: 'Ranking', icon: '🏆' },
  { to: '/desafios', label: 'Desafios', icon: '🏁' },
  { to: '/chefao', label: 'Chefão', icon: '⚔️' },
  { to: '/missoes', label: 'Missões', icon: '🎯' },
  { to: '/trilha', label: 'Jogos', icon: '🎮' },
  { to: '/leilao', label: 'Leilão', icon: '🏛️' },
  { to: '/chat', label: 'Chat', icon: '💬' },
  { to: '/biblia', label: 'Bíblia', icon: '📖' },
  { to: '/bichinho', label: 'Bichinho', icon: '🐾' },
  { to: '/agenda', label: 'Agenda', icon: '📅' },
  { to: '/atividades', label: 'Atividades', icon: '📋' },
  { to: '/unidades', label: 'Unidades', icon: '🏠' },
  { to: '/mural', label: 'Mural', icon: '📸' },
]
const TEM_GESTAO = ['conselheiro', 'instrutor', 'diretoria', 'tesoureiro']
// Telas que o responsável (papel=pais) pode abrir. As demais o mandam pro Meu
// Filho — reforço de UX; a proteção de dados de verdade é o RLS no banco.
const CAMINHOS_PAI = ['/meu-filho', '/perfil']
// Barra inferior do celular: as 5 telas que a criançada mais usa, sempre à mão.
const ABAS_RODAPE = [
  { to: '/ranking', label: 'Ranking', icon: '🏆' },
  { to: '/desafios', label: 'Desafios', icon: '🏁' },
  { to: '/trilha', label: 'Jogos', icon: '🎮' },
  { to: '/biblia', label: 'Bíblia', icon: '📖' },
  { to: '/bichinho', label: 'Bichinho', icon: '🐾' },
]

// Moldura adaptável: menu lateral no PC, cabeçalho + barra inferior no celular.
export default function AppLayout() {
  const location = useLocation()
  const { sair, profile } = useAuth()
  const ehPai = profile?.papel === 'pais'
  const temGestao = TEM_GESTAO.includes(profile?.papel)
  const abas = ehPai
    ? [{ to: '/meu-filho', label: 'Meu Filho', icon: '👨‍👩‍👧' }]
    : temGestao ? [...abasBase, { to: '/gestao', label: 'Gestão', icon: '⚙️' }] : abasBase
  const [menuAberto, setMenuAberto] = useState(false)
  const [tema, setTema] = useState(() =>
    (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark') ? 'escuro' : 'claro')

  function alternarTema() {
    const novo = tema === 'escuro' ? 'claro' : 'escuro'
    document.documentElement.setAttribute('data-theme', novo === 'escuro' ? 'dark' : 'light')
    try { localStorage.setItem('tema', novo) } catch { /* sem storage */ }
    setTema(novo)
  }

  async function atualizarApp() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.()
      if (reg) await reg.update()
    } catch { /* ignora */ }
    window.location.reload()
  }

  if (ehPai && !CAMINHOS_PAI.includes(location.pathname)) {
    return <Navigate to="/meu-filho" replace />
  }

  // Um item do menu lateral (PC / gaveta) com realce em gradiente quando ativo.
  const linkLateral = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold transition-colors ${
      isActive ? 'text-white bg-gradient-to-r from-brand to-brand2 shadow-glow' : 'text-muted hover:bg-surface2'
    }`

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-full lg:flex">
      {!ehPai && <DevocionalPopup />}
      <AvisosPopup />

      {/* ===== Menu lateral (PC) ===== */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-64 z-30 glass border-r border-line">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-line">
          <Logo className="w-11 h-11 rounded-2xl shadow-soft" />
          <div className="leading-tight flex-1 min-w-0">
            <h1 className="font-extrabold text-ink truncate">Filhos da Conquista</h1>
            <p className="text-[11px] text-faint">Desbravadores · 1994</p>
          </div>
          <div className="shrink-0 text-ink"><Notificacoes /></div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {abas.map((aba) => (
            <NavLink key={aba.to} to={aba.to} className={linkLateral}>
              <span className="text-xl">{aba.icon}</span>
              <span>{aba.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 space-y-1 border-t border-line">
          {profile?.nome && <p className="px-4 pb-1 text-[11px] text-faint truncate">Olá, {profile.nome.split(' ')[0]} 👋</p>}
          <NavLink to="/perfil" className="block w-full text-sm bg-surface2 hover:bg-surface text-ink rounded-2xl px-4 py-2.5 text-left font-semibold transition-colors">
            👤 Meu perfil
          </NavLink>
          <button onClick={alternarTema} className="w-full text-sm bg-surface2 hover:bg-surface text-ink rounded-2xl px-4 py-2.5 text-left font-semibold transition-colors">
            {tema === 'escuro' ? '☀️ Modo claro' : '🌙 Modo escuro'}
          </button>
          <button onClick={atualizarApp} className="w-full text-sm bg-surface2 hover:bg-surface text-ink rounded-2xl px-4 py-2.5 text-left font-semibold transition-colors">
            🔄 Atualizar app
          </button>
          <button onClick={sair} className="w-full text-sm bg-surface2 hover:bg-surface text-ink rounded-2xl px-4 py-2.5 text-left font-semibold transition-colors">
            🚪 Sair
          </button>
        </div>
      </aside>

      {/* ===== Coluna de conteúdo ===== */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-full">
        {/* Cabeçalho (celular) — vidro */}
        <header className="lg:hidden sticky top-0 z-20 glass border-b border-line"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="px-4 py-2.5 flex items-center gap-3">
            <button onClick={() => setMenuAberto(true)} aria-label="Abrir menu"
              className="w-10 h-10 rounded-2xl grid place-items-center text-ink bg-surface2 text-xl leading-none">☰</button>
            <Logo className="w-9 h-9 rounded-xl shadow-soft" />
            <div className="leading-tight flex-1 min-w-0">
              <h1 className="font-extrabold text-[15px] text-ink truncate">Filhos da Conquista</h1>
              <p className="text-[10px] text-faint">Desbravadores · 1994</p>
            </div>
            <button onClick={alternarTema} aria-label="Alternar tema claro/escuro"
              className="w-9 h-9 rounded-xl grid place-items-center text-ink bg-surface2 text-lg leading-none">{tema === 'escuro' ? '☀️' : '🌙'}</button>
            <div className="text-ink"><Notificacoes /></div>
          </div>
        </header>

        {profile?.teste && (
          <div className="text-xs font-semibold text-center py-1.5 px-4 text-fun"
            style={{ background: 'color-mix(in srgb, var(--c-fun) 14%, transparent)' }}>
            🧪 Modo teste — nada aqui pontua nem entra no ranking
          </div>
        )}

        <main className="flex-1 w-full max-w-5xl mx-auto px-4 lg:px-8 py-5 lg:py-8 pb-28 lg:pb-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* ===== Barra inferior flutuante (celular) ===== */}
      {!ehPai && (
        <nav className="lg:hidden fixed z-30 left-3 right-3"
          style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
          <div className="glass rounded-[24px] shadow-soft grid grid-cols-5 max-w-lg mx-auto px-1.5 py-1.5">
            {ABAS_RODAPE.map((aba) => (
              <NavLink key={aba.to} to={aba.to}
                className={({ isActive }) =>
                  `relative flex flex-col items-center gap-0.5 pt-2 pb-1.5 rounded-2xl transition-colors ${isActive ? 'text-brand' : 'text-faint'}`
                }>
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span layoutId="rodape-ativo"
                        className="absolute -top-1.5 h-1 w-7 rounded-full bg-gradient-to-r from-brand to-brand2" />
                    )}
                    <motion.span animate={{ scale: isActive ? 1.16 : 1, y: isActive ? -1 : 0 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                      className="text-xl leading-none"
                      style={isActive ? { filter: 'drop-shadow(0 4px 10px var(--c-brand))' } : undefined}>{aba.icon}</motion.span>
                    <span className={`text-[10px] leading-none ${isActive ? 'font-extrabold' : 'font-semibold'}`}>{aba.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}

      {/* ===== Menu deslizante (celular) — abre no ☰ ===== */}
      <AnimatePresence>
        {menuAberto && (
          <div className="lg:hidden">
            <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={() => setMenuAberto(false)}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside className="fixed inset-y-0 left-0 w-72 max-w-[82vw] z-50 flex flex-col shadow-2xl glass border-r border-line"
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
              <div className="flex items-center gap-3 px-5 py-5 border-b border-line">
                <Logo className="w-11 h-11 rounded-2xl shadow-soft" />
                <div className="leading-tight flex-1 min-w-0">
                  <h1 className="font-extrabold text-ink truncate">Filhos da Conquista</h1>
                  <p className="text-[11px] text-faint">Desbravadores · 1994</p>
                </div>
                <button onClick={() => setMenuAberto(false)} aria-label="Fechar menu"
                  className="w-9 h-9 rounded-full bg-surface2 text-ink grid place-items-center shrink-0">✕</button>
              </div>
              <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {abas.map((aba) => (
                  <NavLink key={aba.to} to={aba.to} onClick={() => setMenuAberto(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold transition-colors ${
                        isActive ? 'text-white bg-gradient-to-r from-brand to-brand2 shadow-glow' : 'text-muted hover:bg-surface2'
                      }`
                    }>
                    <span className="text-xl">{aba.icon}</span>
                    <span>{aba.label}</span>
                  </NavLink>
                ))}
              </nav>
              <div className="p-3 space-y-1 border-t border-line">
                {profile?.nome && <p className="px-4 pb-1 text-[11px] text-faint truncate">Olá, {profile.nome.split(' ')[0]} 👋</p>}
                <NavLink to="/perfil" onClick={() => setMenuAberto(false)}
                  className="block w-full text-sm bg-surface2 hover:bg-surface text-ink rounded-2xl px-4 py-2.5 text-left font-semibold transition-colors">
                  👤 Meu perfil
                </NavLink>
                <button onClick={atualizarApp} className="w-full text-sm bg-surface2 hover:bg-surface text-ink rounded-2xl px-4 py-2.5 text-left font-semibold transition-colors">
                  🔄 Atualizar app
                </button>
                <button onClick={sair} className="w-full text-sm bg-surface2 hover:bg-surface text-ink rounded-2xl px-4 py-2.5 text-left font-semibold transition-colors">
                  🚪 Sair
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  )
}
