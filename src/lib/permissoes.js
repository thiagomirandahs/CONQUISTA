// Matriz ÚNICA de permissões das ferramentas da liderança.
// Usada em DOIS lugares (mesma fonte, zero duplicação):
//   1. os cards da tela ⚙️ Gestão (o que cada papel enxerga);
//   2. a trava de rota <RotaRestrita> (quem pode ABRIR cada tela).
// IMPORTANTE: isto é defesa em profundidade na NAVEGAÇÃO — a segurança de
// verdade continua sendo o RLS e as funções do banco (que conferem o papel
// no servidor). Mudou uma permissão aqui? Ela muda nos dois lugares juntos.
export const FERRAMENTAS = [
  { to: '/aprovacoes', icon: '✅', titulo: 'Aprovações', desc: 'Liberar novos cadastros', papeis: ['diretoria', 'instrutor'] },
  { to: '/apontamentos', icon: '✍️', titulo: 'Apontamentos', desc: 'Pontos da reunião por desbravador', papeis: ['conselheiro', 'instrutor', 'diretoria'] },
  { to: '/mensalidades', icon: '💰', titulo: 'Mensalidades', desc: 'Controle de pagamentos', papeis: ['tesoureiro', 'diretoria'] },
  { to: '/usuarios', icon: '👥', titulo: 'Usuários', desc: 'Resetar senha de quem não entra', papeis: ['diretoria', 'instrutor'] },
  { to: '/pontos', icon: '➖', titulo: 'Remover pontos', desc: 'Apagar lançamentos errados', papeis: ['diretoria', 'instrutor'] },
  { to: '/modo-acampamento', icon: '🏕️', titulo: 'Modo Acampamento', desc: 'Lançar colocação das unidades nas provas', papeis: ['diretoria', 'instrutor'] },
  { to: '/chat-moderacao', icon: '💬', titulo: 'Moderação do chat', desc: 'Ver e apagar mensagens de qualquer conversa', papeis: ['diretoria', 'instrutor'] },
  { to: '/aprovar-missoes', icon: '🎯', titulo: 'Aprovar missões', desc: 'Aprovar as fotos das missões', papeis: ['diretoria', 'instrutor'] },
  { to: '/radar', icon: '📡', titulo: 'Radar de faltas', desc: 'Quem está sumindo do clube', papeis: ['diretoria', 'instrutor'] },
  { to: '/temporada', icon: '🏁', titulo: 'Temporadas', desc: 'Zerar o ranking pra recomeçar', papeis: ['diretoria'] },
  { to: '/avisos', icon: '📣', titulo: 'Enviar aviso', desc: 'Recado pro clube (aparece no sino)', papeis: ['diretoria', 'instrutor'] },
  { to: '/conteudo', icon: '📖', titulo: 'Conteúdo', desc: 'Versículos e desafios das missões', papeis: ['diretoria', 'instrutor'] },
  { to: '/jogos-trilha', icon: '🎮', titulo: 'Jogos da Trilha', desc: 'Ativar os jogos pra criançada', papeis: ['diretoria', 'instrutor'] },
  { to: '/atividade-jogos', icon: '📊', titulo: 'Atividade dos jogos', desc: 'Quem jogou hoje e quem sumiu', papeis: ['diretoria', 'instrutor'] },
  { to: '/vinculos-pais', icon: '👨‍👩‍👧', titulo: 'Vínculos dos pais', desc: 'Confirmar quem é filho de quem + PIX', papeis: ['diretoria', 'instrutor'] },
]

// Índice rápido: rota -> papéis autorizados (derivado da lista acima)
export const PAPEIS_POR_ROTA = Object.fromEntries(FERRAMENTAS.map((f) => [f.to, f.papeis]))
