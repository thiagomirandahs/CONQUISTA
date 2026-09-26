-- A 210 trocou a permissão ampla (pode_gerir_no_clube = diretoria|instrutor) pela capacidade certa nas
-- funções que existiam quando foi escrita. Estas chegaram no mesmo dia (170, 171, 190) e ficaram de fora:
--   * cartão da vitrine e nascimento de outro membro  -> só DIRETORIA (pode_administrar_clube)
--   * cancelar classe de um membro / listar classes dele -> quem avalia currículo (diretoria|instrutor)
-- Mesmo método da 210: lê a definição viva e troca só a checagem; falha se não achar o trecho.
do $$
declare r record; v_def text; v_novo text;
begin
  for r in select * from (values
      ('_nascimento_pode_editar', 'pode_administrar_clube'),
      ('vitrine_clube_ler', 'pode_administrar_clube'),
      ('vitrine_clube_salvar', 'pode_administrar_clube'),
      ('classe_cancelar', 'pode_avaliar_curriculo'),
      ('classes_do_membro', 'pode_avaliar_curriculo')) as t(fn, cap) loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_def is null then raise exception 'Função % não encontrada.', r.fn; end if;
    if position('pode_gerir_no_clube' in v_def) = 0 then continue; end if;   -- já trocada
    v_novo := replace(v_def, 'public.pode_gerir_no_clube(', 'public.' || r.cap || '(');
    v_novo := replace(v_novo, ' pode_gerir_no_clube(', ' public.' || r.cap || '(');
    if position('pode_gerir_no_clube' in v_novo) > 0 then raise exception 'Sobrou checagem ampla em %.', r.fn; end if;
    execute v_novo;
  end loop;
end $$;
