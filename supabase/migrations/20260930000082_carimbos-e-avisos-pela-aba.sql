-- =============================================================================
--  Fase 9.1 — o clube de um ponto, de um aviso e de um vínculo de responsável é o do ATO.
--
--  Mesma raiz da migration 73 (fotos e mensalidades), em mais quatro lugares:
--
--    · pontos manuais    `definir_club_ponto`, sem club_id, carimbava o clube MAIS NOVO de quem
--                        RECEBE o ponto. O front lança assim (Usuários > pontos e o ajuste
--                        individual do Modo Acampamento). A liderança de A, na aba A, não conseguia
--                        pontuar a criança cujo vínculo mais novo é B: o gatilho carimbava B e a RLS
--                        (club_id = aba) recusava. Na hora da prova, no celular, sem explicação.
--    · aviso geral       `definir_club_notificacao`, no aviso 'todos'/'lideranca' que a liderança
--                        manda pelo app (sem club_id), carimbava o clube mais novo do AUTOR: quem é
--                        liderança em A e B só conseguia avisar pelo clube mais novo.
--    · "Cadastro         o aviso saía de um gatilho em `profiles` — o espelho do clube PRIMÁRIO. A
--       aprovado"        criança já ativa em A, aprovada em B, nunca recebia o aviso (o espelho ia
--                        de ativo para ativo); e uma troca do clube primário podia disparar o aviso
--                        sem aprovação nenhuma. Agora nasce do VÍNCULO (pendente -> ativo), no clube
--                        do vínculo.
--    · responsáveis      o índice "um par aprovado" era (responsável, criança). O mesmo pai e a
--                        mesma criança em A e em B: aprovado em A, o pedido em B falhava com "já está
--                        vinculado", e na aba B o pai não via nada do filho. Passa a ser por clube.
--
--  E, de carona, o aviso de "entrega avaliada" passa a levar o clube da entrega explicitamente.
--
--  A REGRA dos carimbos, igual à da 73: club_id explícito vale (conferido); senão, em sessão de
--  cliente, o clube da ABA se a pessoa tem vínculo ali; o palpite antigo fica SÓ para rotina do
--  banco (cron, service), que não tem aba.
--
--  Aplicada pelo SQL Editor numa transação só, como postgres. Pode rodar de novo.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. pontos
-- -----------------------------------------------------------------------------
create or replace function public.definir_club_ponto()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_club_unidade uuid; v_club_pessoa uuid;
begin
  if new.unidade_id is not null then
    select club_id into v_club_unidade from public.unidades where id = new.unidade_id;
    -- unidade inexistente: para o cliente é a MESMA resposta de "unidade de outro clube"
    if v_club_unidade is null and public._sessao_de_cliente() then
      perform public._recusar_linha('pontos', 'Unidade inexistente.');
    end if;
  end if;
  if new.usuario_id is not null then
    if new.club_id is not null then
      -- clube explícito (RPC/rotina que já sabe o clube): só CONFERE o vínculo, nunca adivinha outro
      if not exists (
        select 1 from public.organization_memberships m
        where m.user_id = new.usuario_id and m.organizational_unit_id = new.club_id
      ) then
        perform public._recusar_linha('pontos', 'Pessoa sem vínculo com o clube informado.');
      end if;
      v_club_pessoa := new.club_id;
    elsif public._sessao_de_cliente() then
      -- cliente (a liderança lançando pontos pela tela): o clube é a ABA, desde que a pessoa seja
      -- de lá. Qualquer vínculo serve — a mesma régua do club_id explícito acima (a liderança
      -- pode, por exemplo, tirar pontos de alguém que está suspenso). Quem não é da aba é recusado
      -- com a resposta padrão da RLS, e não "desviado" para outro clube dela.
      v_club_pessoa := public._clube_da_aba();
      if not public._tem_vinculo(new.usuario_id, v_club_pessoa, false) then
        perform public._recusar_linha('pontos', 'Pessoa sem clube.');
      end if;
    else
      -- rotina do banco (sem aba): o palpite de sempre
      v_club_pessoa := public.clube_vinculo_do_usuario(new.usuario_id);
    end if;
  end if;
  if v_club_unidade is not null and v_club_pessoa is not null and v_club_unidade <> v_club_pessoa then
    perform public._recusar_linha('pontos', 'A pessoa e a unidade do ponto são de clubes diferentes.');
  end if;
  new.club_id := coalesce(v_club_unidade, v_club_pessoa, null::uuid);
  if new.club_id is null then
    perform public._recusar_linha('pontos', 'Sem clube: esta pessoa não participa de nenhum clube.');
  end if;
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
--  2. notificações — o aviso geral inserido pelo cliente
-- -----------------------------------------------------------------------------
create or replace function public.definir_club_notificacao()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_dest uuid;
begin
  if new.para_usuario is not null then
    -- aviso pessoal: no clube em que o ATO aconteceu, desde que quem recebe tenha vínculo ali
    -- (qualquer status: o aviso de "você foi desativado" é do clube que desativou). Ordem: o clube
    -- explícito da rotina, a aba de quem agiu, e só então o clube mais novo de quem recebe.
    if public._tem_vinculo(new.para_usuario, new.club_id, false) then
      return new;
    end if;
    v_dest := public._clube_da_aba();
    if not public._tem_vinculo(new.para_usuario, v_dest, false) then
      v_dest := public.clube_vinculo_do_usuario(new.para_usuario);
    end if;
    -- destinatário inexistente: para o cliente é a MESMA resposta de "destinatário de outro clube"
    if v_dest is null and public._sessao_de_cliente() then
      perform public._recusar_linha('notificacoes', 'Destinatário sem clube.');
    end if;
    new.club_id := v_dest;
  elsif new.club_id is not null then
    -- clube explícito (gatilhos e rotinas do banco). Se vier de um cliente, a RLS confere que é o
    -- clube dele e que ele é liderança dele; não dá para "mandar" aviso para outro clube.
    null;
  elsif new.criado_por is not null and public._sessao_de_cliente() then
    -- aviso geral ('todos'/'lideranca') escrito pela liderança no app, sem club_id: vai para o
    -- clube da ABA em que ela está, se ela é de lá. Antes ia para o clube MAIS NOVO dela, e quem
    -- é liderança em dois clubes só conseguia avisar por um deles.
    if public._tem_vinculo(new.criado_por, public._clube_da_aba()) then
      new.club_id := public._clube_da_aba();
    end if;
  elsif new.criado_por is not null and public.clube_vinculo_do_usuario(new.criado_por) is not null then
    -- rotina do banco (sem aba): o palpite de sempre
    new.club_id := public.clube_vinculo_do_usuario(new.criado_por);
  end if;
  if new.club_id is null then
    perform public._recusar_linha('notificacoes', 'Sem clube: esta pessoa não participa de nenhum clube.');
  end if;
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
--  3. "Cadastro aprovado" nasce do vínculo, não do espelho
-- -----------------------------------------------------------------------------
drop trigger if exists trg_notif_cadastro_aprovado on public.profiles;
drop function if exists public.notif_cadastro_aprovado();

-- pendente -> ativo num CLUBE: é a aprovação da entrada (por código, convite ou cadastro). Uma
-- reativação (suspenso -> ativo) não é "cadastro aprovado", e a troca do clube primário do espelho
-- também não é.
create or replace function public.notif_vinculo_aprovado()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pendente' and new.status = 'ativo'
     and exists (select 1 from public.organizational_units u
                  where u.id = new.organizational_unit_id and u.type = 'clube') then
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
    values ('🎉 Cadastro aprovado!', 'Bem-vindo(a) ao clube! Já pode usar tudo.', 'cadastro', '/ranking', 'pessoal',
            new.user_id, new.organizational_unit_id);
  end if;
  return new;
end;
$$;
revoke all on function public.notif_vinculo_aprovado() from public, anon, authenticated;

drop trigger if exists trg_notif_vinculo_aprovado on public.organization_memberships;
create trigger trg_notif_vinculo_aprovado
  after update of status on public.organization_memberships
  for each row execute function public.notif_vinculo_aprovado();


-- -----------------------------------------------------------------------------
--  4. "Entrega avaliada": o aviso é do clube da entrega
-- -----------------------------------------------------------------------------
create or replace function public.notif_entrega_avaliada()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tit text;
begin
  if new.status is distinct from old.status and new.status in ('aprovada', 'reprovada') then
    select titulo into v_tit from public.atividades where id = new.atividade_id;
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
    values (
      case when new.status = 'aprovada' then '✅ Entrega aprovada!' else '↺ Entrega reprovada' end,
      case when new.status = 'aprovada'
           then 'Sua entrega em "' || coalesce(v_tit, 'atividade') || '" foi aprovada. Pontos no ranking! 🎉'
           else 'Sua entrega em "' || coalesce(v_tit, 'atividade') || '" foi reprovada — dá pra enviar de novo.' end,
      'atividade', '/atividades', 'pessoal', new.usuario_id, new.club_id);
  end if;
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
--  5. responsáveis: o par aprovado é por clube
-- -----------------------------------------------------------------------------
-- O índice novo acrescenta uma coluna ao antigo: é mais frouxo, criá-lo nunca falha com os dados
-- existentes. Ele nasce antes de o antigo sair, para não haver instante sem a trava.
create unique index if not exists responsaveis_par_aprovado_por_clube_key
  on public.responsaveis (responsavel_id, desbravador_id, club_id) where status = 'aprovado';
drop index if exists public.responsaveis_par_aprovado_key;
