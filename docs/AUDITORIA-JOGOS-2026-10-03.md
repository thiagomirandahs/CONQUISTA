# Auditoria dos jogos — 03/10/2026

Escopo: frontend do CONQUISTA/DesbravaClube, catálogo de 31 jogos, quatro versões clássicas de reserva e integração com a Trilha. Base do repositório: a798a0c; primeira correção remota do caça-palavras: 5db8609. Branch: fix/caca-palavras-responsivo.

## Achados e correções

| Achado | Efeito | Correção |
| --- | --- | --- |
| Caça-palavras: células quadradas recebiam a altura mínima de 44px em telas de toque | O tabuleiro 8×8 ultrapassava o card e cortava a última coluna | Grade com minmax(0, 1fr), largura fluida e exceção alvo-livre só nas células |
| Campo Minado e Forca tinham o mesmo padrão de células/teclas | Risco de ultrapassar a largura em telas pequenas | Mesma contenção aplicada localmente às células/teclas; controles gerais mantêm a regra de toque |
| Anagrama e Morse: input flexível com tamanho mínimo intrínseco | O campo podia empurrar Conferir para fora | min-w-0 no input e shrink-0 no botão |
| Hanói: discos com largura fixa de até 90px | Em telas estreitas, os discos podiam ultrapassar o próprio pino | maxWidth: 90% e min-w-0 no pino |
| Termo: dez teclas com largura mínima fixa | A soma das larguras mínimas com espaçamento podia ultrapassar a linha | Teclas podem encolher dentro da largura disponível |
| Temporizadores sem cleanup em 16 jogos clássicos e Cobrinha Phaser | Resultados/rodadas/flashes podiam continuar depois de desmontar a partida ao sair ou trocar de tela | useGameTimeout cancela todos os callbacks pendentes no unmount |
| Campo Minado: cascata não respeitava casas com bandeira | Casa marcada era aberta automaticamente sem remover a bandeira do contador | Casas marcadas são excluídas da cascata |

## Validação

- 152 testes passaram: módulos de jogos, Trilha, trava de conclusão duplicada e fila de resultados offline.
- Cinco regressões novas: Forca e Conta Rápida não concluem após unmount; Sequência cancela flashes; agendador cancela callbacks encadeados e funciona com StrictMode; cascata do Campo Minado respeita bandeiras e o primeiro toque permanece seguro.
- Chromium headless com viewport móvel e toque: 35 variantes em 320, 360, 393 e 430px, total de 140 combinações únicas. Nenhuma ultrapassou a largura da página/card nos estados verificados e nenhum pageerror foi registrado.
- Em 320px também houve interação inicial com Campo Minado, Forca, Termo, Anagrama, Morse e início dos jogos Phaser (exceto Reflexo). As demais medições são de abertura/tela inicial.
- Captura do caça-palavras em 393px inspecionada visualmente: as oito colunas estão dentro do card.
- ESLint dos jogos: zero erros e dez avisos (já havia onze antes da alteração). Avisos restantes incluem recomendações de hooks/compilador e código existente, não são evidência de falha funcional.
- Build passou com URL/chave fictícias de validação; não usa nem verifica configuração de produção.

## Limites da auditoria

A conferência no Chromium monta os componentes em um main com o CSS real e LazyMotion. O componente de ajuda foi substituído por um stub; não foi usada sessão autenticada nem feita gravação no Supabase de produção. A abertura e algumas interações iniciais não comprovam todas as fases/possibilidades de cada jogo. Os testes de cancelamento e da cascata exercitam os comportamentos descritos acima.

Não foram executadas partidas completas de todos os jogos no APK Android, testes SQL de pontuação/RLS ou uma auditoria de conteúdo pedagógico/médico. A verificação final no aplicativo do usuário permanece necessária.

## Publicação

Não há migration nem SQL nesta alteração. Integrar fix/caca-palavras-responsivo na branch que publica o aplicativo e executar o deploy/OTA habitual. Atualizar o aplicativo só mostra a melhoria depois de publicada a versão com estes arquivos.
