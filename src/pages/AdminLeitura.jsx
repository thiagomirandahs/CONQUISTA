import { useState, useEffect, useCallback } from 'react'
import { Card, Botao, Aviso, Campo, Selecao } from '../ui/index.jsx'
import { adminLeituraListar, adminLeituraSalvar, adminLeituraAuditoria } from '../services/leituras.js'
import { adminAudiolivros } from '../services/audiolivros.js'
import { avisar } from '../ui/avisos.jsx'
import { Chip, Esqueleto, Nota } from '../components/admin/AdminUI.jsx'
import { diferencas } from '../lib/leitura.js'

// /admin › Leituras (migration 514): catálogo global de leitura. SÓ o administrador da plataforma altera
// (o servidor confere e audita cada mudança). Link/PDF/áudio só entram com fonte: o banco recusa o resto.
const VAZIO = {
  chave: '', titulo: '', autor: '', descricao: '', tipo: 'livro_classe', classe_manifesto: '', ano: '', capa_url: '',
  book_url: '', book_rotulo: 'Ver livro', pdf_url: '', pdf_fonte_licenca: '', audio_url: '', audiolivro_id: '',
  audio_confirmado: false, audio_fonte: '', fonte: '', observacao: '', ordem: 100, ativo: false, revisado: false,
}
const TEXTOS = ['chave', 'titulo', 'autor', 'descricao', 'tipo', 'classe_manifesto', 'ano', 'capa_url', 'book_url', 'book_rotulo', 'pdf_url',
  'pdf_fonte_licenca', 'audio_url', 'audiolivro_id', 'audio_fonte', 'fonte', 'observacao']

const doForm = (m) => Object.fromEntries(Object.keys(VAZIO).map((k) => [k, m?.[k] ?? VAZIO[k]]))
function paraEnvio(f) {
  const o = { ...f }
  for (const k of TEXTOS) o[k] = typeof o[k] === 'string' ? o[k].trim() : o[k] ?? ''
  o.ano = o.ano === '' || o.ano == null ? '' : String(o.ano)
  o.ordem = Number.isFinite(Number(o.ordem)) ? Number(o.ordem) : 100
  o.audio_confirmado = !!o.audio_confirmado; o.ativo = !!o.ativo; o.revisado = !!o.revisado
  return o
}

export default function AdminLeitura() {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null) // id | 'novo'
  const [audios, setAudios] = useState([])
  const recarregar = useCallback(() => {
    adminLeituraListar().then((l) => { setErro(''); setLista(l) }).catch((e) => setErro(e?.message || String(e)))
  }, [])
  useEffect(() => { recarregar() }, [recarregar])
  useEffect(() => { adminAudiolivros().then(setAudios).catch(() => {}) }, [])

  return (
    <div className="space-y-3" data-testid="admin-leitura">
      <Nota icone="📚"><strong className="text-ink">Só o administrador da plataforma altera o catálogo. Não cadastre link sem fonte.</strong>{' '}
        Toda mudança fica registrada (quem, quando, o que mudou). O currículo continua sendo a fonte do requisito.
      </Nota>
      <Botao variacao="secundario" aoTocar={() => setAberto(aberto === 'novo' ? null : 'novo')}>{aberto === 'novo' ? 'Fechar' : 'Novo material'}</Botao>
      {aberto === 'novo' && <Formulario material={null} audios={audios} aoSalvar={() => { setAberto(null); recarregar() }} aoCancelar={() => setAberto(null)} />}
      {erro ? <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso> : lista == null ? <Esqueleto avatar={false} /> : (
        lista.map((m) => (
          <Card key={m.id} data-testid="leitura-material">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{m.titulo}</p>
                <p className="text-xs text-muted">{[m.chave, m.autor, m.classe_manifesto].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip tom={m.ativo ? 'ok' : 'neutro'} ponto>{m.ativo ? 'No app' : 'Desligado'}</Chip>
              <Chip tom={m.revisado ? 'ok' : 'atencao'} ponto>{m.revisado ? 'Revisado' : 'Sem revisão'}</Chip>
              <Chip tom={m.audio_confirmado ? 'ok' : 'neutro'} ponto>{m.audio_confirmado ? 'Áudio confirmado' : 'Áudio não confirmado'}</Chip>
            </div>
            <div className="mt-2">
              <Botao variacao="secundario" aoTocar={() => setAberto(aberto === m.id ? null : m.id)} aria-label={`${aberto === m.id ? 'Fechar' : 'Editar'} ${m.titulo}`}>
                {aberto === m.id ? 'Fechar' : 'Editar'}
              </Botao>
            </div>
            {aberto === m.id && <Formulario material={m} audios={audios} aoSalvar={() => { setAberto(null); recarregar() }} aoCancelar={() => setAberto(null)} />}
          </Card>
        ))
      )}
    </div>
  )
}

function Formulario({ material, audios, aoSalvar, aoCancelar }) {
  const [f, setF] = useState(() => doForm(material))
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [auditoria, setAuditoria] = useState(null)
  const p = material?.id || 'novo'
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const campo = (k, rotulo, extra = {}) => <Campo id={`${p}-${k}`} rotulo={rotulo} value={f[k] ?? ''} onChange={set(k)} {...extra} />

  async function salvar(e) {
    e?.preventDefault()
    setErro('')
    const d = paraEnvio(f)
    if (d.audio_confirmado && !d.audio_fonte) { setErro('Para confirmar o áudio, informe a fonte do áudio.'); return }
    if (!material && (!d.chave || !d.titulo)) { setErro('Informe a chave e o título.'); return }
    if (d.pdf_url && !d.pdf_fonte_licenca) { setErro('PDF só entra com a fonte/licença informada.'); return }
    setOcupado(true)
    try {
      await adminLeituraSalvar(material?.id || null, d)
      avisar.sucesso('Material salvo.')
      aoSalvar?.()
    } catch (err) { setErro(err?.message || 'Não foi possível salvar.') }
    setOcupado(false)
  }
  async function verAuditoria() {
    if (auditoria) { setAuditoria(null); return }
    try { setAuditoria(await adminLeituraAuditoria(material.id, 50)) } catch (err) { setErro(err?.message || 'Não foi possível carregar a auditoria.') }
  }

  return (
    <form onSubmit={salvar} className="mt-3 space-y-1 border-t border-line pt-3" data-testid="leitura-form" noValidate>
      {campo('chave', 'Chave (sem espaços, ex.: vaso-de-barro)', { disabled: !!material })}
      {campo('titulo', 'Título')}
      {campo('autor', 'Autor')}
      {campo('descricao', 'Descrição', { linhas: 3 })}
      <Selecao id={`${p}-tipo`} rotulo="Tipo" value={f.tipo} onChange={set('tipo')}
        opcoes={[['livro_classe', 'Livro da Classe'], ['curso_leitura', 'Curso de Leitura'], ['outro', 'Outro']]} />
      {campo('classe_manifesto', 'Classe (chave do manifesto, ex.: amigo)')}
      {campo('ano', 'Ano', { inputMode: 'numeric' })}
      {campo('ordem', 'Ordem na lista', { inputMode: 'numeric' })}
      {campo('capa_url', 'Link da capa (https)', { inputMode: 'url' })}
      {campo('book_url', 'Link do livro (https)', { inputMode: 'url' })}
      <Selecao id={`${p}-book_rotulo`} rotulo="Texto do botão do livro" value={f.book_rotulo} onChange={set('book_rotulo')}
        opcoes={[['Ver livro', 'Ver livro'], ['Comprar', 'Comprar'], ['Ler', 'Ler']]} />
      {campo('pdf_url', 'Link do PDF (https)', { inputMode: 'url' })}
      {campo('pdf_fonte_licenca', 'Fonte/licença do PDF (obrigatória para o PDF aparecer)')}
      {campo('audio_url', 'Link direto do áudio (https, opcional)', { inputMode: 'url' })}
      <Selecao id={`${p}-audiolivro_id`} rotulo="Audiolivro (catálogo de audiolivros)" value={f.audiolivro_id || ''} onChange={set('audiolivro_id')}
        opcoes={[['', 'Nenhum'], ...audios.map((a) => [a.id, a.titulo])]} />
      {campo('audio_fonte', 'Fonte do áudio (obrigatória para confirmar)')}
      {campo('fonte', 'Fonte do material')}
      {campo('observacao', 'Observação interna', { linhas: 2 })}
      {[['audio_confirmado', 'Áudio confirmado'], ['revisado', 'Revisado'], ['ativo', 'No app (ativo)']].map(([k, r]) => (
        <label key={k} className="flex min-h-[44px] items-center gap-3 text-sm font-semibold text-ink">
          <input type="checkbox" checked={!!f[k]} onChange={set(k)} className="h-5 w-5 accent-[#0b1f4d]" />{r}
        </label>
      ))}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="grid grid-cols-2 gap-2">
        <Botao tipo="submit" carregando={ocupado}>Salvar</Botao>
        <Botao variacao="secundario" aoTocar={aoCancelar}>Cancelar</Botao>
      </div>
      {material && <Botao variacao="secundario" className="w-full" aoTocar={verAuditoria}>{auditoria ? 'Esconder auditoria' : 'Ver auditoria'}</Botao>}
      {auditoria && <Auditoria linhas={auditoria} />}
    </form>
  )
}

function Auditoria({ linhas }) {
  if (!linhas.length) return <p className="text-sm text-muted">Nenhuma mudança registrada.</p>
  return (
    <ol className="space-y-2" aria-label="Auditoria" data-testid="leitura-auditoria">
      {linhas.map((a) => {
        const difs = diferencas(a.antes, a.depois)
        return (
          <li key={a.id} className="rounded-xl bg-surface2 p-3 text-xs text-ink">
            <p className="font-bold">{a.acao === 'criar' ? 'Criado' : 'Editado'} · {new Date(a.em).toLocaleString('pt-BR')}</p>
            <p className="text-muted">por {a.ator ? String(a.ator).slice(0, 8) : 'sistema'}</p>
            {a.acao !== 'criar' && <ul className="mt-1 space-y-0.5">
              {difs.map((d) => <li key={d.campo}><strong>{d.campo}</strong>: {String(d.antes ?? '—')} → {String(d.depois ?? '—')}</li>)}
            </ul>}
          </li>
        )
      })}
    </ol>
  )
}
