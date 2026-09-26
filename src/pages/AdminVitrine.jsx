import { useState, useEffect, useCallback } from 'react'
import { Card, Botao, Aviso, Campo } from '../ui/index.jsx'
import {
  adminParceirosListar, adminParceiroSalvar, adminParceiroApagar, subirLogoDoParceiro,
  adminCartoesListar, adminCartaoModerar,
} from '../services/vitrine.js'
import { avisar } from '../ui/avisos.jsx'
import { Chip, Esqueleto, EstadoVazio, Nota } from '../components/admin/AdminUI.jsx'

// /admin › Vitrine do site (migration 190): parceiros (anunciantes) e moderação dos cartões dos clubes.
// Tudo aqui aparece SÓ no site público (/parceiros e /clubes), nunca dentro do app.
const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const paraInput = (iso) => (iso ? String(iso).slice(0, 10) : '')
const VAZIO = { nome: '', descricao: '', link: '', whatsapp: '', categoria: '', ordem: '100', destaque: false, inicio: '', fim: '', ativo: true, logo_url: '' }

export default function AdminVitrine() {
  const [parceiros, setParceiros] = useState(null)
  const [cartoes, setCartoes] = useState(null)
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState(null)   // null | 'novo' | parceiro
  const recarregar = useCallback(() => {
    Promise.all([adminParceirosListar(), adminCartoesListar()])
      .then(([p, c]) => { setErro(''); setParceiros(p); setCartoes(c) })
      .catch((e) => setErro(e?.message || String(e)))
  }, [])
  useEffect(() => { recarregar() }, [recarregar])

  return (
    <div className="space-y-3" data-testid="admin-vitrine">
      <Nota icone="🪧"><strong className="text-ink">Vitrine do site.</strong>{" "}
        Parceiros aparecem em <strong>/parceiros</strong> (e numa faixa discreta da landing) só se ativos e dentro do período.
        Os cartões dos clubes são <strong>opt-in</strong> da diretoria; aqui você só pode ocultá-los (moderação).
      </Nota>
      {erro ? <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso> : parceiros == null ? <Esqueleto avatar={false} /> : (
        <>
          <Card>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-bold text-ink text-sm">Parceiros</p>
              {!editando && <Botao aoTocar={() => setEditando('novo')} data-testid="parceiro-novo">+ Novo parceiro</Botao>}
            </div>
            {editando && (
              <FormParceiro key={editando === 'novo' ? 'novo' : editando.id} inicial={editando === 'novo' ? null : editando}
                aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); recarregar() }} />
            )}
            {parceiros.length === 0 ? <EstadoVazio icone="🤝" titulo="Nenhum parceiro cadastrado" /> : (
              <ul className="divide-y divide-line">
                {parceiros.map((p) => (
                  <li key={p.id} className="py-3 flex items-center gap-3" data-testid="parceiro-item">
                    {p.logo_url ? <img src={p.logo_url} alt="" className="w-10 h-10 rounded-lg object-contain bg-white border border-line shrink-0" />
                      : <span className="w-10 h-10 rounded-lg bg-surface2 grid place-items-center shrink-0" aria-hidden="true">🤝</span>}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink text-sm truncate">{p.nome} {p.destaque && '⭐'}</p>
                      <p className="text-xs text-muted">
                        {p.categoria || 'Sem categoria'} · ordem {p.ordem} · {p.inicio ? `de ${data(p.inicio)}` : 'sem início'} {p.fim ? `até ${data(p.fim)}` : ''}
                      </p>
                    </div>
                    <Chip tom={p.no_ar ? 'ok' : 'neutro'} ponto>{p.no_ar ? 'No ar' : p.ativo ? 'Fora do período' : 'Inativo'}</Chip>
                    <Botao variacao="secundario" aoTocar={() => setEditando(p)}>Editar</Botao>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <p className="font-bold text-ink text-sm mb-2">Cartões dos clubes</p>
            {cartoes.length === 0 ? <p className="text-sm text-muted">Nenhum clube configurou o cartão ainda.</p> : (
              <ul className="divide-y divide-line">
                {cartoes.map((c) => <LinhaCartao key={c.club_id} c={c} onFeito={recarregar} />)}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function FormParceiro({ inicial, aoFechar, aoSalvar }) {
  const [f, setF] = useState(() => (inicial
    ? { ...VAZIO, ...Object.fromEntries(Object.entries(inicial).map(([k, v]) => [k, v ?? ''])), ordem: String(inicial.ordem ?? 100), inicio: paraInput(inicial.inicio), fim: paraInput(inicial.fim) }
    : VAZIO))
  const [ocupado, setOcupado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const mudar = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }))

  async function trocarLogo(arquivo) {
    if (!arquivo) return
    setEnviando(true)
    try { const url = await subirLogoDoParceiro(arquivo); setF((x) => ({ ...x, logo_url: url })) } catch (e) { avisar.erro(e) }
    setEnviando(false)
  }
  async function salvar() {
    if (!f.nome.trim()) { avisar.erro(null, 'Informe o nome do parceiro.'); return }
    if (!f.link.trim() && !f.whatsapp.trim()) { avisar.erro(null, 'Informe o link e/ou o WhatsApp.'); return }
    if (f.link.trim() && !/^https?:\/\/\S+\.\S*$/i.test(f.link.trim())) { avisar.erro(null, 'O link precisa começar com https://'); return }
    setOcupado(true)
    try {
      await adminParceiroSalvar(inicial?.id, {
        ...f, ordem: Number(f.ordem) || 100,
        inicio: f.inicio ? new Date(`${f.inicio}T00:00:00`).toISOString() : null,
        fim: f.fim ? new Date(`${f.fim}T23:59:59`).toISOString() : null,
      })
      avisar.sucesso('Parceiro salvo.'); aoSalvar()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }
  async function apagar() {
    if (!window.confirm(`Apagar o parceiro "${inicial.nome}"?`)) return
    setOcupado(true)
    try { await adminParceiroApagar(inicial.id); avisar.sucesso('Parceiro apagado.'); aoSalvar() } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  return (
    <div className="rounded-xl border border-line p-3 mb-3" data-testid="parceiro-form">
      <Campo id="parc-nome" rotulo="Nome" value={f.nome} onChange={mudar('nome')} maxLength={80} />
      <Campo id="parc-desc" rotulo="Descrição curta" linhas={2} value={f.descricao} onChange={mudar('descricao')} maxLength={240} />
      <Campo id="parc-link" rotulo="Link (https://)" tipo="url" inputMode="url" value={f.link} onChange={mudar('link')} maxLength={300} />
      <Campo id="parc-zap" rotulo="WhatsApp (DDD + número)" inputMode="tel" value={f.whatsapp} onChange={mudar('whatsapp')} maxLength={20} />
      <div className="grid grid-cols-2 gap-2">
        <Campo id="parc-cat" rotulo="Categoria" value={f.categoria} onChange={mudar('categoria')} maxLength={40} />
        <Campo id="parc-ordem" rotulo="Ordem" tipo="number" inputMode="numeric" min={0} max={9999} value={f.ordem} onChange={mudar('ordem')} />
        <Campo id="parc-inicio" rotulo="Exibir a partir de" tipo="date" value={f.inicio} onChange={mudar('inicio')} />
        <Campo id="parc-fim" rotulo="Exibir até" tipo="date" value={f.fim} onChange={mudar('fim')} />
      </div>
      <div className="flex flex-wrap gap-4 mb-3 text-sm text-ink">
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="w-5 h-5" checked={!!f.destaque} onChange={mudar('destaque')} /> Destaque</label>
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="w-5 h-5" checked={!!f.ativo} onChange={mudar('ativo')} /> Ativo</label>
      </div>
      <div className="flex items-center gap-2 mb-3">
        {f.logo_url && <img src={f.logo_url} alt="" className="w-12 h-12 rounded-lg object-contain border border-line bg-white" />}
        <label className={`inline-flex min-h-[44px] items-center text-sm text-brand bg-brand/10 rounded-xl px-4 font-semibold cursor-pointer ${enviando ? 'opacity-60 pointer-events-none' : ''}`}>
          {enviando ? 'Enviando…' : f.logo_url ? 'Trocar logo' : 'Enviar logo'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { trocarLogo(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {f.logo_url && <button type="button" className="min-h-[44px] px-2 text-xs text-muted font-semibold" onClick={() => setF((x) => ({ ...x, logo_url: '' }))}>Remover</button>}
      </div>
      <p className="text-xs text-faint mb-3">Logo: JPG, PNG ou WebP até 2 MB (fica pública).</p>
      <div className="grid grid-cols-2 gap-2">
        <Botao aoTocar={salvar} carregando={ocupado} data-testid="parceiro-salvar">Salvar</Botao>
        <Botao variacao="secundario" aoTocar={aoFechar}>Cancelar</Botao>
      </div>
      {inicial && <Botao variacao="perigo" aoTocar={apagar} className="w-full mt-2">Apagar parceiro</Botao>}
    </div>
  )
}

function LinhaCartao({ c, onFeito }) {
  const [ocupado, setOcupado] = useState(false)
  async function moderar(ocultar) {
    let motivo = null
    if (ocultar) {
      motivo = window.prompt('Motivo para ocultar o cartão (a diretoria verá):')
      if (!motivo?.trim()) return
    }
    setOcupado(true)
    try { await adminCartaoModerar(c.club_id, ocultar, motivo); avisar.sucesso(ocultar ? 'Cartão ocultado.' : 'Cartão reexibido.'); onFeito?.() } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }
  return (
    <li className="py-3 flex items-center gap-3" data-testid="cartao-item">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-ink text-sm truncate">{c.nome}</p>
        <p className="text-xs text-muted">{[c.cidade, c.estado].filter(Boolean).join(' · ') || 'Sem cidade'} · atualizado {data(c.updated_at)}
          {c.oculto_moderacao && c.oculto_motivo ? ` · motivo: ${c.oculto_motivo}` : ''}</p>
      </div>
      <Chip tom={c.visivel ? 'ok' : c.oculto_moderacao ? 'perigo' : 'neutro'} ponto>{c.visivel ? 'Visível' : c.oculto_moderacao ? 'Ocultado' : 'Desligado'}</Chip>
      {c.oculto_moderacao
        ? <Botao variacao="secundario" carregando={ocupado} aoTocar={() => moderar(false)}>Reexibir</Botao>
        : <Botao variacao="secundario" carregando={ocupado} aoTocar={() => moderar(true)} data-testid="cartao-ocultar">Ocultar</Botao>}
    </li>
  )
}
