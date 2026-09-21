-- =====================================================================
--  Filhos da Conquista — Melhorias IMPORTANTES da varredura (2026-07-06)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole TUDO -> Run.
--  Idempotente. Rode DEPOIS do 2026-07-06-varredura-urgentes.sql.
--  DICA: rode também o 2026-06-30-devocional-popup.sql (se ainda não rodou) —
--  sem ele o aviso de MISSÃO é pulado (o resto aplica normalmente). Este arquivo
--  NÃO quebra se a tabela de missões ainda não existir.
--
--  Resolve (lado do banco):
--    #9  Notificação PESSOAL (avisar uma criança só) + avisos automáticos
--    #10 Entrega reprovada com MOTIVO (coluna feedback)
--    #11 Ligar os pontos à ENTREGA que os gerou (coluna entrega_id)
--    #12 Liderança pode EDITAR atividade (policy de update)
--    #16 Cadastro não vira diretoria sozinho (nasce sempre desbravador)
-- =====================================================================


-- ---------------------------------------------------------------------
-- #12  EDITAR ATIVIDADE: liderança pode atualizar (antes só criar/excluir)
-- ---------------------------------------------------------------------
drop policy if exists "editar atividade" on public.atividades;
create policy "editar atividade" on public.atividades for update to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());


-- ---------------------------------------------------------------------
-- #16  CADASTRO SEGURO: ninguém nasce liderança pelo cadastro.
--      Guarda o cargo que a pessoa DIGITOU (pra liderança conferir),
--      mas o papel efetivo é sempre 'desbravador' até a liderança promover
--      (pela tela Usuários). Isso fecha o "me cadastrei como Diretor".
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome, nascimento, unidade_id, cargo, papel)
  values (
    new.id,
    new.raw_user_meta_data->>'nome',
    (nullif(new.raw_user_meta_data->>'nascimento',''))::date,
    (nullif(new.raw_user_meta_data->>'unidade_id',''))::uuid,
    new.raw_user_meta_data->>'cargo',   -- só rótulo informativo
    'desbravador'                        -- papel real: liderança promove depois
  );
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- #10  ENTREGA COM MOTIVO ao reprovar + REENVIO da criança
-- ---------------------------------------------------------------------
alter table public.entregas add column if not exists feedback text;

-- Deixa a criança REENVIAR a própria entrega reprovada (volta pra 'pendente').
-- Só de 'reprovada' -> 'pendente'; não deixa mexer em aprovada/pendente (anti-fraude).
drop policy if exists "reenviar entrega" on public.entregas;
create policy "reenviar entrega" on public.entregas for update to authenticated
  using (usuario_id = auth.uid() and status = 'reprovada')
  with check (usuario_id = auth.uid() and status = 'pendente');


-- ---------------------------------------------------------------------
-- #11  LIGAR PONTOS À ENTREGA (apagar entrega remove o ponto certo)
-- ---------------------------------------------------------------------
alter table public.pontos add column if not exists entrega_id uuid
  references public.entregas(id) on delete set null;

-- aprovar_entrega agora grava o entrega_id no ponto (continua atômico/idempotente)
create or replace function public.aprovar_entrega(p_entrega_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ent public.entregas;
  v_atv public.atividades;
  v_pts int;
begin
  if not public.pode_gerir() then raise exception 'Sem permissão.'; end if;

  update public.entregas
     set status = 'aprovada', avaliado_por = v_uid
   where id = p_entrega_id and status = 'pendente'
   returning * into v_ent;

  if v_ent.id is null then
    return json_build_object('ok', false, 'motivo', 'ja_avaliada');
  end if;

  select * into v_atv from public.atividades where id = v_ent.atividade_id;
  v_pts := coalesce(v_atv.pontos, 0);

  update public.entregas set pontos_dados = v_pts where id = v_ent.id;
  insert into public.pontos (usuario_id, origem, pontos, motivo, lancado_por, entrega_id)
    values (v_ent.usuario_id, 'atividade', v_pts,
            'Atividade: ' || coalesce(v_atv.titulo, ''), v_uid, v_ent.id);

  return json_build_object('ok', true, 'pontos', v_pts);
end;
$$;
grant execute on function public.aprovar_entrega(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- #9  NOTIFICAÇÃO PESSOAL (avisar uma pessoa só) + avisos automáticos
--     Coluna para_usuario: quando preenchida, só aquela pessoa vê/recebe.
-- ---------------------------------------------------------------------
alter table public.notificacoes add column if not exists para_usuario uuid
  references public.profiles(id) on delete cascade;

-- Leitura: pessoal (só o dono) OU broadcast (todos / liderança) como antes
drop policy if exists "ler notificacoes" on public.notificacoes;
create policy "ler notificacoes" on public.notificacoes for select to authenticated using (
  para_usuario = auth.uid()
  or (para_usuario is null and (para = 'todos' or (para = 'lideranca' and public.pode_aprovar())))
);

-- Aviso automático: entrega de atividade aprovada/reprovada -> avisa a criança
create or replace function public.notif_entrega_avaliada()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tit text;
begin
  if new.status is distinct from old.status and new.status in ('aprovada','reprovada') then
    select titulo into v_tit from public.atividades where id = new.atividade_id;
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values (
      case when new.status='aprovada' then '✅ Entrega aprovada!' else '↺ Entrega reprovada' end,
      case when new.status='aprovada'
           then 'Sua entrega em "' || coalesce(v_tit,'atividade') || '" foi aprovada. Pontos no ranking! 🎉'
           else 'Sua entrega em "' || coalesce(v_tit,'atividade') || '" foi reprovada — dá pra enviar de novo.' end,
      'atividade', '/atividades', 'pessoal', new.usuario_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notif_entrega_avaliada on public.entregas;
create trigger trg_notif_entrega_avaliada after update on public.entregas
  for each row execute function public.notif_entrega_avaliada();

-- Aviso automático: missão de foto avaliada -> avisa a criança
create or replace function public.notif_missao_avaliada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('aprovada','reprovada') then
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values (
      case when new.status='aprovada' then '✅ Missão aprovada!' else '↺ Missão não aprovada' end,
      case when new.status='aprovada'
           then 'Sua missão de foto foi aprovada. Pontos no ranking! 🎉'
           else 'Sua missão de foto não foi aprovada desta vez.' end,
      'missao', '/missoes', 'pessoal', new.usuario_id);
  end if;
  return new;
end;
$$;
-- A tabela missoes_feitas vem do 2026-06-30-devocional-popup.sql. Se ele ainda
-- não foi rodado, PULA o gatilho (não deixa o script inteiro falhar/rollback).
-- Depois de rodar o devocional-popup, rode este arquivo de novo pra ligar o aviso.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'missoes_feitas') then
    execute 'drop trigger if exists trg_notif_missao_avaliada on public.missoes_feitas';
    execute 'create trigger trg_notif_missao_avaliada after update on public.missoes_feitas
             for each row execute function public.notif_missao_avaliada()';
  end if;
end $$;

-- Aviso automático: cadastro APROVADO -> boas-vindas pra pessoa (ela vê no 1º login)
create or replace function public.notif_cadastro_aprovado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ativo' and old.status is distinct from 'ativo' then
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values ('🎉 Cadastro aprovado!', 'Bem-vindo(a) ao clube! Já pode usar tudo.', 'cadastro', '/ranking', 'pessoal', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notif_cadastro_aprovado on public.profiles;
create trigger trg_notif_cadastro_aprovado after update on public.profiles
  for each row execute function public.notif_cadastro_aprovado();


notify pgrst, 'reload schema';
