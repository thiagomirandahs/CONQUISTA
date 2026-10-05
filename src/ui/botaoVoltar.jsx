import { useNavigate, useLocation, useInRouterContext } from 'react-router-dom'
import { fecharCamadaDoTopo } from '../lib/camadas.js'

// Seta de voltar ÚNICA do app (auditoria de navegação de 05/10/2026: havia 7 estilos, a maioria das telas sem seta e alguns becos sem saída).
//  * `para`   — destino de EMERGÊNCIA quando não há histórico (a pessoa abriu a tela por link/notificação): nunca fica presa nem sai do app;
//  * `rotulo` — nome do destino, para leitor de tela ("Voltar para Minha Classe");
//  * `aoVoltar` — opcional: pode confirmar descarte; devolver `false` cancela o voltar;
//  * variação 'texto' (padrão: "← Voltar") ou 'icone' (só a seta, 44×44).
// Alvo ≥ 44 px, `type="button"`, aria-label sempre.
const SETA = <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>

// Fora de um Router (telas montadas isoladas em teste) a seta simplesmente não aparece — nunca derruba a tela.
export function BotaoVoltar(props) {
  return useInRouterContext() ? <BotaoVoltarComRota {...props} /> : null
}

function BotaoVoltarComRota({ para = '/', rotulo, aoVoltar, variacao = 'texto', className = '', substituir = true }) {
  const navigate = useNavigate()
  const loc = useLocation()
  async function voltar() {
    if (aoVoltar) {
      const r = await aoVoltar()
      if (r === false) return
    }
    if (fecharCamadaDoTopo()) return
    // `key` diferente de 'default' = a entrada foi aberta por navegação DENTRO do app: dá para voltar no histórico.
    if (loc.key !== 'default') navigate(-1)
    else navigate(para, { replace: substituir })
  }
  const nome = rotulo ? `Voltar para ${rotulo}` : 'Voltar'
  const base = 'inline-flex items-center gap-1.5 min-h-[44px] min-w-[44px] rounded-full font-semibold text-muted hover:text-ink active:bg-surface2 focus-visible:outline-2 focus-visible:outline-offset-2'
  return (
    <button type="button" onClick={voltar} aria-label={nome} data-testid="botao-voltar"
      className={`${base} ${variacao === 'icone' ? 'justify-center' : 'pr-3 -ml-2 pl-2 text-sm'} ${className}`}>
      {SETA}
      {variacao === 'icone' ? null : <span>Voltar</span>}
    </button>
  )
}
