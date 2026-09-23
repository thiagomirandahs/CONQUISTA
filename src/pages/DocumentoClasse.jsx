import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { conteudoDocumento } from '../services/documentos.js'
import { qrSvg } from '../lib/qr.js'

// Representação imprimível do documento (dono/liderança). É função pura do snapshot (via
// documento_conteudo) — regenerável: mesmo token ⇒ mesmo documento. O PDF sai da impressão do
// navegador (A4). O QR aponta pra /verificar/<token>, nunca carrega os dados curriculares.
const SIT = {
  aprovado: { rotulo: 'Aprovado', icone: '✓' },
  aguardando_avaliacao: { rotulo: 'Aguardando', icone: '⏳' },
  correcao_solicitada: { rotulo: 'Correção', icone: '↺' },
  em_andamento: { rotulo: 'Em andamento', icone: '…' },
  nao_iniciado: { rotulo: 'Não iniciado', icone: '·' },
}
const fmtData = (iso) => {
  if (!iso) return ''
  const so = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return so ? `${so[3]}/${so[2]}/${so[1]}` : ''
}
const fmtConf = (c) => (c ? String(c).replace(/(.{4})(.{4})/, '$1-$2') : '')
const ESTADO_ROTULO = { valido: 'Válido', acompanhamento: 'Acompanhamento', substituido: 'Substituído', revogado: 'Revogado', desconhecido: '—' }

export default function DocumentoClasse() {
  const { token } = useParams()
  const [dados, setDados] = useState(undefined)

  useEffect(() => {
    let vivo = true
    conteudoDocumento(token).then((d) => { if (vivo) setDados(d) }).catch(() => { if (vivo) setDados(null) })
    return () => { vivo = false }
  }, [token])

  if (dados === undefined) return <p className="text-center text-muted text-sm mt-10" role="status">Carregando documento…</p>
  if (dados === null) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft max-w-md mx-auto mt-8">
        <div className="text-4xl mb-2" aria-hidden="true">🔒</div>
        <p className="font-semibold text-ink">Documento indisponível</p>
        <p className="text-sm text-faint">Este documento não existe ou você não tem acesso a ele.</p>
      </div>
    )
  }

  const doc = dados.documento || {}
  const urlVerificacao = `${window.location.origin}/verificar/${token}`
  const ehAcomp = doc.tipo !== 'final'

  return (
    <div className="doc-wrap">
      <style>{CSS_DOC}</style>

      <div className="doc-toolbar no-print">
        <div className="text-sm text-muted">Pré-visualização — use “Imprimir” e salve como PDF (A4).</div>
        <button onClick={() => window.print()} className="rounded-xl bg-gradient-to-r from-brand to-brand2 text-white font-bold text-sm px-4 py-2 shadow-glow">
          🖨️ Imprimir / Salvar PDF
        </button>
      </div>

      <article className="folha" aria-label="Documento de classe">
        {(doc.estado === 'revogado' || doc.estado === 'substituido') && (
          <div className={`faixa-estado ${doc.estado}`}>
            {doc.estado === 'revogado' ? 'DOCUMENTO REVOGADO' : 'SUBSTITUÍDO POR UMA VERSÃO MAIS RECENTE'}
          </div>
        )}

        <header className="doc-header">
          <div>
            <div className="marca">📘 Caderno Digital DesbravaClube</div>
            <h1 className="doc-titulo">{ehAcomp ? 'Caderno de acompanhamento de classe' : 'Documento de conclusão de classe'}</h1>
            {ehAcomp && <div className="doc-sub-aviso">Acompanhamento curricular — não é comprovante de investidura.</div>}
          </div>
          <div className="qr" aria-hidden="false" dangerouslySetInnerHTML={{ __html: qrSvg(urlVerificacao) }} />
        </header>

        <section className="ident">
          <Campo r="Desbravador(a)" v={dados.pessoa?.nome} destaque />
          <Campo r="Clube" v={dados.clube_emissor?.nome} />
          <Campo r="Classe" v={dados.classe?.nome} />
          <Campo r="Currículo" v={`${dados.curriculum_version?.identificador || ''} ${dados.curriculum_version?.versao || ''}`.trim()} />
          <Campo r="Início" v={fmtData(dados.periodo?.iniciada_em)} />
          <Campo r="Conclusão dos requisitos" v={fmtData(dados.periodo?.concluida_em)} />
          {dados.periodo?.investidura?.data && <Campo r="Investidura" v={fmtData(dados.periodo.investidura.data)} />}
          {dados.revisao?.revisado_em && <Campo r="Revisão final" v={`${fmtData(dados.revisao.revisado_em)}${dados.revisao.revisado_por_nome ? ` · ${dados.revisao.revisado_por_nome}` : ''}`} />}
        </section>

        {(dados.secoes || []).map((s) => (
          <section key={s.codigo} className="secao">
            <h2 className="secao-titulo">{s.codigo}. {s.nome}</h2>
            {(s.requisitos || []).map((r) => (
              <div key={r.codigo} className="req">
                <div className="req-top">
                  <div className="req-desc"><span className="req-cod">{r.codigo}.</span> {r.descricao}</div>
                  <div className={`req-sit sit-${r.situacao}`}>{(SIT[r.situacao] || SIT.nao_iniciado).icone} {(SIT[r.situacao] || SIT.nao_iniciado).rotulo}</div>
                </div>
                {r.conteudo_dinamico?.valor && <div className="req-extra">📖 {r.conteudo_dinamico.valor}</div>}
                {r.escolha?.escolhidas?.length > 0 && <div className="req-extra">Escolha: {r.escolha.escolhidas.join('; ')}</div>}
                {r.aprovado_por?.nome && <div className="req-aprov">Aprovado por {r.aprovado_por.nome} ({r.aprovado_por.papel}) em {fmtData(r.aprovado_por.em)}</div>}
              </div>
            ))}
          </section>
        ))}

        <section className="assinaturas">
          <div className="ass-titulo">Assinaturas</div>
          <div className="ass-grid">
            <div className="ass-linha"><div className="ass-risco" /><div className="ass-rot">Conselheiro(a) da unidade</div></div>
            <div className="ass-linha"><div className="ass-risco" /><div className="ass-rot">Diretoria do clube</div></div>
            <div className="ass-linha"><div className="ass-risco" /><div className="ass-rot">Reservado (Distrital/Regional)</div></div>
          </div>
          <div className="ass-nota">Espaço reservado para assinaturas. Este documento ainda não possui assinatura digital.</div>
        </section>

        <footer className="doc-footer">
          <div className="conf">
            <div><strong>Conferência:</strong> <code>{fmtConf(doc.conferencia)}</code> · <strong>Estado:</strong> {ESTADO_ROTULO[doc.estado] || '—'}{doc.integro === false ? ' · ⚠ integridade não confirmada' : ''}</div>
            <div><strong>Emitido em:</strong> {fmtData(doc.emitido_em)} · <strong>Modelo:</strong> {doc.template?.chave}/{doc.template?.versao}</div>
            <div className="verif-url">Verifique em: {urlVerificacao}</div>
          </div>
          <div className="disclaimer">
            Registro interno do clube para acompanhamento curricular. <strong>Não substitui</strong> o cartão ou o
            registro oficial da Igreja Adventista / do Ministério de Desbravadores, nem constitui documento eclesiástico.
          </div>
        </footer>
      </article>
    </div>
  )
}

function Campo({ r, v, destaque }) {
  return (
    <div className="campo">
      <span className="campo-rot">{r}</span>
      <span className={`campo-val ${destaque ? 'campo-destaque' : ''}`}>{v || '—'}</span>
    </div>
  )
}

// Estilos do documento — mobile-first na tela, A4 na impressão. Requisito nunca é cortado
// (break-inside: avoid) e a situação nunca se separa do texto (ficam no mesmo bloco .req).
const CSS_DOC = `
.doc-wrap { --tinta:#1f2430; --leve:#6b7280; --linha:#e5e7eb; color:var(--tinta); }
.doc-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; max-width:820px; margin:0 auto 12px; padding:0 4px; flex-wrap:wrap; }
.folha { background:#fff; color:var(--tinta); max-width:820px; margin:0 auto; padding:24px; border-radius:16px; box-shadow:0 1px 8px rgba(0,0,0,.08); }
.faixa-estado { text-align:center; font-weight:800; letter-spacing:.04em; padding:8px; border-radius:8px; margin-bottom:16px; }
.faixa-estado.revogado { background:#fee2e2; color:#991b1b; }
.faixa-estado.substituido { background:#fef3c7; color:#92400e; }
.doc-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; border-bottom:2px solid var(--tinta); padding-bottom:12px; margin-bottom:12px; }
.marca { font-weight:800; font-size:13px; color:var(--leve); }
.doc-titulo { font-size:20px; font-weight:800; margin:2px 0 0; }
.doc-sub-aviso { font-size:12px; color:#92400e; background:#fef3c7; display:inline-block; padding:2px 8px; border-radius:6px; margin-top:6px; }
.qr { width:96px; height:96px; flex-shrink:0; }
.qr svg { width:100%; height:100%; display:block; }
.ident { display:grid; grid-template-columns:1fr 1fr; gap:6px 20px; margin-bottom:16px; }
@media (max-width:520px){ .ident { grid-template-columns:1fr; } }
.campo { display:flex; justify-content:space-between; gap:10px; border-bottom:1px dotted var(--linha); padding:3px 0; font-size:13px; }
.campo-rot { color:var(--leve); }
.campo-val { text-align:right; font-weight:600; }
.campo-destaque { font-size:15px; }
.secao { margin-bottom:12px; }
.secao-titulo { font-size:14px; font-weight:800; background:#f3f4f6; padding:5px 10px; border-radius:6px; margin:0 0 6px; break-after:avoid; }
.req { border-bottom:1px solid var(--linha); padding:6px 2px; break-inside:avoid; }
.req-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.req-desc { font-size:13px; line-height:1.35; }
.req-cod { font-weight:700; }
.req-sit { font-size:11px; font-weight:700; white-space:nowrap; padding:1px 8px; border-radius:999px; border:1px solid var(--linha); }
.sit-aprovado { color:#166534; background:#f0fdf4; border-color:#bbf7d0; }
.sit-aguardando_avaliacao { color:#92400e; background:#fffbeb; }
.sit-correcao_solicitada { color:#991b1b; background:#fef2f2; }
.req-extra { font-size:12px; color:var(--tinta); margin-top:3px; }
.req-aprov { font-size:11px; color:var(--leve); margin-top:2px; }
.assinaturas { margin-top:18px; break-inside:avoid; }
.ass-titulo { font-size:13px; font-weight:800; margin-bottom:12px; }
.ass-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; }
@media (max-width:520px){ .ass-grid { grid-template-columns:1fr; gap:16px; } }
.ass-risco { border-top:1px solid var(--tinta); margin-top:26px; }
.ass-rot { font-size:11px; color:var(--leve); text-align:center; margin-top:4px; }
.ass-nota { font-size:10px; color:var(--leve); margin-top:8px; font-style:italic; }
.doc-footer { margin-top:18px; border-top:1px solid var(--linha); padding-top:10px; break-inside:avoid; }
.conf { font-size:11px; color:var(--tinta); line-height:1.5; }
.conf code { font-family:ui-monospace,monospace; }
.verif-url { color:var(--leve); word-break:break-all; }
.disclaimer { font-size:10px; color:var(--leve); margin-top:8px; line-height:1.4; }
@media print {
  @page { size:A4; margin:14mm; }
  .no-print { display:none !important; }
  .doc-wrap { --tinta:#000; }
  .folha { box-shadow:none; border-radius:0; max-width:none; margin:0; padding:0; }
  .req, .assinaturas, .doc-footer, .secao-titulo { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
}
`
