import { useEffect, useState } from 'react'
import { carregarDesafiosGlobais, ocultarDesafioGlobal } from '../services/jogos.js'
import { Botao, Card, Carregando, Vazio } from '../ui/index.jsx'

export default function AdminDesafiosGlobais() {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const carregar = () => carregarDesafiosGlobais().then(setLista).catch((e) => setErro(e.message))
  useEffect(() => { carregar() }, [])
  async function ocultar(id) {
    if (!window.confirm('Ocultar este desafio para todos os usuários? O histórico será preservado.')) return
    try { await ocultarDesafioGlobal(id); await carregar() } catch (e) { setErro(e.message) }
  }
  if (lista === null) return <Carregando linhas={3} texto="Carregando desafios globais" />
  return <div className="space-y-3">
    {erro && <p className="text-sm text-rose-600">{erro}</p>}
    {lista.length === 0 ? <Vazio icone="🏆" titulo="Nenhum desafio publicado">Publique uma semana pelo SQL do Ranking Global.</Vazio> : lista.map((d) => (
      <Card key={d.id} className="flex items-center justify-between gap-3">
        <div><p className="font-bold text-ink">{d.nome || ({ memoria: 'Jogo da Memória', caca: 'Caça-palavras', desliza: 'Quebra-cabeça' })[d.chave] || d.chave}</p><p className="text-sm text-muted">Semana {d.semana} · {d.dificuldade} · ⭐ {d.estrelas_max}</p></div>
        <Botao variacao="perigo" aoTocar={() => ocultar(d.id)}>Ocultar</Botao>
      </Card>
    ))}
  </div>
}
