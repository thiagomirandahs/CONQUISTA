-- Limpeza das comprovações de ATIVIDADES e MISSÕES 7 dias após a avaliação (migration 553):
-- avaliado_em marcado/zerado pelo status; só sai o que foi avaliado há 7+ dias; vai para a fila segura da 532 já liberado;
-- pendente e avaliado recente ficam; requisito de classe não é tocado; vídeo legado tem dono reconhecido; só o serviço roda.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- avaliado_em acompanha o status ----------
\o /dev/null
update public.entregas set foto_url = t.id('membro_a') || '/atividades/111.jpg' where atividade_id = t.id('atv_a') and usuario_id = t.id('membro_a');
\o
select t.ok('entrega pendente: sem avaliado_em', (select avaliado_em is null from public.entregas where atividade_id = t.id('atv_a') and usuario_id = t.id('membro_a')));
\o /dev/null
update public.entregas set status = 'aprovada' where atividade_id = t.id('atv_a') and usuario_id = t.id('membro_a');
\o
select t.ok('aprovar marca avaliado_em', (select avaliado_em is not null from public.entregas where atividade_id = t.id('atv_a') and usuario_id = t.id('membro_a')));
\o /dev/null
update public.entregas set status = 'pendente' where atividade_id = t.id('atv_a') and usuario_id = t.id('membro_a');
\o
select t.ok('reenviar (pendente) zera avaliado_em', (select avaliado_em is null from public.entregas where atividade_id = t.id('atv_a') and usuario_id = t.id('membro_a')));

-- ---------- cenário: avaliada há 8 dias (sai), há 3 dias (fica), pendente (fica) ----------
\o /dev/null
update public.entregas set status = 'aprovada' where atividade_id = t.id('atv_a') and usuario_id = t.id('membro_a');
update public.entregas set avaliado_em = now() - interval '8 days' where atividade_id = t.id('atv_a') and usuario_id = t.id('membro_a');
update public.entregas set foto_url = t.id('membro_b') || '/atividades/222.jpg', status = 'reprovada' where atividade_id = t.id('atv_b') and usuario_id = t.id('membro_b');
update public.entregas set avaliado_em = now() - interval '3 days' where atividade_id = t.id('atv_b') and usuario_id = t.id('membro_b');
insert into public.missoes_feitas (usuario_id, data, foto_url, status, club_id)
  values (t.id('membro_a'), current_date - 20, t.id('membro_a') || '/missoes/333.jpg', 'pendente', t.id('clube_a'));
insert into public.missoes_feitas (usuario_id, data, foto_url, status, club_id)
  values (t.id('membro_a'), current_date - 21, t.id('membro_a') || '/missoes/444.jpg', 'aprovada', t.id('clube_a'));
update public.missoes_feitas set avaliado_em = now() - interval '10 days' where foto_url like '%/missoes/444.jpg';
\o
select md5(coalesce(string_agg(id::text || coalesce(evidencia_path, '-'), ',' order by id), '')) as req_antes from public.member_requirements \gset

-- ninguém do app roda a limpeza
select t.como('lider_a');
select t.throws('liderança não roda a limpeza', 'select public.comprovacoes_expirar()', 'permission denied');
reset role;
select t.como_anon();
select t.throws('anônimo não roda a limpeza', 'select public.comprovacoes_expirar()', 'permission denied');
reset role;

select t.como_service();
select set_config('t153.r', public.comprovacoes_expirar()::text, true);
reset role;
select t.eq('1 entrega e 1 missão limpas', ((current_setting('t153.r')::jsonb ->> 'entregas')::int * 10 + (current_setting('t153.r')::jsonb ->> 'missoes')::int)::bigint, 11::bigint);
select t.ok('entrega avaliada há 8 dias: foto some do registro e fica a marca de apagada',
  (select foto_url is null and foto_apagada_em is not null and status = 'aprovada' from public.entregas where atividade_id = t.id('atv_a') and usuario_id = t.id('membro_a')));
select t.ok('entrega avaliada há 3 dias: continua com a foto', (select foto_url is not null and foto_apagada_em is null from public.entregas where atividade_id = t.id('atv_b') and usuario_id = t.id('membro_b')));
select t.ok('missão pendente: continua com a foto', (select foto_url is not null from public.missoes_feitas where foto_url like '%/missoes/333.jpg'));
select t.ok('missão avaliada há 10 dias: limpa', (select foto_apagada_em is not null and foto_url is null from public.missoes_feitas where status = 'aprovada' and data = current_date - 21));
select t.eq('os 2 arquivos entraram na fila segura, já liberados para processar (dono confere)',
  (select count(*) from public.storage_exclusao_fila where estado = 'pendente' and processar_apos <= now() and dono_confere
     and caminho in (t.id('membro_a') || '/atividades/111.jpg', t.id('membro_a') || '/missoes/444.jpg')), 2::bigint);
select t.eq('o arquivo da entrega recente NÃO entrou na fila', (select count(*) from public.storage_exclusao_fila where caminho like '%/atividades/222.jpg'), 0::bigint);
select t.ok('requisito de classe não foi tocado',
  (select md5(coalesce(string_agg(id::text || coalesce(evidencia_path, '-'), ',' order by id), '')) from public.member_requirements) = :'req_antes');
select t.eq('rodar de novo não faz nada', ((select public.comprovacoes_expirar()) ->> 'entregas')::bigint, 0::bigint);

-- ---------- regra de dono do vídeo legado ----------
select t.ok('legado atividades/<atividade>-<dono>-<ts>.mp4: dono reconhecido',
  public._storage_exclusao_dono_confere('atividades/' || t.id('atv_a') || '-' || t.id('membro_a') || '-1785.mp4', t.id('membro_a')));
select t.ok('...e outra pessoa NÃO passa por dona', not public._storage_exclusao_dono_confere('atividades/' || t.id('atv_a') || '-' || t.id('membro_a') || '-1785.mp4', t.id('membro_b')));
select t.ok('formato normal continua valendo', public._storage_exclusao_dono_confere(t.id('membro_a') || '/atividades/9.jpg', t.id('membro_a')));

-- ---------- limites ----------
select t.eq('vídeo de comprovação até 20 MB', (select file_size_limit from storage.buckets where id = 'comprovacoes'), 20971520::bigint);
select t.eq('cron diário agendado', (select count(*) from cron.job where jobname = 'comprovacoes-expirar'), 1::bigint);

select t.fim();
rollback;
