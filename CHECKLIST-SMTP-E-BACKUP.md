# Checklists preparados (NADA ativado) — SMTP e Backups

## A) SMTP / e-mail do Auth (ordem obrigatória; só o passo 9 liga a confirmação)
Estado hoje (01/10/2026): SMTP padrão do Supabase (2 e-mails/hora, entrega pouco confiável), templates em inglês, `mailer_autoconfirm=true` (confirmação DESLIGADA).

- [ ] 1. **Provedor** escolhido (Resend, Brevo, Amazon SES, Zoho…) e conta criada por você. *Depende de você.*
- [ ] 2. **Remetente**: `nao-responder@desbravaclube.com.br` (e um e-mail de resposta/suporte real).
- [ ] 3. **DNS no Registro.br**: SPF (TXT), DKIM (CNAME/TXT que o provedor entrega), DMARC (TXT `_dmarc`, começar com `p=none` e subir depois). Verificar no painel do provedor até aparecer "verificado". *Depende de você.*
- [ ] 4. **Credenciais SMTP** (host, porta, usuário, senha) gravadas por você no `~/.desbravaclube-prod.env` (`SMTP_HOST/PORT/USER/PASS/ADMIN_EMAIL`) — nunca no chat.
- [ ] 5. `node scripts/auth/aplicar-auth-producao.mjs` (dry-run, mostra o que mudaria) → depois `--aplicar-smtp`.
- [ ] 6. **Templates em português**: `--aplicar-templates` (já versionados em `supabase/auth-templates/`).
- [ ] 7. **Recuperação de senha**: `TESTE_EMAIL_CONTA=<seu e-mail> node scripts/auth/testar-recuperacao-producao.mjs` → e-mail chega, remetente certo, link abre `https://app.desbravaclube.com.br/nova-senha`, troca funciona, link expirado/usado mostra a tela "Link inválido".
- [ ] 8. **Teste de entrega** em 3 provedores (Gmail, Outlook, um e-mail de domínio próprio): caixa de entrada (não spam), horário, sem `localhost` em nenhum link.
- [ ] 9. **Só depois**: `--ativar-confirmacao` (o script recusa se o SMTP não estiver configurado) e teste de cadastro por link de clube com confirmação em OUTRO navegador (código/slug sobrevivem — já provado localmente).
- Reversão: `mailer_autoconfirm=true` de novo (1 chamada); SMTP pode ser removido voltando ao padrão.

## B) Backups — recomendação objetiva
Situação: plano sem backup automático/PITR; backup só neste computador, **sem criptografia**. O dump contém dados pessoais e (por causa de um gatilho legado) uma chave `service_role` — tratar como segredo.

| Item | Recomendação |
|---|---|
| Cópia local | Pasta única `~/.desbravaclube-backups/` (já usada). Manter o último backup completo + o anterior. |
| Cópia externa | Uma segunda cópia **criptografada** em nuvem sua (Drive pessoal/OneDrive/Backblaze B2) **ou** disco externo guardado fora do computador. **Só envio com sua autorização.** |
| Criptografia | Antes de sair do PC: `7z a -p -mhe=on` (AES-256) ou `age`/`gpg`; senha guardada no gerenciador de senhas, não junto do arquivo. |
| Frequência | Banco: semanal + sempre antes de uma janela de migration. Storage: mensal (cresce pouco: 672 MB) + antes de janela. |
| Retenção | 4 semanais + 3 mensais + o pré-janela de cada fase (nunca apagar o pré-Fase 8 até a Fase 9 estar estável). |
| Restauração testável | Comando existente: `bash scripts/janela-fase8/backup-banco.sh --testar-restauracao <pasta>` (restaura em banco descartável e confere ledger/vínculos). Rodar a cada backup novo. Storage: conferir `MANIFESTO.tsv` (sha256) por amostragem. |
| Automatizar | Tarefa agendada do Windows semanal chamando `backup-banco.sh` + `backup-storage.mjs` (preparo, sem ativar). |
| Alternativa de infra | Avaliar o plano Pro do Supabase (backups diários + PITR opcional) — decisão de custo sua. |
