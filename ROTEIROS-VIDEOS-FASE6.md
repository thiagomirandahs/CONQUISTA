# ROTEIROS DOS VÍDEOS CURTOS — Fase 6 (para aprovação do dono, 30/09/2026 — rev. 2)

**Nada foi gravado.** Regra da Fase 6.17: gravar só depois de congelar o visual. Estes roteiros existem para você aprovar
o conteúdo, a ordem e a duração antes de qualquer produção.

## Regras de produção (valem para os 12)
- **Contas e dados DEMONSTRATIVOS** (clube de teste): sem nome real de criança, sem foto real sem autorização, sem telefone,
  e-mail, mensalidade real, tokens ou URLs administrativas sensíveis.
- **Tela:** celular Android em retrato, 390 px, tema claro. Admin (vídeo 12) em desktop 1366 px.
- **Narração:** português do Brasil, tom de conversa, frases curtas. Legenda sempre (muita gente vê sem som).
- **Formato:** MP4 vertical 9:16 (vídeos 1–11) e 16:9 (vídeo 12); poster (imagem de capa) de cada um.
- **Hospedagem:** YouTube (não listado), embutido pelo `youtube-nocookie` já liberado na CSP. **Nunca dentro do bundle/PWA.**
  Play manual, capa antes de carregar (componente `VideoCurto`).
- **Onde entra:** `/conheca` (etapa correspondente) e `/ajuda` (tópico correspondente), pelo campo `video: { youtubeId, poster }`.
- **Abertura/encerramento padrão (3 s cada):** logo oficial (rosa dos ventos com montanhas) sobre azul-marinho, texto dourado
  "DesbravaClube · desbravaclube.com.br".

## Mapa: vídeo → etapa do /conheca → tópico do /ajuda

| # | Vídeo | Persona | Duração | /conheca | /ajuda (tópico) |
|---|---|---|---|---|---|
| 1 | Conheça o DesbravaClube | todos | 30–45 s | 1 `o-que-e` | `navegacao` |
| 2 | Criando ou entrando em um clube | diretor / novo membro | 30–60 s | 2 `criar-ou-entrar` | `criar-clube`, `inscricoes` |
| 3 | Cadastro do desbravador | desbravador / responsável | 30–60 s | 3 `area-do-desbravador` | `perfil`, `vinculo-responsavel` |
| 4 | Classes | desbravador | 45–90 s | 4 `classes` | `minha-classe` |
| 5 | Enviando uma atividade | desbravador | 45–90 s | 4 `classes` | `minha-classe` |
| 6 | Avaliando uma atividade | instrutor | 45–90 s | 7 `gestao` | `fila-avaliacao`, `avaliar-classes` |
| 7 | Especialidades | desbravador | 45–90 s | 5 `especialidades` | `minhas-especialidades` |
| 8 | Rede DBV | desbravador | 45–90 s | 6 `rede-dbv` | `rede-dbv` |
| 9 | Responsáveis | pais | 45–60 s | 3 `area-do-desbravador` | `meu-filho` |
| 10 | Gestão do clube | diretoria | 60–90 s | 7 `gestao` | `gestao`, `usuarios-equipe` |
| 11 | Investidura | instrutor / diretoria | 60–90 s | 7 `gestao` | `investidura`, `documentos` |
| 12 | Admin da plataforma | administrador | 60–90 s | 8 `coordenacao` | — (só interno) |

---

## 1. Conheça o DesbravaClube (30–45 s)
- **Objetivo:** em meio minuto, o que é e para quem é.
- **Persona:** qualquer pessoa chegando pelo site.
- **Tela inicial:** site `desbravaclube.com.br` (landing).
- **Ações (storyboard):** 1) abertura padrão · 2) rolagem lenta da landing · 3) corte para o celular: tela Início do app com o cartão "Minha classe 78%" · 4) corte rápido: Minha Classe → Rede DBV → Gestão (1,5 s cada) · 5) encerramento.
- **Narração:** "O DesbravaClube é o aplicativo do seu Clube de Desbravadores. As classes, os requisitos, as especialidades, a equipe e a Rede DBV — tudo no celular, com a cara do seu clube. Comece em desbravaclube.com.br."
- **Tela final:** landing com o botão "Quero começar".
- **O que NÃO mostrar:** Nenhum dado pessoal; só a landing e telas do clube de teste.
- **Dados fictícios necessários:** Clube de teste "Clube Demo" (Tenant 002) com 1 desbravador fictício "Ana Demo" (classe Amigo a 78%).

## 2. Criando ou entrando em um clube (30–60 s)
- **Objetivo:** mostrar os dois caminhos: diretor cria; membro entra.
- **Persona:** diretor (primeira metade) e novo membro (segunda).
- **Tela inicial:** `/adquirir`.
- **Ações:** 1) diretor: escolhe o plano de teste → cadastro → onboarding (etapas: conta, dados, clube, identidade, diretor) — cortes rápidos, sem digitar dados reais · 2) tela Gestão → Inscrições: gera link e QR Code · 3) membro: abre o link no celular → cadastro → "vínculo pendente" · 4) diretor: Gestão → Aprovar cadastros → aprova · 5) membro vê o Início.
- **Narração:** "Quem dirige o clube cria a conta e monta o clube em poucos passos. Depois, é só compartilhar o link ou o QR Code. Cada pessoa entra, escolhe o clube, e a diretoria aprova. Ninguém entra sem aprovação."
- **Tela final:** Início do novo membro.
- **O que NÃO mostrar:** Não digitar e-mail/senha reais (usar cortes); não mostrar código de cortesia nem URL do painel.
- **Dados fictícios necessários:** Conta de diretor fictícia "Diretor Demo"; clube novo "Clube Demo 2"; membro fictício "Bruno Demo".

## 3. Cadastro do desbravador (30–60 s)
- **Objetivo:** perfil, foto ou personagem, data de nascimento, e o vínculo com o responsável.
- **Persona:** desbravador (conta de teste "Desbravador Demo").
- **Tela inicial:** Eu → Meu perfil.
- **Ações:** 1) troca a foto pelo **personagem** (montar o bonequinho) · 2) confere data de nascimento · 3) responsável: Eu → "Pedir o vínculo com o meu filho" → diretoria aprova (corte) · 4) Meu Filho aparece para o responsável.
- **Narração:** "Cada desbravador tem o seu perfil. Pode usar uma foto — só com a autorização de imagem arquivada pelo clube — ou montar um personagem. O pai ou a mãe pede o vínculo, a diretoria confirma, e passa a acompanhar tudo em Meu Filho."
- **Tela final:** Meu Filho.
- **O que NÃO mostrar:** Não mostrar foto de rosto real; não mostrar data de nascimento real; não mostrar e-mail do responsável.
- **Dados fictícios necessários:** "Ana Demo" com personagem montado; responsável fictício "Responsável Demo" já vinculado.

## 4. Classes (45–90 s)
- **Objetivo:** entender a tela Minha Classe: progresso, seções, estados dos requisitos.
- **Persona:** desbravador.
- **Tela inicial:** Início → cartão "Minha classe" → Continuar.
- **Ações:** 1) escolher a classe (Amigo) · 2) mostrar a barra de progresso e as seções · 3) percorrer os estados: Disponível → Aguardando → Correção → Concluído → Bloqueado (avançada exige a regular iniciada) · 4) abrir "Mais" de um requisito: Ouvir livro (audiolivro), origem, catálogo.
- **Narração:** "Na Minha Classe você vê o quanto já andou e o que falta. Cada requisito tem um estado claro: disponível, aguardando avaliação, correção pedida, concluído. Alguns requisitos têm o livro para ouvir, direto do app."
- **Tela final:** Minha Classe com 78%.
- **O que NÃO mostrar:** Não mostrar histórico com nomes de outras crianças; não abrir requisito com foto de documento.
- **Dados fictícios necessários:** "Ana Demo", classe Amigo com requisitos em cada estado (Disponível, Aguardando, Correção, Concluído, Bloqueado).

## 5. Enviando uma atividade (45–90 s)
- **Objetivo:** o fluxo de comprovação: texto, foto, rascunho, enviar, correção e reenvio.
- **Persona:** desbravador.
- **Tela inicial:** Minha Classe → requisito "Disponível".
- **Ações:** 1) escreve o texto · 2) tira/escolhe uma foto na caixa tracejada (ZonaUpload) · 3) "Salvar rascunho" · 4) "Enviar para avaliação" (botão grande) → estado Aguardando · 5) corte: chega a correção → o comentário do avaliador aparece em destaque · 6) reenvia → Concluído.
- **Narração:** "Comprovar é simples: conte o que fez, junte uma foto se pedir, e envie para avaliação. Se o instrutor pedir uma correção, o comentário dele aparece na hora, e você reenvia. Requisitos de idade pedem foto do documento — ela some depois de conferida."
- **Tela final:** requisito Concluído.
- **O que NÃO mostrar:** NÃO gravar o fluxo de foto de documento (requisito de idade); usar foto genérica (paisagem/atividade sem rosto).
- **Dados fictícios necessários:** Requisito de texto+foto disponível; uma correção já pedida pelo "Instrutor Demo" com comentário curto.

## 6. Avaliando uma atividade (45–90 s)
- **Objetivo:** a fila de avaliação da liderança.
- **Persona:** instrutor.
- **Tela inicial:** Gestão → Avaliar (fila com contador).
- **Ações:** 1) abre um envio: texto + foto · 2) aprova um · 3) em outro, "Pedir correção" com comentário · 4) mostra o histórico de tentativas com a foto anterior · 5) fila zera.
- **Narração:** "Quem avalia vê tudo numa fila. Abre, confere a foto e o texto, aprova ou pede correção com um recado. O histórico fica guardado — inclusive as tentativas anteriores."
- **Tela final:** fila vazia "Tudo avaliado".
- **O que NÃO mostrar:** Não mostrar fila com nomes reais; a foto avaliada não pode ter rosto de criança.
- **Dados fictícios necessários:** "Instrutor Demo" com 2 envios na fila (um aprovável, um para correção); histórico com 1 tentativa anterior.

## 7. Especialidades (45–90 s)
- **Objetivo:** catálogo, escolher, cumprir, avaliar.
- **Persona:** desbravador.
- **Tela inicial:** Jornada → Especialidades.
- **Ações:** 1) Catálogo (busca + filtro por área) · 2) escolhe uma · 3) requisitos com o mesmo fluxo das classes (Disponível/Aguardando/Concluído) · 4) corte: instrutor avalia (Gestão → Avaliar especialidades) · 5) especialidade concluída no perfil.
- **Narração:** "As especialidades seguem a mesma lógica das classes. Escolha no catálogo, cumpra os requisitos, envie, e a liderança avalia. A comprovação é do jeito que o seu clube define."
- **Tela final:** perfil com a especialidade concluída.
- **O que NÃO mostrar:** Não prometer conteúdo oficial das especialidades; não mostrar catálogo como se fosse manual.
- **Dados fictícios necessários:** Especialidade de teste no catálogo; "Ana Demo" com 1 requisito enviado; "Instrutor Demo" avalia.
- **Atenção:** o catálogo é só de nomes (MDA Wiki); não prometer conteúdo oficial.

## 8. Rede DBV (45–90 s)
- **Objetivo:** feed, stories, publicar, curtir, comentar, denunciar; e as regras de proteção.
- **Persona:** desbravador (com autorização de imagem arquivada no clube de teste).
- **Tela inicial:** Início → atalho Rede DBV.
- **Ações:** 1) feed com posts de outros clubes · 2) story (anel dourado) · 3) publicar: foto + legenda → confirmação "Tem certeza?" → publicado · 4) curtir, comentar · 5) menu ⋯ → Denunciar (o post some na hora) · 6) Sair da Rede (botão no topo).
- **Narração:** "A Rede DBV é a rede social dos desbravadores, dentro do app. Publique, veja os stories, curta e comente. Tudo passa por triagem: denunciou, saiu do ar na hora e a diretoria é avisada. Fotos ficam 90 dias. A foto do rosto só aparece com a autorização arquivada pelo clube."
- **Tela final:** feed.
- **O que NÃO mostrar:** Não mostrar posts/rostos de clubes reais; não gravar denúncia contra conteúdo real; não mostrar a tela de moderação com nomes.
- **Dados fictícios necessários:** Rede ligada para "Clube Demo" e "Clube Demo 2"; 3 posts fictícios (1 conquista, 1 desafio, 1 comum), 1 story; "Ana Demo" com autorização de imagem arquivada.

## 9. Responsáveis (45–60 s)
- **Objetivo:** o que o pai/mãe vê e controla.
- **Persona:** responsável.
- **Tela inicial:** Meu Filho.
- **Ações:** 1) progresso da classe do filho · 2) últimos envios e correções · 3) interruptor da Rede DBV (desligar/religar) · 4) avisos do clube no sino.
- **Narração:** "O responsável acompanha o filho sem mexer em nada: progresso, envios, avisos. A autorização para a Rede DBV é a do papel assinado no clube; aqui, se quiser, o responsável pode desligar a Rede para o filho a qualquer momento."
- **Tela final:** Meu Filho.
- **O que NÃO mostrar:** Não mostrar dados de saúde/mensalidade; não mostrar outros filhos.
- **Dados fictícios necessários:** "Responsável Demo" vinculado a "Ana Demo"; 2 avisos no sino.

## 10. Gestão do clube (60–90 s)
- **Objetivo:** a tela Gestão da diretoria: pessoas, unidades, identidade, recursos, plano.
- **Persona:** diretoria.
- **Tela inicial:** Gestão.
- **Ações:** 1) Aprovar cadastros · 2) Usuários: convidar a equipe com cargo (Capelão, Secretária…) · 3) Unidades e cargos de unidade · 4) Identidade e recursos: logo e cores do clube (logo nunca é alterada pela plataforma) · 5) Plano do clube (o que está incluído) · 6) Avisos para o clube (aparecem no sino e no celular) · 7) Moderação da Rede DBV: lista de autorização de imagem (nasce desligada).
- **Narração:** "Na Gestão a diretoria cuida do clube: aprova quem entra, convida a equipe com o cargo certo, organiza as unidades, define a identidade e vê o plano. Avisos chegam no celular de todo mundo. E é aqui que se marca a autorização de imagem de cada criança."
- **Tela final:** Gestão.
- **O que NÃO mostrar:** Não mostrar e-mails da equipe nem o link real de inscrição; não abrir a lista de autorização de imagem com nomes reais; não mostrar mensalidades.
- **Dados fictícios necessários:** "Diretor Demo"; 2 cadastros pendentes fictícios; 2 unidades ("Águias", "Falcões"); 1 convite de equipe fictício.

## 11. Investidura (60–90 s)
- **Objetivo:** o caminho clube → distrito → região → apto, e o documento.
- **Persona:** instrutor + coordenação.
- **Tela inicial:** Gestão → Investiduras.
- **Ações:** 1) desbravador com classe 100% aparece na lista · 2) revisão final do clube: aprovar ou devolver (marca requisitos para correção) · 3) corte: portal da coordenação (distrito) aprova · 4) região aprova → "Apto" · 5) documento PDF gerado e assinatura · 6) verificação pública pelo QR do documento (`/verificar`).
- **Narração:** "Terminou a classe? Começa a investidura. O clube revisa, o distrito e a região aprovam — se algum nível não existir, o app pula. No fim, sai o documento com QR Code, que qualquer pessoa pode conferir no site."
- **Tela final:** página `/verificar` com o documento válido.
- **O que NÃO mostrar:** Não mostrar documento com nome real; QR do documento aponta para um documento do clube de teste; não mostrar assinatura real.
- **Dados fictícios necessários:** "Ana Demo" com classe 100%; distrito e região de teste com coordenadores fictícios; documento PDF de teste.

## 12. Admin da plataforma (60–90 s) — uso interno
- **Objetivo:** visão geral, clubes, assinaturas, suporte, manutenção.
- **Persona:** administrador da plataforma.
- **Tela inicial:** `/admin` (desktop, dados de teste).
- **Ações:** 1) Visão geral: clubes, ativos, em teste, armazenamento, "Precisa de atenção" · 2) Clubes: tabela com busca, filtro e ordenação → abre um clube · 3) Detalhe: sub-abas Resumo / Assinatura / Uso / Recursos / Auditoria / Zona de perigo · 4) mostrar a confirmação vermelha de suspender (sem confirmar) · 5) Recursos: liberar Rede DBV para um clube · 6) Chamados de suporte · 7) Manutenção (só mostrar).
- **Narração:** "O painel da plataforma mostra a saúde de todos os clubes com os números reais do sistema. Cada clube tem o seu detalhe, e as ações perigosas ficam separadas e pedem confirmação."
- **Tela final:** Visão geral.
- **O que NÃO mostrar:** Nunca mostrar URL do Supabase, IDs, e-mails, chaves, tela de manutenção ligada, lixeira com clubes reais; não confirmar suspensão; mostrar SOMENTE clubes de teste (filtrar).
- **Dados fictícios necessários:** Ambiente de homologação com 3–5 clubes fictícios em status variados (ativa, trial, suspensa) e 1 chamado de suporte fictício.
- **Atenção:** nunca gravar URL do Supabase, IDs, e-mails; usar só o clube de teste.

---

## O que preciso de você
1. Aprovar (ou ajustar) a ordem, as durações e as narrações acima.
2. Decidir quem grava: você (eu entrego roteiro + capturas de tela de referência) ou eu gero as capturas/animações do app com dados de teste.
3. Definir o canal do YouTube (conta do produto) para hospedar os vídeos não listados.
