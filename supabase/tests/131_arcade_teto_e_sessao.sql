-- Migration 131: teto anti-cheat do arcade realista + sessão de replays deslizante.
--   * reflexo: nível 122 em ~80 s (caso real de produção) é ACEITO; absurdos continuam recusados;
--   * corrida: teto = máximo físico do jogo (1,8/s + 5);
--   * teto absoluto de 500 mantido;
--   * partida arcade não expira enquanto há atividade (30 min desde o último envio, até 6 h);
--     parada há mais de 30 min e fora da validade original = recusada.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- abre uma partida arcade como p_quem e "volta no tempo" o início / último envio / validade
create function t.partida_arcade(p_quem text, p_jogo text, p_ini interval, p_ult interval, p_val interval)
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform t.como(p_quem);
  v := (public.iniciar_jogo(p_jogo)->>'id')::uuid;
  reset role;
  update public.partidas
     set iniciado_em = now() - p_ini,
         ultima_submissao_em = case when p_ult is null then null else now() - p_ult end,
         validade_em = now() + p_val
   where id = v;
  return v;
end $$;
grant execute on function t.partida_arcade(text, text, interval, interval, interval) to public;

-- ---------- a função do teto ----------
select t.eq('reflexo: 80 s → teto 208', public._max_pontos_arcade('reflexo', 80), 208);
select t.eq('corrida: 80 s → teto 149', public._max_pontos_arcade('corrida', 80), 149);
select t.eq('outros jogos: regra antiga intacta (80 s → 165)', public._max_pontos_arcade('memoria', 80), 165);

select t.como('lider_a');
select t.permitido('líder A liga reflexo e corrida', $q$update public.jogos_trilha set ativo = true where chave in ('reflexo', 'corrida')$q$, 2);

-- ---------- reflexo: o caso real ----------
select set_config('t.p1', t.partida_arcade('membro_a', 'reflexo', interval '80 seconds', null, interval '10 minutes')::text, true);
select t.como('membro_a');
select t.eq('reflexo: nível 122 em 80 s é ACEITO (antes: "não bate com o tempo")',
  t.txt(format($q$select public.registrar_recorde('reflexo', 122, %L::uuid)->>'recorde'$q$, current_setting('t.p1'))), '122');

select set_config('t.p2', t.partida_arcade('membro_a', 'reflexo', interval '80 seconds', null, interval '10 minutes')::text, true);
select t.como('membro_a');
select t.throws('reflexo: 300 em 80 s continua RECUSADO',
  format($q$select public.registrar_recorde('reflexo', 300, %L::uuid)$q$, current_setting('t.p2')), 'não bate com o tempo');

select set_config('t.p3', t.partida_arcade('membro_a', 'reflexo', interval '10 seconds', null, interval '10 minutes')::text, true);
select t.como('membro_a');
select t.throws('reflexo: 500 em 10 s continua RECUSADO',
  format($q$select public.registrar_recorde('reflexo', 500, %L::uuid)$q$, current_setting('t.p3')), 'não bate com o tempo');

select set_config('t.p4', t.partida_arcade('membro_a', 'reflexo', interval '2 seconds', null, interval '10 minutes')::text, true);
select t.como('membro_a');
select t.throws('reflexo: < 3 s continua "rápido demais"',
  format($q$select public.registrar_recorde('reflexo', 1, %L::uuid)$q$, current_setting('t.p4')), 'Rápido demais');

select set_config('t.p5', t.partida_arcade('membro_a', 'reflexo', interval '2 hours', null, interval '10 minutes')::text, true);
select t.como('membro_a');
select t.eq('teto absoluto 500 mantido (9999 vira 500)',
  t.txt(format($q$select public.registrar_recorde('reflexo', 9999, %L::uuid)->>'recorde'$q$, current_setting('t.p5'))), '500');

-- ---------- corrida ----------
select set_config('t.c1', t.partida_arcade('membro_a', 'corrida', interval '80 seconds', null, interval '10 minutes')::text, true);
select t.como('membro_a');
select t.eq('corrida: 140 em 80 s é aceito',
  t.txt(format($q$select public.registrar_recorde('corrida', 140, %L::uuid)->>'recorde'$q$, current_setting('t.c1'))), '140');
select set_config('t.c2', t.partida_arcade('membro_a', 'corrida', interval '80 seconds', null, interval '10 minutes')::text, true);
select t.como('membro_a');
select t.throws('corrida: 200 em 80 s é RECUSADO',
  format($q$select public.registrar_recorde('corrida', 200, %L::uuid)$q$, current_setting('t.c2')), 'não bate com o tempo');

-- ---------- sessão deslizante ----------
select set_config('t.s1', t.partida_arcade('membro_a', 'reflexo', interval '40 minutes', interval '10 minutes', interval '-25 minutes')::text, true);
select t.como('membro_a');
select t.eq('partida além dos 15 min, mas com envio há 10 min: ACEITA',
  t.txt(format($q$select public.registrar_recorde('reflexo', 20, %L::uuid)->>'recorde'$q$, current_setting('t.s1'))), '500'); -- 500 = recorde da semana (caso do teto absoluto)

select set_config('t.s2', t.partida_arcade('membro_a', 'reflexo', interval '20 minutes', null, interval '-5 minutes')::text, true);
select t.como('membro_a');
select t.eq('corrida longa (20 min sem envio) numa partida vencida: ACEITA',
  t.txt(format($q$select public.registrar_recorde('reflexo', 30, %L::uuid)->>'recorde'$q$, current_setting('t.s2'))), '500');

select set_config('t.s3', t.partida_arcade('membro_a', 'reflexo', interval '2 hours', interval '40 minutes', interval '-105 minutes')::text, true);
select t.como('membro_a');
select t.throws('parada há 40 min e vencida: RECUSADA',
  format($q$select public.registrar_recorde('reflexo', 10, %L::uuid)$q$, current_setting('t.s3')), 'Partida inválida ou expirada');

select set_config('t.s4', t.partida_arcade('membro_a', 'reflexo', interval '7 hours', interval '5 minutes', interval '-6 hours')::text, true);
select t.como('membro_a');
select t.throws('mais de 6 h desde o início: RECUSADA mesmo com atividade',
  format($q$select public.registrar_recorde('reflexo', 10, %L::uuid)$q$, current_setting('t.s4')), 'Partida inválida ou expirada');

-- partida de OUTRA pessoa continua não valendo
select set_config('t.o1', t.partida_arcade('membro_a2', 'reflexo', interval '80 seconds', null, interval '10 minutes')::text, true);
select t.como('membro_a');
select t.throws('partida de outro usuário: RECUSADA',
  format($q$select public.registrar_recorde('reflexo', 10, %L::uuid)$q$, current_setting('t.o1')), 'Partida inválida');

-- sem partida (exigir_partida padrão 'nao'): aceito — é o caminho do reenvio offline de partida vencida
select t.como('membro_a');
select t.eq('sem partida (exigir_partida desligado): aceito',
  t.txt($q$select public.registrar_recorde('corrida', 7)->>'recorde'$q$), '140');

select t.fim();
rollback;
