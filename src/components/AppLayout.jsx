import { useState } from 'react'
import { Outlet, NavLink, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Logo from './Logo.jsx'
import Notificacoes from './Notificacoes.jsx'
import DevocionalPopup from './DevocionalPopup.jsx'
import AvisosPopup from './AvisosPopup.jsx'
import { useAuth } from '../context/Auth.jsx'

const abasBase = [
  { to: '/ranking', label: 'Ranking', icon: '🏆' },
  { to: '/desafios', label: 'Desafios', icon: '🏁' },
  { to: '/missoes', label: 'Missões', icon: '🎯' },
  { to: '/trilha', label: 'Jogos', icon: '🎮' },
  { to: '/agenda', label: 'Agenda', icon: '📅' },
  { to: '/atividades', label: 'Atividades', icon: '📋' },
  { to: '/unidades', label: 'Unidades', icon: '🏠' },
  { to: '/mural', label: 'Mural', icon: '📸' },
]
const TEM_GESTAO = ['conselheiro', 'instrutor', 'diretoria', 'tesoureiro']
// Telas que o responsável (papel=pais) pode abrir. As demais o mandam pro Meu
// Filho — reforço de UX; a proteção de dados de verdade é o RLS no banco.
const CAMINHOS_PAI = ['/meu-filho', '/perfil']

// Moldura adaptável: menu lateral no PC, menu inferior no celular
export default function AppLayout() {
  const location = useLocation()
  const { sair, profile } = useAuth()
  const ehPai = profile?.papel === 'pais'
  const temGestao = TEM_GESTAO.includes(profile?.papel)
  // O responsável tem uma navegação enxuta (só "Meu Filho").
  const abas = ehPai
    ? [{ to: '/meu-filho', label: 'Meu Filho', icon: '👨‍👩‍👧' }]
    : temGestao ? [...abasBase, { to: '/gestao', label: 'Gestão', icon: '⚙️' }] : abasBase
  const [menuAberto, setMenuAberto] = useState(false)

  // Força buscar a versão mais nova e recarregar (reforço da auto-atualização)
  async function atualizarApp() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.()
      if (reg) await reg.update()
    } catch { /* ignora */ }
    window.location.reload()
  }

  // O pai não navega pelas telas de membro (evita ver tela vazia após a blindagem)
  if (ehPai && !CAMINHOS_PAI.includes(location.pathname)) {
    return <Navigate to="/meu-filho" replace />
  }

  return (
    <div className="min-h-full lg:flex">
      {!ehPai && <DevocionalPopup />}
      <AvisosPopup />
      {/* ===== Menu lateral (PC) ===== */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-64 bg-azul text-white z-30">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
          <Logo className="w-11 h-11 rounded-lg" />
          <div className="leading-tight flex-1 min-w-0">
            <h1 className="font-extrabold truncate">Filhos da Conquista</h1>
            <p className="text-[11px] text-blue-200">Desbravadores · 1994</p>
          </div>
          <div className="shrink-0 text-white"><Notificacoes /></div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {abas.map((aba) => (
            <NavLink
              key={aba.to}
              to={aba.to}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-colors ${
                  isActive ? 'text-azul bg-white' : 'text-blue-100 hover:bg-white/10'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="lateral-ativo"
                      className="absolute left-1 top-2 bottom-2 w-1 rounded-full bg-dourado" />
                  )}
                  <span className="text-xl">{aba.icon}</span>
                  <span>{aba.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 space-y-1">
          {profile?.nome && <p className="px-4 pb-1 text-[11px] text-blue-200 truncate">Olá, {profile.nome.split(' ')[0]} 👋</p>}
          <NavLink to="/perfil"
            className="block w-full text-sm bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2.5 text-left transition-colors">
            👤 Meu perfil
          </NavLink>
          <button onClick={atualizarApp}
            className="w-full text-sm bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2.5 text-left transition-colors">
            🔄 Atualizar app
          </button>
          <button onClick={sair}
            className="w-full text-sm bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2.5 text-left transition-colors">
            🚪 Sair
          </button>
        </div>
      </aside>

      {/* ===== Coluna de conteúdo ===== */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-full">
        {/* Cabeçalho (celular) */}
        <header className="lg:hidden bg-azul text-white shadow-md sticky top-0 z-20">
          <div className="px-4 py-3 flex items-center gap-3">
            <button onClick={() => setMenuAberto(true)} aria-label="Menu" className="text-2xl leading-none px-1 -ml-1">☰</button>
            <Logo className="w-10 h-10 rounded-lg" />
            <div className="leading-tight flex-1 min-w-0">
              <h1 className="font-extrabold text-base truncate">Filhos da Conquista</h1>
              <p className="text-[11px] text-blue-200">Desbravadores · 1994</p>
            </div>
            <div className="text-white"><Notificacoes /></div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-5xl mx-auto px-4 lg:px-8 py-5 lg:py-8 pb-10">
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

      {/* ===== Menu deslizante (celular) — abre no ☰ ===== */}
      <AnimatePresence>
        {menuAberto && (
          <div className="lg:hidden">
            <motion.div className="fixed inset-0 bg-black/50 z-40" onClick={() => setMenuAberto(false)}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside className="fixed inset-y-0 left-0 w-72 max-w-[82vw] bg-azul text-white z-50 flex flex-col shadow-2xl"
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
              <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
                <Logo className="w-11 h-11 rounded-lg" />
                <div className="leading-tight flex-1 min-w-0">
                  <h1 className="font-extrabold truncate">Filhos da Conquista</h1>
                  <p className="text-[11px] text-blue-200">Desbravadores · 1994</p>
                </div>
                <button onClick={() => setMenuAberto(false)} aria-label="Fechar" className="w-8 h-8 rounded-full bg-white/15 grid place-items-center shrink-0">✕</button>
              </div>
              <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {abas.map((aba) => (
                  <NavLink key={aba.to} to={aba.to} onClick={() => setMenuAberto(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-colors ${
                        isActive ? 'text-azul bg-white' : 'text-blue-100 hover:bg-white/10'
                      }`
                    }>
                    <span className="text-xl">{aba.icon}</span>
                    <span>{aba.label}</span>
                  </NavLink>
                ))}
              </nav>
              <div className="p-3 space-y-1 border-t border-white/10">
                {profile?.nome && <p className="px-4 pb-1 text-[11px] text-blue-200 truncate">Olá, {profile.nome.split(' ')[0]} 👋</p>}
                <NavLink to="/perfil" onClick={() => setMenuAberto(false)}
                  className="block w-full text-sm bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2.5 text-left transition-colors">
                  👤 Meu perfil
                </NavLink>
                <button onClick={atualizarApp}
                  className="w-full text-sm bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2.5 text-left transition-colors">
                  🔄 Atualizar app
                </button>
                <button onClick={sair}
                  className="w-full text-sm bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2.5 text-left transition-colors">
                  🚪 Sair
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
