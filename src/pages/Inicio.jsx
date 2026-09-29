import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { carregarInicio } from '../services/inicio.js'
import { carregarMinhasClasses } from '../services/classes.js'
import { rotaLiberada } from '../lib/navegacao.js'
import TourPrimeiroAcesso from '../components/TourPrimeiroAcesso.jsx'
import EmblemaDaClasse from '../components/EmblemaDaClasse.jsx'
import { Card, CardAcao, Botao, Carregando, Vazio, Aviso, Progresso, mensagemDeErro } from '../ui/index.jsx'

// Início contextual (fase 7). Responde UMA pergunta: "o que é mais importante para mim agora?".
// A priorização vem do servidor (motor declarativo, sem IA). Aqui só se desenha.
// Deliberadamente NÃO é um dashboard: no máximo 3 ações à vista, o resto em "ver mais", zero
// números soltos. Antes desta fase a pessoa entrava direto no Ranking — um placar — e nada dizia
// o que ela precisava fazer.
//
// Fase 6 (auditoria UX): um cartão FIXO da classe em andamento (nome, %, "Continuar") no topo — o
// `meu_inicio` não traz o percentual, então é UMA chamada a mais (`minhas_classes`), só no front,
// sem migration. O evento próximo (item `evento` do meu_inicio) vira uma faixa curta em vez de
// disputar com as ações; e a grade "Ir para" perdeu Jornada/Clube, que já estão no menu de baixo.
const MOSTRAR = 3

function saudacao() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

// A classe que a pessoa está fazendo agora: a primeira em andamento; se só houver
// concluídas/investidas, nenhuma (o cartão vira "Escolher classe").
export function classeEmAndamento(lista) {
  return (lista || []).find((c) => c.status === 'em_andamento') || null
}

export default function Inicio() {
  const { profile } = useAuth()
  const { marca, temRecurso } = useClube()
  const [itens, setItens] = useState(null)
  const [erro, setErro] = useState('')
  const [tudo, setTudo] = useState(false)
  const temClasses = !!temRecurso?.('classes')
  // null = carregando; [] = sem classe; false = não deu para ler (o cartão some, sem alarde)
  const [classes, setClasses] = useState(temClasses ? null : [])

  useEffect(() => {
    let vivo = true
    carregarInicio()
      .then((r) => { if (vivo) setItens(r) })
      .catch((e) => { if (vivo) { setErro(mensagemDeErro(e)); setItens([]) } })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    if (!temClasses) return undefined
    let vivo = true
    carregarMinhasClasses()
      .then((r) => { if (vivo) setClasses(r || []) })
      .catch(() => { if (vivo) setClasses(false) })
    return () => { vivo = false }
  }, [temClasses])

  const primeiroNome = (profile?.nome || '').split(' ')[0]
  // Card que leva a uma tela cujo recurso está desligado neste clube não aparece (ex.: especialidade com o recurso
  // 'especialidades' desligado — fora do piloto). O servidor já deveria não mandar; isto é a 2ª trava, a de navegação,
  // e evita o nome de um item de teste escrito no primeiro card que a pessoa vê.
  const liberados = itens === null ? null : itens.filter((i) => rotaLiberada(i.rota, temRecurso))
  // O evento próximo vira uma faixa própria (agenda), fora da fila de ações.
  const evento = (liberados || []).find((i) => i.chave === 'evento') || null
  const acoes = (liberados || []).filter((i) => i !== evento)
  const visiveis = tudo ? acoes : acoes.slice(0, MOSTRAR)

  const classe = classeEmAndamento(classes || [])
  const classeParada = classe && (classe.percentual ?? 0) === 0

  return (
    <div className="max-w-2xl mx-auto">
      {/* Tour de primeiro acesso (uma vez por usuário neste aparelho; reabre em Eu → Ajuda) */}
      <TourPrimeiroAcesso uid={profile?.id} />
      <header className="mb-5">
        <p className="text-sm text-muted">{saudacao()}{primeiroNome ? `, ${primeiroNome}` : ''} 👋</p>
        <h1 className="text-2xl font-extrabold text-ink leading-tight">{marca?.nome || 'Seu clube'}</h1>
      </header>

      {temClasses && classes !== null && classes !== false && (
        <CartaoDaClasse classe={classe} />
      )}

      {evento && (
        <Link to={evento.rota} data-testid="faixa-evento"
          className="mb-4 flex items-center gap-2.5 min-h-[44px] rounded-2xl bg-surface2 px-4 py-2.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <span aria-hidden="true">{evento.icone || '📅'}</span>
          <span className="min-w-0"><span className="font-bold">{evento.titulo}</span>{evento.descricao ? <span className="text-muted"> · {evento.descricao}</span> : null}</span>
        </Link>
      )}

      {erro && <Aviso tom="erro" titulo="Não deu pra ver as suas pendências">{erro}</Aviso>}

      {liberados === null ? <Carregando linhas={2} texto="Vendo o que precisa de você" /> : acoes.length === 0 ? (
        classeParada ? (
          // Classe em 0% não é "estar em dia": o primeiro requisito é a próxima coisa a fazer.
          <Vazio icone="📘" titulo="Nada pendente — mas a sua classe ainda não começou"
            acao={<Botao para="/minha-classe">Começar a classe {classe.nome}</Botao>}>
            Você está em {classe.nome} com 0%. O primeiro requisito é o melhor lugar para começar.
          </Vazio>
        ) : (
          <Vazio icone="✅" titulo="Você está em dia!">
            Nada esperando por você agora. Aproveite para explorar a sua jornada ou jogar um pouco.
          </Vazio>
        )
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
          {!tudo && acoes.length > MOSTRAR && (
            <Botao variacao="discreto" className="mt-3 w-full underline text-brand" aoTocar={() => setTudo(true)}>
              Ver mais {acoes.length - MOSTRAR}
            </Botao>
          )}
        </>
      )}

      {(temRecurso?.('comunidade') || temClasses) && (
        <Card className="mt-6">
          <p className="text-sm font-bold text-ink mb-2">Ir para</p>
          <div className="grid grid-cols-2 gap-2">
            {/* atalhos pedidos pelo dono (29/09): Rede DBV e Minha Classe direto do Início, quando o clube tem o recurso.
                Jornada e Clube saíram daqui: já estão no menu de baixo. */}
            {temRecurso?.('comunidade') && <Atalho para="/rede" icone="🌎" texto="Rede DBV" />}
            {temClasses && <Atalho para="/minha-classe" icone="📘" texto="Minha classe" />}
          </div>
        </Card>
      )}
    </div>
  )
}

// Cartão fixo da classe: nome, percentual e o botão de continuar. Sem classe em andamento, convida a escolher.
function CartaoDaClasse({ classe }) {
  if (!classe) {
    return (
      <Card className="mb-4" data-testid="cartao-classe" data-estado="sem-classe">
        <div className="flex items-center gap-3">
          <span className="text-3xl leading-none" aria-hidden="true">📘</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink text-sm">Você ainda não está em uma classe</p>
            <p className="text-sm text-muted leading-snug">Escolha a sua classe para começar os requisitos.</p>
          </div>
        </div>
        <Botao para="/minha-classe" className="w-full mt-3">Escolher classe</Botao>
      </Card>
    )
  }
  const pct = classe.percentual ?? 0
  return (
    <Card className="mb-4" data-testid="cartao-classe" data-estado="em-andamento" aria-labelledby="cartao-classe-titulo">
      <div className="flex items-center gap-3 mb-3">
        <EmblemaDaClasse nome={classe.nome} tamanho={44} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted">Minha classe</p>
          <h2 id="cartao-classe-titulo" className="font-extrabold text-ink text-base leading-tight truncate">{classe.nome}</h2>
        </div>
      </div>
      <Progresso valor={pct} total={100} rotulo={`Progresso em ${classe.nome}`} />
      <Botao para="/minha-classe" className="w-full mt-3" aria-label={`Continuar a classe ${classe.nome}`}>
        Continuar
      </Botao>
    </Card>
  )
}

function Atalho({ para, icone, texto }) {
  return (
    <Link to={para} className="flex items-center gap-2 min-h-[44px] px-3 rounded-xl bg-surface2 text-ink font-bold text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      <span aria-hidden="true">{icone}</span>{texto}
    </Link>
  )
}
