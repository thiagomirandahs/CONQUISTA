import { Cabecalho } from '../ui/index.jsx'
import { FilaDeAvaliacao } from './Gestao.jsx'

// Rota própria da fila única — é para onde o Início manda quando há gente esperando avaliação.
// Antes desta fase, as 6 filas eram cards espalhados entre 21 em Gestão.
export default function GestaoAvaliar() {
  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone="🔎" titulo="Avaliar" descricao="Tudo o que espera a sua avaliação, num lugar só" />
      <FilaDeAvaliacao />
    </div>
  )
}
