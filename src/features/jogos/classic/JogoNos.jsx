import { useState } from 'react'
import { motion } from 'framer-motion'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'

// ===================== 🪢 Quiz dos Nós =====================
const PERGUNTAS_NOS = [
  { p: "Para que serve o nó de escota?", o: ["Unir duas cordas de espessuras (grossuras) diferentes", "Fazer uma alça fixa que não aperta na ponta da corda", "Prender a corda a um poste ou mastro", "Impedir que a ponta da corda passe por um furo"], c: 0 },
  { p: "Qual nó forma uma alça fixa que não aperta nem escorrega, muito usado em resgates?", o: ["Lais de guia", "Nó direito", "Volta do fiel", "Nó de escota"], c: 0 },
  { p: "Para que serve principalmente a volta do fiel?", o: ["Prender a corda a um poste e iniciar as amarras", "Unir duas cordas de mesma grossura", "Fazer uma alça que nunca desliza", "Emendar duas linhas finas de pesca"], c: 0 },
  { p: "O nó direito é mais indicado para qual finalidade?", o: ["Unir duas cordas da mesma espessura ou amarrar um pacote/atadura", "Unir duas cordas de espessuras bem diferentes", "Fazer uma alça de resgate na cintura", "Prender uma corda firme a uma árvore"], c: 0 },
  { p: "Qual é a função do nó de oito feito na ponta da corda?", o: ["Servir de bloqueio, impedindo a ponta de escapar por uma argola ou furo", "Unir duas cordas de grossuras diferentes", "Fazer uma alça corrediça que aperta", "Amarrar dois troncos em cruz"], c: 0 },
  { p: "A amarra quadrada serve para unir dois troncos que se cruzam em que posição?", o: ["Em ângulo reto (90°), como um T ou uma cruz", "Lado a lado, para virarem um só mais comprido", "Em X, quando tendem a se afastar", "Na mesma linha reta, um logo após o outro"], c: 0 },
  { p: "Quando se usa a amarra diagonal?", o: ["Para unir dois troncos que se cruzam e tendem a se afastar (abrir)", "Para emendar dois troncos e deixá-los mais compridos", "Para prender a corda a um único poste", "Para fazer uma alça na ponta da corda"], c: 0 },
  { p: "Para que serve a amarra redonda (também chamada paralela)?", o: ["Unir dois troncos lado a lado para formar um único mais comprido", "Unir dois troncos que se cruzam em ângulo reto", "Fazer uma alça de resgate na cintura", "Impedir que a ponta da corda se desfie"], c: 0 },
  { p: "Qual é o cuidado correto ao guardar as cordas?", o: ["Guardá-las sempre secas, para não mofarem nem apodrecerem", "Guardá-las molhadas para ficarem mais macias", "Deixá-las o dia todo no sol forte", "Passar óleo de cozinha nelas antes de guardar"], c: 0 },
  { p: "Por que se dá um acabamento na ponta da corda (com fita, fio ou derretendo)?", o: ["Para evitar que os fios se soltem e a corda se desfie", "Para a corda ficar mais comprida", "Para a corda flutuar melhor na água", "Para mudar a cor da corda"], c: 0 },
  { p: "O nó de pescador é usado para quê?", o: ["Unir duas linhas ou cordas finas, como linhas de pescar", "Amarrar dois troncos grossos em cruz", "Prender a barraca no chão", "Fazer um bloqueio na ponta da corda"], c: 0 },
  { p: "O que caracteriza um nó de correr (laço corrediço)?", o: ["Forma uma alça que aperta quando se puxa a corda", "Forma uma alça que nunca aperta", "Serve para emendar duas cordas grossas", "É usado só para o acabamento da ponta"], c: 0 },
  { p: "Na linguagem dos nós, como se chama a ponta livre da corda, aquela com que trabalhamos?", o: ["Chicote", "Seio", "Firme (ou dormente)", "Alça de guia"], c: 0 },
  { p: "Ainda na linguagem dos nós, o que é o 'seio' da corda?", o: ["A curva ou alça que a corda faz sem cruzar as partes", "A ponta livre com que se trabalha", "O acabamento feito na extremidade", "O nó já pronto e bem apertado"], c: 0 },
  { p: "A amarra quadrada quase sempre começa com qual nó?", o: ["Volta do fiel", "Lais de guia", "Nó de escota", "Nó de pescador"], c: 0 },
  { p: "O nó simples (nó de embate) é o mais básico de todos. Para que ele costuma servir?", o: ["Fazer um pequeno bloqueio na ponta ou servir de base para outros nós", "Unir dois troncos em cruz com segurança", "Fazer uma alça de resgate que não aperta", "Emendar duas cordas de grossuras diferentes"], c: 0 },
  { p: "Por que não se deve pisar nas cordas nem arrastá-las por pedras e terra?", o: ["Porque isso gasta e corta os fios, deixando a corda fraca", "Porque deixa a corda com cheiro ruim", "Porque faz a corda encolher de tamanho", "Porque muda a cor da corda para escuro"], c: 0 },
  { p: "Se a corda ficou molhada na atividade, o que se deve fazer antes de guardar?", o: ["Deixá-la secar bem, de preferência à sombra", "Guardá-la enrolada e molhada mesmo", "Secá-la no fogo bem perto da chama", "Deixá-la o dia inteiro no sol mais forte"], c: 0 },
  { p: "Qual é a forma correta de guardar uma corda comprida para não embaraçar?", o: ["Enrolada em rolo (aduchada) e amarrada", "Amassada e jogada no fundo da mochila", "Cheia de nós apertados ao longo dela", "Dobrada ao meio e deixada molhada"], c: 0 },
  { p: "Para montar estruturas com troncos na pioneiria (torres, portais, mesas), o que usamos para unir os troncos?", o: ["As amarras (quadrada, diagonal e redonda)", "O nó de oito e o nó simples", "O lais de guia e o nó de escota", "O nó de pescador e o laço corrediço"], c: 0 },
]

function JogoNos({ onTerminar, onCancelar }) {
  // Sorteia 6 perguntas e embaralha as opções de cada uma (a certa muda de lugar)
  const [rodadas] = useState(() => embaralhar(PERGUNTAS_NOS).slice(0, 6).map((q) => {
    const certa = q.o[q.c]
    return { p: q.p, opcoes: embaralhar(q.o), certa }
  }))
  const [n, setN] = useState(0)
  const [acertos, setAcertos] = useState(0)
  const [aviso, setAviso] = useState('')
  const [fim, setFim] = useState(false)
  const q = rodadas[n]

  function responder(op) {
    if (fim || aviso) return
    const ok = op === q.certa
    const total = acertos + (ok ? 1 : 0)
    if (ok) { setAcertos(total); juice.acerto(acertos) } else juice.erro()
    setAviso(ok ? 'Isso! ✅' : `Era: ${q.certa}`)
    setTimeout(() => {
      setAviso('')
      if (n + 1 >= rodadas.length) {
        setFim(true)
        onTerminar(total >= 6 ? 3 : total >= 4 ? 2 : 1)
      } else setN(n + 1)
    }, 1300)
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-muted">Pergunta {n + 1} de {rodadas.length}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <div className="text-center text-4xl mb-2">🪢</div>
      <p className="text-ink font-semibold text-center mb-4">{q.p}</p>
      <div className="space-y-2">
        {q.opcoes.map((op) => (
          <motion.button key={op} whileTap={{ scale: 0.98 }} onClick={() => responder(op)} disabled={!!aviso || fim}
            className="w-full rounded-xl bg-surface2 hover:bg-surface2 py-3 px-3 text-sm font-semibold text-ink text-left disabled:opacity-60">
            {op}
          </motion.button>
        ))}
      </div>
      {aviso && <p className={`text-sm font-bold text-center mt-3 ${aviso.startsWith('Isso') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
      <p className="text-xs text-faint text-center mt-2">Acertos: {acertos}</p>
    </div>
  )
}

export default JogoNos
