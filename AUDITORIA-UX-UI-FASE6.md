# AUDITORIA UX/UI — FASE 6 (29/09/2026)

Branch `fase-6-refinamento` · HEAD inicial `d908e78` · produção NÃO alterada.
Auditoria só-leitura feita antes de mexer nas telas (regra da Fase 6.2). Formato: ATUAL · PROBLEMA · PROPOSTA · PRIORIDADE · RISCO · COMPONENTE.

## 0. Resumo executivo

| Área | Telas auditadas | Achado principal |
|---|---|---|
| Safe area | 69 elementos fixos/flutuantes | Só 11 respeitavam a folga; 3 cabeçalhos de layout e ~45 modais/folhas ignoravam a barra do sistema. **Corrigido em f46ec03** (regra global de CSS + 4 lados). |
| App do membro | 66 páginas + `src/ui` | Design system bom, mas pouco usado: 32 páginas com cabeçalho próprio, ~50 com cartão próprio, 16 páginas + 13 componentes com modal próprio, **45 arquivos mostram erro cru do servidor** (`e.message`). |
| Início | 1 | Não responde "o que tenho para fazer hoje?": sem % da classe fixo, sem avisos; grade "Ir para" repete o menu de baixo. |
| Admin SaaS | 14 telas (um arquivo, `Admin.jsx`, 1077 linhas) | Página de celular esticada: sem sidebar, sem tabela, sem paginação, seção fora da URL. **Suspender/cancelar assinatura sem destaque nem confirmação (P0).** |
| Rede DBV / tutorial / ajuda | 12 áreas | Rede copia o Instagram 1:1 (azul #3b5bff, gradiente roxo); azul-marinho/dourado não aparecem em nenhum arquivo da Rede. Tour: 4 passos genéricos, sem Voltar, não cobre Rede/Classes/Gestão. /ajuda sem espaço para vídeo; nenhum vídeo no bundle. |
| Foto na Rede DBV | cadeia inteira | **Não é bug de URL/bucket.** A Rede reusa o mecanismo oficial (`useImagem` + URL assinada). Foto some por 2 causas: (1) o servidor só devolve `foto` se a diretoria marcou autorização de imagem arquivada, que nasce DESLIGADA para todos; (2) a Rede ignora o avatar-personagem que muita gente usa no clube. |

## 1. Safe area (6.1) — FEITO

Regra do dono: o app ocupa só o espaço entre as barras do sistema, sem faixa artificial, sem valor fixo.

| O que | Onde | Estado |
|---|---|---|
| Variáveis `--seguro-topo/baixo/esq/dir` = max(env(), Capacitor) | `src/index.css` | ✅ (esq/dir novas) |
| Regra global: `.fixed.inset-0.items-end > *` ganha `padding-bottom` da barra de navegação; `.fixed.inset-0:not(.items-end)` nunca encosta em nenhuma barra | `src/index.css` | ✅ cobre os ~45 modais/folhas sem tocar em cada um |
| Cabeçalhos fixos: LayoutConta, Admin (header + sub-nav + menu), Landing, Manutenção, RedeBuscar/RedePublicar (sticky top-14), Notificações (pt-16) | vários | ✅ |
| Conteúdo rola acima do menu: AppLayout `pb = 7rem + folga`, LayoutRede `6rem + folga` (antes valor fixo; escondia até 20px do último item) | AppLayout, LayoutRede | ✅ |
| APK: folga nativa por insets reais + cor do tema via ponte `DesbravaBarras` | MainActivity, `lib/nativo.js` | ✅ (1.3.8) |
| Teste | `src/lib/safeArea.test.js` | ✅ 4 testes |
| Falta testar em aparelho | Android 3 botões, gestos, notch, PWA iPhone, 360/390/430 | ⏳ depende do dono |

## 2. App do membro (6.2 / 6.4 / 6.5)

### 2.1 Inventário do design system (`src/ui`)
Existem: `Cabecalho`, `Card`, `CardAcao`, `Botao` (5 variações), `Campo`, `Selecao`, `Carregando`/`EsqueletoTela`, `Vazio`, `Aviso` + `mensagemDeErro`, `Selo`, `Progresso`, `Abas`, `Folha` (bottom sheet/dialog), `useToast`/`useConfirmacao`/`avisar`.
Faltam: `ItemLista` (linha de configurações — o padrão de `Eu.jsx:232-273` é o candidato), `MenuAcoes` (⋯), `Chip` (filtro alternável), `ZonaUpload` (caixa tracejada, repetida em 4 telas), `CabecalhoSecao`, `FilaDePopups`.

### 2.2 Uso real
- `Cabecalho`: 8/66 páginas. 32 fazem `<h2 class="text-2xl…">` próprio.
- `Botao`: 27/66. Botões crus: Usuarios 21, MinhaClasse 15, Atividades 14, Mural 14…
- Cartão próprio em vez de `Card`: ~50/66.
- Modal próprio (`fixed inset-0`) em vez de `Folha`: 16 páginas + 13 componentes.
- **Erro cru** (`e?.message` na tela) em 45 arquivos — pula o `mensagemDeErro`.
- "Carregando…" em texto (sem esqueleto): Mural, Missoes, Trilha, MinhaClasse.
- Texto < 12px: JogosTrilha, Agenda, Unidades, Ranking. Alvo < 44px: MinhaClasse:535 (botão principal "Enviar para avaliação" com 36px), Experiencias:248, Notificacoes:128 (fechar 28px).

### 2.3 Por tela

| Tela | ATUAL | PROBLEMA | PROPOSTA | PRI | RISCO | COMPONENTE |
|---|---|---|---|---|---|---|
| Início | saudação + até 3 cartões do `meu_inicio` + grade "Ir para" | sem % da classe fixo; sem avisos; vazio diz "está em dia" com classe a 0%; grade repete o menu | cartão fixo "Minha classe X% · Continuar →"; faixa de avisos/agenda; tirar Jornada/Clube da grade | **P1** | baixo | `CardAcao`+`Progresso`; novo `ResumoDoDia` |
| Minha Classe | cabeçalho, abas, progresso, requisitos com formulário embutido | botão principal 36px e sem hierarquia com "rascunho"; comentário do avaliador escondido em "histórico"; cada requisito mostra Ouvir + catálogo + origem; 4 erros crus; modal próprio | `Botao` primário largo; comentário do avaliador em `Aviso` inline; Ouvir/origem/catálogo em `MenuAcoes`; estados com `Selo` (Concluído · Aguardando · Correção · Disponível · Bloqueado) | **P1** | médio (6 arquivos de teste) | `Botao`,`Aviso`,`Progresso`,`Abas`,`Folha`,`MenuAcoes`,`ZonaUpload` |
| Notificações (sino) | modal próprio ancorado no topo | fechar 28px; "Erro: "+cru; cara de dropdown de PC | `Folha` + `mensagemDeErro` | **P1** | baixo | `Folha` |
| Meu Filho | dados + consentimento | 4 erros crus; revogar sem confirmação nem retorno | `mensagemDeErro`, `avisar.confirmar`, `avisar.sucesso` | **P1** | baixo | `Aviso`,`useConfirmacao` |
| Tutorial + popups | tour próprio + Avisos + Devocional + PróximoEvento | 4 modais podem abrir em sequência no 1º acesso | fila única (1 por sessão) e `Folha` | **P1** | médio | novo `FilaDePopups` |
| Minhas Especialidades | cabeçalho próprio + lista | erros crus; duplica `Requisito` de MinhaClasse | `Cabecalho`, `Aviso`, `RequisitoItem` compartilhado | P2 | médio | `RequisitoItem` |
| Catálogo Especialidades | busca + lista | erro cru; busca não é `Campo`; esqueleto de tela inteira | `Campo` busca, `Carregando`, `Vazio` | P2 | baixo | |
| Trilha (jogos) | cabeçalho "🎮 Jogos" | mesmo nome do hub Jogos; "Carregando o jogo…" texto; ranking falha em silêncio | renomear "Trilha de jogos"; `Cabecalho`, `Carregando` | P2 | baixo | |
| Ranking · Agenda · Mural · Chat · Perfil · Experiências · Missões · Avisos | cabeçalho e modal próprios | erros crus, inputs crus, texto 10–11px, cartões demais (Perfil 6) | `Cabecalho`, `Folha`, `Campo`, `mensagemDeErro`, `Vazio` com ação | P2 | baixo/médio | |
| Hub (Jornada/Clube/Jogos) · Gestão · Eu | `Cabecalho` + `CardAcao` | referência boa; sem contadores ("2 para corrigir"); "Ver todas" sublinhado | `Selo` contador; `Botao discreto`; promover `ItemLista` | P3 | baixo | |

### 2.4 Início — dados já disponíveis
`meu_inicio` (RPC única, migrations 050/083/086/210) cobre correções, prontos p/ enviar, avaliar/aprovar, evento, experiência, especialidade, investidura, conquista. **Não cobre** % fixo da classe nem avisos recentes. Opções: (a) estender `meu_inicio` com `classe_progresso` e `aviso_recente` (`_inicio_item` já aceita `p_contador`) — migration, risco médio; (b) só front: 1 chamada `carregarMinhasClasses()` → `Progresso` — risco baixo. **Escolhido para a Fase 6: (b)**, sem migration.

## 3. Admin SaaS (6.11–6.14)

### 3.1 Layout
- Sem sidebar; header azul + coluna `max-w-5xl` (Admin.jsx:140). Em 1366px sobram ~340px vazios; em 360px o filtro de Clubes corta o texto.
- Navegação = 1 botão "☰ Seção" com 18 itens (Admin.jsx:217-267), igual no desktop. Seção não vai para a URL (só `?aba=` na 1ª carga): voltar/avançar e link direto não funcionam.
- Nenhuma `<table>`; tudo `<ul>` de cartões. Nenhuma lista pagina.

### 3.2 Por tela

| Tela | PROBLEMA | PROPOSTA | PRI | RISCO |
|---|---|---|---|---|
| Mudar status da assinatura (detalhe) | suspender/cancelar = mesmo `<select>` + botão neutro, sem vermelho, sem diálogo (Admin.jsx:748-779) | botão `perigo` + confirmação quando alvo é suspensa/cancelada/inadimplente | **P0** | baixo |
| Visão geral | sem "em teste/suspensos/cancelados" diretos, sem total de membros; config de trial misturada | KPIs de `assinaturas_por_status` + provisionamento + chamados; trial vai p/ Planos | P1 | baixo |
| Clubes | sem ordenar, paginar, filtrar por status | tabela (Clube/Status/Plano/Membros/Storage/Onboarding/Criado) ordenável, 25/página, chips de status; cartões < md | P1 | baixo |
| Detalhe do clube | ~10 blocos numa página; ações misturadas com leitura | sub-abas Resumo/Assinatura/Uso/Recursos/Auditoria/Perigo; cabeçalho fixo | P1 | médio |
| Assinaturas · Auditoria (limite 100) · Suporte (sem nome do clube, revogar sem confirmar) | sem filtro/busca/paginação | tabela + filtros + "carregar mais"; resolver clube; confirmar | P1 | baixo |
| Rede todos os clubes · Manutenção | ações em massa com estilo neutro e `window.confirm` | estilo âmbar/perigo, barra de progresso, confirmação com N | P1 | médio |
| Chamados · Onboarding · Armazenamento · Hierarquia · Recursos | sem busca; 2 painéis no desktop; total no topo; `window.confirm` | ver tabela completa da auditoria | P2 | baixo |
| Planos · Provisionamento · Lixeira | leitura | tabela | P3 | — |

### 3.3 Métricas da Visão geral — o que o backend FORNECE
`admin_visao_geral` (migration 103): `clubes_total/ativos/inativos`, `onboarding_em_andamento/concluidos`, `assinaturas_por_status` (trial/ativa/pagamento_pendente/inadimplente/suspensa/cancelada — por assinatura, não por clube), `planos_total/publicos`, `armazenamento_total_bytes`, `clubes_proximos_do_limite`, `clubes_no_limite`, `provisionamentos_pendentes`, `eventos_admin_7d`, `eventos_assinatura_7d`. `admin_chamados_contagem` (290). `admin_clubes_listar` (280): membros/limite/storage por clube (total de membros = soma no cliente). Onboarding parado = só no cliente (7 dias, Admin.jsx:931).
**NÃO existe** (não inventar): receita/MRR/churn, série temporal, membros total no servidor, cota global, usuários ativos, "parado" no servidor.

### 3.4 Ações perigosas
Excluir clube e expurgo: bem separados (zona vermelha, digitar nome/APAGAR). **Suspender/cancelar assinatura: não separado (P0).** Revogar suporte, ligar manutenção, Rede para todos: sem confirmação própria.

## 4. Foto na Rede DBV (6.7–6.9)

### CAUSA (cadeia exata)
1. RPCs da Rede devolvem `'foto', case when _rede_imagem_autorizada(autor) then pr.foto end` (`20260930000490…sql:222-232`; `rede_perfil` idem). É a MESMA URL de `profiles.foto` usada no app do clube.
2. `_rede_imagem_autorizada` (490:206-219) só é verdadeira com linha em `rede_autorizacao_imagem.arquivada = true` (interruptor da diretoria em `/rede/moderacao`, `RedeModeracao.jsx:91-98`) e sem recusa de responsável. A tabela nasce vazia → **todo membro recebe `foto: null`** até a diretoria mexer.
3. `AvatarRede` (`componentes.jsx:78-90`) → `useImagem(foto)` → URL assinada do bucket privado `imagens` (`lib/imagens.js:113`). Igual ao `Avatar.jsx` oficial, **mas sem a prop `avatarPersonagem`**, e nenhuma RPC da Rede devolve `avatar`/`avatar_tipo`. Quem usa personagem (`salvar_avatar`, migration 20260824000001) vira iniciais na Rede; pior, se tiver foto antiga gravada, a Rede mostra o rosto que o app do clube esconde.
4. Inconsistência do "eu": `LayoutRede.jsx:150` e `RedeFeed.jsx:74` usam `profile.foto` do Auth SEM o gate → a pessoa vê a própria foto na barra e no anel de story, mas iniciais no próprio perfil e nos próprios posts. Parece "foto quebrada".
5. Storage cross-club: policy `_rede_pode_ver_foto_perfil` (490:290-310) depende do header `x-clube-atual` chegar ao Postgres pelo storage-api. O front manda o header em todas as chamadas (`lib/supabase.js:39-47`). Não é a causa, mas só o teste SQL 106 cobre (não passa por HTTP) → falta E2E.
6. Cache de falha de assinatura: 1 min (`imagens.js:117-127`) → atraso de até 1 min após a diretoria arquivar. Não é causa permanente.

### CORREÇÃO (reusa o mecanismo oficial)
1. **Migration nova (>491):** `_comunidade_autor_json` e `rede_perfil` devolvem também `avatar` e `avatar_tipo` **só quando `avatar_tipo = 'personagem'`** (JSON de peças, sem rosto — não passa pelo gate). `foto` continua gateada; quando personagem, `foto = null` como no app do clube. `imagem_autorizada` em `rede_perfil` só quando `eu = true` (é flag de consentimento de criança).
2. **Front:** `AvatarRede` ganha `avatarPersonagem` e renderiza `AvatarPersonagem` primeiro (espelha `Avatar.jsx:12-14`); call sites: `componentes.jsx:232,287`, `Stories.jsx:34,52,178`, `RedePerfil.jsx:101`, `RedeBuscar.jsx:15`, `LayoutRede.jsx:97`. Fallback: iniciais em azul-marinho sobre dourado claro; skeleton circular durante a assinatura; nunca `<img>` quebrada.
3. **Coerência do "eu":** barra inferior e anel "Seu story" passam a usar o retorno gateado de `rede_perfil()`/`meu_status`, com um aviso único "sua foto aparece quando a diretoria arquivar a autorização".
4. **Onboarding da diretoria:** em `/rede/moderacao` e no /admin (ligar `comunidade`) deixar claro que a lista de autorização nasce toda desligada.
5. **E2E novo:** Rede ligada + autorização arquivada → membro de OUTRO clube assina a foto (hoje `storage-imagens.mjs:155-194` só prova o bloqueio).

### SEGURANÇA
Nada abre: rosto continua sob `_rede_imagem_autorizada` no JSON e no Storage; regex `perfis/<uuid>-` impede adivinhar caminho; fora da Rede continua bloqueado. Ponto a confirmar no teste 109: coordenador adulto pode nunca assinar o arquivo (se `_comunidade_papel` devolver null em unidade não-clube). Sem bucket público, sem policy entre clubes, sem service role.

### LACUNA DE PRIVACIDADE (documentada, não inventar consentimento)
- Único registro de consentimento de imagem = booleano `arquivada` marcado pela diretoria (sem data do papel, quem assinou, versão do termo; termo ainda em revisão jurídica).
- A 491 presume autorização dos pais para USO da Rede; criança sem responsável vinculado não tem quem diga "não". Exposição social (nome + clube + posts, cross-club) fica na presunção do papel de admissão. Decisão do dono, registrada.
- URL assinada de rosto de menor vale 24 h no aparelho mesmo após revogação (igual ao app do clube). Deve constar no termo.

## 5. Rede DBV visual, tutorial e ajuda (6.10, 6.20–6.21)

### 5.1 Rede DBV
| Área | PROBLEMA | PROPOSTA | PRI | RISCO |
|---|---|---|---|---|
| Identidade global (`componentes.jsx:11-26`) | `AZUL=#3b5bff`, gradiente azul→roxo; azul-marinho/dourado em lugar nenhum | manter o layout limpo; trocar tokens: marinho para texto/ações, dourado para acentos (anel de story, "curtido", selos). **Confirmar com o dono** (ele pediu estilo Instagram) | Alta | médio |
| Stories (`Stories.jsx:22-60`) | cópia mais literal: anel azul→roxo, "Seu story", "+" azul; "Carregando…" em texto | anel dourado→âmbar; "+" marinho; skeleton de fileira | Alta | baixo |
| Tema escuro (`index.css:203-239`) | override hex por hex, frágil (dourado novo ficaria claro) | variáveis `--rede-bg/--rede-ink/--rede-acao` | Alta | médio |
| Cartão do post (`:309-426`) | ícones e cores 1:1 Instagram; contadores sem rótulo | recolorir; badge clube/unidade em desafio/conquista | Média | baixo |
| Cabeça (avatar/nome/tempo `:283-297`) | unidade nunca aparece; badge coordenação = "verificado" azul | "Unidade · Clube · há 8 h"; iniciais marinho/dourado; badge dourado | Média | baixo (checar se a RPC devolve unidade) |
| Desafios · Publicar · Perfil · Busca | badges verde/roxo; `bg-white` fixo; perfil genérico sem classe/unidade; busca sem vazio | badges marinho/dourado; tokens; badges DBV no perfil; `VazioRede` com ação | Média | baixo |
| Vazios e skeletons | `VazioRede` sem ação; skeleton genérico de cartão | prop `acao`; skeleton no formato do post | Média | baixo |
| Admin "Rede em todos os clubes" | `window.confirm` para ação em massa | `avisar.confirmar` perigo | Média | baixo |
| Ajuda na Rede | nenhum `BotaoAjuda`; nenhum tópico em `conteudo.js` | tópico + botão | Média | baixo |

### 5.2 Tutorial
Um tour genérico de 4 passos (Início, Jornada, Clube, Eu) só no Início (`tutorial.js:102-107`), marcado visto ao aparecer. **Pular sim, Voltar não**, rever em /ajuda ("Ver o tour de novo"). Ajuda contextual existe como `?` (`BotaoAjuda` → /ajuda#topico) em 4 telas, não na Rede, Minha Classe, Início. Conteúdo: 38 tópicos em 7 papéis com busca.
**Proposta:** mini-tours por área (Classes, Rede, Gestão) na 1ª entrada, com Pular/Voltar/Rever; fila única de popups; `BotaoAjuda` na Rede e em Minha Classe.

### 5.3 /ajuda e "Como funciona"
`GuiaDeUso` compartilhado (site e app), busca + tópicos recolhíveis. Landing: seção "Como funciona" com 3 cartões estáticos, sem imagem nem vídeo. **Nenhum slot de vídeo** no modelo de tópico; nenhum vídeo no bundle (bom). Se entrar vídeo: campo `video` opcional no tópico, hospedagem externa (YouTube nocookie já liberado na CSP), poster + play manual, fora do precache.
**Proposta:** estrutura Primeiros passos · Desbravadores · Responsáveis · Instrutores · Diretoria · Coordenação · Administração (já existe por papel); apresentação interativa "Conheça o DesbravaClube" (8 passos + vídeo 40 s) como página do site.

## 6. Ordem de implementação proposta (Fase 6.23)
1. ✅ safe-area
2. ✅ auditoria (este documento)
3. design system: criar `ItemLista`, `MenuAcoes`, `Chip`, `ZonaUpload`, `CabecalhoSecao`, `FilaDePopups`; documentar em `src/ui`
4. foto da Rede: migration (avatar-personagem + `imagem_autorizada` só p/ `eu`), `AvatarRede` com personagem, eu coerente, aviso na moderação, E2E
5. app: P1 (erros crus → `mensagemDeErro`; sino em `Folha`; Meu Filho; botão de envio 44px; Início com % e avisos; fila de popups), depois P2 por tela
6. Rede DBV visual
7. Admin: P0 primeiro, depois sidebar/header desktop + tabelas responsivas + seção na URL
8–15. acessibilidade/performance/congelar/roteiros/apresentação/ajuda/testes
