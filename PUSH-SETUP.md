# 📲 Setup do Push (aviso no celular) — SEM terminal

O código já está 100% pronto. Falta só **ligar** (uma vez só), tudo pelo
**painel do Supabase e da Vercel** — nada de linha de comando.

Quando terminar, toda **nova atividade** (e pontos pra unidade, cadastro novo,
aniversário do dia) vira um aviso que **chega no celular** de quem ativou.

---

## 🔑 Suas chaves VAPID (já geradas)

As chaves do seu projeto **já foram geradas** e estão no arquivo
`vapid-keys.txt` (na raiz do projeto, **fora do Git** — não é versionado) e
também foram passadas no chat. Tenha-as à mão pros passos 2 e 3.

> A **pública** pode aparecer no front (o navegador recebe ela de qualquer jeito).
> A **privada é SEGREDO** — só vai no Supabase, nunca no código nem no Git.

---

## 1) Rodar o SQL (cria a tabela de inscrições)
Supabase → **SQL Editor** → **New query** → cole o conteúdo de
`supabase/2026-06-29-push-e-aniversario.sql` → **Run**.

> Se reclamar de `pg_cron`, vá em **Database → Extensions**, ligue **pg_cron**,
> e rode o SQL de novo. (O `pg_cron` é só pro aviso de aniversário; o push das
> atividades funciona sem ele.)

## 2) Chave PÚBLICA na Vercel
Vercel → seu projeto → **Settings → Environment Variables** → **Add**:
- **Name:** `VITE_VAPID_PUBLIC_KEY`
- **Value:** a chave **pública** de cima
- Marque os 3 ambientes (Production/Preview/Development) → **Save**.

Depois **Deployments → ⋯ do último deploy → Redeploy** (pra pegar a variável).

## 3) Secrets no Supabase (as duas chaves + o segredo do webhook)
Supabase → **Edge Functions** → aba/botão **Secrets** (ou
**Project Settings → Edge Functions → Secrets**) → **Add new secret**, crie os TRÊS:
- `VAPID_PUBLIC_KEY` = a pública
- `VAPID_PRIVATE_KEY` = a privada
- `PUSH_WEBHOOK_SECRET` = **invente uma senha longa e aleatória** (30+ caracteres,
  tipo `k9Qz...`; um gerador de senhas serve). **Guarde esse valor** — ele vai
  ser usado de novo no passo 5.

> 🔒 **Pra que serve o `PUSH_WEBHOOK_SECRET`?** Como o "Verify JWT" da função
> fica desligado (quem chama é o webhook do banco, não um usuário logado), a
> função tem a **própria fechadura**: só atende quem mandar esse segredo no
> header `x-push-webhook-secret`. Sem ele, responde **401** e não toca no banco.
> Sem esse secret cadastrado, a função recusa TUDO (falha fechada) — então
> este passo é obrigatório.

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` o Supabase já injeta sozinho.

> 🚦 **Seu push JÁ está funcionando hoje?** Então siga a ordem **3 → 5 → 4**:
> cadastre o secret (3), **adicione o header no webhook que já existe** (5) —
> a função antiga ignora header extra, nada quebra — e **só depois** faça o
> deploy do novo `index.ts` (4). Assim não existe nenhum momento com o push
> caído. (Se fizer 4 antes de 5, todo push morre com **401 em silêncio** até o
> header ser adicionado.) Depois do deploy, teste na hora (seção *Como testar*).

## 4) Subir a função `enviar-push` (pelo navegador)
Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**
(ou **Create a new function**):
- **Nome:** exatamente `enviar-push`
- Apague o exemplo e **cole todo** o conteúdo de
  `supabase/functions/enviar-push/index.ts`
- **Deploy**.

Depois, em **Edge Functions → enviar-push → Settings**, **desligue**
“**Verify JWT**” (quem chama é o webhook do banco, não um usuário logado).

## 5) Ligar o webhook (banco → função) — COM o segredo
Supabase → **Database → Webhooks** → **Create a new hook** (ou **edite** o que
já existe):
- **Name:** `push-notificacoes`
- **Table:** `notificacoes`
- **Events:** apenas **Insert**
- **Type:** **Supabase Edge Functions** → função **enviar-push**
- **HTTP Headers** → **Add header**:
  - **Name:** `x-push-webhook-secret`
  - **Value:** o MESMO valor que você cadastrou em `PUSH_WEBHOOK_SECRET` (passo 3)
- **Create webhook** (ou **Save**).

> ⚠️ Sem esse header (ou com valor diferente do secret), a função responde
> **401** e nenhum push sai — é a fechadura funcionando. Se os pushes pararem
> depois desta mudança, confira se o header e o secret estão IGUAIS.
> Dica: se a função já estava no ar antes, **re-deploy** dela (passo 4) depois
> de cadastrar o secret, pra ela passar a enxergá-lo.

Pronto — a partir daqui, cada linha nova em `notificacoes` (que o app cria
sozinho quando você publica uma atividade) dispara o push.

## 6) Cada pessoa ativa no aparelho dela
No app: **🔔 (sino)** → **📲 Ativar avisos no celular** → **Permitir**.
(Só precisa fazer uma vez por aparelho.)

> 📱 **iPhone:** só funciona com o app **instalado na tela inicial**
> (Compartilhar → *Adicionar à Tela de Início*), iOS 16.4+.
> **Android:** funciona direto no Chrome.

---

## ✅ Como testar
1. Ative o push num celular (passo 6).
2. Em outro login de **diretoria/instrutor**, crie uma **nova atividade**.
3. O aviso deve chegar no celular em segundos.
4. Não chegou? Supabase → **Edge Functions → enviar-push → Logs** mostra o
   que aconteceu (e **Database → Webhooks → push-notificacoes → Logs** mostra
   se o webhook disparou).

## Perguntas rápidas
- **Precisa reativar quando troco de celular?** Sim, cada aparelho ativa uma vez.
- **A chave privada vaza se eu publicar o site?** Não — ela só vive nos *Secrets*
  do Supabase; o front só conhece a pública.
- **Quero trocar as chaves depois?** Gere um novo par, repita passos 2 e 3, e
  peça pra todos ativarem de novo (as inscrições antigas param de valer).
