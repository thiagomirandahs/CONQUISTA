// =============================================================================
//  Central de chamados (migration 290) por HTTP, contra o Supabase LOCAL: o admin da PLATAFORMA que
//  não tem vínculo com clube nenhum precisa conseguir contar, listar, abrir, ver o anexo, responder
//  e mudar o status de um chamado — e ninguém ganha vínculo fictício de clube para isso.
//  Personas: platform_admin SEM clube (hml-admin), platform_admin COM clube (e2e-cham-admin-clube),
//  usuário comum (hml-desbravador), diretoria (hml-diretoria_a), outra pessoa (hml-desbravador2).
//
//  Pré-requisito: node supabase/tests/e2e/_seed_homologacao.mjs
//  Uso: node supabase/tests/e2e/chamados-admin-sem-clube.mjs
//  Cria e apaga o que é dele (prefixo "e2e-cham-" / assunto "[E2E-CHAM]"). URL fixa em 127.0.0.1.
// =============================================================================
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const API_URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SENHA = 'senha-homologacao-123'
const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const sql = (t) => execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: t, encoding: 'utf8' }).trim()
let total = 0, reprovados = 0
const ok = (n, c, d = '') => { total++; if (!c) { reprovados++; console.log(`   FALHOU ${n}  [${d}]`) } else console.log(`   ok     ${n}`) }

async function logar(email, clube = null) {
  const f = (i, o = {}) => { const h = new Headers(o.headers || {}); if (clube) h.set('x-clube-atual', clube); return fetch(i, { ...o, headers: h }) }
  const c = createClient(API_URL, ANON, { auth: { persistSession: false }, global: { fetch: f } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: SENHA })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { c, uid: data.user.id }
}
function limpar() {
  sql(`
    delete from public.suporte_mensagens where chamado_id in (select id from public.suporte_chamados where assunto like '%[E2E-CHAM]%');
    delete from public.suporte_chamados where assunto like '%[E2E-CHAM]%';
    delete from public.platform_admins where user_id in (select id from auth.users where email like 'e2e-cham-%@teste.local');
    delete from public.organization_memberships where user_id in (select id from auth.users where email like 'e2e-cham-%@teste.local');
    delete from auth.users where email like 'e2e-cham-%@teste.local';
  `)
}

async function principal() {
  const clubeA = sql(`select id from public.organizational_units where slug='hml-clube-a';`)
  if (!clubeA) throw new Error('rode antes: node supabase/tests/e2e/_seed_homologacao.mjs')
  limpar()
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'e2e-cham-admin-clube@teste.local',
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{"nome":"E2E Admin com clube"}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false);
    delete from public.organization_memberships where user_id = (select id from auth.users where email = 'e2e-cham-admin-clube@teste.local');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select id, '${clubeA}', 'desbravador', 'ativo' from auth.users where email = 'e2e-cham-admin-clube@teste.local';
    insert into public.platform_admins (user_id, papel, motivo) select id, 'operacao', 'e2e chamados' from auth.users where email = 'e2e-cham-admin-clube@teste.local';
  `)
  const vinculos = (uid) => sql(`select count(*) from public.organization_memberships where user_id = '${uid}';`)

  const adminSem = await logar('hml-admin@teste.local')
  const adminCom = await logar('e2e-cham-admin-clube@teste.local', clubeA)
  const usuario = await logar('hml-desbravador@teste.local', clubeA)
  const diretoria = await logar('hml-diretoria_a@teste.local', clubeA)
  const outro = await logar('hml-desbravador2@teste.local')
  ok('[pré] o admin da plataforma SEM clube não tem vínculo nenhum', vinculos(adminSem.uid) === '0', vinculos(adminSem.uid))

  console.log('\n== usuário comum abre chamado com anexo ==')
  const anexo = `${usuario.uid}/${crypto.randomUUID()}.png`   // mesmo formato do app (src/services/suporte.js)
  const up = await usuario.c.storage.from('suporte-anexos').upload(anexo, PNG, { contentType: 'image/png' })
  ok('usuário sobe o anexo (bucket privado, pasta dele)', !up.error, up.error?.message)
  const ab = await usuario.c.rpc('suporte_chamado_abrir', { p_categoria: 'duvida', p_assunto: 'Não consigo enviar foto [E2E-CHAM]',
    p_descricao: 'Ao enviar a foto do requisito aparece erro. [E2E-CHAM]', p_anexo_path: anexo })
  const idCham = ab.data?.id || ab.data?.chamado_id || (typeof ab.data === 'string' ? ab.data : null)
  ok('usuário abre o chamado', !ab.error && !!idCham, ab.error?.message || JSON.stringify(ab.data))

  for (const [rotulo, adm] of [['SEM clube', adminSem], ['COM clube', adminCom]]) {
    console.log(`\n== platform_admin ${rotulo} ==`)
    const cont = await adm.c.rpc('admin_chamados_contagem')
    ok(`[${rotulo}] contador mostra o chamado`, !cont.error && Number(cont.data) >= 1, cont.error?.message)
    const lista = await adm.c.rpc('admin_chamados_listar', { p_filtro: 'abertos' })
    ok(`[${rotulo}] lista o chamado`, !lista.error && JSON.stringify(lista.data).includes(idCham), lista.error?.message)
    const ver = await adm.c.rpc('admin_chamado_ver', { p_id: idCham })
    ok(`[${rotulo}] abre o chamado (assunto e descrição)`, !ver.error && JSON.stringify(ver.data).includes('Não consigo enviar foto'), ver.error?.message)
    const dl = await adm.c.storage.from('suporte-anexos').download(anexo)
    ok(`[${rotulo}] abre o anexo`, !dl.error, dl.error?.message)
    const resp = await adm.c.rpc('admin_chamado_responder', { p_id: idCham, p_texto: `Resposta do admin ${rotulo} [E2E-CHAM]` })
    ok(`[${rotulo}] responde`, !resp.error, resp.error?.message)
    const nota = await adm.c.rpc('admin_chamado_responder', { p_id: idCham, p_texto: `nota interna ${rotulo} [E2E-CHAM]`, p_interna: true })
    ok(`[${rotulo}] grava nota interna`, !nota.error, nota.error?.message)
    const at = await adm.c.rpc('admin_chamado_atualizar', { p_id: idCham, p_status: 'em_andamento', p_assumir: true })
    ok(`[${rotulo}] muda o status e assume`, !at.error, at.error?.message)
  }
  ok('[SEM clube] continuou sem vínculo nenhum depois de tratar o chamado (nada fictício foi criado)', vinculos(adminSem.uid) === '0', vinculos(adminSem.uid))

  console.log('\n== quem NÃO é da plataforma ==')
  for (const [rotulo, s] of [['usuário comum', usuario], ['diretoria do clube', diretoria], ['outra pessoa', outro]]) {
    ok(`[${rotulo}] não usa o contador da plataforma`, !!(await s.c.rpc('admin_chamados_contagem')).error)
    ok(`[${rotulo}] não lista chamados da plataforma`, !!(await s.c.rpc('admin_chamados_listar', { p_filtro: 'abertos' })).error)
    ok(`[${rotulo}] não abre pelo painel da plataforma`, !!(await s.c.rpc('admin_chamado_ver', { p_id: idCham })).error)
    ok(`[${rotulo}] não responde como plataforma`, !!(await s.c.rpc('admin_chamado_responder', { p_id: idCham, p_texto: 'x' })).error)
  }
  const verDir = await diretoria.c.rpc('suporte_chamado_ver', { p_id: idCham })
  ok('a diretoria do clube não lê o chamado de um membro', !!verDir.error || verDir.data == null)
  ok('outra pessoa não abre o anexo', !!(await outro.c.storage.from('suporte-anexos').download(anexo)).error)
  ok('a diretoria não abre o anexo', !!(await diretoria.c.storage.from('suporte-anexos').download(anexo)).error)

  console.log('\n== o autor vê a resposta (e não a nota interna) ==')
  const meu = await usuario.c.rpc('suporte_chamado_ver', { p_id: idCham })
  const mj = JSON.stringify(meu.data || {})
  ok('o autor vê a resposta do admin', !meu.error && mj.includes('Resposta do admin SEM clube'), meu.error?.message)
  ok('o autor NÃO vê a nota interna', !mj.includes('nota interna'))
  const notif = sql(`select count(*) from public.notificacoes where para_usuario = '${usuario.uid}' and tipo = 'suporte' and link like '%${idCham}%';`)
  ok('o autor foi notificado da resposta', Number(notif) >= 1, notif)
}

principal()
  .catch((e) => { reprovados++; console.log('ERRO INESPERADO:', e) })
  .finally(() => {
    try { limpar() } catch (e) { console.log('limpeza falhou:', e.message) }
    console.log(`\n${total - reprovados}/${total} ok${reprovados ? ` — ${reprovados} FALHA(S)` : ' — TUDO OK'}`)
    process.exitCode = reprovados ? 1 : 0
  })
