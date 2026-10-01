#!/usr/bin/env node
// TESTE CONTROLADO da fila de exclusão (migration 532) em PRODUÇÃO, SEM tocar em arquivo real de usuário.
//  PARTE A (tudo em transações com ROLLBACK; nada persiste): regras de decisão do processador com dados REAIS só como cenário —
//    referenciado => recusa; sem referência mas dentro da carência => recusa; carência vencida (simulada só dentro da transação) => elegível (o SQL nunca apaga);
//    caminho forjado (dono diferente) => recusa; bucket protegido => recusa; anon/authenticated não executam as funções; confirmar é idempotente;
//    geração de órfãos: apagar ATIVIDADE, apagar foto do MURAL e TROCAR avatar enfileiram o caminho ANTIGO (do valor guardado), nunca o novo.
//  PARTE B (commit; objetos SINTÉTICOS de pasta de UUID inexistente): a Edge Function de verdade apaga SÓ o objeto sintético elegível,
//    é idempotente na 2ª chamada, e a falha da API fica registrada (tentativas -> 'falhou' + infra_falhas); depois limpa tudo que criou.
// Nunca imprime caminhos, URL do banco, token, chave ou segredo. Env (nomes): DB_URL_PRODUCAO, SUPABASE_ACCESS_TOKEN, PROJECT_REF, STORAGE_EXCLUIR_SECRET_ARQUIVO.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const DB = process.env.DB_URL_PRODUCAO, TOKEN = process.env.SUPABASE_ACCESS_TOKEN, REF = process.env.PROJECT_REF, SEG_ARQ = process.env.STORAGE_EXCLUIR_SECRET_ARQUIVO
if (!DB || !TOKEN || !REF || !SEG_ARQ) { console.error('Faltam: DB_URL_PRODUCAO, SUPABASE_ACCESS_TOKEN, PROJECT_REF, STORAGE_EXCLUIR_SECRET_ARQUIVO'); process.exit(2) }
const SEGREDO = readFileSync(SEG_ARQ, 'utf8').trim()
const NL = String.fromCharCode(10), CR = String.fromCharCode(13)
const BASE = `https://${REF}.supabase.co`
function psql(sql, { avisos = false } = {}) {
  const r = spawnSync('psql', [DB, '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('psql falhou: ' + String(r.stderr || '').split(NL).filter(Boolean).slice(0, 2).join(' | ').replaceAll(DB, '<db>').slice(0, 260))
  const out = r.stdout.split(CR).join('').trim()
  return avisos ? { out, notas: String(r.stderr || '').split(NL).map((l) => l.split(CR).join('')).filter((l) => l.includes('T|')).map((l) => l.slice(l.indexOf('T|') + 2)) } : out
}
let ok = 0; const falhas = []
const detalhado = process.argv.includes('--verbose')
const t = (nome, cond, det = '') => { if (detalhado) console.log(`  ${cond ? 'ok    ' : 'FALHOU'} ${nome}`); if (cond) ok++; else { falhas.push(nome + (det ? ` [${det}]` : '')); console.log('  FALHOU:', nome, det) } }
const chaves = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
const SERVICO = chaves.find((k) => k.name === 'service_role')?.api_key
const H = { Authorization: `Bearer ${SERVICO}`, apikey: SERVICO }
const JPG = Buffer.concat([Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'), Buffer.from([0xff, 0xd9])])
const SYN = randomUUID()
const criados = []
async function subir(bucket, nome) {
  const r = await fetch(`${BASE}/storage/v1/object/${bucket}/${nome}`, { method: 'POST', headers: { ...H, 'content-type': 'image/jpeg', 'x-upsert': 'false' }, body: JPG })
  if (r.ok) criados.push([bucket, nome]); return r.ok
}
const existe = (bucket, nome) => psql(`select count(*) from storage.objects where bucket_id='${bucket}' and name='${nome}'`) === '1'
const funcao = async (seg) => { const r = await fetch(`${BASE}/functions/v1/storage-excluir`, { method: 'POST', headers: { 'x-storage-excluir-secret': seg, 'content-type': 'application/json' }, body: '{}' }); let c = null; try { c = await r.json() } catch { /* */ } return { s: r.status, c } }
const outros = () => psql(`select count(*)||'|'||coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where name not like '${SYN}/%' and name not like 'perfis/${SYN}-%'`)

try {
  console.log('== teste controlado da exclusão (532) em PRODUÇÃO — parte A: decisões em transação com ROLLBACK')
  t('fila vazia antes', psql('select count(*) from public.storage_exclusao_fila') === '0')
  t('anon e authenticated NÃO executam as funções internas', psql(`select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('_storage_exclusao_processar','_storage_exclusao_confirmar','_storage_exclusao_enfileirar','_storage_exclusao_gatilho','storage_exclusao_rotina') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))`) === '0')
  const antes = outros()
  // objeto sintético REFERENCIÁVEL (pasta perfis/ com UUID inexistente)
  const s1 = `perfis/${SYN}-ctl-1.jpg`
  t('sobe objeto sintético S1', await subir('imagens', s1))
  const url1 = `https://${REF}.supabase.co/storage/v1/object/public/imagens/${s1}`
  const a = psql(`begin;
do $$ declare p record; n int; r record; ref uuid; b text := 'imagens'; c text := '${s1}'; ok1 bool; ok2 bool; ok3 bool; ok4 bool; ok5 bool; ok6 bool; ok7 bool; ok8 bool;
begin
  select id, foto into p from public.profiles where foto is not null and foto <> '' limit 1;
  -- A1: S1 REFERENCIADO por um perfil (só nesta transação) + item vencido => processador RECUSA (mantido:referenciado)
  update public.profiles set foto = '${url1}' where id = p.id;
  update storage.objects set created_at = now() - interval '10 days' where bucket_id = b and name = c;
  insert into public.storage_exclusao_fila (bucket, caminho, origem, motivo, dono_linha, dono_confere, processar_apos) values (b, c, 'teste.controlado', 'apagado', null, true, now() - interval '1 minute');
  select count(*) into n from public._storage_exclusao_processar(8) where caminho = c;
  ok1 := (n = 0) and (select estado || ':' || coalesce(ultima_mensagem,'') from public.storage_exclusao_fila where caminho = c) = 'mantido:referenciado';
  raise notice 'T|A1 referenciado nunca é liberado (mantido:referenciado)|%', ok1;
  -- A2: referência removida => o GATILHO enfileira o valor antigo; dentro da carência o processador RECUSA
  delete from public.storage_exclusao_fila where caminho = c;
  update public.profiles set foto = p.foto where id = p.id;
  ok2 := exists (select 1 from public.storage_exclusao_fila where caminho = c and estado = 'pendente' and processar_apos > now() + interval '6 days 23 hours');
  select count(*) into n from public._storage_exclusao_processar(8) where caminho = c;
  raise notice 'T|A2 gatilho enfileira o valor ANTIGO com carência de 7 dias|%', ok2;
  raise notice 'T|A2 dentro da carência o processador NÃO libera|%', (n = 0);
  -- A3: carência vencida (simulada SÓ aqui) + sem referência + objeto antigo => elegível (o SQL nunca apaga o arquivo físico)
  -- (cenário de teste: o dono confere, como seria numa exclusão legítima do próprio dono)
  update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute', dono_confere = true where caminho = c;
  select count(*) into n from public._storage_exclusao_processar(8) where caminho = c;
  raise notice 'T|A3 vencida + sem referência => elegível (devolvida)|%', (n = 1);
  raise notice 'T|A3 o objeto físico continua existindo (SQL não apaga)|%', exists (select 1 from storage.objects where bucket_id = b and name = c);
  -- A4: caminho FORJADO (dono da linha != dono do caminho) e bucket PROTEGIDO
  insert into public.storage_exclusao_fila (bucket, caminho, origem, motivo, dono_linha, dono_confere, processar_apos) values ('imagens', 'perfis/${randomUUID()}-forjado.jpg', 'teste.controlado', 'apagado', gen_random_uuid(), false, now() - interval '1 minute');
  insert into public.storage_exclusao_fila (bucket, caminho, origem, motivo, dono_linha, dono_confere, processar_apos) values ('publico', 'logo-teste-${randomUUID()}.png', 'teste.controlado', 'apagado', null, true, now() - interval '1 minute');
  insert into public.storage_exclusao_fila (bucket, caminho, origem, motivo, dono_linha, dono_confere, processar_apos) values ('documentos-emitidos', 'doc-${randomUUID()}.pdf', 'teste.controlado', 'apagado', null, true, now() - interval '1 minute');
  perform * from public._storage_exclusao_processar(8);
  raise notice 'T|A4 caminho forjado => mantido:dono_diferente|%', (select count(*) from public.storage_exclusao_fila where origem = 'teste.controlado' and caminho like '%forjado%' and estado || ':' || ultima_mensagem = 'mantido:dono_diferente') = 1;
  raise notice 'T|A4 bucket publico/documentos-emitidos => mantido:bucket_nao_elegivel|%', (select count(*) from public.storage_exclusao_fila where origem = 'teste.controlado' and bucket in ('publico','documentos-emitidos') and estado || ':' || ultima_mensagem = 'mantido:bucket_nao_elegivel') = 2;
  -- A5: confirmar é idempotente e só vale para item entregue/reservado
  delete from public.storage_exclusao_fila where caminho = c;
  insert into public.storage_exclusao_fila (bucket, caminho, origem, motivo, dono_linha, dono_confere, processar_apos, reservado_ate) values (b, c, 'teste.controlado', 'apagado', null, true, now(), now() + interval '5 minutes');
  ok5 := public._storage_exclusao_confirmar(b, c, true, 'removido') = 'excluido' and public._storage_exclusao_confirmar(b, c, true, 'removido') = 'excluido';
  raise notice 'T|A5 confirmar duas vezes é idempotente|%', ok5;
  raise notice 'T|A5 confirmar item NÃO reservado não vale|%', public._storage_exclusao_confirmar('imagens', 'perfis/${randomUUID()}-x.jpg', true, 'x') = 'inexistente';
end $$;
rollback;`, { avisos: true })
  for (const l of a.notas) { const [nome, v] = l.split('|'); t(nome, v === 't' || v === 'true') }

  // ---- geração de novos órfãos (item 7): rollback ----
  const g = psql(`begin;
do $$ declare at_ uuid; esperado text[]; got text[]; fid uuid; furl text; fthumb text; pid uuid; pfoto text; novo text := 'https://x.supabase.co/storage/v1/object/public/imagens/perfis/${randomUUID()}-novo.jpg'; n int;
begin
  -- ATIVIDADE: apagar enfileira os caminhos ANTIGOS das entregas (comprovacoes), nunca outro
  select a.id into at_ from public.atividades a where exists (select 1 from public.entregas e where e.atividade_id = a.id and e.foto_url is not null and e.foto_url !~ '^https?://[^/]+/(?!storage)') limit 1;
  if at_ is null then raise notice 'T|ATIVIDADE: sem atividade com foto para simular (NÃO APLICÁVEL)|t'; else
    select array_agg(distinct public._storage_ref_chave(e.foto_url, 'comprovacoes')) into esperado from public.entregas e where e.atividade_id = at_ and e.foto_url is not null and public._storage_ref_chave(e.foto_url, 'comprovacoes') is not null
       and split_part(public._storage_ref_chave(e.foto_url, 'comprovacoes'), '/', 1) in ('imagens','comprovacoes','comunidade','suporte-anexos');
    delete from public.atividades where id = at_;
    select coalesce(array_agg(bucket || '/' || caminho), '{}') into got from public.storage_exclusao_fila where origem = 'entregas.foto_url';
    raise notice 'T|ATIVIDADE apagada => enfileira exatamente os caminhos antigos das entregas (% itens)|%', coalesce(array_length(esperado,1),0), (select coalesce(array_agg(x order by x),'{}') from unnest(got) x) = (select coalesce(array_agg(x order by x),'{}') from unnest(esperado) x);
    raise notice 'T|ATIVIDADE: motivo=apagado e carência 7 dias|%', not exists (select 1 from public.storage_exclusao_fila where origem = 'entregas.foto_url' and (motivo <> 'apagado' or processar_apos < now() + interval '6 days 23 hours'));
  end if;
  delete from public.storage_exclusao_fila;
  -- MURAL: apagar a foto enfileira url e thumb ANTIGOS
  select id, url, thumb into fid, furl, fthumb from public.fotos where url is not null limit 1;
  if fid is null then raise notice 'T|MURAL: sem foto para simular (NÃO APLICÁVEL)|t'; else
    select array_agg(distinct x) into esperado from (select public._storage_ref_chave(furl, 'imagens') x union select public._storage_ref_chave(fthumb, 'imagens')) z where x is not null and split_part(x, '/', 1) in ('imagens','comprovacoes','comunidade','suporte-anexos');
    delete from public.fotos where id = fid;
    select coalesce(array_agg(bucket || '/' || caminho), '{}') into got from public.storage_exclusao_fila where origem like 'fotos.%';
    raise notice 'T|MURAL apagado => enfileira url e thumb antigos (% itens)|%', coalesce(array_length(esperado,1),0), (select coalesce(array_agg(x order by x),'{}') from unnest(got) x) = (select coalesce(array_agg(x order by x),'{}') from unnest(esperado) x);
  end if;
  delete from public.storage_exclusao_fila;
  -- AVATAR: trocar enfileira o ANTIGO e nunca o NOVO
  select id, foto into pid, pfoto from public.profiles where foto is not null and foto <> '' and public._storage_ref_chave(foto, 'imagens') is not null limit 1;
  if pid is null then raise notice 'T|AVATAR: sem perfil com foto para simular (NÃO APLICÁVEL)|t'; else
    update public.profiles set foto = novo where id = pid;
    raise notice 'T|AVATAR trocado => o caminho ANTIGO entra na fila|%', exists (select 1 from public.storage_exclusao_fila where bucket || '/' || caminho = public._storage_ref_chave(pfoto, 'imagens'));
    raise notice 'T|AVATAR trocado => o caminho NOVO nunca entra|%', not exists (select 1 from public.storage_exclusao_fila where caminho like '%-novo.jpg');
    raise notice 'T|AVATAR: exatamente 1 item e carência 7 dias|%', (select count(*) = 1 and bool_and(processar_apos > now() + interval '6 days 23 hours') from public.storage_exclusao_fila);
  end if;
end $$;
rollback;`, { avisos: true })
  for (const l of g.notas) { const [nome, v] = l.split('|').length > 2 ? [l.split('|').slice(0, -1).join('|'), l.split('|').at(-1)] : l.split('|'); t(nome, v === 't' || v === 'true') }
  t('NADA persistiu da parte A (fila vazia)', psql('select count(*) from public.storage_exclusao_fila') === '0')
  t('objeto sintético S1 não foi tocado pelo SQL', existe('imagens', s1))

  console.log('== parte B: a Edge Function de verdade, só com objetos sintéticos')
  const s3 = `${SYN}/atividades/${Date.now()}.jpg`
  t('sobe objeto sintético S3 (comprovacoes)', await subir('comprovacoes', s3))
  psql(`update storage.objects set created_at = now() - interval '10 days' where bucket_id='comprovacoes' and name='${s3}'`)
  psql(`insert into public.storage_exclusao_fila (bucket, caminho, origem, motivo, dono_linha, dono_confere, processar_apos) values ('comprovacoes','${s3}','teste.controlado','apagado','${SYN}',true, now() - interval '1 minute')`)
  const f0 = await funcao('errado'); t('função com segredo errado = 401 e S3 intacto', f0.s === 401 && existe('comprovacoes', s3))
  const r1 = await funcao(SEGREDO); t('função com segredo = 200', r1.s === 200, JSON.stringify(r1.c))
  t('S3 (sintético, sem referência, carência vencida) foi EXCLUÍDO fisicamente', !existe('comprovacoes', s3), JSON.stringify(r1.c))
  t('fila: S3 = excluido', psql(`select estado from public.storage_exclusao_fila where caminho='${s3}'`) === 'excluido')
  const r2 = await funcao(SEGREDO); t('2ª chamada idempotente (nada a fazer)', r2.s === 200 && r2.c?.reservados === 0 && r2.c?.excluidos === 0, JSON.stringify(r2.c))
  t('S1 (referenciável, dentro da carência, fora da fila) NÃO foi tocado pela função', existe('imagens', s1))
  // falha registrada: 5 falhas seguidas viram 'falhou' + infra_falhas
  const s5 = `${SYN}/atividades/falha-${Date.now()}.jpg`
  psql(`insert into public.storage_exclusao_fila (bucket, caminho, origem, motivo, dono_linha, dono_confere, processar_apos, reservado_ate) values ('comprovacoes','${s5}','teste.controlado','apagado','${SYN}',true, now(), now() + interval '30 minutes')`)
  const est = []
  for (let i = 0; i < 5; i++) { est.push(psql(`select public._storage_exclusao_confirmar('comprovacoes','${s5}', false, 'erro teste controlado'); update public.storage_exclusao_fila set reservado_ate = now() + interval '30 minutes', processar_apos = now() where caminho='${s5}' and estado='pendente';`).split('\n')[0]) }
  t('falha da API fica REGISTRADA: 5ª vira "falhou"', est.at(-1) === 'falhou' || psql(`select estado from public.storage_exclusao_fila where caminho='${s5}'`) === 'falhou', est.join(','))
  t('...com registro em infra_falhas (sem caminho, sem uuid)', psql(`select count(*) from public.infra_falhas where origem='storage/exclusao' and detalhe like '%erro teste controlado%' and detalhe not like '%${SYN}%'`) === '1')
  t('NENHUM outro objeto do Storage foi tocado', outros() === antes, `${antes} -> ${outros()}`)
} catch (e) { falhas.push('EXCEÇÃO: ' + (e.message || e).toString().slice(0, 240)) } finally {
  for (const [b, n] of criados) await fetch(`${BASE}/storage/v1/object/${b}/${n}`, { method: 'DELETE', headers: H }).catch(() => {})
  for (const sql of [
    `delete from storage.objects where (bucket_id='comprovacoes' and name like '${SYN}/%') or (bucket_id='imagens' and name like 'perfis/${SYN}-%')`,
    `delete from public.storage_exclusao_fila where origem = 'teste.controlado' or caminho like '${SYN}/%' or caminho like 'perfis/${SYN}-%'`,
    `delete from public.infra_falhas where origem='storage/exclusao' and detalhe like '%erro teste controlado%'`]) {
    try { psql(sql) } catch (e) { console.log('limpeza: falhou um passo:', String(e.message).slice(0, 120)) }
  }
}
console.log(`limpeza: objetos de teste restantes = ${psql(`select count(*) from storage.objects where name like '${SYN}/%' or name like 'perfis/${SYN}-%'`)}; fila restante = ${psql('select count(*) from public.storage_exclusao_fila')}`)
console.log(`\n${falhas.length ? 'FALHOU' : 'OK'} — ${ok} verificações ok, ${falhas.length} falha(s)`); falhas.forEach((f) => console.log('  -', f))
process.exit(falhas.length ? 1 : 0)
