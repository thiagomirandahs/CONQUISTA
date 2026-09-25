import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useClube } from '../context/Clube.jsx'
import {
  carregarOnboarding, iniciarOnboarding, salvarEtapaOnboarding, formatarPreco,
} from '../services/comercial.js'

// Cadastro de um clube novo (fase 5). O ESTADO MORA NO SERVIDOR: esta tela nunca decide em que etapa
// você está — ela pergunta. Fechar o app na etapa 4 e voltar amanhã continua exatamente dali, e
// repetir uma etapa não cria dois clubes nem duas assinaturas (o servidor é idempotente).
const ETAPAS = [
  { chave: 'conta',         titulo: 'Sua conta',        icone: '👤' },
  { chave: 'dados_basicos', titulo: 'Dados básicos',    icone: '📇' },
  { chave: 'clube',         titulo: 'O clube',          icone: '🏕️' },
  { chave: 'identidade',    titulo: 'Identidade visual', icone: '🎨' },
  { chave: 'diretor',       titulo: 'Primeiro diretor', icone: '🫡' },
  { chave: 'configuracao',  titulo: 'Configuração',     icone: '⚙️' },
  { chave: 'recursos',      titulo: 'Recursos',         icone: '🧩' },
  { chave: 'equipe',        titulo: 'Convidar a equipe', icone: '✉️' },
  { chave: 'pronto',        titulo: 'Pronto para usar', icone: '🎉' },
]

export default function Onboarding() {
  const [estado, setEstado] = useState(null)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState({})

  // Plano/ciclo vindos de /adquirir?plano=...&ciclo=... (itens 4 e 7): só pré-preenchem a etapa
  // "clube", nunca decidem nada sozinhos — a pessoa ainda escolhe e confirma no próprio formulário.
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const p = searchParams.get('plano')
    const cic = searchParams.get('ciclo')
    setForm((f) => {
      const novo = {}
      if (p && !f.plano) novo.plano = p
      if (cic && !f.ciclo) novo.ciclo = cic
      return Object.keys(novo).length ? { ...f, ...novo } : f
    })
  }, [searchParams])

  const buscar = useCallback(async () => {
    try { setEstado(await carregarOnboarding()) } catch (e) { setErro(e?.message || String(e)) }
  }, [])
  useEffect(() => { buscar() }, [buscar])

  // "Entrar no clube" RECARREGA o contexto antes de ir. Era um link para "/": o contexto do clube
  // continuava o de antes do onboarding (sem vínculo), e a primeira tela de quem acabou de criar o
  // clube dizia "Você ainda não está em um clube" — com "Criar um clube" logo abaixo. Achado na UAT
  // da fase 9; o vínculo existia no banco, só a tela estava velha.
  const { recarregar } = useClube()
  const navigate = useNavigate()
  const entrarNoClube = async () => {
    setSalvando(true)
    try { await recarregar() } finally { setSalvando(false) }
    navigate('/')
  }

  const comecar = async () => {
    setErro(''); setSalvando(true)
    try { await iniciarOnboarding(); await buscar() } catch (e) { setErro(e?.message || String(e)) }
    finally { setSalvando(false) }
  }

  const enviar = async (etapa, dados) => {
    setErro(''); setSalvando(true)
    try { await salvarEtapaOnboarding(etapa, dados); setForm({}); await buscar() }
    catch (e) { setErro(e?.message || String(e)) }
    finally { setSalvando(false) }
  }

  if (estado === null && !erro) return <p className="text-faint text-sm text-center mt-10" role="status">Carregando…</p>

  const etapaAtual = estado?.etapa || 'conta'
  const concluidas = estado?.etapas_concluidas || []
  const planos = estado?.planos || []

  return (
    <div className="max-w-md mx-auto px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-extrabold text-ink">🏕️ Criar meu clube</h1>
        <p className="text-sm text-muted">Dá pra parar e continuar depois: nada se perde.</p>
      </header>

      {erro && <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 mb-4">{erro}</div>}

      {!estado?.tem_sessao && !estado?.concluido && (
        <div className="bg-surface rounded-2xl p-6 text-center shadow-soft">
          <p className="text-sm text-muted mb-4">Vamos criar a conta, o clube e deixar tudo funcionando.</p>
          <button type="button" onClick={comecar} disabled={salvando}
            className="w-full min-h-[48px] rounded-xl bg-brand text-white font-bold disabled:opacity-60">
            {salvando ? 'Abrindo…' : 'Começar'}
          </button>
        </div>
      )}

      {estado?.tem_sessao && (
        <>
          <ol className="flex flex-wrap gap-1.5 mb-5" aria-label="Etapas">
            {ETAPAS.map((e) => {
              const feita = concluidas.includes(e.chave)
              const agora = e.chave === etapaAtual
              return (
                <li key={e.chave}
                  className={`text-xs px-2 py-1 rounded-full border ${agora ? 'bg-brand text-white border-brand font-bold'
                    : feita ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-surface text-faint border-line'}`}>
                  {feita && !agora ? '✓ ' : `${e.icone} `}{e.titulo}
                </li>
              )
            })}
          </ol>

          <div className="bg-surface rounded-2xl p-5 shadow-soft" data-testid="etapa-atual">
            <FormularioEtapa etapa={etapaAtual} form={form} setForm={setForm} planos={planos}
              salvando={salvando} onEnviar={enviar} />
          </div>
        </>
      )}

      {/* Já concluiu: NUNCA mostrar de novo o "comece agora" (seria abrir um 2º clube por engano).
          Abrir outro clube continua possível, mas como ato explícito. */}
      {estado?.concluido && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center" data-testid="concluido">
          <p className="font-bold text-emerald-900">🎉 Seu clube está pronto!</p>
          <p className="text-xs text-emerald-800 mt-1">Cadastro concluído — é só entrar.</p>
          <button type="button" onClick={entrarNoClube} disabled={salvando}
            className="block w-full mt-4 min-h-[48px] leading-[48px] rounded-xl bg-brand text-white font-bold">
            Entrar no clube
          </button>
          <button type="button" onClick={comecar} disabled={salvando}
            className="mt-3 text-xs font-semibold text-emerald-900 underline">
            Preciso criar outro clube
          </button>
        </div>
      )}
    </div>
  )
}

function Campo({ id, rotulo, ...props }) {
  return (
    <label htmlFor={id} className="block mb-3">
      <span className="text-xs text-muted">{rotulo}</span>
      <input id={id} {...props}
        className="mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm text-ink" />
    </label>
  )
}

function Botao({ children, salvando }) {
  return (
    <button type="submit" disabled={salvando}
      className="w-full min-h-[48px] rounded-xl bg-brand text-white font-bold disabled:opacity-60">
      {salvando ? 'Salvando…' : children}
    </button>
  )
}

function FormularioEtapa({ etapa, form, setForm, planos, salvando, onEnviar }) {
  const set = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }))
  const submeter = (dados) => (ev) => { ev.preventDefault(); onEnviar(etapa, dados) }

  if (etapa === 'conta') {
    return (
      <form onSubmit={submeter({ nome: form.nome || '', email: form.email || '' })}>
        <h2 className="font-bold text-ink mb-3">👤 Sua conta</h2>
        <Campo id="ob-nome" rotulo="Nome do responsável ou da organização" value={form.nome || ''} onChange={set('nome')} required />
        <Campo id="ob-email" rotulo="E-mail para contato (opcional)" type="email" value={form.email || ''} onChange={set('email')} />
        <Botao salvando={salvando}>Continuar</Botao>
      </form>
    )
  }
  if (etapa === 'dados_basicos') {
    return (
      <form onSubmit={submeter({ documento: form.documento || '', telefone: form.telefone || '' })}>
        <h2 className="font-bold text-ink mb-3">📇 Dados básicos</h2>
        <Campo id="ob-doc" rotulo="CNPJ ou CPF (opcional)" value={form.documento || ''} onChange={set('documento')} />
        <Campo id="ob-tel" rotulo="Telefone (opcional)" value={form.telefone || ''} onChange={set('telefone')} />
        <Botao salvando={salvando}>Continuar</Botao>
      </form>
    )
  }
  if (etapa === 'clube') {
    const planoPadrao = form.plano || planos[0]?.chave || ''
    const planoAtual = planos.find((p) => p.chave === planoPadrao)
    const ciclosDisponiveis = (planoAtual?.precos || []).map((x) => x.ciclo)
    // sem escolha do usuário ainda: usa o ciclo que o plano realmente tem (evita "mensal" fixo pra
    // um plano que só vende anual, como a Licença Anual única).
    const cicloAtual = form.ciclo && ciclosDisponiveis.includes(form.ciclo) ? form.ciclo : (ciclosDisponiveis[0] || 'anual')
    const precoAtual = (planoAtual?.precos || []).find((x) => x.ciclo === cicloAtual)
    return (
      <form onSubmit={submeter({ nome: form.nome || '', plano: planoPadrao, ciclo: cicloAtual })}>
        <h2 className="font-bold text-ink mb-3">🏕️ O clube</h2>
        <Campo id="ob-clube" rotulo="Nome do clube" value={form.nome || ''} onChange={set('nome')} required />
        <label htmlFor="ob-plano" className="block mb-3">
          <span className="text-xs text-muted">Plano (começa em período de teste)</span>
          <select id="ob-plano" value={planoPadrao} onChange={set('plano')}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink">
            {planos.map((p) => {
              const preco = (p.precos || [])[0]
              return <option key={p.chave} value={p.chave}>{p.nome} — {preco ? formatarPreco(preco.valor_centavos, preco.moeda) : '—'}</option>
            })}
          </select>
        </label>
        {ciclosDisponiveis.length > 1 && (
          <div className="mb-3">
            <span className="text-xs text-muted block mb-1">Ciclo de cobrança</span>
            <div className="bg-surface2 rounded-xl p-1 flex" role="radiogroup" aria-label="Ciclo de cobrança">
              {[['mensal', 'Mensal'], ['anual', 'Anual']].filter(([v]) => ciclosDisponiveis.includes(v)).map(([v, lbl]) => (
                <button type="button" key={v} onClick={() => setForm((f) => ({ ...f, ciclo: v }))}
                  aria-pressed={cicloAtual === v}
                  className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${cicloAtual === v ? 'bg-surface text-brand shadow-soft' : 'text-muted'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mb-3">
          {precoAtual && (
            <p className="text-xs text-faint">{formatarPreco(precoAtual.valor_centavos, precoAtual.moeda)} por {cicloAtual === 'anual' ? 'ano' : 'mês'}</p>
          )}
        </div>
        <p className="text-xs text-amber-700 mb-3">Valores provisórios: nada será cobrado nesta fase.</p>
        <Botao salvando={salvando}>Criar o clube</Botao>
      </form>
    )
  }
  if (etapa === 'identidade') {
    return (
      <form onSubmit={submeter({ sigla: form.sigla || '', lema: form.lema || '', cor_primaria: form.cor_primaria || '' })}>
        <h2 className="font-bold text-ink mb-3">🎨 Identidade visual</h2>
        <Campo id="ob-sigla" rotulo="Sigla (opcional)" value={form.sigla || ''} onChange={set('sigla')} maxLength={6} />
        <Campo id="ob-lema" rotulo="Lema (opcional)" value={form.lema || ''} onChange={set('lema')} />
        <Campo id="ob-cor" rotulo="Cor principal (opcional)" type="color" value={form.cor_primaria || '#2563eb'} onChange={set('cor_primaria')} />
        <Botao salvando={salvando}>Continuar</Botao>
      </form>
    )
  }
  if (etapa === 'diretor') {
    return (
      <form onSubmit={submeter({})}>
        <h2 className="font-bold text-ink mb-3">🫡 Primeiro diretor</h2>
        <p className="text-sm text-muted mb-4 leading-snug">
          Você vira a diretoria deste clube. Dá para incluir mais gente na diretoria depois, em Gestão.
        </p>
        <Botao salvando={salvando}>Sou eu</Botao>
      </form>
    )
  }
  if (etapa === 'configuracao') {
    return (
      <form onSubmit={submeter({ pix: form.pix || '' })}>
        <h2 className="font-bold text-ink mb-3">⚙️ Configuração inicial</h2>
        <Campo id="ob-pix" rotulo="Chave PIX do clube (opcional)" value={form.pix || ''} onChange={set('pix')} />
        <Botao salvando={salvando}>Continuar</Botao>
      </form>
    )
  }
  if (etapa === 'recursos') {
    return (
      <form onSubmit={submeter({ recursos: {} })}>
        <h2 className="font-bold text-ink mb-3">🧩 Recursos</h2>
        <p className="text-sm text-muted mb-4 leading-snug">
          O clube já nasce com os recursos do plano ligados. Você liga e desliga cada um quando quiser,
          em Gestão → Recursos.
        </p>
        <Botao salvando={salvando}>Continuar</Botao>
      </form>
    )
  }
  if (etapa === 'equipe') {
    return (
      <form onSubmit={submeter({
        emails: (form.emails || '').split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean),
        papel: 'instrutor',
      })}>
        <h2 className="font-bold text-ink mb-3">✉️ Convidar a equipe</h2>
        <Campo id="ob-emails" rotulo="E-mails separados por vírgula (opcional)" value={form.emails || ''} onChange={set('emails')} />
        <Botao salvando={salvando}>Continuar</Botao>
      </form>
    )
  }
  return (
    <form onSubmit={submeter({})}>
      <h2 className="font-bold text-ink mb-3">🎉 Pronto para usar</h2>
      <p className="text-sm text-muted mb-4 leading-snug">
        Conferimos se o clube nasceu completo (configuração, jogos, chat e conteúdo inicial) e liberamos o acesso.
      </p>
      <Botao salvando={salvando}>Concluir</Botao>
    </form>
  )
}
