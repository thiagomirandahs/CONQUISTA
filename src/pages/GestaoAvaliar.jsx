import { Link } from 'react-router-dom'
import { Cabecalho } from '../ui/index.jsx'
import { FilaDeAvaliacao } from './Gestao.jsx'

// Rota própria da fila única — é para onde o Início manda quando há gente esperando avaliação.
// Antes desta fase, as 6 filas eram cards espalhados entre 21 em Gestão.
export default function GestaoAvaliar() {
  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone="🔎" titulo="Avaliar" descricao="Tudo o que espera a sua avaliação, num lugar só" />
      <FilaDeAvaliacao />
      {/* Classes + Especialidades numa central de trabalho só, com histórico por tentativa e
          filtros — os cards acima continuam levando cada um pra sua tela própria (e continuam
          respeitando o recurso ligado/desligado do clube, que essa central não decide sozinha). */}
      <Link to="/gestao/avaliacoes" className="block w-full text-center text-sm font-semibold text-brand underline mt-2">
        Ver Classes + Especialidades juntas, com histórico
      </Link>
    </div>
  )
}
