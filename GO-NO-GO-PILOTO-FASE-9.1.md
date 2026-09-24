# Fase 9.1 — Go-Live Gate do Piloto: o resultado

> Continuação da [Fase 9](GO-NO-GO-PILOTO-FASE-9.md) ("ainda não"). Esta fase existe só para
> transformar aquele veredito em uma decisão objetiva de GO/NO-GO. Nenhuma funcionalidade comercial,
> gateway, jogo ou módulo novo entrou. Branch `saas-produto-multiclube`, só local, sem push.
> Commits: `f1a46c1..c9ca400` (migrations 80–86).

## A resposta

**Ainda não — um BLOCKER aberto, de decisão do dono, não de código.**

Dos onze itens do gate, dez estão comprovados ou documentados com o status verdadeiro. O único que
impede o GO é o item 6: **criança sem e-mail próprio utilizável não consegue entrar no produto, e
ninguém consegue destravar a conta.** Não é um bug a corrigir — é uma pergunta de produto que só o
dono responde, com as alternativas já postas na mesa (`supabase/infra/MENORES-E-EMAIL.md`).

Todo o resto do gate fecha limpo: o isolamento entre clubes foi auditado, corrigido e reauditado por
um cético; o upgrade foi ensaiado de ponta a ponta sobre um backup (sintético — o real ainda não
chegou, mas a ferramenta está pronta e provada, inclusive com prova negativa); o pré-voo cobre as 80
migrations do SaaS, não mais só 28; e um BLOCKER de segurança real (tomada de conta entre clubes)
foi achado e fechado antes de qualquer piloto abrir.

---

## O que mudou desde a Fase 9

A auditoria desta fase (dois workflows independentes, um de UI/banco e um do pré-voo) encontrou
**duas descobertas que mudam decisões da Fase 9**, não só bugs:

1. **"Cada criança em um clube só" foi REJEITADO como regra do piloto.** O dono pediu explicitamente:
   *"não aceite como solução proibir crianças multi-clube."* O MÉDIO aberto na Fase 9 ("telas listam
   pelo espelho de `profiles`") não era um detalhe — era a UI inteira assumindo clube único. Vira o
   item 1 desta fase, tratado como gate permanente (teste `61_crianca_em_dois_clubes.sql`, 163 asserts).
2. **Um BLOCKER de segurança que a Fase 9 não via:** `resetar_senha_membro` deixava a liderança de
   um clube trocar a senha **global** de qualquer pessoa com vínculo ali — inclusive de quem
   administra a plataforma, se essa pessoa também fosse diretoria de um clube comum. Achado pela
   revisão adversarial desta fase, fechado nas migrations 80 e 86.

---

## Matriz de GO (os onze critérios do pedido)

| # | critério | resultado | evidência |
|---|---|:---:|---|
| 1 | UI multi-clube de membros | ✅ **PASS** | `membros_do_clube()` pelo vínculo do clube da aba, em toda tela que lista pessoas (chamada, ranking/unidades/temporada, mensalidades, atividades, chat, ajuda, radar, acampamento). Verificado ao vivo: Lia (desbravadora em A **e** em B, unidades próprias em cada) aparece certa nas duas abas — ver §"Prova ao vivo". Gate permanente: teste 61 (163 asserts) + contrato de front que proíbe leitura do espelho `profiles` para operação de clube. |
| 2 | pré-voo 1..79+ | ✅ **PASS** | `PREFLIGHT-PRODUCAO.sql` reescrito: 41 verificações cobrindo as migrations 1–80, cada uma **provada com caso negativo** (110 casos, `scripts/testar-preflight.mjs`, 216 OK/0 falhas). Achou e fecha um caso real: objeto legado de outro dono passava com "RESUMO ok" e abortava a migration 67 no meio da janela. |
| 3 | upgrade de cópia real da produção | ⚠️ **PASS no sintético — falta o backup real** | `scripts/ensaio-producao.mjs`: backup → ambiente descartável → restore → pré-voo → migrations 1–86 → antes×depois linha a linha → suíte → Tenant 001 pela API. **ENSAIO OK** com um backup sintético de produção (estado legado real + dados vivos). `--sabotar` prova a prova negativa: NO-GO correto quando um caixa é alterado, uma foto some e um membro é suspenso depois das migrations. **Falta**: o dono baixar o backup real do painel e rodar `node scripts/ensaio-producao.mjs ensaiar <arquivo>`. |
| 4 | Tenant 001 pós-upgrade | ✅ **PASS** | Etapa 9 do ensaio: login real pelo Auth (inclusive com a senha de ANTES do upgrade, provando o hash restaurado), Home, Membros, Unidades, Pontos, Ranking, Jogos, Chat, Mensalidades (caixa do tesoureiro), Gestão, Classes (recurso desligado recusado no servidor), Responsável — todas verdes. |
| 5 | backup/restore | ⚠️ **PASS no local — PENDENTE no hospedado** | Local: `scripts/restaurar-staging.mjs completo` — RESTORE COMPROVADO de novo nesta fase (corrigiu de quebra um resíduo de 100 linhas órfãs deixado pela limpeza do teste de carga). Hospedado: `scripts/verificar-backup-hospedado.mjs` + `BACKUP-PITR-HOSPEDADO.md` prontos; nunca rodados contra o projeto do piloto (não existe ainda). "A opção existe no painel" não conta como prova — falta o restore de teste real. |
| 6 | Auth/rate limiting | ⚠️ **PASS no local — PENDENTE no hospedado** | `scripts/verificar-auth-hospedado.mjs`: 17 critérios obrigatórios, PASS/FAIL/NÃO-VERIFICÁVEL, com guarda que recusa apontar para produção. Rodado contra o staging local (a parte da Management API fica NÃO-VERIFICÁVEL, como esperado sem token do projeto real). Documenta por que brute-force não se resolve no React. Falta rodar contra o projeto do piloto. |
| 7 | fluxo de e-mail | ⛔ **BLOCKER — decisão do dono, não código** | `MENORES-E-EMAIL.md`: confirmação de e-mail obrigatória + único método (e-mail/senha) torna o fluxo **inviável para criança sem e-mail próprio utilizável** — ela se cadastra e fica sem saída, e ninguém no produto consegue destravar. 7 alternativas na mesa, com prós/contras/esforço/risco LGPD-ECA, sem solução pronta. Sai de BLOCKER só com decisão do dono ou template pt-BR aplicado (se o e-mail for viável) mais confirmação de SMTP real. |
| 8 | classes do piloto controladas | ✅ **PASS** | Conteúdo anual com ano obrigatório, vigência fechada, sem fallback de outro ano, fuso do clube; requisito já enviado/aprovado fixa o valor (não reabre na virada do ano); publicação só via `conteudo_anual_publicar(pacote, hash)`, com hash recomputado no banco contra o manifesto e cobertura completa exigida. Procedimento operacional documentado (`PUBLICACAO-CONTEUDO-ANUAL.md`); UI administrativa fica pós-piloto, como o dono autorizou. |
| 9 | especialidades de teste invisíveis | ✅ **PASS** | Recurso `especialidades` nasce desligado e **só a plataforma liga** — nem a liderança do clube, nem pelo onboarding. As 11 RPCs de especialidade exigem o recurso; a RLS do catálogo só mostra `origem = 'oficial'`; as 4 experiências `[TESTE]` que a migration 49 semeava no Tenant 001 foram removidas quando sem uso. Verificado ao vivo: `recurso_definir('especialidades', true)` pela liderança do clube é **recusado**. |
| 10 | isolamento A/B/C hospedado | ⚠️ **PASS no staging local — PENDENTE no hospedado** | Staging local recriado do zero com as migrations 1–86, repovoado, **5 gates pela API: 1.116 verificações, 0 falhas** (leitura, escrita, contexto, portátil, identidade); **red-team: 50 ataques segurados, 0 furos** (3 achados conhecidos, sem furo novo). Capacidade hospedada: `rampa-hospedada.mjs` + `CAPACIDADE-HOSPEDADA.md` prontos, degraus 10→200, guarda de produção; staging hospedado ainda não existe. |
| 11 | observabilidade | ✅ **PASS** (herdado da Fase 9, sem regressão) | Trilha de operações críticas e telemetria sem segredo continuam ativas; nada nesta fase tocou esse mecanismo. |

**Legenda:** ✅ PASS comprovado · ⚠️ PASS parcial (comprovado onde dá para comprovar sem acesso ao
projeto hospedado ou ao backup real; o resto é ferramenta pronta + PENDENTE) · ⛔ BLOCKER.

---

## O BLOCKER, em detalhe

**Item 6 — crianças e e-mail.** Hoje:

- único método de login é e-mail + senha, com confirmação de e-mail **obrigatória**;
- não há `auth.admin` nem qualquer caminho administrativo para confirmar uma conta por fora;
- a liderança **não pode mais** redefinir a senha de quem é de dois clubes (correção de segurança
  desta fase) — para uma criança nessa situação e sem e-mail, não sobra recuperação nenhuma;
- não há idade mínima, termo de uso, política de privacidade nem consentimento do responsável no
  cadastro de menor — risco LGPD/ECA à parte do e-mail.

As 7 alternativas documentadas (`MENORES-E-EMAIL.md`, §4) vão de "a liderança confirma o e-mail ao
aprovar" (barato, mas fura a garantia de posse do e-mail) a "login por apelido com e-mail sintético
num domínio do produto" (mais trabalho, mas resolve de vez e não depende de caixa de entrada
nenhuma). Nenhuma foi implementada — a decisão é do dono, não uma escolha técnica.

**Pergunta de campo que decide o peso disso no piloto:** quantas das crianças dos 2–3 clubes
convidados têm hoje um e-mail que elas (ou o responsável) conseguem abrir? Se a resposta for "quase
todas", o BLOCKER pode conviver com o piloto (cadastre com o e-mail do responsável, avise a família).
Se for "poucas", o piloto não pode começar sem uma alternativa implementada.

---

## O que foi corrigido nesta fase

**Servidor** (migrations 80–86, todas com teste que fica vermelho sem elas):

- **80** — `membros_do_clube()` (a fonte nova para toda UI de pessoas, pelo vínculo do clube da
  aba); `resetar_senha_membro`/`membro_definir_teste`/`membro_definir_foto` recusam quem participa
  de outro clube; a liderança perde a permissão de editar o perfil global (nome, nascimento) de
  terceiro; `mensalidades_ano` no portão financeiro certo.
- **81** — chefão, duelo, bônus diário, ajudas, lembretes e token de partida contam só o clube da
  ação; `trilha_jogos` ganha índice único por clube.
- **82** — ponto e aviso sem `club_id` explícito carimbados pela **aba** (não pelo "clube mais
  novo"); "cadastro aprovado" pelo vínculo; o mesmo responsável pode ser aprovado para a mesma
  criança em dois clubes.
- **83** — especialidades atrás de um recurso só-da-plataforma.
- **84** — conteúdo anual de classes com vigência explícita, sem fallback de ano.
- **85** — três defeitos que a auditoria do pré-voo achou de passagem: `excluir_usuario` falhava com
  erro de FK quando o líder tinha histórico curricular (agora recusa com mensagem clara); o job
  `reconciliar-armazenamento` sempre falhava (rodava sem sessão, e a RPC exigia admin); o lance
  conjunto do leilão calculava a reserva errada desde a migration 60.
- **86** — os achados **confirmados** de uma revisão adversarial de quatro lentes (segurança,
  multi-clube, regressão do clube de um só, currículo), cada achado reproduzido por um cético antes
  de entrar aqui: o BLOCKER de segurança do §"O que mudou"; nascimento completo vazando pela API
  para qualquer colega de clube (agora só pela RPC `meu_perfil()`, e **a ordem de deploy importa**:
  front e APK novos antes desta migration, mesmo padrão da migration 32); missão/devocional que
  valiam "um por dia" somando os clubes; e mais sete achados BAIXO.

**Front:** `Login.jsx` não decide mais pelo espelho; `Entrar.jsx` fala a verdade para quem está
suspenso/recusado em vez de "Pedido enviado" falso; `ClubeGuard` trata vínculo suspenso; o sino e os
popups recarregam ao trocar de clube; o chat relê a conversa (o Realtime não leva o header do clube).

## Prova ao vivo

Staging recriado do zero com as migrations 1–86, povoado pelos três clubes sintéticos (A/B/C),
verificado com a identidade **Lia A-e-B** (desbravadora em A com unidade própria, desbravadora em B
com unidade própria) logada no navegador:

- na aba **A** (Filhos da Conquista): unidade "Unidade Tenant 001", 4 membros, Lia entre eles com 20
  pts — só gente de A;
- trocando para a aba **B** (Águias do Vale): unidade "Andorinhas", 2 membros — Lia e Rui A-B-C, com
  a unidade e o papel do **vínculo de B**, sem nenhum traço do clube A.

Confirmado também direto no servidor, pela mesma RPC que a tela usa: `membros_do_clube()` na sessão
de Lia com `x-clube-atual=B` devolve papel `desbravador`/unidade `Andorinhas` — o espelho de
`profiles` (que aponta para o clube primário A) não influencia o resultado.

## O que falta para o GO

1. **Decisão do dono sobre o item 6** (ou implementar uma das alternativas e testá-la).
2. Quando o dono baixar um backup real: `node scripts/ensaio-producao.mjs ensaiar <arquivo>`.
3. Quando existir o projeto hospedado do piloto: `verificar-auth-hospedado.mjs`,
   `verificar-backup-hospedado.mjs` (com restore de teste real) e uma rampa de carga gradual
   (`rampa-hospedada.mjs`) contra ele.

Nenhum desses três é trabalho de código pendente — são passos que só o dono ou o ambiente hospedado
habilitam. O produto, pela evidência desta fase, está pronto para o piloto assim que o item 6 for
decidido.
