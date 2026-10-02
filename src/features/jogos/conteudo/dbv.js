// Banco de perguntas do ecossistema DBV — SÓ fatos que já estão no app (manifesto do currículo 2026.4,
// supabase/curriculo-manifesto/classes/*.json). O teste dbv.test.js confere cada fato contra o manifesto:
// se o manifesto mudar (versão nova de classe), o teste acusa e a pergunta é revista, nunca inventada.
import { embaralhar } from '../utils/comum.js'
import { HISTORIA } from './historia.js'
import { MANUAL } from './manual.js'
import { SIMBOLOS } from './simbolos.js'

const FATOS_TEXTO = [...HISTORIA, ...MANUAL, ...SIMBOLOS]

// Ordem por idade mínima. `livro` = "livro da classe" (requisito I.5 do manifesto).
export const CLASSES = [
  { id: 'amigo', nome: 'Amigo', idade: 10, livro: 'Vaso de Barro', avancada: 'Amigo da Natureza' },
  { id: 'companheiro', nome: 'Companheiro', idade: 11, livro: 'Um Simples Lanche', avancada: 'Companheiro de Excursionismo' },
  { id: 'pesquisador', nome: 'Pesquisador', idade: 12, livro: 'Além da magia', avancada: 'Pesquisador de Campo e Bosque' },
  { id: 'pioneiro', nome: 'Pioneiro', idade: 13, livro: 'Expedição Galápagos', avancada: 'Pioneiro de Novas Fronteiras' },
  { id: 'excursionista', nome: 'Excursionista', idade: 14, livro: 'O Fim do Começo', avancada: 'Excursionista na Mata' },
  { id: 'guia', nome: 'Guia', idade: 15, livro: 'O Livro Amargo', avancada: 'Guia de Exploração' },
]
const porId = Object.fromEntries(CLASSES.map((c) => [c.id, c]))

// Pistas: um requisito que só existe numa classe regular. `busca` = trecho que o teste procura (sem acento, minúsculo)
// no texto dos requisitos DAQUELA classe e que não pode aparecer em nenhuma outra.
export const PISTAS = [
  { classe: 'amigo', pista: 'Memorizar o que Deus criou em cada dia, as 10 pragas do Egito e as 12 tribos de Israel', busca: '10 pragas do egito' },
  { classe: 'amigo', pista: 'Memorizar e explicar Daniel 1:8 (princípios de temperança de Daniel)', busca: 'daniel 1:8' },
  { classe: 'companheiro', pista: 'Memorizar os 10 Mandamentos e os 27 livros do Novo Testamento', busca: '27 livros do novo testamento' },
  { classe: 'companheiro', pista: 'Memorizar e explicar I Coríntios 9:24-27', busca: 'i corintios 9:24-27' },
  { classe: 'pesquisador', pista: 'Memorizar e mostrar que conhece Levítico 11 (alimentos comestíveis e não comestíveis)', busca: 'levitico 11' },
  { classe: 'pioneiro', pista: 'Memorizar as Bem-Aventuranças (Sermão da Montanha)', busca: 'bem-aventurancas' },
  { classe: 'pioneiro', pista: 'Participar de um estudo com um pastor sobre a inspiração da Bíblia', busca: 'inspiracao da biblia' },
  { classe: 'excursionista', pista: 'Memorizar os nomes dos 12 apóstolos e o fruto do Espírito', busca: '12 apostolos' },
  { classe: 'excursionista', pista: 'Estudar a pessoa do Espírito Santo e seu papel no crescimento espiritual', busca: 'pessoa do espirito santo' },
  { classe: 'guia', pista: 'Memorizar as 3 mensagens angélicas, as 7 igrejas e as 12 pedras preciosas da Nova Jerusalém', busca: '12 pedras preciosas' },
  { classe: 'guia', pista: 'Estudar a estrutura do santuário no Antigo Testamento e relacionar ao ministério de Jesus', busca: 'estrutura do santuario' },
  { classe: 'guia', pista: 'Fazer uma apresentação sobre os 8 remédios naturais', busca: '8 remedios naturais' },
]

// Contagens que o próprio manifesto pede para memorizar.
export const NUMEROS = [
  { sobre: 'livros do Antigo Testamento a memorizar na classe Amigo', n: 39, busca: '39 livros do antigo testamento', classe: 'amigo' },
  { sobre: 'pragas do Egito a memorizar na classe Amigo', n: 10, busca: '10 pragas do egito', classe: 'amigo' },
  { sobre: 'tribos de Israel a memorizar na classe Amigo', n: 12, busca: '12 tribos de israel', classe: 'amigo' },
  { sobre: 'livros do Novo Testamento a memorizar na classe Companheiro', n: 27, busca: '27 livros do novo testamento', classe: 'companheiro' },
  { sobre: 'apóstolos a memorizar na classe Excursionista', n: 12, busca: '12 apostolos', classe: 'excursionista' },
  { sobre: 'mensagens angélicas a memorizar na classe Guia', n: 3, busca: '3 mensagens angelicas', classe: 'guia' },
  { sobre: 'igrejas do Apocalipse a memorizar na classe Guia', n: 7, busca: '7 igrejas', classe: 'guia' },
  { sobre: 'pedras preciosas da Nova Jerusalém a memorizar na classe Guia', n: 12, busca: '12 pedras preciosas', classe: 'guia' },
  { sobre: 'remédios naturais da apresentação da classe Guia', n: 8, busca: '8 remedios naturais', classe: 'guia' },
]

const um = (arr) => arr[Math.floor(Math.random() * arr.length)]
const outras = (certa, todas, n = 3) => embaralhar(todas.filter((x) => x !== certa)).slice(0, n)
const minuscula = (s) => s.charAt(0).toLowerCase() + s.slice(1)
const NUMS_FALSOS = [3, 5, 7, 8, 10, 12, 13, 27, 39]

// Pergunta de múltipla escolha: { p, o: [opções], c: índice da certa, e: explicação curta }
function mc(p, certa, errados, e) {
  return { p, o: [certa, ...errados], c: 0, e }
}

export function perguntasQuiz() {
  const nomes = CLASSES.map((c) => c.nome)
  const idades = CLASSES.map((c) => `${c.idade} anos`)
  const livros = CLASSES.map((c) => c.livro)
  const avancadas = CLASSES.map((c) => c.avancada)
  const qs = []
  for (const c of CLASSES) {
    qs.push(mc(`Qual é a idade mínima da classe ${c.nome}?`, `${c.idade} anos`, outras(`${c.idade} anos`, idades),
      'As classes regulares vão dos 10 aos 15 anos, uma por ano.'))
    qs.push(mc(`Qual é o livro da classe ${c.nome}?`, c.livro, outras(c.livro, livros),
      `Cada classe tem o seu livro: o de ${c.nome} é "${c.livro}".`))
    qs.push(mc(`Qual é a classe avançada que acompanha a classe ${c.nome}?`, c.avancada, outras(c.avancada, avancadas),
      `${c.nome} → ${c.avancada}.`))
    qs.push(mc(`"${c.livro}" é o livro de qual classe?`, c.nome, outras(c.nome, nomes), `"${c.livro}" é o livro da classe ${c.nome}.`))
  }
  for (const x of PISTAS) {
    const cl = porId[x.classe]
    qs.push(mc(`Em qual classe você precisa: ${minuscula(x.pista)}?`, cl.nome, outras(cl.nome, nomes),
      `Esse requisito é da classe ${cl.nome}.`))
  }
  for (const x of NUMEROS) {
    const certa = String(x.n)
    qs.push(mc(`Quantos ${x.sobre}?`, certa, outras(certa, NUMS_FALSOS.map(String)), `São ${x.n}.`))
  }
  for (const h of FATOS_TEXTO) qs.push(mc(h.q, h.certa, h.errados, h.e))
  qs.push(mc('Quantas são as classes regulares dos Desbravadores no app?', '6', ['4', '5', '8'], 'Amigo, Companheiro, Pesquisador, Pioneiro, Excursionista e Guia.'))
  qs.push(mc('Qual classe regular vem logo DEPOIS do Pioneiro?', 'Excursionista', ['Guia', 'Pesquisador', 'Amigo'], 'A ordem é Amigo, Companheiro, Pesquisador, Pioneiro, Excursionista, Guia.'))
  qs.push(mc('Qual é a última classe regular, para quem tem 15 anos?', 'Guia', ['Amigo', 'Pioneiro', 'Excursionista'], 'O Guia fecha as classes regulares.'))
  return qs
}

// Afirmações verdadeiras/falsas: { p, o: ['Verdadeiro','Falso'], c: 0|1, e }
export function afirmacoesVF() {
  const vf = (p, verdade, e) => ({ p, o: ['Verdadeiro', 'Falso'], c: verdade ? 0 : 1, e })
  const out = []
  for (const c of CLASSES) {
    const errada = um(CLASSES.filter((x) => x.idade !== c.idade))
    const outro = um(CLASSES.filter((x) => x.id !== c.id))
    out.push(vf(`A idade mínima da classe ${c.nome} é de ${c.idade} anos.`, true, `Certo: ${c.nome} começa aos ${c.idade}.`))
    out.push(vf(`A idade mínima da classe ${c.nome} é de ${errada.idade} anos.`, false, `A idade mínima de ${c.nome} é ${c.idade}, não ${errada.idade}.`))
    out.push(vf(`O livro da classe ${c.nome} é "${c.livro}".`, true, `Certo: "${c.livro}" é de ${c.nome}.`))
    out.push(vf(`O livro da classe ${c.nome} é "${outro.livro}".`, false, `"${outro.livro}" é da classe ${outro.nome}; o de ${c.nome} é "${c.livro}".`))
  }
  for (const x of PISTAS) {
    const cl = porId[x.classe]
    const outro = um(CLASSES.filter((c) => c.id !== x.classe))
    const base = minuscula(x.pista)
    out.push(vf(`Na classe ${cl.nome} você precisa: ${base}.`, true, `Isso mesmo, é requisito do ${cl.nome}.`))
    out.push(vf(`Na classe ${outro.nome} você precisa: ${base}.`, false, `Esse requisito é da classe ${cl.nome}, não do ${outro.nome}.`))
  }
  for (const h of FATOS_TEXTO) {
    const falso = um(h.errados)
    out.push(vf(h.t.replace('{}', h.certa), true, h.e))
    out.push(vf(h.t.replace('{}', falso), false, h.e))
  }
  for (const x of NUMEROS) {
    const falso = um(NUMS_FALSOS.filter((n) => n !== x.n))
    out.push(vf(`São ${x.n} ${x.sobre}.`, true, `Certo: são ${x.n}.`))
    out.push(vf(`São ${falso} ${x.sobre}.`, false, `São ${x.n}, não ${falso}.`))
  }
  return out
}

// "Qual é a classe?": pista -> uma das 6 classes (sempre as 6 opções, na ordem por idade)
export function pistasDeClasse() {
  return PISTAS.map((x) => ({
    p: x.pista, o: CLASSES.map((c) => c.nome), c: CLASSES.findIndex((c) => c.id === x.classe),
    e: `Esse requisito é da classe ${porId[x.classe].nome}.`,
  }))
}
