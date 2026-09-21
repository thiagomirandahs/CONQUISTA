-- =====================================================================
-- Hardening final (1/3): o TEXTO de mensagem de chat moderada só é legível pela liderança DO CLUBE.
-- Rodar DEPOIS da 20260921000028. Idempotente. Reproduzido no teste 23 antes de corrigir.
--
-- O problema: a view `chat_mensagens_visiveis` escondia o texto de mensagem apagada, mas a policy de leitura da TABELA
-- `chat_mensagens` só decide quem vê a CONVERSA — qualquer membro do chat geral (ou da unidade) lia o `texto` da
-- mensagem "removida pela liderança" direto pela API (PostgREST), sem passar pela view.
--
-- Agora:
--   * o texto original vai para `chat_mensagens_apagadas` (RLS: só liderança do clube da mensagem; ninguém grava direto);
--   * a linha em `chat_mensagens` guarda só o marcador "(mensagem apagada)" (e continua `apagada = true`, então o app
--     segue mostrando "Mensagem removida pela liderança" e a lista/contagem/realtime não mudam);
--   * a view devolve o original só a quem lê a trilha (liderança do clube) — mesmo contrato de antes para o app;
--   * as mensagens JÁ apagadas hoje são migradas (backfill idempotente).
-- Front: a tela de moderação passa a ler a VIEW (funciona antes e depois desta migration). Um front antigo em cache
-- lendo a tabela direto mostra o marcador no lugar do texto apagado (só a tela de moderação; o chat normal não muda).
-- =====================================================================

-- ==================== 1) a trilha de moderação (texto original) ====================
-- (id, club_id) único em chat_mensagens: permite a FK composta abaixo, que impede a trilha de apontar para o clube errado
-- até para quem é dono do banco.
do $m$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.chat_mensagens'::regclass and conname = 'chat_mensagens_id_club_uq') then
    alter table public.chat_mensagens add constraint chat_mensagens_id_club_uq unique (id, club_id);
  end if;
end $m$;

create table if not exists public.chat_mensagens_apagadas (
  mensagem_id uuid primary key,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  texto_original text not null,
  apagada_em timestamptz not null default now(),
  constraint chat_mensagens_apagadas_msg_fk foreign key (mensagem_id, club_id)
    references public.chat_mensagens (id, club_id) on delete cascade
);
create index if not exists idx_chat_mensagens_apagadas_club on public.chat_mensagens_apagadas(club_id);

alter table public.chat_mensagens_apagadas enable row level security;
drop policy if exists "liderança do clube lê a trilha de moderação" on public.chat_mensagens_apagadas;
create policy "liderança do clube lê a trilha de moderação" on public.chat_mensagens_apagadas
  for select to authenticated using (public.pode_gerir_no_clube(club_id));

-- só leitura (filtrada pela RLS) para quem está logado; quem grava é a RPC (SECURITY DEFINER)
revoke all on public.chat_mensagens_apagadas from public, anon, authenticated;
grant select on public.chat_mensagens_apagadas to authenticated;

-- ==================== 2) apagar: guarda o original na trilha e deixa só o marcador na mensagem ====================
create or replace function public.chat_apagar_mensagem(p_mensagem_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_msg public.chat_mensagens;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Só a liderança pode apagar mensagens.'; end if;
  select * into v_msg from public.chat_mensagens where id = p_mensagem_id and club_id = v_club for update;
  if not found then raise exception 'Mensagem não encontrada.'; end if;
  -- idempotente: apagar de novo não sobrescreve o original (nem quem apagou primeiro) com o marcador
  if not v_msg.apagada then
    insert into public.chat_mensagens_apagadas (mensagem_id, club_id, texto_original)
    values (v_msg.id, v_msg.club_id, v_msg.texto) on conflict (mensagem_id) do nothing;
    update public.chat_mensagens
       set apagada = true, apagada_por = v_uid, apagada_em = now(), texto = '(mensagem apagada)'
     where id = v_msg.id;
  end if;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.chat_apagar_mensagem(uuid) from public, anon;
grant execute on function public.chat_apagar_mensagem(uuid) to authenticated;

-- ==================== 3) a view do app: original só para quem lê a trilha (liderança do clube) ====================
create or replace view public.chat_mensagens_visiveis with (security_invoker = true) as
select m.id, m.conversa_id, m.autor_id, m.created_at, m.apagada,
       case when not m.apagada then m.texto
            else coalesce(a.texto_original, case when public.pode_gerir_no_clube(m.club_id) then m.texto end)
       end as texto
from public.chat_mensagens m
left join public.chat_mensagens_apagadas a on a.mensagem_id = m.id;
grant select on public.chat_mensagens_visiveis to authenticated;

-- ==================== 4) backfill: as mensagens já apagadas hoje saem da tabela e vão para a trilha ====================
insert into public.chat_mensagens_apagadas (mensagem_id, club_id, texto_original, apagada_em)
select id, club_id, texto, coalesce(apagada_em, now())
from public.chat_mensagens
where apagada and texto <> '(mensagem apagada)'
on conflict (mensagem_id) do nothing;

update public.chat_mensagens m
   set texto = '(mensagem apagada)'
 where m.apagada and m.texto <> '(mensagem apagada)'
   and exists (select 1 from public.chat_mensagens_apagadas a where a.mensagem_id = m.id);
