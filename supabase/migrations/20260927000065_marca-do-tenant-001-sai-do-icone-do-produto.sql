-- =============================================================================
--  Fase 8.5 — a marca do Tenant 001 deixa de apontar para o ícone do PRODUTO.
--
--  O ACHADO: a marca do clube A, gravada no banco pela migration 33, tinha
--
--      "logo_url": "/icon-192.png"
--
--  que é o ícone GLOBAL do app — o favicon, o ícone do PWA, o ícone do app Android e o `icon`/
--  `badge` de toda notificação push. E aquele arquivo era, de fato, o brasão do clube A: uma
--  imagem com "FILHOS DA CONQUISTA" e "1994" escritos nela.
--
--  Ou seja, a identidade do produto e a identidade de um cliente eram o MESMO arquivo. Enquanto o
--  produto teve um clube só, isso não tinha como incomodar. Com N clubes, incomoda nos dois
--  sentidos ao mesmo tempo:
--
--    · todo clube novo recebia push com o brasão do clube A na tarja da notificação, instalava um
--      app cujo ícone na tela inicial era o brasão do clube A, e abria uma aba cujo favicon era o
--      brasão do clube A;
--    · e o clube A não podia ter seu logo trocado sem trocar o ícone do produto inteiro.
--
--  A separação: o brasão do clube A virou `public/clubes/tenant-001.png` — um arquivo DELE — e o
--  `/icon-192.png` passou a ser a bússola neutra do DesbravaClube. Esta migration move a marca do
--  Tenant 001 para o arquivo novo, para que ele continue exatamente com a mesma aparência de
--  sempre dentro do app. Nada muda para quem é do clube A; muda para todo o resto.
--
--  Só toca em clube cujo logo aponta para o ícone do produto. Um clube que já subiu logo próprio
--  (o caminho normal, pelo Storage) não é tocado — o `where` cobre isso.
-- =============================================================================

update public.organizational_units
   set metadata = jsonb_set(
         metadata,
         '{marca,logo_url}',
         to_jsonb('/clubes/tenant-001.png'::text),
         true)
 where type = 'clube'
   and metadata -> 'marca' ->> 'logo_url' in ('/icon-192.png', '/icon-512.png', '/logo.png');

do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.organizational_units
   where type = 'clube'
     and metadata -> 'marca' ->> 'logo_url' in ('/icon-192.png', '/icon-512.png', '/logo.png');
  if v_n > 0 then
    raise exception 'ainda há % clube(s) com o logo apontando para o ícone do produto', v_n;
  end if;
end $$;
