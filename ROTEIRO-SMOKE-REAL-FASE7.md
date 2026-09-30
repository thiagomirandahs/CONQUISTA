# Roteiro de smoke real — Minha Classe, rascunho, offline e conflito (Fase 7 publicada)

Use uma **conta de teste controlada** (nunca a de uma criança real) num clube com a Classe Amigo iniciada. Celular Android de entrada, Chrome, 4G.
Requisito sugerido: `amigo.IV.1` (listas) ou o diário de 7 dias (Companheiro, `companheiro.VII.3`).

## A. Rascunho
1. Minha Classe → abrir o requisito → o formulário aparece.
2. Digitar 3 qualidades. Conferir o indicador: **Salvando…** → **Salvo**.
3. Fechar o app/aba. Reabrir → Minha Classe → o mesmo requisito. **O texto digitado deve estar lá.**
4. Confirmar que o requisito **não** foi para avaliação (status continua "Rascunho", nada na fila da diretoria).

## B. Offline
1. Com o formulário aberto, ligar o **modo avião**.
2. Continuar digitando. Conferir **Salvo neste aparelho**.
3. Fechar e reabrir o app ainda offline: o texto continua.
4. Desligar o modo avião. Em até ~1 minuto (ou ao voltar para o app) o indicador muda para **Salvo** sozinho.
5. Confirmar de novo que **nada foi enviado** para avaliação.

## C. Conflito (duas versões)
1. No celular A: escrever "Versão A" e deixar sincronizar (Salvo).
2. No celular B (ou no computador), mesma conta: abrir o requisito e trocar para "Versão B" (Salvo).
3. No celular A: ligar o modo avião e editar para "Versão A2" (Salvo neste aparelho). Voltar a internet **depois** de abrir o app.
4. Deve aparecer **"Encontramos duas versões deste relatório."** com **VERSÃO DESTE APARELHO** (horário) e **VERSÃO SALVA NA NUVEM** (horário) e os botões **Usar deste aparelho** / **Usar da nuvem**.
5. Escolher uma. Conferir que a outra ficou recuperável ("Recuperar a outra versão"). Nada some sem escolha.
6. Enquanto não escolher, o botão Enviar não deve funcionar.

## D. Envio, devolução, correção, reenvio (com a diretoria de teste)
1. Completar o formulário → Enviar. A diretoria vê na fila (conteúdo, anexos, tentativa 1).
2. Diretoria **devolve sem comentário** → deve ser recusado. Devolve **com** comentário.
3. O membro vê o comentário, corrige, reenvia → tentativa 2. "Ver histórico" mostra **as duas** com o conteúdo de cada.
4. Outra pessoa da diretoria aprova. A própria pessoa da diretoria **não** consegue aprovar a própria classe.

## E. Teclado e rede lenta (Android pequeno)
- 360 px: nenhum campo some atrás do teclado; Enter nos campos curtos vai para o próximo; maiúscula no começo de frase.
- Rede lenta (Chrome DevTools → Slow 4G, ou 4G fraco real): botão "Só um instante…" ao enviar; erro de rede mostra "Erro ao sincronizar" com **Tentar de novo**, sem perder texto.

Marque cada item OK/FALHOU e me envie prints dos falhos.
