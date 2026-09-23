import { useEffect, useState } from 'react'
import { useClube } from '../context/Clube.jsx'
import { carregarAvaliacoesPendentes } from '../services/inicio.js'
import { FERRAMENTAS, GRUPOS_GESTAO } from '../lib/permissoes.js'
import { Card, CardAcao, Cabecalho, Vazio, Selo, Carregando, Aviso, mensagemDeErro } from '../ui/index.jsx'

// Gestão (fase 7): 4 grupos em vez de uma parede de 21 cards.
// A auditoria mediu 3.670px — 4,6 telas de rolagem a 360px — sem hierarquia nenhuma. Agora a
// primeira tela mostra só o que é operação diária; o que é raro (ou que já tem entrada natural
// dentro da própria tela do assunto) fica atrás de "ver todas". Nenhuma rota foi removida.
const PODE_GERIR = ['instrutor', 'diretoria']

export default function Gestao() {
  const { papel: meuPapel, temRecurso } = useClube()
  const ehAdmin = PODE_GERIR.includes(meuPapel)
  const [abertos, setAbertos] = useState({})
  const disponivel = (f) => f.papeis.includes(meuPapel) && (!f.recurso || temRecurso(f.recurso))
  const minhas = FERRAMENTAS.filter(disponivel)

  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone="⚙️" titulo="Gestão" descricao="As ferramentas da liderança" />

      {ehAdmin && <FilaDeAvaliacao />}

      {minhas.length === 0 ? (
        <Vazio icone="🔒" titulo="Sem ferramentas de gestão">Seu papel não tem acesso a estas áreas.</Vazio>
      ) : GRUPOS_GESTAO.map((g) => {
        const doGrupo = minhas.filter((f) => f.grupo === g.chave)
        if (doGrupo.length === 0) return null
        const fixas = doGrupo.filter((f) => !f.contextual)
        const extras = doGrupo.filter((f) => f.contextual)
        const aberto = abertos[g.chave]
        const lista = aberto ? doGrupo : fixas
        return (
          <section key={g.chave} className="mb-5">
            <TituloGrupo g={g} />
            {lista.length > 0 && (
              <ul className="space-y-2">
                {lista.map((f) => (
                  <li key={f.to}>
                    <CardAcao para={f.to}>
                      <div className="flex items-center gap-3">
                        <span className="text-xl leading-none shrink-0" aria-hidden="true">{f.icon}</span>
                        <span className="min-w-0">
                          <span className="block font-bold text-ink text-sm">{f.titulo}</span>
                          <span className="block text-xs text-faint leading-snug">{f.desc}</span>
                        </span>
                        <span className="ml-auto text-faint shrink-0" aria-hidden="true">›</span>
                      </div>
                    </CardAcao>
                  </li>
                ))}
              </ul>
            )}
            {!aberto && extras.length > 0 && (
              <button type="button" onClick={() => setAbertos((a) => ({ ...a, [g.chave]: true }))}
                className="mt-2 w-full min-h-[44px] text-sm font-bold text-brand underline text-left px-1">
                {lista.length > 0 ? `Ver todas (${extras.length} a mais)` : `Ver as ${extras.length} ferramentas de ${g.titulo.toLowerCase()}`}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}

function TituloGrupo({ g }) {
  return (
    <h2 className="text-sm font-extrabold text-ink mb-2">
      <span aria-hidden="true">{g.icone} </span>{g.titulo}
      <span className="block text-xs font-normal text-faint">{g.desc}</span>
    </h2>
  )
}

// A FILA ÚNICA: antes, avaliar classe, especialidade, experiência, entrega e missão eram 6 cards
// perdidos entre 21. Aqui viram um bloco só, com o número de cada coisa esperando.
const FILAS = [
  { chave: 'classes', rotulo: 'Requisitos de classe', icone: '🎖️', to: '/avaliar-classe' },
  { chave: 'especialidades', rotulo: 'Especialidades', icone: '🏅', to: '/avaliar-especialidades' },
  { chave: 'experiencias', rotulo: 'Experiências', icone: '✨', to: '/experiencias/novo' },
  { chave: 'atividades', rotulo: 'Entregas de atividade', icone: '📋', to: '/atividades' },
  { chave: 'missoes', rotulo: 'Missões', icone: '🎯', to: '/aprovar-missoes' },
  { chave: 'investiduras', rotulo: 'Revisão e investidura', icone: '🏆', to: '/investiduras' },
]

export function FilaDeAvaliacao() {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    let vivo = true
    carregarAvaliacoesPendentes()
      .then((d) => { if (vivo) setDados(d) })
      .catch((e) => { if (vivo) { setErro(mensagemDeErro(e)); setDados({}) } })
    return () => { vivo = false }
  }, [])

  if (erro) return <Aviso tom="erro" titulo="Não deu pra ver a fila">{erro}</Aviso>
  if (dados === null) return <div className="mb-5"><Carregando linhas={1} texto="Vendo o que espera avaliação" /></div>

  const comPendencia = FILAS.filter((f) => (dados[f.chave] || 0) > 0)
  const total = comPendencia.reduce((s, f) => s + dados[f.chave], 0)

  return (
    <section className="mb-5" aria-labelledby="t-fila">
      <h2 id="t-fila" className="text-sm font-extrabold text-ink mb-2">
        <span aria-hidden="true">🔎 </span>Avaliar
      </h2>
      {total === 0 ? (
        <Card><p className="text-sm text-ink font-semibold">✅ Nada esperando a sua avaliação.</p></Card>
      ) : (
        <ul className="space-y-2" data-testid="fila-avaliacao">
          {comPendencia.map((f) => (
            <li key={f.chave}>
              <CardAcao para={f.to}>
                <div className="flex items-center gap-3">
                  <span className="text-xl leading-none shrink-0" aria-hidden="true">{f.icone}</span>
                  <span className="font-bold text-ink text-sm">{f.rotulo}</span>
                  <Selo tom="atencao" className="ml-auto shrink-0">{dados[f.chave]}</Selo>
                </div>
              </CardAcao>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
