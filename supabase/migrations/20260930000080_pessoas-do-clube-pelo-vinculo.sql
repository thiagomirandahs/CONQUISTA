-- =============================================================================
--  Fase 9.1 — as PESSOAS de um clube vêm do vínculo daquele clube, e a conta global de uma
--  pessoa não é mexida por um clube só.
--
--  A regra da fase: para operar DENTRO de um clube, a fonte de papel, unidade e status é
--  `organization_memberships` do clube da requisição (a aba). O espelho em `profiles` guarda o
--  clube PRIMÁRIO da pessoa e existe só por compatibilidade. A criança que é desbravadora em A
--  (unidade A1) e em B (unidade B1) tem de aparecer certa nos dois, cada um com a própria unidade,
--  papel e status. Proibir a criança de estar em dois clubes não é solução: é o produto.
--
--  O que esta migration muda:
--
--    · membros_do_clube (NOVA)  a lista de pessoas do clube da aba, pelo vínculo. É a fonte que o
--                               front passa a usar no lugar do `select` em `profiles` (ranking,
--                               chamada, mensalidades, chat, ajuda...). Aniversário sai só como
--                               dia e mês, nunca a data completa.
--    · mensalidades_ano         o portão era `pode_gerir_no_clube` (instrutor/diretoria): o
--                               TESOUREIRO, que é quem usa a tela, recebia o mapa vazio.
--    · vinculos_pendentes       era `security definer` sem filtro de clube: quem é liderança em A e
--                               em B via os pedidos dos dois misturados, em qualquer aba.
--    · resetar_senha_membro     BLOCKER DE SEGURANÇA. A senha é da PESSOA (auth.users é global), e
--                               a função aceitava qualquer vínculo no clube da aba — pendente,
--                               suspenso, encerrado. A liderança de B trocava a senha de uma criança
--                               de A+B (e ela ficava sem acesso também em A), de um ex-membro, e de
--                               uma diretoria de outro clube que tivesse digitado o código de B.
--                               Qualquer conta abre um clube e vira diretoria dele. Agora: o alvo
--                               tem de estar ATIVO aqui, e é recusado se participa de outro clube
--                               (a própria pessoa usa "Esqueci a senha"). As sessões abertas do alvo
--                               são revogadas.
--    · listar_usuarios          não devolve mais o e-mail de quem tem o vínculo ENCERRADO aqui
--                               (ex-membro): a tela não precisa dele, e o e-mail era o que tornava
--                               o ex-membro "alcançável".
--    · profiles                 sai a policy de UPDATE da liderança sobre o perfil de TERCEIROS. Ela
--                               valia até com vínculo pendente, e deixava a liderança de B mudar
--                               nome, foto, nascimento (que decide a classe em A) e a flag de teste
--                               de uma criança de A+B. O front não edita nada disso de terceiros,
--                               exceto duas coisas, que ganham RPC com as mesmas travas da senha:
--                                 membro_definir_teste  (diretoria da aba)
--                                 membro_definir_foto   (liderança da aba)
--                               E a própria pessoa deixa de poder se marcar teste (ela sumia do
--                               ranking e da pontuação dos DOIS clubes sem ninguém saber por quê).
--                               A pessoa continua atualizando o PRÓPRIO nome, foto, avatar e
--                               notif_visto_em, como hoje (Cadastro, Perfil, sino).
--
--  Aplicada pelo SQL Editor numa transação só, como o papel postgres. Pode rodar de novo.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  0. Um critério só para "esta pessoa participa de OUTRO clube?"
-- -----------------------------------------------------------------------------
-- Pendente, ativo ou suspenso contam: quem digitou o código de outro clube, ou está afastado de
-- lá, continua sendo gente de lá. Encerrado não conta (é ex-membro). Vale qualquer unidade
-- organizacional, não só clube: uma conta com papel num distrito é ainda mais sensível.
create or replace function public._participa_de_outro_clube(p_user uuid, p_club uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
     where m.user_id = p_user
       and m.organizational_unit_id is distinct from p_club
       and m.status in ('pendente', 'ativo', 'suspenso')
       and (m.ends_at is null or m.ends_at > now()));
$$;
revoke all on function public._participa_de_outro_clube(uuid, uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  1. membros_do_clube — a lista de pessoas do clube da aba, pelo vínculo
-- -----------------------------------------------------------------------------
-- Contrato (o front consome; não mudar sem necessidade):
--   p_papeis     null = todos os papéis MENOS 'pais'
--   p_unidade_id filtra a unidade DO VÍNCULO
--   p_status     status DO VÍNCULO; qualquer coisa além de {ativo} é só para a liderança
--                (gestão ou financeiro). Aceita também o vocabulário da tela (inativo, rejeitado).
--   p_busca      trecho do nome
-- Quem chama tem de ser membro ativo (não 'pais') do clube da aba. Quem não é recebe a lista
-- vazia, como no resto das leituras escopadas; o responsável não vê a lista, pela mesma razão que
-- a RLS de profiles só lhe mostra o próprio perfil.
create or replace function public.membros_do_clube(
  p_papeis     text[] default null,
  p_unidade_id uuid   default null,
  p_status     text[] default array['ativo'],
  p_busca      text   default null)
returns table (id uuid, nome text, foto text, avatar jsonb, avatar_tipo text,
               papel text, unidade_id uuid, status text, teste boolean, aniversario text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_lideranca boolean;
  v_status text[];
  v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
begin
  if v_club is null or not public.membro_ativo_no_clube(v_club) then
    return;
  end if;
  v_lideranca := public.pode_gerir_no_clube(v_club) or public.pode_financeiro_no_clube(v_club);

  select coalesce(array_agg(distinct case s when 'inativo' then 'suspenso' when 'rejeitado' then 'encerrado' else s end), '{}')
    into v_status
    from unnest(coalesce(p_status, array['ativo'])) s;
  if not v_lideranca and not (v_status <@ array['ativo']) then
    raise exception 'Sem permissão: só a liderança do clube vê quem não está ativo.';
  end if;

  if v_busca is not null then
    -- o trecho é texto, não padrão: % e _ digitados pela pessoa não viram curinga
    v_busca := '%' || replace(replace(replace(v_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- Uma linha por pessoa. Com dois papéis no mesmo clube (ex.: conselheiro e responsável), vale o
  -- vínculo ativo, depois o que não é 'pais', depois o mais novo.
  return query
  select x.id, x.nome, x.foto, x.avatar, x.avatar_tipo, x.papel, x.unidade_id, x.status, x.teste, x.aniversario
    from (
      select distinct on (m.user_id)
             pf.id, pf.nome, pf.foto, pf.avatar, pf.avatar_tipo,
             m.role as papel, m.unidade_id, m.status,
             coalesce(pf.teste, false) as teste,
             to_char(pf.nascimento, 'MM-DD') as aniversario
        from public.organization_memberships m
        join public.profiles pf on pf.id = m.user_id
       where m.organizational_unit_id = v_club
         and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
         and m.status = any (v_status)
         and case when p_papeis is null then m.role <> 'pais' else m.role = any (p_papeis) end
         and (m.role <> 'pais' or v_lideranca)
         and (p_unidade_id is null or m.unidade_id = p_unidade_id)
         and (v_busca is null or pf.nome ilike v_busca)
       order by m.user_id, (m.status = 'ativo') desc, (m.role <> 'pais') desc, m.created_at desc, m.id desc
    ) x
   order by x.nome, x.id;
end;
$$;
revoke all on function public.membros_do_clube(text[], uuid, text[], text) from public, anon;
grant execute on function public.membros_do_clube(text[], uuid, text[], text) to authenticated;


-- -----------------------------------------------------------------------------
--  2. mensalidades_ano — quem abre a tela é o financeiro
-- -----------------------------------------------------------------------------
create or replace function public.mensalidades_ano(p_ano integer)
returns table (desbravador_id uuid, nome text, meses jsonb)
language sql stable security definer set search_path = '' as $$
  select p.id, p.nome,
         coalesce(jsonb_object_agg(m.mes::text, m.status) filter (where m.mes is not null), '{}'::jsonb)
    from public.profiles p
    join public.organization_memberships v
      on v.user_id = p.id and v.organizational_unit_id = public.clube_atual_id()
     and v.status = 'ativo' and v.role in ('desbravador', 'conselheiro')
     and v.starts_at <= now() and (v.ends_at is null or v.ends_at > now())
    left join public.mensalidades m
      on m.desbravador_id = p.id and m.ano = p_ano and m.club_id = public.clube_atual_id()
   -- Mensalidade é dinheiro do clube: lê quem cuida do caixa (tesoureiro ou diretoria), a mesma
   -- regra da RLS de mensalidades. Antes era a regra da GESTÃO (instrutor/diretoria), e o
   -- tesoureiro — o dono da tela — via a aba "Ano inteiro" vazia. Quem está ativo vem do VÍNCULO
   -- (v.status), nunca do espelho do perfil (o teste 29 trava isso).
   where public.pode_financeiro_no_clube(public.clube_atual_id())
   group by p.id, p.nome
   order by p.nome, p.id;
$$;


-- -----------------------------------------------------------------------------
--  3. vinculos_pendentes — só os pedidos do clube da aba
-- -----------------------------------------------------------------------------
create or replace function public.vinculos_pendentes()
returns json
language sql security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'id', r.id, 'nome_digitado', r.nome_digitado, 'criado_em', r.criado_em, 'responsavel', p.nome
  ) order by r.criado_em), '[]'::json)
  from public.responsaveis r
  join public.profiles p on p.id = r.responsavel_id
  -- `security definer` não passa pela RLS escopada de responsaveis: o filtro da aba tem de estar
  -- aqui. Sem ele, quem é liderança em A e em B via os pedidos dos dois clubes em qualquer aba.
  where r.status = 'pendente'
    and r.club_id = public.clube_atual_id()
    and public.pode_gerir_no_clube(r.club_id);
$$;


-- -----------------------------------------------------------------------------
--  4. resetar_senha_membro — a senha é da pessoa, não do clube
-- -----------------------------------------------------------------------------
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
  --    mais responsabilidade deste clube.
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

  -- 4. A senha vale para TODOS os clubes da pessoa. Se ela participa de outro, este clube não
  --    decide por ele: a criança de A+B ficaria sem acesso em A, e B passaria a conhecer a senha
  --    que ela usa em A. Aqui entra a recuperação pela própria pessoa (ou pelo responsável).
  if public._participa_de_outro_clube(alvo, v_club) then
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

  -- 5. Quem estava logado com a senha antiga sai: as sessões (e os refresh tokens delas) são
  --    apagadas, e o aparelho que estiver com a conta aberta pede login de novo quando o token de
  --    acesso atual vencer (até 1 hora). Quem redefine a PRÓPRIA senha não é derrubado.
  --    O dono desta função é o postgres, que tem DELETE em auth.sessions/refresh_tokens no
  --    Supabase local e no staging (conferido). Se um projeto não der essa permissão, a troca da
  --    senha continua valendo, e a auditoria registra que as sessões NÃO foram revogadas.
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


-- -----------------------------------------------------------------------------
--  5. listar_usuarios — sem o e-mail de ex-membro
-- -----------------------------------------------------------------------------
create or replace function public.listar_usuarios()
returns table (id uuid, nome text, foto text, papel text, status text, unidade_id uuid, email text, teste boolean)
language sql security definer set search_path = '' as $$
  select p.id, p.nome, p.foto, m.role,
    case m.status when 'ativo' then 'ativo' when 'pendente' then 'pendente' when 'encerrado' then 'rejeitado' else 'inativo' end,
    m.unidade_id,
    -- vínculo ENCERRADO aqui = ex-membro: a pessoa continua na lista (histórico), mas o e-mail dela
    -- não é mais assunto deste clube
    case when m.status = 'encerrado' then null else u.email::text end,
    coalesce(p.teste, false)
  from (
    select distinct on (user_id) *
    from public.organization_memberships
    where organizational_unit_id = public.clube_atual_id()
    order by user_id, (status in ('pendente', 'ativo') and starts_at <= now() and (ends_at is null or ends_at > now())) desc, created_at desc
  ) m
  join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = p.id
  where public.pode_gerir_no_clube(public.clube_atual_id())
  order by p.nome;
$$;


-- -----------------------------------------------------------------------------
--  6. profiles — a liderança não edita mais o perfil GLOBAL de terceiros
-- -----------------------------------------------------------------------------
-- A policy valia com lideranca_gere_usuario, que aceita vínculo PENDENTE: bastava a criança
-- digitar o código de um clube recém-criado por qualquer conta para essa conta poder renomeá-la,
-- trocar a foto que aparece em A e mudar o nascimento que decide a classe dela em A.
drop policy if exists "lideranca atualiza perfis do proprio clube" on public.profiles;

-- A flag de teste tira a pessoa do ranking e da pontuação de TODOS os clubes: não é algo que ela
-- mesma liga. Quem liga é a diretoria, por membro_definir_teste.
revoke update (teste) on public.profiles from authenticated;

-- Defesa em profundidade (se um grant futuro devolver a coluna): numa sessão de cliente, papel,
-- status, unidade e teste nunca mudam por UPDATE direto. As RPCs `security definer` rodam como o
-- dono e passam.
create or replace function public.protege_campos_perfil()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  new.papel := old.papel; new.status := old.status; new.unidade_id := old.unidade_id;
  new.teste := old.teste;
  if not public.lideranca_gere_usuario(old.id) then
    new.cargo := old.cargo;
  end if;
  return new;
end;
$$;

-- A diretoria do clube da aba liga/desliga o modo teste de uma conta — só de quem é SÓ deste
-- clube e está ativo aqui. A flag é da conta inteira; num clube só não se decide pelos outros.
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
  if public._participa_de_outro_clube(p_usuario_id, v_club) then
    raise exception 'Esta pessoa também participa de outro clube: o modo teste vale para a conta inteira, então não pode ser ligado ou desligado por um clube só.';
  end if;
  update public.profiles set teste = coalesce(p_teste, false) where id = p_usuario_id;
  perform public._auditar('membro_teste', v_club, p_usuario_id, jsonb_build_object('teste', coalesce(p_teste, false)));
end;
$$;
revoke all on function public.membro_definir_teste(uuid, boolean) from public, anon;
grant execute on function public.membro_definir_teste(uuid, boolean) to authenticated;

-- A liderança do clube da aba troca (ou tira) a foto de perfil de alguém — com as mesmas travas.
-- A própria pessoa continua trocando a dela direto (Perfil), como sempre.
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
  if public._participa_de_outro_clube(p_usuario_id, v_club) then
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
