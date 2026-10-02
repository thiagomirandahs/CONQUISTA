import { Link, useNavigate } from 'react-router-dom'
import { useClube } from '../../context/Clube.jsx'
import { PainelAcessibilidade } from '../../components/PreferenciasAcessibilidade.jsx'
import { useRede } from './contexto.js'
import { destinoDeSaidaDaRede, redeComoCoordenacao, sairDoModoCoordenacao } from '../../lib/redeModo.js'
import { CARD, Icone, PILL_CLARA, TXT, TXT_SUAVE } from './componentes.jsx'

// "Mais" da Rede DBV: minha conta na rede, acessibilidade, regras, moderação (só diretoria) e a volta
// para o app do clube.
const PAPEL = { desbravador: 'Desbravador(a)', conselheiro: 'Conselheiro(a)', instrutor: 'Instrutor(a)', tesoureiro: 'Tesoureiro(a)', diretoria: 'Diretoria', pais: 'Responsável',
  // coordenação (490)
  coordenador_distrital: 'Coordenação distrital', coordenador_regional: 'Coordenação regional', coordenador_geral: 'Coordenação geral',
  diretor_mda: 'Diretoria do MDA', coordenador_uniao: 'Coordenação da união', diretor_uniao: 'Diretoria da união',
  coordenador_divisao: 'Coordenação da divisão' }

function Bloco({ titulo, children }) {
  return (
    <section className={`${CARD} p-4`} aria-label={titulo}>
      <h2 className={`font-extrabold ${TXT} mb-2`}>{titulo}</h2>
      {children}
    </section>
  )
}

function Linha({ para, icone, children }) {
  return (
    <Link to={para} className={`min-h-[52px] flex items-center gap-3 rounded-2xl px-2 hover:bg-[var(--rede-superficie)] font-bold ${TXT}`}>
      <Icone nome={icone} className="w-6 h-6 text-[var(--rede-acao)]" /> <span className="flex-1">{children}</span> <span aria-hidden="true" className={TXT_SUAVE}>›</span>
    </Link>
  )
}

export default function RedeMais() {
  const { status } = useRede()
  const { papel } = useClube()
  const navigate = useNavigate()
  // na rede como coordenação (490) a moderação de clube não se aplica (conteúdo de coordenação vai ao admin)
  const diretoria = papel === 'diretoria' && !status?.coordenacao
  const coordenacao = redeComoCoordenacao()

  return (
    <div className="space-y-4 p-3">
      <Bloco titulo="Minha conta na rede">
        {status?.pode_ver && <Linha para="/rede/perfil" icone="pessoa">Meu perfil e salvos</Linha>}
        <p className={`text-sm ${TXT_SUAVE} px-2 mt-1`}>
          {PAPEL[status?.papel] || 'Membro'}
          {status?.em_observacao ? ' · conta nova (limites menores nos primeiros dias)' : ''}
          {status?.suspenso_ate ? ' · pausada por avisos' : ''}
        </p>
      </Bloco>

      {diretoria && (
        <Bloco titulo="Moderação do meu clube">
          <Linha para="/rede/moderacao" icone="escudo">Denúncias, fotos e autorizações de imagem</Linha>
        </Bloco>
      )}

      <Bloco titulo="Acessibilidade">
        <PainelAcessibilidade />
      </Bloco>

      <Bloco titulo="Regras da Rede DBV">
        <ul className={`text-sm ${TXT} space-y-1.5 list-disc pl-5`}>
          <li>Respeito sempre. Palavrão, ofensa e deboche não passam.</li>
          <li>Nada de telefone, @, links, e-mail, endereço ou escola. Não existe mensagem privada.</li>
          <li>Antes de publicar, o app pergunta se você tem certeza: em “Só meu clube” só o seu clube vê; em “Comunidade” (só diretoria e instrutor publicam) todos os clubes da Rede veem. Fotos saem daqui em 90 dias; stories, em 24 horas.</li>
          <li>Story: na aba “Meu Clube” só o seu clube vê; na aba “Comunidade” qualquer participante publica e todos os clubes da Rede veem por 24 horas. Não existe lista de amigos nem “seguir”.</li>
          <li>Viu algo errado? Toque em ⋮ → Denunciar (no story, na bandeira): o conteúdo some na hora e a diretoria revisa.</li>
          <li>Três avisos em 30 dias pausam a sua rede por alguns dias.</li>
        </ul>
      </Bloco>

      <button type="button" onClick={() => { const d = destinoDeSaidaDaRede(coordenacao); sairDoModoCoordenacao(); navigate(d) }} className={`${PILL_CLARA} w-full`}>
        <Icone nome="sair" className="w-5 h-5" /> {coordenacao ? 'Voltar ao portal da coordenação' : 'Voltar ao app do clube'}
      </button>
    </div>
  )
}
