import { Link, useNavigate } from 'react-router-dom'
import { useClube } from '../../context/Clube.jsx'
import { PainelAcessibilidade } from '../../components/PreferenciasAcessibilidade.jsx'
import { useRede } from './contexto.js'
import { CARD, Icone, PILL_CLARA, TXT, TXT_SUAVE } from './componentes.jsx'

// "Mais" da Rede DBV: minha conta na rede, acessibilidade, regras, moderação (só diretoria) e a volta
// para o app do clube.
const PAPEL = { desbravador: 'Desbravador(a)', conselheiro: 'Conselheiro(a)', instrutor: 'Instrutor(a)', tesoureiro: 'Tesoureiro(a)', diretoria: 'Diretoria', pais: 'Responsável' }

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
    <Link to={para} className={`min-h-[52px] flex items-center gap-3 rounded-2xl px-2 hover:bg-[#f5f6fb] font-bold ${TXT}`}>
      <Icone nome={icone} className="w-6 h-6 text-[#4b3cff]" /> <span className="flex-1">{children}</span> <span aria-hidden="true" className={TXT_SUAVE}>›</span>
    </Link>
  )
}

export default function RedeMais() {
  const { status } = useRede()
  const { papel } = useClube()
  const navigate = useNavigate()
  const diretoria = papel === 'diretoria'

  return (
    <div className="space-y-4">
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
          <li>Toda foto passa pela diretoria do seu clube antes de aparecer e sai daqui em 90 dias.</li>
          <li>Viu algo errado? Toque na bandeira: o conteúdo some na hora e a diretoria revisa.</li>
          <li>Três avisos em 30 dias pausam a sua rede por alguns dias.</li>
        </ul>
      </Bloco>

      <button type="button" onClick={() => navigate('/inicio')} className={`${PILL_CLARA} w-full`}>
        <Icone nome="sair" className="w-5 h-5" /> Voltar ao app do clube
      </button>
    </div>
  )
}
