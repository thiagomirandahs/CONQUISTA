import { useState, useEffect, useCallback } from 'react'
import { Card, Botao, Aviso } from '../ui/index.jsx'
import { adminAudiolivros, adminTrocarVideoDoCapitulo, adminAtivarAudiolivro } from '../services/audiolivros.js'
import { idDoVideo } from '../lib/audiolivros.js'
import { avisar } from '../ui/avisos.jsx'
import { Chip, Esqueleto, Nota } from '../components/admin/AdminUI.jsx'

// /admin › Audiolivros (migration 370): catálogo global dos livros das Classes, tocados pelo player do
// YouTube. Aqui só se troca o vídeo de um capítulo (quando cai do ar) ou se desliga um livro inteiro.
export default function AdminAudiolivros() {
  const [livros, setLivros] = useState(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null)
  const recarregar = useCallback(() => {
    adminAudiolivros().then((l) => { setErro(''); setLivros(l) }).catch((e) => setErro(e?.message || String(e)))
  }, [])
  useEffect(() => { recarregar() }, [recarregar])

  return (
    <div className="space-y-3" data-testid="admin-audiolivros">
      <Nota icone="🎧"><strong className="text-ink">Audiolivros das Classes.</strong>{' '}
        O app toca cada capítulo pelo player do YouTube, na ordem desta lista. Nada é baixado. Se um vídeo sair do ar,
        cole aqui o link novo daquele capítulo.
      </Nota>
      {erro ? <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso> : livros == null ? <Esqueleto avatar={false} /> : (
        livros.map((l) => (
          <Card key={l.id}>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-ink text-sm truncate">{l.titulo}</p>
                <p className="text-xs text-muted">{[l.autor, l.canal && `canal ${l.canal}`, `${l.capitulos.length} partes`].filter(Boolean).join(' · ')}</p>
              </div>
              <Chip tom={l.ativo ? 'ok' : 'neutro'} ponto>{l.ativo ? 'No app' : 'Desligado'}</Chip>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Botao variacao="secundario" aoTocar={() => setAberto(aberto === l.id ? null : l.id)}>{aberto === l.id ? 'Fechar' : 'Ver capítulos'}</Botao>
              <Botao variacao="secundario" aoTocar={async () => {
                try { await adminAtivarAudiolivro(l.id, !l.ativo); avisar.sucesso(l.ativo ? 'Livro desligado.' : 'Livro ligado.'); recarregar() } catch (e) { avisar.erro(e) }
              }}>{l.ativo ? 'Desligar' : 'Ligar'}</Botao>
            </div>
            {aberto === l.id && (
              <ul className="mt-3 divide-y divide-line">
                {l.capitulos.map((c) => <LinhaCapitulo key={c.id} c={c} onFeito={recarregar} />)}
              </ul>
            )}
          </Card>
        ))
      )}
    </div>
  )
}

function LinhaCapitulo({ c, onFeito }) {
  const [editando, setEditando] = useState(false)
  const [link, setLink] = useState('')
  const [ocupado, setOcupado] = useState(false)
  async function salvar() {
    const id = idDoVideo(link)
    if (!id) { avisar.erro(null, 'Cole o link de UM vídeo do YouTube (não o da playlist).'); return }
    setOcupado(true)
    try { await adminTrocarVideoDoCapitulo(c.id, id); avisar.sucesso(`${c.titulo}: vídeo trocado.`); setEditando(false); setLink(''); onFeito?.() } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }
  return (
    <li className="py-2" data-testid="audiolivro-capitulo">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-ink">{c.ordem}. {c.titulo}</span>
        <a href={`https://www.youtube.com/watch?v=${c.video_id}`} target="_blank" rel="noopener noreferrer" className="min-h-[44px] inline-flex items-center px-2 text-xs font-semibold text-brand">Abrir</a>
        <button type="button" onClick={() => setEditando((v) => !v)} className="min-h-[44px] px-2 text-xs font-semibold text-muted">Trocar</button>
      </div>
      {editando && (
        <div className="mt-1 flex gap-2">
          <input value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder="https://youtu.be/..." aria-label={`Link novo do ${c.titulo}`}
            className="flex-1 min-h-[44px] rounded-lg border border-line bg-surface px-3 text-base" />
          <Botao aoTocar={salvar} carregando={ocupado}>Salvar</Botao>
        </div>
      )}
    </li>
  )
}
