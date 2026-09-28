# CLAUDE.md — DesbravaClube

Guia rápido para quem (humano ou IA) vai mexer no código. Atualizado em 28/09/2026 (HEAD `1ed0d6e`,
produção na migration `20260930000330`). Leia isto antes de abrir o código inteiro.

## O que é
SaaS multi-clube para **Clubes de Desbravadores** (crianças/adolescentes 10–15 anos + liderança).
- Site público: **desbravaclube.com.br** · App: **app.desbravaclube.com.br** (mesmo bundle, separado por hostname em `src/lib/dominios.js`).
- Dono: Thiago Miranda. Fala **português (BR)**, prefere explicação didática e **uma ação por vez**.
- **100% dos usuários no celular** (Android simples, 4G fraco). Mobile-first sempre: alvos ≥ 44px, sem rolagem lateral.
- Visual: **clean** (azul-marinho `#07122f`/`#0b1f4d` + dourado). Nada de neon/piscando (foi rejeitado).
- **Logo oficial**: rosa dos ventos com montanhas (`public/icon-192.png`, `MARCA_PRODUTO` em `src/lib/marca.js`). Não trocar. Logos dos clubes nunca são alteradas.
- Identidade global (login, cadastro, abertura, título, favicon, PWA) é sempre **DesbravaClube**; a marca do clube só aparece **dentro** do clube.

## Stack
- React 19 + Vite 8 (rolldown) + Tailwind 4, PWA (vite-plugin-pwa), framer-motion carregado leve (`src/lib/motionRecursos.js`).
- Android via Capacitor 8 (APK no GitHub Actions `android.yml`); iPhone usa o PWA.
- Supabase: Postgres com **RLS em todas as tabelas**, Auth, Storage (buckets privados), Edge Functions (`enviar-push`, `gerar-documento-pdf`, `gerar-documento-pdf-final`), pg_cron.
- Vercel faz deploy automático a cada push na `main`. **Migrations NÃO** vão no deploy: são aplicadas à parte.
- Node **22** (CI usa 22; com 20 o vitest não sobe).

## Estrutura
```
src/App.jsx            rotas (site x app), guards (SessaoObrigatoria, ClubeGuard, RotaRestrita)
src/context/           Auth (sessão/perfil), Clube (clube em uso, marca, papel), Escopo (coordenação)
src/lib/               regras puras: permissoes.js (matriz de ferramentas), clube.js, marca.js, dominios.js,
                       barreiraDeVoltar.js, recuperarVersao.js, tutorial/, corDaClasse.js …
src/services/          chamadas ao Supabase (RPCs) por domínio: classes, jogos, filaJogos (offline), admin,
                       hierarquia, institucional, suporte, vitrine, comercial, usuarios …
src/pages/             telas (app, /admin, portal /institucional, site em pages/site e Landing.jsx)
src/components/        UI compartilhada (AppLayout, ClubeGuard, LayoutConta, Avatar, admin/AdminUI …)
src/ui/                design system (Card, Botao, Campo, carregamento/esqueletos, avisos)
src/features/jogos/    jogos (classic + phaser, carregados sob demanda)
supabase/migrations/   fonte de verdade do banco (timestamp 20260930000xxx = SaaS)
supabase/tests/        testes SQL (run-tests.sh faz replay do zero num banco local isolado)
supabase/curriculo-manifesto/  manifesto das Classes (gera a migration de importação — nunca editar à mão)
supabase/functions/    Edge Functions
```

## Conceitos-chave
- **Multi-clube**: tudo tem `club_id`; o clube em uso vai no header `x-clube-atual` (por aba); servidor valida em `clube_atual_id()`. Uma pessoa pode estar em vários clubes (`organization_memberships`).
- **Papéis no clube** (`organization_memberships.role`): `desbravador`, `conselheiro`, `instrutor`, `tesoureiro`, `diretoria`, `pais`. Cargo real (Capelão, Secretária, Diretor Associado…) vem do convite e mapeia para o papel no servidor (migration 200).
- **Capacidades** (migrations 210–212): `pode_administrar_clube` = só diretoria (aprovar membros, equipe, cargos, config, plano, pontos manuais, jogos, avisos, moderação); `pode_avaliar_curriculo` = diretoria|instrutor; `pode_gerir_atividades` = diretoria|instrutor (desafios/missões/experiências). Conselheiro aponta só a própria unidade.
- **Cargos de unidade** (migration 230) são organizacionais, não dão acesso.
- **Hierarquia**: clube → distrito → região → campo/associação → união → divisão (`organizational_units.parent_id`). Coordenadores veem clubes abaixo pela árvore, **só números agregados** (nunca fotos, chat, financeiro, dados de criança), exceto dentro da etapa de aprovação de investidura.
- **Entrada em clube**: link/QR/código, convite ou escolher o clube no cadastro → vínculo **PENDENTE** → diretoria aprova. Papel sempre decidido pelo servidor. Nome de clube é único (migration 205).
- **Currículo**: versão publicada é imutável; mudou o manifesto → versão nova (hoje **2026.4**, 6 regulares + 6 avançadas). Comprovação por texto/foto (`tipo_evidencia`). Avançada exige a regular iniciada.
- **Investidura** (migration 330): clube → distrito → região → apto (pula nível inexistente; devolver marca requisitos para correção).
- **Membros inativos NUNCA são apagados**: inativar exige motivo e gera histórico (migration 310). A lixeira de membros está desligada de vez.
- **Comercial**: 1 licença = 1 clube; plano à venda = **Licença Anual**; teste grátis (30 dias, expira por cron), cortesia por código, sem gateway de pagamento real.
- **Vitrine do site**: todo clube ativo aparece em /clubes só com dados institucionais; contatos do diretor são opt-in (LGPD).

## Comandos
```bash
npm run check          # lint + vitest + gate de build por ambiente (o mesmo do CI)
npm run build
npm run test:db        # testes SQL: replay de todas as migrations num banco local isolado (Docker/Supabase local)
npm run test:db:upgrade
npm run curriculo:validar && npm run curriculo:importacao:check
npm run test:edge:bundle && npm run test:edge:bundle:pdf
```
No Windows, `npm ci` pode falhar com arquivo em uso: use `npm install` e reverta o `package-lock.json`.
Para testes SQL em paralelo, use `REPLAY_DB=<nome_proprio>`.

## Regras de trabalho (importantes)
- **Produção**: nunca `db reset`, `migration repair` ou `db push --linked` (o `supabase/.temp` está linkado à produção). Migration nova = arquivo novo com número maior; aplicar em transação com `lock_timeout` e inserir no ledger `supabase_migrations.schema_migrations`. Conferir o **Tenant 001** (`filhos-da-conquista`, clube fundador real) antes e depois.
- As migrations de jul–set/2026 (pré-SaaS) foram aplicadas antes do ledger; **não** rodar de novo.
- Nunca imprimir/commitar credenciais. Nunca usar a senha do dono. Nada de SQL "para facilitar" dado de usuário sem autorização explícita.
- Toda função `security definer` com `search_path ''` e checagem de clube/escopo; anon só executa as RPCs públicas listadas nos testes 09/56/72.
- CSP não tem `script-src` de propósito (vite-legacy); não mexer sem ler os testes de CSP.
- Service worker nunca cacheia resposta autenticada.
- Cada mudança de regra de negócio vem com teste SQL e/ou vitest; os testes de contrato (identidade do produto, multiclube, especialidades fora do piloto) não podem ser afrouxados.

## Pendências conhecidas (28/09)
- Documento/PDF, assinatura e investidura nunca exercitados de ponta a ponta em produção.
- Catálogo de Especialidades (só 1 de teste). Classes de Liderança não importadas.
- Termos de Uso/Privacidade prontos na branch local `termos` (aguardando dados do titular + revisão jurídica).
- Painel: SMTP próprio + confirmação de e-mail, MFA do admin, trocar senhas/revogar tokens.
- Testes SQL vermelhos: 29 (função nova olhando `profiles.papel`, provável `entrada_solicitar_clube`), 30 (prêmio de recorde semanal — investigar), 78 (teste desatualizado da vitrine automática).
