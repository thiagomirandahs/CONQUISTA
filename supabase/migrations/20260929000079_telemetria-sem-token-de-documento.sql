-- =============================================================================
--  Fase 9, item 7 (OBSERVABILIDADE) — a máscara da migration 77 deixava passar o token de DOCUMENTO.
--
--  A 77 tratou `/verificar/:token` pelo nome e mascarou, por forma, sequências hex de 16+ e
--  alfanuméricas de 32+. O mapa de rotas conferido depois mostrou uma segunda rota com token no
--  caminho — `/documento/:token` — e o token de documento tem 20 caracteres alfanuméricos MAIÚSCULOS
--  (`7V8XC44WJ1NTYHMEK0ER`): não é hex, e é curto para a regra de 32. Um erro naquela tela gravaria o
--  token que abre o documento de uma criança.
--
--  Duas camadas, como na 77: a rota pelo nome, e a FORMA — uma sequência de 16+ letras maiúsculas e
--  dígitos, sem espaço, não é texto de gente em português; é código, token ou chave.
-- =============================================================================
create or replace function public._sem_segredo(p_texto text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p_texto, ''),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[e-mail]', 'g'),   -- e-mail
    '\m[0-9A-Fa-f]{16,}\M', '[segredo]', 'g'),                            -- código de entrada (16 hex), tokens hex
    '\m[A-Z0-9]{16,}\M', '[segredo]', 'g'),                               -- token de documento (20 maiúsculas/dígitos)
    '\m[A-Za-z0-9_]{32,}\M', '[segredo]', 'g');                           -- tokens longos. SEM hífen de propósito:
                                                                          -- um uuid (grupos de até 12) continua legível
$$;

create or replace function public.registrar_erro(p_origem text, p_correlacao text, p_rota text default null,
  p_contexto text default null, p_codigo text default null, p_agente text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_recentes int; v_rota text;
begin
  if p_origem is null or p_origem not in ('ui', 'boundary', 'janela', 'promessa') then return; end if;
  if p_correlacao is null or length(p_correlacao) not between 8 and 64 then return; end if;

  -- Teto: 20 erros por correlação por hora. Passou disso, para de gravar em silêncio — o
  -- objetivo é investigar um relato, não capturar cada quadro de um laço.
  select count(*) into v_recentes
    from public.app_erros
   where correlacao = p_correlacao and quando > now() - interval '1 hour';
  if v_recentes >= 20 then return; end if;

  -- a rota: sem querystring nem fragmento, e as DUAS rotas que carregam token de documento no
  -- caminho com o token trocado por um marcador (a 77 só conhecia a primeira)
  v_rota := regexp_replace(coalesce(p_rota, ''), '[?#].*$', '');
  v_rota := regexp_replace(v_rota, '^/(verificar|documento)/[^/]+', '/\1/:token');
  v_rota := public._sem_segredo(v_rota);

  insert into public.app_erros (user_id, club_id, origem, rota, contexto, codigo, correlacao, agente)
  values (
    v_uid,
    public.clube_atual_id(),
    p_origem,
    left(v_rota, 120),
    left(public._sem_segredo(p_contexto), 200),
    left(public._sem_segredo(p_codigo), 80),
    p_correlacao,
    left(coalesce(p_agente, ''), 120)
  );
end;
$$;
