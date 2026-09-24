-- =============================================================================
--  Fase 9.1 — correções da REVISÃO ADVERSARIAL das migrations 80–85.
--
--  Quatro revisores (segurança, multi-clube, regressão, currículo) atacaram os commits da 9.1, e um
--  cético reproduziu cada achado no banco antes de ele entrar aqui. Esta migration fecha os que
--  foram CONFIRMADOS, com a gravidade e a correção do cético quando ele corrigiu o revisor. Os
--  testes 61 (multi-clube/segurança), 35 e 64 (currículo) provam cada um — e ficam vermelhos sem ela.
--
--  SEGURANÇA
--    S1 (ALTO)  A conta de quem ADMINISTRA A PLATAFORMA não é mexida por um clube. A trava da 80
--               ("a conta global não é mexida por um clube só") olhava só os vínculos: um admin que
--               também é diretoria (ou conselheiro) de UM clube era tratado como membro comum dele, e
--               a liderança desse clube redefinia a senha GLOBAL dele — e com ela entrava nas RPCs de
--               plataforma de TODOS os clubes. Agora `resetar_senha_membro`, `membro_definir_teste` e
--               `membro_definir_foto` recusam também quem está em platform_admins (ativo OU não: um
--               admin desativado pode ser reativado, e a conta é a mesma), com a MESMA mensagem da
--               recusa "participa de outro clube" — ninguém descobre por aqui quem é admin.
--    S2 (MÉDIO) A data de nascimento COMPLETA saía pela API para qualquer colega (e para colega de
--               outro clube em comum): o grant de SELECT era da tabela inteira e a policy libera quem
--               divide um clube. A 80 tirou a idade só da TELA (membros_do_clube devolve MM-DD).
--               Agora `authenticated` perde o SELECT em `profiles.nascimento` (revoke da tabela +
--               grant das outras colunas — revogar só a coluna não tira nada quando o grant é da
--               tabela, o cético provou) e a própria pessoa lê a linha dela, com o nascimento, pela
--               RPC nova `meu_perfil()`. Levantamento feito antes (no banco replayado): nenhuma função
--               SECURITY INVOKER, view ou policy lê `profiles` — todas as leituras de nascimento são
--               RPCs SECURITY DEFINER (missao_do_dia, registrar_missao, membros_do_clube,
--               entradas_pendentes, _classe_motivo_inelegivel, notif_aniversariantes_hoje,
--               handle_new_user), que rodam como o dono e continuam lendo. O FRONT precisa trocar
--               `select('*')` em profiles (Auth.jsx) pela RPC — sem isso o carregamento do perfil
--               quebra para todo mundo. Ordem do deploy: front PRIMEIRO (com o fallback de colunas
--               explícitas enquanto a RPC não existe), depois este SQL — MESMO PADRÃO da migration 32
--               (bucket privado). ⚠️ E o inverso importa tanto quanto: todo cliente que ainda faz
--               `select('*')` em profiles (o APK já publicado, que embute o dist e não se atualiza
--               sozinho; o PWA em cache; o `main` antes deste branch ir ao ar) passa a receber
--               "permission denied" ao carregar o perfil assim que esta migration entrar — mesmo sem
--               nenhuma mudança no cliente. Não aplique esta migration antes de o front novo (com
--               `meu_perfil()`) e o APK novo estarem publicados, do mesmo jeito que a 32 não podia
--               entrar antes do front e do APK que leem imagem por URL assinada.
--    S4 (BAIXO) `curriculum_dependencies` era `using (true)`: qualquer conta logada lia a dependência
--               do catálogo de TESTE (uuids e o texto "Dependência de TESTE"). Agora só aparece a linha
--               cujos DOIS lados a pessoa enxerga pela RLS do catálogo oficial.
--
--  MULTI-CLUBE
--    M1 (MÉDIO) Missão e devocional eram "um por PESSOA por dia, somando os clubes", mas desde a 81 o
--               duelo e a cartela de B contam só o que foi feito em B: a criança que fazia primeiro em A
--               ficava com "já fez" em B e com ZERO no duelo de B para sempre. Mesma decisão da
--               trilha_jogos na 81 — os clubes são independentes: o índice único passa a ser
--               (pessoa, clube, dia) e os resumos (`meu_resumo_missoes`, `meu_resumo_devocional`,
--               `devocional_feito_hoje`) olham o clube da aba. `registrar_missao`/`registrar_devocional`
--               já gravavam o clube da aba e contavam com o índice para o "já fez": não mudam.
--               DECISÃO DE PRODUTO (não muda aqui): a BÍBLIA continua sendo progresso PESSOAL — um
--               capítulo lido é lido, em qualquer clube, e o teto diário de pontos da leitura soma os
--               clubes. Ler a Bíblia não é tarefa do clube; é da pessoa. Pontuar o mesmo capítulo em
--               cada clube viraria incentivo a "ler" duas vezes.
--    M2 (BAIXO) `_vinculo_ativo` escolhia o vínculo MAIS NOVO; `membros_do_clube` prefere o que não é
--               'pais'. A conselheira que também é responsável no mesmo clube aparecia na lista do chat
--               e depois era recusada ("não está disponível"), não escrevia no grupo da unidade e não
--               criava duelo. Agora o critério é o mesmo: não-'pais' primeiro, depois o mais novo.
--    M4 (BAIXO) O teto anti-spam de 3 duelos por pessoa em 24h somava os clubes (3 em A = nenhum em B).
--               O teto existe para não tocar o push DO CLUBE sem parar: é por clube.
--    M5 (BAIXO) O aviso de aniversário do cron seguia regra diferente do card: avisava o aniversário
--               de responsável ('pais'), de conta de TESTE, de vínculo vencido, e em dobro para quem tem
--               dois papéis no mesmo clube. Agora: uma vez por pessoa por clube, só papel que não é
--               'pais', vínculo vigente, sem conta de teste — a regra do card.
--
--  REGRESSÃO
--    R3 (BAIXO) Desde a 82 o aviso nasce do vínculo e só em pendente→ativo ("Cadastro aprovado"). O
--               "Reativar" (encerrado→ativo, de quem foi rejeitado; suspenso→ativo, de quem foi
--               desativado) passou a não avisar nada. Agora gera um aviso PRÓPRIO, de reativação — não
--               "cadastro aprovado", que seria o texto errado.
--    R2         NÃO MUDA, de propósito: senha/teste/foto continuam só para quem está ATIVO no clube. O
--               vínculo pendente nasce de qualquer conta que digita o código (e qualquer conta abre um
--               clube): aceitar pendente reabriria a tomada de conta que a 80 fechou. O caminho seguro
--               é aprovar/reativar e depois redefinir. O front esconde os botões por status.
--
--  CURRÍCULO
--    C1 Classe: matrícula antiga numa classe de versão que NÃO é oficial (a PILOTO da 36) continuava
--       servida por minha_classe, pelas filas da liderança, pelas contagens do Início e da Gestão, e
--       aceitava salvar/enviar/avaliar. A 83 prometeu "as RPCs não servem matrícula antiga de versão
--       de teste" e só cumpriu para especialidade. `_classe_do_catalogo_oficial` entra em TODAS as RPCs
--       e contagens de classe (resposta = "não encontrado", sem oráculo), e as leituras de classe
--       passam a exigir o recurso 'classes' como as escritas já exigiam.
--    C2 `requisito_origem` entregava o requisito [TESTE] a qualquer conta logada: só versão oficial
--       (a plataforma — sessão sem usuário ou admin — continua vendo qualquer uma, como no diff da 83).
--    C3 A publicação do conteúdo anual contava na cobertura do ano também linhas que NÃO vieram de
--       manifesto (fonte_hash nulo): um manifesto incompleto passava se o slot que faltava tinha uma
--       linha avulsa. Agora a cobertura conta só linhas publicadas por manifesto.
--    C4 O hash não era conferido contra o pacote: qualquer sha256 "bem formado" entrava como
--       fonte_hash, o `arquivo` não precisava ser o do ano, e rodar de novo com a mesma chave e a fonte
--       trocada contava como "já estava" em silêncio. Agora o banco recalcula o sha256 do pacote
--       canônico (a MESMA serialização de gerar-conteudo-anual.mjs, reproduzida em `_json_canonico`
--       e conferida no teste 64 contra o hash que o gerador JS gravou), exige o arquivo
--       `supabase/curriculo-manifesto/conteudo-anual/<ano>.json`, e o no-op só vale se valor,
--       vigência, fonte e arquivo forem iguais — senão recusa.
--    C5 Um admin da plataforma ligava 'especialidades' pelo ONBOARDING (o gatilho liberava qualquer
--       admin), pulando a exigência de catálogo oficial e a auditoria da RPC da plataforma. Agora o
--       gatilho só libera sessão sem usuário ou a própria RPC `admin_recurso_do_clube_definir`.
--    C7 `revisao_final_decidir` gravava a avaliação da correção sem `conteudo_avaliado`: grava o
--       conteúdo fixado no requisito, como `requisito_avaliar` faz desde a 84.
--    C8 O dia de referência do conteúdo anual era o de São Paulo para todo clube: num clube do Acre
--       (UTC-5), das 22h às 23h59 de 31/12 o servidor já fixava o livro do ano seguinte. Decisão: o
--       dia passa a ser o do FUSO DO CLUBE do requisito (organizational_units.timezone), com
--       America/Sao_Paulo como padrão. Por que esta e não "restringir o onboarding a UTC-3": o
--       produto é brasileiro, e o Brasil tem quatro fusos — Manaus, Cuiabá, Porto Velho, Boa Vista e
--       Rio Branco têm clubes de desbravadores; barrá-los seria um defeito de produto, e a coluna de
--       fuso já existe em todo clube. De carona, o fuso passa a ser VALIDADO na escrita (clube e conta
--       comercial): um texto qualquer no fuso quebraria o `at time zone` de todas as leituras do clube.
--
--  Aplicada pelo SQL Editor numa transação só, como postgres. Pode rodar de novo.
-- =============================================================================


-- =============================================================================
--  S1. A conta de quem administra a plataforma não é mexida por um clube
-- =============================================================================
-- "A conta desta pessoa vale além deste clube?" — ela participa de outro clube (a regra da 80), OU
-- está em platform_admins (ativo ou não). Nos dois casos um clube só não decide pela conta global.
create or replace function public._conta_alem_deste_clube(p_user uuid, p_club uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public._participa_de_outro_clube(p_user, p_club)
      or exists (select 1 from public.platform_admins a where a.user_id = p_user);
$$;
revoke all on function public._conta_alem_deste_clube(uuid, uuid) from public, anon, authenticated;

-- Igual à 80 em tudo, menos o passo 4 (a trava da conta global).
create or replace function public.resetar_senha_membro(alvo uuid, nova_senha text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_papel text;
  v_sessoes int := 0;
  v_revogou boolean := false;
begin
  -- 1. Liderança da aba, e o alvo é gente DESTE clube. Inexistente e "de outro clube" recebem a
  --    MESMA resposta: não há oráculo de uuid (teste 24).
  if v_club is null or not public.pode_gerir_no_clube(v_club)
     or not public._tem_vinculo(alvo, v_club, false) then
    raise exception 'Sem permissão (apenas diretoria/instrutor do clube desta pessoa).';
  end if;

  -- 2. ...e ATIVO aqui, hoje. Suspenso, encerrado (ex-membro) e pendente ficam de fora: o
  --    pendente pode ser alguém de outro clube que só digitou o código deste, e o ex-membro não é
  --    mais responsabilidade deste clube. (R2: continua assim, de propósito.)
  if not public._tem_vinculo(alvo, v_club) then
    raise exception 'Sem permissão: só dá para redefinir a senha de quem está ativo neste clube. A própria pessoa pode usar "Esqueci a senha" na tela de entrada.';
  end if;

  -- 3. A regra de sempre: diretoria, instrutor e tesoureiro só têm a senha redefinida pela
  --    DIRETORIA (senão um instrutor assumiria a conta de quem manda nele).
  select va.papel into v_papel from public._vinculo_ativo(alvo, v_club) va;
  if exists (select 1 from public.organization_memberships m
              where m.user_id = alvo and m.organizational_unit_id = v_club
                and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
                and m.role in ('diretoria', 'instrutor', 'tesoureiro'))
     and not public.diretoria_gere_usuario(alvo) then
    raise exception 'Sem permissão: só a diretoria redefine a senha de diretoria, instrutor ou tesoureiro.';
  end if;

  -- 4. A senha vale para TODOS os clubes da pessoa — e, para quem administra a plataforma, para a
  --    plataforma inteira. Se ela participa de outro clube, ou é admin da plataforma, este clube não
  --    decide por ela. A mensagem é a MESMA nos dois casos: a recusa não revela quem é admin.
  if public._conta_alem_deste_clube(alvo, v_club) then
    raise exception 'Esta pessoa também participa de outro clube, e a senha é uma só para todos eles — por isso não pode ser trocada por aqui. A própria pessoa usa "Esqueci a senha" na tela de entrada (ou o responsável ajuda).';
  end if;

  -- a mesma regra que o Auth aplica no cadastro e na recuperação (fase 8.1)
  if nova_senha is null or length(nova_senha) < 8 or nova_senha !~ '[A-Za-z]' or nova_senha !~ '[0-9]' then
    raise exception 'A senha precisa ter pelo menos 8 caracteres, com letras e números.';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(nova_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = alvo;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;

  -- 5. Quem estava logado com a senha antiga sai (ver a 80).
  if alvo is distinct from auth.uid() then
    begin
      delete from auth.sessions where user_id = alvo;
      get diagnostics v_sessoes = row_count;
      delete from auth.refresh_tokens where user_id = alvo::text;
      v_revogou := true;
    exception when insufficient_privilege then
      v_revogou := false;
    end;
  end if;

  perform public._auditar('senha_redefinida', v_club, alvo,
    jsonb_build_object('papel_do_alvo', v_papel, 'sessoes_revogadas', v_revogou, 'sessoes', v_sessoes));
end;
$$;

create or replace function public.membro_definir_teste(p_usuario_id uuid, p_teste boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not exists (
       select 1 from public.organization_memberships m
        where m.user_id = auth.uid() and m.organizational_unit_id = v_club
          and m.role = 'diretoria' and m.status = 'ativo'
          and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'Sem permissão: só a diretoria do clube liga ou desliga o modo teste.';
  end if;
  -- inexistente, de outro clube e inativo aqui: a mesma resposta (sem oráculo de uuid)
  if not public._tem_vinculo(p_usuario_id, v_club) then
    raise exception 'Pessoa não encontrada entre os membros ativos deste clube.';
  end if;
  -- outro clube OU admin da plataforma: a mesma recusa (S1)
  if public._conta_alem_deste_clube(p_usuario_id, v_club) then
    raise exception 'Esta pessoa também participa de outro clube: o modo teste vale para a conta inteira, então não pode ser ligado ou desligado por um clube só.';
  end if;
  update public.profiles set teste = coalesce(p_teste, false) where id = p_usuario_id;
  perform public._auditar('membro_teste', v_club, p_usuario_id, jsonb_build_object('teste', coalesce(p_teste, false)));
end;
$$;
revoke all on function public.membro_definir_teste(uuid, boolean) from public, anon;
grant execute on function public.membro_definir_teste(uuid, boolean) to authenticated;

create or replace function public.membro_definir_foto(p_usuario_id uuid, p_foto text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_foto text := nullif(btrim(coalesce(p_foto, '')), '');
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão: só a liderança do clube muda a foto de outra pessoa.';
  end if;
  if not public._tem_vinculo(p_usuario_id, v_club) then
    raise exception 'Pessoa não encontrada entre os membros ativos deste clube.';
  end if;
  -- outro clube OU admin da plataforma: a mesma recusa (S1)
  if public._conta_alem_deste_clube(p_usuario_id, v_club) then
    raise exception 'Esta pessoa também participa de outro clube: a foto aparece em todos eles, então só ela mesma pode trocar (no Perfil).';
  end if;
  if length(v_foto) > 2048 then
    raise exception 'Endereço da foto grande demais.';
  end if;
  update public.profiles set foto = v_foto where id = p_usuario_id;
  perform public._auditar('membro_foto', v_club, p_usuario_id, jsonb_build_object('removida', v_foto is null));
end;
$$;
revoke all on function public.membro_definir_foto(uuid, text) from public, anon;
grant execute on function public.membro_definir_foto(uuid, text) to authenticated;


-- =============================================================================
--  S2. A data de nascimento completa sai da API; a própria pessoa lê a sua por RPC
-- =============================================================================
-- Revogar só a coluna NÃO tira nada enquanto o grant for da tabela (regra do PostgreSQL). Então:
-- tira o SELECT da tabela (o que também tira os grants de coluna) e devolve, coluna a coluna, todas
-- menos `nascimento`. A lista é EXPLÍCITA de propósito: uma coluna nova em profiles não fica legível
-- por colega sem alguém decidir. O UPDATE da própria pessoa (policy "editar proprio perfil" + grant
-- de coluna) não muda — ela continua podendo corrigir o próprio nascimento.
revoke select on public.profiles from authenticated;
grant select (id, nome, foto, avatar, avatar_tipo, cargo, created_at, notif_visto_em, papel, status, teste, unidade_id)
  on public.profiles to authenticated;

-- A linha da PRÓPRIA pessoa, inteira (com o nascimento, que decide a classe da missão). `setof`: 0 ou
-- 1 linha — sem sessão, ou sem perfil, a lista vem vazia (nunca uma linha de nulos).
create or replace function public.meu_perfil()
returns setof public.profiles
language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.meu_perfil() from public, anon;
grant execute on function public.meu_perfil() to authenticated;


-- =============================================================================
--  S4 + C2. O catálogo de TESTE não sai nem pelas dependências nem pela origem do requisito
-- =============================================================================
-- Os `exists` rodam como quem pergunta: passam pela RLS oficial de classes, requisitos e
-- especialidades (83). Uma linha só aparece se a pessoa enxerga os DOIS lados dela.
drop policy if exists "leitura publica das dependencias" on public.curriculum_dependencies;
create policy "leitura publica das dependencias" on public.curriculum_dependencies for select to authenticated
  using (
    case curriculum_dependencies.alvo_tipo
      when 'class' then exists (select 1 from public.classes c where c.id = curriculum_dependencies.alvo_id)
      when 'specialty' then exists (select 1 from public.specialties s where s.id = curriculum_dependencies.alvo_id)
      when 'class_requirement' then exists (select 1 from public.class_requirements r where r.id = curriculum_dependencies.alvo_id)
      when 'specialty_requirement' then exists (select 1 from public.specialty_requirements r where r.id = curriculum_dependencies.alvo_id)
      else false
    end
    and case curriculum_dependencies.depende_de_tipo
      when 'class' then exists (select 1 from public.classes c where c.id = curriculum_dependencies.depende_de_id)
      when 'specialty' then exists (select 1 from public.specialties s where s.id = curriculum_dependencies.depende_de_id)
      else false
    end);

-- Igual à 39, com a origem: para quem é do app, só versão OFICIAL (a mesma regra do diff na 83). A
-- plataforma (sessão sem usuário, ou administrador) continua lendo qualquer versão.
create or replace function public.requisito_origem(p_requirement_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'requisito', jsonb_build_object('id', r.id, 'manifesto_id', r.manifesto_id, 'codigo', r.codigo, 'descricao', r.descricao,
                                    'status_fonte', r.status_fonte, 'observacao_fonte', r.observacao_fonte,
                                    'alterado_por_omd', (select x from jsonb_array_elements(coalesce(v.fonte_detalhes -> 'omds', '[]'::jsonb)) x where x ->> 'id' = r.alterado_por_omd),
                                    'confirmado_por_omd', (select x from jsonb_array_elements(coalesce(v.fonte_detalhes -> 'omds', '[]'::jsonb)) x where x ->> 'id' = r.confirmado_por_omd),
                                    'conteudo_dinamico', (select jsonb_build_object('chave', d.chave, 'nome', d.nome) from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
                                    'escolha', (select jsonb_build_object('n_minimo', g.n_minimo, 'sem_repeticao', g.sem_repeticao, 'pool_sem_repeticao', g.pool_sem_repeticao,
                                                                          'opcoes', (select coalesce(jsonb_agg(o.rotulo order by o.ordem), '[]'::jsonb) from public.requirement_options o where o.grupo_id = g.id))
                                                from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = r.id)),
    'secao', jsonb_build_object('manifesto_id', s.manifesto_id, 'codigo', s.codigo, 'nome', s.nome),
    'classe', jsonb_build_object('manifesto_id', c.manifesto_id, 'nome', c.nome, 'idade_minima', c.idade_minima, 'vigente_desde', c.vigente_desde,
                                 'fonte_url', c.fonte_url, 'fonte_publicado_em', c.fonte_publicado_em, 'proveniencia', c.proveniencia),
    'versao', jsonb_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao, 'status', v.status,
                                 'vigente_desde', v.vigente_desde, 'fonte_hash', v.fonte_hash, 'fonte_arquivo', v.fonte_arquivo,
                                 'importado_em', v.importado_em, 'fonte_descricao', v.fonte_descricao,
                                 'manifesto_versao', v.fonte_detalhes ->> 'manifesto_versao', 'gerado_em', v.fonte_detalhes ->> 'gerado_em',
                                 'arquivos', v.fonte_detalhes -> 'arquivos')
  )
  from public.class_requirements r
  join public.class_sections s on s.id = r.section_id
  join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id
  where r.id = p_requirement_id and public.classe_esta_publicada(c.id)
    and (v.origem = 'oficial' or auth.uid() is null or public.eh_admin_plataforma(auth.uid()));
$$;


-- =============================================================================
--  M1. Missão e devocional: uma por pessoa, por CLUBE, por dia
-- =============================================================================
-- O índice novo acrescenta o clube ao antigo: é mais frouxo, criá-lo nunca falha com os dados que
-- existem. Ele nasce ANTES de o antigo sair, para não haver instante sem a trava do "já fez". O
-- antigo é achado pelas COLUNAS (não pelo nome), para não sobrar um (usuario_id, data) com outro
-- nome em algum banco (o legado o criou com nome automático).
create unique index if not exists missoes_feitas_usuario_clube_data_key on public.missoes_feitas (usuario_id, club_id, data);
create unique index if not exists devocional_usuario_clube_data_key on public.devocional (usuario_id, club_id, data);
do $m$
declare r record;
begin
  for r in
    select i.indrelid::regclass as tabela, ic.relname as indice, c.conname
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      left join pg_constraint c on c.conindid = i.indexrelid and c.contype = 'u'
     where i.indrelid in ('public.missoes_feitas'::regclass, 'public.devocional'::regclass)
       and i.indisunique and not i.indisprimary
       and (select array_agg(a.attname::text order by a.attname::text)
              from unnest(i.indkey::int2[]) k join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k)
           = array['data', 'usuario_id']
  loop
    if r.conname is not null then
      execute format('alter table %s drop constraint %I', r.tabela, r.conname);
    else
      execute format('drop index public.%I', r.indice);
    end if;
  end loop;
end $m$;

-- os resumos olham o clube da aba (sem clube: nada feito, sequência zero)
create or replace function public.meu_resumo_missoes()
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_feito boolean := false; v_foto text; v_status text; v_seq int := 0; v_d date;
begin
  if v_uid is null or v_club is null then return json_build_object('feito', false, 'sequencia', 0); end if;
  select foto_url, status into v_foto, v_status from public.missoes_feitas
   where usuario_id = v_uid and club_id = v_club and data = v_hoje;
  v_feito := found;
  v_d := case when v_feito then v_hoje else v_hoje - 1 end;
  loop
    exit when not exists (select 1 from public.missoes_feitas where usuario_id = v_uid and club_id = v_club and data = v_d);
    v_seq := v_seq + 1; v_d := v_d - 1;
  end loop;
  return json_build_object('feito', v_feito, 'foto', v_foto, 'sequencia', v_seq, 'status', v_status);
end;
$$;

create or replace function public.meu_resumo_devocional()
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_feito boolean := false; v_foto text; v_status text; v_seq int := 0; v_d date;
begin
  if v_uid is null or v_club is null then return json_build_object('feito', false, 'sequencia', 0); end if;
  select foto_url, status into v_foto, v_status from public.devocional
   where usuario_id = v_uid and club_id = v_club and data = v_hoje;
  v_feito := found;
  v_d := case when v_feito then v_hoje else v_hoje - 1 end;
  loop
    exit when not exists (select 1 from public.devocional where usuario_id = v_uid and club_id = v_club and data = v_d);
    v_seq := v_seq + 1; v_d := v_d - 1;
  end loop;
  return json_build_object('feito', v_feito, 'foto', v_foto, 'sequencia', v_seq, 'status', v_status);
end;
$$;

create or replace function public.devocional_feito_hoje()
returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from public.devocional
    where usuario_id = auth.uid() and club_id = public.clube_atual_id()
      and data = (now() at time zone 'America/Sao_Paulo')::date);
$$;


-- =============================================================================
--  M2. _vinculo_ativo: o mesmo critério de membros_do_clube
-- =============================================================================
-- Com dois vínculos ativos no mesmo clube (ex.: conselheira e responsável), o que vale para chat,
-- duelo e leilão é o que NÃO é 'pais'; empate, o mais novo. É o que a lista de membros mostra.
create or replace function public._vinculo_ativo(p_user uuid, p_club uuid)
returns table (papel text, unidade_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.role, m.unidade_id
    from public.organization_memberships m
   where m.user_id = p_user and m.organizational_unit_id = p_club
     and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
   order by (m.role <> 'pais') desc, m.created_at desc, m.id desc
   limit 1;
$$;


-- =============================================================================
--  M4. criar_duelo: o teto anti-spam de 24h é por clube
-- =============================================================================
-- Igual à 21 em tudo, menos o "Teto 2".
create or replace function public.criar_duelo(p_desafio_id uuid, p_unidade_b uuid)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_ua uuid;
  v_dias int; v_titulo text; v_pontos int;
  v_abertos int; v_recentes int;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  -- Só desafia PELA SUA unidade (não dá pra desafiar em nome de outra) e só quem
  -- já teve o cadastro aprovado (status ativo) — senão um cadastro pendente com
  -- unidade poderia lançar duelos e tocar o push do clube.
  select v.unidade_id into v_ua
  from public._vinculo_ativo(v_uid, v_club) v;
  if v_ua is null or not public.membro_ativo_no_clube(v_club) then
    raise exception 'Você precisa estar numa unidade (com cadastro aprovado) pra desafiar.';
  end if;
  if p_unidade_b is null or p_unidade_b = v_ua then
    raise exception 'Escolha OUTRA unidade pra desafiar.';
  end if;
  -- só unidade do MEU clube (unidade de outro clube = "não encontrada", sem revelar que existe)
  if not exists (select 1 from public.unidades where id = p_unidade_b and club_id = v_club) then
    raise exception 'Unidade não encontrada.';
  end if;

  -- O desafio precisa existir, ser do meu clube e estar ativo (e guardamos o snapshot dele)
  select dias, titulo, pontos into v_dias, v_titulo, v_pontos
  from public.desafios_unidade where id = p_desafio_id and ativo and club_id = v_club;
  if v_dias is null then
    raise exception 'Desafio inválido ou desativado.';
  end if;

  -- Trava 1 — na MINHA unidade: serializa os dois tetos abaixo (contar-e-inserir).
  -- Sem ela, várias chamadas paralelas contra adversários DIFERENTES pegariam
  -- travas diferentes, leriam a mesma contagem e furariam os limites (spam de push).
  perform pg_advisory_xact_lock(hashtext('duelo_uni:' || v_ua::text));

  -- Trava 2 — no PAR de unidades: impede a corrida espelhada (X desafia Y no mesmo
  -- instante em que Y desafia X), que criaria 2 duelos iguais e premiaria em dobro.
  -- Ordem unidade -> par é livre de deadlock (quem segura o par nunca espera unidade).
  perform pg_advisory_xact_lock(hashtext(
    'duelo:' || least(v_ua, p_unidade_b)::text || ':' || greatest(v_ua, p_unidade_b)::text
  ));

  -- Nada de duelo repetido do mesmo desafio entre as mesmas unidades
  if exists (
    select 1 from public.duelos
    where status = 'aberto' and desafio_id = p_desafio_id
      and ((unidade_a = v_ua and unidade_b = p_unidade_b)
        or (unidade_a = p_unidade_b and unidade_b = v_ua))
  ) then
    raise exception 'Já existe um duelo aberto desse desafio entre essas unidades.';
  end if;

  -- Teto 1: 3 duelos ABERTOS por unidade (pra não virar bagunça; a unidade é de um clube só)
  select count(*) into v_abertos
  from public.duelos where status = 'aberto' and unidade_a = v_ua;
  if v_abertos >= 3 then
    raise exception 'Sua unidade já tem 3 duelos abertos. Espere julgarem algum. 🙂';
  end if;

  -- Teto 2 (anti-spam): 3 duelos CRIADOS por pessoa a cada 24h, seja qual for o status, NESTE
  -- clube. Sem isso, criar+cancelar em loop tocaria o push do clube sem parar — e o push é por
  -- clube: os 3 duelos de A não dizem nada sobre o push de B (M4).
  select count(*) into v_recentes
  from public.duelos
  where criado_por = v_uid and club_id = v_club and created_at > now() - interval '24 hours';
  if v_recentes >= 3 then
    raise exception 'Você já lançou 3 duelos nas últimas 24h. Amanhã tem mais! 🙂';
  end if;

  insert into public.duelos (desafio_id, titulo, pontos, unidade_a, unidade_b, criado_por, prazo)
  values (p_desafio_id, v_titulo, v_pontos, v_ua, p_unidade_b, v_uid,
          ((now() at time zone 'America/Sao_Paulo')::date + v_dias))
  returning id into v_id;

  return json_build_object('id', v_id);
exception when unique_violation then
  -- Backstop do índice único (corrida espelhada): mensagem amigável em vez do erro cru
  raise exception 'Já existe um duelo aberto desse desafio entre essas unidades.';
end;
$$;


-- =============================================================================
--  M5. Aviso de aniversário: a regra do card
-- =============================================================================
create or replace function public.notif_aniversariantes_hoje()
returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Uma vez por PESSOA por CLUBE, e só quem aparece no card de aniversariantes (membros_do_clube):
  -- papel que não é 'pais', vínculo ativo e VIGENTE, conta que não é de teste.
  for r in
    select distinct on (m.user_id, m.organizational_unit_id)
           p.nome, m.organizational_unit_id as club_id
      from public.profiles p
      join public.organization_memberships m
        on m.user_id = p.id and m.status = 'ativo' and m.role <> 'pais'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
      join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
     where p.nascimento is not null
       and coalesce(p.teste, false) = false
       and to_char(p.nascimento, 'MM-DD') = to_char((now() at time zone 'America/Sao_Paulo'), 'MM-DD')
     order by m.user_id, m.organizational_unit_id
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('🎂 Aniversário hoje!',
            'Hoje é aniversário de ' || coalesce(r.nome, 'um membro') || '. Mande os parabéns! 🥳',
            'aniversario', '/unidades', 'todos', r.club_id);
  end loop;
end;
$$;


-- =============================================================================
--  R3. "Reativar" gera um aviso próprio
-- =============================================================================
create or replace function public.notif_vinculo_aprovado()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ativo' and old.status is distinct from 'ativo'
     and exists (select 1 from public.organizational_units u
                  where u.id = new.organizational_unit_id and u.type = 'clube') then
    if old.status = 'pendente' then
      -- a aprovação da ENTRADA (por código, convite ou cadastro) — a mesma da 82
      insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
      values ('🎉 Cadastro aprovado!', 'Bem-vindo(a) ao clube! Já pode usar tudo.', 'cadastro', '/ranking', 'pessoal',
              new.user_id, new.organizational_unit_id);
    elsif old.status in ('suspenso', 'encerrado') then
      -- o "Reativar" da tela de Usuários: de quem foi DESATIVADO (suspenso) ou REJEITADO (encerrado —
      -- quem foi rejeitado não consegue pedir de novo, porque entrada_solicitar devolve ja_era; o
      -- Reativar é a única volta). Não é "cadastro aprovado", mas a pessoa precisa saber que voltou.
      insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
      values ('🔓 Acesso reativado!', 'A liderança reativou o seu acesso ao clube. Já pode usar tudo de novo.', 'cadastro', '/ranking', 'pessoal',
              new.user_id, new.organizational_unit_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.notif_vinculo_aprovado() from public, anon, authenticated;


-- =============================================================================
--  C1. Classe de versão que NÃO é oficial não existe para o app
-- =============================================================================
-- O espelho de `_especialidade_do_catalogo_oficial` (83). Arquivada continua valendo: quem começou
-- numa versão oficial termina nela.
create or replace function public._classe_do_catalogo_oficial(p_class_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classes c
    join public.curriculum_versions v on v.id = c.curriculum_version_id
    where c.id = p_class_id and v.origem = 'oficial'
  );
$$;
revoke all on function public._classe_do_catalogo_oficial(uuid) from public, anon, authenticated;

-- ---------- leituras: recurso 'classes' + só catálogo oficial ----------
-- Igual à 84 (que já troca o conteúdo pelo fixado), com o recurso e a origem.
create or replace function public.minha_classe(p_member_class_id uuid default null)
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record;
begin
  if v_uid is null or v_club is null then return null; end if;
  perform public._exigir_classes_habilitado(v_club);
  if p_member_class_id is not null then
    select * into v_mc from public.member_classes
     where id = p_member_class_id and usuario_id = v_uid and club_id = v_club
       and public._classe_do_catalogo_oficial(class_id);
  else
    select * into v_mc from public.member_classes
     where usuario_id = v_uid and club_id = v_club and public._classe_do_catalogo_oficial(class_id)
     order by (status = 'em_andamento') desc, iniciada_em desc
     limit 1;
  end if;
  if v_mc.id is null then return null; end if;

  return json_build_object(
    'member_class', json_build_object(
      'id', v_mc.id, 'status', v_mc.status, 'iniciada_em', v_mc.iniciada_em, 'concluida_em', v_mc.concluida_em, 'investida_em', v_mc.investida_em,
      'percentual', public.classe_percentual(v_mc.id)
    ),
    'classe', (select json_build_object('id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
                                        'idade_minima', c.idade_minima, 'manifesto_id', c.manifesto_id, 'vigente_desde', c.vigente_desde,
                                        'fonte_url', c.fonte_url, 'fonte_publicado_em', c.fonte_publicado_em)
               from public.classes c where c.id = v_mc.class_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao,
               'vigente_desde', ver.vigente_desde, 'fonte_hash', ver.fonte_hash, 'importado_em', ver.importado_em)
      from public.classes c join public.curriculum_versions ver on ver.id = c.curriculum_version_id where c.id = v_mc.class_id
    ),
    'conclusao', json_build_object(
      'snapshot', (select json_build_object('id', s.id, 'versao', s.versao, 'hash', s.hash, 'selado_em', s.selado_em, 'status', s.status)
                   from public.class_completion_snapshots s where s.member_class_id = v_mc.id and s.status = 'selado' order by s.versao desc limit 1),
      'revisao', (select json_build_object('status', ir.status, 'solicitado_em', ir.solicitado_em, 'revisado_em', ir.revisado_em, 'comentario', ir.comentario,
                    'revisado_por_nome', (select nome from public.profiles where id = ir.revisado_por), 'revisado_papel', ir.revisado_papel)
                  from public.investiture_reviews ir where ir.member_class_id = v_mc.id order by ir.solicitado_em desc limit 1),
      'investidura', (select json_build_object('data', i.data_investidura, 'registrado_em', i.created_at, 'observacao', i.observacao,
                        'registrado_por_nome', (select nome from public.profiles where id = i.registrado_por), 'status', i.status)
                      from public.class_investitures i where i.member_class_id = v_mc.id order by i.created_at desc limit 1)
    ),
    'secoes', (
      select coalesce(json_agg(json_build_object(
        'id', s.id, 'codigo', s.codigo, 'nome', s.nome, 'ordem', s.ordem,
        'requisitos', (
          select coalesce(json_agg(json_build_object(
            'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao, 'manifesto_id', r.manifesto_id, 'status_fonte', r.status_fonte,
            'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
            'member_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
            'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
            'conteudo_dinamico', (select public._conteudo_do_requisito(mr.id, d.chave)
                                  from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
            'escolha', (
              select (public._requisito_escolha_estado(mr.id) || jsonb_build_object(
                'opcoes', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'rotulo', o.rotulo, 'specialty_id', o.specialty_id) order by o.ordem), '[]'::jsonb)
                           from public.requirement_options o where o.grupo_id = g.id)))::json
              from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = r.id and mr.id is not null
            ),
            'bloqueios', case when mr.id is null then '[]'::json else to_json(public._requisito_bloqueios(mr.id)) end,
            'avaliacoes', (
              select coalesce(json_agg(json_build_object(
                'decisao', a.decisao, 'avaliado_por_nome', p.nome, 'avaliado_papel', a.avaliado_papel,
                'comentario', a.comentario, 'created_at', a.created_at
              ) order by a.created_at), '[]'::json)
              from public.requirement_approvals a
              join public.profiles p on p.id = a.avaliado_por
              where mr.id is not null and a.member_requirement_id = mr.id
            )
          ) order by r.ordem, r.codigo), '[]'::json)
          from public.class_requirements r
          left join public.member_requirements mr on mr.requirement_id = r.id and mr.member_class_id = v_mc.id
          where r.section_id = s.id and r.ativo
        )
      ) order by s.ordem), '[]'::json)
      from public.class_sections s where s.class_id = v_mc.class_id
    )
  );
end;
$$;

-- A fila da liderança. Quem não é liderança recebe a lista vazia (como antes); a liderança de um
-- clube com 'classes' desligado recebe o erro claro do recurso (como as escritas).
create or replace function public.classe_avaliacoes_pendentes()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then return '[]'::json; end if;
  perform public._exigir_classes_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'member_requirement_id', mr.id,
      'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
      'classe_nome', c.nome, 'secao_nome', s.nome,
      'requisito_id', r.id, 'requisito_codigo', r.codigo, 'requisito_descricao', r.descricao,
      'tipo_evidencia', r.tipo_evidencia, 'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path,
      'enviado_em', mr.enviado_em,
      'escolha', public._requisito_escolha_estado(mr.id),
      'conteudo_dinamico', (select public._conteudo_do_requisito(mr.id, d.chave) from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
      'bloqueios', to_json(public._requisito_bloqueios(mr.id))
    ) order by mr.enviado_em)
    from public.member_requirements mr
    join public.member_classes mc on mc.id = mr.member_class_id
    join public.class_requirements r on r.id = mr.requirement_id
    join public.class_sections s on s.id = r.section_id
    join public.classes c on c.id = s.class_id
    join public.profiles p on p.id = mr.usuario_id
    where mr.club_id = v_club and mr.status = 'aguardando_avaliacao'
      and public._classe_do_catalogo_oficial(mc.class_id)
  ), '[]'::json);
end;
$$;

create or replace function public.classe_revisoes_pendentes()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then return '[]'::json; end if;
  perform public._exigir_classes_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'member_class_id', mc.id, 'status', mc.status, 'concluida_em', mc.concluida_em, 'iniciada_em', mc.iniciada_em,
      'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
      'classe_nome', c.nome, 'classe_manifesto_id', c.manifesto_id, 'percentual', public.classe_percentual(mc.id),
      'snapshot', (select json_build_object('id', s.id, 'versao', s.versao, 'hash', s.hash, 'selado_em', s.selado_em, 'status', s.status,
                      'manifesto_versao', s.conteudo -> 'curriculum_version' ->> 'manifesto_versao')
                   from public.class_completion_snapshots s where s.member_class_id = mc.id and s.status = 'selado' order by s.versao desc limit 1),
      'revisao', (select json_build_object('id', ir.id, 'status', ir.status, 'solicitado_em', ir.solicitado_em, 'revisado_em', ir.revisado_em, 'comentario', ir.comentario)
                  from public.investiture_reviews ir where ir.member_class_id = mc.id order by ir.solicitado_em desc limit 1),
      'bloqueios', (select coalesce(json_agg(json_build_object('codigo', r.codigo, 'bloqueios', to_json(b))), '[]'::json)
                    from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
                    cross join lateral public._requisito_bloqueios(mr.id) b where mr.member_class_id = mc.id and array_length(b, 1) > 0),
      'ultimo_evento', (select json_build_object('tipo', e.tipo, 'em', e.created_at, 'dados', e.dados) from public.class_completion_events e where e.member_class_id = mc.id order by e.created_at desc limit 1),
      'requisitos', (select coalesce(json_agg(json_build_object('member_requirement_id', mr.id, 'secao', s.codigo, 'codigo', r.codigo, 'descricao', r.descricao, 'status', mr.status,
                        'aprovado_por', (select pp.nome from public.requirement_approvals a join public.profiles pp on pp.id = a.avaliado_por where a.member_requirement_id = mr.id and a.decisao = 'aprovado' order by a.created_at desc limit 1))
                        order by s.ordem, r.ordem, r.codigo), '[]'::json)
                     from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id join public.class_sections s on s.id = r.section_id where mr.member_class_id = mc.id and r.ativo)
    ) order by mc.concluida_em nulls last, mc.updated_at)
    from public.member_classes mc
    join public.classes c on c.id = mc.class_id
    join public.profiles p on p.id = mc.usuario_id
    where mc.club_id = v_club and mc.status in ('requisitos_concluidos', 'aguardando_revisao', 'apto_investidura')
      and public._classe_do_catalogo_oficial(mc.class_id)
  ), '[]'::json);
end;
$$;

-- A explicação continua devolvendo NULL para quem não pode ver (sem oráculo). Para quem pode:
-- matrícula de versão que não é oficial também é NULL; oficial exige o recurso (como a de
-- especialidade na 83).
create or replace function public.explicar_requisito_classe(p_member_requirement_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mr record; v_req record; v_regras jsonb := '[]'::jsonb; v_resultado text; v_bloq text[];
  v_dep_pendentes text[]; v_esc jsonb; v_conteudo jsonb;
begin
  select * into v_mr from public.member_requirements where id = p_member_requirement_id;
  if not found then return null; end if;
  if not ((v_mr.usuario_id = auth.uid() and public.membro_ativo_no_clube(v_mr.club_id)) or public.pode_gerir_no_clube(v_mr.club_id)) then return null; end if;
  if not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then return null; end if;
  perform public._exigir_classes_habilitado(v_mr.club_id);

  select * into v_req from public.class_requirements where id = v_mr.requirement_id;

  v_dep_pendentes := public.dependencias_pendentes('class_requirement', v_mr.requirement_id, v_mr.usuario_id, v_mr.club_id);
  v_regras := v_regras || jsonb_build_object(
    'regra', 'dependencia_curricular', 'satisfeito', (coalesce(array_length(v_dep_pendentes, 1), 0) = 0),
    'origem', 'curriculum_dependencies + curriculum_achievements (histórico portátil)',
    'detalhe', jsonb_build_object('pendencias', to_jsonb(coalesce(v_dep_pendentes, '{}'::text[])))
  );

  if v_req.conteudo_dinamico_definicao_id is not null then
    select public._conteudo_do_requisito(v_mr.id, chave) into v_conteudo
      from public.dynamic_content_definitions where id = v_req.conteudo_dinamico_definicao_id;
    v_regras := v_regras || jsonb_build_object(
      'regra', 'conteudo_dinamico', 'satisfeito', (v_conteudo is not null and v_conteudo ->> 'valor' is not null),
      'origem', 'dynamic_content_definitions + dynamic_content_values', 'detalhe', coalesce(v_conteudo, 'null'::jsonb)
    );
  end if;

  v_esc := public._requisito_escolha_estado(p_member_requirement_id);
  if v_esc is not null then
    v_regras := v_regras || jsonb_build_object(
      'regra', 'escolha_n_de_m', 'satisfeito', ((v_esc ->> 'satisfeito')::boolean or v_mr.status = 'aprovado'),
      'origem', 'requirement_option_groups + requirement_options + member_requirement_options', 'detalhe', v_esc
    );
  end if;

  v_bloq := public._requisito_bloqueios(p_member_requirement_id);
  if v_mr.status = 'aprovado' then v_resultado := 'satisfeito';
  elsif coalesce(array_length(v_bloq, 1), 0) > 0 then v_resultado := 'bloqueado';
  else v_resultado := 'pendente';
  end if;

  return jsonb_build_object(
    'requisito', jsonb_build_object('tipo', 'class_requirement', 'id', v_mr.requirement_id, 'status_operacional', v_mr.status),
    'resultado', v_resultado, 'bloqueios', to_jsonb(coalesce(v_bloq, '{}'::text[])), 'regras_aplicadas', v_regras
  );
end;
$$;

-- ---------- contagens (Gestão, Início, painel institucional) ----------
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
      then (select count(*) from public.member_requirements mr join public.member_classes mc on mc.id = mr.member_class_id
             where mr.club_id = v_club and mr.status = 'aguardando_avaliacao' and public._classe_do_catalogo_oficial(mc.class_id)) end,
    'especialidades', case when public.recurso_habilitado_no_clube(v_club, 'especialidades')
      then (select count(*) from public.member_specialty_requirements msr
              join public.member_specialties ms on ms.id = msr.member_specialty_id
             where msr.club_id = v_club and msr.status = 'aguardando_avaliacao'
               and public._especialidade_do_catalogo_oficial(ms.specialty_id)) end,
    'investiduras', case when public.recurso_habilitado_no_clube(v_club, 'classes')
      then (select count(*) from public.member_classes where club_id = v_club and status in ('requisitos_concluidos', 'aguardando_revisao', 'apto_investidura')
              and public._classe_do_catalogo_oficial(class_id)) end,
    'experiencias', case when public.recurso_habilitado_no_clube(v_club, 'experiencias')
      then (select count(*) from public.experience_submissions where club_id = v_club and status = 'enviada') end,
    'atividades', case when public.recurso_habilitado_no_clube(v_club, 'atividades')
      then (select count(*) from public.entregas where club_id = v_club and status = 'pendente') end,
    'missoes', case when public.recurso_habilitado_no_clube(v_club, 'missoes')
      then (select count(*) from public.missoes_feitas where club_id = v_club and status = 'pendente') end,
    'cadastros', (select count(*) from public.organization_memberships where organizational_unit_id = v_club and status = 'pendente'));
end;
$$;

-- meu_inicio: os blocos de CLASSE ganham o filtro, trocados sobre a definição REAL (o mesmo padrão
-- da 83 para os blocos de especialidade: a função é grande e monta JSON; reescrevê-la à mão seria o
-- jeito mais fácil de mudar algo que ninguém pediu). Cada troca tem de acontecer UMA vez, senão a
-- migration PARA.
do $m$
declare
  v_trocas constant text[][] := array[
    -- peso 100: correção pedida (contagem)
    array[$a$and mc.status not in ('investida', 'cancelada');$a$,
          $b$and mc.status not in ('investida', 'cancelada')
       and public._classe_do_catalogo_oficial(mc.class_id);$b$],
    -- peso 100: correção pedida (o nome da classe no card)
    array[$a$and mr.status = 'correcao_solicitada'
       order by mr.updated_at desc limit 1;$a$,
          $b$and mr.status = 'correcao_solicitada'
         and public._classe_do_catalogo_oficial(mc.class_id)
       order by mr.updated_at desc limit 1;$b$],
    -- peso 90: envios de classe esperando a liderança
    array[$a$(select count(*) from public.member_requirements where club_id = v_club and status = 'aguardando_avaliacao')$a$,
          $b$(select count(*) from public.member_requirements mr join public.member_classes mc on mc.id = mr.member_class_id
            where mr.club_id = v_club and mr.status = 'aguardando_avaliacao' and public._classe_do_catalogo_oficial(mc.class_id))$b$],
    -- peso 80: classe quase pronta
    array[$a$and mc.status = 'em_andamento'
       group by cl.nome, mc.id$a$,
          $b$and mc.status = 'em_andamento'
         and public._classe_do_catalogo_oficial(mc.class_id)
       group by cl.nome, mc.id$b$],
    -- peso 60: requisitos prontos para enviar
    array[$a$join public.member_classes mc on mc.id = mr.member_class_id and mc.status = 'em_andamento'$a$,
          $b$join public.member_classes mc on mc.id = mr.member_class_id and mc.status = 'em_andamento' and public._classe_do_catalogo_oficial(mc.class_id)$b$],
    -- peso 32: investidura recente
    array[$a$and data_investidura > (current_date - 30);$a$,
          $b$and data_investidura > (current_date - 30)
       and public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = class_investitures.member_class_id));$b$]
  ];
  v_fonte text; v_novo text; i int; v_vezes int;
begin
  v_fonte := pg_get_functiondef('public.meu_inicio()'::regprocedure);
  if position('_classe_do_catalogo_oficial' in v_fonte) > 0 then return; end if;  -- já trocada (a migration rodou antes)
  v_novo := v_fonte;
  for i in 1 .. array_length(v_trocas, 1) loop
    v_vezes := (length(v_novo) - length(replace(v_novo, v_trocas[i][1], ''))) / length(v_trocas[i][1]);
    if v_vezes <> 1 then
      raise exception 'meu_inicio mudou de forma: o trecho % aparece % vez(es), esperado 1 — revise a troca', i, v_vezes;
    end if;
    v_novo := replace(v_novo, v_trocas[i][1], v_trocas[i][2]);
  end loop;
  execute v_novo;
end $m$;

-- o painel institucional (distrito/região) só conta classe do catálogo oficial
create or replace function public.escopo_painel()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_escopo uuid := public.escopo_atual_id(); v_papel text;
begin
  if v_uid is null or v_escopo is null then return '[]'::json; end if;
  select m.role into v_papel from public.organization_memberships m
   where m.user_id = v_uid and m.organizational_unit_id = v_escopo and m.status = 'ativo'
     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()) limit 1;
  if v_papel is null or not (public._capacidades_institucionais(v_papel) ->> 'ver_painel')::boolean then
    return '[]'::json;
  end if;

  return coalesce((
    select json_agg(json_build_object(
      'club_id', c.id,
      'nome', c.nome,
      'tipo', c.type,
      'status', c.status,
      -- AGREGADOS (contagem pura; nenhuma linha pessoal sai daqui)
      'membros_ativos', (select count(*) from public.organization_memberships m2
                          where m2.organizational_unit_id = c.id and m2.status = 'ativo' and m2.role <> 'pais'
                            and m2.starts_at <= now() and (m2.ends_at is null or m2.ends_at > now())),
      'classes_em_andamento', (select count(*) from public.member_classes mc where mc.club_id = c.id and mc.status = 'em_andamento'
                                 and public._classe_do_catalogo_oficial(mc.class_id)),
      'classes_aguardando_revisao', (select count(*) from public.member_classes mc where mc.club_id = c.id and mc.status in ('requisitos_concluidos', 'aguardando_revisao')
                                       and public._classe_do_catalogo_oficial(mc.class_id)),
      'classes_aptas_investidura', (select count(*) from public.member_classes mc where mc.club_id = c.id and mc.status = 'apto_investidura'
                                      and public._classe_do_catalogo_oficial(mc.class_id)),
      'investidos_total', (select count(*) from public.member_classes mc where mc.club_id = c.id and mc.status = 'investida'
                             and public._classe_do_catalogo_oficial(mc.class_id))
    ) order by c.nome)
    from public.organizational_units c
    where c.id in (select club_id from public._clubes_descendentes(v_escopo))
  ), '[]'::json);
end;
$$;

create or replace function public.escopo_investiduras_pendentes()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_escopo uuid := public.escopo_atual_id(); v_papel text;
begin
  if v_uid is null or v_escopo is null then return '[]'::json; end if;
  select m.role into v_papel from public.organization_memberships m
   where m.user_id = v_uid and m.organizational_unit_id = v_escopo and m.status = 'ativo'
     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()) limit 1;
  if v_papel is null or not (public._capacidades_institucionais(v_papel) ->> 'decidir_workflow')::boolean then
    return '[]'::json;
  end if;

  return coalesce((
    select json_agg(json_build_object(
      'member_class_id', r.member_class_id,
      'pessoa_nome', p.nome,                 -- mínimo indispensável pra decidir sobre a investidura dela
      'classe_nome', cl.nome,
      'clube_nome', o.nome,
      'etapa', json_build_object('ordem', st.ordem, 'chave', st.chave, 'nome', st.nome, 'escopo_tipo', st.escopo_tipo),
      'workflow', json_build_object('versao', r.workflow_versao),
      'aguardando_desde', r.updated_at
    ) order by r.updated_at)
    from public.investiture_workflow_runs r
    join public.investiture_workflow_stages st on st.workflow_id = r.workflow_id and st.ordem = r.current_stage_ordem
    join public.profiles p on p.id = r.usuario_id
    join public.organizational_units o on o.id = r.club_id_origem
    join public.member_classes mc on mc.id = r.member_class_id
    join public.classes cl on cl.id = mc.class_id
    where r.status = 'em_andamento'
      and r.club_id_origem in (select club_id from public._clubes_descendentes(v_escopo))
      -- a etapa atual tem que resolver EXATAMENTE neste escopo, e o papel exigido tem que ser o meu
      and public.unidade_ancestral(r.club_id_origem, st.escopo_tipo) = v_escopo
      and v_papel = any (st.papeis_permitidos)
      and public._classe_do_catalogo_oficial(mc.class_id)
  ), '[]'::json);
end;
$$;

-- ---------- escritas: matrícula de versão que não é oficial = "não encontrada" ----------
create or replace function public.requisito_salvar(p_requirement_id uuid, p_texto text default null, p_evidencia_path text default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  update public.member_requirements
     set evidencia_texto = coalesce(p_texto, evidencia_texto),
         evidencia_path = coalesce(p_evidencia_path, evidencia_path),
         status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         updated_at = now()
   where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.requisito_escolher(p_requirement_id uuid, p_option_ids uuid[] default '{}'::uuid[], p_rotulos_livres text[] default '{}'::text[])
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_g record; v_total int; v_id uuid; v_txt text;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status not in ('nao_iniciado', 'em_andamento', 'correcao_solicitada') then raise exception 'Este requisito não pode mais ser alterado.'; end if;
  select * into v_g from public.requirement_option_groups where alvo_tipo = 'class_requirement' and alvo_id = p_requirement_id;
  if not found then raise exception 'Este requisito não tem opções pra escolher.'; end if;
  select count(*) into v_total from public.requirement_options where grupo_id = v_g.id;
  if v_total > 0 and coalesce(array_length(p_rotulos_livres, 1), 0) > 0 then raise exception 'Este requisito tem opções definidas — escolha entre elas.'; end if;
  if v_total = 0 and coalesce(array_length(p_option_ids, 1), 0) > 0 then raise exception 'Este requisito não tem lista de opções — informe qual foi.'; end if;

  delete from public.member_requirement_options where member_requirement_id = v_mr.id;
  foreach v_id in array coalesce(p_option_ids, '{}') loop
    if not exists (select 1 from public.requirement_options where id = v_id and grupo_id = v_g.id) then raise exception 'Opção inválida para este requisito.'; end if;
    insert into public.member_requirement_options (member_requirement_id, option_id) values (v_mr.id, v_id) on conflict do nothing;
  end loop;
  foreach v_txt in array coalesce(p_rotulos_livres, '{}') loop
    if length(trim(v_txt)) = 0 then continue; end if;
    insert into public.member_requirement_options (member_requirement_id, rotulo_livre) values (v_mr.id, trim(v_txt)) on conflict do nothing;
  end loop;
  update public.member_requirements set status = case when status = 'nao_iniciado' then 'em_andamento' else status end, updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true, 'escolha', public._requisito_escolha_estado(v_mr.id));
end;
$$;

create or replace function public.requisito_enviar(p_requirement_id uuid)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record; v_bloq text[];
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  select * into v_req from public.class_requirements where id = p_requirement_id;
  if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
    raise exception 'Este requisito exige uma evidência antes de enviar.';
  end if;
  v_bloq := public._requisito_bloqueios(v_mr.id);
  if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
  -- o conteúdo do ano em que a criança ENVIOU passa a ser o do requisito (correção e reenvio não trocam)
  perform public._fixar_conteudo_do_requisito(v_mr.id, 'envio');
  update public.member_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.requisito_avaliar(p_member_requirement_id uuid, p_decisao text, p_comentario text default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_papel text; v_bloq text[]; v_conteudo jsonb;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements where id = p_member_requirement_id and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado neste clube.';
  end if;

  if p_decisao = 'aprovado' then
    v_bloq := public._requisito_bloqueios(v_mr.id);
    if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
    -- aprovado direto (sem envio, ex.: observado em reunião): fixa aqui o conteúdo avaliado
    perform public._fixar_conteudo_do_requisito(v_mr.id, 'aprovacao');
  end if;
  select conteudo_fixado into v_conteudo from public.member_requirements where id = v_mr.id;

  v_papel := public.papel_no_clube(v_uid, v_club);
  insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario, conteudo_avaliado)
  select v_mr.id, v_mr.requirement_id, ver.id, v_club, p_decisao, v_uid, coalesce(v_papel, '?'), p_comentario, v_conteudo
  from public.class_requirements r
  join public.class_sections s on s.id = r.section_id
  join public.classes c on c.id = s.class_id
  join public.curriculum_versions ver on ver.id = c.curriculum_version_id
  where r.id = v_mr.requirement_id;

  update public.member_requirements set status = p_decisao, updated_at = now() where id = v_mr.id;  -- gatilho de conclusão roda aqui, já com a aprovação gravada
  return json_build_object('ok', true);
end;
$$;

create or replace function public.classe_revisao_solicitar(p_member_class_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_mc record;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club;
  if not found or not public._classe_do_catalogo_oficial(v_mc.class_id) then raise exception 'Classe do membro não encontrada neste clube.'; end if;
  return public._classe_selar_conclusao(v_mc.id);
end;
$$;

-- C1 + C7: a correção da revisão final grava também o conteúdo que estava fixado no requisito
create or replace function public.revisao_final_decidir(p_member_class_id uuid, p_decisao text, p_observacao text default null, p_requisitos_para_corrigir uuid[] default '{}'::uuid[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record; v_ir record; v_papel text; v_id uuid; v_n int := 0;
  v_run record; v_result jsonb; v_status_final text;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial(v_mc.class_id) then raise exception 'Classe do membro não encontrada neste clube.'; end if;
  if v_mc.status <> 'aguardando_revisao' then raise exception 'Esta matrícula não está aguardando revisão final (status: %).', v_mc.status; end if;
  select * into v_ir from public.investiture_reviews where member_class_id = v_mc.id and status = 'pendente' for update;
  if not found then raise exception 'Revisão final pendente não encontrada.'; end if;
  select r.* into v_run from public.investiture_workflow_runs r where r.snapshot_id = v_ir.snapshot_id and r.status = 'em_andamento';
  if not found then raise exception 'Workflow de investidura não encontrado para esta revisão.'; end if;

  -- fase 4.2: a etapa "revisao_clube" precisa ser a atual — se um workflow com etapa intermediária
  -- (ex.: revisão distrital) ainda estiver pendente à frente desta, o motor recusa (não pula etapa).
  v_result := public._workflow_registrar_decisao(v_run.id, p_decisao, p_observacao, 'revisao_clube');
  v_papel := coalesce(v_result ->> 'papel_utilizado', public.papel_no_clube(v_uid, v_club), '?');

  if p_decisao = 'aprovado' then
    -- 'apto_investidura' só quando a PRÓXIMA etapa é a investidura (workflow padrão: sempre, hoje —
    -- generaliza corretamente se um dia houver etapa intermediária entre revisão e investidura).
    v_status_final := case when (v_result ->> 'proxima_etapa') = 'investidura' then 'apto_investidura' else v_mc.status end;
    update public.investiture_reviews set status = 'aprovado', revisado_por = v_uid, revisado_em = now(), revisado_papel = v_papel, comentario = p_observacao where id = v_ir.id;
    update public.member_classes set status = v_status_final, updated_at = now() where id = v_mc.id;
    perform public._classe_evento(v_mc.id, 'revisao_aprovada', v_ir.snapshot_id, p_observacao, jsonb_build_object('review_id', v_ir.id, 'proxima_etapa', v_result ->> 'proxima_etapa'));
    return jsonb_build_object('ok', true, 'status', v_status_final);
  end if;

  if coalesce(array_length(p_requisitos_para_corrigir, 1), 0) = 0 then raise exception 'Indique ao menos um requisito a corrigir.'; end if;
  if coalesce(trim(p_observacao), '') = '' then raise exception 'Explique o que precisa ser corrigido.'; end if;
  foreach v_id in array p_requisitos_para_corrigir loop
    if not exists (select 1 from public.member_requirements where id = v_id and member_class_id = v_mc.id) then raise exception 'Requisito % não é desta matrícula.', v_id; end if;
    update public.member_requirements set status = 'correcao_solicitada', updated_at = now() where id = v_id;
    -- a avaliação da revisão final registra o que foi avaliado (o conteúdo fixado no envio/aprovação),
    -- como requisito_avaliar faz desde a 84: é a trilha de auditoria de "o que a criança tinha feito"
    insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario, conteudo_avaliado)
    select mr.id, mr.requirement_id, c.curriculum_version_id, v_club, 'correcao_solicitada', v_uid, v_papel, 'Revisão final: ' || p_observacao, mr.conteudo_fixado
      from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
     where mr.id = v_id;
    v_n := v_n + 1;
  end loop;
  update public.investiture_reviews set status = 'correcao_solicitada', revisado_por = v_uid, revisado_em = now(), revisado_papel = v_papel, comentario = p_observacao where id = v_ir.id;
  update public.member_classes set status = 'em_andamento', concluida_em = null, updated_at = now() where id = v_mc.id;
  perform public._classe_evento(v_mc.id, 'revisao_correcao', v_ir.snapshot_id, p_observacao, jsonb_build_object('review_id', v_ir.id, 'requisitos', to_jsonb(p_requisitos_para_corrigir)));
  return jsonb_build_object('ok', true, 'status', 'em_andamento', 'requisitos_reabertos', v_n);
end;
$$;

create or replace function public.investidura_registrar(p_member_class_id uuid, p_data date default current_date, p_observacao text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record; v_ir record; v_snap record; v_pend int; v_bloq jsonb; v_inv uuid; v_papel text;
  v_run record; v_result jsonb;
begin
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial(v_mc.class_id) then raise exception 'Classe do membro não encontrada neste clube.'; end if;
  if v_mc.status = 'investida' or exists (select 1 from public.class_investitures where member_class_id = v_mc.id and status = 'registrada') then
    raise exception 'Investidura já registrada para esta matrícula.';
  end if;
  if v_mc.status <> 'apto_investidura' then raise exception 'Investidura não permitida: a revisão final ainda não foi aprovada (status: %).', v_mc.status; end if;
  select * into v_ir from public.investiture_reviews where member_class_id = v_mc.id and status = 'aprovado' order by revisado_em desc limit 1;
  if not found then raise exception 'Investidura não permitida: revisão final aprovada não encontrada.'; end if;
  select * into v_snap from public.class_completion_snapshots where id = v_ir.snapshot_id and status = 'selado';
  if not found then raise exception 'Investidura não permitida: o snapshot da conclusão não está selado.'; end if;
  if p_data is null or p_data > current_date then raise exception 'Data de investidura inválida.'; end if;
  select r.* into v_run from public.investiture_workflow_runs r where r.snapshot_id = v_snap.id and r.status = 'em_andamento' for update;
  if not found then raise exception 'Investidura não permitida: workflow desta conclusão não está em andamento (etapas obrigatórias pendentes ou já concluído/cancelado).'; end if;

  -- reconfere AGORA: requisito pendente, bloqueado, dinâmico sem valor, N-de-M incompleto — nada passa
  select count(*) into v_pend from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo where mr.member_class_id = v_mc.id and mr.status <> 'aprovado';
  select coalesce(jsonb_agg(jsonb_build_object('codigo', r.codigo, 'bloqueios', to_jsonb(b))), '[]'::jsonb) into v_bloq
    from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
    cross join lateral public._requisito_bloqueios(mr.id) b where mr.member_class_id = v_mc.id and array_length(b, 1) > 0;
  if v_pend > 0 then raise exception 'Investidura não permitida: % requisito(s) não aprovado(s).', v_pend; end if;
  if jsonb_array_length(v_bloq) > 0 then raise exception 'Investidura não permitida: requisito bloqueado — %', v_bloq::text; end if;

  -- fase 4.2: etapa "investidura" precisa ser a atual (segrega e resolve autoridade pelo motor); só
  -- então grava o evento LEGADO de investidura (class_investitures) com o papel realmente usado.
  v_result := public._workflow_registrar_decisao(v_run.id, 'aprovado', p_observacao, 'investidura');
  v_papel := coalesce(v_result ->> 'papel_utilizado', public.papel_no_clube(v_uid, v_club), '?');

  insert into public.class_investitures (member_class_id, snapshot_id, usuario_id, club_id, registrado_por, registrado_papel, data_investidura, observacao)
  values (v_mc.id, v_snap.id, v_mc.usuario_id, v_club, v_uid, v_papel, p_data, p_observacao) returning id into v_inv;
  update public.investiture_reviews set status = 'investido' where id = v_ir.id;
  update public.member_classes set status = 'investida', investida_em = p_data::timestamptz, updated_at = now() where id = v_mc.id;  -- gatilho emite a conquista
  update public.curriculum_achievements set snapshot_id = v_snap.id where member_class_id = v_mc.id and tipo = 'classe' and status = 'ativa' and snapshot_id is null;
  perform public._classe_evento(v_mc.id, 'investidura_registrada', v_snap.id, p_observacao, jsonb_build_object('investidura_id', v_inv, 'data', p_data));
  return jsonb_build_object('ok', true, 'status', 'investida', 'investidura_id', v_inv, 'snapshot_id', v_snap.id,
    'conquista_id', (select id from public.curriculum_achievements where member_class_id = v_mc.id and tipo = 'classe' and status = 'ativa'));
end;
$$;

create or replace function public.documento_emitir(p_member_class_id uuid, p_tipo text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record; v_snap record; v_tpl record;
        v_tipo text; v_token text; v_conf text; v_id uuid; v_ja boolean;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club;
  if not found or not public._classe_do_catalogo_oficial(v_mc.class_id) then raise exception 'Classe do membro não encontrada neste clube.'; end if;
  -- dono (vínculo ativo) OU liderança do clube em uso
  if not ((v_mc.usuario_id = v_uid and public.membro_ativo_no_clube(v_club)) or public.pode_gerir_no_clube(v_club)) then
    raise exception 'Sem permissão para emitir este documento.';
  end if;
  perform public._exigir_classes_habilitado(v_club);

  select * into v_snap from public.class_completion_snapshots where member_class_id = v_mc.id and status = 'selado' order by versao desc limit 1;
  if not found then raise exception 'Ainda não há uma conclusão selada para emitir o documento.'; end if;

  -- tipo: 'final' só com investidura registrada; senão 'acompanhamento'. p_tipo pode forçar, respeitando a regra.
  v_tipo := coalesce(p_tipo, case when v_mc.status = 'investida' then 'final' else 'acompanhamento' end);
  if v_tipo not in ('acompanhamento', 'final') then raise exception 'Tipo de documento inválido.'; end if;
  if v_tipo = 'final' and not (v_mc.status = 'investida' and exists (
      select 1 from public.class_investitures i where i.member_class_id = v_mc.id and i.snapshot_id = v_snap.id and i.status = 'registrada')) then
    raise exception 'O documento final só pode ser emitido após a investidura registrada.';
  end if;

  select * into v_tpl from public.document_templates where chave = 'caderno-desbravaclube' and ativo order by versao desc limit 1;
  if not found then raise exception 'Template do documento não encontrado.'; end if;

  select * into v_id from public.class_documents where snapshot_id = v_snap.id and tipo = v_tipo and template_id = v_tpl.id;
  if found then
    select id into v_id from public.class_documents where snapshot_id = v_snap.id and tipo = v_tipo and template_id = v_tpl.id;
    v_ja := true;
  else
    v_token := public._documento_token();
    -- conferência: determinística do (hash do snapshot + token + versão do template) → 8 hex maiúsculos.
    -- token é estável por emissão (idempotente) ⇒ conferência estável ⇒ regeneração determinística.
    v_conf := upper(substr(encode(extensions.digest(v_snap.hash || ':' || v_token || ':' || v_tpl.versao::text, 'sha256'), 'hex'), 1, 8));
    insert into public.class_documents (snapshot_id, member_class_id, usuario_id, club_id_origem, tipo, template_id, token_publico, conferencia, emitido_por)
    values (v_snap.id, v_mc.id, v_mc.usuario_id, v_mc.club_id, v_tipo, v_tpl.id, v_token, v_conf, v_uid)
    returning id into v_id;
    v_ja := false;
  end if;

  return (select jsonb_build_object('ok', true, 'ja_existia', v_ja, 'token', d.token_publico, 'tipo', d.tipo, 'conferencia', d.conferencia,
            'template', jsonb_build_object('chave', v_tpl.chave, 'versao', v_tpl.versao), 'emitido_em', d.emitido_em)
          from public.class_documents d where d.id = v_id);
end;
$$;

create or replace function public.workflow_etapa_intermediaria_decidir(p_member_class_id uuid, p_decisao text, p_observacao text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_mc record; v_run record; v_stage record; v_result jsonb;
begin
  if p_decisao not in ('aprovado', 'reprovado') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into v_mc from public.member_classes where id = p_member_class_id;
  if not found or not public._classe_do_catalogo_oficial(v_mc.class_id) then raise exception 'Classe do membro não encontrada.'; end if;
  perform public._exigir_classes_habilitado(v_mc.club_id);
  select r.* into v_run from public.investiture_workflow_runs r
   join public.class_completion_snapshots s on s.id = r.snapshot_id
   where r.member_class_id = v_mc.id and r.status = 'em_andamento' order by r.created_at desc limit 1 for update;
  if not found then raise exception 'Não há workflow de investidura em andamento para esta matrícula.'; end if;
  select * into v_stage from public.investiture_workflow_stages where workflow_id = v_run.workflow_id and ordem = v_run.current_stage_ordem;
  if not found or v_stage.chave <> 'aprovacao_intermediaria' then
    raise exception 'A etapa atual (%) não é uma etapa intermediária — use a RPC correspondente.', coalesce(v_stage.chave, '(nenhuma)');
  end if;

  v_result := public._workflow_registrar_decisao(v_run.id, p_decisao, p_observacao, null);
  if p_decisao = 'aprovado' and (v_result ->> 'proxima_etapa') = 'investidura' then
    update public.member_classes set status = 'apto_investidura', updated_at = now() where id = v_mc.id;
  elsif p_decisao = 'reprovado' then
    update public.member_classes set status = 'em_andamento', concluida_em = null, updated_at = now() where id = v_mc.id;
    perform public._classe_evento(v_mc.id, 'revisao_correcao', v_run.snapshot_id, p_observacao, jsonb_build_object('etapa', v_stage.chave, 'decisao', 'reprovado'));
  end if;
  return v_result;
end;
$$;


-- =============================================================================
--  C3 + C4. A publicação do conteúdo anual confere o que recebe
-- =============================================================================
-- A serialização canônica do gerador (canonico() de gerar-importacao.mjs), refeita no banco: objeto
-- com as chaves em ordem (JS `sort()` = ordem de código; as chaves do formato são ASCII, então é a
-- ordem de bytes, collate "C"), sem espaços; array na ordem; escalar como JSON.stringify — que, para
-- texto, escapa exatamente o que a saída de jsonb escapa (aspas, barra invertida, \b \f \n \r \t e os
-- demais controles como \u00xx) e deixa acento e símbolo como estão. O teste 64 confere contra o
-- hash que o gerador JS gravou no pacote real das Classes Regulares (com acentos, travessões etc.).
create or replace function public._json_canonico(p jsonb)
returns text
language plpgsql immutable strict set search_path = '' as $$
begin
  return case jsonb_typeof(p)
    when 'object' then '{' || coalesce((
        select string_agg(to_json(e.key)::text || ':' || public._json_canonico(e.value), ',' order by e.key collate "C")
          from jsonb_each(p) e), '') || '}'
    when 'array' then '[' || coalesce((
        select string_agg(public._json_canonico(x.v), ',' order by x.n)
          from jsonb_array_elements(p) with ordinality x(v, n)), '') || ']'
    else p::text
  end;
end;
$$;
revoke all on function public._json_canonico(jsonb) from public, anon, authenticated;

-- Igual à 84, mais três conferências (C4) e a cobertura só por manifesto (C3).
create or replace function public.conteudo_anual_publicar(p_pacote jsonb, p_hash text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ano int; v_arquivo text; v_item jsonb; v_def_id uuid; v_chave text; v_desde date; v_ate date;
  v_valor text; v_url text; v_desc text; v_novos int := 0; v_ja int := 0; v_lacunas text; v_existente record;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Publicação: hash sha256 inválido.'; end if;
  if p_pacote is null or jsonb_typeof(p_pacote) <> 'object' then raise exception 'Publicação: pacote inválido.'; end if;
  -- C4 (1): o hash é o DESTE pacote. Antes, qualquer sha256 bem formado entrava como fonte_hash — um
  -- SQL de publicação editado à mão (valor trocado, hash antigo mantido) gravava um "manifesto" que
  -- não existe, e o no-op abaixo passava a confiar nele.
  if encode(extensions.digest(public._json_canonico(p_pacote), 'sha256'), 'hex') <> p_hash then
    raise exception 'Publicação: o hash não confere com o pacote (o sha256 do pacote canônico é outro). O SQL foi editado à mão ou montado fora do gerador — regere com npm run curriculo:conteudo-anual:gerar. Nada foi publicado.';
  end if;
  perform public._curriculo_exigir_chaves(p_pacote, array['formato', 'ano', 'arquivo', 'itens'], 'o pacote');
  if p_pacote ->> 'formato' is distinct from 'conquista.conteudo_anual/1' then
    raise exception 'Publicação: formato desconhecido (esperado conquista.conteudo_anual/1).';
  end if;
  if jsonb_typeof(p_pacote -> 'ano') is distinct from 'number' or (p_pacote ->> 'ano') !~ '^2[0-9]{3}$' then
    raise exception 'Publicação: "ano" precisa ser o ano civil, com 4 dígitos.';
  end if;
  v_ano := (p_pacote ->> 'ano')::int;
  v_arquivo := nullif(btrim(coalesce(p_pacote ->> 'arquivo', '')), '');
  if v_arquivo is null then raise exception 'Publicação: "arquivo" (o manifesto de origem) é obrigatório.'; end if;
  -- C4 (2): o manifesto de um ano é conteudo-anual/<ano>.json (o validador exige esse nome, e o
  -- exemplo.json nunca é publicado). Um pacote de 2029 que diz vir de "1999.json" não é de manifesto.
  if v_arquivo is distinct from 'supabase/curriculo-manifesto/conteudo-anual/' || v_ano || '.json' then
    raise exception 'Publicação: "arquivo" (%) não é o manifesto de % (esperado supabase/curriculo-manifesto/conteudo-anual/%.json). Nada foi publicado.', v_arquivo, v_ano, v_ano;
  end if;
  if jsonb_typeof(p_pacote -> 'itens') is distinct from 'array' or jsonb_array_length(p_pacote -> 'itens') = 0 then
    raise exception 'Publicação: nenhum item no pacote.';
  end if;

  for v_item in select x from jsonb_array_elements(p_pacote -> 'itens') x loop
    perform public._curriculo_exigir_chaves(v_item, array['chave', 'valor', 'vigente_desde', 'vigente_ate', 'fonte_url', 'fonte_descricao'], 'um item');
    v_chave := v_item ->> 'chave';
    select id into v_def_id from public.dynamic_content_definitions where chave = v_chave;
    if v_def_id is null then
      raise exception 'Publicação: a chave "%" não é um conteúdo dinâmico do catálogo.', coalesce(v_chave, '(vazia)');
    end if;
    if coalesce(v_item ->> 'vigente_desde', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(v_item ->> 'vigente_ate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Publicação: % precisa de vigência FECHADA (vigente_desde e vigente_ate, AAAA-MM-DD).', v_chave;
    end if;
    v_desde := (v_item ->> 'vigente_desde')::date;
    v_ate := (v_item ->> 'vigente_ate')::date;
    if extract(year from v_desde)::int <> v_ano or extract(year from v_ate)::int <> v_ano or v_ate < v_desde then
      raise exception 'Publicação: a vigência de % (% a %) precisa estar dentro de %.', v_chave, v_desde, v_ate, v_ano;
    end if;
    v_valor := btrim(coalesce(v_item ->> 'valor', ''));
    v_url := btrim(coalesce(v_item ->> 'fonte_url', ''));
    v_desc := btrim(coalesce(v_item ->> 'fonte_descricao', ''));
    if v_valor = '' then raise exception 'Publicação: % sem valor.', v_chave; end if;
    if v_url !~ '^https://[^[:space:]]+$' then raise exception 'Publicação: % sem fonte_url https (de onde veio o conteúdo).', v_chave; end if;
    if v_desc = '' then raise exception 'Publicação: % sem fonte_descricao.', v_chave; end if;

    -- publicado é publicado: o mesmo ano só volta a entrar pelo MESMO manifesto (no-op)
    if exists (select 1 from public.dynamic_content_values v
                where v.definicao_id = v_def_id and v.ano = v_ano and v.fonte_hash is distinct from p_hash) then
      raise exception 'Publicação: % já tem conteúdo de % publicado por outro manifesto (ou fora dele). Nada foi publicado — ver PUBLICACAO-CONTEUDO-ANUAL.md, "Corrigir um conteúdo já publicado".', v_chave, v_ano;
    end if;
    -- C4 (3): "já estava" só se estiver IGUAL — valor, vigência, fonte e arquivo. Com o mesmo hash, o
    -- pacote é o mesmo; se a linha no banco difere, ela foi mexida fora da publicação, e contar como
    -- no-op esconderia isso.
    select * into v_existente from public.dynamic_content_values v
     where v.definicao_id = v_def_id and v.ano = v_ano and v.fonte_hash = p_hash
       and v.vigente_desde = v_desde and v.vigente_ate = v_ate;
    if found then
      if v_existente.valor = v_valor and v_existente.fonte_url is not distinct from v_url
         and v_existente.fonte_descricao is not distinct from v_desc and v_existente.manifesto_arquivo is not distinct from v_arquivo then
        v_ja := v_ja + 1;
        continue;
      end if;
      raise exception 'Publicação: % de % já está publicado por este manifesto, mas o banco tem outro valor, fonte ou arquivo para % a % — a linha foi alterada fora da publicação. Nada foi publicado — ver PUBLICACAO-CONTEUDO-ANUAL.md.', v_chave, v_ano, v_desde, v_ate;
    end if;
    insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao, fonte_hash, manifesto_arquivo, publicado_em)
    values (v_def_id, v_ano, v_valor, v_desde, v_ate, v_url, v_desc, p_hash, v_arquivo, now());
    v_novos := v_novos + 1;
  end loop;

  -- sem lacuna: todo slot usado pelo catálogo OFICIAL publicado precisa cobrir o ano inteiro — e só
  -- com linhas publicadas POR MANIFESTO (C3). Uma linha avulsa (SQL direto, fonte_hash nulo) não
  -- tapa o buraco de um manifesto incompleto. (A sobreposição já é recusada pelo gatilho da tabela;
  -- então somar os dias basta.)
  select string_agg(d.chave, ', ' order by d.chave) into v_lacunas
    from public.dynamic_content_definitions d
   where exists (select 1 from public.class_requirements r
                   join public.class_sections s on s.id = r.section_id
                   join public.classes c on c.id = s.class_id
                   join public.curriculum_versions ver on ver.id = c.curriculum_version_id
                  where r.conteudo_dinamico_definicao_id = d.id and r.ativo and c.ativo
                    and ver.status = 'publicado' and ver.origem = 'oficial')
     and coalesce((select sum(v.vigente_ate - v.vigente_desde + 1) from public.dynamic_content_values v
                    where v.definicao_id = d.id and v.ano = v_ano and v.fonte_hash is not null), 0)
         <> (make_date(v_ano, 12, 31) - make_date(v_ano, 1, 1) + 1);
  if v_lacunas is not null then
    raise exception 'Publicação de %: o ano não fica coberto de 01/01 a 31/12 (por manifesto) para: %. Nada foi publicado.', v_ano, v_lacunas;
  end if;

  return jsonb_build_object('ok', true, 'ano', v_ano, 'publicados', v_novos, 'ja_estavam', v_ja, 'fonte_hash', p_hash, 'arquivo', v_arquivo);
end;
$$;
revoke all on function public.conteudo_anual_publicar(jsonb, text) from public, anon, authenticated;


-- =============================================================================
--  C5. Especialidades só ligam pela RPC auditada da plataforma
-- =============================================================================
-- O gatilho da 83 liberava QUALQUER porta para um administrador da plataforma — inclusive o
-- onboarding (SECURITY DEFINER), que não confere catálogo oficial nem audita. Agora: sessão sem
-- usuário (SQL Editor, service_role, cron) passa; administrador passa SÓ por dentro de
-- `admin_recurso_do_clube_definir`, que marca a transação. As duas condições juntas: a marca sozinha
-- não vale para quem não é admin, e o admin sem a marca é tratado como a liderança de um clube.
create or replace function public._proteger_recurso_da_plataforma()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_nome text;
begin
  if v_uid is null then
    return new;
  end if;
  if coalesce(current_setting('conquista.recurso_pela_plataforma', true), '') = 'sim' and public.eh_admin_plataforma(v_uid) then
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
  -- a marca que o gatilho de club_features reconhece; vale só para ESTA gravação
  perform set_config('conquista.recurso_pela_plataforma', 'sim', true);
  insert into public.club_features (club_id, feature, enabled) values (p_club_id, p_feature, p_enabled)
  on conflict (club_id, feature) do update set enabled = excluded.enabled, updated_at = now();
  perform set_config('conquista.recurso_pela_plataforma', '', true);
  perform public._auditar('recurso_alterado_pela_plataforma', p_club_id, null, jsonb_build_object('recurso', p_feature, 'ligado', p_enabled));
  return public.recursos_do_clube(p_club_id);
end;
$$;
revoke all on function public.admin_recurso_do_clube_definir(uuid, text, boolean) from public, anon;
grant execute on function public.admin_recurso_do_clube_definir(uuid, text, boolean) to authenticated;


-- =============================================================================
--  C8. O dia de referência do conteúdo anual é o do CLUBE
-- =============================================================================
-- O fuso do clube (organizational_units.timezone); sem clube ou sem fuso, America/Sao_Paulo (o
-- padrão da 84). Interna: quem chama já sabe de que clube é o requisito.
create or replace function public._data_do_clube(p_club uuid, p_instante timestamptz default now())
returns date
language sql stable security definer set search_path = '' as $$
  select (p_instante at time zone coalesce(
            (select nullif(btrim(u.timezone), '') from public.organizational_units u where u.id = p_club),
            'America/Sao_Paulo'))::date;
$$;
revoke all on function public._data_do_clube(uuid, timestamptz) from public, anon, authenticated;

-- O fuso passa a ser validado na ESCRITA: um texto qualquer ali faria o `at time zone` acima (e o
-- de qualquer outra leitura do clube) quebrar. Nome IANA (Região/Cidade) que o PostgreSQL reconhece.
create or replace function public._validar_fuso()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.timezone is null or new.timezone !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$' then
    raise exception 'Fuso horário inválido: "%". Use um fuso IANA, como America/Sao_Paulo, America/Manaus ou America/Rio_Branco.', coalesce(new.timezone, '(vazio)');
  end if;
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'Fuso horário inválido: "%". Use um fuso IANA, como America/Sao_Paulo, America/Manaus ou America/Rio_Branco.', new.timezone;
  end;
  return new;
end;
$$;
revoke all on function public._validar_fuso() from public, anon, authenticated;

-- o que já estiver gravado fora do padrão vira o padrão (em produção todos são America/Recife) —
-- antes do gatilho, para ele nunca recusar a própria limpeza
do $m$
declare v_n int; v_m int;
begin
  update public.organizational_units u set timezone = 'America/Sao_Paulo'
   where u.timezone !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'
      or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = u.timezone);
  get diagnostics v_n = row_count;
  update public.billing_accounts b set timezone = 'America/Sao_Paulo'
   where b.timezone !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'
      or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = b.timezone);
  get diagnostics v_m = row_count;
  if v_n + v_m > 0 then
    raise notice '[86] fuso inválido trocado por America/Sao_Paulo: % unidade(s), % conta(s) comercial(is)', v_n, v_m;
  end if;
end $m$;

drop trigger if exists trg_validar_fuso on public.organizational_units;
create trigger trg_validar_fuso before insert or update of timezone on public.organizational_units
for each row execute function public._validar_fuso();
drop trigger if exists trg_validar_fuso on public.billing_accounts;
create trigger trg_validar_fuso before insert or update of timezone on public.billing_accounts
for each row execute function public._validar_fuso();

-- os três pontos que escolhiam "o conteúdo de hoje": agora hoje é o dia NO CLUBE do requisito
create or replace function public._conteudo_do_requisito(p_member_requirement_id uuid, p_chave text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select mr.conteudo_fixado from public.member_requirements mr where mr.id = p_member_requirement_id),
    public.conteudo_dinamico_resolver(p_chave, public._data_do_clube(
      (select mr.club_id from public.member_requirements mr where mr.id = p_member_requirement_id))));
$$;
revoke all on function public._conteudo_do_requisito(uuid, text) from public, anon, authenticated;

create or replace function public._fixar_conteudo_do_requisito(p_member_requirement_id uuid, p_momento text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_mr record; v_chave text; v_cont jsonb;
begin
  select * into v_mr from public.member_requirements where id = p_member_requirement_id;
  if not found or v_mr.conteudo_fixado is not null then return; end if;
  select d.chave into v_chave
    from public.class_requirements r join public.dynamic_content_definitions d on d.id = r.conteudo_dinamico_definicao_id
   where r.id = v_mr.requirement_id;
  if v_chave is null then return; end if;
  v_cont := public.conteudo_dinamico_resolver(v_chave, public._data_do_clube(v_mr.club_id));
  if v_cont ->> 'valor' is null then return; end if;
  update public.member_requirements
     set conteudo_fixado = v_cont || jsonb_build_object('fixado_em', now(), 'fixado_no', p_momento)
   where id = v_mr.id;
end;
$$;
revoke all on function public._fixar_conteudo_do_requisito(uuid, text) from public, anon, authenticated;

create or replace function public._requisito_bloqueios(p_member_requirement_id uuid)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_mr record; v_req record; v_out text[] := '{}'; v_dep text[]; v_cont jsonb; v_nome text; v_esc jsonb;
begin
  select * into v_mr from public.member_requirements where id = p_member_requirement_id;
  if not found then return v_out; end if;
  select * into v_req from public.class_requirements where id = v_mr.requirement_id;

  v_dep := public.dependencias_pendentes('class_requirement', v_mr.requirement_id, v_mr.usuario_id, v_mr.club_id);
  if coalesce(array_length(v_dep, 1), 0) > 0 then
    v_out := array_append(v_out, 'Falta concluir antes: ' || array_to_string(v_dep, ', ') || '.');
  end if;

  -- conteúdo anual: o FIXADO no envio/aprovação vale para sempre; sem ele, o do ano de hoje NO
  -- CLUBE do requisito. Nunca o de outro ano.
  if v_req.conteudo_dinamico_definicao_id is not null then
    select public._conteudo_do_requisito(v_mr.id, d.chave), d.nome into v_cont, v_nome
      from public.dynamic_content_definitions d where d.id = v_req.conteudo_dinamico_definicao_id;
    if v_cont is null or v_cont ->> 'valor' is null then
      v_out := array_append(v_out, 'O conteúdo oficial de '
        || coalesce(v_cont ->> 'ano_referencia', extract(year from public._data_do_clube(v_mr.club_id))::text)
        || ' (' || coalesce(v_nome, 'conteúdo do ano') || ') ainda não está disponível.');
    end if;
  end if;

  v_esc := public._requisito_escolha_estado(p_member_requirement_id);
  if v_esc is not null then
    if jsonb_array_length(v_esc -> 'violacoes_sem_repeticao') > 0 then
      v_out := array_append(v_out, 'Não vale repetir especialidade já realizada antes desta classe: '
        || (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(v_esc -> 'violacoes_sem_repeticao') x) || '.');
    end if;
    if not (v_esc ->> 'satisfeito')::boolean then
      v_out := array_append(v_out, format('Escolha pelo menos %s %s (%s de %s até agora).',
        v_esc ->> 'n_minimo',
        case when (v_esc ->> 'total_opcoes')::int > 0 then 'das ' || (v_esc ->> 'total_opcoes') || ' opções' else 'e informe qual foi' end,
        v_esc ->> 'validas', v_esc ->> 'n_minimo'));
    end if;
  end if;
  return v_out;
end;
$$;

notify pgrst, 'reload schema';
