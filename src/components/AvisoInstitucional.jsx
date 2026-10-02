import { useEffect, useState } from 'react'
import { Card, Botao, Campo } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import { alcanceAvisoInstitucional, enviarAvisoInstitucional } from '../services/avisoInstitucional.js'

// Aviso institucional (migration 536).
//  * Coordenação (painel /institucional): vai para a LIDERANÇA dos clubes da área da pessoa. Quem não é coordenação não vê o cartão.
//  * Plataforma (/admin › Aviso geral): liderança OU todos os membros de TODOS os clubes ativos.
// Confirmação antes de enviar (diz quantos clubes) porque não dá para desfazer: o aviso vira notificação no celular de muita gente.
export default function AvisoInstitucional({ plataforma = false }) {
  const [alcance, setAlcance] = useState(null)
  const [titulo, setTitulo] = useState('')
  const [corpo, setCorpo] = useState('')
  const [destino, setDestino] = useState('lideranca')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let vivo = true
    alcanceAvisoInstitucional(plataforma).then((a) => { if (vivo) setAlcance(a) }).catch(() => { if (vivo) setAlcance({ pode: false, clubes: 0 }) })
    return () => { vivo = false }
  }, [plataforma])

  if (!alcance?.pode) return null
  const n = alcance.clubes
  const clubes = `${n} ${n === 1 ? 'clube' : 'clubes'}`
  const dest = plataforma ? destino : 'lideranca'
  const pronto = titulo.trim().length >= 3

  async function enviar() {
    if (!pronto || enviando) return
    const quem = dest === 'todos' ? 'todos os membros' : 'a liderança'
    const ok = await avisar.confirmar({
      titulo: `Enviar para ${quem} de ${clubes}?`,
      descricao: 'O aviso aparece no sino e chega como notificação no celular. Não dá para desfazer.',
      rotulo: 'Enviar aviso', cancelar: 'Voltar', perigo: false,
    })
    if (!ok) return
    setEnviando(true)
    try {
      const r = await enviarAvisoInstitucional({ titulo: titulo.trim(), corpo: corpo.trim(), destino: dest, plataforma })
      if (r?.ok) { avisar.sucesso(r.mensagem || 'Aviso enviado.'); setTitulo(''); setCorpo('') }
      else avisar.info(r?.mensagem || 'Não foi possível enviar o aviso.')
    } catch (e) { avisar.erro(e) } finally { setEnviando(false) }
  }

  return (
    <Card data-testid="aviso-institucional">
      <p className="font-bold text-ink">📣 {plataforma ? 'Aviso geral da plataforma' : 'Aviso para os clubes da sua área'}</p>
      <p className="text-xs text-muted mb-3">
        {plataforma ? `Chega em ${clubes} ativos.` : `Chega só para a liderança de ${clubes} da sua área (${alcance.origem || 'coordenação'}).`}
      </p>
      {plataforma && (
        <div role="group" aria-label="Quem recebe" className="grid grid-cols-2 gap-2 mb-3">
          {[['lideranca', '⭐ Só a liderança'], ['todos', '👥 Todos os membros']].map(([k, rotulo]) => (
            <button key={k} type="button" aria-pressed={destino === k} onClick={() => setDestino(k)}
              className={`min-h-[44px] rounded-xl text-sm font-semibold border ${destino === k ? 'bg-brand text-white border-transparent' : 'bg-surface2 text-ink border-line'}`}>{rotulo}</button>
          ))}
        </div>
      )}
      <Campo id="aviso-inst-titulo" rotulo="Título" maxLength={80} value={titulo} onChange={(e) => setTitulo(e.target.value)} ajuda="Até 80 letras." />
      <Campo id="aviso-inst-corpo" rotulo="Mensagem (opcional)" linhas={3} maxLength={500} value={corpo} onChange={(e) => setCorpo(e.target.value)} />
      <Botao className="w-full" carregando={enviando} desabilitado={!pronto || enviando} aoTocar={enviar}>Enviar aviso</Botao>
    </Card>
  )
}
