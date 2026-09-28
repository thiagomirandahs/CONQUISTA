-- =============================================================================
-- 360 — Liderança do clube abre a foto de uma TENTATIVA ANTERIOR do requisito
-- =============================================================================
-- Achado do E2E do fluxo pedagógico (28/09): a migration 87 passou a guardar cada tentativa em
-- requirement_submissions (histórico por tentativa, append-only), e a 330 deu à COORDENAÇÃO leitura
-- dessas fotos (coordenacao_ve_comprovacao já olha requirement_submissions). Mas a regra da
-- liderança do PRÓPRIO clube (lideranca_ve_comprovacao) continuou olhando só a evidência ATUAL
-- (member_requirements.evidencia_path). Resultado: depois de um "pedir correção → reenviar", o
-- instrutor/diretoria via no histórico a tentativa 1 com um caminho de foto que o Storage recusava
-- ("Object not found"), enquanto o distrito conseguia abrir a mesma foto.
--
-- Correção: acrescenta requirement_submissions, com a MESMA trava das outras fontes — só gestão do
-- clube em uso (pode_gerir_no_clube) e só linha do clube em uso (club_id = clube_atual_id()).
-- Não abre nada para outro clube, para coordenação (tem regra própria) nem para o anônimo.
-- =============================================================================
create or replace function public.lideranca_ve_comprovacao(p_objeto text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select public.pode_gerir_no_clube(public.clube_atual_id())
     and exists (
       select 1 from public.member_requirements x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.requirement_submissions x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.member_specialty_requirements x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.entregas x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.missoes_feitas x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.devocional x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.experience_submissions x
        where x.arquivo_path = p_objeto and x.club_id = public.clube_atual_id()
     );
$function$;
