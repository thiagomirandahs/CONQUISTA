# 🔄 Migração / Mudança de servidor

Todo o banco está definido em **[`schema.sql`](schema.sql)** — um único arquivo que recria
**tudo**: tabelas, funções, segurança (RLS), storage e permissões. Use-o para mover o
projeto para um novo Supabase (por exemplo, um plano pago/maior).

## Passos para migrar para um novo projeto Supabase

1. **Crie** um novo projeto em https://supabase.com
2. **Banco:** SQL Editor → New query → cole TODO o conteúdo de [`schema.sql`](schema.sql) → **Run**
3. **Auth:** Authentication → Providers → **Email** → desligue **"Confirm email"**
4. **Chaves:** no Vercel (Settings → Environment Variables), troque e faça **Redeploy**:
   - `VITE_SUPABASE_URL` → URL do novo projeto
   - `VITE_SUPABASE_ANON_KEY` → chave anon/publishable do novo projeto
5. **1º diretor:** cadastre-se no app e rode no SQL Editor (troque o e-mail):
   ```sql
   update public.profiles set status='ativo', papel='diretoria'
   where id = (select id from auth.users where email = 'SEU-EMAIL-AQUI');
   ```

Pronto — o app aponta para o novo servidor com a estrutura idêntica.

## Levar os DADOS junto (opcional)

Para migrar também os dados (usuários, atividades, pontos, mensalidades…):
- Use **Database → Backups** no painel do Supabase, **ou**
- `pg_dump` do banco antigo + `pg_restore` no novo (apenas os dados das tabelas em `public`).

> 💡 O `schema.sql` é **idempotente**: rodar de novo não duplica nada.
