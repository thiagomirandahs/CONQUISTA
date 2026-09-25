-- Acrescenta vinculo_id + consentimento_ativo em meus_filhos() — pra Meu Filho (responsável) poder
-- conceder/ver o consentimento (migration 93) sem uma segunda RPC. Resto do corpo idêntico à
-- migration 81 (mesma consulta, mesmos filtros — só os 2 campos novos no json_build_object).
create or replace function public.meus_filhos()
returns json
language sql security definer set search_path = '' as $$
  select coalesce(json_agg(f order by f->>'nome'), '[]'::json) from (
    select json_build_object(
      'id', c.id, 'vinculo_id', r.id, 'nome', c.nome, 'foto', c.foto, 'unidade', u.nome,
      'pontos', coalesce((select sum(pontos)::int from public.pontos where usuario_id = c.id and club_id = r.club_id), 0),
      -- a chamada grava naHora/atrasado/faltou; 'presente' ficou de dado antigo
      'presencas', coalesce((select count(*) from public.pontos
                    where usuario_id = c.id and club_id = r.club_id and origem = 'apontamento'
                      and marca->>'presenca' in ('naHora', 'atrasado', 'presente')), 0),
      'faltas', coalesce((select count(*) from public.pontos
                    where usuario_id = c.id and club_id = r.club_id and origem = 'apontamento' and marca->>'presenca' = 'faltou'), 0),
      'mensalidades_pendentes', coalesce((
                    select json_agg(json_build_object('mes', m.mes, 'ano', m.ano, 'valor', m.valor) order by m.ano, m.mes)
                    from public.mensalidades m where m.desbravador_id = c.id and m.club_id = r.club_id and m.status = 'pendente'), '[]'::json),
      'consentimento_id', (select id from public.responsavel_consentimentos rc
                            where rc.responsavel_id = r.responsavel_id and rc.desbravador_id = c.id and rc.club_id = r.club_id and rc.revogado_em is null
                            limit 1)
    ) as f
    from public.responsaveis r
    join public.profiles c on c.id = r.desbravador_id
    left join public.unidades u on u.id = public.unidade_no_clube(c.id, r.club_id)
    where r.responsavel_id = auth.uid() and r.status = 'aprovado'
      and r.club_id = public.clube_atual_id()
  ) t;
$$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-meus-filhos-com-consentimento.sql')
on conflict (arquivo) do update set aplicada_em = now();
