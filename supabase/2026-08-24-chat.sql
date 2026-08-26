-- =====================================================================
--  Filhos da Conquista — Chat entre desbravadores (2026-08-24)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  Como funciona:
--   1) Cada unidade tem um chat de GRUPO (todos os membros ativos dela).
--   2) Qualquer desbravador/conselheiro pode mandar mensagem DIRETA (1 pra 1)
--      pra qualquer outro desbravador/conselheiro ativo, de qualquer unidade.
--   3) IMPORTANTE — NADA É PRIVADO DE VERDADE: a liderança (diretoria/
--      instrutor) enxerga TODAS as conversas, inclusive as diretas, e pode
--      apagar qualquer mensagem (fica marcada como apagada, não some do
--      banco — a liderança continua vendo o conteúdo original pra auditoria).
--   4) Um filtro simples de palavrão barra o ENVIO de mensagens com
--      palavras óbvias — é só uma primeira camada, não substitui a
--      liderança acompanhar (criança encontra jeito de burlar filtro).
--   5) Limite de 30 mensagens a cada 5 minutos por pessoa (evita spam).
--
--  SEGURANÇA:
--   * Enviar/apagar só por função (security definer). Não há policy de
--     INSERT/UPDATE nas tabelas — ninguém escreve "na mão" pela API.
--   * RLS de leitura: só quem participa da conversa (dono da unidade, ou um
--     dos 2 da conversa direta) OU liderança (pode_gerir()) enxerga.
-- =====================================================================

create table if not exists public.chat_conversas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  unidade_id uuid references public.unidades(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint chat_conversas_tipo_valido check (tipo in ('unidade', 'direta')),
  constraint chat_conversas_unidade_coerente check (
    (tipo = 'unidade' and unidade_id is not null) or (tipo = 'direta' and unidade_id is null)
  )
);
-- Só 1 chat de grupo por unidade
create unique index if not exists uma_conversa_por_unidade on public.chat_conversas(unidade_id) where tipo = 'unidade';

create table if not exists public.chat_participantes (
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  primary key (conversa_id, usuario_id)
);
create index if not exists idx_chat_participantes_usuario on public.chat_participantes(usuario_id);

create table if not exists public.chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  texto text not null,
  created_at timestamptz not null default now(),
  apagada boolean not null default false,
  apagada_por uuid references public.profiles(id) on delete set null,
  apagada_em timestamptz,
  constraint chat_mensagens_texto_valido check (length(trim(texto)) > 0 and length(texto) <= 500)
);
create index if not exists idx_chat_mensagens_conversa on public.chat_mensagens(conversa_id, created_at);

-- ---------------------------------------------------------------------
-- Quem pode LER uma conversa: membro dela (unidade ou os 2 da direta) OU liderança.
-- ---------------------------------------------------------------------
create or replace function public.chat_pode_ver(p_conversa_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.pode_gerir()
    or exists (
      select 1 from public.chat_conversas c
      where c.id = p_conversa_id and c.tipo = 'unidade'
        and c.unidade_id = (
          -- status='ativo' é OBRIGATÓRIO aqui: uma conta recém-cadastrada
          -- (status='pendente', ainda não aprovada) já tem unidade_id desde
          -- o cadastro — sem essa checagem, bastava escolher o nome de
          -- qualquer unidade no cadastro pra ler o chat dela sem aprovação
          -- nenhuma. Mesmo papel exigido pra ENVIAR (desbravador/conselheiro),
          -- pra leitura não ficar mais permissiva que o envio.
          select unidade_id from public.profiles
          where id = auth.uid() and status = 'ativo' and papel in ('desbravador', 'conselheiro')
        )
    )
    or exists (
      select 1 from public.chat_participantes cp
      where cp.conversa_id = p_conversa_id and cp.usuario_id = auth.uid()
    );
$$;
grant execute on function public.chat_pode_ver(uuid) to authenticated;

alter table public.chat_conversas enable row level security;
drop policy if exists "ler minhas conversas" on public.chat_conversas;
create policy "ler minhas conversas" on public.chat_conversas for select to authenticated
  using (public.chat_pode_ver(id));

alter table public.chat_participantes enable row level security;
drop policy if exists "ler participantes" on public.chat_participantes;
create policy "ler participantes" on public.chat_participantes for select to authenticated
  using (public.chat_pode_ver(conversa_id));

alter table public.chat_mensagens enable row level security;
drop policy if exists "ler mensagens" on public.chat_mensagens;
create policy "ler mensagens" on public.chat_mensagens for select to authenticated
  using (public.chat_pode_ver(conversa_id));

-- ---------------------------------------------------------------------
-- "Apagar" mensagem esconde na tela, mas a linha (com o texto original)
-- continua existindo pra liderança conseguir auditar — SE o app lesse a
-- tabela direto, qualquer um na conversa (não só a liderança) ainda
-- receberia o texto original mesmo depois de apagado (a RLS acima só
-- decide QUEM vê a CONVERSA, não esconde o conteúdo de uma linha
-- específica). Essa view resolve isso: quem NÃO é liderança recebe null
-- no texto de mensagens apagadas; a liderança (e a tela de moderação, que
-- lê a tabela direto) continua vendo o original. security_invoker=true
-- faz a RLS de cima valer pra quem está consultando (não pra quem criou a
-- view) — o app dos desbravadores deve ler DAQUI, nunca da tabela direto.
-- ---------------------------------------------------------------------
create or replace view public.chat_mensagens_visiveis
with (security_invoker = true) as
select
  m.id, m.conversa_id, m.autor_id, m.created_at, m.apagada,
  case when m.apagada and not public.pode_gerir() then null else m.texto end as texto
from public.chat_mensagens m;
grant select on public.chat_mensagens_visiveis to authenticated;

-- ---------------------------------------------------------------------
-- Filtro simples de palavrão (primeira camada; não é à prova de tudo).
-- ---------------------------------------------------------------------
create or replace function public._chat_tem_palavrao(p_texto text)
returns boolean language sql immutable as $$
  select lower(p_texto) ~*
    '\y(porra|caralho|merda|putari?a|piranha|viad\w*|bicha|fdp|desgraç\w*|arrombad\w*|buceta|fod[ae]\w*|corno|otári\w*|idiota|imbecil|retardad\w*|vagabund\w*|escroto|babaca)\y';
$$;

-- ---------------------------------------------------------------------
-- Enviar mensagem NO CHAT DA UNIDADE (cria a conversa se ainda não existir).
-- ---------------------------------------------------------------------
create or replace function public.chat_enviar_unidade(p_texto text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_papel text;
  v_unidade uuid;
  v_conversa_id uuid;
  v_texto text := trim(coalesce(p_texto, ''));
  v_recentes int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if length(v_texto) = 0 then raise exception 'Escreva algo.'; end if;
  if length(v_texto) > 500 then raise exception 'Mensagem muito longa (máx. 500 caracteres).'; end if;
  if public._chat_tem_palavrao(v_texto) then
    raise exception 'Essa mensagem tem uma palavra não permitida. Reescreva, por favor.';
  end if;

  select unidade_id, papel into v_unidade, v_papel from public.profiles where id = v_uid and status = 'ativo';
  if v_unidade is null then raise exception 'Você precisa estar numa unidade ativa pra usar o chat.'; end if;
  if v_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros mandam mensagem no chat.';
  end if;

  select count(*) into v_recentes from public.chat_mensagens
  where autor_id = v_uid and created_at > now() - interval '5 minutes';
  if v_recentes >= 30 then
    raise exception 'Calma lá! Espere um pouquinho antes de mandar mais mensagens.';
  end if;

  insert into public.chat_conversas (tipo, unidade_id) values ('unidade', v_unidade)
  on conflict (unidade_id) where tipo = 'unidade' do nothing;

  select id into v_conversa_id from public.chat_conversas where tipo = 'unidade' and unidade_id = v_unidade;

  insert into public.chat_mensagens (conversa_id, autor_id, texto) values (v_conversa_id, v_uid, v_texto);

  return json_build_object('ok', true, 'conversa_id', v_conversa_id);
end;
$$;
grant execute on function public.chat_enviar_unidade(text) to authenticated;

-- ---------------------------------------------------------------------
-- Enviar MENSAGEM DIRETA (cria a conversa entre os 2 se ainda não existir).
-- ---------------------------------------------------------------------
create or replace function public.chat_enviar_direta(p_destinatario_id uuid, p_texto text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_papel text;
  v_dest_papel text;
  v_texto text := trim(coalesce(p_texto, ''));
  v_conversa_id uuid;
  v_recentes int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_destinatario_id is null or p_destinatario_id = v_uid then raise exception 'Destinatário inválido.'; end if;
  if length(v_texto) = 0 then raise exception 'Escreva algo.'; end if;
  if length(v_texto) > 500 then raise exception 'Mensagem muito longa (máx. 500 caracteres).'; end if;
  if public._chat_tem_palavrao(v_texto) then
    raise exception 'Essa mensagem tem uma palavra não permitida. Reescreva, por favor.';
  end if;

  select papel into v_papel from public.profiles where id = v_uid and status = 'ativo';
  if v_papel is null then raise exception 'Você precisa estar ativo pra usar o chat.'; end if;
  if v_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros mandam mensagem no chat.';
  end if;

  select papel into v_dest_papel from public.profiles where id = p_destinatario_id and status = 'ativo';
  if v_dest_papel is null or v_dest_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Essa pessoa não está disponível pro chat.';
  end if;

  select count(*) into v_recentes from public.chat_mensagens
  where autor_id = v_uid and created_at > now() - interval '5 minutes';
  if v_recentes >= 30 then
    raise exception 'Calma lá! Espere um pouquinho antes de mandar mais mensagens.';
  end if;

  -- Trava por PAR (ordem fixa) — evita 2 conversas duplicadas se os dois
  -- mandarem a primeira mensagem quase ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtext(
    'chat_par:' || least(v_uid, p_destinatario_id)::text || ':' || greatest(v_uid, p_destinatario_id)::text
  ));

  select cp1.conversa_id into v_conversa_id
  from public.chat_participantes cp1
  join public.chat_participantes cp2 on cp2.conversa_id = cp1.conversa_id
  join public.chat_conversas c on c.id = cp1.conversa_id
  where c.tipo = 'direta' and cp1.usuario_id = v_uid and cp2.usuario_id = p_destinatario_id
  limit 1;

  if v_conversa_id is null then
    insert into public.chat_conversas (tipo) values ('direta') returning id into v_conversa_id;
    insert into public.chat_participantes (conversa_id, usuario_id)
    values (v_conversa_id, v_uid), (v_conversa_id, p_destinatario_id);
  end if;

  insert into public.chat_mensagens (conversa_id, autor_id, texto) values (v_conversa_id, v_uid, v_texto);

  return json_build_object('ok', true, 'conversa_id', v_conversa_id);
end;
$$;
grant execute on function public.chat_enviar_direta(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Apagar mensagem — só liderança. Marca 'apagada' (não some do banco: a
-- liderança continua vendo o texto original na tela de moderação).
-- ---------------------------------------------------------------------
create or replace function public.chat_apagar_mensagem(p_mensagem_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not public.pode_gerir() then raise exception 'Só a liderança pode apagar mensagens.'; end if;
  update public.chat_mensagens set apagada = true, apagada_por = v_uid, apagada_em = now()
  where id = p_mensagem_id;
  if not found then raise exception 'Mensagem não encontrada.'; end if;
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.chat_apagar_mensagem(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Todas as conversas pra tela de MODERAÇÃO (só liderança) — 1 linha por
-- conversa com um resumo (última mensagem, quantas mensagens).
-- ---------------------------------------------------------------------
create or replace function public.chat_todas_conversas()
returns table (
  conversa_id uuid, tipo text, unidade_id uuid,
  total_mensagens bigint, ultima_mensagem text, ultima_em timestamptz
) language sql stable security definer set search_path = '' as $$
  select c.id, c.tipo, c.unidade_id,
    count(m.id),
    (array_agg(m.texto order by m.created_at desc))[1],
    max(m.created_at)
  from public.chat_conversas c
  left join public.chat_mensagens m on m.conversa_id = c.id
  where public.pode_gerir()
  group by c.id, c.tipo, c.unidade_id
  order by max(m.created_at) desc nulls last;
$$;
grant execute on function public.chat_todas_conversas() to authenticated;

-- ---------------------------------------------------------------------
-- Liga o Realtime nas mensagens (chat ao vivo, sem precisar recarregar).
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_mensagens'
  ) then
    alter publication supabase_realtime add table public.chat_mensagens;
  end if;
end $$;

notify pgrst, 'reload schema';
