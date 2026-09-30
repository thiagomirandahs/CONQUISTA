# Roteiro objetivo — Android real (Fase 8)

Use uma conta de TESTE num clube de teste (nunca conta de criança real). Celular Android simples, Chrome ou APK, 4G.
Marque **OK / FALHOU** e mande print dos que falharem. (O roteiro da Fase 7 — rascunho, offline, conflito, envio — continua em `ROTEIRO-SMOKE-REAL-FASE7.md`.)

## VALIDADO AUTOMATICAMENTE (não precisa repetir, só conferir se quiser)
Sem rolagem lateral, alvos ≥ 44 px e fonte ≥ 16 px em 360/390/430/768 nas telas Minha Classe (com detalhe e formulário), Leituras, Minha Jornada, Portfólio, Especialidades (abas, Explorar, detalhe) e conflito de rascunho; rascunho gravado no servidor com horário; conflito "duas versões" com horários reais (offline simulado); Especialidades com fixture local.

## PENDENTE APARELHO REAL
### A. Minha Classe
1. Abrir Minha Classe: barra de progresso, contagens, botão **Continuar** leva ao próximo requisito.
2. Abrir um requisito: aparecem ícone + texto do status (não só cor).
3. Teclado aberto: o campo focado nunca fica atrás do teclado; Enter nos campos curtos vai ao próximo.
### B. Leituras e player (mais importante)
1. Leituras → Vaso de Barro → **Ouvir audiobook**. O áudio toca?
2. **Play/Pausa**, **−15 s / +15 s**, velocidade (0,75 · 1 · 1,25 · 1,5 · 2), barra de progresso e tempo.
3. Trocar de capítulo. Fechar e reabrir: aparece **"Você parou em…"** e retoma no ponto certo.
4. Tela bloqueada / app em segundo plano: o áudio continua? (Pode parar — me diga o que acontece.)
5. Confirmar que ouvir até o fim **não** marca o requisito da Classe como aprovado.
6. Expedição Galápagos e O Fim do Começo: **não** devem oferecer áudio.
### C. Minha Jornada e Portfólio
1. Minha Jornada mostra Classes, Especialidades (se ligadas), Investiduras, Leituras, Conquistas; só as SUAS.
2. Portfólio lista só o que foi aprovado, sem foto; o texto diz que não é o documento oficial.
### D. Especialidades (só com o recurso ligado num clube de teste)
1. Abas Em andamento · Concluídas · Explorar; busca e filtro por área; "Ver mais".
2. Detalhe: lista de requisitos com ícone + texto; formulário igual ao das Classes.
### E. Rede / Meu Clube / Comunidade (depois da migration 515 local)
1. Como diretoria: publicar "Só meu clube" e "Comunidade".
2. Como desbravador: só "Só meu clube" aparece; nenhum caminho para a Comunidade interclubes.
3. Foto do post: 1 imagem, sobe e aparece no feed do clube.
### F. Geral
App abre sem travar na abertura (Fase 7), sem tela branca ao voltar do segundo plano, APK e PWA.
