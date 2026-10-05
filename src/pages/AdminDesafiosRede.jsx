import { useCallback, useEffect, useState } from 'react'
import { adminDesafios, adminSalvarDesafio, adminArmazenamento } from '../services/rede.js'
import { tamanhoLegivel } from '../lib/imagem.js'
import { avisar } from '../ui/avisos.jsx'
import { hojeLocalISO, hojeMaisDiasLocalISO, dataLocalISO } from '../lib/data.js'
import { Botao, Campo, Card, Carregando, Selo } from '../ui/index.jsx'

// Admin da PLATAFORMA → Comunidade → Desafios da Rede DBV (migration 471): cadastro simples
// (título, descrição, pontos, início, fim, ativo). Só a plataforma cria; o servidor audita.
// Também mostra quanto a limpeza de fotos (migration 472) já liberou.
const hoje = () => hojeLocalISO()
const emDias = (n) => hojeMaisDiasLocalISO(n)
const VAZIO = { id: null, titulo: '', descricao: '', pontos: 10, inicio: hoje(), fim: emDias(7), ativo: true }
// início às 00:00 e fim às 23:59 no horário de Brasília
const inicioDoDia = (d) => `${d}T00:00:00-03:00`
const fimDoDia = (d) => `${d}T23:59:59-03:00`

export default function AdminDesafiosRede() {
  const [lista, setLista] = useState(null)
  const [arm, setArm] = useState(null)
  const [form, setForm] = useState(VAZIO)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    try { setLista(await adminDesafios()) } catch (e) { avisar.erro(e, 'Não consegui abrir os desafios.'); setLista([]) }
    adminArmazenamento().then(setArm).catch(() => {})
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function salvar(e) {
    e.preventDefault()
    if (!form.titulo.trim()) return
    setSalvando(true)
    try {
      setLista(await adminSalvarDesafio({ ...form, titulo: form.titulo.trim(), inicio: inicioDoDia(form.inicio), fim: fimDoDia(form.fim) }))
      setForm(VAZIO); avisar.sucesso('Desafio salvo.')
    } catch (err) { avisar.erro(err, 'Não consegui salvar o desafio.') }
    setSalvando(false)
  }
  const editar = (d) => setForm({ id: d.id, titulo: d.titulo, descricao: d.descricao || '', pontos: d.pontos,
    inicio: dataLocalISO(d.inicio), fim: dataLocalISO(d.fim), ativo: d.ativo })

  return (
    <Card>
      <h3 className="font-extrabold text-ink mb-1">Desafios da Rede DBV</h3>
      <p className="text-xs text-muted mb-3">O desafio aberto que começou por último vira o "Desafio da semana". Os pontos valem só na rede (não entram no ranking do clube).</p>
      <form onSubmit={salvar} className="grid gap-2 sm:grid-cols-2" aria-label="Cadastro de desafio">
        <Campo id="des-titulo" rotulo="Título" value={form.titulo} maxLength={80} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
        <Campo id="des-pontos" rotulo="Pontos" tipo="number" min={0} max={1000} value={form.pontos} onChange={(e) => setForm({ ...form, pontos: e.target.value })} />
        <div className="sm:col-span-2"><Campo id="des-descricao" rotulo="Descrição" linhas={2} maxLength={500} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
        <Campo id="des-inicio" rotulo="Início" tipo="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} />
        <Campo id="des-fim" rotulo="Fim" tipo="date" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} />
        <label className="flex items-center gap-2 min-h-[44px] text-sm font-bold text-ink">
          <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="w-5 h-5" /> Ativo
        </label>
        <div className="flex gap-2 sm:justify-end">
          {form.id && <Botao variacao="secundario" aoTocar={() => setForm(VAZIO)}>Cancelar</Botao>}
          <Botao tipo="submit" carregando={salvando} desabilitado={!form.titulo.trim()}>{form.id ? 'Salvar alterações' : 'Criar desafio'}</Botao>
        </div>
      </form>
      {lista === null ? <Carregando linhas={2} /> : (
        <ul className="divide-y divide-line mt-3">
          {lista.map((d) => (
            <li key={d.id} className="py-2 flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-ink truncate">{d.titulo}</p>
                <p className="text-xs text-muted">+{d.pontos} pts · {new Date(d.inicio).toLocaleDateString('pt-BR')} a {new Date(d.fim).toLocaleDateString('pt-BR')} · {d.participantes} participações</p>
              </div>
              {!d.ativo && <Selo>inativo</Selo>}
              <Botao variacao="discreto" aoTocar={() => editar(d)}>Editar</Botao>
            </li>
          ))}
          {lista.length === 0 && <li className="py-2 text-sm text-faint">Nenhum desafio ainda.</li>}
        </ul>
      )}
      {arm && (
        <p className="text-xs text-muted mt-3 border-t border-line pt-2">
          Fotos da rede: {arm.pendentes} na fila para apagar · já liberados {arm.liberados_arquivos} arquivos ({tamanhoLegivel(arm.liberados_bytes)})
          {arm.ultima ? ` · última limpeza ${new Date(arm.ultima).toLocaleDateString('pt-BR')}` : ' · a limpeza ainda não rodou'}
        </p>
      )}
    </Card>
  )
}
