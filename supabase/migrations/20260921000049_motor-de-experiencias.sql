-- =====================================================================
-- Fase 6 — MOTOR DE EXPERIÊNCIAS no-code. Rodar DEPOIS da 20260921000048. Idempotente.
--
-- O clube monta, sem tocar em código:
--   experiência → etapas/desafios → regras → participantes → evidências → validação → recompensa → período
--
-- PRINCÍPIOS (cada um vira teste no supabase/tests/44):
--
--  1. NÃO É O MOTOR CURRICULAR. Currículo oficial (Classes/Especialidades) e experiências do clube são
--     mundos separados, de propósito: o currículo é catálogo da PLATAFORMA, versionado e oficial; a
--     experiência é conteúdo DO CLUBE. Nenhuma função daqui escreve em member_requirements,
--     requirement_approvals, member_classes, member_specialties nem curriculum_achievements — e o teste
--     44 verifica isso por ESTRUTURA (nenhuma tabela curricular é citada por nenhuma função do motor).
--     Uma integração entre os dois motores, se um dia existir, será explícita e auditável — não um
--     efeito colateral.
--
--  2. NADA EXECUTÁVEL VINDO DO CLUBE. As regras são declarativas e passam por um VOCABULÁRIO FECHADO,
--     validado no servidor: tipo desconhecido, chave a mais, valor fora de faixa e texto com HTML são
--     recusados na escrita. Nenhuma função do motor tem um único `execute` — o que o clube configura é
--     LIDO como dado, jamais executado (o teste 44 confere isso lendo o prosrc das funções).
--
--  3. PUBLICADO NÃO SE REESCREVE. Depois de publicada, a experiência não muda de estrutura (tipo, alvo,
--     regra de conclusão, recompensa, período, etapas) — só correções cosméticas de texto/imagem e
--     transições de estado. Mudança incompatível exige VERSÃO NOVA (`experiencia_nova_versao`), que
--     nasce rascunho e não toca no histórico de quem já participou.
--
--  4. RECOMPENSA IDEMPOTENTE POR CONSTRUÇÃO. `experience_rewards.chave_idempotencia` é UNIQUE no banco.
--     Clique duplo, retry, reprocessamento ou chamada concorrente não concedem duas vezes — a garantia
--     é do banco, não do código de aplicação.
--
--  5. TRÊS CAMADAS DA FASE 5. O recurso comercial `experiencias` passa por plano → clube → permissão,
--     reaproveitando `recurso_habilitado_no_clube()` (que já é "plano E clube") e os gatilhos genéricos
--     `trg_exigir_recurso`. Clube SEM assinatura (Tenant 001) segue funcionando: a camada do plano
--     devolve "disponível" e só a escolha do clube manda.
--
--  6. EVIDÊNCIA É PRIVADA E DO CLUBE. Arquivos vão pro bucket `comprovacoes` que já existe (privado,
--     caminho `<user_id>/…`, policies de dono/liderança da migration 8/16). Evidência de um clube nunca
--     atravessa pra outro, e `curriculum_achievements` NÃO é reaproveitado pra isto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) VOCABULÁRIO FECHADO — a fronteira entre "o clube configura" e "o servidor decide"
-- ---------------------------------------------------------------------
-- Texto escrito pela liderança é CONTEÚDO GERADO PELO USUÁRIO: sem HTML, sem esquema perigoso, com
-- tamanho máximo. Recusar (em vez de "limpar" silenciosamente) é deliberado: o autor vê o que errou.
create or replace function public._texto_seguro(p_texto text, p_max int, p_campo text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_texto, ''));
begin
  if length(v) > p_max then
    raise exception 'O campo "%" passa de % caracteres.', p_campo, p_max;
  end if;
  if v ~ '[<>]' then
    raise exception 'O campo "%" não aceita HTML (os sinais < e >). Escreva só texto.', p_campo;
  end if;
  if v ~* '(javascript:|data:text/html|vbscript:|\son[a-z]+\s*=)' then
    raise exception 'O campo "%" tem conteúdo não permitido.', p_campo;
  end if;
  -- controles sao recusados, menos os que fazem sentido em texto: quebra de linha, CR e tabulacao
  if regexp_replace(v, '[' || chr(10) || chr(13) || chr(9) || ']', '', 'g') ~ '[[:cntrl:]]' then
    raise exception 'O campo "%" tem caracteres de controle.', p_campo;
  end if;
  return v;
end;
$$;
revoke all on function public._texto_seguro(text, int, text) from public, anon, authenticated;

-- Recusa qualquer chave que não esteja no vocabulário. É o que impede o clube de "pendurar" um campo
-- novo (um `sql`, um `script`, um `eval`) dentro de uma regra e esperar que alguém um dia o leia.
create or replace function public._so_estas_chaves(p_obj jsonb, p_permitidas text[], p_onde text) returns void
language plpgsql immutable set search_path = '' as $$
declare v_extra text[];
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then
    raise exception 'Configuração inválida em "%": esperava um objeto.', p_onde;
  end if;
  select array_agg(k) into v_extra from jsonb_object_keys(p_obj) k where not (k = any (p_permitidas));
  if v_extra is not null then
    raise exception 'Configuração inválida em "%": campo(s) não permitido(s): %.', p_onde, array_to_string(v_extra, ', ');
  end if;
end;
$$;
revoke all on function public._so_estas_chaves(jsonb, text[], text) from public, anon, authenticated;

create or replace function public._inteiro_entre(p_obj jsonb, p_chave text, p_min int, p_max int, p_onde text, p_obrigatorio boolean default false) returns int
language plpgsql immutable set search_path = '' as $$
declare v text := p_obj ->> p_chave;
begin
  if v is null or v = '' then
    if p_obrigatorio then raise exception 'Configuração inválida em "%": falta "%".', p_onde, p_chave; end if;
    return null;
  end if;
  if v !~ '^\d+$' then raise exception 'Configuração inválida em "%": "%" precisa ser um número inteiro.', p_onde, p_chave; end if;
  if v::bigint < p_min or v::bigint > p_max then
    raise exception 'Configuração inválida em "%": "%" precisa ficar entre % e %.', p_onde, p_chave, p_min, p_max;
  end if;
  return v::int;
end;
$$;
revoke all on function public._inteiro_entre(jsonb, text, int, int, text, boolean) from public, anon, authenticated;

-- Regra de uma ETAPA: o vocabulário depende do tipo de evidência. Fora disto, erro.
create or replace function public._validar_regra_etapa(p_evidencia text, p_regra jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare r jsonb := coalesce(p_regra, '{}'::jsonb); q jsonb; v_n int; v_op jsonb; i int;
begin
  if jsonb_typeof(r) <> 'object' then raise exception 'A regra da etapa precisa ser um objeto.'; end if;
  if p_evidencia in ('nenhuma', 'confirmacao') then
    perform public._so_estas_chaves(r, array[]::text[], 'regra da etapa');
  elsif p_evidencia = 'texto' then
    perform public._so_estas_chaves(r, array['min_caracteres'], 'regra da etapa (texto)');
    perform public._inteiro_entre(r, 'min_caracteres', 1, 5000, 'regra da etapa (texto)');
  elsif p_evidencia in ('foto', 'arquivo') then
    perform public._so_estas_chaves(r, array['max_arquivos'], 'regra da etapa (arquivo)');
    perform public._inteiro_entre(r, 'max_arquivos', 1, 10, 'regra da etapa (arquivo)');
  elsif p_evidencia = 'contagem' then
    perform public._so_estas_chaves(r, array['meta', 'unidade_medida'], 'regra da etapa (contagem)');
    perform public._inteiro_entre(r, 'meta', 1, 1000000, 'regra da etapa (contagem)', true);
    perform public._texto_seguro(r ->> 'unidade_medida', 20, 'unidade_medida');
  elsif p_evidencia = 'checkin' then
    perform public._so_estas_chaves(r, array['ocorrencias'], 'regra da etapa (check-in)');
    perform public._inteiro_entre(r, 'ocorrencias', 1, 365, 'regra da etapa (check-in)');
  elsif p_evidencia = 'quiz' then
    perform public._so_estas_chaves(r, array['perguntas', 'acertos_minimos'], 'regra da etapa (quiz)');
    if jsonb_typeof(r -> 'perguntas') <> 'array' then raise exception 'O quiz precisa de uma lista de perguntas.'; end if;
    v_n := jsonb_array_length(r -> 'perguntas');
    if v_n < 1 or v_n > 20 then raise exception 'O quiz precisa ter de 1 a 20 perguntas.'; end if;
    for i in 0 .. v_n - 1 loop
      q := r -> 'perguntas' -> i;
      perform public._so_estas_chaves(q, array['texto', 'opcoes', 'correta'], 'pergunta do quiz');
      perform public._texto_seguro(q ->> 'texto', 300, 'texto da pergunta');
      if coalesce(btrim(q ->> 'texto'), '') = '' then raise exception 'Toda pergunta do quiz precisa de um enunciado.'; end if;
      if jsonb_typeof(q -> 'opcoes') <> 'array' then raise exception 'Toda pergunta do quiz precisa de opções.'; end if;
      if jsonb_array_length(q -> 'opcoes') < 2 or jsonb_array_length(q -> 'opcoes') > 6 then
        raise exception 'Cada pergunta do quiz precisa ter de 2 a 6 opções.';
      end if;
      for v_op in select value from jsonb_array_elements(q -> 'opcoes') loop
        if jsonb_typeof(v_op) <> 'string' then raise exception 'As opções do quiz precisam ser texto.'; end if;
        perform public._texto_seguro(v_op #>> '{}', 200, 'opção do quiz');
      end loop;
      perform public._inteiro_entre(q, 'correta', 0, jsonb_array_length(q -> 'opcoes') - 1, 'pergunta do quiz', true);
    end loop;
    perform public._inteiro_entre(r, 'acertos_minimos', 1, v_n, 'regra da etapa (quiz)');
  else
    raise exception 'Tipo de evidência desconhecido: %.', p_evidencia;
  end if;
  return r;
end;
$$;
revoke all on function public._validar_regra_etapa(text, jsonb) from public, anon, authenticated;

-- Regra de CONCLUSÃO da experiência inteira.
create or replace function public._validar_regra_conclusao(p_regra jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare r jsonb := coalesce(p_regra, '{"tipo":"todas_etapas"}'::jsonb); t text;
begin
  if jsonb_typeof(r) <> 'object' then raise exception 'A regra de conclusão precisa ser um objeto.'; end if;
  t := r ->> 'tipo';
  if t = 'todas_etapas' then
    perform public._so_estas_chaves(r, array['tipo'], 'regra de conclusão');
  elsif t = 'minimo_etapas' then
    perform public._so_estas_chaves(r, array['tipo', 'quantidade'], 'regra de conclusão');
    perform public._inteiro_entre(r, 'quantidade', 1, 100, 'regra de conclusão', true);
  elsif t = 'aprovacao_lideranca' then
    perform public._so_estas_chaves(r, array['tipo'], 'regra de conclusão');
  else
    raise exception 'Regra de conclusão desconhecida: %. Use todas_etapas, minimo_etapas ou aprovacao_lideranca.', coalesce(t, '(vazio)');
  end if;
  return r;
end;
$$;
revoke all on function public._validar_regra_conclusao(jsonb) from public, anon, authenticated;

-- RECOMPENSA: pontos (entra no ledger que já existe), conquista (badge), item virtual ou nenhuma.
create or replace function public._validar_recompensa(p_r jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare r jsonb := coalesce(p_r, '{"tipo":"nenhuma"}'::jsonb); t text;
begin
  if jsonb_typeof(r) <> 'object' then raise exception 'A recompensa precisa ser um objeto.'; end if;
  t := r ->> 'tipo';
  if t = 'nenhuma' then
    perform public._so_estas_chaves(r, array['tipo'], 'recompensa');
  elsif t = 'pontos' then
    perform public._so_estas_chaves(r, array['tipo', 'valor'], 'recompensa');
    perform public._inteiro_entre(r, 'valor', 1, 10000, 'recompensa', true);
  elsif t = 'badge' then
    perform public._so_estas_chaves(r, array['tipo', 'chave', 'nome', 'icone'], 'recompensa');
    perform public._texto_seguro(r ->> 'nome', 60, 'nome da conquista');
    perform public._texto_seguro(r ->> 'icone', 8, 'ícone da conquista');
    if coalesce(r ->> 'chave', '') !~ '^[a-z][a-z0-9_-]{1,39}$' then
      raise exception 'A conquista precisa de uma chave simples (letras minúsculas, números, - e _).';
    end if;
  elsif t = 'item' then
    -- item virtual: fica REGISTRADO como recompensa concedida. Não existe loja nova nesta fase — o
    -- item é uma marca no histórico, pronta pra quando houver inventário.
    perform public._so_estas_chaves(r, array['tipo', 'chave', 'nome'], 'recompensa');
    perform public._texto_seguro(r ->> 'nome', 60, 'nome do item');
    if coalesce(r ->> 'chave', '') !~ '^[a-z][a-z0-9_-]{1,39}$' then
      raise exception 'O item precisa de uma chave simples (letras minúsculas, números, - e _).';
    end if;
  else
    raise exception 'Recompensa desconhecida: %. Use pontos, badge, item ou nenhuma.', coalesce(t, '(vazio)');
  end if;
  return r;
end;
$$;
revoke all on function public._validar_recompensa(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- B) TEMPORADAS (agrupador com início/fim) e EXPERIÊNCIAS
-- ---------------------------------------------------------------------
-- Nota de modelagem: "temporada" da lista de tipos é representada aqui como AGRUPADOR (uma temporada
-- contém várias experiências e tem período próprio), não como mais um tipo de experiência — porque a
-- semântica é outra: ela não tem etapas nem participante, ela reúne.
create table if not exists public.experience_seasons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  titulo text not null,
  descricao text not null default '',
  inicio timestamptz,
  fim timestamptz,
  status text not null default 'rascunho' check (status in ('rascunho', 'agendada', 'publicada', 'encerrada', 'arquivada')),
  teste boolean not null default false,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint experience_seasons_periodo check (fim is null or inicio is null or fim > inicio)
);
create index if not exists idx_experience_seasons_club on public.experience_seasons (club_id, status);

create table if not exists public.experiences (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  season_id uuid references public.experience_seasons(id) on delete set null,
  -- os 10 tipos iniciais, TODOS sobre o mesmo modelo (nenhuma tabela por modalidade)
  tipo text not null check (tipo in (
    'desafio_individual', 'desafio_equipe', 'campanha', 'sequencia_missoes', 'evento_especial',
    'quiz', 'tarefa_evidencia', 'meta_quantitativa', 'checkin')),
  alvo text not null default 'individual' check (alvo in ('individual', 'unidade')),
  titulo text not null,
  descricao text not null default '',
  imagem_path text,                      -- objeto no bucket privado `imagens` (mesma regra de sempre)
  inicio timestamptz,
  fim timestamptz,
  status text not null default 'rascunho' check (status in ('rascunho', 'agendada', 'publicada', 'encerrada', 'arquivada')),
  sequencial boolean not null default false,        -- etapas em ordem (sequência de missões)
  regra_conclusao jsonb not null default '{"tipo":"todas_etapas"}'::jsonb,
  recompensa jsonb not null default '{"tipo":"nenhuma"}'::jsonb,
  -- versionamento: mudança incompatível em algo publicado nasce como versão nova, sem tocar no histórico
  versao int not null default 1 check (versao >= 1),
  raiz_id uuid references public.experiences(id) on delete set null,
  -- proveniência do template da plataforma (CÓPIA: mudar o template depois não muda isto aqui)
  template_chave text,
  template_versao int,
  teste boolean not null default false,
  criado_por uuid references public.profiles(id) on delete set null,
  publicado_por uuid references public.profiles(id) on delete set null,
  publicado_em timestamptz,
  encerrado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint experiences_periodo check (fim is null or inicio is null or fim > inicio)
);
create index if not exists idx_experiences_club on public.experiences (club_id, status);
create index if not exists idx_experiences_season on public.experiences (season_id);

create table if not exists public.experience_stages (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  experience_id uuid not null references public.experiences(id) on delete cascade,
  ordem int not null check (ordem >= 1),
  titulo text not null,
  descricao text not null default '',
  -- o que o participante entrega. É o vocabulário de evidência pedido na fase.
  evidencia text not null default 'confirmacao'
    check (evidencia in ('nenhuma', 'confirmacao', 'texto', 'foto', 'arquivo', 'quiz', 'contagem', 'checkin')),
  exige_aprovacao boolean not null default false,   -- "validação da liderança"
  obrigatoria boolean not null default true,
  regra jsonb not null default '{}'::jsonb,
  pontos int not null default 0 check (pontos between 0 and 10000),
  created_at timestamptz not null default now(),
  unique (experience_id, ordem)
);
create index if not exists idx_experience_stages_exp on public.experience_stages (experience_id, ordem);

-- PÚBLICO declarativo. Várias linhas = união. `criterio` fica reservado pra critérios futuros (idade
-- etc.) e HOJE precisa estar vazio: preparar o modelo não é inventar segmentação que ninguém pediu —
-- e nada aqui expõe data de nascimento.
create table if not exists public.experience_audiences (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  experience_id uuid not null references public.experiences(id) on delete cascade,
  tipo text not null check (tipo in ('todos', 'unidade', 'papel', 'membro')),
  unidade_id uuid references public.unidades(id) on delete cascade,
  papel text,
  usuario_id uuid references public.profiles(id) on delete cascade,
  criterio jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint experience_audiences_coerente check (
    (tipo = 'todos'   and unidade_id is null and papel is null and usuario_id is null) or
    (tipo = 'unidade' and unidade_id is not null and papel is null and usuario_id is null) or
    (tipo = 'papel'   and papel is not null and unidade_id is null and usuario_id is null) or
    (tipo = 'membro'  and usuario_id is not null and unidade_id is null and papel is null)),
  constraint experience_audiences_criterio_reservado check (criterio = '{}'::jsonb)
);
create index if not exists idx_experience_audiences_exp on public.experience_audiences (experience_id);

-- ---------------------------------------------------------------------
-- C) PARTICIPAÇÃO, EVIDÊNCIA E VALIDAÇÃO
-- ---------------------------------------------------------------------
create table if not exists public.experience_participations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  experience_id uuid not null references public.experiences(id) on delete cascade,
  usuario_id uuid references public.profiles(id) on delete cascade,   -- alvo individual
  unidade_id uuid references public.unidades(id) on delete cascade,   -- alvo unidade/equipe
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluida', 'invalidada')),
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  constraint experience_participations_um_alvo check (
    (usuario_id is not null and unidade_id is null) or (usuario_id is null and unidade_id is not null))
);
create unique index if not exists uq_participacao_pessoa on public.experience_participations (experience_id, usuario_id) where usuario_id is not null;
create unique index if not exists uq_participacao_unidade on public.experience_participations (experience_id, unidade_id) where unidade_id is not null;

create table if not exists public.experience_submissions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  experience_id uuid not null references public.experiences(id) on delete cascade,
  participation_id uuid not null references public.experience_participations(id) on delete cascade,
  stage_id uuid not null references public.experience_stages(id) on delete cascade,
  ocorrencia int not null default 1 check (ocorrencia >= 1),      -- check-in tem N ocorrências
  usuario_id uuid references public.profiles(id) on delete set null,  -- quem enviou (na unidade, um membro)
  texto text,
  arquivo_path text,                 -- bucket PRIVADO `comprovacoes`, caminho `<user_id>/…` (o de sempre)
  quantidade int check (quantidade is null or quantidade >= 0),
  respostas jsonb,                   -- quiz: {"0":1,"1":3} (índice da pergunta -> índice da opção)
  status text not null default 'enviada' check (status in ('enviada', 'aprovada', 'rejeitada', 'correcao')),
  avaliado_por uuid references public.profiles(id) on delete set null,
  avaliado_em timestamptz,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participation_id, stage_id, ocorrencia)
);
create index if not exists idx_experience_submissions_part on public.experience_submissions (participation_id);
create index if not exists idx_experience_submissions_pendente on public.experience_submissions (club_id, status) where status = 'enviada';

-- ---------------------------------------------------------------------
-- D) RECOMPENSAS — idempotência garantida pelo BANCO
-- ---------------------------------------------------------------------
create table if not exists public.club_badges (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  chave text not null,
  nome text not null,
  icone text not null default '🏅',
  descricao text not null default '',
  created_at timestamptz not null default now(),
  unique (club_id, chave)
);

create table if not exists public.member_badges (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  badge_id uuid not null references public.club_badges(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  experience_id uuid references public.experiences(id) on delete set null,
  concedida_em timestamptz not null default now(),
  unique (badge_id, usuario_id)
);

create table if not exists public.experience_rewards (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  experience_id uuid not null references public.experiences(id) on delete cascade,
  participation_id uuid not null references public.experience_participations(id) on delete cascade,
  tipo text not null check (tipo in ('pontos', 'badge', 'item', 'nenhuma')),
  valor int,
  badge_id uuid references public.club_badges(id) on delete set null,
  item_chave text,
  ponto_id uuid references public.pontos(id) on delete set null,   -- elo com o ledger que já existe
  -- A TRANCA: clique duplo, retry, reprocessamento e chamada concorrente batem nesta unicidade.
  chave_idempotencia text not null unique,
  concedida_em timestamptz not null default now()
);
create index if not exists idx_experience_rewards_part on public.experience_rewards (participation_id);

-- ---------------------------------------------------------------------
-- E) AUDITORIA (imutável) e MODERAÇÃO (preparada, enxuta)
-- ---------------------------------------------------------------------
create table if not exists public.experience_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  experience_id uuid references public.experiences(id) on delete set null,
  season_id uuid references public.experience_seasons(id) on delete set null,
  acao text not null,
  ator_id uuid references public.profiles(id) on delete set null,
  detalhe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_experience_events_exp on public.experience_events (experience_id, created_at desc);

-- Denúncia: a CAPACIDADE existe (conteúdo é gerado por usuário), sem construir um sistema de moderação
-- agora. Quem recebe é a liderança do clube — que é quem publica.
create table if not exists public.experience_reports (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  experience_id uuid not null references public.experiences(id) on delete cascade,
  denunciado_por uuid references public.profiles(id) on delete set null,
  motivo text not null,
  status text not null default 'aberta' check (status in ('aberta', 'resolvida', 'descartada')),
  resolvido_por uuid references public.profiles(id) on delete set null,
  resolvido_em timestamptz,
  created_at timestamptz not null default now(),
  unique (experience_id, denunciado_por)
);

-- ---------------------------------------------------------------------
-- F) TEMPLATES DA PLATAFORMA — copiar, não referenciar
-- ---------------------------------------------------------------------
-- O clube COPIA o template; a instância publicada é dele. Publicar uma versão nova do template NÃO
-- muda nada do que o clube já publicou — é o que permite lançar conteúdo novo sem atualizar código e
-- sem reescrever a experiência de ninguém.
create table if not exists public.experience_templates (
  id uuid primary key default gen_random_uuid(),
  chave text not null check (chave ~ '^[a-z][a-z0-9-]{1,49}$'),
  versao int not null check (versao >= 1),
  tipo text not null,
  alvo text not null default 'individual' check (alvo in ('individual', 'unidade')),
  titulo text not null,
  descricao text not null default '',
  -- definicao: { "sequencial": bool, "regra_conclusao": {...}, "recompensa": {...},
  --              "etapas": [ {ordem, titulo, descricao, evidencia, exige_aprovacao, obrigatoria, regra, pontos} ] }
  definicao jsonb not null,
  publico boolean not null default true,
  status text not null default 'publicado' check (status in ('rascunho', 'publicado', 'arquivado')),
  created_at timestamptz not null default now(),
  unique (chave, versao)
);

-- ---------------------------------------------------------------------
-- G) RECURSO COMERCIAL `experiencias` — as três camadas da fase 5, sem gate novo
-- ---------------------------------------------------------------------
insert into public.recursos_catalogo (chave, nome, descricao, icone, padrao, ordem) values
  ('experiencias', 'Experiências do clube', 'A liderança monta desafios, campanhas e temporadas sem programar.', '✨', false, 130)
on conflict (chave) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, ordem = excluded.ordem;

-- Versão NOVA do plano essencial incluindo o módulo. Quem assinou a v1 continua na v1 (é exatamente
-- para isso que o catálogo é versionado): nenhum cliente muda de escopo sem ato comercial.
-- `completo` já tem recursos = NULL (todos), então nada a fazer lá.
insert into public.billing_plans (chave, versao, nome, descricao, publico, recursos, limites, provisorio) values
  ('essencial', 2, 'Essencial', 'O dia a dia completo do clube, com jogos, desafios, tesouraria e Experiências.', true,
   array['agenda', 'atividades', 'mural', 'missoes', 'chat', 'desafios', 'jogos', 'biblia', 'bichinho', 'chefao', 'mensalidades', 'experiencias'],
   '{"membros": 80, "administradores": 5, "clubes": 1, "fotos": 2000, "armazenamento_mb": 2048}'::jsonb, true)
on conflict (chave, versao) do update
  set recursos = excluded.recursos, descricao = excluded.descricao, limites = excluded.limites;
insert into public.billing_prices (plan_id, ciclo, valor_centavos, provisorio)
select p.id, v.ciclo, v.valor, true from public.billing_plans p
join (values ('mensal', 4900), ('anual', 49000)) as v(ciclo, valor) on true
where p.chave = 'essencial' and p.versao = 2
  and not exists (select 1 from public.billing_prices x where x.plan_id = p.id and x.ciclo = v.ciclo);

-- gate único do motor: recurso (plano E clube) + vínculo ativo. Tudo passa por aqui.
create or replace function public._exigir_experiencias(p_club uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_club is null then raise exception 'Sem clube em uso.'; end if;
  if not public.membro_ativo_no_clube(p_club) then raise exception 'Sem vínculo ativo neste clube.'; end if;
  if not public.recurso_habilitado_no_clube(p_club, 'experiencias') then
    raise exception 'Este recurso está desabilitado neste clube.';
  end if;
end;
$$;
revoke all on function public._exigir_experiencias(uuid) from public, anon, authenticated;

-- defesa em profundidade: o gatilho genérico da migration 34 também vale para as tabelas novas
do $$
declare r record;
begin
  for r in select unnest(array['experiences', 'experience_participations', 'experience_submissions', 'experience_seasons']) as tabela loop
    execute format('drop trigger if exists trg_exigir_recurso on public.%I', r.tabela);
    execute format('create trigger trg_exigir_recurso before insert on public.%I for each row execute function public.exigir_recurso_habilitado(%L)',
                   r.tabela, 'experiencias');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- H) PÚBLICO E VISIBILIDADE
-- ---------------------------------------------------------------------
create or replace function public._experiencia_no_publico(p_exp_id uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.experience_audiences a
    join public.experiences e on e.id = a.experience_id
    join public.organization_memberships m
      on m.user_id = p_uid and m.organizational_unit_id = e.club_id
     and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
    where a.experience_id = p_exp_id
      and (a.tipo = 'todos'
        or (a.tipo = 'unidade' and m.unidade_id = a.unidade_id)
        or (a.tipo = 'papel'   and m.role = a.papel)
        or (a.tipo = 'membro'  and a.usuario_id = p_uid))
  );
$$;
revoke all on function public._experiencia_no_publico(uuid, uuid) from public, anon;
grant execute on function public._experiencia_no_publico(uuid, uuid) to authenticated;

create or replace function public._pode_ver_experiencia(p_exp_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.experiences e
    where e.id = p_exp_id
      and public.membro_ativo_no_clube(e.club_id)
      and (public.pode_gerir_no_clube(e.club_id)
        or (e.status in ('publicada', 'encerrada') and public._experiencia_no_publico(e.id, auth.uid())))
  );
$$;
revoke all on function public._pode_ver_experiencia(uuid) from public, anon;
grant execute on function public._pode_ver_experiencia(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- I) IMUTABILIDADE DO QUE JÁ FOI PUBLICADO
-- ---------------------------------------------------------------------
-- Depois de publicada, a experiência não muda de ESTRUTURA. Correção de texto/imagem continua
-- permitida (erro de digitação não exige versão nova); o resto exige `experiencia_nova_versao`.
create or replace function public._proteger_experiencia_publicada() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_estruturais text[] := array['tipo', 'alvo', 'sequencial', 'regra_conclusao', 'recompensa',
                                      'inicio', 'fim', 'versao', 'raiz_id', 'club_id', 'season_id'];
        k text; v_old jsonb := to_jsonb(old); v_new jsonb := to_jsonb(new);
begin
  if old.status in ('rascunho', 'agendada') then return new; end if;
  foreach k in array v_estruturais loop
    if v_new -> k is distinct from v_old -> k then
      raise exception 'A experiência "%" já foi publicada: "%" não pode mudar. Crie uma versão nova.', old.titulo, k;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public._proteger_experiencia_publicada() from public, anon, authenticated;
drop trigger if exists trg_proteger_experiencia_publicada on public.experiences;
create trigger trg_proteger_experiencia_publicada before update on public.experiences
for each row execute function public._proteger_experiencia_publicada();

-- Etapa de experiência publicada: nem criar, nem mudar, nem apagar. É o histórico dos participantes.
create or replace function public._proteger_etapa_publicada() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text; v_exp uuid := coalesce(new.experience_id, old.experience_id);
begin
  select status into v_status from public.experiences where id = v_exp;
  if v_status is not null and v_status not in ('rascunho', 'agendada') then
    raise exception 'Esta experiência já foi publicada: as etapas não podem mudar. Crie uma versão nova.';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public._proteger_etapa_publicada() from public, anon, authenticated;
drop trigger if exists trg_proteger_etapa_publicada on public.experience_stages;
create trigger trg_proteger_etapa_publicada before insert or update or delete on public.experience_stages
for each row execute function public._proteger_etapa_publicada();

drop trigger if exists trg_imutavel on public.experience_events;
create trigger trg_imutavel before update or delete on public.experience_events
for each row execute function public._proteger_registro_imutavel();

create or replace function public._exp_auditar(p_club uuid, p_exp uuid, p_acao text, p_detalhe jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.experience_events (club_id, experience_id, acao, ator_id, detalhe)
  values (p_club, p_exp, p_acao, auth.uid(), coalesce(p_detalhe, '{}'::jsonb));
$$;
revoke all on function public._exp_auditar(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- J) CONSTRUTOR (liderança)
-- ---------------------------------------------------------------------
create or replace function public.experiencia_salvar(p_id uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_uid uuid := auth.uid(); v_e public.experiences; v_id uuid;
        v_titulo text; v_desc text; v_tipo text; v_alvo text;
begin
  perform public._exigir_experiencias(v_club);
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas a liderança do clube).'; end if;
  perform public._so_estas_chaves(p_dados, array['titulo', 'descricao', 'tipo', 'alvo', 'inicio', 'fim',
                                                 'sequencial', 'regra_conclusao', 'recompensa', 'season_id', 'imagem_path'], 'experiência');
  if p_id is not null then
    select * into v_e from public.experiences where id = p_id and club_id = v_club for update;
    if not found then raise exception 'Experiência não encontrada neste clube.'; end if;
  end if;

  v_titulo := public._texto_seguro(coalesce(p_dados ->> 'titulo', v_e.titulo), 120, 'título');
  v_desc := public._texto_seguro(coalesce(p_dados ->> 'descricao', v_e.descricao, ''), 4000, 'descrição');
  if coalesce(v_titulo, '') = '' then raise exception 'A experiência precisa de um título.'; end if;
  v_tipo := coalesce(p_dados ->> 'tipo', v_e.tipo, 'desafio_individual');
  v_alvo := coalesce(p_dados ->> 'alvo', v_e.alvo, 'individual');

  if p_id is null then
    insert into public.experiences (club_id, season_id, tipo, alvo, titulo, descricao, imagem_path, inicio, fim,
      sequencial, regra_conclusao, recompensa, criado_por)
    values (v_club, nullif(p_dados ->> 'season_id', '')::uuid, v_tipo, v_alvo, v_titulo, v_desc,
      public._texto_seguro(p_dados ->> 'imagem_path', 300, 'imagem'),
      nullif(p_dados ->> 'inicio', '')::timestamptz, nullif(p_dados ->> 'fim', '')::timestamptz,
      coalesce((p_dados ->> 'sequencial')::boolean, false),
      public._validar_regra_conclusao(p_dados -> 'regra_conclusao'),
      public._validar_recompensa(p_dados -> 'recompensa'), v_uid)
    returning id into v_id;
    perform public._exp_auditar(v_club, v_id, 'criada', jsonb_build_object('titulo', v_titulo, 'tipo', v_tipo));
  else
    update public.experiences set
      titulo = v_titulo, descricao = v_desc,
      imagem_path = coalesce(public._texto_seguro(p_dados ->> 'imagem_path', 300, 'imagem'), imagem_path),
      tipo = v_tipo, alvo = v_alvo,
      season_id = case when p_dados ? 'season_id' then nullif(p_dados ->> 'season_id', '')::uuid else season_id end,
      inicio = case when p_dados ? 'inicio' then nullif(p_dados ->> 'inicio', '')::timestamptz else inicio end,
      fim = case when p_dados ? 'fim' then nullif(p_dados ->> 'fim', '')::timestamptz else fim end,
      sequencial = coalesce((p_dados ->> 'sequencial')::boolean, sequencial),
      regra_conclusao = case when p_dados ? 'regra_conclusao' then public._validar_regra_conclusao(p_dados -> 'regra_conclusao') else regra_conclusao end,
      recompensa = case when p_dados ? 'recompensa' then public._validar_recompensa(p_dados -> 'recompensa') else recompensa end,
      updated_at = now()
    where id = p_id returning id into v_id;
    perform public._exp_auditar(v_club, v_id, 'editada', jsonb_build_object('campos', (select jsonb_agg(k) from jsonb_object_keys(p_dados) k)));
  end if;
  return (select to_jsonb(e) from public.experiences e where e.id = v_id);
end;
$$;
revoke all on function public.experiencia_salvar(uuid, jsonb) from public, anon;
grant execute on function public.experiencia_salvar(uuid, jsonb) to authenticated;

create or replace function public.experiencia_etapa_salvar(p_experience_id uuid, p_id uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_e public.experiences; v_id uuid; v_evid text; v_ordem int;
begin
  perform public._exigir_experiencias(v_club);
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas a liderança do clube).'; end if;
  select * into v_e from public.experiences where id = p_experience_id and club_id = v_club;
  if not found then raise exception 'Experiência não encontrada neste clube.'; end if;
  perform public._so_estas_chaves(p_dados, array['titulo', 'descricao', 'ordem', 'evidencia', 'exige_aprovacao',
                                                 'obrigatoria', 'regra', 'pontos'], 'etapa');
  v_evid := coalesce(p_dados ->> 'evidencia', 'confirmacao');
  v_ordem := coalesce((p_dados ->> 'ordem')::int, (select coalesce(max(ordem), 0) + 1 from public.experience_stages where experience_id = p_experience_id));

  insert into public.experience_stages (id, club_id, experience_id, ordem, titulo, descricao, evidencia,
    exige_aprovacao, obrigatoria, regra, pontos)
  values (coalesce(p_id, gen_random_uuid()), v_club, p_experience_id, v_ordem,
    public._texto_seguro(p_dados ->> 'titulo', 120, 'título da etapa'),
    public._texto_seguro(coalesce(p_dados ->> 'descricao', ''), 2000, 'descrição da etapa'),
    v_evid,
    coalesce((p_dados ->> 'exige_aprovacao')::boolean, false),
    coalesce((p_dados ->> 'obrigatoria')::boolean, true),
    public._validar_regra_etapa(v_evid, p_dados -> 'regra'),
    coalesce((p_dados ->> 'pontos')::int, 0))
  on conflict (id) do update set
    ordem = excluded.ordem, titulo = excluded.titulo, descricao = excluded.descricao,
    evidencia = excluded.evidencia, exige_aprovacao = excluded.exige_aprovacao,
    obrigatoria = excluded.obrigatoria, regra = excluded.regra, pontos = excluded.pontos
  returning id into v_id;
  perform public._exp_auditar(v_club, p_experience_id, 'etapa_salva', jsonb_build_object('etapa', v_id, 'ordem', v_ordem));
  return (select to_jsonb(s) from public.experience_stages s where s.id = v_id);
end;
$$;
revoke all on function public.experiencia_etapa_salvar(uuid, uuid, jsonb) from public, anon;
grant execute on function public.experiencia_etapa_salvar(uuid, uuid, jsonb) to authenticated;

create or replace function public.experiencia_publico_definir(p_experience_id uuid, p_publico jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_e public.experiences; v_item jsonb; v_tipo text; v_n int := 0;
begin
  perform public._exigir_experiencias(v_club);
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas a liderança do clube).'; end if;
  select * into v_e from public.experiences where id = p_experience_id and club_id = v_club;
  if not found then raise exception 'Experiência não encontrada neste clube.'; end if;
  if v_e.status not in ('rascunho', 'agendada') then
    raise exception 'Esta experiência já foi publicada: o público não pode mudar. Crie uma versão nova.';
  end if;
  if jsonb_typeof(p_publico) <> 'array' then raise exception 'O público precisa ser uma lista.'; end if;

  delete from public.experience_audiences where experience_id = p_experience_id;
  for v_item in select value from jsonb_array_elements(p_publico) loop
    perform public._so_estas_chaves(v_item, array['tipo', 'unidade_id', 'papel', 'usuario_id'], 'público');
    v_tipo := v_item ->> 'tipo';
    if v_tipo not in ('todos', 'unidade', 'papel', 'membro') then
      raise exception 'Público desconhecido: %. Use todos, unidade, papel ou membro.', coalesce(v_tipo, '(vazio)');
    end if;
    -- unidade e membro precisam ser DESTE clube: segmentar nunca pode virar uma porta pra outro clube
    if v_tipo = 'unidade' and not exists (select 1 from public.unidades u where u.id = (v_item ->> 'unidade_id')::uuid and u.club_id = v_club) then
      raise exception 'Unidade não encontrada neste clube.';
    end if;
    if v_tipo = 'membro' and not exists (
        select 1 from public.organization_memberships m
        where m.user_id = (v_item ->> 'usuario_id')::uuid and m.organizational_unit_id = v_club and m.status = 'ativo') then
      raise exception 'Pessoa não encontrada neste clube.';
    end if;
    if v_tipo = 'papel' and (v_item ->> 'papel') not in ('desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro') then
      raise exception 'Papel desconhecido para segmentação.';
    end if;
    insert into public.experience_audiences (club_id, experience_id, tipo, unidade_id, papel, usuario_id)
    values (v_club, p_experience_id, v_tipo,
            case when v_tipo = 'unidade' then (v_item ->> 'unidade_id')::uuid end,
            case when v_tipo = 'papel' then v_item ->> 'papel' end,
            case when v_tipo = 'membro' then (v_item ->> 'usuario_id')::uuid end);
    v_n := v_n + 1;
  end loop;
  perform public._exp_auditar(v_club, p_experience_id, 'publico_definido', jsonb_build_object('regras', v_n));
  return jsonb_build_object('ok', true, 'regras', v_n);
end;
$$;
revoke all on function public.experiencia_publico_definir(uuid, jsonb) from public, anon;
grant execute on function public.experiencia_publico_definir(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- K) ESTADOS: rascunho → agendada → publicada → encerrada → arquivada
-- ---------------------------------------------------------------------
create or replace function public.experiencia_estado(p_experience_id uuid, p_novo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_e public.experiences; v_permitidos text[];
begin
  perform public._exigir_experiencias(v_club);
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas a liderança do clube).'; end if;
  select * into v_e from public.experiences where id = p_experience_id and club_id = v_club for update;
  if not found then raise exception 'Experiência não encontrada neste clube.'; end if;

  v_permitidos := case v_e.status
    when 'rascunho'  then array['agendada', 'publicada', 'arquivada']
    when 'agendada'  then array['publicada', 'rascunho', 'arquivada']
    when 'publicada' then array['encerrada', 'arquivada']
    when 'encerrada' then array['arquivada']
    else array[]::text[] end;
  if not (p_novo = any (v_permitidos)) then
    raise exception 'Mudança de estado inválida: % -> %.', v_e.status, p_novo;
  end if;
  if p_novo in ('publicada', 'agendada') then
    if not exists (select 1 from public.experience_stages where experience_id = p_experience_id) then
      raise exception 'Publique só depois de criar pelo menos uma etapa.';
    end if;
    if not exists (select 1 from public.experience_audiences where experience_id = p_experience_id) then
      raise exception 'Publique só depois de escolher o público.';
    end if;
  end if;

  update public.experiences set status = p_novo, updated_at = now(),
    publicado_em = case when p_novo = 'publicada' and publicado_em is null then now() else publicado_em end,
    publicado_por = case when p_novo = 'publicada' and publicado_por is null then auth.uid() else publicado_por end,
    encerrado_em = case when p_novo = 'encerrada' then now() else encerrado_em end
  where id = p_experience_id;
  perform public._exp_auditar(v_club, p_experience_id, 'estado', jsonb_build_object('de', v_e.status, 'para', p_novo));
  return jsonb_build_object('ok', true, 'status', p_novo);
end;
$$;
revoke all on function public.experiencia_estado(uuid, text) from public, anon;
grant execute on function public.experiencia_estado(uuid, text) to authenticated;

-- Mudança incompatível em algo publicado: nasce uma VERSÃO NOVA, em rascunho. O histórico de quem
-- participou da versão anterior fica intacto, e a anterior continua existindo.
create or replace function public.experiencia_nova_versao(p_experience_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_e public.experiences; v_nova uuid; v_raiz uuid;
begin
  perform public._exigir_experiencias(v_club);
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas a liderança do clube).'; end if;
  select * into v_e from public.experiences where id = p_experience_id and club_id = v_club;
  if not found then raise exception 'Experiência não encontrada neste clube.'; end if;
  v_raiz := coalesce(v_e.raiz_id, v_e.id);

  insert into public.experiences (club_id, season_id, tipo, alvo, titulo, descricao, imagem_path, inicio, fim,
    status, sequencial, regra_conclusao, recompensa, versao, raiz_id, template_chave, template_versao, teste, criado_por)
  select v_e.club_id, v_e.season_id, v_e.tipo, v_e.alvo, v_e.titulo, v_e.descricao, v_e.imagem_path, v_e.inicio, v_e.fim,
    'rascunho', v_e.sequencial, v_e.regra_conclusao, v_e.recompensa,
    (select coalesce(max(versao), 0) + 1 from public.experiences where coalesce(raiz_id, id) = v_raiz),
    v_raiz, v_e.template_chave, v_e.template_versao, v_e.teste, auth.uid()
  returning id into v_nova;

  insert into public.experience_stages (club_id, experience_id, ordem, titulo, descricao, evidencia, exige_aprovacao, obrigatoria, regra, pontos)
  select v_club, v_nova, s.ordem, s.titulo, s.descricao, s.evidencia, s.exige_aprovacao, s.obrigatoria, s.regra, s.pontos
  from public.experience_stages s where s.experience_id = p_experience_id;

  insert into public.experience_audiences (club_id, experience_id, tipo, unidade_id, papel, usuario_id)
  select v_club, v_nova, a.tipo, a.unidade_id, a.papel, a.usuario_id
  from public.experience_audiences a where a.experience_id = p_experience_id;

  perform public._exp_auditar(v_club, v_nova, 'versao_nova', jsonb_build_object('de', p_experience_id));
  return (select to_jsonb(e) from public.experiences e where e.id = v_nova);
end;
$$;
revoke all on function public.experiencia_nova_versao(uuid) from public, anon;
grant execute on function public.experiencia_nova_versao(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- L) TEMPORADAS
-- ---------------------------------------------------------------------
create or replace function public.temporada_salvar(p_id uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_id uuid;
begin
  perform public._exigir_experiencias(v_club);
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas a liderança do clube).'; end if;
  perform public._so_estas_chaves(p_dados, array['titulo', 'descricao', 'inicio', 'fim', 'status'], 'temporada');
  if p_id is null then
    insert into public.experience_seasons (club_id, titulo, descricao, inicio, fim, criado_por)
    values (v_club, public._texto_seguro(p_dados ->> 'titulo', 120, 'título'),
            public._texto_seguro(coalesce(p_dados ->> 'descricao', ''), 2000, 'descrição'),
            nullif(p_dados ->> 'inicio', '')::timestamptz, nullif(p_dados ->> 'fim', '')::timestamptz, auth.uid())
    returning id into v_id;
  else
    update public.experience_seasons set
      titulo = coalesce(public._texto_seguro(p_dados ->> 'titulo', 120, 'título'), titulo),
      descricao = coalesce(public._texto_seguro(p_dados ->> 'descricao', 2000, 'descrição'), descricao),
      inicio = case when p_dados ? 'inicio' then nullif(p_dados ->> 'inicio', '')::timestamptz else inicio end,
      fim = case when p_dados ? 'fim' then nullif(p_dados ->> 'fim', '')::timestamptz else fim end,
      status = coalesce(p_dados ->> 'status', status),
      updated_at = now()
    where id = p_id and club_id = v_club returning id into v_id;
    if v_id is null then raise exception 'Temporada não encontrada neste clube.'; end if;
  end if;
  return (select to_jsonb(s) from public.experience_seasons s where s.id = v_id);
end;
$$;
revoke all on function public.temporada_salvar(uuid, jsonb) from public, anon;
grant execute on function public.temporada_salvar(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- M) TEMPLATE DA PLATAFORMA → CÓPIA DO CLUBE
-- ---------------------------------------------------------------------
create or replace function public.experiencia_do_template(p_chave text, p_versao int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_t public.experience_templates; v_id uuid; v_et jsonb; v_evid text;
begin
  perform public._exigir_experiencias(v_club);
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas a liderança do clube).'; end if;
  select * into v_t from public.experience_templates
   where chave = p_chave and (p_versao is null or versao = p_versao) and status = 'publicado' and publico
   order by versao desc limit 1;
  if not found then raise exception 'Modelo não encontrado: %.', p_chave; end if;

  -- CÓPIA, não referência: a partir daqui a instância é do clube. Publicar uma versão nova do modelo
  -- depois NÃO muda nada disto (é a garantia pedida na fase).
  insert into public.experiences (club_id, tipo, alvo, titulo, descricao, sequencial, regra_conclusao, recompensa,
    template_chave, template_versao, criado_por)
  values (v_club, v_t.tipo, v_t.alvo,
    public._texto_seguro(v_t.titulo, 120, 'título'),
    public._texto_seguro(v_t.descricao, 4000, 'descrição'),
    coalesce((v_t.definicao ->> 'sequencial')::boolean, false),
    public._validar_regra_conclusao(v_t.definicao -> 'regra_conclusao'),
    public._validar_recompensa(v_t.definicao -> 'recompensa'),
    v_t.chave, v_t.versao, auth.uid())
  returning id into v_id;

  for v_et in select value from jsonb_array_elements(coalesce(v_t.definicao -> 'etapas', '[]'::jsonb)) loop
    v_evid := coalesce(v_et ->> 'evidencia', 'confirmacao');
    insert into public.experience_stages (club_id, experience_id, ordem, titulo, descricao, evidencia,
      exige_aprovacao, obrigatoria, regra, pontos)
    values (v_club, v_id, (v_et ->> 'ordem')::int,
      public._texto_seguro(v_et ->> 'titulo', 120, 'título da etapa'),
      public._texto_seguro(coalesce(v_et ->> 'descricao', ''), 2000, 'descrição da etapa'),
      v_evid, coalesce((v_et ->> 'exige_aprovacao')::boolean, false),
      coalesce((v_et ->> 'obrigatoria')::boolean, true),
      public._validar_regra_etapa(v_evid, v_et -> 'regra'),
      coalesce((v_et ->> 'pontos')::int, 0));
  end loop;

  perform public._exp_auditar(v_club, v_id, 'copiada_do_modelo', jsonb_build_object('modelo', v_t.chave, 'versao', v_t.versao));
  return (select to_jsonb(e) from public.experiences e where e.id = v_id);
end;
$$;
revoke all on function public.experiencia_do_template(text, int) from public, anon;
grant execute on function public.experiencia_do_template(text, int) to authenticated;

-- ---------------------------------------------------------------------
-- N) PARTICIPAÇÃO, EVIDÊNCIA E CONCLUSÃO
-- ---------------------------------------------------------------------
create or replace function public._experiencia_vigente(p_e public.experiences) returns boolean
language sql immutable set search_path = '' as $$
  select p_e.status = 'publicada'
     and (p_e.inicio is null or p_e.inicio <= now())
     and (p_e.fim is null or p_e.fim > now());
$$;
revoke all on function public._experiencia_vigente(public.experiences) from public, anon, authenticated;

create or replace function public.experiencia_participar(p_experience_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_uid uuid := auth.uid(); v_e public.experiences; v_unid uuid; v_id uuid;
begin
  perform public._exigir_experiencias(v_club);
  select * into v_e from public.experiences where id = p_experience_id and club_id = v_club;
  if not found then raise exception 'Experiência não encontrada neste clube.'; end if;
  if not public._experiencia_vigente(v_e) then raise exception 'Esta experiência não está aberta agora.'; end if;
  if not public._experiencia_no_publico(v_e.id, v_uid) then raise exception 'Esta experiência não é para você.'; end if;

  if v_e.alvo = 'unidade' then
    select m.unidade_id into v_unid from public.organization_memberships m
     where m.user_id = v_uid and m.organizational_unit_id = v_club and m.status = 'ativo' limit 1;
    if v_unid is null then raise exception 'Você não está em nenhuma unidade deste clube.'; end if;
    insert into public.experience_participations (club_id, experience_id, unidade_id)
    values (v_club, v_e.id, v_unid) on conflict do nothing;
    select id into v_id from public.experience_participations where experience_id = v_e.id and unidade_id = v_unid;
  else
    insert into public.experience_participations (club_id, experience_id, usuario_id)
    values (v_club, v_e.id, v_uid) on conflict do nothing;
    select id into v_id from public.experience_participations where experience_id = v_e.id and usuario_id = v_uid;
  end if;
  return (select to_jsonb(p) from public.experience_participations p where p.id = v_id);
end;
$$;
revoke all on function public.experiencia_participar(uuid) from public, anon;
grant execute on function public.experiencia_participar(uuid) to authenticated;

-- envia (ou corrige) a evidência de uma etapa
create or replace function public.experiencia_etapa_enviar(p_stage_id uuid, p_dados jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_uid uuid := auth.uid(); v_e public.experiences;
        v_s public.experience_stages; v_p public.experience_participations; v_sub uuid; v_status text;
        v_ocor int; v_acertos int; v_i int; v_q jsonb; v_qtd int;
begin
  perform public._exigir_experiencias(v_club);
  perform public._so_estas_chaves(p_dados, array['texto', 'arquivo_path', 'quantidade', 'respostas'], 'envio da etapa');
  select * into v_s from public.experience_stages where id = p_stage_id and club_id = v_club;
  if not found then raise exception 'Etapa não encontrada neste clube.'; end if;
  select * into v_e from public.experiences where id = v_s.experience_id;
  if not public._experiencia_vigente(v_e) then raise exception 'Esta experiência não está aberta agora.'; end if;
  if not public._experiencia_no_publico(v_e.id, v_uid) then raise exception 'Esta experiência não é para você.'; end if;

  -- a participação tem que existir (participar é um ato explícito)
  if v_e.alvo = 'unidade' then
    select p.* into v_p from public.experience_participations p
     join public.organization_memberships m on m.user_id = v_uid and m.organizational_unit_id = v_club
      and m.status = 'ativo' and m.unidade_id = p.unidade_id
     where p.experience_id = v_e.id for update;
  else
    select * into v_p from public.experience_participations
     where experience_id = v_e.id and usuario_id = v_uid for update;
  end if;
  if not found then raise exception 'Participe da experiência antes de enviar.'; end if;
  if v_p.status = 'concluida' then raise exception 'Esta participação já foi concluída.'; end if;

  -- ordem obrigatória (sequência de missões)
  if v_e.sequencial and exists (
      select 1 from public.experience_stages s2
      where s2.experience_id = v_e.id and s2.ordem < v_s.ordem and s2.obrigatoria
        and not exists (select 1 from public.experience_submissions x
                        where x.participation_id = v_p.id and x.stage_id = s2.id and x.status = 'aprovada')) then
    raise exception 'Termine as etapas anteriores primeiro.';
  end if;

  -- valida o envio contra o tipo de evidência da etapa
  if v_s.evidencia = 'texto' then
    perform public._texto_seguro(p_dados ->> 'texto', 5000, 'resposta');
    if length(btrim(coalesce(p_dados ->> 'texto', ''))) < coalesce((v_s.regra ->> 'min_caracteres')::int, 1) then
      raise exception 'Escreva um pouco mais nesta etapa.';
    end if;
  elsif v_s.evidencia in ('foto', 'arquivo') then
    if coalesce(p_dados ->> 'arquivo_path', '') = '' then raise exception 'Esta etapa pede um arquivo.'; end if;
    -- o arquivo vive no bucket PRIVADO `comprovacoes`, sob a pasta de quem enviou (policy de sempre)
    if split_part(p_dados ->> 'arquivo_path', '/', 1) <> v_uid::text then
      raise exception 'O arquivo precisa estar na sua própria pasta de comprovações.';
    end if;
  elsif v_s.evidencia = 'contagem' then
    v_qtd := public._inteiro_entre(p_dados, 'quantidade', 0, 1000000, 'envio da etapa', true);
  elsif v_s.evidencia = 'quiz' then
    if jsonb_typeof(p_dados -> 'respostas') <> 'object' then raise exception 'Responda o quiz.'; end if;
    v_acertos := 0;
    for v_i in 0 .. jsonb_array_length(v_s.regra -> 'perguntas') - 1 loop
      v_q := v_s.regra -> 'perguntas' -> v_i;
      if (p_dados -> 'respostas' ->> v_i::text) = (v_q ->> 'correta') then v_acertos := v_acertos + 1; end if;
    end loop;
  end if;

  -- check-in acumula ocorrências; o resto tem uma entrega por etapa
  v_ocor := case when v_s.evidencia = 'checkin'
                 then coalesce((select max(ocorrencia) from public.experience_submissions
                                where participation_id = v_p.id and stage_id = v_s.id), 0) + 1
                 else 1 end;

  -- exige_aprovacao => fica 'enviada' até a liderança validar; senão já entra aprovada
  v_status := case
    when v_s.exige_aprovacao then 'enviada'
    when v_s.evidencia = 'quiz' and v_acertos < coalesce((v_s.regra ->> 'acertos_minimos')::int, 1) then 'rejeitada'
    when v_s.evidencia = 'contagem' and v_qtd < coalesce((v_s.regra ->> 'meta')::int, 1) then 'enviada'
    else 'aprovada' end;

  insert into public.experience_submissions (club_id, experience_id, participation_id, stage_id, ocorrencia,
    usuario_id, texto, arquivo_path, quantidade, respostas, status)
  values (v_club, v_e.id, v_p.id, v_s.id, v_ocor, v_uid,
    public._texto_seguro(p_dados ->> 'texto', 5000, 'resposta'), p_dados ->> 'arquivo_path',
    v_qtd, p_dados -> 'respostas', v_status)
  on conflict (participation_id, stage_id, ocorrencia) do update set
    texto = excluded.texto, arquivo_path = excluded.arquivo_path, quantidade = excluded.quantidade,
    respostas = excluded.respostas, status = excluded.status, updated_at = now()
  returning id into v_sub;

  perform public._experiencia_avaliar_conclusao(v_p.id);
  return (select to_jsonb(x) from public.experience_submissions x where x.id = v_sub);
end;
$$;
revoke all on function public.experiencia_etapa_enviar(uuid, jsonb) from public, anon;
grant execute on function public.experiencia_etapa_enviar(uuid, jsonb) to authenticated;

-- liderança valida a evidência ("validação da liderança")
create or replace function public.experiencia_avaliar(p_submission_id uuid, p_decisao text, p_observacao text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_sub public.experience_submissions;
begin
  perform public._exigir_experiencias(v_club);
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas a liderança do clube).'; end if;
  if p_decisao not in ('aprovada', 'rejeitada', 'correcao') then raise exception 'Decisão inválida.'; end if;
  select * into v_sub from public.experience_submissions where id = p_submission_id and club_id = v_club for update;
  if not found then raise exception 'Envio não encontrado neste clube.'; end if;

  update public.experience_submissions
     set status = p_decisao, avaliado_por = auth.uid(), avaliado_em = now(),
         observacao = public._texto_seguro(p_observacao, 2000, 'observação'), updated_at = now()
   where id = p_submission_id;
  perform public._exp_auditar(v_club, v_sub.experience_id, 'avaliacao',
    jsonb_build_object('envio', p_submission_id, 'decisao', p_decisao));
  perform public._experiencia_avaliar_conclusao(v_sub.participation_id);
  return (select to_jsonb(x) from public.experience_submissions x where x.id = p_submission_id);
end;
$$;
revoke all on function public.experiencia_avaliar(uuid, text, text) from public, anon;
grant execute on function public.experiencia_avaliar(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- O) CONCLUSÃO + RECOMPENSA IDEMPOTENTE
-- ---------------------------------------------------------------------
create or replace function public._experiencia_avaliar_conclusao(p_participation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_p public.experience_participations; v_e public.experiences; v_obrig int; v_ok int;
        v_regra jsonb; v_concluiu boolean := false;
begin
  -- serializa a conclusão desta participação: dois cliques simultâneos entram em fila aqui,
  -- e a unicidade da recompensa fecha a porta de vez.
  select * into v_p from public.experience_participations where id = p_participation_id for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if v_p.status = 'concluida' then return jsonb_build_object('ok', true, 'ja_concluida', true); end if;
  select * into v_e from public.experiences where id = v_p.experience_id;

  select count(*) filter (where s.obrigatoria),
         count(*) filter (where s.obrigatoria and exists (
           select 1 from public.experience_submissions x
           where x.participation_id = v_p.id and x.stage_id = s.id and x.status = 'aprovada'))
    into v_obrig, v_ok
  from public.experience_stages s where s.experience_id = v_e.id;

  v_regra := v_e.regra_conclusao;
  if v_regra ->> 'tipo' = 'todas_etapas' then
    v_concluiu := v_obrig > 0 and v_ok >= v_obrig;
  elsif v_regra ->> 'tipo' = 'minimo_etapas' then
    v_concluiu := v_ok >= (v_regra ->> 'quantidade')::int;
  else
    v_concluiu := false;   -- aprovacao_lideranca: só por ato explícito da liderança
  end if;
  if not v_concluiu then return jsonb_build_object('ok', true, 'concluida', false, 'etapas_ok', v_ok, 'etapas', v_obrig); end if;

  update public.experience_participations set status = 'concluida', concluida_em = now() where id = v_p.id;
  return public._experiencia_conceder_recompensa(v_p.id);
end;
$$;
revoke all on function public._experiencia_avaliar_conclusao(uuid) from public, anon, authenticated;

-- A concessão. IDEMPOTENTE PELO BANCO: `chave_idempotencia` é UNIQUE, então reprocessar, repetir o
-- clique, chamar em paralelo ou tentar de novo depois de um erro NUNCA concede duas vezes.
create or replace function public._experiencia_conceder_recompensa(p_participation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_p public.experience_participations; v_e public.experiences; v_r jsonb; v_tipo text;
        v_chave text; v_reward uuid; v_ponto uuid; v_badge uuid;
begin
  select * into v_p from public.experience_participations where id = p_participation_id;
  select * into v_e from public.experiences where id = v_p.experience_id;
  v_r := v_e.recompensa; v_tipo := coalesce(v_r ->> 'tipo', 'nenhuma');
  v_chave := 'exp:' || v_e.id::text || ':part:' || v_p.id::text || ':final';

  insert into public.experience_rewards (club_id, experience_id, participation_id, tipo, valor, item_chave, chave_idempotencia)
  values (v_e.club_id, v_e.id, v_p.id, v_tipo,
          case when v_tipo = 'pontos' then (v_r ->> 'valor')::int end,
          case when v_tipo = 'item' then v_r ->> 'chave' end, v_chave)
  on conflict (chave_idempotencia) do nothing
  returning id into v_reward;

  if v_reward is null then
    return jsonb_build_object('ok', true, 'concluida', true, 'recompensa', 'ja_concedida');
  end if;

  if v_tipo = 'pontos' then
    insert into public.pontos (usuario_id, unidade_id, origem, pontos, motivo, club_id, lancado_por)
    values (v_p.usuario_id, v_p.unidade_id, 'experiencia', (v_r ->> 'valor')::int,
            left('Experiência: ' || v_e.titulo, 200), v_e.club_id, null)
    returning id into v_ponto;
    update public.experience_rewards set ponto_id = v_ponto where id = v_reward;
  elsif v_tipo = 'badge' then
    insert into public.club_badges (club_id, chave, nome, icone)
    values (v_e.club_id, v_r ->> 'chave', coalesce(v_r ->> 'nome', v_r ->> 'chave'), coalesce(v_r ->> 'icone', '🏅'))
    on conflict (club_id, chave) do update set nome = excluded.nome
    returning id into v_badge;
    update public.experience_rewards set badge_id = v_badge where id = v_reward;
    if v_p.usuario_id is not null then
      insert into public.member_badges (club_id, badge_id, usuario_id, experience_id)
      values (v_e.club_id, v_badge, v_p.usuario_id, v_e.id) on conflict (badge_id, usuario_id) do nothing;
    else
      -- alvo unidade: a conquista vai pra cada membro ativo da unidade, sem duplicar
      insert into public.member_badges (club_id, badge_id, usuario_id, experience_id)
      select v_e.club_id, v_badge, m.user_id, v_e.id
        from public.organization_memberships m
       where m.organizational_unit_id = v_e.club_id and m.unidade_id = v_p.unidade_id and m.status = 'ativo'
      on conflict (badge_id, usuario_id) do nothing;
    end if;
  end if;

  perform public._exp_auditar(v_e.club_id, v_e.id, 'recompensa',
    jsonb_build_object('participacao', v_p.id, 'tipo', v_tipo));
  return jsonb_build_object('ok', true, 'concluida', true, 'recompensa', v_tipo);
end;
$$;
revoke all on function public._experiencia_conceder_recompensa(uuid) from public, anon, authenticated;

-- conclusão manual (regra `aprovacao_lideranca`)
create or replace function public.experiencia_concluir_manual(p_participation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_p public.experience_participations;
begin
  perform public._exigir_experiencias(v_club);
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas a liderança do clube).'; end if;
  select * into v_p from public.experience_participations where id = p_participation_id and club_id = v_club for update;
  if not found then raise exception 'Participação não encontrada neste clube.'; end if;
  if v_p.status = 'concluida' then return jsonb_build_object('ok', true, 'ja_concluida', true); end if;
  update public.experience_participations set status = 'concluida', concluida_em = now() where id = v_p.id;
  return public._experiencia_conceder_recompensa(v_p.id);
end;
$$;
revoke all on function public.experiencia_concluir_manual(uuid) from public, anon;
grant execute on function public.experiencia_concluir_manual(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- P) LEITURA (app)
-- ---------------------------------------------------------------------
create or replace function public.experiencias_do_clube(p_incluir_rascunhos boolean default false) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_uid uuid := auth.uid(); v_gere boolean;
begin
  perform public._exigir_experiencias(v_club);
  v_gere := public.pode_gerir_no_clube(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'id', e.id, 'titulo', e.titulo, 'descricao', e.descricao, 'tipo', e.tipo, 'alvo', e.alvo,
      'status', e.status, 'inicio', e.inicio, 'fim', e.fim, 'versao', e.versao, 'teste', e.teste,
      'sequencial', e.sequencial, 'regra_conclusao', e.regra_conclusao, 'recompensa', e.recompensa,
      'temporada', (select json_build_object('id', t.id, 'titulo', t.titulo) from public.experience_seasons t where t.id = e.season_id),
      'etapas', (select count(*) from public.experience_stages s where s.experience_id = e.id),
      'minha_participacao', (select json_build_object('id', p.id, 'status', p.status, 'concluida_em', p.concluida_em)
                             from public.experience_participations p
                             where p.experience_id = e.id
                               and (p.usuario_id = v_uid or p.unidade_id in (
                                    select m.unidade_id from public.organization_memberships m
                                     where m.user_id = v_uid and m.organizational_unit_id = v_club and m.status = 'ativo'))
                             limit 1),
      'participantes', (select count(*) from public.experience_participations p2 where p2.experience_id = e.id),
      'concluidas', (select count(*) from public.experience_participations p3 where p3.experience_id = e.id and p3.status = 'concluida')
    ) order by e.status, e.created_at desc)
    from public.experiences e
    where e.club_id = v_club
      and (case when v_gere and p_incluir_rascunhos then true
                else e.status in ('publicada', 'encerrada') and public._experiencia_no_publico(e.id, v_uid) end)
  ), '[]'::json);
end;
$$;
revoke all on function public.experiencias_do_clube(boolean) from public, anon;
grant execute on function public.experiencias_do_clube(boolean) to authenticated;

create or replace function public.experiencia_detalhe(p_experience_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_uid uuid := auth.uid(); v_e public.experiences; v_part uuid;
begin
  perform public._exigir_experiencias(v_club);
  select * into v_e from public.experiences where id = p_experience_id and club_id = v_club;
  if not found then raise exception 'Experiência não encontrada neste clube.'; end if;
  if not public._pode_ver_experiencia(v_e.id) then raise exception 'Experiência não encontrada neste clube.'; end if;

  select p.id into v_part from public.experience_participations p
   where p.experience_id = v_e.id
     and (p.usuario_id = v_uid or p.unidade_id in (
          select m.unidade_id from public.organization_memberships m
           where m.user_id = v_uid and m.organizational_unit_id = v_club and m.status = 'ativo'))
   limit 1;

  return jsonb_build_object(
    'id', v_e.id, 'titulo', v_e.titulo, 'descricao', v_e.descricao, 'tipo', v_e.tipo, 'alvo', v_e.alvo,
    'status', v_e.status, 'inicio', v_e.inicio, 'fim', v_e.fim, 'sequencial', v_e.sequencial,
    'versao', v_e.versao, 'teste', v_e.teste, 'recompensa', v_e.recompensa, 'regra_conclusao', v_e.regra_conclusao,
    'vigente', public._experiencia_vigente(v_e),
    'participacao', (select to_jsonb(p) from public.experience_participations p where p.id = v_part),
    'etapas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'ordem', s.ordem, 'titulo', s.titulo, 'descricao', s.descricao,
        'evidencia', s.evidencia, 'exige_aprovacao', s.exige_aprovacao, 'obrigatoria', s.obrigatoria,
        'pontos', s.pontos,
        -- o quiz NUNCA entrega a resposta certa pro participante
        'regra', case when s.evidencia = 'quiz' and not public.pode_gerir_no_clube(v_club)
                      then jsonb_build_object('acertos_minimos', s.regra -> 'acertos_minimos',
                             'perguntas', (select jsonb_agg(jsonb_build_object('texto', q ->> 'texto', 'opcoes', q -> 'opcoes'))
                                           from jsonb_array_elements(s.regra -> 'perguntas') q))
                      else s.regra end,
        'meu_envio', (select jsonb_build_object('id', x.id, 'status', x.status, 'texto', x.texto,
                        'quantidade', x.quantidade, 'observacao', x.observacao, 'ocorrencias',
                        (select count(*) from public.experience_submissions y where y.participation_id = v_part and y.stage_id = s.id))
                      from public.experience_submissions x
                      where x.participation_id = v_part and x.stage_id = s.id order by x.ocorrencia desc limit 1)
      ) order by s.ordem)
      from public.experience_stages s where s.experience_id = v_e.id), '[]'::jsonb));
end;
$$;
revoke all on function public.experiencia_detalhe(uuid) from public, anon;
grant execute on function public.experiencia_detalhe(uuid) to authenticated;

-- fila de validação da liderança
create or replace function public.experiencias_pendentes_de_validacao() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  perform public._exigir_experiencias(v_club);
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas a liderança do clube).'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', x.id, 'experiencia', e.titulo, 'etapa', s.titulo, 'evidencia', s.evidencia,
      'quem', coalesce(pr.nome, u.nome), 'texto', x.texto, 'arquivo_path', x.arquivo_path,
      'quantidade', x.quantidade, 'enviado_em', x.created_at) order by x.created_at)
    from public.experience_submissions x
    join public.experiences e on e.id = x.experience_id
    join public.experience_stages s on s.id = x.stage_id
    join public.experience_participations p on p.id = x.participation_id
    left join public.profiles pr on pr.id = p.usuario_id
    left join public.unidades u on u.id = p.unidade_id
    where x.club_id = v_club and x.status = 'enviada'), '[]'::json);
end;
$$;
revoke all on function public.experiencias_pendentes_de_validacao() from public, anon;
grant execute on function public.experiencias_pendentes_de_validacao() to authenticated;

create or replace function public.experiencia_denunciar(p_experience_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  perform public._exigir_experiencias(v_club);
  if not exists (select 1 from public.experiences where id = p_experience_id and club_id = v_club) then
    raise exception 'Experiência não encontrada neste clube.';
  end if;
  insert into public.experience_reports (club_id, experience_id, denunciado_por, motivo)
  values (v_club, p_experience_id, auth.uid(), public._texto_seguro(p_motivo, 1000, 'motivo'))
  on conflict (experience_id, denunciado_por) do update set motivo = excluded.motivo;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.experiencia_denunciar(uuid, text) from public, anon;
grant execute on function public.experiencia_denunciar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Q) RLS
-- ---------------------------------------------------------------------
alter table public.experience_seasons        enable row level security;
alter table public.experiences               enable row level security;
alter table public.experience_stages         enable row level security;
alter table public.experience_audiences      enable row level security;
alter table public.experience_participations enable row level security;
alter table public.experience_submissions    enable row level security;
alter table public.experience_rewards        enable row level security;
alter table public.club_badges               enable row level security;
alter table public.member_badges             enable row level security;
alter table public.experience_events         enable row level security;
alter table public.experience_reports        enable row level security;
alter table public.experience_templates      enable row level security;

revoke insert, update, delete on
  public.experience_seasons, public.experiences, public.experience_stages, public.experience_audiences,
  public.experience_participations, public.experience_submissions, public.experience_rewards,
  public.club_badges, public.member_badges, public.experience_events, public.experience_reports,
  public.experience_templates
from authenticated, anon;

drop policy if exists "membro do clube le temporadas" on public.experience_seasons;
create policy "membro do clube le temporadas" on public.experience_seasons for select to authenticated
using (public.membro_ativo_no_clube(club_id));

drop policy if exists "publicada pro publico, tudo pra lideranca" on public.experiences;
create policy "publicada pro publico, tudo pra lideranca" on public.experiences for select to authenticated
using (public.membro_ativo_no_clube(club_id) and (
  public.pode_gerir_no_clube(club_id)
  or (status in ('publicada', 'encerrada') and public._experiencia_no_publico(id, auth.uid()))));

drop policy if exists "etapas seguem a experiencia" on public.experience_stages;
create policy "etapas seguem a experiencia" on public.experience_stages for select to authenticated
using (public._pode_ver_experiencia(experience_id));

drop policy if exists "publico so pra lideranca" on public.experience_audiences;
create policy "publico so pra lideranca" on public.experience_audiences for select to authenticated
using (public.pode_gerir_no_clube(club_id));

drop policy if exists "a propria participacao, a da minha unidade, ou a lideranca" on public.experience_participations;
create policy "a propria participacao, a da minha unidade, ou a lideranca" on public.experience_participations for select to authenticated
using (public.membro_ativo_no_clube(club_id) and (
  usuario_id = auth.uid() or public.pode_gerir_no_clube(club_id)
  or unidade_id in (select m.unidade_id from public.organization_memberships m
                    where m.user_id = auth.uid() and m.organizational_unit_id = club_id and m.status = 'ativo')));

-- EVIDÊNCIA É PRIVADA: só quem enviou, a unidade a que pertence e a liderança DESTE clube.
drop policy if exists "evidencia e do autor, da unidade e da lideranca deste clube" on public.experience_submissions;
create policy "evidencia e do autor, da unidade e da lideranca deste clube" on public.experience_submissions for select to authenticated
using (public.membro_ativo_no_clube(club_id) and (
  usuario_id = auth.uid() or public.pode_gerir_no_clube(club_id)
  or exists (select 1 from public.experience_participations p
             join public.organization_memberships m on m.user_id = auth.uid() and m.organizational_unit_id = club_id
              and m.status = 'ativo' and m.unidade_id = p.unidade_id
             where p.id = participation_id and p.unidade_id is not null)));

drop policy if exists "membro do clube le recompensas" on public.experience_rewards;
create policy "membro do clube le recompensas" on public.experience_rewards for select to authenticated
using (public.membro_ativo_no_clube(club_id));
drop policy if exists "membro do clube le conquistas" on public.club_badges;
create policy "membro do clube le conquistas" on public.club_badges for select to authenticated
using (public.membro_ativo_no_clube(club_id));
drop policy if exists "membro do clube le conquistas de todos" on public.member_badges;
create policy "membro do clube le conquistas de todos" on public.member_badges for select to authenticated
using (public.membro_ativo_no_clube(club_id));

drop policy if exists "lideranca le a auditoria" on public.experience_events;
create policy "lideranca le a auditoria" on public.experience_events for select to authenticated
using (public.pode_gerir_no_clube(club_id));
drop policy if exists "lideranca le denuncias, autor le a propria" on public.experience_reports;
create policy "lideranca le denuncias, autor le a propria" on public.experience_reports for select to authenticated
using (public.pode_gerir_no_clube(club_id) or denunciado_por = auth.uid());

drop policy if exists "catalogo de modelos publicado" on public.experience_templates;
create policy "catalogo de modelos publicado" on public.experience_templates for select to authenticated
using (status = 'publicado' and publico);
grant select on public.experience_templates to authenticated;

-- ---------------------------------------------------------------------
-- R) MODELOS DA PLATAFORMA (exemplo inicial — o clube copia e personaliza)
-- ---------------------------------------------------------------------
insert into public.experience_templates (chave, versao, tipo, alvo, titulo, descricao, definicao) values
  ('leitura-da-semana', 1, 'desafio_individual', 'individual', 'Leitura da semana',
   'Um desafio curto de leitura, com registro do que foi lido.',
   '{"sequencial": false, "regra_conclusao": {"tipo": "todas_etapas"}, "recompensa": {"tipo": "pontos", "valor": 10},
     "etapas": [
       {"ordem": 1, "titulo": "Confirmar a leitura", "descricao": "Marque quando terminar.", "evidencia": "confirmacao", "regra": {}, "pontos": 5},
       {"ordem": 2, "titulo": "O que ficou", "descricao": "Escreva em poucas linhas.", "evidencia": "texto", "regra": {"min_caracteres": 20}, "pontos": 5}
     ]}'::jsonb),
  ('mutirao-da-unidade', 1, 'tarefa_evidencia', 'unidade', 'Mutirão da unidade',
   'A unidade faz uma tarefa em conjunto e envia uma foto para a liderança validar.',
   '{"sequencial": false, "regra_conclusao": {"tipo": "todas_etapas"}, "recompensa": {"tipo": "pontos", "valor": 50},
     "etapas": [
       {"ordem": 1, "titulo": "Foto do mutirão", "descricao": "Envie uma foto da unidade em ação.", "evidencia": "foto", "exige_aprovacao": true, "regra": {"max_arquivos": 1}, "pontos": 50}
     ]}'::jsonb)
on conflict (chave, versao) do update
  set titulo = excluded.titulo, descricao = excluded.descricao, definicao = excluded.definicao;

-- ---------------------------------------------------------------------
-- S) TRÊS EXPERIÊNCIAS PILOTO — marcadas [TESTE], no clube legado
-- ---------------------------------------------------------------------
-- Mesma abordagem da classe PILOTO da migration 36: dados de exemplo pra provar o fluxo ponta a ponta.
-- O recurso `experiencias` nasce DESLIGADO (padrao = false), então nenhum clube vê nada disto até a
-- liderança ligar. São descartáveis: `teste = true`.
do $$
declare v_club uuid := public.clube_legado_id(); v_season uuid; v_e1 uuid; v_e2 uuid; v_e3 uuid; v_e4 uuid;
begin
  if v_club is null then return; end if;
  if exists (select 1 from public.experiences where club_id = v_club and teste) then return; end if;
  -- semeadura da PLATAFORMA: os gatilhos de produto (recurso desligado, etapa de experiência já
  -- publicada) existem pra barrar o app, não a migration. Mesmo padrão dos fixtures.
  set local session_replication_role = replica;

  -- 1) desafio individual simples
  insert into public.experiences (club_id, tipo, alvo, titulo, descricao, status, teste, publicado_em,
    regra_conclusao, recompensa)
  values (v_club, 'desafio_individual', 'individual', '[TESTE] Desafio da leitura',
    'Exemplo de desafio individual criado pelo motor de Experiências. Pode apagar.', 'publicada', true, now(),
    '{"tipo":"todas_etapas"}'::jsonb, '{"tipo":"pontos","valor":10}'::jsonb)
  returning id into v_e1;
  insert into public.experience_stages (club_id, experience_id, ordem, titulo, descricao, evidencia, regra, pontos) values
    (v_club, v_e1, 1, 'Li o capítulo', 'Marque quando terminar.', 'confirmacao', '{}'::jsonb, 5),
    (v_club, v_e1, 2, 'O que achei', 'Escreva pelo menos 20 caracteres.', 'texto', '{"min_caracteres":20}'::jsonb, 5);
  insert into public.experience_audiences (club_id, experience_id, tipo) values (v_club, v_e1, 'todos');

  -- 2) desafio por unidade, com evidência validada pela liderança
  insert into public.experiences (club_id, tipo, alvo, titulo, descricao, status, teste, publicado_em,
    regra_conclusao, recompensa)
  values (v_club, 'tarefa_evidencia', 'unidade', '[TESTE] Mutirão da unidade',
    'Exemplo de desafio por unidade com foto validada pela liderança. Pode apagar.', 'publicada', true, now(),
    '{"tipo":"todas_etapas"}'::jsonb, '{"tipo":"pontos","valor":50}'::jsonb)
  returning id into v_e2;
  insert into public.experience_stages (club_id, experience_id, ordem, titulo, descricao, evidencia, exige_aprovacao, regra, pontos)
  values (v_club, v_e2, 1, 'Foto do mutirão', 'Envie uma foto da unidade em ação.', 'foto', true, '{"max_arquivos":1}'::jsonb, 50);
  insert into public.experience_audiences (club_id, experience_id, tipo) values (v_club, v_e2, 'todos');

  -- 3) temporada com várias experiências (quiz + meta quantitativa)
  insert into public.experience_seasons (club_id, titulo, descricao, inicio, fim, status, teste)
  values (v_club, '[TESTE] Temporada piloto', 'Exemplo de temporada agrupando experiências. Pode apagar.',
          now() - interval '1 day', now() + interval '90 days', 'publicada', true)
  returning id into v_season;

  insert into public.experiences (club_id, season_id, tipo, alvo, titulo, descricao, status, teste, publicado_em,
    regra_conclusao, recompensa)
  values (v_club, v_season, 'quiz', 'individual', '[TESTE] Quiz da temporada',
    'Exemplo de quiz. Pode apagar.', 'publicada', true, now(),
    '{"tipo":"todas_etapas"}'::jsonb, '{"tipo":"badge","chave":"quiz-piloto","nome":"Quiz da temporada","icone":"🧠"}'::jsonb)
  returning id into v_e3;
  insert into public.experience_stages (club_id, experience_id, ordem, titulo, descricao, evidencia, regra, pontos)
  values (v_club, v_e3, 1, 'Responda', 'Acerte pelo menos 1.', 'quiz',
    '{"acertos_minimos":1,"perguntas":[{"texto":"Qual é o lema dos Desbravadores?","opcoes":["O amor de Cristo me motiva","Sempre alerta","Servir"],"correta":0}]}'::jsonb, 10);
  insert into public.experience_audiences (club_id, experience_id, tipo) values (v_club, v_e3, 'todos');

  insert into public.experiences (club_id, season_id, tipo, alvo, titulo, descricao, status, teste, publicado_em,
    regra_conclusao, recompensa)
  values (v_club, v_season, 'meta_quantitativa', 'individual', '[TESTE] Meta de copos reciclados',
    'Exemplo de meta quantitativa. Pode apagar.', 'publicada', true, now(),
    '{"tipo":"todas_etapas"}'::jsonb, '{"tipo":"pontos","valor":20}'::jsonb)
  returning id into v_e4;
  insert into public.experience_stages (club_id, experience_id, ordem, titulo, descricao, evidencia, regra, pontos)
  values (v_club, v_e4, 1, 'Quantos você juntou?', 'Informe o total.', 'contagem',
    '{"meta":10,"unidade_medida":"copos"}'::jsonb, 20);
  insert into public.experience_audiences (club_id, experience_id, tipo) values (v_club, v_e4, 'todos');
  set local session_replication_role = origin;
end $$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-motor-de-experiencias.sql')
on conflict (arquivo) do update set aplicada_em = now();
