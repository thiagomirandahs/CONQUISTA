// E2E do SANEAMENTO DE IMAGENS contra o Storage REAL LOCAL + a Edge Function `sanear-imagens` rodando de verdade no edge-runtime
// (LOCAL, nunca produção). Prova (migration 529): EXIF/GPS saem do arquivo; owner_id, permissões e RLS do Storage ficam iguais;
// outro usuário e anon continuam sem acesso; a função falha fechada sem o segredo; é idempotente (2ª chamada não regrava);
// formato desconhecido vira 'ignorado'; o cron nasce desligado.
//
//   Pré-requisitos (a mesma ordem do supabase/tests/e2e/saneamento-storage-real.sh, que faz tudo isso sozinho):
//     * Supabase local no ar COM as migrations 528/529;
//     * a função rodando em FUNCAO_URL (padrão http://127.0.0.1:54399/) com o MESMO segredo em SANEAMENTO_SECRET.
//   Dados de teste com prefixo "e2e-san-"; limpa tudo no fim (mesmo se falhar).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const CONT_FN = process.env.SUPABASE_EDGE_CONTAINER || 'supabase_edge_runtime_CONQUISTA'
const FUNCAO_URL = process.env.FUNCAO_URL || 'http://127.0.0.1:54399/'
const SEGREDO = process.env.SANEAMENTO_SECRET
const URL_API = process.env.API_URL || 'http://127.0.0.1:54321'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_API) || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(FUNCAO_URL)) {
  console.error('ABORTADO: este teste só roda contra o Supabase LOCAL.'); process.exit(2)
}
if (!SEGREDO) { console.error('ABORTADO: defina SANEAMENTO_SECRET (o mesmo valor da função local).'); process.exit(2) }

const printenv = (nome) => execFileSync('docker', ['exec', CONT_FN, 'printenv', nome], { encoding: 'utf8' }).trim()
const ANON = printenv('SUPABASE_ANON_KEY')
const SERVICE = printenv('SUPABASE_SERVICE_ROLE_KEY')
const sql = (texto) => execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()

let ok = 0; const falhas = []
const t = (nome, cond, detalhe = '') => { if (cond) ok++; else { falhas.push(nome + (detalhe ? ` [${detalhe}]` : '')); console.log('  FALHOU:', nome, detalhe) } }

// ---------- fixtures: JPEG/PNG reais com EXIF + GPS + marcador textual ----------
// o JPEG de partida dos outros E2E não tem o marcador de fim (EOI): completo aqui, senão o saneador (corretamente) o trata como truncado
const JPG_BASE = Buffer.concat([Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'), Buffer.from([0xff, 0xd9])])
const MARCA = 'APARELHO-E2E-GPS-9f3a'
function exifComGps() {
  // TIFF little-endian: IFD0 (Make, GPSInfo) + GPS IFD (lat/lon refs + racionais) — o bastante para um leitor de EXIF achar GPS
  const make = Buffer.from(MARCA + '\0')
  const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00])
  const ifd0Off = 8, nIfd0 = 2
  const gpsOff = ifd0Off + 2 + nIfd0 * 12 + 4 + make.length
  const ifd0 = Buffer.alloc(2 + nIfd0 * 12 + 4)
  ifd0.writeUInt16LE(nIfd0, 0)
  const ent = (i, tag, tipo, cont, val) => { const o = 2 + i * 12; ifd0.writeUInt16LE(tag, o); ifd0.writeUInt16LE(tipo, o + 2); ifd0.writeUInt32LE(cont, o + 4); ifd0.writeUInt32LE(val, o + 8) }
  ent(0, 0x010f, 2, make.length, ifd0Off + 2 + nIfd0 * 12 + 4) // Make (ASCII) logo depois do IFD0
  ent(1, 0x8825, 4, 1, gpsOff)                                  // GPSInfo -> GPS IFD
  const gps = Buffer.alloc(2 + 2 * 12 + 4); gps.writeUInt16LE(2, 0)
  gps.write('N', 2 + 8); gps.writeUInt16LE(0x0001, 2); gps.writeUInt16LE(2, 4); gps.writeUInt32LE(2, 6)
  gps.write('W', 2 + 12 + 8); gps.writeUInt16LE(0x0003, 2 + 12); gps.writeUInt16LE(2, 2 + 12 + 2); gps.writeUInt32LE(2, 2 + 12 + 4)
  const tiff = Buffer.concat([tiffHeader, ifd0, make, gps])
  const corpo = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
  const app1 = Buffer.alloc(4); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(corpo.length + 2, 2)
  return Buffer.concat([app1, corpo])
}
const jpegComExif = () => Buffer.concat([JPG_BASE.subarray(0, 2), exifComGps(), JPG_BASE.subarray(2)])
const temExif = (b) => b.includes(Buffer.from('Exif\0\0')) || b.includes(Buffer.from(MARCA))
const PNG_BASE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
function pngComTexto() { // insere um chunk tEXt (Comment=MARCA) logo depois do IHDR
  const dados = Buffer.from('Comment\0' + MARCA)
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length)
  const tipo = Buffer.from('tEXt')
  const crc = Buffer.alloc(4) // CRC não é conferido pelo saneador; o chunk será removido
  const chunk = Buffer.concat([len, tipo, dados, crc])
  const pos = 8 + 25 // assinatura + IHDR (4+4+13+4)
  return Buffer.concat([PNG_BASE.subarray(0, pos), chunk, PNG_BASE.subarray(pos)])
}

const mk = (key) => createClient(URL_API, key, { auth: { persistSession: false, autoRefreshToken: false } })
const admin = mk(SERVICE)
const SENHA = 'senha-e2e-san-123'
const ids = {}; const objetos = []
async function usuario(nome) {
  const email = `e2e-san-${nome}-${randomUUID().slice(0, 8)}@teste.local`
  const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error) throw error
  const c = mk(ANON)
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: SENHA })
  if (e2) throw e2
  ids[nome] = data.user.id
  return c
}
const linhaObj = (bucket, caminho) => sql(`select coalesce(owner_id,'∅')||'|'||coalesce(owner::text,'∅')||'|'||coalesce(metadata->>'size','')||'|'||coalesce(metadata->>'mimetype','')||'|'||coalesce(updated_at::text,'') from storage.objects where bucket_id='${bucket}' and name='${caminho}'`)
const policiesHash = () => sql(`select md5(string_agg(policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), '|' order by policyname)) from pg_policies where schemaname='storage' and tablename='objects'`)
async function chamarFuncao(segredo) {
  // a 1ª chamada ao edge-runtime pode encontrar o container ainda aquecendo (máquina carregada): tenta de novo só em ERRO DE REDE (nunca em resposta HTTP)
  let r
  for (let i = 0; i < 6; i++) {
    try { r = await fetch(FUNCAO_URL, { method: 'POST', headers: { 'x-saneamento-secret': segredo ?? '', 'content-type': 'application/json' }, body: '{}' }); break } catch (e) { if (i === 5) throw e; await new Promise((res) => setTimeout(res, 2000)) }
  }
  let corpo = null; try { corpo = await r.json() } catch { /* */ }
  return { status: r.status, corpo }
}

async function main() {
  console.log('== saneamento contra Storage real local')
  t('cron "imagem-sanear" nasce inativo', sql(`select count(*) from cron.job where jobname='imagem-sanear' and not active`) === '1')
  const rlsAntes = sql(`select relrowsecurity from pg_class where oid='storage.objects'::regclass`)
  const polAntes = policiesHash()

  const A = await usuario('a'); const B = await usuario('b')
  const anon = mk(ANON)

  // --- 1) comprovacoes: A sobe JPEG com EXIF+GPS ---
  const orig = jpegComExif()
  t('fixture tem EXIF/GPS antes', temExif(orig))
  const caminhoC = `${ids.a}/requisitos/${randomUUID()}.jpg`
  let up = await A.storage.from('comprovacoes').upload(caminhoC, orig, { contentType: 'image/jpeg', upsert: false })
  t('A sobe o JPEG no bucket comprovacoes', !up.error, up.error?.message); objetos.push(['comprovacoes', caminhoC])
  const antesC = linhaObj('comprovacoes', caminhoC)
  t('objeto tem owner_id do A antes', antesC.startsWith(ids.a + '|'), antesC.split('|')[0])

  // --- 2) imagens: A sobe PNG com tEXt (perfis/<uid>.png) ---
  const caminhoI = `perfis/${ids.a}-foto.png`
  const upI = await A.storage.from('imagens').upload(caminhoI, pngComTexto(), { contentType: 'image/png', upsert: true })
  t('A sobe o PNG no bucket imagens', !upI.error, upI.error?.message); objetos.push(['imagens', caminhoI])
  const antesI = linhaObj('imagens', caminhoI)

  // --- 3) acesso ANTES: dono lê; outro usuário e anon não ---
  const dl = async (cli, bucket, caminho) => (await cli.storage.from(bucket).download(caminho))
  t('A lê o próprio arquivo antes', !(await dl(A, 'comprovacoes', caminhoC)).error)
  t('B NÃO lê o arquivo do A antes', !!(await dl(B, 'comprovacoes', caminhoC)).error)
  t('anon NÃO lê o arquivo do A antes', !!(await dl(anon, 'comprovacoes', caminhoC)).error)

  // --- 4) a fila: só o dono enfileira; B não enfileira o objeto do A ---
  const enfB = await B.rpc('imagem_saneamento_enfileirar', { p_bucket: 'comprovacoes', p_caminho: caminhoC })
  t('B NÃO enfileira objeto do A (mensagem única)', !!enfB.error && /Objeto inválido/.test(enfB.error.message), enfB.error?.message)
  const enfAnon = await anon.rpc('imagem_saneamento_enfileirar', { p_bucket: 'comprovacoes', p_caminho: caminhoC })
  t('anon NÃO enfileira', !!enfAnon.error)
  const enfA = await A.rpc('imagem_saneamento_enfileirar', { p_bucket: 'comprovacoes', p_caminho: caminhoC })
  t('A enfileira o próprio objeto', !enfA.error && enfA.data?.estado === 'pendente', enfA.error?.message)
  const enfA2 = await A.rpc('imagem_saneamento_enfileirar', { p_bucket: 'imagens', p_caminho: caminhoI })
  t('A enfileira a própria imagem (bucket imagens)', !enfA2.error, enfA2.error?.message)

  // --- 5) a função: sem segredo e com segredo errado => 401 e nada é tocado ---
  const f0 = await chamarFuncao(null); const f1 = await chamarFuncao('errado')
  t('função sem segredo = 401', f0.status === 401, String(f0.status)); t('função com segredo errado = 401', f1.status === 401, String(f1.status))
  t('arquivo intocado depois dos 401', linhaObj('comprovacoes', caminhoC) === antesC)

  // --- 6) a função de verdade, com o segredo ---
  const r1 = await chamarFuncao(SEGREDO)
  t('função com segredo = 200', r1.status === 200, `${r1.status} ${JSON.stringify(r1.corpo)}`)
  const estC = sql(`select estado||'|'||coalesce(motivo,'') from public.imagem_saneamento where bucket='comprovacoes' and caminho='${caminhoC}'`)
  const estI = sql(`select estado||'|'||coalesce(motivo,'') from public.imagem_saneamento where bucket='imagens' and caminho='${caminhoI}'`)
  t('fila: JPEG de comprovacoes ficou ok', estC.startsWith('ok'), estC); t('fila: PNG de imagens ficou ok', estI.startsWith('ok'), estI)

  // --- 7) o arquivo saneado ---
  const baixaC = Buffer.from(await (await dl(A, 'comprovacoes', caminhoC)).data.arrayBuffer())
  t('JPEG saneado SEM EXIF/GPS/marcador', !temExif(baixaC))
  t('JPEG saneado continua JPEG íntegro (SOI/EOI)', baixaC[0] === 0xff && baixaC[1] === 0xd8 && baixaC.at(-2) === 0xff && baixaC.at(-1) === 0xd9)
  t('JPEG saneado ficou menor que o original', baixaC.length < orig.length, `${baixaC.length} < ${orig.length}`)
  const baixaI = Buffer.from(await (await dl(A, 'imagens', caminhoI)).data.arrayBuffer())
  t('PNG saneado SEM o chunk de texto', !temExif(baixaI) && !baixaI.includes(Buffer.from('tEXt')))
  t('PNG saneado continua PNG (assinatura)', baixaI.subarray(0, 8).equals(PNG_BASE.subarray(0, 8)))

  // --- 8) owner_id, tipo e demais metadados preservados; RLS/permissões idênticas ---
  const depoisC = linhaObj('comprovacoes', caminhoC); const depoisI = linhaObj('imagens', caminhoI)
  const [oA, , , mA] = antesC.split('|'); const [oD, , , mD] = depoisC.split('|')
  t('owner_id PRESERVADO (comprovacoes)', oD === oA && oD === ids.a, `${oA} -> ${oD}`)
  t('owner_id PRESERVADO (imagens)', depoisI.split('|')[0] === antesI.split('|')[0] && depoisI.split('|')[0] === ids.a, `${antesI.split('|')[0]} -> ${depoisI.split('|')[0]}`)
  t('mimetype preservado', mD === mA && depoisI.split('|')[3] === antesI.split('|')[3], `${mA} -> ${mD}`)
  t('RLS de storage.objects continua ligada', sql(`select relrowsecurity from pg_class where oid='storage.objects'::regclass`) === rlsAntes)
  t('policies de storage.objects IDÊNTICAS (hash)', policiesHash() === polAntes)
  t('A continua lendo o próprio arquivo', !(await dl(A, 'comprovacoes', caminhoC)).error && !(await dl(A, 'imagens', caminhoI)).error)
  t('B continua SEM ler (comprovacoes)', !!(await dl(B, 'comprovacoes', caminhoC)).error)
  t('anon continua SEM ler (comprovacoes)', !!(await dl(anon, 'comprovacoes', caminhoC)).error)
  t('B continua SEM sobrescrever o arquivo do A', !!(await B.storage.from('comprovacoes').upload(caminhoC, Buffer.from('x'), { upsert: true })).error)
  t('dono do objeto reconhecido pela função do projeto', sql(`select public.dono_do_objeto(owner, owner_id)::text from storage.objects where bucket_id='comprovacoes' and name='${caminhoC}'`) === ids.a)

  // --- 9) idempotência: 2ª chamada não regrava nada ---
  const r2 = await chamarFuncao(SEGREDO)
  t('2ª chamada = 200', r2.status === 200)
  t('2ª chamada não regravou (updated_at igual)', linhaObj('comprovacoes', caminhoC) === depoisC && linhaObj('imagens', caminhoI) === depoisI)
  // re-enfileirar sem mudança não volta para pendente
  const re = await A.rpc('imagem_saneamento_enfileirar', { p_bucket: 'comprovacoes', p_caminho: caminhoC })
  t('re-enfileirar objeto já saneado fica ok (idempotente)', re.data?.estado === 'ok', JSON.stringify(re.data))
  t('porta da Rede: _imagem_saneamento_liberada é verdadeira só depois do saneamento', sql(`select public._imagem_saneamento_liberada('comprovacoes','${caminhoC}')`) === 't')

  // --- 10) formato desconhecido => ignorado (nunca quebra o arquivo) ---
  const caminhoH = `${ids.a}/requisitos/${randomUUID()}.jpg`
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(40, 7)])
  const upH = await A.storage.from('comprovacoes').upload(caminhoH, heic, { contentType: 'image/jpeg' })
  t('A sobe um arquivo HEIC (extensão enganosa)', !upH.error, upH.error?.message); objetos.push(['comprovacoes', caminhoH])
  await A.rpc('imagem_saneamento_enfileirar', { p_bucket: 'comprovacoes', p_caminho: caminhoH })
  const antesH = linhaObj('comprovacoes', caminhoH)
  await chamarFuncao(SEGREDO)
  t('HEIC fica "ignorado" e o arquivo NÃO é alterado', sql(`select estado from public.imagem_saneamento where caminho='${caminhoH}'`) === 'ignorado' && linhaObj('comprovacoes', caminhoH) === antesH)

  // --- 10b) rótulo divergente: bytes JPEG enviados com mimetype image/png (acontece em fotos antigas) — o mimetype ORIGINAL é preservado
  const caminhoM = `${ids.a}/requisitos/${randomUUID()}.png`
  const upM = await A.storage.from('comprovacoes').upload(caminhoM, jpegComExif(), { contentType: 'image/png', upsert: false })
  t('A sobe JPEG com mimetype image/png (rótulo divergente)', !upM.error, upM.error?.message); objetos.push(['comprovacoes', caminhoM])
  await A.rpc('imagem_saneamento_enfileirar', { p_bucket: 'comprovacoes', p_caminho: caminhoM })
  const antesM = linhaObj('comprovacoes', caminhoM)
  await chamarFuncao(SEGREDO)
  const depoisM = linhaObj('comprovacoes', caminhoM)
  const baixaM = Buffer.from(await (await dl(A, 'comprovacoes', caminhoM)).data.arrayBuffer())
  t('rótulo divergente: EXIF removido', !temExif(baixaM))
  t('rótulo divergente: mimetype ORIGINAL preservado (image/png)', antesM.split('|')[3] === 'image/png' && depoisM.split('|')[3] === 'image/png', `${antesM.split('|')[3]} -> ${depoisM.split('|')[3]}`)
  t('rótulo divergente: owner_id preservado', depoisM.split('|')[0] === antesM.split('|')[0] && depoisM.startsWith(ids.a + '|'))

  // --- 11) a fila não vaza para o app: authenticated não lê a tabela ---
  const lerFila = await A.from('imagem_saneamento').select('*').limit(1)
  t('authenticated NÃO lê a tabela da fila', !!lerFila.error || (lerFila.data ?? []).length === 0)
  const execInterna = await A.rpc('imagem_saneamento_pendentes', { p_limite: 1 })
  t('authenticated NÃO executa a RPC interna da Edge Function', !!execInterna.error)
}

async function limpar() {
  try {
    for (const [b, n] of objetos) await admin.storage.from(b).remove([n]).catch(() => {})
    if (ids.a || ids.b) sql(`delete from public.imagem_saneamento where dono_id in ('${ids.a ?? randomUUID()}','${ids.b ?? randomUUID()}') or caminho like '%${ids.a ?? 'x-x'}%'`)
    for (const k of Object.keys(ids)) await admin.auth.admin.deleteUser(ids[k]).catch(() => {})
  } catch (e) { console.log('limpeza parcial:', e.message) }
}

try { await main() } catch (e) { falhas.push('EXCEÇÃO: ' + (e.message || e)); console.log(e) } finally { await limpar() }
console.log(`\n${falhas.length ? 'FALHOU' : 'OK'} — ${ok} verificações ok, ${falhas.length} falha(s)`)
falhas.forEach((f) => console.log('  -', f))
process.exit(falhas.length ? 1 : 0)
