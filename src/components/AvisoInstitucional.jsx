import { useEffect, useMemo, useState } from 'react'
import { Card, Botao, Campo } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import { alcanceAvisoInstitucional, destinosAvisoInstitucional, enviarAvisoInstitucional, clubesDaEscolha } from '../services/avisoInstitucional.js'

// Aviso institucional (migrations 536/554).
//  * Coordenação (painel /institucional): vai para a LIDERANÇA dos clubes da área da pessoa. Quem não é coordenação não vê o cartão.
//  * Plataforma (/admin › Aviso geral): liderança OU todos os membros.
//  * Para quem (554): TODOS os clubes da área, ou ESCOLHER — um ou vários clubes, e/ou uma região/distrito inteiro.
//    O servidor recorta pela área de quem envia (escolha de fora da área é ignorada).
// Confirmação antes de enviar (diz quantos clubes) porque não dá para desfazer: o aviso vira notificação no celular de muita gente.
const TIPO = { divisao: 'Divisão', uniao: 'União', campo: 'Associação', regiao: 'Região', distrito: 'Distrito', igreja: 'Igreja', clube: 'Clube' }
const plural = (n) => `${n} ${n === 1 ? 'clube' : 'clubes'}`

export default function AvisoInstitucional({ plataforma = false }) {
  const [alcance, setAlcance] = useState(null)
  const [destinos, setDestinos] = useState(null)
  const [titulo, setTitulo] = useState('')
  const [corpo, setCorpo] = useState('')
  const [destino, setDestino] = useState('lideranca')
  const [modo, setModo] = useState('todos')          // 'todos' (da área) | 'escolher'
  const [marcados, setMarcados] = useState([])
  const [busca, setBusca] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let vivo = true
    alcanceAvisoInstitucional(plataforma).then((a) => { if (vivo) setAlcance(a) }).catch(() => { if (vivo) setAlcance({ pode: false, clubes: 0 }) })
    return () => { vivo = false }
  }, [plataforma])
  // a lista só é buscada quando a pessoa resolve escolher (economiza 4G de quem manda para todos)
  useEffect(() => {
    if (modo !== 'escolher' || destinos) return undefined
    let vivo = true
    destinosAvisoInstitucional(plataforma).then((d) => { if (vivo) setDestinos(d) }).catch(() => { if (vivo) setDestinos({ pode: false, unidades: [], erro: true }) })
    return () => { vivo = false }
  }, [modo, destinos, plataforma])

  // árvore: profundidade de cada unidade (para recuar na lista); a raiz da área fica de fora (equivale a "todos")
  const lista = useMemo(() => {
    const us = destinos?.unidades || []
    const porId = new Map(us.map((u) => [u.id, u]))
    const nivel = (u) => { let n = 0; for (let x = u.pai; x && porId.has(x) && n < 20; x = porId.get(x).pai) n++; return n }
    const caminho = (u) => { const p = []; for (let x = u; x && p.length < 20; x = porId.get(x.pai)) p.unshift(x.nome); return p.join(' › ') }
    return us.filter((u) => u.id !== destinos?.raiz)
      .map((u) => ({ ...u, nivel: nivel(u), caminho: caminho(u) }))
      .sort((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR'))
  }, [destinos])
  const filtrada = busca.trim().length >= 2 ? lista.filter((u) => u.nome.toLowerCase().includes(busca.trim().toLowerCase())) : lista
  const nEscolhidos = clubesDaEscolha(destinos?.unidades, marcados)

  if (!alcance?.pode) return null
  const nTodos = alcance.clubes_area ?? alcance.clubes
  const n = modo === 'escolher' ? nEscolhidos : nTodos
  const dest = plataforma ? destino : 'lideranca'
  const pronto = titulo.trim().length >= 3 && n > 0
  const alternar = (id) => setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))

  async function enviar() {
    if (!pronto || enviando) return
    const quem = dest === 'todos' ? 'todos os membros' : 'a liderança'
    const ok = await avisar.confirmar({
      titulo: `Enviar para ${quem} de ${plural(n)}?`,
      descricao: 'O aviso aparece no sino e chega como notificação no celular. Não dá para desfazer.',
      rotulo: 'Enviar aviso', cancelar: 'Voltar', perigo: false,
    })
    if (!ok) return
    setEnviando(true)
    try {
      const r = await enviarAvisoInstitucional({ titulo: titulo.trim(), corpo: corpo.trim(), destino: dest, plataforma, alvos: modo === 'escolher' ? marcados : null })
      if (r?.ok) { avisar.sucesso(r.mensagem || 'Aviso enviado.'); setTitulo(''); setCorpo(''); setMarcados([]) }
      else avisar.info(r?.mensagem || 'Não foi possível enviar o aviso.')
    } catch (e) { avisar.erro(e) } finally { setEnviando(false) }
  }

  const BOTAO = (ativo) => `min-h-[44px] rounded-xl text-sm font-semibold border ${ativo ? 'bg-brand text-white border-transparent' : 'bg-surface2 text-ink border-line'}`
  return (
    <Card data-testid="aviso-institucional">
      <p className="font-bold text-ink">📣 {plataforma ? 'Aviso geral da plataforma' : 'Aviso para os clubes da sua área'}</p>
      <p className="text-xs text-muted mb-3">
        {plataforma ? `Chega em ${plural(nTodos)} ativos.` : `Chega só para a liderança de ${plural(nTodos)} da sua área (${alcance.origem || 'coordenação'}).`}
      </p>
      {plataforma && (
        <div role="group" aria-label="Quem recebe" className="grid grid-cols-2 gap-2 mb-3">
          {[['lideranca', '⭐ Só a liderança'], ['todos', '👥 Todos os membros']].map(([k, rotulo]) => (
            <button key={k} type="button" aria-pressed={destino === k} onClick={() => setDestino(k)} className={BOTAO(destino === k)}>{rotulo}</button>
          ))}
        </div>
      )}

      <div role="group" aria-label="Para quais clubes" className="grid grid-cols-2 gap-2 mb-3">
        <button type="button" aria-pressed={modo === 'todos'} onClick={() => setModo('todos')} className={BOTAO(modo === 'todos')} data-testid="aviso-modo-todos">
          Todos ({plural(nTodos)})
        </button>
        <button type="button" aria-pressed={modo === 'escolher'} onClick={() => setModo('escolher')} className={BOTAO(modo === 'escolher')} data-testid="aviso-modo-escolher">
          Escolher clubes
        </button>
      </div>

      {modo === 'escolher' && (
        <div className="mb-3 rounded-xl border border-line" data-testid="aviso-escolha">
          {!destinos ? <p className="p-3 text-xs text-muted" role="status">Carregando os clubes…</p>
            : destinos.erro ? <p className="p-3 text-xs text-muted" role="alert">Não consegui carregar a lista. Feche e abra de novo.</p>
              : (
                <>
                  {lista.length > 8 && (
                    <div className="p-2 border-b border-line">
                      <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar clube, distrito ou região"
                        aria-label="Buscar clube, distrito ou região" className="w-full min-h-[44px] rounded-lg bg-surface2 border border-line px-3 text-sm text-ink" />
                    </div>
                  )}
                  <ul className="max-h-72 overflow-y-auto divide-y divide-line">
                    {filtrada.map((u) => (
                      <li key={u.id}>
                        <label className="flex items-center gap-3 min-h-[48px] px-3 py-1.5 cursor-pointer" style={{ paddingLeft: `${12 + (busca ? 0 : u.nivel) * 14}px` }}>
                          <input type="checkbox" checked={marcados.includes(u.id)} onChange={() => alternar(u.id)} className="h-5 w-5 shrink-0 accent-[var(--c-brand)]" />
                          <span className="min-w-0">
                            <span className={`block truncate text-sm ${u.tipo === 'clube' ? 'text-ink' : 'font-bold text-ink'}`}>{u.nome}</span>
                            <span className="block text-xs text-muted">
                              {TIPO[u.tipo] || u.tipo}{u.tipo !== 'clube' ? ` · ${plural(u.clubes)}` : ''}{busca && u.tipo === 'clube' ? ` · ${u.caminho}` : ''}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                    {filtrada.length === 0 && <li className="p-3 text-xs text-muted">Nada encontrado.</li>}
                  </ul>
                  <p className="p-2 border-t border-line text-xs font-semibold text-ink" data-testid="aviso-contagem">
                    {nEscolhidos > 0 ? `Vai para ${plural(nEscolhidos)}.` : 'Marque pelo menos um clube, distrito ou região.'}
                  </p>
                </>
              )}
        </div>
      )}

      <Campo id="aviso-inst-titulo" rotulo="Título" maxLength={80} value={titulo} onChange={(e) => setTitulo(e.target.value)} ajuda="Até 80 letras." />
      <Campo id="aviso-inst-corpo" rotulo="Mensagem (opcional)" linhas={3} maxLength={500} value={corpo} onChange={(e) => setCorpo(e.target.value)} />
      <Botao className="w-full" carregando={enviando} desabilitado={!pronto || enviando} aoTocar={enviar}>
        Enviar aviso
      </Botao>
    </Card>
  )
}
