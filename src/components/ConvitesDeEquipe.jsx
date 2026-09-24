import { useCallback, useEffect, useState } from 'react'
import { useClube } from '../context/Clube.jsx'
import { convitesDoClube, convidarParaEquipe, revogarConvite, meusConvites, aceitarConvite } from '../services/equipe.js'
import { Card, Botao, Selecao } from '../ui/index.jsx'

// A interface do convite de equipe — a ponta que faltava do caminho "entrar num segundo clube".
//
// São dois componentes porque são dois lados da mesma coisa e vivem em telas diferentes:
//   · `ConvidarEquipe`  fica na Gestão, com quem convida;
//   · `MeusConvites`    fica em "Eu", com quem foi convidado.
//
// Papéis: a lista é a MESMA do CHECK da tabela e da validação da RPC. Desbravador não entra de
// propósito — este convite cria vínculo ATIVO sem aprovação, o que cabe para quem a liderança
// avaliza pessoalmente e não para uma criança, cujo cadastro existe para o clube conferir quem é.
const PAPEIS = [
  { valor: 'instrutor', texto: 'Instrutor' },
  { valor: 'conselheiro', texto: 'Conselheiro' },
  { valor: 'tesoureiro', texto: 'Tesoureiro' },
  { valor: 'diretoria', texto: 'Diretoria' },
]

const quando = (iso) => { try { return new Date(iso).toLocaleDateString('pt-BR') } catch { return '' } }

export function ConvidarEquipe() {
  const { podeGerir, clubeId } = useClube()
  const [lista, setLista] = useState([])
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState('instrutor')
  const [msg, setMsg] = useState('')
  const [ocupado, setOcupado] = useState(false)

  // A lista é recarregada quando o CLUBE EM USO muda: esta tela existe dentro de um clube, e trocar
  // de aba tem de trocar o que ela mostra — não herdar a lista do clube anterior.
  const carregar = useCallback(() => {
    convitesDoClube().then(setLista).catch(() => setLista([]))
  }, [])
  useEffect(() => { if (podeGerir) carregar() }, [podeGerir, clubeId, carregar])

  if (!podeGerir) return null

  async function convidar(e) {
    e.preventDefault()
    setMsg(''); setOcupado(true)
    try {
      await convidarParaEquipe(email.trim(), papel)
      setEmail(''); setMsg('Convite enviado. Ele vale por 14 dias.')
      carregar()
    } catch (erro) { setMsg(erro.message || 'Não deu para convidar.') }
    setOcupado(false)
  }

  async function revogar(id) {
    setOcupado(true)
    try { await revogarConvite(id); carregar() } catch (erro) { setMsg(erro.message) }
    setOcupado(false)
  }

  const pendentes = lista.filter((c) => c.situacao === 'pendente')

  return (
    <Card className="p-4" data-testid="convidar-equipe">
      <p className="font-extrabold text-ink">🤝 Convidar para a equipe</p>
      <p className="text-xs text-muted mt-1 mb-3">
        Para quem já tem conta no DesbravaClube. A pessoa continua nos clubes dela e passa a ter
        este também — nada do outro clube vem junto.
      </p>
      <form onSubmit={convidar} className="space-y-2">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          data-testid="convite-email" placeholder="email@da.pessoa"
          className="w-full min-h-[44px] text-sm rounded-xl border border-line px-3" />
        <Selecao id="convite-papel" rotulo="Papel no clube" opcoes={PAPEIS}
          value={papel} onChange={(e) => setPapel(e.target.value)} data-testid="convite-papel" />
        <Botao tipo="submit" carregando={ocupado} data-testid="convite-enviar">Convidar</Botao>
      </form>
      {msg && <p className="text-xs text-muted mt-2" data-testid="convite-msg">{msg}</p>}

      {pendentes.length > 0 && (
        <ul className="mt-4 space-y-2" data-testid="convites-pendentes">
          {pendentes.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-ink">{c.email}</span>
                <span className="text-xs text-muted">{c.papel} · vence em {quando(c.expira_em)}</span>
              </span>
              <button onClick={() => revogar(c.id)} disabled={ocupado}
                data-testid={`revogar-${c.email}`} className="text-xs font-semibold text-muted shrink-0">
                Revogar
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function MeusConvites() {
  const { recarregar } = useClube()
  const [lista, setLista] = useState([])
  const [msg, setMsg] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => { meusConvites().then(setLista).catch(() => setLista([])) }, [])

  if (lista.length === 0) return null

  async function aceitar(id) {
    setOcupado(true); setMsg('')
    try {
      await aceitarConvite(id)
      setLista((l) => l.filter((c) => c.id !== id))
      setMsg('Pronto! O clube novo já aparece na sua lista.')
      // O contexto precisa ser relido: o vínculo acabou de nascer, e sem isto o seletor de clube
      // continuaria mostrando a lista de antes até alguém recarregar a página.
      await recarregar()
    } catch (erro) { setMsg(erro.message || 'Não deu para aceitar.') }
    setOcupado(false)
  }

  return (
    <Card className="p-4" data-testid="meus-convites">
      <p className="font-extrabold text-ink">✉️ Convites para você</p>
      <ul className="mt-2 space-y-2">
        {lista.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate text-ink">{c.clube}</span>
              <span className="text-xs text-muted">como {c.papel} · até {quando(c.expira_em)}</span>
            </span>
            <button onClick={() => aceitar(c.id)} disabled={ocupado}
              data-testid={`aceitar-${c.id}`}
              className="text-xs font-extrabold px-3 py-2 rounded-xl bg-gradient-to-r from-brand to-brand2 shrink-0"
              style={{ color: 'var(--marca-1-texto, #fff)' }}>
              Aceitar
            </button>
          </li>
        ))}
      </ul>
      {msg && <p className="text-xs text-muted mt-2" data-testid="convite-aceite-msg">{msg}</p>}
    </Card>
  )
}
