import { useState } from 'react'
import { Outlet, NavLink, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import Logo from './Logo.jsx'
import Notificacoes from './Notificacoes.jsx'
import DevocionalPopup from './DevocionalPopup.jsx'
import AvisosPopup from './AvisosPopup.jsx'
import ProximoEventoPopup from './ProximoEventoPopup.jsx'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import { destinosDoPapel, gruposDoMenuLateral } from '../lib/navegacao.js'
import { CAMINHOS_DO_RESPONSAVEL } from '../lib/clube.js'

// Moldura do app (fase 7).
//   Celular: no máximo 5 DESTINOS, que mudam conforme o papel. A gaveta ☰ deixou de existir aqui —
//     ela duplicava o que os hubs (Jornada/Clube/Jogos) já fazem, e "duas portas para a mesma coisa"
//     é justamente o que a auditoria apontou como problema. Toda tela continua a 2 toques.
//   PC: a barra lateral lista tudo, agrupada por hub — lá há espaço e quem já conhecia acha na hora.
//
// Por que mudou (ver AUDITORIA-UX.md): o menu tinha 16–17 itens e, medido a 360×800, OITO deles
// ficavam abaixo da dobra — incluindo Minha Classe, Especialidades, Experiências e a própria Gestão.
// Nenhuma rota foi removida: o que mudou foi por onde se chega.
export default function AppLayout() {
  const location = useLocation()
  const { sair, profile } = useAuth()
  // papel/permissões/recursos/marca são do VÍNCULO no clube em uso (não do perfil global)
  const { ehPais: ehPai, temGestao, temRecurso, marca, clubeId } = useClube()
  const { temEscopo } = useEscopo()
  const destinos = destinosDoPapel({ ehPais: ehPai, temGestao }, temRecurso, { temEscopo })
  const grupos = gruposDoMenuLateral({ ehPais: ehPai, temGestao }, temRecurso)
  const [tema, setTema] = useState(() =>
    (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark') ? 'escuro' : 'claro')

  function alternarTema() {
    const novo = tema === 'escuro' ? 'claro' : 'escuro'
    document.documentElement.setAttribute('data-theme', novo === 'escuro' ? 'dark' : 'light')
    try { localStorage.setItem('tema', novo) } catch { /* sem storage */ }
    setTema(novo)
  }

  // O responsável segue fora da administração — e agora tem o destino "Eu" (perfil, tema, sair).
  if (ehPai && !CAMINHOS_DO_RESPONSAVEL.includes(location.pathname)) {
    return <Navigate to="/meu-filho" replace />
  }

  const linkLateral = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold transition-colors ${
      isActive ? 'bg-gradient-to-r from-brand to-brand2 shadow-glow' : 'text-muted hover:bg-surface2'
    }`
  const corDoAtivo = (isActive) => (isActive ? { color: 'var(--marca-1-texto, #fff)' } : undefined)

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-full lg:flex">
      {!ehPai && <DevocionalPopup />}
      <AvisosPopup />
      <ProximoEventoPopup />

      {/* ===== Menu lateral (PC) — tudo, agrupado por hub ===== */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-64 z-30 glass border-r border-line">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-line">
          <Logo className="w-11 h-11 rounded-2xl shadow-soft" />
          <div className="leading-tight flex-1 min-w-0">
            <h1 className="font-extrabold text-ink truncate">{marca.nome}</h1>
            {marca.lema && <p className="text-xs text-faint">{marca.lema}</p>}
          </div>
          <div className="shrink-0 text-ink"><Notificacoes /></div>
        </div>
        <nav className="flex-1 p-3 overflow-y-auto" aria-label="Menu">
          {!ehPai && (
            <NavLink to="/inicio" className={linkLateral}>
              {({ isActive }) => (
                <span className="flex items-center gap-3" style={corDoAtivo(isActive)}>
                  <span className="text-xl" aria-hidden="true">🏠</span><span>Início</span>
                </span>
              )}
            </NavLink>
          )}
          {grupos.map((g) => (
            <div key={g.titulo} className="mt-3">
              <p className="px-4 pb-1 text-xs font-bold uppercase tracking-wide text-faint">{g.titulo}</p>
              <div className="space-y-1">
                {g.itens.map((item) => (
                  <NavLink key={item.to} to={item.to} className={linkLateral}>
                    {({ isActive }) => (
                      <span className="flex items-center gap-3" style={corDoAtivo(isActive)}>
                        <span className="text-xl" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-3 space-y-1 border-t border-line">
          {profile?.nome && <p className="px-4 pb-1 text-xs text-faint truncate">Olá, {profile.nome.split(' ')[0]} 👋</p>}
          <NavLink to="/eu" className="block w-full min-h-[44px] text-sm bg-surface2 hover:bg-surface text-ink rounded-2xl px-4 py-2.5 text-left font-semibold transition-colors">
            👤 Eu
          </NavLink>
          <button onClick={alternarTema} className="w-full min-h-[44px] text-sm bg-surface2 hover:bg-surface text-ink rounded-2xl px-4 py-2.5 text-left font-semibold transition-colors">
            {tema === 'escuro' ? '☀️ Modo claro' : '🌙 Modo escuro'}
          </button>
          <button onClick={sair} className="w-full min-h-[44px] text-sm bg-surface2 hover:bg-surface text-ink rounded-2xl px-4 py-2.5 text-left font-semibold transition-colors">
            🚪 Sair
          </button>
        </div>
      </aside>

      {/* ===== Coluna de conteúdo ===== */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-full">
        <header className="lg:hidden sticky top-0 z-20 glass border-b border-line"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="px-4 py-2.5 flex items-center gap-3">
            <Logo className="w-10 h-10 rounded-xl shadow-soft" />
            <div className="leading-tight flex-1 min-w-0">
              <h1 className="font-extrabold text-[15px] text-ink truncate">{marca.nome}</h1>
              {marca.lema && <p className="text-xs text-faint truncate">{marca.lema}</p>}
            </div>
            <button onClick={alternarTema} aria-label="Alternar tema claro e escuro"
              className="w-11 h-11 rounded-xl grid place-items-center text-ink bg-surface2 text-lg leading-none">{tema === 'escuro' ? '☀️' : '🌙'}</button>
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
              key={`${clubeId}:${location.pathname}`}
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

      {/* ===== Destinos (celular) — no máximo 5, conforme o papel ===== */}
      <nav className="lg:hidden fixed z-30 left-3 right-3" aria-label="Destinos"
        style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
        <div className="glass rounded-[24px] shadow-soft grid max-w-lg mx-auto px-1.5 py-1.5"
          style={{ gridTemplateColumns: `repeat(${destinos.length}, minmax(0, 1fr))` }}>
          {destinos.map((d) => (
            <NavLink key={d.to} to={d.to}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center gap-0.5 min-h-[52px] rounded-2xl transition-colors ${isActive ? 'text-brand' : 'text-faint'}`
              }>
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="rodape-ativo"
                      className="absolute -top-1 h-1 w-7 rounded-full bg-gradient-to-r from-brand to-brand2" />
                  )}
                  <motion.span animate={{ scale: isActive ? 1.16 : 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    className="text-xl leading-none" aria-hidden="true"
                    style={isActive ? { filter: 'drop-shadow(0 4px 10px var(--c-brand))' } : undefined}>{d.icon}</motion.span>
                  <span className={`text-xs leading-none ${isActive ? 'font-extrabold' : 'font-semibold'}`}>{d.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

    </div>
    </MotionConfig>
  )
}
