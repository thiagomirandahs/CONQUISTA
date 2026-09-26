import { useState } from 'react'
import { Botao, Campo } from '../ui/index.jsx'

// Avaliação da visita da coordenação pelo clube (migration 320). Quem avalia é a diretoria; quem lê
// é a diretoria, o coordenador que visitou e os níveis acima (o servidor decide — aqui só desenha).
export const ASPECTOS = [
  { chave: 'pontualidade', rotulo: 'Pontualidade' },
  { chave: 'orientacao', rotulo: 'Orientação / contribuição' },
  { chave: 'relacionamento', rotulo: 'Relacionamento' },
]
export const OBS_MAX = 600

// Estrelas só de leitura
export function EstrelasFixas({ nota, tamanho = 'text-base' }) {
  const v = Math.round(Number(nota) || 0)
  return (
    <span className={`${tamanho} leading-none whitespace-nowrap`} role="img" aria-label={`${v} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= v ? 'text-amber-500' : 'text-line'} aria-hidden="true">★</span>)}
    </span>
  )
}

// Estrelas grandes para tocar (alvo de 44px)
export function EstrelasToque({ id, rotulo, valor, aoMudar, opcional }) {
  return (
    <fieldset className="mb-3">
      <legend className="text-sm font-semibold text-ink mb-1">{rotulo}{opcional && <span className="text-faint font-normal"> (opcional)</span>}</legend>
      <div className="flex items-center gap-1" role="radiogroup" aria-label={rotulo}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" id={i === 1 ? id : undefined} role="radio" aria-checked={valor === i}
            aria-label={`${i} ${i === 1 ? 'estrela' : 'estrelas'} — ${rotulo}`}
            onClick={() => aoMudar(opcional && valor === i ? null : i)}
            className={`min-w-[44px] min-h-[44px] text-3xl leading-none ${valor && i <= valor ? 'text-amber-500' : 'text-line'}`}>★</button>
        ))}
      </div>
    </fieldset>
  )
}

// Bloco de leitura (clube e portal)
export function ResumoAvaliacao({ a }) {
  if (!a) return null
  const extras = ASPECTOS.filter((x) => a[x.chave])
  return (
    <div className="mt-2 rounded-xl bg-amber-50 p-2" data-testid="avaliacao-visita">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-amber-900">Avaliação do clube</p>
        <EstrelasFixas nota={a.geral} />
      </div>
      {extras.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {extras.map((x) => (
            <li key={x.chave} className="flex items-center justify-between gap-2 text-xs text-amber-900">
              <span>{x.rotulo}</span><EstrelasFixas nota={a[x.chave]} tamanho="text-xs" />
            </li>
          ))}
        </ul>
      )}
      {a.observacao && <p className="text-sm text-ink mt-1 whitespace-pre-wrap">{a.observacao}</p>}
    </div>
  )
}

export const avaliacaoEditavel = (a, agora = Date.now()) => !a || !a.editavel_ate || new Date(a.editavel_ate).getTime() > agora

// Formulário da diretoria
export function FormAvaliacao({ inicial, salvando, aoSalvar, aoVoltar }) {
  const [notas, setNotas] = useState({
    geral: inicial?.geral || null, pontualidade: inicial?.pontualidade || null,
    orientacao: inicial?.orientacao || null, relacionamento: inicial?.relacionamento || null,
  })
  const [obs, setObs] = useState(inicial?.observacao || '')
  const mudar = (k) => (v) => setNotas((n) => ({ ...n, [k]: v }))
  return (
    <div className="mt-3" data-testid="form-avaliacao">
      <EstrelasToque id="aval-geral" rotulo="Nota geral da visita" valor={notas.geral} aoMudar={mudar('geral')} />
      {ASPECTOS.map((x) => (
        <EstrelasToque key={x.chave} rotulo={x.rotulo} valor={notas[x.chave]} aoMudar={mudar(x.chave)} opcional />
      ))}
      <Campo id="aval-obs" rotulo="Observação (opcional)" linhas={3} maxLength={OBS_MAX} value={obs} onChange={(e) => setObs(e.target.value)} />
      <p className="text-xs text-faint -mt-2 mb-3 text-right">{obs.length}/{OBS_MAX}</p>
      <div className="grid grid-cols-2 gap-2">
        <Botao variacao="secundario" desabilitado={salvando} aoTocar={aoVoltar}>Voltar</Botao>
        <Botao variacao="contorno" carregando={salvando} desabilitado={!notas.geral}
          aoTocar={() => aoSalvar({ ...notas, observacao: obs.trim() || null })}>Enviar avaliação</Botao>
      </div>
    </div>
  )
}

// Média das avaliações por quem visitou (unidade + nome), para a visão geral dos níveis acima
export function mediasDeAvaliacao(visitas) {
  const grupos = new Map()
  for (const v of visitas || []) {
    const nota = Number(v?.avaliacao?.geral)
    if (!nota) continue
    const unidade = v.agendada_por?.unidade?.nome || 'Coordenação'
    const chave = `${v.agendada_por?.unidade?.id || unidade}|${v.agendada_por?.nome || ''}`
    const g = grupos.get(chave) || { chave, unidade, nome: v.agendada_por?.nome || null, soma: 0, total: 0 }
    g.soma += nota; g.total += 1
    grupos.set(chave, g)
  }
  return [...grupos.values()].map((g) => ({ ...g, media: Math.round((g.soma / g.total) * 10) / 10 }))
    .sort((a, b) => b.total - a.total || b.media - a.media)
}
