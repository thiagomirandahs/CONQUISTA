# 🏕️ Filhos da Conquista — Planejamento do Sistema

> Documento vivo de planejamento. Vamos ajustando conforme as decisões.
> Clube: **Filhos da Conquista** · Cores: **Azul, Amarelo e Branco**

## ✅ Decisões fechadas
- **Plataforma:** site responsivo + **PWA** (instala no celular como app, um só código para web e mobile).
- **Construção:** Claude gera o código e guia o líder **passo a passo** (líder não é programador).
- **Atividades:** divisão **por papel** — líderes criam/corrigem (servidor), desbravadores entregam (cliente).
- **Stack:** React + Vite (PWA) · Tailwind CSS · Supabase (banco/login/fotos) · Vercel (hospedagem grátis).
- **Cadastro:** auto-cadastro **com aprovação da diretoria** (só entra após aprovado).
- **Ranking de unidade:** **média por membro** (pontos da unidade ÷ nº de membros).
- **Unidades:** a diretoria **cria as unidades primeiro**; no cadastro o membro **escolhe a unidade** existente.
- **Identidade:** clube fundado em **1994**; usar a logo oficial (escudo azul/dourado) no app, login e ícone do PWA.

---

## 1. Visão geral

Sistema (web + mobile) para **acompanhamento e postagem de atividades** do clube de
desbravadores. A diretoria cadastra atividades, os desbravadores entregam, e tudo
gera **pontos** que alimentam dois rankings: **por unidade** e **individual**.

Objetivos principais:
- Engajar os desbravadores com uma "competição" saudável (ranking).
- Organizar as atividades num só lugar (sem grupo de WhatsApp bagunçado).
- Registrar a memória do clube (mural de fotos).
- Dar visibilidade pros pais e diretoria do progresso de cada um.

---

## 2. Perfis de usuário (papéis e permissões)

As permissões são **diferentes por cargo**. Perfis do sistema:

1. **Desbravador (membro)** — entrega atividades e acompanha seu progresso.
2. **Conselheiro (líder de unidade)** — **presença** e **apontamento de pontos** da sua unidade.
3. **Instrutor** — cuida das **atividades** (criar e corrigir) e classes/especialidades.
4. **Tesoureiro** — **controla as finanças / mensalidades**.
5. **Diretoria** — **Diretor, Diretora, Diretor Associado, Diretora Associada**: administração geral.
   Pode tudo no operacional e **acompanha** (vê) as finanças, mas quem **edita** mensalidade é o Tesoureiro.
6. **Pais / Responsável** — acompanha (**só vê**) as atividades, pontos e mensalidade do(s) seu(s) filho(s).

### O que cada um pode fazer

| Recurso | Desbravador | Conselheiro | Instrutor | Tesoureiro | Diretoria |
|---|:--:|:--:|:--:|:--:|:--:|
| Ver ranking / unidade / mural | ✅ | ✅ | ✅ | ✅ | ✅ |
| Entregar atividades | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Presença** + **apontar pontos** | ❌ | ✅ (sua unidade) | ✅ | ❌ | ✅ |
| Criar / corrigir **atividades** | ❌ | ❌ | ✅ | ❌ | ✅ |
| Aprovar **cadastros** pendentes | ❌ | ❌ | ✅ | ❌ | ✅ |
| Gerir **unidades** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Gerir mensalidades** | ❌ | ❌ | ❌ | ✅ controla | 👁️ acompanha |

> ✅ Confirmado: **Diretor, Diretora e Associados** têm acesso total igual.
> O **Instrutor** faz atividades, presença/pontos e aprova cadastros (não gere unidades nem finanças).
> 👨‍👩‍👧 **Pais/Responsável**: acesso **somente-leitura** ao progresso do próprio filho.

---

## 3. Telas e funcionalidades

### 3.1. Login / Cadastro
- Login por e-mail + senha (com recuperação de senha).
- **Entrada com carrossel de fotos** das atividades do clube passando ao fundo.
- **Auto-cadastro com aprovação:** o novo membro se inscreve informando nome, **foto de perfil**
  (ajuda no reconhecimento), data de nascimento e **escolhe a unidade** (lista já criada pela diretoria).
- O cadastro fica **pendente** até a diretoria aprovar — só então o membro acessa.
- Se a unidade ainda não existir, o membro pode ficar "sem unidade" e a diretoria define depois.

### 3.2. Tela de Ranking
- **Ranking de Unidades** (média por membro) e **Ranking Individual** (pontos por desbravador).
- **Gamificado para crianças**: pódio animado com coroa, confete, números que sobem contando,
  setas de subiu/desceu e **card** divertido ao tocar num competidor.
- **Avatares com foto** do desbravador (ou inicial/emoji enquanto não houver foto).
- Filtros: geral / por mês / por categoria de atividade.

### 3.3. Tela de Atividades (dois lados)

**Categorias (fixas):** 🙏 Espiritual · 🎖️ Especialidades/Classes · 🤝 Serviço/Comunidade · 🏕️ Eventos/Acampamentos · ✅ Presença/Uniforme/Pontualidade
> A diretoria **cadastra quantas atividades quiser** dentro de cada categoria.

- **Lado Liderança (servidor):**
  - Cadastrar atividade: título, descrição, **pontos**, prazo, categoria,
    público-alvo (todos / unidade específica / individual), exige comprovação? (foto/texto).
  - **Corrigir entregas:** aprovar (dá os pontos), reprovar (com feedback) ou pedir ajuste.
- **Lado Desbravador (cliente):**
  - Lista de atividades pendentes / entregues / concluídas.
  - **Entregar atividade:** enviar texto e/ou foto como comprovação.
  - ⏰ **Após o prazo, não dá mais para entregar** (a atividade fica "Prazo encerrado").
  - Ver status e pontos recebidos.

### 3.4. Unidades

**Gestão de Unidades (diretoria — lado servidor):**
- Criar / editar / remover unidades: nome, emblema, cor e conselheiro responsável.
- ⚠️ As unidades precisam existir **antes** dos membros se cadastrarem — são elas que
  aparecem na lista pro membro escolher no cadastro.

**Tela da Unidade (todos veem):**
- Nome, emblema e cor da unidade.
- **Ao clicar na unidade**, abre o painel com a lista de membros + conselheiro.
- Pontuação (média por membro) e posição no ranking.
- Atividades e fotos da unidade.

### 3.5. Cadastro de Usuários
- Gerenciado pela diretoria (criar, editar, desativar, trocar de unidade/papel).

### 3.6. Mural de Fotos
- Galeria de fotos dos eventos e atividades.
- Upload com legenda, data e evento.
- Moderação pela diretoria (aprovar antes de publicar, opcional).

### 3.7. Presença (Conselheiro / Liderança)
- Marcar a **presença** dos desbravadores em cada reunião (por data).
- Conselheiro marca a **sua unidade**; liderança vê/edita todas.
- A presença pode virar **pontos** automaticamente (categoria Presença).

### 3.8. Apontamento de pontos (Conselheiro / Liderança)
- Lançar pontos por **uniforme, pontualidade, comportamento, material**, etc. — por desbravador, por reunião.
- Esses pontos entram no extrato e contam no ranking, junto com os das atividades.

### 3.9. Mensalidades (Tesoureiro · Diretoria acompanha)
- O **Tesoureiro controla**: marca **pago / pendente** e lança a data do pagamento.
- A **Diretoria acompanha** (vê quem está em dia e quem está devendo), sem editar.
- **Valor igual para todos** — um valor único do clube por mês (definido pela diretoria).
- Histórico mês a mês por desbravador.

### 3.10. Página dos Pais / Responsável
- O responsável acompanha **somente o(s) seu(s) filho(s)** (acesso só de leitura).
- Vê: atividades (pendentes/entregues), pontos, posição no ranking e **situação da mensalidade**.
- Vínculo pai ↔ filho: **auto-cadastro** — o responsável escolhe o(s) filho(s) e a diretoria aprova.

---

## 4. Sistema de pontos e ranking

Coração do sistema. Os pontos vêm de **duas fontes**:
1. **Atividades** entregues pelo desbravador e **aprovadas** pela liderança.
2. **Apontamentos do conselheiro**: presença, uniforme, pontualidade, comportamento.

- **Ranking individual** = soma de **todos** os pontos do desbravador (das duas fontes).
- **Ranking de unidade** = **média por membro** (já decidido).
- Todo ponto fica no **extrato**: data, origem, motivo e quem lançou/aprovou.

---

## 5. Modelo de dados (entidades principais)

```
usuarios     (id, nome, email, senha, foto, nascimento, papel, cargo, unidade_id, status)
                papel: desbravador | conselheiro | instrutor | tesoureiro | diretoria | pais   ·   status: pendente | ativo
                cargo (diretoria): Diretor | Diretora | Diretor Associado | Diretora Associada
config       (id, mensalidade_valor)   ← valor único da mensalidade, definido pela diretoria
unidades     (id, nome, emblema, cor, conselheiro_id)
atividades   (id, titulo, descricao, pontos, prazo, categoria, alvo, exige_foto, criado_por)
entregas     (id, atividade_id, usuario_id, texto, foto, status, pontos_dados, avaliado_por, data)
presencas    (id, data, unidade_id, desbravador_id, presente, registrado_por)
pontos       (id, usuario_id, origem, pontos, motivo, data, lancado_por)   ← extrato (atividade/presença/uniforme/…)
mensalidades (id, desbravador_id, mes, ano, valor, status, data_pagamento, registrado_por)  ← pago | pendente
responsaveis (id, responsavel_id, desbravador_id)                  ← vincula pai/responsável ao filho
fotos        (id, url, legenda, evento, data, autor_id, aprovada)
```

---

## 6. Stack técnica (DECIDIDA)

Recomendação pensada pra um clube (baixo custo, fácil de manter, mobile + web num só lugar):

- **Frontend:** React + Vite (ou Next.js) — site **responsivo** que vira **PWA**
  (instala no celular como se fosse app, sem precisar de loja).
- **Backend + Banco + Login + Fotos:** **Supabase** — já entrega banco de dados,
  autenticação e armazenamento de fotos prontos, com plano **gratuito** generoso.
- **Hospedagem:** **Vercel** (grátis).
- **Visual:** Tailwind CSS com a paleta do clube.

### Identidade visual (baseada na logo oficial)
> Clube fundado em **1994**. Logo: escudo azul com borda dourada, cruz, Jesus
> entregando coroas e o nome em branco/dourado.

| Cor | Uso | Hex |
|---|---|---|
| 🔵 Azul royal | Cor principal (cabeçalho, botões, destaque) | `#1E3A8A` / `#1D4ED8` |
| 🟡 Dourado/Amarelo | Destaques, pódio, bordas, títulos | `#F5C518` / `#FACC15` |
| ⚪ Branco | Fundo das telas e cartões | `#FFFFFF` |
| ⚙️ Prata/Cinza | Detalhes e bordas (moldura do escudo) | `#9CA3AF` |

- A **logo** entra no topo do app, no login e como **ícone do PWA** (tela inicial do celular).
- Guardar o arquivo em `assets/logo.png` quando começarmos a construir.

---

## 7. Fases de desenvolvimento (do MVP ao completo)

**Fase 1 — MVP (o essencial pra já usar):**
1. Login + cadastro (com aprovação) + **papéis e cargos**
2. Unidades + tela da unidade
3. Atividades (liderança cadastra · desbravador entrega · liderança corrige)
4. Ranking (individual e de unidade)

**Fase 2 — Gestão do clube:**
5. **Visão do Conselheiro**: presença da unidade + apontamento de pontos
6. **Mensalidades** (pago/pendente por desbravador, com histórico)

**Fase 3 — Engajamento e extras:**
7. Mural de fotos
8. Filtros de ranking (mês, categoria), notificações, relatórios/PDF

---

## 8. Decisões em aberto

- [x] ~~Plataforma~~ → **PWA (site instalável)**
- [x] ~~"Cliente e servidor" nas atividades~~ → **divisão por papel** (líder cria, membro entrega)
- [x] ~~Quem cadastra usuários~~ → **auto-cadastro com aprovação da diretoria**
- [x] ~~Ranking de unidade~~ → **média por membro**
- [x] ~~Lista de unidades~~ → a **diretoria cria no próprio app** (não precisa definir agora)
- [x] ~~Categorias de atividade~~ → **Espiritual · Especialidades/Classes · Serviço/Comunidade · Eventos/Acampamentos · Presença/Uniforme/Pontualidade**

**Decisões (perfis e mensalidade):**
- [x] ~~Permissões da liderança~~ → **diferentes por cargo** (+ novo cargo **Tesoureiro**)
- [x] ~~Quem corrige entregas~~ → **só a liderança** (diretoria/instrutor)
- [x] ~~Quem gerencia mensalidade~~ → **Tesoureiro** controla · **Diretoria acompanha**
- [x] ~~Valor da mensalidade~~ → **igual para todos**
- [x] ~~Matriz de permissões~~ → Associados = acesso total; Instrutor faz atividades + presença/pontos + aprova cadastros

> 🎯 Planejamento ampliado: perfis por cargo, Tesoureiro, visão do conselheiro e mensalidades.

---

## 9. Progresso do desenvolvimento

### ✅ Etapa 1 — Base do projeto (CONCLUÍDA)
- Projeto criado com **React + Vite + Tailwind v4 + PWA**.
- Identidade do clube aplicada (cores azul/dourado, logo no topo, "1994").
- **6 telas** criadas e navegáveis: Login, Cadastro, Ranking, Atividades, Unidades, Mural.
- **Layout adaptável**: menu lateral no PC / inferior no celular, com **animações e interações** (framer-motion). App roda em `http://localhost:5173` (`npm run dev`).
- **Atividades**: liderança cria atividade com critérios (📷 foto / ✍️ texto / 📎 arquivo) e o desbravador entrega (demo em memória).
- **Ranking gamificado** (pódio, confete, contadores, cards) e **clicar na unidade** mostra os membros.
- **Avatares com foto** prontos e **carrossel** de fotos na entrada (login).
- ✅ Logo oficial aplicada em `public/logo.png`.
- ⚠️ Dados ainda são **de exemplo / em memória** (somem ao recarregar) até ligarmos o banco.

### ⏭️ Próxima etapa — Banco de dados, login e PERFIS (Supabase)
- Criar conta no Supabase e as tabelas (usuarios c/ papel+cargo, unidades, atividades, entregas, presencas, pontos, mensalidades, fotos).
- Ligar login/cadastro reais (com aprovação) e os **papéis/permissões** (desbravador, conselheiro, liderança).
- Com a base pronta, ligar as telas por perfil: **visão do conselheiro** (presença/pontos), **gestão de atividades** e **mensalidades**.
- Substituir os dados de exemplo pelos reais.


---

## 10. Evolução para plataforma SaaS multi-clube

> **Nome provisório da plataforma: DesbravaClube.** O nome poderá ser revisto antes do lançamento comercial.

O sistema atual **Filhos da Conquista** será preservado como o primeiro clube (tenant) da nova plataforma. A marca, logo, cores e demais elementos do Filhos da Conquista deixarão de representar o produto inteiro e passarão a ser configurações específicas desse clube.

### Diretrizes já definidas
- Um único produto e código para múltiplos clubes, com isolamento por tenant/clube.
- Nova identidade central **DesbravaClube**, mantendo identidade visual configurável por clube.
- Estruturar `clubs` e `club_memberships`; evitar vincular permanentemente um usuário a apenas um clube.
- Adicionar escopo de clube às entidades operacionais e reforçar o isolamento com RLS e constraints no PostgreSQL.
- Separar papéis da plataforma (owner/suporte/billing) dos papéis internos de cada clube.
- Auditar todas as funções `SECURITY DEFINER`, Storage, notificações, RPCs e permissões antes de liberar múltiplos clubes.
- Separar mensalidades dos membros da futura cobrança de assinatura do SaaS.
- Preparar personalização por clube: nome, logo, cores, configurações e recursos habilitados.
- Criar futuramente painel Master para clubes, planos, assinaturas, recursos, suporte, auditoria e métricas.
- Preservar React/Vite, Supabase/PostgreSQL, PWA, Capacitor e Vercel enquanto testes de carga e métricas não justificarem mudança de infraestrutura.
- Projetar para crescimento e validar progressivamente carga de 100, 500, 1.000 e 3.000+ usuários simultâneos.
- Tratar LGPD, consentimento, fotos de menores, retenção, exportação/exclusão e auditoria como requisitos de produto.

### Ordem de transformação
1. Auditoria completa e testes de regressão.
2. Criar fundação multi-tenant e migrar Filhos da Conquista como tenant inicial.
3. Criar um segundo clube de teste e validar isolamento integral de dados.
4. Tornar marca, logo, cores e configurações dependentes do clube.
5. Refatorar Storage, notificações, funções privilegiadas e autorizações para multi-tenant.
6. Criar painel Master e gestão de clubes/recursos.
7. Implementar planos, assinaturas e pagamentos.
8. Executar testes de carga e ajustar infraestrutura com base em métricas reais.


## 11. Auditoria consolidada — preparação para DesbravaClube

### Bloqueadores antes do segundo clube
- Tenantizar o banco com `clubs` + `club_memberships` e `club_id` nas entidades operacionais.
- Reescrever RLS e todas as RPCs `SECURITY DEFINER` para validar o clube atual; nenhuma função pode agregar/alterar dados globalmente por acidente.
- Tenantizar ranking, temporadas, unidades, pontos, atividades/entregas, missões, jogos/recordes, duelos, chefão, bichinho, leilão, chat, mural, agenda, mensalidades, responsáveis, conteúdo e configurações.
- Alterar `config_clube` de chave global para configuração por clube, com unicidade `(club_id, chave)`.
- Tenantizar notificações e Edge Function de push. Broadcast `todos` deve significar todos do clube da notificação, nunca todos da plataforma.
- Chat geral, chats de unidade e conversas diretas precisam validar membership no mesmo clube.
- Storage privado deve usar caminho com `club_id`; remover o fallback de comprovação sensível para bucket público.
- Revisar o bucket público `imagens`: logos podem ser públicos; fotos de perfil/mural de menores exigem política de privacidade definida antes da comercialização.
- Portal de responsáveis deve vincular pai e filho dentro do mesmo clube; aprovação de vínculo nunca pode selecionar criança de outro tenant.
- Separar papel global de plataforma de papel/membership no clube.

### Importantes antes da comercialização
- Transformar navegação em módulos/features e reduzir telas permanentes. Core: pessoas, unidades, presença, atividades, agenda e comunicação; financeiro, engajamento, gamificação e conteúdo como módulos.
- Criar `ClubContext` após autenticação, com seleção do clube atual, membership, papel e features.
- Remover fallbacks temporários de versões antigas de RPC/schema depois da migração.
- Remover fallback do ranking que baixa `pontos` e soma no cliente; agregações grandes ficam no PostgreSQL.
- Levar radar de faltas e leituras pesadas de leilão para consultas/RPCs agregadas.
- Migrar definitivamente o fluxo de banco para Supabase CLI + staging + migrations versionadas; não depender de SQL manual em produção.
- Criar testes automáticos de isolamento Tenant A x Tenant B, inclusive RPC, Storage, Chat, Push e vínculos de responsáveis.
- Criar auditoria de ações administrativas/suporte e fluxo seguro de impersonation temporária.
- Definir LGPD: consentimento/base legal, responsáveis, fotos de menores, retenção, exportação, exclusão, suspensão e reativação.
- Separar mensalidade membro→clube da futura assinatura clube→plataforma.

### Escala e desempenho
- Manter Vercel + Supabase enquanto métricas suportarem; não migrar para VPS por antecipação.
- Testar progressivamente 100, 500, 1.000 e 3.000+ usuários simultâneos.
- Medir RPS, latência p95/p99, CPU/IO do Postgres, queries lentas, Realtime, Storage, egress e taxa de erro.
- Para push em massa da plataforma, evoluir para outbox/fila + processamento em lotes quando volume justificar.
- Preservar transações/locks já usados em recursos concorrentes como Leilão e Bichinho.
- Manter compressão e thumbnails; evitar originais gigantes no Storage.

### Pontos positivos a preservar
- RLS já é parte central da segurança.
- Há funções com `SECURITY DEFINER` e `search_path` controlado, além de revogação/grants em várias rotas sensíveis.
- Upload valida assinatura real do arquivo e rejeita SVG/HTML; comprovações novas já usam bucket privado.
- Leilão usa bloqueios transacionais; Bichinho usa `FOR UPDATE`/advisory lock em pontos concorrentes.
- Edge Function de push possui segredo próprio, valida payload/link e remove subscriptions expiradas.
- Service Worker não cacheia respostas autenticadas do Supabase; cache antigo inseguro é apagado.
- CSP/HSTS/X-Frame-Options e outros headers de segurança já estão configurados.
- Serviços frontend foram separados por domínio e `dados.js` ficou como fachada de compatibilidade.
- Lazy loading, CI com lint+test+build e testes utilitários existentes são uma boa fundação.

### Branding a neutralizar
- Trocar gradualmente `Filhos da Conquista`/Conquista no manifest, HTML, push, workflow Android, README, assets e textos globais pela marca de plataforma.
- O tenant Filhos da Conquista mantém seu próprio nome, logo e cores.
- Alterar o package Android `app.filhosdaconquista` somente quando a marca/plano de publicação estiverem definidos.
- Nome provisório da plataforma continua **DesbravaClube** até nova decisão.

### Andamento (22/09/2026) — tudo local, nada em produção
- ✅ Fundação multi-tenant fechada e consolidada em `saas-refactor` (checkpoint `checkpoint/fundacao-multitenant-2026-09-21`): migrations 01–32, Tenant 001 × Tenant 002 nos testes, hardening final.
- ✅ Camada de produto multi-clube, 1ª etapa (migration 33 + front): `ClubContext`/`ClubeContext` (vínculos, clube em uso, papel NO clube, permissões, recursos, marca), telas sem `profiles.papel`/`unidade_id`,
  marca por clube, catálogo de recursos e feature flags, tela de identidade e recursos.
- ✅ Multi-clube REAL (migration 34, branch `saas-produto-multiclube`): banco aceita N vínculos por pessoa (1-clube-por-pessoa saiu); papel/unidade/status são do vínculo, não de `profiles`
  (`vinculo_gerir`); seleção de clube por requisição, sempre validada (`clube_atual_id()` lê o header `x-clube-atual`; duas abas do mesmo usuário operam em clubes diferentes ao mesmo tempo);
  11 recursos que só escondiam rota agora bloqueiam escrita nova (gatilho central, leitura/edição do que já existe continua liberada). Achado e corrigido nesta fase: autoridade de liderança
  usava o clube "mais relevante" do alvo em vez do clube em uso de quem chama — corrigido em `lideranca_gere_usuario`/`resetar_senha_membro`/`excluir_usuario`.
- ✅ Limpeza final da fase multi-clube (migration 35): jogos, chefão, leilão, ranking, recordes, temporada e as RPCs de pontuação
  param de ler o espelho em `profiles` — organization_memberships é a única fonte de papel/unidade/status em TODO código
  operacional, sem exceção (teste de contrato reprova a volta). Achados extras corrigidos: `pontos`/gameplay tinham `club_id`
  adivinhado pelo "clube mais relevante" da pessoa (não pelo clube da requisição); a chave única de `recordes` e os limites
  diários de golpe do chefão/bônus de jogos eram por PESSOA, não por clube — um clube podia "gastar" o limite do outro. Testado
  com uma pessoa desbravador num clube e instrutor noutro, pontuando/jogando/premiando nos dois ao mesmo tempo.
- ✅ **Classes e Especialidades — motor curricular, fase 1 (migration 36, seção 12, etapas 1–3 da implementação)**: as 8
  tabelas do desenho (`curriculum_versions`→`classes`→`class_sections`→`class_requirements` como catálogo da plataforma;
  `member_classes`/`member_requirements`/`requirement_approvals`/base de `investiture_reviews` sempre por clube), as RPCs de
  matrícula/progresso/avaliação/investidura, e as telas **Minha Classe** e **Avaliar Classe** (recurso `classes`, desligado por
  padrão). Percentual sempre calculado no servidor; mudar o currículo cria versão nova sem tocar no histórico de quem já
  andou na antiga; avaliador nunca aprova progresso de um clube em que não está operando, mesmo tendo permissão lá.
  1 classe **piloto de dados de TESTE** (`[PILOTO/TESTE] Amigo`, 6 requisitos) — nenhum requisito oficial foi cadastrado
  (etapa 1 da implementação, "levantar fontes oficiais", segue pendente de propósito). Testado com Tenant 001/Tenant 002,
  pessoa em 2 clubes, avaliador com papéis diferentes em cada um e tentativa de aprovação cruzada.
- ✅ **Classes e Especialidades — motor curricular, fase 2 (migration 37, seção 12, etapa 4 da implementação)**: antes de
  cadastrar conteúdo oficial, auditei o modelo da fase 1 contra Classes Regulares/Avançadas/Agrupadas e Especialidades (relatório
  completo em AUDITORIA-MULTITENANT.md) — Especialidade não cabia no modelo de classe sem forçar (sem "seções", com categoria,
  às vezes em turma com instrutor responsável não-liderança) e não existia dependência estruturada entre currículo (ex.: um
  requisito de classe exigir uma especialidade concluída). Evoluí o modelo primeiro: `specialties`/`specialty_requirements`/
  `specialty_offerings`/`member_specialties`/`member_specialty_requirements` NOVOS, `curriculum_dependencies` (declarativa,
  validada no servidor — nunca texto interpretado no front), reusando `curriculum_versions` e `requirement_approvals`
  (virou polimórfico) em vez de duplicar. De quebra, achei e corrigi um gap real: o recurso `classes` só escondia a rota,
  não bloqueava a API — agora bloqueia escrita de verdade nas RPCs de Classes E Especialidades. Rastreabilidade de importação
  (hash/arquivo/data/quem) e uma ferramenta de diff entre versões (`comparar_versoes_curriculares`) preparam a entrada do
  catálogo oficial. 1 especialidade **piloto de dados de TESTE** (`[PILOTO/TESTE] Primeiros Socorros`), dependência de teste
  ligada a um requisito novo da classe piloto. Telas **Minhas Especialidades** e **Especialidades — avaliar/criar turma**
  (mesmo recurso `classes`). Testado: mesma pessoa fazendo a mesma especialidade em 2 clubes, instrutor em 2 clubes com
  avaliação cruzada bloqueada, turma com instrutor responsável não-liderança, dependência só satisfeita no MESMO clube,
  conclusão automática, histórico, mudança de versão com diff real, feature flag desligada por clube.
- ⏸️ **Classes e Especialidades — o que falta** (seção 12, etapas 1, 5–8): fonte oficial ainda não levantada/validada (etapa 1,
  de propósito); PDF/renderer do cartão final; assinatura digital formal; catálogo completo de classes/especialidades (só
  depois da fonte oficial); gestão de turma completa (atribuir participantes em lote, editar/encerrar — a RPC existe, falta a
  tela); avaliação por instrutor responsável não-liderança tem RPC pronta mas ainda sem tela própria; navegação por módulos e
  painel Master; leitura de tabela pra quem tem 2+ clubes ainda não é escopada por "clube em uso" (por desenho, mesmo limite
  documentado desde a migration 34); nível de investidura regional/associação pra classes avançadas (pergunta em aberto, sem
  fonte oficial que confirme se é necessário).
- ✅ **Auditoria curricular oficial — etapa 1 (fontes DSA), sem importar nada**: `supabase/AUDITORIA-CURRICULO-OFICIAL.md`.
  Confirmou (com fonte oficial, cruzando cartão-base + OMD + vigência) o livro atual das 6 classes regulares — inclusive
  os 4 trocados pela OMD 021/2024, com vigência plena só a partir de **2026**; esclareceu oficialmente que Classes Agrupadas
  NÃO são currículo próprio; mapeou a fonte/metodologia de versão das Especialidades (Manual comprado + OMDs pontuais); e o
  fluxo de aprovação hierárquica das Classes de Liderança (Clube → Regional/Campo → SGC), que exige hierarquia acima do
  clube que o modelo ainda não tem. Achou 4 lacunas reais de schema (requisito anual/dinâmico, escolha N-de-M com exclusão
  de repetição, prazo de conclusão, aprovação hierárquica) — **documentadas, nada alterado**. 9 pontos ficaram
  PENDENTE_DE_VALIDACAO (inclusive uma possível OMD 022/2026 não confirmada). Aguardando aprovação antes de importar
  qualquer conteúdo oficial de verdade.
- ✅ **Fase 2.5 — Consolidação Curricular**: `supabase/curriculo-manifesto/` — as 6 Classes Regulares (+ as 6 avançadas
  pareadas) viraram manifesto JSON versionado e validável por máquina (212 requisitos), com `publicado_em` ≠
  `vigente_desde` explícito em cada classe, proveniência (fonte + OMD) em todo item, e as 4 lacunas de schema marcadas
  via `lacuna_schema` (ainda NÃO no banco). Validador (`npm run curriculo:validar`) + autoteste com fixtures sintéticas
  (`npm run curriculo:autoteste`, 14 casos) provando que rejeita fonte ausente, ID duplicado, dependência inexistente,
  vigência copiada do carimbo da página, e item pendente apresentado como confirmado (inclusive a OMD 022/2026, travada
  no registro). Relendo as páginas oficiais texto bruto, resolveu 2 dos 9 PENDENTE_DE_VALIDACAO da etapa 1 (Guia
  avançada, Companheiro avançada item 11) — os outros 7 continuam pendentes, nenhum resolvido por inferência. Nenhum
  requisito das 6 Classes Regulares ficou PENDENTE_DE_VALIDACAO (o único pendente do manifesto é da classe AVANÇADA
  Pesquisador de Campo e Bosque) — nada impede a publicação das 6 Regulares por falta de fonte; falta só evoluir o
  schema pras 4 lacunas antes de importar de verdade. Ainda NADA foi importado para `curriculum_versions`.
- ✅ **Fase 2.6 — Motor de Regras Curriculares (migration 38)**: as 4 lacunas ganharam representação DECLARATIVA e
  versionada no banco, sem coluna específica por regra: (1) conteúdo anual/dinâmico = catálogo temporal próprio
  (`dynamic_content_definitions`/`dynamic_content_values`, vigência sem sobreposição, `conteudo_dinamico_resolver(chave, data)`)
  — 2026 e 2027 resolvem sem duplicar a Classe; (2) escolha N-de-M = `requirement_option_groups(n_minimo)` +
  `requirement_options`, o servidor conta (`opcoes_satisfeitas_automaticamente`); (3) não repetir especialidade = primeiro
  o **histórico curricular PORTÁTIL** da pessoa (`curriculum_achievements`: identidade global + proveniência — clube emissor
  imutável, versão, data, link ao registro operacional/avaliador; revogação SÓ pelo emissor, sempre soft, com autoria) —
  `dependencias_pendentes/satisfeitas` passaram a consultar ele (evolução INTENCIONAL da migration 37, que era "só no
  mesmo clube"): a conclusão reconhecida em A satisfaz regra curricular em B sem transferir pontos/presença/mensalidade/
  mensagens/arquivos (provado); (4) prazo = `prazo_minimo_dias`/`prazo_maximo_dias` em `classes`/`specialties` +
  `prazo_situacao()`; o gatilho de conclusão respeita o mínimo, o máximo é informativo; NULL nas 6 Regulares (a fonte não
  determina). Motor de explicação: `explicar_requisito_classe/especialidade` → `{resultado: satisfeito|pendente|bloqueado,
  regras_aplicadas: [{regra, satisfeito, origem, detalhe}]}`. Validador do manifesto ganhou `REPRESENTACAO_DAS_LACUNAS` e
  rejeita `lacuna_schema` sem representação (autoteste: 16 casos). Testes: `35_motor_de_regras_curriculares.sql` (133
  asserts, os 10 cenários pedidos) + 34 atualizado (46) + matriz 20 (5 exceções novas). As 6 Classes continuam NÃO
  importadas; PDF/cartão/assinatura/Liderança/catálogo de Especialidades seguem fora.
- ✅ **Fase 3 — Importação oficial das 6 Classes Regulares 2026 (migrations 39/40)**: catálogo publicado a partir
  EXCLUSIVAMENTE do manifesto — `gerar-importacao.mjs` valida o manifesto, monta o pacote canônico (só `classe_regular`
  das 6; avançadas fora), calcula o sha256 e GERA a migration 40 (`curriculo_importar_classes_regulares(pacote, hash)`) e
  a fixture de teste; `npm run curriculo:importacao:check` falha se o manifesto mudar sem regerar. Importador determinístico
  (ids = md5 de `versão:item`), idempotente (mesmo hash = no-op; mesma versão com outro conteúdo = RECUSADO) e sem
  aproximação (chave/tipo/status/OMD/escolha fora do schema = falha). `curriculum_version` `classes-regulares-dsa 2026.1`
  (origem oficial, vigente desde 2026-01-01, `fonte_hash`, `fonte_detalhes` com OMDs, documentos-base e sha256 de cada
  arquivo). Anual/dinâmico → slot `curso_leitura_<classe>` (nada de "2026" no requisito; o valor do ano entra depois, com
  fonte — hoje NENHUM cadastrado); N-de-M e sem_repeticao → `requirement_option_groups`/`requirement_options` (+ `pool_sem_repeticao`).
  Proveniência por requisito (`manifesto_id`, `status_fonte`, OMDs, observação) + RPC `requisito_origem()` e "Origem do
  requisito" na tela. Piloto preservado e invisível no fluxo normal quando há oficial. Elegibilidade SÓ por `idade_minima`
  (o que a fonte declara; sem nascimento não bloqueia); nenhuma sequência inventada. Minha Classe consome o oficial
  (escolha/dinâmico/origem do banco). Testes: 36 (integridade permanente manifesto→banco, 40 asserts, inclusive
  auto-adulteração detectada), 37 (12 cenários, 65), Vitest MinhaClasse (5); upgrade legado agora confere catálogo sem
  progresso. Não avançou pra PDF/cartão, assinatura, Liderança nem catálogo de Especialidades.
- ✅ **Fase 3.1 — Validação visual e funcional das 6 Classes (migration 41)**: revisão requisito a requisito no navegador
  (Supabase local, 375×812) e matriz automatizada manifesto → API (`38_matriz_manifesto_api.sql`, 18) → UI
  (`MinhaClasse.matriz.test.jsx`, 7): 149 requisitos, nenhum sumido/duplicado/fora de ordem/texto diferente. Motor:
  regra curricular passa a BLOQUEAR de verdade — `member_requirement_options` (a escolha N-de-M registrada,
  `requisito_escolher`), `_requisito_bloqueios()` (dependência, conteúdo dinâmico sem valor, N-de-M sem escolhas válidas,
  sem_repeticao violada) e `requisito_enviar`/`requisito_avaliar(aprovado)` recusando com a mesma lista que a tela mostra.
  Minha Classe representa os 9 estados (ícone + texto, h2→h5, `progressbar`, labels, botão desabilitado com
  `aria-describedby` do motivo, alvos ≥ 44px); OMD/hash/ids só na "Origem do requisito"; fila da liderança mostra a escolha
  e desabilita Aprovar com o motivo. Divergências corrigidas: data-sem-hora exibida como "31/12/2017" (fuso), checkbox sem
  nome acessível, aviso dinâmico duplicado. Registrado (sem alterar o manifesto): Amigo IX.1 como opção única entre
  parênteses vs. Companheiro IX.1 sem lista. Uma Classe (Amigo) testada do início ao fim com dado sintético pro que ainda
  não tem conteúdo oficial (Curso de Leitura 2026 continua NÃO cadastrado). Gates: 39 testes SQL, upgrade 116, e2e, edge,
  Vitest 285, ESLint, build, validar/autoteste/importação:check.
- ✅ **Fase 3.1b — Amigo IX.1 + Curso de Leitura 2026 (migrations 42/43)**: Amigo IX.1 conferido na página oficial =
  "Completar uma especialidade na área de Artes e habilidades manuais." (categoria aberta, sem lista) — a 2026.1 tinha uma
  opção artificial entre parênteses; `amigo.VII.1` e) é "Aves de estimação". Correção como **manifesto 2026.2**
  (`revisoes[]` com fonte/motivo), importador aceitando escolha aberta sem `opcoes` e **arquivando** a versão publicada
  anterior ao importar a nova; migration 43 gerada publica a 2026.2, a 2026.1 fica arquivada e intacta (teste 36). Curso
  de Leitura 2026: nenhuma fonte primária DSA encontrada (página oficial parada em 2011, downloads sem nada, busca interna
  vazia); só a CPB (loja, não normativa) lista "Servo de Deus e Amigo de Todos" pra Desbravadores 10–15 → **não
  cadastrado**, requisito segue bloqueado; os 6 slots por classe já cobrem o modelo "um livro por público" sem mudança.
  Matriz manifesto → banco → API → UI re-executada (36: 43, 38: 18, UI: 7, 37: 81 — dinâmico resolve 2026 e não reaproveita
  em 2027).
- ✅ **Fase 4 — Snapshot curricular e fluxo de conclusão/investidura (migration 44)**: estados formais
  `em_andamento → requisitos_concluidos → aguardando_revisao → apto_investidura → investida` (100% aprovado ≠ investido);
  ao selar a conclusão (reconferindo TODA regra) nasce um **snapshot imutável** (`class_completion_snapshots`: pessoa, clube,
  classe, versão + hash do manifesto, seções/requisitos exatos, escolhas, dinâmico resolvido com período/fonte, dependências
  e conquistas usadas, aprovações/avaliadores/datas, percentual; sem copiar evidências) com hash canônico, gatilho que recusa
  UPDATE/DELETE pra qualquer papel, reproduzível sem o catálogo; eventos imutáveis (`class_completion_events`); revisão final
  (`revisao_final_decidir`: aprovar ou pedir correção reabrindo requisitos); investidura como evento (`class_investitures`,
  `investidura_registrar` reconfere bloqueios, idempotente) que emite a conquista portátil com `snapshot_id`; correção
  posterior só por `snapshot_revogar` auditado em cascata (nada apagado). Tela `/investiduras` pra liderança; Minha Classe
  mostra a etapa. Achado corrigido: `requisito_avaliar` gravava a aprovação depois do status (última aprovação ficava fora
  do snapshot). Testes: 39 (62), 32/35/37 migrados, Vitest 297. Sem PDF/cartão ainda.
- ✅ **Fase 4.1 — Caderno Digital DesbravaClube + verificação pública (migration 45)**: snapshot selado → documento
  emitido (`class_documents`, idempotente — mesmo snapshot+tipo+template devolve o mesmo token/conferência) → PDF
  (HTML imprimível A4/mobile, `DocumentoClasse.jsx`, regenerável a partir da mesma emissão) → verificação pública
  (`documento_verificar`, anon, token de 100 bits não enumerável, só resumo mínimo + integridade + estado ao vivo).
  `document_templates` versionado (identidade própria — a página da DSA é só lista de requisitos, sem cartão/arte
  oficial pra copiar). Caderno de acompanhamento antes da investidura (nunca comprovante); documento final só após
  `investidura_registrar`. QR aponta só pra `/verificar/<token>`, nunca carrega dado curricular. Assinaturas
  reservadas, sem fingir validade (aviso explícito: "ainda não possui assinatura digital"); disclaimer fixo que
  não substitui registro oficial da Igreja/SGC. Achado da inspeção visual: o acompanhamento vazava a data de
  investidura quando o mesmo snapshot já tinha sido investido — corrigido (`documento_conteudo`/`documento_verificar`
  só expõem a chave no tipo `final`), com teste cobrindo o cenário exato. Testes: 40 (41), Vitest 11 (qr +
  VerificarDocumento + DocumentoClasse); dois documentos reais gerados do banco pra inspeção visual. Sem assinatura
  digital/ICP-Brasil.
- ✅ **Fase 4.2 — Hierarquia institucional + workflow declarativo de investidura (migration 46)**: pesquisa
  confirmou que a exigência de revisão distrital/regional/MDA (institucional.adventistas.org +
  orientacoes-cartao-classes-de-lideranca) é **só de Classes de Liderança**, ainda não importadas — o workflow ativo
  pra Classes Regulares continua com 2 etapas, ambas no clube, nada muda na prática. Hierarquia (`organizational_units`
  Clube→Distrito→Região→Campo, níveis opcionais) já existia desde a fundação; adicionado o vocabulário de papel fora
  do clube (`coordenador_distrital`/`coordenador_regional`/`coordenador_geral`/`diretor_mda`), validado por gatilho
  contra o tipo da unidade, e `unidade_ancestral()` pra subir a árvore. Workflow **declarativo e versionado**
  (`investiture_workflows`/`investiture_workflow_stages`: chave/ordem/escopo/papéis/obrigatória/pula-se-ausente) —
  nada de colunas `assinatura_diretor`/`assinatura_distrital`. Execução (`investiture_workflow_runs`+
  `workflow_stage_decisions`, IMUTÁVEL): o SERVIDOR resolve quem pode decidir (nunca o cliente declarando "sou
  distrital"), segrega funções (mesma pessoa não decide 2 etapas de escopo distinto na mesma investidura, salvo
  permissão explícita), pula etapas de nível ausente com registro auditável. Aprovação (`aprovacao_sistema`) ≠
  assinatura (schema pronto pra `assinatura_eletronica`/`certificado_digital`, nenhuma RPC aceita ainda).
  `revisao_final_decidir`/`investidura_registrar` da fase 4 preservados byte a byte (mesma assinatura, mesmos erros,
  mesmos efeitos) — agora autorizados pelo motor por baixo. Testes: 41 (62 asserts, workflow de teste de 4 etapas
  criado só na transação, nunca ativado de verdade) + inspeção visual do fluxo real completo. Sem tela pra atores
  fora do clube (não existe "unidade em uso" não-clube no front ainda); sem assinatura digital/ICP-Brasil.
- ✅ **Fase 4.3 — Portal institucional + verificação pública (migration 47)**: resolve a lacuna de front da 4.2.
  Escopo institucional ganha contexto PRÓPRIO (`escopo_atual_id()` pelo header `x-escopo-atual`, mesma mecânica de
  duas abas do clube, sem padrão — entrar no portal é explícito; pedir um clube como escopo é ignorado) e
  `meu_contexto_institucional()` ao lado do `meu_contexto()` (que segue só de clube — nada quebrou). Portal
  `/institucional` FORA do `ClubeGuard` (achado: o guard trancaria um coordenador distrital puro pra fora do app),
  enxuto: clubes descendentes com **contagens** (`escopo_painel()` desce por `parent_id`) e o que exige a decisão
  daquela autoridade (`escopo_investiduras_pendentes()`) — que pras Classes Regulares é SEMPRE vazio, e o portal diz
  isso em vez de inventar aprovação distrital. **Hierarquia não é acesso**: nenhuma policy nova de RLS; tudo vem de
  RPC agregada; testado que o coordenador lê 0 linhas de profiles/member_*/fotos/chat/mensalidades/responsáveis/
  evidências/documentos dos clubes abaixo. Troca de JORNADA (não de conta) por um card em Gestão. QR e URL de
  verificação passam a existir só no documento FINAL — o Caderno de acompanhamento tinha QR desde a 4.1 e isso o
  fazia parecer comprovante. Red-team da rota pública (token inexistente/vizinho/1 char trocado/injeção/leitura
  direta) e asserção de que o resumo não vaza nascimento, e-mail, evidência, comentário, avaliações nem IDs.
  `document_signatures` criada como interface de dados VAZIA pra futura assinatura eletrônica (nenhuma RPC escreve).
  Testes: 42 (54 asserts), Vitest 317 (+8). Inspeção visual: público válido/acompanhamento/não encontrado/revogado,
  portal, documento final com QR e faixa de revogado, acompanhamento sem QR. Portal é só leitura (a tela pra a
  autoridade DECIDIR fica pra quando houver processo real que exija); sem assinatura eletrônica/ICP-Brasil.
- ✅ **Fase 5 — Fundação comercial SaaS (migration 48)**: o motor comercial ANTES de qualquer gateway.
  Cadeia modelada: conta/cliente (`billing_accounts` + contatos) → assinatura (`subscriptions`) → plano versionado
  (`billing_plans`/`billing_prices`, chave+versão) → recursos/limites → clubes cobertos (`subscription_clubs`) →
  cobrança (`billing_invoices`) → status comercial. **Assinatura não é vínculo**: inadimplência/cancelamento não
  apagam nem desligam ninguém (`billing_policies.nunca_apagar_dados` tem CHECK — não existe política que apague).
  **Três camadas distintas** (plano → clube → usuário) integradas POR DENTRO do entitlement que já existia:
  `recurso_habilitado_no_clube()` virou "plano E clube", então os 17 gatilhos `trg_exigir_recurso` da 34 passaram a
  respeitar o plano sem nenhum gate novo; `operacao_permitida()` diz QUAL camada barrou e a tela usa isso (achado:
  antes o app dizia "o clube não usa" quando quem barrava era o plano). Downgrade abaixo do uso é permitido com
  confirmação explícita e **não apaga nada** — o que para é o crescimento. Preço NUNCA no React: catálogo lido do
  banco, tudo marcado como `provisorio` (nada decidido comercialmente). **Admin da plataforma fora de
  `organization_memberships`**, sem nenhuma policy sobre dado de clube (lê 0 linhas de profiles/fotos/chat/
  mensalidades/responsáveis/entregas/eventos), sem auto-promoção, com auditoria imutável. **Suporte assistido**
  modelado (motivo + prazo + autorização do CLUBE + auditoria) mas **sem acesso**: assert estrutural de que nenhuma
  policy consulta `suporte_acesso_vigente`. **Nenhum gateway**: interface de provedor + `mock` local; webhook
  idempotente por `unique (provider, evento_externo_id)`. **Onboarding retomável e idempotente** (9 etapas, estado no
  servidor, ordem imposta, repetir etapa não cria 2º clube/assinatura) reaproveitando `provisionar_clube` e
  conferindo o resultado em `club_provisioning_status`. Achado corrigido de forma aditiva: cadastro público sem
  unidade caía no Tenant 001 — criado o tipo `fundador`, que nasce sem clube (membro/responsável byte a byte iguais).
  Testes: 43 (150 asserts), Vitest 332 (+15). Inspeção visual: onboarding completo no navegador com reload no meio
  (retomou na etapa certa; 1 clube, 1 conta, 1 assinatura no fim), página de planos com uso do plano, e o bloqueio
  por plano explicando a camada certa. **Pendências declaradas**: medição de `armazenamento_mb` por clube (exige o
  clube no caminho do Storage); valores comerciais definitivos; nenhum gateway real integrado.
- ✅ **Fase 6 — Motor de experiências no-code (migration 49)**: o clube monta
  `experiência → etapas → regras → participantes → evidências → validação → recompensa → período` sem
  tocar em código. UM modelo representa os 10 tipos iniciais (desafio individual, por unidade, campanha,
  sequência de missões, evento especial, quiz, tarefa com evidência, meta quantitativa, check-in) — sem
  tabela por modalidade; **temporada** é AGRUPADOR (`experience_seasons`, com início/fim), não mais um tipo.
  **Vocabulário FECHADO validado no servidor**: tipo desconhecido, chave a mais, valor fora de faixa e
  texto com HTML/`javascript:`/evento são recusados na escrita, e **nenhuma função do motor tem `execute`**
  (assert estrutural) — o que o clube configura é lido como dado, jamais executado. **Não é o motor
  curricular**: assert estrutural de que nenhuma função toca em member_requirements/requirement_approvals/
  member_classes/member_specialties/curriculum_achievements — experiência do clube não marca requisito
  oficial. **Publicado não se reescreve** (gatilhos em experiences e experience_stages); mudança
  incompatível vira versão nova, sem tocar no histórico. **Recompensa idempotente pelo BANCO**
  (`chave_idempotencia` UNIQUE) integrada ao ledger `pontos` que já existia; badge/item preparados, sem
  loja nova. **Evidência privada** no bucket `comprovacoes` que já existe (pasta do próprio usuário),
  sem atravessar clube nem unidade e sem reaproveitar `curriculum_achievements`. **Público declarativo**
  (todos/unidade/papel/membro) com `criterio` reservado e vazio por CHECK. **Três camadas da fase 5**:
  recurso `experiencias` nasce desligado e entra por versão NOVA de plano (`essencial v2`) — Tenant 001,
  sem assinatura, segue funcionando. Quiz não entrega a resposta certa a quem responde. Auditoria imutável
  + capacidade de denúncia. **Templates da plataforma são COPIADOS**: publicar a v2 do modelo não muda a
  instância já publicada pelo clube. Testes: 44 (114 asserts, com red-team do no-code), Vitest 351 (+19).
  Inspeção visual: 3 pilotos [TESTE] ponta a ponta no navegador (individual com regra de texto recusando
  resposta curta; unidade com foto no bucket privado, validação da liderança e 50 pontos pra unidade;
  temporada com quiz→conquista e meta quantitativa recusando 3 e concluindo com 12) — 4 conclusões,
  4 recompensas, nenhuma duplicada. **Parado antes de migrar os jogos atuais para o motor**.
  **Pendências declaradas**: editor de etapa existente (hoje só adiciona), upload de imagem de capa,
  check-in recorrente sem UI dedicada, e a migração dos jogos/missões atuais.
- ✅ **Fase 7 — Arquitetura de experiência mobile (migration 50, somente leitura)**: reorganização de
  navegação, não reimplementação. Começou pela auditoria (`AUDITORIA-UX.md`): 48 rotas catalogadas,
  16–17 itens de menu, 21 cards em Gestão, e o achado mais duro — a 360×800, **8 dos 17 itens do menu
  ficavam abaixo da dobra**, incluindo Minha Classe, Especialidades, Experiências e a própria Gestão;
  Gestão media 4,6 telas de rolagem; e DUAS jornadas que existem e funcionam eram **inalcançáveis pela
  UI** (o coordenador sem clube e o fundador caíam numa tela com um único botão "Sair" — o onboarding
  da fase 5 não tinha um link sequer no app). Depois: **5 destinos por papel** (membro: Início ·
  Jornada · Clube · Jogos · Eu; liderança troca Jogos por Gestão; responsável, coordenador e fundador
  ganham 2 cada), **Início contextual** com motor de prioridades DECLARATIVO no servidor
  (`meu_inicio()`, 10 regras com peso e texto humano — no máximo 3 ações à vista, resto em "ver mais",
  zero dashboard), Gestão em 4 grupos com **fila ÚNICA de avaliação** (`avaliacoes_pendentes()`), e a
  gaveta ☰ do celular removida por ser a "segunda porta" que a própria auditoria criticou. Design
  system em `src/ui` (Card, Botão, Campo, Vazio, Carregando com skeleton, Folha, Aviso, Selo,
  Progresso, Abas, Cabeçalho) + **contraste protegido**: a cor escolhida pelo clube passa por cálculo
  WCAG e o app decide o texto em cima dela. Erros deixam de mostrar o texto cru do servidor
  (`mensagemDeErro`). PWA passa a se chamar **DesbravaClube** (era o nome de um cliente) com ícone
  `maskable`. Medido a 360/390/430: 5 destinos de 52px, 0 itens fora da tela, sem scroll horizontal;
  Gestão de 4,6 → 1,6 telas; instrutor chega à fila de avaliação em **1 toque** (era 3 + varrer 21
  cards); coordenador e fundador em **1 toque** (era impossível). Testes: Vitest 373 (+22), nada de
  RLS/RPC de escrita/contrato tocado. **11 das 19 métricas bateram, 5 avançaram parcialmente, 2 não se
  moveram** — consequência do alcance aprovado (núcleo + telas de jornada): ~35 telas antigas seguem
  com `alert()`, texto ≤11px e a tabela de 12 colunas, todas listadas com caminho:linha na auditoria.
- ✅ **Fase 7.1 — Fechamento de UX legado, responsividade e acessibilidade**: zerou o backlog da
  seção 4.1 da auditoria. **74 `alert()`/`confirm()` nativos → 0** (só ficaram os 2 de
  `features/jogos`, fora do escopo), cada um trocado pelo componente da sua SEMÂNTICA: toast de
  sucesso/info que some sozinho, toast de erro que **não** some, mensagem inline para erro de campo e
  modal de confirmação com o rótulo da ação no botão — nunca "OK". **42 telas mostravam o texto cru
  do servidor → 0** (`mensagemDeErro(erro, contexto)` mantém o que falhou e troca o resto por o que
  fazer). **135 textos ≤11px subiram para 12px**, com 9 mantidos a 11px por classificação explícita
  (nota de rodapé, disclaimer, lema) — nenhum 9px ou 10px sobreviveu. **Mensalidades redesenhada**:
  a tabela de 12 colunas saiu do celular (uma linha por pessoa + fita dos 12 meses + detalhe numa
  folha); no PC continua tabela, agora com `scope`/`caption`. Design system ganhou `ToastProvider`,
  `ConfirmacaoProvider` e uma ponte imperativa (`avisar`) que evitou cirurgia em 20 componentes.
  Alvo de toque mínimo virou regra escopada de CSS para `pointer: coarse`. Varredura final em 25
  rotas × 360/390/430px: **0 overflow horizontal, 0 tabela larga, 0 controle sem nome acessível**.
  Testes: Vitest 383 (+10). **18 das 19 métricas fecharam**; a única aberta (M16, 2 botões a 40px em
  Atividades) tem justificativa concreta registrada — exige redesenho do card, fora do backlog.

### Ordem de execução recomendada após a auditoria
1. Criar branch `saas-refactor`, staging e baseline/testes.
2. Criar `clubs`, `club_memberships`, Tenant 001 e Tenant 002 de teste.
3. Introduzir `ClubContext` e tenantizar dados/RLS/RPCs por domínio, começando pelo core.
4. Tenantizar Storage, notificações/push, chat e responsáveis.
5. Executar suíte de isolamento cruzado e corrigir qualquer vazamento.
6. Reorganizar navegação em módulos/features e aplicar branding por tenant.
7. Criar painel master da plataforma, auditoria e suporte.
8. Só então criar planos, assinatura SaaS e gateway de pagamento.
9. Executar testes de carga e decidir infraestrutura com métricas.


## 12. Módulo Classes e Especialidades — caderno/cartão digital

### Objetivo
Criar um módulo curricular versionado que acompanhe Classes Regulares, Classes Avançadas, Classes Agrupadas quando aplicável e Especialidades. A experiência deve reproduzir a estrutura lógica do cartão/caderno oficial vigente, registrar evidências e aprovações requisito a requisito e, ao atingir 100%, gerar um dossiê/cartão de conclusão pronto para o fluxo final de validação/investidura.

### Regra fundamental: conteúdo versionado
- Nunca codificar requisitos diretamente nas telas.
- Criar catálogo curricular com versão, vigência, fonte oficial e status (rascunho/publicado/arquivado).
- Um desbravador iniciado numa versão mantém histórico daquela versão; alterações oficiais futuras não podem reescrever silenciosamente requisitos já cumpridos.
- Manter referência da fonte/OMD que alterou cada requisito.
- Atualizações oficiais devem entrar como nova versão curricular e passar por revisão antes de publicação.
- Não tratar material gerado pelo sistema como substituto de registro oficial/SGC sem confirmação/autorização da organização responsável.

### Estrutura proposta
- `curriculum_versions`: versão, tipo, vigência, fonte, hash/controle.
- `classes`: Amigo, Companheiro, Pesquisador, Pioneiro, Excursionista, Guia e avançadas/agrupadas.
- `class_sections`: seções e ordem exatamente conforme currículo.
- `class_requirements`: requisito, código, texto, tipo de comprovação, ordem, dependências e assinatura exigida.
- `specialties`, `specialty_requirements` e categorias.
- `member_classes`: matrícula do membro numa classe/versão.
- `member_requirements`: progresso, resposta, evidência, data, status e observação.
- `requirement_approvals`: quem avaliou, papel, data, decisão e assinatura.
- `member_specialties` e progresso de requisitos de especialidades.
- `investiture_reviews`: revisão final e aprovações exigidas.
- Todos os registros operacionais devem conter `club_id` e obedecer RLS multi-tenant.

### Fluxo do desbravador
1. Sistema identifica/sugere a classe adequada conforme idade e regras vigentes; liderança confirma a matrícula.
2. Tela “Minha Classe” mostra o cartão/caderno digital por seções, requisitos e percentual.
3. Cada requisito pode aceitar, conforme configuração: confirmação presencial, texto, questionário, foto, arquivo, atividade vinculada, presença, especialidade concluída ou avaliação manual.
4. Instrutor/conselheiro/diretoria avalia somente requisitos para os quais possui permissão.
5. Requisitos que dependem de especialidade são concluídos automaticamente quando a especialidade correspondente for validada.
6. O progresso deve mostrar pendências reais, sem permitir 100% apenas por manipulação do frontend.
7. Ao concluir todos os requisitos, o registro entra em revisão final.
8. Após as validações exigidas, fica “Apto para investidura”.

### Caderno/cartão digital e PDF final
- Criar renderer separado dos dados para permitir saída web e PDF.
- O PDF deve seguir a ordem, seções, campos e paginação do modelo oficial aplicável, desde que haja autorização para reproduzir o layout/material.
- Preencher automaticamente nome, clube, unidade, datas, requisitos concluídos, instrutores/avaliadores e demais campos disponíveis.
- Incluir página/área de auditoria com ID verificável/QR Code sem alterar indevidamente o documento oficial.
- Se assinatura externa ainda for obrigatória, gerar o documento pronto para assinatura do Diretor/Regional/Distrital conforme a regra vigente.
- Guardar snapshot imutável da versão emitida para que mudanças posteriores no currículo não alterem um caderno já concluído.

### Assinaturas
Implementar dois níveis distintos:
- **Aprovação eletrônica interna:** usuário autenticado confirma requisito com identidade, data/hora, papel, clube e trilha de auditoria.
- **Assinatura eletrônica/digital formal:** módulo opcional para assinatura final, com hash do documento, signatário, data/hora, motivo e verificação. Integração com provedor de assinatura pode ser adicionada depois.
- Não confundir desenho de assinatura na tela com assinatura digital criptográfica.
- Antes de usar assinatura digital como substituta da assinatura física exigida para investidura, validar a aceitação do Campo/Associação/Missão responsável.

### Especialidades
- Catálogo oficial versionado e pesquisável por área.
- Requisitos estruturados individualmente, não apenas PDF/texto único.
- Instrutor responsável, turma, período, participantes e evidências.
- Aprovação requisito a requisito ou em lote somente quando a regra permitir.
- Histórico permanente de especialidades concluídas.
- Relação automática entre especialidades obrigatórias/opcionais e requisitos das classes.
- Dashboard da liderança mostrando quem precisa de qual especialidade para concluir a classe.

### Gestão pedagógica
Criar visão “Classes” para liderança com:
- progresso por membro, unidade, classe e seção;
- requisitos atrasados;
- requisitos aguardando aprovação;
- especialidades necessárias;
- membros próximos de 100%;
- inconsistências/documentos faltantes;
- fila “Prontos para revisão/investidura”.

### Segurança e auditoria
- Evidências de menores ficam privadas por padrão.
- Signed URLs para fotos/arquivos privados.
- Toda alteração de conclusão/aprovação registra antes/depois, ator e timestamp.
- Conclusões assinadas não podem ser editadas silenciosamente; correção exige evento de retificação.
- RLS impede liderança do Clube A de consultar/assinar requisitos do Clube B.
- PDF final deve possuir hash/snapshot e mecanismo de verificação.
- Definir política de retenção de evidências e documentos conforme LGPD.

### Integração com módulos existentes
- Presença pode satisfazer requisitos configurados que dependam de frequência.
- Agenda pode vincular eventos/campamentos a requisitos.
- Atividades podem ser associadas a requisitos de classe.
- Bíblia/Devocional pode fornecer evidência quando curricularmente aplicável.
- Mural não deve ser usado como armazenamento de evidência privada.
- Gamificação pode conceder conquistas por progresso, mas pontos nunca substituem aprovação curricular.
- Notificações avisam requisito aprovado/reprovado, pendência e proximidade da conclusão.
- Portal dos Pais pode mostrar progresso do filho sem expor evidências sensíveis desnecessárias.

### Etapas de implementação
1. ⏸️ Levantar e validar fontes oficiais vigentes e permissões de reprodução — **ainda pendente, de propósito**.
2. ✅ Modelar currículo versionado e importar **uma única classe piloto** (migration 36) — mas com dados de **TESTE**
   (`origem = 'piloto_teste'`), não a fonte oficial da etapa 1; substituir antes de qualquer uso real.
3. ✅ Implementar progresso + evidências + aprovação + auditoria (migration 36 + telas Minha Classe/Avaliar Classe).
4. ✅ Implementar especialidades e dependências (migration 37) — `specialties`/`specialty_requirements`/`specialty_offerings`/
   `member_specialties`/`member_specialty_requirements` + `curriculum_dependencies` (declarativa, validada no servidor) + 1
   especialidade **piloto de TESTE** (`[PILOTO/TESTE] Primeiros Socorros`) com uma dependência de teste ligada à classe piloto.
   4b. ✅ Motor de regras curriculares (migration 38, fase 2.6): conteúdo anual/dinâmico, escolha N-de-M, histórico curricular
   portátil (`curriculum_achievements`) e prazo — as 4 lacunas do manifesto representadas sem achatar; motor de explicação.
5. ⏸️ Criar PDF/renderer e comparar visualmente com o modelo autorizado.
6. ⏸️ Implementar revisão final/assinaturas (a base de `investiture_reviews` e a confirmação já existem pra classes; falta
   PDF/assinatura formal — especialidade não tem equivalente a investidura, é reconhecida/entregue).
7. ✅ Testar uma classe completa com Tenant 001 (e Tenant 002, com isolamento cruzado) e uma especialidade completa nos dois,
   incluindo turma com instrutor responsável não-liderança e dependência de classe→especialidade.
8. 🔶 Importar as demais classes/especialidades: ✅ as 6 Classes Regulares 2026 (fase 3, migration 40, gerada do manifesto);
   ⏸️ Classes Avançadas (bloqueadas pelo PENDENTE_DE_VALIDACAO de Pesquisador de Campo e Bosque), Liderança, catálogo de
   Especialidades e o valor anual do Curso de Leitura (dado com fonte, não migration).


## 13. Arquitetura institucional e expansão hierárquica

### Princípio
Preparar a plataforma para refletir a estrutura administrativa dos Desbravadores sem codificar a hierarquia em colunas fixas. Usar uma árvore organizacional genérica e memberships com papel, escopo, vigência e permissões. O objetivo é suportar Clube, Distrito, Região, Campo (Associação/Missão), União e Divisão, além de funções especiais autorizadas, sem conceder acesso excessivo por cargo.

### Estrutura organizacional
- `organizations`: organização raiz/entidade administrativa.
- `organizational_units`: nós hierárquicos com `type`, `parent_id`, nome, código oficial, país/timezone, status e metadados.
- Tipos inicialmente suportados: divisão, união, campo, região, distrito, igreja e clube; permitir extensão sem migration estrutural.
- `organization_memberships`: usuário + unidade organizacional + papel + período + status.
- `role_definitions`, `permissions`, `role_permissions`: RBAC configurável.
- `scope_grants`: define alcance de leitura/gestão (somente nó atual, descendentes específicos, indicadores agregados etc.).
- Histórico de nomeações/mandatos; nunca sobrescrever silenciosamente quem ocupava determinado cargo.
- Possibilidade de uma pessoa possuir múltiplos papéis simultâneos em escopos diferentes.

### Perfis/portais previstos
- Clube: diretor, associados, secretário, tesoureiro, capelão, instrutores, conselheiros e demais funções internas.
- Distrito/Região: distrital, regional/coordenador e equipes autorizadas.
- Igreja/distrito pastoral: pastor com painel de acompanhamento e permissões explicitamente definidas.
- Campo: departamental, associado quando aplicável, secretaria MDA e Coordenador do SGC/suporte autorizado.
- União/Divisão: perfis institucionais futuros, inicialmente preparados no modelo, não necessariamente implementados na v1.
- Plataforma: owner, suporte, billing e auditoria, totalmente separados dos cargos eclesiásticos/ministeriais.

### Regra de acesso
Cargo não equivale a acesso irrestrito. Toda autorização deve responder: quem é o usuário, qual papel possui, em qual unidade organizacional, durante qual vigência, qual permissão e qual escopo. Perfis superiores podem receber indicadores agregados sem acesso automático a conversas, documentos, finanças individuais, dados médicos ou evidências privadas de menores.

### Módulos importantes para expansão
- Classes e Especialidades versionadas, histórico curricular e investiduras.
- Avaliação/visitas de clubes com formulários versionados e plano de ação.
- Eventos e Camporis: inscrições, vagas, pagamentos, documentos, delegações, transporte, alojamento e check-in.
- Relatórios oficiais/configuráveis por Campo, Região, Distrito e Clube.
- Secretaria/cadastro: membros, funções, unidades, histórico e movimentações.
- Transferência de membro entre clubes preservando currículo/conquistas institucionais e protegendo dados internos do clube de origem.
- Patrimônio e empréstimo de bens.
- Tesouraria do clube e relatórios, separada do billing SaaS.
- Seguro anual: preparar modelo/relatórios/integração, sem afirmar integração oficial enquanto não houver API/autorização.
- Documentos, autorizações e validade documental.
- Formação/capacitação de líderes e certificados verificáveis.
- Agenda hierárquica: eventos de Clube, Distrito, Região, Campo, União/Divisão com herança controlada.
- Comunicados hierárquicos: um nível superior pode publicar para escopos autorizados, com segmentação e auditoria.
- Central de relatórios/indicadores.
- Histórico institucional do clube: diretorias, unidades, avaliações, investiduras, eventos e marcos.
- Diretório institucional de clubes e contatos públicos configuráveis.
- Suporte/tickets escaláveis Clube → coordenação autorizada → plataforma.

### Avaliação e visitas
- `evaluation_templates` e versões, permitindo modelos oficiais ou específicos de Campo quando autorizados.
- Visita agendada, checklist, evidências, observações, responsáveis e plano de ação.
- Assinatura/aprovação das partes quando aplicável.
- Histórico longitudinal do clube.
- Indicadores servem para acompanhamento; evitar exposição pública automática de avaliações internas.

### Passaporte curricular
- Classes, especialidades, investiduras e certificados pertencem ao histórico do membro e podem acompanhar transferência quando institucionalmente válido.
- Dados operacionais/sensíveis do clube de origem não acompanham automaticamente a pessoa.
- Toda transferência deve registrar origem, destino, autorizações, data e quais registros foram portados.

### Integração oficial e interoperabilidade
- Tratar SGC/Encontre um Clube como sistemas oficiais externos; não tentar substituí-los por alegação ou sincronização não autorizada.
- Criar camada futura de adapters/import/export para SGC ou outros sistemas somente quando houver API, formato autorizado ou parceria.
- Guardar códigos oficiais externos separadamente dos IDs internos.
- Produzir exportações que reduzam retrabalho, mas sinalizar claramente o que ainda precisa ser registrado/validado no sistema oficial.

### Privacidade por camadas
Classificar dados em: público institucional, interno do clube, liderança, financeiro, curricular, evidência privada, dados de responsável/menor e dados altamente restritos. Acesso de níveis superiores deve ser mínimo e explicitamente concedido; hierarquia organizacional por si só não libera dados sensíveis.

### Internacionalização e expansão
Como a DSA cobre múltiplos países, preparar desde a fundação: idioma por usuário/clube, timezone por unidade organizacional, formatos de data/telefone/documento configuráveis, moeda no financeiro e textos curriculares por versão/idioma. Não codificar regras brasileiras como universais.
