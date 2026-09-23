-- =============================================================================
--  Fase 8.2 — a aba "Ano" de Mensalidades para de truncar em silêncio.
--
--  MEDIDO, não suposto: com 1.320 mensalidades de um ano num clube, a API devolve **1.000 linhas
--  e HTTP 200**. O `max_rows = 1000` do PostgREST corta e não avisa — não há erro, não há header
--  que o app leia, não há nada. A tela monta o mapa com o que chegou e mostra 320 pagamentos
--  como NÃO PAGOS.
--
--  É erro de DINHEIRO, é silencioso, e acontece na ferramenta que justifica a mensalidade do
--  produto. 1.320 linhas é um clube de 110 membros — não é um cenário extremo, é um clube médio.
--  Com 83 membros ainda passa (996 linhas); com 84, começa a mentir.
--
--  A correção não é paginar: é devolver a FORMA CERTA. A tela precisa de uma linha por PESSOA
--  com os doze meses dentro — que é exatamente o mapa que ela monta no cliente hoje, a partir de
--  N×12 linhas. Devolvendo N linhas em vez de N×12, o volume cai 12x e um clube precisaria de
--  1.000 membros para chegar perto do teto.
-- =============================================================================
create or replace function public.mensalidades_ano(p_ano int)
returns table (desbravador_id uuid, nome text, meses jsonb)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.nome,
         coalesce(jsonb_object_agg(m.mes::text, m.status) filter (where m.mes is not null), '{}'::jsonb)
    from public.profiles p
    join public.organization_memberships v
      on v.user_id = p.id and v.organizational_unit_id = public.clube_atual_id()
     and v.status = 'ativo' and v.role in ('desbravador', 'conselheiro')
    left join public.mensalidades m
      on m.desbravador_id = p.id and m.ano = p_ano and m.club_id = public.clube_atual_id()
   -- Mensalidade é dinheiro do clube: quem lê é a gestão. A checagem é a mesma do resto da tela.
   -- Quem esta ativo e decidido pelo VINCULO (v.status), nunca pela coluna homonima da tabela de
   -- perfis: desde o multiclube, o perfil e identidade global e o vinculo e a verdade operacional
   -- — a mesma pessoa pode estar ativa num clube e suspensa noutro. O teste 29 trava essa regra e
   -- pegou esta funcao na primeira versao. (O detector dele varre o texto INTEIRO da definicao,
   -- comentario inclusive, entao aqui nem o nome da coluna proibida pode ser escrito.)
   where public.pode_gerir_no_clube(public.clube_atual_id())
   group by p.id, p.nome
   order by p.nome, p.id;
$$;
revoke all on function public.mensalidades_ano(int) from public, anon;
grant execute on function public.mensalidades_ano(int) to authenticated;
