-- =============================================================================
-- 430 — COMUNIDADE entre clubes (fase 1): recurso, tabelas e TRIAGEM DE TEXTO no servidor
-- =============================================================================
-- Feed estilo Instagram/TikTok entre clubes. Público: crianças de 10–15 anos, então a SEGURANÇA
-- vem antes de tudo. Esta migration cria a base; a 431 as RPCs do feed e a 432 moderação,
-- autorização dos pais, Storage e o painel da plataforma.
--
-- Decisões do dono (28/09) que moldam o desenho:
--   * O recurso 'comunidade' NASCE DESLIGADO e é SOMENTE DA PLATAFORMA (como 'especialidades',
--     migration 83): a liderança não liga. Só será ligado depois de termos de uso, autorização
--     dos pais e IA de imagem — decisões pendentes do dono.
--   * O desbravador publica LIVREMENTE (sem aprovação prévia), mas o SISTEMA faz triagem
--     automática ANTES de publicar. Texto ruim NEM é publicado (mensagem gentil).
--   * Conteúdo DENUNCIADO some para todos na hora; a DIRETORIA do clube de quem publicou é avisada
--     e revisa (restaurar ou remover de vez).
--
-- Acesso: TODAS as tabelas com RLS ligado e SEM grant para anon/authenticated. Tudo passa por
-- RPC security definer (search_path '') que confere clube em uso, papel, recurso e regras.
--
-- A triagem é NOSSA (sem serviço externo): lista de termos pt-BR editável pelo admin da
-- plataforma (comunidade_termos), com normalização de disfarces, e bloqueio de dados de contato.
-- Tudo o que é bloqueado fica registrado (comunidade_bloqueios), com dígitos mascarados.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. O recurso: desligado e somente da plataforma
-- -----------------------------------------------------------------------------
insert into public.recursos_catalogo (chave, nome, descricao, icone, padrao, ordem, somente_plataforma) values
  ('comunidade', 'Comunidade', 'Feed entre clubes com triagem automática e moderação da diretoria. Liberado pela plataforma depois dos termos de uso, da autorização dos pais e da análise de imagens.', '🌎', false, 140, true)
on conflict (chave) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, padrao = excluded.padrao,
      ordem = excluded.ordem, somente_plataforma = excluded.somente_plataforma;


-- -----------------------------------------------------------------------------
--  2. Normalização de disfarces (pura, sem acesso a dado)
-- -----------------------------------------------------------------------------
-- Ordem: minúsculas -> sem acento -> leetspeak (0→o 4→a 3→e 1→i @→a 5→s $→s 7→t !→i |→i)
-- -> tudo que não é letra vira espaço (pontos, traços, emojis) -> letras soltas em sequência são
-- juntadas ("p u t a", "p.u.t.a" -> "puta") -> letras repetidas colapsam ("merdaaaa" -> "merda").
-- Os TERMOS da lista passam pela MESMA normalização (gatilho), então os dois lados batem.
create or replace function public.comunidade_normalizar(p_texto text)
returns text
language plpgsql immutable set search_path = '' as $$
declare v text; v_tok text; v_saida text[] := '{}'; v_run text := '';
begin
  v := lower(coalesce(p_texto, ''));
  v := translate(v, 'áàâãäåāéèêëēíìîïóòôõöøúùûüçñýÿ', 'aaaaaaaeeeeeiiiiooooooouuuucnyy');
  v := translate(v, '0431@5$7!|', 'oaeiasstii');
  v := regexp_replace(v, '[^a-z]+', ' ', 'g');
  foreach v_tok in array string_to_array(btrim(v), ' ') loop
    if v_tok = '' then continue; end if;
    if length(v_tok) = 1 then
      v_run := v_run || v_tok;
    else
      if v_run <> '' then v_saida := v_saida || v_run; v_run := ''; end if;
      v_saida := v_saida || v_tok;
    end if;
  end loop;
  if v_run <> '' then v_saida := v_saida || v_run; end if;
  v := array_to_string(v_saida, ' ');
  return regexp_replace(v, '([a-z])\1+', '\1', 'g');
end;
$$;
revoke all on function public.comunidade_normalizar(text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  3. Tabelas
-- -----------------------------------------------------------------------------
-- 3.1 Lista de termos (da PLATAFORMA; sem club_id — exceção declarada no teste 20)
create table if not exists public.comunidade_termos (
  id uuid primary key default gen_random_uuid(),
  termo text not null,
  -- exata: a palavra/expressão inteira; radical: palavra que COMEÇA com o termo
  modo text not null default 'exata' check (modo in ('exata', 'radical')),
  -- ofensa: palavrão/xingamento/sexual; contato: rede social, "me chama no zap", endereço...
  categoria text not null default 'ofensa' check (categoria in ('ofensa', 'contato')),
  ativo boolean not null default true,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (termo, modo)
);
alter table public.comunidade_termos enable row level security;
revoke all on public.comunidade_termos from public, anon, authenticated;

create or replace function public._comunidade_normalizar_termo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.termo := btrim(public.comunidade_normalizar(new.termo));
  if new.termo = '' or length(new.termo) < 2 then
    raise exception 'Termo vazio ou curto demais depois da normalização.';
  end if;
  return new;
end;
$$;
revoke all on function public._comunidade_normalizar_termo() from public, anon, authenticated;
drop trigger if exists trg_comunidade_normalizar_termo on public.comunidade_termos;
create trigger trg_comunidade_normalizar_termo before insert or update of termo on public.comunidade_termos
  for each row execute function public._comunidade_normalizar_termo();

-- 3.2 Publicações. club_id = clube do AUTOR (é a diretoria dele que modera).
create table if not exists public.comunidade_posts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  autor_papel text not null,                        -- papel no clube no momento da publicação
  legenda text check (legenda is null or length(legenda) <= 500),
  foto_path text unique,                            -- bucket privado 'comunidade': <club>/<autor>/<uuid>.jpg
  repost_de uuid references public.comunidade_posts(id) on delete set null,
  status text not null check (status in (
    'publicado',          -- visível no feed
    'em_analise',         -- foto aguardando a diretoria (sem IA de imagem ainda)
    'oculto_denuncia',    -- denunciado: some para todos até a diretoria revisar
    'removido',           -- a moderação removeu de vez
    'recusado',           -- a diretoria recusou a foto
    'apagado',            -- o próprio autor apagou
    'retirado'            -- o responsável revogou a autorização
  )),
  created_at timestamptz not null default now(),
  publicado_em timestamptz,
  moderado_por uuid references public.profiles(id) on delete set null,
  moderado_em timestamptz,
  check (legenda is not null or foto_path is not null or repost_de is not null)
);
create index if not exists comunidade_posts_feed_idx on public.comunidade_posts (created_at desc, id desc) where status = 'publicado';
create index if not exists comunidade_posts_clube_idx on public.comunidade_posts (club_id, status);
create index if not exists comunidade_posts_autor_idx on public.comunidade_posts (autor_id, created_at desc);
create index if not exists comunidade_posts_repost_idx on public.comunidade_posts (repost_de) where repost_de is not null;
alter table public.comunidade_posts enable row level security;
revoke all on public.comunidade_posts from public, anon, authenticated;

-- 3.3 Curtidas (club_id = clube de quem curtiu)
create table if not exists public.comunidade_curtidas (
  post_id uuid not null references public.comunidade_posts(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, usuario_id)
);
alter table public.comunidade_curtidas enable row level security;
revoke all on public.comunidade_curtidas from public, anon, authenticated;

-- 3.4 Comentários (club_id = clube de quem comentou; é a diretoria dele que modera)
create table if not exists public.comunidade_comentarios (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.comunidade_posts(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  autor_papel text not null,
  texto text not null check (length(texto) between 1 and 300),
  status text not null default 'publicado' check (status in ('publicado', 'oculto_denuncia', 'removido', 'apagado', 'retirado')),
  created_at timestamptz not null default now(),
  moderado_por uuid references public.profiles(id) on delete set null,
  moderado_em timestamptz
);
create index if not exists comunidade_comentarios_post_idx on public.comunidade_comentarios (post_id, created_at desc);
create index if not exists comunidade_comentarios_autor_idx on public.comunidade_comentarios (autor_id, created_at desc);
alter table public.comunidade_comentarios enable row level security;
revoke all on public.comunidade_comentarios from public, anon, authenticated;

-- 3.5 Denúncias. club_id = clube de quem PUBLICOU o conteúdo (a diretoria que revisa).
create table if not exists public.comunidade_denuncias (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  alvo_tipo text not null check (alvo_tipo in ('post', 'comentario')),
  alvo_id uuid not null,
  denunciante_id uuid not null references public.profiles(id) on delete cascade,
  denunciante_club_id uuid references public.organizational_units(id) on delete set null,
  motivo text not null check (motivo in ('ofensivo', 'perigoso', 'contato', 'imagem', 'outro')),
  ocultou boolean not null default false,        -- esta denúncia escondeu o conteúdo na hora?
  resultado text not null default 'pendente' check (resultado in ('pendente', 'procedente', 'improcedente')),
  resolvido_em timestamptz,
  created_at timestamptz not null default now(),
  unique (alvo_tipo, alvo_id, denunciante_id)
);
create index if not exists comunidade_denuncias_fila_idx on public.comunidade_denuncias (club_id, resultado);
create index if not exists comunidade_denuncias_denunciante_idx on public.comunidade_denuncias (denunciante_id, created_at desc);
alter table public.comunidade_denuncias enable row level security;
revoke all on public.comunidade_denuncias from public, anon, authenticated;

-- 3.6 Registro do que a triagem BLOQUEOU (club_id = clube de quem tentou). Dígitos mascarados:
-- a tentativa de passar telefone não vira um cadastro de telefones de criança.
create table if not exists public.comunidade_bloqueios (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  alvo text not null check (alvo in ('post', 'comentario')),
  motivo text not null check (motivo in ('ofensa', 'contato')),
  regra text not null,                           -- termo normalizado ou telefone/email/arroba/link
  trecho text not null,                          -- até 280 caracteres, dígitos trocados por #
  created_at timestamptz not null default now()
);
create index if not exists comunidade_bloqueios_autor_idx on public.comunidade_bloqueios (autor_id, created_at desc);
create index if not exists comunidade_bloqueios_quando_idx on public.comunidade_bloqueios (created_at desc);
alter table public.comunidade_bloqueios enable row level security;
revoke all on public.comunidade_bloqueios from public, anon, authenticated;

-- 3.7 Auditoria da moderação (quem ocultou/restaurou/removeu/aprovou/suspendeu, e por qual via)
create table if not exists public.comunidade_moderacao_log (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  alvo_tipo text not null check (alvo_tipo in ('post', 'comentario', 'usuario')),
  alvo_id uuid not null,
  acao text not null check (acao in ('ocultado_por_denuncia', 'restaurar', 'remover', 'aprovar_foto', 'recusar_foto',
                                     'suspenso', 'suspensao_encerrada', 'autorizacao_concedida', 'autorizacao_revogada')),
  por uuid references public.profiles(id) on delete set null,   -- nulo = o sistema
  via text not null check (via in ('sistema', 'diretoria', 'plataforma', 'responsavel')),
  motivo text,
  created_at timestamptz not null default now()
);
create index if not exists comunidade_moderacao_log_clube_idx on public.comunidade_moderacao_log (club_id, created_at desc);
alter table public.comunidade_moderacao_log enable row level security;
revoke all on public.comunidade_moderacao_log from public, anon, authenticated;

create or replace function public._comunidade_log_imutavel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'O histórico da moderação não se altera.';
end;
$$;
revoke all on function public._comunidade_log_imutavel() from public, anon, authenticated;
drop trigger if exists trg_comunidade_log_imutavel on public.comunidade_moderacao_log;
create trigger trg_comunidade_log_imutavel before update on public.comunidade_moderacao_log
  for each row execute function public._comunidade_log_imutavel();

-- 3.8 Avisos (strikes) e suspensões temporárias do feed
create table if not exists public.comunidade_avisos (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  origem text not null check (origem in ('texto_bloqueado', 'conteudo_removido')),
  referencia uuid,
  created_at timestamptz not null default now()
);
create index if not exists comunidade_avisos_usuario_idx on public.comunidade_avisos (usuario_id, created_at desc);
alter table public.comunidade_avisos enable row level security;
revoke all on public.comunidade_avisos from public, anon, authenticated;

create table if not exists public.comunidade_suspensoes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  ate timestamptz not null,
  motivo text not null,
  created_at timestamptz not null default now(),
  encerrada_em timestamptz,
  encerrada_por uuid references public.profiles(id) on delete set null
);
create index if not exists comunidade_suspensoes_usuario_idx on public.comunidade_suspensoes (usuario_id, ate desc);
alter table public.comunidade_suspensoes enable row level security;
revoke all on public.comunidade_suspensoes from public, anon, authenticated;

-- 3.9 Autorização do responsável (por desbravador, no clube do vínculo pais↔filho)
create table if not exists public.comunidade_autorizacoes (
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  desbravador_id uuid not null references public.profiles(id) on delete cascade,
  responsavel_id uuid not null references public.profiles(id) on delete cascade,
  autorizado boolean not null,
  atualizado_em timestamptz not null default now(),
  primary key (club_id, desbravador_id)
);
alter table public.comunidade_autorizacoes enable row level security;
revoke all on public.comunidade_autorizacoes from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  4. Limites (um lugar só; mudar = migration nova)
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_limites()
returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'posts_por_minuto', 2,
    'posts_por_dia', 10,
    'posts_por_dia_observacao', 3,          -- conta nova (primeiros dias)
    'comentarios_por_minuto', 5,
    'comentarios_por_dia', 60,
    'comentarios_por_dia_observacao', 15,
    'dias_observacao', 7,
    'avisos_para_suspender', 3,
    'janela_avisos_dias', 30,
    'dias_suspensao', 3,
    'denuncias_por_dia', 10,
    'denuncias_improcedentes_para_perder', 3, -- quem erra tanto perde o poder de esconder na hora
    'janela_denuncias_dias', 60
  );
$$;
revoke all on function public.comunidade_limites() from public, anon;
grant execute on function public.comunidade_limites() to authenticated;


-- -----------------------------------------------------------------------------
--  5. A triagem
-- -----------------------------------------------------------------------------
-- Devolve {ok:true} ou {ok:false, motivo:'ofensa'|'contato', regra}. Interna: nunca exposta, para
-- ninguém usar como oráculo e "testar" a lista. O cliente NÃO decide nada: as RPCs chamam isto.
create or replace function public._comunidade_triar(p_texto text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_raw text := lower(coalesce(p_texto, '')); v_norm text; v_t record;
begin
  -- dados de contato no texto CRU (antes do leetspeak, que transformaria @ e dígitos em letras)
  if v_raw ~ '(\d[\s.()_-]*){8,}' then
    return jsonb_build_object('ok', false, 'motivo', 'contato', 'regra', 'telefone');
  end if;
  if v_raw ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    return jsonb_build_object('ok', false, 'motivo', 'contato', 'regra', 'email');
  end if;
  if v_raw ~ '(^|[^a-z0-9])@[a-z0-9_.]{2,}' then
    return jsonb_build_object('ok', false, 'motivo', 'contato', 'regra', 'arroba');
  end if;
  if v_raw ~ '(https?://|www\.)'
     or v_raw ~ '[a-z0-9-]+\.(com|net|org|br|ly|gg|io|app|link|tv|xyz|site|online|info)(\M|/|$)' then
    return jsonb_build_object('ok', false, 'motivo', 'contato', 'regra', 'link');
  end if;

  v_norm := ' ' || public.comunidade_normalizar(p_texto) || ' ';
  select t.termo, t.categoria into v_t
    from public.comunidade_termos t
   where t.ativo
     and case t.modo when 'exata' then position(' ' || t.termo || ' ' in v_norm) > 0
                     else position(' ' || t.termo in v_norm) > 0 end
   order by (t.categoria = 'contato') desc, length(t.termo) desc
   limit 1;
  if found then
    return jsonb_build_object('ok', false, 'motivo', v_t.categoria, 'regra', v_t.termo);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public._comunidade_triar(text) from public, anon, authenticated;

-- mensagem gentil (a criança nunca sabe QUAL palavra pegou — não vira jogo de adivinhar a lista)
create or replace function public._comunidade_msg_bloqueio(p_motivo text, p_alvo text)
returns text
language sql immutable set search_path = '' as $$
  select case
    when p_motivo = 'contato' then 'Por segurança, não é permitido passar telefone, @, links, e-mail ou rede social na Comunidade 🙂'
    when p_alvo = 'comentario' then 'Esse comentário não pode ser publicado. Vamos manter o respeito 🙂'
    else 'Essa publicação não pode ser publicada. Vamos manter o respeito 🙂'
  end;
$$;
revoke all on function public._comunidade_msg_bloqueio(text, text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  6. Lista inicial (pt-BR). Editável pelo admin da plataforma (migration 432, RPCs admin_comunidade_*).
--     Os termos são normalizados pelo gatilho (acentos, repetições), então "whatsapp" vira "whatsap".
-- -----------------------------------------------------------------------------
insert into public.comunidade_termos (termo, modo, categoria)
select x.termo, x.modo, x.categoria from (values
  -- ofensa / palavrão (palavra inteira)
  ('porra', 'exata', 'ofensa'), ('caralho', 'exata', 'ofensa'), ('merda', 'exata', 'ofensa'), ('bosta', 'exata', 'ofensa'),
  ('puta', 'exata', 'ofensa'), ('puto', 'exata', 'ofensa'), ('putaria', 'exata', 'ofensa'), ('puteiro', 'exata', 'ofensa'),
  ('fdp', 'exata', 'ofensa'), ('pqp', 'exata', 'ofensa'), ('vsf', 'exata', 'ofensa'), ('vtnc', 'exata', 'ofensa'),
  ('tnc', 'exata', 'ofensa'), ('krl', 'exata', 'ofensa'), ('crl', 'exata', 'ofensa'), ('cu', 'exata', 'ofensa'),
  ('cuzao', 'exata', 'ofensa'), ('cuzinho', 'exata', 'ofensa'), ('arrombado', 'exata', 'ofensa'), ('arrombada', 'exata', 'ofensa'),
  ('viado', 'exata', 'ofensa'), ('viadinho', 'exata', 'ofensa'), ('sapatao', 'exata', 'ofensa'),
  ('buceta', 'exata', 'ofensa'), ('boceta', 'exata', 'ofensa'), ('xoxota', 'exata', 'ofensa'), ('xereca', 'exata', 'ofensa'),
  ('piroca', 'exata', 'ofensa'), ('babaca', 'exata', 'ofensa'), ('otario', 'exata', 'ofensa'), ('otaria', 'exata', 'ofensa'),
  ('imbecil', 'exata', 'ofensa'), ('retardado', 'exata', 'ofensa'), ('retardada', 'exata', 'ofensa'),
  ('vagabundo', 'exata', 'ofensa'), ('vagabunda', 'exata', 'ofensa'), ('vadia', 'exata', 'ofensa'),
  ('corno', 'exata', 'ofensa'), ('corna', 'exata', 'ofensa'), ('desgracado', 'exata', 'ofensa'), ('desgracada', 'exata', 'ofensa'),
  ('nudes', 'exata', 'ofensa'), ('nude', 'exata', 'ofensa'), ('pelada', 'exata', 'ofensa'), ('pelado', 'exata', 'ofensa'),
  ('gostosa', 'exata', 'ofensa'), ('gostoso', 'exata', 'ofensa'), ('sexo', 'exata', 'ofensa'), ('transar', 'exata', 'ofensa'),
  ('porno', 'exata', 'ofensa'), ('xvideos', 'exata', 'ofensa'), ('maconha', 'exata', 'ofensa'), ('cocaina', 'exata', 'ofensa'),
  ('hitler', 'exata', 'ofensa'), ('nazista', 'exata', 'ofensa'),
  -- ofensa (expressões)
  ('filho da puta', 'exata', 'ofensa'), ('vai se foder', 'exata', 'ofensa'), ('vai tomar no cu', 'exata', 'ofensa'),
  ('puta que pariu', 'exata', 'ofensa'), ('se mata', 'exata', 'ofensa'), ('vou te matar', 'exata', 'ofensa'),
  -- ofensa (radical: palavra que começa com)
  ('fod', 'radical', 'ofensa'), ('caralh', 'radical', 'ofensa'), ('arromb', 'radical', 'ofensa'), ('merd', 'radical', 'ofensa'),
  ('punhet', 'radical', 'ofensa'), ('siriric', 'radical', 'ofensa'), ('masturb', 'radical', 'ofensa'), ('bucet', 'radical', 'ofensa'),
  -- contato: redes, mensageiros, privado, endereço
  ('zap', 'exata', 'contato'), ('zapzap', 'exata', 'contato'), ('whats', 'exata', 'contato'), ('whatsapp', 'exata', 'contato'),
  ('wpp', 'exata', 'contato'), ('insta', 'exata', 'contato'), ('instagram', 'exata', 'contato'), ('telegram', 'exata', 'contato'),
  ('discord', 'exata', 'contato'), ('snap', 'exata', 'contato'), ('snapchat', 'exata', 'contato'), ('kwai', 'exata', 'contato'),
  ('tiktok', 'exata', 'contato'), ('facebook', 'exata', 'contato'), ('gmail', 'exata', 'contato'), ('hotmail', 'exata', 'contato'),
  ('pv', 'exata', 'contato'), ('dm', 'exata', 'contato'), ('direct', 'exata', 'contato'), ('inbox', 'exata', 'contato'),
  ('no privado', 'exata', 'contato'), ('me chama', 'exata', 'contato'), ('me add', 'exata', 'contato'), ('me adiciona', 'exata', 'contato'),
  ('me segue', 'exata', 'contato'), ('meu numero', 'exata', 'contato'), ('meu telefone', 'exata', 'contato'), ('meu cel', 'exata', 'contato'),
  ('meu celular', 'exata', 'contato'), ('ponto com', 'exata', 'contato'), ('arroba', 'exata', 'contato'),
  ('meu endereco', 'exata', 'contato'), ('onde eu moro', 'exata', 'contato'), ('onde voce mora', 'exata', 'contato'),
  ('onde vc mora', 'exata', 'contato'), ('minha escola', 'exata', 'contato')
) as x(termo, modo, categoria)
where not exists (select 1 from public.comunidade_termos t where t.termo = public.comunidade_normalizar(x.termo) and t.modo = x.modo);
