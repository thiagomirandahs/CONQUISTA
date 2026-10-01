# Roteiro de validação em ANDROID REAL — Fase 8 (checklist final)

**Como usar.** Aparelho Android SIMPLES, conta e clube de TESTE (nunca criança real), 4G. Marque `[ ] → [x] OK` ou `FALHOU` e mande print dos que falharem.
**Nenhum item abaixo foi executado em aparelho físico.** Tudo que está em "PENDENTE NO ANDROID REAL" só pode ser dado como validado depois que VOCÊ marcar.
Complemento: `ROTEIRO-SMOKE-REAL-FASE7.md` (rascunho/offline/conflito/envio — ainda vale).

## O QUE JÁ TEM EVIDÊNCIA (para você não repetir à toa)
| Área | TESTADO AUTOMATICAMENTE (vitest/SQL/E2E contra banco e Storage locais reais) | TESTADO EM NAVEGADOR (emulado 360/390/430, banco local) |
|---|---|---|
| Classes (idade, anteriores, avançadas, bloqueios, sem nascimento, versão, conclusão anterior, conquista única) | SQL 124/125/127/129/131/132; E2E classes 198; concorrência 61 | seções "Disponíveis / Classes anteriores / Bloqueadas / Concluídas anteriormente"; aviso único de nascimento; registrar classe já concluída (passos e confirmação) |
| Comprovação/relato/rascunho/conflito/histórico | SQL 126/130; vitest; E2E relatório 95 e classes | relato salvo no servidor com horário; offline simulado; conflito com duas versões e horários |
| Inscrição (link, QR, código, pendente, aprovação, e-mail em outro navegador) | E2E inscrição 92; **e-mail REAL via Mailpit local 41** (confirmação aberta sem nenhum estado do navegador); contrato impede localhost/127.0.0.1/capacitor:/ionic:/file: nos links | Gestão → Inscrições a 430 px |
| Rede DBV (abas, publicar por papel, conquista por lista, moderação, menores) | SQL 122/123; E2E rede 58, admin no Storage 131 | feed Meu Clube, publicar, lista de conquistas e preview |
| Landing/site | vitest (CTAs, imagens, SEO, canonical) | 360/390/1366 |
| **PENDENTE NO ANDROID REAL** | **TUDO o que está nas seções 1 a 9 abaixo** | |

---
## 1. ABERTURA (PENDENTE NO ANDROID REAL)
- [ ] **Primeira abertura** após instalar/atualizar: abre sem travar na tela de abertura (se passar de ~15 s deve aparecer "Tentar de novo").
- [ ] **Abertura fria** (fechar o app pelos recentes e abrir).
- [ ] **Sessão válida:** entra direto, sem pedir login.
- [ ] **Sessão expirada** (deixe horas/dias sem abrir, ou saia pelo painel em outro aparelho): pede login ou renova sozinho, sem tela branca.
- [ ] **Internet normal / lenta (4G fraco):** botões mostram "Só um instante…", nada duplica ao tocar duas vezes.
- [ ] **Sem internet:** o que já estava carregado abre; erro com "Tentar de novo" onde precisa de rede.
- [ ] **Retorno da conexão:** em até ~1 min indicadores voltam ("Salvo"), nada é enviado para avaliação sozinho.
- [ ] **Fechar e abrir de novo** várias vezes seguidas: sem loop de recarregamento.
- [ ] **Atualização (OTA/PWA):** depois de publicar versão nova, abrir o app: atualiza sem travar o boot e sem loop; versão antiga em cache não fica presa.

## 2. SAFE-AREA E TECLADO (PENDENTE NO ANDROID REAL)
- [ ] **Android por GESTOS:** barra inferior do app acima da linha de gesto; o gesto de voltar na borda não aciona botão do app.
- [ ] **Android com 3 BOTÕES (◁ ○ □):** barra do app acima dos botões do sistema, sem ficar atrás.
- [ ] **Notch/câmera/furo:** nenhum conteúdo atrás da barra superior; cabeçalho legível.
- [ ] **Nenhuma barra preta indevida** (topo, base, laterais) e o app usa a área útil real do aparelho.
- [ ] **Teclado aberto** (relato, formulário, campos da Rede, cadastro): o campo focado nunca fica atrás do teclado; botão principal alcançável; Enter nos campos curtos vai ao próximo.
- [ ] Girar o aparelho (se permitido) e **fonte do sistema aumentada**: rótulos da barra não cortam/quebram o layout.

## 3. INSCRIÇÕES (BUG DO LOCALHOST — prioridade alta) (PENDENTE NO ANDROID REAL)
- [ ] Gestão → **Inscrições** → gerar código/link.
- [ ] **Copiar link** e colar num bloco de notas: começa com `https://app.desbravaclube.com.br/entrar?codigo=…` e **NÃO contém** `localhost`, `127.0.0.1`, `capacitor://`, `ionic://`, `file://`.
- [ ] **Compartilhar** (menu do Android): a mensagem/prévia traz o mesmo endereço.
- [ ] **QR Code:** leia com OUTRO celular → abre `app.desbravaclube.com.br/entrar?codigo=…` (não localhost).
- [ ] **Regerar** o código: QR e link mudam; o código antigo deixa de valer.
- [ ] **Abrir o link em outro aparelho**: mostra o nome do clube → **Criar minha conta**.
- [ ] **Confirmação de e-mail** (só se estiver ligada no painel — hoje em produção a confirmação está DESLIGADA): abra o e-mail em OUTRO navegador/aparelho e confirme.
- [ ] **Login** (sem usar o link de novo): volta ao **clube correto** e cria o **pedido PENDENTE** (código preservado) — nunca ativo sozinho.
- [ ] Pessoa **já com conta**: usa o link → entra → pedido criado sem digitar o código.
- [ ] Diretoria vê o pedido em **Aprovações** e aprova → só então a pessoa acessa o clube; membro comum NÃO vê/aprova.
- [ ] Links de **convite de responsável**, **convite de coordenação**, **verificação de documento (QR do PDF)** e **recuperar senha**: todos com `https://app.desbravaclube.com.br`, nunca localhost.
- [ ] **Recuperar senha:** o e-mail chega (em produção hoje usa o e-mail padrão do Supabase, limitado — ver relatório), o link abre `/nova-senha` e a troca de senha funciona.

## 4. CLASSES (PENDENTE NO ANDROID REAL)
- [ ] **Classes disponíveis pela idade** (com nascimento): "Disponíveis", "Classes anteriores disponíveis" e "Bloqueadas" corretas; ex.: 13 anos vê Amigo, Companheiro, Pesquisador e Pioneiro como disponíveis (anteriores + atual); Excursionista e Guia bloqueadas por idade. **Não há idade máxima.**
- [ ] **Classe anterior:** iniciar Companheiro (anterior) cria nova aba, não aprova nada sozinha, não mexe na classe já em andamento.
- [ ] **Avançada:** sem a regular iniciada/concluída NESTE clube fica "Bloqueada" com o motivo ("Comece a classe … primeiro"); com a regular iniciada neste clube (ou concluída em qualquer clube) fica disponível. Regular só iniciada em OUTRO clube **não** libera.
- [ ] **Membro sem nascimento:** UM aviso "Informe a data de nascimento…" com botão para o Perfil; nenhum botão Iniciar habilitado; depois de informar, as classes aparecem.
- [ ] **Classe já concluída anteriormente:** em "Concluídas anteriormente" (origem/data), sem botão Iniciar; **Corrigir registro** (motivo ≥ 5 letras) e a classe volta a poder ser iniciada.
- [ ] **Registrar classe já concluída** (diretoria/instrutor): membro → classe → data (ou "Não sei a data") → observação → foto opcional (só foto) → Confirme → registrado; ninguém registra para si; não cria matrícula/aprovação/documento.
- [ ] **Comprovação em requisito** simples (sem foto): bloco "Relato / comprovação (opcional)"; salvar rascunho; enviar COM e SEM relato.
- [ ] **Relatório estruturado** (ex.: lista de qualidades), **foto/evidência**, requisito com **texto obrigatório** (relato NÃO substitui a evidência exigida).
- [ ] **Devolução → correção → reenvio:** histórico mostra as DUAS tentativas, cada uma com o seu relato; a 1ª não muda; comentário do avaliador visível.
- [ ] **Autosave, teclado real, rascunho offline** (modo avião: "Salvo neste aparelho"; reabrir offline: texto continua; internet volta: "Salvo").
- [ ] **Conflito:** celular A offline edita, celular B salva outra versão, A volta: "Encontramos duas versões…" com horários e **Usar deste aparelho / Usar da nuvem**.
- [ ] Anexos/foto offline continuam exigindo internet (limitação conhecida).
- [ ] **Conclusão sem duplicidade:** com matrícula em andamento no clube A e registro anterior feito pelo clube B, investir no A mostra "Conclusão já reconhecida (…)" e Minha Jornada mostra UMA conquista.
- [ ] **Matrícula na versão original:** (Tenant 001) a Guia 2026.2 em andamento continua abrindo e concluindo na 2026.2; não existe botão "atualizar matrícula" nesta versão; iniciar a Guia 2026.4 no mesmo clube enquanto a 2026.2 está aberta é recusado com mensagem clara.

## 5. REDE DBV (PENDENTE NO ANDROID REAL)
- [ ] **Meu Clube** (feed, stories, atalho de Desafios) × **Comunidade** (só feed interclubes).
- [ ] **Foto/avatar:** subir foto do post (1 imagem, sem localização), avatar/personagem; menor de outro clube não aparece em busca/perfil.
- [ ] **Publicar:** diretoria/instrutor → "Só meu clube" e "Comunidade (todos os clubes)" (com confirmação); aviso e evento só para eles; desbravador só "Só meu clube".
- [ ] **Comentários:** diretoria/instrutor/conselheiro na Comunidade; tesoureiro só no clube; desbravador só no próprio clube.
- [ ] **Conquista:** "Compartilhar conquista" → lista só de conquistas reais → preview "Nome R. concluiu … 🎉" (sem editar/foto) → Publicar.
- [ ] **Conquista revogada / nova conclusão depois da revogação:** revogue o registro anterior e conclua de novo: nasce UMA conquista ativa nova; a revogada some da lista e fica no histórico.
- [ ] **Stories** (24 h) e **desafios**: publicar e ver.
- [ ] **Moderação:** denunciar oculta na hora; diretoria vê a fila; foto em Comunidade fica em análise até aprovar.
- [ ] **Troca entre clubes** (pessoa com 2 clubes): cada clube mostra o seu feed e o seu progresso.

## 6. TRILHA (PENDENTE NO ANDROID REAL)
- [ ] **Carregar** sem travar, sem rolagem lateral, sem tela branca ao voltar do segundo plano.
- [ ] **Erro de rede** → mensagem clara + **Tentar de novo**.
- [ ] **Funcionamento depois do retorno da internet** (sem recarregar o app).

## 7. LEITURAS / AUDIOBOOK (PENDENTE NO ANDROID REAL)
- [ ] Vaso de Barro → **Ouvir**: toca? Play/Pausa, ±15 s, velocidades (0,75–2), barra/tempo, trocar capítulo, "Você parou em…".
- [ ] Tela bloqueada/segundo plano: o áudio continua? (pode parar — anote).
- [ ] Ouvir até o fim **não** aprova requisito. Galápagos, O Fim do Começo, O Desejado de Todas as Nações e O Maior Discurso de Cristo: **sem** áudio.

## 8. MINHA JORNADA / PORTFÓLIO / ESPECIALIDADES (PENDENTE NO ANDROID REAL)
- [ ] Minha Jornada: só os SEUS dados. Portfólio: só aprovados, sem foto, "Ver mais".
- [ ] Especialidades (só em clube de teste com o recurso ligado): abas, busca/filtro, detalhe com ícone + texto.

## 9. SITE / LANDING NO CELULAR (PENDENTE NO ANDROID REAL)
- [ ] `desbravaclube.com.br` no Chrome do Android: carrega rápido em 4G, sem rolagem lateral, a faixa "Veja como funciona" desliza dentro dela, botões ≥ 44 px, **Conhecer o DesbravaClube** e **Ver planos** funcionam.
- [ ] Compartilhar o link no WhatsApp: mostra a imagem e o texto (a prévia é da página inicial em qualquer rota — limitação conhecida).

## Registro do que foi realmente testado
| Data | Aparelho/Android | Seção | Resultado |
|---|---|---|---|
| | | | |
