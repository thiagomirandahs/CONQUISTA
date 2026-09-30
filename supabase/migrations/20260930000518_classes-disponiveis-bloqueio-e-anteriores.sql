-- 518 — Classes disponíveis: por que uma classe está bloqueada e se ela é "de idade anterior".
--
-- A regra NÃO muda (continua igual à 512 e anteriores):
--   * disponível se a idade atual (profiles.nascimento) >= classes.idade_minima; SEM limite máximo;
--   * a avançada exige a regular pareada iniciada/concluída (curriculum_dependencies, modo 'iniciada_ou_concluida');
--   * sem nascimento cadastrado não há trava de idade (não inventa).
-- Esta migration só deixa a TELA explicar melhor, sem recalcular regra no front:
--   bloqueio  text    'idade' | 'pre_requisito' | null (null = elegível). Sempre coerente com "elegivel":
--                      elegivel = (bloqueio is null). Usa a mesma fonte de _classe_motivo_inelegivel.
--   anterior  boolean true quando a idade é conhecida, a classe é elegível POR IDADE e o idade_minima dela é
--                      MENOR que o maior idade_minima entre as classes oficiais publicadas e ativas com
--                      idade_minima <= idade atual (ou seja, é uma classe de uma idade anterior à atual).
--                      false caso contrário, inclusive sem nascimento.
-- Aditiva: nenhuma tabela nova, _classe_motivo_inelegivel / classe_iniciar / classe_atribuir intactas.

create or replace function public._classe_bloqueio_tipo(p_usuario_id uuid, p_class_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.classes c join public.profiles p on p.id = p_usuario_id
       where c.id = p_class_id and c.idade_minima is not null and p.nascimento is not null
         and extract(year from age(current_date, p.nascimento))::int < c.idade_minima
    ) then 'idade'
    when exists (
      select 1 from public.curriculum_dependencies d
       where d.alvo_tipo = 'class' and d.alvo_id = p_class_id and d.depende_de_tipo = 'class' and d.obrigatorio
         and not public._dependencia_de_classe_satisfeita(p_usuario_id, d.depende_de_id, d.modo)
    ) then 'pre_requisito'
    else null
  end;
$$;

create or replace function public._classe_eh_anterior(p_usuario_id uuid, p_class_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with pessoa as (
    select extract(year from age(current_date, p.nascimento))::int as idade
      from public.profiles p where p.id = p_usuario_id and p.nascimento is not null
  )
  select coalesce((
    select c.idade_minima is not null
       and c.idade_minima <= pessoa.idade
       and c.idade_minima < (
         select max(c2.idade_minima)
           from public.classes c2 join public.curriculum_versions v2 on v2.id = c2.curriculum_version_id
          where c2.ativo and v2.status = 'publicado' and v2.origem = 'oficial' and c2.idade_minima <= pessoa.idade
       )
      from public.classes c, pessoa
     where c.id = p_class_id
  ), false);
$$;

revoke all on function public._classe_bloqueio_tipo(uuid, uuid) from public, anon, authenticated;
revoke all on function public._classe_eh_anterior(uuid, uuid) from public, anon, authenticated;

create or replace function public.classes_disponiveis() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'class_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
    'idade_minima', c.idade_minima, 'manifesto_id', c.manifesto_id, 'vigente_desde', c.vigente_desde,
    'avancada', c.tipo_classe = 'avancada', 'classe_regular_codigo', c.classe_regular_codigo,
    'elegivel', public._classe_motivo_inelegivel(auth.uid(), c.id) is null,
    'motivo_inelegivel', public._classe_motivo_inelegivel(auth.uid(), c.id),
    'curriculum_version', json_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao),
    'bloqueio', public._classe_bloqueio_tipo(auth.uid(), c.id),
    'anterior', public._classe_eh_anterior(auth.uid(), c.id)
  ) order by c.ordem, c.tipo_classe = 'avancada', c.nome), '[]'::json)
  from public.classes c
  join public.curriculum_versions v on v.id = c.curriculum_version_id
  where c.ativo and v.status = 'publicado' and v.origem = 'oficial'
    and public.membro_ativo_no_clube(public.clube_atual_id())
    and not exists (
      select 1 from public.member_classes mc
      where mc.usuario_id = auth.uid() and mc.club_id = public.clube_atual_id() and mc.class_id = c.id and mc.status <> 'cancelada'
    );
$$;
revoke all on function public.classes_disponiveis() from public, anon;
grant execute on function public.classes_disponiveis() to authenticated;
