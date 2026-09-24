-- =====================================================================
-- ENSAIO DE PRODUÇÃO — as DIFERENÇAS entre o retrato de antes e o banco depois do upgrade.
--
-- Para cada tabela copiada em `ensaio_antes` (retrato-antes.sql):
--   · removida   — linha que existia antes e não existe mais (pela chave primária de antes);
--   · adicionada — linha que não existia antes e existe agora;
--   · alterada   — mesma chave, e a COLUNA mudou (uma linha por coluna; só colunas que existiam antes);
--   · tabela_removida — a tabela inteira sumiu.
-- Cada diferença é contada e, ao lado, quantas delas uma REGRA explica (`ensaio_antes._regras`:
-- predicado SQL sobre `a` = a linha de antes e `d` = a de depois). Diferença sem regra = inexplicada
-- = NO-GO. Colunas NOVAS (club_id etc.) não entram aqui: quem cuida delas são os invariantes.
-- Devolve JSON. Nunca devolve conteúdo de linha: só nomes de tabela/coluna e contagens.
-- =====================================================================
\set ON_ERROR_STOP on
create or replace function pg_temp.ensaio_diferencas() returns table (copia text, tipo text, coluna text, total bigint, explicadas bigint, motivos text)
language plpgsql as $$
declare
  c record; v_dest text; v_cols text[]; v_chave text[]; v_on text; v_col text; v_regra text; v_mot text; v_total bigint; v_expl bigint;
begin
  for c in select * from ensaio_antes._copias order by copia loop
    v_dest := format('%I.%I', c.origem_schema, c.origem_tabela);
    if to_regclass(v_dest) is null then
      execute format('select count(*) from ensaio_antes.%I', c.copia) into v_total;
      copia := c.copia; tipo := 'tabela_removida'; coluna := null; total := v_total; explicadas := 0; motivos := null;
      return next; continue;
    end if;
    -- colunas em comum (as de antes que ainda existem)
    select array_agg(a.attname::text order by a.attnum) into v_cols
      from pg_attribute a
     where a.attrelid = format('ensaio_antes.%I', c.copia)::regclass and a.attnum > 0 and not a.attisdropped
       and exists (select 1 from pg_attribute b where b.attrelid = v_dest::regclass and b.attname = a.attname and b.attnum > 0 and not b.attisdropped);
    v_chave := case when c.chave is not null and c.chave <@ v_cols then c.chave else v_cols end;
    select string_agg(format('d.%1$I::text is not distinct from a.%1$I::text', k), ' and ') into v_on from unnest(v_chave) k;

    -- removidas
    select coalesce(string_agg('(' || r.onde || ')', ' or '), 'false'), string_agg(distinct r.migration || ': ' || r.motivo, ' | ')
      into v_regra, v_mot from ensaio_antes._regras r where r.copia = c.copia and r.tipo = 'removida';
    execute format('select count(*), count(*) filter (where %s) from ensaio_antes.%I a where not exists (select 1 from %s d where %s)',
                   v_regra, c.copia, v_dest, v_on) into v_total, v_expl;
    if v_total > 0 then copia := c.copia; tipo := 'removida'; coluna := null; total := v_total; explicadas := v_expl; motivos := v_mot; return next; end if;

    -- adicionadas
    select coalesce(string_agg('(' || r.onde || ')', ' or '), 'false'), string_agg(distinct r.migration || ': ' || r.motivo, ' | ')
      into v_regra, v_mot from ensaio_antes._regras r where r.copia = c.copia and r.tipo = 'adicionada';
    execute format('select count(*), count(*) filter (where %s) from %s d where not exists (select 1 from ensaio_antes.%I a where %s)',
                   v_regra, v_dest, c.copia, v_on) into v_total, v_expl;
    if v_total > 0 then copia := c.copia; tipo := 'adicionada'; coluna := null; total := v_total; explicadas := v_expl; motivos := v_mot; return next; end if;

    -- alteradas, coluna por coluna
    foreach v_col in array v_cols loop
      continue when v_col = any (v_chave);
      select coalesce(string_agg('(' || r.onde || ')', ' or '), 'false'), string_agg(distinct r.migration || ': ' || r.motivo, ' | ')
        into v_regra, v_mot from ensaio_antes._regras r where r.copia = c.copia and r.tipo = 'alterada' and r.coluna = v_col;
      execute format('select count(*), count(*) filter (where %s) from ensaio_antes.%I a join %s d on %s where a.%I::text is distinct from d.%I::text',
                     v_regra, c.copia, v_dest, v_on, v_col, v_col) into v_total, v_expl;
      if v_total > 0 then copia := c.copia; tipo := 'alterada'; coluna := v_col; total := v_total; explicadas := v_expl; motivos := v_mot; return next; end if;
    end loop;
  end loop;
end $$;

select coalesce(json_agg(row_to_json(x) order by x.copia, x.tipo, x.coluna), '[]') from pg_temp.ensaio_diferencas() x;
