import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useEscopo } from '../context/Escopo.jsx'
import { carregarResumoCoordenador, carregarInvestidurasDoEscopo } from '../services/institucional.js'
import { EsqueletoTela } from '../ui/carregamento.jsx'
import { entrarNaRedeComoCoordenacao } from '../lib/redeModo.js'
import { Aviso, Carregando, Vazio, mensagemDeErro } from '../ui/index.jsx'
import {
  PERIODOS, dataBR, estaParado, fraseAvanco, fraseVisita, gerarCSV, gerarHTMLImpressao, gerarTextoWhatsApp,
  linkAjudaWhatsApp, pctTexto,
} from '../lib/relatorioCoordenador.js'

// =============================================================================
//  Painel do coordenador — tela inicial "Como estão meus clubes".
//  Público: coordenação de distrito/região, muitos idosos, 100% no celular. Por isso: letra ≥ 16px,
//  botões ≥ 56px, frases simples sem sigla, no máximo 3 botões principais, ajuda sempre à mão.
//  Só números por clube (o servidor — migration 390 — nem devolve nome de pessoa, foto ou conversa).
//  O portal completo (abas) continua em /institucional/detalhes.
// =============================================================================
const BOTAO_GRANDE = 'flex items-center justify-center gap-2 min-h-[56px] px-4 rounded-2xl text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

export default function PainelCoordenador() {
  const { carregando, erro, escopos, escopo, temEscopo, capacidades, trocarEscopo, recarregar } = useEscopo()
  useEffect(() => { recarregar?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [periodo, setPeriodo] = useState('mes')
  const [resumo, setResumo] = useState(null)
  const [erroResumo, setErroResumo] = useState(null)
  const [aprovacoes, setAprovacoes] = useState(null)
  const [aviso, setAviso] = useState('')
  const [versao, setVersao] = useState(0)
  const verPainel = !!capacidades?.ver_painel

  useEffect(() => {
    if (!escopo || !verPainel) return undefined
    let vivo = true
    setResumo(null); setErroResumo(null)
    carregarResumoCoordenador(periodo).then((d) => { if (vivo) setResumo(d) }).catch((e) => { if (vivo) setErroResumo(e) })
    return () => { vivo = false }
  }, [escopo, verPainel, periodo, versao])

  useEffect(() => {
    if (!escopo) return undefined
    let vivo = true
    carregarInvestidurasDoEscopo().then((x) => { if (vivo) setAprovacoes(x || []) }).catch(() => { if (vivo) setAprovacoes([]) })
    return () => { vivo = false }
  }, [escopo, versao])

  const mudou = useCallback(() => setVersao((x) => x + 1), [])
  useEffect(() => { window.addEventListener('conta:atualizar', mudou); return () => window.removeEventListener('conta:atualizar', mudou) }, [mudou])

  if (carregando) return <div className="max-w-2xl mx-auto px-4 py-6"><EsqueletoTela cartoes={3} /></div>
  if (erro) {
    return <div className="max-w-md mx-auto px-4 mt-8"><Aviso tom="erro" titulo="Não deu pra carregar seus vínculos">Confira a internet e tente de novo.</Aviso></div>
  }
  if (!temEscopo) {
    return (
      <div className="max-w-md mx-auto px-4 mt-8">
        <Vazio icone="🏛️" titulo="Sem vínculo institucional"
          acao={<Link to="/" className="inline-block text-base font-semibold text-brand underline min-h-[56px] leading-[56px]">Voltar para o meu clube</Link>}>
          Este painel é para a coordenação de distrito, região ou associação.
        </Vazio>
      </div>
    )
  }

  const clubes = resumo?.clubes || []
  const t = resumo?.totais || {}
  const parados = clubes.filter(estaParado)
  const nomeArquivo = `meus-clubes-${periodo}-${resumo?.hoje || 'hoje'}`

  const baixarPlanilha = () => {
    const blob = new Blob([gerarCSV(resumo)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${nomeArquivo}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setAviso('Planilha baixada. Abra no Excel ou no aplicativo de planilhas.')
  }
  const imprimirPDF = () => {
    const w = window.open('', '_blank')
    if (!w) { setAviso('O celular bloqueou a janela. Permita janelas e toque de novo.'); return }
    w.document.open(); w.document.write(gerarHTMLImpressao(resumo)); w.document.close()
    w.focus(); setTimeout(() => w.print(), 300)
    setAviso('Na janela de impressão, escolha "Salvar como PDF".')
  }
  const compartilhar = async () => {
    const texto = gerarTextoWhatsApp(resumo)
    try {
      if (navigator.share) { await navigator.share({ text: texto }); return }
    } catch (e) { if (e?.name === 'AbortError') return }
    try {
      await navigator.clipboard.writeText(texto)
      setAviso('Resumo copiado! Abra o WhatsApp e cole na conversa.')
    } catch {
      setAviso('Não deu para copiar sozinho. Tente de novo.')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 pb-32 text-base">
      <header className="mb-4 rounded-3xl bg-gradient-to-br from-brand to-brand2 p-5 shadow-glow" style={{ color: 'var(--marca-1-texto, #fff)' }}>
        <p className="text-base font-semibold opacity-90">{escopo?.nome}</p>
        <h1 className="text-2xl font-extrabold leading-tight mt-1">Como estão meus clubes</h1>
        {escopos.length > 1 && (
          <label className="block mt-3">
            <span className="text-base font-semibold opacity-90">Ver outra coordenação</span>
            <select value={escopo?.escopo_id || ''} onChange={(e) => trocarEscopo(e.target.value)}
              className="mt-1 w-full min-h-[56px] rounded-xl bg-surface px-3 text-base font-semibold text-ink">
              {escopos.map((e) => <option key={e.escopo_id} value={e.escopo_id}>{e.nome}</option>)}
            </select>
          </label>
        )}
      </header>

      {/* 3 botões principais — nada mais disputa a atenção */}
      <nav aria-label="Botões principais" className="grid grid-cols-1 gap-3 mb-5" data-testid="botoes-principais">
        <Link to="/institucional/detalhes?aba=clubes" className={`${BOTAO_GRANDE} bg-surface shadow-soft text-ink`}>🏕️ Meus clubes</Link>
        <Link to="/institucional/detalhes?aba=geral" className={`${BOTAO_GRANDE} bg-surface shadow-soft text-ink`}>
          ✍️ Aprovações{aprovacoes?.length > 0 && <span className="ml-1 rounded-full bg-amber-500 text-white px-2.5 py-0.5 text-base">{aprovacoes.length}</span>}
        </Link>
        <Link to="/institucional/detalhes?aba=visitas" className={`${BOTAO_GRANDE} bg-surface shadow-soft text-ink`}>🚗 Visitas</Link>
      </nav>

      {/* Rede DBV (migration 490): a coordenação entra como "Coordenação · <unidade>". Fica fora dos 3 botões
          principais de propósito; se nenhum clube da área liberou a rede, a própria rede explica. */}
      <Link to="/rede" onClick={entrarNaRedeComoCoordenacao} data-testid="cartao-rede"
        className="flex items-center gap-3 min-h-[64px] mb-5 rounded-2xl bg-surface shadow-soft p-4 text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        <span aria-hidden="true" className="text-3xl">🌎</span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-extrabold leading-tight">Rede DBV</span>
          <span className="block text-base text-muted leading-snug">Veja e publique na rede dos clubes da sua área</span>
        </span>
        <span aria-hidden="true" className="text-2xl text-faint">›</span>
      </Link>

      {!verPainel ? (
        <p className="text-base text-muted">Seu cargo nesta coordenação não inclui os números dos clubes.</p>
      ) : (
        <>
          <div role="group" aria-label="Período" className="grid grid-cols-3 gap-2 mb-4">
            {PERIODOS.map((p) => (
              <button key={p.chave} type="button" aria-pressed={periodo === p.chave} onClick={() => setPeriodo(p.chave)}
                className={`${BOTAO_GRANDE} !px-2 ${periodo === p.chave ? 'bg-brand text-white' : 'bg-surface2 text-ink'}`}>
                {p.rotulo}
              </button>
            ))}
          </div>

          {erroResumo && <Aviso tom="erro" titulo="Não deu pra carregar os clubes">{mensagemDeErro(erroResumo)}</Aviso>}
          {!resumo && !erroResumo ? <Carregando linhas={3} texto="Somando os números dos clubes" /> : resumo && (
            <>
              <section aria-label="Resumo" className="rounded-2xl bg-surface shadow-soft p-4 mb-4 space-y-1 text-base text-ink" data-testid="resumo-geral">
                <p>🏕️ <b>{t.clubes ?? 0}</b> {t.clubes === 1 ? 'clube' : 'clubes'}</p>
                <p>🎓 <b>{t.desbravadores_em_classe ?? 0}</b> desbravadores fazendo classe</p>
                <p>✅ <b>{pctTexto(t.requisitos_pct)}</b> dos requisitos aprovados</p>
                <p>📝 <b>{t.aprovados_no_periodo ?? 0}</b> requisitos aprovados no período</p>
                <p data-testid="visitas-ano">🚗 Visitas do ano: <b>{t.visitados_ano ?? 0}</b> visitados, <b>{t.faltando_visitar_ano ?? 0}</b> faltando</p>
              </section>

              {parados.length > 0 && (
                <section aria-label="Precisam de atenção" className="mb-4 space-y-2">
                  {parados.map((c) => (
                    <p key={c.club_id} role="alert" className="rounded-2xl bg-amber-50 border-2 border-amber-400 p-4 text-base font-bold text-amber-900">
                      ⚠️ {c.nome} {c.dias_sem_avancar == null ? 'ainda não começou as classes no aplicativo' : `não avança há ${c.dias_sem_avancar} dias`}
                    </p>
                  ))}
                </section>
              )}

              <section aria-label="Relatórios" className="mb-5">
                <h2 className="text-lg font-extrabold text-ink mb-2">Relatórios</h2>
                <div className="grid grid-cols-1 gap-2">
                  <button type="button" onClick={imprimirPDF} className={`${BOTAO_GRANDE} bg-surface2 text-ink`}>📄 Relatório em PDF</button>
                  <button type="button" onClick={baixarPlanilha} className={`${BOTAO_GRANDE} bg-surface2 text-ink`}>📊 Planilha (Excel)</button>
                  <button type="button" onClick={compartilhar} className={`${BOTAO_GRANDE} bg-surface2 text-ink`}>💬 Resumo para o WhatsApp</button>
                </div>
                {aviso && <p role="status" className="mt-2 text-base text-green-800">{aviso}</p>}
              </section>

              {clubes.length === 0 ? (
                <Vazio icone="🏕️" titulo="Nenhum clube por aqui ainda">Quando um clube for ligado à sua coordenação, ele aparece aqui sozinho.</Vazio>
              ) : (
                <ul className="space-y-3">
                  {clubes.map((c) => (
                    <li key={c.club_id} data-testid="cartao-clube" className="rounded-2xl bg-surface shadow-soft p-4 text-base text-ink">
                      <h3 className="text-xl font-extrabold leading-tight">{c.nome}</h3>
                      <p className="mt-2">🎓 <b>{c.desbravadores_em_classe ?? 0}</b> desbravadores fazendo classe</p>
                      <p>✅ <b>{pctTexto(c.requisitos_pct)}</b> dos requisitos aprovados</p>
                      <p>📝 <b>{c.aprovados_no_periodo ?? 0}</b> aprovados no período</p>
                      <p className={estaParado(c) ? 'font-bold text-amber-900' : ''}>🕒 {fraseAvanco(c)}{c.ultimo_avanco ? ` (${dataBR(c.ultimo_avanco)})` : ''}</p>
                      <p>🚗 {fraseVisita(c)}</p>
                      {c.proxima_visita && <p>📅 Próxima visita: {dataBR(c.proxima_visita)}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      <p className="text-base text-muted mt-6 leading-snug">
        Aqui aparecem só números gerais de cada clube. Nomes, fotos e conversas ficam dentro do clube.
      </p>

      <a href={linkAjudaWhatsApp(escopo?.nome)} target="_blank" rel="noopener noreferrer" data-testid="preciso-de-ajuda"
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 min-h-[56px] px-5 rounded-full bg-[#25D366] text-[#07122f] text-base font-extrabold shadow-lg"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        💬 Preciso de ajuda
      </a>
    </div>
  )
}
