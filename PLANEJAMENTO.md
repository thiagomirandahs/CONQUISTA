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
5. ⏸️ Criar PDF/renderer e comparar visualmente com o modelo autorizado.
6. ⏸️ Implementar revisão final/assinaturas (a base de `investiture_reviews` e a confirmação já existem pra classes; falta
   PDF/assinatura formal — especialidade não tem equivalente a investidura, é reconhecida/entregue).
7. ✅ Testar uma classe completa com Tenant 001 (e Tenant 002, com isolamento cruzado) e uma especialidade completa nos dois,
   incluindo turma com instrutor responsável não-liderança e dependência de classe→especialidade.
8. ⏸️ Importar as demais classes/especialidades após validação do piloto (e da fonte oficial da etapa 1).


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
