import { useState, useEffect, useCallback } from 'react'
import { Card, Botao, Aviso, Selo, Carregando, Campo } from '../ui/index.jsx'
import {
  clubeExcluir, clubeRecuperar, clubeExpurgarAgora, clubesExcluidosListar, exclusaoConfigDefinir,
} from '../services/adminExclusaoClube.js'
import { avisar } from '../ui/avisos.jsx'

// /admin: exclusão de clube em duas fases (migration 280).
//  - ZonaDePerigoClube: fim do detalhe do clube. Excluir = ARQUIVAR (nada é apagado ainda).
//  - LixeiraDeClubes: aba do /admin com os excluídos, RECUPERAR e "Apagar definitivamente agora".
// O servidor confere tudo de novo (admin, nome, motivo, APAGAR, fundador); aqui é a confirmação forte.
const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const ROTULO = { excluido: 'Na lixeira', recuperado: 'Recuperado', expurgado: 'Apagado de vez' }
const TOM = { excluido: 'atencao', recuperado: 'ok', expurgado: 'neutro' }
export const MOTIVO_MINIMO = 5

export const nomeConfere = (digitado, nome) =>
  (digitado || '').trim().toLocaleLowerCase('pt-BR') === (nome || '').trim().toLocaleLowerCase('pt-BR') && !!(nome || '').trim()

// ------------------------------------------------------------------ zona de perigo
export function ZonaDePerigoClube({ clube, aoExcluir }) {
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const fundador = !!clube?.fundador

  const pode = nomeConfere(nome, clube?.nome) && motivo.trim().length >= MOTIVO_MINIMO && !ocupado

  async function excluir() {
    if (!pode) return
    setOcupado(true)
    try {
      const r = await clubeExcluir(clube.club_id, nome.trim(), motivo.trim())
      avisar.sucesso(`"${clube.nome}" foi para a lixeira de clubes. Expurgo previsto para ${data(r?.expurgo_previsto_em)}.`)
      setAberto(false); setNome(''); setMotivo('')
      aoExcluir?.(r)
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  return (
    <section data-testid="zona-perigo" className="rounded-2xl border-2 border-rose-300 bg-rose-50/40 p-4 dark:bg-rose-950/20">
      <p className="text-sm font-extrabold text-rose-700 dark:text-rose-300">Zona de perigo</p>
      <p className="mt-1 text-sm text-muted">
        Excluir tira o clube do ar na hora: some do app, do site e da coordenação, os membros perdem o acesso,
        a assinatura é cancelada (sem cobrança e sem estorno) e convites deixam de valer. Nada é apagado
        ainda: dá para recuperar pela Lixeira de clubes até o expurgo definitivo.
      </p>
      {fundador && (
        <div className="mt-3"><Aviso tom="atencao" titulo="Clube fundador protegido">
          O Tenant 001 só pode ser excluído depois que a liberação for ligada na Lixeira de clubes. O servidor recusa sem ela.
        </Aviso></div>
      )}
      {!aberto ? (
        <div className="mt-3">
          <Botao variacao="perigo" aoTocar={() => setAberto(true)} data-testid="excluir-abrir">Excluir clube</Botao>
        </div>
      ) : (
        <div className="mt-3" data-testid="excluir-form">
          <Campo id="excluir-nome" rotulo={`Digite o nome do clube para confirmar: ${clube?.nome || ''}`}
            value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off"
            erro={nome && !nomeConfere(nome, clube?.nome) ? 'O nome não confere.' : undefined} />
          <Campo id="excluir-motivo" rotulo="Motivo da exclusão (vai para a auditoria)" linhas={2} maxLength={500}
            value={motivo} onChange={(e) => setMotivo(e.target.value)}
            ajuda={`Obrigatório (pelo menos ${MOTIVO_MINIMO} letras).`} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Botao variacao="perigo" aoTocar={excluir} carregando={ocupado} desabilitado={!pode} data-testid="excluir-confirmar">
              Excluir clube
            </Botao>
            <Botao variacao="secundario" aoTocar={() => { setAberto(false); setNome(''); setMotivo('') }} desabilitado={ocupado}>
              Cancelar
            </Botao>
          </div>
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------------------ lixeira de clubes
export function LixeiraDeClubes() {
  const [d, setD] = useState(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [apagando, setApagando] = useState(null)
  const [palavra, setPalavra] = useState('')
  const [dias, setDias] = useState('')
  const [motivoFundador, setMotivoFundador] = useState('')

  const recarregar = useCallback(() => {
    clubesExcluidosListar().then((x) => { setErro(''); setD(x) }).catch((e) => setErro(e?.message || String(e)))
  }, [])
  useEffect(() => { recarregar() }, [recarregar])

  async function acao(chave, fn, sucesso) {
    setOcupado(chave)
    try { const r = await fn(); if (sucesso) avisar.sucesso(typeof sucesso === 'function' ? sucesso(r) : sucesso); recarregar(); return r } catch (e) { avisar.erro(e) } finally { setOcupado('') }
  }
  async function recuperar(c) {
    if (!(await avisar.confirmar({ titulo: `Recuperar "${c.nome}"?`, descricao: 'O clube volta ao ar como estava: vínculos, convites, vitrine e assinatura (se o teste ou o período pago já venceu, volta como aguardando pagamento).', rotulo: 'Recuperar' }))) return
    const r = await acao(`rec-${c.id}`, () => clubeRecuperar(c.id, 'recuperado pelo admin'), (x) => `Recuperado: ${x.vinculos_restaurados} vínculo(s) de volta.`)
    for (const a of r?.avisos || []) avisar.info(a)
  }
  async function apagarAgora() {
    if (palavra !== 'APAGAR') return
    await acao(`del-${apagando.id}`, () => clubeExpurgarAgora(apagando.id, palavra), 'Clube apagado definitivamente.')
    setApagando(null); setPalavra('')
  }
  async function salvarDias() {
    const n = Number(dias)
    if (!(n >= 1 && n <= 3650)) { avisar.erro(new Error('Use de 1 a 3650 dias.')); return }
    await acao('dias', () => exclusaoConfigDefinir({ diasRetencao: n }), 'Retenção atualizada.')
    setDias('')
  }
  async function liberarFundador(ligar) {
    if (ligar && motivoFundador.trim().length < MOTIVO_MINIMO) { avisar.erro(new Error('Informe o motivo para liberar.')); return }
    await acao('fundador', () => exclusaoConfigDefinir({ permitirFundador: ligar, motivo: ligar ? motivoFundador.trim() : 'proteção religada' }),
      ligar ? 'Liberação do clube fundador LIGADA.' : 'Clube fundador protegido de novo.')
    setMotivoFundador('')
  }

  if (erro) return <Aviso tom="erro" titulo="Lixeira de clubes">{erro}</Aviso>
  if (!d) return <Carregando />
  const naLixeira = d.clubes.filter((c) => c.status === 'excluido')
  const historico = d.clubes.filter((c) => c.status !== 'excluido')

  return (
    <div className="space-y-3" data-testid="lixeira-clubes">
      <Card>
        <p className="font-bold text-ink text-sm">Lixeira de clubes</p>
        <p className="text-xs text-muted mt-1">
          Clube excluído fica aqui por <strong>{d.dias_retencao} dias</strong> e depois é apagado de vez pela rotina diária:
          todos os dados do clube, os arquivos dele e as contas de login que só existiam nele. Outros clubes nunca são tocados.
        </p>
        <div className="grid gap-2 mt-3 sm:grid-cols-2">
          <Campo id="lixeira-clubes-dias" rotulo="Dias na lixeira antes do expurgo" tipo="number" inputMode="numeric" min={1} max={3650}
            value={dias} onChange={(e) => setDias(e.target.value)} />
          <div className="self-end mb-3"><Botao variacao="secundario" aoTocar={salvarDias} desabilitado={!dias} carregando={ocupado === 'dias'}>Salvar retenção</Botao></div>
        </div>
        {!d.permitir_excluir_fundador && (
          <Campo id="lixeira-clubes-fundador-motivo" rotulo="Motivo para liberar a exclusão do clube fundador (só se for mesmo necessário)"
            value={motivoFundador} onChange={(e) => setMotivoFundador(e.target.value)} maxLength={300} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Selo tom={d.permitir_excluir_fundador ? 'perigo' : 'ok'}>
            Clube fundador: {d.permitir_excluir_fundador ? 'exclusão LIBERADA' : 'protegido'}
          </Selo>
          <Botao variacao="discreto" aoTocar={() => liberarFundador(!d.permitir_excluir_fundador)} carregando={ocupado === 'fundador'}>
            {d.permitir_excluir_fundador ? 'Proteger de novo' : 'Liberar exclusão do fundador'}
          </Botao>
        </div>
      </Card>

      {naLixeira.length === 0 && <p className="text-sm text-muted">Nenhum clube na lixeira.</p>}
      {naLixeira.map((c) => (
        <Card key={c.id} data-testid={`clube-excluido-${c.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold text-ink">{c.nome}</p>
            <Selo tom={TOM[c.status]}>{ROTULO[c.status]}</Selo>
          </div>
          <p className="text-sm text-muted mt-1">Excluído em {data(c.excluido_em)} por {c.excluido_por}</p>
          <p className="text-sm text-muted">Motivo: {c.motivo}</p>
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Expurgo previsto: {data(c.expurgo_previsto_em)}</p>
          {apagando?.id === c.id ? (
            <div className="mt-3">
              <Campo id={`apagar-${c.id}`} rotulo='Digite APAGAR para apagar definitivamente (não tem volta)'
                value={palavra} onChange={(e) => setPalavra(e.target.value)} autoComplete="off" />
              <div className="grid gap-2 sm:grid-cols-2">
                <Botao variacao="perigo" aoTocar={apagarAgora} desabilitado={palavra !== 'APAGAR'} carregando={ocupado === `del-${c.id}`} data-testid="apagar-confirmar">
                  Apagar definitivamente
                </Botao>
                <Botao variacao="secundario" aoTocar={() => { setApagando(null); setPalavra('') }}>Cancelar</Botao>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 mt-3 sm:grid-cols-2">
              <Botao aoTocar={() => recuperar(c)} carregando={ocupado === `rec-${c.id}`} data-testid={`recuperar-${c.id}`}>Recuperar</Botao>
              <Botao variacao="perigo" aoTocar={() => { setApagando(c); setPalavra('') }} data-testid={`apagar-${c.id}`}>Apagar definitivamente agora</Botao>
            </div>
          )}
        </Card>
      ))}

      {historico.length > 0 && (
        <Card>
          <p className="font-bold text-ink text-sm mb-2">Histórico</p>
          <ul className="space-y-1">
            {historico.map((c) => (
              <li key={c.id} className="text-sm text-muted">
                <Selo tom={TOM[c.status]}>{ROTULO[c.status]}</Selo> {c.nome} · excluído em {data(c.excluido_em)}
                {c.status === 'recuperado' ? ` · recuperado em ${data(c.recuperado_em)}` : ` · apagado em ${data(c.expurgado_em)}`}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
