-- =====================================================================
-- Camada de produto multi-clube (1/2): contexto da sessão, marca (branding) e recursos (feature flags) POR CLUBE.
-- Rodar DEPOIS da 20260921000032. Idempotente. Reproduzido no teste 26 antes de escrever.
-- Nada aqui muda dado de negócio nem regra de acesso existente: é leitura nova (`meu_contexto`) + duas portas de escrita da
-- liderança (`clube_marca_gravar`, `recurso_definir`). O front novo funciona ANTES e DEPOIS deste SQL (cai no modo legado).
--
--  1) `recursos_catalogo`: os recursos do app (plataforma), com o padrão de cada um. O clube só escolhe o que quer diferente do padrão
--     (`club_features`, que já existia). `recurso_habilitado_no_clube` passa a considerar o padrão — o leilão continua DESLIGADO por
--     padrão, então nada muda para quem já usa (o Tenant 001 tem a linha `leilao = true`).
--  2) Marca por clube em `organizational_units.metadata->'marca'`: nome, sigla, lema, descrição, ano, cores e logo. O que o clube não
--     definiu é DERIVADO do nome do clube (nunca vira "Filhos da Conquista" em outro clube). O Tenant 001 recebe a marca de sempre.
--  3) `meu_contexto()`: numa chamada só, os vínculos DA PRÓPRIA pessoa — clube, papel NO clube, status, unidade NO clube, marca e
--     recursos efetivos — e qual clube o SERVIDOR usa (`clube_atual_id()`). É a fonte do ClubeContext do app.
--
-- Papel e unidade globais em `profiles` seguem existindo (o banco ainda tem 1 clube por pessoa: `um_clube_por_pessoa`); o front deixa de
-- LER `profiles.papel`/`profiles.unidade_id` e passa a ler o vínculo. Vários clubes por pessoa no servidor é outra fase (ver AUDITORIA).
-- =====================================================================

-- ==================== 1) catálogo de recursos ====================
create table if not exists public.recursos_catalogo (
  chave text primary key check (chave ~ '^[a-z][a-z0-9_]{0,39}$'),
  nome text not null,
  descricao text not null default '',
  icone text not null default '🧩',
  padrao boolean not null,
  ordem int not null default 100
);
alter table public.recursos_catalogo enable row level security;
drop policy if exists "logado le o catalogo de recursos" on public.recursos_catalogo;
create policy "logado le o catalogo de recursos" on public.recursos_catalogo for select to authenticated using (true);
revoke all on public.recursos_catalogo from public, anon, authenticated;
grant select on public.recursos_catalogo to authenticated;

insert into public.recursos_catalogo (chave, nome, descricao, icone, padrao, ordem) values
  ('desafios',    'Desafios entre unidades', 'Duelos e desafios da semana entre as unidades.', '🏁', true, 10),
  ('chefao',      'Chefão',                  'A batalha do clube contra o chefão (aba no menu).', '⚔️', true, 20),
  ('missoes',     'Missões diárias',         'Missão do dia com quiz ou foto para aprovar.', '🎯', true, 30),
  ('jogos',       'Jogos',                   'Trilha de jogos e ranking dos jogos.', '🎮', true, 40),
  ('leilao',      'Leilão',                  'As unidades dão lances com os pontos da temporada.', '🏛️', false, 50),
  ('chat',        'Chat',                    'Conversas do clube, da unidade e diretas.', '💬', true, 60),
  ('biblia',      'Bíblia',                  'Leitura e progresso da Bíblia.', '📖', true, 70),
  ('bichinho',    'Bichinho',                'O bichinho virtual de cada desbravador.', '🐾', true, 80),
  ('agenda',      'Agenda',                  'Reuniões e eventos do clube.', '📅', true, 90),
  ('atividades',  'Atividades',              'Atividades com entrega e aprovação.', '📋', true, 100),
  ('mural',       'Mural de fotos',          'Álbuns de fotos do clube.', '📸', true, 110),
  ('mensalidades','Mensalidades',            'Controle de pagamentos (tesouraria).', '💰', true, 120)
on conflict (chave) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, padrao = excluded.padrao, ordem = excluded.ordem;

-- `club_features.feature` só aceitava 'leilao' (check da migration 7); agora aceita QUALQUER recurso do catálogo (e só eles: chave estrangeira).
-- As linhas que existem hoje só têm 'leilao', que está no catálogo.
alter table public.club_features drop constraint if exists club_features_feature_valida;
alter table public.club_features drop constraint if exists club_features_feature_catalogo_fkey;
alter table public.club_features add constraint club_features_feature_catalogo_fkey
  foreign key (feature) references public.recursos_catalogo (chave) on update cascade;

-- o gate de dados do leilão (`leilao_habilitado`) e os gatilhos usam esta função: agora com o padrão do catálogo
create or replace function public.recurso_habilitado_no_clube(p_club_id uuid, p_feature text) returns boolean
language sql stable security definer set search_path = 'public' as $$
  select coalesce(
    (select enabled from public.club_features where club_id = p_club_id and feature = p_feature),
    (select padrao from public.recursos_catalogo where chave = p_feature),
    false);
$$;

-- mapa {recurso: ligado?} de TODOS os recursos do catálogo para um clube (escolha do clube, senão o padrão). Interna.
create or replace function public.recursos_do_clube(p_club_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.chave, coalesce(f.enabled, c.padrao)), '{}'::jsonb)
  from public.recursos_catalogo c
  left join public.club_features f on f.club_id = p_club_id and f.feature = c.chave;
$$;
revoke all on function public.recursos_do_clube(uuid) from public, anon, authenticated;

-- liga/desliga um recurso do PRÓPRIO clube (liderança). O catálogo manda: recurso desconhecido é recusado.
create or replace function public.recurso_definir(p_feature text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas a liderança do clube).';
  end if;
  if p_enabled is null then
    raise exception 'Informe se o recurso fica ligado ou desligado.';
  end if;
  if not exists (select 1 from public.recursos_catalogo where chave = p_feature) then
    raise exception 'Recurso desconhecido.';
  end if;
  -- desligar o leilão com leilão em andamento esconderia a tela com pontos das unidades em jogo
  if p_feature = 'leilao' and not p_enabled
     and exists (select 1 from public.leiloes where club_id = v_club and status = 'aberto') then
    raise exception 'Há leilão aberto: encerre ou cancele antes de desligar o leilão.';
  end if;
  insert into public.club_features (club_id, feature, enabled) values (v_club, p_feature, p_enabled)
  on conflict (club_id, feature) do update set enabled = excluded.enabled, updated_at = now();
  return public.recursos_do_clube(v_club);
end;
$$;
revoke all on function public.recurso_definir(text, boolean) from public, anon;
grant execute on function public.recurso_definir(text, boolean) to authenticated;

-- ==================== 2) marca (branding) por clube ====================
-- "Filhos da Conquista" -> "FC"; "Clube B (teste)" -> "CB" (as duas primeiras palavras que importam)
create or replace function public._sigla_do_nome(p_nome text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif((
    select string_agg(upper(left(p.w, 1)), '' order by p.n)
    from (
      select w, n from (
        select regexp_replace(x.w, '[^[:alnum:]]', '', 'g') as w, x.n
        from unnest(regexp_split_to_array(btrim(coalesce(p_nome, '')), '\s+')) with ordinality as x(w, n)
      ) y
      where y.w <> '' and lower(y.w) not in ('da', 'de', 'do', 'das', 'dos', 'e')
      order by n limit 2
    ) p
  ), ''), '?');
$$;
revoke all on function public._sigla_do_nome(text) from public, anon, authenticated;

-- marca EFETIVA de um clube: o que ele definiu, senão derivado do nome do clube. Interna (só o meu_contexto entrega ao app).
create or replace function public.clube_marca(p_club_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'nome', coalesce(nullif(u.metadata #>> '{marca,nome}', ''), u.nome),
    'sigla', coalesce(nullif(u.metadata #>> '{marca,sigla}', ''), public._sigla_do_nome(u.nome)),
    'lema', nullif(u.metadata #>> '{marca,lema}', ''),
    'descricao', nullif(u.metadata #>> '{marca,descricao}', ''),
    'desde', case when (u.metadata #>> '{marca,desde}') ~ '^\d{4}$' then (u.metadata #>> '{marca,desde}')::int end,
    'cor_primaria', nullif(u.metadata #>> '{marca,cor_primaria}', ''),
    'cor_secundaria', nullif(u.metadata #>> '{marca,cor_secundaria}', ''),
    'logo_url', nullif(u.metadata #>> '{marca,logo_url}', '')
  ))
  from public.organizational_units u where u.id = p_club_id;
$$;
revoke all on function public.clube_marca(uuid) from public, anon, authenticated;

-- grava a marca do PRÓPRIO clube (liderança). Só campos conhecidos; null ou vazio volta ao padrão; erro claro para o que não vale.
create or replace function public.clube_marca_gravar(p_marca jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_atual jsonb;
  v_novo jsonb;
  v_chave text;
  v_valor text;
  v_permitidas constant text[] := array['nome', 'sigla', 'lema', 'descricao', 'desde', 'cor_primaria', 'cor_secundaria', 'logo_url'];
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas a liderança do clube).';
  end if;
  if p_marca is null or jsonb_typeof(p_marca) <> 'object' then
    raise exception 'Formato inválido: envie um objeto com os campos da marca.';
  end if;
  select coalesce(u.metadata -> 'marca', '{}'::jsonb) into v_atual from public.organizational_units u where u.id = v_club for update;
  v_novo := v_atual;

  for v_chave in select jsonb_object_keys(p_marca) loop
    if not (v_chave = any (v_permitidas)) then
      raise exception 'Campo desconhecido: %.', v_chave;
    end if;
    if jsonb_typeof(p_marca -> v_chave) = 'null' or btrim(coalesce(p_marca ->> v_chave, '')) = '' then
      v_novo := v_novo - v_chave;                      -- limpar = voltar ao padrão
      continue;
    end if;
    v_valor := btrim(p_marca ->> v_chave);
    if v_valor ~ '[[:cntrl:]]' or v_valor ~ '[<>]' then
      raise exception 'O campo % tem caracteres não permitidos.', v_chave;
    end if;
    case v_chave
      when 'nome' then
        if length(v_valor) not between 2 and 60 then raise exception 'O nome deve ter de 2 a 60 caracteres.'; end if;
      when 'sigla' then
        if v_valor !~ '^[[:alnum:]]{1,4}$' then raise exception 'A sigla deve ter de 1 a 4 letras ou números.'; end if;
        v_valor := upper(v_valor);
      when 'lema' then
        if length(v_valor) > 80 then raise exception 'O lema deve ter no máximo 80 caracteres.'; end if;
      when 'descricao' then
        if length(v_valor) > 120 then raise exception 'A descrição deve ter no máximo 120 caracteres.'; end if;
      when 'desde' then
        if v_valor !~ '^\d{4}$' or v_valor::int not between 1900 and extract(year from now())::int + 1 then
          raise exception 'O ano de fundação deve estar entre 1900 e %.', extract(year from now())::int + 1;
        end if;
      when 'cor_primaria', 'cor_secundaria' then
        if v_valor !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Cor inválida em %: use o formato #rrggbb.', v_chave; end if;
        v_valor := lower(v_valor);
      when 'logo_url' then
        -- só arquivo do bucket público, na pasta DO PRÓPRIO clube (o app não carrega imagem de terceiro; e a pasta só aceita gravação da
        -- liderança daquele clube). Reenviar o valor que já está gravado não é erro.
        if v_valor is distinct from (v_atual ->> 'logo_url')
           and (length(v_valor) > 500 or v_valor !~ ('^https?://[^/]+/storage/v1/object/public/publico/' || v_club::text || '/[^/?#]+$')) then
          raise exception 'A logo precisa ser um arquivo do bucket "publico", na pasta do próprio clube.';
        end if;
      else null;
    end case;
    v_novo := v_novo || jsonb_build_object(v_chave, case when v_chave = 'desde' then to_jsonb(v_valor::int) else to_jsonb(v_valor) end);
  end loop;

  update public.organizational_units set metadata = jsonb_set(metadata, '{marca}', v_novo, true), updated_at = now() where id = v_club;
  return public.clube_marca(v_club);
end;
$$;
revoke all on function public.clube_marca_gravar(jsonb) from public, anon;
grant execute on function public.clube_marca_gravar(jsonb) to authenticated;

-- ==================== 3) o contexto da sessão ====================
create or replace function public.meu_contexto() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_atual uuid := public.clube_atual_id();
begin
  if v_uid is null then
    return jsonb_build_object('usuario_id', null, 'clube_atual_id', null, 'vinculos', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'usuario_id', v_uid,
    'clube_atual_id', v_atual,     -- o clube em que o SERVIDOR age (RLS/RPCs): o app só pode "trocar" para um vínculo selecionável
    'vinculos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'club_id', u.id,
        'nome', u.nome,
        'slug', u.slug,
        'timezone', u.timezone,
        'papel', m.role,                                   -- o papel é do VÍNCULO (não da pessoa)
        'status', m.status,
        'selecionavel', (m.status = 'ativo' and u.id is not distinct from v_atual),
        'unidade_id', un.id,                               -- a unidade só vale NO clube dela
        'unidade_nome', un.nome,
        'marca', public.clube_marca(u.id),
        'recursos', public.recursos_do_clube(u.id)
      ) order by (u.id is not distinct from v_atual) desc, m.starts_at, m.created_at)
      from public.organization_memberships m
      join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
      left join public.profiles p on p.id = m.user_id
      left join public.unidades un on un.id = p.unidade_id and un.club_id = u.id
      where m.user_id = v_uid
        and m.status in ('pendente', 'ativo', 'suspenso')
        and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.meu_contexto() from public, anon;
grant execute on function public.meu_contexto() to authenticated;

-- ==================== 4) o Tenant 001 mantém a marca de sempre (dado, não código) ====================
-- (só se ainda não tiver marca: a liderança pode ter editado depois; nunca sobrescreve)
update public.organizational_units
   set metadata = jsonb_set(metadata, '{marca}', jsonb_build_object(
         'lema', 'Desbravadores · 1994',
         'descricao', 'Clube de Desbravadores · 1994',
         'desde', 1994,
         'logo_url', '/icon-192.png'), true)
 where slug = 'filhos-da-conquista' and type = 'clube' and not (metadata ? 'marca');
