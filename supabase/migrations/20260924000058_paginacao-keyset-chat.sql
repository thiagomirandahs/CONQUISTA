-- =============================================================================
--  Fase 8.2 — PAGINAÇÃO REAL, pelo caminho que mais importa: o chat.
--
--  A auditoria mapeou 14 superfícies que crescem sem teto. Esta migration resolve a primeira da
--  lista e estabelece o PADRÃO que as outras vão seguir. O que a torna a primeira:
--
--    · a moderação do chat é a ferramenta de proteção de um produto cujo público é
--      majoritariamente menor de idade, e hoje ela carrega a conversa inteira;
--    · `chat_mensagens` é, junto com `pontos`, a tabela que mais cresce (100.000 linhas no
--      dataset sintético de 100 clubes);
--    · o teto de hoje é o `max_rows = 1000` do PostgREST, que TRUNCA E DEVOLVE 200. Toda tela
--      que "funciona" acima disso já mostra dado incompleto sem avisar ninguém.
--
--  POR QUE KEYSET E NÃO OFFSET
--  `offset 9000` faz o Postgres ler e descartar 9.000 linhas. Numa tabela que só cresce, a última
--  página fica mais cara a cada mensagem nova. Keyset lê a partir de onde parou: custo constante.
--
--  A ARMADILHA QUE O KEYSET INGÊNUO NÃO VÊ — e que neste projeto é real, não teórica:
--  `created_at` EMPATA. Não por azar: `now()` no Postgres é o instante de INÍCIO DA TRANSAÇÃO,
--  então toda rotina que grava várias linhas num laço produz timestamps idênticos byte a byte.
--  Um cursor só com `created_at` PULA linhas (se usar `<`) ou entra em LAÇO INFINITO (se usar
--  `<=`). Por isso o cursor é o par (created_at, id) e a comparação é de TUPLA — `(a, b) < (x, y)`
--  é ordem lexicográfica de verdade, não duas comparações soltas.
--
--  O `id` é uuid v4, que NÃO serve como relógio. Serve para o que é usado aqui: desempate estável
--  e único dentro do mesmo instante.
-- =============================================================================

-- O índice que torna o keyset barato. Sem ele o plano ordena a conversa inteira a cada página.
-- Note a ordem: (conversa, created_at desc, id desc) espelha exatamente o ORDER BY da função.
create index if not exists idx_chat_msg_keyset
  on public.chat_mensagens (conversa_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- A página. Devolve N+1 internamente para saber se HÁ MAIS sem um count(*) — contar numa tabela
-- que só cresce é caro e, pior, a resposta já nasce velha.
--
-- Contrato:
--   p_antes_de / p_antes_id = o cursor, que é a ÚLTIMA linha da página anterior (nulos = 1ª página)
--   devolve: as linhas + `tem_mais`, para a tela saber se mostra "carregar mais"
-- ---------------------------------------------------------------------------
create or replace function public.chat_pagina(
  p_conversa_id uuid,
  p_limite int default 50,
  p_antes_de timestamptz default null,
  p_antes_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_lim int; v_linhas jsonb; v_n int;
begin
  -- Teto próprio, sempre abaixo do max_rows do PostgREST: o truncamento silencioso do gateway
  -- nunca pode ser o que limita uma resposta nossa.
  v_lim := greatest(least(coalesce(p_limite, 50), 200), 1);

  -- A autorização é a MESMA do resto do chat: o conjunto de conversas que a pessoa alcança
  -- (migration 51). Não há uma segunda regra aqui para divergir da primeira.
  if not exists (select 1 from public.chat_conversas_visiveis() v where v = p_conversa_id) then
    return jsonb_build_object('mensagens', '[]'::jsonb, 'tem_mais', false);
  end if;

  with pagina as (
    select m.id, m.autor_id, m.created_at, m.apagada,
           -- ATENCAO: esta funcao e SECURITY DEFINER, entao o join com chat_mensagens_apagadas
           -- NAO passa pela RLS daquela tabela (que e "so a lideranca do clube"). A view
           -- chat_mensagens_visiveis pode se dar ao luxo de escrever coalesce(a.texto_original, ...)
           -- porque ela roda com a RLS do chamador; aqui isso entregaria o texto original de uma
           -- mensagem moderada a QUALQUER membro. O gate tem de ser explicito — e foi o proprio
           -- teste 52 que pegou isso.
           case when not m.apagada then m.texto
                when public.pode_gerir_no_clube(m.club_id) then coalesce(a.texto_original, m.texto)
                else null end as texto
      from public.chat_mensagens m
      left join public.chat_mensagens_apagadas a on a.mensagem_id = m.id
     where m.conversa_id = p_conversa_id
       -- O CORAÇÃO: comparação de TUPLA. `(created_at, id) < (cursor, cursor_id)` é ordem
       -- lexicográfica — com created_at empatado, o id decide, e nenhuma linha é pulada nem
       -- repetida. Duas comparações soltas com `and` NÃO fazem isso.
       and (p_antes_de is null or (m.created_at, m.id) < (p_antes_de, coalesce(p_antes_id, '00000000-0000-0000-0000-000000000000'::uuid)))
     order by m.created_at desc, m.id desc
     limit v_lim + 1
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc), '[]'::jsonb), count(*)
    into v_linhas, v_n
    from (select * from pagina limit v_lim) p;

  return jsonb_build_object(
    'mensagens', v_linhas,
    -- `tem_mais` sai da linha N+1 que foi lida e descartada. Nunca de um count(*).
    'tem_mais', (select count(*) from (
        select 1 from public.chat_mensagens m
         where m.conversa_id = p_conversa_id
           and (p_antes_de is null or (m.created_at, m.id) < (p_antes_de, coalesce(p_antes_id, '00000000-0000-0000-0000-000000000000'::uuid)))
         order by m.created_at desc, m.id desc
         limit v_lim + 1) x) > v_lim);
end $$;
revoke all on function public.chat_pagina(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.chat_pagina(uuid, int, timestamptz, uuid) to authenticated;
