-- =============================================================================
--  Fase 9.1 — três defeitos de CÓDIGO que a auditoria do pré-voo achou.
--
--    1. `excluir_usuario` morria numa foreign key quando a pessoa já tinha agido no motor
--       curricular (avaliou, revisou, revogou, abriu turma...).
--    2. O job pg_cron 'reconciliar-armazenamento' falhava TODA semana: a função que ele chama
--       começa pelo portão de administrador da plataforma, e no cron não existe sessão.
--    3. `confirmar_lance_conjunto` "devolvia" ao saldo o valor CHEIO do lance ativo, uma vez por
--       unidade, quando desde a 60 a reserva de cada unidade é a PARCELA dela no rateio.
--
--  Aplicada pelo SQL Editor numa transação só, como postgres. Pode rodar de novo.
--
-- -----------------------------------------------------------------------------
--  1. excluir_usuario × histórico curricular — e a decisão de trilha de auditoria
-- -----------------------------------------------------------------------------
--  O que estava errado. Sete FKs para profiles(id) nasceram SEM on delete (NO ACTION):
--
--      requirement_approvals.avaliado_por (NOT NULL)      investiture_reviews.revisado_por
--      curriculum_achievements.revogada_por                curriculum_versions.criado_por
--      curriculum_versions.importado_por                   specialty_offerings.criado_por
--      specialty_offerings.instrutor_responsavel_id
--
--  (nenhuma outra FK para profiles ou auth.users, em public, está sem on delete — conferido no
--  catálogo do banco replayado). `excluir_usuario` só "soltava" as referências das tabelas antigas
--  (atividades, entregas, pontos...). Bastava o líder ter aprovado UM requisito para a exclusão
--  morrer com "violates foreign key constraint requirement_approvals_avaliado_por_fkey" — um erro
--  que a diretoria não entende. E havia uma segunda armadilha da mesma família: nas tabelas
--  imutáveis do selo e da investidura (44), `gerado_por` e `registrado_por` são ON DELETE SET NULL,
--  mas `_proteger_registro_imutavel` só tolera esse SET NULL em coluna "*_id" — então excluir quem
--  selou ou registrou uma investidura morria com "class_completion_snapshots é imutável".
--
--  A escolha, pelo critério de trilha de auditoria:
--
--    · Quem AVALIOU, REVISOU, REVOGOU, SELOU, REGISTROU, EMITIU, DECIDIU ou ASSINOU algo no percurso
--      curricular de OUTRA pessoa faz parte do registro: o "quem aprovou" é o que dá valor a uma
--      aprovação e a uma investidura. Excluir essa pessoa ou tiraria o nome do registro (SET NULL)
--      ou apagaria o registro (CASCADE) — as duas coisas destroem a trilha. Então `excluir_usuario`
--      passa a RECUSAR a exclusão definitiva dessa pessoa, com mensagem clara, mandando desativar o
--      vínculo — o botão "Desativar" que a tela já tem, e o que a 02 já recomendava para o dia a dia
--      (excluir de vez era "só pra cadastro duplicado/de teste").
--    · As três colunas de auditoria (avaliado_por, revisado_por, revogada_por) CONTINUAM sem on
--      delete, de propósito: é o banco que garante a trilha também fora da RPC (ex.: alguém apagar
--      o login em Authentication > Users). Cada constraint ganha um comentário dizendo isso, para
--      ninguém "consertar" com um SET NULL no futuro.
--    · Colunas que só dizem quem CRIOU, IMPORTOU ou é RESPONSÁVEL por algo que continua existindo
--      por si passam a ON DELETE SET NULL, como já são atividades.criado_por, pontos.lancado_por
--      etc.: curriculum_versions.criado_por / importado_por (catálogo da plataforma) e
--      specialty_offerings.criado_por / instrutor_responsavel_id (a turma continua, sem o nome).
--      Não são avaliação de ninguém.
--    · Quem é só o SUJEITO do histórico (o desbravador que fez a classe) continua podendo ser
--      excluído como antes: foi desenho da 44 (os registros imutáveis ficam anonimizados pelo SET
--      NULL em "*_id"; o progresso da própria pessoa vai em cascata). Esta migration não muda isso.
--      Pelo mesmo motivo, emitir/decidir/assinar/agir sobre o PRÓPRIO percurso não conta como
--      histórico de auditor.
--    · Com vínculo em outro clube, excluir continua tirando só o vínculo deste clube: o perfil
--      fica, a trilha fica — não há o que recusar.
--
-- -----------------------------------------------------------------------------
--  2. O job 'reconciliar-armazenamento' (54)
-- -----------------------------------------------------------------------------
--  A 54 agendou `select public.storage_reconciliar(null, true)`, e a função começa com
--  `_exigir_admin_plataforma()`, que exige o auth.uid() de um administrador. No pg_cron não há
--  sessão: auth.uid() é nulo, o job falhava toda semana com "Sem permissão" e a deriva do
--  armazenamento nunca era corrigida. Agora:
--    · `_storage_reconciliar_interno(clube, aplicar)` faz o trabalho, SEM portão e SEM EXECUTE para
--      anon/authenticated — só o dono (quem roda o cron) e a RPC abaixo alcançam;
--    · `storage_reconciliar` continua sendo a RPC do administrador: portão + chamada à interna;
--    · o job (mesmo nome, mesmo horário) passa a chamar a interna.
--  De carona: a tabela temporária da reconciliação é recriada a cada chamada. Antes, chamar duas
--  vezes na mesma transação quebrava com "relation _recon already exists".
--
-- -----------------------------------------------------------------------------
--  3. confirmar_lance_conjunto e a parcela do rateio (60, 78)
-- -----------------------------------------------------------------------------
--  Desde a 60, a reserva de uma unidade num lance ativo é a PARCELA dela (`_leilao_rateio`), não o
--  valor inteiro. A confirmação do lance conjunto (última versão na 78) ainda somava ao saldo das
--  unidades, para o lance ativo que vai ser superado no MESMO item, `sum(l.valor)` — o valor cheio,
--  uma vez por linha de unidade. Exemplo (coberto no teste 53, seção 11): A1 (300) e A2 (200) têm
--  um lance conjunto ativo de 400 (reservas 240 + 160, saldos 60 + 40). As duas propõem 600 no mesmo
--  item: a conta antiga via 60 + 40 + 400 + 400 = 900 disponíveis e ATIVAVA um lance de 600 para
--  quem só tem 500 juntas.
--
--  A correção não soma a parcela por cima do saldo já com piso de zero: o disponível de cada unidade
--  passa a ser calculado SEM a reserva deste item — pontos menos a reserva dos OUTROS itens, e só
--  então o piso de zero. Somar a parcela ao saldo já "pisado" daria a mais quando a unidade está no
--  zero por reservas de outros itens (seção 11 do teste 53, caso do piso). E para reserva e
--  confirmação não voltarem a divergir, a conta da reserva sai de dentro de `leilao_saldo_unidade`
--  para `_leilao_reserva_unidade(unidade, exceto_item)`, que as duas chamam — a lição da 60: duas
--  contas "equivalentes" divergem no primeiro ajuste que alguém fizer numa delas.
--  (`dar_lance` tem um "já reservado aqui" com `sum(l.valor)`, mas ele é código morto: um lance solo
--  de quem já está na frente do item é recusado antes, então aquela soma é sempre 0. Não mexemos.)
-- =============================================================================


-- =============================================================================
--  1a. Colunas "quem criou / quem é responsável": ON DELETE SET NULL
-- =============================================================================
-- Procura a FK pela COLUNA (não pelo nome), para não deixar uma FK antiga NO ACTION ao lado da nova
-- se o nome em algum banco for diferente do gerado automaticamente.
do $m$
declare r record; v_con text;
begin
  for r in select * from (values
      ('curriculum_versions', 'criado_por'), ('curriculum_versions', 'importado_por'),
      ('specialty_offerings', 'criado_por'), ('specialty_offerings', 'instrutor_responsavel_id')
    ) v(tabela, coluna)
  loop
    for v_con in
      select c.conname from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.conrelid = ('public.' || r.tabela)::regclass
         and c.confrelid = 'public.profiles'::regclass and array_length(c.conkey, 1) = 1
         and a.attname = r.coluna
    loop
      execute format('alter table public.%I drop constraint %I', r.tabela, v_con);
    end loop;
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on delete set null',
                   r.tabela, r.tabela || '_' || r.coluna || '_fkey', r.coluna);
  end loop;
end $m$;


-- =============================================================================
--  1b. Colunas da trilha de auditoria: continuam SEM on delete, e dizem por quê
-- =============================================================================
do $m$
declare r record; v_con text;
begin
  for r in select * from (values
      ('requirement_approvals', 'avaliado_por', 'quem avaliou o requisito'),
      ('investiture_reviews', 'revisado_por', 'quem revisou a investidura'),
      ('curriculum_achievements', 'revogada_por', 'quem revogou a conquista')
    ) v(tabela, coluna, papel)
  loop
    for v_con in
      select c.conname from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.conrelid = ('public.' || r.tabela)::regclass
         and c.confrelid = 'public.profiles'::regclass and array_length(c.conkey, 1) = 1
         and a.attname = r.coluna
    loop
      execute format('comment on constraint %I on public.%I is %L', v_con, r.tabela,
        'SEM on delete DE PROPÓSITO (migration 85): ' || r.papel || ' é trilha de auditoria e precisa '
        || 'continuar registrado. excluir_usuario recusa antes, com mensagem clara; desative o vínculo '
        || 'em vez de excluir. Não troque por SET NULL/CASCADE.');
    end loop;
  end loop;
end $m$;


-- =============================================================================
--  1c. excluir_usuario: recusa clara quando a pessoa é parte da trilha curricular
-- =============================================================================
-- Igual à 34 em tudo o mais: o portão (diretoria do clube em uso, e o alvo tem vínculo nele), o
-- "não exclui a si mesmo", o caminho de "só o vínculo" para quem tem outro clube, e a soltura das
-- referências antigas antes de apagar o perfil. A recusa entra só no caminho da exclusão DEFINITIVA,
-- depois do portão (quem não pode excluir não fica sabendo se a pessoa tem histórico).
create or replace function public.excluir_usuario(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_nome text;
  v_outros_clubes int;
begin
  if v_club is null or not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.organizational_unit_id = v_club and m.role = 'diretoria' and m.status = 'ativo'
  ) or not exists (
    select 1 from public.organization_memberships where user_id = p_id and organizational_unit_id = v_club
  ) then
    raise exception 'Só a diretoria do clube desta pessoa pode excluir usuários.';
  end if;

  if p_id = v_uid then
    raise exception 'Você não pode excluir a si mesmo.';
  end if;

  select nome into v_nome from public.profiles where id = p_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;

  select count(*) into v_outros_clubes
  from public.organization_memberships
  where user_id = p_id and organizational_unit_id <> v_club;

  if v_outros_clubes > 0 then
    delete from public.organization_memberships where user_id = p_id and organizational_unit_id = v_club;
    return json_build_object('ok', true, 'nome', v_nome, 'somente_vinculo', true);
  end if;

  -- Trilha de auditoria curricular: a pessoa agiu sobre o percurso de OUTRA pessoa.
  -- (as três primeiras são FKs sem on delete; as de selo/investidura são imutáveis — o gatilho
  -- recusaria o SET NULL de gerado_por/registrado_por; as demais seriam anonimizadas em silêncio)
  if exists (select 1 from public.requirement_approvals   where avaliado_por = p_id)
     or exists (select 1 from public.investiture_reviews  where revisado_por = p_id)
     or exists (select 1 from public.curriculum_achievements where revogada_por = p_id)
     or exists (select 1 from public.class_completion_snapshots where gerado_por = p_id or revogado_por = p_id)
     or exists (select 1 from public.class_investitures   where registrado_por = p_id or revogado_por = p_id)
     or exists (select 1 from public.class_documents      where emitido_por = p_id and usuario_id is distinct from p_id)
     or exists (select 1 from public.workflow_stage_decisions where decisor_id = p_id and usuario_id is distinct from p_id)
     or exists (select 1 from public.document_signatures  where signatario_id = p_id and usuario_id is distinct from p_id)
     or exists (select 1 from public.class_completion_events where ator_id = p_id and usuario_id is distinct from p_id)
  then
    raise exception 'Não dá para excluir %: esta pessoa tem histórico curricular/avaliações (avaliou, revisou ou registrou etapas de classes de outras pessoas), e esse histórico precisa continuar registrado. Desative o vínculo em vez de excluir.', coalesce(v_nome, 'esta pessoa')
      using hint = 'Use "Desativar" na lista de usuários: a pessoa perde o acesso ao clube e a trilha de auditoria fica intacta.';
  end if;

  update public.atividades   set criado_por     = null where criado_por     = p_id;
  update public.entregas     set avaliado_por   = null where avaliado_por   = p_id;
  update public.pontos       set lancado_por    = null where lancado_por    = p_id;
  update public.mensalidades set registrado_por = null where registrado_por = p_id;
  update public.notificacoes set criado_por     = null where criado_por     = p_id;
  update public.fotos        set autor_id       = null where autor_id       = p_id;
  delete from public.profiles where id = p_id;
  return json_build_object('ok', true, 'nome', v_nome, 'somente_vinculo', false);
end;
$$;
revoke all on function public.excluir_usuario(uuid) from public, anon;
grant execute on function public.excluir_usuario(uuid) to authenticated;


-- =============================================================================
--  2. Reconciliação do armazenamento: a interna (cron) e a RPC (admin)
-- =============================================================================
create or replace function public._storage_reconciliar_interno(p_club_id uuid default null, p_aplicar boolean default true)
returns table (club_id uuid, bytes_antes bigint, bytes_reais bigint, diferenca bigint,
               objetos_antes int, objetos_reais int)
language plpgsql security definer set search_path = ''
as $$
-- `club_id` é coluna e parâmetro de SAÍDA ao mesmo tempo (ver a 54): resolve pela COLUNA.
#variable_conflict use_column
begin
  -- Recriada a cada chamada: duas reconciliações na mesma transação não colidem mais.
  drop table if exists pg_temp._recon;

  -- A comparação é MATERIALIZADA antes de qualquer escrita (o "antes" é o que mostra a deriva).
  create temporary table _recon on commit drop as
  with reais as (
    select public._storage_clube_do_objeto(o.name, coalesce(o.owner_id, o.owner::text)) as cid,
           sum(coalesce((o.metadata->>'size')::bigint, 0))::bigint as bytes,
           count(*)::int as objetos
      from storage.objects o
     group by 1
  )
  select coalesce(r.cid, u.club_id) as cid,
         coalesce(u.bytes, 0)::bigint as antes, coalesce(r.bytes, 0)::bigint as reais,
         coalesce(u.objetos, 0) as obj_antes, coalesce(r.objetos, 0) as obj_reais
    from reais r
    full outer join public.club_storage_uso u on u.club_id = r.cid
   where coalesce(r.cid, u.club_id) is not null
     and (p_club_id is null or coalesce(r.cid, u.club_id) = p_club_id);

  if p_aplicar then
    insert into public.club_storage_uso (club_id, bytes, objetos, atualizado_em)
    select c.cid, c.reais, c.obj_reais, now() from _recon c
    on conflict (club_id) do update
      set bytes = excluded.bytes, objetos = excluded.objetos, atualizado_em = now();
  end if;

  return query
  select c.cid, c.antes, c.reais, c.reais - c.antes, c.obj_antes, c.obj_reais
    from _recon c order by abs(c.reais - c.antes) desc;
end $$;
-- Rotina interna: só o dono (quem roda o pg_cron) e a RPC abaixo, que é security definer.
revoke all on function public._storage_reconciliar_interno(uuid, boolean) from public, anon, authenticated;

create or replace function public.storage_reconciliar(p_club_id uuid default null, p_aplicar boolean default true)
returns table (club_id uuid, bytes_antes bigint, bytes_reais bigint, diferenca bigint,
               objetos_antes int, objetos_reais int)
language plpgsql security definer set search_path = ''
as $$
begin
  -- A RPC do app continua sendo só da operação da plataforma (não é botão de diretor de clube).
  perform public._exigir_admin_plataforma();
  return query select * from public._storage_reconciliar_interno(p_club_id, p_aplicar);
end $$;
revoke all on function public.storage_reconciliar(uuid, boolean) from public, anon;
grant execute on function public.storage_reconciliar(uuid, boolean) to authenticated;

-- O job (nome reservado pela 54; o pré-voo já o trata como do repo) passa a chamar a interna.
select cron.alter_job(j.jobid, command := 'select count(*) from public._storage_reconciliar_interno(null, true)')
  from cron.job j
 where j.jobname = 'reconciliar-armazenamento';
select cron.schedule('reconciliar-armazenamento', '20 4 * * 0',
  'select count(*) from public._storage_reconciliar_interno(null, true)')
 where not exists (select 1 from cron.job where jobname = 'reconciliar-armazenamento');


-- =============================================================================
--  3. Leilão: a reserva numa conta só, e a confirmação sem a reserva do próprio item
-- =============================================================================
-- Quanto uma unidade tem reservado em lances ATIVOS de leilões ABERTOS: a soma das PARCELAS dela
-- (`_leilao_rateio`), opcionalmente sem um item. Interna: lê a reserva de qualquer unidade.
create or replace function public._leilao_reserva_unidade(p_unidade_id uuid, p_exceto_item uuid default null)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(r.parcela), 0)::bigint
    from public.leilao_lances l
    join public.leilao_lance_unidades lu on lu.lance_id = l.id
    join public.leilao_itens it on it.id = l.item_id
    join public.leiloes le on le.id = it.leilao_id
    cross join lateral public._leilao_rateio(l.id) r
   where lu.unidade_id = p_unidade_id
     and r.unidade_id = p_unidade_id
     and l.status = 'ativo' and le.status = 'aberto'
     and (p_exceto_item is null or l.item_id <> p_exceto_item);
$$;
revoke all on function public._leilao_reserva_unidade(uuid, uuid) from public, anon, authenticated;

-- O saldo que o app mostra: exatamente o da 60 (mesmos gates, mesmo `case when` que não avalia o
-- ramo caro sem permissão, mesmo `least` que satura), só que a reserva vem da função acima.
create or replace function public.leilao_saldo_unidade(p_unidade_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case when exists (
      select 1 from public.unidades u
       where u.id = p_unidade_id
         and u.club_id = public.clube_atual_id()
         and public.membro_ativo_no_clube(u.club_id)
         and public.recurso_habilitado_no_clube(u.club_id, 'leilao')
    )
    then least(greatest(0,
           public.pontos_temporada_unidade(p_unidade_id)::bigint
           - public._leilao_reserva_unidade(p_unidade_id)), 2147483647)::int
    else 0 end;
$$;
revoke all on function public.leilao_saldo_unidade(uuid) from public, anon;
grant execute on function public.leilao_saldo_unidade(uuid) to authenticated, service_role;

-- confirmar_lance_conjunto: igual à 78, menos a conta do saldo coletivo.
create or replace function public.confirmar_lance_conjunto(p_lance_id uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_minha_unidade uuid;
  v_item_id uuid; v_valor int; v_leilao_id uuid;
  v_leilao_status text; v_fecha_em timestamptz;
  v_preco_base int; v_incremento int;
  v_status_atual text;
  v_maior_valor int;
  v_faltam int;
  v_disponivel bigint;
  v_meu_papel text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.leilao_habilitado(v_club) then raise exception 'O leilão não está habilitado para o seu clube.'; end if;
  select v.unidade_id, v.papel into v_minha_unidade, v_meu_papel from public._vinculo_ativo(v_uid, public.clube_atual_id()) v;
  if v_minha_unidade is null then raise exception 'Você precisa estar numa unidade ativa.'; end if;
  if v_meu_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros podem confirmar lance no leilão.';
  end if;

  select l.item_id, l.valor, it.leilao_id, it.preco_base, it.incremento_minimo
    into v_item_id, v_valor, v_leilao_id, v_preco_base, v_incremento
  from public.leilao_lances l join public.leilao_itens it on it.id = l.item_id
  where l.id = p_lance_id and l.club_id = v_club;
  if v_item_id is null then raise exception 'Lance não encontrado.'; end if;

  if not exists (
    select 1 from public.leilao_lance_unidades
    where lance_id = p_lance_id and unidade_id = v_minha_unidade and confirmado = false
  ) then
    raise exception 'Sua unidade não precisa confirmar esse lance.';
  end if;

  -- Trava a linha do leilão (mesma trava de dar_lance/recusar/encerrar/cron).
  select status, fecha_em into v_leilao_status, v_fecha_em from public.leiloes where id = v_leilao_id for update;
  if v_leilao_status <> 'aberto' then raise exception 'Esse leilão já encerrou.'; end if;
  if now() >= v_fecha_em then raise exception 'O tempo desse leilão acabou.'; end if;

  select status into v_status_atual from public.leilao_lances where id = p_lance_id;
  if v_status_atual <> 'pendente' then
    raise exception 'Esse lance não está mais pendente (alguém recusou, ou o leilão fechou).';
  end if;

  update public.leilao_lance_unidades set confirmado = true
   where lance_id = p_lance_id and unidade_id = v_minha_unidade;

  select count(*) into v_faltam from public.leilao_lance_unidades
  where lance_id = p_lance_id and confirmado = false;
  if v_faltam > 0 then
    return json_build_object('ativado', false, 'faltam', v_faltam);
  end if;

  -- Todo mundo confirmou: valida de novo (o mundo pode ter mudado) e ativa.
  -- Sem "raise exception" ao invalidar: devolve o motivo no JSON e commita o
  -- 'superado' (uma exceção desfaria a transação e o lance ficaria pendente).
  select coalesce(max(valor), 0) into v_maior_valor
  from public.leilao_lances where item_id = v_item_id and status = 'ativo';
  if v_valor < v_preco_base or (v_maior_valor > 0 and v_valor < v_maior_valor + v_incremento) then
    update public.leilao_lances set status = 'superado' where id = p_lance_id;
    return json_build_object('ativado', false,
      'motivo', 'Enquanto vocês combinavam, outra unidade deu um lance maior. Esse lance não vale mais.');
  end if;

  -- SALDO COLETIVO: as unidades somam forças; basta a soma do que cada uma tem disponível cobrir o
  -- valor. O disponível de cada unidade é o que ela teria SE o lance ativo deste item (que será
  -- superado logo abaixo, seja de quem for) saísse: pontos menos a reserva dos OUTROS itens — a
  -- mesma conta de `leilao_saldo_unidade`, sem este item — e só então o piso de zero.
  -- (Antes da 85: saldo com piso + `sum(l.valor)` do lance ativo, o valor CHEIO por unidade.)
  select coalesce(sum(least(greatest(0,
           public.pontos_temporada_unidade(lu.unidade_id)::bigint
           - public._leilao_reserva_unidade(lu.unidade_id, v_item_id)), 2147483647)), 0)
    into v_disponivel
    from public.leilao_lance_unidades lu
   where lu.lance_id = p_lance_id;

  if v_disponivel < v_valor then
    update public.leilao_lances set status = 'superado' where id = p_lance_id;
    return json_build_object('ativado', false, 'motivo',
      'Juntas, as unidades não têm ' || v_valor || ' pontos disponíveis agora. Esse lance não vale mais.');
  end if;

  update public.leilao_lances set status = 'superado' where item_id = v_item_id and status = 'ativo';
  update public.leilao_lances set status = 'ativo' where id = p_lance_id and status = 'pendente';

  return json_build_object('ativado', true);
end;
$$;
revoke all on function public.confirmar_lance_conjunto(uuid) from public, anon;
grant execute on function public.confirmar_lance_conjunto(uuid) to authenticated;

notify pgrst, 'reload schema';
