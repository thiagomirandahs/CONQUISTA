import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { clubesListar } from '../services/admin.js'
import { Botao, Card } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'

// /admin › Comunidade — liga ou desliga a Rede DBV (recurso 'comunidade') em TODOS os clubes ativos de
// uma vez. Chama a mesma RPC do liga/desliga clube a clube (admin_recurso_do_clube_definir), então as
// travas do servidor valem uma a uma: clube cujo plano não inclui a Comunidade fica de fora e aparece
// na lista com o motivo. Desligar não apaga nada.
export default function AdminRedeTodosClubes({ onFeito }) {
  const [ocupado, setOcupado] = useState(false)
  const [resultado, setResultado] = useState(null) // { acao, ok, falhas: [{nome, motivo}] }

  async function aplicar(ligar) {
    let clubes
    try { clubes = (await clubesListar()).filter((c) => c.status === 'ativo') } catch (e) { avisar.erro(e, 'Não consegui carregar a lista de clubes.'); return }
    const confirmou = await avisar.confirmar(ligar
      ? { titulo: `Liberar a Rede DBV para os ${clubes.length} clubes ativos?`,
          descricao: 'Cada desbravador ainda precisa da autorização do responsável para publicar. Clube cujo plano não inclui a Comunidade fica de fora.',
          rotulo: `Liberar em ${clubes.length} clube(s)`, perigo: false }
      : { titulo: `Desligar a Rede DBV em todos os ${clubes.length} clubes ativos?`,
          descricao: 'Nada é apagado: tudo volta quando liberar de novo.',
          rotulo: `Desligar em ${clubes.length} clube(s)` })
    if (!confirmou) return
    setOcupado(true)
    const falhas = []
    let ok = 0
    for (const c of clubes) {
      const { error } = await supabase.rpc('admin_recurso_do_clube_definir', { p_club_id: c.club_id, p_feature: 'comunidade', p_enabled: ligar })
      if (error) falhas.push({ nome: c.nome, motivo: error.message }); else ok++
    }
    setResultado({ acao: ligar ? 'liberada' : 'desligada', ok, falhas })
    setOcupado(false)
    onFeito?.()
  }

  return (
    <Card data-testid="rede-todos-clubes">
      <h3 className="font-extrabold text-ink mb-1">🌎 Rede DBV em todos os clubes</h3>
      <p className="text-xs text-muted mb-3">Liga ou desliga a Rede em todos os clubes ativos de uma vez. Para um clube só, use /admin → Clubes → clube.</p>
      <div className="grid grid-cols-2 gap-2">
        <Botao aoTocar={() => aplicar(true)} carregando={ocupado} data-testid="rede-liberar-todos">Liberar para todos</Botao>
        <Botao variacao="perigo" aoTocar={() => aplicar(false)} desabilitado={ocupado} data-testid="rede-desligar-todos">Desligar de todos</Botao>
      </div>
      {resultado && (
        <div className="mt-3 rounded-xl bg-surface2 p-3 text-sm text-ink" role="status">
          <p>✅ Rede {resultado.acao} em <strong>{resultado.ok}</strong> clube(s).</p>
          {resultado.falhas.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-amber-900">
              {resultado.falhas.map((f) => <li key={f.nome}>⚠️ <strong>{f.nome}</strong>: {f.motivo}</li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
