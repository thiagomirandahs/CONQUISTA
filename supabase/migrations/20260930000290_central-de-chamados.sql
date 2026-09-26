-- =============================================================================
--  CENTRAL DE CHAMADOS (suporte por ticket) — pedido do dono: "coloca a área de suporte no aplicativo
--  para abrirem ticket lá e chegar para mim também".
--
--  NÃO confundir com `support_grants` (aba "Suporte" do /admin, migration 48): aquilo é o clube
--  AUTORIZAR acesso de suporte. Isto aqui é a conversa pessoa ↔ equipe da plataforma.
--
--  Privacidade (decisão mais simples e mais segura): o chamado é visível SÓ para o AUTOR e para quem é
--  platform_admin. A diretoria do clube não vê chamado de ninguém. Tabelas sem grant nenhum para
--  authenticated/anon: todo acesso passa por RPC security definer com search_path ''.
--
--  Como chega ao dono: abrir chamado ou responder gera uma linha em `notificacoes` para cada
--  platform_admin ativo (para_usuario = admin). Essa linha já é o que o sino lê e o que o gatilho
--  de push (migrations 52/55: _push_preparar_evento → _push_disparar → Edge Function enviar-push)
--  consome — nenhuma infraestrutura nova de push. O público do push exige vínculo ativo em algum
--  clube (o gatilho definir_club_notificacao escolhe o clube do destinatário); admin sem vínculo
--  nenhum não recebe sino/push, só vê o contador na aba "Chamados" do /admin.
--
--  LGPD: anexos num bucket PRIVADO ('suporte-anexos'), pasta por usuário, 3 MB, só imagem.
--  Chamado é da CONTA, não do vínculo com o clube: não entra na lixeira de membros (migration 221,
--  que é por clube), e some com a conta (on delete cascade em auth.users). Retenção: chamado
--  'fechado' há mais de 2 anos é expurgado pela rotina diária (mensagens e metadados; o arquivo do
--  anexo fica órfão no Storage e deve ser limpo pela rotina de Storage — documentado no relatório).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.suporte_chamados (
  id uuid primary key default gen_random_uuid(),
  autor_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid references public.organizational_units(id) on delete set null,
  categoria text not null check (categoria in ('duvida', 'problema', 'pagamento', 'sugestao', 'privacidade', 'outro')),
  assunto text not null check (char_length(assunto) between 3 and 120),
  status text not null default 'aberto'
    check (status in ('aberto', 'em_andamento', 'aguardando_usuario', 'resolvido', 'fechado')),
  prioridade text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  prioridade_sugerida text check (prioridade_sugerida is null or prioridade_sugerida in ('baixa', 'normal', 'alta', 'urgente')),
  contexto jsonb not null default '{}'::jsonb,
  responsavel_id uuid references auth.users(id) on delete set null,
  ultima_msg_origem text not null default 'usuario' check (ultima_msg_origem in ('usuario', 'suporte')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  fechado_em timestamptz
);
create index if not exists idx_suporte_chamados_autor on public.suporte_chamados (autor_id, criado_em desc);
create index if not exists idx_suporte_chamados_fila on public.suporte_chamados (status, atualizado_em desc);

create table if not exists public.suporte_mensagens (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.suporte_chamados(id) on delete cascade,
  autor_id uuid references auth.users(id) on delete set null,
  origem text not null check (origem in ('usuario', 'suporte')),
  -- nota interna: só a equipe da plataforma lê; NUNCA sai nas RPCs do autor.
  interna boolean not null default false,
  texto text not null check (char_length(texto) between 1 and 4000),
  anexo_path text,
  criado_em timestamptz not null default now(),
  check (not interna or origem = 'suporte')
);
create index if not exists idx_suporte_mensagens_chamado on public.suporte_mensagens (chamado_id, criado_em);
create index if not exists idx_suporte_mensagens_autor on public.suporte_mensagens (autor_id, criado_em desc);

alter table public.suporte_chamados enable row level security;
alter table public.suporte_mensagens enable row level security;
revoke all on public.suporte_chamados, public.suporte_mensagens from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Storage: bucket privado, pasta = uid de quem sobe.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('suporte-anexos', 'suporte-anexos', false, 3 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Quem pode LER um anexo: o dono da pasta, a equipe da plataforma, ou o autor do chamado quando o
-- anexo está numa mensagem NÃO interna do chamado dele (print mandado pelo suporte).
create or replace function public._suporte_pode_ler_anexo(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
       split_part(p_name, '/', 1) = auth.uid()::text
    or public.eh_admin_plataforma()
    or exists (
      select 1 from public.suporte_mensagens m
      join public.suporte_chamados c on c.id = m.chamado_id
      where m.anexo_path = p_name and not m.interna and c.autor_id = auth.uid()
    )
  );
$$;
revoke all on function public._suporte_pode_ler_anexo(text) from public, anon;
grant execute on function public._suporte_pode_ler_anexo(text) to authenticated;

drop policy if exists "suporte anexo: dono envia" on storage.objects;
create policy "suporte anexo: dono envia" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'suporte-anexos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  );
drop policy if exists "suporte anexo: autor ou plataforma le" on storage.objects;
create policy "suporte anexo: autor ou plataforma le" on storage.objects for select to authenticated
  using (bucket_id = 'suporte-anexos' and public._suporte_pode_ler_anexo(name));
-- Sem policy de UPDATE/DELETE: anexo enviado não se troca.

-- ---------------------------------------------------------------------------
-- 3. Utilitários internos
-- ---------------------------------------------------------------------------
-- Texto puro: tira tags HTML e caracteres de controle (menos \n e \t), apara.
create or replace function public._suporte_limpar(p text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '<[^>]*>', '', 'g'),
                              '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
$$;
revoke all on function public._suporte_limpar(text) from public, anon, authenticated;

-- Anexo só vale se estiver na pasta de quem manda E existir no bucket.
create or replace function public._suporte_validar_anexo(p_path text, p_uid uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if p_path is null or p_path = '' then return null; end if;
  if p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' or split_part(p_path, '/', 1) <> p_uid::text then
    raise exception 'Anexo inválido.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'suporte-anexos' and o.name = p_path) then
    raise exception 'Anexo não encontrado. Envie a imagem de novo.';
  end if;
  return p_path;
end $$;
revoke all on function public._suporte_validar_anexo(text, uuid) from public, anon, authenticated;

-- Contexto técnico: lista FECHADA de chaves, cada valor texto curto. Nada de senha/token entra
-- porque nada fora da lista entra.
create or replace function public._suporte_contexto(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, left(public._suporte_limpar(p ->> k), 160)), '{}'::jsonb)
    from unnest(array['versao', 'rota', 'clube', 'papel', 'aparelho', 'sistema', 'navegador', 'tela', 'app']) k
   where jsonb_typeof(coalesce(p, '{}'::jsonb) -> k) in ('string', 'number', 'boolean');
$$;
revoke all on function public._suporte_contexto(jsonb) from public, anon, authenticated;

-- Notificação pessoal (sino + push pela infraestrutura existente). Nunca derruba o chamado: sem
-- vínculo ativo não há clube para o sino/push, então pula; qualquer erro vira silêncio.
create or replace function public._suporte_notificar(p_para uuid, p_titulo text, p_corpo text, p_link text, p_chave text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_para is null then return; end if;
  if not exists (select 1 from public.organization_memberships m
                  where m.user_id = p_para and m.status = 'ativo'
                    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())) then
    return;
  end if;
  begin
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, chave_push)
    values (left(p_titulo, 120), left(p_corpo, 240), 'suporte', p_link, 'todos', p_para, p_chave);
  exception when others then
    null;
  end;
end $$;
revoke all on function public._suporte_notificar(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public._suporte_notificar_admins(p_chamado uuid, p_msg uuid, p_titulo text, p_corpo text, p_excluir uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  for r in select a.user_id from public.platform_admins a where a.ativo and a.user_id is distinct from p_excluir loop
    perform public._suporte_notificar(r.user_id, p_titulo, p_corpo, '/admin?aba=chamados&chamado=' || p_chamado,
      'suporte:' || p_msg || ':' || r.user_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public._suporte_notificar_admins(uuid, uuid, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPCs do USUÁRIO
-- ---------------------------------------------------------------------------
create or replace function public.suporte_chamado_abrir(
  p_categoria text, p_assunto text, p_descricao text,
  p_anexo_path text default null, p_prioridade_sugerida text default null, p_contexto jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid;
  v_assunto text := public._suporte_limpar(p_assunto);
  v_desc text := public._suporte_limpar(p_descricao);
  v_anexo text;
  v_prio text;
  v_id uuid;
  v_msg uuid;
  v_ctx jsonb;
begin
  if v_uid is null then raise exception 'Entre na sua conta para abrir um chamado.'; end if;
  if p_categoria is null or p_categoria not in ('duvida', 'problema', 'pagamento', 'sugestao', 'privacidade', 'outro') then
    raise exception 'Escolha uma categoria.';
  end if;
  if char_length(v_assunto) < 3 or char_length(v_assunto) > 120 then
    raise exception 'O assunto precisa ter entre 3 e 120 caracteres.';
  end if;
  if char_length(v_desc) < 10 or char_length(v_desc) > 4000 then
    raise exception 'Descreva com 10 a 4000 caracteres.';
  end if;
  -- limite: 5 chamados abertos por pessoa em 24h
  if (select count(*) from public.suporte_chamados c
       where c.autor_id = v_uid and c.criado_em > now() - interval '24 hours') >= 5 then
    raise exception 'Limite de 5 chamados em 24 horas. Responda um chamado existente ou tente mais tarde.';
  end if;

  v_anexo := public._suporte_validar_anexo(p_anexo_path, v_uid);

  begin
    v_club := public.clube_atual_id();
  exception when others then
    v_club := null;
  end;

  -- prioridade sugerida só vale para quem é diretoria do clube em uso
  if p_prioridade_sugerida in ('baixa', 'normal', 'alta', 'urgente') and v_club is not null and exists (
       select 1 from public.organization_memberships m
        where m.user_id = v_uid and m.organizational_unit_id = v_club and m.status = 'ativo' and m.role = 'diretoria') then
    v_prio := p_prioridade_sugerida;
  end if;

  v_ctx := public._suporte_contexto(p_contexto);

  insert into public.suporte_chamados (autor_id, club_id, categoria, assunto, prioridade, prioridade_sugerida, contexto)
  values (v_uid, v_club, p_categoria, v_assunto, coalesce(v_prio, 'normal'), v_prio, v_ctx)
  returning id into v_id;

  insert into public.suporte_mensagens (chamado_id, autor_id, origem, texto, anexo_path)
  values (v_id, v_uid, 'usuario', v_desc, v_anexo)
  returning id into v_msg;

  perform public._suporte_notificar_admins(v_id, v_msg, '🆘 Novo chamado de suporte', v_assunto, v_uid);
  return v_id;
end $$;
revoke all on function public.suporte_chamado_abrir(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.suporte_chamado_abrir(text, text, text, text, text, jsonb) to authenticated;

-- Pode responder: não fechado, e resolvido só até 7 dias.
create or replace function public._suporte_pode_responder(p_status text, p_resolvido_em timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select p_status in ('aberto', 'em_andamento', 'aguardando_usuario')
      or (p_status = 'resolvido' and p_resolvido_em is not null and p_resolvido_em > now() - interval '7 days');
$$;
revoke all on function public._suporte_pode_responder(text, timestamptz) from public, anon, authenticated;

create or replace function public.suporte_meus_chamados()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'categoria', c.categoria, 'assunto', c.assunto, 'status', c.status,
    'criado_em', c.criado_em, 'atualizado_em', c.atualizado_em, 'ultima_msg_origem', c.ultima_msg_origem,
    'pode_responder', public._suporte_pode_responder(c.status, c.resolvido_em)
  ) order by c.atualizado_em desc), '[]'::jsonb)
  from public.suporte_chamados c
  where auth.uid() is not null and c.autor_id = auth.uid();
$$;
revoke all on function public.suporte_meus_chamados() from public, anon;
grant execute on function public.suporte_meus_chamados() to authenticated;

create or replace function public.suporte_chamado_ver(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); c public.suporte_chamados;
begin
  select * into c from public.suporte_chamados where id = p_id;
  -- mesma resposta para "não existe" e "não é seu": não revela existência
  if v_uid is null or c.id is null or c.autor_id <> v_uid then
    raise exception 'Chamado não encontrado.';
  end if;
  return jsonb_build_object(
    'id', c.id, 'categoria', c.categoria, 'assunto', c.assunto, 'status', c.status,
    'criado_em', c.criado_em, 'atualizado_em', c.atualizado_em, 'resolvido_em', c.resolvido_em,
    'pode_responder', public._suporte_pode_responder(c.status, c.resolvido_em),
    'mensagens', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'origem', m.origem, 'texto', m.texto,
               'anexo_path', m.anexo_path, 'criado_em', m.criado_em, 'minha', m.autor_id = v_uid) order by m.criado_em)
        from public.suporte_mensagens m where m.chamado_id = c.id and not m.interna), '[]'::jsonb));
end $$;
revoke all on function public.suporte_chamado_ver(uuid) from public, anon;
grant execute on function public.suporte_chamado_ver(uuid) to authenticated;

create or replace function public.suporte_chamado_responder(p_id uuid, p_texto text, p_anexo_path text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); c public.suporte_chamados; v_txt text := public._suporte_limpar(p_texto); v_anexo text; v_msg uuid;
begin
  select * into c from public.suporte_chamados where id = p_id for update;
  if v_uid is null or c.id is null or c.autor_id <> v_uid then raise exception 'Chamado não encontrado.'; end if;
  if not public._suporte_pode_responder(c.status, c.resolvido_em) then
    raise exception 'Este chamado foi encerrado. Abra um novo chamado.';
  end if;
  if char_length(v_txt) < 1 or char_length(v_txt) > 4000 then raise exception 'Escreva de 1 a 4000 caracteres.'; end if;
  if (select count(*) from public.suporte_mensagens m where m.autor_id = v_uid and m.criado_em > now() - interval '1 hour') >= 30 then
    raise exception 'Muitas mensagens em pouco tempo. Aguarde um pouco.';
  end if;
  v_anexo := public._suporte_validar_anexo(p_anexo_path, v_uid);

  insert into public.suporte_mensagens (chamado_id, autor_id, origem, texto, anexo_path)
  values (c.id, v_uid, 'usuario', v_txt, v_anexo) returning id into v_msg;

  -- resposta do usuário devolve a bola ao suporte (e REABRE se estava resolvido há ≤ 7 dias)
  update public.suporte_chamados
     set status = case when status = 'em_andamento' then 'em_andamento' else 'aberto' end,
         resolvido_em = null, ultima_msg_origem = 'usuario', atualizado_em = now()
   where id = c.id;

  perform public._suporte_notificar_admins(c.id, v_msg,
    case when c.status = 'resolvido' then '🔁 Chamado reaberto' else '💬 Nova resposta no chamado' end, c.assunto, v_uid);
end $$;
revoke all on function public.suporte_chamado_responder(uuid, text, text) from public, anon;
grant execute on function public.suporte_chamado_responder(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPCs da PLATAFORMA (/admin → Chamados)
-- ---------------------------------------------------------------------------
create or replace function public.admin_chamados_contagem()
returns int
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return (select count(*) from public.suporte_chamados where status in ('aberto', 'em_andamento'))::int;
end $$;
revoke all on function public.admin_chamados_contagem() from public, anon;
grant execute on function public.admin_chamados_contagem() to authenticated;

create or replace function public.admin_chamados_listar(p_filtro text default 'abertos')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public._exigir_admin_plataforma();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'assunto', c.assunto, 'categoria', c.categoria, 'status', c.status, 'prioridade', c.prioridade,
      'prioridade_sugerida', c.prioridade_sugerida, 'criado_em', c.criado_em, 'atualizado_em', c.atualizado_em,
      'ultima_msg_origem', c.ultima_msg_origem, 'club_id', c.club_id, 'clube', u.nome,
      'autor', coalesce(p.nome, 'Usuário'), 'responsavel_id', c.responsavel_id, 'meu', c.responsavel_id = v_uid
    ) order by case c.prioridade when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 else 3 end, c.criado_em)
    from public.suporte_chamados c
    left join public.organizational_units u on u.id = c.club_id
    left join public.profiles p on p.id = c.autor_id
    where case coalesce(p_filtro, 'abertos')
      when 'abertos'    then c.status in ('aberto', 'em_andamento')
      when 'meus'       then c.responsavel_id = v_uid and c.status not in ('resolvido', 'fechado')
      when 'aguardando' then c.status = 'aguardando_usuario'
      when 'resolvidos' then c.status in ('resolvido', 'fechado')
      else true end
  ), '[]'::jsonb);
end $$;
revoke all on function public.admin_chamados_listar(text) from public, anon;
grant execute on function public.admin_chamados_listar(text) to authenticated;

create or replace function public.admin_chamado_ver(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public._exigir_admin_plataforma(); c public.suporte_chamados;
begin
  select * into c from public.suporte_chamados where id = p_id;
  if c.id is null then raise exception 'Chamado não encontrado.'; end if;
  return jsonb_build_object(
    'id', c.id, 'assunto', c.assunto, 'categoria', c.categoria, 'status', c.status, 'prioridade', c.prioridade,
    'prioridade_sugerida', c.prioridade_sugerida, 'contexto', c.contexto, 'criado_em', c.criado_em,
    'atualizado_em', c.atualizado_em, 'resolvido_em', c.resolvido_em, 'responsavel_id', c.responsavel_id,
    'meu', c.responsavel_id = v_uid, 'club_id', c.club_id,
    'clube', (select nome from public.organizational_units where id = c.club_id),
    'autor', coalesce((select nome from public.profiles where id = c.autor_id), 'Usuário'),
    'mensagens', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'origem', m.origem, 'interna', m.interna, 'texto', m.texto,
               'anexo_path', m.anexo_path, 'criado_em', m.criado_em,
               'autor', coalesce((select nome from public.profiles where id = m.autor_id), '—')) order by m.criado_em)
        from public.suporte_mensagens m where m.chamado_id = c.id), '[]'::jsonb));
end $$;
revoke all on function public.admin_chamado_ver(uuid) from public, anon;
grant execute on function public.admin_chamado_ver(uuid) to authenticated;

-- Responder (ou nota interna). Resposta pública passa o chamado para "aguardando você" (salvo outro
-- status explícito) e notifica o autor. Nota interna não muda status nem notifica ninguém.
create or replace function public.admin_chamado_responder(
  p_id uuid, p_texto text, p_interna boolean default false, p_anexo_path text default null, p_novo_status text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public._exigir_admin_plataforma();
  c public.suporte_chamados; v_txt text := public._suporte_limpar(p_texto); v_anexo text; v_msg uuid; v_status text;
begin
  select * into c from public.suporte_chamados where id = p_id for update;
  if c.id is null then raise exception 'Chamado não encontrado.'; end if;
  if char_length(v_txt) < 1 or char_length(v_txt) > 4000 then raise exception 'Escreva de 1 a 4000 caracteres.'; end if;
  if p_novo_status is not null and p_novo_status not in ('aberto', 'em_andamento', 'aguardando_usuario', 'resolvido', 'fechado') then
    raise exception 'Status inválido.';
  end if;
  v_anexo := public._suporte_validar_anexo(p_anexo_path, v_uid);

  insert into public.suporte_mensagens (chamado_id, autor_id, origem, interna, texto, anexo_path)
  values (c.id, v_uid, 'suporte', coalesce(p_interna, false), v_txt, v_anexo) returning id into v_msg;

  if coalesce(p_interna, false) then
    v_status := coalesce(p_novo_status, c.status);
  else
    v_status := coalesce(p_novo_status, 'aguardando_usuario');
  end if;

  update public.suporte_chamados
     set status = v_status,
         responsavel_id = coalesce(responsavel_id, v_uid),
         ultima_msg_origem = case when coalesce(p_interna, false) then ultima_msg_origem else 'suporte' end,
         resolvido_em = case when v_status = 'resolvido' then coalesce(resolvido_em, now()) when v_status = 'fechado' then resolvido_em else null end,
         fechado_em = case when v_status = 'fechado' then now() else null end,
         atualizado_em = now()
   where id = c.id;

  perform public._admin_auditar(case when coalesce(p_interna, false) then 'chamado_nota_interna' else 'chamado_responder' end,
    'suporte_chamado', c.id, jsonb_build_object('status_de', c.status, 'status_para', v_status, 'com_anexo', v_anexo is not null));

  if not coalesce(p_interna, false) then
    perform public._suporte_notificar(c.autor_id, '💬 O suporte respondeu seu chamado', c.assunto,
      '/suporte?chamado=' || c.id, 'suporte:' || v_msg || ':' || c.autor_id);
  end if;
end $$;
revoke all on function public.admin_chamado_responder(uuid, text, boolean, text, text) from public, anon;
grant execute on function public.admin_chamado_responder(uuid, text, boolean, text, text) to authenticated;

create or replace function public.admin_chamado_atualizar(
  p_id uuid, p_status text default null, p_prioridade text default null, p_assumir boolean default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._exigir_admin_plataforma(); c public.suporte_chamados; v_status text;
begin
  select * into c from public.suporte_chamados where id = p_id for update;
  if c.id is null then raise exception 'Chamado não encontrado.'; end if;
  if p_status is not null and p_status not in ('aberto', 'em_andamento', 'aguardando_usuario', 'resolvido', 'fechado') then
    raise exception 'Status inválido.';
  end if;
  if p_prioridade is not null and p_prioridade not in ('baixa', 'normal', 'alta', 'urgente') then
    raise exception 'Prioridade inválida.';
  end if;
  v_status := coalesce(p_status, c.status);

  update public.suporte_chamados
     set status = v_status,
         prioridade = coalesce(p_prioridade, prioridade),
         responsavel_id = case when p_assumir is true then v_uid when p_assumir is false then null else responsavel_id end,
         resolvido_em = case when v_status = 'resolvido' then coalesce(resolvido_em, now()) when v_status = 'fechado' then resolvido_em else null end,
         fechado_em = case when v_status = 'fechado' then coalesce(fechado_em, now()) else null end,
         atualizado_em = now()
   where id = c.id;

  perform public._admin_auditar('chamado_atualizar', 'suporte_chamado', c.id, jsonb_build_object(
    'status_de', c.status, 'status_para', v_status, 'prioridade_de', c.prioridade,
    'prioridade_para', coalesce(p_prioridade, c.prioridade), 'assumir', p_assumir));

  if p_status is not null and p_status <> c.status and p_status in ('resolvido', 'fechado') then
    perform public._suporte_notificar(c.autor_id,
      case when p_status = 'resolvido' then '✅ Seu chamado foi resolvido' else 'Seu chamado foi encerrado' end,
      c.assunto, '/suporte?chamado=' || c.id, 'suporte:status:' || c.id || ':' || p_status || ':' || extract(epoch from now())::bigint);
  end if;
end $$;
revoke all on function public.admin_chamado_atualizar(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_chamado_atualizar(uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Rotina: resolvido há 7+ dias vira fechado; fechado há 2+ anos é expurgado.
-- ---------------------------------------------------------------------------
create or replace function public.suporte_rotina()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.suporte_chamados set status = 'fechado', fechado_em = now(), atualizado_em = now()
   where status = 'resolvido' and resolvido_em < now() - interval '7 days';
  delete from public.suporte_chamados where status = 'fechado' and fechado_em < now() - interval '2 years';
end $$;
revoke all on function public.suporte_rotina() from public, anon, authenticated;

select cron.schedule('suporte-rotina', '15 4 * * *', 'select public.suporte_rotina()')
 where not exists (select 1 from cron.job where jobname = 'suporte-rotina');

notify pgrst, 'reload schema';
