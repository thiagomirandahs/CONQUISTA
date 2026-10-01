# Roteiro PRÁTICO — Android real (Fase 8)

**Você faz os testes físicos; eu não marco nada como testado.** Use um clube e contas de TESTE (nunca criança real), 4G, Android simples.
Para cada item: marque `[x]` se o **Resultado esperado** aconteceu; se não, marque `FALHOU` e mande print + o texto do "Se falhar".

Legenda do que já tem evidência (não precisa repetir): **AUTOMÁTICO** = vitest/SQL/E2E contra banco e Storage locais · **NAVEGADOR** = Chrome emulado (360/390/430) com banco local · **ANDROID REAL** = só você.
Tudo abaixo está **PENDENTE NO ANDROID REAL**.

---
## BLOCO 1 — PRIORIDADE MÁXIMA: ABERTURA (10 min)
- [ ] **Primeira abertura** (app recém-instalado/atualizado)
  Resultado esperado: abre a tela do logo e entra na tela de login/início em até ~15 s, sem tela branca.
  Se falhar: print + diga se apareceu "Tentar de novo".
- [ ] **Abertura fria** (feche o app pelos recentes e abra de novo)
  Esperado: abre rápido e já logado.
  Se falhar: print; anote quantos segundos levou.
- [ ] **Sessão expirada** (fique algumas horas sem abrir ou saia da conta em outro aparelho e volte)
  Esperado: pede login ou renova sozinho, sem tela branca nem erro técnico.
  Se falhar: print do erro.
- [ ] **Internet lenta** (use "economia de dados"/sinal fraco; abra Minha Classe)
  Esperado: botões mostram "Só um instante…", nada duplica ao tocar duas vezes.
  Se falhar: print + o que duplicou.
- [ ] **Sem internet** (modo avião, app já aberto antes)
  Esperado: o que já estava carregado continua; onde precisa de rede aparece mensagem amigável com "Tentar de novo".
  Se falhar: print.
- [ ] **Internet voltou** (desligue o modo avião)
  Esperado: em até ~1 min tudo volta ao normal sozinho ("Salvo"); nada é enviado para avaliação sem você tocar.
  Se falhar: print + o que ficou preso.

## BLOCO 2 — BARRAS, GESTOS E TECLADO (10 min)
- [ ] **Barra superior correta** — Esperado: nada do app fica atrás da barra de status/câmera/notch; cabeçalho legível. Se falhar: print.
- [ ] **Navegação por gestos** — Esperado: a barra de baixo do app fica ACIMA da linha de gesto; voltar pela borda não aperta botão do app. Se falhar: print.
- [ ] **Android com 3 botões (◁ ○ □)** — Esperado: a barra do app fica acima dos 3 botões do sistema, sem ficar escondida. Se falhar: print.
- [ ] **Teclado aberto** (relato, cadastro, campo da Rede) — Esperado: o campo que você digita nunca fica atrás do teclado; o botão principal continua alcançável. Se falhar: print com o teclado aberto.
- [ ] **Nada atrás das barras do sistema / sem barra preta indevida** — Esperado: o app usa a área útil real do aparelho. Se falhar: print.

## BLOCO 3 — INSCRIÇÕES NO APK (bug do localhost) (15 min)
- [ ] **Gestão → Inscrições** abre (como diretoria).
- [ ] **Copiar link** e colar num bloco de notas
  Esperado: começa com `https://app.desbravaclube.com.br/entrar?codigo=…`.
  Se falhar: copie e me mande o endereço exato.
- [ ] **URL começa com https://app.desbravaclube.com.br** e **NUNCA contém** `localhost`, `127.0.0.1`, `capacitor://`, `ionic://`, `file://`
  Se falhar: foto da tela com o endereço — é bug grave.
- [ ] **Compartilhar** (menu do Android) — Esperado: a mensagem traz o mesmo endereço. Se falhar: print da prévia.
- [ ] **QR** — Esperado: ao ler com OUTRO celular abre `app.desbravaclube.com.br/entrar?codigo=…`. Se falhar: print do que abriu.
- [ ] **Abrir em outro celular** — Esperado: aparece o nome do clube e "Criar minha conta" / "Já tenho conta". Se falhar: print.
- [ ] **Cadastro** — Esperado: conta criada. (Hoje a confirmação de e-mail está DESLIGADA em produção: não chega e-mail.)
- [ ] **Login** (sem usar o link de novo) — Esperado: volta ao clube correto com "pedido enviado" (PENDENTE). Se falhar: print.
- [ ] **Pedido pendente** — Esperado: a pessoa NÃO acessa o clube ainda. Se falhar: print do que ela vê.
- [ ] **Aprovação** (diretoria, em Aprovações) — Esperado: o pedido aparece e aprova. Se falhar: print.
- [ ] **Acesso** — Esperado: só depois de aprovado a pessoa entra no clube certo, com o papel de desbravador. Se falhar: print.

## BLOCO 4 — MINHA CLASSE (20 min)
- [ ] **Minha Classe** abre com a barra de progresso e o botão Continuar. Se falhar: print.
- [ ] **Classe atual** — Esperado: aparece como "Em andamento" com o percentual certo.
- [ ] **Classe anterior** (pessoa com idade para mais de uma classe: "+ Iniciar outra classe")
  Esperado: seção "Classes anteriores disponíveis"; iniciar uma cria nova aba sem aprovar nada e sem mexer na classe em andamento.
  Se falhar: print da lista.
- [ ] **Avançada** — Esperado: sem a regular iniciada/concluída NESTE clube fica em "Bloqueadas" com o motivo em português; com a regular iniciada aqui, libera.
- [ ] **Relato** (abra qualquer requisito) — Esperado: bloco "Relato / comprovação (opcional)"; salvar rascunho; enviar COM e SEM relato.
- [ ] **Relatório** (requisito de formulário, ex.: lista de qualidades) — Esperado: formulário normal; o relato aparece à parte.
- [ ] **Foto** (requisito que pede foto) — Esperado: tirar/escolher foto e enviar; sem foto não envia quando é obrigatória.
- [ ] **Rascunho** — Esperado: digite, feche o app, abra de novo: o texto está lá, nada foi enviado.
- [ ] **Offline** — Esperado: no modo avião continua digitando e aparece "Salvo neste aparelho".
- [ ] **Sincronização** — Esperado: ao voltar a internet vira "Salvo"; se você editou em outro aparelho, aparece "Encontramos duas versões…" com horários e botões **Usar deste aparelho / Usar da nuvem**.
- [ ] **Devolução e reenvio** (diretoria devolve com comentário) — Esperado: o histórico mostra as DUAS tentativas, cada uma com o seu relato; a primeira não muda.
- [ ] **Sem data de nascimento** (conta de teste sem nascimento) — Esperado: um aviso "Informe a data de nascimento…" e nenhum botão Iniciar.
- [ ] **Registrar classe já concluída** (diretoria/instrutor: Gestão → Classes já concluídas) — Esperado: membro → classe → data (ou "Não sei a data") → observação → confirmação → registrado; **Corrigir registro** pede motivo e a classe volta a poder ser iniciada.

## BLOCO 5 — REDE DBV (15 min)
- [ ] **Rede** abre. Se falhar: print.
- [ ] **Meu Clube** — Esperado: feed, stories e atalho de Desafios.
- [ ] **Comunidade** — Esperado: só o feed entre clubes.
- [ ] **Publicar** (diretoria/instrutor) — Esperado: "Só meu clube" e "Comunidade (todos os clubes)" com confirmação; desbravador só "Só meu clube".
- [ ] **Foto/avatar** — Esperado: foto do post sobe e aparece; sem localização na foto.
- [ ] **Conquista** — Esperado: "Compartilhar conquista" mostra só conquistas reais; preview "Nome R. concluiu … 🎉"; publicar.
- [ ] **Story** — Esperado: publica e aparece por 24 h em Meu Clube.
- [ ] **Desafio** — Esperado: abre e participa.
- [ ] **Comentários** — Esperado: diretoria/instrutor/conselheiro comentam na Comunidade; tesoureiro só no clube.

## BLOCO 6 — TRILHA (5 min)
- [ ] **Carregar** — Esperado: abre sem travar e sem rolagem lateral.
- [ ] **Ficar offline** (modo avião e abrir a Trilha) — Esperado: mensagem amigável, sem tela branca.
- [ ] **Erro amigável + Tentar novamente** — Esperado: toque em "Tentar de novo" com a internet de volta carrega sem reiniciar o app.

---
## BLOCOS EXTRAS (se sobrar tempo)
- [ ] **Leituras/audiobook:** Vaso de Barro → Ouvir: toca; play/pausa, ±15 s, velocidade, "Você parou em…"; ouvir até o fim NÃO aprova requisito; Galápagos, O Fim do Começo, O Desejado de Todas as Nações e O Maior Discurso de Cristo SEM áudio.
- [ ] **Minha Jornada/Portfólio:** só os seus dados; Portfólio sem foto e "Ver mais".
- [ ] **Site no celular** (`desbravaclube.com.br`): carrega rápido, sem rolagem lateral, "Veja como funciona" desliza dentro da faixa.
- [ ] **Atualização do app (OTA/PWA)** depois do deploy: abre sem travar e sem loop.
- [ ] **Recuperar senha** (só depois do SMTP próprio): e-mail chega, link abre `/nova-senha`, troca funciona.

## Registro do que foi realmente testado
| Data | Aparelho/Android | Bloco | Resultado |
|---|---|---|---|
| | | | |
