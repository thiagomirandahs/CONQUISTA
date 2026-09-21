-- =====================================================================
-- CHAT, BICHINHO e BÍBLIA POR CLUBE. Rodar DEPOIS da 20260921000024. Idempotente.
--
--  * chat_conversas / chat_mensagens / chat_participantes ganham club_id. Cada clube tem o SEU chat geral
--    (índice único por clube); chat de unidade é da unidade; conversa direta só entre gente do MESMO clube;
--    a liderança modera só o clube dela (UUID de outro clube = "não encontrada").
--  * bichinhos, biblia_leituras e biblia_leitura_atual ganham club_id (o do dono). "Bichinhos do clube" só
--    mostra gente do clube. O conteúdo da Bíblia (livros/versículos) é da plataforma: igual para todos.
--  * Clube novo nasce com o chat geral (registro _prov_chat).
--  * Saem os últimos gates "só clube legado" (as funções dos gates são removidas).
-- =====================================================================

-- ==================== A) chat: colunas e dados ====================
alter table public.chat_conversas
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.chat_conversas c
   set club_id = coalesce(
     (select u.club_id from public.unidades u where u.id = c.unidade_id),
     (select public.clube_vinculo_do_usuario(cp.usuario_id) from public.chat_participantes cp where cp.conversa_id = c.id limit 1),
     public.clube_legado_id())
 where c.club_id is null;
alter table public.chat_conversas alter column club_id set not null;
create index if not exists idx_chat_conversas_club on public.chat_conversas(club_id);
-- um chat geral POR CLUBE (antes: um só no banco)
drop index if exists public.uma_conversa_geral;
create unique index if not exists uma_conversa_geral_por_clube on public.chat_conversas (club_id) where tipo = 'geral';

alter table public.chat_mensagens
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.chat_mensagens m set club_id = c.club_id from public.chat_conversas c where c.id = m.conversa_id and m.club_id is null;
alter table public.chat_mensagens alter column club_id set not null;
create index if not exists idx_chat_mensagens_club on public.chat_mensagens(club_id);

alter table public.chat_participantes
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.chat_participantes p set club_id = c.club_id from public.chat_conversas c where c.id = p.conversa_id and p.club_id is null;
alter table public.chat_participantes alter column club_id set not null;

create or replace function public.definir_club_chat() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_club uuid;
begin
  if tg_table_name = 'chat_conversas' then
    if new.unidade_id is not null then
      select club_id into v_club from public.unidades where id = new.unidade_id;
    else
      v_club := coalesce(new.club_id, public.clube_atual_id());
    end if;
    new.club_id := v_club;
  elsif tg_table_name = 'chat_mensagens' then
    select club_id into v_club from public.chat_conversas where id = new.conversa_id;
    new.club_id := v_club;
    if public.clube_vinculo_do_usuario(new.autor_id) is distinct from v_club then
      raise exception 'Autor de outro clube.';
    end if;
  else  -- chat_participantes
    select club_id into v_club from public.chat_conversas where id = new.conversa_id;
    new.club_id := v_club;
    if public.clube_vinculo_do_usuario(new.usuario_id) is distinct from v_club then
      raise exception 'Participante de outro clube.';
    end if;
  end if;
  if v_club is null then
    raise exception 'Conversa sem clube.';
  end if;
  return new;
end;
$$;
revoke all on function public.definir_club_chat() from public, anon, authenticated;

drop trigger if exists trg_exigir_clube_legado on public.chat_mensagens;
drop trigger if exists trg_exigir_clube_legado on public.chat_participantes;
drop trigger if exists trg_definir_club_chat on public.chat_conversas;
drop trigger if exists trg_definir_club_chat on public.chat_mensagens;
drop trigger if exists trg_definir_club_chat on public.chat_participantes;
create trigger trg_definir_club_chat before insert on public.chat_conversas for each row execute function public.definir_club_chat();
create trigger trg_definir_club_chat before insert on public.chat_mensagens for each row execute function public.definir_club_chat();
create trigger trg_definir_club_chat before insert on public.chat_participantes for each row execute function public.definir_club_chat();

-- ==================== B) chat: quem vê o quê (a policy de leitura chama esta função por linha) ====================
create or replace function public.chat_pode_ver(p_conversa_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid; v_tipo text; v_unidade uuid; v_uid uuid := auth.uid();
begin
  select club_id, tipo, unidade_id into v_club, v_tipo, v_unidade from public.chat_conversas where id = p_conversa_id;
  if v_club is null then return false; end if;
  if public.pode_gerir_no_clube(v_club) then return true; end if;
  if not public.membro_ativo_no_clube(v_club) then return false; end if;
  if v_tipo = 'geral' then return true; end if;
  if v_tipo = 'unidade' then
    return v_unidade is not null and v_unidade is not distinct from (
      select unidade_id from public.profiles where id = v_uid and status = 'ativo' and papel in ('desbravador', 'conselheiro'));
  end if;
  return exists (select 1 from public.chat_participantes part where part.conversa_id = p_conversa_id and part.usuario_id = v_uid);
end;
$$;

create or replace function public.chat_apagar_mensagem(p_mensagem_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Só a liderança pode apagar mensagens.'; end if;
  update public.chat_mensagens set apagada = true, apagada_por = v_uid, apagada_em = now()
  where id = p_mensagem_id and club_id = v_club;
  if not found then raise exception 'Mensagem não encontrada.'; end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.chat_todas_conversas()
returns table (conversa_id uuid, tipo text, unidade_id uuid, total_mensagens bigint, ultima_mensagem text, ultima_em timestamp with time zone)
language sql stable security definer set search_path = '' as $$
  select c.id, c.tipo, c.unidade_id,
    count(m.id),
    (array_agg(m.texto order by m.created_at desc))[1],
    max(m.created_at)
  from public.chat_conversas c
  left join public.chat_mensagens m on m.conversa_id = c.id
  where public.pode_gerir_no_clube(public.clube_atual_id()) and c.club_id = public.clube_atual_id()
  group by c.id, c.tipo, c.unidade_id
  order by max(m.created_at) desc nulls last;
$$;

-- ==================== C) bichinho e bíblia: registro no clube do dono ====================
do $mig$
declare v_t text;
begin
  foreach v_t in array array['bichinhos', 'biblia_leituras', 'biblia_leitura_atual'] loop
    execute format('alter table public.%I add column if not exists club_id uuid references public.organizational_units(id) on delete cascade', v_t);
    execute format('update public.%I x set club_id = coalesce(public.clube_vinculo_do_usuario(x.usuario_id), public.clube_legado_id()) where x.club_id is null', v_t);
    execute format('alter table public.%I alter column club_id set not null', v_t);
    execute format('create index if not exists %I on public.%I(club_id)', 'idx_' || v_t || '_club', v_t);
    execute format('drop trigger if exists trg_exigir_clube_legado on public.%I', v_t);
    execute format('drop trigger if exists trg_definir_club_por_usuario on public.%I', v_t);
    execute format('create trigger trg_definir_club_por_usuario before insert on public.%I for each row execute function public.definir_club_por_usuario(%L)', v_t, 'usuario_id');
  end loop;
end $mig$;

drop policy if exists "ler meu bichinho" on public.bichinhos;
drop policy if exists "membro le o proprio bichinho ou lideranca do clube" on public.bichinhos;
create policy "membro le o proprio bichinho ou lideranca do clube" on public.bichinhos for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));

drop policy if exists "ler minhas leituras biblia" on public.biblia_leituras;
drop policy if exists "membro le as proprias leituras ou lideranca do clube" on public.biblia_leituras;
create policy "membro le as proprias leituras ou lideranca do clube" on public.biblia_leituras for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));

drop policy if exists "ler minha leitura atual" on public.biblia_leitura_atual;
drop policy if exists "membro le a propria leitura atual ou lideranca do clube" on public.biblia_leitura_atual;
create policy "membro le a propria leitura atual ou lideranca do clube" on public.biblia_leitura_atual for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));

-- ==================== D) clube novo nasce com o chat geral ====================
create or replace function public._prov_chat(p_club_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chat_conversas (club_id, tipo) values (p_club_id, 'geral')
  on conflict (club_id) where tipo = 'geral' do nothing;
end;
$$;
revoke all on function public._prov_chat(uuid) from public, anon, authenticated;
select public.provisionar_clube(id) from public.organizational_units where type = 'clube';

-- ==================== E) enviar mensagem e "bichinhos do clube" (definição real + escopo do clube) ====================
CREATE OR REPLACE FUNCTION public.chat_enviar_direta(p_destinatario_id uuid, p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
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
  if v_papel is null or not public.membro_ativo_no_clube(v_club) then raise exception 'Você precisa estar ativo pra usar o chat.'; end if;
  if v_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros mandam mensagem no chat.';
  end if;

  select papel into v_dest_papel from public.profiles where id = p_destinatario_id and status = 'ativo' and public.clube_do_usuario(p_destinatario_id) = v_club;
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
  where c.tipo = 'direta' and c.club_id = v_club and cp1.usuario_id = v_uid and cp2.usuario_id = p_destinatario_id
  limit 1;

  if v_conversa_id is null then
    insert into public.chat_conversas (club_id, tipo) values (v_club, 'direta') returning id into v_conversa_id;
    insert into public.chat_participantes (conversa_id, usuario_id)
    values (v_conversa_id, v_uid), (v_conversa_id, p_destinatario_id);
  end if;

  insert into public.chat_mensagens (conversa_id, autor_id, texto) values (v_conversa_id, v_uid, v_texto);

  return json_build_object('ok', true, 'conversa_id', v_conversa_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.chat_enviar_unidade(p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
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
  if v_unidade is null or not public.membro_ativo_no_clube(v_club) then raise exception 'Você precisa estar numa unidade ativa pra usar o chat.'; end if;
  if v_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros mandam mensagem no chat.';
  end if;

  select count(*) into v_recentes from public.chat_mensagens
  where autor_id = v_uid and created_at > now() - interval '5 minutes';
  if v_recentes >= 30 then
    raise exception 'Calma lá! Espere um pouquinho antes de mandar mais mensagens.';
  end if;

  insert into public.chat_conversas (club_id, tipo, unidade_id) values (v_club, 'unidade', v_unidade)
  on conflict (unidade_id) where tipo = 'unidade' do nothing;

  select id into v_conversa_id from public.chat_conversas where tipo = 'unidade' and unidade_id = v_unidade;

  insert into public.chat_mensagens (conversa_id, autor_id, texto) values (v_conversa_id, v_uid, v_texto);

  return json_build_object('ok', true, 'conversa_id', v_conversa_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.chat_enviar_geral(p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
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
  if v_papel is null or not public.membro_ativo_no_clube(v_club) then raise exception 'Você precisa estar ativo pra usar o chat.'; end if;
  if v_papel = 'pais' then raise exception 'O chat não é pra responsáveis.'; end if;

  select count(*) into v_recentes from public.chat_mensagens
  where autor_id = v_uid and created_at > now() - interval '5 minutes';
  if v_recentes >= 30 then
    raise exception 'Calma lá! Espere um pouquinho antes de mandar mais mensagens.';
  end if;

  select id into v_conversa_id from public.chat_conversas where tipo = 'geral' and club_id = v_club limit 1;
  if v_conversa_id is null then
    insert into public.chat_conversas (club_id, tipo) values (v_club, 'geral') returning id into v_conversa_id;
  end if;

  insert into public.chat_mensagens (conversa_id, autor_id, texto) values (v_conversa_id, v_uid, v_texto);

  return json_build_object('ok', true, 'conversa_id', v_conversa_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.pets_do_clube()
 RETURNS TABLE(dono_id uuid, dono_nome text, dono_avatar jsonb, dono_avatar_tipo text, dono_foto text, especie text, pet_nome text, estagio integer, item text, cenario text, cor text, olhos text, movel text, vivo boolean, ofensiva integer, dormindo boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.nome, p.avatar, p.avatar_tipo, p.foto,
    b.especie, b.nome, public._bichinho_estagio(b.dias_cuidados), b.item, b.cenario, b.cor, b.olhos,
    b.movel,
    (b.vivo and (b.pontuado_em is null or b.dormindo_desde is not null
                 or now() - b.ultimo_cuidado_em <= interval '72 hours')),
    b.ofensiva,
    (b.dormindo_desde is not null)
  from public.bichinhos b
  join public.profiles p on p.id = b.usuario_id
  where p.status = 'ativo' and p.papel <> 'pais'
    and public.clube_do_usuario(p.id) = public.clube_atual_id()
    and public.membro_ativo_no_clube(public.clube_atual_id())
  order by b.ofensiva desc, public._bichinho_estagio(b.dias_cuidados) desc, p.nome;
$function$;



-- ==================== F) os gates "só clube legado" não têm mais nenhum gatilho: saem as funções ====================
drop function if exists public.exigir_clube_legado();
drop function if exists public.exigir_unidades_do_clube_legado();

-- ACL: nada novo ficou executável por PUBLIC/anon (só a do cadastro público)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-chat-bichinho-biblia-por-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
