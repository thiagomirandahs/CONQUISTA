import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { hojeLocalISO } from '../lib/data.js'
import { baixarCSV } from '../lib/csv.js'
import Avatar from '../components/Avatar.jsx'
import { Cabecalho, Card, Carregando, Vazio, Selo, Botao, Selecao, Campo, Folha, Abas } from '../ui/index.jsx'
import { useAvisos } from '../ui/avisos.jsx'

const FINANCEIRO = ['tesoureiro', 'diretoria']
const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const abrevs = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const agora = new Date()

export default function Mensalidades() {
  const { profile } = useAuth()
  const { papel: meuPapel } = useClube()
  const { sucesso, erro: avisarErro, confirmar } = useAvisos()
  const podeVer = FINANCEIRO.includes(meuPapel)
  const [desbravadores, setDesbravadores] = useState([])
  const [pagamentos, setPagamentos] = useState({})
  const [mes, setMes] = useState(agora.getMonth() + 1)
  const [ano, setAno] = useState(agora.getFullYear())
  const [valor, setValor] = useState(30)
  const [carregando, setCarregando] = useState(true)
  const [aba, setAba] = useState('mes') // mes | ano
  const [anual, setAnual] = useState({}) // { desbravador_id: { mes: status } }
  const [carregandoAnual, setCarregandoAnual] = useState(false)

  // Carrega os pagamentos do MÊS (com flag 'vivo' pra resposta atrasada não sobrescrever)
  useEffect(() => {
    if (!podeVer) { setCarregando(false); return }
    let vivo = true
    setCarregando(true)
    ;(async () => {
      const { data: ds } = await supabase.from('profiles').select('id,nome,foto,papel')
        .eq('status', 'ativo').in('papel', ['desbravador', 'conselheiro']).order('nome')
      const { data: ms } = await supabase.from('mensalidades').select('desbravador_id,status,valor').eq('mes', mes).eq('ano', ano)
      if (!vivo) return
      setDesbravadores(ds || [])
      const map = {}
      ;(ms || []).forEach((m) => { map[m.desbravador_id] = m })
      setPagamentos(map)
      setCarregando(false)
    })()
    return () => { vivo = false }
  }, [mes, ano, podeVer]) // eslint-disable-line

  // Carrega o ANO inteiro quando a aba "Ano" abre
  useEffect(() => {
    if (!podeVer || aba !== 'ano') return
    let vivo = true
    setCarregandoAnual(true)
    ;(async () => {
      // Uma linha por PESSOA com os doze meses dentro, em vez de N x 12 linhas soltas.
      // Medido na fase 8.2: com 110 membros a consulta antiga pedia 1.320 linhas e o PostgREST
      // devolvia 1.000 com HTTP 200 — sem erro, sem aviso. A tela mostrava 320 pagamentos como
      // NAO PAGOS. Erro de dinheiro, silencioso, na tela que justifica a mensalidade do produto.
      const { data } = await supabase.rpc('mensalidades_ano', { p_ano: ano })
      if (!vivo) return
      const map = {}
      ;(data || []).forEach((r) => { map[r.desbravador_id] = r.meses || {} })
      setAnual(map)
      setCarregandoAnual(false)
    })()
    return () => { vivo = false }
  }, [aba, ano, podeVer])

  async function recarregarMes() {
    const { data: ms } = await supabase.from('mensalidades').select('desbravador_id,status,valor').eq('mes', mes).eq('ano', ano)
    const map = {}
    ;(ms || []).forEach((m) => { map[m.desbravador_id] = m })
    setPagamentos(map)
  }

  async function alternar(d) {
    const pago = pagamentos[d.id]?.status === 'pago'
    const primeiroNome = (d.nome || 'esta pessoa').split(' ')[0]
    if (pago) {
      // desmarcar perde a data registrada: é decisão, não aviso — vai para o modal do design system
      const ok = await confirmar({
        titulo: `Desmarcar o pagamento de ${primeiroNome}?`,
        descricao: `A data em que ${primeiroNome} pagou ${meses[mes - 1]} será apagada. Isso não pode ser desfeito.`,
        rotulo: 'Desmarcar o pagamento',
      })
      if (!ok) return
    }
    const novo = pago ? 'pendente' : 'pago'
    setPagamentos((p) => ({ ...p, [d.id]: { status: novo, valor } }))
    const { error } = await supabase.from('mensalidades').upsert({
      desbravador_id: d.id, mes, ano, valor: Number(valor) || 0, status: novo,
      data_pagamento: novo === 'pago' ? hojeLocalISO() : null,
      registrado_por: profile?.id,
    // o `club_id` não vai no corpo: o gatilho carimba o clube da aba ANTES da checagem de conflito,
    // então o alvo casa com a linha deste clube — e nunca com a do outro clube da mesma pessoa
    }, { onConflict: 'club_id,desbravador_id,mes,ano' })
    if (error) { avisarErro(error); recarregarMes(); return }
    sucesso(novo === 'pago' ? `${primeiroNome} pagou ${meses[mes - 1]}.` : `${primeiroNome} voltou para pendente.`)
  }

  if (!podeVer) {
    return <Vazio icone="🔒" titulo="Área do tesoureiro e da diretoria">Aqui se controlam as mensalidades do clube.</Vazio>
  }

  const qtdPagos = desbravadores.filter((d) => pagamentos[d.id]?.status === 'pago').length
  const total = desbravadores.reduce((s, d) => s + (pagamentos[d.id]?.status === 'pago' ? Number(pagamentos[d.id]?.valor) || 0 : 0), 0)
  const anos = [agora.getFullYear() - 1, agora.getFullYear(), agora.getFullYear() + 1]

  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone="💰" titulo="Mensalidades" descricao="Pagamentos dos desbravadores e conselheiros" />

      <Abas rotulo="Ver por" ativa={aba} aoTrocar={setAba}
        abas={[{ chave: 'mes', icone: '📅', rotulo: 'Por mês' }, { chave: 'ano', icone: '🗓️', rotulo: 'Ano inteiro' }]} />

      {aba === 'ano' ? (
        <AnualView desbravadores={desbravadores} anual={anual} carregando={carregandoAnual} ano={ano} setAno={setAno} anos={anos} />
      ) : (
        <>
          <Card className="mb-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3">
              <Selecao id="m-mes" rotulo="Mês" value={mes} onChange={(e) => setMes(Number(e.target.value))}
                opcoes={meses.map((m, i) => [i + 1, m])} />
              <Selecao id="m-ano" rotulo="Ano" value={ano} onChange={(e) => setAno(Number(e.target.value))}
                opcoes={anos.map((a) => [a, String(a)])} />
              <Campo id="m-valor" rotulo="Valor (R$)" tipo="number" min="0" value={valor}
                onChange={(e) => setValor(e.target.value)} className="sm:col-span-1 col-span-2" />
            </div>
          </Card>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <Resumo rotulo="Pagos" valor={`${qtdPagos}/${desbravadores.length}`} cor="text-emerald-600" />
            <Resumo rotulo="Pendentes" valor={desbravadores.length - qtdPagos} cor="text-amber-600" />
            <Resumo rotulo="Arrecadado" valor={`R$ ${total}`} cor="text-brand" />
          </div>

          {carregando ? <Carregando linhas={3} texto="Carregando as mensalidades" />
            : desbravadores.length === 0 ? <Vazio icone="👥" titulo="Ninguém cadastrado ainda">Quando houver desbravadores e conselheiros no clube, eles aparecem aqui.</Vazio>
            : (
              <ul className="bg-surface rounded-2xl shadow-soft divide-y divide-line">
                {desbravadores.map((d) => {
                  const pago = pagamentos[d.id]?.status === 'pago'
                  return (
                    <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                      <Avatar foto={d.foto} nome={d.nome} size="w-10 h-10" textSize="text-sm" />
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-ink truncate">{d.nome}</span>
                        {d.papel === 'conselheiro' && <span className="block text-xs text-brand font-semibold">Conselheiro</span>}
                      </span>
                      <button type="button" onClick={() => alternar(d)}
                        aria-label={`${d.nome}: ${pago ? 'pago, tocar para desmarcar' : 'pendente, tocar para marcar como pago'}`}
                        className={`shrink-0 text-sm font-bold rounded-xl px-3.5 min-h-[44px] transition-colors ${
                          pago ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}`}>
                        {pago ? '✅ Pago' : '⏳ Pendente'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ano inteiro. Antes era UMA tabela de 12 colunas com scroll horizontal, nome truncado em 110px e
// texto a 12px — ilegível no celular e a única tabela larga do app.
// Agora: no celular, uma linha por pessoa com a fita dos 12 meses (toque abre o detalhe do ano);
// no PC (lg:), a tabela continua, porque ali ela é mesmo a forma mais eficiente de comparar.
// Nada foi removido: filtro de ano, CSV, estados e contagem seguem iguais.
// ---------------------------------------------------------------------------
function AnualView({ desbravadores, anual, carregando, ano, setAno, anos }) {
  const [aberto, setAberto] = useState(null)

  function baixar() {
    const cab = ['Membro', ...meses, 'Meses pagos']
    const linhas = desbravadores.map((d) => {
      const linha = anual[d.id] || {}
      const cols = meses.map((_, i) => (linha[i + 1] === 'pago' ? 'Pago' : ''))
      return [d.nome || '', ...cols, cols.filter((c) => c === 'Pago').length]
    })
    baixarCSV(`mensalidades-${ano}.csv`, cab, linhas)
  }

  if (carregando) return <Carregando linhas={4} texto="Carregando o ano inteiro" />

  return (
    <div>
      <div className="flex items-end justify-between gap-2 mb-3">
        <div className="w-36">
          <Selecao id="a-ano" rotulo="Ano" value={ano} onChange={(e) => setAno(Number(e.target.value))}
            opcoes={anos.map((a) => [a, String(a)])} />
        </div>
        {desbravadores.length > 0 && (
          <Botao variacao="secundario" aoTocar={baixar} className="mb-3">📥 Baixar CSV</Botao>
        )}
      </div>

      {desbravadores.length === 0 ? (
        <Vazio icone="👥" titulo="Ninguém cadastrado ainda">Quando houver membros no clube, o ano deles aparece aqui.</Vazio>
      ) : (
        <>
          {/* ---------- celular: uma pessoa por linha, detalhe sob demanda ---------- */}
          <ul className="lg:hidden bg-surface rounded-2xl shadow-soft divide-y divide-line">
            {desbravadores.map((d) => {
              const linha = anual[d.id] || {}
              const pagos = Object.values(linha).filter((s) => s === 'pago').length
              return (
                <li key={d.id}>
                  <button type="button" onClick={() => setAberto(d)}
                    className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-surface2"
                    aria-label={`${d.nome}: ${pagos} de 12 meses pagos em ${ano}. Tocar para ver mês a mês.`}>
                    <div className="flex items-center gap-2">
                      <span className="flex-1 min-w-0 font-semibold text-ink truncate">{d.nome}</span>
                      <Selo tom={pagos === 12 ? 'ok' : pagos === 0 ? 'atencao' : 'info'}>{pagos}/12</Selo>
                      <span className="text-faint shrink-0" aria-hidden="true">›</span>
                    </div>
                    <div className="flex gap-1 mt-2" aria-hidden="true">
                      {meses.map((_, i) => (
                        <span key={i} title={meses[i]}
                          className={`h-2.5 flex-1 rounded-full ${linha[i + 1] === 'pago' ? 'bg-emerald-500' : 'bg-surface2'}`} />
                      ))}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="lg:hidden text-xs text-faint mt-2 px-1">
            Cada barrinha é um mês do ano. Toque em alguém para ver mês a mês.
          </p>

          {/* ---------- PC: a tabela continua, que aqui é mesmo a forma mais eficiente ---------- */}
          <div className="hidden lg:block bg-surface rounded-2xl shadow-soft p-3">
            <table className="text-sm w-full border-collapse">
              <caption className="sr-only">Mensalidades de {ano}, mês a mês, por membro</caption>
              <thead>
                <tr className="text-muted">
                  <th scope="col" className="text-left font-semibold px-2 py-2">Membro</th>
                  {meses.map((m, i) => <th key={i} scope="col" className="px-1 py-2 font-semibold"><abbr title={m}>{abrevs[i]}</abbr></th>)}
                  <th scope="col" className="px-2 py-2 font-semibold">Pagos</th>
                </tr>
              </thead>
              <tbody>
                {desbravadores.map((d) => {
                  const linha = anual[d.id] || {}
                  const pagos = Object.values(linha).filter((s) => s === 'pago').length
                  return (
                    <tr key={d.id} className="border-t border-line">
                      <th scope="row" className="text-left px-2 py-2 font-medium text-ink">{d.nome}</th>
                      {meses.map((_, i) => (
                        <td key={i} className="px-1 py-2 text-center">
                          {linha[i + 1] === 'pago'
                            ? <span title={`${meses[i]}: pago`}>✅</span>
                            : <span className="text-faint" title={`${meses[i]}: em aberto`}>·</span>}
                        </td>
                      ))}
                      <td className="px-2 py-2 text-center font-bold text-brand">{pagos}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="text-xs text-faint mt-2 px-1">✅ pago · <span className="text-faint">·</span> em aberto</p>
          </div>
        </>
      )}

      <Folha aberta={!!aberto} aoFechar={() => setAberto(null)} titulo={aberto?.nome || ''}>
        {aberto && (
          <>
            <p className="text-sm text-muted mb-3">Mensalidades de {ano}</p>
            <ul className="divide-y divide-line">
              {meses.map((m, i) => {
                const pago = (anual[aberto.id] || {})[i + 1] === 'pago'
                return (
                  <li key={i} className="flex items-center justify-between gap-3 py-3">
                    <span className="text-sm font-semibold text-ink">{m}</span>
                    <Selo tom={pago ? 'ok' : 'atencao'}>{pago ? '✅ Pago' : '⏳ Em aberto'}</Selo>
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-faint mt-3">
              Para marcar ou desmarcar um pagamento, use a aba <strong>Por mês</strong>.
            </p>
          </>
        )}
      </Folha>
    </div>
  )
}

function Resumo({ rotulo, valor, cor }) {
  return (
    <div className="bg-surface rounded-xl p-3 text-center shadow-soft">
      <div className={`font-extrabold ${cor}`}>{valor}</div>
      <div className="text-xs text-faint">{rotulo}</div>
    </div>
  )
}
