-- Dados exclusivamente locais para validar isolamento multi-tenant.
-- IDs fixos tornam o seed idempotente e facilitam os testes automatizados.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new,
  email_change, phone_change, phone_change_token,
  email_change_token_current, reauthentication_token,
  is_sso_user, is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'tenant001@local.test',
    crypt('local-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nome":"Usuário Tenant 001"}'::jsonb,
    now(), now(), '', '', '', '', '', '', '', '', false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'tenant002@local.test',
    crypt('local-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nome":"Usuário Tenant 002"}'::jsonb,
    now(), now(), '', '', '', '', '', '', '', '', false, false
  )
on conflict (id) do update
set email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

-- Os dois usuários de teste são a liderança (diretoria) do seu clube. O cadastro (handle_new_user,
-- ao inserir em auth.users acima) já criou um vínculo desbravador/pendente no clube legado pra cada
-- um (não tem unidade_id no raw_user_meta_data) — apaga esse vínculo automático antes de inserir o
-- de verdade. profiles.papel/status são só um ESPELHO do clube primário agora (não são a fonte).
delete from public.organization_memberships
where user_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
  and metadata->>'source' = 'cadastro';

insert into public.organizational_units (
  type, nome, slug, pais, timezone, metadata
)
values (
  'clube',
  'Clube Teste Tenant 002',
  'clube-teste-tenant-002',
  'BR',
  'America/Recife',
  '{"tenant":"002","environment":"local","test_only":true}'::jsonb
)
on conflict (slug) do update
set nome = excluded.nome,
    metadata = excluded.metadata,
    updated_at = now();

insert into public.organization_memberships (
  user_id, organizational_unit_id, role, status, metadata
)
select
  '00000000-0000-0000-0000-000000000001', id, 'diretoria', 'ativo',
  '{"seed":"local"}'::jsonb
from public.organizational_units
where slug = 'filhos-da-conquista'
on conflict do nothing;

-- O usuário 002 pertence ao clube de teste (não ao legado): troca o vínculo.
delete from public.organization_memberships
where user_id = '00000000-0000-0000-0000-000000000002';

insert into public.organization_memberships (
  user_id, organizational_unit_id, role, status, metadata
)
select
  '00000000-0000-0000-0000-000000000002', id, 'diretoria', 'ativo',
  '{"seed":"local"}'::jsonb
from public.organizational_units
where slug = 'clube-teste-tenant-002'
on conflict do nothing;

-- Cada clube inicia com a própria temporada. O Tenant 001 já recebe a
-- temporada histórica pela migration legada; esta linha cria só a do Tenant 002.
insert into public.temporadas (club_id, numero, inicio)
select id, 1, '-infinity'::timestamptz
from public.organizational_units
where slug = 'clube-teste-tenant-002'
  and not exists (
    select 1 from public.temporadas t
    where t.club_id = public.organizational_units.id
  );

insert into public.unidades (nome, cor, club_id)
select 'Unidade Tenant 001', '#1d4ed8', id
from public.organizational_units
where slug = 'filhos-da-conquista'
on conflict (club_id, nome) do update set cor = excluded.cor;

insert into public.unidades (nome, cor, club_id)
select 'Unidade Tenant 002', '#7c3aed', id
from public.organizational_units
where slug = 'clube-teste-tenant-002'
on conflict (club_id, nome) do update set cor = excluded.cor;

insert into public.atividades (titulo, descricao, pontos, club_id)
select 'Atividade Tenant 001', 'Dado de isolamento local', 10, id
from public.organizational_units where slug = 'filhos-da-conquista';

insert into public.atividades (titulo, descricao, pontos, club_id)
select 'Atividade Tenant 002', 'Dado de isolamento local', 20, id
from public.organizational_units where slug = 'clube-teste-tenant-002';

insert into public.eventos (titulo, tipo, data, criado_por, club_id)
select 'Evento Tenant 001', 'Reunião', current_date + 7,
       '00000000-0000-0000-0000-000000000001', id
from public.organizational_units where slug = 'filhos-da-conquista';

insert into public.eventos (titulo, tipo, data, criado_por, club_id)
select 'Evento Tenant 002', 'Reunião', current_date + 7,
       '00000000-0000-0000-0000-000000000002', id
from public.organizational_units where slug = 'clube-teste-tenant-002';

insert into public.entregas (atividade_id, usuario_id, texto, club_id)
select a.id, '00000000-0000-0000-0000-000000000001', 'Entrega Tenant 001', a.club_id
from public.atividades a where a.titulo = 'Atividade Tenant 001';

insert into public.entregas (atividade_id, usuario_id, texto, club_id)
select a.id, '00000000-0000-0000-0000-000000000002', 'Entrega Tenant 002', a.club_id
from public.atividades a where a.titulo = 'Atividade Tenant 002';

insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
values ('00000000-0000-0000-0000-000000000001', 'seed', 10, 'Ponto Tenant 001', public.clube_legado_id());

insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
select '00000000-0000-0000-0000-000000000002', 'seed', 20, 'Ponto Tenant 002', id
from public.organizational_units where slug = 'clube-teste-tenant-002';

insert into public.fotos (url, legenda, autor_id)
values ('https://example.test/tenant-001.jpg', 'Foto Tenant 001', '00000000-0000-0000-0000-000000000001');

insert into public.fotos (url, legenda, autor_id)
values ('https://example.test/tenant-002.jpg', 'Foto Tenant 002', '00000000-0000-0000-0000-000000000002');

insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por, chave_push)
values ('Aviso Tenant 001', 'Dado de isolamento local', 'geral', '/', 'todos', '00000000-0000-0000-0000-000000000001', '');

insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por, chave_push)
values ('Aviso Tenant 002', 'Dado de isolamento local', 'geral', '/', 'todos', '00000000-0000-0000-0000-000000000002', '');

insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
values ('00000000-0000-0000-0000-000000000001', 1, 2026, 50, 'pago', '00000000-0000-0000-0000-000000000001');
insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
values ('00000000-0000-0000-0000-000000000002', 1, 2026, 60, 'pendente', '00000000-0000-0000-0000-000000000002');
