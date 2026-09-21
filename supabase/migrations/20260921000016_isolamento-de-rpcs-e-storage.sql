-- =====================================================================
-- DesbravaClube — Correções multi-tenant 4/5: RPCs, configuração, comprovantes e "reino legado"
--
-- Antes: uma diretoria de QUALQUER clube redefinia a senha e excluía usuário de outro clube,
-- lançava pontos em unidade alheia, aprovava vínculo de responsável de outro clube, alterava
-- o PIX (config_clube), cancelava o leilão e lia os comprovantes privados (fotos de crianças).
--
-- Agora:
--  A) Operações sobre PESSOAS e PONTOS (dados já tenantizados) checam a liderança do clube
--     da pessoa/unidade-alvo: redefinir senha, excluir usuário, acampamento, vínculos de
--     responsáveis (com club_id), "Meus Filhos".
--  B) Tudo que ainda NÃO foi tenantizado (chat, missões, jogos, duelos, config_clube, pets,
--     lembretes...) é do Tenant 001: pode_gerir()/eh_membro_ativo() já valem para o clube
--     legado (migration 13); aqui entram (1) gatilho de escrita que só aceita gente do clube
--     legado nessas tabelas e (2) os pontos onde a checagem era inline (profiles.papel).
--  C) Storage: comprovantes privados e imagens só para o dono ou a liderança do clube dele.
--  D) config_clube: leitura só do clube legado; escrita já é pode_gerir() (legado).
-- Duelos, jogos, missões e config_clube seguem como pendência de tenantização "de verdade".
-- =====================================================================

-- ==================== A) pessoas e pontos, por clube ====================

-- Só a liderança do clube DA PESSOA redefine a senha; senha de instrutor/diretoria só a diretoria
-- (senão um instrutor redefiniria a senha da diretoria e assumiria a conta).
create or replace function public.resetar_senha_membro(alvo uuid, nova_senha text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_vinculo_do_usuario(alvo); v_papel text;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor do clube desta pessoa).';
  end if;
  select role into v_papel from public.organization_memberships
   where user_id = alvo and organizational_unit_id = v_club order by created_at desc limit 1;
  if v_papel in ('diretoria', 'instrutor') and not exists (
       select 1 from public.organization_memberships
        where user_id = auth.uid() and organizational_unit_id = v_club and role = 'diretoria' and status = 'ativo') then
    raise exception 'Sem permissão: só a diretoria redefine a senha de instrutor ou diretoria.';
  end if;
  if nova_senha is null or length(nova_senha) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(nova_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = alvo;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
end;
$$;

-- Só a DIRETORIA do clube da pessoa exclui.
create or replace function public.excluir_usuario(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_nome text;
begin
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.organizational_unit_id = public.clube_vinculo_do_usuario(p_id)
      and m.role = 'diretoria' and m.status = 'ativo'
  ) then
    raise exception 'Só a diretoria do clube desta pessoa pode excluir usuários.';
  end if;

  if p_id = v_uid then
    raise exception 'Você não pode excluir a si mesmo.';
  end if;

  select nome into v_nome from public.profiles where id = p_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;

  -- Solta as referências de AUDITORIA ("quem lançou/criou/avaliou"). Sem isto o
  -- delete trava numa foreign key e a liderança só vê um erro incompreensível.
  -- Vira null: o registro do clube continua, só sem o nome de quem fez.
  update public.atividades   set criado_por     = null where criado_por     = p_id;
  update public.entregas     set avaliado_por   = null where avaliado_por   = p_id;
  update public.pontos       set lancado_por    = null where lancado_por    = p_id;
  update public.mensalidades set registrado_por = null where registrado_por = p_id;
  update public.notificacoes set criado_por     = null where criado_por     = p_id;
  -- Fotos do mural FICAM (são memória do clube); só perdem o autor.
  update public.fotos        set autor_id       = null where autor_id       = p_id;

  -- Agora sim: apaga o perfil. Em cascata vão os registros PRÓPRIOS da pessoa
  -- (pontos dela, entregas, mensalidades, jogos, vínculos de responsável).
  delete from public.profiles where id = p_id;
  return json_build_object('ok', true, 'nome', v_nome);
end;
$$;

-- Pontuação do acampamento: só unidades do clube de quem lança.
create or replace function public.lancar_colocacao_acampamento(p_atividade text, p_colocacoes jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_item jsonb;
  v_unidade_id uuid;
  v_posicao int;
  v_pontos int;
  v_motivo text;
  v_posicoes_usadas int[] := '{}';
  v_lancados int := 0;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Só a liderança pode lançar pontuação do acampamento.';
  end if;
  if p_colocacoes is null or jsonb_typeof(p_colocacoes) <> 'array' or jsonb_array_length(p_colocacoes) = 0 then
    raise exception 'Lance ao menos uma colocação.';
  end if;

  for v_item in select * from jsonb_array_elements(p_colocacoes) loop
    v_unidade_id := nullif(v_item->>'unidade_id', '')::uuid;
    v_posicao := nullif(v_item->>'posicao', '')::int;
    v_pontos := coalesce(nullif(v_item->>'pontos', '')::int, 0);

    if v_unidade_id is null then raise exception 'Colocação sem unidade.'; end if;
    if not exists (select 1 from public.unidades where id = v_unidade_id and club_id = v_club) then
      raise exception 'Unidade não encontrada neste clube.';
    end if;

    if v_posicao is not null then
      if v_posicao <= 0 then raise exception 'Colocação inválida.'; end if;
      if v_posicao = any(v_posicoes_usadas) then
        raise exception 'Duas unidades não podem ficar na mesma colocação.';
      end if;
      v_posicoes_usadas := v_posicoes_usadas || v_posicao;
    end if;

    if v_pontos <> 0 then
      v_motivo := 'Acampamento'
        || case when coalesce(trim(p_atividade), '') <> '' then ': ' || trim(p_atividade) else '' end
        || case when v_posicao is not null then ' — ' || v_posicao || 'º lugar' else '' end;
      insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por)
      values (v_unidade_id, 'acampamento', v_pontos, v_motivo, v_uid);
      v_lancados := v_lancados + 1;
    end if;
  end loop;

  if v_lancados = 0 then raise exception 'Nenhuma unidade com pontos pra lançar.'; end if;

  return json_build_object('ok', true, 'lancados', v_lancados);
end;
$$;

-- Teto de ±100 pontos individuais para quem NÃO é liderança: agora "liderança" = do clube DO PONTO
-- (o gatilho definir_club_ponto já preencheu new.club_id: nome dele vem antes na ordem alfabética).
create or replace function public.limita_pontos_conselheiro() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.usuario_id is not null and auth.uid() is not null and not public.pode_gerir_no_clube(new.club_id) then
    new.pontos := greatest(-100, least(100, coalesce(new.pontos, 0)));
  end if;
  return new;
end;
$$;
revoke all on function public.limita_pontos_conselheiro() from public, anon, authenticated;

-- ---------- responsáveis: vínculo pai -> filho pertence a um clube ----------
alter table public.responsaveis add column if not exists club_id uuid references public.organizational_units(id);
update public.responsaveis r
   set club_id = coalesce(public.clube_do_usuario(r.responsavel_id), public.clube_legado_id())
 where r.club_id is null;
alter table public.responsaveis alter column club_id set not null;
create index if not exists idx_responsaveis_club on public.responsaveis(club_id);

create or replace function public.definir_club_responsavel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.club_id := public.clube_do_usuario(new.responsavel_id);
  if new.club_id is null then raise exception 'O responsável não pertence a nenhum clube.'; end if;
  if new.desbravador_id is not null and public.clube_do_usuario(new.desbravador_id) is distinct from new.club_id then
    raise exception 'O desbravador é de outro clube.';
  end if;
  return new;
end;
$$;
revoke all on function public.definir_club_responsavel() from public, anon, authenticated;
drop trigger if exists trg_definir_club_responsavel on public.responsaveis;
create trigger trg_definir_club_responsavel
before insert or update of responsavel_id, desbravador_id on public.responsaveis
for each row execute function public.definir_club_responsavel();

drop policy if exists "ler responsaveis" on public.responsaveis;
create policy "ler responsaveis" on public.responsaveis for select to authenticated
using (responsavel_id = auth.uid() or public.pode_gerir_no_clube(club_id));
drop policy if exists "apagar responsaveis" on public.responsaveis;
create policy "apagar responsaveis" on public.responsaveis for delete to authenticated
using (public.pode_gerir_no_clube(club_id) or (responsavel_id = auth.uid() and status = 'pendente'));

create or replace function public.pedir_vinculo(p_nome text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_papel text; v_pend int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select papel into v_papel from public.profiles where id = v_uid and status = 'ativo';
  if v_papel is distinct from 'pais' then raise exception 'Só responsáveis pedem vínculo.'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Digite o nome do seu filho(a).'; end if;

  select count(*) into v_pend from public.responsaveis
   where responsavel_id = v_uid and status = 'pendente';
  if v_pend >= 5 then raise exception 'Você já tem pedidos demais aguardando. Espere a diretoria. 🙂'; end if;

  insert into public.responsaveis (responsavel_id, nome_digitado) values (v_uid, trim(p_nome));
  return json_build_object('ok', true);
end;
$$;

-- Só a DIRETORIA DO CLUBE do pedido aprova, e o filho tem que ser membro desse mesmo clube.
create or replace function public.aprovar_vinculo(p_id uuid, p_desbravador_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_status text; v_club uuid;
begin
  select status, club_id into v_status, v_club from public.responsaveis where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.organizational_unit_id = v_club and m.role = 'diretoria' and m.status = 'ativo'
  ) then
    raise exception 'Só a diretoria aprova vínculos.';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_desbravador_id and p.papel <> 'pais' and public.clube_do_usuario(p.id) = v_club
  ) then
    raise exception 'Desbravador não encontrado neste clube.';
  end if;
  if v_status = 'aprovado' then raise exception 'Esse vínculo já foi aprovado.'; end if;

  update public.responsaveis
     set desbravador_id = p_desbravador_id, status = 'aprovado', aprovado_por = v_uid, aprovado_em = now()
   where id = p_id;
  return json_build_object('ok', true);
exception when unique_violation then
  raise exception 'Esse responsável já está vinculado a esse desbravador.';
end;
$$;

create or replace function public.rejeitar_vinculo(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid;
begin
  select club_id into v_club from public.responsaveis where id = p_id;
  if v_club is null or not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.organizational_unit_id = v_club and m.role = 'diretoria' and m.status = 'ativo'
  ) then
    raise exception 'Só a diretoria.';
  end if;
  update public.responsaveis set status = 'rejeitado' where id = p_id and status = 'pendente';
  return json_build_object('ok', true);
end;
$$;

create or replace function public.vinculos_pendentes()
returns json language sql security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'id', r.id, 'nome_digitado', r.nome_digitado, 'criado_em', r.criado_em, 'responsavel', p.nome
  ) order by r.criado_em), '[]'::json)
  from public.responsaveis r
  join public.profiles p on p.id = r.responsavel_id
  where r.status = 'pendente' and public.pode_gerir_no_clube(r.club_id);
$$;

-- Portal "Meus Filhos": a ÚNICA porta do responsável para dados de menores — só filhos
-- aprovados, do MESMO clube do responsável.
create or replace function public.meus_filhos()
returns json language sql security definer set search_path = '' as $$
  select coalesce(json_agg(f order by f->>'nome'), '[]'::json) from (
    select json_build_object(
      'id', c.id, 'nome', c.nome, 'foto', c.foto, 'unidade', u.nome,
      'pontos', coalesce((select sum(pontos)::int from public.pontos where usuario_id = c.id and club_id = r.club_id), 0),
      'presencas', coalesce((select count(*) from public.pontos
                    where usuario_id = c.id and club_id = r.club_id and origem = 'apontamento' and marca->>'presenca' = 'presente'), 0),
      'faltas', coalesce((select count(*) from public.pontos
                    where usuario_id = c.id and club_id = r.club_id and origem = 'apontamento' and marca->>'presenca' = 'faltou'), 0),
      'mensalidades_pendentes', coalesce((
                    select json_agg(json_build_object('mes', m.mes, 'ano', m.ano, 'valor', m.valor) order by m.ano, m.mes)
                    from public.mensalidades m where m.desbravador_id = c.id and m.club_id = r.club_id and m.status = 'pendente'), '[]'::json)
    ) as f
    from public.responsaveis r
    join public.profiles c on c.id = r.desbravador_id
    left join public.unidades u on u.id = c.unidade_id
    where r.responsavel_id = auth.uid() and r.status = 'aprovado'
      and public.clube_do_usuario(auth.uid()) = r.club_id
      and public.clube_do_usuario(c.id) = r.club_id
  ) t;
$$;

-- ==================== B) "reino legado" = Tenant 001 ====================

-- Só gente do clube legado grava nestas tabelas (chat, missões, jogos, bichinho, bíblia,
-- ajuda, duelos, chefão, partidas): impede que outro clube gere linhas que a liderança do
-- Tenant 001 depois veria/aprovaria, e vice-versa. Vale para qualquer RPC que insira.
create or replace function public.exigir_clube_legado() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_col text; v_uid uuid;
begin
  foreach v_col in array tg_argv loop
    v_uid := (to_jsonb(new) ->> v_col)::uuid;
    if v_uid is not null and public.clube_do_usuario(v_uid) is distinct from public.clube_legado_id() then
      raise exception 'Este recurso ainda não está disponível para o seu clube.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.exigir_clube_legado() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('chat_mensagens', 'autor_id'), ('chat_participantes', 'usuario_id'),
    ('missoes_feitas', 'usuario_id'), ('devocional', 'usuario_id'),
    ('trilha_jogos', 'usuario_id'), ('recordes', 'usuario_id'), ('partidas', 'usuario_id'),
    ('bichinhos', 'usuario_id'), ('biblia_leituras', 'usuario_id'), ('biblia_leitura_atual', 'usuario_id'),
    ('chefao_golpes', 'usuario_id'), ('duelos', 'criado_por')
  ) as v(tabela, coluna) loop
    execute format('drop trigger if exists trg_exigir_clube_legado on public.%I', r.tabela);
    execute format('create trigger trg_exigir_clube_legado before insert on public.%I for each row execute function public.exigir_clube_legado(%L)', r.tabela, r.coluna);
  end loop;
  execute 'drop trigger if exists trg_exigir_clube_legado on public.ajudas';
  execute 'create trigger trg_exigir_clube_legado before insert on public.ajudas for each row execute function public.exigir_clube_legado(''de_id'', ''para_id'')';
end $$;

-- Missões: liderança do clube legado (antes: qualquer diretoria/instrutor de qualquer clube)
create or replace function public.missoes_pendentes()
returns table (id uuid, nome text, foto_url text, data date)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.pode_gerir() then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  return query
  select m.id, p.nome, m.foto_url, m.data
  from public.missoes_feitas m join public.profiles p on p.id = m.usuario_id
  where m.status = 'pendente' order by m.created_at;
end;
$$;

create or replace function public.avaliar_missao(p_id uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row record;
begin
  if not public.pode_gerir() then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  select * into v_row from public.missoes_feitas where id = p_id and status = 'pendente';
  if not found then raise exception 'Missão não encontrada ou já avaliada.'; end if;
  if p_aprovar then
    update public.missoes_feitas set status = 'aprovada' where id = p_id;
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_row.usuario_id, 'missao', coalesce(v_row.pontos_dados, 10), 'Missão ' || to_char(v_row.data, 'DD/MM') || ' (aprovada)');
  else
    update public.missoes_feitas set status = 'reprovada' where id = p_id;
  end if;
end;
$$;

-- Chat: leitura só do clube legado (antes: o canal Geral era lido por qualquer membro ativo de qualquer clube)
create or replace function public.chat_pode_ver(p_conversa_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pode_gerir()
    or (public.eh_membro_ativo() and (
      exists (
        select 1 from public.chat_conversas ch where ch.id = p_conversa_id and ch.tipo = 'unidade'
          and ch.unidade_id = (
            select unidade_id from public.profiles where id = auth.uid() and status = 'ativo' and papel in ('desbravador', 'conselheiro')
          )
      )
      or exists (select 1 from public.chat_conversas cg where cg.id = p_conversa_id and cg.tipo = 'geral')
      or exists (
        select 1 from public.chat_participantes part where part.conversa_id = p_conversa_id and part.usuario_id = auth.uid()
      )
    ));
$$;

-- Galeria de bichinhos: só do clube legado
create or replace function public.pets_do_clube()
returns table (dono_id uuid, dono_nome text, dono_avatar jsonb, dono_avatar_tipo text, dono_foto text,
               especie text, pet_nome text, estagio integer, item text, cenario text, cor text, olhos text,
               movel text, vivo boolean, ofensiva integer, dormindo boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, p.avatar, p.avatar_tipo, p.foto,
    b.especie, b.nome, public._bichinho_estagio(b.dias_cuidados), b.item, b.cenario, b.cor, b.olhos,
    b.movel,
    (b.vivo and (b.pontuado_em is null or b.dormindo_desde is not null
                 or now() - b.ultimo_cuidado_em <= interval '72 hours')),
    b.ofensiva,
    (b.dormindo_desde is not null)
  from public.bichinhos b
  join public.profiles p on p.id = b.usuario_id
  where p.status = 'ativo' and p.papel <> 'pais'
    and public.clube_do_usuario(p.id) = public.clube_legado_id()
    and public.eh_membro_ativo()
  order by b.ofensiva desc, public._bichinho_estagio(b.dias_cuidados) desc, p.nome;
$$;

-- Lembretes diários do "reino legado": só para o clube legado
create or replace function public.lembrar_ausentes()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  -- idempotência: no máximo 1x por dia
  if coalesce((select valor from public.config_clube where chave = 'lembrete_ausencia_dia'), '') = v_hoje::text then
    return;
  end if;
  for r in
    select p.id
    from public.profiles p
    where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false
      and public.clube_do_usuario(p.id) = public.clube_legado_id()
      -- 2+ dias sem jogar: nada ontem nem hoje
      and not exists (select 1 from public.trilha_jogos t where t.usuario_id = p.id and t.data >= v_hoje - 1)
      -- não repetir: não lembrado nos últimos 2 dias
      and not exists (
        select 1 from public.notificacoes n
        where n.para_usuario = p.id and n.titulo = '🎮 Sentimos sua falta!'
          and (n.created_at at time zone 'America/Sao_Paulo')::date >= v_hoje - 1
      )
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values ('🎮 Sentimos sua falta!',
      'Já faz uns dias que você não joga! Vem ganhar pontos — tem jogo novo te esperando. 🎁',
      'geral', '/trilha', 'pessoal', r.id);
  end loop;
  insert into public.config_clube (chave, valor) values ('lembrete_ausencia_dia', v_hoje::text)
  on conflict (chave) do update set valor = excluded.valor;
end;
$$;

create or replace function public.lembrar_jogos_do_dia()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_on boolean := public.rodizio_ligado();
  v_total int;
  r record;
begin
  if coalesce((select valor from public.config_clube where chave = 'lembrete_jogos_dia'), '') = v_hoje::text then
    return;
  end if;
  create temp table if not exists _abertos_lembrete (chave text primary key) on commit drop;
  delete from _abertos_lembrete;
  if v_on then
    insert into _abertos_lembrete
      select q.chave from (
        select d.chave from public.jogos_do_dia(v_hoje) d
        union
        select l.chave from public.jogos_liberados l
        join public.jogos_trilha j on j.chave = l.chave
        where l.data = v_hoje and j.ativo and l.chave not in ('reflexo', 'corrida')
      ) q
      join public.jogos_trilha jt on jt.chave = q.chave
      where not jt.requer_webgl;
  else
    insert into _abertos_lembrete
      select j.chave from public.jogos_trilha j
      where j.ativo and j.chave not in ('reflexo', 'corrida') and not j.requer_webgl;
  end if;
  select count(*) into v_total from _abertos_lembrete;
  if v_total = 0 then return; end if;
  for r in
    select p.id
    from public.profiles p
    where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false
      and public.clube_do_usuario(p.id) = public.clube_legado_id()
      and (
        select count(distinct t.tipo) from public.trilha_jogos t
        where t.usuario_id = p.id and t.data = v_hoje
          and t.tipo in (select chave from _abertos_lembrete)
      ) < v_total
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values ('🎮 Ainda dá tempo de jogar!',
      'Complete os jogos de hoje e ganhe o bônus do dia! 🎁',
      'geral', '/trilha', 'pessoal', r.id);
  end loop;
  insert into public.config_clube (chave, valor) values ('lembrete_jogos_dia', v_hoje::text)
  on conflict (chave) do update set valor = excluded.valor;
end;
$$;
revoke all on function public.lembrar_ausentes() from public, anon, authenticated;
revoke all on function public.lembrar_jogos_do_dia() from public, anon, authenticated;

-- ==================== D) configuração e catálogos globais ====================
-- config_clube (PIX, rodízio, popup...) é GLOBAL hoje: leitura só do clube legado (membros e
-- responsáveis, que precisam do PIX); escrita já é pode_gerir() = liderança do clube legado.
drop policy if exists "ler config" on public.config_clube;
create policy "ler config" on public.config_clube for select to authenticated
using (public.tem_vinculo_unidade(public.clube_legado_id()));

drop policy if exists "ler duelos" on public.duelos;
create policy "ler duelos" on public.duelos for select to authenticated using (public.eh_membro_ativo());
drop policy if exists "ler desafios_unidade" on public.desafios_unidade;
create policy "ler desafios_unidade" on public.desafios_unidade for select to authenticated using (public.eh_membro_ativo());

-- ==================== C) storage ====================
-- Comprovantes (fotos de missões/atividades de crianças): o dono OU a liderança do clube do dono.
drop policy if exists "comprovacao dono ou lideranca le" on storage.objects;
create policy "comprovacao dono ou lideranca le" on storage.objects for select to authenticated
using (
  bucket_id = 'comprovacoes'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.lideranca_gere_pasta((storage.foldername(name))[1]))
);

-- Imagens (mural/perfil): o dono OU a liderança do clube do dono altera/apaga.
drop policy if exists "apagar imagens" on storage.objects;
create policy "apagar imagens" on storage.objects for delete to authenticated
using (bucket_id = 'imagens' and (owner = auth.uid() or public.lideranca_gere_usuario(owner)));
drop policy if exists "atualizar imagens" on storage.objects;
create policy "atualizar imagens" on storage.objects for update to authenticated
using (bucket_id = 'imagens' and (owner = auth.uid() or public.lideranca_gere_usuario(owner)))
with check (bucket_id = 'imagens' and (owner = auth.uid() or public.lideranca_gere_usuario(owner)));

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-isolamento-de-rpcs-e-storage.sql')
on conflict (arquivo) do update set aplicada_em = now();
