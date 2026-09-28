-- Migration 460: catálogo de especialidades e mestrados (Desbravadores), gerado do MDA Wiki.
-- Catálogo global sem dado de pessoa: logado lê pela RPC; ninguém lê as tabelas direto; anônimo nada.
-- Prova também os itens que as Classes citam por nome e a composição dos mestrados.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.eq('mais de 500 especialidades de Desbravadores', ((select count(*) from public.especialidades_catalogo) > 500)::text, 'true');
select t.eq('16 mestrados', (select count(*) from public.mestrados_catalogo), 16);
select t.eq('nenhuma de Aventureiros', (select count(*) from public.especialidades_catalogo where nome ilike '%aventureiros%'), 0);
select t.eq('código único e no formato oficial', (select count(*) from public.especialidades_catalogo where codigo !~ '^[A-Z]{2}(-EB)?-[0-9]{3}$'), 0);
select t.eq('Acampamento I = AR-050, nível 1', (select codigo || '|' || nivel from public.especialidades_catalogo where nome = 'Acampamento I'), 'AR-050|1');
select t.eq('especialidades que as Classes pedem por nome estão no catálogo',
  (select count(*) from public.especialidades_catalogo where nome in ('Acampamento I', 'Arte de Acampar', 'Excursionismo Pedestre com Mochila',
    'Resgate Básico', 'Cidadania Cristã', 'Mapa e Bússola', 'Fogueiras e Cozinha ao Ar Livre', 'Temperança', 'Aventuras com Cristo',
    'Pioneirias', 'Testemunho Juvenil', 'Ordem Unida', 'Vida Silvestre', 'Mordomia', 'Liderança Campestre', 'Orçamento Familiar')), 16);
select t.eq('Vida Campestre (o Guia pede) tem a lista e o mínimo 7',
  (select m.minimo || '|' || (count(*) > 20)::text from public.mestrados_catalogo m join public.mestrado_especialidades me on me.mestrado_codigo = m.codigo
    where m.codigo = 'ME-009' group by m.minimo), '7|true');
select t.eq('mestrado por área (ADRA) cobre as especialidades da área AD',
  (select count(*) from public.mestrado_especialidades where mestrado_codigo = 'ME-001'), (select count(*) from public.especialidades_catalogo where area = 'AD'));

select t.como('membro_a');
select t.eq('desbravador lê o catálogo pela RPC', (json_array_length(public.catalogo_especialidades() -> 'especialidades') > 500)::text, 'true');
select t.eq('...e os mestrados', json_array_length(public.catalogo_especialidades() -> 'mestrados')::bigint, 16);
select t.eq('não lê a tabela direto', t.nv('select count(*) from public.especialidades_catalogo'), 0);
select t.throws('não escreve no catálogo', $$insert into public.especialidades_catalogo (codigo, nome, area, area_nome, fonte_url) values ('AR-999', 'x', 'AR', 'x', 'https://mda.wiki.br/x')$$);
select t.como_anon();
select t.throws('anônimo não executa', 'select public.catalogo_especialidades()');
reset role;

select t.fim();
rollback;
