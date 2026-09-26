-- Nome de clube ÚNICO (pedido do dono, 26/09): evitar que alguém crie de novo um clube que já está
-- cadastrado ("Filhos da Conquista" x "filhos da conquista" x "Filhos da Conquísta"). A comparação ignora
-- maiúsculas, acentos, espaços e pontuação. Vale para criar (onboarding) e para renomear. Clubes
-- excluídos (lixeira de clubes) não bloqueiam o nome.
create or replace function public._nome_de_clube_normalizado(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
           translate(lower(coalesce(p, '')),
                     'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
           '[^a-z0-9]', '', 'g');
$$;

create or replace function public._exigir_nome_de_clube_unico() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type <> 'clube' or coalesce(new.status, '') = 'excluido' then return new; end if;
  if tg_op = 'UPDATE' and public._nome_de_clube_normalizado(new.nome) = public._nome_de_clube_normalizado(old.nome) then
    return new;
  end if;
  if exists (
    select 1 from public.organizational_units o
     where o.type = 'clube' and o.id <> new.id and coalesce(o.status, '') <> 'excluido'
       and public._nome_de_clube_normalizado(o.nome) = public._nome_de_clube_normalizado(new.nome)
  ) then
    raise exception 'Já existe um clube chamado "%" no DesbravaClube. Se é o seu clube, não crie outro: cadastre-se e escolha esse clube na lista para pedir a entrada, ou fale com a diretoria dele.', new.nome
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_nome_de_clube_unico on public.organizational_units;
create trigger trg_nome_de_clube_unico
  before insert or update of nome, status on public.organizational_units
  for each row execute function public._exigir_nome_de_clube_unico();
