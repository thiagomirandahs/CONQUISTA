-- =====================================================================
--  Filhos da Conquista — Melhorias "DEPOIS" da varredura (2026-07-06)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole TUDO -> Run.
--  Idempotente. Pode rodar depois dos outros SQLs de 2026-07-06.
--
--  Resolve (lado do banco):
--    #21 Índices nas tabelas que mais crescem (telas rápidas com o tempo)
--    #21 Teto anti-abuso pros pontos do conselheiro (via API)
--    #22 Aviso de aniversário leva pra tela certa (/unidades)
-- =====================================================================


-- ---------------------------------------------------------------------
-- #21  ÍNDICES: mantêm ranking, apontamentos, entregas e sino rápidos
--      conforme o clube acumula meses/anos de dados.
-- ---------------------------------------------------------------------
create index if not exists idx_pontos_usuario   on public.pontos(usuario_id);
create index if not exists idx_pontos_unidade    on public.pontos(unidade_id);
create index if not exists idx_pontos_data        on public.pontos(data desc);
create index if not exists idx_pontos_entrega     on public.pontos(entrega_id);
create index if not exists idx_entregas_status    on public.entregas(status);
create index if not exists idx_entregas_usuario   on public.entregas(usuario_id);
create index if not exists idx_notificacoes_para_usuario on public.notificacoes(para_usuario);


-- ---------------------------------------------------------------------
-- #21  TETO do conselheiro: pontos INDIVIDUAIS de quem não é liderança
--      ficam limitados a +/- 100 por lançamento. Barra abuso via API
--      (um adolescente com DevTools não despeja 999999 num favorito).
--      O app usa valores fixos bem menores, então nada legítimo é afetado.
-- ---------------------------------------------------------------------
create or replace function public.limita_pontos_conselheiro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.usuario_id is not null and auth.uid() is not null and not public.pode_gerir() then
    new.pontos := greatest(-100, least(100, coalesce(new.pontos, 0)));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_limita_pontos_conselheiro on public.pontos;
create trigger trg_limita_pontos_conselheiro before insert on public.pontos
  for each row execute function public.limita_pontos_conselheiro();


-- ---------------------------------------------------------------------
-- #22  Aviso de aniversário leva pra /unidades (onde fica o card de
--      aniversariantes), não pra /ranking.
-- ---------------------------------------------------------------------
create or replace function public.notif_aniversariantes_hoje()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select nome from public.profiles
    where status = 'ativo' and nascimento is not null
      and to_char(nascimento, 'MM-DD') = to_char((now() at time zone 'America/Sao_Paulo'), 'MM-DD')
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🎂 Aniversário hoje!',
            'Hoje é aniversário de ' || coalesce(r.nome, 'um membro') || '. Mande os parabéns! 🥳',
            'aniversario', '/unidades', 'todos');
  end loop;
end;
$$;


notify pgrst, 'reload schema';
