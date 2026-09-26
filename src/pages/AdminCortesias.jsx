import { useState, useEffect, useCallback } from 'react'
import { Card, Botao, Aviso, Selo, Carregando, Vazio, Campo } from '../ui/index.jsx'
import {
  cortesiasListar, cortesiasConcedidas, cortesiaGerar, cortesiaRevogar, cortesiaApagar, cortesiaAplicar, clubesListar,
} from '../services/admin.js'
import { avisar } from '../ui/avisos.jsx'

// /admin › Cortesias — LICENÇA CORTESIA para sorteio/promoção (migration 150).
// Não é pagamento: nenhuma cobrança é criada. O clube fica "ativa" com provider 'cortesia' até o fim;
// depois o job diário (cortesias_expirar) devolve ao fluxo normal (aguardando pagamento).
const ROTULO = { ativo: 'Ativo', resgatado: 'Resgatado', revogado: 'Revogado', expirado: 'Expirado' }
const TOM = { ativo: 'ok', resgatado: 'neutro', revogado: 'perigo', expirado: 'atencao' }
const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

export default function AdminCortesias() {
  const [codigos, setCodigos] = useState(null)
  const [concedidas, setConcedidas] = useState(null)
  const [erro, setErro] = useState('')
  const recarregar = useCallback(() => {
    Promise.all([cortesiasListar(), cortesiasConcedidas()])
      .then(([c, g]) => { setErro(''); setCodigos(c); setConcedidas(g) })
      .catch((e) => setErro(e?.message || String(e)))
  }, [])
  useEffect(() => { recarregar() }, [recarregar])

  return (
    <div className="space-y-3" data-testid="admin-cortesias">
      <Aviso tom="info" titulo="Licença cortesia (sorteio / promoção)">
        O clube fica com a licença <strong>ativa, sem cobrança</strong>, até a data de fim. Quando acaba, volta
        sozinho para “aguardando pagamento” (rotina diária). Tudo fica na auditoria.
      </Aviso>
      <GerarCodigo onFeito={recarregar} />
      <AplicarEmClube onFeito={recarregar} />
      {erro ? <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
        : codigos == null ? <Carregando /> : (
          <>
            <Card>
              <p className="font-bold text-ink text-sm mb-2">Códigos</p>
              {codigos.length === 0 ? <Vazio icone="🎁" titulo="Nenhum código gerado ainda" /> : (
                <ul className="divide-y divide-line">
                  {codigos.map((c) => <LinhaCodigo key={c.id} c={c} onFeito={recarregar} />)}
                </ul>
              )}
            </Card>
            <Card>
              <p className="font-bold text-ink text-sm mb-2">Clubes com cortesia</p>
              {concedidas.length === 0 ? <p className="text-sm text-muted">Nenhuma cortesia concedida.</p> : (
                <ul className="divide-y divide-line text-sm">
                  {concedidas.map((g) => (
                    <li key={g.id} className="py-2">
                      <p className="font-semibold text-ink">{g.clube || 'Clube'}</p>
                      <p className="text-xs text-muted">
                        {g.origem === 'resgate' ? 'Código' : 'Direto pelo admin'}{g.rotulo ? ` · ${g.rotulo}` : ''} · até <strong>{data(g.fim)}</strong>
                        {g.expirada_em ? ` · encerrada em ${data(g.expirada_em)}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
    </div>
  )
}

function GerarCodigo({ onFeito }) {
  const [rotulo, setRotulo] = useState('')
  const [meses, setMeses] = useState('12')
  const [usos, setUsos] = useState('1')
  const [dias, setDias] = useState('90')
  const [ocupado, setOcupado] = useState(false)
  const [gerado, setGerado] = useState(null)

  async function gerar() {
    if (!rotulo.trim()) { avisar.erro(null, 'Dê um nome à cortesia (ex.: Sorteio outubro 2026).'); return }
    setOcupado(true)
    try {
      const r = await cortesiaGerar({ rotulo: rotulo.trim(), meses: Number(meses), usos: Number(usos), diasParaResgate: Number(dias) })
      setGerado(r); setRotulo(''); onFeito?.()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(gerado.codigo); avisar.sucesso('Código copiado.') } catch { avisar.erro(null, 'Copie o código manualmente.') }
  }

  return (
    <Card>
      <p className="font-bold text-ink text-sm mb-2">Gerar código de cortesia</p>
      {gerado && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 mb-3" data-testid="cortesia-gerada">
          <p className="text-xs text-emerald-900 mb-1">Copie agora — este código <strong>não aparece de novo</strong>.</p>
          <p className="font-mono text-lg font-bold text-emerald-950 break-all select-all" data-testid="cortesia-codigo">{gerado.codigo}</p>
          <p className="text-xs text-emerald-900 mt-1">
            {gerado.duracao_meses} mese(s) de licença · {gerado.max_usos} uso(s) · resgatar até {data(gerado.resgate_ate)}
          </p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Botao aoTocar={copiar}>Copiar</Botao>
            <Botao variacao="secundario" aoTocar={() => setGerado(null)}>Fechar</Botao>
          </div>
        </div>
      )}
      <Campo id="cortesia-rotulo" rotulo="Nome (ex.: Sorteio outubro 2026)" value={rotulo} onChange={(e) => setRotulo(e.target.value)} maxLength={160} />
      <div className="grid grid-cols-3 gap-2">
        <Campo id="cortesia-meses" rotulo="Meses" tipo="number" inputMode="numeric" min={1} max={36} value={meses} onChange={(e) => setMeses(e.target.value)} />
        <Campo id="cortesia-usos" rotulo="Usos" tipo="number" inputMode="numeric" min={1} max={500} value={usos} onChange={(e) => setUsos(e.target.value)} />
        <Campo id="cortesia-dias" rotulo="Resgatar em (dias)" tipo="number" inputMode="numeric" min={1} max={365} value={dias} onChange={(e) => setDias(e.target.value)} />
      </div>
      <Botao aoTocar={gerar} carregando={ocupado} className="w-full" data-testid="cortesia-gerar">Gerar código</Botao>
    </Card>
  )
}

function LinhaCodigo({ c, onFeito }) {
  const [ocupado, setOcupado] = useState(null)
  async function rodar(chave, fn, ok) {
    setOcupado(chave)
    try { await fn(); avisar.sucesso(ok); onFeito?.() } catch (e) { avisar.erro(e) }
    setOcupado(null)
  }
  const revogar = () => {
    if (!window.confirm(`Revogar "${c.rotulo}"? Ninguém mais consegue resgatar. Quem já resgatou continua com a cortesia.`)) return
    rodar('revogar', () => cortesiaRevogar(c.id, 'revogado no /admin'), 'Código revogado.')
  }
  const apagar = () => {
    if (!window.confirm(`Apagar "${c.rotulo}" da lista? O histórico das cortesias concedidas fica.`)) return
    rodar('apagar', () => cortesiaApagar(c.id), 'Código apagado.')
  }
  return (
    <li className="py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink text-sm truncate">{c.rotulo}</p>
          <p className="text-xs text-muted">
            DC-{c.prefixo}-… · {c.duracao_meses} mese(s) · usos {c.usos}/{c.max_usos} · resgatar até {data(c.resgate_ate)}
          </p>
          {(c.resgates || []).map((r, i) => (
            <p key={i} className="text-xs text-faint">→ {r.clube || 'clube'}: cortesia até {data(r.fim)}</p>
          ))}
        </div>
        <Selo tom={TOM[c.status]}>{ROTULO[c.status] || c.status}</Selo>
      </div>
      <div className="flex gap-2 mt-2">
        {c.status === 'ativo'
          ? <Botao variacao="perigo" aoTocar={revogar} carregando={ocupado === 'revogar'} desabilitado={!!ocupado}>Revogar</Botao>
          : <Botao variacao="secundario" aoTocar={apagar} carregando={ocupado === 'apagar'} desabilitado={!!ocupado}>Apagar</Botao>}
      </div>
    </li>
  )
}

// Ganhador que já criou o clube (em teste ou aguardando pagamento): aplica direto, sem código.
function AplicarEmClube({ onFeito }) {
  const [clubes, setClubes] = useState(null)
  const [clubId, setClubId] = useState('')
  const [meses, setMeses] = useState('12')
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { clubesListar().then(setClubes).catch(() => setClubes([])) }, [])

  async function aplicar() {
    const c = (clubes || []).find((x) => x.club_id === clubId)
    if (!c) { avisar.erro(null, 'Escolha o clube.'); return }
    if (!window.confirm(`Dar ${meses} mese(s) de licença cortesia para "${c.nome}"? Nenhuma cobrança é criada.`)) return
    setOcupado(true)
    try {
      const r = await cortesiaAplicar(clubId, Number(meses), 'ganhador de sorteio / promoção')
      avisar.sucesso(`Licença cortesia até ${data(r?.ate)}.`); setClubId(''); onFeito?.()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  return (
    <Card>
      <p className="font-bold text-ink text-sm mb-2">Aplicar cortesia a um clube que já existe</p>
      {clubes == null ? <Carregando /> : (
        <>
          <label htmlFor="cortesia-clube" className="block mb-3">
            <span className="text-xs text-muted">Clube</span>
            <select id="cortesia-clube" value={clubId} onChange={(e) => setClubId(e.target.value)}
              className="mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm text-ink">
              <option value="">Escolha…</option>
              {clubes.filter((c) => c.assinatura_status && c.assinatura_status !== 'cancelada').map((c) => (
                <option key={c.club_id} value={c.club_id}>{c.nome}</option>
              ))}
            </select>
          </label>
          <Campo id="cortesia-aplicar-meses" rotulo="Meses" tipo="number" inputMode="numeric" min={1} max={36} value={meses} onChange={(e) => setMeses(e.target.value)} />
          <Botao aoTocar={aplicar} carregando={ocupado} desabilitado={!clubId} className="w-full" data-testid="cortesia-aplicar">Aplicar cortesia</Botao>
        </>
      )}
    </Card>
  )
}
