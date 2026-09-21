-- =====================================================================
-- Fim do "reino legado": saem os helpers globais do clube legado. Rodar DEPOIS da 20260921000025. Idempotente.
--
-- pode_gerir() / pode_aprovar() / eh_membro_ativo() / eh_financeiro() valiam SÓ para o Tenant 001 (falha
-- fechada, enquanto os módulos não eram por clube). Agora nenhuma função, policy, default ou tela do app
-- depende deles (o teste 20_matriz_de_auditoria garante) — então saem, em vez de ficarem como armadilha:
-- quem precisar de permissão usa pode_gerir_no_clube(clube) / membro_ativo_no_clube(clube) /
-- pode_financeiro_no_clube(clube), sempre com o clube DA LINHA ou de quem chama (clube_atual_id()).
--
-- O que segue chamando clube_legado_id() de propósito (declarado no teste 20):
--   * cadastro público e sincronização de vínculo (o app de cadastro ainda entra pelo Tenant 001);
--   * o catálogo-modelo de jogos que clube novo copia; o "manual no SQL Editor" (fotos/avisos/pontos sem
--     clube informado caem no Tenant 001, como sempre foi);
--   * as policies do cadastro público (unidades para anon) e do ledger de migrations.
-- =====================================================================
-- A view que o app lê no chat escondia o texto da mensagem apagada com pode_gerir() (helper legado):
-- a liderança de outro clube veria "(apagada)" mesmo sendo dona da moderação. Agora: liderança DO CLUBE da mensagem.
-- (mesmas colunas e o mesmo security_invoker: o RLS de chat_mensagens continua valendo)
create or replace view public.chat_mensagens_visiveis with (security_invoker = true) as
select m.id, m.conversa_id, m.autor_id, m.created_at, m.apagada,
       case when m.apagada and not public.pode_gerir_no_clube(m.club_id) then null::text else m.texto end as texto
from public.chat_mensagens m;
grant select on public.chat_mensagens_visiveis to authenticated;

-- O ledger de migrations (só nomes de arquivo aplicados) era lido pela liderança via pode_gerir(): agora, pela
-- liderança do clube de quem lê (é informação da plataforma, sem dado de clube; o app não a usa).
drop policy if exists "ledger leitura lideranca" on public.migracoes_aplicadas;
create policy "ledger leitura lideranca" on public.migracoes_aplicadas for select to authenticated
using (public.pode_gerir_no_clube(public.clube_atual_id()));

drop function if exists public.pode_gerir();
drop function if exists public.pode_aprovar();
drop function if exists public.eh_membro_ativo();
drop function if exists public.eh_financeiro();

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-remove-helpers-legados.sql')
on conflict (arquivo) do update set aplicada_em = now();
