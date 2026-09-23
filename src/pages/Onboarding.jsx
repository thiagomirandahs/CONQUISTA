import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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

  const buscar = useCallback(async () => {
    try { setEstado(await carregarOnboarding()) } catch (e) { setErro(e?.message || String(e)) }
  }, [])
  useEffect(() => { buscar() }, [buscar])

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
                  className={`text-[11px] px-2 py-1 rounded-full border ${agora ? 'bg-brand text-white border-brand font-bold'
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
          <Link to="/" className="block mt-4 min-h-[48px] leading-[48px] rounded-xl bg-brand text-white font-bold">
            Entrar no clube
          </Link>
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
    return (
      <form onSubmit={submeter({ nome: form.nome || '', plano: form.plano || 'essencial' })}>
        <h2 className="font-bold text-ink mb-3">🏕️ O clube</h2>
        <Campo id="ob-clube" rotulo="Nome do clube" value={form.nome || ''} onChange={set('nome')} required />
        <label htmlFor="ob-plano" className="block mb-3">
          <span className="text-xs text-muted">Plano (começa em período de teste)</span>
          <select id="ob-plano" value={form.plano || 'essencial'} onChange={set('plano')}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink">
            {planos.map((p) => {
              const mensal = (p.precos || []).find((x) => x.ciclo === 'mensal')
              return <option key={p.chave} value={p.chave}>{p.nome} — {mensal ? formatarPreco(mensal.valor_centavos, mensal.moeda) : '—'}/mês</option>
            })}
          </select>
        </label>
        <p className="text-[11px] text-amber-700 mb-3">Valores provisórios: nada será cobrado nesta fase.</p>
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
