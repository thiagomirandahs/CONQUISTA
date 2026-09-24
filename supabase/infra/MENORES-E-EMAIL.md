# Crianças e e-mail: como o produto cria e autentica contas de menores

> Fase 9.1, item 6. Documento de **decisão**. Nada foi implementado e nada foi mudado no Auth.
> Base: a frente "menores-email" da auditoria desta rodada, conferida no código e no staging local
> (versão 79, com a migration 80 em andamento nesta mesma rodada).

## Resposta curta

**BLOCKER para a criança sem e-mail próprio utilizável.** Hoje o único jeito de entrar é e-mail +
senha, com **confirmação de e-mail obrigatória**. A criança sem uma caixa de e-mail que ela (ou
alguém por ela) consiga abrir faz o cadastro e depois fica sem saída: não confirma, então não entra;
sem entrar, não usa o código do clube e nunca aparece para a liderança. Ninguém no produto consegue
destravar essa conta.

Para a criança **com** e-mail utilizável, o fluxo é **adequado ao piloto com ressalvas**. Faltam
SMTP próprio e templates em português (`AUTH-HOSPEDADO.md`), e há textos de tela que confundem (§5).

À parte do e-mail, vale para todas as crianças: o produto coleta nome, e-mail e nascimento de menores
**sem idade mínima, sem termo, sem política de privacidade e sem consentimento do responsável**. É
risco LGPD/ECA que pede decisão jurídica, não código.

---

## 1. Como é hoje, passo a passo

### 1.1 Cadastro da criança (`src/pages/Cadastro.jsx`)

1. Formulário público: nome, **foto** (opcional), **e-mail**, **senha**, **data de nascimento** e
   função no clube. A data é um `input type="date"` sem mínimo nem máximo.
2. `supabase.auth.signUp({ email, password, options.data: { nome, nascimento, cargo } })`. O
   cadastro não passa `emailRedirectTo`, então o link de confirmação volta para o `site_url` do projeto.
3. No banco, o gatilho `on_auth_user_created` roda **ao inserir** em `auth.users`, ou seja, antes da
   confirmação, e chama `handle_new_user` (migration 70). Ele grava só a **identidade**: um `profiles`
   com nome, nascimento e cargo. **Nenhum vínculo com clube.** O servidor converte o nascimento sem
   validar faixa. `profiles.nascimento` aceita nulo e não tem CHECK.
4. A **foto nunca é enviada** com a confirmação ligada: o envio depende de `data.session`, e o
   `signUp` sem confirmação não devolve sessão. O erro é engolido, e a foto some sem aviso.
5. `signOut()` e tela de sucesso: *"Sua conta está pronta! Agora é só entrar e usar o código do seu
   clube"*. A tela **não fala do e-mail de confirmação**. E o aviso do próprio formulário ainda
   promete *"passará pela aprovação da diretoria antes de liberar o acesso"*, o que contradiz a
   migration 70 e a tela de sucesso. O rótulo da senha diz *"mín. 6 caracteres"*, mas o Auth exige
   8, com letras e números.

### 1.2 Confirmação de e-mail (obrigatória)

- Ligada em `supabase/config.toml` (`[auth.email] enable_confirmations = true`, fase 8.1, B5) e no
  staging (`GOTRUE_MAILER_AUTOCONFIRM=false`, conferido de novo nesta rodada pelo
  `verificar-auth-hospedado.mjs`: `confirmacao-email` PASS). É exigida para produção em
  `AMBIENTE-DE-PRODUCAO.md` §3.
- O e-mail sai pelo SMTP do projeto. Localmente vai para o Mailpit e chega **em inglês** (Go/No-Go,
  P2). No hospedado, sem SMTP próprio, a cota é baixa e pode entregar só para a equipe do projeto
  (`AUTH-HOSPEDADO.md` §5).
- Até confirmar, o login devolve `Email not confirmed`, e a tela mostra *"Confirme seu e-mail antes de
  entrar — o link está na sua caixa de entrada."* (`src/lib/erros.js`).
- **Um e-mail = uma conta.** Há índice único em `auth.users` (`users_email_partial_key`). Dois irmãos
  não usam o mesmo endereço. O adulto cujo e-mail a criança usou não consegue criar a própria conta
  de responsável com ele. E o app **não tem troca de e-mail** (nenhum `updateUser({ email })`), então
  quem começou com o e-mail de outra pessoa não migra depois.

### 1.3 Entrar num clube (exige sessão)

`/entrar` (código ou QR) → `entrada_solicitar` (migration 71). A função recusa sem `auth.uid()`:
*"Entre na sua conta para continuar."* Com sessão, ela cria um **vínculo pendente**, e a liderança
aprova em Aprovações. **Sem confirmar o e-mail não há sessão**. A criança não confirmada não chega
ao pedido e fica **invisível** para Aprovações e para Usuários.

### 1.4 Login (`src/pages/Login.jsx`)

`signInWithPassword` e, em seguida, leitura de `profiles.status`. A pessoa é deslogada se o status não
for `ativo`. O status é o **espelho** do vínculo primário. A criança recusada ou suspensa no único
clube em que estava (por exemplo, porque digitou o código do clube errado) fica trancada fora do
produto inteiro e não consegue entrar para usar o código de outro clube. A auditoria classificou
como MÉDIO.

### 1.5 Recuperação de senha (`src/pages/Recuperar.jsx`)

`resetPasswordForEmail` com volta em `/nova-senha`. A resposta é a mesma exista a conta ou não
(correto: as contas são de menores). A tela aplica a política de 8 caracteres com letras e números
e desloga depois da troca. **Funciona só para quem abre a caixa de e-mail.**

### 1.6 A liderança definindo a senha (`src/pages/Usuarios.jsx` + `resetar_senha_membro`)

- A liderança (instrutor ou diretoria do clube da aba) define uma senha nova e **vê essa senha** na
  tela (*"Passe esta senha para…"*). Não há troca obrigatória no próximo login. Isso contradiz o
  princípio escrito em `Recuperar.jsx`: *"a liderança passava a conhecer a senha das crianças, o que
  não deveria acontecer nunca"*.
- Até a versão 79 (a do staging), a função aceitava **qualquer** vínculo do alvo no clube da aba
  (pendente, suspenso ou encerrado) e trocava a senha **global** da pessoa. Isso era o BLOCKER de
  segurança da auditoria.
- **Migration 80, nesta rodada, por outra frente:** agora o alvo precisa estar **ativo** no clube da
  aba, e a função **recusa quem participa de outro clube** (pendente, ativo ou suspenso). A mensagem
  manda a própria pessoa usar "Esqueci a senha" (*"ou o responsável ajuda"*). Além disso, as sessões
  abertas do alvo são revogadas.
- **Consequência para este item:** a criança de dois clubes (ou que só digitou o código de um
  segundo clube) perde o único caminho que não passava pelo e-mail. Se ela não tem e-mail
  utilizável, **não há mais recuperação nenhuma**. O "responsável ajuda" da mensagem não tem
  ferramenta: o responsável não tem poder sobre a conta da criança (§1.7).
- Mesmo quando é permitida, a redefinição **não confirma o e-mail**. Ela não resgata uma conta que
  nunca foi confirmada, até porque essa conta não tem vínculo no clube.

### 1.7 O responsável (convite do clube)

1. A liderança gera um convite (`criar_convite_responsavel`, migration 17). O convite **não recebe
   criança nem e-mail**: é um token do clube. O link é `/cadastro#convite=<token>`.
2. O adulto se cadastra como responsável. `handle_new_user` consome o convite e cria o vínculo
   `pais` **ativo já no signUp, antes da confirmação**. Um e-mail digitado errado queima o convite, e
   o dono real daquela caixa pode confirmar e assumir a conta `pais` pelo "Esqueci a senha".
3. Depois de entrar, o responsável pede o vínculo digitando o **nome** do filho (`pedir_vinculo`), e
   a diretoria liga o pedido a uma **conta de criança que já existe** (`aprovar_vinculo`).
4. **O responsável não cria, não confirma e não recupera a conta da criança.** No produto de hoje,
   ele não é caminho para a criança sem e-mail.
5. Sem o link, o alternador "Sou responsável" aparece mesmo assim. O cadastro falha com "Algo deu
   errado", porque o servidor exige o convite.

### 1.8 Fundador sem clube

Qualquer conta sem clube vê **"Criar um clube"** (`src/components/ClubeGuard.jsx`). O onboarding
(`onboarding_iniciar`) **não pergunta a idade**. No fim, a conta vira **diretoria ativa** de um clube
em trial, gera códigos de entrada e vê nome, e-mail e nascimento de quem pedir para entrar. Uma
criança de 10 anos consegue fazer isso. A migration 80 fecha o uso disso para trocar senha ou editar
o perfil de alguém de outro clube, mas a porta continua aberta.

### 1.9 Idade, consentimento e retenção

- Nenhuma idade mínima, nenhuma distinção entre menor e adulto, nenhum termo, nenhuma política de
  privacidade e nenhum registro de consentimento do responsável. O `PLANEJAMENTO.md` lista LGPD como
  pendência.
- Não existe expurgo de contas nunca confirmadas. Nenhuma migration olha `email_confirmed_at`. Nome,
  e-mail e nascimento de quem nunca confirmou ficam guardados para sempre.

## 2. O caminho da criança sem e-mail utilizável

| situação | o que acontece hoje |
|---|---|
| não tem e-mail | não consegue nem preencher o formulário. Se inventar um endereço, cai na linha seguinte |
| e-mail inventado | a conta nasce não confirmada: **não entra, não pede vaga, ninguém a vê, ninguém destrava** (não há `auth.admin` nem Edge Function com `service_role`; a única função é `enviar-push`) |
| e-mail de um adulto (pai, mãe) | funciona se aquele endereço ainda não tiver conta. Mas o adulto fica sem o e-mail para a conta dele de responsável, os irmãos não podem repetir o endereço e não dá para trocar depois. Com alias `+` (`mae+joao@…`) contorna, se o provedor aceitar |
| tem e-mail, mas não lê ou não entende | a confirmação chega em inglês (sem template pt-BR) ou não chega (sem SMTP próprio). A criança não confirma |
| já tem conta, esqueceu a senha, está em **dois clubes** | com a migration 80, a liderança não redefine mais, e só sobra o e-mail. Sem e-mail utilizável, fica sem conta |

As contas atuais do clube em produção (Tenant 001) nasceram no modelo antigo, que tinha aprovação
da diretoria e (**a conferir no painel da produção**) confirmação desligada. Elas continuam entrando.
Quem usou e-mail inventado, porém, **já não consegue recuperar a senha** hoje.

## 3. É adequado ao piloto?

| público | veredito |
|---|---|
| criança **com** e-mail utilizável (próprio ou do responsável, com alias) | **adequado com ressalvas**: SMTP próprio e templates pt-BR (`AUTH-HOSPEDADO.md`, obrigatórios) e as correções de texto do §5 |
| criança **sem** e-mail utilizável | **BLOCKER**. O fluxo é inviável, e nenhuma pessoa do produto (liderança, responsável, plataforma) consegue destravar |
| todas | **risco LGPD/ECA em aberto** (§4.2), que não se resolve com código: pede decisão e texto jurídico |

O que decide se o BLOCKER pesa no piloto é uma pergunta de campo, não de código: **quantas crianças
dos clubes convidados não têm e-mail utilizável?** Levante isso com as diretorias **antes** de
escolher uma alternativa.

## 4. Alternativas, para decisão do dono

Nenhuma está implementada. Esforço: **P** (texto ou painel, horas), **M** (dias, uma função ou uma
tela nova), **G** (semanas, modelo de dados e fluxo novo).

| # | alternativa | prós | contras | esforço | risco LGPD/ECA | impacto no Auth hospedado |
|---|---|---|---|---|---|---|
| **1** | **Regra do piloto: só entra criança com e-mail utilizável**, usando o **alias `+`** do e-mail do responsável quando ela não tiver um próprio | nenhum código. O adulto confirma e recebe a recuperação, o que funciona como uma verificação parental informal | depende de o provedor aceitar `+`. O adulto precisa de outro alias para a própria conta de responsável. Gasta a cota de e-mail. Sem troca de e-mail depois. É orientação, não garantia | **P** (orientação escrita aos clubes + os textos do §5) | reduz, sem resolver: a caixa é do adulto, mas não fica **registro** de consentimento | nenhum além do obrigatório: SMTP próprio, templates pt-BR e cota ≥ cadastros por hora |
| **2** | **Desligar a confirmação de e-mail** (voltar ao antes da fase 8.1) | nenhum código. Desde as migrations 70/71 a conta sozinha não acessa nenhum clube: a porta real é a aprovação do vínculo pela liderança | **reabre o B5**: qualquer um ocupa o endereço de outra pessoa, e o dono real toma a conta pelo "Esqueci a senha". Quem usar e-mail inventado fica sem recuperação. O erro "already registered" volta a revelar quem tem conta | **P** | **piora**: conta de criança com e-mail que ninguém verificou, e nenhum sinal de adulto | *Confirm email* desligado. O critério `confirmacao-email` passa a dar FAIL **de propósito**, e a decisão precisa estar escrita |
| **3** | **A liderança confirma o e-mail ao aprovar**: o cadastro aceita o código do clube e já cria o vínculo pendente, e aprovar confirma a conta | mantém o bloqueio a cadastro anônimo. Quem autoriza é quem conhece a criança | o endereço continua sem prova de dono: se for de outra pessoa, ela toma a conta pela recuperação. Sem e-mail, continua sem recuperação. Dá à liderança um poder sobre a conta **global** (o mesmo problema da senha na migration 80) | **M** (Edge Function com `service_role` chamando `auth.admin.updateUserById({ email_confirm: true })`, ou função `security definer` que grava `auth.users.email_confirmed_at`, e o código no cadastro) | neutro. Não há consentimento do responsável | a confirmação continua ligada. Surge um segredo `service_role` numa Edge Function (ou uma função com escrita em `auth.users`), mais superfície para auditar |
| **4** | **Login por apelido, com e-mail sintético** num domínio do produto que não recebe e-mail. A conta nasce **já confirmada**, criada por um processo autorizado (liderança ou responsável) | funciona sem e-mail e sem celular. Não muda JWT nem RLS. `createUser` não envia e-mail nem gasta cota: aguenta 30 crianças no primeiro dia | a recuperação passa a depender de um adulto, e isso exige que a migration 80 esteja no ar **antes**. Quem cria sabe a senha inicial, então precisa de troca no 1º login. Nova superfície com `service_role`. Falta decidir quem responde por uma conta que é **global** (a criança de dois clubes) | **M/G** (Edge Function `createUser`, login que converte apelido em e-mail, recuperação que recusa o domínio sintético, troca obrigatória de senha) | depende de quem cria: pela liderança, sem consentimento parental; pelo responsável, vira a 5 | a confirmação continua ligada para os adultos. O domínio sintético não pode ter caixa (os e-mails do GoTrue para ele se perdem, por desenho). O limite por IP de cadastro não se aplica ao `createUser` |
| **5** | **Conta tutelada pelo responsável**: o adulto, com e-mail confirmado, cria e administra as contas dos filhos no portal (com o mecanismo da 4), registra o consentimento e a tutela, e a redefinição de senha passa a ser dele | é a que mais se aproxima do consentimento de pai ou responsável do art. 14 da LGPD. É coerente com multi-clube: a autoridade é **da pessoa**, não de um clube | a de maior esforço. Inverte a ordem de hoje (a criança precisa existir antes do vínculo, e o convite `pais` é por clube). A criança cujo responsável não usa o app fica de fora | **G** (4 + tabela de tutela + registro de consentimento + telas no portal dos pais + regras de recuperação) | **a melhor das sete**, se o termo de consentimento for redigido por quem entende do assunto | o mesmo da 4, mais a tutela guardada no banco (dado sensível: RLS e auditoria próprias) |
| **6** | **Telefone com código (SMS ou WhatsApp)** | muitos de 12 a 15 anos têm celular | custo por mensagem. Crianças de 10 e 11 anos muitas vezes não têm número próprio. Celular compartilhado cai no mesmo "um número = uma conta" | **M/G** | neutro | `[auth.sms]` ligado com um provedor (ou o Send SMS Hook). O critério `metodos-de-entrada` muda. Entra o limite `sms_sent` |
| **7** | magic link, código por e-mail ou passkey | — | **não resolvem**: os dois primeiros dependem de uma caixa de e-mail, e a passkey só existe depois que a conta existe | — | — | — |

**Leitura técnica, não decisão:** a auditoria recomenda **4 + 5** como estrutura e **1** como
paliativo para o piloto. Qualquer caminho que dê a um adulto poder sobre a senha de uma conta
global exige a migration 80 no ar primeiro. A alternativa 2 é a mais barata e a única que desfaz
uma decisão de segurança já tomada (B5). Se for a escolhida, que fique escrita junto com o motivo.

### 4.1 Perguntas para o dono responder antes de escolher

- [ ] Quantas crianças dos clubes convidados **não têm** e-mail utilizável? (as diretorias sabem)
- [ ] Para o piloto: regra 1 (só com e-mail, alias do responsável) ou outra?
- [ ] Para depois do piloto: 4 + 5, ou outra estrutura?
- [ ] Quem redige termo de uso, política de privacidade e texto de consentimento? (§4.2)
- [ ] Criar clube exige maioridade declarada? (§1.8)
- [ ] Contas nunca confirmadas são apagadas depois de N dias? Qual N?
- [ ] Na produção atual, quantas contas usam e-mail inventado ou repetido? Leitura agregada, sem
      nomes, para o dono rodar no SQL Editor da produção:
      `select split_part(email, '@', 2) as dominio, count(*) from auth.users group by 1 order by 2 desc limit 15;`

### 4.2 LGPD e ECA: o que o repositório mostra, sem interpretação jurídica

- O ECA chama de **criança** quem tem até 12 anos incompletos e de **adolescente** quem tem de 12 a
  18. O público dos Desbravadores (10 a 15 anos) tem os dois.
- O art. 14 da LGPD pede que o tratamento de dados de crianças e adolescentes siga o **melhor
  interesse** deles. Para **crianças**, o §1º fala em consentimento específico e em destaque de pelo
  menos um dos pais ou do responsável, e o §5º pede esforço razoável do controlador para verificar
  que foi mesmo o responsável quem consentiu. A ANPD (Enunciado CD/ANPD nº 1/2023) admite outras
  bases legais dos arts. 7º e 11, sempre com o melhor interesse. **Qual base usar é decisão
  jurídica**, e o documento não a toma.
- O repositório não tem **nenhum** desses elementos: não há base legal registrada, termo, política,
  consentimento, verificação de quem consente, idade mínima nem prazo de retenção. Além disso, o
  cadastro coleta nascimento e (tentaria coletar) foto **direto da criança**.
- O que as alternativas mudam nisso está na coluna "risco LGPD/ECA" do §4. Só a 5 produz um
  **registro** de consentimento do responsável.

## 5. O que independe da escolha

A auditoria listou estas correções pequenas de tela e banco. Elas valem para qualquer alternativa.
Não foram implementadas neste item (este é um item de documento), e algumas podem estar sendo
feitas por outras frentes desta rodada:

| o quê | gravidade na auditoria |
|---|---|
| tela de sucesso: *"Enviamos um link para `<email>`. Abra-o antes de entrar"* + botão de reenviar (`auth.resend`, tipo `signup`) | MÉDIO |
| tirar o aviso "passará pela aprovação da diretoria" do cadastro | MÉDIO |
| o login deixa de barrar pelo espelho `profiles.status`, e o `ClubeGuard`/`meu_contexto` decidem | MÉDIO |
| vínculo `pais` criado só depois da confirmação (ou convite amarrado a um e-mail) | MÉDIO |
| rótulo "mín. 6" → "mínimo 8, com letras e números" (cadastro e Usuários) | BAIXO |
| tirar o campo de foto do cadastro (some em silêncio, e para menores é melhor pedir depois) | BAIXO |
| esconder "Sou responsável" sem convite, ou explicar "peça o link ao clube" | BAIXO |
| link de convite para `/entrar#convite=`, preservando o token depois do login | BAIXO |
| senha definida pela liderança com troca obrigatória no próximo login | BAIXO |
| validar a faixa do nascimento no servidor; expurgo de contas nunca confirmadas | ALTO (junto com LGPD) |

## 6. Status do item 6

**BLOCKER, com decisão pendente do dono.** O fluxo foi documentado e conferido no código e no
staging, e as alternativas estão na mesa. Nada foi implementado e nada mudou no Auth. O item sai
de BLOCKER quando houver uma de duas coisas:

- a **regra 1** adotada para o piloto, com o levantamento de que toda criança convidada tem e-mail
  utilizável, e SMTP/templates pt-BR verdes no `AUTH-HOSPEDADO.md`; ou
- outra alternativa escolhida, implementada e testada.

O risco LGPD/ECA segue aberto em paralelo, até haver decisão jurídica.
