-- =============================================================================
--  Fase 8.1 — observabilidade mínima (blocker B7).
--
--  O problema: o build de produção roda com `drop_console: true` e não existe rastreio de erro
--  nenhum. Um clube pagante liga dizendo "não consigo lançar pontos" e não há absolutamente nada
--  para investigar — nem quando aconteceu, nem em que tela, nem se foi um caso ou cinquenta.
--
--  O que este SQL cria, e o que deliberadamente NÃO cria:
--
--    CRIA   `app_erros`: uma linha por falha que chegou ao usuário, com rota, contexto, código do
--           erro e um id de correlação. Escrita só por `registrar_erro()`, leitura só pela
--           operação da plataforma (fase 5) — nem a diretoria do clube lê.
--
--    NÃO CRIA  um "log de tudo". Nada de token, senha, corpo de requisição, texto de mensagem,
--           evidência, foto, nome ou contato. O público do produto é majoritariamente menor de
--           idade; um sistema de telemetria que grava demais é um vazamento esperando acontecer.
--           A regra aqui é: o suficiente para reproduzir, nada além disso.
--
--  Correlação: `correlacao` é um id aleatório por ABA, gerado no cliente, sem relação com o
--  usuário. Serve para juntar os erros de uma mesma sessão de uso ("a pessoa tentou 3x seguidas")
--  sem precisar de identidade. O `user_id` é gravado à parte, pelo servidor, a partir do JWT —
--  o cliente não escolhe de quem é o erro.
-- =============================================================================

create table if not exists public.app_erros (
  id bigserial primary key,
  quando timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  club_id uuid references public.organizational_units(id) on delete set null,
  -- de onde veio: 'ui' (erro mostrado à pessoa), 'boundary' (tela quebrou), 'janela' (erro não
  -- tratado), 'promessa' (rejeição sem catch)
  origem text not null check (origem in ('ui', 'boundary', 'janela', 'promessa')),
  rota text,                 -- caminho do app, já sem querystring (pode ter id de pessoa)
  contexto text,             -- a frase humana que a tela usou ("Não consegui salvar a atividade.")
  codigo text,               -- o código técnico, quando há (ex.: PGRST204, 42501, TypeError)
  correlacao text not null,  -- id aleatório por aba
  agente text                -- navegador/plataforma, truncado — para separar bug de Android velho
);

alter table public.app_erros enable row level security;
create index if not exists idx_app_erros_quando on public.app_erros (quando desc);
create index if not exists idx_app_erros_correlacao on public.app_erros (correlacao, quando);

-- Ninguém ESCREVE direto na tabela: só pela função, que é quem sanitiza e limita.
-- O `select` fica concedido porque é a POLICY abaixo que decide quem lê — revogar o grant
-- inteiro faria a policy nunca ser avaliada e nem a operação da plataforma leria nada.
-- (Foi exatamente o que aconteceu na primeira versão desta migration; o teste 48 pegou.)
revoke all on public.app_erros from public, authenticated, anon;
grant select on public.app_erros to authenticated;

-- Leitura: só a operação da plataforma (o mesmo papel da fase 5, que é deliberadamente separado
-- das diretorias). A diretoria de um clube não precisa — e não deve — ler a telemetria de erro
-- das outras pessoas.
create policy "operação da plataforma lê os erros" on public.app_erros
  for select to authenticated
  using (public.eh_admin_plataforma());

-- ---------------------------------------------------------------------------
-- O funil único de escrita.
--
-- Corta todo texto no tamanho útil e NUNCA aceita o corpo do erro cru: o cliente manda um
-- `codigo` curto, não a mensagem do servidor (que pode carregar nome de coluna, valor, e-mail).
-- O teto por sessão existe para um laço de render quebrado não escrever um milhão de linhas —
-- que seria, por si só, um jeito de derrubar o banco a partir do navegador.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_erro(
  p_origem text, p_correlacao text, p_rota text default null,
  p_contexto text default null, p_codigo text default null, p_agente text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_recentes int;
begin
  if p_origem is null or p_origem not in ('ui', 'boundary', 'janela', 'promessa') then return; end if;
  if p_correlacao is null or length(p_correlacao) not between 8 and 64 then return; end if;

  -- Teto: 20 erros por correlação por hora. Passou disso, para de gravar em silêncio — o
  -- objetivo é investigar um relato, não capturar cada quadro de um laço.
  select count(*) into v_recentes
    from public.app_erros
   where correlacao = p_correlacao and quando > now() - interval '1 hour';
  if v_recentes >= 20 then return; end if;

  insert into public.app_erros (user_id, club_id, origem, rota, contexto, codigo, correlacao, agente)
  values (
    v_uid,
    -- o clube vem do HEADER da requisição, pela mesma função que o resto do app usa: é o clube
    -- em que a pessoa estava de fato, não um palpite do cliente
    public.clube_atual_id(),
    p_origem,
    left(regexp_replace(coalesce(p_rota, ''), '\?.*$', ''), 120),
    left(coalesce(p_contexto, ''), 200),
    left(coalesce(p_codigo, ''), 80),
    p_correlacao,
    left(coalesce(p_agente, ''), 120)
  );
end $$;

revoke all on function public.registrar_erro(text, text, text, text, text, text) from public, anon;
grant execute on function public.registrar_erro(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Retenção. Telemetria não é acervo: 90 dias é mais do que suficiente para investigar um relato,
-- e guardar além disso só aumenta a superfície. Mesmo prazo já usado por `cron_falhas`.
-- ---------------------------------------------------------------------------
create or replace function public.expurgar_app_erros()
returns void language sql security definer set search_path = '' as $$
  delete from public.app_erros where quando < now() - interval '90 days';
$$;
revoke all on function public.expurgar_app_erros() from public, authenticated, anon;

select cron.schedule('expurgar-app-erros', '30 3 * * *', 'select public.expurgar_app_erros()')
 where not exists (select 1 from cron.job where jobname = 'expurgar-app-erros');

-- ---------------------------------------------------------------------------
-- A visão que a operação usa de fato: erros agrupados, mais recentes primeiro.
-- Responde "isso é um caso isolado ou está acontecendo com todo mundo?" — que é a primeira
-- pergunta diante de um relato de cliente.
-- ---------------------------------------------------------------------------
create or replace function public.painel_erros(p_horas int default 24)
returns table (rota text, contexto text, codigo text, ocorrencias bigint,
               pessoas bigint, clubes bigint, ultimo timestamptz)
language sql stable security definer set search_path = ''
as $$
  select e.rota, e.contexto, e.codigo,
         count(*), count(distinct e.user_id), count(distinct e.club_id), max(e.quando)
    from public.app_erros e
   where public.eh_admin_plataforma()
     and e.quando > now() - (greatest(least(coalesce(p_horas, 24), 720), 1) || ' hours')::interval
   group by e.rota, e.contexto, e.codigo
   order by count(*) desc, max(e.quando) desc
   limit 100;
$$;
revoke all on function public.painel_erros(int) from public, anon;
grant execute on function public.painel_erros(int) to authenticated;

-- Falhas de INFRAESTRUTURA (migration 52) seguem a mesma regra de leitura: operação, não clube.
grant select on public.infra_falhas to authenticated;
create policy "operação da plataforma lê as falhas de infra" on public.infra_falhas
  for select to authenticated
  using (public.eh_admin_plataforma());
