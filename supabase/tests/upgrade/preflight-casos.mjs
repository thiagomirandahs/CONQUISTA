// Casos NEGATIVOS do pré-voo de produção (scripts/testar-preflight.mjs). Cada caso estraga UMA
// pré-condição do upgrade no estado legado (migrations 20260701..20260909 + pre_dados.sql, com o
// ledger do CLI já criado), numa transação que termina em ROLLBACK, e diz qual verificação do
// supabase/PREFLIGHT-PRODUCAO.sql tem de acusar.
//   nome        — o que o caso simula
//   verificacao — regex que casa com o id da linha do pré-voo (a coluna `verificacao`)
//   sabotagem   — SQL rodado como supabase_admin antes do pré-voo (que roda como postgres)
//   esperado    — 'PROBLEMA' (padrão) ou 'AVISO'; 'ok' prova o caminho de volta (a verificação
//                 fica verde quando a pré-condição é cumprida)
//   detalhe     — (opcional) regex que o detalhe da linha tem de casar ("não lê o schema cron",
//                 "travada"...): prova o motivo, não só a cor
//
// Chaves dos dados: md5('up:<chave>')::uuid (dir, ins, tes, con, d1, d2, d3, pend, rej, pai).
// Nenhum dado aqui é real; tudo volta no ROLLBACK.

const id = (s) => new RegExp(`^${s}$`)

// Restos do Cartão de Classe (git 34c65eb) já sem as 2 policies com pode_gerir(): tabelas só de produção,
// sem club_id e fora do inventário, com FK para profiles, policy e gatilho. Nenhuma migration as toca.
const CARTAO_DE_CLASSE = `create table public.classe_requisitos (id uuid primary key, criado_por uuid references public.profiles(id));
create table public.requisito_cumprido (id uuid primary key, requisito_id uuid references public.classe_requisitos(id),
  usuario_id uuid references public.profiles(id));
alter table public.classe_requisitos enable row level security;
alter table public.requisito_cumprido enable row level security;
create policy "ler classe_requisitos" on public.classe_requisitos for select using (true);
create policy "ler requisito_cumprido" on public.requisito_cumprido for select to authenticated using (usuario_id = auth.uid());
create function public.tg_requisito() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger tg_requisito before update on public.requisito_cumprido for each row execute function public.tg_requisito();`

// Outra sessão (dblink) com AccessExclusiveLock em public.profiles. O lock_timeout é a rede de segurança
// do arnês: se a guarda falhar, o caso quebra em 10 s em vez de travar. A conexão cai com o psql.
const TRAVA_PROFILES = `set local lock_timeout = '10s';
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect('trava', 'dbname=' || current_database() || ' user=supabase_admin');
select extensions.dblink_exec('trava', 'begin');
select extensions.dblink_exec('trava', 'lock table public.profiles in access exclusive mode');`

export const CASOS = [
  // ---------------------------------------------------------------- upgrade-parcial-ou-objetos-saas
  { nome: 'tabela do SaaS criada à mão antes da janela (subscriptions)', verificacao: id('upgrade-parcial-ou-objetos-saas'),
    sabotagem: `create table public.subscriptions (id int);` },
  { nome: 'função do SaaS já existe (clube_atual_id)', verificacao: id('upgrade-parcial-ou-objetos-saas'),
    sabotagem: `create function public.clube_atual_id() returns uuid language sql as $$ select null::uuid $$;` },
  { nome: 'ledger legado já registra migration do SaaS', verificacao: id('upgrade-parcial-ou-objetos-saas'),
    sabotagem: `insert into public.migracoes_aplicadas (arquivo) values ('2026-09-21-fundacao-saas-multitenant.sql');` },
  { nome: 'ledger do CLI já registra a 01 (upgrade parcial)', verificacao: id('upgrade-parcial-ou-objetos-saas'),
    sabotagem: `insert into supabase_migrations.schema_migrations (version, name) values ('20260921000001', 'fundacao-saas-multitenant');` },
  { nome: 'upgrade parado depois da 59 (mensalidades_ano já existe)', verificacao: id('upgrade-parcial-ou-objetos-saas'),
    sabotagem: `create function public.mensalidades_ano(p_ano integer) returns void language sql as $$ select $$;` },
  { nome: 'hotfix legado no ledger (2026-09-26-...) não é upgrade parcial', verificacao: id('upgrade-parcial-ou-objetos-saas'), esperado: 'ok',
    sabotagem: `insert into public.migracoes_aplicadas (arquivo) values ('2026-09-26-hotfix-ranking-legado.sql');` },
  { nome: 'versão do ledger do CLI com U+FFFF e controle (não derruba o XML)', verificacao: id('upgrade-parcial-ou-objetos-saas'),
    detalhe: /ledger do CLI já registra a versão 20260930000099/,
    sabotagem: `insert into supabase_migrations.schema_migrations (version) values ('20260930000099' || chr(65535) || chr(1));` },
  { nome: 'sem USAGE no schema do ledger do CLI: acusa, não cai', verificacao: id('ledger-do-cli-supabase_migrations-ausente'),
    detalhe: /falta USAGE no schema/,
    sabotagem: `revoke pg_read_all_data from postgres; revoke usage on schema supabase_migrations from postgres, public, anon, authenticated, service_role;` },

  // ---------------------------------------------------------------- ledger-do-cli-supabase_migrations-ausente
  { nome: 'produção sem o ledger do CLI (nunca usou o CLI)', verificacao: id('ledger-do-cli-supabase_migrations-ausente'),
    sabotagem: `drop schema supabase_migrations cascade;` },
  { nome: 'ledger do CLI existe mas postgres não grava nele', verificacao: id('ledger-do-cli-supabase_migrations-ausente'),
    sabotagem: `revoke insert on supabase_migrations.schema_migrations from postgres;` },

  // ---------------------------------------------------------------- papel-ou-status-fora-do-vocabulario
  { nome: "papel grafado diferente ('Diretoria')", verificacao: id('papel-ou-status-fora-do-vocabulario'),
    sabotagem: `update public.profiles set papel = 'Diretoria' where id = md5('up:dir')::uuid;` },
  { nome: "status grafado diferente ('Ativo')", verificacao: id('papel-ou-status-fora-do-vocabulario'),
    sabotagem: `update public.profiles set status = 'Ativo' where id = md5('up:d2')::uuid;` },

  // ---------------------------------------------------------------- dados-que-violam-constraints-novas
  { nome: 'unidade com nome repetido (03)', verificacao: id('dados-que-violam-constraints-novas'),
    sabotagem: `insert into public.unidades (nome, cor) select nome, cor from public.unidades where nome = 'Águias';` },
  { nome: 'duas temporadas abertas com o mesmo número (08)', verificacao: id('dados-que-violam-constraints-novas'),
    sabotagem: `drop index public.uma_temporada_aberta; insert into public.temporadas (numero, inicio) values (1, now());` },
  { nome: 'mensalidade repetida sem a unique legada (11)', verificacao: id('dados-que-violam-constraints-novas'),
    sabotagem: `alter table public.mensalidades drop constraint mensalidades_desbravador_id_mes_ano_key;
insert into public.mensalidades (desbravador_id, mes, ano, valor, status) values (md5('up:d1')::uuid, 1, 2026, 50, 'pendente');` },
  { nome: 'dois leilões abertos (23)', verificacao: id('dados-que-violam-constraints-novas'),
    sabotagem: `drop index public.um_leilao_aberto;
insert into public.leiloes (titulo, fecha_em, criado_por) values ('Outro leilão', now() + interval '3 days', md5('up:dir')::uuid);` },
  { nome: 'duas conversas do tipo geral (25)', verificacao: id('dados-que-violam-constraints-novas'),
    sabotagem: `drop index public.uma_conversa_geral; insert into public.chat_conversas (tipo) values ('geral');` },
  { nome: 'liberação de jogo fora do catálogo (24)', verificacao: id('dados-que-violam-constraints-novas'),
    sabotagem: `alter table public.jogos_liberados drop constraint jogos_liberados_chave_fkey;
insert into public.jogos_liberados (chave, data) values ('jogo-fantasma', current_date - 1);` },

  // ---------------------------------------------------------------- colunas-legadas-ausentes-ou-divergentes
  { nome: 'coluna pontos.marca ausente (a 16 aborta)', verificacao: id('colunas-legadas-ausentes-ou-divergentes'),
    sabotagem: `alter table public.pontos drop column marca;` },
  { nome: 'profiles.nascimento em text (a 39 aborta)', verificacao: id('colunas-legadas-ausentes-ou-divergentes'),
    sabotagem: `alter table public.profiles alter column nascimento type text;` },
  { nome: 'coluna só de produção NOT NULL sem default', verificacao: id('colunas-legadas-ausentes-ou-divergentes'),
    sabotagem: `alter table public.pontos add column x int not null default 0; alter table public.pontos alter column x drop default;` },
  { nome: 'tabela legada inteira ausente (push_tokens)', verificacao: id('colunas-legadas-ausentes-ou-divergentes'),
    sabotagem: `drop table public.push_tokens;` },

  // ---------------------------------------------------------------- funcoes-legadas-ausentes-ou-com-assinatura-diferente
  { nome: 'sobrecarga antiga registrar_jogo(text, int)', verificacao: id('funcoes-legadas-ausentes-ou-com-assinatura-diferente'),
    sabotagem: `create function public.registrar_jogo(text, int) returns json language sql as $$ select '{}'::json $$;` },
  { nome: 'fechar_leiloes_vencidos com outra assinatura (a 15 aborta)', verificacao: id('funcoes-legadas-ausentes-ou-com-assinatura-diferente'),
    sabotagem: `drop function public.fechar_leiloes_vencidos();
create function public.fechar_leiloes_vencidos(p int) returns void language sql as $$ select $$;` },
  { nome: 'função legada ausente (salvar_reuniao)', verificacao: id('funcoes-legadas-ausentes-ou-com-assinatura-diferente'),
    sabotagem: `drop function public.salvar_reuniao(date, text, jsonb);` },
  { nome: 'salvar_reuniao com um DEFAULT que o repo não tem (a 67 aborta)', verificacao: id('funcoes-legadas-ausentes-ou-com-assinatura-diferente'),
    detalhe: /cannot remove parameter defaults/,
    sabotagem: `create or replace function public.salvar_reuniao(p_data date, p_motivo text, p_itens jsonb default '[]') returns integer
language sql as $$ select 0 $$;` },

  // ---------------------------------------------------------------- objetos-legados-de-outro-dono
  { nome: 'função legada com dono supabase_admin (a 67 aborta: must be owner)', verificacao: id('objetos-legados-de-outro-dono'),
    sabotagem: `alter function public.salvar_reuniao(date, text, jsonb) owner to supabase_admin;` },
  { nome: 'tabela legada com dono supabase_admin (a 06 aborta: must be owner)', verificacao: id('objetos-legados-de-outro-dono'),
    detalhe: /tabela public\.fotos: dono supabase_admin/,
    sabotagem: `alter table public.fotos owner to supabase_admin; grant all on public.fotos to postgres;` },
  { nome: 'função legada com dono de papel que o postgres herda (service_role)', verificacao: id('objetos-legados-de-outro-dono'), esperado: 'ok',
    sabotagem: `alter function public.salvar_reuniao(date, text, jsonb) owner to service_role;` },

  // ---------------------------------------------------------------- funcoes-que-chamam-funcoes-dropadas
  { nome: 'função do Cartão de Classe chama pode_gerir()', verificacao: id('funcoes-que-chamam-funcoes-dropadas'),
    sabotagem: `create function public.avaliar_requisito(p uuid) returns void language plpgsql as $$
begin if not public.pode_gerir() then raise exception 'x'; end if; end $$;` },
  { nome: 'função que chama rodizio_ligado() (a 20/24 recriam: não some)', verificacao: id('funcoes-que-chamam-funcoes-dropadas'), esperado: 'ok',
    sabotagem: `create function public.meu_jogo_extra() returns boolean language plpgsql as $$ begin return public.rodizio_ligado(); end $$;` },

  // ---------------------------------------------------------------- dependentes-de-funcoes-dropadas
  { nome: 'view que depende de pode_gerir() (a 26 aborta no drop)', verificacao: id('dependentes-de-funcoes-dropadas'),
    sabotagem: `create view public.v_teste as select public.pode_gerir() as x;` },
  { nome: 'policy do Cartão de Classe com pode_gerir()', verificacao: id('dependentes-de-funcoes-dropadas'),
    sabotagem: `create table public.classe_requisitos (id uuid primary key);
alter table public.classe_requisitos enable row level security;
create policy "gerir classe_requisitos" on public.classe_requisitos for all using (public.pode_gerir()) with check (public.pode_gerir());` },

  // ---------------------------------------------------------------- policies-fora-do-repo
  { nome: "policy do painel TO public ('Enable read access for all users')", verificacao: id('policies-fora-do-repo'),
    sabotagem: `create policy "Enable read access for all users" on public.pontos for select using (true);` },
  { nome: "policy 'Public Access' no Storage", verificacao: id('policies-fora-do-repo'),
    sabotagem: `create policy "Public Access" on storage.objects for select using (bucket_id = 'imagens');` },
  { nome: 'policy de escrita sem predicado (a 68 aborta)', verificacao: id('policies-fora-do-repo'),
    sabotagem: `create policy x on public.pontos for delete to authenticated;` },
  { nome: 'policy para anon (a 72 aborta)', verificacao: id('policies-fora-do-repo'),
    sabotagem: `create policy x_anon on public.unidades for select to anon using (true);` },
  { nome: 'policy de tabela só de produção (Cartão de Classe) não para a janela', verificacao: id('policies-fora-do-repo'), esperado: 'ok',
    sabotagem: CARTAO_DE_CLASSE },

  // ---------------------------------------------------------------- constraints-e-indices-unicos-fora-do-padrao
  { nome: 'índice único de mensalidades com outro nome', verificacao: id('constraints-e-indices-unicos-fora-do-padrao'),
    sabotagem: `create unique index uq_mens_x on public.mensalidades (desbravador_id, mes, ano);` },
  { nome: 'CHECK manual em profiles.status (a 34 aborta)', verificacao: id('constraints-e-indices-unicos-fora-do-padrao'),
    sabotagem: `alter table public.profiles add constraint profiles_status_ck check (status in ('ativo', 'pendente', 'inativo', 'rejeitado'));` },
  { nome: 'PK de config_clube com outro nome (a 20 aborta)', verificacao: id('constraints-e-indices-unicos-fora-do-padrao'),
    sabotagem: `alter table public.config_clube rename constraint config_clube_pkey to config_pk;` },
  { nome: 'FK de tabela só de produção apoiada em config_clube_pkey (o drop da 20 aborta)', verificacao: id('constraints-e-indices-unicos-fora-do-padrao'),
    sabotagem: `create table public.config_extra (chave text references public.config_clube(chave));` },
  { nome: 'FK de tabela só de produção para profiles não para a janela', verificacao: id('constraints-e-indices-unicos-fora-do-padrao'), esperado: 'ok',
    sabotagem: CARTAO_DE_CLASSE },

  // ---------------------------------------------------------------- gatilhos-fora-do-repo
  { nome: 'gatilho de teto com outro nome, que ordena antes', verificacao: id('gatilhos-fora-do-repo'),
    sabotagem: `create trigger trg_a_teto before insert on public.pontos for each row execute function public.limita_pontos_conselheiro();` },
  { nome: 'on_auth_user_created desligado', verificacao: id('gatilhos-fora-do-repo'),
    sabotagem: `alter table auth.users disable trigger on_auth_user_created;` },
  { nome: 'gatilho de tabela só de produção não para a janela', verificacao: id('gatilhos-fora-do-repo'), esperado: 'ok',
    sabotagem: CARTAO_DE_CLASSE },
  { nome: 'sem USAGE em auth: a verificação de gatilhos não cai (auth.users pelo catálogo)', verificacao: id('gatilhos-fora-do-repo'), esperado: 'ok',
    sabotagem: `revoke pg_read_all_data from postgres; revoke usage on schema auth from postgres, public, anon, authenticated, service_role;` },

  // ---------------------------------------------------------------- extensoes-obrigatorias
  { nome: 'pg_cron desligado (a 53+ abortam)', verificacao: id('extensoes-obrigatorias'),
    sabotagem: `drop extension pg_cron;` },
  { nome: 'pgcrypto no schema public (a 44/45 abortam)', verificacao: id('extensoes-obrigatorias'),
    sabotagem: `alter extension pgcrypto set schema public;` },

  // ---------------------------------------------------------------- permissoes-do-papel-do-sql-editor
  // (no Supabase o postgres herda os privilégios de authenticated/anon/service_role: o revoke tem de tirar de todos)
  { nome: 'postgres sem TRIGGER em storage.objects (a 54 aborta)', verificacao: id('permissoes-do-papel-do-sql-editor'),
    sabotagem: `set local role supabase_storage_admin; revoke trigger on storage.objects from postgres, authenticated, anon, service_role cascade;` },
  { nome: 'postgres sem INSERT em storage.buckets (a 28 aborta)', verificacao: id('permissoes-do-papel-do-sql-editor'),
    sabotagem: `set local role supabase_storage_admin; revoke insert on storage.buckets from postgres, authenticated, anon, service_role cascade;` },
  { nome: 'Storage antigo, sem storage.objects.owner_id (a 31 aborta)', verificacao: id('permissoes-do-papel-do-sql-editor'),
    sabotagem: `alter table storage.objects rename column owner_id to owner_id_antigo;` },
  { nome: 'postgres sem USAGE no schema cron (a 53+ abortam)', verificacao: id('permissoes-do-papel-do-sql-editor'),
    detalhe: /sem USAGE no schema cron/,
    sabotagem: `revoke pg_read_all_data from postgres; revoke usage on schema cron from postgres, public, anon, authenticated, service_role;` },
  { nome: 'postgres sem USAGE no schema auth (as policies com auth.uid() abortam)', verificacao: id('permissoes-do-papel-do-sql-editor'),
    detalhe: /sem USAGE no schema auth/,
    sabotagem: `revoke pg_read_all_data from postgres; revoke usage on schema auth from postgres, public, anon, authenticated, service_role;` },
  { nome: 'postgres sem USAGE no schema extensions (pgcrypto)', verificacao: id('permissoes-do-papel-do-sql-editor'),
    detalhe: /sem USAGE no schema extensions/,
    sabotagem: `revoke pg_read_all_data from postgres; revoke usage on schema extensions from postgres, public, anon, authenticated, service_role;` },

  // ---------------------------------------------------------------- default-acl-de-funcoes
  { nome: 'default ACL de funções sem EXECUTE para authenticated', verificacao: id('default-acl-de-funcoes'),
    sabotagem: `alter default privileges for role postgres in schema public revoke execute on functions from authenticated;` },

  // ---------------------------------------------------------------- buckets-de-storage
  { nome: 'bucket comprovacoes ausente', verificacao: id('buckets-de-storage'),
    sabotagem: `set local storage.allow_delete_query = 'true'; delete from storage.buckets where id = 'comprovacoes';` },
  { nome: 'bucket comprovacoes público', verificacao: id('buckets-de-storage'),
    sabotagem: `update storage.buckets set public = true where id = 'comprovacoes';` },
  { nome: "bucket 'publico' já existe (a 31 reconfigura ou aborta)", verificacao: id('buckets-de-storage'),
    sabotagem: `insert into storage.buckets (id, name, public) values ('publico', 'publico', false);` },
  { nome: 'storage.buckets.public de outro tipo: a verificação diz que não conferiu, não cai', verificacao: id('buckets-de-storage'),
    detalhe: /tem outro tipo\) storage\.buckets\.public:boolean/,
    sabotagem: `alter table storage.buckets alter column public drop default; alter table storage.buckets alter column public type text;` },

  // ---------------------------------------------------------------- metadados-de-storage-que-abortam-a-54
  { nome: 'objeto com metadata.size não inteiro', verificacao: id('metadados-de-storage-que-abortam-a-54'),
    sabotagem: `insert into storage.objects (bucket_id, name, metadata) values ('imagens', 'perfis/x-1.jpg', '{"size":"12.5"}');` },
  { nome: 'objeto com size gigante (estouraria o bigint)', verificacao: id('metadados-de-storage-que-abortam-a-54'),
    sabotagem: `insert into storage.objects (bucket_id, name, metadata) values ('imagens', 'perfis/x-2.jpg', '{"size":"99999999999999999999999"}');` },
  { nome: 'objeto com owner_id de uuid malformado', verificacao: id('metadados-de-storage-que-abortam-a-54'),
    sabotagem: `insert into storage.objects (bucket_id, name, owner_id) values ('imagens', 'perfis/x-3.jpg', '12345678-zzzz');` },
  { nome: 'sem USAGE no schema storage: "não lê", sem derrubar o pré-voo', verificacao: id('metadados-de-storage-que-abortam-a-54'),
    detalhe: /não lê o schema storage/,
    sabotagem: `revoke pg_read_all_data from postgres; revoke usage on schema storage from postgres, public, anon, authenticated, service_role;` },

  // ---------------------------------------------------------------- pontos-fora-do-teto
  { nome: 'lançamento de 2.000.000 pontos', verificacao: id('pontos-fora-do-teto'),
    sabotagem: `insert into public.pontos (usuario_id, origem, pontos, motivo) values (md5('up:d1')::uuid, 'manual', 2000000, 'teste');` },

  // ---------------------------------------------------------------- leiloes-abertos-em-risco
  { nome: 'leilão aberto que fecha em 1 hora', verificacao: id('leiloes-abertos-em-risco'),
    sabotagem: `update public.leiloes set fecha_em = now() + interval '1 hour' where status = 'aberto';` },
  { nome: 'leilão com lance conjunto vivo (Águias + Leões)', verificacao: id('leiloes-abertos-em-risco'),
    sabotagem: `insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
select l.id, (select id from public.unidades where nome = 'Leões'), false from public.leilao_lances l where l.status = 'ativo';` },
  { nome: 'título de leilão com U+FFFF/U+FFFE e controle (não derruba o XML)', verificacao: id('leiloes-abertos-em-risco'),
    detalhe: /fecha nas próximas 24h/,
    sabotagem: `update public.leiloes set fecha_em = now() + interval '1 hour',
  titulo = 'Leilão da Primavera ' || chr(65535) || chr(65534) || chr(1) where status = 'aberto';` },
  { nome: 'leiloes.fecha_em em text: a verificação diz que não conferiu, não cai', verificacao: id('leiloes-abertos-em-risco'),
    detalhe: /tem outro tipo\) public\.leiloes\.fecha_em:timestamptz/,
    sabotagem: `alter table public.leiloes alter column fecha_em type text;` },

  // ---------------------------------------------------------------- tesoureiro-ativo-vs-mensalidades_ano
  // Passo da janela, não dado a corrigir: com tesoureiro ativo (o 'tes' do pre_dados), a 59 e a 80 têm de
  // ir juntas — o legado limpo já dá este AVISO. O caso da função já criada simula um upgrade que PAROU
  // entre a 59 e a 80 (upgrade-parcial-ou-objetos-saas também acusa).
  { nome: 'upgrade parado entre a 59 e a 80, com tesoureiro ativo', verificacao: id('tesoureiro-ativo-vs-mensalidades_ano'), esperado: 'AVISO',
    detalhe: /já existe com o portão da 59/,
    sabotagem: `create function public.mensalidades_ano(p_ano integer) returns void language plpgsql as $$
begin perform public.pode_gerir_no_clube(null); end $$;` },
  { nome: 'mensalidades_ano já com o portão financeiro (a 80 aplicada)', verificacao: id('tesoureiro-ativo-vs-mensalidades_ano'), esperado: 'ok',
    sabotagem: `create function public.mensalidades_ano(p_ano integer) returns void language plpgsql as $$
begin perform public.pode_financeiro_no_clube(null); end $$;` },
  { nome: 'sem tesoureiro ativo, nada a lembrar', verificacao: id('tesoureiro-ativo-vs-mensalidades_ano'), esperado: 'ok',
    sabotagem: `update public.profiles set status = 'inativo' where papel = 'tesoureiro';` },

  // ---------------------------------------------------------------- cron-jobs-conflitantes
  { nome: "job manual com o nome reservado 'alertas'", verificacao: id('cron-jobs-conflitantes'),
    sabotagem: `select cron.schedule('alertas', '0 * * * *', 'select 1');` },
  { nome: 'job legado rodando como authenticated', verificacao: id('cron-jobs-conflitantes'),
    sabotagem: `update cron.job set username = 'authenticated' where jobname = 'lembrar-ausentes';` },

  // ---------------------------------------------------------------- sessoes-longas-e-locks
  // Os casos de lock vêm logo antes do de 31 s: se uma conexão dblink demorar a cair, só o caso de 31 s
  // (que espera AVISO de sessão longa de qualquer jeito) a veria.
  { nome: 'outra sessão com AccessExclusiveLock em profiles: o pré-voo não trava e diz quem é', verificacao: id('sessoes-longas-e-locks'), esperado: 'AVISO',
    detalhe: /segura AccessExclusiveLock em public\.profiles/,
    sabotagem: TRAVA_PROFILES },
  { nome: 'outra sessão com AccessExclusiveLock em profiles: a verificação diz "travada"', verificacao: id('papel-ou-status-fora-do-vocabulario'),
    detalhe: /public\.profiles \(travada pelo pid/,
    sabotagem: TRAVA_PROFILES },
  { nome: 'ALTER na fila atrás de uma leitura aberta: a verificação não entra na fila', verificacao: id('dados-que-violam-constraints-novas'),
    detalhe: /public\.unidades \(ALTER\/DROP na fila/,
    sabotagem: `set local lock_timeout = '10s';
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect('app', 'dbname=' || current_database() || ' user=supabase_admin');
select extensions.dblink_exec('app', 'begin');
select * from extensions.dblink('app', 'select count(*) from public.unidades') as t(n bigint);
select extensions.dblink_connect('mig', 'dbname=' || current_database() || ' user=supabase_admin');
select extensions.dblink_exec('mig', 'begin');
select extensions.dblink_send_query('mig', 'alter table public.unidades add column zz_fila int');
do $$ begin
  for i in 1..50 loop
    exit when exists (select 1 from pg_locks where not granted and mode = 'AccessExclusiveLock' and relation = 'public.unidades'::regclass);
    perform pg_sleep(0.1);
  end loop;
end $$;` },
  // (espera 31 s)
  { nome: 'outra sessão com transação aberta há mais de 30 s', verificacao: id('sessoes-longas-e-locks'), esperado: 'AVISO',
    sabotagem: `create extension if not exists dblink with schema extensions;
select extensions.dblink_connect('lenta', 'dbname=' || current_database() || ' user=supabase_admin');
select extensions.dblink_exec('lenta', 'begin');
select extensions.dblink_exec('lenta', 'lock table public.pontos in access share mode');
select pg_sleep(31);` },

  // ---------------------------------------------------------------- webhook-de-push-do-painel
  { nome: 'Database Webhook do painel em notificacoes', verificacao: id('webhook-de-push-do-painel'), esperado: 'AVISO',
    sabotagem: `create trigger push_hook after insert on public.notificacoes for each row
execute function supabase_functions.http_request('https://x.test', 'POST', '{}', '{}', '1000');` },

  // ---------------------------------------------------------------- segredos-de-push-no-vault
  { nome: 'Vault só com push_edge_url (falta a fechadura)', verificacao: id('segredos-de-push-no-vault'), esperado: 'AVISO',
    sabotagem: `select vault.create_secret('https://x.test/functions/v1/enviar-push', 'push_edge_url', 'teste');` },
  { nome: 'Vault com os dois segredos', verificacao: id('segredos-de-push-no-vault'), esperado: 'ok',
    sabotagem: `select vault.create_secret('https://x.test/functions/v1/enviar-push', 'push_edge_url', 'teste');
select vault.create_secret('segredo-de-teste', 'push_webhook_secret', 'teste');` },
  { nome: 'sem USAGE no schema vault: "não lê", sem derrubar o pré-voo', verificacao: id('segredos-de-push-no-vault'), esperado: 'AVISO',
    detalhe: /não lê o schema vault/,
    sabotagem: `revoke pg_read_all_data from postgres; revoke usage on schema vault from postgres, public, anon, authenticated, service_role;` },

  // ---------------------------------------------------------------- cron-jobs-desconhecidos-ou-ausentes
  { nome: 'job do pg_cron que só existe em produção', verificacao: id('cron-jobs-desconhecidos-ou-ausentes'), esperado: 'AVISO',
    sabotagem: `select cron.schedule('meu-job', '0 3 * * *', 'select 1');` },
  { nome: 'job legado removido (lembrar-ausentes)', verificacao: id('cron-jobs-desconhecidos-ou-ausentes'), esperado: 'AVISO',
    sabotagem: `delete from cron.job where jobname = 'lembrar-ausentes';` },
  { nome: 'sem USAGE no schema cron: "não lê", sem derrubar o pré-voo', verificacao: id('cron-jobs-desconhecidos-ou-ausentes'), esperado: 'AVISO',
    detalhe: /não lê o schema cron/,
    sabotagem: `revoke pg_read_all_data from postgres; revoke usage on schema cron from postgres, public, anon, authenticated, service_role;` },

  // ---------------------------------------------------------------- colunas-so-em-producao-em-profiles
  { nome: 'coluna profiles.telefone só em produção', verificacao: id('colunas-so-em-producao-em-profiles'), esperado: 'AVISO',
    sabotagem: `alter table public.profiles add column telefone text;` },

  // ---------------------------------------------------------------- funcoes-fora-do-repo-ou-de-outro-dono
  { nome: 'função manual que grava em notificacoes', verificacao: id('funcoes-fora-do-repo-ou-de-outro-dono'), esperado: 'AVISO',
    sabotagem: `create function public.aviso_manual() returns void language sql as $$ insert into public.notificacoes (titulo) values ('x') $$;` },

  // ---------------------------------------------------------------- objetos-em-tabelas-so-de-producao
  { nome: 'restos do Cartão de Classe (FK, policy e gatilho em tabela só de produção)', verificacao: id('objetos-em-tabelas-so-de-producao'), esperado: 'AVISO',
    detalhe: /FK de classe_requisitos para tabela legada/,
    sabotagem: CARTAO_DE_CLASSE },

  // ---------------------------------------------------------------- perfis-rejeitados-e-inativos
  { nome: 'cadastro rejeitado com avatar no Storage', verificacao: id('perfis-rejeitados-e-inativos'), esperado: 'AVISO',
    sabotagem: `insert into storage.objects (bucket_id, name, owner) values ('imagens', 'perfis/' || md5('up:rej')::uuid || '-1.jpg', md5('up:rej')::uuid);` },

  // ---------------------------------------------------------------- nascimento-implausivel
  { nome: 'nascimento no futuro', verificacao: id('nascimento-implausivel'), esperado: 'AVISO',
    sabotagem: `update public.profiles set nascimento = current_date + 10 where id = md5('up:d1')::uuid;` },

  // ---------------------------------------------------------------- push-endpoints-fora-do-padrao
  { nome: 'inscrição de push com endpoint http', verificacao: id('push-endpoints-fora-do-padrao'), esperado: 'AVISO',
    sabotagem: `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (md5('up:d2')::uuid, 'http://x', 'k', 'a');` },

  // ---------------------------------------------------------------- uploads-que-a-28-e-a-31-recusam
  { nome: 'vídeo de 20 MB enviado para imagens', verificacao: id('uploads-que-a-28-e-a-31-recusam'), esperado: 'AVISO',
    sabotagem: `insert into storage.objects (bucket_id, name, owner, metadata)
values ('imagens', 'atividades/' || md5('up:d1')::uuid || '-foo.mp4', md5('up:d1')::uuid, '{"mimetype":"video/mp4","size":"20000000"}');` },
  { nome: 'upload em caminho que pode_subir_imagem recusa', verificacao: id('uploads-que-a-28-e-a-31-recusam'), esperado: 'AVISO',
    sabotagem: `insert into storage.objects (bucket_id, name, owner, metadata)
values ('imagens', 'atividades/foo.jpg', md5('up:d1')::uuid, '{"mimetype":"image/jpeg","size":"1000"}');` },

  // ---------------------------------------------------------------- imagens-que-somem-depois-da-32
  { nome: 'avatar apontando para outro projeto', verificacao: id('imagens-que-somem-depois-da-32'), esperado: 'AVISO',
    sabotagem: `update public.profiles set foto = 'https://outro.supabase.co/storage/v1/object/public/imagens/perfis/nao-existe.jpg' where id = md5('up:d1')::uuid;` },

  // ---------------------------------------------------------------- comprovacoes-sem-linha-com-o-nome-exato
  { nome: 'comprovação sem linha que cite o nome', verificacao: id('comprovacoes-sem-linha-com-o-nome-exato'), esperado: 'AVISO',
    sabotagem: `insert into storage.objects (bucket_id, name, owner) values ('comprovacoes', md5('up:d2')::uuid || '/missao/1.jpg', md5('up:d2')::uuid);` },

  // ---------------------------------------------------------------- objetos-de-storage-sem-clube
  { nome: 'objeto sem dono (enviado pelo painel)', verificacao: id('objetos-de-storage-sem-clube'), esperado: 'AVISO',
    sabotagem: `insert into storage.objects (bucket_id, name) values ('imagens', 'mural/sem-dono.jpg');` },

  // ---------------------------------------------------------------- chat-apagadas-mudam-de-texto
  // O pre_dados já tem uma mensagem apagada (dado normal: vira só um número informativo). O AVISO é
  // para quando há liderança no APK antigo, cuja tela de moderação lê a tabela direto.
  { nome: 'mensagem apagada e diretoria usando o APK', verificacao: id('chat-apagadas-mudam-de-texto'), esperado: 'AVISO',
    sabotagem: `insert into public.push_tokens (token, user_id) values ('token-de-teste', md5('up:dir')::uuid);` },

  // ---------------------------------------------------------------- notificacoes-para-aceita-nulo
  { nome: 'notificacoes.para aceita NULL', verificacao: id('notificacoes-para-aceita-nulo'), esperado: 'AVISO',
    sabotagem: `alter table public.notificacoes alter column para drop not null;` },

  // ---------------------------------------------------------------- respostas-401-5xx-do-pg_net
  { nome: 'resposta 401 do pg_net nas últimas 24h', verificacao: id('respostas-401-5xx-do-pg_net'), esperado: 'AVISO',
    sabotagem: `insert into net._http_response (id, status_code, created) values (987654321, 401, now());` },
  { nome: 'net._http_response.created de outro tipo: não é "nada a conferir" nem cai', verificacao: id('respostas-401-5xx-do-pg_net'), esperado: 'AVISO',
    detalhe: /tem outro tipo\) net\._http_response\.created:timestamptz/,
    sabotagem: `alter table net._http_response alter column created drop default; alter table net._http_response alter column created type text;` },
  { nome: 'sem USAGE no schema net: "não lê", sem derrubar o pré-voo', verificacao: id('respostas-401-5xx-do-pg_net'), esperado: 'AVISO',
    detalhe: /não lê o schema net/,
    sabotagem: `revoke pg_read_all_data from postgres;
revoke usage on schema net from postgres, public, anon, authenticated, service_role, supabase_functions_admin;` },

  // ---------------------------------------------------------------- fim-de-linha-crlf-no-metodo-de-aplicacao
  // Neste worktree (Windows) as migrations legadas estão CRLF no disco: o legado limpo JÁ dá AVISO aqui
  // (achado real, não falso positivo). O caso garante que uma função com CR entra na lista.
  { nome: 'função com CR no corpo', verificacao: id('fim-de-linha-crlf-no-metodo-de-aplicacao'), esperado: 'AVISO',
    sabotagem: `do $$ begin execute 'create function public.f_cr() returns int language sql as ' || quote_literal('select 1' || chr(13) || chr(10)); end $$;` },

  // ---------------------------------------------------------------- sem-diretoria-ativa
  { nome: 'nenhuma diretoria ativa', verificacao: id('sem-diretoria-ativa'), esperado: 'AVISO',
    sabotagem: `update public.profiles set status = 'inativo' where papel = 'diretoria';` },

  // ---------------------------------------------------------------- robustez: nada derruba o pré-voo inteiro
  { nome: 'sem pg_cron, as verificações de cron dizem "nada a conferir" (e o pré-voo não cai)', verificacao: id('cron-jobs-conflitantes'), esperado: 'ok',
    sabotagem: `drop extension pg_cron;` },
  { nome: 'sem pg_net (schema net), a verificação de 401/5xx não derruba o pré-voo', verificacao: id('respostas-401-5xx-do-pg_net'), esperado: 'ok',
    sabotagem: `drop extension pg_net;` },
  { nome: 'sem supabase_vault, a verificação dos segredos diz "nada a conferir"', verificacao: id('segredos-de-push-no-vault'), esperado: 'ok',
    sabotagem: `drop extension supabase_vault cascade;` },
  { nome: 'sem o Storage instalado (schema storage), o pré-voo não cai e acusa', verificacao: id('permissoes-do-papel-do-sql-editor'),
    sabotagem: `drop schema storage cascade;` },
  { nome: 'sem a tabela pontos, a verificação do teto diz que não deu para conferir', verificacao: id('pontos-fora-do-teto'),
    sabotagem: `drop table public.pontos cascade;` },
  { nome: 'nascimento em text não derruba a verificação de idade', verificacao: id('nascimento-implausivel'), esperado: 'AVISO',
    sabotagem: `alter table public.profiles alter column nascimento type text;` },
  { nome: 'postgres sem SELECT em cron.job: a verificação diz que não conseguiu ler', verificacao: id('cron-jobs-desconhecidos-ou-ausentes'), esperado: 'AVISO',
    sabotagem: `revoke select on cron.job from postgres, public; revoke pg_read_all_data from postgres;` },
]

// Verificações que NÃO têm como ficar vermelhas no banco legado local — o mínimo possível, cada uma
// com o motivo. O arnês as exclui da exigência de cobertura e diz por quê.
export const SEM_CASO_LOCAL = {
  'pacote-curricular-colado-integro':
    'a colagem de ~39 KB da 40/43 só existe na janela, não no banco: a linha do pré-voo é um lembrete fixo (AVISO). ' +
    'O que prova a verificação é o BLOCO À PARTE do fim do arquivo, que o arnês roda com o literal da 40 e da 43 ' +
    '(0 linhas) e com um caractere trocado (1 linha).',
}
