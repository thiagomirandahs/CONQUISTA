# Ambiente de produção — o que precisa existir antes do primeiro clube pagante

Este documento **não** provisiona nada. Ele descreve o alvo, item por item, para que subir o
ambiente comercial seja uma execução conferível e não uma sequência de lembranças. Nada aqui foi
aplicado a projeto remoto nenhum.

**Alvo:** Supabase **Pro** + compute **Small** (2 vCPU / 2 GB).

---

## 1. Por que Pro, por que Small, e por que não mais

Tudo abaixo vem de medição, não de catálogo ([PRODUCTION-READINESS-8.1.md](../../PRODUCTION-READINESS-8.1.md) §3 e §6).

| Decisão | Motivo medido |
|---|---|
| **Pro** (e não Free) | Free pausa por inatividade e tem retenção curta de backup. Um clube pagante não pode encontrar o app dormindo numa terça-feira. |
| **Small** (2 vCPU / 2 GB) | O limite medido é **CPU do banco** (75–95% no pico), não conexão. Micro é a mesma classe do container local que saturou a ~200 req/s. |
| **Pool do PostgREST: não mexer** | Na Fase 8 o pool (10) era o gargalo. Depois da migration 51 deixou de ser: 23 conexões de 100, 1–3 ativas, **zero espera de lock** nos quatro degraus de carga. Aumentar o pool agora resolveria um problema que não existe — e a Fase 8.2 proíbe mexer sem evidência nova. |
| **Sem Supavisor** | Serve para muitas conexões curtas (serverless). A arquitetura é PostgREST com pool persistente. |
| **Sem réplica de leitura** | Resolveria o problema errado: o banco está a 14% de uso de conexões. |

**Gatilho para revisar:** espera de conexão aparecendo em `pg_stat_activity`, ou CPU do banco
sustentada acima de 80% fora de pico. Aí, e só aí, subir compute — antes de mexer no pool.

---

## 2. Segredos e variáveis

Nada aqui vai para o repositório. A coluna "onde" é o lugar exato no painel.

| Nome | Onde | Para que | Se faltar |
|---|---|---|---|
| `PUSH_WEBHOOK_SECRET` | Edge Functions → Secrets | fechadura da `enviar-push` (header `x-push-webhook-secret`) | a função responde 401 a tudo — **falha fechada** |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Edge Functions → Secrets | Web Push (navegador/PWA) | push web não sai |
| `FCM_SERVICE_ACCOUNT` | Edge Functions → Secrets | JSON da conta de serviço do Firebase (push do APK) | push nativo não sai, e isso vira linha em `infra_falhas` |
| `push_edge_url` | **Vault** do banco | URL da Edge Function, lida pelo gatilho | o gatilho registra a falta em `infra_falhas` e a notificação é gravada mesmo assim |
| `push_webhook_secret` | **Vault** do banco | o MESMO valor do secret acima | idem |

Os dois do Vault entram por `supabase/infra/configurar-push.sql` — é um molde, com conferência
no fim que mostra que os segredos existem **sem imprimir o valor**.

> A chave `anon` e a VAPID **pública** não são segredos: vão no bundle por design. Classificá-las
> errado leva a esconder o que não precisa e a relaxar no que precisa.

---

## 3. Autenticação

Aplicado em `supabase/config.toml` (Fase 8.1) e precisa ser conferido no painel do projeto remoto,
que tem a sua própria cópia dessas opções:

| Opção | Valor | Por quê |
|---|---|---|
| `enable_confirmations` | **true** | sem isso, o e-mail de qualquer terceiro vira conta ativa |
| `minimum_password_length` | **8** | seis sem exigência nenhuma é força bruta trivial |
| `password_requirements` | `letters_digits` | símbolo **não** é exigido de propósito: o público inclui crianças de 10 anos digitando no celular |
| `secure_password_change` | **true** | aparelho destravado não vira sequestro de conta |
| `site_url` | domínio real do app | é o que monta os links de confirmação e recuperação. Apontando para `127.0.0.1`, o link chega no e-mail da pessoa apontando para a máquina dela |
| `additional_redirect_urls` | inclui **`/nova-senha`** | é para onde o link de recuperação volta; sem isso a recuperação falha no último passo |

Conferir com `npm run test:auth:e2e` apontado para o ambiente (20 asserts: cadastro → confirmação
→ login → recuperação).

---

## 4. Domínio, URLs e CSP

- A CSP viaja **no próprio HTML**, como `<meta>`, gerada no build por `vite-plugin-csp.js`. Vale
  para o navegador **e** para a WebView do APK, que não tem servidor na frente para mandar header.
- O `vercel.json` continua responsável pelo que só funciona em header: `frame-ancestors`, HSTS,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. As duas políticas se somam.
- `connect-src` precisa citar o domínio do projeto Supabase de produção. Hoje é
  `https://*.supabase.co` + `wss://*.supabase.co` — se um dia houver domínio próprio para a API,
  entra em `cspComHashes({ conectaEm: [...] })` no `vite.config.js`.

**Conferência após deploy:** abrir o app e olhar o console. **Zero erro de CSP.** Um script
bloqueado não derruba a página — degrada em silêncio, que é pior.

---

## 5. Backup e restore

| | |
|---|---|
| **Backup** | automático do plano Pro, com PITR de 7 dias |
| **Restore — procedimento** | `supabase/infra/restaurar-teste.sh`, reexecutável, com conferência de tabelas, funções, policies, gatilhos, índices, RLS **e uma leitura real como `authenticated`** |
| **RTO medido** | 7 s de máquina para 157 MB (dump 2 s + restore 4 s). É **piso**, não promessa: o RTO real soma decisão humana, provisionamento e reapontamento do app |
| **RPO** | o do PITR do plano |

**Duas coisas que só aparecem restaurando de verdade, e que estão no procedimento:**

1. **`pg_restore --no-acl` passa em todas as contagens e devolve um banco inutilizável.** Sem os
   GRANTs, `authenticated` não lê uma única tabela — a RLS decide quem vê o quê *depois* do grant.
2. **`pg_cron` não acompanha um restore para banco novo.** Os jobs agendados se perdem. Num PITR do
   Supabase o banco mantém o nome e isso não ocorre; numa restauração para projeto novo, ocorre —
   e os jobs precisam ser recriados.

---

## 6. Edge Functions

Uma só: `enviar-push`.

- **Verify JWT desligado** — quem chama é o gatilho do banco, não um usuário. A fechadura é o
  segredo próprio, comparado em tempo constante, com falha fechada se o segredo nem estiver
  cadastrado.
- **Sem CORS** de propósito: é webhook, não API de navegador.
- Entrega por **duas rotas** (Web Push e FCM) para o mesmo público, vindo da mesma regra no banco.
- **Lote de 25 com prazo de 10 s por chamada.** Um clube de 500 membros abriria 1.000 conexões de
  saída num invoke se fosse `Promise.all` sobre a lista inteira.

**Publicação:** a função é colada no painel (não há lockfile), então as dependências têm versão
**exata** e `src/lib/pushEdgeContrato.test.js` (20 asserts) trava o formato.

---

## 7. Push

O mecanismo inteiro vem nas migrations: extensão `pg_net`, gatilho `trg_notificacao_push` em
`notificacoes`, e as funções de destinatário. **Um projeto novo já nasce com push ligado** — o que
falta é só preencher os dois valores do Vault e os secrets da Edge Function.

Conferência de ponta a ponta depois de configurar:
```sql
select * from public.infra_falhas order by id desc limit 5;  -- precisa continuar vazio
select * from net._http_response order by id desc limit 5;   -- precisa ter um 200
```

---

## 8. Observabilidade

| O quê | Onde |
|---|---|
| erro de frontend (UI, boundary, janela, promessa) | `app_erros`, via `registrar_erro()` |
| leitura agrupada para investigar um relato | `painel_erros(horas)` |
| falha de infraestrutura | `infra_falhas` |
| falha de cron | `cron_falhas` |

**Quem lê:** só a operação da plataforma (`eh_admin_plataforma()`), papel deliberadamente separado
das diretorias de clube. **Retenção:** 90 dias, com expurgo agendado.

**O que nunca é gravado:** mensagem crua do servidor, querystring, token, senha, evidência, texto
de chat, nome ou contato. O `user_id` e o `club_id` vêm do JWT e do header — o cliente não escolhe
de quem é o erro, e a função nem aceita esses parâmetros.

---

## 9. Rollback

| Camada | Como voltar | Tempo |
|---|---|---|
| **Front (Vercel)** | promover o deploy anterior (o Vercel guarda todos) | ~1 min |
| **Front, do lado do cliente** | já existe rede de segurança: o app recarrega uma vez sozinho se um chunk falhar (`App.jsx`) | automático |
| **Migration** | o SQL Editor é atômico por execução: uma migration que falha **não aplica nada**. Há pré-voo (`PREFLIGHT-PRODUCAO.sql`) e teste de replay do zero a cada rodada | imediato |
| **Migration já aplicada** | não há `down` automático. O caminho é uma migration nova que corrige — ou PITR, se houver perda de dado | minutos a horas |
| **Edge Function** | republicar a versão anterior no painel | ~1 min |
| **Banco** | PITR do plano Pro | ver §5 |

**Ordem de deploy que minimiza janela de incompatibilidade:** migrations primeiro (são aditivas por
convenção neste projeto), depois a Edge Function, depois o front. Assim o front novo nunca chega
antes do schema de que ele depende.

---

## 10. Checklist de subida

- [ ] Projeto Supabase **Pro** criado, compute **Small**
- [ ] Migrations aplicadas na ordem (replay do zero testado localmente a cada rodada)
- [ ] `PREFLIGHT-PRODUCAO.sql` executado e conferido
- [ ] Segredos da Edge Function cadastrados (§2)
- [ ] `supabase/infra/configurar-push.sql` executado, com as duas linhas aparecendo na conferência
- [ ] Opções de auth conferidas no painel (§3), incluindo `site_url` e `/nova-senha`
- [ ] Deploy do front; console **sem nenhum erro de CSP**
- [ ] Smoke test pós-deploy executado (`npm run test:smoke`)
- [ ] Restore testado **neste** projeto, não só localmente
- [ ] Canal de alerta configurado e testado com um disparo real
