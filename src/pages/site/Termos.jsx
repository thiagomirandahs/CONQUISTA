import { Link } from 'react-router-dom'
import { PaginaLegal, Secao, Lista, Nota } from './legal.jsx'

// /termos — Termos de Uso do DesbravaClube: o que o serviço é, quem pode usar, as responsabilidades
// de cada parte, pagamentos, propriedade intelectual e as regras gerais. Rascunho de boa-fé, descrevendo
// o que o app realmente faz; precisa de revisão jurídica antes de valer como documento oficial.

const ATUALIZADO_EM = '14 de outubro de 2026'
const WHATSAPP = 'https://wa.me/5581989499469?text=' +
  encodeURIComponent('Olá! Tenho uma dúvida sobre os Termos de Uso do DesbravaClube.')

const SECOES = [
  { id: 'aceite', titulo: 'Aceitação destes termos' },
  { id: 'servico', titulo: 'O que é o DesbravaClube' },
  { id: 'contas', titulo: 'Contas, clubes e papéis' },
  { id: 'menores', titulo: 'Uso por crianças e adolescentes' },
  { id: 'responsabilidades', titulo: 'Responsabilidades de quem usa' },
  { id: 'conteudo', titulo: 'Conteúdo, fotos e imagem' },
  { id: 'pagamentos', titulo: 'Planos, assinaturas e pagamentos' },
  { id: 'propriedade', titulo: 'Propriedade intelectual' },
  { id: 'disponibilidade', titulo: 'Disponibilidade, suporte e mudanças' },
  { id: 'encerramento', titulo: 'Suspensão e encerramento' },
  { id: 'responsabilidade', titulo: 'Limitação de responsabilidade' },
  { id: 'lei', titulo: 'Lei aplicável e foro' },
  { id: 'contato', titulo: 'Contato' },
]

export default function Termos() {
  return (
    <PaginaLegal
      titulo="Termos de Uso"
      descricao="As regras de uso do DesbravaClube: o que o serviço oferece, quem pode usar, responsabilidades, pagamentos e propriedade intelectual."
      caminho="/termos"
      atualizadoEm={ATUALIZADO_EM}
      resumo="As regras para usar o DesbravaClube — direitos e deveres de quem usa a plataforma e do próprio serviço."
      secoes={SECOES}
    >
      <Secao id={SECOES[0].id} numero={1} titulo={SECOES[0].titulo}>
        <p>
          Estes Termos de Uso regem o acesso e o uso do aplicativo e do site DesbravaClube (“plataforma”,
          “serviço”), operados por Thiago Miranda (“DesbravaClube”, “nós”). Ao criar uma conta ou usar a
          plataforma, você concorda com estes termos e com a nossa{' '}
          <Link to="/privacidade" className="text-brand hover:underline">Política de Privacidade</Link>.
          Se não concordar, não use o serviço.
        </p>
      </Secao>

      <Secao id={SECOES[1].id} numero={2} titulo={SECOES[1].titulo}>
        <p>
          O DesbravaClube é uma ferramenta para apoiar a organização de Clubes de Desbravadores: cadastro
          de membros, unidades, classes, atividades, pontuação e ranking, comunicação com as famílias e
          gestão do clube (incluindo controle de mensalidades). Cada clube é independente e usa a plataforma
          para o seu próprio funcionamento.
        </p>
        <Nota>
          O DesbravaClube é um <strong>produto independente</strong>. Não é um site oficial da Igreja
          Adventista do Sétimo Dia nem de qualquer de suas organizações, e não fala em nome delas.
        </Nota>
      </Secao>

      <Secao id={SECOES[2].id} numero={3} titulo={SECOES[2].titulo}>
        <p>
          Para usar o serviço você cria uma conta com dados verdadeiros e mantém sua senha em sigilo. Você é
          responsável pelo que acontece na sua conta. Dentro de cada clube, as pessoas têm papéis diferentes
          (como desbravador, responsável, conselheiro, diretoria, tesouraria e coordenação), e cada papel dá
          acesso só ao que lhe cabe.
        </p>
        <Lista>
          <li>Cadastros e vínculos passam por aprovação da liderança do clube.</li>
          <li>Você não deve usar a conta de outra pessoa nem tentar obter acesso além do seu papel.</li>
          <li>Avise a liderança do clube ou a gente se perceber uso indevido da sua conta.</li>
        </Lista>
      </Secao>

      <Secao id={SECOES[3].id} numero={4} titulo={SECOES[3].titulo}>
        <p>
          A plataforma trata de crianças e adolescentes. O cadastro de um menor e o seu acompanhamento
          dependem de um <strong>responsável legal</strong> e da liderança do clube. O responsável declara ter
          autoridade para fornecer os dados do menor e autoriza o uso descrito na{' '}
          <Link to="/privacidade" className="text-brand hover:underline">Política de Privacidade</Link>,
          sempre no melhor interesse da criança.
        </p>
      </Secao>

      <Secao id={SECOES[4].id} numero={5} titulo={SECOES[4].titulo}>
        <p>Ao usar o DesbravaClube, você concorda em:</p>
        <Lista>
          <li>fornecer informações verdadeiras e mantê-las atualizadas;</li>
          <li>usar o serviço de forma lícita, respeitosa e adequada a um ambiente com crianças;</li>
          <li>não publicar conteúdo ofensivo, ilegal, enganoso ou que viole direitos de terceiros;</li>
          <li>não tentar burlar a segurança, sobrecarregar, copiar ou fazer engenharia reversa da plataforma;</li>
          <li>respeitar a privacidade dos demais membros do clube.</li>
        </Lista>
        <p>O descumprimento pode levar à suspensão ou ao encerramento do acesso.</p>
      </Secao>

      <Secao id={SECOES[5].id} numero={6} titulo={SECOES[5].titulo}>
        <p>
          O conteúdo que você envia (textos, fotos, documentos) continua sendo seu. Ao enviá-lo, você concede
          ao clube e ao DesbravaClube a permissão necessária para exibi-lo e processá-lo dentro da plataforma,
          conforme o seu papel e as finalidades do serviço.
        </p>
        <Lista>
          <li>Você declara ter o direito de enviar o que envia.</li>
          <li>Fotos de crianças só devem ser enviadas com a autorização do responsável.</li>
          <li>As imagens ficam em armazenamento privado e são exibidas apenas a quem tem permissão.</li>
        </Lista>
      </Secao>

      <Secao id={SECOES[6].id} numero={7} titulo={SECOES[6].titulo}>
        <p>Há dois tipos de cobrança, que não se confundem:</p>
        <Lista>
          <li><strong>Mensalidade do clube:</strong> o valor que o clube define e cobra dos seus membros. A plataforma apenas ajuda a registrar e acompanhar esses pagamentos; a relação é entre o membro e o clube.</li>
          <li><strong>Plano da plataforma:</strong> quando aplicável, a assinatura que mantém o clube no DesbravaClube.</li>
        </Lista>
        <p>
          Os pagamentos online são processados por um serviço de pagamento especializado e seguro; não
          guardamos dados de cartão. Valores, formas de pagamento e condições são informados no momento da contratação.
          Pedidos de cancelamento ou reembolso seguem a legislação aplicável (inclusive o Código de Defesa do
          Consumidor) e devem ser tratados pelos canais de contato.
        </p>
      </Secao>

      <Secao id={SECOES[7].id} numero={8} titulo={SECOES[7].titulo}>
        <p>
          A marca, o código, o design e os textos do DesbravaClube pertencem ao seu titular e são protegidos
          pela legislação (Leis 9.610/1998 e 9.609/1998). É proibida a reprodução, cópia ou distribuição,
          total ou parcial, sem autorização expressa. O uso da plataforma não transfere a você nenhum desses
          direitos — apenas a permissão de usar o serviço enquanto estes termos estiverem em vigor.
        </p>
      </Secao>

      <Secao id={SECOES[8].id} numero={9} titulo={SECOES[8].titulo}>
        <p>
          Nos esforçamos para manter o serviço disponível e seguro, mas ele é oferecido “no estado em que se
          encontra”. Pode haver interrupções para manutenção, atualizações ou por fatores fora do nosso
          controle. Podemos melhorar, alterar ou descontinuar recursos, avisando quando a mudança for
          relevante. O suporte é prestado pelos canais indicados nestes termos.
        </p>
      </Secao>

      <Secao id={SECOES[9].id} numero={10} titulo={SECOES[9].titulo}>
        <p>
          Podemos suspender ou encerrar o acesso em caso de descumprimento destes termos, uso que coloque em
          risco outras pessoas ou a plataforma, ou por exigência legal. Você pode encerrar sua conta a
          qualquer momento. O tratamento dos dados após o encerramento segue a{' '}
          <Link to="/privacidade" className="text-brand hover:underline">Política de Privacidade</Link>.
        </p>
      </Secao>

      <Secao id={SECOES[10].id} numero={11} titulo={SECOES[10].titulo}>
        <p>
          Na medida permitida pela lei, o DesbravaClube não se responsabiliza por danos indiretos ou por uso
          indevido do serviço por terceiros. Não respondemos pelas decisões, cobranças e condutas internas de
          cada clube, que é independente. Nada nestes termos afasta direitos garantidos por lei, especialmente
          os do Código de Defesa do Consumidor.
        </p>
      </Secao>

      <Secao id={SECOES[11].id} numero={12} titulo={SECOES[11].titulo}>
        <p>
          Estes termos são regidos pelas leis do Brasil. Fica eleito o foro do domicílio do consumidor para
          resolver questões decorrentes deste documento, quando aplicável.
        </p>
      </Secao>

      <Secao id={SECOES[12].id} numero={13} titulo={SECOES[12].titulo}>
        <p>Para falar com a gente sobre estes termos:</p>
        <Lista>
          <li>WhatsApp: <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">(81) 98949-9469</a></li>
          <li>DesbravaClube — Thiago Miranda</li>
        </Lista>
      </Secao>
    </PaginaLegal>
  )
}
