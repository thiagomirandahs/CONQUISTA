# Auth do Supabase — SMTP próprio e confirmação de e-mail (próximos passos)

**Estado em produção (lido em 01/10/2026, sem segredos):**
- Site URL: `https://app.desbravaclube.com.br` ✓
- Redirect URLs: `https://app.desbravaclube.com.br/**` e `https://desbravaclube.com.br/**` ✓ (o domínio antigo `conquista-ashy.vercel.app` foi removido hoje; ver "Domínio antigo").
- Confirmação de e-mail: **DESLIGADA** (`mailer_autoconfirm=true`).
- SMTP: **não configurado** (e-mail padrão do Supabase: limite de 2 e-mails/hora e só para endereços da equipe do projeto).
- Templates: **padrão do Supabase, em INGLÊS** ("Confirm your email address", "Reset your password"…).
- DNS de `desbravaclube.com.br` (Registro.br): **sem SPF, sem MX e sem DMARC** — nenhum e-mail do domínio está autenticado ainda.

## O QUE FALTA (não inventei nada — preciso destes dados)
1. **Um serviço de envio de e-mail** (SMTP) — qualquer um que ofereça SMTP e domínio próprio (exemplos: Resend, Brevo, Mailgun, Amazon SES, Zoho). Recomendo um com plano gratuito suficiente para o piloto.
2. **Remetente:** sugestão `nao-responder@desbravaclube.com.br`, nome `DesbravaClube`. (Se quiser receber respostas, um endereço real com caixa.)
3. **Registros DNS no Registro.br** pedidos pelo serviço escolhido (você cria no painel do Registro.br, onde estão os nameservers do domínio): normalmente **SPF** (TXT), **DKIM** (CNAME/TXT) e, recomendado, **DMARC** (TXT em `_dmarc`). Sem isso o e-mail cai no spam ou é recusado.
4. **Dados SMTP** (guarde SÓ no arquivo de ambiente local `C:\Users\Thiago T.I\.desbravaclube-prod.env`, nunca no chat nem no Git), acrescentando estas linhas (substitua o que estiver entre `< >`):
   ```
   export SMTP_HOST=<servidor, ex.: smtp.exemplo.com>
   export SMTP_PORT=<465 ou 587>
   export SMTP_USER=<usuário ou "apikey">
   export SMTP_PASS=<senha ou chave de API do serviço>
   export SMTP_ADMIN_EMAIL=<nao-responder@desbravaclube.com.br>
   export SMTP_SENDER_NAME=DesbravaClube
   export TESTE_EMAIL_CONTA=<um e-mail SEU, de uma conta que já existe no app>
   ```
   Depois que as linhas estiverem salvas, é só avisar; o resto é feito pelos scripts abaixo.

## Procedimento (cada passo só depois do anterior; nada é aplicado sem sua autorização)
1. **Prévia (não grava nada):** `node scripts/auth/aplicar-auth-producao.mjs` — mostra a situação atual e o que mudaria.
2. **Templates em português + assuntos:** `node scripts/auth/aplicar-auth-producao.mjs --aplicar-templates` (arquivos em `supabase/auth-templates/`). Salva antes um instantâneo da configuração atual (sem segredos) em `~/.desbravaclube-backups/`.
3. **SMTP próprio:** `node scripts/auth/aplicar-auth-producao.mjs --aplicar-smtp` (lê `SMTP_*`; nunca imprime a senha). Depois subir o limite de envio no painel (`rate_limit_email_sent`) se o plano permitir.
4. **Teste controlado da recuperação de senha:** `node scripts/auth/testar-recuperacao-producao.mjs` e conferir a lista que ele imprime (chegada, remetente, português, link em `app.desbravaclube.com.br/nova-senha`, **sem localhost**, uso único, expiração de 1 h).
5. **Só se o passo 4 passar:** `node scripts/auth/aplicar-auth-producao.mjs --ativar-confirmacao` (`mailer_autoconfirm=false`). O script RECUSA ligar a confirmação se o SMTP próprio não estiver gravado.
6. **Teste do cenário completo com e-mail real** (uma conta nova de teste combinada com você): link do clube → cadastro → e-mail → confirmação em OUTRO navegador → login → pedido pendente no clube certo → aprovação pela diretoria. (Localmente isto já passou com e-mail real em `inscricao-email-real.mjs`, 41 asserts.)

**Rollback:** `mailer_autoconfirm=true` volta ao cadastro sem confirmação; o instantâneo em `~/.desbravaclube-backups/` guarda os valores anteriores (templates e demais campos não secretos).

**Efeito de ligar a confirmação:** quem se cadastra não tem sessão até clicar no link. O app já guarda o código do clube (`entrada_codigo`) ou o clube escolhido (`entrada_clube_slug`) dentro da conta, então o pedido é criado (PENDENTE) no primeiro login mesmo que o link seja aberto em outro navegador. O servidor continua decidindo clube, papel e status.

## Domínio antigo (`conquista-ashy.vercel.app`) — removido da allow-list em 01/10/2026
Provas de que nada depende dele: (1) `vercel.json` redireciona **permanentemente (308) todo caminho** desse host para `https://app.desbravaclube.com.br` — conferido ao vivo, inclusive `/entrar?codigo=…` e `/nova-senha`; (2) nenhum código, configuração do APK/Capacitor, PWA, função de borda ou variável de ambiente o referencia (só o `README.md` e a própria regra de redirect); (3) o APK embute as telas e usa `urlPublicaDoApp()` (domínio canônico). Efeito da remoção: um pedido de recuperação iniciado a partir desse host (que já redireciona antes) cairia no Site URL — o mesmo domínio do app. O projeto/deploy antigo **não** foi apagado. Reversão (se algum dia necessário): reincluir `https://conquista-ashy.vercel.app/**` no painel.
