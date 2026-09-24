# Auth do projeto hospedado — checklist e conferência

> Fase 9.1, item 5. Ferramenta: `scripts/verificar-auth-hospedado.mjs` (só GET). Evidência:
> `supabase/e2e/evidencias-fase9_1/auth-hospedado-*.json`.

**Status: PENDENTE.** A ferramenta está pronta e foi provada contra o staging local. O projeto do
piloto **não foi conferido**: esta rodada não tem acesso a projeto hospedado nenhum, e não deveria ter.
O item só fica verde quando o dono rodar o script contra o projeto do piloto e todos os critérios
obrigatórios derem PASS.

---

## 1. Por que isto existe

O `supabase/config.toml` configura só o Supabase **local**. O projeto hospedado guarda a sua
própria cópia de cada opção de Auth: confirmação de e-mail, limites por IP, política de senha,
templates, SMTP e redirects. Essa cópia é editada no painel, e nada garante que ela bata com o
repositório. O Go/No-Go da fase 9 deixou três pendências como **P2**, e nenhuma delas se resolve
localmente:

- **Limite de login.** No staging local não existe: foram 40 senhas erradas em 2,4 s, sem nenhuma
  recusa. O motivo mais provável foi conferido no container: o GoTrue só aplica limite por IP
  quando `GOTRUE_RATE_LIMIT_HEADER` está definido, e o container do staging não tem essa variável.
  No hospedado quem define essa variável é a plataforma. Por isso **a prova só existe lá** (§4).
- **Templates de e-mail em português.** No staging a confirmação chega em inglês. A criança que não
  entende o e-mail não confirma, e sem confirmar não entra.
- **Restore/PITR.** Fica no `BACKUP-PITR-HOSPEDADO.md`.

## 2. Como rodar

Tudo é leitura. O script faz três GET e nada mais: `/auth/v1/health`, `/auth/v1/settings` e
`api.supabase.com/v1/projects/<ref>/config/auth`.

```bash
SUPABASE_URL=https://<ref-do-piloto>.supabase.co \
SUPABASE_ANON_KEY=<anon do piloto> \
SUPABASE_ACCESS_TOKEN=<token pessoal> \
PROJECT_REF=<ref-do-piloto> \
PILOTO_DOMINIO=https://<domínio do app do piloto> \
  node scripts/verificar-auth-hospedado.mjs --saida supabase/e2e/evidencias-fase9_1/auth-hospedado-piloto-AAAA-MM-DD.json
```

| variável | onde achar | observação |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | painel → Project Settings → API | a anon não é segredo, mas o script nunca a imprime |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens | **crie um token só para isto e revogue depois**. Ele tem poder de escrita em todos os projetos da organização. O script só faz GET e se recusa a imprimir qualquer coisa com cara de token |
| `PROJECT_REF` | o `<ref>` de `<ref>.supabase.co` | se faltar, sai da URL |
| `PILOTO_DOMINIO` | o endereço em que o app do piloto é aberto | sem ele, site_url e redirects ficam NAO-VERIFICAVEL |
| `AUTH_LOGINS_POR_IP` (60) | decisão do dono | quantas entradas pelo mesmo Wi-Fi em 5 min o limite precisa comportar (§4) |
| `AUTH_EMAILS_POR_HORA` (60) | decisão do dono | cadastros e recuperações por hora no dia de entrada dos clubes |
| `AUTH_REDIRECT_EXTRA` | — | prefixos de redirect aceitos além do domínio, se um dia o APK receber link direto |

**Saída:** uma linha por critério (PASS, FAIL ou NAO-VERIFICAVEL), o veredito e um JSON.
Códigos: `0` VERDE · `1` algum FAIL · `2` nenhum FAIL, mas algum obrigatório NAO-VERIFICAVEL · `3` recusado.

**A guarda de produção.** O script recusa, **antes de qualquer requisição**, a URL e o
PROJECT_REF da produção. A produção é lida de `.env`, `.env.production` e `.env.production.local`
deste repositório e do checkout principal (num worktree, o `.env` de verdade fica lá), mais a
lista `AUTH_VERIFICAR_BLOQUEAR` (URLs ou refs separados por vírgula). Um alvo hospedado sem nenhuma
produção conhecida também é recusado: sem saber o que é produção, a guarda não guarda nada. O
motivo não é risco de escrita, que não existe aqui. É que um PASS medido na produção seria
atribuído ao piloto.

`node scripts/verificar-auth-hospedado.mjs --autoteste` confere a heurística de idioma, a leitura da
política de senha, a guarda (inclusive contra a URL real de produção, lida do `.env` sem rede) e a
avaliação de uma configuração boa e de uma ruim.

## 3. Os critérios

As linhas marcadas com "sim" são obrigatórias e decidem o veredito. As outras só ficam registradas.

| critério | obrig. | o que significa | se der FAIL, onde mexer no painel |
|---|---|---|---|
| `auth-responde` | sim | health e settings respondem com a anon do projeto | URL ou chave erradas |
| `confirmacao-email` | sim | `mailer_autoconfirm = false`, pela camada pública e pela de gestão, **e as duas concordam** | Authentication → Sign In / Providers → Email → *Confirm email*. Desligar reabre o B5 **e** é uma das alternativas do `MENORES-E-EMAIL.md`: só com decisão registrada |
| `metodos-de-entrada` | sim | só e-mail + senha. Anônimo, telefone, OAuth, SAML e passkey desligados | provedor ligado que o app não usa é superfície de ataque sem dono |
| `cadastro-aberto` | sim | `disable_signup = false`: a criança cria a própria conta | Authentication → Sign In / Providers → *Allow new users to sign up* |
| `senha-politica` | sim | mínimo 8, letras e números (`letters_digits`). **Mais forte também é FAIL**: o gerador de senha da liderança e a validação do app seguem essa regra, e o Auth passaria a recusar o que o app aceita | Authentication → Policies (Password) |
| `troca-de-senha-segura` | sim | trocar a senha exige sessão recente (`secure_password_change`) | Authentication → Sign In / Providers → Email |
| `limite-login-ativo` | sim | cadastro + login por IP entre 1 e 300 a cada 5 min, e refresh ≥ 1. Acima de 300 o limite só existe no papel | Authentication → Rate Limits → *sign-ups and sign-ins* |
| `limite-comporta-reuniao` | sim | o mesmo limite ≥ `AUTH_LOGINS_POR_IP`. Numa reunião todo mundo sai pelo mesmo IP público (§4) | idem |
| `smtp-proprio` | sim | SMTP transacional próprio (host e remetente). O script mostra o host e o domínio do remetente, nunca a senha | Authentication → Emails → SMTP Settings |
| `limite-emails` | sim | SMTP próprio e cota ≥ `AUTH_EMAILS_POR_HORA`. Confirmação e recuperação **dividem a mesma cota** | Rate Limits → *emails sent* (só é editável com SMTP próprio) |
| `captcha-coerente` | sim | captcha ligado **só se** o app enviar `captchaToken`. Hoje o app não envia (o script varre `src/`), então ligar o captcha sozinho bloqueia cadastro, login e recuperação de todo mundo | Attack Protection → CAPTCHA |
| `jwt-expiracao` | sim | access token ≤ 3600 s. É a janela em que um token continua valendo depois do logout (Go/No-Go, BAIXO) | Project Settings → JWT |
| `refresh-rotacao` | sim | rotação ligada, reuso ≤ 10 s | Authentication → Sessions |
| `site-url` | sim | https, no domínio do piloto. É com ele que o GoTrue monta os links de confirmação e de recuperação. O cadastro do app não passa `emailRedirectTo`, então a confirmação volta **sempre** para cá | Authentication → URL Configuration |
| `redirects-so-piloto` | sim | cada entrada da lista é https no domínio do piloto: sem curinga no host, sem localhost, sem preview da Vercel. `/nova-senha` já fica coberto porque o GoTrue aceita qualquer caminho do mesmo host do `site_url`. Pôr `/nova-senha` explícito na lista não faz mal, e é o que o `AMBIENTE-DE-PRODUCAO.md` §3 pede | URL Configuration → Redirect URLs |
| `template-confirmacao-pt` | sim | assunto e corpo em português, com `{{ .ConfirmationURL }}` | Authentication → Emails → Templates → *Confirm signup* |
| `template-recuperacao-pt` | sim | idem | Templates → *Reset password* |
| `troca-de-email-dupla` | — | a troca confirma nos dois endereços (o app não troca e-mail hoje) | — |
| `limite-verificacao` | — | limite de cliques em link por IP (também esbarra no Wi-Fi da reunião) | Rate Limits |
| `senha-vazada` | — | recusa senha que já vazou (recurso do Pro). Recomendado | Attack Protection |
| `template-convite-pt`, `template-magic-link-pt`, `template-troca-email-pt` | — | o app não dispara esses e-mails hoje. Traduzir evita surpresa no dia em que disparar | Templates |

**Os templates precisam usar `{{ .ConfirmationURL }}`.** O app não tem rota de `verifyOtp`. Um
template que monte o próprio link com `{{ .TokenHash }}` manda a pessoa para uma tela que não
existe. Por isso esse caso é FAIL, mesmo com o texto em português perfeito.

**A heurística de idioma** conta palavras características das duas línguas e os acentos do
português. Ela distingue "Confirm Your Signup", o padrão do Supabase, de "Confirme seu cadastro".
Quando fica em dúvida, devolve NAO-VERIFICAVEL, e o certo é ler o template no painel. Template vazio
na API quer dizer o padrão do Supabase, que é em inglês.

Sugestão de texto (curto, para ler no celular):

- **Confirmação.** Assunto: `Confirme seu cadastro`. Corpo: `<p>Olá! Para ativar sua conta,
  toque no botão abaixo.</p><p><a href="{{ .ConfirmationURL }}">Confirmar meu e-mail</a></p><p>Se
  você não pediu este cadastro, ignore esta mensagem.</p>`
- **Recuperação.** Assunto: `Criar uma nova senha`. Corpo: `<p>Recebemos um pedido para trocar a
  sua senha. O link vale por 1 hora e só funciona uma vez.</p><p><a href="{{ .ConfirmationURL }}">Criar
  nova senha</a></p><p>Se não foi você, ignore esta mensagem: sua senha continua a mesma.</p>`

## 4. Força bruta: não se resolve no React

Quem ataca não abre o app. A URL do projeto e a chave anon estão no bundle por desenho, e com as
duas qualquer um chama `POST /auth/v1/token?grant_type=password` direto, milhares de vezes. Um
contador de tentativas na tela de login, um "espere 30 segundos" ou um captcha que só aparece no
React **não existem para esse atacante**: ele nunca passa pela tela. A defesa tem de estar no
servidor, e no servidor de Auth há só três peças:

1. **Limite por IP do GoTrue.** No painel, é o *sign-ups and sign-ins* (na API, `rate_limit_otp`;
   no `config.toml`, `sign_in_sign_ups`. O mapeamento foi conferido no container do staging, onde
   `sign_in_sign_ups = 30` vira `GOTRUE_RATE_LIMIT_OTP=30`). Há também o limite de *token refresh*.
   É a única defesa que já existe sem mudar código. O preço é o outro lado da mesma moeda: todas as
   crianças de uma reunião saem pelo **mesmo IP** do Wi-Fi da igreja. Com 30 por 5 min, a 31ª
   entrada recebe "Muitas tentativas". O valor é decisão do dono: alto o bastante para uma reunião
   (`AUTH_LOGINS_POR_IP`), baixo o bastante para não virar convite. Orientação que ajuda nos dois
   sentidos: no dia do primeiro cadastro, cada clube entra pelos dados móveis ou em turmas.
2. **Captcha verificado pelo GoTrue** (hCaptcha ou Turnstile). Ele exige **as duas pontas ao mesmo
   tempo**: o app passa a enviar `captchaToken` no cadastro, no login e na recuperação, e o captcha
   é ligado no painel. Só uma das duas = ninguém entra (critério `captcha-coerente`). É mudança de
   código com widget externo numa tela usada por crianças. **Não está feita** e é decisão do dono.
3. **Política de senha e recusa de senha vazada** (8 com letras e números, que já está no app, mais
   HaveIBeenPwned, do plano Pro). Elas não impedem a tentativa, mas diminuem o número de senhas que
   uma tentativa acerta.

Nada disso aparece num teste local. **A prova é empírica, no projeto do piloto antes de ele ter dado
real** (ou num staging hospedado com a mesma configuração). Use um e-mail que **não existe**: nenhuma
conta é tocada, e mesmo assim cada tentativa conta no limite.

```bash
# N acima do MAIOR dos dois limites que o script registrou (sign-ups/sign-ins e token refresh):
# qual dos dois o GoTrue aplica ao login por senha é justamente o que este teste mostra
N=200
for i in $(seq 1 $N); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"forca-bruta-$i@teste.invalid\",\"password\":\"errada$i\"}"
done | uniq -c
```

Esperado: `400` (credencial inválida) até o limite e **`429` depois**. O `uniq -c` sem `sort` mostra
a sequência. Anote na evidência o número de tentativas até o primeiro 429 e o tempo que levou.
Se nenhum 429 aparecer, o critério `limite-login-ativo` pode estar PASS no papel sem que o limite
funcione de verdade, e isso conta como FAIL. Depois do teste, este IP fica bloqueado para login por
até 5 minutos.

## 5. O e-mail chega?

O script prova a configuração, mas não prova a entrega. O `npm run test:auth:e2e` é só local: as URLs
dele são fixas em 127.0.0.1 e o e-mail é lido do Mailpit. No projeto do piloto, antes de haver dado
real, faça a checagem à mão:

- [ ] cadastro com uma caixa de e-mail **real da equipe**: a confirmação chegou? Em quanto tempo? Caiu no spam?
- [ ] o assunto e o corpo estão em português, o link abre o **domínio do piloto** e, depois de
      confirmar, o login funciona
- [ ] "Esqueci a senha": o e-mail chegou em português, o link abre `/nova-senha` no domínio do
      piloto, e a senha nova funciona
- [ ] a conta de teste é removida pelo painel depois (Authentication → Users)

Sem SMTP próprio, o e-mail embutido do Supabase tem cota fixa e baixa por hora para o projeto
inteiro. Pela política atual do Supabase, ele entrega só para os endereços da equipe do projeto
(**confira no painel**). O teste acima passaria com a caixa da equipe e falharia no primeiro dia de
cadastro das crianças. Por isso `smtp-proprio` é obrigatório.

## 6. Checklist do item 5

- [ ] `node scripts/verificar-auth-hospedado.mjs` contra o projeto do piloto: **VEREDITO VERDE**,
      JSON salvo em `evidencias-fase9_1/`
- [ ] prova empírica do limite de login (§4): número de tentativas até o 429 anotado
- [ ] e-mail real de confirmação e de recuperação (§5): chegou, em português, com o link no domínio do piloto
- [ ] valores decididos pelo dono e anotados: `AUTH_LOGINS_POR_IP`, `AUTH_EMAILS_POR_HORA` e captcha (sim ou não, e por quê)
- [ ] a decisão sobre crianças sem e-mail (`MENORES-E-EMAIL.md`) tomada **antes** de mexer em
      `confirmacao-email`. Esse critério e o BLOCKER de lá são a mesma chave

## 7. O que foi provado nesta rodada

| o quê | resultado |
|---|---|
| `--autoteste` (idioma, senha, guarda, config boa e ruim, camada pública) | todos OK |
| contra o **staging local** (`--env-arquivo .env.staging`) | GoTrue v2.196.0 · 4 PASS (auth-responde, confirmacao-email, metodos-de-entrada, cadastro-aberto) · 13 obrigatórios NAO-VERIFICAVEL (alvo local, sem Management API) · saída 2 · `evidencias-fase9_1/auth-hospedado-staging-local.json` |
| guarda contra a **URL real de produção** (lida do `.env` do checkout principal), com o `fetch` trocado por um que falha | recusado, **0 requisições**, saída 3. Também recusado pelo PROJECT_REF da produção com outra URL, e sem nenhum `.env` de produção conhecido |
| projeto hospedado **simulado** (fetch substituído, sem rede): sem token, com token e config boa, com token e config ruim, com token recusado | saída 2 / 0 (VERDE) / 1 (10 FAIL esperados) / 2. Nenhum segredo da resposta simulada (senha SMTP, segredo do captcha, token) saiu na tela nem no arquivo |
| projeto do piloto | **não conferido** (PENDENTE) |
