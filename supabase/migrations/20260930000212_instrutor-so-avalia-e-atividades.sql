-- Decisão do dono (26/09, confirmada): a Gestão do instrutor/capelão fica SÓ com Avaliações (classes,
-- especialidades, investidura, documentos), Desafios/Conteúdo, Missões e Experiências. Pontos manuais,
-- apontamentos, modo acampamento, moderação do chat, avisos, jogos/leilão/duelos/chefão e radar passam a
-- ser da DIRETORIA (conselheiro continua apontando a própria unidade — ramo próprio de pode_apontar).
-- Método da 210/211: lê a definição viva e troca só a checagem ampla.
do $$
declare r record; v_def text; v_novo text; v_pol record; v_q text; v_c text;
begin
  for r in select unnest(array['cancelar_duelo','cancelar_leilao','chat_apagar_mensagem','chat_todas_conversas','chefao_config',
      'criar_leilao','encerrar_leilao','julgar_duelo','lancar_colocacao_acampamento','liberar_jogo','trancar_jogo',
      'atividade_jogos','pode_apontar']) as fn loop
    for v_def in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = r.fn loop
      if position('pode_gerir_no_clube' in v_def) = 0 then continue; end if;
      v_novo := replace(v_def, 'public.pode_gerir_no_clube(', 'public.pode_administrar_clube(');
      v_novo := replace(v_novo, ' pode_gerir_no_clube(', ' public.pode_administrar_clube(');
      if position('pode_gerir_no_clube' in v_novo) > 0 then raise exception 'Sobrou checagem ampla em %.', r.fn; end if;
      execute v_novo;
    end loop;
  end loop;

  for v_pol in select c.relname tabela, p.polname, pg_get_expr(p.polqual, p.polrelid) q, pg_get_expr(p.polwithcheck, p.polrelid) c
                 from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public'
                  and (c.relname, p.polname) in (('pontos','lideranca apaga pontos do proprio clube'), ('pontos','lideranca lanca pontos do proprio clube'),
                                                 ('notificacoes','lideranca cria notificacoes do proprio clube'), ('jogos_trilha','lideranca gere o catalogo de jogos do proprio clube')) loop
    v_q := replace(v_pol.q, 'pode_gerir_no_clube(', 'pode_administrar_clube(');
    v_c := replace(v_pol.c, 'pode_gerir_no_clube(', 'pode_administrar_clube(');
    if v_q is not null then execute format('alter policy %I on public.%I using (%s)', v_pol.polname, v_pol.tabela, v_q); end if;
    if v_c is not null then execute format('alter policy %I on public.%I with check (%s)', v_pol.polname, v_pol.tabela, v_c); end if;
  end loop;
end $$;
