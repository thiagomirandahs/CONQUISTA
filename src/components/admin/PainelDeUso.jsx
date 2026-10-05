import { useEffect, useState, useCallback } from 'react'
import { metricasDeUso } from '../../services/metricas.js'
import { Kpi, Painel, Nota, LinkAcao } from './AdminUI.jsx'

const n = (v) => Number(v || 0)
const fmt = (v) => n(v).toLocaleString('pt-BR')
const diaCurto = (iso) => { const [, m, d] = String(iso).split('-'); return `${d}/${m}` }

// Barras simples (sem biblioteca): site e app lado a lado, 14 dias.
export function GraficoDeVisitas({ serie }) {
  const max = Math.max(1, ...serie.map((s) => Math.max(n(s.site), n(s.app))))
  return (
    <div data-testid="uso-grafico">
      <div className="flex items-end gap-1 h-24" role="img" aria-label={`Visitas por dia nos últimos ${serie.length} dias: ${serie.map((s) => `${diaCurto(s.dia)} site ${n(s.site)} app ${n(s.app)}`).join('; ')}`}>
        {serie.map((s) => (
          <div key={s.dia} className="flex-1 flex items-end justify-center gap-px h-full" title={`${diaCurto(s.dia)} — site ${n(s.site)} · app ${n(s.app)}`}>
            <div className="w-1/2 rounded-t bg-amber-500" style={{ height: `${(n(s.site) / max) * 100}%`, minHeight: n(s.site) ? 2 : 0 }} />
            <div className="w-1/2 rounded-t bg-brand" style={{ height: `${(n(s.app) / max) * 100}%`, minHeight: n(s.app) ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint tabular-nums"><span>{diaCurto(serie[0]?.dia)}</span><span>{diaCurto(serie[serie.length - 1]?.dia)}</span></div>
      <p className="mt-1 text-[11px] text-muted"><span className="inline-block h-2 w-2 rounded-sm bg-amber-500 align-middle" aria-hidden="true" /> Site &nbsp; <span className="inline-block h-2 w-2 rounded-sm bg-brand align-middle" aria-hidden="true" /> Aplicativo</p>
    </div>
  )
}

// "Quem está usando agora" + visitas do site e do app. Atualiza sozinho a cada 30 s (só com a tela visível).
export default function PainelDeUso() {
  const [d, setD] = useState(null)
  const [erro, setErro] = useState('')
  const carregar = useCallback(() => {
    metricasDeUso().then((r) => { setErro(''); setD(r) }).catch((e) => setErro(e?.message || 'falha'))
  }, [])
  useEffect(() => {
    carregar()
    const id = setInterval(() => { if (document.visibilityState === 'visible') carregar() }, 30_000)
    return () => clearInterval(id)
  }, [carregar])

  if (erro && !d) {
    return (
      <Painel titulo="Uso do site e do aplicativo" icone="📈" data-testid="painel-uso">
        <Nota icone="⚠️">Não consegui carregar as métricas de uso. <LinkAcao aoTocar={carregar}>Tentar de novo</LinkAcao></Nota>
      </Painel>
    )
  }
  if (!d) return <Painel titulo="Uso do site e do aplicativo" icone="📈" data-testid="painel-uso"><p className="text-xs text-muted" role="status">Carregando…</p></Painel>

  const agora = d.agora || {}
  const v = d.visitas || {}
  const noApp = n(agora.app) + n(agora.apk)
  return (
    <Painel titulo="Uso do site e do aplicativo" icone="📈" data-testid="painel-uso"
      acao={<LinkAcao aoTocar={carregar}>Atualizar</LinkAcao>}
      descricao="Contagem anônima: nada identifica quem acessa. Vale a partir de quando foi ligada.">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi icone="🟢" tom="ok" valor={fmt(noApp)} rotulo="No app agora" testid="uso-app-agora"
          detalhe={`${fmt(agora.apk)} no APK · ${fmt(agora.app)} no navegador · ${fmt(agora.app_logados)} logado(s)`} />
        <Kpi icone="🌐" tom="info" valor={fmt(agora.site)} rotulo="No site agora" testid="uso-site-agora" detalhe="sinal nos últimos 2 min" />
        <Kpi icone="👀" valor={fmt(v.hoje?.site?.visitantes)} rotulo="Visitas ao site hoje" testid="uso-site-hoje"
          detalhe={`${fmt(v.d7?.site?.visitantes)} em 7 dias · ${fmt(v.d30?.site?.visitantes)} em 30 dias`} />
        <Kpi icone="📱" valor={fmt(v.hoje?.app?.sessoes)} rotulo="Acessos ao app hoje" testid="uso-app-hoje"
          detalhe={`${fmt(v.d7?.app?.sessoes)} em 7 dias · ${fmt(v.d30?.app?.sessoes)} em 30 dias`} />
      </div>
      {Array.isArray(d.serie) && d.serie.length > 0 && <div className="mt-4"><GraficoDeVisitas serie={d.serie} /></div>}
      <div className="mt-3"><Nota>Visita = uma aba ou uso do app (uma sessão), não uma pessoa: quem volta em outro dia ou em outra aba conta de novo. Robôs de busca são filtrados, mas o número do site é uma boa estimativa, não exato.</Nota></div>
    </Painel>
  )
}
