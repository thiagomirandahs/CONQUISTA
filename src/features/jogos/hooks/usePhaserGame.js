import { useEffect, useRef } from 'react'
import Phaser from 'phaser'

// Hook FINO que tira o boilerplate repetido dos jogos Phaser — e SÓ isso:
//   • cria o Phaser.Game com os padrões compartilhados (AUTO, parent no host,
//     escala FIT + centralizada);
//   • liga os eventos do jogo (mapa nome→handler) e sempre chama a versão
//     ATUAL do handler (sem closure velha e sem escrever ref no render);
//   • destrói o jogo no cleanup (game.destroy(true)).
//
// O que NÃO está aqui (continua 100% em cada arquivo de jogo): a cena, o
// tamanho, as cores, e o QUE cada evento faz. Ou seja, a lógica específica do
// jogo não é escondida — só a "encanação" idêntica sai de cena.
//
// Uso:
//   const { hostRef, emit } = usePhaserGame(
//     { width: W, height: H, scene: MinhaCena, backgroundColor: '#04220f' },
//     { 'jogo:pontos': (n) => setPontos(n), 'jogo:fim': (n) => { ... } },
//   )
//   ...<div ref={hostRef} />...
//   <button onClick={() => emit('jogo:start')}>
export function usePhaserGame(config, eventos) {
  const hostRef = useRef(null)
  const gameRef = useRef(null)
  const eventosRef = useRef(eventos)
  // Mantém os handlers frescos SEM escrever a ref durante o render (roda depois
  // do render); os wrappers abaixo sempre leem a versão mais nova.
  useEffect(() => { eventosRef.current = eventos })

  useEffect(() => {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: config.width,
        height: config.height,
      },
      ...config, // width/height/scene/backgroundColor/fps/banner... do jogo
    })
    gameRef.current = game

    const nomes = Object.keys(eventosRef.current || {})
    const wrappers = {}
    for (const nome of nomes) {
      wrappers[nome] = (payload) => eventosRef.current?.[nome]?.(payload)
      game.events.on(nome, wrappers[nome])
    }

    return () => {
      for (const nome of nomes) game.events.off(nome, wrappers[nome])
      game.destroy(true)
    }
    // roda uma vez (monta/desmonta o jogo); os handlers ficam frescos via ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Manda um evento pra dentro do jogo (start, virar, etc.)
  const emit = (evento, payload) => gameRef.current?.events.emit(evento, payload)

  return { hostRef, gameRef, emit }
}
