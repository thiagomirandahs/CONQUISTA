import { useClube } from '../context/Clube.jsx'
import { CardAcao, Cabecalho, Vazio } from '../ui/index.jsx'
import { HUB_JORNADA, HUB_CLUBE, HUB_JOGOS, itensDoHub, descricaoDaJornada } from '../lib/navegacao.js'

// Hubs de destino (fase 7): Jornada, Clube e Jogos.
// Cada um reúne as telas de um assunto. Antes, cada uma dessas telas era uma linha solta no menu —
// e a 360px oito delas ficavam abaixo da dobra. Aqui elas viram cards grandes, com alvo de toque
// cheio e um subtítulo que diz o que a pessoa vai encontrar.
function Hub({ icone, titulo, descricao, itens, vazio }) {
  const { temRecurso } = useClube()
  const lista = itensDoHub(itens, temRecurso)
  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone={icone} titulo={titulo} descricao={descricao} />
      {lista.length === 0 ? (
        <Vazio icone={icone} titulo={vazio}>
          A diretoria do clube pode ligar estes recursos em Configurações.
        </Vazio>
      ) : (
        <ul className="space-y-2.5">
          {lista.map((i) => (
            <li key={i.to}>
              <CardAcao para={i.to}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none shrink-0" aria-hidden="true">{i.icon}</span>
                  <span className="min-w-0">
                    <span className="block font-bold text-ink">{i.label}</span>
                    <span className="block text-sm text-faint leading-snug">{i.desc}</span>
                  </span>
                  <span className="ml-auto text-faint shrink-0" aria-hidden="true">›</span>
                </div>
              </CardAcao>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Jornada() {
  const { temRecurso } = useClube()
  // o subtítulo acompanha o que está ligado NESTE clube: não promete especialidades com o recurso desligado
  return <Hub icone="🎖️" titulo="Minha jornada" itens={HUB_JORNADA}
    descricao={descricaoDaJornada(temRecurso)}
    vazio="Sua jornada ainda não começou" />
}

export function MeuClube() {
  const { temGestao, temRecurso } = useClube()
  // Para a liderança, os jogos vivem AQUI: ela não é o público deles, e o 4º destino dela é a Gestão.
  const itens = temGestao ? [...HUB_CLUBE, ...HUB_JOGOS] : HUB_CLUBE
  void temRecurso
  return <Hub icone="🏕️" titulo="Meu clube" itens={itens}
    descricao="Ranking, unidades, mural, agenda e conversas"
    vazio="Nada ligado por aqui ainda" />
}

export function Jogos() {
  return <Hub icone="🎮" titulo="Jogos" itens={HUB_JOGOS}
    descricao="Jogue, desafie a sua unidade e cuide do bichinho"
    vazio="Os jogos estão desligados neste clube" />
}
