import { useEffect, useState } from 'react'
import { lerCartaoDoClube, salvarCartaoDoClube } from '../services/vitrine.js'
import { CartaoDoClube } from './site/CartaoDoClube.jsx'

// Configurações do clube › Cartão na vitrine do site (migration 190). OPT-IN: nasce desligado; só aparece no site
// quando a diretoria liga E aceita publicar o contato. Cada contato tem o seu "publicar". Nunca vai dado de membro.
const inputClass =
  'w-full min-h-[44px] rounded-lg border border-line bg-surface2 px-3 py-2.5 text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30'

const VAZIO = {
  ativo: false, aceite_contato: false, apresentacao: '', cidade: '', estado: '', reuniao_dia: '', reuniao_horario: '',
  reuniao_local: '', diretor_nome: '', diretor_whatsapp: '', diretor_email: '', publicar_nome: false,
  publicar_whatsapp: false, publicar_email: false, link_inscricao: '',
}
const doServidor = (d) => Object.fromEntries(Object.keys(VAZIO).map((k) => [k, d?.[k] ?? VAZIO[k]]))

// erros que o servidor também confere (aqui só para avisar antes de enviar)
export function errosDoCartao(f) {
  const e = []
  if (f.ativo && !f.aceite_contato) e.push('Para aparecer na vitrine, aceite publicar o contato.')
  if (f.ativo && !(f.publicar_whatsapp || f.publicar_email)) e.push('Publique ao menos um contato (WhatsApp ou e-mail).')
  if (f.publicar_nome && !f.diretor_nome.trim()) e.push('Preencha o nome do diretor para publicá-lo.')
  if (f.publicar_whatsapp && !f.diretor_whatsapp.replace(/\D/g, '')) e.push('Preencha o WhatsApp para publicá-lo.')
  if (f.publicar_email && !f.diretor_email.trim()) e.push('Preencha o e-mail para publicá-lo.')
  if (f.link_inscricao.trim() && !/^https?:\/\/\S+\.\S*$/i.test(f.link_inscricao.trim())) e.push('O link de inscrição precisa começar com https://')
  return e
}

function Chave({ rotulo, dica, ligado, aoMudar, testid }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink">{rotulo}</div>
        {dica && <div className="text-xs text-faint">{dica}</div>}
      </div>
      <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} data-testid={testid} onClick={() => aoMudar(!ligado)}
        className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${ligado ? 'bg-brand' : 'bg-line'}`}>
        <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${ligado ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

function Campo({ rotulo, dica, children }) {
  return (
    <div>
      <label className="block">
        <span className="block text-sm font-medium text-ink mb-1">{rotulo}</span>
        {children}
      </label>
      {dica && <span className="block text-xs text-faint mt-1">{dica}</span>}
    </div>
  )
}

export default function ClubeVitrine({ clubeId, marca }) {
  const [form, setForm] = useState(null)
  const [meta, setMeta] = useState({})
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [previa, setPrevia] = useState(false)

  useEffect(() => {
    let vivo = true
    lerCartaoDoClube(clubeId)
      .then((d) => { if (vivo) { setForm(doServidor(d)); setMeta(d || {}) } })
      .catch((e) => { if (vivo) { setForm(doServidor(null)); setErro(e?.message || String(e)) } })
    return () => { vivo = false }
  }, [clubeId])

  if (!form) return <section className="bg-surface rounded-2xl shadow-soft p-4"><p className="text-faint text-sm">Carregando cartão…</p></section>

  const mudar = (k) => (v) => { setOk(false); setErro(''); setForm((f) => ({ ...f, [k]: v })) }
  const texto = (k) => (e) => mudar(k)(e.target.value)
  const erros = errosDoCartao(form)

  async function salvar(e) {
    e.preventDefault()
    if (erros.length) return
    setSalvando(true); setErro('')
    try { const d = await salvarCartaoDoClube(clubeId, form); setForm(doServidor(d)); setMeta(d || {}); setOk(true) } catch (err) { setErro(err?.message || String(err)) }
    setSalvando(false)
  }

  // prévia = exatamente o que o público veria (só os campos publicados)
  const clubePrevia = {
    nome: marca?.nome, sigla: marca?.sigla, lema: marca?.lema, cor: marca?.corPrimaria, logo_url: marca?.logoUrl,
    cidade: form.cidade.trim(), estado: form.estado.trim().toUpperCase(), apresentacao: form.apresentacao.trim(),
    reuniao_dia: form.reuniao_dia.trim(), reuniao_horario: form.reuniao_horario.trim(), reuniao_local: form.reuniao_local.trim(),
    diretor_nome: form.publicar_nome ? form.diretor_nome.trim() : null,
    whatsapp: form.publicar_whatsapp ? (() => { const d = form.diretor_whatsapp.replace(/\D/g, ''); return d.length <= 11 ? `55${d}` : d })() : null,
    email: form.publicar_email ? form.diretor_email.trim() : null,
    link_inscricao: form.link_inscricao.trim() || null,
  }
  const endereco = meta.slug ? `desbravaclube.com.br/clubes/${meta.slug}` : null

  return (
    <form onSubmit={salvar} className="bg-surface rounded-2xl shadow-soft p-4 space-y-4" aria-label="Cartão na vitrine do site">
      <div>
        <h3 className="font-extrabold text-ink">Cartão na vitrine do site</h3>
        <p className="text-sm text-muted">
          Um cartão de visita do clube em “Clubes que estão com a gente”, para futuros membros acharem vocês.
          Só aparece se você ligar. Nunca mostramos membros, crianças, fotos ou números do clube.
        </p>
      </div>

      {meta.oculto_moderacao && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3" role="alert">
          O cartão foi ocultado pela equipe do DesbravaClube{meta.oculto_motivo ? `: ${meta.oculto_motivo}` : ''}. Fale com o suporte.
        </div>
      )}

      <Chave rotulo="Aparecer na vitrine do site" testid="vitrine-ativo" ligado={form.ativo} aoMudar={mudar('ativo')}
        dica={form.ativo && endereco ? endereco : 'Desligado: o clube não aparece no site.'} />

      <Campo rotulo="Apresentação" dica="Texto curto para quem quer conhecer o clube (até 600 caracteres).">
        <textarea rows={4} maxLength={600} value={form.apresentacao} onChange={texto('apresentacao')} className={inputClass} />
      </Campo>
      <div className="grid grid-cols-[1fr_5rem] gap-3">
        <Campo rotulo="Cidade"><input maxLength={60} value={form.cidade} onChange={texto('cidade')} className={inputClass} /></Campo>
        <Campo rotulo="UF"><input maxLength={2} value={form.estado} onChange={(e) => mudar('estado')(e.target.value.toUpperCase())} className={inputClass} placeholder="PE" /></Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Dia da reunião"><input maxLength={40} value={form.reuniao_dia} onChange={texto('reuniao_dia')} className={inputClass} placeholder="Domingo" /></Campo>
        <Campo rotulo="Horário"><input maxLength={40} value={form.reuniao_horario} onChange={texto('reuniao_horario')} className={inputClass} placeholder="8h às 11h" /></Campo>
      </div>
      <Campo rotulo="Local da reunião"><input maxLength={120} value={form.reuniao_local} onChange={texto('reuniao_local')} className={inputClass} /></Campo>

      <fieldset className="rounded-xl border border-line p-3 space-y-3">
        <legend className="px-1 text-sm font-bold text-ink">Contato do diretor</legend>
        <Campo rotulo="Nome"><input maxLength={80} value={form.diretor_nome} onChange={texto('diretor_nome')} className={inputClass} /></Campo>
        <Chave rotulo="Publicar o nome" ligado={form.publicar_nome} aoMudar={mudar('publicar_nome')} />
        <Campo rotulo="WhatsApp" dica="DDD + número."><input inputMode="tel" maxLength={20} value={form.diretor_whatsapp} onChange={texto('diretor_whatsapp')} className={inputClass} placeholder="(81) 99999-9999" /></Campo>
        <Chave rotulo="Publicar o WhatsApp" testid="vitrine-pub-zap" ligado={form.publicar_whatsapp} aoMudar={mudar('publicar_whatsapp')} />
        <Campo rotulo="E-mail"><input type="email" maxLength={120} value={form.diretor_email} onChange={texto('diretor_email')} className={inputClass} /></Campo>
        <Chave rotulo="Publicar o e-mail" ligado={form.publicar_email} aoMudar={mudar('publicar_email')} />
      </fieldset>

      <Campo rotulo="Link de inscrição (opcional)" dica="Se quiser, cole o link de entrada do clube. O botão “Quero participar” leva para ele; sem link, leva ao WhatsApp.">
        <input inputMode="url" maxLength={300} value={form.link_inscricao} onChange={texto('link_inscricao')} className={inputClass} placeholder="https://" />
      </Campo>

      <label className="flex items-start gap-3 rounded-xl bg-surface2 p-3 cursor-pointer">
        <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={form.aceite_contato} onChange={(e) => mudar('aceite_contato')(e.target.checked)} data-testid="vitrine-aceite" />
        <span className="text-sm text-ink">
          Autorizo, em nome da diretoria, publicar no site do DesbravaClube as informações e os contatos marcados como “publicar”
          acima. Posso desligar a qualquer momento.
        </span>
      </label>

      <button type="button" onClick={() => setPrevia((v) => !v)} aria-expanded={previa}
        className="w-full min-h-[44px] rounded-lg border border-line text-ink font-semibold">
        {previa ? 'Fechar pré-visualização' : 'Pré-visualizar o cartão'}
      </button>
      {previa && <div className="rounded-2xl bg-slate-100 p-3" data-testid="vitrine-previa"><CartaoDoClube clube={clubePrevia} /></div>}

      {erros.length > 0 && (
        <ul className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 space-y-1" role="alert">
          {erros.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3" role="alert">{erro}</div>}
      {ok && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3" role="status">Cartão salvo ✅</div>}

      <button type="submit" disabled={salvando || erros.length > 0}
        className="w-full min-h-[44px] rounded-lg bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-semibold py-2.5 disabled:opacity-50">
        {salvando ? 'Salvando…' : 'Salvar cartão'}
      </button>
    </form>
  )
}
