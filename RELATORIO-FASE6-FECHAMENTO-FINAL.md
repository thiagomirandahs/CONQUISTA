# FASE 6 — FECHAMENTO FINAL (relatório pré-deploy · 30/09/2026)

**HEAD INICIAL (Fase 6):** `d908e78` · **HEAD do briefing desta rodada:** `eae4afc` (havia `313c5e4` com o relatório) · **ORIGIN/MAIN:** `d908e78` (nada publicado)
**HEAD FINAL:** ver última linha do `git log` (commit deste relatório) · branch `fase-6-refinamento` · **34 commits** à frente da `main`.

> ⚠️ **DRIFT DE PRODUÇÃO (aguardando resposta do dono):** o briefing dizia que as migrations 500 e 501 NÃO estavam em produção, mas a leitura
> somente-leitura mostra o ledger em **`20260930000501`** e a função `_rede_pode_ver_foto_perfil` já com a regra do personagem. Não fui eu
> (todos os meus comandos usaram o Docker local; o E2E recusa qualquer host fora de 127.0.0.1; 0 usuários de teste em produção). Hipótese: o
> dono rodou `scripts/aplicar-500-501-producao.sql`. **Pergunta em aberto: você rodou esse script?** Se NÃO, investigar antes de qualquer coisa.
> As duas migrations só RESTRINGEM privacidade e o Tenant 001 está íntegro, então não há dano observado.

## COMMITS NOVOS DESTA RODADA (desde `313c5e4`)
773d310 roteiros rev.2 · c96683c Admin sem `window.confirm` · 1ea3b28 (wip, hoje VALIDADO) adoção ZonaUpload/MenuAcoes + tour da Rede + migrations 502/503 ·
03fb54d evidência · 64efdb8 teste do menu ⋯ · b19bc35 desenho do consentimento + teste 113 · d43a969 tabela/alvos de toque · 915dd0a legenda 12px ·
e85e62f **Folha prende o foco** · ea219fb + 6b5b6b4 título da Rede (o 1º ficou com 1 teste vermelho por erro meu; o 2º corrige — HEAD verde) ·
95367b5 /conheca · a94a83c login 44px · 67ba6d3 escopo da Fase 7 · 8f9d66d **teste SQL 93 determinístico** · b41d2d9 script 502+503 + 2ª leitura de produção.

## MIGRATIONS
- **Já em produção (drift):** 500 (avatar-personagem) e 501 (arquivo do personagem fechado entre clubes).
- **A PUBLICAR, nesta ordem:** **502** `rede-unidade-no-post` → **503** `rede-consentimento-imagem-auditavel`, pelo `scripts/aplicar-502-503-producao.sql`
  (idempotente, sem transação/temp table, guarda de ledger 501–503). Ambas aditivas: 502 = `create or replace` de 2 funções; 503 = tabela nova
  append-only + coluna `versao_termo` nula + gatilhos + RPC de leitura da diretoria. **Nenhum delete/truncate/drop de dado** (só `drop trigger if exists` dos próprios gatilhos).

## DESIGN SYSTEM
- **ZonaUpload: OK** — adotada em MinhaClasse, Mural, Missões, Experiências e MinhasEspecialidades; restam `input type=file` crus em Atividades, Perfil, Suporte, Unidades, ClubeConfig, Cadastro, DocumentoDaIdade e AdminChamados/AdminVitrine (fora do escopo pedido).
- **MenuAcoes: OK** — adotado onde há menu contextual claro (Minha Classe: Ouvir livro / catálogo / histórico / origem; áudios mantidos). Só há 1 uso.
- ItemLista/GrupoLista: usados em Eu. **Chip e CabecalhoSecao: criados e testados, sem adoção em telas** (não houve correspondência 1:1 que justificasse trocar). FilaDePopups: ligada em tour, avisos, devocional e próximo evento. Nenhum marcador `// Fase 6: trocar…` restante.

## REDE DBV
Foto autorizada **OK** · Personagem **OK** · Revogação **OK** · Storage privado **OK** · Path forjado **OK** (E2E 55/55) ·
**Unidade no post: OK** no servidor (teste 112, 31 asserts: mesmo clube, outro clube, sem unidade, coordenação, suspenso, encerrado, unidade de outro clube, anônimo, chaves do JSON sem vazamento) e no front por testes; **não visto ao vivo com um post real** (o banco local não tem posts) ·
**Tour: OK** (visto ao vivo: 5 passos; Pular no 1º; Voltar/Próximo/Pular tour nos 2–4; Voltar/Concluir no 5º; marca "visto"; não reaparece; funciona no tema escuro).

## CONSENTIMENTO DE IMAGEM
- **Estado atual:** 1 linha por criança/clube com `arquivada` (booleano da diretoria) + recusa do responsável; cada mudança **sobrescreve**. Só existe a trilha genérica `auditoria_operacoes` (só o admin da plataforma lê, janela curta). Sem versão do termo, sem histórico imutável para a diretoria.
- **Auditoria implementada: SIM (migration 503)** — histórico append-only por gatilho (quem, papel, origem, antes/depois, data), `versao_termo` nula, leitura só pela RPC da diretoria/admin; revogar **nunca** apaga histórico. Validada no banco (teste 113, 59 asserts) e no ensaio; **não aplicada em produção**. Detalhes: `CONSENTIMENTO-IMAGEM-DESENHO.md`.
- **Limitação da URL assinada (verificada no código, não suposta):** foto de **perfil/avatar = 24 h** (`VALIDADE_S`, `src/lib/imagens.js:20`; o cache do aparelho reaproveita a URL até faltarem 2 h); foto de **post = 10 min** (`services/comunidade.js:89`). Revogar impede URLs novas na hora; a já emitida vale até expirar.
- **Hoje em produção:** `rede_autorizacao_imagem` está **vazia** → nenhum rosto é exibido na Rede.
- **Próximo passo jurídico/técnico:** texto do termo (jurídico) → versão em `versao_termo`; tela do histórico para a diretoria; decidir encurtar a validade da foto de perfil.

## SAFE AREA
Medido no navegador de teste (variáveis `--safe-area-inset-*` simuladas; conteúdo do topo começa na borda; menu 58 px acima do fim com barra de 48 px; folha com o botão 20 px acima da barra; último item da rolagem 30–57 px acima do menu):
360 **OK** · 390 **OK** · 430 **OK** · Tablet 768 **OK** · Desktop 1024/1366 **OK** ·
Android 3 botões: **SIMULADO** (48 px), **NÃO TESTADO em aparelho** · Android gestos: **NÃO TESTADO** (mesmo mecanismo, ~24 px não simulado à parte) · Notch/câmera: **SIMULADO** (32 px), **NÃO TESTADO em aparelho** · iPhone/PWA: **NÃO TESTADO** · Teclado virtual: **NÃO TESTADO**.

## APP (varredura de rolagem lateral + alvos < 44 px + texto < 12 px)
35 rotas do membro × 6 larguras + `/conheca`, `/ajuda`, `/adquirir` + login + Meu Filho (responsável): **sem rolagem lateral em nenhuma**.
Início **OK** · Minha Classe **OK** (varredura + testes; envio 44 px, correção visível, menu ⋯) · Rede **OK** (claro e escuro) · Gestão **PARCIAL** (vista só como membro/plataforma; **não como diretoria**) · Meu Filho **OK** · Notificações **OK** (folha, teclado real, foco preso e devolvido) · Ajuda **OK**.
Observações registradas (não bloqueiam): iniciais de avatar de 28 px usam 10 px (decorativo); pontos de progresso do /conheca com 32×44 px (WCAG 2.2 ok; regra do projeto é 44).

## ADMIN (18 seções × 6 larguras)
Desktop **OK** (menu lateral com 14 seções, tabela com busca/chips/ordenação/25 por página — visto em 1366) · Mobile **OK** (gaveta, cartões) · URLs **OK** (`?aba=` navegável por histórico; testes) ·
Confirmações destrutivas **OK** (nenhum `window.confirm` restante; testado por vitest, **não clicado ao vivo**) · Acessibilidade **PARCIAL** (teclado real validado só na Folha; sidebar/drawer/MenuAcoes por testes automatizados).

## APRESENTAÇÃO
Conheça **OK** (sem overflow em 360–1366; identidade correta) · 12 roteiros **OK** (rev.2 com "o que NÃO mostrar" e dados fictícios por vídeo) · Vídeos produzidos **NÃO**.

## GATES (todos no HEAD funcional `8f9d66d`; `b41d2d9` só acrescenta docs/script/evidência)
SQL **110/110** · Upgrade **120 asserts** · Vitest **1251/1251** (worktree) e **1248 + 3 puladas** no **clone limpo** (as 3 dependem de `dist/`; depois do build, `cspContrato` **20/20**) ·
ESLint **0 erros** (102 warnings pré-existentes) · Build **OK** (worktree; clone com `build:vercel` incl. pacote OTA, 49 s) · CSP/Ambiente **OK** · Currículo **OK** (2026.4 íntegro) · Edge **OK** (2 funções) · Rede E2E **55/55**.
- **Clone limpo** (`git clone` da branch em pasta curta): `npm install` sem alterar `package-lock.json`. O build de produção **sem** `VITE_SUPABASE_URL` recusa subir **de propósito** (fail-closed); com uma URL fictícia passa.
- **Ensaio das migrations:** banco no estado da produção (até a 501) + script 502/503 aplicado **2×** (idempotente, ledger com exatamente 2 linhas novas) + testes 100/110/111/112/113 verdes. **Não foi sobre cópia real dos dados de produção** (não há backup restaurável disponível aqui); a produção é pequena (51 perfis, 8 posts, 0 autorizações) e as migrations são aditivas.

## PRÉ-DEPLOY — LEITURA DE PRODUÇÃO (somente leitura, 2×, idênticas)
Ledger 501 · Tenant 001 "Filhos da Conquista" ativo, 30 vínculos ativos/1 encerrado · 4 clubes, 3 distritos, 1 região · assinaturas: ativa 1, cancelada 1, trial 2 · Rede ligada em 4 clubes · Storage: comprovações 58, comunidade 6, imagens 361 (461 MB), público 4 · mensalidades 37 · posts da Rede 8 · manutenção desligada. Sem drift além do 500/501 já aplicado.

## PRODUÇÃO ALTERADA: **NÃO** (por mim) · PUSH: **NÃO**

## BUGS REAIS × MELHORIAS
**Bugs reais (produto):** (1) `Folha` (modal) **não prendia o foco do teclado** — Tab escapava para a página de trás (corrigido, teste falha na versão antiga); (2) tabela do Admin **esticava a página ~7 px** em 768/1024 (`sr-only` fora do `relative`) (corrigido); (3) título "Rede DBV" **quebrava em 2 linhas** em 360 px (corrigido); (4) alvos de toque < 44 px: ordenar, arrastar, "Ver →", remover palavra, passo-a-passo do /conheca, botão Entrar (corrigidos); (5) legenda de 11 px no Perfil (corrigida).
**Bugs de teste (não de produto):** teste SQL **93 instável** — sorteava requisitos por UUID aleatório e, ao cair num dos 4 que exigem foto de documento (migration 380), falhava (~1 em 8); fixture agora determinística, **25/25** (classificação: FIXTURE INCORRETA) · teste SQL **113**: `reset role` não limpa o JWT da sessão (FIXTURE INCORRETA) · teste da Minha Classe esperava o toggle "Mais" antigo (TESTE DESATUALIZADO) · infra: contêineres de Storage/Edge do Docker local estavam parados (INFRA/AMBIENTE; religados).
**Achados de privacidade nesta rodada: nenhum novo.** (Os 3 da rodada anterior seguem corrigidos na 500/501, já em produção.)

## PRONTO PARA DEPLOY: **SIM, tecnicamente — com 1 pendência sua**
**Blocker único:** confirmar a origem da aplicação de 500/501 em produção (pergunta acima).
**MIGRATIONS A APLICAR (ordem):** 502 → 503 (`scripts/aplicar-502-503-producao.sql`, no SQL Editor, depois de você autorizar). O front funciona sem elas (unidade cai para "Clube · há X"; a 503 não tem uso no front), então a ordem entre push e script é indiferente; sugerido: script primeiro, push depois.
**HEAD A PUBLICAR:** o HEAD da branch `fase-6-refinamento` após este relatório (34+1 commits sobre `d908e78`).
**Depois de publicar:** teste no celular (Android 3 botões e gestos, câmera/notch, teclado, iPhone/PWA) — é o que falta para trocar os "NÃO TESTADO".

## PRÓXIMA FASE (não iniciada) — ver `FASE-7-ESCOPO-RECOMENDADO.md`
Fase 7 — Conteúdo e Comunidade: A) Classes com relatório estruturado; B) Especialidades com manifesto oficial; C) Rede/Comunidade (perfil, moderação, consentimento auditável, segurança infantil); D) vídeos e apresentação (após aprovar os roteiros).
