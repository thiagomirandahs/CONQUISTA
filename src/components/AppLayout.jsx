import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Logo from './Logo.jsx'
import Notificacoes from './Notificacoes.jsx'
import DevocionalPopup from './DevocionalPopup.jsx'
import { useAuth } from '../context/Auth.jsx'

const abasBase = [
  { to: '/ranking', label: 'Ranking', icon: '🏆' },
  { to: '/missoes', label: 'Missões', icon: '🎯' },
  { to: '/atividades', label: 'Atividades', icon: '📋' },
  { to: '/unidades', label: 'Unidades', icon: '🏠' },
  { to: '/mural', label: 'Mural', icon: '📸' },
]
const TEM_GESTAO = ['conselheiro', 'instrutor', 'diretoria', 'tesoureiro']

// Moldura adaptável: menu lateral no PC, menu inferior no celular
export default function AppLayout() {
  const location = useLocation()
  const { sair, profile } = useAuth()
  const temGestao = TEM_GESTAO.includes(profile?.papel)
  const abas = temGestao ? [...abasBase, { to: '/gestao', label: 'Gestão', icon: '⚙️' }] : abasBase

  // Força buscar a versão mais nova e recarregar (reforço da auto-atualização)
  async function atualizarApp() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.()
      if (reg) await reg.update()
    } catch { /* ignora */ }
    window.location.reload()
  }

  return (
    <div className="min-h-full lg:flex">
      <DevocionalPopup />
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
            <Logo className="w-10 h-10 rounded-lg" />
            <div className="leading-tight flex-1 min-w-0">
              <h1 className="font-extrabold text-base truncate">Filhos da Conquista</h1>
              <p className="text-[11px] text-blue-200">Desbravadores · 1994</p>
            </div>
            <div className="text-white"><Notificacoes /></div>
            <button onClick={atualizarApp} aria-label="Atualizar app" className="text-white text-lg leading-none px-1">🔄</button>
            <button onClick={sair}
              className="text-xs bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5 transition-colors">
              Sair
            </button>
          </div>
        </header>

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

      {/* ===== Menu inferior (celular) ===== */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-slate-200 z-20">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${abas.length}, minmax(0, 1fr))` }}>
          {abas.map((aba) => (
            <NavLink
              key={aba.to}
              to={aba.to}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                  isActive ? 'text-azul' : 'text-slate-400'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="inferior-ativo"
                      className="absolute -top-px h-1 w-8 rounded-full bg-dourado" />
                  )}
                  <motion.span className="text-xl"
                    animate={{ scale: isActive ? 1.18 : 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
                    {aba.icon}
                  </motion.span>
                  <span>{aba.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
