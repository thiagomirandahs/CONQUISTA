import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { lerEstadoManutencao } from '../services/manutencao.js'
import { deveMostrarTela, textoDaFaixa, INTERVALO_CONSULTA_MS } from '../lib/manutencao.js'
import { MARCA_PRODUTO } from '../lib/marca.js'

// Modo manutenção (migration 400) no app.
//  - Consulta o estado ao abrir, a cada 60s com a aba VISÍVEL (aba escondida não gasta 4G), ao voltar
//    o foco, ao voltar a internet e quando a sessão muda (o "sou admin" depende de quem entrou).
//  - Aviso prévio agendado: faixa no topo, em todas as telas (inclusive login).
//  - Manutenção ligada: tela amigável no lugar do app — menos para o admin da plataforma, que segue
//    navegando para testar, e para o login/recuperação (é por onde o admin entra).
//  - Falha ao consultar = segue normal. Quem garante que nada se perde é o SERVIDOR (recusa escrita).
export function useEstadoManutencao() {
  const { session } = useAuth()
  const uid = session?.user?.id || null
  const [estado, setEstado] = useState(null)
  const emVoo = useRef(false)
  const consultar = useCallback(async () => {
    if (emVoo.current) return
    emVoo.current = true
    try { setEstado(await lerEstadoManutencao()) } catch { /* sem rede: mantém o último estado */ } finally { emVoo.current = false }
  }, [])

  useEffect(() => { consultar() }, [consultar, uid])
  useEffect(() => {
    const visivel = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
    const id = setInterval(() => { if (visivel()) consultar() }, INTERVALO_CONSULTA_MS)
    const aoVoltar = () => { if (visivel()) consultar() }
    window.addEventListener('focus', aoVoltar)
    window.addEventListener('online', aoVoltar)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', aoVoltar)
      window.removeEventListener('online', aoVoltar)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [consultar])
  return { estado, consultar, temSessao: !!uid }
}

export default function GuardaDeManutencao({ children }) {
  const { pathname } = useLocation()
  const { estado, consultar, temSessao } = useEstadoManutencao()
  if (deveMostrarTela(estado, pathname)) {
    return <TelaManutencao mensagem={estado.mensagem} aoTentar={consultar} mostrarEntrar={!temSessao} />
  }
  const faixa = textoDaFaixa(estado)
  return (
    <>
      {faixa && <FaixaManutencao texto={faixa} admin={!!estado?.ativo} />}
      {children}
    </>
  )
}

export function FaixaManutencao({ texto, admin = false }) {
  return (
    <div role="status" aria-live="polite" data-testid="faixa-manutencao"
      className="sticky top-0 z-[60] flex items-start gap-2 px-4 py-2.5 text-sm font-semibold"
      style={{ paddingTop: 'calc(0.625rem + var(--seguro-topo))', background: admin ? '#0b1f4d' : '#fff7d6', color: admin ? '#f5c518' : '#5b4300', borderBottom: '1px solid rgba(245,197,24,.55)' }}>
      <span aria-hidden="true">🛠️</span>
      <span className="min-w-0 break-words">{texto}</span>
    </div>
  )
}

export function TelaManutencao({ mensagem, aoTentar, mostrarEntrar = false }) {
  const [tentando, setTentando] = useState(false)
  async function tentar() {
    setTentando(true)
    try { await aoTentar?.() } finally { setTentando(false) }
  }
  return (
    <main data-testid="tela-manutencao" className="min-h-[100dvh] flex items-center justify-center px-4 py-10"
      style={{ background: 'linear-gradient(180deg, #07122f 0%, #0b1f4d 100%)', color: '#fff' }}>
      <div className="w-full max-w-sm text-center">
        <img src={MARCA_PRODUTO.logoUrl} alt={MARCA_PRODUTO.nome} width="88" height="88" className="mx-auto mb-5 rounded-2xl" />
        <h1 className="text-2xl font-extrabold">Estamos em manutenção</h1>
        <p className="mt-1 text-base" style={{ color: '#f5c518' }}>Volte em instantes.</p>
        {mensagem && <p className="mt-4 text-sm leading-relaxed text-white/85 break-words">{mensagem}</p>}
        <p className="mt-4 rounded-2xl px-4 py-3 text-sm leading-relaxed text-white/80" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(245,197,24,.35)' }}>
          Nada do que você fez foi perdido. O que você estava escrevendo ficou guardado neste aparelho —
          quando voltarmos, é só abrir a tela de novo e enviar.
        </p>
        <button type="button" onClick={tentar} disabled={tentando}
          className="mt-6 w-full min-h-[48px] rounded-2xl font-bold disabled:opacity-60"
          style={{ background: '#f5c518', color: '#07122f' }}>
          {tentando ? 'Verificando…' : 'Tentar de novo'}
        </button>
        {mostrarEntrar && (
          <a href="/login" className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-white/70 underline">
            Sou da equipe DesbravaClube — entrar
          </a>
        )}
      </div>
    </main>
  )
}
