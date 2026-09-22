-- Depois de aplicar 20260921000001..17 sobre o estado de produção simulado (pre_dados.sql):
-- nenhum dado se perdeu, todo mundo ganhou o vínculo certo e os fluxos do Tenant 001 seguem funcionando.
begin;
\ir ../_lib.sql

insert into t.ids (chave, id)
select k, md5('up:' || k)::uuid from unnest(array['dir','ins','tes','con','d1','d2','d3','pend','rej','pai']) k;
insert into t.ids (chave, id) select 'clube', id from public.organizational_units where slug = 'filhos-da-conquista';
insert into t.ids (chave, id) select 'aguias', id from public.unidades where nome = 'Águias';
insert into t.ids (chave, id) select 'leoes', id from public.unidades where nome = 'Leões';

-- ---------- 1) nenhum dado se perdeu ----------
select t.eq('pontos preservados', (select count(*) from public.pontos where origem <> 'leilao'), :pre_pontos::bigint);
select t.eq('soma dos pontos preservada', (select coalesce(sum(pontos), 0) from public.pontos where origem <> 'leilao'), :pre_soma_pontos::bigint);
select t.eq('fotos preservadas', (select count(*) from public.fotos), :pre_fotos::bigint);
select t.eq('atividades preservadas', (select count(*) from public.atividades), :pre_atividades::bigint);
select t.eq('entregas preservadas', (select count(*) from public.entregas), :pre_entregas::bigint);
select t.eq('config do clube preservada, toda no Tenant 001 (chave composta)', (select count(*) from public.config_clube where club_id = public.clube_legado_id()), :pre_config::bigint);
select t.eq('duelos preservados, todos no Tenant 001', (select count(*) from public.duelos where club_id = public.clube_legado_id()), :pre_duelos::bigint);
select t.eq('catálogo de desafios de unidade preservado, todo no Tenant 001', (select count(*) from public.desafios_unidade where club_id = public.clube_legado_id()), :pre_desafios::bigint);
select t.eq('missões feitas preservadas, todas no Tenant 001', (select count(*) from public.missoes_feitas where club_id = public.clube_legado_id()), :pre_missoes::bigint);
select t.eq('devocional preservado, todo no Tenant 001', (select count(*) from public.devocional where club_id = public.clube_legado_id()), :pre_devocional::bigint);
select t.eq('jogadas da trilha preservadas, todas no Tenant 001', (select count(*) from public.trilha_jogos where club_id = public.clube_legado_id()), :pre_trilha::bigint);
select t.eq('recordes arcade preservados, todos no Tenant 001', (select count(*) from public.recordes where club_id = public.clube_legado_id()), :pre_recordes::bigint);
select t.eq('liberações de jogo preservadas, todas no Tenant 001', (select count(*) from public.jogos_liberados where club_id = public.clube_legado_id()), :pre_liberados::bigint);
select t.eq('golpes do chefão e partidas preservados no Tenant 001', (select count(*) from public.chefao_golpes where club_id = public.clube_legado_id()) * 100 + (select count(*) from public.partidas where club_id = public.clube_legado_id()), (:pre_golpes::bigint * 100) + :pre_partidas::bigint);
select t.eq('catálogo de jogos preservado (liga/desliga do Tenant 001 intacto), todo no clube legado', (select count(*) from public.jogos_trilha where club_id = public.clube_legado_id()), :pre_catalogo::bigint);
select t.eq('chat preservado (mensagens e conversas), todo no Tenant 001', (select count(*) from public.chat_mensagens where club_id = public.clube_legado_id()) * 100 + (select count(*) from public.chat_conversas where club_id = public.clube_legado_id()), (:pre_chat_msgs::bigint * 100) + :pre_chat_conv::bigint);
select t.eq('bichinhos e leituras da Bíblia preservados, todos no Tenant 001', (select count(*) from public.bichinhos where club_id = public.clube_legado_id()) * 100 + (select count(*) from public.biblia_leituras where club_id = public.clube_legado_id()), (:pre_bichinhos::bigint * 100) + :pre_biblia::bigint);
select t.eq('conteúdo (missões do dia e versículos) preservado, todo no Tenant 001', (select count(*) from public.desafios where club_id = public.clube_legado_id()) * 1000 + (select count(*) from public.versiculos where club_id = public.clube_legado_id()), (:pre_cat_desafios::bigint * 1000) + :pre_cat_versiculos::bigint);
select t.eq('mensalidades preservadas', (select count(*) from public.mensalidades), :pre_mensalidades::bigint);
select t.eq('mensalidades órfãs (sem dono) preservadas e no clube legado', (select count(*) from public.mensalidades where desbravador_id is null and club_id = public.clube_legado_id()), 2);
select t.eq('eventos preservados', (select count(*) from public.eventos), :pre_eventos::bigint);
select t.eq('notificações preservadas', (select count(*) from public.notificacoes), :pre_notificacoes::bigint);
select t.eq('perfis preservados', (select count(*) from public.profiles), :pre_perfis::bigint);
select t.eq('unidades preservadas', (select count(*) from public.unidades), :pre_unidades::bigint);
select t.eq('vínculos de responsável preservados', (select count(*) from public.responsaveis), :pre_responsaveis::bigint);
select t.eq('lances de leilão preservados', (select count(*) from public.leilao_lances), :pre_lances::bigint);
select t.eq('todo dado ganhou clube (nada órfão): pontos', (select count(*) from public.pontos where club_id is null), 0);
select t.eq('todo dado ganhou o clube LEGADO: fotos', (select count(*) from public.fotos where club_id <> t.id('clube')), 0);
select t.eq('todo dado ganhou o clube LEGADO: unidades', (select count(*) from public.unidades where club_id <> t.id('clube')), 0);
select t.eq('todo dado ganhou o clube LEGADO: notificações', (select count(*) from public.notificacoes where club_id <> t.id('clube')), 0);
select t.eq('todo dado ganhou o clube LEGADO: responsáveis', (select count(*) from public.responsaveis where club_id <> t.id('clube')), 0);

-- ---------- 2) vínculos: um por pessoa, no clube legado, com papel/status certos ----------
select t.eq('todo perfil tem exatamente 1 vínculo de clube', (select count(*) from public.profiles p where (select count(*) from public.organization_memberships m where m.user_id = p.id) <> 1), 0);
select t.eq('todos no clube legado', (select count(*) from public.organization_memberships where organizational_unit_id <> t.id('clube')), 0);
select t.eq('diretoria: vínculo diretoria ativo', (select role || '/' || status from public.organization_memberships where user_id = t.id('dir')), 'diretoria/ativo');
select t.eq('instrutor: vínculo instrutor ativo', (select role || '/' || status from public.organization_memberships where user_id = t.id('ins')), 'instrutor/ativo');
select t.eq('tesoureiro: vínculo tesoureiro ativo', (select role || '/' || status from public.organization_memberships where user_id = t.id('tes')), 'tesoureiro/ativo');
select t.eq('conselheiro: vínculo conselheiro ativo', (select role || '/' || status from public.organization_memberships where user_id = t.id('con')), 'conselheiro/ativo');
select t.eq('desbravador ativo', (select role || '/' || status from public.organization_memberships where user_id = t.id('d1')), 'desbravador/ativo');
select t.eq('desativado vira suspenso', (select role || '/' || status from public.organization_memberships where user_id = t.id('d3')), 'desbravador/suspenso');
select t.eq('cadastro pendente vira vínculo pendente (a diretoria passa a ver)', (select role || '/' || status from public.organization_memberships where user_id = t.id('pend')), 'desbravador/pendente');
select t.eq('cadastro rejeitado vira vínculo encerrado', (select role || '/' || status from public.organization_memberships where user_id = t.id('rej')), 'desbravador/encerrado');
select t.eq('responsável: papel padronizado em pais (nunca responsavel)', (select role || '/' || status from public.organization_memberships where user_id = t.id('pai')), 'pais/ativo');
select t.eq('a reconciliação não tem mais nada a ajustar', t.n('select public.reconciliar_perfis_dos_vinculos()'), 0);

-- ---------- 3) cada papel enxerga o que deve ----------
select t.como('dir');
select t.eq('diretoria vê todos os perfis pela tela Usuários (inclusive pendente/rejeitado/inativo)', t.n('select count(*) from public.listar_usuarios()'), :pre_perfis::bigint);
select t.eq('diretoria vê todos os pontos', t.n('select count(*) from public.pontos'), (:pre_pontos::bigint));
select t.eq('diretoria vê as fotos', t.n('select count(*) from public.fotos'), :pre_fotos::bigint);
select t.eq('diretoria lê o PIX', t.txt($q$select valor from public.config_clube where chave = 'pix'$q$), 'PIX-DE-PRODUCAO');
select t.eq('ranking: totais por pessoa iguais aos de antes do upgrade',
  t.txt($q$select string_agg(x->>'id' || ':' || (x->>'total'), ',' order by x->>'id') from json_array_elements(public.ranking_totais()->'pessoas') x$q$), :'pre_totais_pessoas');
select t.como('d1');
select t.eq('membro vê os pontos do clube (como sempre)', t.n('select count(*) from public.pontos'), :pre_pontos::bigint);
select t.eq('membro vê as fotos do clube', t.n('select count(*) from public.fotos'), :pre_fotos::bigint);
select t.eq('membro vê o aviso pessoal e os gerais (2 gerais + 1 pessoal + avisos automáticos)', t.n($q$select count(*) from public.notificacoes where titulo in ('Aviso geral 1','Aviso geral 2','Recado do d1')$q$), 3);
select t.eq('membro lê o PIX', t.txt($q$select valor from public.config_clube where chave = 'pix'$q$), 'PIX-DE-PRODUCAO');
select t.como('pai');
select t.eq('responsável: só o próprio perfil', t.n('select count(*) from public.profiles'), 1);
select t.eq('responsável: nenhum ponto', t.nv('select count(*) from public.pontos'), 0);
select t.eq('responsável: nenhuma foto', t.nv('select count(*) from public.fotos'), 0);
select t.eq('responsável: nenhuma entrega', t.nv('select count(*) from public.entregas'), 0);
select t.eq('responsável: Meus Filhos devolve o filho aprovado', t.txt('select public.meus_filhos()->0->>''nome'''), 'Desbravador 1');
select t.eq('responsável: Meus Filhos traz os pontos do filho', t.txt('select public.meus_filhos()->0->>''pontos'''), '30');
select t.eq('responsável ainda lê o PIX (paga a mensalidade)', t.txt($q$select valor from public.config_clube where chave = 'pix'$q$), 'PIX-DE-PRODUCAO');
select t.eq('contexto do responsável: papel "pais" no vínculo do clube legado, sem unidade', t.txt('select (public.meu_contexto()->''vinculos''->0->>''papel'') || ''|'' || coalesce(public.meu_contexto()->''vinculos''->0->>''unidade_id'', ''sem-unidade'')'), 'pais|sem-unidade');
select t.como('pend');
select t.eq('cadastro pendente: só o próprio perfil', t.n('select count(*) from public.profiles'), 1);
select t.eq('cadastro pendente: nada do clube', t.nv('select count(*) from public.pontos') + t.nv('select count(*) from public.fotos'), 0);
select t.como('d3');
select t.eq('desativado: nada do clube', t.nv('select count(*) from public.pontos') + t.nv('select count(*) from public.fotos'), 0);
select t.como('rej');
select t.eq('rejeitado: nada do clube', t.nv('select count(*) from public.pontos') + t.nv('select count(*) from public.fotos'), 0);

-- ---------- 4) os fluxos do dia a dia seguem funcionando ----------
select t.como('dir');
select t.permitido('diretoria aprova o cadastro pendente', format($q$select public.vinculo_gerir(%L, p_status := 'ativo')$q$, t.id('pend')));
select t.permitido('diretoria reativa o desativado', format($q$select public.vinculo_gerir(%L, p_status := 'ativo')$q$, t.id('d3')));
select t.permitido('diretoria redefine a senha do instrutor', format($q$select public.resetar_senha_membro(%L, 'senha-nova-123')$q$, t.id('ins')));
select t.permitido('diretoria exclui o cadastro rejeitado', format('select public.excluir_usuario(%L)', t.id('rej')));
select t.como('ins');
select t.throws('instrutor NÃO promove a diretoria (erro claro, nada muda)', format($q$select public.vinculo_gerir(%L, p_papel := 'diretoria')$q$, t.id('d1')), 'diretoria');
select t.como('d1');
select t.permitido('o aparelho de push segue quem está logado (RPC nova)', $q$select public.push_registrar('https://push.exemplo.test/prod-1', 'k', 'a')$q$);
select t.como('dir');
select t.bloqueado('diretoria NÃO lança ponto absurdo (teto de 1.000.000 por lançamento)', $q$insert into public.pontos (unidade_id, origem, pontos, motivo) values ((select id from public.unidades limit 1), 'unidade', 2147483000, 'x')$q$);
select t.permitido('diretoria (Tenant 001) lança ponto para membro do PRÓPRIO clube, como sempre (migration 30 não muda o fluxo)', format($q$insert into public.pontos (usuario_id, origem, pontos, motivo) values (%L, 'manual', 1, 'ok')$q$, t.id('d1')));
select t.bloqueado('diretoria lançando ponto para pessoa inexistente recebe erro de RLS (não cai mais no clube legado)', $q$insert into public.pontos (usuario_id, origem, pontos, motivo) values (gen_random_uuid(), 'manual', 1, 'x')$q$);
select t.bloqueado('diretoria NÃO grava avaliado_por de OUTRA pessoa (só quem avalia)', format($q$update public.entregas set avaliado_por = %L where usuario_id = %L$q$, t.id('d1'), t.id('d2')));
select t.permitido('diretoria reprova entrega marcando a PRÓPRIA avaliação (o que o app faz)', format($q$update public.entregas set status = 'reprovada', avaliado_por = %L, feedback = 'refazer' where usuario_id = %L$q$, t.id('dir'), t.id('d2')));
select t.permitido('diretoria cria atividade', $q$insert into public.atividades (titulo, pontos) values ('Atividade nova', 5)$q$);
select t.permitido('diretoria cria unidade', $q$insert into public.unidades (nome) values ('Nova Unidade')$q$);
select t.permitido('diretoria cria evento', $q$insert into public.eventos (titulo, tipo, data) values ('Novo', 'Reunião', current_date + 1)$q$);
select t.permitido('diretoria aprova a entrega pendente do d2', format($q$select public.aprovar_entrega(id) from public.entregas where usuario_id = %L$q$, t.id('d2')));
select t.como('d1');
select t.permitido('membro vê o duelo em andamento do clube', $q$select id from public.duelos$q$);
select t.permitido('membro desafia a outra unidade (fluxo de sempre)', format($q$select public.criar_duelo((select id from public.desafios_unidade where titulo = 'Presença total'), %L)$q$, t.id('leoes')));
select t.como('dir');
select t.permitido('diretoria julga o duelo em andamento (prêmio para a unidade vencedora)', $q$select public.julgar_duelo((select id from public.duelos where titulo = 'Maratona de missões' and status = 'aberto'), 'a')$q$);
select t.como('d1');
select t.permitido('membro joga a memória hoje (fluxo de sempre; +1 lançamento de pontos)', $q$select public.registrar_jogo('memoria', 2)$q$);
select t.como('dir');
select t.permitido('diretoria edita o conteúdo pelo painel Conteúdo (update em desafios)', $q$update public.desafios set ativo = ativo where id = (select id from public.desafios limit 1)$q$);
select t.permitido('diretoria cria um versículo pelo painel Conteúdo', $q$insert into public.versiculos (texto, referencia, pergunta, opcoes, correta, ativo, livro_abrev, capitulo, versiculo_num) values ('novo', 'Gn 9:9', 'Q?', '["a","b"]'::jsonb, 0, false, 'gn', 9, 9)$q$);
select t.como('d1');
select t.eq('o membro segue recebendo a missão do dia (do conteúdo do Tenant 001)', t.n('select count(*) from public.missao_do_dia()'), 1);
select t.eq('o membro lê o histórico do chat geral e vê o próprio bichinho', t.n($q$select count(*) from public.chat_mensagens where texto = 'oi geral (legado)'$q$) * 10 + t.n($q$select count(*) from public.pets_do_clube() where pet_nome = 'Rex'$q$), 11);
select t.eq('mensagem JÁ apagada em produção: o membro NÃO lê mais o texto original pela tabela (migration 29 fez o backfill)', t.n($q$select count(*) from public.chat_mensagens m where m::text like '%mensagem ruim (legado)%'$q$), 0);
select t.eq('...mas a mensagem continua lá, marcada como apagada (o app mostra "removida pela liderança")', t.n($q$select count(*) from public.chat_mensagens where apagada and texto = '(mensagem apagada)'$q$), 1);
select t.eq('o ranking dos jogos traz os dois jogadores de antes', t.txt($q$select json_array_length(public.ranking_trilha()->'geral')::text$q$), '2');
select t.eq('o recorde da semana do reflexo continua lá', t.txt($q$select public.recordes_semana('reflexo')->0->>'pontos'$q$), '55');
select t.como('dir');
reset role;
select t.como('d1');
select t.eq('contexto (Tenant 001 de produção): 1 vínculo ativo, papel DO VÍNCULO, e o clube atual do servidor é o legado', (public.meu_contexto()->'vinculos'->0->>'club_id') || '|' || (public.meu_contexto()->'vinculos'->0->>'papel') || '|' || (public.meu_contexto()->>'clube_atual_id' = public.meu_contexto()->'vinculos'->0->>'club_id')::text || '|' || jsonb_array_length(public.meu_contexto()->'vinculos')::text, public.clube_legado_id()::text || '|desbravador|true|1');
select t.eq('contexto: a unidade do vínculo é a do perfil de produção (Águias)', t.txt('select public.meu_contexto()->''vinculos''->0->>''unidade_nome'''), 'Águias');
select t.eq('contexto: a marca de sempre vem do BANCO (nome, sigla FC, lema, ano e a logo do app), sem cor própria', t.txt('select concat_ws(''|'', public.meu_contexto()->''vinculos''->0->''marca''->>''nome'', public.meu_contexto()->''vinculos''->0->''marca''->>''sigla'', public.meu_contexto()->''vinculos''->0->''marca''->>''lema'', public.meu_contexto()->''vinculos''->0->''marca''->>''desde'', public.meu_contexto()->''vinculos''->0->''marca''->>''logo_url'', coalesce(public.meu_contexto()->''vinculos''->0->''marca''->>''cor_primaria'', ''padrao''))'), 'Filhos da Conquista|FC|Desbravadores · 1994|1994|/icon-192.png|padrao');
select t.eq('contexto: o leilão que já usavam segue ligado e os módulos de sempre também (nada some para o Tenant 001)', t.txt('select concat_ws(''|'', public.meu_contexto()->''vinculos''->0->''recursos''->>''leilao'', public.meu_contexto()->''vinculos''->0->''recursos''->>''chat'', public.meu_contexto()->''vinculos''->0->''recursos''->>''jogos'', public.meu_contexto()->''vinculos''->0->''recursos''->>''mensalidades'')'), 'true|true|true|true');
select t.como('dir');
select t.eq('contexto da diretoria de produção: papel diretoria', t.txt('select public.meu_contexto()->''vinculos''->0->>''papel'''), 'diretoria');
select t.permitido('diretoria de produção grava a identidade do clube (lema novo) e liga recurso pela RPC', $q$select public.clube_marca_gravar('{"lema":"Sempre prontos"}'::jsonb), public.recurso_definir('mural', true)$q$);
reset role;
select t.eq('imagens: depois do upgrade o bucket é PRIVADO e o bucket publico existe (migrations 31/32)', (select count(*) from storage.buckets where id = 'imagens' and not public) * 10 + (select count(*) from storage.buckets where id = 'publico' and public), 11);
select t.eq('imagens (Tenant 001): a diretoria vê tudo do clube (4 objetos de produção, todos com dono em owner)', t.n($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 4);
select t.como('d2');
select t.eq('imagens (Tenant 001): o colega vê o avatar e o mural do d1 e os próprios, incluindo o comprovante antigo (4)', t.n($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 4);
select t.como('d1');
select t.eq('imagens (Tenant 001): o d1 vê os próprios arquivos e o avatar do colega (para assinar a URL no ranking) — NÃO o comprovante antigo do d2 (3)', t.n($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 3);
select t.como('dir');
select t.eq('a diretoria (Tenant 001) ainda lê o texto original da mensagem apagada em produção, pela view e pela trilha', t.n($q$select count(*) from public.chat_mensagens_visiveis where texto = 'mensagem ruim (legado)'$q$) * 10 + t.n($q$select count(*) from public.chat_mensagens_apagadas where texto_original = 'mensagem ruim (legado)'$q$), 11);
select t.permitido('diretoria libera um jogo do rodízio', $q$select public.liberar_jogo('memoria')$q$);
select t.permitido('diretoria abre o painel de atividade dos jogos', $q$select public.atividade_jogos()$q$);
select t.eq('a diretoria vê a missão de foto pendente', t.n('select count(*) from public.missoes_pendentes()'), 1);
select t.permitido('diretoria aprova a missão de foto pendente (+10 pontos para o d2)', $q$select public.avaliar_missao((select id from public.missoes_feitas where status = 'pendente' limit 1), true)$q$);
select t.como('pend');
-- +1 da aprovação da entrega do d2, +1 do prêmio do duelo +1 da missão de foto aprovada e +1 da jogada de hoje acima
select t.eq('aprovado: passa a ver os pontos do clube', t.n('select count(*) from public.pontos'), (:pre_pontos::bigint + 4));
select t.como('d3');
select t.eq('reativado: volta a ver as fotos', t.n('select count(*) from public.fotos'), :pre_fotos::bigint);
select t.como('tes');
select t.permitido('tesoureiro grava mensalidade com o onConflict do front PUBLICADO', format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
   values (%L, 1, 2026, 55, 'pago', %L) on conflict (desbravador_id, mes, ano) do update set valor = excluded.valor, status = excluded.status$q$, t.id('d2'), t.id('tes')));
select t.como('con');
select t.permitido('conselheiro aponta membro da própria unidade', format($q$select public.salvar_reuniao(current_date, 'Reunião prod', %L::jsonb)$q$, jsonb_build_array(jsonb_build_object('usuario_id', t.id('d1'), 'pontos', 3))::text));
select t.como('d2');
select t.permitido('membro posta foto', format($q$insert into public.fotos (url, legenda, autor_id) values ('https://x.test/n.jpg', 'nova', %L)$q$, t.id('d2')));
select t.permitido('membro fala no chat geral', $q$select public.chat_enviar_geral('oi')$q$);

-- ---------- 5) leilão em andamento: cron e "Encerrar agora" cobram exatamente o mesmo ----------
reset role;
create function t.cobrancas() returns text language sql as $$
  select coalesce(string_agg(u.nome || ':' || x.s, ',' order by u.nome), '(nenhuma)')
  from (select unidade_id, sum(pontos) s from public.pontos where origem = 'leilao' group by 1) x
  join public.unidades u on u.id = x.unidade_id;
$$;
savepoint sp_cron;
update public.leiloes set fecha_em = now() - interval '1 minute' where titulo = 'Leilão de produção';
select t.como_cron();
select public.fechar_leiloes_vencidos();
reset role;
select t.cobrancas() as up_cron \gset
rollback to savepoint sp_cron;
savepoint sp_manual;
select t.como('dir');
select public.encerrar_leilao(id) from public.leiloes where titulo = 'Leilão de produção';
reset role;
select t.cobrancas() as up_manual \gset
rollback to savepoint sp_manual;
select t.eq('leilão de produção: o cron cobra o lance (20 pts da Águias)', :'up_cron', 'Águias:-20');
select t.eq('leilão de produção: cron == manual', :'up_cron', :'up_manual');

-- fase 3 (migrations 39/40): o upgrade publica o catálogo oficial das 6 Classes Regulares SEM matricular ninguém
reset role;
select t.eq('classes regulares 2026: 1 versão oficial publicada, 6 classes, 149 requisitos', (select count(*) from public.curriculum_versions where origem = 'oficial' and status = 'publicado') * 1000
  + (select count(*) from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial') * 100
  + (select count(*) from public.class_requirements where manifesto_id is not null) - 149, 1600);
select t.eq('classes regulares 2026: a importação não criou progresso/conquista pra NENHUM usuário de produção',
  (select count(*) from public.member_classes mc join public.classes c on c.id = mc.class_id join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial')
  + (select count(*) from public.curriculum_achievements), 0);

select t.fim();
rollback;
