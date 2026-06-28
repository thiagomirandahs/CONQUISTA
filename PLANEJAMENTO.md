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
