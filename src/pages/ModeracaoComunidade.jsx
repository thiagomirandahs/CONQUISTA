import { useCallback, useEffect, useState } from 'react'
import { filaModeracao, moderar, encerrarSuspensao, urlDaFoto, tempoRelativo, MOTIVOS_DENUNCIA } from '../services/comunidade.js'
import { avisar } from '../ui/avisos.jsx'
import { Abas, Aviso, Botao, Cabecalho, Card, Carregando, Selo, Vazio, mensagemDeErro } from '../ui/index.jsx'

// =============================================================================
//  Moderação da COMUNIDADE — só a DIRETORIA do clube (o servidor confere: pode_administrar_clube).
//  A fila é do PRÓPRIO clube: fotos dos membros esperando aprovação (ainda sem IA de imagem) e
//  conteúdo denunciado. Quem denunciou nunca aparece. Toda decisão fica no histórico (auditoria).
// =============================================================================

const ROTULO_MOTIVO = Object.fromEntries(MOTIVOS_DENUNCIA)
const ROTULO_ACAO = {
  ocultado_por_denuncia: 'Escondido por denúncia', restaurar: 'Restaurado', remover: 'Removido',
  aprovar_foto: 'Foto aprovada', recusar_foto: 'Foto recusada', suspenso: 'Pausado (3 avisos)',
  suspensao_encerrada: 'Pausa encerrada', autorizacao_concedida: 'Responsável autorizou', autorizacao_revogada: 'Responsável revogou',
}

function FotoRevisao({ path }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let vivo = true
    urlDaFoto(path).then((u) => { if (vivo) setUrl(u) }).catch(() => {})
    return () => { vivo = false }
  }, [path])
  if (!url) return <div className="mt-2 w-full aspect-square rounded-xl bg-surface2 animate-pulse" />
  return <img src={url} alt="Foto para revisar" className="mt-2 w-full max-h-[60vh] object-contain rounded-xl bg-surface2" />
}

function Item({ item, acoes, aoDecidir }) {
  const [ocupado, setOcupado] = useState(false)
  async function decidir(acao, rotulo) {
    if (acao === 'remover' && !(await avisar.confirmar({ titulo: 'Remover de vez?', descricao: 'O conteúdo sai da Comunidade e quem publicou recebe um aviso.', rotulo: 'Remover' }))) return
    setOcupado(true)
    try {
      await moderar(item.tipo, item.id, acao)
      avisar.sucesso(rotulo)
      aoDecidir()
    } catch (e) { avisar.erro(e, 'Não consegui registrar a decisão.') }
    setOcupado(false)
  }
  return (
    <Card data-testid="item-fila">
      <div className="flex items-center justify-between gap-2">
        <p className="font-extrabold text-ink truncate">{item.autor}</p>
        <span className="text-xs text-muted shrink-0">{tempoRelativo(item.criado_em)}</span>
      </div>
      <p className="text-xs text-muted">{item.tipo === 'post' ? (item.repost ? 'Compartilhamento' : 'Publicação') : 'Comentário'}</p>
      {item.denuncias > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          <Selo tom="perigo">🚩 {item.denuncias} {item.denuncias === 1 ? 'denúncia' : 'denúncias'}</Selo>
          {(item.motivos || []).map((m) => <Selo key={m}>{ROTULO_MOTIVO[m] || m}</Selo>)}
          {item.status === 'oculto_denuncia' && <Selo tom="atencao">Escondido</Selo>}
        </div>
      )}
      {item.texto && <p className="mt-2 text-ink whitespace-pre-line break-words">{item.texto}</p>}
      {item.foto && <FotoRevisao path={item.foto} />}
      <div className="grid grid-cols-2 gap-2 mt-3">
        {acoes.map(([acao, rotulo, variacao]) => (
          <Botao key={acao} variacao={variacao} desabilitado={ocupado} aoTocar={() => decidir(acao, rotulo)}>{rotulo}</Botao>
        ))}
      </div>
    </Card>
  )
}

export default function ModeracaoComunidade() {
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

  const cabecalho = <Cabecalho icone="🌎" titulo="Moderação da Comunidade" descricao="Fotos e denúncias dos membros do seu clube" />
  if (erro) return <div>{cabecalho}<Aviso tom="erro" acao={<Botao variacao="secundario" aoTocar={carregar}>Tentar de novo</Botao>}>{mensagemDeErro(erro, 'Não consegui abrir a fila.')}</Aviso></div>
  if (!fila) return <div>{cabecalho}<Carregando /></div>

  const abas = [
    { chave: 'denuncias', rotulo: 'Denúncias', icone: '🚩', contador: fila.denuncias?.length },
    { chave: 'fotos', rotulo: 'Fotos', icone: '📷', contador: fila.fotos?.length },
    { chave: 'pausados', rotulo: 'Pausados', icone: '⏸️', contador: fila.suspensos?.length },
    { chave: 'historico', rotulo: 'Histórico', icone: '🗂️' },
  ]

  return (
    <div className="max-w-xl mx-auto">
      {cabecalho}
      <Abas abas={abas} ativa={aba} aoTrocar={setAba} rotulo="Filas da moderação" />
      {aba === 'denuncias' && (fila.denuncias?.length
        ? <div className="space-y-3">{fila.denuncias.map((i) => (
            <Item key={`${i.tipo}-${i.id}`} item={i} aoDecidir={carregar}
              acoes={[['restaurar', 'Restaurar', 'secundario'], ['remover', 'Remover de vez', 'perigo']]} />))}</div>
        : <Vazio icone="✅" titulo="Nenhuma denúncia">Quando alguém denunciar um conteúdo do seu clube, ele aparece aqui.</Vazio>)}
      {aba === 'fotos' && (<>
        <Aviso tom="info">Enquanto não há análise automática de imagens, toda foto passa por aqui antes de aparecer. Recuse fotos com documento, uniforme com nome, casa, escola ou qualquer coisa que identifique onde a criança está.</Aviso>
        {fila.fotos?.length
          ? <div className="space-y-3">{fila.fotos.map((i) => (
              <Item key={i.id} item={i} aoDecidir={carregar}
                acoes={[['aprovar_foto', 'Aprovar', 'primario'], ['recusar_foto', 'Recusar', 'secundario']]} />))}</div>
          : <Vazio icone="📷" titulo="Nenhuma foto esperando" />}
      </>)}
      {aba === 'pausados' && (fila.suspensos?.length
        ? <div className="space-y-2">{fila.suspensos.map((s) => (
            <Card key={s.usuario_id} className="flex items-center justify-between gap-2">
              <div className="min-w-0"><p className="font-bold text-ink truncate">{s.nome}</p>
                <p className="text-xs text-muted">Pausado até {new Date(s.ate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p></div>
              <Botao variacao="secundario" aoTocar={() => encerrar(s)}>Encerrar</Botao>
            </Card>))}</div>
        : <Vazio icone="🙂" titulo="Ninguém pausado" />)}
      {aba === 'historico' && (fila.historico?.length
        ? <Card as="ul" className="divide-y divide-line">{fila.historico.map((h, i) => (
            <li key={i} className="py-2 text-sm">
              <span className="font-bold text-ink">{ROTULO_ACAO[h.acao] || h.acao}</span>
              <span className="text-muted"> · {h.via === 'sistema' ? 'automático' : h.por} · {tempoRelativo(h.quando)}</span>
            </li>))}</Card>
        : <Vazio icone="🗂️" titulo="Sem histórico ainda" />)}
    </div>
  )
}
