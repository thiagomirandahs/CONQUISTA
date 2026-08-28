import { useState } from 'react'
import { motion } from 'framer-motion'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'

// ===================== 🚑 Primeiros Socorros =====================
// "O que fazer PRIMEIRO?" — cenas reais da especialidade de Primeiros Socorros.
// A criança escolhe a ação certa e o jogo EXPLICA o porquê. Sorteia 5 por rodada.
const SOCORRO = [
  { emoji: "🔥", cena: "Seu amigo encostou a mão na panela quente e queimou a pele, que ficou vermelha e ardendo. O que fazer PRIMEIRO?", o: ["Colocar a mão debaixo de água corrente fria por alguns minutos", "Passar pasta de dente ou manteiga na queimadura", "Estourar a bolha para sair o líquido", "Colocar gelo direto na pele queimada"], c: 0, dica: "A água fria corrente tira o calor da pele e alivia a dor sem machucar mais; pasta de dente, manteiga e gelo direto pioram a lesão." },
  { emoji: "🩹", cena: "Você se cortou no dedo com a faca e está saindo sangue. O que fazer PRIMEIRO?", o: ["Apertar o corte com um pano limpo para estancar o sangue", "Assoprar o corte para parar de sangrar", "Passar terra em cima para 'secar' o sangue", "Deixar o corte aberto e continuar brincando"], c: 0, dica: "Fazer pressão com um pano limpo estanca o sangramento e evita entrada de sujeira; assoprar ou passar terra só traz micróbios." },
  { emoji: "😰", cena: "Um colega está engasgado com comida, não consegue falar nem respirar e leva as mãos ao pescoço. O que fazer PRIMEIRO?", o: ["Dar tapas firmes nas costas, entre as escápulas, e chamar ajuda", "Dar água para ele 'empurrar' a comida", "Deitar ele e esperar passar sozinho", "Colocar o dedo na garganta dele às cegas"], c: 0, dica: "Os tapas nas costas ajudam a expulsar o objeto; dar água ou enfiar o dedo pode empurrar mais fundo e piorar o engasgo." },
  { emoji: "🐝", cena: "Uma abelha picou seu braço e o ferrão ficou espetado na pele. O que fazer PRIMEIRO?", o: ["Raspar o ferrão de lado com uma unha ou cartão e lavar o local", "Apertar o ferrão com os dedos como uma pinça", "Coçar bastante o lugar da picada", "Passar barro ou saliva por cima"], c: 0, dica: "Raspar de lado tira o ferrão sem espremer a bolsa de veneno; apertar com os dedos pode injetar mais veneno na pele." },
  { emoji: "🩸", cena: "Seu amigo cortou a perna e o sangue está saindo bastante, escorrendo. O que fazer PRIMEIRO?", o: ["Pressionar firme o ferimento com um pano limpo e levantar a perna", "Amarrar bem apertado com um cordão acima do corte", "Lavar o corte com álcool para 'matar germe'", "Correr para buscar ajuda deixando o corte solto"], c: 0, dica: "Pressão firme com pano limpo e elevar o membro reduzem o sangramento; garrote apertado corta a circulação e é perigoso." },
  { emoji: "🦶", cena: "Você pisou errado, torceu o tornozelo e ele está inchando e doendo. O que fazer PRIMEIRO?", o: ["Parar, sentar e colocar gelo enrolado num pano sobre o tornozelo", "Continuar correndo para 'soltar' a torção", "Massagear forte o tornozelo inchado", "Puxar o pé com força para 'colocar no lugar'"], c: 0, dica: "Repouso e gelo com pano diminuem o inchaço e a dor; forçar ou massagear o tornozelo torcido só aumenta a lesão." },
  { emoji: "🥵", cena: "Depois de horas no sol forte, um desbravador está com a pele quente, vermelha, tonto e com dor de cabeça. O que fazer PRIMEIRO?", o: ["Levar ele para a sombra, deitar e refrescar o corpo", "Deixar ele continuar as atividades no sol", "Cobrir ele com muitas roupas e cobertas", "Dar café bem quente para 'dar energia'"], c: 0, dica: "Tirar do sol e refrescar o corpo baixa a temperatura; ficar no calor ou se cobrir esquenta ainda mais o corpo." },
  { emoji: "😵", cena: "Durante a formatura, um colega fica pálido, cai desmaiado mas está respirando. O que fazer PRIMEIRO?", o: ["Deitar ele de costas e levantar as pernas dele um pouco", "Jogar bastante água fria no rosto dele", "Dar tapas fortes no rosto para acordar", "Sentar ele e dar água enquanto está desacordado"], c: 0, dica: "Levantar as pernas faz o sangue voltar para a cabeça; dar água a quem está desacordado pode causar engasgo." },
  { emoji: "🦴", cena: "Seu amigo caiu da bicicleta e o braço está torto, muito dolorido e ele não consegue mexer. O que fazer PRIMEIRO?", o: ["Manter o braço parado do jeito que está e chamar um adulto", "Tentar endireitar o braço puxando ele", "Balançar o braço para ver se está quebrado", "Mandar ele levantar peso para 'testar'"], c: 0, dica: "Imobilizar sem mexer evita piorar uma possível fratura; puxar ou mexer no osso pode causar mais dano." },
  { emoji: "🪵", cena: "Uma lasca de madeira entrou na ponta do seu dedo e a pontinha aparece para fora. O que fazer PRIMEIRO?", o: ["Lavar as mãos e o local, depois puxar a lasca com uma pinça limpa", "Empurrar a lasca mais para dentro com a unha", "Cortar a pele em volta com a faca", "Deixar a lasca lá e esquecer"], c: 0, dica: "Puxar com pinça limpa no mesmo sentido que entrou tira a lasca inteira; empurrar ou cortar a pele aumenta o risco de infecção." },
  { emoji: "💧", cena: "Do sapato apertado, formou-se uma bolha de água no seu calcanhar que está doendo. O que fazer PRIMEIRO?", o: ["Deixar a bolha fechada e proteger com um curativo limpo", "Furar a bolha com uma agulha qualquer", "Arrancar a pele que cobre a bolha", "Continuar andando muito com o sapato apertado"], c: 0, dica: "A pele da bolha protege contra infecção; furar ou arrancar abre porta para micróbios entrarem." },
  { emoji: "🥤", cena: "Numa caminhada longa e quente, você está com muita sede, boca seca, tonto e sem xixi há horas. O que fazer PRIMEIRO?", o: ["Parar na sombra e beber água aos poucos", "Beber refrigerante e energético para repor rápido", "Continuar andando e aguentar a sede", "Beber muita água de uma vez bem depressa"], c: 0, dica: "Água em goles na sombra reidrata sem passar mal; refrigerante e energético não hidratam bem e seguir andando piora tudo." },
  { emoji: "🤕", cena: "Você caiu e ralou o joelho na terra; está sujo, ardendo e com um pouco de sangue. O que fazer PRIMEIRO?", o: ["Lavar o machucado com água limpa e sabão neutro", "Passar álcool puro direto na ferida aberta", "Cobrir com terra ou folha para estancar", "Deixar sujo e só soprar em cima"], c: 0, dica: "Lavar com água e sabão tira a sujeira e previne infecção; álcool na ferida aberta arde muito e machuca o tecido." },
  { emoji: "🚑", cena: "Um colega se cortou fundo e o sangue está jorrando bastante e não para. Enquanto alguém liga para o socorro, o que fazer PRIMEIRO?", o: ["Pressionar o local com força usando um pano limpo, sem soltar", "Ficar tirando o pano toda hora para ver se parou", "Lavar o corte fundo com bastante água por dentro", "Colocar algodão solto dentro do corte"], c: 0, dica: "Pressão contínua e firme ajuda o sangue a coagular; ficar tirando o pano atrapalha e faz sangrar de novo." },
  { emoji: "🐶", cena: "Um cachorro mordeu a perna de um desbravador e ficou uma marca com um pouco de sangue. O que fazer PRIMEIRO?", o: ["Lavar bem a mordida com água e sabão por vários minutos", "Só passar um pano seco e continuar brincando", "Amarrar a perna bem apertada acima da mordida", "Ignorar porque 'foi só uma mordidinha'"], c: 0, dica: "Lavar bem com água e sabão remove germes da saliva do animal; toda mordida precisa depois ser vista por um adulto ou médico." },
  { emoji: "👁️", cena: "Entrou um cisco de areia no seu olho e ele está lacrimejando e ardendo. O que fazer PRIMEIRO?", o: ["Lavar o olho com água limpa e piscar bastante", "Esfregar o olho com força com a mão suja", "Cutucar o olho com a ponta do dedo para tirar o cisco", "Fechar o olho bem apertado e aguentar"], c: 0, dica: "Água limpa e piscar arrastam o cisco para fora; esfregar ou cutucar pode arranhar o olho e machucar mais." },
  { emoji: "🥶", cena: "Depois de horas no frio e na chuva, um colega está tremendo muito, com a pele fria e os lábios roxos. O que fazer PRIMEIRO?", o: ["Levar ele para um lugar abrigado e trocar por roupas secas", "Dar bebida quente com álcool para 'esquentar'", "Esfregar as mãos e os pés dele com muita força", "Deixar ele com a roupa molhada até parar de tremer"], c: 0, dica: "Abrigo e roupa seca aquecem o corpo com segurança; roupa molhada mantém o frio e esfregar forte pode machucar a pele gelada." },
]

function JogoSocorro({ onTerminar, onCancelar }) {
  // Sorteia 5 cenas e embaralha as opções de cada uma (a certa muda de lugar)
  const [rodadas] = useState(() => embaralhar(SOCORRO).slice(0, 5).map((s) => ({
    emoji: s.emoji, cena: s.cena, dica: s.dica, certa: s.o[s.c], opcoes: embaralhar(s.o),
  })))
  const [n, setN] = useState(0)
  const [acertos, setAcertos] = useState(0)
  const [escolha, setEscolha] = useState(null) // texto da opção escolhida | null
  const [fim, setFim] = useState(false)
  const q = rodadas[n]
  const acertou = escolha === q.certa

  function responder(op) {
    if (escolha !== null || fim) return
    setEscolha(op)
    if (op === q.certa) { setAcertos((a) => a + 1); juice.acerto(acertos) } else juice.erro()
  }
  function proxima() {
    if (n + 1 >= rodadas.length) {
      setFim(true)
      onTerminar(acertos >= 5 ? 3 : acertos >= 3 ? 2 : 1)
    } else { setN(n + 1); setEscolha(null) }
  }

  if (fim) {
    return (
      <div className="bg-surface rounded-3xl p-6 shadow-md text-center">
        <div className="text-5xl mb-2">🚑</div>
        <p className="font-extrabold text-ink text-lg">Você acertou {acertos} de {rodadas.length}!</p>
        <p className="text-sm text-muted mt-1">Primeiros socorros salvam vidas. 💪</p>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-muted">Cena {n + 1} de {rodadas.length}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <div className="text-center text-5xl mb-2">{q.emoji}</div>
      <p className="text-ink font-bold text-center mb-4">{q.cena}</p>
      <div className="space-y-2">
        {q.opcoes.map((op) => {
          const revela = escolha !== null
          const ehCerta = op === q.certa
          const ehEscolha = op === escolha
          const cor = !revela ? 'bg-surface2 hover:bg-surface2 text-ink'
            : ehCerta ? 'bg-green-100 text-green-800 ring-2 ring-green-400'
              : ehEscolha ? 'bg-red-100 text-red-700 ring-2 ring-red-300'
                : 'bg-surface2 text-faint'
          return (
            <motion.button key={op} whileTap={revela ? undefined : { scale: 0.98 }} onClick={() => responder(op)} disabled={revela}
              className={`w-full rounded-xl py-3 px-3 text-sm font-semibold text-left ${cor}`}>
              {revela && ehCerta ? '✅ ' : revela && ehEscolha ? '❌ ' : ''}{op}
            </motion.button>
          )
        })}
      </div>
      {escolha !== null && (
        <>
          <div className={`text-sm font-semibold mt-3 rounded-xl p-3 ${acertou ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
            {acertou ? 'Isso! ' : 'Fique ligado: '}{q.dica}
          </div>
          <button onClick={proxima} className="w-full mt-3 rounded-xl bg-brand text-white font-extrabold py-3">
            {n + 1 >= rodadas.length ? 'Ver resultado 🎉' : 'Próxima ▶️'}
          </button>
        </>
      )}
      <p className="text-xs text-faint text-center mt-2">Acertos: {acertos}</p>
    </div>
  )
}

export default JogoSocorro
