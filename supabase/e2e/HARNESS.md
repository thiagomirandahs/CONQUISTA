# Harness de teste — as regras que não são óbvias

## 1. Sessões: uma conta por contexto de navegador

Esta é a regra mais importante, e foi aprendida errando duas vezes.

| o que se quer testar | como se faz | por quê |
|---|---|---|
| **mesma conta, clubes diferentes** | duas **abas** do mesmo contexto | o clube em uso vive em `sessionStorage`, que é por aba. Duas abas da mesma sessão podem estar em clubes diferentes, e é assim que a pessoa realmente usa |
| **contas diferentes ao mesmo tempo** | dois **contextos/perfis** de navegador independentes | a sessão do supabase-js vive em `localStorage`, que é **compartilhado por origem**. Logar numa aba **troca a sessão de todas as outras** |

O erro: montar "duas contas, uma por aba" e concluir alguma coisa do resultado. Aconteceu na fase
8.6 — a aba que eu achava ser da pessoa nova estava operando como a diretoria do clube, porque o
login na outra aba havia substituído a sessão compartilhada. O teste parecia passar e media outra
coisa.

Como reconhecer que caiu nisso: o `document.title` ou a marca de uma aba muda sozinho depois de você
logar em outra. Se isso acontecer, as duas abas são a mesma sessão.

Na prática, com o browser pane:

- **duas abas, mesma conta** → `tabs_create` e trocar o clube em uma delas. Legítimo;
- **duas contas** → não dá para ter as duas vivas. Faça **em sequência**: entra, faz, sai, entra
  como a outra. É também como as pessoas usam de verdade — cada uma no seu aparelho.

## 2. Ambiente alvo

```bash
node supabase/e2e/montar-tres-clubes.mjs                 # desenvolvimento (54321)
ALVO=staging node supabase/e2e/montar-tres-clubes.mjs    # staging (55321)
```

As chaves do staging saem de `.env.staging`, escrito por `scripts/staging.mjs`. **Nunca** de
`supabase status`: ele recalcula as chaves do segredo que enxerga, e sem a variável devolve as do
ambiente de desenvolvimento apontando para a porta do staging.

## 3. Rodar os testes SQL contra o staging

```bash
SUPABASE_DB_CONTAINER=supabase_db_CONQUISTA-STAGING \
  bash supabase/tests/run-tests.sh --db postgres --no-replay 56_gate_multiclube_permanente
```

`--no-replay` porque o alvo é o banco **vivo** do staging, com os dados que o seeder criou — que é
o ponto do item 5 da fase 9: conferir o estado real, não um clone limpo. Cada arquivo roda em
transação com `rollback`, então o staging não é alterado.

## 4. O que "verde" não prova

- Sucesso HTTP não é evidência de isolamento: a escrita pode ter caído no clube errado e retornado
  200. O gate mede o **estado do banco fora da RLS**, antes e depois, e desfaz.
- Uma varredura que devolve zero pode significar "nada vazou" ou "não havia nada para vazar". Todo
  gate de varredura precisa de um **piso**: prove que havia linha no clube alvo antes de o zero
  contar.
- Carga medida nesta máquina mede **esta máquina**. Ver `supabase/infra/STAGING.md`.
