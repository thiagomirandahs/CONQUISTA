import { useCallback, useState } from 'react'
import { useAuth } from '../context/Auth.jsx'
import { Folha } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import { salvarPreferenciasAcessibilidade } from '../services/usuarios.js'
import {
  FONTES, aplicarPreferencias, guardarPreferenciasLocais, lerPreferenciasLocais,
} from '../lib/acessibilidade.js'

// Painel de acessibilidade (tamanho de letra A− / A / A+ / A++ e alto contraste).
// Aplica NA HORA (o <html> muda), guarda a cópia local e grava na conta em segundo plano — se a
// internet falhar, a escolha continua valendo neste aparelho e a pessoa é avisada.
export function PainelAcessibilidade() {
  const { session } = useAuth() || {}
  const [pref, setPref] = useState(lerPreferenciasLocais)

  async function mudar(parcial) {
    const nova = { ...pref, ...parcial }
    setPref(nova)
    aplicarPreferencias(nova)
    guardarPreferenciasLocais(nova)
    if (!session) return
    try {
      await salvarPreferenciasAcessibilidade(nova)
    } catch {
      avisar.erro('Não consegui salvar na sua conta agora. Neste aparelho a escolha já vale.')
    }
  }

  return (
    <div className="space-y-5" data-testid="painel-acessibilidade">
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-ink">Tamanho da letra</legend>
        <div className="grid grid-cols-4 gap-2">
          {FONTES.map((f) => {
            const ativa = pref.fonte === f.valor
            return (
              <button key={f.valor} type="button" aria-pressed={ativa} aria-label={f.nome}
                onClick={() => mudar({ fonte: f.valor })}
                className={`min-h-[48px] rounded-xl border-2 font-extrabold ${
                  ativa ? 'border-brand bg-surface2 text-ink' : 'border-line bg-surface text-muted'}`}>
                <span aria-hidden="true" style={{ fontSize: `${f.escala}rem` }}>{f.rotulo}</span>
                {ativa && <span className="sr-only"> (escolhido)</span>}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        <div>
          <p id="rotulo-alto-contraste" className="text-sm font-bold text-ink">Alto contraste</p>
          <p className="text-xs text-muted">Letras e bordas mais fortes, no tema claro ou escuro.</p>
        </div>
        <button type="button" role="switch" aria-checked={pref.alto_contraste} aria-labelledby="rotulo-alto-contraste"
          onClick={() => mudar({ alto_contraste: !pref.alto_contraste })}
          className={`min-h-[44px] min-w-[76px] shrink-0 rounded-full border-2 px-3 text-sm font-bold ${
            pref.alto_contraste ? 'border-brand bg-brand text-white' : 'border-line bg-surface2 text-ink'}`}
          style={pref.alto_contraste ? { color: 'var(--marca-1-texto, #fff)' } : undefined}>
          {pref.alto_contraste ? 'Ligado' : 'Desligado'}
        </button>
      </div>
    </div>
  )
}

// Botão "Aa" que abre o painel numa folha. `rotuloVisivel` para o menu lateral do PC.
export default function BotaoAcessibilidade({ className = '', rotuloVisivel = false }) {
  const [aberta, setAberta] = useState(false)
  const fechar = useCallback(() => setAberta(false), [])
  return (
    <>
      <button type="button" onClick={() => setAberta(true)} aria-label="Acessibilidade: tamanho da letra e contraste"
        data-testid="abrir-acessibilidade" className={className}>
        <span aria-hidden="true" className="font-extrabold">Aa</span>
        {rotuloVisivel && <span className="ml-2">Letra e contraste</span>}
      </button>
      <Folha aberta={aberta} aoFechar={fechar} titulo="Acessibilidade">
        <PainelAcessibilidade />
      </Folha>
    </>
  )
}
