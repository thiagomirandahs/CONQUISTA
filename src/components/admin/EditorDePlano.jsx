import { useState } from 'react'
import { Botao, Campo, Folha } from '../../ui/index.jsx'
import { avisar } from '../../ui/avisos.jsx'
import { planoRascunhoSalvar } from '../../services/admin.js'
import { CICLOS, LIMITES, formDoPlano, argsDoForm, chaveDoNome } from '../../lib/planoEditor.js'

// Editor de plano (/admin → Planos). Abre num painel (Folha). Salvar grava um RASCUNHO (versão nova, fora da vitrine);
// publicar é um passo separado, com confirmação, na lista de planos. Quem já assinou não muda.
// `plano` = versão de partida (publicada ou rascunho) ou null para um plano novo.
export default function EditorDePlano({ plano, aoFechar, aoSalvar }) {
  const [f, setF] = useState(() => formDoPlano(plano))
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const novo = !plano
  const mudar = (campo) => (e) => setF((x) => ({ ...x, [campo]: e.target.value }))
  const mudarCiclo = (c, campo) => (e) => setF((x) => ({ ...x, ciclos: { ...x.ciclos, [c]: { ...x.ciclos[c], [campo]: campo === 'oferecer' ? e.target.checked : e.target.value } } }))
  const mudarLimite = (k) => (e) => setF((x) => ({ ...x, limites: { ...x.limites, [k]: e.target.value } }))

  async function salvar(e) {
    e.preventDefault()
    if (salvando) return
    const base = novo ? { ...f, chave: chaveDoNome(f.nome) } : f
    const r = argsDoForm(base)
    if (r.erro) { setErro(r.erro); return }
    setErro(''); setSalvando(true)
    try {
      await planoRascunhoSalvar(r.args)
      avisar.sucesso('Rascunho salvo. Publique quando estiver pronto.')
      aoSalvar?.()
    } catch (err) { setErro(err?.message || 'Não consegui salvar o rascunho.') }
    setSalvando(false)
  }

  const titulo = novo ? 'Novo plano' : plano.status === 'rascunho' ? `Editar rascunho · ${plano.nome}` : `Nova versão de “${plano.nome}”`
  return (
    <Folha aberta aoFechar={aoFechar} titulo={titulo}>
      <form onSubmit={salvar} aria-label="Editor de plano" className="space-y-4">
        {!novo && plano.status !== 'rascunho' && (
          <p className="text-xs text-muted leading-snug">
            Isto cria uma <b>versão nova</b> (rascunho). A versão atual e quem já assinou ela <b>não mudam</b> até você publicar e migrar as assinaturas.
          </p>
        )}
        <Campo id="pl-nome" rotulo="Nome do plano" value={f.nome} maxLength={60} onChange={mudar('nome')} />
        <Campo id="pl-desc" rotulo="Descrição (aparece para quem vai contratar)" linhas={3} maxLength={400} value={f.descricao} onChange={mudar('descricao')} />
        <label className="flex items-center gap-2 min-h-[44px] text-sm font-bold text-ink">
          <input type="checkbox" className="w-5 h-5" checked={f.publico} onChange={(e) => setF((x) => ({ ...x, publico: e.target.checked }))} />
          Aparece na vitrine (quem vai contratar enxerga)
        </label>

        {CICLOS.map(([c, rotulo]) => (
          <fieldset key={c} className="rounded-xl border border-line p-3 space-y-2">
            <legend className="px-1 text-sm font-extrabold text-ink">Preço {rotulo.toLowerCase()}</legend>
            <label className="flex items-center gap-2 min-h-[44px] text-sm text-ink">
              <input type="checkbox" className="w-5 h-5" checked={f.ciclos[c].oferecer} onChange={mudarCiclo(c, 'oferecer')} aria-label={`Oferecer o ciclo ${rotulo.toLowerCase()}`} />
              Oferecer este ciclo
            </label>
            {f.ciclos[c].oferecer && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Campo id={`pl-${c}-valor`} rotulo="Valor (R$)" inputMode="decimal" placeholder="229,90" value={f.ciclos[c].valor} onChange={mudarCiclo(c, 'valor')} />
                <Campo id={`pl-${c}-pix`} rotulo="No Pix (R$, opcional)" inputMode="decimal" placeholder="199,90" value={f.ciclos[c].pix} onChange={mudarCiclo(c, 'pix')} />
                <Campo id={`pl-${c}-parc`} rotulo="Parcelas no cartão (opcional)" inputMode="numeric" placeholder="12" value={f.ciclos[c].parcelas} onChange={mudarCiclo(c, 'parcelas')} />
              </div>
            )}
          </fieldset>
        ))}

        <fieldset className="rounded-xl border border-line p-3 space-y-2">
          <legend className="px-1 text-sm font-extrabold text-ink">Limites</legend>
          <p className="text-xs text-muted">Deixe vazio para ilimitado.</p>
          <div className="grid grid-cols-2 gap-2">
            {LIMITES.map(([k, rotulo]) => (
              <Campo key={k} id={`pl-lim-${k}`} rotulo={rotulo} inputMode="numeric" value={f.limites[k]} onChange={mudarLimite(k)} />
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted leading-snug">Os painéis (recursos) deste plano se escolhem em <b>Painéis do plano</b>, que também vale para o rascunho.</p>

        {erro && <p role="alert" className="text-sm font-bold text-rose-600">{erro}</p>}
        <div className="flex gap-2 justify-end">
          <Botao variacao="secundario" aoTocar={aoFechar}>Cancelar</Botao>
          <Botao tipo="submit" carregando={salvando} desabilitado={salvando}>Salvar rascunho</Botao>
        </div>
      </form>
    </Folha>
  )
}
