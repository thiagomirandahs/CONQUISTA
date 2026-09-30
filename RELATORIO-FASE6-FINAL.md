# RELATÓRIO FINAL — FASE 6 (refinamento do DesbravaClube) · 30/09/2026

**HEAD INICIAL:** `d908e78` (main publicada) · **HEAD FINAL:** `eae4afc` · branch `fase-6-refinamento` (worktree `frosty-bouman-a116c9`)

## COMMITS CRIADOS (17, em ordem)
f46ec03 safe-area · 03c0d5f auditoria · 40366bd erros amigáveis (50 telas) · b5375b5 Admin P0 + URL · 971a94d design system · bba69ee traduções de erro · a824028 /conheca · 0c61188 app P1 (Início, Minha Classe, sino, Meu Filho) · b1c5a1e Rede foto/avatar + migration 500 · 05988e8 wip (pausa 1) · bb48203 onboarding sem chaves internas · d7e86d5 migration 501 · 3ac2d4a wip (pausa 2) · f13bdbc roteiros dos vídeos · 07e6054 Admin desktop + mini-tours · d132e2c Rede visual · eae4afc script de produção 500+501.
(Os dois `wip` foram pausas a pedido do dono; o conteúdo deles foi concluído e testado nos commits seguintes.)

## DESIGN SYSTEM (`src/ui`, doc em `src/ui/README.md`)
- **ItemLista/GrupoLista** ✅ (ícone, título, descrição, info à direita, seta, badge, desabilitado, ≥44px; `Eu` já usa)
- **MenuAcoes** ✅ (⋯; Folha no celular, popover no PC; perigo separado; Esc/foco/setas)
- **Chip** ✅ (aria-pressed, contador, 44px)
- **ZonaUpload** ✅ (vazio/selecionado/enviando/erro/concluído, trocar/remover, acessível) — criado e testado; adoção nas telas marcada com `// Fase 6: trocar por ZonaUpload`
- **CabecalhoSecao** ✅ · **FilaDePopups** ✅ (um popup por vez, prioridade, não reabre na sessão; ligada em tour/avisos/devocional/próximo evento)

## REDE DBV
- **foto:** ✅ continua só com autorização arquivada, bucket privado, URL assinada · **avatar-personagem:** ✅ aparece entre clubes; foto antiga nunca vaza (migration 500) · **autorização:** ✅ `imagem_autorizada` só para o próprio; aviso na moderação de que a lista nasce desligada · **E2E:** ✅ `npm run test:rede:e2e` 49/49 (outro clube vê foto autorizada; sem autorização não; revogação bloqueia; personagem; caminho forjado negado; clube sem recurso; anon)
- **visual:** ✅ tokens `--rede-*` claro/escuro (sem override hex a hex), sem azul/roxo do Instagram · **perfil:** ✅ clube/unidade, selos marinho/dourado, aba dourada · **stories:** ✅ anel dourado→âmbar, "+" marinho, esqueleto · **posts:** ✅ "Clube · há 8 h" (unidade quando a RPC trouxer), selos 🏅/🎯, "12 curtidas · 3 comentários", esqueleto no formato · **busca:** ✅ vazio útil + esqueleto
- Nota: dourado do tema claro ajustado para `#b08a1e` (contraste 3,2:1); tema escuro `#e0b84a`. É uma variável, fácil de trocar se não agradar.

## APP
- **Início** ✅ cartão "Minha classe X% · Continuar", faixa de agenda, vazio correto com 0%, atalhos sem repetir o menu
- **Minha Classe** ✅ envio 44px primário, rascunho discreto, comentário do avaliador em destaque, estados em Selo, Progresso, Folha, "Mais" (Ouvir/origem/catálogo — audiolivros mantidos)
- **Notificações** ✅ Folha, fechar 44px, erro amigável · **Meu Filho** ✅ confirmação ao revogar, sucesso, erro amigável
- **erros amigáveis** ✅ 50 telas via `mensagemDeErro` (+2 traduções úteis) · **popups** ✅ fila única

## ADMIN
- **P0 assinatura** ✅ suspender/cancelar/inadimplente = botão perigo + confirmação com clube, status atual → novo, impacto, motivo
- **sidebar desktop** ✅ (14 seções, ativa em dourado) · **mobile** ✅ gaveta ☰ (Esc, foco) · **URLs** ✅ `?aba=` sincronizada (voltar/avançar/link direto)
- **visão geral** ✅ só `admin_visao_geral` + `admin_chamados_contagem` (sem MRR/receita/série) · **clubes** ✅ tabela ≥md com busca/chips/ordenação/25 por página; cartões no celular · **detalhe** ✅ sub-abas Resumo/Assinatura/Uso/Recursos/Auditoria/Zona de perigo · **tabelas/filtros** ✅ Assinaturas, Auditoria (carregar mais), Suporte (nome do clube + data + confirmação), Chamados (2 painéis), Onboarding, Armazenamento; Manutenção/Rede-para-todos/Hierarquia sem `window.confirm`

## TUTORIAL
- **Primeiros passos** ✅ · **Classes** ✅ · **Rede** ✅ (passos prontos; gatilho pelo hook `useTourDaArea('rede')`) · **Gestão** ✅ (diretoria/instrutor) — todos com Próximo/Voltar/Pular/Concluir, rever em /ajuda, BotaoAjuda em Início, Minha Classe, Rede, Gestão; tópico `rede-dbv` na ajuda; campo `video` opcional nos tópicos

## APRESENTAÇÃO
- estrutura pronta: **SIM** (`/conheca`, 8 etapas, VideoCurto com poster/play manual/youtube-nocookie, fora do bundle)
- roteiros dos vídeos: **SIM** (`ROTEIROS-VIDEOS-FASE6.md`, 12 vídeos — aguardam aprovação)
- vídeos produzidos: **NÃO**

## SAFE AREA
- preservado: **SIM** (4 lados + regra global; `src/lib/safeArea.test.js`). Checklist físico pendente: Android 3 botões, gestos, notch, PWA iPhone, 360/390/430.

## GATES (30/09)
- SQL: **108/108** · UPGRADE: **120 asserts ok** · VITEST: **1229/1229** (129 arquivos) · ESLINT: **0 erros** (102 warnings pré-existentes) · BUILD: **ok** (28,6 s) · CSP/AMBIENTE: **ok** · CURRÍCULO: **ok** (manifesto 2026.4 íntegro) · EDGE: **ok** (bundle + pdf) · E2E Rede: **49/49**

## MIGRATIONS NOVAS
- `20260930000500_rede-dbv-avatar-personagem.sql` (RPCs devolvem personagem; foto null quando personagem; `imagem_autorizada` só p/ eu) + teste 110
- `20260930000501_rede-foto-personagem-fecha-arquivo.sql` (Storage nega arquivo de quem usa personagem — só restringe) + teste 111
- Script de produção: `scripts/aplicar-500-501-producao.sql` (idempotente, guarda de ledger 491–501, ensaiado 1x numa cópia local)

## PRODUÇÃO ALTERADA: **NÃO** · PUSH: **NÃO**

## PENDÊNCIAS
1. Decisões do dono: aprovar roteiros (quem grava, canal do YouTube); confirmar o tom do dourado; aprovar merge/push e aplicação de 500+501.
2. Teste físico de safe-area e telas em 360/390/430/tablet/desktop (não houve navegador nesta rodada — validação por testes).
3. Adoção de `ZonaUpload`/`MenuAcoes` nas telas marcadas com `// Fase 6:` (Minha Classe, Mural, Missões, Experiências).
4. "Unidade" no subtítulo do post exige a RPC devolver `unidade` (mudança de SQL futura, não feita de propósito).
5. Mini-tour da Rede: hook pronto, gatilho na tela da Rede fica para a próxima rodada.
6. `TesteGratuito › encerrar` (Admin) ainda usa `window.confirm` (fora do escopo pedido).
7. Termo de uso: registrar que a URL assinada de foto vale até 24 h após revogação; consentimento de imagem hoje é só o booleano `arquivada` (sem data/versão do termo).

## BUGS REAIS ENCONTRADOS (separados das melhorias de UX)
1. **Rede DBV — foto:** RPCs não devolviam avatar-personagem e podiam expor foto antiga de rosto de quem escolheu personagem (corrigido, 500).
2. **Rede DBV — privacidade:** `rede_perfil` expunha `imagem_autorizada` (flag de consentimento de criança) a qualquer visitante (corrigido, 500).
3. **Rede DBV — Storage:** membro de outro clube podia abrir `perfis/<uid>-x.jpg` de quem usa personagem, montando o caminho, se a autorização estivesse arquivada (corrigido, 501 — só restringe).
4. **Rede DBV — "eu" incoerente:** barra e anel de story usavam a foto do Auth sem o gate (corrigido).
5. **Admin — P0:** suspender/cancelar assinatura sem destaque nem confirmação (corrigido).
6. **Admin — URL:** seção só lida na primeira carga; voltar/avançar não funcionava (corrigido).
7. **Safe area:** conteúdo escondido até 20 px atrás do menu inferior em aparelhos com barra de gestos/3 botões; 3 cabeçalhos e ~45 modais sob a barra de status (corrigido).
8. **Onboarding:** mensagem de erro vazava chaves internas de etapa (corrigido).
9. **Início:** vazio dizia "Você está em dia!" com classe a 0% (corrigido).
