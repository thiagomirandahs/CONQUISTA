-- AUDITORIA DOS CANDIDATOS DO GC (somente leitura): procura o NOME de cada arquivo órfão (>30 dias) em TODAS as colunas de texto/json do
-- schema public e em auth.users, para provar se algo ainda aponta para ele (referência legada, URL guardada, JSON...). Não imprime caminhos:
-- só "tabela.coluna: N candidato(s) citado(s)". Nenhuma escrita (transação READ ONLY).
--   psql "$DB_URL_PRODUCAO" -X -q -A -t -f scripts/storage-gc-auditar-orfaos.sql 2>&1 | grep 'GC|'
begin read only;
do $$
declare cands text[]; pats text[]; t record; n int; m int; total int;
begin
  select array_agg(distinct regexp_replace(name, '^.*/', '')) into cands from public._storage_gc_fatos(null, 30) where categoria = 'orfao';
  select array_agg('%' || x || '%') into pats from unnest(cands) x;
  total := coalesce(array_length(cands, 1), 0);
  raise notice 'GC|candidatos órfãos (nomes distintos): %', total;
  for t in
    select c.table_schema, c.table_name, c.column_name from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where ((c.table_schema = 'public') or (c.table_schema = 'auth' and c.table_name = 'users'))
       and c.data_type in ('text', 'character varying', 'json', 'jsonb', 'ARRAY')
  loop
    begin
      execute format('select count(*) from %I.%I where %I::text like any ($1)', t.table_schema, t.table_name, t.column_name) into n using pats;
      if n > 0 then
        execute format('select count(*) from unnest($1) x where exists (select 1 from %I.%I where %I::text like ''%%'' || x || ''%%'')', t.table_schema, t.table_name, t.column_name) into m using cands;
        raise notice 'GC|%.%.%: % linha(s), % candidato(s) citado(s)', t.table_schema, t.table_name, t.column_name, n, m;
      end if;
    exception when others then null;
    end;
  end loop;
  raise notice 'GC|fim da varredura';
end $$;
rollback;
