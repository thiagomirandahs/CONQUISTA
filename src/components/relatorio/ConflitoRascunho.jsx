// Decisão de conflito do rascunho: duas versões (aparelho × nuvem), cada uma com horário e prévia.
// Nada é sobrescrito sem escolha explícita; a versão não escolhida vira cópia de segurança recuperável.
import { Botao } from '../../ui/index.jsx'
import { formatarHorario, previaDoConteudo } from '../../lib/relatorio/conflito.js'

function Versao({ titulo, em, conteudo, testid }) {
  return (
    <div data-testid={testid} className="rounded-xl border border-amber-300 bg-white/70 p-3">
      <p className="text-xs font-extrabold uppercase tracking-wide text-amber-950">{titulo}</p>
      <p data-testid={`${testid}-horario`} className="text-sm font-semibold text-ink">{formatarHorario(em)}</p>
      <p data-testid={`${testid}-previa`} className="mt-1 break-words text-sm text-muted">{previaDoConteudo(conteudo)}</p>
    </div>
  )
}

export default function ConflitoRascunho({ conflito, aoEscolher }) {
  return (
    <div data-testid="conflito-rascunho" role="group" aria-labelledby="conflito-titulo" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p id="conflito-titulo" className="font-bold"><span aria-hidden="true">⚠ </span>Encontramos duas versões deste relatório.</p>
      <p className="mt-1">Nada foi sobrescrito. Escolha qual usar; a outra fica guardada neste aparelho e dá para recuperar.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Versao testid="versao-aparelho" titulo="Versão deste aparelho" em={conflito.local.em} conteudo={conflito.local.conteudo} />
        <Versao testid="versao-nuvem" titulo="Versão salva na nuvem" em={conflito.servidor.em} conteudo={conflito.servidor.conteudo} />
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Botao variacao="secundario" aoTocar={() => aoEscolher('local')} className="flex-1">Usar deste aparelho</Botao>
        <Botao variacao="secundario" aoTocar={() => aoEscolher('servidor')} className="flex-1">Usar da nuvem</Botao>
      </div>
    </div>
  )
}
