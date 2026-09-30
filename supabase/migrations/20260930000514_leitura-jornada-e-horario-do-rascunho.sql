-- =============================================================================
--  Fase 8 — (1) HORÁRIO do rascunho no servidor (conflito de rascunho mostra "versão do aparelho × versão da nuvem com horário"),
--           (2) CATÁLOGO DE LEITURA + progresso de leitura/áudio + administração com auditoria,
--           (3) MINHA JORNADA e PORTFÓLIO de atividades.
--  Tudo ADITIVO: nenhuma tabela/coluna existente muda de significado; nenhuma comprovação antiga é tocada.
-- =============================================================================

-- ==================== 1) horário do rascunho (servidor) ====================
alter table public.member_requirements add column if not exists rascunho_em timestamptz;
alter table public.member_specialty_requirements add column if not exists rascunho_em timestamptz;

CREATE OR REPLACE FUNCTION public.requisito_relatorio_salvar(p_requirement_id uuid, p_conteudo jsonb, p_anexos jsonb DEFAULT '[]'::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_mod public.requisito_modelos; v_erros text[];
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  if v_mr.status = 'aguardando_avaliacao' then raise exception 'Este requisito já foi enviado. Aguarde a avaliação.'; end if;
  v_mod := public._modelo_da_classe(p_requirement_id);
  if v_mod.id is null then raise exception 'Este requisito não tem formulário.'; end if;
  v_erros := public._relatorio_validar(v_mod.schema, p_conteudo, p_anexos, false) || public._anexos_do_dono_erros(p_anexos, v_uid, v_club);
  if array_length(v_erros, 1) > 0 then raise exception 'Formulário: %', public._erros_em_texto(v_erros); end if;
  update public.member_requirements
     set rascunho = p_conteudo, rascunho_anexos = coalesce(p_anexos, '[]'::jsonb),
         status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         rascunho_em = now(), updated_at = now()
   where id = v_mr.id;
  return json_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.especialidade_requisito_relatorio_salvar(p_specialty_requirement_id uuid, p_conteudo jsonb, p_anexos jsonb DEFAULT '[]'::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record; v_erros text[];
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
  if v_mr.status = 'aguardando_avaliacao' then raise exception 'Este requisito já foi enviado. Aguarde a avaliação.'; end if;
  if v_req.modelo is null then raise exception 'Este requisito não tem formulário.'; end if;
  v_erros := public._relatorio_validar(v_req.modelo, p_conteudo, p_anexos, false) || public._anexos_do_dono_erros(p_anexos, v_uid, v_club);
  if array_length(v_erros, 1) > 0 then raise exception 'Formulário: %', public._erros_em_texto(v_erros); end if;
  update public.member_specialty_requirements
     set rascunho = p_conteudo, rascunho_anexos = coalesce(p_anexos, '[]'::jsonb),
         status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         rascunho_em = now(), updated_at = now()
   where id = v_mr.id;
  return json_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.requisito_formulario(p_requirement_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_mod public.requisito_modelos;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  v_mod := public._modelo_da_classe(p_requirement_id);
  return json_build_object(
    'tem_formulario', v_mod.id is not null,
    'modelo', case when v_mod.id is null then null else json_build_object('versao', v_mod.versao, 'schema', v_mod.schema, 'categoria', v_mod.categoria, 'familia', v_mod.familia, 'nota', v_mod.nota) end,
    'member_requirement_id', v_mr.id,
    'status', v_mr.status,
    'rascunho', v_mr.rascunho, 'rascunho_em', v_mr.rascunho_em,
    'anexos', v_mr.rascunho_anexos,
    'tentativas', (select count(*) from public.requirement_submissions s where s.member_requirement_id = v_mr.id),
    'ultima_avaliacao', (
      select json_build_object('decisao', ap.decisao, 'comentario', ap.comentario, 'avaliado_em', ap.created_at, 'avaliado_papel', ap.avaliado_papel, 'avaliado_por_nome', av.nome)
        from public.requirement_approvals ap left join public.profiles av on av.id = ap.avaliado_por
          left join public.requirement_submissions sb on sb.id = ap.submission_id
       where ap.member_requirement_id = v_mr.id order by sb.tentativa_numero desc nulls last, ap.created_at desc limit 1)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.classe_formularios(p_member_class_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mc from public.member_classes where id = p_member_class_id and usuario_id = v_uid and club_id = v_club;
  if not found or not public._classe_do_catalogo_oficial(v_mc.class_id) then raise exception 'Matrícula não encontrada para você neste clube.'; end if;
  return coalesce((
    select json_object_agg(mr.requirement_id::text, json_build_object(
      'modelo', json_build_object('versao', m.versao, 'schema', m.schema, 'categoria', m.categoria, 'familia', m.familia, 'nota', m.nota),
      'member_requirement_id', mr.id,
      'status', mr.status,
      'rascunho', mr.rascunho, 'rascunho_em', mr.rascunho_em,
      'anexos', mr.rascunho_anexos,
      'tentativas', (select count(*) from public.requirement_submissions s where s.member_requirement_id = mr.id),
      'ultima_avaliacao', (
        select json_build_object('decisao', ap.decisao, 'comentario', ap.comentario, 'avaliado_em', ap.created_at, 'avaliado_papel', ap.avaliado_papel, 'avaliado_por_nome', av.nome)
          from public.requirement_approvals ap left join public.profiles av on av.id = ap.avaliado_por
            left join public.requirement_submissions sb on sb.id = ap.submission_id
         where ap.member_requirement_id = mr.id order by sb.tentativa_numero desc nulls last, ap.created_at desc limit 1)
    ))
    from public.member_requirements mr
    join public.class_requirements r on r.id = mr.requirement_id
    join lateral (
      select m2.* from public.requisito_modelos m2 where m2.alvo = 'classe' and m2.chave = r.manifesto_id order by m2.versao desc limit 1
    ) m on true
    where mr.member_class_id = v_mc.id and mr.status in ('nao_iniciado', 'em_andamento', 'correcao_solicitada')
  ), '{}'::json);
end;
$function$;

CREATE OR REPLACE FUNCTION public.minha_especialidade(p_member_specialty_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'especialidade', (select json_build_object('id', sp.id, 'codigo', sp.codigo, 'nome', sp.nome, 'categoria', sp.categoria, 'nivel', sp.nivel,
                              'fonte_url', sp.fonte_url, 'fonte_consultada_em', sp.fonte_consultada_em, 'fonte_revisao', sp.fonte_revisao)
                       from public.specialties sp where sp.id = v_ms.specialty_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao)
      from public.specialties sp join public.curriculum_versions ver on ver.id = sp.curriculum_version_id where sp.id = v_ms.specialty_id
    ),
    'oferta', (select json_build_object('titulo', o.titulo, 'instrutor_responsavel_nome', p.nome, 'periodo_inicio', o.periodo_inicio, 'periodo_fim', o.periodo_fim)
               from public.specialty_offerings o left join public.profiles p on p.id = o.instrutor_responsavel_id where o.id = v_ms.oferta_id),
    'grupos', (
      select coalesce(json_agg(json_build_object(
        'chave', g.chave, 'rotulo', g.rotulo, 'minimo', g.minimo,
        'aprovados', (select count(*) from public.specialty_requirements r2
                        join public.member_specialty_requirements m2 on m2.specialty_requirement_id = r2.id and m2.member_specialty_id = v_ms.id
                       where r2.specialty_id = g.specialty_id and r2.grupo = g.chave and m2.status = 'aprovado')
      ) order by g.chave), '[]'::json)
      from public.specialty_requirement_groups g where g.specialty_id = v_ms.specialty_id
    ),
    'requisitos', (
      select coalesce(json_agg(json_build_object(
        'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao,
        'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
        'modelo', r.modelo, 'grupo', r.grupo, 'depende_de', to_json(r.depende_de), 'prazo_dias', r.prazo_dias,
        'prazo_em', case when r.prazo_dias is null then null else v_ms.iniciada_em + make_interval(days => r.prazo_dias) end,
        'bloqueios', case when mr.id is null then '[]'::json else to_json(public._especialidade_bloqueios(mr.id)) end,
        'member_specialty_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
        'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
        'rascunho', mr.rascunho, 'rascunho_em', mr.rascunho_em, 'anexos', coalesce(mr.rascunho_anexos, '[]'::jsonb),
        'tentativas', (select count(*) from public.specialty_requirement_submissions s where s.member_specialty_requirement_id = mr.id),
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
$function$;

-- =============================================================================
--  2) CATÁLOGO DE LEITURA (materiais das Classes e do Curso de Leitura) + progresso de leitura/áudio
--
--  O CURRÍCULO continua sendo a fonte de verdade do requisito; o catálogo é só o MATERIAL relacionado.
--  O áudio reaproveita o catálogo de audiolivros (migration 370: capítulos tocados pelo player sem cookie do YouTube);
--  aqui entram título/capa/fonte/links oficiais e o status de revisão. Nada é hospedado nem copiado: só links.
--  Regras:
--   · o material só aparece quando `ativo`; os LINKS (livro/PDF/áudio) só quando `revisado` — e o áudio só quando
--     `audio_confirmado` (fonte documentada). Sem fonte confirmada = "indisponível", nunca URL inventada;
--   · PDF só com `pdf_fonte_licenca` preenchida (fonte oficial/licenciada);
--   · quem edita é SÓ o administrador da plataforma (RPC), com auditoria append-only de cada mudança;
--   · as URLs ficam na tabela, editáveis pelo admin SEM migration.
-- =============================================================================
create table if not exists public.leitura_materiais (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique check (chave ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  titulo text not null check (length(btrim(titulo)) between 2 and 160),
  autor text check (autor is null or length(autor) <= 160),
  descricao text check (descricao is null or length(descricao) <= 1000),
  tipo text not null check (tipo in ('livro_classe', 'curso_leitura', 'outro')),
  classe_manifesto text check (classe_manifesto is null or classe_manifesto ~ '^[a-z_]{2,60}$'),
  ano int check (ano is null or ano between 2000 and 2100),
  capa_url text check (capa_url is null or (capa_url ~ '^https://[^ ]+$' and length(capa_url) between 12 and 500)),
  book_url text check (book_url is null or (book_url ~ '^https://[^ ]+$' and length(book_url) between 12 and 500)),
  book_rotulo text not null default 'Ver livro' check (book_rotulo in ('Ver livro', 'Comprar', 'Ler')),
  pdf_url text check (pdf_url is null or (pdf_url ~ '^https://[^ ]+$' and length(pdf_url) between 12 and 500)),
  pdf_fonte_licenca text check (pdf_fonte_licenca is null or length(pdf_fonte_licenca) <= 400),
  audio_url text check (audio_url is null or (audio_url ~ '^https://[^ ]+$' and length(audio_url) between 12 and 500)),   -- áudio direto (exige liberar o domínio na CSP)
  audiolivro_id uuid references public.audiolivros(id) on delete set null,
  audio_confirmado boolean not null default false,
  audio_fonte text check (audio_fonte is null or length(audio_fonte) <= 400),
  fonte text check (fonte is null or length(fonte) <= 400),
  observacao text check (observacao is null or length(observacao) <= 600),
  ordem int not null default 100,
  ativo boolean not null default true,
  revisado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint leitura_audio_so_com_fonte check (not audio_confirmado or nullif(btrim(coalesce(audio_fonte, '')), '') is not null),
  constraint leitura_pdf_so_com_licenca check (pdf_url is null or nullif(btrim(coalesce(pdf_fonte_licenca, '')), '') is not null)
);
alter table public.leitura_materiais enable row level security;
revoke all on public.leitura_materiais from public, anon, authenticated;

create table if not exists public.leitura_auditoria (
  id bigserial primary key,
  material_id uuid,
  ator uuid,
  acao text not null,
  antes jsonb,
  depois jsonb,
  em timestamptz not null default now()
);
alter table public.leitura_auditoria enable row level security;
revoke all on public.leitura_auditoria from public, anon, authenticated;
drop trigger if exists trg_leitura_auditoria_imutavel on public.leitura_auditoria;
create trigger trg_leitura_auditoria_imutavel before update or delete on public.leitura_auditoria
  for each row execute function public._proteger_registro_imutavel();

-- progresso da PESSOA num material (por clube em uso; o servidor deriva pessoa e clube, o cliente nunca manda)
create table if not exists public.leitura_progresso (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  material_id uuid not null references public.leitura_materiais(id) on delete cascade,
  capitulo_ordem int not null default 1 check (capitulo_ordem between 1 and 500),
  posicao_seg int not null default 0 check (posicao_seg between 0 and 86400),
  duracao_seg int check (duracao_seg is null or duracao_seg between 0 and 86400),
  concluido boolean not null default false,
  ultima_em timestamptz not null default now(),
  unique (usuario_id, club_id, material_id)
);
create index if not exists idx_leitura_progresso_pessoa on public.leitura_progresso (usuario_id, club_id);
alter table public.leitura_progresso enable row level security;
revoke all on public.leitura_progresso from public, anon, authenticated;

-- sementes: só o que está DOCUMENTADO. Áudio confirmado = os 4 com link conferido pelo dono (migration 370).
-- Expedição Galápagos e O Fim do Começo: o áudio existe no catálogo 370 (playlist indicada pelo dono), mas o pacote
-- visual de 28/09 os marca como "não confirmado" → ficam com audio_confirmado = false até o admin confirmar.
-- Curso de Leitura 2026 ("Servo de Deus e Amigo de Todos"): nenhuma fonte de áudio foi fornecida → sem áudio.
insert into public.leitura_materiais (chave, titulo, autor, tipo, classe_manifesto, ano, audiolivro_id, audio_confirmado, audio_fonte, fonte, observacao, ordem, ativo, revisado)
select v.chave, v.titulo, coalesce(a.autor, v.autor), v.tipo, v.classe, v.ano, a.id, v.audio_ok,
       case when v.audio_ok then 'Playlist do YouTube indicada pelo dono e conferida capítulo a capítulo (catálogo de audiolivros, migration 370).' end,
       v.fonte, v.obs, v.ordem, true, true
from (values
  ('vaso-de-barro',          'Vaso de Barro',                      null::text, 'livro_classe',  'amigo',         null::int, true,  'Livro da Classe Amigo (catálogo de leitura 2026).', null::text, 10),
  ('um-simples-lanche',      'Um Simples Lanche',                  null,       'livro_classe',  'companheiro',   null,      true,  'Livro da Classe Companheiro (catálogo de leitura 2026).', null, 20),
  ('alem-da-magia',          'Além da Magia',                      null,       'livro_classe',  'pesquisador',   null,      true,  'Livro da Classe Pesquisador (catálogo de leitura 2026).', null, 30),
  ('expedicao-galapagos',    'Expedição Galápagos',                null,       'livro_classe',  'pioneiro',      null,      false, 'Livro da Classe Pioneiro (catálogo de leitura 2026).', 'Áudio a confirmar: a playlist existe no catálogo de audiolivros, mas a fonte ainda não foi confirmada.', 40),
  ('o-fim-do-comeco',        'O Fim do Começo',                    null,       'livro_classe',  'excursionista', null,      false, 'Livro da Classe Excursionista (catálogo de leitura 2026).', 'Áudio a confirmar: a playlist existe no catálogo de audiolivros, mas a fonte ainda não foi confirmada.', 50),
  ('o-livro-amargo',         'O Livro Amargo',                     null,       'livro_classe',  'guia',          null,      true,  'Livro da Classe Guia (catálogo de leitura 2026).', null, 60),
  ('servo-de-deus-e-amigo-de-todos', 'Servo de Deus e Amigo de Todos', null,   'curso_leitura', null,            2026,      false, 'Curso de Leitura 2026.', 'Sem fonte de áudio cadastrada: informe a fonte para liberar.', 70)
) as v(chave, titulo, autor, tipo, classe, ano, audio_ok, fonte, obs, ordem)
left join public.audiolivros a on a.titulo = v.titulo
on conflict (chave) do nothing;

-- ---------- leitura pelo aplicativo ----------
create or replace function public.leituras_catalogo(p_filtro text default 'todos')
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then return json_build_object('itens', '[]'::json); end if;
  if p_filtro not in ('todos', 'minha_classe', 'curso', 'com_audio', 'concluidos') then raise exception 'Filtro inválido.'; end if;
  return json_build_object('itens', coalesce((
    select json_agg(s.x order by s.ordem, s.titulo) from (
      select m.ordem, m.titulo,
        json_build_object(
          'id', m.id, 'chave', m.chave, 'titulo', m.titulo, 'autor', m.autor, 'descricao', m.descricao, 'tipo', m.tipo,
          'classe_manifesto', m.classe_manifesto, 'ano', m.ano, 'capa_url', m.capa_url,
          'tem_audio', (m.audio_confirmado and m.revisado and (m.audiolivro_id is not null or m.audio_url is not null)),
          'audiolivro_id', case when m.audio_confirmado and m.revisado then m.audiolivro_id end,
          'audio_url', case when m.audio_confirmado and m.revisado then m.audio_url end,
          'book_url', case when m.revisado then m.book_url end, 'book_rotulo', m.book_rotulo,
          'pdf_url', case when m.revisado and m.pdf_fonte_licenca is not null then m.pdf_url end,
          'na_minha_classe', exists (select 1 from public.member_classes mc join public.classes c on c.id = mc.class_id
                                      where mc.usuario_id = v_uid and mc.club_id = v_club and mc.status <> 'cancelada' and c.manifesto_id = m.classe_manifesto),
          'progresso', (select json_build_object('capitulo', p.capitulo_ordem, 'posicao_seg', p.posicao_seg, 'duracao_seg', p.duracao_seg, 'concluido', p.concluido, 'ultima_em', p.ultima_em)
                          from public.leitura_progresso p where p.usuario_id = v_uid and p.club_id = v_club and p.material_id = m.id)
        ) as x
        from public.leitura_materiais m
       where m.ativo
         and case p_filtro
               when 'curso' then m.tipo = 'curso_leitura'
               when 'com_audio' then (m.audio_confirmado and m.revisado and (m.audiolivro_id is not null or m.audio_url is not null))
               when 'minha_classe' then exists (select 1 from public.member_classes mc join public.classes c on c.id = mc.class_id
                                                 where mc.usuario_id = v_uid and mc.club_id = v_club and mc.status <> 'cancelada' and c.manifesto_id = m.classe_manifesto)
               when 'concluidos' then exists (select 1 from public.leitura_progresso p where p.usuario_id = v_uid and p.club_id = v_club and p.material_id = m.id and p.concluido)
               else true end
    ) s), '[]'::json));
end;
$$;
revoke all on function public.leituras_catalogo(text) from public, anon;
grant execute on function public.leituras_catalogo(text) to authenticated;

-- Salva onde a pessoa parou. Pessoa e clube vêm do SERVIDOR. NUNCA aprova requisito nem mexe no currículo.
create or replace function public.leitura_progresso_salvar(p_material_id uuid, p_capitulo int, p_posicao_seg int, p_duracao_seg int default null, p_concluido boolean default false)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then raise exception 'Sem clube em uso.'; end if;
  if not exists (select 1 from public.leitura_materiais m where m.id = p_material_id and m.ativo) then raise exception 'Material não encontrado.'; end if;
  insert into public.leitura_progresso (usuario_id, club_id, material_id, capitulo_ordem, posicao_seg, duracao_seg, concluido, ultima_em)
  values (v_uid, v_club, p_material_id, least(greatest(coalesce(p_capitulo, 1), 1), 500), least(greatest(coalesce(p_posicao_seg, 0), 0), 86400),
          case when p_duracao_seg is null then null else least(greatest(p_duracao_seg, 0), 86400) end, coalesce(p_concluido, false), now())
  on conflict (usuario_id, club_id, material_id) do update
     set capitulo_ordem = excluded.capitulo_ordem, posicao_seg = excluded.posicao_seg,
         duracao_seg = coalesce(excluded.duracao_seg, public.leitura_progresso.duracao_seg),
         concluido = public.leitura_progresso.concluido or excluded.concluido, ultima_em = now();
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.leitura_progresso_salvar(uuid, int, int, int, boolean) from public, anon;
grant execute on function public.leitura_progresso_salvar(uuid, int, int, int, boolean) to authenticated;

-- ---------- administração (SÓ administrador da plataforma; diretoria de clube NÃO altera o catálogo global) ----------
create or replace function public.admin_leitura_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select json_agg(to_json(m) order by m.ordem, m.titulo) from public.leitura_materiais m), '[]'::json);
end;
$$;
revoke all on function public.admin_leitura_listar() from public, anon;
grant execute on function public.admin_leitura_listar() to authenticated;

create or replace function public.admin_leitura_salvar(p_id uuid, p_dados jsonb) returns json
language plpgsql security definer set search_path = '' as $$
declare v_antes jsonb; v_id uuid := p_id; v_novo jsonb; k text;
  v_permitidas text[] := array['chave','titulo','autor','descricao','tipo','classe_manifesto','ano','capa_url','book_url','book_rotulo','pdf_url','pdf_fonte_licenca','audio_url','audiolivro_id','audio_confirmado','audio_fonte','fonte','observacao','ordem','ativo','revisado'];
begin
  perform public._exigir_admin_plataforma();
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then raise exception 'Dados inválidos.'; end if;
  for k in select jsonb_object_keys(p_dados) loop
    if not (k = any (v_permitidas)) then raise exception 'Campo não permitido: %', left(k, 40); end if;
  end loop;
  if v_id is null then
    if coalesce(p_dados ->> 'chave', '') = '' or coalesce(p_dados ->> 'titulo', '') = '' or coalesce(p_dados ->> 'tipo', '') = '' then raise exception 'Informe chave, título e tipo.'; end if;
    insert into public.leitura_materiais (chave, titulo, tipo) values (p_dados ->> 'chave', p_dados ->> 'titulo', p_dados ->> 'tipo') returning id into v_id;
  else
    select to_jsonb(m) into v_antes from public.leitura_materiais m where m.id = v_id;
    if v_antes is null then raise exception 'Material não encontrado.'; end if;
  end if;
  update public.leitura_materiais m set
    chave = coalesce(p_dados ->> 'chave', m.chave),
    titulo = coalesce(p_dados ->> 'titulo', m.titulo),
    autor = case when p_dados ? 'autor' then nullif(p_dados ->> 'autor', '') else m.autor end,
    descricao = case when p_dados ? 'descricao' then nullif(p_dados ->> 'descricao', '') else m.descricao end,
    tipo = coalesce(p_dados ->> 'tipo', m.tipo),
    classe_manifesto = case when p_dados ? 'classe_manifesto' then nullif(p_dados ->> 'classe_manifesto', '') else m.classe_manifesto end,
    ano = case when p_dados ? 'ano' then nullif(p_dados ->> 'ano', '')::int else m.ano end,
    capa_url = case when p_dados ? 'capa_url' then nullif(p_dados ->> 'capa_url', '') else m.capa_url end,
    book_url = case when p_dados ? 'book_url' then nullif(p_dados ->> 'book_url', '') else m.book_url end,
    book_rotulo = coalesce(p_dados ->> 'book_rotulo', m.book_rotulo),
    pdf_url = case when p_dados ? 'pdf_url' then nullif(p_dados ->> 'pdf_url', '') else m.pdf_url end,
    pdf_fonte_licenca = case when p_dados ? 'pdf_fonte_licenca' then nullif(p_dados ->> 'pdf_fonte_licenca', '') else m.pdf_fonte_licenca end,
    audio_url = case when p_dados ? 'audio_url' then nullif(p_dados ->> 'audio_url', '') else m.audio_url end,
    audiolivro_id = case when p_dados ? 'audiolivro_id' then nullif(p_dados ->> 'audiolivro_id', '')::uuid else m.audiolivro_id end,
    audio_confirmado = case when p_dados ? 'audio_confirmado' then (p_dados ->> 'audio_confirmado')::boolean else m.audio_confirmado end,
    audio_fonte = case when p_dados ? 'audio_fonte' then nullif(p_dados ->> 'audio_fonte', '') else m.audio_fonte end,
    fonte = case when p_dados ? 'fonte' then nullif(p_dados ->> 'fonte', '') else m.fonte end,
    observacao = case when p_dados ? 'observacao' then nullif(p_dados ->> 'observacao', '') else m.observacao end,
    ordem = case when p_dados ? 'ordem' then (p_dados ->> 'ordem')::int else m.ordem end,
    ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else m.ativo end,
    revisado = case when p_dados ? 'revisado' then (p_dados ->> 'revisado')::boolean else m.revisado end,
    atualizado_em = now()
  where m.id = v_id;
  select to_jsonb(m) into v_novo from public.leitura_materiais m where m.id = v_id;
  insert into public.leitura_auditoria (material_id, ator, acao, antes, depois) values (v_id, auth.uid(), case when p_id is null then 'criar' else 'editar' end, v_antes, v_novo);
  return json_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.admin_leitura_salvar(uuid, jsonb) from public, anon;
grant execute on function public.admin_leitura_salvar(uuid, jsonb) to authenticated;

create or replace function public.admin_leitura_auditoria(p_material_id uuid default null, p_limite int default 50) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select json_agg(x) from (
    select a.id, a.material_id, a.ator, a.acao, a.antes, a.depois, a.em from public.leitura_auditoria a
     where p_material_id is null or a.material_id = p_material_id order by a.id desc limit least(greatest(coalesce(p_limite, 50), 1), 200)) x), '[]'::json);
end;
$$;
revoke all on function public.admin_leitura_auditoria(uuid, int) from public, anon;
grant execute on function public.admin_leitura_auditoria(uuid, int) to authenticated;

-- =============================================================================
--  3) MINHA JORNADA e PORTFÓLIO (só a PRÓPRIA pessoa; nada de ranking, nada de foto/caminho de evidência)
-- =============================================================================
create or replace function public.minha_jornada() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then return null; end if;
  return json_build_object(
    'classes', coalesce((select json_agg(json_build_object('member_class_id', mc.id, 'nome', c.nome, 'manifesto_id', c.manifesto_id, 'status', mc.status,
            'percentual', public.classe_percentual(mc.id), 'iniciada_em', mc.iniciada_em, 'concluida_em', mc.concluida_em, 'investida_em', mc.investida_em) order by mc.iniciada_em desc)
        from public.member_classes mc join public.classes c on c.id = mc.class_id where mc.usuario_id = v_uid and mc.club_id = v_club and mc.status <> 'cancelada'), '[]'::json),
    'especialidades', coalesce((select json_agg(json_build_object('member_specialty_id', ms.id, 'codigo', sp.codigo, 'nome', sp.nome, 'categoria', sp.categoria, 'status', ms.status,
            'percentual', public.especialidade_percentual(ms.id), 'iniciada_em', ms.iniciada_em, 'concluida_em', ms.concluida_em) order by ms.iniciada_em desc)
        from public.member_specialties ms join public.specialties sp on sp.id = ms.specialty_id where ms.usuario_id = v_uid and ms.club_id = v_club and ms.status <> 'cancelada'), '[]'::json),
    'investiduras', coalesce((select json_agg(json_build_object('classe', c.nome, 'data', i.data_investidura) order by i.data_investidura desc)
        from public.class_investitures i join public.member_classes mc on mc.id = i.member_class_id join public.classes c on c.id = mc.class_id
       where i.usuario_id = v_uid and i.club_id = v_club and i.status = 'registrada'), '[]'::json),
    'conquistas', coalesce((select json_agg(json_build_object('tipo', a.tipo, 'nome', coalesce(c.nome, sp.nome), 'concluida_em', a.concluida_em) order by a.concluida_em desc)
        from public.curriculum_achievements a left join public.classes c on c.id = a.classe_id left join public.specialties sp on sp.id = a.specialty_id
       where a.usuario_id = v_uid and a.status = 'ativa'), '[]'::json),
    'leituras', coalesce((select json_agg(json_build_object('titulo', m.titulo, 'concluido', p.concluido, 'ultima_em', p.ultima_em, 'capitulo', p.capitulo_ordem) order by p.ultima_em desc)
        from public.leitura_progresso p join public.leitura_materiais m on m.id = p.material_id where p.usuario_id = v_uid and p.club_id = v_club and m.ativo), '[]'::json)
  );
end;
$$;
revoke all on function public.minha_jornada() from public, anon;
grant execute on function public.minha_jornada() to authenticated;

-- Portfólio de atividades: requisitos APROVADOS da própria pessoa (resumo curto, avaliador, data). Sem foto, sem caminho.
-- É diferente do documento/cartão oficial. Paginado por cursor (aprovado_em|id).
create or replace function public.meu_portfolio(p_limite int default 20, p_depois text default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_lim int := least(greatest(coalesce(p_limite, 20), 1), 50); v_em timestamptz; v_id uuid; v_itens json; v_prox text;
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then return json_build_object('itens', '[]'::json, 'proximo', null); end if;
  if p_depois is not null then
    if p_depois !~ '^[0-9T:.+\-Z ]{10,40}\|[0-9a-f-]{36}$' then raise exception 'Cursor inválido.'; end if;
    v_em := split_part(p_depois, '|', 1)::timestamptz; v_id := split_part(p_depois, '|', 2)::uuid;
  end if;
  with base as (
    select a.id, a.created_at as aprovado_em, 'classe'::text as alvo, c.nome as origem, r.codigo as requisito_codigo, left(r.descricao, 220) as requisito,
           a.avaliado_papel, av.nome as avaliador, s.tentativa_numero, left(coalesce(s.evidencia_texto, ''), 280) as resumo,
           (jsonb_array_length(coalesce(s.anexos, '[]'::jsonb)) + case when s.evidencia_path is not null and jsonb_array_length(coalesce(s.anexos, '[]'::jsonb)) = 0 then 1 else 0 end) as anexos
      from public.requirement_approvals a
      join public.member_requirements mr on mr.id = a.member_requirement_id
      join public.class_requirements r on r.id = mr.requirement_id
      join public.class_sections se on se.id = r.section_id join public.classes c on c.id = se.class_id
      left join public.profiles av on av.id = a.avaliado_por
      left join public.requirement_submissions s on s.id = a.submission_id
     where a.decisao = 'aprovado' and mr.usuario_id = v_uid and mr.club_id = v_club
    union all
    select a.id, a.created_at, 'especialidade', sp.nome, r.codigo, left(r.descricao, 220), a.avaliado_papel, av.nome, s.tentativa_numero, left(coalesce(s.evidencia_texto, ''), 280),
           (jsonb_array_length(coalesce(s.anexos, '[]'::jsonb)) + case when s.evidencia_path is not null and jsonb_array_length(coalesce(s.anexos, '[]'::jsonb)) = 0 then 1 else 0 end)
      from public.requirement_approvals a
      join public.member_specialty_requirements msr on msr.id = a.member_specialty_requirement_id
      join public.specialty_requirements r on r.id = msr.specialty_requirement_id
      join public.specialties sp on sp.id = r.specialty_id
      left join public.profiles av on av.id = a.avaliado_por
      left join public.specialty_requirement_submissions s on s.id = a.specialty_submission_id
     where a.decisao = 'aprovado' and msr.usuario_id = v_uid and msr.club_id = v_club
  ), pag as (
    select b.*, row_number() over (order by b.aprovado_em desc, b.id desc) rn
      from (select * from base where p_depois is null or (aprovado_em, id) < (v_em, v_id) order by aprovado_em desc, id desc limit v_lim + 1) b
  )
  select coalesce(json_agg(json_build_object('alvo', alvo, 'origem', origem, 'requisito_codigo', requisito_codigo, 'requisito', requisito, 'aprovado_em', aprovado_em,
           'avaliador', avaliador, 'avaliado_papel', avaliado_papel, 'tentativa', tentativa_numero, 'resumo', nullif(resumo, ''), 'anexos', anexos) order by rn) filter (where rn <= v_lim), '[]'::json),
         (select to_char(p2.aprovado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p2.id from pag p2 where p2.rn = v_lim and (select count(*) from pag) > v_lim)
    into v_itens, v_prox from pag;
  return json_build_object('itens', v_itens, 'proximo', v_prox);
end;
$$;
revoke all on function public.meu_portfolio(int, text) from public, anon;
grant execute on function public.meu_portfolio(int, text) to authenticated;

select public._manutencao_instalar_guarda();
notify pgrst, 'reload schema';
