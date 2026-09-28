import { useState, useEffect, useCallback } from 'react'
import { Card, Botao, Aviso } from '../ui/index.jsx'
import { planosRecursosListar, planoRecursoDefinir } from '../services/planosRecursos.js'
import { avisar } from '../ui/avisos.jsx'
import { Chip, Esqueleto, EstadoVazio, Nota } from '../components/admin/AdminUI.jsx'

// /admin › Painéis do plano (migration 410). Para cada plano, liga/desliga os recursos que os clubes
// daquele plano podem usar. O servidor aplica e audita; tirar um recurso do plano NÃO apaga nada:
// o painel só fica inacessível para os clubes do plano e volta inteiro quando o recurso é incluído.
export default function AdminPaineisPlano() {
  const [planos, setPlanos] = useState(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null)
  const recarregar = useCallback(() => {
    planosRecursosListar()
      .then((p) => { setErro(''); setPlanos(p) })
      .catch((e) => setErro(e?.message || String(e)))
  }, [])
  useEffect(() => { recarregar() }, [recarregar])

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (planos == null) return <Esqueleto avatar={false} />
  if (planos.length === 0) return <EstadoVazio icone="🧩" titulo="Nenhum plano no catálogo" />

  const plano = planos.find((p) => p.id === aberto)
  return (
    <div className="space-y-3" data-testid="admin-paineis-plano">
      <Nota icone="🧩">
        <strong className="text-ink">Escolha o que cada plano libera.</strong>{' '}
        Tirar um painel do plano <strong>não apaga nada</strong>: ele só fica fechado para os clubes desse plano.
        Incluir de novo devolve tudo como estava. Tudo fica na auditoria.
      </Nota>
      {plano
        ? <PlanoRecursos plano={plano} aoVoltar={() => setAberto(null)} onFeito={recarregar} />
        : (
          <ul className="grid gap-2 md:grid-cols-2">
            {planos.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setAberto(p.id)} data-testid="plano-paineis"
                  className="w-full min-h-[44px] rounded-2xl border border-line bg-surface p-4 text-left">
                  <p className="font-bold text-ink leading-tight">{p.nome}</p>
                  <p className="text-xs text-faint">{p.chave} · v{p.versao} · {p.clubes} clube(s)</p>
                  <p className="mt-1 text-xs text-muted">
                    {p.todos ? 'Todos os painéis' : `${(p.recursos || []).filter((r) => r.incluido).length} de ${(p.recursos || []).length} painéis`}
                    {!p.ativo || p.status !== 'publicado' ? ` · ${p.status}` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

function PlanoRecursos({ plano, aoVoltar, onFeito }) {
  const [ocupado, setOcupado] = useState(null)
  const [confirmacao, setConfirmacao] = useState(null) // { recurso, nome, impacto }

  async function alternar(r, confirmar = false) {
    setOcupado(r.chave)
    try {
      const res = await planoRecursoDefinir(plano.id, r.chave, !r.incluido, confirmar)
      if (res?.precisa_confirmar) { setConfirmacao({ recurso: r, impacto: res.impacto }); setOcupado(null); return }
      setConfirmacao(null)
      avisar.sucesso(r.incluido ? `"${r.nome}" saiu do plano. Nada foi apagado.` : `"${r.nome}" entrou no plano.`)
      onFeito?.()
    } catch (e) { avisar.erro(e) }
    setOcupado(null)
  }

  return (
    <div className="space-y-3">
      <Botao variacao="secundario" aoTocar={aoVoltar}>← Voltar aos planos</Botao>
      <Card>
        <p className="font-bold text-ink">{plano.nome} <span className="text-xs font-medium text-faint">v{plano.versao}</span></p>
        <p className="text-xs text-muted">{plano.clubes} clube(s) neste plano sentem a mudança na hora.</p>
      </Card>

      {confirmacao && (
        <Aviso tom="erro" titulo={`Tirar "${confirmacao.recurso.nome}" do plano?`}>
          <p data-testid="impacto-remocao">
            {confirmacao.impacto.clubes_no_plano} clube(s) estão neste plano
            {' '}({confirmacao.impacto.clubes_usando} usando esse painel agora). Eles deixam de ver e usar o painel.
            Nenhum dado é apagado: incluir de novo devolve tudo.
          </p>
          {(confirmacao.impacto.clubes || []).length > 0 && (
            <p className="mt-1 text-xs">{confirmacao.impacto.clubes.join(', ')}{confirmacao.impacto.clubes_no_plano > confirmacao.impacto.clubes.length ? '…' : ''}</p>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Botao variacao="perigo" aoTocar={() => alternar(confirmacao.recurso, true)} carregando={ocupado === confirmacao.recurso.chave}>
              Confirmar e tirar do plano
            </Botao>
            <Botao variacao="secundario" aoTocar={() => setConfirmacao(null)}>Cancelar</Botao>
          </div>
        </Aviso>
      )}

      <ul className="space-y-2">
        {(plano.recursos || []).map((r) => (
          <li key={r.chave} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
            <span aria-hidden="true" className="text-xl">{r.icone}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink leading-tight">{r.nome}</p>
              {r.descricao && <p className="text-xs text-muted">{r.descricao}</p>}
              {r.somente_plataforma && <Chip tom="atencao" className="mt-1">Liberado pela plataforma, clube a clube</Chip>}
            </div>
            <button type="button" role="switch" aria-checked={!!r.incluido} aria-label={`${r.nome} no plano ${plano.nome}`}
              disabled={!!ocupado} onClick={() => alternar(r)} data-testid={`switch-${r.chave}`}
              className={`relative h-11 w-16 shrink-0 rounded-full border transition-colors disabled:opacity-60 ${r.incluido ? 'bg-brand border-brand' : 'bg-bg border-line'}`}>
              <span aria-hidden="true" className={`absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-white shadow transition-all ${r.incluido ? 'left-[26px]' : 'left-1'}`} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
