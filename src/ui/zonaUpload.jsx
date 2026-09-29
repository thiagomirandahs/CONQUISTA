import { useEffect, useId, useMemo } from 'react'

// =============================================================================
//  Zona de upload (fase 6.3): a "caixa tracejada grande com ícone" que já existia em MinhaClasse
//  (foto de comprovação) e no Mural, agora como peça única com todos os estados.
//
//  Estados: vazio → selecionado (miniatura + nome) → enviando (progresso) → concluído | erro.
//  O `<input type="file">` fica escondido mas ACESSÍVEL (sr-only, com rótulo); a caixa inteira é o
//  `<label>`, então o alvo de toque é enorme — tem criança e responsável com dificuldade usando.
//  Nada de neon: caixa tracejada, ícone e uma frase.
// =============================================================================

const juntar = (...c) => c.filter(Boolean).join(' ')

const TEXTO_VAZIO = { imagem: 'Toque para tirar uma foto ou escolher da galeria', arquivo: 'Toque para escolher um arquivo' }

/**
 * Caixa de envio de arquivo, mobile-first.
 *
 * O estado é controlado por quem usa: o componente não faz o upload, só mostra onde ele está.
 *
 * @param {object} p
 * @param {File|null} [p.arquivo]         arquivo escolhido (dispara o estado "selecionado")
 * @param {Function} p.aoEscolher         recebe o `File` escolhido
 * @param {Function} [p.aoRemover]        botão "Remover" (estados selecionado/erro/concluído)
 * @param {'vazio'|'selecionado'|'enviando'|'erro'|'concluido'} [p.estado]  força o estado; sem ele,
 *        é "selecionado" quando há `arquivo` e "vazio" quando não há
 * @param {number|string} [p.progresso]   número (0–100) ou texto livre durante o envio
 * @param {string} [p.erro]               mensagem humana (estado erro)
 * @param {string} [p.previaUrl]          miniatura já pronta (ex.: foto salva no servidor)
 * @param {string} [p.accept='image/*']
 * @param {string} [p.capture]            'environment' | 'user' (abre a câmera direto no celular)
 * @param {string} [p.rotulo='Foto']      nome acessível do input
 * @param {string} [p.ajuda]              frase abaixo do ícone no estado vazio
 * @param {boolean} [p.obrigatorio]
 * @param {boolean} [p.desabilitado]
 *
 * @example
 * <ZonaUpload rotulo="Foto de comprovação" arquivo={foto} aoEscolher={setFoto} aoRemover={() => setFoto(null)}
 *   estado={enviando ? 'enviando' : undefined} progresso={pct} erro={erro} capture="environment" />
 */
export function ZonaUpload({ arquivo = null, aoEscolher, aoRemover, estado, progresso, erro, previaUrl, accept = 'image/*',
  capture, rotulo = 'Foto', ajuda, obrigatorio = false, desabilitado = false, className }) {
  const idInput = useId()
  const idAjuda = `${idInput}-ajuda`
  const ehImagem = accept.startsWith('image')
  const efetivo = estado || (arquivo || previaUrl ? 'selecionado' : 'vazio')
  const enviando = efetivo === 'enviando'
  const travado = desabilitado || enviando

  // Miniatura local do arquivo: a URL de objeto nasce com o arquivo e é liberada ao trocar/desmontar.
  const previaLocal = useMemo(() => (
    arquivo?.type?.startsWith('image/') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(arquivo) : null
  ), [arquivo])
  useEffect(() => () => { if (previaLocal) URL.revokeObjectURL(previaLocal) }, [previaLocal])
  const previa = previaLocal || previaUrl || null

  const nomeRotulo = `${rotulo}${obrigatorio ? ' (obrigatória)' : ''}`
  const borda = efetivo === 'erro' ? 'border-rose-300 bg-rose-50'
    : efetivo === 'concluido' ? 'border-emerald-300 bg-emerald-50'
      : 'border-line bg-surface2 hover:border-brand'

  return (
    <div className={className} data-estado={efetivo} data-testid="zona-upload">
      <label className={juntar('group flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition',
        travado ? 'cursor-not-allowed opacity-70' : 'cursor-pointer active:scale-[0.99]', borda)}>
        <input id={idInput} type="file" accept={accept} capture={capture} className="sr-only" disabled={travado}
          aria-label={nomeRotulo} aria-describedby={idAjuda} aria-invalid={efetivo === 'erro' ? 'true' : undefined}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) aoEscolher?.(f); e.target.value = '' }} />

        {previa ? (
          <img src={previa} alt="" className="max-h-48 w-auto rounded-xl object-contain shadow-soft" />
        ) : (
          <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-surface text-3xl shadow-soft">
            {efetivo === 'erro' ? '⚠️' : efetivo === 'concluido' ? '✅' : ehImagem ? '📷' : '📎'}
          </span>
        )}

        {arquivo?.name && <span className="max-w-full truncate text-xs text-muted" data-testid="zona-upload-nome">{arquivo.name}</span>}

        <span className="text-base font-bold text-ink">
          {efetivo === 'vazio' && (ehImagem ? 'Adicionar foto' : 'Adicionar arquivo')}
          {efetivo === 'selecionado' && (ehImagem ? 'Trocar foto' : 'Trocar arquivo')}
          {efetivo === 'enviando' && 'Enviando…'}
          {efetivo === 'erro' && 'Tentar de novo'}
          {efetivo === 'concluido' && 'Enviado'}
        </span>

        <span id={idAjuda} className="text-xs text-muted">
          {efetivo === 'vazio' && (ajuda || TEXTO_VAZIO[ehImagem ? 'imagem' : 'arquivo'])}
          {efetivo === 'selecionado' && 'Toque para escolher outro'}
          {efetivo === 'enviando' && (typeof progresso === 'number' ? `${Math.min(100, Math.max(0, Math.round(progresso)))}%` : (progresso || 'Só um instante'))}
          {efetivo === 'concluido' && 'Tudo certo com o envio'}
          {efetivo === 'erro' && (erro || 'Não deu certo agora. Tente de novo.')}
        </span>
      </label>

      {enviando && (
        <span className="sr-only" role="status" aria-live="polite">
          Enviando{typeof progresso === 'number' ? ` ${Math.round(progresso)}%` : ''}
        </span>
      )}
      {efetivo === 'erro' && erro && <p role="alert" className="sr-only">{erro}</p>}

      {aoRemover && !enviando && (arquivo || previaUrl) && (
        <button type="button" onClick={aoRemover} disabled={desabilitado}
          className="mt-2 min-h-[44px] w-full rounded-xl text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
          {ehImagem ? 'Remover foto' : 'Remover arquivo'}
        </button>
      )}
    </div>
  )
}
