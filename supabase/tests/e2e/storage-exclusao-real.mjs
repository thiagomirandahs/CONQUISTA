// E2E da FILA DE EXCLUSÃO DO STORAGE contra o Storage REAL LOCAL + a Edge Function `storage-excluir` rodando de verdade no edge-runtime
// (LOCAL, nunca produção). Prova (migration 532): apagar a linha NÃO apaga o arquivo; o arquivo FÍSICO só some depois da carência
// (7 dias) e só se nada mais o referencia, o objeto tem mais de 7 dias, o bucket é elegível e o dono do caminho é o dono da linha;
// arquivo ainda referenciado, caminho forjado e bucket protegido PERMANECEM; função falha fechada sem o segredo; duas chamadas
// simultâneas nunca excluem o mesmo item duas vezes; cron nasce desligado.
//
//   Pré-requisitos (supabase/tests/e2e/storage-exclusao-real.sh faz a função/porta/segredo sozinho):
//     * Supabase local no ar COM a migration 532 aplicada no banco "postgres" local;
//     * a função rodando em FUNCAO_URL (padrão http://127.0.0.1:54398/) com o MESMO segredo em STORAGE_EXCLUIR_SECRET.
//   A "passagem do tempo" (carência de 7 dias) é simulada SÓ aqui, ajustando processar_apos e storage.objects.created_at por SQL local.
//   Dados de teste com prefixo "e2e-exc-"; limpa tudo no fim (mesmo se falhar).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const CONT_FN = process.env.SUPABASE_EDGE_CONTAINER || 'supabase_edge_runtime_CONQUISTA'
const FUNCAO_URL = process.env.FUNCAO_URL || 'http://127.0.0.1:54398/'
const SEGREDO = process.env.STORAGE_EXCLUIR_SECRET
const URL_API = process.env.API_URL || 'http://127.0.0.1:54321'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_API) || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(FUNCAO_URL)) {
  console.error('ABORTADO: este teste só roda contra o Supabase LOCAL.'); process.exit(2)
}
if (!SEGREDO) { console.error('ABORTADO: defina STORAGE_EXCLUIR_SECRET (o mesmo valor da função local).'); process.exit(2) }

const printenv = (nome) => execFileSync('docker', ['exec', CONT_FN, 'printenv', nome], { encoding: 'utf8' }).trim()
const SERVICE = printenv('SUPABASE_SERVICE_ROLE_KEY')
const sql = (texto) => execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
if (sql(`select to_regclass('public.storage_exclusao_fila') is not null`) !== 't') { console.error('ABORTADO: aplique a migration 532 no banco local antes.'); process.exit(2) }

let ok = 0; const falhas = []
const t = (nome, cond, detalhe = '') => { if (cond) ok++; else { falhas.push(nome + (detalhe ? ` [${detalhe}]` : '')); console.log('  FALHOU:', nome, detalhe) } }

const admin = createClient(URL_API, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const JPG = Buffer.concat([Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'), Buffer.from([0xff, 0xd9])])
const ids = {}; const objetos = []; const titulos = []

async function usuario(nome) {
  const email = `e2e-exc-${nome}-${randomUUID().slice(0, 8)}@teste.local`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'senha-e2e-exc-123', email_confirm: true })
  if (error) throw error
  ids[nome] = data.user.id
  return data.user.id
}
async function subir(bucket, caminho) {
  const { error } = await admin.storage.from(bucket).upload(caminho, JPG, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`upload ${bucket}: ${error.message}`)
  objetos.push([bucket, caminho])
}
const fisico = async (bucket, caminho) => !(await admin.storage.from(bucket).download(caminho)).error      // o arquivo existe de verdade na API?
const linhaObj = (bucket, caminho) => sql(`select count(*) from storage.objects where bucket_id='${bucket}' and name='${caminho}'`) === '1'
const estado = (bucket, caminho) => sql(`select estado||':'||coalesce(ultima_mensagem,'') from public.storage_exclusao_fila where bucket='${bucket}' and caminho='${caminho}'`)
const venceCarencia = (like) => sql(`update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute', reservado_ate = null where caminho like '${like}' and estado='pendente'`)
const envelhece = (bucket, caminho) => sql(`update storage.objects set created_at = now() - interval '10 days', updated_at = now() - interval '10 days' where bucket_id='${bucket}' and name='${caminho}'`)
async function chamar(segredo, corpo = '{}') {
  // a 1ª chamada ao edge-runtime pode encontrar o container ainda aquecendo (máquina carregada): tenta de novo só em ERRO DE REDE (nunca em resposta HTTP)
  let r
  for (let i = 0; i < 6; i++) {
    try { r = await fetch(FUNCAO_URL, { method: 'POST', headers: { 'x-storage-excluir-secret': segredo ?? '', 'content-type': 'application/json' }, body: corpo }); break } catch (e) { if (i === 5) throw e; await new Promise((res) => setTimeout(res, 2000)) }
  }
  let c = null; try { c = await r.json() } catch { /* */ }
  return { status: r.status, corpo: c }
}

async function main() {
  console.log('== exclusão do Storage (fila + carência) contra Storage real local')
  t('cron "storage-excluir" nasce inativo', sql(`select count(*) from cron.job where jobname='storage-excluir' and not active`) === '1')
  const clube = sql(`select id from public.organizational_units where type='clube' order by created_at limit 1`)
  const A = await usuario('a'); const B = await usuario('b')
  sql(`delete from public.storage_exclusao_fila where caminho like '%${A}%' or caminho like '%${B}%'`)
  for (const u of [A, B]) sql(`insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values ('${u}', '${clube}', 'desbravador', 'ativo')`)

  // --- 0) a função falha fechada ---
  const f0 = await chamar(null); const f1 = await chamar('errado')
  t('função sem segredo = 401', f0.status === 401, String(f0.status)); t('função com segredo errado = 401', f1.status === 401, String(f1.status))

  // --- 1) cenário principal: atividade apagada -> 2 entregas com arquivo ---
  const c1 = `${A}/atividades/${randomUUID()}.jpg`; const c2 = `${A}/atividades/${randomUUID()}.jpg`
  await subir('comprovacoes', c1); await subir('comprovacoes', c2)
  const tit = `e2e-exc-${randomUUID().slice(0, 8)}`; titulos.push(tit)
  sql(`insert into public.atividades (titulo, pontos, club_id) values ('${tit}', 1, '${clube}')`)
  const atv = sql(`select id from public.atividades where titulo='${tit}'`)
  sql(`insert into public.entregas (atividade_id, usuario_id, texto, foto_url) values ('${atv}','${A}','e2e','${c1}')`)
  const tit2 = `e2e-exc-${randomUUID().slice(0, 8)}`; titulos.push(tit2)
  sql(`insert into public.atividades (titulo, pontos, club_id) values ('${tit2}', 1, '${clube}')`)
  const atv2 = sql(`select id from public.atividades where titulo='${tit2}'`)
  sql(`insert into public.entregas (atividade_id, usuario_id, texto, foto_url) values ('${atv2}','${A}','e2e','${c2}')`)
  t('antes de apagar nada está na fila', sql(`select count(*) from public.storage_exclusao_fila where caminho in ('${c1}','${c2}')`) === '0')
  sql(`delete from public.atividades where id in ('${atv}','${atv2}')`)
  t('apagar a atividade enfileirou os 2 caminhos (pendente)', estado('comprovacoes', c1).startsWith('pendente') && estado('comprovacoes', c2).startsWith('pendente'))
  t('...mas o arquivo FÍSICO continua lá (nada apaga na hora)', (await fisico('comprovacoes', c1)) && (await fisico('comprovacoes', c2)))

  // --- 2) dentro da carência a função não toca em nada ---
  const r0 = await chamar(SEGREDO)
  t('função com segredo = 200', r0.status === 200, JSON.stringify(r0.corpo))
  t('dentro da carência a função NÃO apagou (reservados = 0 para os itens novos)', (await fisico('comprovacoes', c1)) && (await fisico('comprovacoes', c2)) && estado('comprovacoes', c1).startsWith('pendente'))

  // --- 3) carência vencida mas objeto novo demais (<7 dias): continua ---
  venceCarencia(`%${A}%`)
  const r1 = await chamar(SEGREDO)
  t('carência da fila vencida, objeto com menos de 7 dias: o arquivo permanece', (await fisico('comprovacoes', c1)) && r1.corpo?.excluidos === 0, JSON.stringify(r1.corpo))
  t('...e o item voltou a "pendente" reagendado (não foi resolvido)', estado('comprovacoes', c1).startsWith('pendente'))

  // --- 4) cenários paralelos montados ANTES de "passar o tempo" ---
  // 4a) ainda referenciado: avatar de A = URL do arquivo; foto do mural com a mesma URL é apagada
  const cRef = `perfis/${A}-${Date.now()}.jpg`
  await subir('imagens', cRef)
  const urlRef = `${URL_API}/storage/v1/object/public/imagens/${cRef}`
  sql(`update public.profiles set foto='${urlRef}' where id='${A}'`)
  sql(`insert into public.fotos (url, legenda, autor_id, club_id) values ('${urlRef}', 'e2e-exc-F', '${A}', '${clube}')`)
  sql(`delete from public.fotos where legenda='e2e-exc-F' and autor_id='${A}'`)
  t('foto apagada cujo arquivo ainda é o avatar de A: entrou na fila', estado('imagens', cRef).startsWith('pendente'))
  // 4b) forjado: B aponta a própria entrega para um arquivo SEM referência de A e apaga
  const cVit = `${A}/atividades/${randomUUID()}.jpg`
  await subir('comprovacoes', cVit)
  const tit3 = `e2e-exc-${randomUUID().slice(0, 8)}`; titulos.push(tit3)
  sql(`insert into public.atividades (titulo, pontos, club_id) values ('${tit3}', 1, '${clube}')`)
  const atv3 = sql(`select id from public.atividades where titulo='${tit3}'`)
  sql(`insert into public.entregas (atividade_id, usuario_id, texto, foto_url) values ('${atv3}','${B}','forja','${cVit}')`)
  sql(`delete from public.entregas where atividade_id='${atv3}'`)
  t('caminho FORJADO (arquivo de A na entrega de B) foi enfileirado com dono_confere = false', sql(`select dono_confere::text from public.storage_exclusao_fila where caminho='${cVit}'`) === 'false')
  // 4c) bucket protegido direto na fila (alguém com acesso de banco)
  const cPub = `e2e-exc/${randomUUID()}.jpg`
  await subir('publico', cPub)
  sql(`insert into public.storage_exclusao_fila (bucket, caminho, origem, motivo, dono_linha, dono_confere, processar_apos) values ('publico','${cPub}','e2e','apagado',null,true, now() - interval '1 minute')`)
  // 4d) objeto que já não existe no Storage
  const cSumiu = `${A}/atividades/${randomUUID()}.jpg`
  sql(`select public._storage_exclusao_enfileirar('${cSumiu}','comprovacoes','e2e','apagado','${A}')`)
  // 4e) 6 itens elegíveis para a disputa de concorrência
  const lote = []
  for (let i = 0; i < 6; i++) {
    const c = `${B}/atividades/${randomUUID()}.jpg`; lote.push(c)
    await subir('comprovacoes', c)
    sql(`select public._storage_exclusao_enfileirar('${c}','comprovacoes','e2e','apagado','${B}')`)
    envelhece('comprovacoes', c)
  }

  // --- 5) passa o tempo: carência da fila + idade dos objetos (SÓ no teste) ---
  for (const [b, n] of [['comprovacoes', c1], ['comprovacoes', c2], ['imagens', cRef], ['comprovacoes', cVit], ['publico', cPub]]) envelhece(b, n)
  sql(`update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute', reservado_ate = null where estado='pendente' and (caminho like '%${A}%' or caminho like '%${B}%')`)
  // duas chamadas SIMULTÂNEAS: os 6 + os demais itens; nenhum item pode ser apagado duas vezes (ausentes = 0)
  const [rA, rB] = await Promise.all([chamar(SEGREDO), chamar(SEGREDO)])
  const [rC, rD] = await Promise.all([chamar(SEGREDO), chamar(SEGREDO)])
  const resp = [rA, rB, rC, rD]
  t('as chamadas simultâneas responderam 200', resp.every((r) => r.status === 200), resp.map((r) => r.status).join(','))
  const soma = (k) => resp.reduce((s, r) => s + (r.corpo?.[k] ?? 0), 0)
  t('CONCORRÊNCIA: nenhum item foi apagado/confirmado duas vezes (ausentes = 0)', soma('ausentes') === 0, JSON.stringify(resp.map((r) => r.corpo)))
  t('CONCORRÊNCIA: o total apagado = itens elegíveis (c1, c2 e os 6 do lote)', soma('excluidos') === 8, `excluidos=${soma('excluidos')}`)
  t('sem falhas nem recusas da função', soma('falhas') === 0 && soma('recusados') === 0 && soma('erro_confirmar') === 0)

  // --- 6) o que mudou fisicamente ---
  t('c1 (atividade apagada, sem referência, >7 dias) foi APAGADO do Storage', !(await fisico('comprovacoes', c1)) && !linhaObj('comprovacoes', c1))
  t('c2 idem', !(await fisico('comprovacoes', c2)) && !linhaObj('comprovacoes', c2))
  t('os 6 itens do lote foram apagados', (await Promise.all(lote.map((c) => fisico('comprovacoes', c)))).every((e) => !e))
  t('fila: c1/c2 = excluido', estado('comprovacoes', c1).startsWith('excluido') && estado('comprovacoes', c2).startsWith('excluido'), estado('comprovacoes', c1))
  t('fila: os 6 do lote = excluido', lote.every((c) => estado('comprovacoes', c).startsWith('excluido')))
  t('ainda REFERENCIADO (avatar de A) permanece no Storage', (await fisico('imagens', cRef)) && linhaObj('imagens', cRef))
  t('...e a fila registrou mantido:referenciado', estado('imagens', cRef) === 'mantido:referenciado', estado('imagens', cRef))
  t('FORJADO (dono do caminho != dono da linha) permanece no Storage', (await fisico('comprovacoes', cVit)) && linhaObj('comprovacoes', cVit))
  t('...e a fila registrou mantido:dono_diferente', estado('comprovacoes', cVit) === 'mantido:dono_diferente', estado('comprovacoes', cVit))
  t('bucket PROTEGIDO (publico) permanece', (await fisico('publico', cPub)) && linhaObj('publico', cPub))
  t('...e a fila registrou mantido:bucket_nao_elegivel', estado('publico', cPub) === 'mantido:bucket_nao_elegivel', estado('publico', cPub))
  t('item cujo objeto não existe: mantido:objeto_ausente', estado('comprovacoes', cSumiu) === 'mantido:objeto_ausente', estado('comprovacoes', cSumiu))

  // --- 7) idempotência e segunda rodada ---
  const r9 = await chamar(SEGREDO)
  t('2ª rodada: nada novo a apagar (idempotente)', r9.status === 200 && r9.corpo?.reservados === 0 && r9.corpo?.excluidos === 0, JSON.stringify(r9.corpo))
  t('a função ignora caminho no corpo da requisição (só o que o banco devolve)', (await chamar(SEGREDO, JSON.stringify({ bucket: 'comprovacoes', caminho: cVit }))).status === 200 && (await fisico('comprovacoes', cVit)))
  // trocar o avatar: o antigo entra na fila; depois de envelhecer e sem referência, a função apaga
  const cNovo = `perfis/${A}-${Date.now() + 1}.jpg`
  await subir('imagens', cNovo)
  sql(`update public.profiles set foto='${URL_API}/storage/v1/object/public/imagens/${cNovo}' where id='${A}'`)
  t('trocar o avatar enfileirou o ANTIGO (e só ele)', estado('imagens', cRef).startsWith('pendente') && sql(`select count(*) from public.storage_exclusao_fila where caminho='${cNovo}'`) === '0')
  envelhece('imagens', cRef)
  venceCarencia(cRef)
  const r10 = await chamar(SEGREDO)
  t('avatar antigo (agora sem referência, >7 dias, carência vencida) foi apagado', r10.corpo?.excluidos === 1 && !(await fisico('imagens', cRef)), JSON.stringify(r10.corpo))
  t('o avatar NOVO permanece', await fisico('imagens', cNovo))
  t('nenhuma falha ficou registrada no resumo', sql(`select count(*) from public.storage_exclusao_fila where estado='falhou' and (caminho like '%${A}%' or caminho like '%${B}%')`) === '0')
}

async function limpar() {
  try {
    for (const [b, n] of objetos) await admin.storage.from(b).remove([n]).catch(() => {})
    sql(`delete from public.storage_exclusao_fila where caminho like '%${ids.a ?? 'x-x'}%' or caminho like '%${ids.b ?? 'x-x'}%' or caminho like 'e2e-exc/%'`)
    for (const tt of titulos) sql(`delete from public.atividades where titulo='${tt}'`)
    sql(`delete from public.fotos where legenda='e2e-exc-F'`)
    for (const k of Object.keys(ids)) await admin.auth.admin.deleteUser(ids[k]).catch(() => {})
    sql(`delete from public.storage_exclusao_fila where caminho like '%${ids.a ?? 'x-x'}%' or caminho like '%${ids.b ?? 'x-x'}%'`)   // o delete do perfil enfileira de novo: zera o resíduo
  } catch (e) { console.log('limpeza parcial:', e.message) }
}

try { await main() } catch (e) { falhas.push('EXCEÇÃO: ' + (e.message || e)); console.log(e) } finally { await limpar() }
console.log(`\n${falhas.length ? 'FALHOU' : 'OK'} — ${ok} verificações ok, ${falhas.length} falha(s)`)
falhas.forEach((f) => console.log('  -', f))
process.exit(falhas.length ? 1 : 0)
