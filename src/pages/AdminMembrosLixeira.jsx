import { useState, useEffect, useCallback } from 'react'
import { Card, Botao, Aviso, Selo, Carregando, Campo } from '../ui/index.jsx'
import { limiteMembros, limiteMembrosDefinir, lixeiraListar, lixeiraRecuperar } from '../services/adminMembros.js'
import { avisar } from '../ui/avisos.jsx'

// /admin › detalhe do clube: LIMITE DE MEMBROS (migration 220). A lixeira de membros inativos
// (migration 221) foi desligada de vez na migration 310 (decisão do dono, 26/09: inativo não se
// apaga, fica no clube com o histórico). Sobrou só "recuperar" algum pacote antigo, que aparece
// apenas se existir.
const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const ROTULO_MOTIVO = {
  vinculo_suspenso: 'vínculo suspenso', vinculo_encerrado: 'saiu do clube', vinculo_vencido: 'vínculo vencido', sem_login: 'sem entrar no app',
}

function useCarga(fn) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const recarregar = useCallback(() => {
    fn().then((d) => { setErro(''); setDados(d) }).catch((e) => setErro(e?.message || String(e)))
  }, [fn])
  useEffect(() => { recarregar() }, [recarregar])
  return { dados, erro, recarregar }
}

// ------------------------------------------------------------------ limite de membros
export function LimiteMembrosClube({ clubId, onFeito }) {
  const buscar = useCallback(() => limiteMembros(clubId), [clubId])
  const { dados: d, erro, recarregar } = useCarga(buscar)
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function salvar(limite) {
    if (limite !== null && !(Number(limite) >= 1)) { avisar.erro(new Error('Informe um limite de pelo menos 1 membro.')); return }
    setOcupado(true)
    try {
      const r = await limiteMembrosDefinir(clubId, limite === null ? null : Number(limite), motivo.trim() || null)
      avisar.sucesso(limite === null ? 'O clube voltou ao limite do plano.' : `Limite ajustado para ${r.limite_efetivo} membros.`)
      if (r.abaixo_do_uso) avisar.info('O limite ficou abaixo do uso atual: ninguém é removido, só novas entradas ficam barradas.')
      setValor(''); setMotivo('')
      recarregar(); onFeito?.()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  if (erro) return <Aviso tom="erro" titulo="Limite de membros">{erro}</Aviso>
  if (!d) return <Carregando />
  const cheio = d.limite_efetivo != null && d.uso >= d.limite_efetivo
  return (
    <Card data-testid="admin-limite-membros">
      <p className="font-bold text-ink text-sm mb-2">Limite de membros</p>
      <p className="text-2xl font-extrabold text-ink" data-testid="limite-uso">
        {d.uso} <span className="text-base font-semibold text-muted">de {d.limite_efetivo ?? 'sem limite'}</span>
      </p>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {cheio && <Selo tom="perigo">Limite atingido — novas entradas barradas</Selo>}
        {d.ajuste ? <Selo tom="atencao">Ajustado pelo admin</Selo> : <Selo tom="neutro">Teto do plano</Selo>}
      </div>
      <p className="text-sm text-muted mt-2">
        Plano: {d.limite_plano ?? 'sem limite'}
        {d.ajuste && <> · ajuste: <strong>{d.ajuste.valor}</strong> desde {data(d.ajuste.definido_em)}{d.ajuste.motivo ? ` (${d.ajuste.motivo})` : ''}</>}
      </p>
      <p className="text-xs text-faint mt-1">{d.regra}</p>
      <div className="grid gap-2 mt-3 sm:grid-cols-2">
        <Campo id="limite-valor" rotulo="Novo limite só deste clube" tipo="number" inputMode="numeric" min={1} max={100000}
          value={valor} onChange={(e) => setValor(e.target.value)} />
        <Campo id="limite-motivo" rotulo="Motivo (vai para a auditoria)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
      </div>
      <div className="grid gap-2 mt-2 sm:grid-cols-2">
        <Botao aoTocar={() => salvar(valor)} carregando={ocupado} desabilitado={!valor || !motivo.trim()} data-testid="limite-salvar">Salvar ajuste</Botao>
        {d.ajuste && <Botao variacao="secundario" aoTocar={() => salvar(null)} desabilitado={ocupado} data-testid="limite-remover">Voltar ao limite do plano</Botao>}
      </div>
      <p className="text-xs text-faint mt-2">Vale só para este clube; a versão do plano não muda para os outros. Ninguém é removido se o limite ficar abaixo do uso.</p>
    </Card>
  )
}

// ------------------------------------------------------------------ pacotes antigos (só recuperar)
// Não há mais lixeira: nada novo entra aqui. Se ainda existir algum pacote guardado de antes do
// desligamento, o admin pode devolvê-lo ao clube. Sem pacote, não aparece nada.
export function PacotesGuardados({ clubId }) {
  const buscar = useCallback(() => lixeiraListar(clubId), [clubId])
  const { dados: d, recarregar } = useCarga(buscar)
  const [ocupado, setOcupado] = useState('')

  async function recuperar(p) {
    if (!(await avisar.confirmar({ titulo: `Recuperar ${p.nome || 'esta pessoa'}?`, descricao: 'Os dados voltam e o vínculo volta INATIVO (a diretoria reativa se quiser).', rotulo: 'Recuperar' }))) return
    setOcupado(p.id)
    try {
      const r = await lixeiraRecuperar(p.id, 'recuperado pelo admin')
      avisar.sucesso(`Recuperado: ${r.restauradas} registro(s).`)
      recarregar()
    } catch (e) { avisar.erro(e) }
    setOcupado('')
  }

  const guardados = (d?.pacotes || []).filter((p) => p.status === 'na_lixeira')
  if (guardados.length === 0) return null
  return (
    <Card data-testid="admin-pacotes-guardados">
      <p className="font-bold text-ink text-sm">Membros guardados de antes ({guardados.length})</p>
      <p className="text-xs text-muted mt-1">A lixeira de membros foi desligada: ninguém mais sai do clube por inatividade. Devolva estes ao clube.</p>
      <ul className="divide-y divide-line text-sm mt-2">
        {guardados.map((p) => (
          <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{p.nome || 'Sem nome'}</p>
              <p className="text-xs text-muted">{ROTULO_MOTIVO[p.motivo] || p.motivo} desde {data(p.inativo_desde)}</p>
            </div>
            <Botao aoTocar={() => recuperar(p)} carregando={ocupado === p.id} desabilitado={!!ocupado} data-testid={`recuperar-${p.id}`}>Recuperar</Botao>
          </li>
        ))}
      </ul>
    </Card>
  )
}

