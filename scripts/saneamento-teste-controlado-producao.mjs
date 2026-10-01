#!/usr/bin/env node
// TESTE CONTROLADO do saneamento de imagens no Storage de PRODUÇÃO, SÓ com arquivos criados aqui (nunca foto real de usuário).
//   * cria 3 objetos de teste no bucket `comprovacoes`, numa pasta de um UUID SINTÉTICO (não é nenhum usuário): um JPEG com EXIF+GPS,
//     um JPEG truncado (inválido) e um "HEIC" (formato não suportado);
//   * marca o dono (owner_id) do objeto de teste, como o Storage faria para um usuário, e enfileira pelo RPC real (identidade simulada);
//   * chama a Edge Function de verdade (`sanear-imagens`) e confere: EXIF/GPS saem, imagem continua válida, owner_id e mimetype iguais,
//     policies/RLS de storage.objects idênticas (hash), outro usuário e anon não enxergam o objeto (RLS avaliada no banco),
//     2ª chamada não regrava (idempotente), inválido/HEIC ficam byte a byte iguais;
//   * apaga SÓ os objetos de teste e as linhas de fila deles. Nenhuma foto real é lida, alterada ou apagada.
// Variáveis (NOMES; nunca valores na linha de comando): DB_URL_PRODUCAO, SUPABASE_ACCESS_TOKEN (Management API, p/ obter a chave de serviço em memória),
// SANEAMENTO_SECRET_ARQUIVO (caminho de um arquivo com o segredo da função), PROJECT_REF.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'

const DB = process.env.DB_URL_PRODUCAO, TOKEN = process.env.SUPABASE_ACCESS_TOKEN, REF = process.env.PROJECT_REF
const SEG_ARQ = process.env.SANEAMENTO_SECRET_ARQUIVO
if (!DB || !TOKEN || !REF || !SEG_ARQ) { console.error('Faltam variáveis: DB_URL_PRODUCAO, SUPABASE_ACCESS_TOKEN, PROJECT_REF, SANEAMENTO_SECRET_ARQUIVO'); process.exit(2) }
const SEGREDO = readFileSync(SEG_ARQ, 'utf8').trim()
const BASE = `https://${REF}.supabase.co`
// SQL entra por stdin (a URL do banco, com a senha, NUNCA vai em mensagem de erro nem em log): erros são reescritos sem argumentos
function psqlSeguro(sql) {
  try { return execFileSync('psql', [DB, '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
  catch (e) { throw new Error('psql falhou: ' + String(e.stderr || '').split(String.fromCharCode(10)).filter(Boolean).slice(0, 2).join(' | ').replaceAll(DB, '<db>').slice(0, 220)) }
}
const psql = (q) => psqlSeguro(q)
const psqlArq = (sql) => psqlSeguro(sql)

const chaves = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
const SERVICO = chaves.find((k) => k.name === 'service_role')?.api_key
if (!SERVICO) { console.error('Sem chave de serviço (somente leitura em memória).'); process.exit(2) }
const H = { Authorization: `Bearer ${SERVICO}`, apikey: SERVICO }

let ok = 0; const falhas = []
const t = (nome, cond, det = '') => { if (cond) ok++; else { falhas.push(nome + (det ? ` [${det}]` : '')); console.log('  FALHOU:', nome, det) } }
const sha = (b) => createHash('sha256').update(b).digest('hex')

// ---- fixtures ----
const MARCA = 'TESTE-CONTROLADO-GPS-7c1e'
const JPG_BASE = Buffer.concat([Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'), Buffer.from([0xff, 0xd9])])
function exif() {
  const make = Buffer.from(MARCA + '\0')
  const th = Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])
  const gpsOff = 8 + 2 + 2 * 12 + 4 + make.length
  const ifd0 = Buffer.alloc(2 + 24 + 4); ifd0.writeUInt16LE(2, 0)
  const ent = (i, tag, tp, c, v) => { const o = 2 + i * 12; ifd0.writeUInt16LE(tag, o); ifd0.writeUInt16LE(tp, o + 2); ifd0.writeUInt32LE(c, o + 4); ifd0.writeUInt32LE(v, o + 8) }
  ent(0, 0x010f, 2, make.length, 8 + 2 + 24 + 4); ent(1, 0x8825, 4, 1, gpsOff)
  const gps = Buffer.alloc(2 + 24 + 4); gps.writeUInt16LE(2, 0)
  const corpo = Buffer.concat([Buffer.from('Exif\0\0'), th, ifd0, make, gps])
  const app1 = Buffer.alloc(4); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(corpo.length + 2, 2)
  return Buffer.concat([app1, corpo])
}
const jpegExif = Buffer.concat([JPG_BASE.subarray(0, 2), exif(), JPG_BASE.subarray(2)])
const jpegTruncado = jpegExif.subarray(0, jpegExif.length - 30) // corta no meio do scan e sem EOI
const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(40, 7)])
const temExif = (b) => b.includes(Buffer.from('Exif\0\0')) || b.includes(Buffer.from(MARCA))

const TESTUID = randomUUID()
const pasta = `${TESTUID}/requisitos`
const objs = { exif: `${pasta}/${randomUUID()}.jpg`, truncado: `${pasta}/${randomUUID()}.jpg`, heic: `${pasta}/${randomUUID()}.jpg` }
const enviar = async (nome, corpo) => {
  const r = await fetch(`${BASE}/storage/v1/object/comprovacoes/${nome}`, { method: 'POST', headers: { ...H, 'content-type': 'image/jpeg', 'x-upsert': 'false' }, body: corpo })
  return r.ok
}
const baixar = async (nome) => { const r = await fetch(`${BASE}/storage/v1/object/comprovacoes/${nome}`, { headers: H }); return r.ok ? Buffer.from(await r.arrayBuffer()) : null }
const linha = (nome) => psql(`select coalesce(owner_id,'-')||'|'||coalesce(metadata->>'mimetype','')||'|'||coalesce(metadata->>'size','')||'|'||coalesce(updated_at::text,'') from storage.objects where bucket_id='comprovacoes' and name='${nome}'`)
const polHash = () => psql(`select md5(string_agg(policyname||cmd||coalesce(qual,'')||coalesce(with_check,''),'|' order by policyname)) from pg_policies where schemaname='storage' and tablename='objects'`)
const demaisObjetos = () => psql(`select count(*)||'|'||coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where name not like '${TESTUID}/%'`)
const visivelPara = (uid, nome) => psqlArq(`begin; set local role ${uid ? 'authenticated' : 'anon'}; ${uid ? `select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);` : ''} select count(*) from storage.objects where bucket_id='comprovacoes' and name='${nome}'; rollback;`).split('\n').filter((l) => /^\d+$/.test(l.trim())).pop()
const chamar = async (seg) => { const r = await fetch(`${BASE}/functions/v1/sanear-imagens`, { method: 'POST', headers: { 'x-saneamento-secret': seg, 'content-type': 'application/json' }, body: '{}' }); let c = null; try { c = await r.json() } catch { /* */ } return { s: r.status, c } }

async function limpar() {
  for (const n of Object.values(objs)) await fetch(`${BASE}/storage/v1/object/comprovacoes/${n}`, { method: 'DELETE', headers: H }).catch(() => {})
  try { psql(`delete from public.imagem_saneamento where caminho like '${TESTUID}/%'`); psql(`delete from storage.objects where bucket_id='comprovacoes' and name like '${TESTUID}/%'`) } catch { /* */ }
}

try {
  console.log('== teste controlado em PRODUÇÃO (objetos sintéticos; pasta de UUID inexistente)')
  t('fila vazia antes (só nossos itens entrarão)', psql(`select count(*) from public.imagem_saneamento`) === '0')
  const outrosAntes = demaisObjetos(); const polAntes = polHash()
  const rlsAntes = psql(`select relrowsecurity from pg_class where oid='storage.objects'::regclass`)
  t('fixture tem EXIF/GPS', temExif(jpegExif))
  t('sobe JPEG com EXIF', await enviar(objs.exif, jpegExif)); t('sobe JPEG truncado', await enviar(objs.truncado, jpegTruncado)); t('sobe "HEIC"', await enviar(objs.heic, heic))
  // o Storage de um usuário real marca o dono; aqui marcamos o dono sintético só nos nossos objetos
  psql(`update storage.objects set owner_id='${TESTUID}', owner='${TESTUID}' where bucket_id='comprovacoes' and name like '${TESTUID}/%'`)
  const antes = linha(objs.exif); const shaTrunc = sha(await baixar(objs.truncado)); const shaHeic = sha(await baixar(objs.heic))
  t('owner_id do objeto de teste definido', antes.startsWith(TESTUID + '|'), antes.split('|')[0])
  t('dono sintético VÊ o próprio objeto (RLS no banco)', visivelPara(TESTUID, objs.exif) === '1')
  t('outro usuário NÃO vê', visivelPara(randomUUID(), objs.exif) === '0'); t('anon NÃO vê', visivelPara(null, objs.exif) === '0')
  // enfileira pelo RPC REAL, com a identidade do dono sintético (o app faz isto; o RPC valida caminho e dono)
  for (const n of Object.values(objs)) {
    const r = psqlArq(`begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"${TESTUID}","role":"authenticated"}', true); select public.imagem_saneamento_enfileirar('comprovacoes','${n}'); commit;`)
    t('enfileirar pelo RPC real', /"estado"/.test(r) && /pendente/.test(r), r.slice(0, 60))
  }
  t('só 3 itens na fila (os nossos)', psql(`select count(*) from public.imagem_saneamento`) === '3')
  const f0 = await chamar('errado'); t('função com segredo errado = 401 e nada tocado', f0.s === 401 && linha(objs.exif) === antes)
  const r1 = await chamar(SEGREDO); t('função com segredo = 200', r1.s === 200, JSON.stringify(r1.c))
  const est = (n) => psql(`select estado||'|'||coalesce(motivo,'') from public.imagem_saneamento where caminho='${n}'`)
  t('JPEG com EXIF: ok', est(objs.exif).startsWith('ok'), est(objs.exif)); t('truncado: motivo invalida (fica em retry com espera; arquivo intacto)', /^(pendente|falhou)|invalida/.test(est(objs.truncado)), est(objs.truncado)); t('HEIC: ignorado', est(objs.heic).startsWith('ignorado'), est(objs.heic))
  const dep = await baixar(objs.exif)
  t('EXIF/GPS/marcador REMOVIDOS', dep && !temExif(dep)); t('continua JPEG válido (SOI/EOI)', dep && dep[0] === 0xff && dep[1] === 0xd8 && dep.at(-2) === 0xff && dep.at(-1) === 0xd9)
  t('ficou menor', dep && dep.length < jpegExif.length, `${dep?.length} < ${jpegExif.length}`)
  const depois = linha(objs.exif); const [oA, mA] = antes.split('|'); const [oD, mD] = depois.split('|')
  t('owner_id PRESERVADO', oD === oA && oD === TESTUID, `${oA} -> ${oD}`); t('mimetype PRESERVADO', mD === mA, `${mA} -> ${mD}`)
  t('RLS de storage.objects intacta', psql(`select relrowsecurity from pg_class where oid='storage.objects'::regclass`) === rlsAntes)
  t('policies de storage.objects IDÊNTICAS (hash)', polHash() === polAntes)
  t('dono continua vendo', visivelPara(TESTUID, objs.exif) === '1'); t('outro usuário continua sem ver', visivelPara(randomUUID(), objs.exif) === '0'); t('anon continua sem ver', visivelPara(null, objs.exif) === '0')
  t('dono do objeto reconhecido pela função do projeto', psql(`select public.dono_do_objeto(owner, owner_id)::text from storage.objects where bucket_id='comprovacoes' and name='${objs.exif}'`) === TESTUID)
  t('truncado: arquivo BYTE A BYTE igual (nada corrompido)', sha(await baixar(objs.truncado)) === shaTrunc); t('HEIC: arquivo byte a byte igual', sha(await baixar(objs.heic)) === shaHeic)
  const r2 = await chamar(SEGREDO); t('2ª chamada = 200', r2.s === 200); t('2ª chamada idempotente (não regravou)', linha(objs.exif) === depois)
  const re = psqlArq(`begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"${TESTUID}","role":"authenticated"}', true); select public.imagem_saneamento_enfileirar('comprovacoes','${objs.exif}'); commit;`)
  t('re-enfileirar objeto já saneado continua ok', /"estado": ?"ok"/.test(re), re.slice(0, 60))
  t('NENHUM outro objeto do Storage foi tocado (contagem e bytes)', demaisObjetos() === outrosAntes, `${outrosAntes} -> ${demaisObjetos()}`)
} catch (e) { falhas.push('EXCEÇÃO: ' + (e.message || e).toString().slice(0, 200)) } finally { await limpar() }
const resto = psql(`select count(*) from storage.objects where name like '${TESTUID}/%'`)
console.log(`limpeza: objetos de teste restantes = ${resto}; fila restante = ${psql('select count(*) from public.imagem_saneamento')}`)
console.log(`\n${falhas.length ? 'FALHOU' : 'OK'} — ${ok} verificações ok, ${falhas.length} falha(s)`); falhas.forEach((f) => console.log('  -', f))
process.exit(falhas.length ? 1 : 0)
