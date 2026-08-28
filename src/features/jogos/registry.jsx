import { lazy, Component } from 'react'
import { suportaWebGL } from '../../lib/webgl.js'

// Jogos clássicos (canvas 2D / React puro) — entram no chunk da Trilha.
import JogoMemoria from './classic/JogoMemoria.jsx'
import JogoSequencia from './classic/JogoSequencia.jsx'
import JogoCacaPalavras from './classic/JogoCacaPalavras.jsx'
import JogoDeslizante from './classic/JogoDeslizante.jsx'
import JogoMorse from './classic/JogoMorse.jsx'
import JogoBussola from './classic/JogoBussola.jsx'
import JogoForca from './classic/JogoForca.jsx'
import JogoContas from './classic/JogoContas.jsx'
import JogoNos from './classic/JogoNos.jsx'
import JogoSemaforo from './classic/JogoSemaforo.jsx'
import JogoCobra from './classic/JogoCobra.jsx'
import JogoAnagrama from './classic/JogoAnagrama.jsx'
import JogoCampoMinado from './classic/JogoCampoMinado.jsx'
import JogoMudou from './classic/JogoMudou.jsx'
import JogoHanoi from './classic/JogoHanoi.jsx'
import JogoTermo from './classic/JogoTermo.jsx'
import JogoProximo from './classic/JogoProximo.jsx'
import JogoVelha from './classic/JogoVelha.jsx'
import JogoSocorro from './classic/JogoSocorro.jsx'
import JogoCarrinho from './classic/JogoCarrinho.jsx'
import JogoCorrida from './classic/JogoCorrida.jsx'
import JogoReflexo from './classic/JogoReflexo.jsx'

// Registro dos jogos que o app conhece (a chave bate com jogos_trilha)
// A Corrida virou um jogo em Phaser (motor 2D de verdade) — carregada sob
// demanda (lazy) pra o Phaser só entrar no bundle de quem abre ESTE jogo.
const JogoCorridaPhaser = lazy(() => import('./phaser/CorridaPhaser.jsx'))
const JogoCobraPhaser = lazy(() => import('./phaser/CobrinhaPhaser.jsx'))
const JogoCarrinhoPhaser = lazy(() => import('./phaser/CarrinhoPhaser.jsx'))
const JogoReflexoPhaser = lazy(() => import('./phaser/ReflexoPhaser.jsx'))
const JogoFutebolPhaser = lazy(() => import('./phaser/FutebolPhaser.jsx'))
const JogoBasquetePhaser = lazy(() => import('./phaser/BasquetePhaser.jsx'))
const JogoPescaPhaser = lazy(() => import('./phaser/PescaPhaser.jsx'))
const JogoCavernaPhaser = lazy(() => import('./phaser/CavernaPhaser.jsx'))
const JogoArcoPhaser = lazy(() => import('./phaser/ArcoPhaser.jsx'))
const JogoDardosPhaser = lazy(() => import('./phaser/DardosPhaser.jsx'))

// O motor Phaser 4 SÓ renderiza com WebGL — em celular sem WebGL (antigo/fraco
// ou WebView desatualizado) o jogo viraria TELA PRETA. Nesses aparelhos usamos
// as versões clássicas (canvas 2D), que rodam em qualquer tela.
export const TEM_WEBGL = typeof document !== 'undefined' && suportaWebGL()

export const JOGOS = {
  memoria: { nome: 'Jogo da Memória', curto: 'Memória', emoji: '🧠', desc: 'Ache os pares dos itens do desbravador', Comp: JogoMemoria },
  genius: { nome: 'Siga a Sequência', curto: 'Sequência', emoji: '🎮', desc: 'Repita a ordem que os itens piscarem', Comp: JogoSequencia },
  caca: { nome: 'Caça-palavras', curto: 'Caça', emoji: '🔍', desc: 'Ache as palavras escondidas no quadro', Comp: JogoCacaPalavras },
  desliza: { nome: 'Quebra-cabeça', curto: 'Peças', emoji: '🧩', desc: 'Deslize as peças até ordenar os números', Comp: JogoDeslizante },
  morse: { nome: 'Código Morse', curto: 'Morse', emoji: '📻', desc: 'Decifre a palavra em pontos e traços', Comp: JogoMorse },
  bussola: { nome: 'Bússola', curto: 'Bússola', emoji: '🧭', desc: 'Girou 90°… pra onde você está olhando?', Comp: JogoBussola },
  forca: { nome: 'Forca', curto: 'Forca', emoji: '🎯', desc: 'Adivinhe a palavra letra por letra', Comp: JogoForca },
  contas: { nome: 'Conta Rápida', curto: 'Contas', emoji: '🔢', desc: 'Quantas contas você acerta em 30 segundos?', Comp: JogoContas },
  nos: { nome: 'Quiz dos Nós', curto: 'Nós', emoji: '🪢', desc: 'Qual nó serve pra quê? Teste seus nós e amarras', Comp: JogoNos },
  semaforo: { nome: 'Semáfora', curto: 'Semáfora', emoji: '🚩', desc: 'Leia a letra pela posição das bandeiras', Comp: JogoSemaforo },
  cobra: { nome: 'Cobrinha', curto: 'Cobrinha', emoji: '🐍', desc: 'Atravesse as paredes! Só não bata em você mesmo', Comp: TEM_WEBGL ? JogoCobraPhaser : JogoCobra },
  anagrama: { nome: 'Anagrama', curto: 'Anagrama', emoji: '🔤', desc: 'Desembaralhe a palavra do clube', Comp: JogoAnagrama },
  minado: { nome: 'Campo Minado', curto: 'Minado', emoji: '💣', desc: 'Abra o campo sem pisar nas minas', Comp: JogoCampoMinado },
  mudou: { nome: 'O Que Mudou?', curto: 'Mudou', emoji: '👀', desc: 'Memorize a grade e diga o que sumiu', Comp: JogoMudou },
  hanoi: { nome: 'Torre de Hanói', curto: 'Hanói', emoji: '🗼', desc: 'Leve os discos pro último pino em poucos movimentos', Comp: JogoHanoi },
  termo: { nome: 'Termo do Clube', curto: 'Termo', emoji: '🟩', desc: 'Descubra a palavra de 5 letras em 6 tentativas', Comp: JogoTermo },
  proximo: { nome: 'Qual é o Próximo?', curto: 'Próximo', emoji: '➡️', desc: 'Complete a sequência lógica', Comp: JogoProximo },
  velha: { nome: 'Jogo da Velha', curto: 'Velha', emoji: '⭕', desc: 'Melhor de 3 contra o app — você é o ❌', Comp: JogoVelha },
  socorro: { nome: 'Primeiros Socorros', curto: 'Socorros', emoji: '🚑', desc: 'O que fazer primeiro? Aprenda socorrendo de verdade', Comp: JogoSocorro },
  carrinho: { nome: 'Carrinho na Estrada', curto: 'Carrinho', emoji: '🚗', desc: 'Arraste pra pegar os itens bons e desviar dos perigos!', Comp: TEM_WEBGL ? JogoCarrinhoPhaser : JogoCarrinho },
  reflexo: { nome: 'Reflexo', curto: 'Reflexo', emoji: '⚡', desc: 'SEM LIMITE! Acelera a cada nível — o recorde da semana vale +20', Comp: TEM_WEBGL ? JogoReflexoPhaser : JogoReflexo },
  corrida: { nome: 'Corrida do Acampamento', curto: 'Corrida', emoji: '🏕️', desc: 'Corra e pule os obstáculos! O recorde da semana vale +20', Comp: TEM_WEBGL ? JogoCorridaPhaser : JogoCorrida },
  // Jogos 100% do motor (sem versão clássica): só aparecem com WebGL.
  ...(TEM_WEBGL ? {
    futebol: { nome: 'Pênaltis', curto: 'Pênaltis', emoji: '⚽', desc: 'Cobre 5 pênaltis: arraste pra mirar e engane o goleiro!', Comp: JogoFutebolPhaser },
    basquete: { nome: 'Arremesso', curto: 'Basquete', emoji: '🏀', desc: 'Arraste pra arremessar e acerte a cesta — 5 bolas!', Comp: JogoBasquetePhaser },
    pesca: { nome: 'Pescaria', curto: 'Pescaria', emoji: '🎣', desc: 'Toque pra soltar o anzol e pesque o máximo em 45s!', Comp: JogoPescaPhaser },
    caverna: { nome: 'Caverna', curto: 'Caverna', emoji: '🔦', desc: 'Segure pra voar e desvie das pedras no escuro!', Comp: JogoCavernaPhaser },
    arco: { nome: 'Arco e Flecha', curto: 'Arco', emoji: '🏹', desc: 'Puxe a corda, mire no alvo e cuidado com o vento!', Comp: JogoArcoPhaser },
    dardos: { nome: 'Dardos', curto: 'Dardos', emoji: '🎯', desc: 'A mira dança sozinha — toque na hora certa e acerte a mosca!', Comp: JogoDardosPhaser },
  } : {}),
}

// Jogos "sem fim": repetição livre (não dão +10/+5; valem pelo recorde da semana)
export const ARCADE = new Set(['reflexo', 'corrida'])

// Rede de segurança dos jogos do motor: se o componente Phaser quebrar ao abrir
// (WebGL falhou no boot, chunk não baixou por cache velho...), renderiza a
// versão clássica em vez de tela preta. Pênaltis não tem clássica → aviso + Sair.
export const RESERVAS = { cobra: JogoCobra, corrida: JogoCorrida, carrinho: JogoCarrinho, reflexo: JogoReflexo }

export class JogoBoundary extends Component {
  constructor(props) { super(props); this.state = { quebrou: false } }
  static getDerivedStateFromError() { return { quebrou: true } }
  render() {
    if (!this.state.quebrou) return this.props.children
    const Reserva = this.props.Reserva
    if (Reserva) return <Reserva onTerminar={this.props.onTerminar} onCancelar={this.props.onCancelar} />
    return (
      <div className="bg-surface rounded-3xl p-8 shadow-md text-center">
        <div className="text-4xl mb-2">😢</div>
        <p className="font-bold text-ink">Este jogo não abriu neste aparelho</p>
        <p className="text-sm text-faint mt-1 mb-4">Tente atualizar o navegador (no Android, o "Android System WebView" na Play Store) e abrir de novo.</p>
        <button onClick={this.props.onCancelar} className="bg-brand text-white font-bold rounded-xl px-6 py-2.5">Voltar</button>
      </div>
    )
  }
}

// Fallback quando um jogo não está no registro (usado direto pela Trilha).
export { JogoMemoria }
