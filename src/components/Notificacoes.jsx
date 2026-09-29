import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { carregarNotificacoes, marcarNotificacoesVistas } from '../lib/dados.js'
import { pushSuportado, pushAtivo, ativarPush } from '../lib/push.js'
import { ehNativo } from '../lib/nativo.js'
import { estadoPushNativo, ativarPushNativo, MSG_NEGADO } from '../lib/pushNativo.js'
import { Folha, Botao, Vazio, Aviso, mensagemDeErro } from '../ui/index.jsx'

const iconePorTipo = { pontos: '🏆', atividade: '📋', missao: '🎯', cadastro: '👤', foto: '📸', aniversario: '🎂', geral: '📣' }

function tempoRel(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'agora'
  if (s < 3600) return Math.floor(s / 60) + ' min'
  if (s < 86400) return Math.floor(s / 3600) + ' h'
  return Math.floor(s / 86400) + ' d'
}

// Motivos conhecidos do Web Push, em palavras da pessoa. Qualquer outro erro passa por `mensagemDeErro`
// (o texto cru do navegador/servidor nunca vai para a tela).
const MOTIVOS_PUSH = {
  SEM_SUPORTE: 'Este aparelho não suporta. No iPhone, instale o app na tela inicial primeiro.',
  SEM_VAPID: 'Push ainda não configurado pela diretoria (veja PUSH-SETUP.md).',
  PERMISSAO_NEGADA: 'Notificações bloqueadas. Libere nas configurações do navegador.',
}

// `icone`/`classeBotao`: a Rede DBV usa o mesmo sino com ícone de linha num quadradinho claro.
// Fase 6: o painel é uma `Folha` (sobe de baixo no celular, diálogo no PC), com fechar de 44px e Esc.
export default function Notificacoes({ icone = null, classeBotao = '' } = {}) {
  const { profile } = useAuth()
  // O sino fica FORA da área que remonta ao trocar de clube (key={clubeId} no AppLayout): sem o
  // clube nas dependências, depois de trocar de A para B ele seguia mostrando os avisos de A.
  const { clubeId } = useClube()
  const navigate = useNavigate()
  const [aberto, setAberto] = useState(false)
  const [lista, setLista] = useState([])
  const [vistoEm, setVistoEm] = useState(null)
  const [baseline, setBaseline] = useState(null) // congela as não-lidas no momento de abrir
  const [pushOn, setPushOn] = useState(false)
  const [pushMsg, setPushMsg] = useState(null) // { tom: 'ok' | 'erro' | 'info', texto }
  // No APK o push é o NATIVO (FCM), não o Web Push do navegador.
  const nativo = ehNativo()
  const suportaPush = nativo || pushSuportado()

  // notif_visto_em ainda é UM só por pessoa (profiles): ler o sino num clube zera as não-lidas do
  // outro. Guardar "visto em" por clube é mudança de banco; aqui só se garante a lista certa.
  useEffect(() => {
    if (!profile?.id) return
    setVistoEm(profile.notif_visto_em || null)
    carregarNotificacoes().then(setLista)
  }, [profile?.id, profile?.notif_visto_em, clubeId])

  useEffect(() => {
    if (nativo) estadoPushNativo().then((e) => { setPushOn(e === 'ativo'); if (e === 'negado') setPushMsg({ tom: 'erro', texto: MSG_NEGADO }) })
    else pushAtivo().then(setPushOn)
  }, [nativo, aberto])

  // Atualiza a contagem ao voltar pro app (antes só no login/refresh)
  useEffect(() => {
    function atualizar() {
      if (document.visibilityState === 'visible') carregarNotificacoes().then(setLista)
    }
    document.addEventListener('visibilitychange', atualizar)
    window.addEventListener('focus', atualizar)
    return () => {
      document.removeEventListener('visibilitychange', atualizar)
      window.removeEventListener('focus', atualizar)
    }
  }, [])

  async function alternarPush() {
    setPushMsg(null)
    if (nativo) {
      const r = await ativarPushNativo(profile?.id)
      if (r.ok) { setPushOn(true); setPushMsg({ tom: 'ok', texto: 'Pronto! Este celular vai receber os avisos.' }) }
      else if (r.motivo === 'negado' || r.motivo === 'desligado') setPushMsg({ tom: 'erro', texto: MSG_NEGADO })
      else setPushMsg({ tom: 'erro', texto: mensagemDeErro(r.detalhe || r.motivo, 'Não consegui ativar os avisos.') })
      return
    }
    try {
      await ativarPush(profile?.id)
      setPushOn(true)
      setPushMsg({ tom: 'ok', texto: 'Pronto! Este aparelho vai receber os avisos.' })
    } catch (e) {
      setPushMsg({ tom: 'erro', texto: MOTIVOS_PUSH[e?.message] || mensagemDeErro(e, 'Não consegui ativar os avisos.') })
    }
  }

  const naoLidas = lista.filter((n) => !vistoEm || n.created_at > vistoEm).length
  // Mostra o HISTÓRICO (últimas 30) e destaca as que estavam não-lidas ao abrir.
  const mostradas = lista
  const naoLidaNoPainel = (n) => baseline && n.created_at > baseline

  async function abrir() {
    const fresh = await carregarNotificacoes()
    setLista(fresh)
    setBaseline(vistoEm) // congela as não-lidas de agora
    setAberto(true)
    if (profile?.id && fresh.some((n) => !vistoEm || n.created_at > vistoEm)) {
      await marcarNotificacoesVistas(profile.id)
      setVistoEm(new Date().toISOString())
    }
  }

  const fechar = useCallback(() => setAberto(false), [])

  function abrirItem(n) {
    setAberto(false)
    if (n.link) navigate(n.link)
  }

  return (
    <>
      <button type="button" onClick={abrir} aria-label={naoLidas > 0 ? `Notificações, ${naoLidas} não lida${naoLidas === 1 ? '' : 's'}` : 'Notificações'}
        aria-haspopup="dialog" aria-expanded={aberto} data-testid="sino-notificacoes"
        className={`relative grid place-items-center min-w-[44px] min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${classeBotao}`}>
        {icone || <span className="text-xl" aria-hidden="true">🔔</span>}
        {naoLidas > 0 && (
          <span aria-hidden="true" data-testid="contador-nao-lidas"
            className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-xs font-bold grid place-items-center ring-2 ring-azul">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      <Folha aberta={aberto} aoFechar={fechar} titulo="Notificações">
        {mostradas.length === 0 ? (
          <Vazio icone="✅" titulo="Nada por aqui ainda.">Quando o clube avisar algo, aparece aqui.</Vazio>
        ) : (
          <ul className="-mx-5 -mt-5 divide-y divide-line" data-testid="lista-notificacoes">
            {mostradas.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => abrirItem(n)}
                  className={`w-full flex gap-3 px-5 py-3 min-h-[44px] text-left hover:bg-surface2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${naoLidaNoPainel(n) ? 'bg-brand/5' : ''}`}>
                  <span className="text-xl shrink-0" aria-hidden="true">{iconePorTipo[n.tipo] || '🔔'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-ink text-sm">
                      {naoLidaNoPainel(n) && <span className="sr-only">Não lida: </span>}{n.titulo}
                    </span>
                    {n.corpo && <span className="block text-xs text-muted line-clamp-2">{n.corpo}</span>}
                    <span className="block text-xs text-faint mt-0.5">{tempoRel(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Ativar push neste aparelho (Web Push no navegador; FCM no APK) */}
        <div className="mt-4 pt-4 border-t border-line" data-testid="bloco-push">
          {!suportaPush ? (
            <p className="text-xs text-faint text-center">Avisos no celular não disponíveis neste aparelho.</p>
          ) : pushOn ? (
            <p className="text-xs text-emerald-700 text-center font-semibold" role="status">📲 Avisos no celular ativados ✓</p>
          ) : (
            <Botao variacao="secundario" className="w-full" aoTocar={alternarPush} data-testid="ativar-push">
              📲 Ativar avisos no celular
            </Botao>
          )}
          {pushMsg && (
            <div className="mt-3">
              <Aviso tom={pushMsg.tom}>{pushMsg.texto}</Aviso>
            </div>
          )}
        </div>
      </Folha>
    </>
  )
}
