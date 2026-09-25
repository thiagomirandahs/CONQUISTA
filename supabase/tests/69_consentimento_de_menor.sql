-- Fechamento (Bloco G3): consentimento AUDITÁVEL do responsável — infraestrutura real (tabela
-- versionada, RPC, auditoria, revogação); o TEXTO do termo é placeholder marcado, de propósito
-- (não escrevo texto jurídico definitivo). Não mexe no vínculo responsável↔desbravador (já existia).
begin;
\ir _lib.sql
\ir _fixtures.sql

create function t.vinc(p_resp text, p_desb text) returns uuid language sql stable security definer as $$
  select id from public.responsaveis where responsavel_id = t.id(p_resp) and desbravador_id = t.id(p_desb) and status = 'aprovado' limit 1 $$;

-- ==================== termo placeholder é marcado, não fingido como definitivo ====================
select t.ok('o texto do termo vigente está marcado como pendente de revisão jurídica',
  (select texto like '%PENDENTE DE REVISÃO JURÍDICA%' from public.termos_consentimento where chave = 'vinculo-responsavel' and ativo order by versao desc limit 1));

-- ==================== responsável correto, filho correto ====================
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.permitido('pais_a concede consentimento pro PRÓPRIO vínculo aprovado (membro_a)', format($q$select public.consentimento_conceder(%L)$q$, t.vinc('pais_a', 'membro_a')));
reset role;
select t.eq('1 consentimento ativo registrado, termo v1', (select count(*) || '|' || t.versao from public.responsavel_consentimentos c join public.termos_consentimento t on t.id = c.termo_id where c.responsavel_id = t.id('pais_a') group by t.versao), '1|1');

-- ==================== outra criança / outro clube: nunca em nome de terceiro ====================
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.throws('pais_a NÃO consente pelo vínculo de OUTRO responsável (membro_b/pais_b)', format($q$select public.consentimento_conceder(%L)$q$, t.vinc('pais_b', 'membro_b')), 'não encontrado ou sem permissão');
select t.throws('vínculo inexistente (uuid aleatório) dá a MESMA mensagem — sem oráculo', format($q$select public.consentimento_conceder(%L)$q$, gen_random_uuid()), 'não encontrado ou sem permissão');
reset role;

-- ==================== vínculo ainda pendente/recusado: sem consentimento possível ====================
insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status)
values (t.id('pais_a'), t.id('membro_a2'), 'Membro A2 [TESTE]', 'pendente');
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.throws('vínculo AINDA PENDENTE (não aprovado pela liderança) não permite consentimento',
  format($q$select public.consentimento_conceder(%L)$q$, (select id from public.responsaveis where responsavel_id = t.id('pais_a') and desbravador_id = t.id('membro_a2'))),
  'precisa estar aprovado');
reset role;

-- ==================== consentimento duplicado é recusado ====================
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.throws('conceder de novo (já ativo) é recusado', format($q$select public.consentimento_conceder(%L)$q$, t.vinc('pais_a', 'membro_a')), 'já concedeu');
reset role;

-- ==================== histórico (meus_consentimentos) ====================
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.eq('meus_consentimentos: 1 registro, do filho certo, ainda não revogado',
  (select json_array_length(m) || '|' || (m->0->>'desbravador_nome') || '|' || coalesce(m->0->>'revogado_em', '')
   from (select public.meus_consentimentos() m) x), '1|Membro A|');
reset role;

-- outro responsável não vê o consentimento de pais_a
select t.como('pais_b'); select t.pedir_clube('clube_b');
select t.eq('pais_b (outro responsável) não vê o consentimento de pais_a em meus_consentimentos', (select json_array_length(public.meus_consentimentos())), 0);
reset role;

-- ==================== revogação ====================
select t.como('membro_a'); select t.pedir_clube('clube_a'); -- não é o responsável nem liderança
select t.throws('quem não é o responsável nem liderança do clube não revoga', format($q$select public.consentimento_revogar(%L, 'tentativa indevida [TESTE]')$q$, (select id from public.responsavel_consentimentos where responsavel_id = t.id('pais_a'))), 'não encontrado ou sem permissão');
reset role;

select t.como('lider_a'); select t.pedir_clube('clube_a'); -- liderança do clube TAMBÉM pode revogar (ex.: responsável suspenso)
select t.permitido('a liderança do clube revoga (cenário "responsável suspenso")', format($q$select public.consentimento_revogar(%L, 'responsável suspenso pelo clube [TESTE]')$q$, (select id from public.responsavel_consentimentos where responsavel_id = t.id('pais_a'))));
reset role;
select t.eq('depois de revogado: revogado_em preenchido, motivo salvo', (select (revogado_em is not null) || '|' || revogado_motivo from public.responsavel_consentimentos where responsavel_id = t.id('pais_a')), 'true|responsável suspenso pelo clube [TESTE]');
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.throws('revogar de novo (já revogado) é recusado', format($q$select public.consentimento_revogar(%L, 'de novo [TESTE]')$q$, (select id from public.responsavel_consentimentos where responsavel_id = t.id('pais_a'))), 'já está revogado');
reset role;

-- ==================== depois de revogar, pode conceder de novo (índice único é PARCIAL) ====================
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.permitido('concede de novo depois de revogar o anterior', format($q$select public.consentimento_conceder(%L)$q$, t.vinc('pais_a', 'membro_a')));
reset role;
select t.eq('histórico agora tem 2 linhas (a revogada + a nova ativa) — nada foi apagado', (select count(*) from public.responsavel_consentimentos where responsavel_id = t.id('pais_a')), 2::bigint);

-- ==================== versão nova do termo ====================
insert into public.termos_consentimento (chave, versao, titulo, texto, ativo)
values ('vinculo-responsavel', 2, 'Consentimento do responsável (v2)', 'CONTEÚDO PENDENTE DE REVISÃO JURÍDICA — v2 [TESTE]', true);
update public.termos_consentimento set ativo = false where chave = 'vinculo-responsavel' and versao = 1;
select t.como('pais_b'); select t.pedir_clube('clube_b');
select t.permitido('novo consentimento passa a usar a versão MAIS RECENTE ativa do termo', format($q$select public.consentimento_conceder(%L)$q$, t.vinc('pais_b', 'membro_b')));
reset role;
select t.eq('o consentimento de pais_b ficou preso à versão 2 (a que estava ativa quando concedeu)',
  (select tc.versao from public.responsavel_consentimentos c join public.termos_consentimento tc on tc.id = c.termo_id where c.responsavel_id = t.id('pais_b')), 2);

-- ==================== não vaza entre clubes: liderança de OUTRO clube não revoga ====================
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('liderança do clube B não revoga consentimento do clube A', format($q$select public.consentimento_revogar(%L, 'tentativa indevida [TESTE]')$q$, (select id from public.responsavel_consentimentos where responsavel_id = t.id('pais_a') and revogado_em is null)), 'não encontrado ou sem permissão');
reset role;

select t.fim();
rollback;
