import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'

const FINANCEIRO = ['tesoureiro', 'diretoria']
const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const agora = new Date()

export default function Mensalidades() {
  const { profile } = useAuth()
  const podeVer = FINANCEIRO.includes(profile?.papel)
  const [desbravadores, setDesbravadores] = useState([])
  const [pagamentos, setPagamentos] = useState({})
  const [mes, setMes] = useState(agora.getMonth() + 1)
  const [ano, setAno] = useState(agora.getFullYear())
  const [valor, setValor] = useState(20)
  const [carregando, setCarregando] = useState(true)

  async function carregar() {
    setCarregando(true)
    const { data: ds } = await supabase.from('profiles').select('id,nome,foto,papel').eq('status', 'ativo').in('papel', ['desbravador', 'conselheiro']).order('nome')
    setDesbravadores(ds || [])
    const { data: ms } = await supabase.from('mensalidades').select('desbravador_id,status,valor').eq('mes', mes).eq('ano', ano)
    const map = {}
    ;(ms || []).forEach((m) => { map[m.desbravador_id] = m })
    setPagamentos(map)
    setCarregando(false)
  }
  useEffect(() => { if (podeVer) carregar(); else setCarregando(false) }, [mes, ano, podeVer]) // eslint-disable-line

  async function alternar(d) {
    const pago = pagamentos[d.id]?.status === 'pago'
    const novo = pago ? 'pendente' : 'pago'
    setPagamentos((p) => ({ ...p, [d.id]: { status: novo, valor } }))
    const { error } = await supabase.from('mensalidades').upsert({
      desbravador_id: d.id, mes, ano, valor: Number(valor) || 0, status: novo,
      data_pagamento: novo === 'pago' ? new Date().toISOString().slice(0, 10) : null,
      registrado_por: profile?.id,
    }, { onConflict: 'desbravador_id,mes,ano' })
    if (error) { alert('Erro: ' + error.message); carregar() }
  }

  if (!podeVer) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área do tesoureiro e diretoria</p>
        <p className="text-sm text-slate-400">Aqui se controlam as mensalidades.</p>
      </div>
    )
  }

  const qtdPagos = desbravadores.filter((d) => pagamentos[d.id]?.status === 'pago').length
  const total = desbravadores.reduce((s, d) => s + (pagamentos[d.id]?.status === 'pago' ? Number(pagamentos[d.id]?.valor) || 0 : 0), 0)
  const anos = [agora.getFullYear() - 1, agora.getFullYear(), agora.getFullYear() + 1]

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">💰 Mensalidades</h2>
        <p className="text-sm text-slate-500">Controle de pagamentos (desbravadores e conselheiros)</p>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4 grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Mês</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
            {meses.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Ano</label>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Valor (R$)</label>
          <input type="number" min="0" value={valor} onChange={(e) => setValor(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <Resumo rotulo="Pagos" valor={`${qtdPagos}/${desbravadores.length}`} cor="text-green-600" />
        <Resumo rotulo="Pendentes" valor={desbravadores.length - qtdPagos} cor="text-amber-600" />
        <Resumo rotulo="Arrecadado" valor={`R$ ${total}`} cor="text-azul" />
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : desbravadores.length === 0 ? (
        <p className="text-slate-400 text-sm">Ninguém cadastrado ainda.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
          {desbravadores.map((d) => {
            const pago = pagamentos[d.id]?.status === 'pago'
            return (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar foto={d.foto} nome={d.nome} size="w-9 h-9" textSize="text-sm" />
                <span className="flex-1 min-w-0 font-medium text-slate-800 truncate">
                  {d.nome}
                  {d.papel === 'conselheiro' && <span className="ml-2 text-[10px] bg-azul/10 text-azul rounded-full px-2 py-0.5 align-middle">Conselheiro</span>}
                </span>
                <button onClick={() => alternar(d)}
                  className={`text-xs font-bold rounded-lg px-3 py-1.5 transition-colors ${pago ? 'bg-green-500 text-white' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                  {pago ? '✅ Pago' : '⏳ Pendente'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Resumo({ rotulo, valor, cor }) {
  return (
    <div className="bg-white rounded-xl p-3 text-center shadow-sm">
      <div className={`font-extrabold ${cor}`}>{valor}</div>
      <div className="text-[10px] text-slate-400">{rotulo}</div>
    </div>
  )
}
