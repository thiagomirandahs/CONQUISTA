# 🏕️ Filhos da Conquista

Aplicativo (PWA) do clube de desbravadores **Filhos da Conquista** (fundado em 1994) para
acompanhamento de atividades, pontuação, ranking e gestão das unidades.

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

Feito com 💙💛 para o clube **Filhos da Conquista**.
