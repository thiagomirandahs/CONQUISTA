-- Segurança (achado da auditoria de 26/09, teste 24_oraculos): vitrine_clube_salvar/ler respondiam
-- "Clube não encontrado" para id inexistente e "Sem permissão" para clube de outro — isso deixa descobrir
-- quais ids de clube existem. Agora as duas situações dão a MESMA resposta. Troca feita na definição viva.
do $$
declare v_fn text; v_def text; v_novo text;
begin
  foreach v_fn in array array['vitrine_clube_salvar', 'vitrine_clube_ler'] loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then continue; end if;
    v_novo := replace(v_def, 'raise exception ''Clube não encontrado.'';', 'raise exception ''Clube não encontrado ou sem permissão.'';');
    v_novo := regexp_replace(v_novo, 'raise exception ''Sem permissão[^'']*'';', 'raise exception ''Clube não encontrado ou sem permissão.'';', 'g');
    if v_novo <> v_def then execute v_novo; end if;
  end loop;
end $$;
