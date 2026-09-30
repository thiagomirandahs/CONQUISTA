import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { avisar } from '../ui/avisos.jsx'

// /admin › Clubes › (clube) — recursos que SÓ a plataforma libera, clube a clube (recursos_catalogo.
// somente_plataforma). A diretoria não liga nem desliga. O servidor (admin_recurso_do_clube_definir)
// confere o plano do clube e, para Especialidades, se o catálogo oficial do MÓDULO já foi publicado.
const RECURSOS = [
  { chave: 'comunidade', nome: 'Comunidade', icone: '🌎',
    ajuda: 'Feed entre clubes: publicar, curtir, comentar. Triagem automática de texto, denúncia some na hora e avisa a diretoria; fotos só depois da aprovação da diretoria. Cada criança ainda precisa da autorização do responsável.' },
  { chave: 'especialidades', nome: 'Especialidades (módulo)', icone: '🏅',
    ajuda: 'Fazer a especialidade no app, requisito por requisito. Só libera depois que o catálogo oficial do módulo (com requisitos) for publicado. O catálogo de consulta (📚 na Minha Classe) já funciona para todos.' },
]

export default function AdminRecursosPlataforma({ clubId, clube, recursos = [], onFeito }) {
  const [ocupado, setOcupado] = useState(null)
  const [motivo, setMotivo] = useState(null) // { chave, texto } — recusa do servidor (plano, catálogo), escrita como veio
  const ligado = (k) => recursos.some((r) => r.recurso === k && r.ligado)

  async function trocar(r) {
    const novo = !ligado(r.chave)
    // Fase 6: confirmação do app (modal de avisos, não a nativa). Desligar tira o recurso do clube na hora → perigo.
    const ok = await avisar.confirmar({
      titulo: `${novo ? 'Liberar' : 'Desligar'} "${r.nome}" para este clube?`,
      descricao: [
        `Clube: ${clube || '—'}.`,
        `Situação atual: ${novo ? 'Desligado' : 'Liberado'} → nova: ${novo ? 'Liberado' : 'Desligado'}.`,
        novo
          ? `Impacto: o clube passa a ver e usar ${r.nome} na hora (o servidor ainda confere o plano do clube).`
          : `Impacto: o clube deixa de ver e usar ${r.nome} na hora. Nada é apagado: os dados ficam guardados e voltam se liberar de novo.`,
      ].join(' '),
      rotulo: novo ? `Liberar ${r.nome}` : `Desligar ${r.nome}`,
      perigo: !novo,
    })
    if (!ok) return
    setOcupado(r.chave); setMotivo(null)
    try {
      const { error } = await supabase.rpc('admin_recurso_do_clube_definir', { p_club_id: clubId, p_feature: r.chave, p_enabled: novo })
      if (error) throw new Error(error.message)
      avisar.sucesso(`${r.nome}: ${novo ? 'liberado' : 'desligado'} para este clube.`)
      onFeito?.()
    } catch (e) { setMotivo({ chave: r.chave, texto: e?.message || String(e) }) }
    setOcupado(null)
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-4" data-testid="recursos-plataforma">
      <h3 className="text-sm font-bold text-ink"><span aria-hidden="true">🔓 </span>Recursos liberados pela plataforma</h3>
      <p className="mt-0.5 mb-3 text-xs text-muted">Só você libera, clube a clube. A diretoria do clube não consegue ligar.</p>
      <ul className="space-y-3">
        {RECURSOS.map((r) => {
          const on = ligado(r.chave)
          return (
            <li key={r.chave} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold text-ink"><span aria-hidden="true">{r.icone} </span>{r.nome}</p>
                <button type="button" role="switch" aria-checked={on} aria-label={`${r.nome}: ${on ? 'liberado' : 'desligado'}`}
                  disabled={!!ocupado} onClick={() => trocar(r)} data-testid={`recurso-${r.chave}`}
                  className={`relative inline-flex h-11 w-20 shrink-0 items-center rounded-full transition disabled:opacity-60 ${on ? 'bg-green-600' : 'bg-line'}`}>
                  <span className={`absolute h-8 w-8 rounded-full bg-white shadow transition-all ${on ? 'left-10' : 'left-1.5'}`} />
                  <span className="sr-only">{on ? 'Liberado' : 'Desligado'}</span>
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">{on ? '✓ Liberado' : '○ Desligado'} · {r.ajuda}</p>
              {motivo?.chave === r.chave && <p role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">⚠️ {motivo.texto}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
