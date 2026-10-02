import { Component } from 'react'
import { ehErroDeVersao, recuperarVersao } from '../lib/recuperarVersao.js'
import { reportarErro } from '../lib/observabilidade.js'
import { FimDaAbertura } from '../ui/carregamento.jsx'

// "Atualizar agora" (botão): sempre executa, sem a trava de tempo.
const atualizarDeVez = () => recuperarVersao({ forcar: true })

// Rede de segurança: se uma página falhar ao CARREGAR (chunk velho depois de um
// deploy, com cache do PWA), em vez de tela branca a gente recarrega sozinho 1x
// pra pegar a versão nova. Se persistir (ou for outro erro), mostra "Atualizar".
export default class ErroApp extends Component {
  constructor(props) { super(props); this.state = { erro: false } }
  static getDerivedStateFromError() { return { erro: true } }
  componentDidCatch(erro) {
    // Tela quebrada e o pior caso para a pessoa e o mais dificil de reproduzir depois:
    // e o unico lugar onde o relato costuma ser so "deu erro e sumiu tudo".
    reportarErro(erro, { origem: 'boundary', contexto: 'A tela quebrou e o app precisou se recuperar.' })
    // versão velha (pedaço do app que sumiu no deploy): recupera SOZINHO — o botão só aparece se
    // já tentou há menos de 1 minuto (aí é outro problema e a pessoa decide).
    if (ehErroDeVersao(erro)) recuperarVersao()
  }
  render() {
    // a abertura do HTML sai assim que o React pinta — seja a primeira tela, seja o aviso de erro
    return <><FimDaAbertura />{this.conteudo()}</>
  }
  conteudo() {
    if (this.state.erro) {
      return (
        <div className="min-h-screen grid place-items-center p-6 text-center">
          <div className="max-w-sm">
            <div className="text-5xl mb-3">🔄</div>
            <p className="font-extrabold text-ink text-lg">Precisamos atualizar o app</p>
            <p className="text-sm text-muted mt-1 mb-5">Saiu uma versão nova. Toque abaixo pra atualizar — é rapidinho. 🙂</p>
            <button onClick={atualizarDeVez}
              className="w-full bg-gradient-to-r from-brand to-brand2 text-white font-extrabold rounded-2xl py-3.5 shadow-glow">
              Atualizar agora
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

