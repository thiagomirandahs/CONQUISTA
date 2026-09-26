import { useRef, useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import { atualizarFotoPerfil } from '../services/usuarios.js'
import { avisar } from '../ui/avisos.jsx'
import Logo from './Logo.jsx'
import Avatar from './Avatar.jsx'

// Moldura das telas que ficam FORA do clube (portal da coordenação e as telas da conta usadas por quem
// não tem clube). Sem ela, um coordenador só de distrito não tinha como atualizar, trocar a foto, trocar
// a senha, pedir suporte nem SAIR (achado em produção, 26/09). Evento 'conta:atualizar' avisa a tela
// de dentro para reler os dados.
export const EVENTO_ATUALIZAR = 'conta:atualizar'

export default function LayoutConta({ children }) {
  const { profile, sair, recarregarPerfil } = useAuth() || {}
  const escopoCtx = useEscopo() || {}
  const [aberto, setAberto] = useState(false)
  const [girando, setGirando] = useState(false)
  const arquivo = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => { setAberto(false) }, [pathname])

  const nome = profile?.nome || 'Você'
  const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'

  async function atualizar() {
    setGirando(true)
    try {
      await escopoCtx.recarregar?.()
      window.dispatchEvent(new Event(EVENTO_ATUALIZAR))
    } finally { setTimeout(() => setGirando(false), 400) }
  }

  async function trocarFoto(file) {
    if (!file || !profile?.id) return
    try {
      await atualizarFotoPerfil({ userId: profile.id, file })
      await recarregarPerfil?.()
      avisar.sucesso('Foto atualizada!')
    } catch (e) { avisar.erro(e) }
    setAberto(false)
  }

  const item = 'flex w-full min-h-[48px] items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold text-ink active:bg-surface2'
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <Logo produto className="h-8 w-8" />
          <span className="flex-1 truncate text-sm font-extrabold text-ink">DesbravaClube</span>
          <button type="button" onClick={atualizar} aria-label="Atualizar" data-testid="conta-atualizar"
            className="grid h-11 w-11 place-items-center rounded-full text-lg active:bg-surface2">
            <span aria-hidden="true" className={girando ? 'inline-block animate-spin' : ''}>🔄</span>
          </button>
          <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-label="Minha conta" data-testid="conta-menu"
            className="grid h-11 w-11 place-items-center overflow-hidden rounded-full ring-2 ring-line">
            {/* Avatar assina a URL do bucket privado 'imagens' (img direto quebrava) */}
            <Avatar foto={profile?.foto} nome={iniciais} size="w-11 h-11" textSize="text-sm" />
          </button>
        </div>
        {aberto && (
          <div className="mx-auto max-w-2xl px-4 pb-3">
            <div className="rounded-2xl border border-line bg-surface p-1.5 shadow-lg">
              <p className="px-3 pt-2 pb-1 text-xs font-bold uppercase tracking-wide text-faint">{nome}</p>
              <Link to="/institucional" className={item}><span aria-hidden="true">🏛️</span>Portal da coordenação</Link>
              <button type="button" className={item} onClick={() => arquivo.current?.click()}><span aria-hidden="true">📷</span>Trocar foto</button>
              <input ref={arquivo} type="file" accept="image/*" className="sr-only" onChange={(e) => trocarFoto(e.target.files?.[0])} />
              <Link to="/conta/senha" className={item}><span aria-hidden="true">🔑</span>Trocar senha</Link>
              <Link to="/conta/suporte" className={item}><span aria-hidden="true">🛟</span>Suporte</Link>
              <a href="https://desbravaclube.com.br/ajuda" target="_blank" rel="noopener noreferrer" className={item}><span aria-hidden="true">❓</span>Como usar</a>
              <button type="button" className={`${item} text-red-600`} onClick={sair} data-testid="conta-sair"><span aria-hidden="true">🚪</span>Sair da conta</button>
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-2xl px-4 py-4">{children}</main>
    </div>
  )
}
