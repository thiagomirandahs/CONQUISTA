# Fase 8 — auditoria de partida, o que foi feito e decisões que precisam do dono

**Nada aqui foi para produção.** A migration nova (514) só foi aplicada em bancos locais isolados.

## 1. Estado de partida (confirmado por git)
- Produção: `main` = `origin/main` = Vercel = `eb897ef` (OTA `202609301343-eb897ef`), ledger até a **513**. O HEAD local da branch era `8d8243e` (= eb897ef + 1 commit só de evidências do deploy, **não enviado**). Nenhum commit posterior relevante.
- Arquivos soltos (untracked) antigos: relatórios e scripts de fases anteriores (`ETAPA-*.md`, `scripts/_janela-real.mjs`…) — nenhum é necessário ao produto.

## 2. O que já existia e NÃO foi refeito (pedido: "não refaça o homologado")
| Tema | O que existe em produção |
|---|---|
| Relatório estruturado, tentativas imutáveis, histórico, rascunho offline, conflito, avaliação sem autoavaliação | Fase 7 (510–513) |
| Audiolivros | migration 370: 8 livros, 128 capítulos, player do YouTube sem cookie, admin troca vídeo/desliga; progresso só no aparelho |
| Especialidades: motor, busca paginada, manifesto v2 + validador + gerador | Fase 7 |
| **Comunidade = "Rede DBV"** | migrations 430–503, **no ar desde 29/09** (feed, stories 24 h, publicar, buscar, desafios, denúncia/moderação, autorização de pais, coordenação, limpeza de fotos) |

## 3. Comunidade — auditoria e CONFLITO com o pacote visual (precisa da sua decisão)
O pacote `Pacote_Visual_Comunidade_DesbravaClube_v2.pdf` é de **28/09** e descreve uma Comunidade **privada por clube** (abas Clube · Minha Unidade · Desafios, feed livre/moderado por clube, cota social, retenção, vídeo de 30 s).
Depois dele vieram decisões suas que a **Rede DBV** já implementa e que **contradizem** partes do pedido desta fase:

| Pedido desta fase / pacote v2 | Rede DBV hoje (decisão sua de 29/09) |
|---|---|
| Comunidade **club-centric**, sem descoberta entre clubes | Feed e stories **entre todos os clubes** da Rede; buscar pessoas/clubes |
| Desbravador **não publica livremente** (publicação institucional, provavelmente diretoria) | Desbravador **publica direto**, com confirmação ("Fica visível para todos os clubes da Rede DBV"); moderação por denúncia |
| Sem perfil de criança | Perfil com nome + sobrenome, avatar/personagem, foto de rosto só com autorização de imagem arquivada |
| Tipos: Atividade · Aviso · Conquista · Evento · Foto do clube | Tipos: foto · desafio · conquista · livre |
| Moderação por `club_id`; platform admin sem acesso ao conteúdo privado de menores | Moderação pela diretoria do clube do autor; admin da plataforma tem `/admin/rede` (todos os clubes) |
| Feed Livre × Moderado configurável por clube; cota/retensão/Memórias; vídeo | Regra global única `rede_foto_exige_aprovacao()`; limpeza de fotos em 90 dias; sem vídeo; sem cota por clube |

**O que fiz:** nada de código novo na Comunidade — construir "outra" por cima quebraria a Rede no ar e sua decisão de 29/09. Esta seção é o inventário e os gaps.
**Decisões que preciso de você (D1–D6):**
1. **D1 — Modelo:** a Comunidade passa a ser (a) a própria Rede DBV como está; (b) a Rede só **dentro do clube** (desliga o feed entre clubes); (c) os dois (feed do clube + rede entre clubes)?
2. **D2 — Quem publica:** manter desbravador publicando direto (hoje) ou só diretoria/instrutor (publicação institucional)? Mudar exige migration e desfaz o que você pediu em 29/09.
3. **D3 — Tipos de post:** trocar foto/desafio/conquista/livre por Atividade/Aviso/Conquista/Evento/Foto do clube?
4. **D4 — Admin da plataforma:** hoje vê a Rede de todos os clubes em `/admin/rede`. Manter ou restringir?
5. **D5 — Mídia:** cota por clube, retenção configurável, Memórias e vídeo (pacote v2) — entram agora ou depois de medir o Storage?
6. **D6 — Conquistas curriculares na Comunidade:** só "Classe Amigo concluída" (sem relatório/foto/parecer), com consentimento — quer a arquitetura já agora? (Preparada: `minha_jornada().conquistas` já existe só para a própria pessoa.)

### Auditoria de uploads (pedido do pacote v2)
| Fluxo | Redimensiona/comprime | Tira EXIF | Observação |
|---|---|---|---|
| Rede (post/story/avatar) | sim: WebP, 1080/1920/256 px, alvo 150 KB/30 KB | sim (canvas) | bucket `comunidade` ≤ 300 KB validado no servidor |
| Comprovações de requisito, missões, atividades | `comprimirImagem` (1080 px, JPEG 0,72) | **não garantido** (devolve o original se não ficar menor) | bucket `comprovacoes`; foto de documento tem regra própria (380) |
| Avatar/mural/unidades/cadastro | `comprimirImagem` | não garantido | bucket `imagens` |
| Suporte (anexo) | não | não | bucket de suporte |
| Logo do clube (`publico`) | não | não | não alterar a logo |
Pipeline central único, cota por clube e métricas ainda **não existem** → fica como proposta (seção 7).

## 4. Navegação (auditoria; **nada mudou**)
Hoje (`src/lib/navegacao.js`): no máximo 5 destinos por papel — Início · **Jornada** (hub: Minha Classe, Especialidades, Experiências, Atividades, Missões, Bíblia) · Clube (Ranking, Minha unidade, Unidades, Mural, **Rede DBV**, Agenda, Chat) · Jogos · Gestão/Eu. Já existe o destino **Jornada** e a Rede vive dentro de **Clube**.
Proposta (sem remover acesso): manter a barra; dentro do hub **Jornada** acrescentar **Minha Jornada**, **Portfólio** e **Leituras**; promover "Comunidade" à barra só depois da decisão D1. A barra "Início | Jornada | Comunidade | Clube | Conta" exigiria tirar Jogos da barra (vira item do Clube) — é decisão de produto (D7).

## 5. Classes de Liderança (só documentação)
O motor foi desenhado para classe **regular/avançada** (`tipo_classe` só `regular`/`avancada`; sem workflow próprio) e **não há conteúdo oficial**. Como integrar no futuro: (1) novo `tipo_classe = 'lideranca'` + importador do manifesto próprio (mesmo padrão `curriculo-manifesto/`); (2) modelos de relatório por requisito (já suportado pelo motor da Fase 7); (3) pré-requisitos por `curriculum_dependencies` (classe regular concluída + idade); (4) avaliação por quem tem capacidade de liderança (regra "ninguém avalia o próprio requisito" vale). Nada foi importado nem inventado.

## 6. Storage GC (não tocado)
Nenhuma rotina destrutiva foi criada. O expurgo de clube continua deixando o arquivo físico órfão (ver `STORAGE-GC-DESENHO.md`: 3 decisões suas pendentes).

## 7. Proposta de pipeline central de imagens (não implementado — depende de D5)
Perfis por finalidade (`avatar`, `feed`, `miniatura`, `mural`, `evidencia`, `documento`), sem compressão social nas evidências/documentos; métricas por clube (bytes originais × armazenados); cota separada (institucional × social × Memórias). Só faz sentido depois de fechar D1–D5.

## 8. Operação: clube com uma única pessoa que pode avaliar
A regra "ninguém avalia o próprio requisito" (inclusive diretoria) **não tem exceção**. Se o clube tiver só uma pessoa com capacidade de avaliar (ex.: só a diretora), ela não consegue aprovar a **própria** classe/especialidade: precisa de outra pessoa da diretoria/instrutor. **Não criei exceção automática.** Decisão futura (D8): permitir aprovação cruzada entre clubes, ou coordenação avaliar, ou diretor de outro clube da mesma região.

## 9. Pendências de conteúdo oficial
Ver `PENDENCIAS-DE-CONTEUDO-OFICIAL.md` (guia.V.2 opção 4; fonte/piloto das Especialidades) e, novas: **áudio do Curso de Leitura 2026** ("Servo de Deus e Amigo de Todos") sem fonte cadastrada; **capas** dos livros (nenhuma URL inventada); **áudio de Expedição Galápagos e O Fim do Começo** existe no catálogo 370 (playlist indicada por você), mas o pacote v2 os marca como "não confirmado" → no **catálogo de leitura** ficam com áudio **não confirmado** (escondido); o player do requisito (migration 370) continua tocando como antes até você decidir (D9: confirmar ou remover).
