# FASE 7 — CONTEÚDO E COMUNIDADE (escopo recomendado · registrado em 30/09/2026)

**Nada disto foi implementado.** É só o escopo sugerido para depois de a Fase 6 ser publicada e provada em produção.
Regra do dono: primeiro terminar e provar a Fase 6; não começar a Fase 7 por ansiedade.

## A) CLASSES — experiência de execução dos requisitos
- Requisitos que exigem entrega passam a ter **relatório estruturado** (campos guiados, não um texto solto).
- Texto + **fotos/evidências** (caixa de upload padrão `ZonaUpload`, já pronta) + **rascunho** salvo + **envio**.
- Ciclo completo: **devolução → correção → reenvio**, com **histórico de tentativas** e **comentário do avaliador** sempre visível
  (a base já existe: migration 360 + tela de correção inline).
- **Assinatura/documento** ao concluir (motor de PDF/assinatura já existe; ligar ao relatório estruturado).
- **Audiolivros/áudios** só onde houver fonte permitida (hoje: 6 livros no youtube-nocookie, migration 370). Cada requisito mostra a
  **origem do conteúdo**.
- Não alterar a regra curricular sem necessidade (currículo versionado 2026.4 é imutável; mudança = versão nova).

## B) ESPECIALIDADES — do catálogo de nomes ao módulo completo
- **Manifesto oficial** (como o das Classes) + **validador** + **gerador de migration** (nunca editar migration à mão).
- Catálogo, **categorias**, **requisitos**, **evidências**, **instrutores**, **aprovação**, **dependências** (pré-requisitos),
  **histórico**, **não repetição**, documentos/certificação quando aplicável.
- **Não inventar conteúdo oficial.** Só fontes fornecidas pelo dono ou oficialmente verificadas (hoje só há nomes da MDA Wiki).
- Decisão do dono pendente: comprovação obrigatória ou opcional por especialidade; manual oficial de referência.

## C) COMUNIDADE / REDE DBV — continuar refinando (comunidade CONTROLADA, não rede social aberta)
- Perfil, feed, stories, clubes, unidades, conquistas, selos, comentários, curtidas.
- Moderação, privacidade, segurança infantil.
- **Consentimento de imagem auditável:** a migration 503 (histórico append-only) já existe; falta a **tela da diretoria** para consultar
  o histórico de uma criança, a **versão do termo** (depende do texto jurídico) e decidir a **validade das URLs assinadas** (foto de perfil 24 h, foto de post 10 min).
- "Unidade" no subtítulo do post (migration 502) já preparada.
- Continua sendo comunidade de Clubes de Desbravadores: sem mensagem privada, sem perfil público aberto.

## D) APRESENTAÇÃO — depois de o dono aprovar os roteiros
- Produzir os **12 vídeos curtos** (roteiros em `ROTEIROS-VIDEOS-FASE6.md`), hospedados **fora do bundle** (YouTube nocookie, play manual, poster).
- Integrar em **/conheca** (campo `video` já pronto por etapa) e **/ajuda** (campo `video` por tópico).
- Tutorial contextual (mini-tours já prontos) e apresentação comercial.
- **Pré-requisito:** visual congelado (feito ao publicar a Fase 6) e dados fictícios do clube de demonstração.

## E) Pendências técnicas menores herdadas da Fase 6 (podem entrar no início da Fase 7)
- Interruptor de som do Perfil: animação `layout` do framer-motion parece travar quando o painel está oculto (artefato de teste); confirmar em aparelho real.
- Botão primário do app usa gradiente azul→ciano (`src/ui`), enquanto a Rede usa marinho/dourado: decidir se unifica (decisão de identidade do dono).
- Pontos de progresso do `/conheca` com 32×44 px (mínimo WCAG 2.2 cumprido; regra do projeto é 44).
- Teste em aparelhos reais: Android 3 botões, gestos, câmera/notch, teclado virtual, PWA iPhone.
