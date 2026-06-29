# 📲 Setup do Push (notificação no celular)

O código já está pronto. Faltam estes passos de configuração (uma vez só).
As **chaves VAPID** geradas para o seu projeto foram passadas no chat e estão
salvas localmente em `vapid-keys.txt` (fora do repositório). Tenha-as à mão.

> ⚠️ A **chave PRIVADA é segredo** — nunca a coloque no código nem no Git.
> A **pública** pode ficar no front (é enviada ao navegador de qualquer forma).

---

## 1) Rodar o SQL
Supabase → **SQL Editor** → cole `supabase/2026-06-29-push-e-aniversario.sql` → **Run**.
(Cria a tabela `push_subscriptions` e agenda o aviso diário de aniversário.)

> Se der erro em `create extension pg_cron`, habilite antes em
> **Database → Extensions → pg_cron** e rode o SQL de novo.

## 2) Chave pública no front (Vercel + local)
- **Local:** no arquivo `.env`, adicione:
  `VITE_VAPID_PUBLIC_KEY=` *(cole a chave PÚBLICA)*
- **Vercel:** Project → **Settings → Environment Variables** → adicione
  `VITE_VAPID_PUBLIC_KEY` com a mesma chave pública → **Redeploy**.

## 3) Secrets da função (chaves VAPID)
No terminal, com o [Supabase CLI](https://supabase.com/docs/guides/cli) instalado e o projeto linkado:
```bash
supabase login
supabase link --project-ref SEU-PROJECT-REF
supabase secrets set VAPID_PUBLIC_KEY=COLE_A_PUBLICA VAPID_PRIVATE_KEY=COLE_A_PRIVADA
```

## 4) Subir a função
```bash
supabase functions deploy enviar-push --no-verify-jwt
```
(`--no-verify-jwt` porque quem chama é o webhook do banco, não um usuário logado.)

## 5) Ligar o webhook (banco → função)
Supabase → **Database → Webhooks → Create a new hook**:
- **Table:** `notificacoes`
- **Events:** `Insert`
- **Type:** *Supabase Edge Functions* → selecione **enviar-push**
  (ou *HTTP Request* `POST` para a URL da função)
- Salvar.

A partir daí: toda notificação criada (pontos pra unidade, nova atividade,
cadastro novo, **aniversário do dia**) vira push automaticamente nos aparelhos
que ativaram.

## 6) Ativar no aparelho
No app: abra o **🔔 (sino)** → **📲 Ativar avisos no celular** → permita.

> 📱 **iPhone:** o push de PWA só funciona se o app estiver **instalado na tela
> inicial** (Compartilhar → Adicionar à Tela de Início), iOS 16.4+. No Android
> funciona direto no Chrome.

---

## Como testar
1. Ative o push num aparelho (passo 6).
2. Entre como diretoria/instrutor e lance pontos numa unidade.
3. O push deve chegar em segundos. Se não chegar, veja os logs da função em
   Supabase → **Edge Functions → enviar-push → Logs**.
