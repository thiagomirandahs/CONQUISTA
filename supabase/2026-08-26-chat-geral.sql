-- =====================================================================
--  Filhos da Conquista — Chat GERAL do clube (2026-08-26)
--
--  Um canal único do clube inteiro onde TODO MUNDO conversa junto —
--  inclusive a diretoria/instrutor (no chat de unidade a liderança só
--  audita; aqui ela também escreve). Continua tudo auditável: a liderança
--  vê e pode apagar qualquer mensagem, como nas outras conversas.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Depende de 2026-08-24-chat.sql já rodado.
-- =====================================================================

-- 1) Libera o tipo 'geral' nas conversas (sem unidade, igual à 'direta').
alter table public.chat_conversas drop constraint if exists chat_conversas_tipo_valido;
alter table public.chat_conversas add constraint chat_conversas_tipo_valido
  check (tipo in ('unidade', 'direta', 'geral'));

alter table public.chat_conversas drop constraint if exists chat_conversas_unidade_coerente;
alter table public.chat_conversas add constraint chat_conversas_unidade_coerente check (
  (tipo = 'unidade' and unidade_id is not null)
  or (tipo in ('direta', 'geral') and unidade_id is null)
);

-- Só pode existir UMA conversa geral no clube.
create unique index if not exists uma_conversa_geral on public.chat_conversas (tipo) where tipo = 'geral';

-- Cria a conversa geral (se ainda não existir).
insert into public.chat_conversas (tipo)
select 'geral' where not exists (select 1 from public.chat_conversas where tipo = 'geral');

-- 2) Quem pode LER: liderança (pode_gerir), membro da unidade (chat de
--    unidade), os 2 de uma direta, OU — novo — qualquer pessoa ATIVA do
--    clube (menos responsáveis) pode ver o chat geral.
create or replace function public.chat_pode_ver(p_conversa_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.pode_gerir()
    or exists (
      select 1 from public.chat_conversas ch where ch.id = p_conversa_id and ch.tipo = 'unidade'
        and ch.unidade_id = (
          select unidade_id from public.profiles where id = auth.uid() and status = 'ativo' and papel in ('desbravador', 'conselheiro')
        )
    )
    or exists (
      select 1 from public.chat_conversas cg where cg.id = p_conversa_id and cg.tipo = 'geral'
        and exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and papel <> 'pais')
    )
    or exists (
      select 1 from public.chat_participantes part where part.conversa_id = p_conversa_id and part.usuario_id = auth.uid()
    );
$$;
grant execute on function public.chat_pode_ver(uuid) to authenticated;

-- 3) Enviar no chat geral — qualquer membro ativo (inclusive liderança),
--    menos responsáveis. Mesmas regras de palavrão / tamanho / anti-spam.
create or replace function public.chat_enviar_geral(p_texto text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_papel text;
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

  select papel into v_papel from public.profiles where id = v_uid and status = 'ativo';
  if v_papel is null then raise exception 'Você precisa estar ativo pra usar o chat.'; end if;
  if v_papel = 'pais' then raise exception 'O chat não é pra responsáveis.'; end if;

  select count(*) into v_recentes from public.chat_mensagens
  where autor_id = v_uid and created_at > now() - interval '5 minutes';
  if v_recentes >= 30 then
    raise exception 'Calma lá! Espere um pouquinho antes de mandar mais mensagens.';
  end if;

  select id into v_conversa_id from public.chat_conversas where tipo = 'geral' limit 1;
  if v_conversa_id is null then
    insert into public.chat_conversas (tipo) values ('geral') returning id into v_conversa_id;
  end if;

  insert into public.chat_mensagens (conversa_id, autor_id, texto) values (v_conversa_id, v_uid, v_texto);

  return json_build_object('ok', true, 'conversa_id', v_conversa_id);
end;
$$;
grant execute on function public.chat_enviar_geral(text) to authenticated;

notify pgrst, 'reload schema';
