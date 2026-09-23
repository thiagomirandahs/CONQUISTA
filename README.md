# 🧭 DesbravaClube

Plataforma (PWA + app Android) para clubes de desbravadores: classes, especialidades, atividades,
pontuação, ranking, mensalidades e o dia a dia das unidades.

É **multi-clube**: cada clube tem a própria identidade (nome, sigla, cores, logo), o próprio plano
e os próprios dados. Uma pessoa pode ter vínculo em mais de um clube, e o clube em uso é escolhido
por aba — nada de um clube enxergar o outro.

O clube **Filhos da Conquista** (fundado em 1994) é o primeiro cliente da plataforma, preservado
como Tenant 001 — a marca dele vive no banco, como a de qualquer outro clube, e não no código.

🔗 **No ar:** https://conquista-ashy.vercel.app

---

## ✨ Funcionalidades

- 🔐 **Login e cadastro** com aprovação da diretoria
- 👥 **Perfis e permissões por cargo** — Desbravador, Conselheiro, Instrutor, Tesoureiro, Diretoria, Pais
- 🏆 **Ranking gamificado** (individual e por unidade) com pódio, contadores, animações e confete
- 📋 **Atividades** — a liderança cria, o desbravador entrega, a liderança aprova → vira pontos
- ✍️ **Apontamentos** — o conselheiro lança pontos da reunião (presença, uniforme, Bíblia, igreja…)
- 🏠 **Unidades** com emblema (imagem), lista de membros e média de pontos
- 📸 **Mural de fotos** por categorias — entrar no álbum e adicionar fotos
- 📱 **PWA** — instalável no celular, responsivo (mobile e desktop)

## 🛠️ Tecnologias

| Camada | Stack |
|---|---|
| Front-end | React + Vite · Tailwind CSS · Framer Motion · React Router |
| Back-end | Supabase (PostgreSQL · Auth · Storage) com Row Level Security |
| Hospedagem | Vercel (deploy automático a cada push) |

## 🚀 Rodar localmente

```bash
npm install
# Crie um arquivo .env com as chaves do seu projeto Supabase (veja .env.example)
npm run dev
```

## 🗄️ Banco de dados

O esquema completo — tabelas, funções e **políticas de segurança (RLS)** — está em
[`supabase/schema.sql`](supabase/schema.sql). Para aplicar num projeto Supabase, cole o conteúdo
no **SQL Editor** e execute.

## 🔒 Segurança

- Acesso controlado por **Row Level Security** direto no banco (não apenas no front-end).
- Usuários **não podem alterar o próprio papel/status** (proteção contra escalonamento de privilégio).
- Chaves sensíveis ficam **somente no `.env`** (nunca no repositório).

## 📁 Estrutura

```
src/
  components/   Layout, Avatar, Logo, Contador…
  context/      Autenticação (sessão + perfil)
  lib/          Cliente Supabase, carregamento de dados, helpers
  pages/        Login, Cadastro, Ranking, Atividades, Unidades,
                Mural, Aprovações, Apontamentos
supabase/       schema.sql (banco + segurança)
public/         logo e ícones do PWA
```

---

Nasceu para o clube **Filhos da Conquista** e virou produto para todos os clubes. 💙💛
