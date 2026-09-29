import { useCallback, useEffect, useState } from 'react'
import {
  filaModeracao, moderar, encerrarSuspensao, urlDaFoto, tempoRelativo, MOTIVOS_DENUNCIA,
  membrosAutorizacaoImagem, marcarAutorizacaoImagem,
} from '../../services/rede.js'
import { avisar } from '../../ui/avisos.jsx'
import { Aviso, Carregando, mensagemDeErro } from '../../ui/index.jsx'
import { CARD, PILL, PILL_CLARA, PILL_PRIMARIA, TXT, TXT_SUAVE, VazioRede } from './componentes.jsx'

// =============================================================================
//  Moderação da Rede DBV — só a DIRETORIA do clube (o servidor confere pode_administrar_clube).
//  Denúncias: Manter (= restaurar) · Ocultar (esconde o que ficou no ar) · Remover (de vez, dá aviso).
//  Fotos em análise: Aprovar · Recusar (ainda não há IA de imagem).
//  Imagem: a diretoria marca "autorização de imagem arquivada" (papel assinado na admissão).
//  Quem denunciou nunca aparece. Toda decisão fica no histórico.
// =============================================================================

const ROTULO_MOTIVO = Object.fromEntries(MOTIVOS_DENUNCIA)
const ABAS = [['denuncias', 'Denúncias'], ['fotos', 'Fotos'], ['imagem', 'Imagem'], ['pausados', 'Pausados']]

function Foto({ path }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let vivo = true
    urlDaFoto(path).then((u) => { if (vivo) setUrl(u) }).catch(() => {})
    return () => { vivo = false }
  }, [path])
  if (!url) return <div className="mt-3 w-full aspect-[4/5] rounded-2xl bg-[#eceef6] animate-pulse" />
  return <img src={url} alt="Foto para revisar" loading="lazy" className="mt-3 w-full h-auto max-h-[60vh] object-contain rounded-2xl bg-[#eceef6]" />
}

function CartaoFila({ item, acoes, aoDecidir }) {
  const [ocupado, setOcupado] = useState(false)
  async function decidir(acao, rotulo) {
    if (acao === 'remover' && !(await avisar.confirmar({ titulo: 'Remover de vez?', descricao: 'O conteúdo sai da rede e quem publicou recebe um aviso.', rotulo: 'Remover' }))) return
    setOcupado(true)
    try { await moderar(item.tipo, item.id, acao); avisar.sucesso(rotulo); aoDecidir() }
    catch (e) { avisar.erro(e, 'Não consegui registrar a decisão.') }
    setOcupado(false)
  }
  return (
    <article className={`${CARD} p-4`} data-testid="item-fila">
      <div className="flex items-center justify-between gap-2">
        <p className={`font-extrabold ${TXT} truncate`}>{item.autor}</p>
        <span className={`text-xs ${TXT_SUAVE} shrink-0`}>{tempoRelativo(item.criado_em)}</span>
      </div>
      <p className={`text-xs ${TXT_SUAVE}`}>{item.tipo === 'post' ? (item.repost ? 'Compartilhamento' : 'Publicação') : item.tipo === 'story' ? 'Story (24 h)' : 'Comentário'}
        {item.status === 'oculto_denuncia' ? ' · escondido' : item.status === 'publicado' && item.denuncias ? ' · ainda no ar' : ''}</p>
      {item.denuncias > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          <span className="text-xs font-bold text-red-800 bg-red-50 rounded-full px-3 py-1">{item.denuncias} {item.denuncias === 1 ? 'denúncia' : 'denúncias'}</span>
          {(item.motivos || []).map((m) => <span key={m} className={`text-xs font-bold ${TXT} bg-[#f1f3fb] rounded-full px-3 py-1`}>{ROTULO_MOTIVO[m] || m}</span>)}
        </div>
      )}
      {item.texto && <p className={`mt-2 ${TXT} whitespace-pre-line break-words`}>{item.texto}</p>}
      {item.foto && <Foto path={item.foto} />}
      <div className={`grid gap-2 mt-3 ${acoes.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {acoes.map(([acao, rotulo, estilo]) => (
          <button key={acao} type="button" disabled={ocupado} onClick={() => decidir(acao, rotulo)} className={`${estilo} w-full px-2`}>{rotulo}</button>
        ))}
      </div>
    </article>
  )
}

const PERIGO = `${PILL} bg-red-600 text-white disabled:opacity-60`

function acoesDaDenuncia(item) {
  const acoes = [['restaurar', 'Manter', PILL_CLARA]]
  if (item.status === 'publicado') acoes.push(['ocultar', 'Ocultar', `${PILL} bg-amber-100 text-amber-900`])
  acoes.push(['remover', 'Remover', PERIGO])
  return acoes
}

function Interruptor({ ligado, aoMudar, rotulo, desabilitado }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} disabled={desabilitado} onClick={() => aoMudar(!ligado)}
      className="shrink-0 min-h-[44px] min-w-[56px] grid place-items-center disabled:opacity-60">
      <span className={`relative block w-14 h-8 rounded-full transition-colors ${ligado ? 'bg-[#4b3cff]' : 'bg-[#cfd3e6]'}`}>
        <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${ligado ? 'left-7' : 'left-1'}`} />
      </span>
    </button>
  )
}

function AutorizacoesDeImagem() {
  const [membros, setMembros] = useState(null)
  const [ocupado, setOcupado] = useState(null)
  const [erro, setErro] = useState(null)
  const carregar = useCallback(async () => {
    try { setMembros(await membrosAutorizacaoImagem()) } catch (e) { setErro(e) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function mudar(m, arquivada) {
    setOcupado(m.usuario_id)
    try {
      await marcarAutorizacaoImagem(m.usuario_id, arquivada)
      setMembros((l) => l.map((x) => (x.usuario_id === m.usuario_id ? { ...x, arquivada } : x)))
      avisar.sucesso(arquivada ? 'Autorização de imagem arquivada.' : 'Autorização de imagem desmarcada.')
    } catch (e) { avisar.erro(e, 'Não consegui salvar.') }
    setOcupado(null)
  }

  if (erro) return <p className={`${CARD} p-4 ${TXT}`}>{mensagemDeErro(erro, 'Não consegui abrir a lista.')}</p>
  if (!membros) return <Carregando linhas={3} />
  return (
    <div className="space-y-3">
      <Aviso tom="info" titulo="A lista começa toda DESLIGADA">
        <p>
          Na Rede DBV ninguém aparece com a foto de rosto até você marcar aqui. A foto só aparece depois que a diretoria
          arquiva no clube o termo de uso de imagem ASSINADO no papel e liga o interruptor da pessoa. Sem isso, todos veem as
          iniciais (ou o personagem que a pessoa montou no app, que é um desenho sem rosto).
        </p>
        <p className="mt-2">O responsável pode desligar a qualquer momento pelo app (Meus filhos), e o "não" dele vale na hora.</p>
      </Aviso>
      {membros.length === 0 ? <VazioRede icone="👥" titulo="Nenhum membro ativo" /> : (
        <ul className={`${CARD} divide-y divide-[#f0f1f7]`}>
          {membros.map((m) => (
            <li key={m.usuario_id} className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="min-w-0">
                <p className={`font-bold ${TXT} truncate`}>{m.nome}</p>
                <p className={`text-xs ${TXT_SUAVE}`}>
                  {m.desligada_pelo_responsavel ? 'Responsável desligou' : m.arquivada ? 'Autorização arquivada' : 'Sem autorização de imagem'}
                </p>
              </div>
              <Interruptor ligado={!!m.arquivada} desabilitado={ocupado === m.usuario_id}
                rotulo={`Autorização de imagem arquivada de ${m.nome}`} aoMudar={(v) => mudar(m, v)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function RedeModeracao() {
  const [fila, setFila] = useState(null)
  const [erro, setErro] = useState(null)
  const [aba, setAba] = useState('denuncias')
  const carregar = useCallback(async () => {
    setErro(null)
    try { setFila(await filaModeracao()) } catch (e) { setErro(e); setFila(null) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function encerrar(s) {
    if (!(await avisar.confirmar({ titulo: `Encerrar a pausa de ${s.nome}?`, rotulo: 'Encerrar a pausa', perigo: false }))) return
    try { await encerrarSuspensao(s.usuario_id); avisar.sucesso('Pausa encerrada.'); carregar() }
    catch (e) { avisar.erro(e, 'Não consegui encerrar a pausa.') }
  }

  const contador = { denuncias: fila?.denuncias?.length, fotos: fila?.fotos?.length, pausados: fila?.suspensos?.length }
  return (
    <div className="p-3">
      <h1 className={`text-xl font-extrabold ${TXT} mb-3`}>Moderação do clube</h1>
      <div role="tablist" aria-label="Filas da moderação" className="grid grid-cols-4 gap-1 p-1 rounded-full bg-white border border-[#e8eaf3] mb-4">
        {ABAS.map(([chave, rotulo]) => (
          <button key={chave} type="button" role="tab" aria-selected={aba === chave} onClick={() => setAba(chave)}
            className={`min-h-[44px] rounded-full text-xs font-bold ${aba === chave ? 'bg-[#141a3a] text-white' : TXT_SUAVE}`}>
            {rotulo}{contador[chave] > 0 ? ` (${contador[chave]})` : ''}
          </button>
        ))}
      </div>
      {aba === 'imagem' ? <AutorizacoesDeImagem />
        : erro ? <div className={`${CARD} p-6 text-center`}><p className={TXT}>{mensagemDeErro(erro, 'Não consegui abrir a fila.')}</p>
            <button type="button" onClick={carregar} className={`${PILL_CLARA} mt-3`}>Tentar de novo</button></div>
          : !fila ? <Carregando />
            : aba === 'denuncias' ? (fila.denuncias?.length
                ? <div className="space-y-3">{fila.denuncias.map((i) => (
                    <CartaoFila key={`${i.tipo}-${i.id}`} item={i} aoDecidir={carregar} acoes={acoesDaDenuncia(i)} />))}</div>
                : <VazioRede icone="✅" titulo="Nenhuma denúncia">Quando alguém denunciar um conteúdo do seu clube, ele aparece aqui.</VazioRede>)
              : aba === 'fotos' ? (fila.fotos?.length
                  ? <div className="space-y-3">
                      <p className={`${CARD} p-4 text-sm ${TXT_SUAVE}`}>Recuse fotos com documento, uniforme com nome, casa, escola ou qualquer coisa que mostre onde a criança está.</p>
                      {fila.fotos.map((i) => (
                        <CartaoFila key={i.id} item={i} aoDecidir={carregar}
                          acoes={[['aprovar_foto', 'Aprovar', PILL_PRIMARIA], ['recusar_foto', 'Recusar', PILL_CLARA]]} />))}
                    </div>
                  : <VazioRede icone="📷" titulo="Nenhuma foto esperando">
                      {fila.foto_exige_aprovacao === false ? 'Hoje as fotos e stories publicam direto (com confirmação de quem publica). A moderação é pela aba Denúncias.' : null}
                    </VazioRede>)
                : (fila.suspensos?.length
                    ? <ul className="space-y-2">{fila.suspensos.map((s) => (
                        <li key={s.usuario_id} className={`${CARD} p-4 flex items-center justify-between gap-2`}>
                          <div className="min-w-0"><p className={`font-bold ${TXT} truncate`}>{s.nome}</p>
                            <p className={`text-xs ${TXT_SUAVE}`}>Pausado até {new Date(s.ate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p></div>
                          <button type="button" onClick={() => encerrar(s)} className={PILL_CLARA}>Encerrar</button>
                        </li>))}</ul>
                    : <VazioRede icone="🙂" titulo="Ninguém pausado" />)}
    </div>
  )
}
