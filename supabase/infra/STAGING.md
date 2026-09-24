# Staging — recriar do zero

> Ambiente separado do de desenvolvimento em **tudo**: banco, storage, auth, edge functions,
> realtime, studio, portas, chaves e domínio de confiança.

```bash
node scripts/staging.mjs recriar    # do zero (derruba, apaga volumes, sobe, aplica migrations + seed)
node scripts/staging.mjs conferir   # prova, por experimento, que os dois ambientes não se enxergam
```

`recriar` é idempotente e não pergunta nada. Ele gera o que falta, sincroniza as migrations do
projeto, sobe o stack e escreve `.env.staging`.

| | desenvolvimento | staging |
|---|---|---|
| API | `127.0.0.1:54321` | `127.0.0.1:55321` |
| Banco | `:54322` | `:55322` |
| Studio | `:54323` | `:55323` |
| E-mail (Mailpit) | `:54324` | `:55324` |
| Front | `:5173` (dev) / `:4173` (preview) | **`:4273`** |
| Containers | `supabase_*_CONQUISTA` | `supabase_*_CONQUISTA-STAGING` |
| Segredo JWT | padrão do CLI | `staging/.jwt-secret` (fora do git) |
| Chave de assinatura | padrão do CLI | `staging/supabase/signing_keys.json` (fora do git) |

Rodar o front apontado para o staging:

```bash
npm run dev -- --port 4273 --mode staging
```

---

## O que quase deu errado, e por que a conferência existe

Trocar o segredo JWT **não isola** dois stacks locais. Com os segredos diferentes, bancos
diferentes e portas diferentes, um token emitido pelo auth de desenvolvimento **continuava sendo
aceito** pelo staging. A sonda de `conferir` pegou isso na primeira execução.

A razão está no PostgREST. Ele valida o token contra um JWKS com **duas** chaves:

- uma `oct` (simétrica), derivada do segredo — essa era diferente entre os dois;
- uma `EC / ES256`, que é a chave de assinatura **assimétrica** do CLI — e ela é **fixa**. Medido:
  o mesmo `kid` `b81269f1-…` nos dois stacks, porque o CLI embarca a mesma chave em todo projeto
  local.

Como o GoTrue assina com a assimétrica, o token de um ambiente validava no outro. Os dois tinham
bancos separados, buckets separados, portas separadas — e o **mesmo domínio de confiança**. Uma
sessão de um valia no outro.

A correção é `signing_keys_path` apontando para uma chave gerada só para o staging. Depois dela:

```
staging  kid 5c01ebdd-…      dev  kid b81269f1-…
OK   um token do DESENVOLVIMENTO é recusado pelo staging
```

E um efeito medido depois, no teste de carga: com a chave própria, o JWKS do PostgREST do staging
tem **só a chave EC** — a simétrica some. Um token HS256 assinado com o segredo do staging dá
**401**. Quem precisar de tokens sintéticos (carga) assina ES256 com a chave do staging:
`CHAVE_JWK=staging/supabase/signing_keys.json node supabase/carga/gerar-tokens.mjs …`.

**Isto vale para produção.** Se um dia houver um projeto Supabase de staging na nuvem ao lado do de
produção, as chaves são geradas por projeto e o problema não existe. Mas qualquer ambiente local que
alguém chame de "staging" e suba com o CLI padrão **compartilha domínio de confiança com todos os
outros stacks locais da máquina** — inclusive um `supabase start` de outro projeto qualquer.

---

## Segunda armadilha: `supabase status` mente sobre as chaves

`status -o env` **não lê** as chaves do stack em execução: ele as **recalcula** a partir do segredo
JWT que enxerga naquele momento. Como o segredo do staging entra por variável de ambiente (para não
viver no `config.toml`, que é versionado), um `status` sem ela devolve as chaves do segredo
**padrão** — as do ambiente de desenvolvimento, apontando para a porta do staging.

Medido: `supabase status --workdir staging` imprimia a `ANON_KEY` do desenvolvimento. Quem seguisse
um runbook que dissesse "copie a chave do `status`" colaria a chave errada, o auth recusaria tudo, e
o erro não falaria em segredo nenhum.

Por isso a fonte de verdade é **`.env.staging`**, escrito por `scripts/staging.mjs` no momento em que
o stack sobe — por quem sabe o segredo. Não copie chave de `status`.

---

## Povoar, conferir, recuperar — os comandos da fase 9

```bash
node supabase/e2e/montar-tres-clubes.mjs            # ALVO=staging: B e C pelo onboarding
ALVO=staging node supabase/e2e/popular-staging.mjs  # dez identidades e os dados, pelo produto
ALVO=staging node supabase/e2e/gates-api-staging.mjs  # os cinco gates pela API real
ALVO=staging node supabase/e2e/redteam-staging.mjs    # o red-team
node scripts/restaurar-staging.mjs completo         # backup + restore num terceiro stack descartável
node scripts/restaurar-staging.mjs in-place <dir>   # restore do PRÓPRIO staging (recuperação)
node scripts/aplicar-migration.mjs                  # migrations pendentes, como o SQL Editor aplica
node scripts/drill-migration.mjs                    # o drill (só a partir da versão 72)
```

Os scripts que usam o serviço pedem `SERVICE_ROLE_KEY` (saída de `node scripts/staging.mjs chaves`).

**Um restore que recria o banco precisa criá-lo com `owner postgres`.** Sem isso tudo volta — dados,
policies, GRANTs, a suíte passa — e a próxima migration falha com "permission denied for schema
public". Os dois restores do `restaurar-staging.mjs` criam com o dono certo e provam que uma migration
ainda passa. Detalhes em `DEPLOY-E-RECUPERACAO.md`.

---

## O que este staging **não** prova

Ele roda na mesma máquina que o ambiente de desenvolvimento. Isso é suficiente para isolamento,
jornada de navegador, backup/restore, drill de migration e red-team.

**Não serve para medir capacidade.** Um teste de carga aqui mede este computador — CPU, disco e
Docker —, não o Supabase. Qualquer número de carga obtido neste ambiente é diagnóstico, nunca
promessa de capacidade.

---

## Promover para um projeto na nuvem

Quando existir um projeto Supabase de staging de verdade, o caminho é:

1. criar o projeto no painel (região igual à de produção, plano igual);
2. `supabase link --project-ref <ref>` e `supabase db push` — as mesmas migrations, na mesma ordem;
3. aplicar `supabase/infra/configurar-push.sql` e as configurações de auth de
   `AMBIENTE-DE-PRODUCAO.md` (confirmação de e-mail, redirect URLs);
4. gerar um `.env.staging` com a URL e a `anon` do projeto novo — e **nada mais muda**: a CSP sai do
   `VITE_SUPABASE_URL` desde a fase 8.5, então o build se ajusta sozinho;
5. rodar `npm run test:ambiente`, que prova que o bundle não carrega o endpoint de outro ambiente.

O que **não** é transportável: as chaves locais, o segredo e a chave de assinatura deste diretório.
Eles existem só para isolar os dois stacks desta máquina.
