# Roteiro objetivo — Android real (Fase 8, versão final)

Use uma conta de TESTE num clube de teste (nunca conta de criança real). Celular Android simples, Chrome ou APK, 4G.
Marque **OK / FALHOU** e mande print dos que falharem. O roteiro da Fase 7 (rascunho, offline, conflito, envio) continua em `ROTEIRO-SMOKE-REAL-FASE7.md`.
**Nada daqui foi testado em aparelho físico.** Tudo abaixo está PENDENTE até você marcar.

## JÁ VALIDADO AUTOMATICAMENTE (navegador emulado + banco local; não substitui o aparelho)
Sem rolagem lateral, alvos ≥ 44 px e fonte ≥ 16 px em 360/390/430/768 nas telas Minha Classe (detalhe, formulário, seções de classes), Leituras, Minha Jornada, Portfólio, Especialidades e Rede; conflito de rascunho com horários; conquista (lista → preview → publicar) contra o servidor; classes anteriores e bloqueadas.

## PENDENTE APARELHO REAL

### A. Abertura e rede
1. **Abertura fria:** feche o app por completo, abra de novo. Entra sem travar na tela de abertura (limite ~15 s; se passar, deve aparecer "Tentar de novo").
2. **Sessão expirada:** deixe o app fechado por horas/dias e abra: pede login ou renova sozinho, sem tela branca.
3. **Internet lenta (4G fraco):** botões mostram "Só um instante…" e nada duplica ao tocar duas vezes.
4. **Sem internet:** modo avião → Minha Classe abre o que já estava carregado; o relatório continua editável ("Salvo neste aparelho").
5. **Retorno da conexão:** desligue o modo avião; em até ~1 min o indicador vira "Salvo" sozinho e nada foi enviado para avaliação sem você tocar.

### B. Teclado e safe-area
1. **Teclado aberto** (formulário do relatório, campo da Rede): o campo focado nunca fica atrás do teclado; Enter nos campos curtos vai ao próximo; maiúscula no começo de frase.
2. **Safe-area com GESTOS** (Android sem botões): a barra inferior do app fica acima da barra/linha de gesto, sem cobrir nem ficar colada; o gesto de voltar pela borda não aciona botão do app.
3. **Safe-area com 3 BOTÕES** (◁ ○ □): a barra do app fica acima dos 3 botões do sistema, sem ficar atrás deles.
4. Gire o aparelho (se o app permitir) e aumente a fonte do sistema: rótulos da barra não cortam nem quebram o layout.

### C. Minha Classe
1. Progresso geral, progresso por seção, botão **Continuar** leva ao próximo requisito; status com ícone + texto (não só cor).
2. **Classes anteriores disponíveis:** com data de nascimento que dê idade para mais de uma classe, "+ Iniciar outra classe" mostra as seções **Disponíveis**, **Classes anteriores disponíveis** e **Bloqueadas**. Inicie uma classe anterior: aparece em nova aba, sem aprovar nada sozinha, sem mexer na classe que já estava em andamento.
3. **Classe concluída anteriormente:** numa pessoa que concluiu uma classe em OUTRO clube, a classe aparece em "Concluídas anteriormente" (com clube e data), **sem** botão Iniciar, e não é oferecida como pendente.
4. **Avançada bloqueada:** sem a regular iniciada/concluída no clube, a avançada fica em "Bloqueadas" com o motivo em português ("Comece a classe … primeiro"). **Avançada liberada:** depois de iniciar a regular NESTE clube (ou de concluí-la em qualquer clube), a avançada passa a "Disponíveis"/"anteriores" e inicia. (Regular só iniciada em OUTRO clube **não** libera.)
5. **Sem data de nascimento:** aparece UM aviso "Informe a data de nascimento para verificar quais classes estão disponíveis." com botão para o Perfil; nenhuma classe inicia até informar; depois de informar, as classes aparecem.

### D. Leituras e audiobook (mais importante)
1. Leituras → Vaso de Barro → **Ouvir audiobook** toca?
2. Play/Pausa, **−15 s / +15 s**, velocidades (0,75 · 1 · 1,25 · 1,5 · 2), barra e tempo.
3. Trocar de capítulo; fechar e reabrir: **"Você parou em…"** retoma no ponto certo.
4. Tela bloqueada / app em segundo plano: o áudio continua? (pode parar — diga o que acontece).
5. Ouvir até o fim **não** marca requisito como aprovado.
6. Expedição Galápagos, O Fim do Começo, O Desejado de Todas as Nações e O Maior Discurso de Cristo: **sem** áudio.

### E. Rede, Meu Clube e Comunidade
1. **Meu Clube** (aba padrão): feed, **stories** e atalho de **Desafios** só aqui. **Comunidade:** só feed interclubes (sem stories/desafios).
2. Como **diretoria/instrutor**: publicar "Só meu clube" e "Comunidade (todos os clubes)" (com confirmação); aviso e evento só para eles.
3. Como **desbravador**: só "Só meu clube"; nenhum caminho para Comunidade, aviso ou evento.
4. **Conquista na Rede** (diretoria/instrutor): "Compartilhar conquista" → lista só de conquistas reais do seu clube → preview "Nome R. concluiu … 🎉" (sem editar, sem foto) → Publicar. Sem conquista disponível: mensagem clara.
5. **Story** e **desafio**: publicar e ver; a foto sobe e aparece; sem metadado de localização.
6. Comentar: diretoria/instrutor/conselheiro na Comunidade; tesoureiro só no clube.

### F. Minha Jornada, Portfólio, Especialidades
1. Minha Jornada: só os SEUS dados (Classes, Especialidades se ligadas, Investiduras, Leituras, Conquistas).
2. Portfólio: só aprovados, sem foto; texto diz que não é o documento oficial; "Ver mais" funciona.
3. Especialidades (só num clube de teste com o recurso ligado): abas Em andamento · Concluídas · Explorar; busca/filtro; detalhe com ícone + texto.
