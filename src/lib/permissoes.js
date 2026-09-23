// Matriz ÚNICA de permissões das ferramentas da liderança.
// Usada em DOIS lugares (mesma fonte, zero duplicação):
//   1. os cards da tela ⚙️ Gestão (o que cada papel enxerga);
//   2. a trava de rota <RotaRestrita> (quem pode ABRIR cada tela).
// IMPORTANTE: isto é defesa em profundidade na NAVEGAÇÃO — a segurança de
// verdade continua sendo o RLS e as funções do banco (que conferem o papel
// no servidor). Mudou uma permissão aqui? Ela muda nos dois lugares juntos.
//
// `papeis` são papéis do VÍNCULO da pessoa no clube em uso (ClubeContext), não o papel global do perfil.
// `recurso` (opcional) é o recurso do clube (feature flag, catálogo `recursos_catalogo`) de que a ferramenta depende: clube que o desligou
// não mostra o card nem abre a rota.
export const FERRAMENTAS = [
  { to: '/aprovacoes', icon: '✅', titulo: 'Aprovações', desc: 'Liberar novos cadastros', papeis: ['diretoria', 'instrutor'] },
  { to: '/apontamentos', icon: '✍️', titulo: 'Apontamentos', desc: 'Pontos da reunião por desbravador', papeis: ['conselheiro', 'instrutor', 'diretoria'] },
  { to: '/mensalidades', icon: '💰', titulo: 'Mensalidades', desc: 'Controle de pagamentos', papeis: ['tesoureiro', 'diretoria'], recurso: 'mensalidades' },
  { to: '/usuarios', icon: '👥', titulo: 'Usuários', desc: 'Resetar senha de quem não entra', papeis: ['diretoria', 'instrutor'] },
  { to: '/pontos', icon: '➖', titulo: 'Remover pontos', desc: 'Apagar lançamentos errados', papeis: ['diretoria', 'instrutor'] },
  { to: '/modo-acampamento', icon: '🏕️', titulo: 'Modo Acampamento', desc: 'Lançar colocação das unidades nas provas', papeis: ['diretoria', 'instrutor'] },
  { to: '/chat-moderacao', icon: '💬', titulo: 'Moderação do chat', desc: 'Ver e apagar mensagens de qualquer conversa', papeis: ['diretoria', 'instrutor'], recurso: 'chat' },
  { to: '/aprovar-missoes', icon: '🎯', titulo: 'Aprovar missões', desc: 'Aprovar as fotos das missões', papeis: ['diretoria', 'instrutor'], recurso: 'missoes' },
  { to: '/radar', icon: '📡', titulo: 'Radar de faltas', desc: 'Quem está sumindo do clube', papeis: ['diretoria', 'instrutor'] },
  { to: '/temporada', icon: '🏁', titulo: 'Temporadas', desc: 'Zerar o ranking pra recomeçar', papeis: ['diretoria'] },
  { to: '/avisos', icon: '📣', titulo: 'Enviar aviso', desc: 'Recado pro clube (aparece no sino)', papeis: ['diretoria', 'instrutor'] },
  { to: '/conteudo', icon: '📖', titulo: 'Conteúdo', desc: 'Versículos e desafios das missões', papeis: ['diretoria', 'instrutor'] },
  { to: '/jogos-trilha', icon: '🎮', titulo: 'Jogos da Trilha', desc: 'Ativar os jogos pra criançada', papeis: ['diretoria', 'instrutor'], recurso: 'jogos' },
  { to: '/atividade-jogos', icon: '📊', titulo: 'Atividade dos jogos', desc: 'Quem jogou hoje e quem sumiu', papeis: ['diretoria', 'instrutor'], recurso: 'jogos' },
  { to: '/vinculos-pais', icon: '👨‍👩‍👧', titulo: 'Vínculos dos pais', desc: 'Confirmar quem é filho de quem + PIX', papeis: ['diretoria', 'instrutor'] },
  { to: '/clube', icon: '🎨', titulo: 'Identidade e recursos', desc: 'Nome, cores e logo do clube; o que o clube usa', papeis: ['diretoria', 'instrutor'] },
  { to: '/planos', icon: '💳', titulo: 'Plano do clube', desc: 'O que está incluído e quanto já está sendo usado', papeis: ['diretoria', 'instrutor'] },
  { to: '/avaliar-classe', icon: '🎖️', titulo: 'Avaliar classes', desc: 'Aprovar ou pedir correção dos requisitos enviados', papeis: ['diretoria', 'instrutor'], recurso: 'classes' },
  { to: '/investiduras', icon: '🏅', titulo: 'Revisão final e investidura', desc: 'Revisar conclusões de classe e registrar investiduras', papeis: ['diretoria', 'instrutor'], recurso: 'classes' },
  { to: '/avaliar-especialidades', icon: '🏅', titulo: 'Especialidades', desc: 'Criar turmas e avaliar requisitos enviados', papeis: ['diretoria', 'instrutor'], recurso: 'classes' },
]

// Índice rápido: rota -> papéis autorizados (derivado da lista acima)
export const PAPEIS_POR_ROTA = Object.fromEntries(FERRAMENTAS.map((f) => [f.to, f.papeis]))

// Rota -> recurso do clube de que ela depende (abas do menu, telas da criançada e ferramentas). Sem entrada = tela do núcleo (sempre existe).
// Usada em TRÊS lugares com a mesma fonte: o menu (esconde a aba), a rota (bloqueia digitar a URL) e a Gestão (esconde o card).
export const RECURSO_POR_ROTA = Object.freeze({
  '/desafios': 'desafios',
  '/chefao': 'chefao',
  '/missoes': 'missoes',
  '/trilha': 'jogos',
  '/leilao': 'leilao',
  '/chat': 'chat',
  '/biblia': 'biblia',
  '/bichinho': 'bichinho',
  '/pets-clube': 'bichinho',
  '/agenda': 'agenda',
  '/atividades': 'atividades',
  '/mural': 'mural',
  '/minha-classe': 'classes',
  '/minhas-especialidades': 'classes',
  ...Object.fromEntries(FERRAMENTAS.filter((f) => f.recurso).map((f) => [f.to, f.recurso])),
})
