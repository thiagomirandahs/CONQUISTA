import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useEscopo } from '../context/Escopo.jsx'
import { carregarInvestidurasDoEscopo } from '../services/institucional.js'
import { PainelAnalitico, VisitasDoEscopo } from './PainelDoEscopo.jsx'
import { EsqueletoTela } from '../ui/carregamento.jsx'

// Portal institucional (fase 4.3) — ENXUTO de propósito. Mostra só o que o escopo justifica:
// os clubes abaixo, a situação geral deles (agregada) e os processos que REALMENTE exigem a atuação
// desta autoridade. Estar acima na hierarquia não abre chat, fotos, mensagens, financeiro, evidências
// nem dados de responsáveis — e o servidor nem devolve isso.
const TIPO_ROTULO = { distrito: 'Distrito', regiao: 'Região', campo: 'Campo / Associação-Missão', uniao: 'União', divisao: 'Divisão' }
const PAPEL_ROTULO = {
  coordenador_distrital: 'Coordenação distrital', coordenador_regional: 'Coordenação regional',
  coordenador_geral: 'Coordenação geral', diretor_mda: 'Direção do Ministério',
  secretario_md: 'Secretaria do MD', associado_md: 'Associado(a) do MD', departamental_jovem: 'Departamental',
  coordenador_uniao: 'Coordenação da união', diretor_uniao: 'Direção da união', coordenador_divisao: 'Coordenação da divisão',
}
const fmtData = (iso) => {
  if (!iso) return ''
  const so = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return so ? `${so[3]}/${so[2]}/${so[1]}` : ''
}

export default function PortalInstitucional() {
  const { carregando, erro, escopos, escopo, temEscopo, capacidades, trocarEscopo, recarregar } = useEscopo()
  // ao abrir o portal, relê os escopos (vínculo criado agora por convite aparece sem sair e entrar)
  useEffect(() => { recarregar?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [investiduras, setInvestiduras] = useState(null)
  const [versao, setVersao] = useState(0)
  const [erroDados, setErroDados] = useState('')

  const recarregarDados = useCallback(async () => {
    // sem escopo em uso não há o que buscar — e não se fica "carregando" pra sempre
    if (!escopo) { setInvestiduras([]); return }
    setErroDados('')
    try {
      setInvestiduras(await carregarInvestidurasDoEscopo())
    } catch (e) { setErroDados(e?.message || String(e)) }
  }, [escopo])
  useEffect(() => { recarregarDados() }, [recarregarDados])

  if (carregando) return <EsqueletoTela cabecalho={false} cartoes={2} />

  if (erro) {
    return (
      <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800 max-w-md mx-auto mt-8">
        Não deu pra carregar seus vínculos institucionais. Tente de novo.
      </div>
    )
  }

  if (!temEscopo) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft max-w-md mx-auto mt-8">
        <div className="text-4xl mb-2" aria-hidden="true">🏛️</div>
        <p className="font-semibold text-ink">Sem vínculo institucional</p>
        <p className="text-sm text-faint mt-1">Este portal é para coordenação distrital, regional, de campo, união ou divisão.</p>
        <Link to="/" className="inline-block mt-4 text-sm font-semibold text-brand underline">Voltar para o meu clube</Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-extrabold text-ink">🏛️ Portal institucional</h1>
        <p className="text-sm text-muted">Acompanhamento dos clubes do seu escopo</p>
      </header>

      <SeletorDeEscopo escopos={escopos} escopo={escopo} onTrocar={trocarEscopo} />

      {erroDados && <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 mb-4">{erroDados}</div>}

      <section className="mb-5" aria-labelledby="t-pendencias">
        <h2 id="t-pendencias" className="text-sm font-extrabold text-ink mb-2">O que depende de você</h2>
        {investiduras === null ? (
          <EsqueletoTela cabecalho={false} cartoes={2} />
        ) : investiduras.length === 0 ? (
          <div className="bg-surface rounded-2xl p-5 shadow-soft">
            <p className="font-semibold text-ink text-sm">✅ Nada aguarda a sua decisão</p>
            <p className="text-xs text-faint mt-1 leading-snug">
              As Classes Regulares (Amigo a Guia) são revisadas e investidas pelo próprio clube — não há
              etapa distrital ou regional nesse processo. Se um processo passar a exigir a sua aprovação,
              ele aparece aqui.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {investiduras.map((i) => (
              <li key={i.member_class_id} className="bg-surface rounded-2xl p-4 shadow-soft">
                <div className="font-bold text-ink text-sm">{i.pessoa_nome}</div>
                <div className="text-xs text-muted">{i.classe_nome} · {i.clube_nome}</div>
                <div className="text-xs text-amber-800 mt-1">
                  ⏳ Aguardando: {i.etapa?.nome} · desde {fmtData(i.aguardando_desde)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!capacidades.ver_painel ? (
        <p className="text-sm text-faint mb-5">Seu papel neste escopo não inclui o painel dos clubes.</p>
      ) : (
        <>
          <PainelAnalitico escopoId={escopo?.escopo_id} versao={versao} aoAgendado={() => setVersao((x) => x + 1)} />
          <VisitasDoEscopo escopoId={escopo?.escopo_id} versao={versao} aoMudar={() => setVersao((x) => x + 1)} />
        </>
      )}

      <p className="text-xs text-faint mt-6 leading-snug">
        Este portal mostra apenas números gerais dos clubes e o que exige a sua decisão. Conversas, fotos,
        mensagens, mensalidades, evidências dos requisitos e dados de responsáveis pertencem a cada clube e
        não são acessíveis aqui.
      </p>
    </div>
  )
}

function SeletorDeEscopo({ escopos, escopo, onTrocar }) {
  if (escopos.length <= 1) {
    return escopo ? (
      <div className="bg-surface rounded-2xl px-4 py-3 shadow-soft mb-4">
        <div className="font-bold text-ink">{escopo.nome}</div>
        <div className="text-xs text-faint">{TIPO_ROTULO[escopo.tipo] || escopo.tipo} · {PAPEL_ROTULO[escopo.papel] || escopo.papel}</div>
      </div>
    ) : (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-800 mb-4">
        Escolha um escopo para continuar.
      </div>
    )
  }
  return (
    <div className="mb-4">
      <label className="block">
        <span className="text-xs text-muted">Escopo em uso</span>
        <select value={escopo?.escopo_id || ''} onChange={(e) => onTrocar(e.target.value)}
          className="mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink">
          <option value="" disabled>Escolha um escopo…</option>
          {escopos.map((e) => (
            <option key={e.escopo_id} value={e.escopo_id}>
              {e.nome} — {TIPO_ROTULO[e.tipo] || e.tipo}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
