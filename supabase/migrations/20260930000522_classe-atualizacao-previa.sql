-- =============================================================================
--  Atualização de matrícula de Classe para a versão vigente do currículo — PARTE SEGURA E ADITIVA.
--  Rodar DEPOIS da 20260930000519. Idempotente. NÃO toca o motor curricular.
--
--  O que ESTA migration faz (e só isso):
--   1) class_requirement_equivalencias — o mapa EXPLÍCITO de requisito da versão antiga -> requisito da
--      versão nova (editorial | equivalente | material), vindo do manifesto/migration, NUNCA de similaridade
--      de texto. Nasce VAZIO. Ninguém escreve pela API (RLS ligada, sem policy, sem grant) e nem o dono
--      altera/apaga linha depois de gravada (gatilho de imutabilidade): corrigir = linha nova numa migration.
--   2) classe_atualizacao_previa(member_class_id) — leitura PURA ("o que mudaria"): compara os requisitos da
--      matrícula com os da versão vigente da MESMA classe e devolve, por requisito, preservado | inalterado |
--      equivalente | novo | refazer, e os removidos. Não altera nenhuma linha de nenhuma tabela.
--
--  O que esta migration NÃO faz, de propósito (PARADA CONSCIENTE — ver ATUALIZACAO-DE-CLASSE-ARQUITETURA.md):
--   a AÇÃO de atualizar. A arquitetura atual não tem onde guardar "cumprido na versão anterior" sem fabricar
--   requirement_approvals nem reescrever member_requirements/class_id. Nenhuma função existente é alterada.
--
--  Regras da prévia (todas explícitas e determinísticas — zero similaridade textual):
--   * mapa explícito (esta versão de origem -> esta versão de destino) manda sobre qualquer outra coisa:
--       tipo 'material' -> refazer; tipo 'editorial'/'equivalente' -> equivalente;
--   * sem linha no mapa: MESMO manifesto_id + descrição IDÊNTICA + configuração IDÊNTICA (tipo/obrigatoriedade
--     de evidência, conteúdo anual, escolha N-de-M com as mesmas opções) -> preservado (se já aprovado e com
--     aprovação rastreável) ou inalterado (ainda não aprovado: nada a refazer, o andamento segue igual);
--   * sem linha no mapa e mesmo manifesto_id mas descrição OU configuração diferente -> refazer;
--   * requisito da versão nova sem origem -> novo; requisito só da versão antiga -> removido.
-- =============================================================================

-- ==================== 1) o mapa explícito (nasce vazio) ====================
create table if not exists public.class_requirement_equivalencias (
  id uuid primary key default gen_random_uuid(),
  identificador text not null,                       -- ex.: 'classes-regulares-dsa'
  versao_origem text not null,                       -- versão em que a pessoa andou
  versao_destino text not null,                      -- versão para a qual ela poderia ser atualizada
  requisito_origem text not null check (requisito_origem ~ '^[A-Za-z0-9_.-]{3,120}$'),   -- manifesto_id na origem
  requisito_destino text not null check (requisito_destino ~ '^[A-Za-z0-9_.-]{3,120}$'), -- manifesto_id no destino
  tipo text not null check (tipo in ('editorial', 'equivalente', 'material')),
  fonte text not null check (char_length(btrim(fonte)) >= 10),   -- a regra declarada (manifesto/OMD/decisão registrada)
  criado_em timestamptz not null default now(),
  foreign key (identificador, versao_origem) references public.curriculum_versions (identificador, versao),
  foreign key (identificador, versao_destino) references public.curriculum_versions (identificador, versao),
  check (versao_origem <> versao_destino),
  -- 1:1 de propósito: fusão ou divisão de requisitos nunca é "equivalente" — é material (requisito novo)
  unique (identificador, versao_origem, versao_destino, requisito_origem),
  unique (identificador, versao_origem, versao_destino, requisito_destino)
);
comment on table public.class_requirement_equivalencias is
  'Mapa EXPLÍCITO de requisito entre versões do currículo (editorial/equivalente/material). Só entra por migration gerada do manifesto; imutável; sem escrita pela API.';

alter table public.class_requirement_equivalencias enable row level security;
revoke all on public.class_requirement_equivalencias from public, anon, authenticated;

drop trigger if exists trg_equivalencia_imutavel on public.class_requirement_equivalencias;
create trigger trg_equivalencia_imutavel before update or delete on public.class_requirement_equivalencias
  for each row execute function public._proteger_registro_imutavel();

-- ==================== 2) assinatura estruturada de um requisito (igualdade EXATA, nunca "parecido") ====================
-- Tudo o que, mudando, muda o que a pessoa precisa fazer/comprovar além do texto: evidência, conteúdo anual,
-- escolha N-de-M (mínimo, sem-repetição, opções na ordem).
create or replace function public._classe_requisito_assinatura(p_requirement_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tipo_evidencia', r.tipo_evidencia,
    'evidencia_obrigatoria', r.evidencia_obrigatoria,
    'conteudo_dinamico', r.conteudo_dinamico_definicao_id,
    'escolha', (
      select jsonb_build_object('n_minimo', g.n_minimo, 'sem_repeticao', g.sem_repeticao, 'pool', g.pool_sem_repeticao,
        'opcoes', (select coalesce(jsonb_agg(jsonb_build_array(o.rotulo, o.specialty_id) order by o.ordem, o.rotulo), '[]'::jsonb)
                     from public.requirement_options o where o.grupo_id = g.id))
        from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = r.id)
  )
  from public.class_requirements r where r.id = p_requirement_id;
$$;
revoke all on function public._classe_requisito_assinatura(uuid) from public, anon, authenticated;

-- ==================== 3) a prévia (somente leitura) ====================
create or replace function public.classe_atualizacao_previa(p_member_class_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
  v_mc public.member_classes; v_old record; v_new record;
  v_existe boolean := false; v_atualizavel boolean := false; v_motivo text; v_mapa_n int := 0;
  v_res jsonb; v_req jsonb := '[]'::jsonb; v_rem jsonb := '[]'::jsonb; v_outra jsonb;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  -- o clube vem SEMPRE do servidor; matrícula de outro clube, de outra pessoa sem liderança ou UUID forjado
  -- recebem a MESMA resposta (nenhum oráculo de existência)
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club;
  if not found
     or not ((v_mc.usuario_id = v_uid and public.membro_ativo_no_clube(v_club)) or public.pode_avaliar_curriculo(v_club))
     or not public._classe_do_catalogo_oficial(v_mc.class_id) then
    raise exception 'Matrícula não encontrada neste clube.';
  end if;
  perform public._exigir_classes_habilitado(v_club);

  select c.id as class_id, c.codigo, c.nome, v.id as version_id, v.identificador, v.versao, v.status
    into v_old
    from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id
   where c.id = v_mc.class_id;

  -- versão VIGENTE da mesma classe: mesmo identificador de currículo, mesmo código, publicada
  select c.id as class_id, c.codigo, c.nome, v.id as version_id, v.identificador, v.versao, v.status
    into v_new
    from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id
   where v.origem = 'oficial' and v.status = 'publicado' and v.identificador = v_old.identificador
     and c.codigo = v_old.codigo and c.ativo
   order by v.vigente_desde desc nulls last, v.created_at desc, v.id
   limit 1;

  if v_new.class_id is null then
    v_motivo := 'sem_versao_vigente';
  elsif v_new.class_id = v_old.class_id then
    v_motivo := 'ja_na_versao_vigente';
  else
    v_existe := true;
    if v_mc.status = 'em_andamento' then v_atualizavel := true; else v_motivo := 'matricula_nao_em_andamento'; end if;
  end if;

  if v_existe then
    select count(*) into v_mapa_n from public.class_requirement_equivalencias e
     where e.identificador = v_old.identificador and e.versao_origem = v_old.versao and e.versao_destino = v_new.versao;

    with
    dest as (
      select r.id, r.manifesto_id as mid, r.codigo, r.descricao, r.ordem, s.codigo as secao_codigo, s.ordem as secao_ordem,
             public._classe_requisito_assinatura(r.id) as ass
        from public.class_sections s join public.class_requirements r on r.section_id = s.id and r.ativo
       where s.class_id = v_new.class_id
    ),
    orig as (   -- o que a pessoa de fato tem na versão antiga (requisito + andamento + aprovação rastreável)
      select r.id as rid, mr.id as mr_id, r.manifesto_id as mid, r.codigo, r.descricao, r.ordem, s.codigo as secao_codigo,
             s.ordem as secao_ordem, coalesce(mr.status, 'nao_iniciado') as status, public._classe_requisito_assinatura(r.id) as ass,
             ap.id is not null as rastreavel, ap.created_at as aprovado_em, ap.avaliado_papel as aprovado_papel,
             (coalesce(mr.status, 'nao_iniciado') = 'aprovado' and ap.id is not null) as cumprido
        from public.class_sections s
        join public.class_requirements r on r.section_id = s.id
        left join public.member_requirements mr on mr.requirement_id = r.id and mr.member_class_id = v_mc.id
        left join lateral (select a.id, a.created_at, a.avaliado_papel from public.requirement_approvals a
                            where a.member_requirement_id = mr.id and a.decisao = 'aprovado'
                            order by a.created_at desc limit 1) ap on true
       where s.class_id = v_old.class_id and (r.ativo or mr.id is not null)
    ),
    mapa as (
      select e.* from public.class_requirement_equivalencias e
       where e.identificador = v_old.identificador and e.versao_origem = v_old.versao and e.versao_destino = v_new.versao
    ),
    par as (
      select d.*, mm.id as mapa_id, mm.tipo as mapa_tipo, mm.fonte as mapa_fonte, oo.rid as o_rid, oo.mr_id as o_mr_id, oo.mid as o_mid,
             oo.codigo as o_codigo, oo.descricao as o_descricao, oo.status as o_status, oo.rastreavel as o_rastreavel,
             oo.aprovado_em as o_aprovado_em, oo.aprovado_papel as o_aprovado_papel, oo.cumprido as o_cumprido,
             case
               when mm.id is not null then
                 case when oo.rid is null then 'novo'
                      when mm.tipo = 'material' then 'refazer'
                      else 'equivalente' end
               when d.mid is null or oo.rid is null then 'novo'
               when oo.descricao = d.descricao and oo.ass = d.ass then (case when oo.cumprido then 'preservado' else 'inalterado' end)
               else 'refazer'
             end as categoria,
             case
               when mm.id is not null then
                 case when oo.rid is null then 'origem_do_mapa_ausente_na_matricula'
                      when mm.tipo = 'material' then 'mapa_material'
                      else 'mapa_' || mm.tipo end
               when d.mid is null then 'sem_manifesto_id'
               when oo.rid is null then 'sem_origem'
               when oo.descricao = d.descricao and oo.ass = d.ass then 'mesmo_id_descricao_e_configuracao_identicos'
               when oo.descricao <> d.descricao then 'descricao_diferente_sem_regra_explicita'
               else 'configuracao_diferente_sem_regra_explicita'
             end as motivo
        from dest d
        left join mapa mm on d.mid is not null and mm.requisito_destino = d.mid
        left join lateral (select o.* from orig o
                            where o.mid is not null and o.mid = (case when mm.id is not null then mm.requisito_origem else d.mid end)
                              -- uma origem que o mapa já destinou a OUTRO requisito não casa também por "mesmo id"
                              and (mm.id is not null or not exists (select 1 from mapa m2 where m2.requisito_origem = o.mid))
                            limit 1) oo on true
    )
    select jsonb_build_object(
      'requisitos', coalesce((select jsonb_agg(jsonb_build_object(
          'categoria', p.categoria,
          'motivo', p.motivo,
          'cumprido_na_versao_anterior', (p.categoria in ('preservado', 'equivalente') and coalesce(p.o_cumprido, false)),
          'regra', case when p.mapa_id is not null then jsonb_build_object('via', 'mapa_explicito', 'tipo', p.mapa_tipo, 'fonte', p.mapa_fonte)
                        when p.o_rid is not null then jsonb_build_object('via', 'mesmo_manifesto_id', 'tipo', null, 'fonte', null)
                        else null end,
          'destino', jsonb_build_object('requirement_id', p.id, 'manifesto_id', p.mid, 'secao_codigo', p.secao_codigo,
                                        'codigo', p.codigo, 'descricao', p.descricao),
          'origem', case when p.o_rid is null then null else jsonb_build_object(
                      'requirement_id', p.o_rid, 'member_requirement_id', p.o_mr_id, 'manifesto_id', p.o_mid, 'codigo', p.o_codigo,
                      'descricao', p.o_descricao, 'status', p.o_status, 'aprovacao_rastreavel', p.o_rastreavel,
                      'aprovado_em', p.o_aprovado_em, 'aprovado_papel', p.o_aprovado_papel) end
        ) order by p.secao_ordem, p.ordem, p.codigo) from par p), '[]'::jsonb),
      'removidos', coalesce((select jsonb_agg(jsonb_build_object(
          'categoria', 'removido',
          'motivo', 'sem_requisito_correspondente_na_versao_vigente',
          'cumprido_na_versao_anterior', o.cumprido,
          'origem', jsonb_build_object(
            'requirement_id', o.rid, 'member_requirement_id', o.mr_id, 'manifesto_id', o.mid, 'secao_codigo', o.secao_codigo,
            'codigo', o.codigo, 'descricao', o.descricao, 'status', o.status, 'aprovacao_rastreavel', o.rastreavel,
            'aprovado_em', o.aprovado_em, 'aprovado_papel', o.aprovado_papel)
        ) order by o.secao_ordem, o.ordem, o.codigo)
          from orig o where not exists (select 1 from par p where p.o_rid = o.rid)), '[]'::jsonb)
    ) into v_res;
    v_req := v_res -> 'requisitos';
    v_rem := v_res -> 'removidos';

    select jsonb_build_object('member_class_id', x.id, 'status', x.status) into v_outra
      from public.member_classes x
     where x.usuario_id = v_mc.usuario_id and x.club_id = v_club and x.class_id = v_new.class_id and x.status <> 'cancelada';
  end if;

  return jsonb_build_object(
    'ok', true,
    'somente_leitura', true,
    'member_class_id', v_mc.id,
    'status_matricula', v_mc.status,
    'versao_da_matricula', jsonb_build_object('class_id', v_old.class_id, 'curriculum_version_id', v_old.version_id,
      'identificador', v_old.identificador, 'versao', v_old.versao, 'status', v_old.status, 'codigo', v_old.codigo, 'nome', v_old.nome),
    'versao_vigente', case when v_new.class_id is null then null else jsonb_build_object(
      'class_id', v_new.class_id, 'curriculum_version_id', v_new.version_id, 'identificador', v_new.identificador,
      'versao', v_new.versao, 'status', v_new.status, 'codigo', v_new.codigo, 'nome', v_new.nome) end,
    'existe_atualizacao', v_existe,
    'atualizavel', v_atualizavel,           -- só informa: a AÇÃO de atualizar ainda não existe (parada consciente)
    'motivo', v_motivo,
    'mapa_explicito_linhas', v_mapa_n,
    'ja_tem_matricula_na_versao_vigente', v_outra,
    'contagens', jsonb_build_object(
      'total_requisitos_vigentes', jsonb_array_length(v_req),
      'preservado', (select count(*) from jsonb_array_elements(v_req) e where e ->> 'categoria' = 'preservado'),
      'inalterado', (select count(*) from jsonb_array_elements(v_req) e where e ->> 'categoria' = 'inalterado'),
      'equivalente', (select count(*) from jsonb_array_elements(v_req) e where e ->> 'categoria' = 'equivalente'),
      'novo', (select count(*) from jsonb_array_elements(v_req) e where e ->> 'categoria' = 'novo'),
      'refazer', (select count(*) from jsonb_array_elements(v_req) e where e ->> 'categoria' = 'refazer'),
      'removido', jsonb_array_length(v_rem)),
    'requisitos', v_req,
    'removidos', v_rem
  );
end;
$$;
revoke all on function public.classe_atualizacao_previa(uuid) from public, anon;
grant execute on function public.classe_atualizacao_previa(uuid) to authenticated;

select public._manutencao_instalar_guarda();
notify pgrst, 'reload schema';
