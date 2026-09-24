-- =============================================================================
--  Fase 9.1 (item 9) — Especialidades viram um recurso PRÓPRIO, que só a PLATAFORMA liga.
--
--  O que estava errado (auditoria da fase 9, frente "especialidades-flag"):
--
--    · Não existia recurso "especialidades". Tudo de especialidade, no servidor e no front, ficava
--      atrás da chave 'classes'. Um clube que ligava as Classes (que já rodam sobre o catálogo
--      OFICIAL 2026.2) levava junto as especialidades — e o único catálogo de especialidades que
--      existe é o de TESTE ("[PILOTO/TESTE] Primeiros Socorros").
--    · Quem liga é a liderança do clube, sozinha, em Configurações → Recursos (`recurso_definir`),
--      ou direto pela API: a policy de `club_features` é FOR ALL para a liderança e `authenticated`
--      tem INSERT/UPDATE/DELETE na tabela. O onboarding (`onboarding_etapa`, etapa 'recursos')
--      também grava ali. Nenhuma dessas portas sabia de "recurso da plataforma".
--    · O catálogo de teste entrava no fluxo NORMAL justamente porque o oficial não existe:
--      `_especialidade_no_fluxo_normal` e `especialidades_disponiveis` aceitavam origem
--      'piloto_teste' enquanto `catalogo_oficial_publicado('specialty')` fosse falso. A classe
--      PILOTO da migration 36 tinha o mesmo desenho (`_classe_no_fluxo_normal`,
--      `classes_disponiveis`), hoje escondido só porque o catálogo oficial de classes existe.
--    · As RPCs de LEITURA de especialidade não checavam recurso nenhum; `meu_inicio` e
--      `avaliacoes_pendentes` mostravam o card "[PILOTO/TESTE]" com 'classes' ligado.
--    · A RLS do catálogo (specialties, specialty_requirements, classes, seções, requisitos,
--      curriculum_versions) deixava qualquer conta logada ler o [TESTE] direto por REST, e
--      `comparar_versoes_curriculares` comparava qualquer versão, inclusive a de teste.
--
--  O que muda:
--
--    1. `recursos_catalogo.somente_plataforma` (novo). A chave 'especialidades' nasce desligada e
--       somente da plataforma. A liderança não liga nem desliga: `recurso_definir` recusa com
--       mensagem clara, a policy de `club_features` não alcança essas chaves e um gatilho barra
--       qualquer outra porta de cliente (o onboarding, por exemplo). Quem liga é a plataforma: pelo
--       SQL (postgres/service_role) ou pela RPC nova `admin_recurso_do_clube_definir`, que exige
--       administrador da plataforma, audita e só liga especialidades com catálogo OFICIAL publicado.
--    2. `_exigir_especialidades_habilitado(clube)` e TODAS as RPCs de especialidade, de leitura e
--       de escrita, passam a exigir o recurso 'especialidades' (erro claro), em vez de 'classes'.
--       `meu_inicio` e `avaliacoes_pendentes` separam os blocos de especialidade no recurso próprio.
--       De carona (achados menores da mesma frente): o instrutor responsável de uma turma precisa de
--       vínculo ativo e vigente e não pode ser um responsável ('pais'); e ser responsável pela turma
--       só vale dentro do clube da turma. A descrição de 'classes' deixa de dizer "dados de teste".
--    3. SEM FALLBACK para o catálogo de teste no fluxo normal, nem para especialidade nem para
--       classe: só origem 'oficial'. As RPCs também não servem matrícula antiga de versão de teste
--       (a resposta é a mesma de "não encontrado"). A RLS do catálogo passa a mostrar só o oficial.
--       Os testes que exercitam o motor com dado sintético agora "publicam" esse dado como a
--       plataforma faria, dentro da própria transação — a regra de produção não abre.
--    4. As experiências [TESTE] que a migration 49 semeia no clube legado (Tenant 001) saem: o
--       ensaio de produção mostrou que o upgrade cria quatro delas no cliente real. Só são apagadas
--       as que não têm NENHUM rastro de uso; se alguma teve (só possível em staging), ela é
--       arquivada — deixa de aparecer para membros, e o histórico de quem participou fica.
--
--  Aplicada pelo SQL Editor numa transação só, como postgres. Pode rodar de novo.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. O catálogo de recursos sabe o que é "da plataforma"
-- -----------------------------------------------------------------------------
alter table public.recursos_catalogo add column if not exists somente_plataforma boolean not null default false;
comment on column public.recursos_catalogo.somente_plataforma is
  'true = só a plataforma liga/desliga no clube (SQL, service_role ou admin_recurso_do_clube_definir); a liderança não. O front não oferece switch.';

-- 'classes' deixa de se apresentar como "dados de teste": roda sobre o catálogo oficial desde a
-- migration 40. As especialidades ganham a chave própria (desligada; somente da plataforma).
insert into public.recursos_catalogo (chave, nome, descricao, icone, padrao, ordem, somente_plataforma) values
  ('classes', 'Classes', 'Minha Classe e a avaliação de requisitos, sobre o catálogo oficial das Classes Regulares.', '🎖️', false, 130, false),
  ('especialidades', 'Especialidades', 'Especialidades do catálogo oficial. Liberado pela plataforma quando o catálogo oficial for publicado.', '🏅', false, 135, true)
on conflict (chave) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, padrao = excluded.padrao,
      ordem = excluded.ordem, somente_plataforma = excluded.somente_plataforma;


-- -----------------------------------------------------------------------------
--  2. club_features: a liderança não grava chave da plataforma
-- -----------------------------------------------------------------------------
-- (a) a porta REST: a policy da liderança continua FOR ALL, mas não alcança chave da plataforma
drop policy if exists "lideranca gere recursos do proprio clube" on public.club_features;
create policy "lideranca gere recursos do proprio clube" on public.club_features for all to authenticated
  using (club_id = public.clube_atual_id() and public.pode_gerir_no_clube(club_id)
         and not exists (select 1 from public.recursos_catalogo c where c.chave = club_features.feature and c.somente_plataforma))
  with check (club_id = public.clube_atual_id() and public.pode_gerir_no_clube(club_id)
              and not exists (select 1 from public.recursos_catalogo c where c.chave = club_features.feature and c.somente_plataforma));

-- (b) as portas SECURITY DEFINER (recurso_definir, onboarding_etapa e qualquer uma que venha
-- depois): a RLS não as alcança, o gatilho sim. "Plataforma" = sessão sem usuário (SQL Editor,
-- service_role, cron) ou administrador da plataforma. APAGAR a linha continua livre: devolve o
-- recurso ao padrão (desligado) e é o que acontece quando um clube é excluído em cascata.
create or replace function public._proteger_recurso_da_plataforma()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_nome text;
begin
  if v_uid is null or public.eh_admin_plataforma(v_uid) then
    return new;
  end if;
  select c.nome into v_nome from public.recursos_catalogo c
   where c.somente_plataforma
     and (c.chave = new.feature or (tg_op = 'UPDATE' and c.chave = old.feature))
   limit 1;
  if v_nome is not null then
    raise exception 'O recurso "%" é liberado pela plataforma: a liderança do clube não liga nem desliga.', v_nome;
  end if;
  return new;
end;
$$;
revoke all on function public._proteger_recurso_da_plataforma() from public, anon, authenticated;
drop trigger if exists trg_proteger_recurso_da_plataforma on public.club_features;
create trigger trg_proteger_recurso_da_plataforma before insert or update on public.club_features
for each row execute function public._proteger_recurso_da_plataforma();

-- (c) a porta da tela: recusa com a mensagem certa antes de chegar no gatilho
create or replace function public.recurso_definir(p_feature text, p_enabled boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_cat record;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas a liderança do clube).';
  end if;
  if p_enabled is null then
    raise exception 'Informe se o recurso fica ligado ou desligado.';
  end if;
  select * into v_cat from public.recursos_catalogo where chave = p_feature;
  if not found then
    raise exception 'Recurso desconhecido.';
  end if;
  if v_cat.somente_plataforma then
    raise exception 'O recurso "%" é liberado pela plataforma, não pela liderança do clube.', v_cat.nome;
  end if;
  -- desligar o leilão com leilão em andamento esconderia a tela com pontos das unidades em jogo
  if p_feature = 'leilao' and not p_enabled
     and exists (select 1 from public.leiloes where club_id = v_club and status = 'aberto') then
    raise exception 'Há leilão aberto: encerre ou cancele antes de desligar o leilão.';
  end if;
  insert into public.club_features (club_id, feature, enabled) values (v_club, p_feature, p_enabled)
  on conflict (club_id, feature) do update set enabled = excluded.enabled, updated_at = now();
  perform public._auditar('recurso_alterado', v_club, null, jsonb_build_object('recurso', p_feature, 'ligado', p_enabled));
  return public.recursos_do_clube(v_club);
end;
$$;
revoke all on function public.recurso_definir(text, boolean) from public, anon;
grant execute on function public.recurso_definir(text, boolean) to authenticated;

-- (d) a porta da plataforma. Especialidades só ligam com catálogo OFICIAL publicado: ligar antes
-- mostraria uma tela vazia (e, antes desta migration, o catálogo de teste). O plano continua sendo
-- o teto: recurso fora do plano do clube não liga por aqui — muda-se o plano (ato comercial).
create or replace function public.admin_recurso_do_clube_definir(p_club_id uuid, p_feature text, p_enabled boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_cat record;
begin
  perform public._exigir_admin_plataforma();
  if p_enabled is null then
    raise exception 'Informe se o recurso fica ligado ou desligado.';
  end if;
  if not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Clube não encontrado.';
  end if;
  select * into v_cat from public.recursos_catalogo where chave = p_feature;
  if not found then
    raise exception 'Recurso desconhecido.';
  end if;
  if p_enabled and p_feature = 'especialidades' and not public.catalogo_oficial_publicado('specialty') then
    raise exception 'Especialidades só podem ser liberadas depois que o catálogo OFICIAL de especialidades for publicado.';
  end if;
  if p_enabled and not public.recurso_disponivel_no_plano(p_club_id, p_feature) then
    raise exception 'O plano deste clube não inclui "%": ajuste o plano antes de liberar.', v_cat.nome;
  end if;
  insert into public.club_features (club_id, feature, enabled) values (p_club_id, p_feature, p_enabled)
  on conflict (club_id, feature) do update set enabled = excluded.enabled, updated_at = now();
  perform public._auditar('recurso_alterado_pela_plataforma', p_club_id, null, jsonb_build_object('recurso', p_feature, 'ligado', p_enabled));
  return public.recursos_do_clube(p_club_id);
end;
$$;
revoke all on function public.admin_recurso_do_clube_definir(uuid, text, boolean) from public, anon;
grant execute on function public.admin_recurso_do_clube_definir(uuid, text, boolean) to authenticated;


-- -----------------------------------------------------------------------------
--  3. O gate próprio e o filtro "só catálogo oficial"
-- -----------------------------------------------------------------------------
create or replace function public._exigir_especialidades_habilitado(p_club uuid)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.recurso_habilitado_no_clube(p_club, 'especialidades') then
    raise exception 'As especialidades não estão liberadas neste clube.';
  end if;
end;
$$;
revoke all on function public._exigir_especialidades_habilitado(uuid) from public, anon, authenticated;

-- Especialidade de versão que NÃO é oficial (a de teste) não existe para o app: nem no catálogo,
-- nem em matrícula antiga. Arquivada continua valendo (quem começou numa versão termina nela).
create or replace function public._especialidade_do_catalogo_oficial(p_specialty_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.specialties s
    join public.curriculum_versions v on v.id = s.curriculum_version_id
    where s.id = p_specialty_id and v.origem = 'oficial'
  );
$$;
revoke all on function public._especialidade_do_catalogo_oficial(uuid) from public, anon, authenticated;

-- fluxo normal = publicada E oficial. Sem o "ou enquanto não houver oficial".
create or replace function public._especialidade_no_fluxo_normal(p_specialty_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.especialidade_esta_publicada(p_specialty_id) and public._especialidade_do_catalogo_oficial(p_specialty_id);
$$;
revoke all on function public._especialidade_no_fluxo_normal(uuid) from public, anon, authenticated;

create or replace function public._classe_no_fluxo_normal(p_class_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.classe_esta_publicada(p_class_id) and exists (
    select 1 from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id
    where c.id = p_class_id and v.origem = 'oficial'
  );
$$;
revoke all on function public._classe_no_fluxo_normal(uuid) from public, anon, authenticated;

create or replace function public.classes_disponiveis()
returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'class_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
    'idade_minima', c.idade_minima, 'manifesto_id', c.manifesto_id, 'vigente_desde', c.vigente_desde,
    'elegivel', public._classe_motivo_inelegivel(auth.uid(), c.id) is null,
    'motivo_inelegivel', public._classe_motivo_inelegivel(auth.uid(), c.id),
    'curriculum_version', json_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao)
  ) order by c.ordem, c.nome), '[]'::json)
  from public.classes c
  join public.curriculum_versions v on v.id = c.curriculum_version_id
  where c.ativo and v.status = 'publicado' and v.origem = 'oficial'
    and public.membro_ativo_no_clube(public.clube_atual_id())
    and not exists (
      select 1 from public.member_classes mc
      where mc.usuario_id = auth.uid() and mc.club_id = public.clube_atual_id() and mc.class_id = c.id and mc.status <> 'cancelada'
    );
$$;


-- -----------------------------------------------------------------------------
--  4. As RPCs de especialidade: recurso próprio + só catálogo oficial
-- -----------------------------------------------------------------------------
create or replace function public.especialidades_disponiveis()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null then return '[]'::json; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'specialty_id', sp.id, 'codigo', sp.codigo, 'nome', sp.nome, 'categoria', sp.categoria, 'nivel', sp.nivel,
      'curriculum_version', json_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao),
      'dependencias_pendentes', public.dependencias_pendentes('specialty', sp.id, v_uid, v_club)
    ) order by sp.ordem, sp.nome)
    from public.specialties sp
    join public.curriculum_versions v on v.id = sp.curriculum_version_id
    where sp.ativo and v.status = 'publicado' and v.origem = 'oficial'
      and public.membro_ativo_no_clube(v_club)
      and not exists (
        select 1 from public.member_specialties ms
        where ms.usuario_id = v_uid and ms.club_id = v_club and ms.specialty_id = sp.id and ms.status <> 'cancelada'
      )
  ), '[]'::json);
end;
$$;

create or replace function public.especialidade_iniciar(p_specialty_id uuid, p_oferta_id uuid default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_ms_id uuid; v_faltando text[];
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  if not public._especialidade_no_fluxo_normal(p_specialty_id) then raise exception 'Especialidade não encontrada.'; end if;
  if p_oferta_id is not null and not exists (select 1 from public.specialty_offerings where id = p_oferta_id and club_id = v_club and specialty_id = p_specialty_id) then
    raise exception 'Turma/oferta não encontrada neste clube.';
  end if;
  v_faltando := public.dependencias_pendentes('specialty', p_specialty_id, v_uid, v_club);
  if array_length(v_faltando, 1) > 0 then raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', '); end if;
  v_ms_id := public._especialidade_matricular(v_uid, v_club, p_specialty_id, p_oferta_id);
  return json_build_object('ok', true, 'member_specialty_id', v_ms_id);
end;
$$;

create or replace function public.especialidade_atribuir(p_usuario_id uuid, p_specialty_id uuid, p_oferta_id uuid default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_ms_id uuid; v_faltando text[];
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_especialidades_habilitado(v_club);
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_usuario_id and m.organizational_unit_id = v_club and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Pessoa sem vínculo ativo neste clube.';
  end if;
  if not public._especialidade_no_fluxo_normal(p_specialty_id) then raise exception 'Especialidade não encontrada.'; end if;
  if p_oferta_id is not null and not exists (select 1 from public.specialty_offerings where id = p_oferta_id and club_id = v_club and specialty_id = p_specialty_id) then
    raise exception 'Turma/oferta não encontrada neste clube.';
  end if;
  v_faltando := public.dependencias_pendentes('specialty', p_specialty_id, p_usuario_id, v_club);
  if array_length(v_faltando, 1) > 0 then raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', '); end if;
  v_ms_id := public._especialidade_matricular(p_usuario_id, v_club, p_specialty_id, p_oferta_id);
  return json_build_object('ok', true, 'member_specialty_id', v_ms_id);
end;
$$;

-- turma nova: só de especialidade do fluxo normal (antes aceitava qualquer publicada, inclusive a de
-- teste depois de existir o oficial). O instrutor responsável precisa de vínculo ATIVO e VIGENTE, e
-- não pode ser um responsável ('pais'): ele passa a avaliar as crianças da turma.
create or replace function public.oferta_especialidade_criar(p_specialty_id uuid, p_titulo text, p_instrutor_responsavel_id uuid default null,
  p_periodo_inicio date default null, p_periodo_fim date default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_id uuid;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_especialidades_habilitado(v_club);
  if not public._especialidade_no_fluxo_normal(p_specialty_id) then raise exception 'Especialidade não encontrada.'; end if;
  if p_instrutor_responsavel_id is not null and not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_instrutor_responsavel_id and m.organizational_unit_id = v_club and m.status = 'ativo' and m.role <> 'pais'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'O instrutor responsável precisa ter vínculo ativo neste clube.';
  end if;
  insert into public.specialty_offerings (club_id, specialty_id, instrutor_responsavel_id, titulo, periodo_inicio, periodo_fim, criado_por)
  values (v_club, p_specialty_id, p_instrutor_responsavel_id, p_titulo, p_periodo_inicio, p_periodo_fim, v_uid)
  returning id into v_id;
  return json_build_object('ok', true, 'oferta_id', v_id);
end;
$$;

create or replace function public.ofertas_especialidade_do_clube()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then return '[]'::json; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'oferta_id', o.id, 'specialty_id', o.specialty_id, 'especialidade_nome', sp.nome, 'titulo', o.titulo,
      'instrutor_responsavel_id', o.instrutor_responsavel_id, 'instrutor_responsavel_nome', p.nome,
      'periodo_inicio', o.periodo_inicio, 'periodo_fim', o.periodo_fim, 'status', o.status,
      'participantes', (select count(*) from public.member_specialties ms where ms.oferta_id = o.id)
    ) order by o.created_at desc)
    from public.specialty_offerings o
    join public.specialties sp on sp.id = o.specialty_id
    left join public.profiles p on p.id = o.instrutor_responsavel_id
    where o.club_id = v_club and public._especialidade_do_catalogo_oficial(o.specialty_id)
  ), '[]'::json);
end;
$$;

create or replace function public.minha_especialidade(p_member_specialty_id uuid default null)
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_ms record;
begin
  if v_uid is null or v_club is null then return null; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  if p_member_specialty_id is not null then
    select * into v_ms from public.member_specialties
     where id = p_member_specialty_id and usuario_id = v_uid and club_id = v_club
       and public._especialidade_do_catalogo_oficial(specialty_id);
  else
    select * into v_ms from public.member_specialties
     where usuario_id = v_uid and club_id = v_club and public._especialidade_do_catalogo_oficial(specialty_id)
     order by (status = 'em_andamento') desc, iniciada_em desc
     limit 1;
  end if;
  if v_ms.id is null then return null; end if;

  return json_build_object(
    'member_specialty', json_build_object(
      'id', v_ms.id, 'status', v_ms.status, 'iniciada_em', v_ms.iniciada_em, 'concluida_em', v_ms.concluida_em,
      'percentual', public.especialidade_percentual(v_ms.id)
    ),
    'especialidade', (select json_build_object('id', sp.id, 'codigo', sp.codigo, 'nome', sp.nome, 'categoria', sp.categoria, 'nivel', sp.nivel)
                       from public.specialties sp where sp.id = v_ms.specialty_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao)
      from public.specialties sp join public.curriculum_versions ver on ver.id = sp.curriculum_version_id where sp.id = v_ms.specialty_id
    ),
    'oferta', (select json_build_object('titulo', o.titulo, 'instrutor_responsavel_nome', p.nome, 'periodo_inicio', o.periodo_inicio, 'periodo_fim', o.periodo_fim)
               from public.specialty_offerings o left join public.profiles p on p.id = o.instrutor_responsavel_id where o.id = v_ms.oferta_id),
    'requisitos', (
      select coalesce(json_agg(json_build_object(
        'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao,
        'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
        'member_specialty_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
        'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
        'avaliacoes', (
          select coalesce(json_agg(json_build_object(
            'decisao', a.decisao, 'avaliado_por_nome', p2.nome, 'avaliado_papel', a.avaliado_papel,
            'comentario', a.comentario, 'created_at', a.created_at
          ) order by a.created_at), '[]'::json)
          from public.requirement_approvals a
          join public.profiles p2 on p2.id = a.avaliado_por
          where mr.id is not null and a.member_specialty_requirement_id = mr.id
        )
      ) order by r.ordem, r.codigo), '[]'::json)
      from public.specialty_requirements r
      left join public.member_specialty_requirements mr on mr.specialty_requirement_id = r.id and mr.member_specialty_id = v_ms.id
      where r.specialty_id = v_ms.specialty_id and r.ativo
    )
  );
end;
$$;

-- Requisito de especialidade de versão que não é oficial responde "não encontrado" — a mesma
-- mensagem de um id que não existe (sem oráculo).
create or replace function public.especialidade_requisito_salvar(p_specialty_requirement_id uuid, p_texto text default null, p_evidencia_path text default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements
   where specialty_requirement_id = p_specialty_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._especialidade_do_catalogo_oficial((select r.specialty_id from public.specialty_requirements r where r.id = p_specialty_requirement_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  update public.member_specialty_requirements
     set evidencia_texto = coalesce(p_texto, evidencia_texto),
         evidencia_path = coalesce(p_evidencia_path, evidencia_path),
         status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         updated_at = now()
   where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.especialidade_requisito_enviar(p_specialty_requirement_id uuid)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements
   where specialty_requirement_id = p_specialty_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  select * into v_req from public.specialty_requirements where id = p_specialty_requirement_id;
  if v_mr.id is null or not public._especialidade_do_catalogo_oficial(v_req.specialty_id) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
    raise exception 'Este requisito exige uma evidência antes de enviar.';
  end if;
  update public.member_specialty_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.especialidade_requisito_avaliar(p_member_specialty_requirement_id uuid, p_decisao text, p_comentario text default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_papel text;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements where id = p_member_specialty_requirement_id and club_id = v_club for update;
  if not found or not public._especialidade_do_catalogo_oficial((select r.specialty_id from public.specialty_requirements r where r.id = v_mr.specialty_requirement_id)) then
    raise exception 'Requisito não encontrado neste clube.';
  end if;
  if not public._pode_avaliar_especialidade(v_mr.member_specialty_id, v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube, ou o instrutor responsável pela turma).';
  end if;

  v_papel := coalesce(public.papel_no_clube(v_uid, v_club), 'responsavel_da_turma');
  update public.member_specialty_requirements set status = p_decisao, updated_at = now() where id = v_mr.id;

  insert into public.requirement_approvals (member_specialty_requirement_id, specialty_requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario)
  select v_mr.id, v_mr.specialty_requirement_id, ver.id, v_club, p_decisao, v_uid, v_papel, p_comentario
  from public.specialty_requirements r
  join public.specialties sp on sp.id = r.specialty_id
  join public.curriculum_versions ver on ver.id = sp.curriculum_version_id
  where r.id = v_mr.specialty_requirement_id;

  return json_build_object('ok', true);
end;
$$;

create or replace function public.especialidade_avaliacoes_pendentes()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null then return '[]'::json; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'member_specialty_requirement_id', mr.id,
      'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
      'especialidade_nome', sp.nome,
      'requisito_id', r.id, 'requisito_codigo', r.codigo, 'requisito_descricao', r.descricao,
      'tipo_evidencia', r.tipo_evidencia, 'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path,
      'enviado_em', mr.enviado_em
    ) order by mr.enviado_em)
    from public.member_specialty_requirements mr
    join public.specialty_requirements r on r.id = mr.specialty_requirement_id
    join public.specialties sp on sp.id = r.specialty_id
    join public.profiles p on p.id = mr.usuario_id
    where mr.club_id = v_club and mr.status = 'aguardando_avaliacao'
      and public._especialidade_do_catalogo_oficial(sp.id)
      and public._pode_avaliar_especialidade(mr.member_specialty_id, v_club)
  ), '[]'::json);
end;
$$;

-- a explicação continua devolvendo NULL para quem não pode ver (sem oráculo); para quem pode, exige
-- o recurso e ignora a versão de teste
create or replace function public.explicar_requisito_especialidade(p_member_specialty_requirement_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mr record; v_req record; v_regras jsonb := '[]'::jsonb; v_bloqueado boolean := false; v_resultado text;
  v_grupo record; v_opcoes jsonb; v_conteudo jsonb;
begin
  select * into v_mr from public.member_specialty_requirements where id = p_member_specialty_requirement_id;
  if not found then return null; end if;
  if not ((v_mr.usuario_id = auth.uid() and public.membro_ativo_no_clube(v_mr.club_id)) or public.pode_gerir_no_clube(v_mr.club_id)) then return null; end if;

  select * into v_req from public.specialty_requirements where id = v_mr.specialty_requirement_id;
  if not public._especialidade_do_catalogo_oficial(v_req.specialty_id) then return null; end if;
  perform public._exigir_especialidades_habilitado(v_mr.club_id);

  if v_req.conteudo_dinamico_definicao_id is not null then
    -- sem data explícita: vale o dia padrão do resolvedor (a migration 84 o torna o dia no Brasil)
    select public.conteudo_dinamico_resolver(chave) into v_conteudo
      from public.dynamic_content_definitions where id = v_req.conteudo_dinamico_definicao_id;
    v_regras := v_regras || jsonb_build_object(
      'regra', 'conteudo_dinamico', 'satisfeito', (v_conteudo is not null and v_conteudo ->> 'valor' is not null),
      'origem', 'dynamic_content_definitions + dynamic_content_values', 'detalhe', coalesce(v_conteudo, 'null'::jsonb)
    );
    if v_conteudo is null or v_conteudo ->> 'valor' is null then v_bloqueado := true; end if;
  end if;

  select * into v_grupo from public.requirement_option_groups where alvo_tipo = 'specialty_requirement' and alvo_id = v_mr.specialty_requirement_id;
  if found then
    v_opcoes := public.opcoes_satisfeitas_automaticamente(v_grupo.id, v_mr.usuario_id);
    v_regras := v_regras || jsonb_build_object(
      'regra', 'escolha_n_de_m',
      'satisfeito', (((v_opcoes ->> 'satisfeitas')::int >= (v_opcoes ->> 'n_minimo')::int) or v_mr.status = 'aprovado'),
      'origem', 'requirement_option_groups + requirement_options', 'detalhe', v_opcoes
    );
  end if;

  if v_mr.status = 'aprovado' then v_resultado := 'satisfeito';
  elsif v_bloqueado then v_resultado := 'bloqueado';
  else v_resultado := 'pendente';
  end if;

  return jsonb_build_object(
    'requisito', jsonb_build_object('tipo', 'specialty_requirement', 'id', v_mr.specialty_requirement_id, 'status_operacional', v_mr.status),
    'resultado', v_resultado, 'regras_aplicadas', v_regras
  );
end;
$$;

-- o responsável pela turma só conta DENTRO do clube da turma
create or replace function public._e_responsavel_da_oferta(p_member_specialty_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member_specialties ms
    join public.specialty_offerings o on o.id = ms.oferta_id and o.club_id = ms.club_id
    where ms.id = p_member_specialty_id and o.instrutor_responsavel_id = auth.uid()
  );
$$;


-- -----------------------------------------------------------------------------
--  5. Fila única da Gestão e o Início: especialidade no recurso próprio
-- -----------------------------------------------------------------------------
create or replace function public.avaliacoes_pendentes()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas a liderança do clube).';
  end if;
  return jsonb_build_object(
    'classes', case when public.recurso_habilitado_no_clube(v_club, 'classes')
      then (select count(*) from public.member_requirements where club_id = v_club and status = 'aguardando_avaliacao') end,
    'especialidades', case when public.recurso_habilitado_no_clube(v_club, 'especialidades')
      then (select count(*) from public.member_specialty_requirements msr
              join public.member_specialties ms on ms.id = msr.member_specialty_id
             where msr.club_id = v_club and msr.status = 'aguardando_avaliacao'
               and public._especialidade_do_catalogo_oficial(ms.specialty_id)) end,
    'investiduras', case when public.recurso_habilitado_no_clube(v_club, 'classes')
      then (select count(*) from public.member_classes where club_id = v_club and status in ('requisitos_concluidos', 'aguardando_revisao', 'apto_investidura')) end,
    'experiencias', case when public.recurso_habilitado_no_clube(v_club, 'experiencias')
      then (select count(*) from public.experience_submissions where club_id = v_club and status = 'enviada') end,
    'atividades', case when public.recurso_habilitado_no_clube(v_club, 'atividades')
      then (select count(*) from public.entregas where club_id = v_club and status = 'pendente') end,
    'missoes', case when public.recurso_habilitado_no_clube(v_club, 'missoes')
      then (select count(*) from public.missoes_feitas where club_id = v_club and status = 'pendente') end,
    'cadastros', (select count(*) from public.organization_memberships where organizational_unit_id = v_club and status = 'pendente'));
end;
$$;

-- `meu_inicio` é grande e só três trechos mudam: troca cirúrgica sobre a definição REAL (mesmo
-- padrão das migrations 69 e 70). Se algum trecho não estiver lá, a migration PARA: seria sinal
-- de que a função mudou de forma e a troca precisa ser revista.
do $$
declare v_fonte text; v_novo text; v_antes text;
begin
  v_fonte := pg_get_functiondef('public.meu_inicio()'::regprocedure);
  -- já trocada (esta migration rodou antes): nada a fazer — é o que a deixa rodar de novo
  if position('_especialidade_do_catalogo_oficial' in v_fonte) > 0 then return; end if;
  v_novo := v_fonte;

  -- (a) correção em especialidade: sai de dentro do bloco de 'classes' para um bloco próprio
  v_antes := v_novo;
  v_novo := replace(v_novo,
$velho$    -- ===== peso 40: especialidade com requisito devolvido =====
    select count(*) into v_n
      from public.member_specialty_requirements msr
     where msr.usuario_id = v_uid and msr.club_id = v_club and msr.status = 'correcao_solicitada';
    if v_n > 0 then
      v_itens := v_itens || public._inicio_item('especialidade_correcao', 96, '✏️',
        'Correção em uma especialidade',
        public._plural(v_n, 'item espera', 'itens esperam') || ' a sua correção.',
        '/minhas-especialidades', v_n);
    end if;
  end if;$velho$,
$novo$  end if;

  -- ===== peso 96: especialidade com requisito devolvido (recurso PRÓPRIO desde a migration 83; só catálogo oficial) =====
  if public.recurso_habilitado_no_clube(v_club, 'especialidades') then
    select count(*) into v_n
      from public.member_specialty_requirements msr
      join public.member_specialties ms on ms.id = msr.member_specialty_id
     where msr.usuario_id = v_uid and msr.club_id = v_club and msr.status = 'correcao_solicitada'
       and public._especialidade_do_catalogo_oficial(ms.specialty_id);
    if v_n > 0 then
      v_itens := v_itens || public._inicio_item('especialidade_correcao', 96, '✏️',
        'Correção em uma especialidade',
        public._plural(v_n, 'item espera', 'itens esperam') || ' a sua correção.',
        '/minhas-especialidades', v_n);
    end if;
  end if;$novo$);
  if v_novo = v_antes then raise exception 'meu_inicio mudou de forma (bloco "especialidade com requisito devolvido"): revise a troca'; end if;

  -- (b) o contador "avaliar" da liderança soma especialidade só com o recurso próprio
  v_antes := v_novo;
  v_novo := replace(v_novo,
$velho$    if public.recurso_habilitado_no_clube(v_club, 'classes') then
      v_n := v_n
        + (select count(*) from public.member_requirements where club_id = v_club and status = 'aguardando_avaliacao')
        + (select count(*) from public.member_specialty_requirements where club_id = v_club and status = 'aguardando_avaliacao');
    end if;$velho$,
$novo$    if public.recurso_habilitado_no_clube(v_club, 'classes') then
      v_n := v_n
        + (select count(*) from public.member_requirements where club_id = v_club and status = 'aguardando_avaliacao');
    end if;
    if public.recurso_habilitado_no_clube(v_club, 'especialidades') then
      v_n := v_n
        + (select count(*) from public.member_specialty_requirements msr
             join public.member_specialties ms on ms.id = msr.member_specialty_id
            where msr.club_id = v_club and msr.status = 'aguardando_avaliacao'
              and public._especialidade_do_catalogo_oficial(ms.specialty_id));
    end if;$novo$);
  if v_novo = v_antes then raise exception 'meu_inicio mudou de forma (contador "avaliar"): revise a troca'; end if;

  -- (c) "continue de onde parou": idem, bloco próprio e só catálogo oficial
  v_antes := v_novo;
  v_novo := replace(v_novo,
$velho$    -- ===== peso 40: especialidade em andamento =====
    select sp.nome into v_txt
      from public.member_specialties ms
      join public.specialties sp on sp.id = ms.specialty_id
     where ms.usuario_id = v_uid and ms.club_id = v_club and ms.status = 'em_andamento'
     order by ms.updated_at desc limit 1;
    if v_txt is not null then
      v_itens := v_itens || public._inicio_item('especialidade', 40, '🏅',
        'Continue de onde parou', 'Você está fazendo a especialidade ' || v_txt || '.',
        '/minhas-especialidades', null);
    end if;
  end if;$velho$,
$novo$  end if;

  -- ===== peso 40: especialidade em andamento (recurso próprio; só catálogo oficial) =====
  if public.recurso_habilitado_no_clube(v_club, 'especialidades') then
    select sp.nome into v_txt
      from public.member_specialties ms
      join public.specialties sp on sp.id = ms.specialty_id
     where ms.usuario_id = v_uid and ms.club_id = v_club and ms.status = 'em_andamento'
       and public._especialidade_do_catalogo_oficial(sp.id)
     order by ms.updated_at desc limit 1;
    if v_txt is not null then
      v_itens := v_itens || public._inicio_item('especialidade', 40, '🏅',
        'Continue de onde parou', 'Você está fazendo a especialidade ' || v_txt || '.',
        '/minhas-especialidades', null);
    end if;
  end if;$novo$);
  if v_novo = v_antes then raise exception 'meu_inicio mudou de forma (bloco "especialidade em andamento"): revise a troca'; end if;

  execute v_novo;
end $$;


-- -----------------------------------------------------------------------------
--  6. O catálogo visto pela API: só o oficial
-- -----------------------------------------------------------------------------
-- As RPCs são SECURITY DEFINER e não passam por aqui; isto é o que uma conta logada lê direto por
-- REST. Seções e requisitos herdam a regra da classe/especialidade pela própria RLS (a subconsulta
-- roda como quem pergunta), então a regra mora num lugar só por tabela-mãe.
drop policy if exists "leitura do curriculo publicado" on public.curriculum_versions;
create policy "leitura do curriculo publicado" on public.curriculum_versions for select to authenticated
  using (status = 'publicado' and origem = 'oficial');

drop policy if exists "leitura do curriculo publicado" on public.classes;
create policy "leitura do curriculo publicado" on public.classes for select to authenticated
  using (ativo and exists (select 1 from public.curriculum_versions v
                            where v.id = classes.curriculum_version_id and v.status = 'publicado' and v.origem = 'oficial'));

drop policy if exists "leitura do curriculo publicado" on public.class_sections;
create policy "leitura do curriculo publicado" on public.class_sections for select to authenticated
  using (exists (select 1 from public.classes c where c.id = class_sections.class_id));

drop policy if exists "leitura do curriculo publicado" on public.class_requirements;
create policy "leitura do curriculo publicado" on public.class_requirements for select to authenticated
  using (ativo and exists (select 1 from public.class_sections s where s.id = class_requirements.section_id));

drop policy if exists "leitura do curriculo publicado" on public.specialties;
create policy "leitura do curriculo publicado" on public.specialties for select to authenticated
  using (ativo and exists (select 1 from public.curriculum_versions v
                            where v.id = specialties.curriculum_version_id and v.status = 'publicado' and v.origem = 'oficial'));

drop policy if exists "leitura do curriculo publicado" on public.specialty_requirements;
create policy "leitura do curriculo publicado" on public.specialty_requirements for select to authenticated
  using (ativo and exists (select 1 from public.specialties s where s.id = specialty_requirements.specialty_id));

-- O diff entre versões continua API (migration 56 explica por quê), mas só entre versões OFICIAIS
-- para quem é do app. A plataforma (sessão sem usuário ou administrador) compara qualquer uma.
create or replace function public.comparar_versoes_curriculares(p_versao_a uuid, p_versao_b uuid)
returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.eh_admin_plataforma(auth.uid())
     and exists (select 1 from public.curriculum_versions v where v.id in (p_versao_a, p_versao_b) and v.origem <> 'oficial') then
    return null;
  end if;
  return (
    with req_a as (
      select 'class_requirement'::text as tipo, c.codigo as pai_codigo, c.nome as pai_nome, r.codigo,
             r.descricao, r.tipo_evidencia, r.evidencia_obrigatoria, r.ordem
      from public.class_requirements r
      join public.class_sections s on s.id = r.section_id
      join public.classes c on c.id = s.class_id
      where c.curriculum_version_id = p_versao_a
      union all
      select 'specialty_requirement', sp.codigo, sp.nome, r.codigo, r.descricao, r.tipo_evidencia, r.evidencia_obrigatoria, r.ordem
      from public.specialty_requirements r join public.specialties sp on sp.id = r.specialty_id
      where sp.curriculum_version_id = p_versao_a
    ),
    req_b as (
      select 'class_requirement'::text as tipo, c.codigo as pai_codigo, c.nome as pai_nome, r.codigo,
             r.descricao, r.tipo_evidencia, r.evidencia_obrigatoria, r.ordem
      from public.class_requirements r
      join public.class_sections s on s.id = r.section_id
      join public.classes c on c.id = s.class_id
      where c.curriculum_version_id = p_versao_b
      union all
      select 'specialty_requirement', sp.codigo, sp.nome, r.codigo, r.descricao, r.tipo_evidencia, r.evidencia_obrigatoria, r.ordem
      from public.specialty_requirements r join public.specialties sp on sp.id = r.specialty_id
      where sp.curriculum_version_id = p_versao_b
    )
    select json_build_object(
      'versao_a', (select json_build_object('id', id, 'identificador', identificador, 'versao', versao, 'status', status) from public.curriculum_versions where id = p_versao_a),
      'versao_b', (select json_build_object('id', id, 'identificador', identificador, 'versao', versao, 'status', status) from public.curriculum_versions where id = p_versao_b),
      'adicionados', (
        select coalesce(json_agg(json_build_object('tipo', b.tipo, 'pai', b.pai_nome, 'codigo', b.codigo, 'descricao', b.descricao) order by b.pai_codigo, b.codigo), '[]'::json)
        from req_b b where not exists (select 1 from req_a a where a.tipo = b.tipo and a.pai_codigo = b.pai_codigo and a.codigo = b.codigo)
      ),
      'removidos', (
        select coalesce(json_agg(json_build_object('tipo', a.tipo, 'pai', a.pai_nome, 'codigo', a.codigo, 'descricao', a.descricao) order by a.pai_codigo, a.codigo), '[]'::json)
        from req_a a where not exists (select 1 from req_b b where b.tipo = a.tipo and b.pai_codigo = a.pai_codigo and b.codigo = a.codigo)
      ),
      'alterados', (
        select coalesce(json_agg(json_build_object(
          'tipo', a.tipo, 'pai', a.pai_nome, 'codigo', a.codigo,
          'descricao_antes', a.descricao, 'descricao_depois', b.descricao,
          'tipo_evidencia_antes', a.tipo_evidencia, 'tipo_evidencia_depois', b.tipo_evidencia,
          'evidencia_obrigatoria_antes', a.evidencia_obrigatoria, 'evidencia_obrigatoria_depois', b.evidencia_obrigatoria
        ) order by a.pai_codigo, a.codigo), '[]'::json)
        from req_a a join req_b b on b.tipo = a.tipo and b.pai_codigo = a.pai_codigo and b.codigo = a.codigo
        where a.descricao is distinct from b.descricao
           or a.tipo_evidencia is distinct from b.tipo_evidencia
           or a.evidencia_obrigatoria is distinct from b.evidencia_obrigatoria
      )
    )
  );
end;
$$;


-- -----------------------------------------------------------------------------
--  7. As experiências [TESTE] da migration 49 saem do clube legado
-- -----------------------------------------------------------------------------
-- "Sem uso" = nenhuma participação, envio, recompensa, conquista, evento de auditoria, denúncia
-- nem versão derivada. No upgrade de produção é o caso das quatro (o recurso nasce desligado e
-- tudo roda na mesma janela). As etapas e o público saem pela cascata da própria chave estrangeira.
do $$
declare v_club uuid := public.clube_legado_id(); v_apagadas int; v_temporadas int; v_arquivadas int;
begin
  if v_club is null then return; end if;

  delete from public.experiences e
   where e.club_id = v_club and e.teste and e.titulo like '[TESTE]%'
     and not exists (select 1 from public.experience_participations x where x.experience_id = e.id)
     and not exists (select 1 from public.experience_submissions x where x.experience_id = e.id)
     and not exists (select 1 from public.experience_rewards x where x.experience_id = e.id)
     and not exists (select 1 from public.member_badges x where x.experience_id = e.id)
     and not exists (select 1 from public.experience_events x where x.experience_id = e.id)
     and not exists (select 1 from public.experience_reports x where x.experience_id = e.id)
     and not exists (select 1 from public.experiences x where x.raiz_id = e.id and x.id <> e.id);
  get diagnostics v_apagadas = row_count;

  delete from public.experience_seasons s
   where s.club_id = v_club and s.teste and s.titulo like '[TESTE]%'
     and not exists (select 1 from public.experiences e where e.season_id = s.id)
     and not exists (select 1 from public.experience_events x where x.season_id = s.id);
  get diagnostics v_temporadas = row_count;

  -- o que teve uso (só possível fora da produção) fica, arquivado: membro não vê; a liderança e o
  -- histórico de quem participou continuam lá
  update public.experiences set status = 'arquivada', updated_at = now()
   where club_id = v_club and teste and titulo like '[TESTE]%' and status <> 'arquivada';
  get diagnostics v_arquivadas = row_count;
  update public.experience_seasons set status = 'arquivada', updated_at = now()
   where club_id = v_club and teste and titulo like '[TESTE]%' and status <> 'arquivada';

  raise notice '[83] experiências [TESTE] do clube legado: % apagada(s), % temporada(s) apagada(s), % arquivada(s)', v_apagadas, v_temporadas, v_arquivadas;
end $$;

notify pgrst, 'reload schema';
