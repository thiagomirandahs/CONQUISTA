// Bloco COMPROVAÇÃO (migration 520): relato complementar, em texto livre, de TODO requisito (Classes e Especialidades).
// REGRAS: é OPCIONAL (enviar sem relato continua permitido), NÃO substitui foto/anexo/formulário e NÃO altera o requisito
// oficial. Reaproveita o mecanismo do rascunho do relatório (local → servidor, offline, conflito aparelho × nuvem) —
// nada aqui envia para avaliação: quem envia é o botão "Enviar para avaliação" do requisito, via `preparar()`.
// Banco SEM a 520: o bloco some e nada quebra.
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Aviso } from '../../ui/index.jsx'
import { CAMPOS_RELATO, LIMITE_RELATO, RelatoIndisponivel } from '../../lib/relatorio/relato.js'
import { ehErroDeRede } from '../../lib/prazo.js'
import { useRascunhoRelatorio, decidirInicio } from './useRascunhoRelatorio.js'
import ConflitoRascunho from './ConflitoRascunho.jsx'
import { textoDoErro } from './mensagens.js'

const SEM_ANEXOS = []
const SEM_FUNCAO = () => {}
const ENTRADA = 'mt-1.5 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:opacity-70'
const comoConteudo = (t) => (t ? { relato: t } : {})

/**
 * @param salvarRelato       (texto) => Promise — grava o rascunho do relato no servidor (texto vazio apaga)
 * @param carregarServidor   () => Promise<{ relato, rascunhoEm, editavel }> — releitura antes de empurrar um local pendente
 * @param disponivel         false quando o payload não traz `relato` (banco sem a 520)
 * ref: { preparar(), salvarAgora(), aoEnviado(), retomar() }
 */
const RelatoComplementar = forwardRef(function RelatoComplementar({
  requirementId, chaveLocal, relatoInicial = null, rascunhoEm = null, desativado = false, disponivel = true,
  exigeTexto = false, salvarRelato, carregarServidor, autosaveMs = 1500, className = '',
}, ref) {
  const [inicio] = useState(() => decidirInicio({ chaveLocal, valorInicial: { conteudo: comoConteudo(relatoInicial || ''), anexos: [], rascunhoEm } }))
  const [conteudo, setConteudo] = useState(inicio.conteudo)
  const [ausente, setAusente] = useState(false) // o servidor respondeu "RPC inexistente" → some
  const servidor = useRef((relatoInicial || '').trim())
  const vivo = disponivel && !ausente

  async function gravar(c) {
    const t = (c?.relato || '').trim()
    try {
      await salvarRelato(t)
      servidor.current = t
    } catch (e) {
      if (e instanceof RelatoIndisponivel) { setAusente(true); return }
      throw e
    }
  }
  const lerServidor = carregarServidor
    ? async () => {
      const s = await carregarServidor()
      if (!s) return s
      return { conteudo: comoConteudo((s.relato || '').trim()), anexos: [], rascunhoEm: s.rascunhoEm ?? null, editavel: s.editavel }
    }
    : undefined

  const rasc = useRascunhoRelatorio({
    campos: CAMPOS_RELATO, conteudo, anexos: SEM_ANEXOS, setConteudo, setAnexos: SEM_FUNCAO, desativado: desativado || !vivo,
    onSalvarRascunho: gravar, autosaveMs, chaveLocal, carregarServidor: lerServidor, inicio,
  })
  const ultimo = useRef({})
  ultimo.current = { texto: (conteudo.relato || '').trim(), rasc, vivo }

  async function salvarAgora() {
    const { texto, vivo: ativo } = ultimo.current
    if (!ativo || texto === servidor.current) return
    try {
      await gravar({ relato: texto })
    } catch (e) {
      throw new Error(ehErroDeRede(e) || (typeof navigator !== 'undefined' && navigator.onLine === false)
        ? 'Sem internet: seu relato ficou salvo neste aparelho. Tente de novo quando a conexão voltar.'
        : textoDoErro(e, 'Não consegui salvar o seu relato.'))
    }
  }
  useImperativeHandle(ref, () => ({
    salvarAgora,
    // antes de ENVIAR: nunca envia sozinho — só garante que o relato digitado já está no servidor (o envio congela esse texto)
    async preparar() {
      const { vivo: ativo, rasc: r } = ultimo.current
      if (!ativo) return
      if (r.conflito) throw new Error('Escolha qual versão do seu relato usar antes de enviar.')
      r.parar()
      try { await salvarAgora() } catch (e) { r.retomar(); throw e }
    },
    retomar: () => ultimo.current.rasc.retomar(),
    aoEnviado: () => ultimo.current.rasc.aoEnviado(),
  }))

  if (!vivo) return null
  const id = `relato-${requirementId}`
  const texto = conteudo.relato || ''
  const rotulo = exigeTexto ? 'Relato complementar (opcional)' : 'Relato / comprovação (opcional)'
  const { estado } = rasc

  return (
    <section data-testid="relato-complementar" aria-labelledby={`${id}-t`} className={`rounded-2xl bg-surface2/60 p-3 ${className}`}>
      <h4 id={`${id}-t`} className="text-xs font-extrabold uppercase tracking-wide text-muted">Comprovação</h4>
      <p className="mt-0.5 text-sm text-ink">Conte ao instrutor como você cumpriu este requisito.</p>
      {rasc.conflito && <div className="mt-2"><ConflitoRascunho conflito={rasc.conflito} aoEscolher={rasc.resolverConflito} assunto="do seu relato" /></div>}
      {rasc.encerrado && <div className="mt-2"><Aviso tom="info"><p data-testid="aviso-relato-encerrado">Este requisito já foi enviado/aprovado; guardamos uma cópia do seu relato neste aparelho.</p></Aviso></div>}
      <label htmlFor={id} className="mt-2 block text-sm font-bold text-ink">{rotulo}</label>
      <textarea id={id} data-testid="relato-texto" value={texto} maxLength={LIMITE_RELATO} rows={4} disabled={desativado || rasc.encerrado}
        autoComplete="off" autoCapitalize="sentences" enterKeyHint="enter" aria-describedby={`${id}-ajuda`}
        placeholder="Escreva aqui, com as suas palavras..."
        onChange={(e) => setConteudo(comoConteudo(e.target.value))} className={ENTRADA} />
      <p id={`${id}-ajuda`} className="mt-1 text-xs text-muted">
        <span data-testid="contagem-relato">{texto.length} de {LIMITE_RELATO} caracteres</span>
        {' · '}É o seu relato: ele não muda o requisito oficial.
      </p>
      {!desativado && (
        <div className="mt-1 space-y-1">
          <p role="status" aria-live="polite" data-testid="estado-relato" className="min-h-[1.25rem] text-xs text-muted">
            {estado === 'salvando' && 'Salvando...'}
            {estado === 'salvo' && 'Salvo'}
            {estado === 'local' && 'Salvo neste aparelho'}
            {estado === 'erro' && 'Erro ao sincronizar'}
          </p>
          {estado === 'erro' && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-rose-800" data-testid="erro-sincronizar-relato">
              {rasc.motivo && <span>{rasc.motivo}</span>}
              <button type="button" onClick={rasc.tentarDeNovo} className="inline-flex min-h-[44px] items-center rounded-xl px-3 font-bold underline">Tentar de novo</button>
            </div>
          )}
          {rasc.temBackup && !rasc.conflito && (
            <button type="button" onClick={rasc.recuperarBackup} data-testid="recuperar-relato"
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-muted underline">Recuperar a outra versão</button>
          )}
        </div>
      )}
    </section>
  )
})

export default RelatoComplementar
