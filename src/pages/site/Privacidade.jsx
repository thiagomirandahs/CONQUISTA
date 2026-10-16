import { Link } from 'react-router-dom'
import { PaginaLegal, Secao, Lista, Nota } from './legal.jsx'

// /privacidade — Política de Privacidade (LGPD, Lei 13.709/2018). Descreve o que o DesbravaClube
// trata, por quê, com quem compartilha, por quanto tempo e como a pessoa exerce seus direitos.
// O produto lida com dados de CRIANÇAS e ADOLESCENTES: a seção 03 (art. 14 da LGPD) é central.

const ATUALIZADO_EM = '14 de outubro de 2026'
const WHATSAPP = 'https://wa.me/5581989499469?text=' +
  encodeURIComponent('Olá! Tenho uma dúvida sobre privacidade/dados no DesbravaClube.')

const SECOES = [
  { id: 'quem-somos', titulo: 'Quem somos e o que esta política cobre' },
  { id: 'dados', titulo: 'Quais dados tratamos' },
  { id: 'criancas', titulo: 'Crianças e adolescentes' },
  { id: 'finalidades', titulo: 'Para que usamos e com qual base legal' },
  { id: 'compartilhamento', titulo: 'Com quem compartilhamos' },
  { id: 'seguranca', titulo: 'Onde seus dados ficam e como os protegemos' },
  { id: 'retencao', titulo: 'Por quanto tempo guardamos' },
  { id: 'direitos', titulo: 'Seus direitos e como exercê-los' },
  { id: 'cookies', titulo: 'Cookies e armazenamento no aparelho' },
  { id: 'mudancas', titulo: 'Mudanças nesta política' },
  { id: 'contato', titulo: 'Como falar com a gente' },
]

export default function Privacidade() {
  return (
    <PaginaLegal
      titulo="Política de Privacidade"
      descricao="Como o DesbravaClube trata os dados pessoais de desbravadores, responsáveis e liderança, conforme a LGPD — o que coletamos, por quê, com quem compartilhamos e como exercer seus direitos."
      caminho="/privacidade"
      atualizadoEm={ATUALIZADO_EM}
      resumo="Como tratamos os dados pessoais de quem usa o DesbravaClube, em linguagem clara e de acordo com a Lei Geral de Proteção de Dados (LGPD)."
      secoes={SECOES}
    >
      <Secao id={SECOES[0].id} numero={1} titulo={SECOES[0].titulo}>
        <p>
          O DesbravaClube é um aplicativo e site que ajudam Clubes de Desbravadores no dia a dia:
          classes, atividades, pontuação, comunicação com as famílias e gestão do clube. A plataforma
          é operada por Thiago Miranda (“DesbravaClube”, “nós”).
        </p>
        <p>
          Esta política explica como tratamos dados pessoais quando você usa o DesbravaClube. Ela vale
          para o site público, o aplicativo (no navegador e instalado no celular) e os serviços ligados a ele.
        </p>
        <Nota>
          <strong>Dois papéis diferentes.</strong> Cada clube decide quais informações registra sobre seus
          membros e é o responsável por esses dados perante as famílias — nesse caso o DesbravaClube atua
          como <em>operador</em>, tratando os dados em nome do clube. Já os dados da sua conta e do
          funcionamento da plataforma (login, suporte, segurança, pagamento do plano) são tratados pelo
          DesbravaClube como <em>controlador</em>.
        </Nota>
      </Secao>

      <Secao id={SECOES[1].id} numero={2} titulo={SECOES[1].titulo}>
        <p>Tratamos apenas o necessário para o clube funcionar. De forma resumida:</p>
        <Lista>
          <li><strong>Cadastro e conta:</strong> nome, e-mail, senha (guardada de forma cifrada, nunca em texto puro) e o papel da pessoa no clube (desbravador, responsável, conselheiro, diretoria, tesouraria, coordenação).</li>
          <li><strong>Vida no clube:</strong> unidade, presença e apontamentos, pontuação e ranking, atividades, classes, especialidades, conquistas e participação em jogos e desafios.</li>
          <li><strong>Vínculo familiar:</strong> a ligação entre responsável e desbravador, para que os pais acompanhem a criança.</li>
          <li><strong>Imagens:</strong> fotos e avatares enviados ao app. Ficam em armazenamento privado e só aparecem para quem tem permissão, por links temporários.</li>
          <li><strong>Mensalidades e pagamentos:</strong> valores, situação de pagamento e confirmação da transação. Os dados do cartão ou do Pix são processados pelo provedor de pagamento — <strong>não guardamos número de cartão</strong>.</li>
          <li><strong>Comunicação:</strong> mensagens, avisos e, se você autorizar, o registro para enviar notificações (push) ao seu aparelho.</li>
          <li><strong>Dados técnicos:</strong> informações mínimas de funcionamento e segurança (como registros de acesso e identificadores de erro), tratadas sem expor conteúdo pessoal sensível.</li>
        </Lista>
      </Secao>

      <Secao id={SECOES[2].id} numero={3} titulo={SECOES[2].titulo}>
        <p>
          O DesbravaClube é feito para clubes com crianças e adolescentes. O tratamento desses dados segue
          o art. 14 da LGPD e é sempre feito no <strong>melhor interesse</strong> da criança.
        </p>
        <Lista>
          <li>O cadastro de uma criança ou adolescente e o acompanhamento pelos pais dependem do <strong>consentimento e do vínculo de um responsável</strong> ou da atuação da liderança do clube.</li>
          <li>Não exibimos dados de uma criança para quem não tem relação com ela no clube, e não usamos esses dados para publicidade.</li>
          <li>Os responsáveis podem acompanhar, pedir correção e solicitar a exclusão dos dados da criança pelos canais de contato desta política.</li>
        </Lista>
      </Secao>

      <Secao id={SECOES[3].id} numero={4} titulo={SECOES[3].titulo}>
        <p>Usamos os dados para finalidades claras, com a base legal correspondente da LGPD:</p>
        <Lista>
          <li><strong>Fazer o clube funcionar</strong> (cadastro, pontuação, classes, comunicação): execução do serviço contratado pelo clube e legítimo interesse do clube na sua organização.</li>
          <li><strong>Proteger crianças e adolescentes:</strong> tutela da saúde e do melhor interesse do menor.</li>
          <li><strong>Cobrança de mensalidades e do plano:</strong> execução de contrato e cumprimento de obrigações legais e fiscais.</li>
          <li><strong>Segurança e prevenção a fraudes:</strong> legítimo interesse em manter a plataforma íntegra e as contas protegidas.</li>
          <li><strong>Notificações e comunicações opcionais:</strong> com base no seu consentimento, que você pode retirar a qualquer momento.</li>
        </Lista>
        <p>Não vendemos dados pessoais e não os usamos para publicidade direcionada.</p>
      </Secao>

      <Secao id={SECOES[4].id} numero={5} titulo={SECOES[4].titulo}>
        <p>Não vendemos seus dados. Eles só são compartilhados quando é necessário para o serviço funcionar, e sempre de forma protegida:</p>
        <Lista>
          <li><strong>Provedores de tecnologia</strong> que hospedam e mantêm a plataforma com segurança, tratando os dados apenas em nosso nome.</li>
          <li><strong>Serviço de pagamento,</strong> quando há cobrança, para processar o pagamento com segurança — sem que guardemos dados do cartão.</li>
          <li><strong>Dentro do próprio clube,</strong> conforme o papel de cada pessoa (por exemplo, a diretoria vê a gestão; o responsável vê o seu filho).</li>
          <li><strong>Autoridades,</strong> quando houver obrigação legal ou ordem judicial.</li>
        </Lista>
        <p>Quem presta esses serviços é obrigado a manter sigilo e a proteger os dados, usando-os apenas para as finalidades acima.</p>
      </Secao>

      <Secao id={SECOES[5].id} numero={6} titulo={SECOES[5].titulo}>
        <p>
          Os dados são armazenados em servidores no <strong>Brasil</strong> (região de São Paulo). Adotamos
          medidas de segurança proporcionais à sensibilidade dos dados, entre elas:
        </p>
        <Lista>
          <li>conexão cifrada (HTTPS) em todo o acesso;</li>
          <li>regras de acesso por linha no banco de dados, de modo que cada pessoa só alcança o que lhe cabe;</li>
          <li>arquivos e fotos em armazenamento privado, acessíveis apenas por links temporários;</li>
          <li>senhas guardadas de forma cifrada e registros de segurança sem expor conteúdo pessoal.</li>
        </Lista>
        <p>
          Nenhum sistema é totalmente imune a incidentes. Se ocorrer um incidente de segurança relevante,
          tomaremos as providências cabíveis e comunicaremos os envolvidos e a autoridade (ANPD) quando a lei exigir.
        </p>
      </Secao>

      <Secao id={SECOES[6].id} numero={7} titulo={SECOES[6].titulo}>
        <p>
          Guardamos os dados enquanto a conta existir e o clube estiver usando a plataforma, e depois pelo
          prazo necessário para cumprir obrigações legais (por exemplo, registros de pagamento) ou resolver
          disputas. Encerrado o uso e vencidos esses prazos, os dados são apagados ou anonimizados.
        </p>
      </Secao>

      <Secao id={SECOES[7].id} numero={8} titulo={SECOES[7].titulo}>
        <p>A LGPD garante a você (ou ao responsável pela criança) o direito de:</p>
        <Lista>
          <li>confirmar se tratamos seus dados e acessá-los;</li>
          <li>corrigir dados incompletos ou desatualizados;</li>
          <li>pedir anonimização, bloqueio ou eliminação de dados desnecessários;</li>
          <li>solicitar a portabilidade e saber com quem compartilhamos;</li>
          <li>revogar um consentimento dado anteriormente;</li>
          <li>opor-se a um tratamento e apresentar reclamação à ANPD.</li>
        </Lista>
        <p>
          Para exercer qualquer um deles, fale com a gente pelos canais da seção{' '}
          <a href="#contato" className="text-brand hover:underline">“Como falar com a gente”</a>.
          Podemos pedir informações para confirmar sua identidade antes de atender ao pedido.
        </p>
      </Secao>

      <Secao id={SECOES[8].id} numero={9} titulo={SECOES[8].titulo}>
        <p>
          Usamos apenas o armazenamento necessário para o app funcionar — por exemplo, manter você conectado
          e lembrar preferências (tema, tamanho da fonte). <strong>Não usamos cookies de publicidade nem
          rastreamento entre sites.</strong> Ao sair, as informações de sessão são limpas do aparelho.
        </p>
      </Secao>

      <Secao id={SECOES[9].id} numero={10} titulo={SECOES[9].titulo}>
        <p>
          Podemos atualizar esta política para refletir melhorias no serviço ou mudanças na lei. Quando a
          mudança for relevante, avisaremos pelo app ou pelos canais do clube. A data no topo indica a
          versão em vigor.
        </p>
      </Secao>

      <Secao id={SECOES[10].id} numero={11} titulo={SECOES[10].titulo}>
        <p>Dúvidas sobre privacidade ou para exercer seus direitos:</p>
        <Lista>
          <li>WhatsApp: <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">(81) 98949-9469</a></li>
          <li>Responsável pelo tratamento: Thiago Miranda — DesbravaClube</li>
        </Lista>
        <p>
          Veja também os nossos <Link to="/termos" className="text-brand hover:underline">Termos de Uso</Link>.
        </p>
      </Secao>
    </PaginaLegal>
  )
}
