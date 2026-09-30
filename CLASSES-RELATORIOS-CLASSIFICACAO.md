# Fase 7 — Classes: classificação FINAL dos 71 requisitos de texto

Aplicadas as 10 regras aprovadas em 30/09/2026. Fonte da lista: manifesto 2026.4. Os modelos de campos estão em `supabase/curriculo-manifesto/modelos-de-relatorio/classes.json` (fonte de verdade; o app monta o formulário a partir dele).

## Totais finais

| Categoria | Qtde |
|---|---|
| 1. RESPOSTA SIMPLES | 28 |
| 2. RELATÓRIO ESTRUTURADO | 9 |
| 3. FOTO/EVIDÊNCIA | 0 |
| 4. ATIVIDADE/VALIDAÇÃO | 11 |
| 5. LEITURA/CONTEÚDO | 17 |
| 6. OUTRO | 6 |
| **Total** | **71** |

**Relatórios estruturados: 9 (mantidos).** A aplicação das regras não demonstrou que algum deva mudar.

## O que mudou em relação à primeira análise
- Regra 1 moveu para RESPOSTA SIMPLES: requisitos de identificar/explicar (pesquisador.VII.1, amigo.VIII.3) e os de "examinar atitudes" (30/43/68 continuam resposta, agora com escolha de 2 temas).
- Regra 2: "estudar/descobrir" sem produto (excursionista.II.3/4/5, pioneiro.VII.1) → LEITURA, só confirmação (antes: dúvida).
- Regra 3: conversas/discussões/estudo com pastor → VALIDAÇÃO com confirmação do responsável.
- Regra 5: escolha explícita de forma em 6 requisitos (categoria OUTRO) e em vários outros (o desbravador escolhe UMA forma; as demais não são obrigatórias).
- Regra 6: requisitos compostos viram subitens dentro do mesmo requisito (amigo.V.2, guia.III.2, excursionista.IV.2, companheiro_de_excursionismo.4).
- Regra 7: convite (pioneiro.II.5) guarda só a quantidade.
- Regra 8: foto nunca obrigatória; anexo opcional só nos relatos de atividade, em excursionista.IV.2 e pesquisador.II.4.
- Regra 9: toda confirmação é uma avaliação registrada (quem, papel, data) na tentativa — nunca um booleano solto.

## Exceção que depende de você (regra 10)

| Requisito | Dúvida | O que foi feito |
|---|---|---|
| `guia.V.2` — 4ª opção "especialidade de Nutrição / liderar Cultura física" | O texto não diz se basta ter a especialidade, se precisa concluí-la pelo app, ou se "liderar Cultura física" é outra atividade com outra comprovação. | Nada inventado: a opção aparece **desativada** ("decisão pendente"); as outras 3 opções (poesia/artigo, corrida com treino, ler Temperança e apresentar 10 textos) funcionam. |

Nenhuma outra exceção relevante.

## Lista completa

| Requisito | Classe | Categoria | Modelo | Texto |
|---|---|---|---|---|
| `amigo.I.4` | amigo (reg) | LEITURA/CONTEÚDO | L1 — confirmação de leitura | Ler o livro do Curso de Leitura do ano. |
| `amigo.I.5` | amigo (reg) | LEITURA/CONTEÚDO | L1 — confirmação de leitura | Ler o livro da classe: "Vaso de Barro". |
| `amigo.II.2` | amigo (reg) | RESPOSTA SIMPLES | A3 — uma resposta por item | Ler e explicar com suas palavras: João 3:16, Efésios 6:1-3, II Timóteo 3:16 e Salmo 1. |
| `amigo.II.3` | amigo (reg) | LEITURA/CONTEÚDO | L2 — checklist de livros + reconto opcional | Leitura bíblica dos capítulos indicados de Gênesis e Êxodo (conte o que leu). |
| `amigo.III.2` | amigo (reg) | RESPOSTA SIMPLES | A1 — texto livre | Escrever uma redação sobre como ser um bom cidadão em casa e na escola. |
| `amigo.IV.1` | amigo (reg) | RESPOSTA SIMPLES | A2 — listas | Listar 10 qualidades de um bom amigo e contar 4 situações do dia a dia em que praticou a Regra Áurea (Mateus 7:12). |
| `amigo.V.2` | amigo (reg) | RESPOSTA SIMPLES | A6 — subitens independentes | Com base em Daniel 1: explicar (ou encenar) os princípios de temperança de Daniel, memorizar e explicar Daniel 1:8 e escrever seu compromisso pessoal com um estilo de vida saudável. |
| `amigo.VIII.3` | amigo (reg) | RESPOSTA SIMPLES | A2 — listas | Apresentar 10 regras para uma caminhada e explicar o que fazer quando estiver perdido. |
| `companheiro.I.4` | companheiro (reg) | RESPOSTA SIMPLES | A1r — livro + resumo | Ler o livro do Curso de Leitura do ano e escrever 1 parágrafo sobre o que mais chamou sua atenção. |
| `companheiro.I.5` | companheiro (reg) | LEITURA/CONTEÚDO | L1 — confirmação de leitura | Ler o livro da classe: "Um Simples Lanche". |
| `companheiro.II.2` | companheiro (reg) | RESPOSTA SIMPLES | A3 — uma resposta por item | Ler e explicar com suas palavras: Isaías 41:9-10, Hebreus 13:5, Provérbios 22:6, I João 1:9 e Salmo 8. |
| `companheiro.II.3` | companheiro (reg) | LEITURA/CONTEÚDO | L2 — checklist de livros + reconto opcional | Leitura bíblica dos capítulos indicados de Levítico, Números, Deuteronômio, Josué, Juízes, Rute e 1 e 2 Samuel (conte o que leu). |
| `companheiro.II.4` | companheiro (reg) | OUTRO | E1 — escolha de forma (tema + forma) | Com o conselheiro, escolher 1 tema (uma parábola, um milagre, o Sermão da Montanha ou um sermão sobre a Segunda Vinda) e mostrar o que aprendeu de 1 jeito: conversa com o conselheiro, atividade com o grupo ou redação. |
| `companheiro.IV.1` | companheiro (reg) | ATIVIDADE/VALIDAÇÃO | V1 — confirmação do responsável | Conversar com o conselheiro ou a Unidade sobre como respeitar pessoas de outras culturas, raças e sexo. |
| `companheiro.V.2` | companheiro (reg) | ATIVIDADE/VALIDAÇÃO | V1 — confirmação do responsável | Conversar com o líder sobre aptidão física e exercícios regulares para uma vida saudável. |
| `companheiro.V.3` | companheiro (reg) | RESPOSTA SIMPLES | A1 — texto livre | Aprender os prejuízos do cigarro à saúde e escrever seu compromisso de não fumar. |
| `companheiro.VII.3` | companheiro (reg) | RELATÓRIO ESTRUTURADO | R2 — diário de 7 dias | Recapitular a Criação e fazer um diário de 7 dias anotando o que observou do que foi criado em cada dia. |
| `companheiro.VIII.2` | companheiro (reg) | RELATÓRIO ESTRUTURADO | R1 — relato de atividade | Participar de um acampamento de fim de semana e fazer um relatório do que mais impressionou você. |
| `companheiro_de_excursionismo.2` | companheiro (ava) | ATIVIDADE/VALIDAÇÃO | V2 — leitura + conversa (2 confirmações) | Ler a primeira visão de Ellen White (Primeiros Escritos, p. 13–20) e conversar sobre como Deus usa os profetas para falar com a igreja. |
| `companheiro_de_excursionismo.4` | companheiro (ava) | RESPOSTA SIMPLES | A2 — listas | Conversar com o conselheiro ou a Unidade sobre respeitar os pais ou responsáveis e fazer uma lista de como eles cuidam de você. |
| `companheiro_de_excursionismo.5` | companheiro (ava) | RELATÓRIO ESTRUTURADO | R1 — relato de atividade | Fazer uma caminhada de 6 km e, no fim, escrever um relatório de uma página. |
| `excursionista.I.4` | excursionista (reg) | RESPOSTA SIMPLES | A1r — livro + resumo | Ler o livro do Curso de Leitura do ano e fazer um resumo dele em 1 página. |
| `excursionista.I.5` | excursionista (reg) | LEITURA/CONTEÚDO | L1 — confirmação de leitura | Ler o livro da classe: "O Fim do Começo". |
| `excursionista.II.2` | excursionista (reg) | RESPOSTA SIMPLES | A3 — uma resposta por item | Ler e explicar com suas palavras: Romanos 8:28, Apocalipse 21:1-3, II Pedro 1:20-21, I João 2:14, II Crônicas 20:20 e Salmo 46. |
| `excursionista.II.3` | excursionista (reg) | LEITURA/CONTEÚDO | L3 — confirmação de estudo | Estudar a pessoa do Espírito Santo e seu papel no crescimento espiritual. |
| `excursionista.II.4` | excursionista (reg) | LEITURA/CONTEÚDO | L3 — confirmação de estudo | Estudar os eventos finais e a segunda vinda de Cristo. |
| `excursionista.II.5` | excursionista (reg) | LEITURA/CONTEÚDO | L3 — confirmação de estudo | Descobrir, estudando a Bíblia, o verdadeiro significado da observância do sábado. |
| `excursionista.II.6` | excursionista (reg) | LEITURA/CONTEÚDO | L2 — checklist de livros + reconto opcional | Leitura bíblica dos capítulos indicados de Mateus 24 a 28, Marcos, Lucas, João e Atos 1 a 8 (conte o que leu). |
| `excursionista.III.3` | excursionista (reg) | ATIVIDADE/VALIDAÇÃO | V1 — confirmação do responsável | Discutir como o jovem adventista deve se relacionar com as pessoas no dia a dia: vizinhos, escola, atividades sociais e atividades recreativas. |
| `excursionista.IV.1` | excursionista (reg) | RESPOSTA SIMPLES | A4 — escolha de 2 temas + reflexão | Em conversa em grupo ou avaliação pessoal, examinar suas atitudes em 2 destes temas: autoestima, relacionamento familiar, finanças pessoais, pressão de grupo. |
| `excursionista.IV.2` | excursionista (reg) | RELATÓRIO ESTRUTURADO | R5 — lista + atividade organizada | Fazer uma lista com 5 sugestões de atividades recreativas para pessoas com necessidades específicas e ajudar a organizar uma delas. |
| `excursionista.VII.1` | excursionista (reg) | RESPOSTA SIMPLES | A1 — texto livre | Recapitular a história de Nicodemos e relacioná-la com o ciclo de vida da lagarta/borboleta, dando um significado espiritual. |
| `excursionista_na_mata.1` | excursionista (ava) | OUTRO | E2 — escolha: escrito ou falado | Apresentar (por escrito ou falando) o respeito devido à Lei de Deus e às autoridades civis, com 10 princípios de comportamento moral. |
| `excursionista_na_mata.4` | excursionista (ava) | RESPOSTA SIMPLES | A2 — listas | Propor 5 atividades na natureza para fazer no sábado à tarde. |
| `guia.I.4` | guia (reg) | RESPOSTA SIMPLES | A1r — livro + resumo | Ler o livro do Curso de Leitura do ano e fazer um resumo dele em 1 página. |
| `guia.I.5` | guia (reg) | LEITURA/CONTEÚDO | L1 — confirmação de leitura | Ler o livro da classe: "O Livro Amargo". |
| `guia.II.2` | guia (reg) | RESPOSTA SIMPLES | A3 — uma resposta por item | Ler e explicar com suas palavras: I Coríntios 13, II Crônicas 7:14, Apocalipse 22:18-20, II Timóteo 4:6-7, Romanos 8:38-39 e Mateus 6:33-34. |
| `guia.II.3` | guia (reg) | RESPOSTA SIMPLES | A1 — texto livre | Descrever os dons espirituais citados por Paulo (Coríntios, Efésios, Filipenses) e para que a igreja os recebe. |
| `guia.II.4` | guia (reg) | RESPOSTA SIMPLES | A1 — texto livre | Estudar a estrutura do santuário no AT e relacionar ao ministério de Jesus. |
| `guia.II.5` | guia (reg) | RELATÓRIO ESTRUTURADO | R4 — histórias contadas | Ler e resumir 3 histórias de pioneiros adventistas e contá-las numa reunião do Clube, no Culto JA ou na Escola Sabatina. |
| `guia.II.6` | guia (reg) | LEITURA/CONTEÚDO | L2 — checklist de livros + reconto opcional | Leitura bíblica dos capítulos indicados de Atos 9 a 28, das epístolas e do Apocalipse (conte o que leu). |
| `guia.III.2` | guia (reg) | ATIVIDADE/VALIDAÇÃO | V8 — discussão + prática | Discutir com a Unidade métodos de evangelismo pessoal e colocar alguns princípios em prática. |
| `guia.IV.1` | guia (reg) | RESPOSTA SIMPLES | A4 — escolha de 2 temas + reflexão | Assistir a uma palestra ou aula e examinar suas atitudes em 2 destes temas: escolha profissional, relacionamento com os pais, escolha de quem namorar, plano de Deus para o sexo. |
| `guia.V.2` | guia (reg) | OUTRO | E3 — escolha de 1 atividade entre várias | Completar 1 destas atividades: poesia ou artigo sobre saúde para publicação na igreja; organizar uma corrida com programa de treino; ler Temperança (p. 102-125) e apresentar 10 textos selecionados; ou especialidade de Nutrição / liderar Cultura física. |
| `guia.VII.1` | guia (reg) | RESPOSTA SIMPLES | A1 — texto livre | Ler o capítulo 7 de "O Desejado de Todas as Nações" e apresentar as lições sobre a importância da natureza na educação e no ministério de Jesus. |
| `guia_de_exploracao.2` | guia (ava) | RESPOSTA SIMPLES | A1r — livro + resumo | Ler o livro "O Maior Discurso de Cristo" e escrever uma página sobre como a leitura mexeu com a sua vida. |
| `guia_de_exploracao.4` | guia (ava) | OUTRO | E2 — escolha: escrito ou falado | Escrever uma página ou dar uma palestra sobre como influenciar amigos para Cristo. |
| `guia_de_exploracao.5` | guia (ava) | RELATÓRIO ESTRUTURADO | R3 — relato de acompanhamento | Acompanhar por 2 meses o trabalho dos diáconos e fazer um relatório detalhado: cuidado do templo, lava-pés, batismo e recolhimento de dízimos e ofertas. |
| `pesquisador.I.3` | pesquisador (reg) | OUTRO | E2 — escolha: escrito ou falado | Mostrar que entende a Lei do Desbravador por 1 destas atividades: representação, debate ou redação. |
| `pesquisador.I.4` | pesquisador (reg) | RESPOSTA SIMPLES | A1r — livro + resumo | Ler o livro do Curso de Leitura do ano e escrever 2 parágrafos sobre o que mais chamou sua atenção. |
| `pesquisador.I.5` | pesquisador (reg) | LEITURA/CONTEÚDO | L1 — confirmação de leitura | Ler o livro da classe: "Além da magia". |
| `pesquisador.II.2` | pesquisador (reg) | RESPOSTA SIMPLES | A3 — uma resposta por item | Ler e explicar com suas palavras: Eclesiastes 12:13-14, Romanos 6:23, Apocalipse 1:3, Isaías 43:1-2, Salmo 51:10 e Salmo 16. |
| `pesquisador.II.3` | pesquisador (reg) | LEITURA/CONTEÚDO | L2 — checklist de livros + reconto opcional | Leitura bíblica dos capítulos indicados de 1 e 2 Reis, 2 Crônicas, Esdras, Neemias, Ester, Jó, Salmos, Provérbios e Eclesiastes (conte o que leu). |
| `pesquisador.II.4` | pesquisador (reg) | OUTRO | E1 — escolha de forma (tema + forma) | Com o líder, escolher 1 destas histórias e mostrar como Jesus salva as pessoas por 1 método: conversa em grupo com o líder, mensagem numa reunião do Clube, série de cartazes ou maquete, ou poesia/hino. |
| `pesquisador.IV.1` | pesquisador (reg) | ATIVIDADE/VALIDAÇÃO | V4 — participação + resposta | Participar de um debate ou representação sobre pressão de grupo e identificar como ela influencia as decisões. |
| `pesquisador.V.1` | pesquisador (reg) | RESPOSTA SIMPLES | A5 — escolha de atividade + texto | Escolher 1 destas atividades e escrever um texto pessoal por uma vida livre do álcool: discussão em classe sobre os efeitos do álcool no corpo, ou vídeo sobre álcool/drogas seguido de conversa. |
| `pesquisador.VII.1` | pesquisador (reg) | RESPOSTA SIMPLES | A1 — texto livre | Identificar a estrela Alfa do Centauro e a constelação de Órion, e explicar o significado espiritual de Órion (Primeiros Escritos, p. 41). |
| `pesquisador_de_campo_e_bosque.2` | pesquisador (ava) | ATIVIDADE/VALIDAÇÃO | V2 — leitura + conversa (2 confirmações) | Ler a história de J. N. Andrews ou de um pioneiro do seu país e conversar sobre o trabalho missionário e a grande comissão (Mateus 28:18-20). |
| `pesquisador_de_campo_e_bosque.5` | pesquisador (ava) | RELATÓRIO ESTRUTURADO | R1 — relato de atividade | Fazer uma caminhada de 10 km e listar o equipamento necessário, inclusive a roupa e o calçado certos. |
| `pesquisador_de_campo_e_bosque.9` | pesquisador (ava) | RELATÓRIO ESTRUTURADO | R6 — plano de cardápio | Planejar um cardápio vegetariano de 3 dias de acampamento para a Unidade e apresentá-lo ao instrutor. |
| `pioneiro.I.4` | pioneiro (reg) | RESPOSTA SIMPLES | A1r — livro + resumo | Ler o livro do Curso de Leitura do ano e fazer um resumo dele em 1 página. |
| `pioneiro.I.5` | pioneiro (reg) | LEITURA/CONTEÚDO | L1 — confirmação de leitura | Ler o livro da classe: "Expedição Galápagos". |
| `pioneiro.II.2` | pioneiro (reg) | RESPOSTA SIMPLES | A3 — uma resposta por item | Ler e explicar com suas palavras: Isaías 26:3, Romanos 12:12, João 14:1-3, Salmo 37:5, Filipenses 3:12-14, Salmo 23 e I Samuel 15:22. |
| `pioneiro.II.3` | pioneiro (reg) | ATIVIDADE/VALIDAÇÃO | V1 — confirmação do responsável | Conversar no Clube ou na Unidade sobre: o que é cristianismo, as marcas de um verdadeiro discípulo e o que fazer para ser um cristão verdadeiro. |
| `pioneiro.II.4` | pioneiro (reg) | ATIVIDADE/VALIDAÇÃO | V1 — confirmação do responsável | Participar de um estudo com um pastor sobre a inspiração da Bíblia (inspiração, revelação e iluminação). |
| `pioneiro.II.5` | pioneiro (reg) | ATIVIDADE/VALIDAÇÃO | V6 — meta de quantidade (sem dados de terceiros) | Convidar 3 ou mais pessoas para uma classe bíblica ou um pequeno grupo. |
| `pioneiro.II.6` | pioneiro (reg) | LEITURA/CONTEÚDO | L2 — checklist de livros + reconto opcional | Leitura bíblica dos capítulos indicados de Eclesiastes, Isaías, Jeremias, Daniel, Joel, Amós, Jonas, Miqueias, Ageu, Zacarias, Malaquias e Mateus 1 a 23 (conte o que leu). |
| `pioneiro.IV.1` | pioneiro (reg) | RESPOSTA SIMPLES | A4 — escolha de 2 temas + reflexão | Participar de um debate e fazer uma avaliação pessoal das suas atitudes em 2 destes temas: autoestima, amizade, relacionamentos, otimismo e pessimismo. |
| `pioneiro.V.2` | pioneiro (reg) | ATIVIDADE/VALIDAÇÃO | V1 — confirmação do responsável | Discutir as vantagens do estilo de vida adventista segundo a Bíblia. |
| `pioneiro.VII.1` | pioneiro (reg) | LEITURA/CONTEÚDO | L3 — confirmação de estudo | Estudar a história do dilúvio e o processo de fossilização. |
| `pioneiro_de_novas_fronteiras.3` | pioneiro (ava) | RELATÓRIO ESTRUTURADO | R1 — relato de atividade | Fazer 1 destas atividades físicas e entregar um relatório escrito de pelo menos 2 páginas: caminhar 10 km, cavalgar 2 km, 2 horas de canoa, 15 km de bicicleta, nadar 200 m, correr 1.500 m ou 2 km de patins/roller. |
