import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { carregarInicio } from '../services/inicio.js'
import { rotaLiberada } from '../lib/navegacao.js'
import { Card, CardAcao, Carregando, Vazio, Aviso, mensagemDeErro } from '../ui/index.jsx'

// Início contextual (fase 7). Responde UMA pergunta: "o que é mais importante para mim agora?".
// A priorização vem do servidor (motor declarativo, sem IA). Aqui só se desenha.
// Deliberadamente NÃO é um dashboard: no máximo 3 ações à vista, o resto em "ver mais", zero
// números soltos. Antes desta fase a pessoa entrava direto no Ranking — um placar — e nada dizia
// o que ela precisava fazer.
const MOSTRAR = 3

function saudacao() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

export default function Inicio() {
  const { profile } = useAuth()
  const { marca, temRecurso } = useClube()
  const [itens, setItens] = useState(null)
  const [erro, setErro] = useState('')
  const [tudo, setTudo] = useState(false)

  useEffect(() => {
    let vivo = true
    carregarInicio()
      .then((r) => { if (vivo) setItens(r) })
      .catch((e) => { if (vivo) { setErro(mensagemDeErro(e)); setItens([]) } })
    return () => { vivo = false }
  }, [])

  const primeiroNome = (profile?.nome || '').split(' ')[0]
  // Card que leva a uma tela cujo recurso está desligado neste clube não aparece (ex.: especialidade com o recurso
  // 'especialidades' desligado — fora do piloto). O servidor já deveria não mandar; isto é a 2ª trava, a de navegação,
  // e evita o nome de um item de teste escrito no primeiro card que a pessoa vê.
  const liberados = itens === null ? null : itens.filter((i) => rotaLiberada(i.rota, temRecurso))
  const visiveis = tudo ? liberados : (liberados || []).slice(0, MOSTRAR)

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-5">
        <p className="text-sm text-muted">{saudacao()}{primeiroNome ? `, ${primeiroNome}` : ''} 👋</p>
        <h1 className="text-2xl font-extrabold text-ink leading-tight">{marca?.nome || 'Seu clube'}</h1>
      </header>

      {erro && <Aviso tom="erro" titulo="Não deu pra ver as suas pendências">{erro}</Aviso>}

      {liberados === null ? <Carregando linhas={2} texto="Vendo o que precisa de você" /> : liberados.length === 0 ? (
        <Vazio icone="✅" titulo="Você está em dia!">
          Nada esperando por você agora. Aproveite para explorar a sua jornada ou jogar um pouco.
        </Vazio>
      ) : (
        <>
          <h2 className="text-sm font-extrabold text-ink mb-2">Para você agora</h2>
          <ul className="space-y-2.5" data-testid="prioridades">
            {visiveis.map((i) => (
              <li key={i.chave}>
                <CardAcao para={i.rota}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl leading-none shrink-0" aria-hidden="true">{i.icone}</span>
                    <span className="min-w-0">
                      <span className="block font-bold text-ink text-sm">{i.titulo}</span>
                      <span className="block text-sm text-muted leading-snug">{i.descricao}</span>
                    </span>
                  </div>
                </CardAcao>
              </li>
            ))}
          </ul>
          {!tudo && liberados.length > MOSTRAR && (
            <button type="button" onClick={() => setTudo(true)}
              className="mt-3 w-full min-h-[44px] text-sm font-bold text-brand underline">
              Ver mais {liberados.length - MOSTRAR}
            </button>
          )}
        </>
      )}

      <Card className="mt-6">
        <p className="text-sm font-bold text-ink mb-2">Ir para</p>
        <div className="grid grid-cols-2 gap-2">
          <Atalho para="/jornada" icone="🎖️" texto="Minha jornada" />
          <Atalho para="/meu-clube" icone="🏕️" texto="Meu clube" />
        </div>
      </Card>
    </div>
  )
}

function Atalho({ para, icone, texto }) {
  return (
    <Link to={para} className="flex items-center gap-2 min-h-[44px] px-3 rounded-xl bg-surface2 text-ink font-bold text-sm">
      <span aria-hidden="true">{icone}</span>{texto}
    </Link>
  )
}
