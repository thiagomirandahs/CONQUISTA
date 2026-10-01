// E2E das LACUNAS da fila de exclusão do Storage (migration 533) contra o Storage REAL LOCAL + a Edge Function `storage-excluir`
// rodando de verdade no edge-runtime (LOCAL, nunca produção). Prova: trocar/remover a foto OU o anexo de rascunho de um requisito enfileira
// só o arquivo ANTIGO; nada some na hora; depois da carência (simulada SÓ aqui) o arquivo antigo some FISICAMENTE (Storage + storage.objects)
// e o novo permanece; arquivo que voltou a ser referenciado, prova em histórico imutável e caminho forjado de outra pessoa NÃO são excluídos.
//
//   Pré-requisitos (supabase/tests/e2e/storage-exclusao-533-real.sh faz a função/porta/segredo sozinho):
//     * Supabase local no ar COM as migrations 532 e 533 aplicadas no banco "postgres" local;
//     * a função rodando em FUNCAO_URL (padrão http://127.0.0.1:54397/) com o MESMO segredo em STORAGE_EXCLUIR_SECRET.
//   Dados de teste com prefixo "e2e533-"; limpa tudo no fim (mesmo se falhar): 0 objetos, 0 linhas de fila e 0 infra_falhas de teste.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const CONT_FN = process.env.SUPABASE_EDGE_CONTAINER || 'supabase_edge_runtime_CONQUISTA'
const FUNCAO_URL = process.env.FUNCAO_URL || 'http://127.0.0.1:54397/'
const SEGREDO = process.env.STORAGE_EXCLUIR_SECRET
const URL_API = process.env.API_URL || 'http://127.0.0.1:54321'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_API) || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(FUNCAO_URL)) {
  console.error('ABORTADO: este teste só roda contra o Supabase LOCAL.'); process.exit(2)
}
if (!SEGREDO) { console.error('ABORTADO: defina STORAGE_EXCLUIR_SECRET (o mesmo valor da função local).'); process.exit(2) }

const printenv = (nome) => execFileSync('docker', ['exec', CONT_FN, 'printenv', nome], { encoding: 'utf8' }).trim()
const SERVICE = printenv('SUPABASE_SERVICE_ROLE_KEY')
const sql = (texto) => execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
if (sql(`select count(*) from pg_trigger where tgname like 'zz_storage_lacuna_%' and not tgisinternal`) !== '9') { console.error('ABORTADO: aplique as migrations 532 e 533 no banco local antes.'); process.exit(2) }

let ok = 0; const falhas = []
const t = (nome, cond, detalhe = '') => { if (cond) ok++; else { falhas.push(nome + (detalhe ? ` [${detalhe}]` : '')); console.log('  FALHOU:', nome, detalhe) } }

const admin = createClient(URL_API, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const JPG = Buffer.concat([Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'), Buffer.from([0xff, 0xd9])])
const ids = {}; const objetos = []
const inicio = sql(`select now()::text`)

async function usuario(nome) {
  const email = `e2e533-${nome}-${randomUUID().slice(0, 8)}@teste.local`
  const { data, error } = await admin.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true })
  if (error) throw error
  ids[nome] = data.user.id
  return data.user.id
}
async function subir(caminho, bucket = 'comprovacoes') {
  const { error } = await admin.storage.from(bucket).upload(caminho, JPG, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`upload ${bucket}: ${error.message}`)
  objetos.push([bucket, caminho])
}
const fisico = async (caminho, bucket = 'comprovacoes') => !(await admin.storage.from(bucket).download(caminho)).error
const linhaObj = (caminho, bucket = 'comprovacoes') => sql(`select count(*) from storage.objects where bucket_id='${bucket}' and name='${caminho}'`) === '1'
const estado = (caminho, bucket = 'comprovacoes') => sql(`select estado||':'||coalesce(ultima_mensagem,'') from public.storage_exclusao_fila where bucket='${bucket}' and caminho='${caminho}'`)
const naFila = (caminho) => sql(`select count(*) from public.storage_exclusao_fila where caminho='${caminho}'`)
const venceCarencia = (like) => sql(`update public.storage_exclusao_fila set processar_apos = now() - interval '1 minute', reservado_ate = null where caminho like '${like}' and estado='pendente'`)
const envelhece = (caminho, bucket = 'comprovacoes') => sql(`update storage.objects set created_at = now() - interval '10 days', updated_at = now() - interval '10 days' where bucket_id='${bucket}' and name='${caminho}'`)
const anexos = (...caminhos) => JSON.stringify(caminhos.map((p) => ({ campo: 'fotos', path: p })))
async function chamar(segredo, corpo = '{}') {
  let r
  for (let i = 0; i < 6; i++) {
    try { r = await fetch(FUNCAO_URL, { method: 'POST', headers: { 'x-storage-excluir-secret': segredo ?? '', 'content-type': 'application/json' }, body: corpo }); break } catch (e) { if (i === 5) throw e; await new Promise((res) => setTimeout(res, 2000)) }
  }
  let c = null; try { c = await r.json() } catch { /* */ }
  return { status: r.status, corpo: c }
}

async function main() {
  console.log('== lacunas da exclusão do Storage (533) contra Storage real local')
  const clube = sql(`select id from public.organizational_units where type='clube' order by created_at limit 1`)
  const A = await usuario('a'); const B = await usuario('b')
  sql(`delete from public.storage_exclusao_fila where caminho like '%${A}%' or caminho like '%${B}%'`)
  for (const u of [A, B]) sql(`insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values ('${u}', '${clube}', 'desbravador', 'ativo')`)

  // matrículas de classe reais do catálogo (insert direto; os gatilhos derivam usuario/clube) — requisitos que NÃO exigem foto de documento
  const classe = sql(`select s.class_id from public.class_sections s join public.class_requirements r on r.section_id = s.id group by s.class_id order by count(*) desc limit 1`)
  const reqs = sql(`select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id
                     where s.class_id = '${classe}' and not public._requisito_exige_documento(r.id) order by r.manifesto_id limit 12`).split('\n')
  const mr = {}
  for (const [u, nome, n] of [[A, 'a', 8], [B, 'b', 2]]) {
    sql(`insert into public.member_classes (usuario_id, club_id, class_id) values ('${u}', '${clube}', '${classe}')`)
    const mc = sql(`select id from public.member_classes where usuario_id='${u}' and class_id='${classe}'`)
    mr[nome] = []
    for (let i = 0; i < n; i++) {
      sql(`insert into public.member_requirements (member_class_id, requirement_id) values ('${mc}', '${reqs[i]}')`)
      mr[nome].push(sql(`select id from public.member_requirements where member_class_id='${mc}' and requirement_id='${reqs[i]}'`))
    }
  }
  const f = (tag) => `${A}/requisitos/e2e533-${tag}-${randomUUID().slice(0, 8)}.jpg`

  // --- 1) o cenário pedido: preencher o rascunho, TROCAR, conferir a fila, vencer a carência, executar a função ---
  const f1 = f('foto-antiga'); const f2 = f('foto-nova'); const f3 = f('anexo-saiu'); const f4 = f('anexo-ficou')
  for (const c of [f1, f2, f3, f4]) await subir(c)
  sql(`update public.member_requirements set evidencia_path='${f1}', rascunho_anexos='${anexos(f3, f4)}' where id='${mr.a[0]}'`)
  t('preencher o rascunho (null -> valor) não enfileirou nada', naFila(f1) === '0' && naFila(f3) === '0')
  sql(`update public.member_requirements set evidencia_path='${f2}', rascunho_anexos='${anexos(f4)}' where id='${mr.a[0]}'`)
  t('TROCAR a foto enfileirou a ANTIGA (pendente)', estado(f1).startsWith('pendente'), estado(f1))
  t('REMOVER um anexo do rascunho enfileirou só ele (pendente)', estado(f3).startsWith('pendente'), estado(f3))
  t('a foto NOVA e o anexo MANTIDO nunca entram na fila', naFila(f2) === '0' && naFila(f4) === '0')
  t('...e nada foi apagado na hora (arquivos físicos todos lá)', (await Promise.all([f1, f2, f3, f4].map((c) => fisico(c)))).every(Boolean))
  sql(`update public.member_requirements set evidencia_path='${f1}' where id='${mr.a[0]}'`)   // volta para f1 (f2 entra na fila)...
  sql(`update public.member_requirements set evidencia_path='${f2}' where id='${mr.a[0]}'`)   // ...e troca de novo: f1 sai DE NOVO
  t('trocar de novo antes da carência NÃO duplica (1 linha por caminho)', naFila(f1) === '1' && naFila(f2) === '1')
  sql(`delete from public.storage_exclusao_fila where caminho='${f2}'`)   // o cenário principal parte de f2 como foto vigente (f2 só entrou ao voltar/sair)

  t('função sem segredo = 401', (await chamar(null)).status === 401)
  const r0 = await chamar(SEGREDO)
  t('dentro da carência a função NÃO apagou nada nosso', r0.status === 200 && (await fisico(f1)) && (await fisico(f3)) && estado(f1).startsWith('pendente'), JSON.stringify(r0.corpo))
  // passa o tempo (SÓ no teste): carência da fila + idade dos objetos
  for (const c of [f1, f2, f3, f4]) envelhece(c)
  venceCarencia(`%${A}%`)
  const r1 = await chamar(SEGREDO)
  t('após a carência a função respondeu 200 sem falhas', r1.status === 200 && r1.corpo?.falhas === 0 && r1.corpo?.erro_confirmar === 0, JSON.stringify(r1.corpo))
  t('a foto ANTIGA sumiu FISICAMENTE (API do Storage e storage.objects)', !(await fisico(f1)) && !linhaObj(f1))
  t('o anexo que saiu do rascunho sumiu FISICAMENTE', !(await fisico(f3)) && !linhaObj(f3))
  t('fila: f1 e f3 = excluido', estado(f1).startsWith('excluido') && estado(f3).startsWith('excluido'), `${estado(f1)} | ${estado(f3)}`)
  t('a foto NOVA (vigente) PERMANECE', (await fisico(f2)) && linhaObj(f2))
  t('o anexo MANTIDO no rascunho PERMANECE', (await fisico(f4)) && linhaObj(f4))

  // --- 2) o arquivo voltou a ser referenciado antes de executar: NÃO exclui ---
  const g1 = f('voltou-1'); const g2 = f('voltou-2')
  await subir(g1); await subir(g2)
  sql(`update public.member_requirements set evidencia_path='${g1}' where id='${mr.a[1]}'`)
  sql(`update public.member_requirements set evidencia_path='${g2}' where id='${mr.a[1]}'`)           // g1 enfileirado
  t('g1 enfileirado ao ser trocado por g2', estado(g1).startsWith('pendente'))
  sql(`update public.member_requirements set evidencia_path='${g1}' where id='${mr.a[1]}'`)           // g1 VOLTA a ser a foto (g2 sai)
  envelhece(g1); envelhece(g2); venceCarencia(`%${A}%`)
  const r2 = await chamar(SEGREDO)
  t('arquivo que VOLTOU a ser a foto do requisito NÃO é excluído (mantido:referenciado)', (await fisico(g1)) && linhaObj(g1) && estado(g1) === 'mantido:referenciado', `${estado(g1)} ${JSON.stringify(r2.corpo)}`)
  t('...e o que saiu de verdade (g2) é excluído', !(await fisico(g2)) && !linhaObj(g2))
  // outra LINHA passa a usar o arquivo (outra coluna/linha): idem
  const h1 = f('outra-linha-1'); const h2 = f('outra-linha-2')
  await subir(h1); await subir(h2)
  sql(`update public.member_requirements set evidencia_path='${h1}' where id='${mr.a[2]}'`)
  sql(`update public.member_requirements set evidencia_path='${h2}' where id='${mr.a[2]}'`)           // h1 enfileirado
  sql(`update public.member_requirements set rascunho_anexos='${anexos(h1)}' where id='${mr.a[3]}'`)    // outra linha, outra coluna (anexo) passa a usar h1
  envelhece(h1); venceCarencia(`%${A}%`)
  await chamar(SEGREDO)
  t('arquivo que OUTRA linha/coluna passou a usar NÃO é excluído', (await fisico(h1)) && estado(h1) === 'mantido:referenciado', estado(h1))

  // --- 3) histórico IMUTÁVEL: foto já ENVIADA (tentativa) nunca some, mesmo trocada no rascunho ---
  const s1 = f('enviada-1'); const s2 = f('enviada-2')
  await subir(s1); await subir(s2)
  sql(`update public.member_requirements set evidencia_path='${s1}' where id='${mr.a[4]}'`)
  sql(`insert into public.requirement_submissions (member_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_path) values ('${mr.a[4]}', 1, 'foto', '${s1}')`)
  sql(`update public.member_requirements set evidencia_path='${s2}' where id='${mr.a[4]}'`)           // aluno corrige depois da devolução
  envelhece(s1); venceCarencia(`%${A}%`)
  await chamar(SEGREDO)
  t('foto da TENTATIVA ENVIADA (histórico imutável) NÃO é excluída (mantido:referenciado)', (await fisico(s1)) && linhaObj(s1) && estado(s1) === 'mantido:referenciado', estado(s1))
  t('...e a foto nova do rascunho também permanece', await fisico(s2))

  // --- 4) forjado: B aponta o requisito dele para o arquivo (sem referência) de A e depois remove ---
  const v1 = f('vitima'); await subir(v1)
  sql(`update public.member_requirements set evidencia_path='${v1}' where id='${mr.b[0]}'`)
  sql(`update public.member_requirements set evidencia_path=null where id='${mr.b[0]}'`)
  t('caminho FORJADO foi enfileirado com dono_confere = false (dono da linha = B)', sql(`select dono_confere::text||'|'||(dono_linha='${B}')::text from public.storage_exclusao_fila where caminho='${v1}'`) === 'false|true')
  envelhece(v1); venceCarencia(`%${A}%`)
  await chamar(SEGREDO)
  t('FORJADO (arquivo de A na linha de B) PERMANECE e fica mantido:dono_diferente', (await fisico(v1)) && linhaObj(v1) && estado(v1) === 'mantido:dono_diferente', estado(v1))

  // --- 5) B (outro usuário) troca a própria foto: só o arquivo dele é liberado ---
  const b1 = `${B}/requisitos/e2e533-b1-${randomUUID().slice(0, 8)}.jpg`; const b2 = `${B}/requisitos/e2e533-b2-${randomUUID().slice(0, 8)}.jpg`
  await subir(b1); await subir(b2)
  sql(`update public.member_requirements set evidencia_path='${b1}' where id='${mr.b[1]}'`)
  sql(`update public.member_requirements set evidencia_path='${b2}' where id='${mr.b[1]}'`)
  envelhece(b1); venceCarencia(`%${B}%`)
  await chamar(SEGREDO)
  t('foto antiga do B foi excluída; a nova do B permanece; nada de A foi tocado por isso', !(await fisico(b1)) && (await fisico(b2)) && (await fisico(f2)) && (await fisico(f4)))

  // --- 6) idempotência e DELETE da linha ---
  const r9 = await chamar(SEGREDO)
  t('2ª rodada sem nada novo é idempotente (200, sem exclusão dupla)', r9.status === 200 && r9.corpo?.ausentes === 0 && r9.corpo?.falhas === 0, JSON.stringify(r9.corpo))
  const d1 = f('apagada-1'); const d2 = f('apagada-2')
  await subir(d1); await subir(d2)
  sql(`update public.member_requirements set evidencia_path='${d1}', rascunho_anexos='${anexos(d2)}' where id='${mr.a[5]}'`)
  sql(`delete from public.member_requirements where id='${mr.a[5]}'`)
  t('apagar a linha (DELETE) enfileirou a foto e o anexo', estado(d1).startsWith('pendente') && estado(d2).startsWith('pendente'))
  envelhece(d1); envelhece(d2); venceCarencia(`%${A}%`)
  await chamar(SEGREDO)
  t('...e a função apagou os dois fisicamente', !(await fisico(d1)) && !(await fisico(d2)))
  t('nenhuma falha de exclusão ficou registrada para os dados de teste', sql(`select count(*) from public.storage_exclusao_fila where estado='falhou' and (caminho like '%${A}%' or caminho like '%${B}%')`) === '0')
}

async function limpar() {
  const a = ids.a ?? 'x-x'; const b = ids.b ?? 'x-x'
  try {
    for (const [bk, n] of objetos) await admin.storage.from(bk).remove([n]).catch(() => {})
    for (const k of Object.keys(ids)) await admin.auth.admin.deleteUser(ids[k]).catch(() => {})   // cascata: matrícula/requisitos/histórico do usuário
    // o delete do usuário (cascata) enfileira os últimos caminhos: zera o resíduo e o que sobrou em storage.objects
    sql(`delete from public.storage_exclusao_fila where caminho like '%${a}%' or caminho like '%${b}%'`)
    for (const u of [a, b]) {   // o que sobrar em storage.objects só sai pela API do Storage (o banco proíbe delete direto)
      const { data } = await admin.storage.from('comprovacoes').list(`${u}/requisitos`, { limit: 200 })
      if (data?.length) await admin.storage.from('comprovacoes').remove(data.map((o) => `${u}/requisitos/${o.name}`)).catch(() => {})
    }
    sql(`delete from public.infra_falhas where origem like 'storage/exclusao%' and quando >= '${inicio}'::timestamptz`)
  } catch (e) { console.log('limpeza parcial:', e.message) }
  // contagens finais: nada de teste pode sobrar
  const sobra = Number(sql(`select count(*) from storage.objects where bucket_id='comprovacoes' and (name like '${a}/%' or name like '${b}/%')`))
  const fila = Number(sql(`select count(*) from public.storage_exclusao_fila where caminho like '%${a}%' or caminho like '%${b}%'`))
  const inf = Number(sql(`select count(*) from public.infra_falhas where origem like 'storage/exclusao%' and quando >= '${inicio}'::timestamptz`))
  t('limpeza: 0 objetos sintéticos, 0 linhas de fila de teste e 0 infra_falhas de teste restantes', sobra === 0 && fila === 0 && inf === 0, `objetos=${sobra} fila=${fila} infra=${inf}`)
}

try { await main() } catch (e) { falhas.push('EXCEÇÃO: ' + (e.message || e)); console.log(e) } finally { await limpar() }
console.log(`\n${falhas.length ? 'FALHOU' : 'OK'} — ${ok} verificações ok, ${falhas.length} falha(s)`)
falhas.forEach((f) => console.log('  -', f))
process.exit(falhas.length ? 1 : 0)
