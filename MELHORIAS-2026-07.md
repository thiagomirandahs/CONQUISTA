# 🛠️ Melhorias — Filhos da Conquista (julho/2026)

Resumo do que foi feito no app, pra consulta da diretoria. Tudo já está publicado
(a Vercel republica sozinha a cada envio). Os arquivos `.sql` foram rodados no
painel do Supabase.

---

## 🔎 A varredura
Uma auditoria completa leu o app inteiro (código + banco) e encontrou **68 pontos**
de melhoria, cada um confirmado por um segundo revisor (0 alarme falso). Foram
organizados em 3 blocos — **todos corrigidos**.

---

## 🔴 Bloco 1 — Urgentes (falhas silenciosas / risco)
- **Ranking à prova do limite de 1000 linhas** — soma no banco, não "some" pontos com o tempo.
- **Fotos comprimidas no envio** — não estoura o plano grátis do Supabase.
- **Apontamentos numa transação** — nunca mais perde ponto pela metade.
- **Aprovar entrega atômico** — sem pontos em dobro (toque duplo) nem "aprovada sem pontos".
- **Storage seguro** — cada um só troca a própria foto.
- **Excluir usuário** — sem travar e sem apagar histórico de mensalidades.

## 🟠 Bloco 2 — Importantes (bugs / experiência)
- **Fuso horário** — prazos deixam de encerrar 3h cedo.
- **Nome vazio** não derruba mais o ranking.
- **"Quem ainda não entregou"** aparece no card da atividade.
- **Extrato de pontos** no Perfil (de onde veio cada ponto).
- **Enviar aviso geral** (Gestão → 📣) — cai no sino do clube.
- **Notificação pessoal** — a criança é avisada quando a entrega/missão é aprovada ou reprovada, e quando o cadastro é liberado.
- **Entrega reprovada com motivo** + poder **reenviar**.
- **Editar atividade** (✏️), não só excluir.
- **Cadastro seguro** — ninguém vira diretoria pelo cadastro; a liderança promove.

## 🟡 Bloco 3 — Depois (robustez)
- **Aviso de "sem internet"** — não mostra mais "vazio" quando está offline.
- **Mensalidades: aba "Ano inteiro"** (quem pagou cada mês) + confirmação ao desmarcar.
- **Sino com histórico** (últimas 30) e atualiza sozinho.
- **Paginação** no Mural e nas Entregas.
- **Índices** no banco (telas rápidas com o tempo).
- **Teto anti-abuso** nos pontos do conselheiro (via API).
- **Filtro de entregas por atividade** (não vira lista infinita).

---

## 🗄️ SQLs rodados no painel (Supabase → SQL Editor)
1. `supabase/2026-06-30-devocional-popup.sql`
2. `supabase/2026-07-06-varredura-urgentes.sql`
3. `supabase/2026-07-06-importantes.sql`
4. `supabase/2026-07-06-depois.sql`

> São idempotentes (pode rodar de novo sem problema).

---

## 📲 Push no celular (aviso na tela)
Configurado no painel (chaves VAPID, função `enviar-push`, webhook em `notificacoes`,
variável na Vercel). Guia completo em `PUSH-SETUP.md`.

**Cada pessoa ativa uma vez** no próprio aparelho: **🔔 → 📲 Ativar avisos no celular**.
No **iPhone** só funciona com o app instalado na tela inicial (Compartilhar → Adicionar
à Tela de Início); no **Android** funciona direto no Chrome.

---

## 💡 Ainda dá pra fazer (não são consertos — quando quiser)
- Ícones do app (deixa o ícone instalado mais bonito, ajuda no iPhone).
- Trocar as janelas de "tem certeza?" do sistema por telas do próprio app.
- Espaço pros **pais** acompanharem o filho.
- **"Temporada"** pra zerar o ranking a cada ano.
- Reset de senha por **e-mail** (hoje a liderança reseta em Usuários).

---

*Atualizado em 07/07/2026.*
