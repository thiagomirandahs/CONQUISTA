// Script AUXILIAR (não é gate) — semeia a hierarquia completa + 1 persona de cada papel pra
// homologação do piloto (fase final): uniao > campo > regiao > distrito_a/distrito_b > clube_a/clube_b,
// com desbravador, responsável, conselheiro, instrutor, diretoria (nos 2 clubes), coordenador
// distrital/regional/geral, diretor_mda, admin da plataforma, pessoa multi-clube e pessoa acumulando
// cargos (clube + institucional). Roda contra o Supabase local. Prefixo "hml-" em tudo; apaga antes
// de semear. NUNCA toca em produção (URL fixa em 127.0.0.1 via docker exec).
import { execFileSync } from 'node:child_process'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const SENHA = 'senha-homologacao-123'

function sql(texto) {
  return execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' })
}
const uid = (k) => `md5('hml:${k}')::uuid`

const PESSOAS = [
  ['desbravador', 'Hml Desbravador'],
  ['desbravador2', 'Hml Desbravador Dois'], // pra teste de "outra criança"
  ['responsavel', 'Hml Responsavel'],
  ['responsavel2', 'Hml Responsavel Dois'],
  ['conselheiro', 'Hml Conselheiro'],
  ['instrutor', 'Hml Instrutor'],
  ['diretoria_a', 'Hml Diretoria A'],
  ['diretoria_b', 'Hml Diretoria B'],
  ['coord_dist', 'Hml Coordenador Distrital'],
  ['coord_reg', 'Hml Coordenador Regional'],
  ['coord_campo', 'Hml Coordenador Geral (Campo)'],
  ['diretor_mda', 'Hml Diretor MDA (Uniao)'],
  ['admin', 'Hml Admin Plataforma'],
  ['multi', 'Hml Multi Clube'],
  ['acumula', 'Hml Acumula Cargos'],
]

function limparSql() {
  return `
    set session_replication_role = replica;
    delete from public.responsavel_consentimentos where responsavel_id in (select id from auth.users where email like 'hml-%@teste.local');
    delete from public.responsaveis where responsavel_id in (select id from auth.users where email like 'hml-%@teste.local') or desbravador_id in (select id from auth.users where email like 'hml-%@teste.local');
    delete from public.platform_admins where user_id in (select id from auth.users where email like 'hml-%@teste.local');
    delete from public.mensalidades where desbravador_id in (select id from auth.users where email like 'hml-%@teste.local');
    delete from public.pontos where usuario_id in (select id from auth.users where email like 'hml-%@teste.local');
    delete from public.organization_memberships where user_id in (select id from auth.users where email like 'hml-%@teste.local');
    delete from public.profiles where id in (select id from auth.users where email like 'hml-%@teste.local');
    delete from auth.users where email like 'hml-%@teste.local';
    delete from public.organizational_units where slug like 'hml-%';
  `
}

function principal() {
  if (process.argv[2] === '--limpar') { sql(limparSql()); console.log('limpo.'); return }

  sql(limparSql())

  const inserts = PESSOAS.map(([k, nome]) => `
    ('00000000-0000-0000-0000-000000000000', ${uid(k)}, 'authenticated', 'authenticated', 'hml-${k}@teste.local',
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false)`).join(',\n')

  sql(`
    set session_replication_role = replica;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    values ${inserts};

    insert into public.profiles (id, nome, papel, status)
    select id, raw_user_meta_data->>'nome', 'desbravador', 'ativo' from auth.users where email like 'hml-%@teste.local';
    update auth.users set raw_user_meta_data = jsonb_build_object('nome',
      case email
        ${PESSOAS.map(([k, nome]) => `when 'hml-${k}@teste.local' then '${nome}'`).join('\n        ')}
      end) where email like 'hml-%@teste.local';
    update public.profiles p set nome = u.raw_user_meta_data->>'nome' from auth.users u where u.id = p.id and u.email like 'hml-%@teste.local';

    -- hierarquia: uniao > campo > regiao > distrito_a/distrito_b ; clube_a sob distrito_a, clube_b sob distrito_b
    insert into public.organizational_units (type, nome, slug, pais, timezone)
    values
      ('uniao', 'Hml Uniao', 'hml-uniao', 'BR', 'America/Recife'),
      ('campo', 'Hml Campo', 'hml-campo', 'BR', 'America/Recife'),
      ('regiao', 'Hml Regiao', 'hml-regiao', 'BR', 'America/Recife'),
      ('distrito', 'Hml Distrito A', 'hml-distrito-a', 'BR', 'America/Recife'),
      ('distrito', 'Hml Distrito B', 'hml-distrito-b', 'BR', 'America/Recife'),
      ('clube', 'Hml Clube A', 'hml-clube-a', 'BR', 'America/Recife'),
      ('clube', 'Hml Clube B', 'hml-clube-b', 'BR', 'America/Recife');
    update public.organizational_units set parent_id = (select id from public.organizational_units where slug='hml-uniao') where slug='hml-campo';
    update public.organizational_units set parent_id = (select id from public.organizational_units where slug='hml-campo') where slug='hml-regiao';
    update public.organizational_units set parent_id = (select id from public.organizational_units where slug='hml-regiao') where slug in ('hml-distrito-a','hml-distrito-b');
    update public.organizational_units set parent_id = (select id from public.organizational_units where slug='hml-distrito-a') where slug='hml-clube-a';
    update public.organizational_units set parent_id = (select id from public.organizational_units where slug='hml-distrito-b') where slug='hml-clube-b';

    insert into public.club_features (club_id, feature, enabled)
    select id, f.feature, true from public.organizational_units o, (values ('classes'),('mensalidades'),('mural'),('chat'),('agenda')) f(feature)
    where o.slug in ('hml-clube-a','hml-clube-b');

    insert into public.unidades (nome, cor, club_id) select 'Hml Unidade A1', '#22c55e', id from public.organizational_units where slug='hml-clube-a';
    insert into public.temporadas (club_id, numero, inicio) select id, 1, now() from public.organizational_units where slug in ('hml-clube-a','hml-clube-b');

    -- vínculos de clube
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('desbravador')}, id, 'desbravador', 'ativo' from public.organizational_units where slug='hml-clube-a';

    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('desbravador2')}, id, 'desbravador', 'ativo' from public.organizational_units where slug='hml-clube-b';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('conselheiro')}, id, 'conselheiro', 'ativo' from public.organizational_units where slug='hml-clube-a';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('instrutor')}, id, 'instrutor', 'ativo' from public.organizational_units where slug='hml-clube-a';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('diretoria_a')}, id, 'diretoria', 'ativo' from public.organizational_units where slug='hml-clube-a';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('diretoria_b')}, id, 'diretoria', 'ativo' from public.organizational_units where slug='hml-clube-b';

    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('coord_dist')}, id, 'coordenador_distrital', 'ativo' from public.organizational_units where slug='hml-distrito-a';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('coord_reg')}, id, 'coordenador_regional', 'ativo' from public.organizational_units where slug='hml-regiao';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('coord_campo')}, id, 'coordenador_geral', 'ativo' from public.organizational_units where slug='hml-campo';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('diretor_mda')}, id, 'diretor_mda', 'ativo' from public.organizational_units where slug='hml-uniao';

    -- multi-clube: vínculo ativo nos DOIS clubes
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('multi')}, id, 'desbravador', 'ativo' from public.organizational_units where slug='hml-clube-a';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('multi')}, id, 'conselheiro', 'ativo' from public.organizational_units where slug='hml-clube-b';

    -- acumula cargos: diretoria do clube A E coordenador distrital do distrito A ao mesmo tempo
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('acumula')}, id, 'diretoria', 'ativo' from public.organizational_units where slug='hml-clube-a';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('acumula')}, id, 'coordenador_distrital', 'ativo' from public.organizational_units where slug='hml-distrito-a';

    -- admin da plataforma (tabela própria, não é vínculo de clube)
    insert into public.platform_admins (user_id, papel) values (${uid('admin')}, 'owner');

    -- vínculo de CLUBE do responsável (role 'pais') — sem isso clube_atual_id() nunca resolve pra
    -- ele, e meus_filhos() (que filtra por r.club_id = clube_atual_id()) sempre devolve vazio.
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('responsavel')}, id, 'pais', 'ativo' from public.organizational_units where slug='hml-clube-a';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select ${uid('responsavel2')}, id, 'pais', 'ativo' from public.organizational_units where slug='hml-clube-b';

    -- responsável 1 -> desbravador (vínculo aprovado, clube A)
    insert into public.responsaveis (responsavel_id, desbravador_id, club_id, nome_digitado, status)
    select ${uid('responsavel')}, ${uid('desbravador')}, o.id, 'Hml Desbravador', 'aprovado'
    from public.organizational_units o where o.slug='hml-clube-a';
    -- responsável 2 -> desbravador2 (outro clube, outra criança — pra ataques)
    insert into public.responsaveis (responsavel_id, desbravador_id, club_id, nome_digitado, status)
    select ${uid('responsavel2')}, ${uid('desbravador2')}, o.id, 'Hml Desbravador Dois', 'aprovado'
    from public.organizational_units o where o.slug='hml-clube-b';

    -- alguns pontos/mensalidade pra telas não ficarem 100% vazias
    insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
    select ${uid('desbravador')}, 'seed', 15, 'Homologação [TESTE]', id from public.organizational_units where slug='hml-clube-a';
    insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por, club_id)
    select ${uid('desbravador')}, 1, 2026, 40, 'pendente', ${uid('diretoria_a')}, id from public.organizational_units where slug='hml-clube-a';
  `)

  console.log(JSON.stringify({ senha: SENHA, contas: Object.fromEntries(PESSOAS.map(([k]) => [k, `hml-${k}@teste.local`])) }, null, 2))
}

principal()
