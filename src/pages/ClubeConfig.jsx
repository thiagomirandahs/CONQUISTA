import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useClube } from '../context/Clube.jsx'
import { gravarMarca, definirRecurso, carregarCatalogoRecursos, subirLogoDoClube } from '../services/clubes.js'
import { formularioDaMarca, diferencasDaMarca, errosDaMarca, COR_TEMA_PADRAO } from '../lib/marca.js'

const inputClass =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2.5 text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30'

// Identidade e recursos do clube — só a liderança (a rota e o banco conferem). A identidade e os recursos são DESTE clube:
// nada aqui muda outro clube.
export default function ClubeConfig() {
  const { marca, recursos, clubeId, recarregar, podeGerir } = useClube()

  if (!podeGerir) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Só a liderança</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-extrabold text-ink">🎨 Identidade e recursos</h2>
        <p className="text-sm text-muted">Como o clube aparece no app e o que ele usa. Vale só para este clube.</p>
      </div>
      {/* a chave refaz o formulário quando a marca muda (depois de salvar) — sem efeito para sincronizar */}
      <FormIdentidade key={JSON.stringify(marca)} marca={marca} clubeId={clubeId} aoSalvar={recarregar} />
      <ListaRecursos recursos={recursos} aoMudar={recarregar} />
    </div>
  )
}

// o <label> envolve SÓ o rótulo e o campo (a dica fica fora: senão vira parte do nome acessível do campo)
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

function CampoCor({ rotulo, valor, aoMudar }) {
  return (
    <div>
      <span className="block text-sm font-medium text-ink mb-1">{rotulo}</span>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`Escolher ${rotulo}`} value={/^#[0-9a-f]{6}$/i.test(valor) ? valor : COR_TEMA_PADRAO}
          onChange={(e) => aoMudar(e.target.value)} className="w-12 h-11 rounded-lg border border-line bg-surface2 p-1 shrink-0" />
        <input type="text" aria-label={`${rotulo} (código)`} value={valor} placeholder="#rrggbb" maxLength={7}
          onChange={(e) => aoMudar(e.target.value)} className={inputClass} />
        {valor && (
          <button type="button" onClick={() => aoMudar('')} className="text-xs text-muted font-semibold shrink-0 px-2">Padrão</button>
        )}
      </div>
      <span className="block text-xs text-faint mt-1">Deixe vazio para usar a cor padrão do app.</span>
    </div>
  )
}

function FormIdentidade({ marca, clubeId, aoSalvar }) {
  const [form, setForm] = useState(() => formularioDaMarca(marca))
  const [enviandoLogo, setEnviandoLogo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState(false)

  const mudar = (campo) => (valor) => { setOk(false); setErro(''); setForm((f) => ({ ...f, [campo]: valor })) }
  const erros = errosDaMarca(form)
  const diff = diferencasDaMarca(form, marca)
  const mudou = Object.keys(diff).length > 0

  async function trocarLogo(arquivo) {
    if (!arquivo) return
    setEnviandoLogo(true); setErro('')
    try { mudar('logoUrl')(await subirLogoDoClube({ clubeId, file: arquivo })) } catch (e) { setErro(e?.message || String(e)) }
    setEnviandoLogo(false)
  }

  async function salvar(e) {
    e.preventDefault()
    if (erros.length || !mudou) return
    setSalvando(true); setErro('')
    try {
      await gravarMarca(diff)
      setOk(true)
      await aoSalvar()
    } catch (err) { setErro(err?.message || String(err)) }
    setSalvando(false)
  }

  const c1 = /^#[0-9a-f]{6}$/i.test(form.corPrimaria) ? form.corPrimaria : null
  const c2 = /^#[0-9a-f]{6}$/i.test(form.corSecundaria) ? form.corSecundaria : null
  const fundo = c1 ? `linear-gradient(90deg, ${c1}, ${c2 || c1})` : 'linear-gradient(90deg, var(--c-brand), var(--c-brand2))'
  const nomePrevia = form.nome.trim() || marca.nome
  const siglaPrevia = form.sigla.trim().toUpperCase() || marca.sigla

  return (
    <form onSubmit={salvar} className="bg-surface rounded-2xl shadow-soft p-4 space-y-4" aria-label="Identidade do clube">
      <h3 className="font-extrabold text-ink">Identidade</h3>

      {/* prévia ao vivo (o que a pessoa vai ver no menu) */}
      <div className="rounded-2xl p-4 text-white flex items-center gap-3" style={{ background: fundo }} aria-label="Prévia">
        {form.logoUrl
          ? <img src={form.logoUrl} alt="" className="w-12 h-12 rounded-2xl object-contain bg-white/20" />
          : <div className="w-12 h-12 rounded-2xl grid place-items-center bg-white/25 font-extrabold">{siglaPrevia}</div>}
        <div className="min-w-0">
          <div className="font-extrabold truncate">{nomePrevia}</div>
          {form.lema.trim() && <div className="text-xs opacity-90 truncate">{form.lema.trim()}</div>}
        </div>
      </div>

      <Campo rotulo="Nome do clube"><input value={form.nome} maxLength={60} onChange={(e) => mudar('nome')(e.target.value)} className={inputClass} /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Sigla" dica="Até 4 letras — aparece quando não há logo."><input value={form.sigla} maxLength={4} onChange={(e) => mudar('sigla')(e.target.value)} className={inputClass} /></Campo>
        <Campo rotulo="Fundado em"><input value={form.desde} inputMode="numeric" maxLength={4} placeholder="2010" onChange={(e) => mudar('desde')(e.target.value)} className={inputClass} /></Campo>
      </div>
      <Campo rotulo="Lema" dica="Frase curta abaixo do nome no menu."><input value={form.lema} maxLength={80} onChange={(e) => mudar('lema')(e.target.value)} className={inputClass} /></Campo>
      <Campo rotulo="Descrição" dica="Aparece na tela de entrada."><input value={form.descricao} maxLength={120} onChange={(e) => mudar('descricao')(e.target.value)} className={inputClass} /></Campo>

      <div className="grid sm:grid-cols-2 gap-3">
        <CampoCor rotulo="Cor principal" valor={form.corPrimaria} aoMudar={mudar('corPrimaria')} />
        <CampoCor rotulo="Cor secundária" valor={form.corSecundaria} aoMudar={mudar('corSecundaria')} />
      </div>

      <div>
        <span className="block text-sm font-medium text-ink mb-1">Logo</span>
        <div className="flex items-center gap-2">
          <label className={`text-sm text-brand bg-brand/10 hover:bg-brand/20 rounded-xl px-4 py-2 font-semibold cursor-pointer ${enviandoLogo ? 'opacity-60 pointer-events-none' : ''}`}>
            {enviandoLogo ? 'Enviando…' : form.logoUrl ? 'Trocar logo' : 'Enviar logo'}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={enviandoLogo}
              onChange={(e) => { trocarLogo(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {form.logoUrl && <button type="button" onClick={() => mudar('logoUrl')('')} className="text-xs text-muted font-semibold px-2">Remover</button>}
        </div>
        <span className="block text-xs text-faint mt-1">JPG, PNG, WebP ou GIF, até 5 MB. Fica pública (aparece na tela de entrada).</span>
      </div>

      {erros.length > 0 && (
        <ul className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 space-y-1" role="alert">
          {erros.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3" role="alert">{erro}</div>}
      {ok && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3" role="status">Identidade salva ✅</div>}

      <motion.button type="submit" disabled={salvando || enviandoLogo || !mudou || erros.length > 0} whileTap={{ scale: 0.97 }}
        className="w-full rounded-lg bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-semibold py-2.5 disabled:opacity-50">
        {salvando ? 'Salvando…' : 'Salvar identidade'}
      </motion.button>
    </form>
  )
}

function ListaRecursos({ recursos, aoMudar }) {
  const [catalogo, setCatalogo] = useState(null)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(null)

  useEffect(() => {
    let vivo = true
    carregarCatalogoRecursos()
      .then((c) => { if (vivo) setCatalogo(c) })
      .catch((e) => { if (vivo) { setCatalogo([]); setErro(e?.message || String(e)) } })
    return () => { vivo = false }
  }, [])

  async function alternar(chave, ligar) {
    setSalvando(chave); setErro('')
    try { await definirRecurso(chave, ligar); await aoMudar() } catch (e) { setErro(e?.message || String(e)) }
    setSalvando(null)
  }

  return (
    <section className="bg-surface rounded-2xl shadow-soft p-4" aria-label="Recursos do clube">
      <h3 className="font-extrabold text-ink">Recursos</h3>
      <p className="text-sm text-muted mb-3">Desligar um recurso esconde a tela para o clube inteiro. Os dados ficam guardados e voltam quando você religar.</p>
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3" role="alert">{erro}</div>}
      {catalogo === null ? <p className="text-faint text-sm">Carregando…</p> : (
        <ul className="divide-y divide-line">
          {catalogo.map((r) => {
            const ligado = recursos[r.chave] === true
            return (
              <li key={r.chave} className="py-3 flex items-center gap-3">
                <span className="text-2xl shrink-0" aria-hidden="true">{r.icone}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink text-sm">{r.nome}</div>
                  <div className="text-xs text-faint">{r.descricao}</div>
                </div>
                <button type="button" role="switch" aria-checked={ligado} aria-label={`${r.nome}: ${ligado ? 'ligado' : 'desligado'}`}
                  disabled={salvando === r.chave} onClick={() => alternar(r.chave, !ligado)}
                  className={`relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-60 ${ligado ? 'bg-brand' : 'bg-line'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${ligado ? 'translate-x-5' : ''}`} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
