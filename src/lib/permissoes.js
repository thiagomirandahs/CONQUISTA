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
  { to: '/gestao/inscricoes', icon: '🔗', titulo: 'Inscrições', desc: 'Link e QR Code para novos membros', papeis: ['diretoria', 'instrutor'] , grupo: 'pessoas' },
  { to: '/aprovacoes', icon: '✅', titulo: 'Aprovações', desc: 'Liberar novos cadastros', papeis: ['diretoria', 'instrutor'] , grupo: 'pessoas' },
  { to: '/gestao/documentos', icon: '📄', titulo: 'Documentos', desc: 'PDF dos documentos de classe emitidos', papeis: ['diretoria', 'instrutor'], recurso: 'classes' , grupo: 'avaliar' },
  { to: '/apontamentos', icon: '✍️', titulo: 'Apontamentos', desc: 'Pontos da reunião por desbravador', papeis: ['conselheiro', 'instrutor', 'diretoria'] , grupo: 'pessoas' },
  { to: '/mensalidades', icon: '💰', titulo: 'Mensalidades', desc: 'Controle de pagamentos', papeis: ['tesoureiro', 'diretoria'], recurso: 'mensalidades' , grupo: 'clube' },
  { to: '/usuarios', icon: '👥', titulo: 'Usuários', desc: 'Resetar senha de quem não entra', papeis: ['diretoria', 'instrutor'] , grupo: 'pessoas' },
  { to: '/pontos', icon: '➖', titulo: 'Remover pontos', desc: 'Apagar lançamentos errados', papeis: ['diretoria', 'instrutor'] , grupo: 'clube', contextual: true },
  { to: '/modo-acampamento', icon: '🏕️', titulo: 'Modo Acampamento', desc: 'Lançar colocação das unidades nas provas', papeis: ['diretoria', 'instrutor'] , grupo: 'clube' },
  { to: '/chat-moderacao', icon: '💬', titulo: 'Moderação do chat', desc: 'Ver e apagar mensagens de qualquer conversa', papeis: ['diretoria', 'instrutor'], recurso: 'chat' , grupo: 'conteudo', contextual: true },
  { to: '/aprovar-missoes', icon: '🎯', titulo: 'Aprovar missões', desc: 'Aprovar as fotos das missões', papeis: ['diretoria', 'instrutor'], recurso: 'missoes' , grupo: 'avaliar', contextual: true },
  { to: '/radar', icon: '📡', titulo: 'Radar de faltas', desc: 'Quem está sumindo do clube', papeis: ['diretoria', 'instrutor'] , grupo: 'pessoas' },
  { to: '/temporada', icon: '🏁', titulo: 'Temporadas', desc: 'Zerar o ranking pra recomeçar', papeis: ['diretoria'] , grupo: 'clube', contextual: true },
  { to: '/avisos', icon: '📣', titulo: 'Enviar aviso', desc: 'Recado pro clube (aparece no sino)', papeis: ['diretoria', 'instrutor'] , grupo: 'clube' },
  { to: '/conteudo', icon: '📖', titulo: 'Conteúdo', desc: 'Versículos e desafios das missões', papeis: ['diretoria', 'instrutor'] , grupo: 'conteudo', contextual: true },
  { to: '/jogos-trilha', icon: '🎮', titulo: 'Jogos da Trilha', desc: 'Ativar os jogos pra criançada', papeis: ['diretoria', 'instrutor'], recurso: 'jogos' , grupo: 'conteudo', contextual: true },
  { to: '/atividade-jogos', icon: '📊', titulo: 'Atividade dos jogos', desc: 'Quem jogou hoje e quem sumiu', papeis: ['diretoria', 'instrutor'], recurso: 'jogos' , grupo: 'conteudo', contextual: true },
  { to: '/vinculos-pais', icon: '👨‍👩‍👧', titulo: 'Vínculos dos pais', desc: 'Confirmar quem é filho de quem + PIX', papeis: ['diretoria', 'instrutor'] , grupo: 'pessoas', contextual: true },
  { to: '/clube', icon: '🎨', titulo: 'Identidade e recursos', desc: 'Nome, cores e logo do clube; o que o clube usa', papeis: ['diretoria', 'instrutor'] , grupo: 'clube', contextual: true },
  { to: '/planos', icon: '💳', titulo: 'Plano do clube', desc: 'O que está incluído e quanto já está sendo usado', papeis: ['diretoria', 'instrutor'] , grupo: 'clube', contextual: true },
  { to: '/experiencias/novo', icon: '🛠️', titulo: 'Montar experiências', desc: 'Desafios, campanhas e temporadas, sem programar', papeis: ['diretoria', 'instrutor'], recurso: 'experiencias' , grupo: 'conteudo', contextual: true },
  { to: '/avaliar-classe', icon: '🎖️', titulo: 'Avaliar classes', desc: 'Aprovar ou pedir correção dos requisitos enviados', papeis: ['diretoria', 'instrutor'], recurso: 'classes' , grupo: 'avaliar', contextual: true },
  { to: '/investiduras', icon: '🏅', titulo: 'Revisão final e investidura', desc: 'Revisar conclusões de classe e registrar investiduras', papeis: ['diretoria', 'instrutor'], recurso: 'classes' , grupo: 'avaliar', contextual: true },
  // Especialidades têm recurso PRÓPRIO, separado de `classes` (fase 9, item 9): o catálogo de especialidades ainda é de teste
  // e fica fora do piloto. Com `classes` ligado e `especialidades` desligado, este card some e a rota não abre.
  { to: '/avaliar-especialidades', icon: '🏅', titulo: 'Especialidades', desc: 'Criar turmas e avaliar requisitos enviados', papeis: ['diretoria', 'instrutor'], recurso: 'especialidades' , grupo: 'avaliar', contextual: true },
]

// ---- fase 7: agrupamento e progressive disclosure ----
// `grupo` organiza a tela de Gestão em 4 blocos em vez de uma parede de 21 cards (4,6 telas de
// rolagem a 360px, medido na auditoria). `contextual: true` marca a ferramenta que passou a ter a
// sua entrada natural DENTRO da tela do assunto (ex.: "Aprovar missões" vive em Missões). Ela NÃO
// sai do produto nem perde a rota: deixa de ocupar a primeira tela e fica em "ver todas".
export const GRUPOS_GESTAO = [
  { chave: 'avaliar', titulo: 'Avaliar', icone: '🔎', desc: 'Tudo o que espera a sua avaliação' },
  { chave: 'pessoas', titulo: 'Pessoas', icone: '👥', desc: 'Quem entra, quem pontua, quem sumiu' },
  { chave: 'clube', titulo: 'Clube', icone: '🏕️', desc: 'Dinheiro, avisos e configuração' },
  { chave: 'conteudo', titulo: 'Conteúdo', icone: '📖', desc: 'O que o clube publica e libera' },
]

// Índice rápido: rota -> papéis autorizados (derivado da lista acima)
export const PAPEIS_POR_ROTA = Object.fromEntries([
  ...FERRAMENTAS.map((f) => [f.to, f.papeis]),
  // fase 7: a fila ÚNICA de avaliação (reúne o que antes eram 6 cards espalhados em Gestão)
  ['/gestao/avaliar', ['diretoria', 'instrutor']],
  // Classes + Especialidades numa central de trabalho só (Etapa 3 desta rodada).
  ['/gestao/avaliacoes', ['diretoria', 'instrutor']],
  // Gestão → Inscrições: mesmos papéis que já geravam o código dentro de Aprovações.
  ['/gestao/inscricoes', ['diretoria', 'instrutor']],
])

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
  '/experiencias': 'experiencias',
  '/minha-classe': 'classes',
  '/minhas-especialidades': 'especialidades',   // não 'classes': ligar as Classes oficiais não pode abrir as especialidades de teste
  ...Object.fromEntries(FERRAMENTAS.filter((f) => f.recurso).map((f) => [f.to, f.recurso])),
})
